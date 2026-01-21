#!/usr/bin/env python3
"""Extract Virginia Medicaid rates from PDF."""
import pdfplumber
import re
import csv

facilities = []

with pdfplumber.open('VA_2025-10_rates.pdf') as pdf:
    for page_num, page in enumerate(pdf.pages):
        text = page.extract_text()
        lines = text.split('\n')

        for line in lines:
            # Look for 10-digit NPI pattern
            npi_match = re.search(r'(\d{10})', line)
            if npi_match:
                npi = npi_match.group(1)

                # Get facility name (everything before NPI)
                facility_name = line[:npi_match.start()].strip()

                # Skip header rows
                if not facility_name or facility_name.upper().startswith('FACILITY') or 'NPI' in facility_name.upper():
                    continue

                # Find all dollar amounts in the line
                amounts = re.findall(r'\$(\d+\.\d{2})', line)
                if amounts:
                    # Last amount is total rate
                    total_rate = float(amounts[-1])

                    facilities.append({
                        'facility_name': facility_name,
                        'npi': npi,
                        'total_rate': total_rate
                    })

print(f'Extracted {len(facilities)} facilities')
print(f'\nFirst 10:')
for f in facilities[:10]:
    print(f"  {f['facility_name'][:45]:<45} NPI:{f['npi']} ${f['total_rate']:.2f}")

print(f'\nLast 5:')
for f in facilities[-5:]:
    print(f"  {f['facility_name'][:45]:<45} NPI:{f['npi']} ${f['total_rate']:.2f}")

# Stats
rates = [f['total_rate'] for f in facilities]
print(f'\nRate range: ${min(rates):.2f} - ${max(rates):.2f}')
print(f'Average rate: ${sum(rates)/len(rates):.2f}')

# Save to CSV
with open('VA_2025-10_rates.csv', 'w', newline='', encoding='utf-8') as csvfile:
    writer = csv.DictWriter(csvfile, fieldnames=['state', 'facility_name', 'state_facility_id', 'daily_rate', 'effective_date', 'source_file'])
    writer.writeheader()
    for f in facilities:
        writer.writerow({
            'state': 'VA',
            'facility_name': f['facility_name'],
            'state_facility_id': f['npi'],
            'daily_rate': f['total_rate'],
            'effective_date': '2025-10-01',
            'source_file': 'VA_2025-10_rates.pdf'
        })

print(f'\nSaved to VA_2025-10_rates.csv')
