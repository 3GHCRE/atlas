#!/usr/bin/env python3
"""
Medicaid Rates Update Script
Updates rates from source sites while preserving history.

Usage:
    python update_rates.py --check          # Check which states need updates
    python update_rates.py --fetch FL       # Fetch latest rates for a state
    python update_rates.py --load FL        # Load new rates (closes old, inserts new)
    python update_rates.py --history FL     # Show rate history for a state
    python update_rates.py --changes        # Show period-over-period changes

Dependencies:
    pip install pandas openpyxl mysql-connector-python requests beautifulsoup4
"""

import argparse
import os
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import logging

import pandas as pd
import mysql.connector
from mysql.connector import Error

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# Database connection settings
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 3306)),
    "database": os.getenv("DB_NAME", "atlas"),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", "devpass"),
}

# Source file directory
SOURCE_DIR = Path(r"G:\My Drive\3G\Source NF Rates")


def get_db_connection():
    """Create database connection."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        return conn
    except Error as e:
        logger.error(f"Database connection failed: {e}")
        raise


def check_update_status():
    """Check which states need rate updates."""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    print("\n" + "=" * 90)
    print("RATE UPDATE STATUS")
    print("=" * 90)

    cursor.execute("""
        SELECT
            mrs.state,
            mrs.update_frequency,
            mrs.requires_user_auth,
            mrs.source_url,
            MAX(mr.effective_date) as latest_rate_date,
            COUNT(DISTINCT mr.effective_date) as periods_loaded
        FROM medicaid_rate_sources mrs
        LEFT JOIN medicaid_rates mr ON mrs.state = mr.state
        WHERE mrs.is_active = TRUE
        GROUP BY mrs.state, mrs.update_frequency, mrs.requires_user_auth, mrs.source_url
        ORDER BY mrs.state
    """)

    results = cursor.fetchall()

    print(f"\n{'State':<6} {'Frequency':<12} {'Auth':<5} {'Latest Rate':<12} {'Periods':<8} {'Status'}")
    print("-" * 90)

    today = date.today()
    for row in results:
        latest = row['latest_rate_date']
        freq = row['update_frequency']
        auth = 'Yes' if row['requires_user_auth'] else 'No'

        # Determine if update needed
        if latest is None:
            status = "NO DATA"
        else:
            days_old = (today - latest).days
            if freq == 'Quarterly' and days_old > 100:
                status = f"UPDATE NEEDED ({days_old}d old)"
            elif freq == 'Biannually' and days_old > 200:
                status = f"UPDATE NEEDED ({days_old}d old)"
            elif freq == 'Annually' and days_old > 380:
                status = f"UPDATE NEEDED ({days_old}d old)"
            else:
                status = "Current"

        print(f"{row['state']:<6} {freq:<12} {auth:<5} {str(latest):<12} {row['periods_loaded']:<8} {status}")

    conn.close()


def show_source_urls():
    """Display source URLs for all states."""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    print("\n" + "=" * 100)
    print("RATE SOURCE URLS")
    print("=" * 100)

    cursor.execute("""
        SELECT state, update_frequency, requires_user_auth, source_url, notes
        FROM medicaid_rate_sources
        WHERE is_active = TRUE
        ORDER BY state
    """)

    for row in cursor.fetchall():
        auth = "[AUTH REQUIRED]" if row['requires_user_auth'] else ""
        print(f"\n{row['state']} ({row['update_frequency']}) {auth}")
        print(f"  URL: {row['source_url'] or 'N/A'}")
        if row['notes']:
            print(f"  Notes: {row['notes'][:100]}...")

    conn.close()


def show_rate_history(state: str):
    """Show rate history for a specific state."""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    print(f"\n{'=' * 70}")
    print(f"RATE HISTORY: {state}")
    print("=" * 70)

    # State summary by period
    cursor.execute("""
        SELECT
            effective_date,
            COUNT(*) as facilities,
            ROUND(MIN(daily_rate), 2) as min_rate,
            ROUND(AVG(daily_rate), 2) as avg_rate,
            ROUND(MAX(daily_rate), 2) as max_rate
        FROM medicaid_rates
        WHERE state = %s AND daily_rate > 0
        GROUP BY effective_date
        ORDER BY effective_date DESC
    """, (state,))

    results = cursor.fetchall()

    if not results:
        print(f"\nNo rate data found for {state}")
        conn.close()
        return

    print(f"\n{'Period':<12} {'Facilities':>10} {'Min':>10} {'Avg':>10} {'Max':>10}")
    print("-" * 55)

    prev_avg = None
    for row in results:
        avg = float(row['avg_rate'])
        if prev_avg:
            change = f" ({(avg - prev_avg) / prev_avg * 100:+.1f}%)"
        else:
            change = ""
        print(f"{str(row['effective_date']):<12} {row['facilities']:>10} ${row['min_rate']:>8} ${row['avg_rate']:>8}{change} ${row['max_rate']:>8}")
        prev_avg = avg

    conn.close()


def show_rate_changes():
    """Show period-over-period rate changes."""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    print("\n" + "=" * 90)
    print("PERIOD-OVER-PERIOD RATE CHANGES")
    print("=" * 90)

    # Check if we have any changes
    cursor.execute("""
        SELECT COUNT(*) as cnt FROM v_rate_changes WHERE prior_rate IS NOT NULL
    """)
    result = cursor.fetchone()

    if result['cnt'] == 0:
        print("\nNo rate changes found - only one period loaded per facility.")
        print("Load historical rate data to see period-over-period changes.")
        conn.close()
        return

    # State-level changes
    cursor.execute("""
        SELECT
            state,
            COUNT(*) as facilities,
            ROUND(AVG(rate_change_dollar), 2) as avg_change_dollar,
            ROUND(AVG(rate_change_pct), 2) as avg_change_pct,
            SUM(CASE WHEN rate_change_pct > 0 THEN 1 ELSE 0 END) as increases,
            SUM(CASE WHEN rate_change_pct < 0 THEN 1 ELSE 0 END) as decreases
        FROM v_rate_changes
        WHERE prior_rate IS NOT NULL
        GROUP BY state
        ORDER BY avg_change_pct DESC
    """)

    results = cursor.fetchall()

    print(f"\n{'State':<6} {'Facilities':>10} {'Avg $ Change':>12} {'Avg % Change':>12} {'Increases':>10} {'Decreases':>10}")
    print("-" * 70)

    for row in results:
        print(f"{row['state']:<6} {row['facilities']:>10} ${row['avg_change_dollar']:>10} {row['avg_change_pct']:>10}% {row['increases']:>10} {row['decreases']:>10}")

    conn.close()


def load_new_rates(state: str, filepath: Path, effective_date: date):
    """
    Load new rates for a state while preserving history.

    Process:
    1. Set end_date on existing current rates for the state
    2. Insert new rates with the new effective_date
    3. Run matching against property_master
    """
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    logger.info(f"Loading new rates for {state} from {filepath}")

    # Import the ETL functions
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from load_medicaid_rates import process_file
    from state_mappings import get_state_config

    try:
        # 1. Close out existing current rates
        cursor.execute("""
            UPDATE medicaid_rates
            SET end_date = %s
            WHERE state = %s AND end_date IS NULL
        """, (effective_date, state))
        closed = cursor.rowcount
        logger.info(f"Closed {closed} existing rate records")

        # 2. Process new file
        df = process_file(filepath, state)
        df['effective_date'] = effective_date

        # 3. Insert new rates
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
        for _, row in df.iterrows():
            try:
                cursor.execute(insert_sql, {
                    "state": row["state"],
                    "facility_name": row["facility_name"],
                    "state_facility_id": row.get("state_facility_id"),
                    "daily_rate": row["daily_rate"],
                    "rate_type": row.get("rate_type", "total"),
                    "effective_date": effective_date,
                    "source_file": row.get("source_file"),
                    "data_source": "state_medicaid_update"
                })
                rows_inserted += 1
            except Error as e:
                logger.warning(f"Insert failed for {row['facility_name']}: {e}")

        conn.commit()
        logger.info(f"Inserted {rows_inserted} new rate records")

        # 4. Summary
        print(f"\n{'=' * 50}")
        print(f"RATE UPDATE COMPLETE: {state}")
        print("=" * 50)
        print(f"  Previous records closed: {closed}")
        print(f"  New records inserted: {rows_inserted}")
        print(f"  Effective date: {effective_date}")
        print("\nRun facility matching to link new rates to property_master")

    except Exception as e:
        conn.rollback()
        logger.error(f"Rate update failed: {e}")
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Medicaid Rates Update Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python update_rates.py --check              # Check which states need updates
    python update_rates.py --sources            # Show source URLs
    python update_rates.py --history FL         # Show rate history for FL
    python update_rates.py --changes            # Show period-over-period changes
    python update_rates.py --load FL --file "path/to/file.xlsx" --date 2026-01-01
        """
    )

    parser.add_argument("--check", action="store_true", help="Check update status")
    parser.add_argument("--sources", action="store_true", help="Show source URLs")
    parser.add_argument("--history", type=str, metavar="STATE", help="Show rate history for state")
    parser.add_argument("--changes", action="store_true", help="Show rate changes")
    parser.add_argument("--load", type=str, metavar="STATE", help="Load new rates for state")
    parser.add_argument("--file", type=str, help="Path to rate file (for --load)")
    parser.add_argument("--date", type=str, help="Effective date YYYY-MM-DD (for --load)")

    args = parser.parse_args()

    if args.check:
        check_update_status()
    elif args.sources:
        show_source_urls()
    elif args.history:
        show_rate_history(args.history.upper())
    elif args.changes:
        show_rate_changes()
    elif args.load:
        if not args.file or not args.date:
            print("Error: --load requires --file and --date")
            sys.exit(1)
        filepath = Path(args.file)
        if not filepath.exists():
            print(f"Error: File not found: {filepath}")
            sys.exit(1)
        effective_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        load_new_rates(args.load.upper(), filepath, effective_date)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
