#!/usr/bin/env python3
"""
Facility Name Matching Script
Matches medicaid_rates facilities to property_master using fuzzy matching.

Usage:
    python match_facilities.py --preview        # Preview matches without updating
    python match_facilities.py --execute        # Execute matching and update database
    python match_facilities.py --state FL       # Match only specific state
    python match_facilities.py --threshold 85   # Custom match threshold

Dependencies:
    pip install mysql-connector-python rapidfuzz
"""

import argparse
import os
import re
import sys
from typing import Dict, List, Optional, Tuple
import logging

import mysql.connector
from mysql.connector import Error
from rapidfuzz import fuzz, process

# ============================================
# CONFIGURATION
# ============================================

# Database connection settings
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 3306)),
    "database": os.getenv("DB_NAME", "atlas"),
    "user": os.getenv("DB_USER", "atlas_user"),
    "password": os.getenv("DB_PASSWORD", "atlas_pass"),
}

# Matching thresholds
DEFAULT_THRESHOLD = 85  # Minimum fuzzy match score
HIGH_CONFIDENCE_THRESHOLD = 95  # Auto-accept threshold

# Common nursing facility name variations to normalize
NAME_NORMALIZATIONS = [
    (r'\bskilled nursing facility\b', 'snf', re.IGNORECASE),
    (r'\bnursing home\b', 'nh', re.IGNORECASE),
    (r'\bnursing center\b', 'nc', re.IGNORECASE),
    (r'\brehabilitation\b', 'rehab', re.IGNORECASE),
    (r'\bhealthcare\b', 'hc', re.IGNORECASE),
    (r'\bhealth care\b', 'hc', re.IGNORECASE),
    (r'\bhealth center\b', 'hc', re.IGNORECASE),
    (r'\bcommunity\b', 'comm', re.IGNORECASE),
    (r'\bassisted living\b', 'al', re.IGNORECASE),
    (r'\blong term care\b', 'ltc', re.IGNORECASE),
    (r'\bltc\b', 'ltc', re.IGNORECASE),
    (r'\bllc\b', '', re.IGNORECASE),
    (r'\binc\.?\b', '', re.IGNORECASE),
    (r'\bcorp\.?\b', '', re.IGNORECASE),
    (r'\bthe\b', '', re.IGNORECASE),
    (r'[,\.\-\'\"]+', ' ', 0),  # Remove punctuation
    (r'\s+', ' ', 0),  # Collapse whitespace
]

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)


# ============================================
# NAME NORMALIZATION
# ============================================

def normalize_facility_name(name: str) -> str:
    """
    Normalize facility name for matching.
    Removes common suffixes, standardizes abbreviations, etc.
    """
    if not name:
        return ""

    normalized = name.strip().lower()

    for pattern, replacement, flags in NAME_NORMALIZATIONS:
        if flags:
            normalized = re.sub(pattern, replacement, normalized, flags=flags)
        else:
            normalized = re.sub(pattern, replacement, normalized)

    return normalized.strip()


def get_name_tokens(name: str) -> set:
    """Extract significant tokens from a name."""
    normalized = normalize_facility_name(name)
    tokens = set(normalized.split())
    # Remove very short tokens
    return {t for t in tokens if len(t) > 2}


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


def get_unmatched_rates(conn, state: Optional[str] = None) -> List[Dict]:
    """Get medicaid_rates records without property_master match."""
    cursor = conn.cursor(dictionary=True)

    sql = """
        SELECT id, state, facility_name, state_facility_id
        FROM medicaid_rates
        WHERE property_master_id IS NULL
    """

    if state:
        sql += " AND state = %s"
        cursor.execute(sql, (state,))
    else:
        cursor.execute(sql)

    results = cursor.fetchall()
    cursor.close()
    return results


def get_property_master_facilities(conn, state: str) -> List[Dict]:
    """Get property_master records for a specific state."""
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, ccn, facility_name, city, zip
        FROM property_master
        WHERE state = %s
    """, (state,))

    results = cursor.fetchall()
    cursor.close()
    return results


def update_match(conn, rate_id: int, property_id: int, ccn: str = None):
    """Update medicaid_rates record with property_master match."""
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE medicaid_rates
        SET property_master_id = %s, ccn = %s, verified = FALSE
        WHERE id = %s
    """, (property_id, ccn, rate_id))

    conn.commit()
    cursor.close()


# ============================================
# MATCHING LOGIC
# ============================================

def find_best_match(
    rate_name: str,
    property_facilities: List[Dict],
    threshold: int = DEFAULT_THRESHOLD
) -> Optional[Tuple[Dict, int]]:
    """
    Find the best matching property_master facility for a rate facility name.

    Args:
        rate_name: Facility name from medicaid_rates
        property_facilities: List of property_master records for the same state
        threshold: Minimum match score (0-100)

    Returns:
        Tuple of (matched facility dict, score) or None
    """
    if not rate_name or not property_facilities:
        return None

    # Normalize the rate name
    norm_rate = normalize_facility_name(rate_name)
    rate_tokens = get_name_tokens(rate_name)

    # Create lookup of normalized names to facilities
    name_to_facility = {}
    for facility in property_facilities:
        norm_name = normalize_facility_name(facility["facility_name"])
        name_to_facility[norm_name] = facility

    # Try exact match first
    if norm_rate in name_to_facility:
        return (name_to_facility[norm_rate], 100)

    # Fuzzy match against all normalized names
    if name_to_facility:
        matches = process.extract(
            norm_rate,
            list(name_to_facility.keys()),
            scorer=fuzz.token_sort_ratio,
            limit=3
        )

        for match_name, score, _ in matches:
            if score >= threshold:
                return (name_to_facility[match_name], score)

    # Token overlap as fallback
    best_overlap = 0
    best_facility = None
    for facility in property_facilities:
        property_tokens = get_name_tokens(facility["facility_name"])
        if rate_tokens and property_tokens:
            overlap = len(rate_tokens & property_tokens) / max(len(rate_tokens), len(property_tokens))
            if overlap > best_overlap:
                best_overlap = overlap
                best_facility = facility

    if best_overlap >= 0.6:  # 60% token overlap
        return (best_facility, int(best_overlap * 100))

    return None


def match_state(
    conn,
    state: str,
    threshold: int = DEFAULT_THRESHOLD,
    preview: bool = True
) -> Dict:
    """
    Match all unmatched rates in a state to property_master.

    Args:
        conn: Database connection
        state: Two-letter state code
        threshold: Minimum match score
        preview: If True, don't update database

    Returns:
        Dict with match statistics
    """
    # Get unmatched rates and property facilities
    unmatched_rates = get_unmatched_rates(conn, state)
    property_facilities = get_property_master_facilities(conn, state)

    stats = {
        "state": state,
        "total_unmatched": len(unmatched_rates),
        "total_properties": len(property_facilities),
        "matched": 0,
        "high_confidence": 0,
        "low_confidence": 0,
        "unmatched": 0,
        "matches": []
    }

    if not unmatched_rates:
        logger.info(f"{state}: No unmatched rates found")
        return stats

    if not property_facilities:
        logger.warning(f"{state}: No property_master facilities found")
        stats["unmatched"] = len(unmatched_rates)
        return stats

    logger.info(f"{state}: Matching {len(unmatched_rates)} rates against {len(property_facilities)} properties")

    for rate in unmatched_rates:
        result = find_best_match(
            rate["facility_name"],
            property_facilities,
            threshold
        )

        if result:
            matched_facility, score = result

            match_info = {
                "rate_id": rate["id"],
                "rate_name": rate["facility_name"],
                "property_id": matched_facility["id"],
                "property_name": matched_facility["facility_name"],
                "ccn": matched_facility["ccn"],
                "score": score
            }
            stats["matches"].append(match_info)
            stats["matched"] += 1

            if score >= HIGH_CONFIDENCE_THRESHOLD:
                stats["high_confidence"] += 1
            else:
                stats["low_confidence"] += 1

            if not preview:
                update_match(
                    conn,
                    rate["id"],
                    matched_facility["id"],
                    matched_facility["ccn"]
                )
        else:
            stats["unmatched"] += 1

    return stats


# ============================================
# MAIN OPERATIONS
# ============================================

def preview_matches(conn, state: Optional[str] = None, threshold: int = DEFAULT_THRESHOLD):
    """Preview matches without updating database."""
    print("\n" + "=" * 70)
    print("FACILITY MATCHING - PREVIEW MODE")
    print("=" * 70)

    # Get states to process
    cursor = conn.cursor()
    if state:
        states = [state]
    else:
        cursor.execute("SELECT DISTINCT state FROM medicaid_rates WHERE property_master_id IS NULL ORDER BY state")
        states = [row[0] for row in cursor.fetchall()]
    cursor.close()

    total_stats = {
        "total_unmatched": 0,
        "matched": 0,
        "high_confidence": 0,
        "low_confidence": 0,
        "unmatched": 0
    }

    for st in states:
        stats = match_state(conn, st, threshold, preview=True)

        print(f"\n--- {st} ---")
        print(f"Unmatched rates: {stats['total_unmatched']}")
        print(f"Property master facilities: {stats['total_properties']}")
        print(f"Matches found: {stats['matched']} ({stats['high_confidence']} high confidence, {stats['low_confidence']} low)")
        print(f"Still unmatched: {stats['unmatched']}")

        # Show sample matches
        if stats["matches"]:
            print("\nSample matches:")
            for match in stats["matches"][:5]:
                confidence = "HIGH" if match["score"] >= HIGH_CONFIDENCE_THRESHOLD else "LOW"
                print(f"  [{match['score']}% {confidence}] '{match['rate_name']}' -> '{match['property_name']}' (CCN: {match['ccn']})")

        for key in total_stats:
            total_stats[key] += stats.get(key, 0)

    print("\n" + "-" * 70)
    print("SUMMARY:")
    print(f"  Total unmatched: {total_stats['total_unmatched']}")
    print(f"  Would match: {total_stats['matched']} ({total_stats['high_confidence']} high, {total_stats['low_confidence']} low)")
    print(f"  Would remain unmatched: {total_stats['unmatched']}")
    match_rate = (total_stats['matched'] / total_stats['total_unmatched'] * 100) if total_stats['total_unmatched'] > 0 else 0
    print(f"  Match rate: {match_rate:.1f}%")
    print("=" * 70)


def execute_matches(conn, state: Optional[str] = None, threshold: int = DEFAULT_THRESHOLD):
    """Execute matches and update database."""
    print("\n" + "=" * 70)
    print("FACILITY MATCHING - EXECUTE MODE")
    print("=" * 70)

    # Get states to process
    cursor = conn.cursor()
    if state:
        states = [state]
    else:
        cursor.execute("SELECT DISTINCT state FROM medicaid_rates WHERE property_master_id IS NULL ORDER BY state")
        states = [row[0] for row in cursor.fetchall()]
    cursor.close()

    total_matched = 0
    total_unmatched = 0

    for st in states:
        stats = match_state(conn, st, threshold, preview=False)

        print(f"{st}: Matched {stats['matched']}, Unmatched {stats['unmatched']}")
        total_matched += stats["matched"]
        total_unmatched += stats["unmatched"]

    print("\n" + "-" * 70)
    print(f"TOTAL: {total_matched} matched, {total_unmatched} unmatched")
    print("=" * 70)


def show_match_stats(conn):
    """Show current matching statistics."""
    print("\n" + "=" * 70)
    print("CURRENT MATCH STATISTICS")
    print("=" * 70)

    cursor = conn.cursor(dictionary=True)
    cursor.execute("""
        SELECT
            state,
            COUNT(*) as total_rates,
            COUNT(property_master_id) as matched,
            COUNT(*) - COUNT(property_master_id) as unmatched,
            ROUND(COUNT(property_master_id) * 100.0 / COUNT(*), 1) as match_pct
        FROM medicaid_rates
        GROUP BY state
        ORDER BY state
    """)

    results = cursor.fetchall()
    cursor.close()

    print(f"\n{'State':<8} {'Total':<10} {'Matched':<10} {'Unmatched':<12} {'Match %':<10}")
    print("-" * 50)

    total_rates = 0
    total_matched = 0

    for row in results:
        print(f"{row['state']:<8} {row['total_rates']:<10} {row['matched']:<10} {row['unmatched']:<12} {row['match_pct']:<10}%")
        total_rates += row['total_rates']
        total_matched += row['matched']

    print("-" * 50)
    overall_pct = (total_matched / total_rates * 100) if total_rates > 0 else 0
    print(f"{'TOTAL':<8} {total_rates:<10} {total_matched:<10} {total_rates - total_matched:<12} {overall_pct:.1f}%")
    print("=" * 70)


# ============================================
# CLI ENTRY POINT
# ============================================

def main():
    parser = argparse.ArgumentParser(
        description="Match medicaid_rates facilities to property_master",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python match_facilities.py --preview
    python match_facilities.py --execute
    python match_facilities.py --state FL --preview
    python match_facilities.py --threshold 90 --execute
    python match_facilities.py --stats
        """
    )

    parser.add_argument(
        "--preview",
        action="store_true",
        help="Preview matches without updating database"
    )

    parser.add_argument(
        "--execute",
        action="store_true",
        help="Execute matches and update database"
    )

    parser.add_argument(
        "--stats",
        action="store_true",
        help="Show current matching statistics"
    )

    parser.add_argument(
        "--state",
        type=str,
        help="Process only a specific state (e.g., FL)"
    )

    parser.add_argument(
        "--threshold",
        type=int,
        default=DEFAULT_THRESHOLD,
        help=f"Minimum match score (default: {DEFAULT_THRESHOLD})"
    )

    args = parser.parse_args()

    if not any([args.preview, args.execute, args.stats]):
        parser.print_help()
        print("\nError: Must specify --preview, --execute, or --stats")
        sys.exit(1)

    conn = get_db_connection()

    try:
        if args.stats:
            show_match_stats(conn)
        elif args.preview:
            preview_matches(conn, args.state, args.threshold)
        elif args.execute:
            execute_matches(conn, args.state, args.threshold)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
