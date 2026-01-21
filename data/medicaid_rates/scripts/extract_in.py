#!/usr/bin/env python3
"""Extract Indiana Medicaid rates from Excel file."""
import pandas as pd
import csv

# Read with header at row 11
df = pd.read_excel('IN_2025-07_rates.xlsx', sheet_name='PI Prospective')

# Find the header row
header_idx = None
for i in range(20):
    if df.iloc[i, 0] == 'Provider Name':
        header_idx = i
        break

# Re-read with correct header
df = pd.read_excel('IN_2025-07_rates.xlsx', sheet_name='PI Prospective', skiprows=header_idx+1, header=None)
df.columns = ['Provider Name', 'Provider Number', 'Chain Name', 'NSGO Entity', 'Cost Report End Date',
              'County', 'Rate Effective Date', 'Organization Type', 'Capital Type', 'Medicare Cert.',
              'Hosp. Based', 'CCRC', 'Unnamed', 'NF Beds', 'Occ. Percent', 'Medicaid Utiliz.',
              'Fac. Avg. CMI', 'Medicaid CMI', 'Direct Care Comp.', 'Therapy Component',
              'Indirect Care Comp.', 'Admin Comp.', 'Capital Comp.', 'Component Total',
              'Assessment Add-On', 'NEMT Add-On', 'Prospective Case Mix Rate', 'Case Mix Assessment',
              'Blended Case Mix Rate']

# Filter valid rows - Provider Number should be numeric
df = df[df['Provider Name'].notna()]
df = df[df['Provider Number'].apply(lambda x: str(x).replace('.0', '').isdigit() if pd.notna(x) else False)]

# Convert rate to numeric
df['Blended Case Mix Rate'] = pd.to_numeric(df['Blended Case Mix Rate'], errors='coerce')

# Filter valid rates
df = df[df['Blended Case Mix Rate'].notna() & (df['Blended Case Mix Rate'] > 0)]

# Extract facility data
facilities = []
for _, row in df.iterrows():
    facilities.append({
        'facility_name': str(row['Provider Name']).strip(),
        'provider_number': str(int(float(row['Provider Number']))),
        'county': str(row['County']).strip() if pd.notna(row['County']) else '',
        'daily_rate': float(row['Blended Case Mix Rate'])
    })

print(f"Extracted {len(facilities)} facilities")

print("\nFirst 10:")
for f in facilities[:10]:
    print(f"  {f['facility_name'][:45]:<45} #{f['provider_number']} ${f['daily_rate']:.2f}")

print("\nLast 5:")
for f in facilities[-5:]:
    print(f"  {f['facility_name'][:45]:<45} #{f['provider_number']} ${f['daily_rate']:.2f}")

# Stats
rates = [f['daily_rate'] for f in facilities]
print(f"\nRate range: ${min(rates):.2f} - ${max(rates):.2f}")
print(f"Average rate: ${sum(rates)/len(rates):.2f}")

# Save to CSV
with open('IN_2025-07_rates.csv', 'w', newline='', encoding='utf-8') as csvfile:
    writer = csv.DictWriter(csvfile, fieldnames=['state', 'facility_name', 'state_facility_id', 'daily_rate', 'effective_date', 'source_file'])
    writer.writeheader()
    for f in facilities:
        writer.writerow({
            'state': 'IN',
            'facility_name': f['facility_name'],
            'state_facility_id': f['provider_number'],
            'daily_rate': f['daily_rate'],
            'effective_date': '2025-07-01',
            'source_file': 'IN_2025-07_rates.xlsx'
        })

print(f"\nSaved to IN_2025-07_rates.csv")
