# 3G Healthcare RE Atlas - ERD with REAPI Integration

**Last Updated:** January 23, 2026
**Version:** 2.1 (Deals Subsystem with REAPI Sales)

---

## Conceptual Model: Dual-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            OWNERSHIP HIERARCHY                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   LAYER 4: PRINCIPALS (People)                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  John Smith (CEO)    Mary Jones (Dir)    Bob Brown (Owner 25%)      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│   LAYER 3: COMPANIES (Portfolios)                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  ENSIGN GROUP (opco)           CASCADE CAPITAL GROUP (opco)         │   │
│   │  Standard Bearer REIT (reit)   Legacy Healthcare (opco)             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│   LAYER 2: ENTITIES (Legal Entities - LLCs, Corps)                          │
│   ┌────────────────────────────┐  ┌────────────────────────────┐           │
│   │ OPCO (CMS Data)            │  │ PROPCO (REAPI Data)        │           │
│   │ "Sunrise SNF LLC"          │  │ "Valley Health Holdings"   │           │
│   │ "Heritage Care Inc"        │  │ "Orland Park Property LLC" │           │
│   │ (Facility Operator)        │  │ (Property Owner)           │           │
│   └────────────────────────────┘  └────────────────────────────┘           │
│                              │                                               │
│                              ▼                                               │
│   LAYER 1: PROPERTIES (Physical Assets)                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  CCN: 145320  │  CCN: 055120  │  CCN: 365247  │  CCN: 675012        │   │
│   │  Sunrise SNF  │  Valley Care  │  Heritage NH  │  Park Ridge Care    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Physical Schema (ERD)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ATLAS DATABASE (Local Docker)                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│    principals       │     │      companies      │     │   property_master   │
├─────────────────────┤     ├─────────────────────┤     ├─────────────────────┤
│ PK id               │     │ PK id               │     │ PK id               │
│    first_name       │     │    company_name     │     │ UK ccn ◄────────────┼──┐
│    last_name        │     │    company_type     │     │    reapi_property_id│  │
│    full_name        │     │      (opco/propco/  │     │    facility_name    │  │
│    title            │     │       reit/pe/mgmt) │     │    address          │  │
│    cms_associate_id │     │    cms_affiliated_  │     │    city/state/zip   │  │
│                     │     │      entity_id      │     │    latitude/longitude  │
└─────────┬───────────┘     │    address/city/    │     │    data_quality_score  │
          │                 │      state/zip      │     └─────────┬───────────┘  │
          │                 └─────────┬───────────┘               │              │
          │                           │                           │              │
          ▼                           ▼                           │              │
┌─────────────────────────┐  ┌─────────────────────┐              │              │
│principal_company_       │  │     entities        │              │              │
│  relationships          │  ├─────────────────────┤              │              │
├─────────────────────────┤  │ PK id               │              │              │
│ PK id                   │  │    entity_name      │              │              │
│ FK principal_id ────────┘  │    entity_type      │              │              │
│ FK company_id ─────────────┤      (opco/propco)  │              │              │
│    role (owner/director/   │ FK company_id ──────┘              │              │
│      officer/ceo/cfo...)   │    cms_associate_id │              │              │
│    ownership_percentage    │    address/city/    │              │              │
│    effective_date          │      state/zip      │              │              │
│    data_source (cms)       └─────────┬───────────┘              │              │
└─────────────────────────┘            │                          │              │
                                       │                          │              │
                                       ▼                          │              │
                           ┌─────────────────────────┐            │              │
                           │ property_entity_        │            │              │
                           │   relationships         │            │              │
                           ├─────────────────────────┤            │              │
                           │ PK id                   │            │              │
                           │ FK property_master_id ──┼────────────┘              │
                           │ FK entity_id ───────────┘                           │
                           │    relationship_type                                │
                           │      (property_owner /                              │
                           │       facility_operator)                            │
                           │    data_source                                      │
                           │      (cms / reapi)                                  │
                           │    effective_date                                   │
                           │    end_date                                         │
                           └─────────────────────────┘                           │
                                                                                 │
┌─────────────────────────────────────────────────────────────────────────────┐ │
│                        REAPI DATABASE (Remote DigitalOcean)                  │ │
└─────────────────────────────────────────────────────────────────────────────┘ │
                                                                                 │
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐ │
│ reapi_properties    │◄────┤ reapi_owner_info    │     │reapi_nursing_homes  │ │
├─────────────────────┤     ├─────────────────────┤     ├─────────────────────┤ │
│ PK property_id      │     │ PK id               │     │ PK ccn ─────────────┼─┘
│    ccn ─────────────┼─────┤ FK property_id      │     │    provider_name    │
│    estimated_value  │     │    owner1_full_name │     └─────────────────────┘
│    last_sale_date   │     │    owner1_type      │
│    last_sale_price  │     │    company_name     │
│    equity           │     │  ► mail_address ◄   │ ◄── Key matching field
│    mortgage_balance │     │    mail_city/state  │
└─────────────────────┘     │    ownership_length │
          │                 └─────────────────────┘
          │
          ├──────────────────┬──────────────────┬─────────────────────┐
          ▼                  ▼                  ▼                     ▼
┌─────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐
│reapi_property_  │ │reapi_sales_    │ │reapi_tax_info  │ │reapi_linked_     │
│  addresses      │ │  history       │ │                │ │ properties_summary│
├─────────────────┤ ├────────────────┤ ├────────────────┤ ├──────────────────┤
│ FK property_id  │ │ FK property_id │ │ FK property_id │ │ FK property_id   │
│    address      │ │    sale_date   │ │    assessed_val│ │    total_owned   │
│    city/state   │ │    sale_amount │ │    market_val  │ │    total_value   │
│    lat/lng      │ │    buyer_names │ │    tax_amount  │ └──────────────────┘
└─────────────────┘ │    seller_names│ │    tax_year    │
                    └────────────────┘ └────────────────┘
```

---

## Key Relationships & Data Flow

### 1. Property Layer (CCN is the key)

```
property_master.ccn ◄──► reapi_properties.ccn ◄──► reapi_nursing_homes.ccn
```

- **CCN** (CMS Certification Number) is the universal link between systems
- 14,597 properties in REAPI matched to ~15,000 properties in CMS

### 2. Entity Layer (Opco vs Propco)

| Attribute | OPCO (CMS Data) | PROPCO (REAPI Data) |
|-----------|-----------------|---------------------|
| **Source** | CMS Enrollments | REAPI owner_info |
| **entity_type** | `opco` | `propco` |
| **Naming Pattern** | Legal facility operator name | `*Health Holdings LLC` (Ensign)<br>`*Property Holdings LLC` (Cascade) |
| **relationship_type** | `facility_operator` | `property_owner` |
| **data_source** | `cms` | `reapi` |

### 3. Company Layer (Portfolio Grouping)

| company_type | Description | Example |
|--------------|-------------|---------|
| `opco` | Operating company portfolio | Ensign Group, Cascade Capital |
| `propco` | Property ownership company | (Individual LLCs roll up here) |
| `reit` | Real Estate Investment Trust | Standard Bearer Healthcare REIT |
| `pe_firm` | Private equity firm | Various |
| `management` | Management company | Third-party managers |

### 4. REAPI Propco Matching Logic

```sql
-- Match properties to companies via mailing address
reapi_owner_info.mail_address → owner_mappings.csv → companies.id

-- Example: Ensign Group addresses
'Po Box 128109'           -- Nashville, TN → 80 properties
'29222 Rancho Viejo Rd'   -- San Juan Capistrano → 60 properties
'27101 Puerta Real'       -- Mission Viejo (HQ) → 30 properties
```

---

## Sample Queries

### Complete Ownership Chain

```sql
-- Show property with both opco (operator) and propco (owner)
SELECT
    pm.facility_name,
    pm.ccn,
    pm.state,

    -- Operator (CMS)
    opco_e.entity_name AS operator_entity,
    opco_c.company_name AS operator_portfolio,

    -- Owner (REAPI)
    propco_e.entity_name AS owner_entity,
    propco_c.company_name AS owner_portfolio,

    -- Financials (REAPI)
    rp.estimated_value,
    rp.estimated_mortgage_balance,
    rsh.last_sale_price,
    rsh.last_sale_date

FROM property_master pm

-- Join CMS Opco chain
LEFT JOIN property_entity_relationships opco_per
    ON opco_per.property_master_id = pm.id
    AND opco_per.relationship_type = 'facility_operator'
LEFT JOIN entities opco_e ON opco_e.id = opco_per.entity_id
LEFT JOIN companies opco_c ON opco_c.id = opco_e.company_id

-- Join REAPI Propco chain
LEFT JOIN property_entity_relationships propco_per
    ON propco_per.property_master_id = pm.id
    AND propco_per.relationship_type = 'property_owner'
LEFT JOIN entities propco_e ON propco_e.id = propco_per.entity_id
LEFT JOIN companies propco_c ON propco_c.id = propco_e.company_id

-- Join REAPI financials
LEFT JOIN reapi_properties rp ON rp.ccn = pm.ccn
LEFT JOIN reapi_sales_history rsh ON rsh.property_id = rp.property_id

WHERE pm.ccn = '055120';  -- Example CCN
```

### Find Opco ≠ Propco (Sale-Leaseback Identification)

```sql
-- Find properties where operating company differs from owning company
SELECT
    pm.facility_name,
    pm.state,
    opco_c.company_name AS operator,
    propco_c.company_name AS owner,
    rp.estimated_value,
    rp.estimated_mortgage_balance
FROM property_master pm
JOIN property_entity_relationships opco_per
    ON opco_per.property_master_id = pm.id
    AND opco_per.relationship_type = 'facility_operator'
JOIN entities opco_e ON opco_e.id = opco_per.entity_id
JOIN companies opco_c ON opco_c.id = opco_e.company_id
JOIN property_entity_relationships propco_per
    ON propco_per.property_master_id = pm.id
    AND propco_per.relationship_type = 'property_owner'
JOIN entities propco_e ON propco_e.id = propco_per.entity_id
JOIN companies propco_c ON propco_c.id = propco_e.company_id
LEFT JOIN reapi_properties rp ON rp.ccn = pm.ccn
WHERE opco_c.id != propco_c.id;
```

This reveals sale-leaseback arrangements, REIT-owned facilities, and third-party management structures.

---

## Data Source Summary

| Table | Source | Records | Purpose |
|-------|--------|---------|---------|
| `property_master` | CMS | ~15,000 | Golden property record (CCN-based) |
| `companies` | CMS + REAPI | ~14,000 | Portfolio-level groupings |
| `entities` | CMS + REAPI | ~15,000+ | Legal entities (opco + propco) |
| `principals` | CMS | ~50,000 | People (owners, directors, officers) |
| `property_entity_relationships` | Both | ~15,000+ | Property↔Entity links |
| `principal_company_relationships` | CMS | ~80,000 | People↔Company links |
| **REAPI tables** | REAPI | 14,597 each | Property financials, ownership, transactions |

---

## REAPI Tables Reference

| Table | Rows | Key Fields | Purpose |
|-------|------|------------|---------|
| `reapi_properties` | 14,597 | ccn, property_id, estimated_value | Core property financials |
| `reapi_owner_info` | 14,597 | owner1_full_name, mail_address | Ownership identification |
| `reapi_nursing_homes` | 14,654 | ccn, provider_name | CCN↔Name mapping |
| `reapi_property_addresses` | 14,597 | address, city, state, lat/lng | Physical locations |
| `reapi_sales_history` | 14,597 | sale_date, sale_amount, buyer/seller | Transaction history |
| `reapi_tax_info` | 14,597 | assessed_value, market_value, tax_amount | Tax assessments |
| `reapi_linked_properties_summary` | 8,700 | total_owned, total_value | Owner portfolio metrics |

---

## Deals Subsystem (CHOW + Sales)

The Deals subsystem unifies transaction data from CMS (CHOWs) and REAPI (Sales) into a single queryable structure.

### Deals Schema

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│       deals         │     │    deals_parties    │     │    deals_chow       │
├─────────────────────┤     ├─────────────────────┤     ├─────────────────────┤
│ PK id               │◄────┤ FK deal_id          │     │ PK id               │
│ FK property_master  │     │    party_role       │     │ FK deal_id ─────────┼──┐
│    ccn              │     │      (buyer/seller/ │     │    chow_type_code   │  │
│    deal_type        │     │       borrower/     │     │    chow_type_text   │  │
│      (chow/sale/    │     │       lender...)    │     │    buyer_enrollment │  │
│       mortgage...)  │     │    party_name       │     │    seller_enrollment│  │
│    effective_date   │     │ FK company_id       │     └─────────────────────┘  │
│    amount           │     │ FK principal_id     │                              │
│    document_type    │     │    enrollment_id    │     ┌─────────────────────┐  │
│    data_source      │     └─────────────────────┘     │    deals_sale       │  │
│      (cms/reapi)    │                                 ├─────────────────────┤  │
│    verified         │◄────────────────────────────────┤ FK deal_id ─────────┼──┘
└─────────────────────┘                                 │    sale_type        │
                                                        │    price_per_bed    │
                                                        │    price_per_sqft   │
                                                        │    bed_count        │
                                                        │    building_sqft    │
                                                        │    year_built       │
                                                        └─────────────────────┘
```

### Deal Types & Sources

| deal_type | data_source | Count | Description |
|-----------|-------------|-------|-------------|
| `chow` | `cms` | ~4,953 | CMS Change of Ownership records |
| `sale` | `reapi` | ~4,446 | REAPI property sales with amount > 0 |
| `mortgage` | `reapi` | (pending) | Mortgage originations (reapi_mortgages) |
| `assignment` | `reapi` | (future) | Mortgage assignments |

### Party Roles

| Party Role | Deal Types | Description |
|------------|------------|-------------|
| `buyer` | sale, chow | Property acquirer |
| `seller` | sale, chow | Property seller |
| `lender` | mortgage | Financing provider (bank, HUD, etc.) |
| `borrower` | mortgage | Loan recipient (propco/opco) |
| `assignor` | assignment | Mortgage assignor |
| `assignee` | assignment | Mortgage assignee |

### Sample Queries

```sql
-- Unified deals view (CHOWs + Sales)
SELECT
    d.deal_type,
    d.effective_date,
    d.amount,
    pm.facility_name,
    buyer.party_name AS buyer,
    seller.party_name AS seller
FROM deals d
LEFT JOIN property_master pm ON pm.id = d.property_master_id
LEFT JOIN deals_parties buyer ON buyer.deal_id = d.id AND buyer.party_role = 'buyer'
LEFT JOIN deals_parties seller ON seller.deal_id = d.id AND seller.party_role = 'seller'
WHERE d.effective_date >= '2020-01-01'
ORDER BY d.effective_date DESC;

-- Company acquisition activity
SELECT
    c.company_name,
    SUM(CASE WHEN dp.party_role = 'buyer' THEN 1 ELSE 0 END) AS acquisitions,
    SUM(CASE WHEN dp.party_role = 'seller' THEN 1 ELSE 0 END) AS dispositions,
    SUM(CASE WHEN dp.party_role = 'buyer' THEN d.amount ELSE 0 END) AS buy_volume,
    SUM(CASE WHEN dp.party_role = 'seller' THEN d.amount ELSE 0 END) AS sell_volume
FROM deals d
JOIN deals_parties dp ON dp.deal_id = d.id
JOIN companies c ON c.id = dp.company_id
WHERE d.deal_type IN ('chow', 'sale')
GROUP BY c.company_name
ORDER BY acquisitions DESC;

-- Top lenders by mortgage volume (when mortgage data available)
SELECT
    dp.party_name AS lender,
    COUNT(*) AS loans,
    SUM(d.amount) AS total_volume,
    AVG(dm.interest_rate) AS avg_rate
FROM deals d
JOIN deals_parties dp ON dp.deal_id = d.id AND dp.party_role = 'lender'
LEFT JOIN deals_mortgage dm ON dm.deal_id = d.id
WHERE d.deal_type = 'mortgage'
GROUP BY dp.party_name
ORDER BY total_volume DESC;

-- Company financing activity (borrowing)
SELECT
    c.company_name,
    COUNT(*) AS loans,
    SUM(d.amount) AS total_borrowed
FROM deals d
JOIN deals_parties dp ON dp.deal_id = d.id
JOIN companies c ON c.id = dp.company_id
WHERE d.deal_type = 'mortgage' AND dp.party_role = 'borrower'
GROUP BY c.company_name
ORDER BY total_borrowed DESC;
```

### ETL Scripts

| Script | Purpose | Run Order |
|--------|---------|-----------|
| `07_phase1b_chow.sql` | Load CMS CHOW data (buyer/seller) | Docker init |
| `scripts/load-reapi-sales.js` | Load REAPI sales (buyer/seller) | Manual |
| `scripts/load-reapi-mortgages.js` | Load REAPI mortgages (lender/borrower) | Manual (pending data) |
| `scripts/link-sales-entities.js` | Link parties to entities | Manual (optional) |
| `docker/init/50_sales_validation.sql` | Validation queries | After data load |

**Note:** `load-reapi-mortgages.js` is ready but waiting for `reapi_mortgages` table to be populated. Run with `--check` to verify data availability.

---

## Propco Company Mappings

Properties are matched to companies via mailing address using `data/owner_mappings.csv`:

| Company | Addresses | Properties | Pattern |
|---------|-----------|------------|---------|
| **Ensign Group** | Po Box 128109 (Nashville)<br>29222 Rancho Viejo Rd<br>27101 Puerta Real | ~170 | `*Health Holdings LLC` |
| **Cascade Capital** | 3450 Oakton St (Skokie) | ~163 | `*Property Holdings LLC` |
| **Others** | 315 additional mappings | ~3,000 | Various |

**Total Coverage:** 317 addresses → ~3,247 properties (22.2% of 14,597)

---

## Architecture Notes

### Two-Database Pattern

1. **Atlas (Local Docker MySQL)** - Normalized schema for analysis
   - `property_master`, `entities`, `companies`, `principals`
   - Junction tables for relationships

2. **REAPI (Remote DigitalOcean MySQL)** - Source data
   - Denormalized property data
   - Read-only for ETL purposes

### ETL Flow

```
REAPI (cms_data)                    Atlas (atlas)
─────────────────                   ─────────────
reapi_owner_info.mail_address  ──►  owner_mappings.csv
                                           │
                                           ▼
                                    companies (propco)
                                           │
reapi_owner_info.owner1_full_name ──►  entities (propco)
                                           │
reapi_properties.ccn ──────────────►  property_entity_relationships
        │                                  │
        └──────────────────────────►  property_master.ccn
```

---

## Related Documentation

- `docs/data/REAPI_SCHEMA.md` - Full REAPI table documentation
- `docs/research/ENSIGN_GROUP_ACQUISITION_ANALYSIS.md` - Ensign case study
- `docs/research/CASCADE_CAPITAL_GROUP_ACQUISITION_ANALYSIS.md` - Cascade case study
- `data/owner_mappings.csv` - Address→Company mappings
- `docker/init/50_sales_validation.sql` - Sales data validation queries
- `scripts/load-reapi-sales.js` - REAPI sales ETL script
- `scripts/link-sales-entities.js` - Entity linking for sales parties
