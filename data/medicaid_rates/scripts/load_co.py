#!/usr/bin/env python3
"""Load Colorado Medicaid rates into database."""
import csv
import mysql.connector
from datetime import date

DB_CONFIG = {
    "host": "localhost",
    "port": 3306,
    "database": "atlas",
    "user": "root",
    "password": "devpass",
}

# Read CSV
facilities = []
with open('CO_2025-26_rates.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        facilities.append(row)

print(f"Read {len(facilities)} facilities from CSV")

# Connect to database
conn = mysql.connector.connect(**DB_CONFIG)
cursor = conn.cursor(dictionary=True)

# Check existing CO rates
cursor.execute("""
    SELECT COUNT(*) as cnt, MAX(effective_date) as latest
    FROM medicaid_rates
    WHERE state = 'CO' AND end_date IS NULL
""")
existing = cursor.fetchone()
print(f"Existing current CO rates: {existing['cnt']} (latest: {existing['latest']})")

# Close existing current rates
effective_date = date(2025, 7, 1)
cursor.execute("""
    UPDATE medicaid_rates
    SET end_date = %s
    WHERE state = 'CO' AND end_date IS NULL
""", (effective_date,))
closed = cursor.rowcount
print(f"Closed {closed} existing rate records")

# Insert new rates
insert_sql = """
INSERT INTO medicaid_rates (
    state, facility_name, state_facility_id, daily_rate,
    rate_type, effective_date, source_file, data_source
) VALUES (
    %s, %s, %s, %s, %s, %s, %s, %s
)
"""

inserted = 0
for f in facilities:
    cursor.execute(insert_sql, (
        'CO',
        f['facility_name'],
        f['state_facility_id'],
        float(f['daily_rate']),
        'total',
        effective_date,
        f['source_file'],
        'state_medicaid_update'
    ))
    inserted += 1

conn.commit()
print(f"Inserted {inserted} new rate records")

# Summary
print("\n" + "=" * 50)
print("COLORADO RATE UPDATE COMPLETE")
print("=" * 50)
print(f"  Prior records closed: {closed}")
print(f"  New records inserted: {inserted}")
print(f"  Effective date: {effective_date}")

cursor.close()
conn.close()
