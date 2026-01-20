# 3G Healthcare Real Estate Atlas - Entity Relationship Diagram

**Last Updated:** January 2025

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    3G HEALTHCARE REAL ESTATE ATLAS - ERD                                │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘

                                           ┌─────────────────────┐
                                           │     principals      │
                                           ├─────────────────────┤
                                           │ PK id               │
                                           │    first_name       │
                                           │    last_name        │
                                           │    full_name        │
                                           │    title            │
                                           │    email            │
                                           │    cms_associate_id │
                                           │    address/city/    │
                                           │    state/zip        │
                                           │    zoho_contact_id  │
                                           └──────────┬──────────┘
                                                      │
                                                      │ 1:N
                                                      ▼
┌─────────────────────┐                  ┌─────────────────────────────────┐                  ┌─────────────────────┐
│   property_master   │                  │ principal_company_relationships │                  │      companies      │
├─────────────────────┤                  ├─────────────────────────────────┤                  ├─────────────────────┤
│ PK id               │                  │ PK id                           │                  │ PK id               │
│ UK ccn              │                  │ FK principal_id ────────────────┼──────────────────│    company_name     │
│ UK reapi_property_id│                  │ FK company_id ──────────────────┼──────────────────│    company_type     │
│ UK zoho_account_id  │                  │    role (owner/ceo/officer...)  │                  │    dba_name         │
│    facility_name    │                  │    role_detail                  │                  │    ein              │
│    address          │                  │    ownership_percentage         │                  │    cms_affiliated_  │
│    city/state/zip   │                  │    effective_date/end_date      │                  │      entity_id      │
│    lat/lng          │                  │    data_source                  │                  │    address/city/    │
│    data_quality_    │                  └─────────────────────────────────┘                  │    state/zip        │
│      score          │                                                                       │    zoho_company_id  │
└──────────┬──────────┘                                                                       └──────────┬──────────┘
           │                                                                                             │
           │ 1:N                                                                                         │ 1:N
           ▼                                                                                             ▼
┌─────────────────────────────────┐                                              ┌─────────────────────────────────┐
│ property_company_relationships  │                                              │ property_company_relationships  │
├─────────────────────────────────┤                                              │        (same table)             │
│ PK id                           │◄─────────────────────────────────────────────┤                                 │
│ FK property_master_id ──────────┼──────────────────────────────────────────────│ FK company_id                   │
│    relationship_type            │                                              │                                 │
│    (facility_operator/          │                                              │                                 │
│     property_owner/lender...)   │                                              │                                 │
│    ownership_percentage         │                                              │                                 │
│    effective_date/end_date      │                                              │                                 │
│    data_source                  │                                              │                                 │
└─────────────────────────────────┘                                              └─────────────────────────────────┘
           │
           │
           │ 1:N
           ▼
┌─────────────────────┐         ┌─────────────────────┐         ┌─────────────────────┐
│        deals        │────────►│     deals_chow      │         │     deals_sale      │
├─────────────────────┤   1:1   ├─────────────────────┤         ├─────────────────────┤
│ PK id               │         │ PK id               │         │ PK id               │
│ FK property_master_ │         │ FK deal_id (UK) ────┼─────────│ FK deal_id (UK)     │
│    id               │         │    chow_type_code   │         │    sale_type        │
│    ccn              │         │    chow_type_text   │         │    price_per_bed    │
│    deal_type        │         │    buyer_enrollment │         │    price_per_sqft   │
│    (chow/sale/      │         │    buyer_associate  │         │    bed_count        │
│     mortgage/...)   │         │    seller_enrollment│         │    cap_rate         │
│    effective_date   │         │    seller_associate │         │    occupancy        │
│    recorded_date    │         └─────────────────────┘         │    reapi_txn_id     │
│    amount           │                                         └─────────────────────┘
│    document_id      │         ┌─────────────────────┐
│    data_source      │────────►│   deals_mortgage    │
└──────────┬──────────┘   1:1   ├─────────────────────┤
           │                    │ PK id               │
           │                    │ FK deal_id (UK) ────┼─────────────────────────────────────┐
           │                    │    loan_type        │                                     │
           │                    │    term_months      │                                     │
           │                    │    interest_rate    │                                     │
           │                    │    maturity_date    │                                     │
           │                    │    is_refinance     │                                     │
           │                    └─────────────────────┘                                     │
           │                                                                                │
           │ 1:N                                                                            │
           ▼                                                                                │
┌─────────────────────────────────┐                                                         │
│        deals_parties            │                                                         │
├─────────────────────────────────┤                                                         │
│ PK id                           │                                                         │
│ FK deal_id ─────────────────────┼─────────────────────────────────────────────────────────┘
│    party_role (buyer/seller/    │
│      borrower/lender/...)       │
│    party_name                   │
│    party_dba_name               │
│ FK company_id ──────────────────┼───────► companies (optional - if party is known opco)
│ FK principal_id ────────────────┼───────► principals (optional - if party is individual)
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
│  property_master ◄──1:N──► property_company_relationships ◄──N:1──► companies                          │
│                                                                                                         │
│  principals ◄──1:N──► principal_company_relationships ◄──N:1──► companies                              │
│                                                                                                         │
│  property_master ◄──1:N──► deals ◄──1:1──► deals_chow | deals_sale | deals_mortgage                    │
│                                                                                                         │
│  deals ◄──1:N──► deals_parties ──► companies (optional)                                                │
│                               ──► principals (optional)                                                 │
│                                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Key Relationships

| From | To | Type | Via |
|------|-----|------|-----|
| Property | Company | N:M | `property_company_relationships` |
| Principal | Company | N:M | `principal_company_relationships` |
| Property | Deal | 1:N | `deals.property_master_id` |
| Deal | Extension | 1:1 | `deals_chow`, `deals_sale`, `deals_mortgage` |
| Deal | Party | 1:N | `deals_parties` |
| Party | Company | N:1 | `deals_parties.company_id` (optional) |
| Party | Principal | N:1 | `deals_parties.principal_id` (optional) |

## Record Counts

| Table | Records | Description |
|-------|---------|-------------|
| `property_master` | 14,054 | SNF facilities from CMS |
| `companies` | 619 | Operating companies (opcos) |
| `principals` | 47,386 | Individuals (owners, officers, directors) |
| `property_company_relationships` | 9,928 | Facility-operator links |
| `principal_company_relationships` | 62,970 | Principal-company links |
| `deals` | 4,953 | All transactions |
| `deals_chow` | 4,953 | CHOW-specific data |
| `deals_sale` | 0 | Ready for REAPI |
| `deals_mortgage` | 0 | Ready for REAPI |
| `deals_parties` | 9,906 | Transaction parties |

## Table Details

### Core Tables

#### property_master
The foundation table for all SNF facilities.
- **Primary Key:** `id`
- **Unique Keys:** `ccn`, `reapi_property_id`, `zoho_account_id`
- **Source:** CMS Enrollments data

#### companies
Operating companies (opcos) that operate SNF facilities.
- **Primary Key:** `id`
- **Types:** opco, propco, management, holding, pe_firm, reit, other
- **Source:** CMS Affiliated Entities

#### principals
Individual people (owners, officers, directors, managers).
- **Primary Key:** `id`
- **Source:** CMS Owners data (role codes 34, 35, 40-45)

### Junction Tables

#### property_company_relationships
Links properties to companies with relationship context.
- **Relationship Types:** property_owner, facility_operator, management_services, lender, parent_company, affiliate, consultant, other

#### principal_company_relationships
Links principals to companies with role context.
- **Roles:** owner, director, officer, ceo, cfo, coo, president, vp, manager, managing_employee, other

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
| 04 | `04_phase1b_companies.sql` | Companies + property_company_relationships |
| 05 | `05_phase1b_principals.sql` | Principals + principal_company_relationships |
| 06 | `06_deals_schema.sql` | Deals schema (all deals tables) |
| 07 | `07_phase1b_chow.sql` | Load CHOW data into deals |
