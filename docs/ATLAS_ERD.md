# 3G Healthcare Real Estate Atlas - Entity Relationship Diagram

**Last Updated:** January 2026

## 4-Layer Ownership Architecture

```
Property (14,054) → Entity (16,261) → Company (4,144) → Principal (47,386)
```

- **Property** = SNF facility (CCN) - Layer 1: Assets
- **Entity** = Legal entity (LLC, Corp) - Layer 2: Legal Entities
- **Company** = Portfolio/grouping layer - Layer 3: Portfolios
- **Principal** = Individual (owner, officer) - Layer 4: People

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                        3G HEALTHCARE REAL ESTATE ATLAS - 4-LAYER OWNERSHIP ERD                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 LAYER 1: ASSETS                LAYER 2: LEGAL ENTITIES           LAYER 3: PORTFOLIOS            LAYER 4: PEOPLE
┌─────────────────────┐        ┌─────────────────────┐           ┌─────────────────────┐        ┌─────────────────────┐
│   property_master   │        │      entities       │           │      companies      │        │     principals      │
│      (14,054)       │        │     (16,261)        │           │      (4,144)        │        │     (47,386)        │
├─────────────────────┤        ├─────────────────────┤           ├─────────────────────┤        ├─────────────────────┤
│ PK id               │        │ PK id               │           │ PK id               │        │ PK id               │
│ UK ccn              │        │    entity_name      │           │    company_name     │        │    first_name       │
│ UK reapi_property_id│        │    entity_type      │           │    company_type     │        │    last_name        │
│ UK zoho_account_id  │        │ FK company_id ──────┼──────────►│    dba_name         │        │    full_name        │
│    facility_name    │        │    dba_name         │           │    cms_affiliated_  │        │    title            │
│    address          │        │    ein              │           │      entity_id      │        │    email            │
│    city/state/zip   │        │    cms_associate_id │           │    address/city/    │        │    cms_associate_id │
│    lat/lng          │        │    state_of_incorp  │           │    state/zip        │        │    address/city/    │
│    data_quality_    │        │    zoho_entity_id   │           │    zoho_company_id  │        │    state/zip        │
│      score          │        └──────────┬──────────┘           └──────────┬──────────┘        │    zoho_contact_id  │
└──────────┬──────────┘                   │                                 │                   └──────────┬──────────┘
           │                              │                                 │                              │
           │ 1:N                          │ N:1                             │                              │
           ▼                              │                                 │ 1:N                          │
┌─────────────────────────────────┐       │                    ┌───────────┴───────────┐                   │
│ property_entity_relationships   │       │                    │                       │                   │
│          (14,054)               │       │                    ▼                       │                   │
├─────────────────────────────────┤       │    ┌─────────────────────────────────┐     │                   │
│ PK id                           │       │    │ principal_company_relationships │     │                   │
│ FK property_master_id ──────────┼───────┘    │          (62,970)               │◄────┼───────────────────┘
│ FK entity_id ───────────────────┼────────────┤          (Portfolio Level)      │     │
│    relationship_type            │            ├─────────────────────────────────┤     │
│    (facility_operator/          │            │ FK principal_id                 │     │
│     property_owner/lender...)   │            │ FK company_id ──────────────────┼─────┘
│    ownership_percentage         │            │    role                         │
│    effective_date/end_date      │            │    ownership_percentage         │
│    data_source                  │            │    effective_date/end_date      │
└─────────────────────────────────┘            │    data_source                  │
                                               └─────────────────────────────────┘

┌─────────────────────────────────┐
│ principal_entity_relationships  │
│          (98,788)               │
│        (Entity Level)           │
├─────────────────────────────────┤
│ PK id                           │
│ FK principal_id ────────────────┼───────────────────────────────────────────────► principals
│ FK entity_id ───────────────────┼───────────────────────────────────────────────► entities
│    role                         │
│    ownership_percentage         │
│    effective_date/end_date      │
│    data_source                  │
└─────────────────────────────────┘


                                    DEALS SUBSYSTEM
┌─────────────────────┐         ┌─────────────────────┐         ┌─────────────────────┐
│        deals        │────────►│     deals_chow      │         │     deals_sale      │
├─────────────────────┤   1:1   ├─────────────────────┤         ├─────────────────────┤
│ PK id               │         │ PK id               │         │ PK id               │
│ FK property_master_ │         │ FK deal_id (UK)     │         │ FK deal_id (UK)     │
│    id               │         │    chow_type_code   │         │    sale_type        │
│    ccn              │         │    chow_type_text   │         │    price_per_bed    │
│    deal_type        │         │    buyer_enrollment │         │    price_per_sqft   │
│    effective_date   │         │    seller_enrollment│         │    bed_count        │
│    recorded_date    │         └─────────────────────┘         │    cap_rate         │
│    amount           │                                         └─────────────────────┘
│    document_id      │         ┌─────────────────────┐
│    data_source      │────────►│   deals_mortgage    │
└──────────┬──────────┘   1:1   ├─────────────────────┤
           │                    │ PK id               │
           │                    │ FK deal_id (UK)     │
           │                    │    loan_type        │
           │                    │    term_months      │
           │                    │    interest_rate    │
           │                    │    maturity_date    │
           │                    └─────────────────────┘
           │
           │ 1:N
           ▼
┌─────────────────────────────────┐
│        deals_parties            │
├─────────────────────────────────┤
│ PK id                           │
│ FK deal_id                      │
│    party_role (buyer/seller/    │
│      borrower/lender/...)       │
│    party_name                   │
│    party_dba_name               │
│ FK company_id ──────────────────┼───────► companies (optional)
│ FK principal_id ────────────────┼───────► principals (optional)
│    enrollment_id                │
│    associate_id                 │
└─────────────────────────────────┘
```

## Relationship Summary

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                           RELATIONSHIP SUMMARY                                          │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                         │
│  OWNERSHIP HIERARCHY (4 Layers):                                                                        │
│  property_master ◄──1:N──► property_entity_relationships ◄──N:1──► entities ◄──N:1──► companies        │
│                                                                                                         │
│  PRINCIPAL CONTROL (2 Levels):                                                                          │
│  principals ◄──1:N──► principal_entity_relationships ◄──N:1──► entities (entity-level control)        │
│  principals ◄──1:N──► principal_company_relationships ◄──N:1──► companies (portfolio-level control)   │
│                                                                                                         │
│  DEALS:                                                                                                 │
│  property_master ◄──1:N──► deals ◄──1:1──► deals_chow | deals_sale | deals_mortgage                    │
│  deals ◄──1:N──► deals_parties ──► companies (optional) / principals (optional)                        │
│                                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Key Relationships

| From | To | Type | Via |
|------|-----|------|-----|
| Property | Entity | N:M | `property_entity_relationships` |
| Entity | Company | N:1 | `entities.company_id` |
| Principal | Entity | N:M | `principal_entity_relationships` (entity control) |
| Principal | Company | N:M | `principal_company_relationships` (portfolio control) |
| Property | Deal | 1:N | `deals.property_master_id` |
| Deal | Extension | 1:1 | `deals_chow`, `deals_sale`, `deals_mortgage` |
| Deal | Party | 1:N | `deals_parties` |
| Party | Company | N:1 | `deals_parties.company_id` (optional) |
| Party | Principal | N:1 | `deals_parties.principal_id` (optional) |

## Record Counts

| Table | Records | Description |
|-------|---------|-------------|
| `property_master` | 14,054 | SNF facilities from CMS |
| `entities` | 16,261 | Legal entities (11,897 current + 4,364 historical) |
| `companies` | 4,144 | Portfolio companies (619 chains + 264 principal portfolios + 3,261 standalone) |
| `principals` | 47,386 | Individuals (owners, officers, directors) |
| `property_entity_relationships` | 14,054 | Facility-entity links (100% coverage) |
| `principal_entity_relationships` | 98,788 | Principal-entity links (100% entity coverage) |
| `principal_company_relationships` | 88,015 | Principal-company links (portfolio level) |
| `deals` | 4,953 | All transactions |
| `deals_chow` | 4,953 | CHOW-specific data |
| `deals_sale` | 0 | Ready for REAPI |
| `deals_mortgage` | 0 | Ready for REAPI |
| `deals_parties` | 9,906 | Transaction parties |

## Table Details

### Core Tables

#### property_master (Layer 1: Assets)
The foundation table for all SNF facilities.
- **Primary Key:** `id`
- **Unique Keys:** `ccn`, `reapi_property_id`, `zoho_account_id`
- **Source:** CMS Enrollments data

#### entities (Layer 2: Legal Entities)
Specific legal entities (LLCs, Corps) that operate facilities.
- **Primary Key:** `id`
- **Foreign Key:** `company_id` → `companies.id`
- **Types:** opco, propco, management, holding, pe_firm, reit, other
- **Source:** CMS Associate IDs (organization_name from enrollments)

#### companies (Layer 3: Portfolios)
Portfolio/grouping layer that aggregates multiple entities.
- **Primary Key:** `id`
- **Types:** opco, propco, management, holding, pe_firm, reit, other
- **Source:** CMS Affiliated Entities

#### principals (Layer 4: People)
Individual people (owners, officers, directors, managers).
- **Primary Key:** `id`
- **Source:** CMS Owners data (role codes 34, 35, 40-45)

### Junction Tables

#### property_entity_relationships
Links properties to entities with relationship context.
- **Relationship Types:** property_owner, facility_operator, management_services, lender, parent_company, affiliate, consultant, other

#### principal_entity_relationships (Entity-Level Control)
Links principals to specific legal entities.
- **Roles:** ceo, president, cfo, coo, board_member, managing_partner, general_partner, limited_partner, owner_direct, owner_indirect, officer, manager, member, managing_employee, director, other

#### principal_company_relationships (Portfolio-Level Control)
Links principals to portfolio companies.
- **Roles:** portfolio_owner, portfolio_manager, board_member, ceo, president, cfo, coo, owner, owner_direct, owner_indirect, director, officer, manager, managing_employee, vp, other

### Deals Tables

#### deals (base)
All transactions in a unified structure.
- **Deal Types:** chow, sale, mortgage, assignment, satisfaction, lease, refinance, other
- **Data Sources:** cms, reapi, acris, zoho, manual, web_scrape

#### deals_parties
Parties involved in each deal (supports multiple parties per deal).
- **Party Roles:** buyer, seller, borrower, lender, assignor, assignee, grantor, grantee, lessor, lessee, other
- **Optional Links:** Can link to `companies` or `principals` if party is identified

#### deals_chow (extension)
CMS-specific CHOW data (1:1 with deals where deal_type='chow').

#### deals_sale (extension)
Sale-specific data from REAPI (1:1 with deals where deal_type='sale').

#### deals_mortgage (extension)
Mortgage-specific data from REAPI (1:1 with deals where deal_type='mortgage').

## SQL Init Scripts

| Order | Script | Purpose |
|-------|--------|---------|
| 00 | `00_create_schema.sql` | Base tables (property_master, cms_enrollments_staging) |
| 01 | `01_load_csv_staging.sql` | Load CMS enrollments CSV |
| 02 | `02_load_property_master.sql` | Deduplicate into property_master |
| 03 | `03_validation_queries.sql` | Phase 1A validation |
| 04 | `04_phase1b_companies.sql` | Companies (portfolio layer) |
| 05 | `05_phase1b_principals.sql` | Principals + principal_company_relationships |
| 06 | `06_deals_schema.sql` | Deals schema (all deals tables) |
| 07 | `07_phase1b_chow.sql` | Load CHOW data into deals |
| 08 | `08_phase1b_entities.sql` | Entity layer + property_entity_relationships |
| 09 | `09_phase1b_principal_entity.sql` | principal_entity_relationships |
| 10 | `10_phase1b_validation.sql` | Comprehensive 4-layer validation |
| 11 | `11_phase1b_standalone_entities.sql` | Standalone facility entities (100% coverage) |
| 12 | `12_consolidate_standalone_portfolios.sql` | Consolidate multi-facility owners by principal |
| 13 | `13_fix_principal_company_links.sql` | Add principal-company links for standalone/consolidated |
| 14 | `14_fix_deals_entity_links.sql` | Add entity_id to deals_parties, link buyers |
| 15 | `15_historical_entities.sql` | **Historical entities for CHOW sellers (100% coverage)** |

## Critical Graph Queries

### Query 1: Full ownership chain (Property → Entity → Company → Principal)
```sql
SELECT
    pm.facility_name,
    e.entity_name,
    c.company_name AS portfolio_name,
    p.full_name AS principal_name,
    per.role AS entity_role,
    per.ownership_percentage
FROM property_master pm
JOIN property_entity_relationships pre ON pre.property_master_id = pm.id
JOIN entities e ON e.id = pre.entity_id
JOIN companies c ON c.id = e.company_id
LEFT JOIN principal_entity_relationships per ON per.entity_id = e.id
LEFT JOIN principals p ON p.id = per.principal_id
WHERE pm.ccn = '105678'
  AND pre.end_date IS NULL
  AND (per.end_date IS NULL OR per.end_date IS NULL);
```

### Query 2: Get entity's portfolio of facilities
```sql
SELECT pm.facility_name, pm.city, pm.state, pre.relationship_type
FROM entities e
JOIN property_entity_relationships pre ON pre.entity_id = e.id
JOIN property_master pm ON pm.id = pre.property_master_id
WHERE e.entity_name LIKE '%GENESIS%'
  AND pre.end_date IS NULL;
```

### Query 3: Get portfolio company's complete network
```sql
SELECT
    c.company_name AS portfolio_name,
    COUNT(DISTINCT e.id) AS entity_count,
    COUNT(DISTINCT pre.property_master_id) AS facility_count,
    COUNT(DISTINCT per.principal_id) AS principal_count
FROM companies c
LEFT JOIN entities e ON e.company_id = c.id
LEFT JOIN property_entity_relationships pre ON pre.entity_id = e.id AND pre.end_date IS NULL
LEFT JOIN principal_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
GROUP BY c.id, c.company_name
ORDER BY facility_count DESC
LIMIT 20;
```

### Query 4: Find principals controlling multiple entities
```sql
SELECT
    p.full_name,
    COUNT(DISTINCT per.entity_id) AS entity_count,
    GROUP_CONCAT(DISTINCT e.entity_name SEPARATOR ', ') AS entities
FROM principals p
JOIN principal_entity_relationships per ON per.principal_id = p.id
JOIN entities e ON e.id = per.entity_id
WHERE per.end_date IS NULL
GROUP BY p.id, p.full_name
HAVING entity_count > 5
ORDER BY entity_count DESC;
```

### Query 5: Get ownership percentage distribution by role
```sql
SELECT
    role,
    COUNT(*) AS count,
    AVG(ownership_percentage) AS avg_pct,
    MAX(ownership_percentage) AS max_pct
FROM principal_entity_relationships
WHERE ownership_percentage IS NOT NULL
  AND end_date IS NULL
GROUP BY role
ORDER BY count DESC;
```
