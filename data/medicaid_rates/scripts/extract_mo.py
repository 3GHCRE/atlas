#!/usr/bin/env python3
"""Extract Missouri Medicaid rates from Excel file."""
import pandas as pd
import csv

# Read with proper header
df = pd.read_excel('MO_SFY2026_rates.xlsx', sheet_name=0, skiprows=14)

# Map columns based on position
# Col 1 = Pseudo (provider number)
# Col 2 = Provider Name
# Col 3 = Rate Type
# Col 4 = City
# Col 5 = County
# Col -2 = 7/1/2025 rate (Effective.7)

# Rename for clarity
df.columns = ['Count', 'Pseudo', 'Provider_Name', 'Rate_Type', 'City', 'County',
              'Location', 'FYE', 'Entity_Type', 'Lic_Beds', 'Mcd_Beds',
              'Rate_2021_07', 'NA1', 'Rate_2022_07', 'Rate_2023_01', 'Rate_2023_07',
              'Rate_2024_01', 'Rate_2024_07', 'CMI_2024_07', 'Rate_2025_01',
              'CMI_2025_01', 'Rate_2025_07', 'CMI_2025_07']

# Filter to valid rows (have provider name and pseudo number)
df = df[df['Provider_Name'].notna() & df['Provider_Name'] != 'Provider Name']
df = df[df['Pseudo'].notna()]

# Convert rate to numeric
df['Rate_2025_07'] = pd.to_numeric(df['Rate_2025_07'], errors='coerce')

# Filter valid rates
df = df[df['Rate_2025_07'].notna() & (df['Rate_2025_07'] > 0)]

# Extract facility data
facilities = []
for _, row in df.iterrows():
    facilities.append({
        'facility_name': str(row['Provider_Name']).strip(),
        'pseudo': str(row['Pseudo']).strip(),
        'city': str(row['City']).strip() if pd.notna(row['City']) else '',
        'county': str(row['County']).strip() if pd.notna(row['County']) else '',
        'daily_rate': float(row['Rate_2025_07'])
    })

print(f"Extracted {len(facilities)} facilities")

print("\nFirst 10:")
for f in facilities[:10]:
    print(f"  {f['facility_name'][:45]:<45} #{f['pseudo']} ${f['daily_rate']:.2f}")

print("\nLast 5:")
for f in facilities[-5:]:
    print(f"  {f['facility_name'][:45]:<45} #{f['pseudo']} ${f['daily_rate']:.2f}")

# Stats
rates = [f['daily_rate'] for f in facilities]
print(f"\nRate range: ${min(rates):.2f} - ${max(rates):.2f}")
print(f"Average rate: ${sum(rates)/len(rates):.2f}")

# Save to CSV
with open('MO_2025-07_rates.csv', 'w', newline='', encoding='utf-8') as csvfile:
    writer = csv.DictWriter(csvfile, fieldnames=['state', 'facility_name', 'state_facility_id', 'daily_rate', 'effective_date', 'source_file'])
    writer.writeheader()
    for f in facilities:
        writer.writerow({
            'state': 'MO',
            'facility_name': f['facility_name'],
            'state_facility_id': f['pseudo'],
            'daily_rate': f['daily_rate'],
            'effective_date': '2025-07-01',
            'source_file': 'MO_SFY2026_rates.xlsx'
        })

print(f"\nSaved to MO_2025-07_rates.csv")
