#!/usr/bin/env python3
"""Extract Rhode Island Medicaid rates from Excel file."""
import pandas as pd
import csv

# Read the Excel file, skipping the header row
df = pd.read_excel('RI_2024-10_rates.xlsx', header=1)

# Rename columns for clarity
df.columns = ['idx', 'NPI', 'Provider_Name', 'Alternate_Name', 'Direct_Care_Base',
              'Provider_Base_Rate', 'Provider_Assessment', 'Effective_Date', 'RUG'] + list(df.columns[9:])

# Filter to actual data rows (have NPI number)
df = df[df['NPI'].notna() & (df['NPI'] != 'NPI #')]
df = df[df['NPI'].astype(str).str.isdigit()]

print(f"Found {len(df)} facilities")

# Extract facility data
# Use AAA rate as the base rate (first RUG category)
facilities = []
for _, row in df.iterrows():
    # Use alternate name if available, otherwise provider name
    name = row['Alternate_Name'] if pd.notna(row['Alternate_Name']) else row['Provider_Name']
    npi = str(row['NPI'])

    # AAA rate is the base rate (column index 9 after renaming)
    aaa_rate = row.iloc[9]  # AAA column

    if pd.notna(aaa_rate) and float(aaa_rate) > 0:
        facilities.append({
            'facility_name': str(name).strip(),
            'npi': npi,
            'daily_rate': float(aaa_rate)
        })

print(f"\nExtracted {len(facilities)} facilities with valid rates")
print(f"\nFirst 10:")
for f in facilities[:10]:
    print(f"  {f['facility_name'][:45]:<45} NPI:{f['npi']} ${f['daily_rate']:.2f}")

print(f"\nLast 5:")
for f in facilities[-5:]:
    print(f"  {f['facility_name'][:45]:<45} NPI:{f['npi']} ${f['daily_rate']:.2f}")

# Stats
rates = [f['daily_rate'] for f in facilities]
print(f"\nRate range (AAA/base): ${min(rates):.2f} - ${max(rates):.2f}")
print(f"Average rate: ${sum(rates)/len(rates):.2f}")

# Save to CSV
with open('RI_2024-10_rates.csv', 'w', newline='', encoding='utf-8') as csvfile:
    writer = csv.DictWriter(csvfile, fieldnames=['state', 'facility_name', 'state_facility_id', 'daily_rate', 'effective_date', 'source_file'])
    writer.writeheader()
    for f in facilities:
        writer.writerow({
            'state': 'RI',
            'facility_name': f['facility_name'],
            'state_facility_id': f['npi'],
            'daily_rate': f['daily_rate'],
            'effective_date': '2024-10-01',
            'source_file': 'RI_2024-10_rates.xlsx'
        })

print(f"\nSaved to RI_2024-10_rates.csv")
print("\nNote: Using AAA (base RUG rate) for comparison. Actual reimbursement varies by patient acuity.")
