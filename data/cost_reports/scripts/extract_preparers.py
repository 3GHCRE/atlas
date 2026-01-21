#!/usr/bin/env python3
"""
Extract cost report preparer/certifier information from CMS HCRIS SNF data.
Links preparers to facilities and identifies top CPA firms/chains.
"""

import pandas as pd
import os
from collections import defaultdict

# File paths
DATA_DIR = os.path.dirname(os.path.abspath(__file__))
RPT_FILE = os.path.join(DATA_DIR, 'SNF10_2024_rpt.csv')
ALPHA_FILE = os.path.join(DATA_DIR, 'SNF10_2024_alpha.csv')
OUTPUT_FILE = os.path.join(DATA_DIR, 'snf_preparers_2024.csv')

# Column definitions based on HCRIS documentation
RPT_COLS = [
    'rpt_rec_num', 'prvdr_ctrl_type_cd', 'prvdr_num', 'npi', 'rpt_stus_cd',
    'fy_bgn_dt', 'fy_end_dt', 'proc_dt', 'initl_rpt_sw', 'last_rpt_sw',
    'trnsmtl_num', 'fi_num', 'adr_vndr_cd', 'fi_creat_dt', 'util_cd',
    'npr_dt', 'spec_ind', 'fi_rcpt_dt'
]

ALPHA_COLS = ['rpt_rec_num', 'wksht_cd', 'line_num', 'clmn_num', 'alphnmrc_itm_txt']

# Worksheet S-2 Part I (Provider Identification)
S2_FIELDS = {
    ('S200001', '00100', '00100'): 'address_line1',
    ('S200001', '00200', '00100'): 'city',
    ('S200001', '00200', '00200'): 'state',
    ('S200001', '00200', '00300'): 'zip',
    ('S200001', '00400', '00100'): 'facility_name',
    ('S200001', '00400', '00200'): 'provider_num_s2',
}

# Worksheet S Part II (Certification)
CERT_FIELDS = {
    ('S000002', '00100', '00100'): 'certifier_name',
    ('S000002', '00200', '00100'): 'certifier_printed_name',
    ('S000002', '00300', '00100'): 'certifier_title',
    ('S000002', '00400', '00100'): 'certifier_date',
}


def load_rpt_data():
    """Load report metadata file."""
    print(f"Loading report file: {RPT_FILE}")
    df = pd.read_csv(RPT_FILE, names=RPT_COLS, dtype=str, low_memory=False)
    print(f"  Loaded {len(df):,} cost reports")
    return df


def load_alpha_data():
    """Load alphanumeric data file."""
    print(f"Loading alpha file: {ALPHA_FILE}")
    df = pd.read_csv(ALPHA_FILE, names=ALPHA_COLS, dtype=str, low_memory=False)
    print(f"  Loaded {len(df):,} alphanumeric records")
    return df


def extract_field_values(alpha_df, field_defs):
    """Extract specific fields from alpha data based on worksheet/line/col definitions."""
    results = defaultdict(dict)

    for (wksht, line, col), field_name in field_defs.items():
        mask = (
            (alpha_df['wksht_cd'] == wksht) &
            (alpha_df['line_num'] == line) &
            (alpha_df['clmn_num'] == col)
        )
        subset = alpha_df[mask][['rpt_rec_num', 'alphnmrc_itm_txt']]

        for _, row in subset.iterrows():
            results[row['rpt_rec_num']][field_name] = row['alphnmrc_itm_txt']

    return results


def main():
    # Load data
    rpt_df = load_rpt_data()
    alpha_df = load_alpha_data()

    # Extract provider identification fields
    print("\nExtracting provider identification (S-2)...")
    s2_data = extract_field_values(alpha_df, S2_FIELDS)

    # Extract certification fields
    print("Extracting certification data (S Part II)...")
    cert_data = extract_field_values(alpha_df, CERT_FIELDS)

    # Merge all data
    print("\nMerging data...")
    records = []

    for _, rpt_row in rpt_df.iterrows():
        rec_num = rpt_row['rpt_rec_num']

        record = {
            'rpt_rec_num': rec_num,
            'prvdr_num': rpt_row['prvdr_num'],
            'npi': rpt_row['npi'],
            'prvdr_ctrl_type_cd': rpt_row['prvdr_ctrl_type_cd'],
            'fy_bgn_dt': rpt_row['fy_bgn_dt'],
            'fy_end_dt': rpt_row['fy_end_dt'],
            'rpt_stus_cd': rpt_row['rpt_stus_cd'],
        }

        # Add S-2 fields
        if rec_num in s2_data:
            record.update(s2_data[rec_num])

        # Add certification fields
        if rec_num in cert_data:
            record.update(cert_data[rec_num])

        records.append(record)

    # Create DataFrame
    result_df = pd.DataFrame(records)

    # Clean up certifier names
    result_df['certifier_name'] = result_df['certifier_name'].fillna('').str.strip().str.upper()
    result_df['certifier_title'] = result_df['certifier_title'].fillna('').str.strip().str.upper()

    # Save full dataset
    print(f"\nSaving to {OUTPUT_FILE}")
    result_df.to_csv(OUTPUT_FILE, index=False)
    print(f"  Saved {len(result_df):,} records")

    # Summary statistics
    print("\n" + "="*60)
    print("SUMMARY STATISTICS")
    print("="*60)

    # Top certifiers by facility count
    print("\nTop 25 Certifiers by Facility Count:")
    certifier_counts = result_df[result_df['certifier_name'] != ''].groupby(
        ['certifier_name', 'certifier_title']
    ).size().reset_index(name='facility_count')
    certifier_counts = certifier_counts.sort_values('facility_count', ascending=False)

    print(f"{'Certifier Name':<35} {'Title':<25} {'Facilities':>10}")
    print("-"*75)
    for _, row in certifier_counts.head(25).iterrows():
        print(f"{row['certifier_name'][:35]:<35} {row['certifier_title'][:25]:<25} {row['facility_count']:>10}")

    # Title distribution
    print("\n\nTop Certifier Titles:")
    title_counts = result_df[result_df['certifier_title'] != '']['certifier_title'].value_counts().head(15)
    for title, count in title_counts.items():
        print(f"  {title}: {count:,}")

    # Unique certifiers
    unique_certifiers = result_df['certifier_name'].nunique()
    total_facilities = len(result_df[result_df['certifier_name'] != ''])
    print(f"\n\nTotal unique certifiers: {unique_certifiers:,}")
    print(f"Total facilities with certifier data: {total_facilities:,}")
    print(f"Average facilities per certifier: {total_facilities/unique_certifiers:.1f}")

    # Save certifier summary
    summary_file = os.path.join(DATA_DIR, 'snf_certifier_summary_2024.csv')
    certifier_counts.to_csv(summary_file, index=False)
    print(f"\nSaved certifier summary to: {summary_file}")

    return result_df, certifier_counts


if __name__ == '__main__':
    main()
