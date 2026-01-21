# Medicaid Rates Data

## Overview

This directory contains facility-level Medicaid reimbursement rates for skilled nursing facilities (SNFs) across 26 states. Rates are collected from state Medicaid agency websites and stored both as CSV files and in the MySQL database.

## Directory Structure

```
medicaid_rates/
├── raw/                    # Source files from state agencies (gitignored)
│   └── [state]/            # PDFs, Excel files by state
├── compiled/               # Standardized CSV output (tracked)
│   └── [STATE]_[DATE]_rates.csv
├── scripts/                # Processing scripts
│   ├── export_db_to_csv.cjs
│   └── load_csv_to_db.cjs
├── rate_sources.csv        # State agency metadata
├── package.json
└── README.md
```

## Data Coverage

| State | Facilities | Avg Rate | Effective Date |
|-------|------------|----------|----------------|
| AK | 20 | $1,214.01 | 2026-01 |
| CA | 944 | $327.88 | 2026-01 |
| CO | 362 | $288.78 | 2025-26 |
| FL | 650 | $307.39 | 2025-10 |
| GA | 687 | $233.95 | 2026-01 |
| HI | 36 | $494.45 | 2026-01 |
| IA | 340 | $239.32 | 2025-07 |
| IL | 1,277 | $251.37 | 2026-01 |
| IN | 998 | $306.25 | 2025-07 |
| KS | 291 | $309.03 | 2026-01 |
| KY | 496 | $375.52 | 2025-10 |
| MA | 336 | $601.09 | 2025-10 |
| MO | 966 | $243.88 | 2025-07 |
| MS | 318 | $283.10 | 2026-01 |
| MT | 59 | $283.19 | 2025-07 |
| ND | 75 | $283.05 | 2025-01 |
| NH | 72 | $255.55 | 2025-07 |
| NY | 600 | $293.67 | 2025-01 |
| OH | 1,700 | $273.44 | 2025-07 |
| PA | 1,151 | $283.69 | 2026-01 |
| RI | 146 | $178.14 | 2024-10 |
| SD | 91 | $247.70 | 2025-07 |
| UT | 84 | $555.90 | 2025-10 |
| VA | 539 | $257.91 | 2025-10 |
| VT | 31 | $396.21 | 2025-07 |
| WA | 183 | $393.55 | 2026-01 |

**Total: 26 states, ~14,000 facility rates**

## CSV Format

All compiled CSV files follow a standard format:

```csv
state,provider_number,facility_name,daily_rate,effective_date,city
KS,100001,St. Luke Living Center,308.77,2026-01-01,Marion
```

| Column | Description |
|--------|-------------|
| state | 2-letter state code |
| provider_number | State-specific facility ID |
| facility_name | Facility name from rate file |
| daily_rate | Medicaid per diem rate ($/day) |
| effective_date | Rate effective date (YYYY-MM-DD) |
| city | City location |

## Scripts

### Export from Database to CSV

```bash
npm run export
# or
node scripts/export_db_to_csv.cjs
```

Exports rates from MySQL `medicaid_rates` table to CSV files in `compiled/`.

### Load CSV to Database

```bash
npm run load
# or
node scripts/load_csv_to_db.cjs
```

Loads rates from CSV files into MySQL `medicaid_rates` table and matches to `property_master`.

## Database Schema

See `/docker/init/20_medicaid_rates_schema.sql` for:
- `medicaid_rates` table (facility-level rates)
- `medicaid_rate_sources` table (state agency metadata)
- `v_current_medicaid_rates` view
- `v_medicaid_rate_stats` view

### Key Queries

```sql
-- Current rates by state
SELECT * FROM v_medicaid_rate_stats ORDER BY state;

-- Rates for a specific facility
SELECT * FROM v_current_medicaid_rates
WHERE facility_name LIKE '%Genesis%';

-- Compare rates across states
SELECT state,
       COUNT(*) as facilities,
       ROUND(AVG(daily_rate), 2) as avg_rate,
       MIN(daily_rate) as min_rate,
       MAX(daily_rate) as max_rate
FROM medicaid_rates
WHERE end_date IS NULL
GROUP BY state
ORDER BY avg_rate DESC;
```

## Data Sources

Rates are collected from state Medicaid agency websites. See `rate_sources.csv` for:
- Agency URLs
- Update frequency (quarterly, annually)
- Collection notes and patterns

### High-Rate States (>$400/day avg)
- **Massachusetts** ($601) - Highest rates in dataset
- **Utah** ($555) - Mountain West premium
- **Hawaii** ($494) - Island cost adjustment
- **Alaska** ($1,214) - Highest individual rates due to remote locations

### Collection Status
- 26 states with publicly available rates
- ~24 additional states require FOIA requests or have restricted access
- See main project documentation for FOIA tracking

## Notes

- Rates represent Medicaid per diem reimbursement only (not private pay or Medicare)
- Some states publish component rates (nursing, capital, ancillary) - we track total rates
- Rate periods vary by state (quarterly, semi-annual, annual updates)
- Match rate to `property_master` averages 60-80% depending on state
