#!/usr/bin/env python3
"""Extract Colorado Medicaid rates from PDF."""
import pdfplumber
import csv
import re

facilities = []

with pdfplumber.open('CO_2025-26_rates.pdf') as pdf:
    for page_num, page in enumerate(pdf.pages):
        tables = page.extract_tables()

        for table in tables:
            for row in table:
                # Skip header rows
                if not row or row[0] == 'PFID' or not row[0]:
                    continue

                # Extract fields
                pfid = row[0]
                npi = row[1]
                facility_name = row[2]

                # Parse rate - handle dollar sign and commas
                rate_str = row[5] if row[5] else ''
                rate_str = rate_str.replace('$', '').replace(',', '').strip()

                # Skip if no valid rate
                if not rate_str or not pfid.isdigit():
                    continue

                try:
                    daily_rate = float(rate_str)
                    if daily_rate > 0:
                        facilities.append({
                            'pfid': pfid,
                            'npi': npi,
                            'facility_name': facility_name,
                            'daily_rate': daily_rate
                        })
                except ValueError:
                    continue

print(f"Extracted {len(facilities)} facilities")

# Show some samples
print("\nFirst 10:")
for f in facilities[:10]:
    print(f"  {f['facility_name'][:45]:<45} PFID:{f['pfid']} ${f['daily_rate']:.2f}")

print("\nLast 5:")
for f in facilities[-5:]:
    print(f"  {f['facility_name'][:45]:<45} PFID:{f['pfid']} ${f['daily_rate']:.2f}")

# Stats
rates = [f['daily_rate'] for f in facilities]
print(f"\nRate range: ${min(rates):.2f} - ${max(rates):.2f}")
print(f"Average rate: ${sum(rates)/len(rates):.2f}")

# Save to CSV
with open('CO_2025-26_rates.csv', 'w', newline='', encoding='utf-8') as csvfile:
    writer = csv.DictWriter(csvfile, fieldnames=['state', 'facility_name', 'state_facility_id', 'npi', 'daily_rate', 'effective_date', 'source_file'])
    writer.writeheader()
    for f in facilities:
        writer.writerow({
            'state': 'CO',
            'facility_name': f['facility_name'],
            'state_facility_id': f['pfid'],
            'npi': f['npi'],
            'daily_rate': f['daily_rate'],
            'effective_date': '2025-07-01',
            'source_file': 'CO_2025-26_rates.pdf'
        })

print(f"\nSaved to CO_2025-26_rates.csv")
