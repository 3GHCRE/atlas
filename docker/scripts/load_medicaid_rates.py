#!/usr/bin/env python3
"""
Medicaid Rates ETL Pipeline
Loads compiled rate files from 9 states into the medicaid_rates table.

Usage:
    python load_medicaid_rates.py --scan-only        # Scan files and report columns
    python load_medicaid_rates.py --execute          # Load data to database
    python load_medicaid_rates.py --report-unmatched # Show facilities without property_master match

Dependencies:
    pip install pandas openpyxl mysql-connector-python rapidfuzz
"""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import logging

import pandas as pd
import mysql.connector
from mysql.connector import Error

# Import our column mapping module
try:
    from state_mappings import (
        detect_columns,
        validate_required_columns,
        get_state_config
    )
except ImportError:
    # If running from different directory
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from state_mappings import (
        detect_columns,
        validate_required_columns,
        get_state_config
    )

# ============================================
# CONFIGURATION
# ============================================

# Database connection settings (from docker-compose.yml)
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 3306)),
    "database": os.getenv("DB_NAME", "atlas"),
    "user": os.getenv("DB_USER", "atlas_user"),
    "password": os.getenv("DB_PASSWORD", "atlas_pass"),
}

# Path to compiled rate files (relative to script location)
# Adjust based on where script is run from
COMPILED_RATES_DIR = Path(__file__).parent.parent.parent / "data" / "medicaid_rates" / "compiled" / "Compiled NF Rates"

# Expected states in compiled directory
EXPECTED_STATES = ["FL", "GA", "IL", "IN", "MS", "NY", "OH", "PA", "VA"]

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)


# ============================================
# DATABASE FUNCTIONS
# ============================================

def get_db_connection():
    """Create database connection."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        logger.info(f"Connected to database: {DB_CONFIG['database']}")
        return conn
    except Error as e:
        logger.error(f"Database connection failed: {e}")
        raise


def insert_rates(conn, rates_df: pd.DataFrame) -> int:
    """
    Insert rates dataframe into medicaid_rates table.

    Args:
        conn: Database connection
        rates_df: DataFrame with standardized columns

    Returns:
        Number of rows inserted
    """
    cursor = conn.cursor()

    insert_sql = """
    INSERT INTO medicaid_rates (
        state, facility_name, state_facility_id, daily_rate,
        rate_type, effective_date, source_file, data_source
    ) VALUES (
        %(state)s, %(facility_name)s, %(state_facility_id)s, %(daily_rate)s,
        %(rate_type)s, %(effective_date)s, %(source_file)s, %(data_source)s
    )
    """

    rows_inserted = 0
    for _, row in rates_df.iterrows():
        try:
            cursor.execute(insert_sql, {
                "state": row["state"],
                "facility_name": row["facility_name"],
                "state_facility_id": row.get("state_facility_id"),
                "daily_rate": row["daily_rate"],
                "rate_type": row.get("rate_type", "total"),
                "effective_date": row.get("effective_date", datetime.now().date()),
                "source_file": row.get("source_file"),
                "data_source": "state_medicaid_compiled"
            })
            rows_inserted += 1
        except Error as e:
            logger.warning(f"Insert failed for {row['facility_name']}: {e}")

    conn.commit()
    cursor.close()
    return rows_inserted


def log_collection(conn, state: str, status: str, files: int, records: int, error: str = None):
    """Log collection attempt to medicaid_rate_collection_log."""
    cursor = conn.cursor()

    # Get rate_source_id for state
    cursor.execute(
        "SELECT id FROM medicaid_rate_sources WHERE state = %s",
        (state,)
    )
    result = cursor.fetchone()

    if result:
        source_id = result[0]
        cursor.execute(
            """
            INSERT INTO medicaid_rate_collection_log
            (rate_source_id, status, files_found, records_loaded, error_message)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (source_id, status, files, records, error)
        )
        conn.commit()

    cursor.close()


# ============================================
# FILE PROCESSING FUNCTIONS
# ============================================

def find_rate_files(directory: Path) -> Dict[str, Path]:
    """
    Find all rate files in the compiled directory.

    Returns:
        Dict mapping state code to file path
    """
    files = {}

    if not directory.exists():
        logger.error(f"Directory not found: {directory}")
        return files

    for file in directory.glob("*.xlsx"):
        # Extract state from filename pattern: "XX - Compiled Rates.xlsx"
        parts = file.stem.split(" - ")
        if len(parts) >= 1:
            state = parts[0].strip().upper()
            if len(state) == 2:
                files[state] = file
                logger.debug(f"Found: {state} -> {file.name}")

    return files


def scan_file(filepath: Path, state: str) -> Dict:
    """
    Scan a rate file and report detected columns.

    Returns:
        Dict with scan results
    """
    config = get_state_config(state)

    try:
        df = pd.read_excel(
            filepath,
            sheet_name=config.get("sheet_name", 0),
            nrows=5  # Just peek at first few rows
        )

        columns = list(df.columns)
        detected = detect_columns(state, columns)
        valid = validate_required_columns(detected)

        # Format columns for display (handle datetime objects)
        display_columns = []
        for col in columns:
            if hasattr(col, 'strftime'):
                display_columns.append(col.strftime('%Y-%m-%d'))
            else:
                display_columns.append(str(col))

        return {
            "state": state,
            "file": filepath.name,
            "columns_found": display_columns,
            "detected_mapping": detected,
            "valid": valid,
            "row_count": len(pd.read_excel(filepath, sheet_name=config.get("sheet_name", 0))),
            "error": None
        }

    except Exception as e:
        return {
            "state": state,
            "file": filepath.name,
            "columns_found": [],
            "detected_mapping": {},
            "valid": False,
            "row_count": 0,
            "error": str(e)
        }


def process_file(filepath: Path, state: str) -> pd.DataFrame:
    """
    Process a rate file and return normalized DataFrame.

    Args:
        filepath: Path to Excel file
        state: State code

    Returns:
        Normalized DataFrame ready for insertion
    """
    config = get_state_config(state)

    # Read full file
    df = pd.read_excel(
        filepath,
        sheet_name=config.get("sheet_name", 0),
        skiprows=config.get("skip_rows", 0)
    )

    # Detect columns
    detected = detect_columns(state, list(df.columns))

    if not validate_required_columns(detected):
        raise ValueError(
            f"Missing required columns for {state}. "
            f"Detected: {detected}"
        )

    # Build normalized dataframe - start with facility_name to set index length
    normalized = pd.DataFrame()
    normalized["facility_name"] = df[detected["facility_name"]].astype(str).str.strip()
    normalized["state"] = state  # Now this will broadcast to all rows

    # Daily rate - handle various formats
    rate_col = detected["daily_rate"]
    # Handle datetime column headers
    rate_values = df[rate_col]
    if hasattr(rate_values.iloc[0] if len(rate_values) > 0 else None, 'strip'):
        normalized["daily_rate"] = pd.to_numeric(
            rate_values.astype(str).str.replace(r'[\$,]', '', regex=True),
            errors='coerce'
        )
    else:
        normalized["daily_rate"] = pd.to_numeric(rate_values, errors='coerce')

    # Optional columns
    if detected.get("state_facility_id"):
        normalized["state_facility_id"] = df[detected["state_facility_id"]].astype(str).str.strip()
    else:
        normalized["state_facility_id"] = None

    # Effective date - use _rate_date if available (from date column header)
    if detected.get("_rate_date"):
        # Date column header was used as rate column
        rate_date = detected["_rate_date"]
        if hasattr(rate_date, 'date'):
            normalized["effective_date"] = rate_date.date()
        else:
            normalized["effective_date"] = rate_date
    elif detected.get("effective_date"):
        try:
            normalized["effective_date"] = pd.to_datetime(
                df[detected["effective_date"]], errors='coerce'
            ).dt.date
        except Exception:
            normalized["effective_date"] = datetime.now().date()
    else:
        # Default to current date if not found
        normalized["effective_date"] = datetime.now().date()

    normalized["rate_type"] = "total"
    normalized["source_file"] = filepath.name

    # Clean up - remove rows with invalid rates
    normalized = normalized[normalized["daily_rate"].notna()]
    normalized = normalized[normalized["daily_rate"] > 0]
    normalized = normalized[normalized["facility_name"].str.len() > 0]

    # Remove duplicates (keep first)
    normalized = normalized.drop_duplicates(
        subset=["state", "facility_name"],
        keep="first"
    )

    return normalized


# ============================================
# MAIN OPERATIONS
# ============================================

def scan_only(directory: Path):
    """Scan all files and report column mappings."""
    print("\n" + "=" * 70)
    print("MEDICAID RATES FILE SCAN")
    print("=" * 70)

    files = find_rate_files(directory)

    if not files:
        print(f"\nNo files found in: {directory}")
        return

    print(f"\nFound {len(files)} files in: {directory}")
    print("-" * 70)

    total_rows = 0
    valid_count = 0

    for state in sorted(files.keys()):
        filepath = files[state]
        result = scan_file(filepath, state)

        status = "VALID" if result["valid"] else "INVALID"
        if result["error"]:
            status = "ERROR"

        print(f"\n=== {state} - {result['file']} ===")
        print(f"Status: {status}")
        print(f"Rows: {result['row_count']}")

        if result["error"]:
            print(f"Error: {result['error']}")
        else:
            print(f"Columns: {result['columns_found']}")
            print("Mapped:")
            for field, col in result["detected_mapping"].items():
                if field.startswith("_"):
                    continue  # Skip internal fields
                # Format datetime columns for display
                display_col = col
                if col is not None and hasattr(col, 'strftime'):
                    display_col = col.strftime('%Y-%m-%d')
                marker = "+" if col else "x"
                print(f"  [{marker}] {field}: {display_col}")
            # Show rate date if from column header
            if result["detected_mapping"].get("_rate_date"):
                rate_date = result["detected_mapping"]["_rate_date"]
                if hasattr(rate_date, 'strftime'):
                    print(f"  [*] rate_date (from column header): {rate_date.strftime('%Y-%m-%d')}")

            total_rows += result["row_count"]
            if result["valid"]:
                valid_count += 1

    print("\n" + "-" * 70)
    print(f"SUMMARY: {valid_count}/{len(files)} files valid, ~{total_rows:,} total rows")
    print("=" * 70)


def execute_load(directory: Path):
    """Load all valid files to database."""
    print("\n" + "=" * 70)
    print("MEDICAID RATES ETL - EXECUTE MODE")
    print("=" * 70)

    files = find_rate_files(directory)
    if not files:
        print(f"\nNo files found in: {directory}")
        return

    conn = get_db_connection()
    total_loaded = 0
    states_loaded = []
    states_failed = []

    for state in sorted(files.keys()):
        filepath = files[state]
        print(f"\nProcessing {state}...")

        try:
            df = process_file(filepath, state)
            rows = insert_rates(conn, df)
            log_collection(conn, state, "success", 1, rows)

            print(f"  Loaded {rows:,} rates from {filepath.name}")
            total_loaded += rows
            states_loaded.append(state)

        except Exception as e:
            logger.error(f"  Failed: {e}")
            log_collection(conn, state, "failed", 1, 0, str(e))
            states_failed.append(state)

    conn.close()

    print("\n" + "-" * 70)
    print(f"RESULTS:")
    print(f"  Loaded: {', '.join(states_loaded)} ({len(states_loaded)} states)")
    print(f"  Failed: {', '.join(states_failed) if states_failed else 'None'}")
    print(f"  Total rates: {total_loaded:,}")
    print("=" * 70)


def report_unmatched():
    """Report facilities without property_master matches."""
    print("\n" + "=" * 70)
    print("UNMATCHED FACILITIES REPORT")
    print("=" * 70)

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    # Summary by state
    cursor.execute("""
        SELECT
            state,
            COUNT(*) as total_rates,
            COUNT(property_master_id) as matched,
            COUNT(*) - COUNT(property_master_id) as unmatched,
            ROUND(COUNT(property_master_id) * 100.0 / COUNT(*), 1) as match_pct
        FROM medicaid_rates
        WHERE end_date IS NULL
        GROUP BY state
        ORDER BY state
    """)

    results = cursor.fetchall()

    print("\nMatch Summary by State:")
    print("-" * 70)
    print(f"{'State':<8} {'Total':<10} {'Matched':<10} {'Unmatched':<12} {'Match %':<10}")
    print("-" * 70)

    for row in results:
        print(f"{row['state']:<8} {row['total_rates']:<10} {row['matched']:<10} {row['unmatched']:<12} {row['match_pct']:<10}%")

    # Sample unmatched facilities
    print("\n\nSample Unmatched Facilities (first 5 per state):")
    print("-" * 70)

    for row in results:
        if row['unmatched'] > 0:
            cursor.execute("""
                SELECT facility_name, daily_rate
                FROM medicaid_rates
                WHERE state = %s AND property_master_id IS NULL
                LIMIT 5
            """, (row['state'],))

            facilities = cursor.fetchall()
            print(f"\n{row['state']}:")
            for f in facilities:
                print(f"  - {f['facility_name']} (${f['daily_rate']}/day)")

    cursor.close()
    conn.close()
    print("\n" + "=" * 70)


# ============================================
# CLI ENTRY POINT
# ============================================

def main():
    parser = argparse.ArgumentParser(
        description="Medicaid Rates ETL Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python load_medicaid_rates.py --scan-only
    python load_medicaid_rates.py --execute
    python load_medicaid_rates.py --report-unmatched
    python load_medicaid_rates.py --directory /path/to/files --scan-only
        """
    )

    parser.add_argument(
        "--scan-only",
        action="store_true",
        help="Scan files and report column mappings without loading"
    )

    parser.add_argument(
        "--execute",
        action="store_true",
        help="Execute full ETL load to database"
    )

    parser.add_argument(
        "--report-unmatched",
        action="store_true",
        help="Report facilities without property_master matches"
    )

    parser.add_argument(
        "--directory",
        type=Path,
        default=COMPILED_RATES_DIR,
        help=f"Directory containing rate files (default: {COMPILED_RATES_DIR})"
    )

    parser.add_argument(
        "--state",
        type=str,
        help="Process only a specific state (e.g., FL)"
    )

    args = parser.parse_args()

    if not any([args.scan_only, args.execute, args.report_unmatched]):
        parser.print_help()
        print("\nError: Must specify --scan-only, --execute, or --report-unmatched")
        sys.exit(1)

    # Override directory if provided
    directory = args.directory

    if args.scan_only:
        scan_only(directory)
    elif args.execute:
        execute_load(directory)
    elif args.report_unmatched:
        report_unmatched()


if __name__ == "__main__":
    main()
