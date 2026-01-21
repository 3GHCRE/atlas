# 08 - Medicaid Rates Integration

## Overview

This module integrates Medicaid reimbursement rates from state Medicaid programs into the 3G Healthcare Real Estate Atlas. The integration enables:

1. **Storage** of facility-level Medicaid rates linked to 14,054 nursing facilities
2. **Rate Source Configuration** for automated collection from 24 state programs
3. **ETL Pipeline** for loading compiled rate data from 25 states

### Current Status

| Metric | Value |
|--------|-------|
| States Loaded | 25 |
| Total Rates | 8,144 |
| Matched to property_master | 7,693 (94.5%) |
| Unmatched | 451 |

---

## Schema Design

### Tables Created

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `medicaid_rate_sources` | Rate collection configuration | state, update_frequency, source_url, regex_pattern |
| `medicaid_rates` | Facility-level rates | state, facility_name, daily_rate, effective_date, property_master_id |
| `medicaid_rate_collection_log` | Collection tracking | rate_source_id, status, records_loaded |

### Views

| View | Purpose |
|------|---------|
| `v_current_medicaid_rates` | Current rates (end_date IS NULL) with property_master join |
| `v_medicaid_rate_stats` | Statistics by state (avg/min/max rate, match percentage) |
| `v_rate_history` | All rate history with facility details and property_master join |
| `v_rate_changes` | Period-over-period rate changes ($ and %) |
| `v_state_rate_trends` | State-level rate trends by period |
| `v_rate_summary` | Current rates with history count flag |

---

## Data Sources

### Rate Source Configuration (24 States)

The `medicaid_rate_sources` table stores metadata for 24 state Medicaid programs:

| Update Frequency | States |
|-----------------|--------|
| Quarterly | GA, MS, KY, IL, PA, VT, UT |
| Biannually | VA, IN, OH, NH |
| Annually | FL, IA, NY, CA, MA, TX, CO, MT, HI, SD, RI |

### States Requiring Manual Download

Five states require manual authentication/download:
- **FL** - Florida AHCA portal
- **KY** - Kentucky CHFS
- **IA** - Iowa HHS
- **NY** - New York DOH
- **CA** - California DHCS

### Loaded Rate Data (25 States)

Rate data loaded from Excel and PDF source files in `G:\My Drive\3G\Source NF Rates\`:

| State | Facilities | Matched | Match % | Source Type |
|-------|------------|---------|---------|-------------|
| AK | 20 | 18 | 90.0% | PDF |
| CA | 1,018 | 985 | 96.8% | Excel |
| CO | 181 | 163 | 90.1% | PDF |
| FL | 650 | 625 | 96.2% | Excel |
| GA | 343 | 337 | 98.3% | Excel |
| IA | 388 | 343 | 88.4% | Excel |
| IL | 637 | 584 | 91.7% | Excel |
| IN | 497 | 479 | 96.4% | Excel |
| KS | 291 | 276 | 94.8% | Excel |
| KY | 243 | 224 | 92.2% | PDF |
| MA | 336 | 316 | 94.0% | Excel |
| MO | 489 | 460 | 94.1% | Excel |
| MS | 151 | 140 | 92.7% | Excel |
| MT | 59 | 55 | 93.2% | PDF |
| ND | 75 | 68 | 90.7% | PDF |
| NH | 72 | 56 | 77.8% | PDF |
| NY | 600 | 556 | 92.7% | Excel |
| OH | 789 | 773 | 98.0% | Excel |
| PA | 574 | 557 | 97.0% | Excel |
| RI | 73 | 69 | 94.5% | Excel |
| SD | 91 | 82 | 90.1% | PDF |
| UT | 84 | 79 | 94.0% | Excel |
| VA | 269 | 246 | 91.4% | Excel |
| VT | 31 | 30 | 96.8% | PDF |
| WA | 183 | 175 | 95.6% | Excel |

**Total: 8,144 rates covering 57.9% of 14,054 nursing facilities**

---

## Installation & Setup

### Prerequisites

```bash
# Python dependencies
pip install pandas openpyxl mysql-connector-python rapidfuzz
```

### Step 1: Create Schema

```bash
# From project root
mysql -u root -p atlas < docker/init/20_medicaid_rates_schema.sql
```

Verify:
```sql
SHOW TABLES LIKE 'medicaid%';
-- Should return: medicaid_rate_sources, medicaid_rates, medicaid_rate_collection_log
```

### Step 2: Load Rate Source Configuration

```bash
mysql -u root -p atlas < docker/init/21_load_rate_sources.sql
```

Verify:
```sql
SELECT state, update_frequency, requires_user_auth
FROM medicaid_rate_sources
WHERE is_active = TRUE;
-- Should return 24 active states
```

### Step 3: Scan Excel Files (Dry Run)

```bash
cd docker/scripts
python load_medicaid_rates.py --scan-only
```

Expected output:
```
=== FL - FL - Compiled Rates.xlsx ===
Status: VALID
Rows: 689
Columns: ['Provider Number', 'Facility Name', 'City', 'Total Rate', ...]
Mapped:
  [+] facility_name: Facility Name
  [+] daily_rate: Total Rate
  [+] state_facility_id: Provider Number
  ...
```

### Step 4: Execute ETL Load

```bash
python load_medicaid_rates.py --execute
```

### Step 5: Run Facility Matching

```bash
# Preview matches first
python match_facilities.py --preview

# Execute matching
python match_facilities.py --execute

# Check results
python match_facilities.py --stats
```

---

## Query Examples

### Basic Queries

**Current Rates by State (View)**
```sql
SELECT * FROM v_medicaid_rate_stats;
```

**Facilities with Rates**
```sql
SELECT
    pm.facility_name,
    pm.city,
    pm.state,
    mr.daily_rate,
    mr.effective_date
FROM property_master pm
JOIN medicaid_rates mr ON pm.id = mr.property_master_id
WHERE mr.end_date IS NULL
ORDER BY mr.daily_rate DESC
LIMIT 20;
```

**Unmatched Facilities**
```sql
SELECT state, facility_name, daily_rate
FROM medicaid_rates
WHERE property_master_id IS NULL
  AND end_date IS NULL
ORDER BY state, facility_name;
```

---

### Rate Analysis Queries

**State Summary with Statistics**
```sql
SELECT
    state,
    COUNT(*) as facilities,
    ROUND(MIN(daily_rate), 2) as min_rate,
    ROUND(AVG(daily_rate), 2) as avg_rate,
    ROUND(MAX(daily_rate), 2) as max_rate,
    ROUND(STDDEV(daily_rate), 2) as std_dev,
    ROUND(STDDEV(daily_rate) / AVG(daily_rate) * 100, 1) as cv_pct
FROM medicaid_rates
WHERE end_date IS NULL AND daily_rate > 0
GROUP BY state
ORDER BY avg_rate DESC;
```

**Regional Comparison**
```sql
SELECT
    CASE
        WHEN state IN ('MA', 'NY', 'PA', 'VT', 'NH', 'RI') THEN 'Northeast'
        WHEN state IN ('FL', 'GA', 'VA', 'KY', 'MS') THEN 'Southeast'
        WHEN state IN ('OH', 'IN', 'IL', 'IA', 'MO', 'ND', 'SD') THEN 'Midwest'
        WHEN state IN ('CA', 'CO', 'MT', 'UT', 'WA') THEN 'West'
    END as region,
    COUNT(*) as facilities,
    ROUND(AVG(daily_rate), 2) as avg_rate,
    ROUND(MIN(daily_rate), 2) as min_rate,
    ROUND(MAX(daily_rate), 2) as max_rate
FROM medicaid_rates
WHERE end_date IS NULL AND daily_rate > 0
GROUP BY region
ORDER BY avg_rate DESC;
```

**Rate Distribution Buckets**
```sql
SELECT
    CASE
        WHEN daily_rate < 150 THEN 'Under $150'
        WHEN daily_rate < 200 THEN '$150-$199'
        WHEN daily_rate < 250 THEN '$200-$249'
        WHEN daily_rate < 300 THEN '$250-$299'
        WHEN daily_rate < 350 THEN '$300-$349'
        WHEN daily_rate < 400 THEN '$350-$399'
        WHEN daily_rate < 500 THEN '$400-$499'
        ELSE '$500+'
    END as rate_bucket,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM medicaid_rates WHERE end_date IS NULL), 1) as pct
FROM medicaid_rates
WHERE end_date IS NULL AND daily_rate > 0
GROUP BY rate_bucket
ORDER BY MIN(daily_rate);
```

**Top 20 Highest Rates**
```sql
SELECT
    mr.state,
    mr.facility_name,
    mr.daily_rate,
    pm.city,
    ROUND(mr.daily_rate * 365, 0) as annual_per_bed
FROM medicaid_rates mr
LEFT JOIN property_master pm ON mr.property_master_id = pm.id
WHERE mr.end_date IS NULL AND mr.daily_rate > 0
ORDER BY mr.daily_rate DESC
LIMIT 20;
```

**Lowest 20 Rates (Potential Concerns)**
```sql
SELECT
    mr.state,
    mr.facility_name,
    mr.daily_rate,
    pm.city
FROM medicaid_rates mr
LEFT JOIN property_master pm ON mr.property_master_id = pm.id
WHERE mr.end_date IS NULL AND mr.daily_rate > 0
ORDER BY mr.daily_rate ASC
LIMIT 20;
```

**Annual Revenue Potential by State**
```sql
SELECT
    state,
    COUNT(*) as facilities,
    ROUND(AVG(daily_rate), 2) as avg_daily_rate,
    ROUND(AVG(daily_rate) * 365, 0) as annual_per_bed,
    ROUND(AVG(daily_rate) * 365 * 100, 0) as annual_100_beds
FROM medicaid_rates
WHERE end_date IS NULL AND daily_rate > 0
GROUP BY state
ORDER BY avg_daily_rate DESC;
```

**Rate Variance Analysis (Coefficient of Variation)**
```sql
-- Higher CV% indicates more rate variation within the state
SELECT
    state,
    COUNT(*) as facilities,
    ROUND(AVG(daily_rate), 2) as avg_rate,
    ROUND(STDDEV(daily_rate), 2) as std_dev,
    ROUND(STDDEV(daily_rate) / AVG(daily_rate) * 100, 1) as cv_pct,
    ROUND(MAX(daily_rate) - MIN(daily_rate), 2) as rate_spread
FROM medicaid_rates
WHERE end_date IS NULL AND daily_rate > 0
GROUP BY state
ORDER BY cv_pct DESC;
```

**Matched vs Unmatched Rate Comparison**
```sql
SELECT
    CASE WHEN property_master_id IS NOT NULL THEN 'Matched' ELSE 'Unmatched' END as status,
    COUNT(*) as count,
    ROUND(AVG(daily_rate), 2) as avg_rate,
    ROUND(MIN(daily_rate), 2) as min_rate,
    ROUND(MAX(daily_rate), 2) as max_rate
FROM medicaid_rates
WHERE end_date IS NULL AND daily_rate > 0
GROUP BY status;
```

**Facilities Above/Below State Average**
```sql
WITH state_avg AS (
    SELECT state, AVG(daily_rate) as avg_rate
    FROM medicaid_rates
    WHERE end_date IS NULL
    GROUP BY state
)
SELECT
    mr.state,
    mr.facility_name,
    mr.daily_rate,
    ROUND(sa.avg_rate, 2) as state_avg,
    ROUND(mr.daily_rate - sa.avg_rate, 2) as variance,
    ROUND((mr.daily_rate - sa.avg_rate) / sa.avg_rate * 100, 1) as pct_diff
FROM medicaid_rates mr
JOIN state_avg sa ON mr.state = sa.state
WHERE mr.end_date IS NULL
ORDER BY pct_diff DESC
LIMIT 20;
```

**Overall Summary Statistics**
```sql
SELECT
    COUNT(*) as total_facilities,
    COUNT(DISTINCT state) as states_covered,
    ROUND(AVG(daily_rate), 2) as avg_rate,
    ROUND(MIN(daily_rate), 2) as min_rate,
    ROUND(MAX(daily_rate), 2) as max_rate,
    ROUND(STDDEV(daily_rate), 2) as std_dev,
    SUM(CASE WHEN property_master_id IS NOT NULL THEN 1 ELSE 0 END) as matched,
    ROUND(SUM(CASE WHEN property_master_id IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as match_pct
FROM medicaid_rates
WHERE end_date IS NULL AND daily_rate > 0;
```

---

### Current Rate Benchmarks (January 2026)

| Metric | Value |
|--------|-------|
| **Total Facilities** | 8,144 |
| **States Covered** | 25 |
| **Overall Average** | $308.45/day |
| **Median Rate** | $290.50/day |
| **25th Percentile** | $252.00/day |
| **75th Percentile** | $325.00/day |
| **Highest State Avg** | AK ($1,198.91) |
| **Lowest State Avg** | RI ($137.27) |
| **Annual/Bed (Median)** | $106,033 |

**Notable:** Alaska has the highest Medicaid NF rates in the US ($553-$2,201/day) due to high cost of living, remote locations, and hospital-based facilities.

---

## ETL Pipeline Details

### Column Detection

The ETL uses adaptive column detection with this priority:

| Priority | Method | Example |
|----------|--------|---------|
| 1 | Exact match | "Facility Name" → "Facility Name" |
| 2 | Case-insensitive | "FACILITY NAME" → "Facility Name" |
| 3 | Contains match | "NF Facility Name" → "Facility Name" |
| 4 | Fuzzy (>80%) | "Facil. Name" → "Facility Name" |
| 5 | State config | Fall back to state-specific override |

### State Configuration

State-specific mappings are in `docker/scripts/state_mappings.py`:

```python
STATE_CONFIGS = {
    "FL": {
        "facility_name_cols": ["Facility Name", "Provider Name", ...],
        "rate_cols": ["Total Rate", "Per Diem Rate", ...],
        "id_cols": ["Provider Number", "Provider ID", ...],
        ...
    },
    ...
}
```

### PDF Extraction

Seven states provide rate data only in PDF format. The ETL uses `pdfplumber` for extraction:

| State | PDF Pattern | Example |
|-------|-------------|---------|
| KY | `FacilityName $Rate Percent` | `Signature Healthcare $286.34 75%` |
| CO | `Address City, State Zip` | `1000 East Stuart Street Fort Collins, CO 80525` |
| SD | `FacilityName $PerDiem` | `Aberdeen Healthcare $245.50` |
| ND | `City FacilityName; ProviderID` | `Bismarck Good Samaritan; 1234` |
| NH | `FacilityName, City CODE $Rate` | `The Elms, Milford 03055 $180.25` |
| MT | `FacilityName City $Rate` | `Benefis Skilled Nursing Center Great Falls $286.34` |
| VT | `FacilityName $Rate` | `Bel Aire Quality Care $298.50` |

```python
# Example KY extraction pattern
import pdfplumber
import re

pattern = r'^(.+?)\s+\$(\d+\.\d{2})\s+\d+%'
with pdfplumber.open(filepath) as pdf:
    for page in pdf.pages:
        for line in page.extract_text().split('\n'):
            match = re.match(pattern, line)
            if match:
                facility = match.group(1).strip()
                rate = float(match.group(2))
```

### Facility Matching

The matching script uses multiple strategies:

1. **Exact Match** - Normalized name equality (100% score)
2. **Fuzzy Match** - Token sort ratio via RapidFuzz (85%+ threshold)
3. **Token Overlap** - Significant word overlap (60%+ overlap)

Name normalization includes:
- Abbreviation standardization (SNF, NH, HC, etc.)
- Suffix removal (LLC, Inc, Corp)
- Punctuation cleanup
- Whitespace normalization

---

## Data Quality Notes

### Match Rate by Tier

**Tier 1: Excellent (95%+)**
| State | Match % | Notes |
|-------|---------|-------|
| GA | 98.3% | Clean facility names |
| OH | 98.0% | NPI lookup applied |
| PA | 97.0% | Standard naming |
| VT | 96.8% | Small state, manual review |
| CA | 96.8% | Large dataset, good coverage |
| IN | 96.4% | Clean data |
| FL | 96.2% | Standard naming |
| WA | 95.6% | Clean Excel source |

**Tier 2: Good (90-95%)**
| State | Match % | Notes |
|-------|---------|-------|
| KS | 94.8% | Clean facility names from Excel |
| RI | 94.5% | Used alternate names column |
| MO | 94.1% | Standard matching |
| UT | 94.0% | Standard matching |
| MA | 94.0% | Standard matching |
| MT | 93.2% | City suffix removal, manual matches |
| NY | 92.7% | Large dataset |
| MS | 92.7% | Enhanced fuzzy matching |
| KY | 92.2% | PDF extraction |
| IL | 91.7% | Truncated names, partial matching |
| VA | 91.4% | NPI lookup applied |
| ND | 90.7% | City prefix removal |
| SD | 90.1% | DBA name extraction |
| CO | 90.1% | Address-based matching |
| AK | 90.0% | Hospital-based SNFs, highest rates in US |

**Tier 3: Needs Review (<90%)**
| State | Match % | Notes |
|-------|---------|-------|
| IA | 88.4% | "Aspire of" chain uses different names |
| NH | 77.8% | Hospital-based SNF units not in property_master |

### Matching Techniques Applied

1. **NPI Lookup** - Used cms_enrollments_staging to map NPI → DBA name (OH, VA, others)
2. **Fuzzy Matching** - RapidFuzz token_sort_ratio, token_set_ratio, partial_ratio
3. **Name Normalization** - Suffix removal, abbreviation standardization
4. **Address Matching** - For CO facilities listed by street address
5. **City Context** - City suffix/prefix removal for state-specific formats
6. **DBA Extraction** - Parse "D/B/A" patterns in facility names
7. **Manual Review** - Hand-matched facilities with non-standard names

### Common Unmatched Patterns

1. **Hospital-based SNFs** - Critical Access Hospitals with swing beds (NH)
2. **Chain rebrandings** - "Aspire of" facilities have different CMS names (IA)
3. **Operating company names** - LLCs instead of facility names (RI, OH)
4. **New facilities** - Recently opened, not yet in CMS data
5. **Closed facilities** - Still in rate files but removed from property_master

### Temporal Handling

- Multiple rates per facility are supported (historical tracking)
- `end_date IS NULL` indicates current rate
- Always filter for current rates in queries unless historical analysis needed

---

## Automation (Future)

### n8n Workflow Architecture

For states WITHOUT manual download requirement:

```
Trigger: Cron (based on update_frequency)
  → Read medicaid_rate_sources WHERE is_active = TRUE
  → For each state:
      → HTTP Request to source_url
      → Apply regex_pattern to find files
      → Download matching files
      → Parse with appropriate handler
      → Insert into medicaid_rates
      → Log to medicaid_rate_collection_log
```

### Manual Download States

For FL, KY, IA, NY, CA:
1. Download file manually to watched folder
2. n8n watches folder for new files
3. File processed and loaded automatically

---

## Rate Update Workflow

### Check Update Status

```bash
python docker/scripts/update_rates.py --check
```

Shows which states need updates based on their update frequency:
- **Quarterly** states: Update needed after 100 days
- **Biannually** states: Update needed after 200 days
- **Annually** states: Update needed after 380 days

### Source URLs by State

| State | Frequency | Auth Required | Source URL |
|-------|-----------|---------------|------------|
| CA | Annually | Yes | https://www.dhcs.ca.gov/services/medi-cal/Pages/AB1629/LTC.aspx |
| CO | Annually | No | https://hcpf.colorado.gov/provider-rates-fee-schedule |
| FL | Annually | Yes | https://ahca.myflorida.com/medicaid/cost-reimbursement/nursing-home-rates |
| GA | Quarterly | No | https://dch.georgia.gov/providers/provider-types/nursing-home-providers/reimbursement-rates |
| IA | Annually | Yes | http://hhs.iowa.gov/programs/welcome-iowa-medicaid/iowa-health-link/nursing-facility-rates |
| IL | Quarterly | No | https://hfs.illinois.gov/medicalproviders/medicaidreimbursement/ltc.html |
| IN | Biannually | No | https://myersandstauffer.com/client-portal/indiana/indiana-long-term-care/#toggle-id-9 |
| KY | Quarterly | Yes | https://www.chfs.ky.gov/agencies/dms/Pages/feesrates.aspx |
| MA | Annually | No | https://www.mass.gov/regulations/101-CMR-20600-standard-payments-to-nursing-facilities |
| MO | Biannually | No | https://mydss.mo.gov/media/file/nursing-facility-rate-list |
| MS | Quarterly | No | https://medicaid.ms.gov/providers/fee-schedules-and-rates/ |
| MT | Annually | No | https://medicaidprovider.mt.gov/26 |
| NH | Biannually | No | https://www.dhhs.nh.gov/programs-services/adult-aging-care/nursing-home-care |
| NY | Annually | Yes | https://www.health.ny.gov/facilities/long_term_care/reimbursement/nhr/ |
| OH | Biannually | No | https://medicaid.ohio.gov/resources-for-providers/enrollment-and-support/provider-types/nursing-facilities/nursing-facilities |
| PA | Quarterly | No | https://www.pa.gov/agencies/dhs/resources/for-providers/ltc-providers/nursing-facilities-rates |
| RI | Annually | No | https://eohhs.ri.gov/providers-partners/provider-directories/nursing-homes |
| TX | Annually | No | https://pfd.hhs.texas.gov/long-term-services-supports/nursing-facility-nf |
| UT | Quarterly | No | https://medicaid.utah.gov/stplan/longtermcarehra/ |
| VA | Biannually | No | https://www.dmas.virginia.gov/for-providers/rates-and-rate-setting/nursing-facilities/ |
| VT | Quarterly | No | https://dvha.vermont.gov/document/medicaid-quarterly-rate-list |
| WA | Biannually | No | https://www.dshs.wa.gov/altsa/management-services-division/nursing-facility-rates-and-reports |

### Load New Rates

```bash
# 1. Download updated rate file from source URL
# 2. Place in G:\My Drive\3G\Source NF Rates\

# 3. Load with effective date
python docker/scripts/update_rates.py --load FL --file "G:\My Drive\3G\Source NF Rates\FL_Rates_2026.xlsx" --date 2026-01-01
```

The load process:
1. Closes existing current rates (sets `end_date`)
2. Inserts new rates with the provided `effective_date`
3. New rates have `end_date = NULL` (marking them as current)

### Show Rate History

```bash
python docker/scripts/update_rates.py --history FL
```

Example output:
```
RATE HISTORY: FL
Period       Facilities     Min        Avg        Max
2026-01-01         650   $175.00   $325.50       $485.00
2025-10-01         650   $172.00   $318.25 (+2.3%)  $480.00
2025-07-01         648   $170.00   $311.00 (+2.3%)  $475.00
```

### Show Rate Changes

```bash
python docker/scripts/update_rates.py --changes
```

Shows period-over-period changes by state with $ and % change.

---

## Rate History Tracking

### Views for Period-Over-Period Analysis

**v_rate_changes** - Compare current vs prior period for each facility:

```sql
SELECT
    state,
    facility_name,
    current_rate,
    current_period,
    prior_rate,
    prior_period,
    rate_change_dollar,
    rate_change_pct
FROM v_rate_changes
WHERE prior_rate IS NOT NULL
ORDER BY rate_change_pct DESC
LIMIT 20;
```

**v_state_rate_trends** - State-level trends by period:

```sql
SELECT * FROM v_state_rate_trends
WHERE state = 'FL'
ORDER BY effective_date DESC;
```

### Rate Change Queries

**Facilities with Rate Increases**
```sql
SELECT * FROM v_rate_changes
WHERE rate_change_pct > 0
ORDER BY rate_change_pct DESC
LIMIT 20;
```

**Facilities with Rate Decreases**
```sql
SELECT * FROM v_rate_changes
WHERE rate_change_pct < 0
ORDER BY rate_change_pct ASC
LIMIT 20;
```

**Largest $ Increases**
```sql
SELECT * FROM v_rate_changes
WHERE prior_rate IS NOT NULL
ORDER BY rate_change_dollar DESC
LIMIT 20;
```

**State Summary of Changes**
```sql
SELECT
    state,
    COUNT(*) as facilities,
    ROUND(AVG(rate_change_dollar), 2) as avg_change_dollar,
    ROUND(AVG(rate_change_pct), 2) as avg_change_pct,
    SUM(CASE WHEN rate_change_pct > 0 THEN 1 ELSE 0 END) as increases,
    SUM(CASE WHEN rate_change_pct < 0 THEN 1 ELSE 0 END) as decreases
FROM v_rate_changes
WHERE prior_rate IS NOT NULL
GROUP BY state
ORDER BY avg_change_pct DESC;
```

---

## Troubleshooting

### Common Issues

**ETL fails to connect to database:**
```bash
# Check Docker container is running
docker ps | grep 3ghcre-mysql

# Verify connection settings
export DB_HOST=localhost
export DB_PORT=3306
export DB_USER=atlas_user
export DB_PASSWORD=atlas_pass
```

**No columns detected:**
- Check Excel file structure
- Add state-specific mapping to `state_mappings.py`
- Run with `--scan-only` to diagnose

**Low match rate:**
- Lower threshold: `python match_facilities.py --threshold 80`
- Add name normalizations to `match_facilities.py`
- Manual review of unmatched facilities

### Debug Queries

```sql
-- Check collection log
SELECT * FROM medicaid_rate_collection_log
ORDER BY collection_date DESC
LIMIT 10;

-- Find duplicate rates
SELECT state, facility_name, COUNT(*)
FROM medicaid_rates
WHERE end_date IS NULL
GROUP BY state, facility_name
HAVING COUNT(*) > 1;
```

---

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| Schema SQL | `docker/init/20_medicaid_rates_schema.sql` | Table definitions |
| Rate Sources Load | `docker/init/21_load_rate_sources.sql` | Configuration data |
| Rate History Views | `docker/init/22_rate_history_views.sql` | Period-over-period tracking views |
| State Mappings | `docker/scripts/state_mappings.py` | Column configurations |
| ETL Script | `docker/scripts/load_medicaid_rates.py` | Main data loading |
| Update Script | `docker/scripts/update_rates.py` | Rate updates and history commands |
| Matching Script | `docker/scripts/match_facilities.py` | Facility matching |
| Source CSV | `data/medicaid_rates/rate_sources.csv` | 24-state source config |
| Source Files | `G:\My Drive\3G\Source NF Rates\` | Raw rate files from states |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-20 | Initial implementation with 9 compiled states |
| 1.1 | 2026-01-20 | Expanded to 23 states (7,833 rates), added PDF extraction |
| 1.2 | 2026-01-20 | Enhanced matching: NPI lookup, address matching, DBA extraction. Overall 94.5% match rate |
| 1.3 | 2026-01-20 | Added comprehensive rate analysis queries and benchmarks |
| 1.4 | 2026-01-20 | Added rate update workflow with source URLs, rate history tracking views (v_rate_changes, v_state_rate_trends), and update_rates.py script |
| 1.5 | 2026-01-21 | Added Alaska (20 facilities, highest rates in US $553-$2,201/day) and Kansas (291 facilities) bringing total to 25 states with 8,144 rates |
