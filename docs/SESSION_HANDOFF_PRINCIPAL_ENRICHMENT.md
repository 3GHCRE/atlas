# Principal Enrichment Session Handoff

**Date:** 2026-01-25
**Status:** In Progress
**Next Principal:** Herzka (big player, multiple companies)

---

## Summary of Completed Work

### 1. Data Quality Fixes - Scheiner

**Problem:** Lou Scheiner showed 904 properties - wildly inflated due to:
- Incorrectly linked to 12 OpCos that operate his buildings (Ensign, Nexion, Creative Solutions, etc.)
- MCP tool showing duplicate companies when principal has multiple roles (manager + director)

**Solution:**
- Removed 12 incorrect principal-company relationships (soft delete with `end_date`)
- Updated `trace_principal_network.ts` to aggregate roles via `GROUP_CONCAT`
- Properties deduped by `property_id` using Set

**Result:**
| Principal | Before | After |
|-----------|--------|-------|
| Scheiner | 904 props, 32 companies | **204 props, 14 companies** |

**Verified via:** `scripts/verify-scheiner-count.js`

---

### 2. Principal Enrichment - Joel Landau

**Problem:** Landau showed only 9 properties despite being one of the biggest players in SNF.

**Root Cause:**
- Missing link to Genesis Healthcare (93% stake via ReGen)
- Aurora Health Network entities not consolidated
- Company addresses and types not populated

**Solution:**

1. **Updated company information** (`scripts/update-landau-companies.js`):
   - Allure Group: 691 92nd Street, Brooklyn, NY 11228
   - Aurora Health Network: 55 Broadway, Suite 2001, New York, NY 10006
   - AlphaCare of New York: 335 Adams Street, Floor 26, Brooklyn, NY 11201
   - Pinta Capital Partners: type = `pe_firm` (not owner_operator)
   - ReGen Healthcare: type = `ownership` (investment vehicle)

2. **Consolidated Aurora entities** (`scripts/link-aurora-entities.js`):
   - Moved Aurora Holdings LLC entities under Aurora Health Network
   - Marked orphan holding companies as `[MERGED]`

3. **Added Genesis relationship**:
   ```sql
   INSERT INTO principal_company_relationships
   (principal_id, company_id, role, ownership_percentage, data_source)
   VALUES (22741, 14628, 'owner', 93.00, 'manual')
   ```

**Result:**
| Metric | Before | After |
|--------|--------|-------|
| Properties | 9 | **219** |
| States | 3 | **28** |
| Companies | 6 | 7 |

**Key Insight:** Genesis Healthcare (id 14628) has 204 properties. Landau/ReGen owns 93% via $125M investment.

---

## Key Distinctions for Entity Classification

### Entity Types
- **opco** - Operating company (licensee, runs facility)
- **propco** - Property-holding company (owns real estate)
- **borrower** - Loan recipient entity
- **lender** - Financing entity
- **buyer** - Transaction record (acquisition)
- **seller** - Transaction record (disposition)
- **other** - Ancillary (managed care, consulting, etc.)

### Relationship Types
- **property_owner** - Owns the real estate
- **facility_operator** - Licensed to operate the SNF
- **lender** - Provides financing
- **property_borrower** - Borrower on mortgage
- **property_buyer** - Acquired the property
- **property_seller** - Sold the property

### Company Types
- **owner_operator** - Owns and operates facilities
- **ownership** - PropCo/investment vehicle (owns RE, leases to operators)
- **operating** - OpCo only (operates for third-party owners)
- **pe_firm** - Private equity (invests, doesn't operate)
- **lending** - Provides debt financing
- **other** - Ancillary services (managed care, consulting)

---

## Workflow for Principal Enrichment

### Step 1: Assess Current State
```bash
# Search for principal
node -e "... mcp__3ghcre-atlas__search_principals({ name: 'Herzka' })"

# Trace their network
node -e "... mcp__3ghcre-atlas__trace_principal_network({ principal_id: XXX })"
```

### Step 2: Web Research
Search for:
- `"[Principal Name]" skilled nursing facilities portfolio`
- `"[Principal Name]" healthcare real estate`
- `"[Company Name]" address headquarters`

Key sources:
- Company websites (About/Team pages)
- LinkedIn profiles
- Skilled Nursing News articles
- McKnight's Long-Term Care News
- SEC filings (if public)
- State licensure databases

### Step 3: Update Companies
```javascript
// scripts/update-[principal]-companies.js
await conn.query(`
  UPDATE companies
  SET address = ?, city = ?, state = ?, zip = ?, company_type = ?
  WHERE id = ?
`, [address, city, state, zip, type, companyId]);
```

### Step 4: Link Missing Relationships
```javascript
// Add principal-company relationship
await conn.query(`
  INSERT INTO principal_company_relationships
  (principal_id, company_id, role, ownership_percentage, data_source)
  VALUES (?, ?, 'owner', ?, 'manual')
`, [principalId, companyId, ownershipPct]);
```

### Step 5: Consolidate Entities
```javascript
// Move entities to parent company
await conn.query(`
  UPDATE entities SET company_id = ? WHERE company_id = ?
`, [parentCompanyId, subsidiaryCompanyId]);

// Mark old company as merged
await conn.query(`
  UPDATE companies
  SET company_name = CONCAT('[MERGED into ', ?, '] ', company_name)
  WHERE id = ?
`, [parentName, subsidiaryCompanyId]);
```

### Step 6: Verify
```bash
node scripts/verify-[principal]-count.js
```

---

## Important Validations

### Allure Healthcare Services vs Allure Group
- **ALLURE GROUP** (id 340) - Joel Landau's company, Brooklyn NY, 7 properties
- **ALLURE HEALTHCARE SERVICES** (id 424) - DIFFERENT company, Illinois, Goldberg/Oseroff ownership

**They share a name but have completely different ownership - DO NOT merge.**

### Data Source Enum Values
Column `principal_company_relationships.data_source` accepts:
- `cms` - CMS Provider Information
- `reapi` - Real Estate API data
- `zoho` - CRM import
- `manual` - Manual enrichment
- `web_scrape` - Automated web scrape

---

## Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/verify-scheiner-count.js` | Verify principal property counts |
| `scripts/analyze-landau.js` | Analyze Landau's current state |
| `scripts/update-landau-companies.js` | Update Landau company addresses/types |
| `scripts/find-aurora-entities.js` | Find entities to consolidate |
| `scripts/link-aurora-entities.js` | Consolidate Aurora entities |
| `scripts/enrich-landau.js` | Full enrichment analysis |

---

## Completed: Herzka Enrichment ✓

### Herzka Family Portfolio (Distinct Individuals)

| ID | Name | Properties | States | Key Companies |
|----|------|------------|--------|---------------|
| **30548** | YISROEL E HERZKA | **147** | **23** | Venza (36%), Imperial (47.5%), Empres (21.6%), Solaris (~20%), Infinite (17.5%), Certus |
| 21609 | CHAIM HERZKA | 55 | 10 | Imperial (10%), Venza (2%), Solaris (director) |
| 8634 | MATISYOHU HERZKA | 24 | 3 | The Blossoms (32%), Continental Springs (33%) |
| 14429 | DAVID HERZKA | 30 | 5 | Atlas Healthcare (15%) |
| 79992 | [MATCHED] Matis Herzka | - | - | Merged into Matisyohu |

### Yisroel "Chuny" Herzka Enrichment Details

**Key Findings from Web Research:**
- Based in **Lakewood, NJ**
- Nickname: "Chuny" Herzka
- Nephew of **Ralph Herzka** (Meridian Capital founder)
- Major political donor ($50K to DeSantis)

**Co-Owners Identified:**
- **Daniel Gottesman** + **ENS Holdings/Ens Family Trust** → Imperial Healthcare Group
- **Yitzchok Yenowitz** → Empres Operated by Evergreen

**Added Relationship:**
- Linked to **Certus Healthcare** (10 properties in Ohio) - Certus Healthcare Management manages 1,350+ beds

**Result:**
| Metric | Before | After |
|--------|--------|-------|
| Properties | 137 | **147** |
| States | 22 | **23** |
| Companies | 12 | **13** (9 unique after role dedup) |

**Scripts Created:**
- `scripts/check-certus-principals.js` - Check Certus link
- `scripts/update-herzka-principal.js` - Add location/notes

---

## Database Connection

```javascript
const mysql = require('mysql2/promise');
require('dotenv').config();

const conn = await mysql.createConnection({
  host: process.env.LOCAL_DB_HOST || 'localhost',
  port: process.env.LOCAL_DB_PORT || 3306,
  user: process.env.LOCAL_DB_USER || 'root',
  password: process.env.LOCAL_DB_PASSWORD,
  database: process.env.LOCAL_DB_NAME || 'atlas'
});
```

---

## Major Players Reference (Verified Counts)

| Principal | Properties | States | Key Companies |
|-----------|------------|--------|---------------|
| Samuel Stern | 387 | 23 | Complete Care, Autumn Lake, Excelsior |
| Joel Landau | 219 | 28 | Genesis (93%), Allure Group, Aurora Health |
| Lou Scheiner | 204 | 13 | Hamilton County, TL Management, Caring Healthcare |
| **Yisroel "Chuny" Herzka** | **147** | **23** | Venza, Imperial, Empres, Solaris, Infinite, Certus |
| Benjamin Landa | 60 | ~5 | Benjamin Landa company (FL/KY/NY) |

---

## Completed: Rajchenbach Family Enrichment ✓

### Rajchenbach Family Portfolio (Distinct Individuals)

| ID | Name | Properties | States | Key Companies |
|----|------|------------|--------|---------------|
| **17060** | CHAIM Z RAJCHENBACH | **198** | **20** | Legacy Healthcare (5.32%), Cascade Capital (managing_partner), Morton Grove (50%) |
| 29864 | MOSHE Y RAJCHENBACH | 63 | 7 | Lifeworks Rehab (100%) |
| 27324 | AVRUM RAJCHENBACH | 92 | 3 | Legacy Healthcare (director) - Trustee GPN Family Trust |
| 31179 | JUDITH A RAJCHENBACH | 92 | 3 | Legacy Healthcare (director) - Trustee Rajchenbach 2015 Family |
| 12685 | RIVKA RAJCHENBACH | 92 | 3 | Legacy Healthcare (director) - Trustee GPN Family Trust |
| 70821 | JACK RAJCHENBACH | 0 | 0 | Secretary - Father of Chaim |

### Key Companies

| Company | Type | Address | Properties |
|---------|------|---------|------------|
| **Legacy Healthcare** | owner_operator | 7040 N Ridgeway Ave, Lincolnwood, IL | 92 |
| **Cascade Capital Group** | pe_firm | 3450 Oakton St, Skokie, IL | 152 |
| **Lifeworks Rehab** | owner_operator | 400 Boulevard Of Americas, Lakewood, NJ | 63 |

### Enrichment Details

**Key Findings from Web Research:**
- **Chaim Rajchenbach** is Managing Director & Co-Founder of Cascade Capital Group
- Co-founded Cascade with **Menachem Shabat** in 2016 in Skokie, IL
- Cascade Capital launched by the team that built Legacy Healthcare
- Chaim was "integral piece of Legacy Healthcare transformation into premier SNF brand"
- **Jack Rajchenbach** is Chaim's father

**Duplicates Merged:**
- Chaim Rajchenbach (80508) → CHAIM Z RAJCHENBACH (17060) - had managing_partner role
- RAJCHENBACH, JACK CHAIM (73285) → JACK RAJCHENBACH (70821) - bad name parse

**Scripts Created:**
- `scripts/enrich-rajchenbach.js` - Merge duplicates and update info

**Sources:**
- [Cascade Capital Group LinkedIn](https://www.linkedin.com/in/chaim-rajchenbach-862110140/)
- [Cascade Capital Crunchbase](https://www.crunchbase.com/organization/cascade-capital-group)
- [Cascade Capital Acquisition News](https://cascadellc.com/2016/02/01/cascade-capital-group-acquires-skilled-nursing-portfolio-western-u-s/)

---

## Completed: Portopiccolo Group + Rozenberg Enrichment ✓

### Kenny Rozenberg Duplicate Merge
**Problem:** Two records for same person with different spelling
- KENNETH ROZENBERG (26727) - canonical
- KEN ROZENBURG (80481) - duplicate

**Solution:** Merged duplicate into canonical, marked as `[MERGED]`

### Portopiccolo Group Principals Updated

| ID | Name | Title | Location | Notes |
|----|------|-------|----------|-------|
| **7334** | SIMCHA MELECH HYMAN | CEO | Brooklyn, NY | Co-founded Portopiccolo 2016, 130+ nursing homes |
| **25187** | NAFTALI ZANZIPER | President | Brooklyn, NY | Co-founder, started at RiteCare medical supplies |

**Company Info:**
- The Portopiccolo Group LLC (14607)
- Address: 980 Sylvan Ave, Englewood Cliffs, NJ 07632
- Type: pe_firm
- Properties: 188+ (483 via all relationships)
- Entities: 261 (OpCos + PropCos)

**Key Background (Web Research):**
- Founded 2016 after selling medical supply company
- Brooklyn businessmen, ages 25 (Hyman) and 32 (Zanziper) at founding
- Portfolio grew from 70 facilities (2020) to 134+ (2024)
- 25 facilities in Kentucky alone
- Associated entities: H.C. Family Trust, Zanziper Family Trust, Accordius Health LLC

**Sources:**
- [Kentucky Lantern (2024)](https://kentuckylantern.com/2024/04/24/for-profit-nursing-homes-are-cutting-corners/)
- [Skilled Nursing News (2019)](https://skillednursingnews.com/2019/09/capital-funding-backs-portopiccolos-36-9m-pickup/)
- [The Real Deal (2024)](https://therealdeal.com/miami/2024/01/25/healthcare-realty-trust-sells-sunrise-alf-to-portopiccolo/)

**Scripts Created:**
- `scripts/enrich-rozenberg-portopiccolo.js`

---

## Major Players Reference (Updated)

| Principal | Properties | States | Key Companies |
|-----------|------------|--------|---------------|
| Samuel Stern | 387 | 23 | Complete Care (252), Autumn Lake (146), Excelsior (114), Benjamin Landa (122) |
| Benjamin Landa | 194 | 15 | Embassy Healthcare (100), Serrano Group (32), Bluegrass KY (51), Champion Care (48) |
| Joel Landau | 219 | 28 | Genesis (93%), Allure Group, Aurora Health |
| Lou Scheiner | 204 | 13 | Hamilton County, TL Management, Caring Healthcare |
| Menachem Shabat | 198 | 20 | Cascade Capital (242), Legacy Healthcare (201) |
| Simcha Melech Hyman | 190 | 24 | Portopiccolo Group (188), Ivy Healthcare (8) |
| Naftali Zanziper | 188 | 23 | Portopiccolo Group (President) |
| Yisroel "Chuny" Herzka | 147 | 23 | Venza, Imperial, Empres, Solaris, Infinite, Certus |
| Kenneth Rozenberg | 99 | 12 | Centers Health Care (105), CareRite Centers (134) |
| Daniel A Gottesman | 64 | 9 | Imperial Healthcare (45), Hill Valley (126) |
| Yitzchok Yenowitz | 53 | 12 | Empres/Evergreen (106), Golden SNF (10) |

---

## Discovered: Shimon Idels - Hill Valley Co-Founder

| ID | Name | Title | Properties | States | Key Companies |
|----|------|-------|------------|--------|---------------|
| **25305** | SHIMON "SHIMMY" IDELS | Co-Founder/Co-CEO | **163** | **14** | Hill Valley (50% owner, 126 props), Infinity Healthcare (164), Kingston Healthcare (14), Majestic Care (31) |

**Key Findings:**
- Co-founder and Co-CEO of Hill Valley Healthcare
- **50% ownership stake** in Hill Valley Healthcare
- Licensed Nursing Home Administrator (VA #5444, expired)
- Hill Valley based in Woodmere, NY (1007 Broadway, Woodmere, NY 11598)
- 2022: Acquired 10th senior housing/SNF in Virginia, 20th in East Coast footprint
- Also manages Infinity Healthcare Consulting, Kingston Healthcare, Majestic Care

**Associated Companies:**
- Hill Valley Healthcare (460) - 126 properties, 58 entities
- Infinity Healthcare Consulting (221) - 164 properties (management)
- Kingston Healthcare (177) - 14 properties (management)
- Majestic Care (380) - 31 properties (management)

**Other Hill Valley Principals:**
- **Steven A Schwartz** (21673) - CFO
- **Robert Meisner** (22956) - Member, 11 companies

**Sources:**
- [HJ Sims - Hill Valley Healthcare](https://hjsims.com/hill-valley-healthcare/)
- [Nursing Home Database - Shimon Idels](https://www.nursinghomedatabase.com/owner/shimon-idels)

---

## Completed: Latest Enrichments (Session 2) ✓

### Akiva Schonfeld (71466)
- **Title:** General Counsel
- **Location:** Brooklyn, NY
- **Role:** Portopiccolo Group legal counsel, handles acquisitions/dispositions
- **Background:** JD Brooklyn Law School, now also President & General Counsel at 980Investments

### Daniel A Gottesman (6729)
- **Title:** Transaction Attorney/Investor
- **Location:** Cleveland, OH (via Ulmer & Berne LLP)
- **Role:** Transaction attorney for Imperial Healthcare Group and ENS Holdings
- **Ownership:** 15% Imperial Healthcare, 46% Downers Grove SNF, 45% Shippensburg Opco, others
- **Network:** Works with Yisroel Herzka and ENS Family Trust

### Yitzchok "Isaac" Yenowitz (30303)
- **Title:** CEO
- **Location:** Vancouver, WA (service office)
- **Role:** CEO of Evergreen Healthcare Group
- **2023 Acquisition:** Acquired EmpRes Healthcare from Brent Weil (46 facilities, 6 states)
- **Ownership:** 30% Golden SNF Operations (California)
- **Network:** Works with Yisroel Herzka, 53 properties across 12 states

### Robert Meisner (22956)
- **Title:** Investment Partner
- **Role:** Silent investor/capital partner in Texas-focused SNF operators
- **Ownership Pattern:** Consistent 21% stakes across multiple companies:
  - Creative Solutions in Healthcare (145 props)
  - OPCO Skilled Management (106 props)
  - Caring Healthcare Group (43 props)
  - Advanced Healthcare Solutions (56 props)
  - Coryell County Memorial Hospital Authority (62 props)
  - Also: 5% Hill Valley, 4.9% Atlas Healthcare
- **Network:** 305 properties across 21 states

**Scripts Created:**
- `scripts/enrich-schonfeld-gottesman.js`
- `scripts/enrich-yenowitz-meisner.js`

---

## Completed: Samuel Stern (Sam Stein) - LARGEST Principal ✓

### Samuel Stern (13758)
- **Title:** Founder/CEO (was CFO in CMS - corrected)
- **Location:** Lakewood, NJ
- **Companies:** Complete Care Management, Peace Capital LLC (PE firm)
- **Properties:** 387 across 23 states - **LARGEST principal in database**
- **2022 Acquisition:** Majority of Hackensack Meridian Health LTC portfolio
- **NJ Comptroller:** Officer of 43+ NJ nursing homes
- **Name Note:** "Sam Stern" in CMS records = "Sam Stein" in business records

**Key Companies:**
| Company | Properties | Role |
|---------|------------|------|
| Complete Care | 252 | 10% officer |
| Autumn Lake Healthcare | 146 | owner |
| Benjamin Landa | 122 | 10% officer |
| Excelsior Care Group | 114 | officer/manager |
| Upstate Services Group | 49 | officer |
| The Grand Healthcare | 36 | officer |
| Preferred Care | 32 | manager/officer |

**Sources:**
- [LinkedIn](https://www.linkedin.com/in/sam-stein-ccm/)
- [Skilled Nursing News - HMH Acquisition](https://skillednursingnews.com/2022/03/health-system-hackensack-meridian-sells-majority-of-ltc-portfolio-to-complete-care/)

---

## Major Players Reference (Updated with Latest)

| Principal | Properties | States | Key Companies | Enriched? |
|-----------|------------|--------|---------------|-----------|
| **Samuel Stern** | **387** | **23** | Complete Care (252), Autumn Lake (146), Excelsior (114) | ✅ |
| **Robert Meisner** | **305** | **21** | Creative Solutions (21%), OPCO Skilled (21%), Hill Valley (5%) | ✅ |
| Joel Landau | 219 | 28 | Genesis (93%), Allure Group, Aurora Health | ✅ |
| Lou Scheiner | 204 | 13 | Hamilton County, TL Management, Caring Healthcare | ✅ |
| **Menachem Shabat** | **198** | **20** | Cascade Capital (242), Legacy Healthcare (201) | ✅ |
| Benjamin Landa | 194 | 15 | Embassy Healthcare, Serrano Group, Bluegrass KY | ❌ |
| Simcha Melech Hyman | 190 | 24 | Portopiccolo Group (188), Ivy Healthcare (8) | ✅ |
| Naftali Zanziper | 188 | 23 | Portopiccolo Group (President) | ✅ |
| Shimon Idels | 163 | 14 | Hill Valley (50%), Infinity Healthcare | ✅ |
| Yisroel "Chuny" Herzka | 147 | 23 | Venza, Imperial, Empres, Solaris, Infinite, Certus | ✅ |
| Kenneth Rozenberg | 99 | 12 | Centers Health Care, CareRite Centers | ✅ |
| Daniel A Gottesman | 64 | 9 | Imperial Healthcare (attorney), various OpCos | ✅ |
| Yitzchok Yenowitz | 53 | 12 | Evergreen/Empres (CEO), Golden SNF (30%) | ✅ |
| Akiva Schonfeld | 188 | - | Portopiccolo (General Counsel) | ✅ |

---

## Completed: Menachem "Nachy" Shabat - Cascade Capital Co-Founder ✓

### Menachem Shabat (12160)
- **Title:** Co-Founder/Managing Director
- **Location:** Skokie, IL
- **Company:** Cascade Capital Group (3450 Oakton Street, Skokie, IL)
- **Co-founded:** 2016 with Chaim Rajchenbach
- **Background:** Previously built Legacy Healthcare, extensive frontline experience as facility administrator
- **Cascade Capital:** 300+ facilities in 19 states, 30,000 licensed beds
- **Also:** General Partner at Cane Investment Partners
- **Nickname:** "Nachy"

**Cascade Capital Team Identified:**
| ID | Name | Title/Role |
|----|------|------------|
| 12160 | Menachem Shabat | Co-Founder/Managing Director |
| 17060 | Chaim Z Rajchenbach | Co-Founder/Managing Partner |
| 80510 | Mordy Kaplan | COO |
| 68544 | Eli Davis | VP |
| 16071 | Daniel Garden | Owner |

---

## Next Targets for Enrichment

### Priority 1 - Major Players Not Yet Enriched
- **Benjamin Landa** (31537) - 194 properties, 15 states, 17 companies - LAST MAJOR PLAYER

### Priority 2 - Network Expansion
- **Ralph Herzka** (Meridian Capital - Chuny's uncle)
- **Centers Health Care partners** - Cross-reference with Kenny Rozenberg's co-owners
- **Michael Meisner** (23737) - Related to Robert Meisner? 9 companies

### Priority 3 - Portopiccolo Team
- Rachel Kosowsky (79744) - owner
- Jean Stiles (80489) - officer
- Avi Hoffman (80490) - VP
- Sara Fishoff (80491) - director
