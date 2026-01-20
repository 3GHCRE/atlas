# Implementation Action List
**Aligned with Playbook & Deck - Phase I: Graph Foundation**

---

## PHASE 1A: Master Property Linking Table
**Goal:** Create single source of truth with 3 IDs

### Day 1-2: Master Linking Table
- [ ] Create `property_master` table with:
  - `ccn` (UNIQUE) - CMS Certification Number
  - `reapi_property_id` (UNIQUE) - REAPI Property ID  
  - `zoho_account_id` (UNIQUE) - Zoho Account/Property Record ID
  - All three IDs required for master table

- [ ] Load from CMS (primary source):
  - Insert CCN + facility name + address from `cms_facilities_monthly`
  - Expected: ~15,000 rows

- [ ] Link REAPI IDs:
  - JOIN via `reapi_nursing_homes.ccn = property_master.ccn`
  - Update `reapi_property_id` field
  - Expected: ~90% coverage (13,500+)

- [ ] Link Zoho IDs:
  - Map Zoho Account ID to CCN (manual mapping table initially)
  - Update `zoho_account_id` field
  - **Note:** Zoho Account ID will link to other Zoho related modules (Companies, Contacts)

- [ ] Calculate `data_quality_score`:
  - Formula: (has_ccn ? 0.33 : 0) + (has_reapi ? 0.33 : 0) + (has_zoho ? 0.34 : 0)
  - Target: avg score 0.85+

**Deliverable:** Master table with 15K facilities, 90%+ have all 3 IDs

---

## PHASE 1B: CMS Company Layer (Operator - Opco)
**Goal:** Build operator portfolio structure from CMS data

### Day 3-4: CMS Opco Company Structure
**Flow:** Property → Entity (Opco) → Company → Role → Principal

- [ ] Create `companies` table:
  - `company_type` ENUM including `opco`
  - `cms_affiliated_entity_id` (links to CMS)
  - `cms_affiliated_entity_name`

- [ ] Create `property_company_relationships` junction:
  - **CRITICAL FIELD:** `relationship_type` = `facility_operator`
  - Links: `property_master` ↔ `companies`
  - `data_source` = `cms`

- [ ] Load CMS companies (Opco):
  - Extract from `cms_provider_information.affiliated_entity_id`
  - Insert into `companies` with `company_type = 'opco'`
  - Expected: ~2,000-3,000 opco companies

- [ ] Link facilities to opco companies:
  - Join via `cms_provider_information.ccn` → `property_master.ccn`
  - Join via `cms_provider_information.affiliated_entity_id` → `companies.cms_affiliated_entity_id`
  - Insert into `property_company_relationships` with `relationship_type = 'facility_operator'`

- [ ] Create `principals` table:
  - `normalized_full_name` (UPPERCASE, standardized for matching)
  - `zoho_contact_id` (for CRM linkage later)

- [ ] Create `principal_company_relationships` junction:
  - **CRITICAL FIELD:** `role` (ceo, president, cfo, owner_direct, etc.)
  - Links: `principals` ↔ `companies`
  - `data_source` = `cms`

- [ ] Load CMS principals:
  - Extract from `snf_all_owners` (type_owner = 'I' for Individuals)
  - Normalize names: UPPERCASE(TRIM(CONCAT(first_name, ' ', last_name)))
  - Insert into `principals` table

- [ ] Link principals to opco companies:
  - Match via `cms_provider_information.affiliated_entity_id`
  - Map CMS role codes to our `role` enum:
    - 34 → `owner_direct`
    - 35 → `owner_indirect`
    - 40 → `officer`
    - 43 → `board_member`
  - Insert into `principal_company_relationships`

**Deliverable:** Complete operator portfolio: Property → Opco Company → Principals (with roles)

---

## PHASE 1C: Principal Normalization (CRITICAL - BEFORE Ownership)
**Goal:** Normalize principal names & addresses for matching

### Day 5: Normalization Layer
**REQUIRED BEFORE PROCEEDING TO REAPI/CRM OWNERSHIP**

- [ ] Standardize principal names:
  - Create `normalized_full_name` field (UPPERCASE, remove punctuation, handle common variations)
  - Example: "John Smith" = "JOHN SMITH" = "J. SMITH" = "JOHN A. SMITH"

- [ ] Standardize addresses:
  - Create address normalization function:
    - Uppercase all
    - Standardize street suffixes (St, Ave, Rd, etc.)
    - Normalize city names (remove periods, standardize abbreviations)
    - Standardize state codes (always 2-letter uppercase)
    - Normalize ZIP codes (handle +4, remove dashes)

- [ ] Create principal matching table:
  - `principal_matches` table to track potential duplicates
  - Store: `principal_id_1`, `principal_id_2`, `match_confidence`, `match_type` (name, address, both)

- [ ] Run normalization on existing CMS principals:
  - Apply normalization functions
  - Flag potential duplicates for manual review
  - Target: Identify ~60% overlap expected (per 60% rule)

**Deliverable:** Normalized principal database ready for REAPI/CRM matching

---

## PHASE 1D: Ownership Layer (Propco - REAPI + CRM)
**Goal:** Add property ownership structure AFTER normalization

### Day 6-7: REAPI Propco Companies (Ownership)
**Flow:** Property → Entity (Propco) → Company → Role → Principal

- [ ] Load REAPI owners as propco companies:
  - Extract from `reapi_owner_info.owner1_full`
  - Insert into `companies` with `company_type = 'propco'`
  - Include REAPI owner address data

- [ ] Link properties to propco companies:
  - Join via `reapi_properties.property_id` → `property_master.reapi_property_id`
  - Insert into `property_company_relationships` with:
    - `relationship_type = 'property_owner'` ⭐ KEY FIELD
    - `data_source = 'reapi'`

- [ ] Match REAPI principals to normalized principals:
  - **USE NORMALIZED ADDRESSES** from Phase 1C
  - Match REAPI owner address → CMS principal address (normalized)
  - When match found: Link REAPI propco company to existing principal
  - When no match: Create new principal from REAPI data

- [ ] Link principals to propco companies:
  - Insert into `principal_company_relationships` with:
    - `role = 'owner_direct'` (inferred from property ownership)
    - `data_source = 'reapi'`

**Deliverable:** Complete ownership network: Property → Propco Company → Principals

### Day 8: CRM Integration (Ownership Enrichment)
**Goal:** Enrich ownership data from Zoho CRM

- [ ] Map Zoho Companies module to `companies`:
  - Sync `zoho_company_id` field
  - Update existing companies or create new ones

- [ ] Map Zoho Contacts/Principals to `principals`:
  - Match via `zoho_contact_id`
  - Enrich with CRM contact data (email, phone, LinkedIn)

- [ ] Link CRM relationships:
  - Load `CompanyxProperty` junction records (Zoho)
  - Map to `property_company_relationships`
  - Load `CompanyxPrincipal` junction records (Zoho)
  - Map to `principal_company_relationships`
  - `data_source = 'zoho'`

**Deliverable:** Complete graph: CMS (Opco) + REAPI (Propco) + CRM (Enrichment)

---

## Validation Queries

### Master Linking Table
```sql
SELECT COUNT(*) as total, 
       COUNT(DISTINCT ccn) as with_ccn,
       COUNT(DISTINCT reapi_property_id) as with_reapi,
       COUNT(DISTINCT zoho_account_id) as with_zoho,
       AVG(data_quality_score) as avg_quality
FROM property_master;
```

### CMS Operator Structure
```sql
-- Property → Opco → Principal chain
SELECT pm.facility_name, c.company_name, p.full_name, prc.role
FROM property_master pm
JOIN property_company_relationships pcr ON pcr.property_master_id = pm.id
  AND pcr.relationship_type = 'facility_operator'
JOIN companies c ON c.id = pcr.company_id
JOIN principal_company_relationships prc ON prc.company_id = c.id
JOIN principals p ON p.id = prc.principal_id
WHERE pm.ccn = '105678';
```

### Ownership Structure  
```sql
-- Property → Propco → Principal chain
SELECT pm.facility_name, c.company_name, p.full_name, prc.role
FROM property_master pm
JOIN property_company_relationships pcr ON pcr.property_master_id = pm.id
  AND pcr.relationship_type = 'property_owner'
JOIN companies c ON c.id = pcr.company_id
JOIN principal_company_relationships prc ON prc.company_id = c.id
JOIN principals p ON p.id = prc.principal_id
WHERE pm.ccn = '105678';
```

### The 60% Rule Validation
```sql
-- Find principals in both Opco and Propco (address match)
SELECT p.full_name, p.normalized_full_name,
       COUNT(DISTINCT CASE WHEN c.company_type = 'opco' THEN c.id END) as opco_count,
       COUNT(DISTINCT CASE WHEN c.company_type = 'propco' THEN c.id END) as propco_count
FROM principals p
JOIN principal_company_relationships prc ON prc.principal_id = p.id
JOIN companies c ON c.id = prc.company_id
GROUP BY p.id
HAVING opco_count > 0 AND propco_count > 0;
```

---

## Key Principles

1. **Master Table First:** CCN + REAPI ID + Zoho ID = Rosetta Stone
2. **CMS Operator Layer First:** Build from what we have (CMS data)
3. **Normalization Before Ownership:** Must normalize principals before REAPI/CRM matching
4. **Ownership Layer Second:** REAPI + CRM enrich ownership after normalization
5. **The Critical Field:** `relationship_type` in `property_company_relationships` enables one property → many companies
6. **Data Source Tracking:** Every relationship tracks origin (`cms`, `reapi`, `zoho`, `manual`)

---

**Status:** Ready for alignment check ✅
