"""
State-specific column mappings for Medicaid rate files.
Each state publishes rates in different formats - this module provides
configuration-driven column detection for the ETL pipeline.

Usage:
    from state_mappings import STATE_CONFIGS, find_matching_column
"""

from typing import List, Optional, Dict, Any, Tuple
from rapidfuzz import fuzz, process

# ============================================
# STATE CONFIGURATIONS
# Maps state-specific column names to standard schema fields
# ============================================

STATE_CONFIGS: Dict[str, Dict[str, Any]] = {
    "FL": {
        "facility_name_cols": [
            "Facility Name", "Provider Name", "Nursing Facility",
            "Provider", "NH Name", "NF Name"
        ],
        "rate_cols": [
            "Total Rate", "Per Diem Rate", "Daily Rate", "Rate",
            "Total Per Diem", "Medicaid Rate", "Per Diem"
        ],
        "id_cols": [
            "Provider Number", "Provider ID", "Medicaid Provider #",
            "License Number", "NPI", "Provider No"
        ],
        "effective_date_col": ["Effective Date", "Rate Effective", "Eff Date"],
        "skip_rows": 0,
        "sheet_name": 0,
        "notes": "FL requires manual download from AHCA portal"
    },
    "GA": {
        "facility_name_cols": [
            "Provider Name", "Facility Name", "Facility", "Name",
            "Nursing Home Name", "NF Name"
        ],
        "rate_cols": [
            "Per Diem Rate", "Rate", "Per Diem", "Daily Rate",
            "Medicaid Rate", "Total Rate", "Reimbursement Rate"
        ],
        "id_cols": [
            "Provider ID", "Provider Number", "Medicaid ID",
            "Provider No", "ID"
        ],
        "effective_date_col": ["Effective Date", "Effective"],
        "skip_rows": 0,
        "sheet_name": 0,
        "notes": "Quarterly updates from DCH"
    },
    "IL": {
        "facility_name_cols": [
            "Facility Name", "Provider Name", "Name", "Facility",
            "Nursing Facility Name", "NF Name"
        ],
        "rate_cols": [
            "Total Rate", "Per Diem Rate", "Rate", "All Rate",
            "Combined Rate", "Daily Rate", "Total"
        ],
        "id_cols": [
            "Provider Number", "Provider ID", "Medicaid Provider No",
            "Provider", "ID", "License"
        ],
        "effective_date_col": ["Effective Date", "Rate Date", "Effective"],
        "skip_rows": 0,
        "sheet_name": 0,
        "notes": "Files starting with 'allrt' are the main rate files"
    },
    "IN": {
        "facility_name_cols": [
            "Provider Name", "Facility Name", "Facility", "Name",
            "NF Name", "Provider"
        ],
        "rate_cols": [
            "Per Diem Rate", "Rate", "Total Rate", "Daily Rate",
            "Per Diem", "Reimbursement"
        ],
        "id_cols": [
            "Provider Number", "Provider ID", "NPI", "Provider No",
            "Indiana Provider ID", "Medicaid ID"
        ],
        "effective_date_col": ["Rate Effective Date", "Effective Date", "Effective"],
        "skip_rows": 0,
        "sheet_name": 0,
        "notes": "Provider Index Report from Myers and Stauffer"
    },
    "MS": {
        "facility_name_cols": [
            "Facility Name", "Provider Name", "Name", "Facility",
            "Nursing Facility", "NF Name"
        ],
        "rate_cols": [
            "Rate", "Per Diem Rate", "Daily Rate", "Total Rate",
            "Medicaid Rate", "Per Diem"
        ],
        "id_cols": [
            "Provider Number", "Provider ID", "Medicaid ID",
            "Provider No", "ID"
        ],
        "effective_date_col": ["Effective Date", "Quarter", "Period"],
        "skip_rows": 0,
        "sheet_name": 0,
        "notes": "Quarterly NF rate files"
    },
    "NY": {
        "facility_name_cols": [
            "Facility Name", "Provider Name", "Nursing Home Name",
            "Name", "NH Name", "Facility"
        ],
        "rate_cols": [
            "Rate", "Per Diem Rate", "Total Rate", "Daily Rate",
            "Operating", "Capital", "Total"
        ],
        "id_cols": [
            "Provider Number", "Provider ID", "PFI", "Medicaid ID",
            "Operating Certificate", "Provider No"
        ],
        "effective_date_col": ["Effective Date", "Rate Period", "Period"],
        "skip_rows": 0,
        "sheet_name": 0,
        "notes": "NY requires manual download, annual updates"
    },
    "OH": {
        "facility_name_cols": [
            "Provider Name", "Facility Name", "Facility", "Name",
            "NF Name", "Nursing Facility"
        ],
        "rate_cols": [
            "Total Rate", "Per Diem Rate", "Rate", "Daily Rate",
            "Combined Rate", "Medicaid Rate"
        ],
        "id_cols": [
            "Provider Number", "Provider ID", "Medicaid Provider Number",
            "ODM Provider ID", "Provider No"
        ],
        "effective_date_col": ["Effective Date", "Rate Effective Date", "Effective"],
        "skip_rows": 0,
        "sheet_name": 0,
        "notes": "Look for NF_Rates or RSProvRatecCmpDataNF files"
    },
    "PA": {
        "facility_name_cols": [
            "Provider Name", "Facility Name", "Nursing Facility",
            "Name", "Facility", "MA Provider Name"
        ],
        "rate_cols": [
            "Per Diem Rate", "Rate", "Total Rate", "Daily Rate",
            "CHC Rate", "MA Rate", "Minimum Payment Rate", "MPR"
        ],
        "id_cols": [
            "Provider Number", "Provider ID", "MA ID", "Medicaid ID",
            "Provider No", "MPI"
        ],
        "effective_date_col": ["Effective Date", "Quarter", "Period"],
        "skip_rows": 0,
        "sheet_name": 0,
        "notes": "CHC-MPR files for quarterly rates"
    },
    "VA": {
        "facility_name_cols": [
            "Skilled Nursing Facility Name", "Facility Name",
            "Provider Name", "SNF Name", "Name", "Facility"
        ],
        "rate_cols": [
            "Skilled Nursing Facility Rate", "SNF Rate", "Rate",
            "Per Diem Rate", "Daily Rate", "Total Rate"
        ],
        "id_cols": [
            "Provider Number", "Provider ID", "NPI", "Medicaid ID",
            "Provider No", "License Number"
        ],
        "effective_date_col": ["Effective Date", "Rate Effective", "Period"],
        "skip_rows": 0,
        "sheet_name": 0,
        "notes": "Price-based rates files, biannual updates"
    },
    "WA": {
        "facility_name_cols": [
            "Vendor Name", "Provider Name", "Facility Name", "Name"
        ],
        "rate_cols": [
            "TR", "Total Rate", "TL", "Rate", "Per Diem Rate"
        ],
        "id_cols": [
            "License Number", "Vendor ID", "NPI", "Location ID", "Provider Number"
        ],
        "effective_date_col": ["Effective Date", "Rate Effective"],
        "skip_rows": 6,
        "sheet_name": 0,
        "notes": "DSHS Current Rate Report - header on row 7"
    },
    "IA": {
        "facility_name_cols": [
            "Provider Name", "Facility Name", "Name", "Facility"
        ],
        "rate_cols": [],  # Uses date columns for rates
        "id_cols": [
            "NPI", "Provider Number", "Provider ID", "Medicaid ID"
        ],
        "effective_date_col": [],  # Date is in column headers
        "skip_rows": 8,
        "sheet_name": 0,
        "use_date_columns": True,
        "notes": "Cumulative Rate Listing - rates in date columns, header row 9"
    },
    "CA": {
        "facility_name_cols": [
            "Facility Name", "Provider Name", "Name"
        ],
        "rate_cols": [
            "Accommodation Code 01", "FS/NF-B Regular Services",
            "Rate", "Per Diem Rate", "Daily Rate"
        ],
        "id_cols": [
            "HCAI ID", "NPI", "Provider Number", "Provider ID"
        ],
        "effective_date_col": ["Rate Published", "Effective Date"],
        "skip_rows": 3,
        "sheet_name": 0,
        "notes": "CY Rates on File - header row 4"
    },
    "VT": {
        "facility_name_cols": [
            "Provider Name", "Facility Name", "Name", "Facility"
        ],
        "rate_cols": [
            "Rate", "Per Diem Rate", "Daily Rate", "Total Rate"
        ],
        "id_cols": [
            "Provider Number", "Provider ID", "NPI", "Medicaid ID"
        ],
        "effective_date_col": ["Effective Date", "Period"],
        "skip_rows": 0,
        "sheet_name": 0,
        "file_type": "pdf",
        "notes": "Quarterly rate list PDF - requires PDF extraction"
    },
}

# Default config for states without specific mapping
DEFAULT_CONFIG: Dict[str, Any] = {
    "facility_name_cols": [
        "Facility Name", "Provider Name", "Name", "Facility",
        "Nursing Facility", "NF Name", "Provider"
    ],
    "rate_cols": [
        "Rate", "Per Diem Rate", "Daily Rate", "Total Rate",
        "Per Diem", "Medicaid Rate", "Reimbursement Rate"
    ],
    "id_cols": [
        "Provider Number", "Provider ID", "Medicaid ID",
        "Provider No", "NPI", "ID", "License"
    ],
    "effective_date_col": ["Effective Date", "Rate Date", "Effective", "Period"],
    "skip_rows": 0,
    "sheet_name": 0,
    "notes": "Using default column detection"
}


def find_matching_column(
    available_columns: List[str],
    target_patterns: List[str],
    min_score: int = 80
) -> Optional[str]:
    """
    Find the best matching column from available columns using fuzzy matching.

    Priority:
    1. Exact match (case-insensitive)
    2. Contains match
    3. Fuzzy match (>= min_score)

    Args:
        available_columns: List of column names from the file
        target_patterns: List of expected column name patterns
        min_score: Minimum fuzzy match score (0-100)

    Returns:
        Best matching column name or None if no match found
    """
    # Normalize available columns - handle datetime objects
    col_map = {}
    for col in available_columns:
        if hasattr(col, 'strip'):
            col_map[col.strip().lower()] = col
        else:
            # Skip datetime columns for text matching
            continue

    for pattern in target_patterns:
        pattern_lower = pattern.strip().lower()

        # Priority 1: Exact match
        if pattern_lower in col_map:
            return col_map[pattern_lower]

        # Priority 2: Contains match
        for norm_col, orig_col in col_map.items():
            if pattern_lower in norm_col or norm_col in pattern_lower:
                return orig_col

    # Priority 3: Fuzzy match
    if col_map:
        all_patterns = " ".join(target_patterns)
        matches = process.extract(
            all_patterns,
            list(col_map.keys()),
            scorer=fuzz.partial_ratio,
            limit=3
        )

        for match_text, score, _ in matches:
            if score >= min_score:
                return col_map[match_text]

    return None


def find_date_columns(available_columns: List[Any]) -> List[Tuple[Any, Any]]:
    """
    Find columns that represent dates (for rate data).
    Returns list of (column_name, parsed_date) sorted by date descending.
    """
    from datetime import datetime
    import re

    date_cols = []

    for col in available_columns:
        parsed_date = None

        # Handle datetime objects directly
        if hasattr(col, 'date'):
            parsed_date = col
            date_cols.append((col, parsed_date))
            continue

        # Handle string date formats
        if isinstance(col, str):
            # Try common date patterns
            patterns = [
                (r'(\d{2})/(\d{2})/(\d{2,4})', '%m/%d/%y'),  # MM/DD/YY or MM/DD/YYYY
                (r'(\d{4})-(\d{2})-(\d{2})', '%Y-%m-%d'),    # YYYY-MM-DD
                (r'(\d{2})-(\d{2})-(\d{4})', '%m-%d-%Y'),    # MM-DD-YYYY
            ]

            for regex, fmt in patterns:
                if re.match(regex, col.strip()):
                    try:
                        # Handle 2-digit year
                        test_col = col.strip()
                        if fmt == '%m/%d/%y' and len(test_col.split('/')[-1]) == 2:
                            parsed_date = datetime.strptime(test_col, '%m/%d/%y')
                        elif fmt == '%m/%d/%y':
                            parsed_date = datetime.strptime(test_col, '%m/%d/%Y')
                        else:
                            parsed_date = datetime.strptime(test_col, fmt)
                        date_cols.append((col, parsed_date))
                        break
                    except ValueError:
                        continue

    # Sort by date descending (most recent first)
    date_cols.sort(key=lambda x: x[1], reverse=True)
    return date_cols


def get_most_recent_rate_column(available_columns: List[Any]) -> Optional[Tuple[Any, Any]]:
    """
    Get the most recent date column (for current rate).
    Returns (column_name, date) or None.
    """
    date_cols = find_date_columns(available_columns)
    return date_cols[0] if date_cols else None


def get_state_config(state: str) -> Dict[str, Any]:
    """
    Get column configuration for a specific state.
    Falls back to DEFAULT_CONFIG if state not configured.

    Args:
        state: Two-letter state code (e.g., 'FL', 'GA')

    Returns:
        Configuration dict with column mappings
    """
    return STATE_CONFIGS.get(state.upper(), DEFAULT_CONFIG)


def detect_columns(
    state: str,
    available_columns: List[Any]
) -> Dict[str, Optional[Any]]:
    """
    Detect all required columns for a state's rate file.
    Handles both named columns and date-based rate columns.

    Args:
        state: Two-letter state code
        available_columns: Columns found in the file

    Returns:
        Dict mapping standard fields to detected column names
    """
    config = get_state_config(state)

    # Try to find named rate column first
    rate_col = find_matching_column(
        available_columns,
        config["rate_cols"]
    )

    # If no named rate column, use most recent date column
    effective_date = None
    if not rate_col:
        date_result = get_most_recent_rate_column(available_columns)
        if date_result:
            rate_col, effective_date = date_result

    # Try to find named effective date column
    date_col = find_matching_column(
        available_columns,
        config["effective_date_col"]
    )

    return {
        "facility_name": find_matching_column(
            available_columns,
            config["facility_name_cols"]
        ),
        "daily_rate": rate_col,
        "state_facility_id": find_matching_column(
            available_columns,
            config["id_cols"]
        ),
        "effective_date": date_col,
        "_rate_date": effective_date,  # Store the actual date if from column header
    }


def validate_required_columns(
    detected: Dict[str, Optional[str]],
    required: List[str] = ["facility_name", "daily_rate"]
) -> bool:
    """
    Validate that required columns were detected.

    Args:
        detected: Dict from detect_columns()
        required: List of required field names

    Returns:
        True if all required columns detected, False otherwise
    """
    return all(detected.get(field) is not None for field in required)


# ============================================
# CLI Testing
# ============================================

if __name__ == "__main__":
    # Example usage
    print("State Mappings Module - Test Output")
    print("=" * 50)

    # Test column detection with sample columns
    sample_columns = [
        "Provider Number", "Facility Name", "City",
        "County", "Total Per Diem Rate", "Effective Date"
    ]

    print(f"\nSample columns: {sample_columns}")
    print("-" * 50)

    for state in ["FL", "GA", "XX"]:
        detected = detect_columns(state, sample_columns)
        valid = validate_required_columns(detected)

        print(f"\n{state} Detection:")
        for field, col in detected.items():
            status = "+" if col else "x"
            print(f"  [{status}] {field}: {col}")
        print(f"  Valid: {valid}")
