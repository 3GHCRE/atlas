# CMS HCRIS Cost Report Certifier Analysis

## Overview

This directory contains tools to extract and analyze cost report preparer/certifier information from CMS HCRIS (Healthcare Cost Report Information System) SNF data. The certifier signatures reveal corporate chain structure since chain-level executives (CFOs, VP Reimbursement) sign for all their facilities.

## Directory Structure

```
cost_reports/
├── raw/                    # Large CMS source files (gitignored)
│   ├── SNF10_2024_rpt.csv
│   ├── SNF10_2024_alpha.csv
│   ├── SNF10_2024_nmrc.csv
│   ├── SNF10FY2024.zip
│   └── snf10-documentation.zip
├── docs/                   # HCRIS reference documentation
│   ├── HCRIS_DataDictionary.csv
│   ├── HCRIS_Data_model.pdf
│   ├── HCRIS_*.csv
│   └── SNF CROSSWALK*.pdf/xlsx
├── output/                 # Generated analysis files (tracked)
│   ├── snf_preparers_2024.csv
│   ├── snf_certifier_summary_2024.csv
│   └── certifier_chain_analysis.csv
├── scripts/                # Processing scripts
│   ├── extract_preparers.cjs
│   ├── analyze_chains.cjs
│   └── load_certifiers_to_mysql.cjs
├── package.json
└── README.md
```

## Key Finding

**The cost report "preparer" field shows internal chain executives, NOT external CPA firms.**

Top certifiers are chain-level finance executives:
- MICHELLE LEWIS (PACS Group) - 241 facilities across 15 states
- KEITH GOSS (Life Care Centers of America) - 190 facilities across 26 states
- DIANE MORRIS - 140 facilities across 19 states
- TIM MOODY (PruittHealth) - 91 facilities

## Data Source

CMS HCRIS SNF FY2024 data: https://www.cms.gov/data-research/statistics-trends-and-reports/cost-reports/cost-reports-fiscal-year

Download and extract to `raw/`:
- `SNF10_2024_rpt.csv` - Report metadata (14,242 cost reports)
- `SNF10_2024_alpha.csv` - Alphanumeric data (144MB, contains preparer info)
- `SNF10_2024_nmrc.csv` - Numeric data (452MB)

## Scripts

### 1. `scripts/extract_preparers.cjs`
Extracts preparer/certifier information from raw HCRIS alpha file.
- Reads Worksheet S000002 (Certification) for certifier name/title/date
- Reads Worksheet S200001 (Provider Identification) for facility details
- Outputs to `output/`

```bash
node scripts/extract_preparers.cjs
```

### 2. `scripts/analyze_chains.cjs`
Analyzes certifiers to identify chains/organizations.
- Groups facilities by certifier signature
- Identifies common naming patterns
- Classifies certifiers (External Preparer, Chain Executive, etc.)

```bash
node scripts/analyze_chains.cjs
```

### 3. `scripts/load_certifiers_to_mysql.cjs`
Loads certifier data into MySQL and matches to property_master.
- Creates `cost_report_certifiers` table
- Matches by CCN (provider number) to property_master
- Generates chain portfolio analysis

```bash
# Requires mysql2 package
npm install
node scripts/load_certifiers_to_mysql.cjs
```

## Output Files

| File | Records | Description |
|------|---------|-------------|
| `output/snf_preparers_2024.csv` | 14,242 | Full dataset with facility + certifier info |
| `output/snf_certifier_summary_2024.csv` | 3,161 | Unique certifiers ranked by facility count |
| `output/certifier_chain_analysis.csv` | 3,161 | Chain classification analysis |

## Database Schema

See `/docker/init/25_cost_report_certifiers.sql` for:
- `cost_report_certifiers` table
- `v_certifier_summary` view
- `v_chain_portfolios_by_certifier` view
- `v_chain_analysis` view

## Usage for Chain Analysis

Once loaded into MySQL, query chain portfolios:

```sql
-- Top chains by certifier
SELECT * FROM v_certifier_summary ORDER BY facility_count DESC LIMIT 20;

-- All facilities for a specific chain executive
SELECT * FROM v_chain_portfolios_by_certifier
WHERE certifier_name = 'MICHELLE LEWIS'
ORDER BY state, facility_name;

-- Match rates: how many cost reports matched to property_master
SELECT
    COUNT(*) as total,
    COUNT(property_master_id) as matched,
    ROUND(COUNT(property_master_id) * 100.0 / COUNT(*), 1) as match_pct
FROM cost_report_certifiers;
```

## Certifier Classification Logic

| Classification | Criteria |
|----------------|----------|
| External Preparer | 10+ states |
| Multi-State Chain | 5+ states, 30+ facilities |
| Single Chain Executive | ≤2 states, 20+ facilities |
| Small Operator | <5 facilities |
| Regional Chain/Consultant | Everything else |

## Notes

- Cost reports are filed annually (FY2024 = fiscal years ending in 2024)
- Not all facilities file cost reports (some are exempt or late)
- CCN (CMS Certification Number) is the primary key for matching
- Provider control type codes indicate ownership (proprietary, nonprofit, etc.)
