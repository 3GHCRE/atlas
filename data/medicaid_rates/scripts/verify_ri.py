#!/usr/bin/env python3
"""Verify Rhode Island rate changes period-over-period."""
import mysql.connector

DB_CONFIG = {
    "host": "localhost",
    "port": 3306,
    "database": "atlas",
    "user": "root",
    "password": "devpass",
}

conn = mysql.connector.connect(**DB_CONFIG)
cursor = conn.cursor(dictionary=True)

# Check RI rate periods
print("=" * 60)
print("RHODE ISLAND RATE PERIODS")
print("=" * 60)

cursor.execute("""
    SELECT
        effective_date,
        end_date,
        COUNT(*) as facilities,
        ROUND(MIN(daily_rate), 2) as min_rate,
        ROUND(AVG(daily_rate), 2) as avg_rate,
        ROUND(MAX(daily_rate), 2) as max_rate
    FROM medicaid_rates
    WHERE state = 'RI'
    GROUP BY effective_date, end_date
    ORDER BY effective_date DESC
""")

for row in cursor.fetchall():
    current = "CURRENT" if row['end_date'] is None else f"ended {row['end_date']}"
    print(f"\n{row['effective_date']} ({current})")
    print(f"  Facilities: {row['facilities']}")
    print(f"  Rates: ${row['min_rate']} - ${row['max_rate']} (avg: ${row['avg_rate']})")

# Period-over-period changes
print("\n" + "=" * 60)
print("RHODE ISLAND RATE CHANGES (Period-over-Period)")
print("=" * 60)

cursor.execute("""
    SELECT
        COUNT(*) as facilities,
        ROUND(AVG(rate_change_dollar), 2) as avg_change_dollar,
        ROUND(AVG(rate_change_pct), 2) as avg_change_pct,
        SUM(CASE WHEN rate_change_pct > 0 THEN 1 ELSE 0 END) as increases,
        SUM(CASE WHEN rate_change_pct < 0 THEN 1 ELSE 0 END) as decreases,
        SUM(CASE WHEN rate_change_pct = 0 THEN 1 ELSE 0 END) as unchanged
    FROM v_rate_changes
    WHERE state = 'RI' AND prior_rate IS NOT NULL
""")

result = cursor.fetchone()
if result and result['facilities'] > 0:
    print(f"\nFacilities with history: {result['facilities']}")
    print(f"Average change: ${result['avg_change_dollar']}/day ({result['avg_change_pct']}%)")
    print(f"Increases: {result['increases']}")
    print(f"Decreases: {result['decreases']}")
    print(f"Unchanged: {result['unchanged']}")

    # Top increases
    print("\nTop 10 Rate Increases:")
    cursor.execute("""
        SELECT facility_name, current_rate, prior_rate, rate_change_dollar, rate_change_pct
        FROM v_rate_changes
        WHERE state = 'RI' AND prior_rate IS NOT NULL
        ORDER BY rate_change_pct DESC
        LIMIT 10
    """)
    for row in cursor.fetchall():
        print(f"  {row['facility_name'][:40]:<40} ${row['prior_rate']:.2f} -> ${row['current_rate']:.2f} ({row['rate_change_pct']:+.1f}%)")

    # Top decreases
    print("\nTop 10 Rate Decreases:")
    cursor.execute("""
        SELECT facility_name, current_rate, prior_rate, rate_change_dollar, rate_change_pct
        FROM v_rate_changes
        WHERE state = 'RI' AND prior_rate IS NOT NULL
        ORDER BY rate_change_pct ASC
        LIMIT 10
    """)
    for row in cursor.fetchall():
        print(f"  {row['facility_name'][:40]:<40} ${row['prior_rate']:.2f} -> ${row['current_rate']:.2f} ({row['rate_change_pct']:+.1f}%)")
else:
    print("\nNo period-over-period comparison available.")
    print("Both periods have same effective date - this update is refreshing from official source.")

# Overall summary
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
cursor.execute("""
    SELECT
        COUNT(*) as total,
        COUNT(property_master_id) as matched,
        ROUND(COUNT(property_master_id) * 100.0 / COUNT(*), 1) as match_pct
    FROM medicaid_rates
    WHERE state = 'RI' AND end_date IS NULL
""")
summary = cursor.fetchone()
print(f"Current RI rates: {summary['total']}")
print(f"Matched to property_master: {summary['matched']} ({summary['match_pct']}%)")
print("\nNote: Rhode Island uses RUG (case-mix) system. Rates shown are base AAA rate.")
print("      Effective Oct 2025, RI transitioned to PDPM model with different rate structure.")

cursor.close()
conn.close()
