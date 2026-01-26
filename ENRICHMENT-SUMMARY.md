# Atlas Ownership Network Enrichment - Technical Summary

**Date:** January 25, 2026
**Purpose:** Document the complete process of enriching property → entity → company → principal linkages in the Atlas SNF ownership database.

---

## The Problem We Solved

### Initial State
The Atlas database had **14,054 SNF properties** but limited ability to answer: *"Who actually owns and controls this facility?"*

**Gaps identified:**
- Properties linked to entities, but entities often orphaned from parent companies
- Companies existed but lacked principal (people) linkages
- Duplicate records inflated property counts (e.g., one person showing 904 properties instead of 204)
- Management relationships incorrectly treated as ownership
- No distinction between PropCo (owns real estate) vs OpCo (operates facility)
- Nonprofit and government entities had no leadership data

### Why This Matters
Without accurate ownership chains, you cannot:
- Identify who controls a portfolio of facilities
- Track acquisitions and divestitures
- Understand competitive dynamics between operators
- Assess counterparty risk for lenders
- Navigate from one property to discover related holdings

---

## The 4-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  PROPERTY (14,054)                                                   │
│  - SNF facility identified by CCN (CMS Certification Number)        │
│  - Has physical address, bed count, quality ratings                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ property_entity_relationships
                                │ (relationship_type: property_owner, facility_operator, lender)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ENTITY (29,508)                                                     │
│  - Legal entity (LLC, Corp, LP, Trust)                              │
│  - Has entity_type: opco, propco, lender, buyer, seller, borrower   │
│  - Example: "SUNRISE SNF LLC" or "ABC HOLDINGS LP"                  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ company_id (FK)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COMPANY (9,749)                                                     │
│  - Consolidated ownership/operating group                           │
│  - Has company_type: owner_operator, ownership, operating, lending  │
│  - Example: "ENSIGN GROUP" or "OMEGA HEALTHCARE INVESTORS"          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ principal_company_relationships
                                │ (role, ownership_percentage, data_source)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PRINCIPAL (47,386)                                                  │
│  - Individual person (owner, officer, director, manager)            │
│  - Has title, location, notes with background                       │
│  - Example: "Samuel Stern" or "Kenneth Rozenberg"                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1-3: Core Network Bridges (14 principals)

### Objective
Establish foundational connections between major SNF networks and clean inflated data.

### Process

#### Step 1: Identify Inflated Property Counts
We ran queries to find principals with suspiciously high property counts:

```sql
SELECT p.id, p.full_name, COUNT(DISTINCT pm.id) as property_count
FROM principals p
JOIN principal_company_relationships pcr ON p.id = pcr.principal_id
JOIN companies c ON pcr.company_id = c.id
JOIN entities e ON e.company_id = c.id
JOIN property_entity_relationships per ON e.id = per.entity_id
JOIN property_master pm ON per.property_id = pm.id
GROUP BY p.id
ORDER BY property_count DESC
LIMIT 20;
```

**Finding:** Lou Scheiner showed 904 properties, Shai Berdugo showed 636 properties - both impossibly high for individual investors.

#### Step 2: Diagnose the Problem
Investigation revealed these principals were linked to **operating companies that managed their buildings**, not just companies they owned.

Example: Lou Scheiner owns properties operated by Ensign, Nexion, Creative Solutions. The system incorrectly linked him to ALL properties those operators manage.

```
INCORRECT:
Scheiner → Ensign (operator of his buildings) → ALL 239 Ensign properties

CORRECT:
Scheiner → Scheiner's PropCos → Only his 204 properties
```

#### Step 3: Clean the Relationships
Created scripts to identify and remove incorrect relationships:

```javascript
// scripts/fix-scheiner-relationships.js
const OPERATORS_TO_REMOVE = [
  'THE ENSIGN GROUP',
  'NEXION HEALTH',
  'CREATIVE SOLUTIONS IN HEALTHCARE',
  // ... 12 total operators
];

for (const operatorName of OPERATORS_TO_REMOVE) {
  await conn.execute(`
    UPDATE principal_company_relationships
    SET end_date = CURDATE(),
        notes = CONCAT(IFNULL(notes, ''), ' [Removed: operator relationship, not ownership]')
    WHERE principal_id = ?
    AND company_id = (SELECT id FROM companies WHERE company_name = ?)
  `, [scheinerId, operatorName]);
}
```

#### Results - Phase 1-3

| Principal | Before | After | Properties Removed | Reason |
|-----------|--------|-------|-------------------|--------|
| Lou Scheiner | 904 | 204 | 700 | Removed 12 operator relationships |
| Shai Berdugo | 636 | 28 | 608 | Removed 15 management relationships |
| Ari Silberstein | 796 | 48 | 748 | Removed 22 management relationships |

**Total data quality improvement:** 2,056 incorrect property linkages removed.

---

## Phase 4: Executive Team Enrichment (15 principals)

### Objective
Add leadership teams to major companies that had properties but no principals linked.

### Process

#### Step 1: Find Companies Missing Principals
```sql
SELECT c.id, c.company_name,
       COUNT(DISTINCT pm.id) as properties,
       COUNT(DISTINCT pcr.principal_id) as principals
FROM companies c
JOIN entities e ON e.company_id = c.id
JOIN property_entity_relationships per ON e.id = per.entity_id
JOIN property_master pm ON per.property_id = pm.id
LEFT JOIN principal_company_relationships pcr ON c.id = pcr.company_id
GROUP BY c.id
HAVING properties >= 50 AND principals = 0
ORDER BY properties DESC;
```

**Finding:** Major companies like Centers Health Care (105 properties), Portopiccolo Group (188 properties) had zero principals linked.

#### Step 2: Web Research for Leadership
For each company, we researched:
- Company website "About/Team" pages
- LinkedIn profiles of executives
- Skilled Nursing News articles
- SEC filings (if public)
- State licensure databases

Example research for **Portopiccolo Group**:
- Kentucky Lantern (2024): "Brooklyn businessmen Simcha Hyman and Naftali Zanziper"
- Skilled Nursing News (2019): Portfolio grew from 70 to 134 facilities
- Real Deal (2024): Healthcare Realty Trust sale transaction details

#### Step 3: Create/Update Principal Records
```javascript
// scripts/enrich-portopiccolo-executives.js

// Update existing principal with enriched data
await conn.execute(`
  UPDATE principals
  SET title = 'CEO',
      city = 'Brooklyn',
      state = 'NY',
      notes = 'Co-founded Portopiccolo Group in 2016. Started at age 25 after selling medical supply company. Portfolio grew from 70 (2020) to 134+ facilities (2024). 25 facilities in Kentucky alone.'
  WHERE id = 7334
`, []);

// Create new principal for discovered executive
const [result] = await conn.execute(`
  INSERT INTO principals (full_name, title, city, state, notes, data_source)
  VALUES ('Akiva Schonfeld', 'General Counsel', 'Brooklyn', 'NY',
          'Portopiccolo Group legal counsel. JD Brooklyn Law School. President & General Counsel at 980Investments.',
          'manual')
`);

// Link principal to company
await conn.execute(`
  INSERT INTO principal_company_relationships
  (principal_id, company_id, role, data_source)
  VALUES (?, 14607, 'officer', 'manual')
`, [result.insertId]);
```

#### Results - Phase 4

| Company | Properties | Principals Before | Principals After |
|---------|------------|-------------------|------------------|
| Centers Health Care | 105 | 0 | 7 |
| Portopiccolo Group | 188 | 2 | 9 |
| Cascade Capital Group | 152 | 3 | 11 |
| Venza Care Management | 20 | 1 | 4 |

**Ownership percentages documented:**
- Kenneth Rozenberg: Centers Health Care (Founder/CEO)
- Simcha Hyman: Portopiccolo (CEO, co-founder)
- Naftali Zanziper: Portopiccolo (President, co-founder)
- Menachem Shabat: Cascade Capital (Co-Founder, Managing Director)
- Chaim Rajchenbach: Cascade Capital (Co-Founder, Managing Partner)

---

## Phase 5: Major Network Enrichment (2 networks, 921 properties)

### Objective
Map complete ownership networks for major industry players with complex multi-company structures.

### Process

#### Moishe Gubin Network

**Step 1: Trace existing relationships**
```sql
SELECT c.company_name, pcr.role, pcr.ownership_percentage,
       COUNT(DISTINCT pm.id) as properties
FROM principals p
JOIN principal_company_relationships pcr ON p.id = pcr.principal_id
JOIN companies c ON pcr.company_id = c.id
JOIN entities e ON e.company_id = c.id
JOIN property_entity_relationships per ON e.id = per.entity_id
JOIN property_master pm ON per.property_id = pm.id
WHERE p.id = 32874  -- Moishe Gubin
GROUP BY c.id
ORDER BY properties DESC;
```

**Finding:** Gubin connected to 12 companies, 477 properties, but missing key relationships.

**Step 2: Research revealed additional holdings**
- Strawberry Fields REIT (NYSE: STRW) - CEO, ~140 facilities
- OptimumBank Holdings (NASDAQ: OPHC) - Chairman/Director
- Infinity Healthcare Management - Co-founded with Michael Blisko (2004)

**Step 3: Create missing entities and relationships**
```javascript
// Create Infinity Healthcare Management company
const [infinityResult] = await conn.execute(`
  INSERT INTO companies (company_name, company_type, city, state, notes)
  VALUES ('Infinity Healthcare Management, LLC', 'operating', 'South Bend', 'IN',
          'Co-founded by Moishe Gubin and Michael Blisko in 2004. Operated skilled nursing facilities until 2014.')
`);

// Link Gubin as co-founder
await conn.execute(`
  INSERT INTO principal_company_relationships
  (principal_id, company_id, role, ownership_percentage, start_date, end_date, data_source, notes)
  VALUES (32874, ?, 'owner', 50.00, '2004-01-01', '2014-12-31', 'manual',
          'Co-founder with Michael Blisko. CFO/Manager 2004-2014.')
`, [infinityResult.insertId]);
```

#### Ira Smedra (ARBA Group) Network

**Problem identified:** 3 duplicate records for same person
- ID 10461: "IRA SMEDRA" (canonical)
- ID 73322: "IRA SMEDRA Smedra" (bad parse)
- ID 75524: "IRA SMEDRA- MICHAEL TURNER" (combined names)

**Consolidation process:**
```javascript
// scripts/consolidate-ira-smedra.js

const CANONICAL_ID = 10461;
const DUPLICATE_IDS = [73322, 75524];

for (const dupId of DUPLICATE_IDS) {
  // Move all relationships to canonical record
  await conn.execute(`
    UPDATE principal_company_relationships
    SET principal_id = ?
    WHERE principal_id = ?
  `, [CANONICAL_ID, dupId]);

  // Mark duplicate as merged
  await conn.execute(`
    UPDATE principals
    SET full_name = CONCAT('[MERGED into ', ?, '] ', full_name),
        notes = CONCAT(IFNULL(notes, ''), ' Merged into canonical record ID ', ?)
    WHERE id = ?
  `, [CANONICAL_ID, CANONICAL_ID, dupId]);
}
```

**Created ARBA Group company:**
```javascript
await conn.execute(`
  INSERT INTO companies (company_name, company_type, city, state, notes)
  VALUES ('ARBA Group', 'owner_operator', 'Los Angeles', 'CA',
          'Family-owned Los Angeles-based real estate and nursing home company. Operating for nearly 40 years. Owns and operates 99 skilled nursing facilities across 7 states.')
`);
```

#### Results - Phase 5

| Network | Companies | Properties | Key Insight |
|---------|-----------|------------|-------------|
| Moishe Gubin | 12 | 477 | Strawberry Fields REIT CEO, OptimumBank Chairman |
| Ira Smedra | 13 | 444 | ARBA Group President, 40-year family business |
| **Combined** | **25** | **921** | Two major networks fully documented |

---

## Phase 6: Lahasky Network (18 companies, 186 properties)

### Objective
Document a major private investor who maintains low public profile.

### Process

#### Step 1: Consolidate Duplicates
Found 2 records for same person:
- ID 5647: "Ephram Lahasky" (canonical)
- ID 76417: "EPHRAM LAHASKY - MORDY" (nickname variant)

#### Step 2: Document CHMS Ownership Structure
Research revealed **Comprehensive Healthcare Management Services (CHMS)** is co-owned:

```javascript
// Create CHMS company
const [chmsResult] = await conn.execute(`
  INSERT INTO companies (company_name, company_type, city, state, notes)
  VALUES ('Comprehensive Healthcare Management Services', 'owner_operator', 'Lynbrook', 'NY',
          'CHMS manages nursing home operations. $35M DOL fine for payroll violations.')
`);

// Link three co-owners with exact percentages
const owners = [
  { id: 24838, name: 'Sam Halper', pct: 33.34, role: 'owner' },
  { id: 5647, name: 'Ephram Lahasky', pct: 33.33, role: 'owner' },
  { id: 27252, name: 'David Gast', pct: 33.33, role: 'owner' }
];

for (const owner of owners) {
  await conn.execute(`
    INSERT INTO principal_company_relationships
    (principal_id, company_id, role, ownership_percentage, data_source)
    VALUES (?, ?, ?, ?, 'manual')
  `, [owner.id, chmsResult.insertId, owner.role, owner.pct]);
}
```

#### Step 3: Document Acquisition Vehicles
```javascript
// DAC Acquisition LLC - used to acquire Diversicare
await conn.execute(`
  INSERT INTO companies (company_name, company_type, notes)
  VALUES ('DAC Acquisition LLC', 'ownership',
          'Acquisition vehicle used to acquire Diversicare Healthcare Services in 2021 for $70M ($10.10/share, 256% premium). 61 facilities, ~7,250 beds.')
`);

// MCS Plan - investment vehicle
await conn.execute(`
  INSERT INTO companies (company_name, company_type, notes)
  VALUES ('MCS Plan', 'ownership',
          'Investment vehicle. Controlled 5.2% of Diversicare stock prior to acquisition.')
`);
```

#### Results - Phase 6

| Metric | Value |
|--------|-------|
| Companies documented | 18 (15 active, 3 merged) |
| Properties linked | 186 |
| States covered | 24 |
| Ownership structure | CHMS three-way split documented |
| Acquisition history | Diversicare $70M deal documented |

---

## Phase 7: Nonprofit & Government Entity Enrichment

### Objective
Add leadership to nonprofit healthcare systems and government-owned facilities.

### Process

#### Step 1: Match Nonprofits to EINs via ProPublica
```javascript
// scripts/enrich-nonprofits-propublica.js

const { nonprofitSearch } = require('./lib/propublica-client');

for (const company of nonprofitCompanies) {
  const results = await nonprofitSearch(company.company_name, company.state);

  if (results.organizations && results.organizations.length > 0) {
    const org = results.organizations[0];

    await conn.execute(`
      UPDATE companies
      SET ein = ?,
          notes = CONCAT(IFNULL(notes, ''),
                         ' ProPublica: ', ?, ' Revenue: $', ?)
      WHERE id = ?
    `, [org.ein, org.name, org.income_amount, company.id]);
  }
}
```

**Result:** 61 nonprofits matched with EINs and revenue data.

#### Step 2: Add Nonprofit Leadership from 990 Forms
```javascript
// scripts/enrich-nonprofits-990-officers.js

const { nonprofitGet990 } = require('./lib/propublica-client');

for (const company of nonprofitsWithEin) {
  const filing = await nonprofitGet990(company.ein);

  if (filing.organization && filing.organization.officers) {
    for (const officer of filing.organization.officers) {
      // Create principal if not exists
      const [existing] = await conn.execute(
        'SELECT id FROM principals WHERE full_name = ?',
        [officer.name]
      );

      let principalId;
      if (existing.length === 0) {
        const [result] = await conn.execute(`
          INSERT INTO principals (full_name, title, data_source)
          VALUES (?, ?, '990_filing')
        `, [officer.name, officer.title]);
        principalId = result.insertId;
      } else {
        principalId = existing[0].id;
      }

      // Link to company
      await conn.execute(`
        INSERT INTO principal_company_relationships
        (principal_id, company_id, role, data_source)
        VALUES (?, ?, 'officer', '990_filing')
      `, [principalId, company.id]);
    }
  }
}
```

#### Step 3: CMS Cost Report Certifiers → Principals
CMS cost reports are certified by facility administrators/CFOs. We extracted these:

```javascript
// scripts/load-cms-certifiers-to-principals.js

// Query CMS cost report certifiers
const [certifiers] = await reapiConn.execute(`
  SELECT DISTINCT
    certifier_name,
    certifier_title,
    ccn
  FROM cms_cost_reports
  WHERE certifier_name IS NOT NULL
`);

for (const cert of certifiers) {
  // Find the company for this CCN
  const [company] = await atlasConn.execute(`
    SELECT c.id as company_id
    FROM property_master pm
    JOIN property_entity_relationships per ON pm.id = per.property_id
    JOIN entities e ON per.entity_id = e.id
    JOIN companies c ON e.company_id = c.id
    WHERE pm.ccn = ?
    AND per.relationship_type = 'facility_operator'
    LIMIT 1
  `, [cert.ccn]);

  if (company.length > 0) {
    // Create or find principal
    // Link to company
    // ...
  }
}
```

#### Step 4: Hospital District Web Research
For government-owned hospital districts, we manually researched leadership:

```javascript
// scripts/enrich-hospital-district-certifiers.js

const HOSPITAL_DISTRICT_LEADERSHIP = [
  { company_id: 14401, name: 'Ross Korkmas', title: 'CEO', city: 'Mineral Wells', state: 'TX' },
  { company_id: 14402, name: 'Stephen Bowerman', title: 'CEO', city: 'Midland', state: 'TX' },
  { company_id: 14403, name: 'Dr. Esmaeil Porsa', title: 'CEO', city: 'Houston', state: 'TX' },
  // ... 40+ more districts
];

for (const leader of HOSPITAL_DISTRICT_LEADERSHIP) {
  const [result] = await conn.execute(`
    INSERT INTO principals (full_name, title, city, state, data_source)
    VALUES (?, ?, ?, ?, 'web_research')
  `, [leader.name, leader.title, leader.city, leader.state]);

  await conn.execute(`
    INSERT INTO principal_company_relationships
    (principal_id, company_id, role, data_source)
    VALUES (?, ?, 'officer', 'web_research')
  `, [result.insertId, leader.company_id]);
}
```

#### Results - Phase 7

| Category | Before | After | Change |
|----------|--------|-------|--------|
| Companies with principals | 4,094 | 4,176 | **+82** |
| Nonprofits with EIN | 0 | 61 | **+61** |
| Nonprofits with principals | 11 | 34 | **+23** |
| Hospital districts with CEO | 0 | 44 | **+44** |
| State veterans boards | 0 | 7 | **+7** |
| Total relationships | 63,719 | 63,853 | **+134** |

---

## Entity-to-Company Principal Promotion

### Problem
Principals were sometimes linked at the **entity level** but not the **company level**:

```
Property → Entity (has principal) → Company (no principal)
```

This meant searching for company principals would miss them.

### Solution
```javascript
// scripts/link-entity-principals-to-company.js

// Find principals linked to entities but not their parent companies
const [orphanedPrincipals] = await conn.execute(`
  SELECT DISTINCT
    per.principal_id,
    e.company_id,
    per.role
  FROM principal_entity_relationships per
  JOIN entities e ON per.entity_id = e.id
  WHERE e.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM principal_company_relationships pcr
    WHERE pcr.principal_id = per.principal_id
    AND pcr.company_id = e.company_id
  )
`);

// Promote each relationship to company level
for (const rel of orphanedPrincipals) {
  await conn.execute(`
    INSERT INTO principal_company_relationships
    (principal_id, company_id, role, data_source, notes)
    VALUES (?, ?, ?, 'promoted', 'Promoted from entity-level relationship')
  `, [rel.principal_id, rel.company_id, rel.role]);
}
```

**Result:** 134+ principals promoted from entity-level to company-level relationships.

---

## MCP Tool Development

### Purpose
Enable natural language queries against the enriched database.

### Tools Created (41 total)

#### Record Tools (9) - Basic CRUD
```typescript
// Example: get_principal with merged record resolution
export async function execute(params: { id: number, include_merged?: boolean }) {
  // Check if this ID was merged into another
  const [merged] = await db.execute(`
    SELECT merged_into_id FROM principal_merges WHERE original_id = ?
  `, [params.id]);

  const actualId = merged.length > 0 ? merged[0].merged_into_id : params.id;

  // Fetch principal with all relationships
  const [principal] = await db.execute(`
    SELECT p.*,
           GROUP_CONCAT(DISTINCT pcr.role) as roles,
           COUNT(DISTINCT pm.id) as property_count
    FROM principals p
    LEFT JOIN principal_company_relationships pcr ON p.id = pcr.principal_id
    LEFT JOIN companies c ON pcr.company_id = c.id
    LEFT JOIN entities e ON e.company_id = c.id
    LEFT JOIN property_entity_relationships per ON e.id = per.entity_id
    LEFT JOIN property_master pm ON per.property_id = pm.id
    WHERE p.id = ?
    GROUP BY p.id
  `, [actualId]);

  return principal;
}
```

#### Graph Tools (12) - Network Navigation
```typescript
// Example: trace_owner - Property → Entity → Company → Principals
export async function execute(params: { ccn?: string, property_id?: number }) {
  const result = {
    property: null,
    owner_entity: null,
    parent_company: null,
    principals: []
  };

  // 1. Get property
  result.property = await getProperty(params);

  // 2. Get owner entity
  const [ownerEntity] = await db.execute(`
    SELECT e.* FROM entities e
    JOIN property_entity_relationships per ON e.id = per.entity_id
    WHERE per.property_id = ? AND per.relationship_type = 'property_owner'
  `, [result.property.id]);
  result.owner_entity = ownerEntity[0];

  // 3. Get parent company
  if (result.owner_entity?.company_id) {
    result.parent_company = await getCompany({ id: result.owner_entity.company_id });
  }

  // 4. Get principals (officers/decision makers only by default)
  if (result.parent_company) {
    const [principals] = await db.execute(`
      SELECT p.*, pcr.role, pcr.ownership_percentage
      FROM principals p
      JOIN principal_company_relationships pcr ON p.id = pcr.principal_id
      WHERE pcr.company_id = ?
      AND pcr.role IN ('owner', 'ceo', 'president', 'cfo', 'director')
      AND (pcr.end_date IS NULL OR pcr.end_date > CURDATE())
    `, [result.parent_company.id]);
    result.principals = principals;
  }

  return result;
}
```

#### Intelligence Tools (6) - External Data
```typescript
// Example: nonprofit_search - Query ProPublica
export async function execute(params: { q: string, state?: string }) {
  const url = `https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(params.q)}`;

  const response = await fetch(url);
  const data = await response.json();

  return {
    total_results: data.total_results,
    organizations: data.organizations.map(org => ({
      ein: org.ein,
      name: org.name,
      city: org.city,
      state: org.state,
      income_amount: org.income_amount,
      asset_amount: org.asset_amount
    }))
  };
}
```

---

## Final Database Statistics

### Record Counts
| Table | Count | Description |
|-------|-------|-------------|
| property_master | 14,054 | SNF facilities (unique by CCN) |
| entities | 29,508 | Legal entities (LLCs, Corps, Trusts) |
| companies | 9,749 | Consolidated ownership groups |
| principals | 47,386 | Individual owners, officers, directors |
| deals | 29,365 | Transactions (mortgages, sales, CHOWs) |
| property_entity_relationships | 49,469 | Property ↔ Entity links |
| principal_company_relationships | 63,853 | Principal ↔ Company links |

### Coverage Metrics
| Metric | Value |
|--------|-------|
| Properties with owner entity | 100% (14,054/14,054) |
| Properties with operator entity | 100% (14,054/14,054) |
| Entities linked to companies | 78% (23,016/29,508) |
| Companies with 5+ properties having principals | **90.6%** |
| Companies with 100+ properties having principals | ~95% |

### Major Networks Documented
| Network | Properties | Principals | Ownership % Documented |
|---------|------------|------------|------------------------|
| Complete Care Management | 252 | 7 | Yes (Rothner 51%, Helman 33%, etc.) |
| Hill Valley Healthcare | 126 | 6 | Yes (Idels 50%, Schwartz 50%, etc.) |
| Portopiccolo Group | 188 | 9 | Partial (executive team) |
| Cascade Capital Group | 152 | 11 | Yes (Shabat/Rajchenbach co-founders) |
| Imperial Healthcare | 45 | 6 | Yes (Herzka 47.5%, etc.) |
| CHMS | - | 3 | Yes (33.33% each) |
| Strawberry Fields REIT | 68 | 5 | Partial (public REIT) |
| ARBA Group | 99 | 1 | Yes (family-owned) |

---

## What This Accomplishes

### 1. Ownership Intelligence
**Before:** "Who owns CCN 675432?" → Unknown
**After:** "Who owns CCN 675432?" → Property → Owner Entity → Scheiner PropCo LLC → Lou Scheiner (100% owner, TL Management)

### 2. Portfolio Discovery
**Before:** "What does Samuel Stern own?" → Unknown
**After:** "What does Samuel Stern own?" → 387 properties across 23 states via Complete Care (252), Autumn Lake (146), Excelsior (114), etc.

### 3. Network Navigation
**Before:** Isolated data points
**After:**
```
Start: One property in Ohio
→ Owner: Portopiccolo PropCo OH-4 LLC
→ Parent: Portopiccolo Group (188 properties)
→ Principals: Simcha Hyman (CEO), Naftali Zanziper (President)
→ Related: H.C. Family Trust, Zanziper Family Trust
→ Lender: Capital Funding (334 properties financed)
```

### 4. Competitive Intelligence
**Before:** No ability to track acquisitions
**After:**
- Lahasky acquired Diversicare (61 facilities, $70M, 2021)
- Portopiccolo grew from 70 facilities (2020) to 134+ (2024)
- Ensign operates 239 properties across 24 states

### 5. Risk Assessment
**Before:** No quality data linked to owners
**After:**
- Lahasky network: Only 2 of 97 facilities have 5-star rating
- $35M DOL fine for CHMS payroll violations
- LME Family Holdings bankruptcy (13 PA facilities, 2024)

---

## Files Created

### Enrichment Scripts (40+)
```
scripts/
├── enrich-*.js              # 30+ network enrichment scripts
├── consolidate-*.js         # Duplicate merging scripts
├── link-*.js                # Relationship creation scripts
├── verify-*.js              # Data quality verification
├── load-cms-certifiers-to-principals.js
├── link-entity-principals-to-company.js
└── lib/
    └── db-config.js         # Shared database configuration
```

### MCP Tools (41)
```
mcp/src/tools/
├── record/     # 9 tools (get/search)
├── graph/      # 12 tools (trace/navigate)
├── market/     # 5 tools (analytics)
├── hierarchy/  # 4 tools (PropCo/parent)
├── performance/# 5 tools (quality/financial)
└── intelligence/ # 6 tools (SEC/nonprofit)
```

### Documentation
```
docs/
├── PHASES_1-6_PROGRESS_SUMMARY.md
├── SESSION_HANDOFF_PRINCIPAL_ENRICHMENT.md
├── PHASE4_ENRICHMENT_SUMMARY.md
├── PHASE5_GUBIN_SMEDRA_NETWORKS.md
├── PHASE6_LAHASKY_NETWORK.md
└── research/
    ├── LAHASKY_CHMS_OWNERSHIP.md
    ├── ORTHODOX_OWNERSHIP_NETWORKS.md
    └── SCHEINER_OWNERSHIP_STRUCTURE.md
```

---

## Replication Instructions

To replicate this enrichment process:

1. **Setup Database Connection**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

2. **Run Data Quality Fixes**
   ```bash
   node scripts/fix-scheiner-relationships.js
   node scripts/consolidate-ira-smedra.js
   node scripts/consolidate-lahasky-records.js
   ```

3. **Run Network Enrichment**
   ```bash
   node scripts/enrich-portopiccolo-executives.js
   node scripts/enrich-moishe-gubin-network.js
   node scripts/enrich-mordy-lahasky-network.js
   ```

4. **Run Nonprofit Enrichment**
   ```bash
   node scripts/enrich-nonprofits-propublica.js
   node scripts/enrich-hospital-district-certifiers.js
   ```

5. **Verify Results**
   ```bash
   node scripts/summarize-enrichment.js
   node scripts/verify-scheiner-count.js
   ```

---

*Generated: January 25, 2026*
*Total enrichment work: 7 phases, 40+ scripts, 41 MCP tools*
*Database: 14,054 properties → 9,749 companies → 47,386 principals*
