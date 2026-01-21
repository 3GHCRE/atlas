#!/usr/bin/env python3
"""Match Indiana Medicaid rates to property_master using fuzzy matching."""
import mysql.connector
import re
from rapidfuzz import fuzz

DB_CONFIG = {
    "host": "localhost",
    "port": 3306,
    "database": "atlas",
    "user": "root",
    "password": "devpass",
}

def normalize_name(name):
    """Normalize facility name for matching."""
    name = name.upper()
    # Remove common suffixes
    for suffix in [' LLC', ' INC', ' CORP', ' LP', ' LLP', ', LLC', ', INC', ', LP', ' OPCO']:
        name = name.replace(suffix, '')
    # Standardize common terms
    replacements = {
        'NURSING HOME': 'NH',
        'NURSING FACILITY': 'NF',
        'HEALTH AND REHABILITATION': 'H&R',
        'HEALTH & REHABILITATION': 'H&R',
        'HEALTH AND REHAB': 'H&R',
        'HEALTH & REHAB': 'H&R',
        'REHABILITATION': 'REHAB',
        'CENTER': 'CTR',
        'CONVALESCENT': 'CONV',
        '&': 'AND',
        'SAINT': 'ST',
        'MOUNT': 'MT',
        'HEALTHCARE': 'HC',
        'SKILLED NURSING': 'SNF',
        'HEALTH CARE': 'HC',
        'CARE CENTER': 'CC',
    }
    for old, new in replacements.items():
        name = name.replace(old, new)
    # Remove special characters
    name = re.sub(r'[^A-Z0-9 ]', '', name)
    return ' '.join(name.split())

THRESHOLD = 85

conn = mysql.connector.connect(**DB_CONFIG)
cursor = conn.cursor(dictionary=True)

# Get unmatched IN rates
cursor.execute("""
    SELECT id, facility_name, state_facility_id
    FROM medicaid_rates
    WHERE state = 'IN' AND property_master_id IS NULL AND end_date IS NULL
""")
unmatched = cursor.fetchall()
print(f"Unmatched IN rates: {len(unmatched)}")

# Get IN facilities from property_master
cursor.execute("""
    SELECT id, facility_name, ccn, city
    FROM property_master
    WHERE state = 'IN'
""")
pm_facilities = cursor.fetchall()
print(f"IN facilities in property_master: {len(pm_facilities)}")

# Build lookup with normalized names
pm_lookup = {}
for pm in pm_facilities:
    norm = normalize_name(pm['facility_name'])
    pm_lookup[norm] = pm

# Match
matched = 0
updates = []

for rate in unmatched:
    rate_norm = normalize_name(rate['facility_name'])
    best_score = 0
    best_match = None

    for pm_norm, pm in pm_lookup.items():
        score = max(
            fuzz.token_sort_ratio(rate_norm, pm_norm),
            fuzz.partial_ratio(rate_norm, pm_norm)
        )
        if score > best_score:
            best_score = score
            best_match = pm

    if best_score >= THRESHOLD:
        updates.append({
            'rate_id': rate['id'],
            'pm_id': best_match['id'],
            'ccn': best_match['ccn'],
            'score': best_score,
            'rate_name': rate['facility_name'],
            'pm_name': best_match['facility_name']
        })
        matched += 1

print(f"\nMatched {matched}/{len(unmatched)} facilities ({matched/len(unmatched)*100:.1f}%)")

# Show some matches
print("\nSample matches:")
for u in updates[:10]:
    print(f"  {u['rate_name'][:40]:<40} -> {u['pm_name'][:40]:<40} ({u['score']}%)")

# Update database
for u in updates:
    cursor.execute("""
        UPDATE medicaid_rates
        SET property_master_id = %s, ccn = %s
        WHERE id = %s
    """, (u['pm_id'], u['ccn'], u['rate_id']))

conn.commit()
print(f"\nUpdated {len(updates)} records in database")

# Show unmatched
cursor.execute("""
    SELECT facility_name, daily_rate
    FROM medicaid_rates
    WHERE state = 'IN' AND property_master_id IS NULL AND end_date IS NULL
    LIMIT 10
""")
still_unmatched = cursor.fetchall()
if still_unmatched:
    print(f"\nStill unmatched ({len(still_unmatched)} sample):")
    for f in still_unmatched:
        print(f"  {f['facility_name'][:50]} (${f['daily_rate']})")

cursor.close()
conn.close()
