# CMS Skilled Nursing Facility Data Dictionary
## Critical Metadata for Opco/Affiliated Entity → Company → Principal Graph

---

## Executive Summary

**CMS provides 3 core datasets for building your ownership graph:**

1. **Provider Information** (facility-level) - Links CCN to affiliated entities and organization details
2. **SNF All Owners** (ownership records) - Individual and organizational owners with roles and percentages  
3. **Change of Ownership** (transaction history) - Historical ownership transfers since 2016

**Key Insight:** CMS's "Affiliated Entity" is essentially their pre-computed company/portfolio layer. It groups facilities that share common owners, officers, or operational control. This is your starting point for the Opco/Company layer.

---

## 1. PROVIDER INFORMATION FILE (Facility Master)

**Purpose:** Master facility record linking CCN to affiliated entities and basic enrollment data

### Critical Fields for Graph Building

| Field Name | Description | Graph Use |
|------------|-------------|-----------|
| **CCN** | CMS Certification Number (6-digit) | Primary key for facility node |
| **ENROLLMENT_ID** | Unique enrollment identifier | Links to ownership records |
| **ASSOCIATE_ID** | Tax ID proxy (CMS-assigned unique ID for TIN) | Groups multiple facilities under same legal entity |
| **ORGANIZATION_NAME** | Legal business name of the provider | Facility legal entity name |
| **DOING_BUSINESS_AS_NAME** | DBA name if different | Alternate facility name |
| **NPI** | National Provider Identifier (10-digit) | Alternate facility identifier |
| **AFFILIATED_ENTITY_NAME** | CMS-computed chain/portfolio name | **THIS IS YOUR OPCO/COMPANY NAME** |
| **AFFILIATED_ENTITY_ID** | Numeric ID for affiliated entity | **THIS IS YOUR COMPANY ID** |
| **ADDRESS** fields | Facility physical address | Location data |
| **STATE** | State code (2-digit or alphanumeric) | Geographic filtering |

### How Affiliated Entities Work

**CMS Definition:** "Groups of nursing homes sharing at least one individual or organizational owner, officer, or entity with operational/managerial control"

**CMS Algorithm:** Uses network analysis to cluster facilities that share:
1. Direct or indirect owners (5%+ ownership)
2. Officers or board members (if no owners reported)
3. Managing entities

**Coverage:** ~67% of SNFs are assigned to affiliated entities. The remaining 33% are standalone facilities with no common ownership detected.

**Important Notes:**
- Multiple CCNs can have the same ASSOCIATE_ID (same legal entity operating multiple facilities)
- 82.4% of SNFs have unique ASSOCIATE_IDs (single facility per legal entity)
- 8.3% have 2-10 facilities per ASSOCIATE_ID
- 9.3% have 10+ facilities per ASSOCIATE_ID

---

## 2. SNF ALL OWNERS FILE (Ownership Records)

**Purpose:** Detailed ownership records for all current SNF owners (individuals and organizations)

### File Structure

This is a **many-to-many junction table** linking facilities to owners with role metadata.

```
ENROLLMENT_ID (facility) → ASSOCIATE_ID_OWNER (owner) → ROLE + PERCENTAGE
```

### Complete Field List (40 Fields)

#### Facility Linkage
| Field | Description | Use |
|-------|-------------|-----|
| **ENROLLMENT_ID** | Facility enrollment ID | Links to Provider Info |
| **ASSOCIATE_ID** | Facility's Associate ID | Groups facilities by legal entity |
| **ORGANIZATION_NAME** | Facility organization name | Facility context |

#### Owner Identity (Individual)
| Field | Description | Use |
|-------|-------------|-----|
| **ASSOCIATE_ID_OWNER** | Unique owner identifier | **Owner node ID** |
| **TYPE_OWNER** | "I" = Individual, "O" = Organization | Determines node type |
| **FIRST_NAME_OWNER** | Individual first name | Principal name |
| **MIDDLE_NAME_OWNER** | Individual middle name | Principal name |
| **LAST_NAME_OWNER** | Individual last name | **Principal name** |
| **TITLE_OWNER** | Job title (CEO, President, etc.) | **Principal role** |

#### Owner Identity (Organizational)
| Field | Description | Use |
|-------|-------------|-----|
| **ORGANIZATION_NAME_OWNER** | Legal business name | **Company/entity name** |
| **DOING_BUSINESS_AS_NAME_OWNER** | DBA name | Alternate company name |

#### Owner Address
| Field | Description | Use |
|-------|-------------|-----|
| **ADDRESS_LINE_1_OWNER** | Street address | **Critical for entity matching** |
| **ADDRESS_LINE_2_OWNER** | Suite/unit | Address detail |
| **CITY_OWNER** | City | Location |
| **STATE_OWNER** | State | Location |
| **ZIP_CODE_OWNER** | ZIP code | Location |

#### Ownership Relationship
| Field | Description | Use |
|-------|-------------|-----|
| **ROLE_CODE_OWNER** | Numeric role code | Relationship type |
| **ROLE_TEXT_OWNER** | Role description | **Relationship label** |
| **PERCENTAGE_OWNERSHIP** | Ownership percentage (0-100) | **Ownership stake** |
| **ASSOCIATION_DATE_OWNER** | Date became owner | **Temporal tracking** |

#### Role Codes (Critical for Graph Edges)

| Code | Role Text | Graph Meaning |
|------|-----------|---------------|
| 34 | 5% OR GREATER DIRECT OWNERSHIP INTEREST | Direct owner edge |
| 35 | 5% OR GREATER INDIRECT OWNERSHIP INTEREST | Indirect owner edge (subsidiary) |
| 40 | CORPORATE OFFICER | Officer/management edge |
| 41 | MANAGING EMPLOYEE | Operational control |
| 42 | PARTNER | Partnership stake |
| 43 | DIRECTOR | Board member |
| 44 | MEMBER | LLC member |
| 45 | MANAGER | LLC manager |

#### Entity Type Flags (Boolean)
| Field | Description |
|-------|-------------|
| **CORPORATION_OWNER** | Y/N - Is corporation |
| **LLC_OWNER** | Y/N - Is LLC |
| **MEDICAL_PROVIDER_SUPPLIER_OWNER** | Y/N - Healthcare entity |
| **MANAGEMENT_SERVICES_COMPANY_OWNER** | Y/N - MSO |
| **MEDICAL_STAFFING_COMPANY_OWNER** | Y/N - Staffing company |
| **HOLDING_COMPANY_OWNER** | Y/N - **Holding company** |
| **INVESTMENT_FIRM_OWNER** | Y/N - Investment entity |
| **FINANCIAL_INSTITUTION_OWNER** | Y/N - Bank/lender |
| **CONSULTING_FIRM_OWNER** | Y/N - Consultant |
| **FOR_PROFIT_OWNER** | Y/N - For-profit entity |
| **NON_PROFIT_OWNER** | Y/N - Non-profit entity |
| **PRIVATE_EQUITY_COMPANY_OWNER** | Y/N - **PE firm** |
| **REIT_OWNER** | Y/N - **REIT** |
| **CHAIN_HOME_OFFICE_OWNER** | Y/N - **Corporate headquarters** |
| **TRUST_OR_TRUSTEE_OWNER** | Y/N - Trust entity |
| **OTHER_TYPE_OWNER** | Y/N - Other |

#### Parent Company Tracking
| Field | Description | Use |
|-------|-------------|-----|
| **PARENT_COMPANY_OWNER** | Y/N - Is parent company | **Identifies parent companies** |
| **OWNED_BY_ANOTHER_ORG_OR_IND_OWNER** | Y/N - Has upstream owner | **Identifies subsidiaries** |
| **CREATED_FOR_ACQUISITION_OWNER** | Y/N - Acquisition vehicle | Special purpose entity flag |

---

## 3. CHANGE OF OWNERSHIP FILE (Transaction History)

**Purpose:** Historical ownership transfers since January 1, 2016

### File Structure

Three related files:
1. **SNF_CHOW** - Transaction master (buyer/seller pairs)
2. **SNF_CHOW_OWNERS** - Owner records for buyers/sellers
3. **SNF_CHOW_NPIS** - NPI records

### Critical Fields

| Field | Description | Use |
|-------|-------------|-----|
| **CCN** | Facility certification number | Property being sold |
| **EFFECTIVE_DATE** | Transaction date | **Temporal tracking** |
| **ENROLLMENT_ID_BUYER** | Buyer enrollment ID | New owner |
| **ENROLLMENT_ID_SELLER** | Seller enrollment ID | Previous owner |
| **ORGANIZATION_NAME_BUYER** | Buyer entity name | New owner entity |
| **ORGANIZATION_NAME_SELLER** | Seller entity name | Previous owner entity |
| **PAC_ID_BUYER** | Buyer PAC ID (PECOS Associate Control ID) | Ultimate buyer identifier |
| **PAC_ID_SELLER** | Seller PAC ID | Ultimate seller identifier |

---

## 4. KEY IDENTIFIER CROSSWALK

Understanding how CMS identifiers link together:

```
FACILITY LEVEL:
┌─────────────────────────────────────────────────────────┐
│ CCN (Certification #) - 6 digits                        │
│   ├─> Primary facility identifier                       │
│   ├─> Format: [STATE][TYPE][SEQUENCE]                  │
│   └─> Example: 015432 (CA skilled nursing)             │
│                                                          │
│ NPI (National Provider #) - 10 digits                   │
│   ├─> Alternate facility identifier                     │
│   └─> Links to NPPES system                            │
│                                                          │
│ ENROLLMENT_ID                                           │
│   ├─> CMS-assigned enrollment identifier               │
│   └─> Links to ownership records                       │
│                                                          │
│ ASSOCIATE_ID                                            │
│   ├─> Proxy for Tax ID (TIN)                          │
│   ├─> Groups facilities under same legal entity        │
│   └─> 82% are unique (1 facility per entity)          │
└─────────────────────────────────────────────────────────┘

OWNERSHIP LEVEL:
┌─────────────────────────────────────────────────────────┐
│ ASSOCIATE_ID_OWNER                                      │
│   ├─> Unique owner identifier                          │
│   ├─> Can be individual OR organization                │
│   └─> Same owner ID appears across multiple facilities │
│                                                          │
│ PAC_ID (PECOS Associate Control ID)                    │
│   ├─> Ultimate organizational identifier               │
│   └─> Used in Change of Ownership tracking            │
└─────────────────────────────────────────────────────────┘

COMPANY/PORTFOLIO LEVEL:
┌─────────────────────────────────────────────────────────┐
│ AFFILIATED_ENTITY_ID                                    │
│   ├─> CMS-computed chain/portfolio ID                 │
│   ├─> Numeric identifier                               │
│   └─> Groups facilities with common ownership          │
│                                                          │
│ AFFILIATED_ENTITY_NAME                                  │
│   ├─> Human-readable chain/portfolio name             │
│   └─> Example: "Centers Health Care"                   │
└─────────────────────────────────────────────────────────┘
```

---

## 5. DATA QUALITY NOTES & LIMITATIONS

### Self-Reported Data
- All ownership data comes from Form CMS-855A (Medicare enrollment application)
- PECOS is considered "System of Record" but is **self-reported and unaudited**
- Limited validation opportunities

### Ownership Thresholds
- Only owners with **5%+ ownership** must be reported
- Smaller stakeholders may be invisible in the data

### Affiliated Entity Accuracy
- CMS network analysis is algorithmic, not manually verified
- Some facilities may be incorrectly grouped or missed
- Contact: NH_Affiliation_Inquiries@cms.hhs.gov for corrections

### Data Freshness
- Provider data updated as facilities submit enrollment changes
- Ownership data updated quarterly
- Some lag between real-world changes and data updates

### Coverage Gaps
- 33% of facilities have NO affiliated entity assignment
- These are likely standalone/independent facilities
- OR they failed to report shared ownership properly

---

## 6. CRITICAL FIELDS FOR YOUR PHASE I BUILD

### For Building `cms_companies` Table

**Primary Source:** Provider Information file

```sql
INSERT INTO cms_companies (
    affiliated_entity_id,
    affiliated_entity_name,
    entity_type,
    facility_count
)
SELECT 
    AFFILIATED_ENTITY_ID,
    AFFILIATED_ENTITY_NAME,
    'AFFILIATED_ENTITY' as entity_type,
    COUNT(DISTINCT CCN) as facility_count
FROM provider_information
WHERE AFFILIATED_ENTITY_ID IS NOT NULL
GROUP BY AFFILIATED_ENTITY_ID, AFFILIATED_ENTITY_NAME;
```

### For Building `cms_company_facilities` Junction Table

**Links:** Facilities → CMS Companies

```sql
INSERT INTO cms_company_facilities (
    cms_company_id,
    property_master_id,
    ccn,
    facility_legal_name,
    associate_id
)
SELECT 
    cc.id as cms_company_id,
    pm.id as property_master_id,
    pi.CCN,
    pi.ORGANIZATION_NAME,
    pi.ASSOCIATE_ID
FROM provider_information pi
JOIN cms_companies cc ON cc.affiliated_entity_id = pi.AFFILIATED_ENTITY_ID
JOIN property_master pm ON pm.ccn = pi.CCN;
```

### For Building `cms_owners` Staging Table

**Source:** SNF All Owners file

**Filter for individuals only (TYPE_OWNER = 'I'):**

```sql
INSERT INTO cms_owners (
    associate_id_owner,
    first_name,
    last_name,
    full_name,
    normalized_full_name,
    title,
    role_code,
    role_text,
    enrollment_id,
    ccn
)
SELECT 
    ASSOCIATE_ID_OWNER,
    FIRST_NAME_OWNER,
    LAST_NAME_OWNER,
    CONCAT_WS(' ', FIRST_NAME_OWNER, LAST_NAME_OWNER) as full_name,
    UPPER(TRIM(CONCAT_WS(' ', FIRST_NAME_OWNER, LAST_NAME_OWNER))) as normalized_full_name,
    TITLE_OWNER,
    ROLE_CODE_OWNER,
    ROLE_TEXT_OWNER,
    ENROLLMENT_ID,
    (SELECT CCN FROM provider_information WHERE ENROLLMENT_ID = so.ENROLLMENT_ID) as ccn
FROM snf_all_owners so
WHERE TYPE_OWNER = 'I'  -- Individuals only
AND ROLE_CODE_OWNER IN (34, 35, 40, 41, 42, 43, 44, 45);  -- Ownership/control roles
```

### For Matching Principals → CMS Owners → Companies

**Three-hop join:**

```sql
-- Match CRM Principals to CMS Owners to CMS Companies
SELECT 
    zp.zoho_contact_id,
    zp.full_name as zoho_name,
    co.associate_id_owner,
    co.full_name as cms_owner_name,
    co.title as cms_title,
    cc.affiliated_entity_name as company_name,
    cc.id as cms_company_id,
    CASE 
        WHEN zp.normalized_full_name = co.normalized_full_name THEN 1.00
        ELSE jaro_winkler(zp.normalized_full_name, co.normalized_full_name)
    END as name_match_confidence
FROM zoho_principals zp
JOIN zoho_accounts za ON za.zoho_account_id = zp.zoho_account_id
JOIN property_master pm ON pm.zoho_account_id = za.zoho_account_id
JOIN cms_owners co ON co.ccn = pm.ccn
JOIN cms_company_facilities ccf ON ccf.ccn = pm.ccn
JOIN cms_companies cc ON cc.id = ccf.cms_company_id
WHERE zp.normalized_full_name = co.normalized_full_name  -- Exact match
   OR jaro_winkler(zp.normalized_full_name, co.normalized_full_name) > 0.90  -- Fuzzy match
ORDER BY name_match_confidence DESC;
```

---

## 7. 60% RULE: CMS Owners Are Also REAPI Property Owners

**Malcolm's Insight:** "60% of CMS contacts are also RE Owners"

**Implication:** Many principals in CMS ownership data will ALSO appear in REAPI property ownership data.

**Strategy for Phase II (REAPI/Propco layer):**
1. Extract CMS owner addresses: `ADDRESS_LINE_1_OWNER, CITY_OWNER, STATE_OWNER, ZIP_CODE_OWNER`
2. Standardize addresses using USPS rules
3. Match against REAPI owner addresses: `OwnerAddress` field
4. When same address appears in both:
   - Create single Principal node
   - Link to BOTH CMS company (Opco) AND REAPI company (Propco)
   - This reveals OpCo/PropCo structures automatically

**Example:**
```
Principal: John Smith
├─ CMS Owner Address: 980 Sylvan Ave, Englewood Cliffs, NJ 07632
└─ REAPI Owner Address: 980 Sylvan Ave, Englewd Clfs, NJ 07632  [same after standardization]

Result:
John Smith (Principal)
  ├─> Portopicolo Group (CMS Affiliated Entity / Opco)
  │    └─> Coosa Valley Healthcare Center LLC (Facility)
  └─> Panama City FL Propco LLC (REAPI Property Owner / Propco)
       └─> Various real estate holdings
```

---

## 8. RECOMMENDED DATA LOAD SEQUENCE

**Week 1, Days 4-5: CMS Company Layer**

1. **Load Provider Information** → Identify all facilities and their affiliated entities
2. **Create `cms_companies` table** → One row per unique `AFFILIATED_ENTITY_ID`
3. **Link facilities to companies** → `cms_company_facilities` junction table
4. **Load SNF All Owners** → All ownership records (both individuals and orgs)
5. **Filter for individual owners** → Create `cms_owners` staging table
6. **Match principals to owners** → Join Zoho → CMS Owners → CMS Companies
7. **Create `principal_cms_company` junction** → Store matched relationships

---

## 9. CRITICAL QUESTIONS ANSWERED

### Q: What is an "Affiliated Entity" exactly?
**A:** CMS's algorithmic grouping of facilities that share common owners, officers, or operational control. It's essentially CMS's version of a "chain" or "portfolio." This becomes your **Opco/Company layer**.

### Q: How do I link CCN to ownership records?
**A:** 
1. Provider Information: `CCN → ENROLLMENT_ID`
2. SNF All Owners: `ENROLLMENT_ID → ASSOCIATE_ID_OWNER` (with role/percentage)

### Q: How do I know if an owner is an individual vs organization?
**A:** `TYPE_OWNER` field: "I" = Individual, "O" = Organization

### Q: How do I distinguish operating companies from holding companies?
**A:** Check boolean flags in SNF All Owners:
- `HOLDING_COMPANY_OWNER = Y` → Holding company
- `CHAIN_HOME_OFFICE_OWNER = Y` → Corporate HQ
- `PARENT_COMPANY_OWNER = Y` → Parent company

### Q: How do I build ownership hierarchies?
**A:** Look for owners where:
- `OWNED_BY_ANOTHER_ORG_OR_IND_OWNER = Y` → This entity has upstream owners
- Then search for those upstream owners in the dataset

### Q: What if a facility has NO affiliated entity?
**A:** ~33% of facilities are standalone. These are:
1. True independent facilities with no chain affiliation
2. OR facilities that didn't properly report shared ownership
3. For Phase I, treat these as separate companies (1 facility = 1 company)

---

## 10. NEXT STEPS FOR IMPLEMENTATION

### Immediate Actions (Day 4-5 of Sprint)

1. **Download CMS datasets:**
   - Provider Information: https://data.cms.gov/provider-data/dataset/4pq5-n9py
   - SNF All Owners: https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/skilled-nursing-facility-all-owners

2. **Create staging tables** in MySQL matching the schemas above

3. **Load data via CSV import** (files are updated monthly by CMS)

4. **Run validation queries:**
   - Count distinct CCNs (should be ~15,000)
   - Count affiliated entities (should be ~2,000-3,000)
   - Count individual owners vs organizational owners
   - Verify CCN → Enrollment ID → Associate ID linkages

5. **Build company layer** using `AFFILIATED_ENTITY_ID` as primary key

6. **Extract principals** from individual owners (TYPE_OWNER = 'I')

7. **Match principals** to Zoho CRM contacts using normalized names

---

## APPENDIX: Data Sources & Updates

**CMS Data Portal:** https://data.cms.gov/provider-data

**Update Frequency:**
- Provider Information: Monthly
- SNF All Owners: Quarterly
- Change of Ownership: Monthly

**Data Dictionaries:**
- SNF All Owners: https://data.cms.gov/sites/default/files/2024-11/40f49c9e-6bb9-4755-abe9-9c35a7dff6b9/SNF_All_Owners_Data_Dictionary.pdf
- Nursing Home Data: https://data.cms.gov/provider-data/sites/default/files/data_dictionaries/nursing_home/NH_Data_Dictionary.pdf

**CMS Contact for Data Issues:**
- Email: NH_Affiliation_Inquiries@cms.hhs.gov
