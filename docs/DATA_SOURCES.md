# Data Sources & Schema Reference

**3G Healthcare Real Estate Atlas**
**Last Updated:** January 2026

---

## Current Data Sources

### 1. CMS Provider Enrollment Data (Primary)

| Dataset | Source | Records | Key Fields |
|---------|--------|---------|------------|
| SNF Enrollments | data.cms.gov | 14,054 | CCN, facility_name, address, affiliated_entity |
| SNF All Owners | data.cms.gov | 47,386 | Owner type (I/O), role codes, associate_id |
| SNF CHOW | data.cms.gov | 4,953 | Change of ownership transactions |
| SNF CHOW Owners | data.cms.gov | 9,906 | Buyer/seller parties on CHOW deals |

**Update Frequency:** Monthly
**Join Key:** CCN (CMS Certification Number)
**Coverage:** 100% of Medicare/Medicaid certified SNFs

**URL:** https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/skilled-nursing-facility-providers

---

### 2. State Medicaid Reimbursement Rates

| Metric | Value |
|--------|-------|
| States Loaded | 26 |
| Total Rate Records | 14,041 |
| Current Rates | 8,206 |
| Matched to Facilities | 6,156 (75%) |
| Facility Coverage | 41.3% of 14,054 |

**Rate Ranges:**
| Region | Avg Rate | Min | Max |
|--------|----------|-----|-----|
| West | $359.57 | $194 | $2,201 (AK) |
| Northeast | $341.42 | $162 | $2,139 (NY) |
| Southeast | $300.85 | $170 | $1,005 |
| Midwest | $269.64 | $120 | $553 |

**Source Files:** State Medicaid agency websites (Excel, PDF)
**Update Frequency:** Varies by state (Quarterly → Annually)
**Join Key:** Facility name fuzzy match → property_master_id

**States Covered:**
AK, CA, CO, FL, GA, HI, IA, IL, IN, KS, KY, MA, MO, MS, MT, ND, NH, NY, OH, PA, RI, SD, UT, VA, VT, WA

---

### 3. CMS Cost Report Certifiers

| Metric | Value |
|--------|-------|
| Records | 14,242 |
| Unique Certifiers | ~2,500 |
| Facilities Covered | 14,054 |

**Source:** CMS HCRIS (Healthcare Cost Report Information System)
**Value:** Identifies external preparers, chain executives, consultants
**Join Key:** CCN → property_master

---

## Current Schema (4-Layer Architecture)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 1        LAYER 2         LAYER 3        LAYER 4    │
│                    ASSETS         ENTITIES        PORTFOLIOS     PEOPLE     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  property_master ──► entities ──► companies ──► principals                  │
│     (14,054)        (29,574)     (10,489)       (54,714)                   │
│                                                                             │
│  SNF Facilities    Legal LLCs/    Portfolio      Individual                 │
│  by CCN            Corps          Groups         Owners/Officers            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Junction Tables

| Table | Records | Links |
|-------|---------|-------|
| property_entity_relationships | 56,721 | Property → Entity |
| principal_entity_relationships | 99,049 | Principal → Entity |
| principal_company_relationships | 65,135 | Principal → Company |
| deals | 29,365 | All transactions (CHOW, sales, mortgages) |
| deals_parties | 59,464 | Buyer/Seller/Lender on deals |
| medicaid_rates | 8,206 | Rates → Property |

---

## Alternative Data Sources (Prioritized)

### Tier 1: High Impact / Easy Integration

#### 1.1 CMS Quality & Star Ratings
**Source:** data.cms.gov - Nursing Home Compare
**URL:** https://data.cms.gov/provider-data/dataset/4pq5-n9py

| Field | Description |
|-------|-------------|
| overall_rating | 1-5 stars |
| health_inspection_rating | Survey performance |
| staffing_rating | RN/total staffing levels |
| quality_rating | Quality measures |
| abuse_icon | Abuse citations flag |
| sff_flag | Special Focus Facility |

**Join Key:** CCN
**Update Frequency:** Monthly
**Value:** Quality overlay on ownership - identify distressed assets, turnaround targets

---

#### 1.2 CMS Staffing Data (PBJ - Payroll Based Journal)
**Source:** data.cms.gov
**URL:** https://data.cms.gov/provider-data/dataset/g6vv-u9sr

| Field | Description |
|-------|-------------|
| rn_hours_per_resident_day | RN staffing intensity |
| total_nurse_hours | All nursing hours |
| staffing_rating | Derived rating |
| weekend_staffing | Weekend coverage |
| turnover_rate | Staff turnover % |

**Join Key:** CCN
**Update Frequency:** Quarterly
**Value:** Operational health indicator, predicts quality problems

---

#### 1.3 CMS Utilization & Discharge Data
**Source:** data.cms.gov - SNF Utilization
**URL:** https://data.cms.gov/provider-summary-by-type-of-service/medicare-skilled-nursing-facilities

| Field | Description |
|-------|-------------|
| total_stays | Medicare stays |
| total_days | Total patient days |
| avg_length_of_stay | Average LOS |
| discharge_to_community | % discharged home |
| readmission_rate | 30-day hospital readmit |
| medicare_payments | Total Medicare $ |

**Join Key:** CCN
**Update Frequency:** Annual (with lag)
**Value:** Utilization patterns, payer mix insights, operational benchmarking

---

#### 1.4 CMS Cost Reports (Full HCRIS Data)
**Source:** CMS HCRIS
**URL:** https://www.cms.gov/Research-Statistics-Data-and-Systems/Downloadable-Public-Use-Files/Cost-Reports

| Field | Description |
|-------|-------------|
| total_revenue | All revenue |
| total_expenses | All expenses |
| net_income | Profitability |
| occupancy_rate | Beds occupied % |
| payer_mix | Medicare/Medicaid/Private % |
| bad_debt | Uncollected revenue |

**Join Key:** CCN + Provider Number
**Update Frequency:** Annual (18-month lag)
**Value:** Financial performance, identify underperformers, acquisition targets

---

### Tier 2: Medium Impact / Moderate Effort

#### 2.1 Industry News & Intelligence

##### SkilledNursingNews.com
**Type:** Trade publication
**Coverage:** Deal announcements, acquisitions, closures, executive moves, regulatory news

| Intelligence Type | Lead Time vs CMS |
|-------------------|------------------|
| Acquisition announcements | 3-6 months early |
| Closure notices | Immediate |
| Executive changes | Real-time |
| Regulatory actions | Real-time |
| Financing deals | Never in CMS |

**Integration:** RSS feed monitoring, article scraping, entity extraction
**Value:** Real-time deal flow intelligence

##### McKnight's Long-Term Care News
**URL:** https://www.mcknights.com
**Type:** Trade publication (broader LTC coverage)
**Coverage:** Similar to SNN plus policy analysis, workforce trends

##### Senior Housing News
**URL:** https://seniorhousingnews.com
**Coverage:** Broader senior living, includes SNF transactions

**Recommended Approach:**
1. RSS feed aggregation
2. Keyword alerts (operator names, "acquisition", "sale", "closure")
3. Entity extraction to match to companies/principals
4. Store as `news_articles` table linked to entities

---

#### 2.2 HUD/FHA Mortgage Data (Section 232)
**Source:** HUD
**URL:** https://www.hud.gov/program_offices/housing/mfh/hsgmftgdb

| Field | Description |
|-------|-------------|
| fha_loan_number | HUD loan ID |
| original_principal | Loan amount |
| interest_rate | Rate |
| maturity_date | Loan term end |
| lender_name | Originating lender |
| property_name | Facility name |

**Join Key:** Address matching → property_master
**Update Frequency:** Monthly
**Value:** Financing intelligence, identify refinancing opportunities, lender relationships

---

#### 2.3 State Licensing Databases
**Source:** State health department licensing portals
**Coverage:** Varies by state

| Field | Description |
|-------|-------------|
| license_number | State license ID |
| license_status | Active/Suspended/Revoked |
| bed_count | Licensed beds |
| administrator | Licensed administrator name |
| expiration_date | License renewal date |

**Value:** Bed count validation, administrator tracking, license status alerts

---

#### 2.4 State Corporate Filings (Secretary of State)
**Source:** State SOS websites
**Coverage:** All 50 states (varying accessibility)

| Field | Description |
|-------|-------------|
| entity_name | Legal name |
| entity_type | LLC/Corp/LP |
| formation_date | Date formed |
| registered_agent | Agent name/address |
| officers | Listed officers |
| annual_report | Latest filing |

**Value:** Verify ownership, find shell company connections, track entity changes
**Challenge:** 50 different systems, scraping complexity

---

### Tier 3: Specialized / High Effort

#### 3.1 County Property Records
**Source:** County assessor/recorder offices
**Coverage:** County-by-county

| Field | Description |
|-------|-------------|
| parcel_id | APN/Parcel number |
| assessed_value | Tax assessed value |
| sale_price | Last sale price |
| sale_date | Transaction date |
| deed_type | Warranty/Quitclaim/etc |
| grantor/grantee | Buyer/Seller names |

**Value:** Real estate valuation, verify REAPI data, track transfers
**Challenge:** 3,000+ counties, no standard format

---

#### 3.2 Litigation Data (PACER / State Courts)
**Source:** Federal PACER, state court systems

| Intelligence Type | Source |
|-------------------|--------|
| Bankruptcy filings | PACER |
| Federal lawsuits | PACER |
| State lawsuits | State court portals |
| Qui tam actions | PACER |
| AG investigations | State AG websites |

**Value:** Risk intelligence, distressed opportunity identification
**Challenge:** Cost (PACER fees), scraping complexity

---

#### 3.3 SEC Filings (Public Operators)
**Source:** SEC EDGAR
**URL:** https://www.sec.gov/cgi-bin/browse-edgar

**Covered Operators:**
- The Ensign Group (ENSG)
- PACS Group (PACS)
- Genesis Healthcare (GEN) - emerged from bankruptcy
- Sabra Health Care REIT (SBRA)
- CareTrust REIT (CTRE)
- National Health Investors (NHI)

| Filing | Value |
|--------|-------|
| 10-K | Annual facility lists, financials |
| 10-Q | Quarterly updates |
| 8-K | Acquisitions, dispositions |
| DEF 14A | Executive compensation |

**Join Key:** Facility lists in exhibits → CCN matching
**Value:** Public chain intelligence, early acquisition signals

---

#### 3.4 OSHA Violations
**Source:** OSHA
**URL:** https://www.osha.gov/ords/imis/establishment.html

| Field | Description |
|-------|-------------|
| inspection_date | When inspected |
| violation_type | Serious/Willful/Repeat |
| penalty | Fine amount |
| citation_status | Open/Closed |

**Join Key:** Employer name/address → property_master
**Value:** Workplace safety risk indicator

---

#### 3.5 Medicare Claims / Utilization (Limited Access)
**Source:** CMS Research Data
**Access:** Data Use Agreement required

| Dataset | Description |
|---------|-------------|
| MDS 3.0 | Minimum Data Set - patient assessments |
| Claims | Actual Medicare billing data |
| MBSF | Beneficiary summary file |

**Value:** Deep utilization analytics, case mix, acuity
**Challenge:** DUA process, PHI handling, research use only

---

## Data Integration Roadmap

### Phase 1: CMS Quality Stack ✅ SCHEMA READY

**Schema Created:** `docker/init/30_cms_quality_schema.sql`

**Tables Created:**
- `cms_provider_info_staging` - Raw provider info import
- `quality_ratings` - Star ratings with multi-period support
- `staffing_data` - PBJ staffing metrics with multi-period support
- `cms_cost_report_staging` - Raw HCRIS import
- `cost_reports` - Parsed financial metrics with multi-period support
- `cms_data_collection_log` - Data source tracking

**Views Created:**
- `v_quality_changes` - Period-over-period rating changes
- `v_staffing_trends` - Period-over-period staffing changes
- `v_financial_trends` - Period-over-period financial performance
- `v_facility_performance` - Latest performance summary per facility

---

### Download URLs & Instructions

#### 1. CMS Provider Info (Quality/Star Ratings)
**Direct Download:**
```
https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0/download?format=csv
```

**Archived Versions (Multiple Periods):**
```
https://data.cms.gov/provider-data/archived-data/nursing-homes
```
Navigate to "Provider Information" section, download monthly snapshots.

**Update Frequency:** Monthly
**File Size:** ~15MB per snapshot

---

#### 2. CMS Staffing Data (PBJ)
**Direct Download:**
```
https://data.cms.gov/provider-data/api/1/datastore/query/g6vv-u9sr/0/download?format=csv
```

**Update Frequency:** Quarterly
**File Size:** ~10MB per snapshot

---

#### 3. CMS Cost Reports (HCRIS)

**Option A: NBER Pre-Parsed (Recommended)**
```
https://www.nber.org/research/data/hcris-snf
```
- Formats: CSV, Stata, SAS
- Years: 2010-2021 (Form 2540-10)
- Files needed: `snf10_rpt.csv` (report table), `snf10_nmrc.csv` (numeric data)

**Option B: CMS Direct (Raw)**
```
https://www.cms.gov/data-research/statistics-trends-and-reports/cost-reports/cost-reports-fiscal-year
```
- Download SNF-2010 zipped files per fiscal year
- Contains: Rpt, Nmrc, Alphnmrc files
- Note: Requires parsing - cannot open in Excel

**Update Frequency:** Quarterly (18-month lag)
**File Size:** ~500MB per year (all SNFs)

---

### Loading Scripts

#### Step 1: Create Schema
```bash
docker exec -i 3ghcre-mysql mysql -u root -pdevpass atlas < docker/init/30_cms_quality_schema.sql
```

#### Step 2: Load Provider Info (Quality)
```sql
-- Place CSV in project root, then:
LOAD DATA INFILE '/data/NH_ProviderInfo_Jan2026.csv'
INTO TABLE cms_provider_info_staging
FIELDS TERMINATED BY ',' ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
SET file_date = '2026-01-01';

-- Transform to quality_ratings
INSERT INTO quality_ratings (
    property_master_id, rating_date, overall_rating, health_inspection_rating,
    staffing_rating, quality_measure_rating, rn_staffing_rating,
    special_focus_facility, abuse_icon, certified_beds, average_residents_per_day,
    total_weighted_health_survey_score, number_of_fines, total_fines_dollars,
    number_of_payment_denials, total_penalties
)
SELECT
    pm.id,
    s.file_date,
    s.overall_rating,
    s.health_inspection_rating,
    s.staffing_rating,
    s.qm_rating,
    s.rn_staffing_rating,
    CASE
        WHEN s.special_focus_facility LIKE '%SFF%' THEN 'SFF'
        WHEN s.special_focus_facility_candidate = 'Y' THEN 'SFF_Candidate'
        ELSE 'None'
    END,
    s.abuse_icon = 'Y',
    s.number_of_certified_beds,
    s.average_number_of_residents_per_day,
    s.total_weighted_health_survey_score,
    s.number_of_fines,
    s.total_amount_of_fines_in_dollars,
    s.number_of_payment_denials,
    s.total_number_of_penalties
FROM cms_provider_info_staging s
JOIN property_master pm ON pm.ccn = s.federal_provider_number
WHERE s.file_date = '2026-01-01'
ON DUPLICATE KEY UPDATE
    overall_rating = VALUES(overall_rating),
    health_inspection_rating = VALUES(health_inspection_rating);
```

#### Step 3: Load Staffing Data
```sql
-- Similar pattern - load staging then transform
-- Use file_date field to track period
```

---

### Phase 2: Financial Layer

### Phase 3: News Intelligence
```
Week 5-6:
├── Set up RSS monitoring (SNN, McKnights)
├── Create news_articles table
├── Entity extraction pipeline
├── Link articles to companies/principals
└── Alert system for deal announcements
```

### Phase 4: Real Estate Layer
```
Week 7-8:
├── HUD 232 mortgage data
├── Match to property_master
├── Financing intelligence views
└── Lender relationship mapping
```

---

## Schema Extensions (Proposed)

### Quality Tables
```sql
CREATE TABLE quality_ratings (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NOT NULL,
    rating_date DATE NOT NULL,
    overall_rating TINYINT,
    health_inspection_rating TINYINT,
    staffing_rating TINYINT,
    quality_rating TINYINT,
    sff_flag BOOLEAN DEFAULT FALSE,
    abuse_icon BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (property_master_id) REFERENCES property_master(id)
);

CREATE TABLE staffing_data (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NOT NULL,
    report_quarter DATE NOT NULL,
    rn_hours_per_day DECIMAL(5,2),
    total_nurse_hours_per_day DECIMAL(5,2),
    cna_hours_per_day DECIMAL(5,2),
    turnover_rate DECIMAL(5,2),
    weekend_staffing_flag BOOLEAN,
    FOREIGN KEY (property_master_id) REFERENCES property_master(id)
);
```

### Financial Tables
```sql
CREATE TABLE cost_reports (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NOT NULL,
    fiscal_year_end DATE NOT NULL,
    total_revenue DECIMAL(15,2),
    total_expenses DECIMAL(15,2),
    net_income DECIMAL(15,2),
    occupancy_rate DECIMAL(5,2),
    medicare_pct DECIMAL(5,2),
    medicaid_pct DECIMAL(5,2),
    private_pct DECIMAL(5,2),
    FOREIGN KEY (property_master_id) REFERENCES property_master(id)
);
```

### News Intelligence Tables
```sql
CREATE TABLE news_articles (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source VARCHAR(50), -- 'snn', 'mcknights', 'shn'
    published_date DATE,
    title VARCHAR(500),
    url VARCHAR(500),
    article_type ENUM('acquisition', 'closure', 'executive', 'regulatory', 'financing', 'other'),
    summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE news_entity_mentions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    news_article_id INT UNSIGNED NOT NULL,
    entity_type ENUM('company', 'principal', 'property'),
    entity_id INT UNSIGNED,
    entity_name VARCHAR(255),
    mention_type ENUM('buyer', 'seller', 'subject', 'mentioned'),
    FOREIGN KEY (news_article_id) REFERENCES news_articles(id)
);
```

### HUD Mortgage Tables
```sql
CREATE TABLE hud_mortgages (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED,
    fha_loan_number VARCHAR(20),
    original_principal DECIMAL(15,2),
    current_principal DECIMAL(15,2),
    interest_rate DECIMAL(5,3),
    origination_date DATE,
    maturity_date DATE,
    lender_name VARCHAR(255),
    loan_status VARCHAR(50),
    FOREIGN KEY (property_master_id) REFERENCES property_master(id)
);
```

---

## Data Quality Metrics

### Current Coverage

| Data Type | Coverage | Quality |
|-----------|----------|---------|
| Facility Master | 14,054 (100%) | High |
| Ownership (Entity) | 29,574 (100%) | High |
| Ownership (Company) | 10,489 | High |
| Ownership (Principal) | 54,714 (100%) | High |
| All Transactions | 29,365 | High |
| Medicaid Rates | 5,809 (41.3%) | Medium |
| Cost Report Certifiers | 14,242 (100%) | High |

### Target Coverage (Post-Enhancement)

| Data Type | Target | Value Add |
|-----------|--------|-----------|
| Quality Ratings | 100% | Distress identification |
| Staffing Data | 100% | Operational health |
| Cost Reports | 80%+ | Financial performance |
| News Intelligence | Real-time | Deal flow early warning |
| HUD Mortgages | ~2,000 | Financing intelligence |

---

## Appendix: Data Source URLs

| Source | URL |
|--------|-----|
| CMS Provider Data | https://data.cms.gov/provider-data/ |
| CMS Cost Reports | https://www.cms.gov/Research-Statistics-Data-and-Systems/Downloadable-Public-Use-Files/Cost-Reports |
| HUD 232 Data | https://www.hud.gov/program_offices/housing/mfh/hsgmftgdb |
| SEC EDGAR | https://www.sec.gov/cgi-bin/browse-edgar |
| OSHA Data | https://www.osha.gov/ords/imis/establishment.html |
| SkilledNursingNews | https://skillednursingnews.com |
| McKnight's LTC | https://www.mcknights.com |
| Senior Housing News | https://seniorhousingnews.com |

---

*Document created for Stan/Saneel technical discussion - January 2026*
