# 3G Healthcare Real Estate Atlas

**Navigation and Intelligence System for SNF Ownership Networks**

> Start anywhere. Navigate everywhere.

---

## Current Status: Phase 1B Revised Complete (Entity Layer Added)

**Last Updated:** January 2026

### 4-Layer Ownership Architecture

```
Property (14,054) → Entity (11,897) → Company (4,377) → Principal (47,386)
```

- **Property** = SNF facility (CCN)
- **Entity** = Legal entity (LLC, Corp) - e.g., "Panama City FL Propco LLC"
- **Company** = Portfolio/grouping layer - e.g., "Portopicolo Group"
- **Principal** = Individual (owner, officer, director)

### Data Loaded from CMS

| Table | Records | Description |
|-------|---------|-------------|
| `property_master` | 14,054 | SNF facilities (unique by CCN) |
| `entities` | 11,897 | Legal entities (opcos from CMS Associate IDs) |
| `companies` | 4,377 | Portfolio companies (619 chains + 3,758 standalone) |
| `principals` | 47,386 | Individual owners, officers, directors, managers |
| `property_entity_relationships` | 14,054 | Facility → Entity links (100% coverage) |
| `principal_entity_relationships` | 98,788 | Principal → Entity role assignments |
| `principal_company_relationships` | 62,970 | Principal → Company (portfolio level) |
| `deals` | 4,953 | Change of Ownership (CHOW) transactions |
| `deals_parties` | 9,906 | Buyers and sellers on CHOW deals |

### Linkage Quality

| Relationship | Coverage |
|--------------|----------|
| Properties linked to Entity | **100%** |
| Entities linked to Principals | 100% |
| Principals with Entity Roles | 57.4% |
| CHOW Deals linked to Property | 97.0% |
| CHOW Buyers linked to Opco | 82.2% |

### Top Portfolios by Entity Count

| Portfolio | Entities | Facilities |
|-----------|----------|------------|
| PACS GROUP | 240 | 240 |
| THE ENSIGN GROUP | 225 | 350 |
| GENESIS HEALTHCARE | 178 | 190 |
| LIFE CARE CENTERS OF AMERICA | 140 | 179 |
| SABER HEALTHCARE GROUP | 106 | 124 |

### What We Built

1. **Docker MySQL Infrastructure** - One command setup with persistent data
2. **Staging Tables** - Raw CMS data preserved for reprocessing
3. **Normalized Schema** - Clean relational model with proper FKs
4. **Deals System** - Unified transaction tracking ready for REAPI (sales, mortgages)
5. **Full ERD Documentation** - See [docs/ATLAS_ERD.md](docs/ATLAS_ERD.md)

### Next Phase: REAPI + Zoho Integration

- Property enrichment (beds, sqft, year built, coordinates)
- Sales transactions with pricing
- Mortgage/financing data
- Zoho CRM sync

---

## Overview

Atlas is a **two-tier system** for navigating skilled nursing facility (SNF) ownership networks:

- **Tier 1 (Navigation Tools)**: Graph navigation engine querying CMS, REAPI, Zoho, and Graph data
- **Tier 2 (Intelligence Tools)**: Orchestrates navigation + web research + AI synthesis into deliverables

**Core Architecture**: Property → Entity → Company → Principal (4-layer ownership hierarchy)

---

## Quick Start

### Prerequisites

- Docker Desktop
- CMS data files (download from data.cms.gov):
  - `SNF_Enrollments_2025.12.02.csv`
  - `SNF_All_Owners_2025.12.02.csv`
  - `SNF_CHOW_2025.10.01.csv`
  - `SNF_CHOW_Owners_2025.10.01.csv`

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/3GHCRE/atlas.git
cd atlas

# 2. Place CMS CSV files in root directory

# 3. Start MySQL container
cd docker
docker-compose up -d

# 4. Wait for healthy status
docker-compose ps

# 5. Load CMS data (run as root for FILE privilege)
docker exec -i 3ghcre-mysql mysql -u root -pdevpass atlas < init/01_load_csv_staging.sql
docker exec -i 3ghcre-mysql mysql -u root -pdevpass atlas < init/02_load_property_master.sql
# ... continue with remaining scripts
```

### SQL Init Scripts (Execute in Order)

| Script | Purpose |
|--------|---------|
| `00_create_schema.sql` | Base tables and staging |
| `01_load_csv_staging.sql` | Load CMS enrollments CSV |
| `02_load_property_master.sql` | Deduplicate facilities by CCN |
| `03_validation_queries.sql` | Phase 1A validation |
| `04_phase1b_companies.sql` | Companies (portfolio layer) |
| `05_phase1b_principals.sql` | Principals + company links |
| `06_deals_schema.sql` | Deals tables (base + extensions) |
| `07_phase1b_chow.sql` | Load CHOW into deals |
| `08_phase1b_entities.sql` | Entity layer + property-entity links |
| `09_phase1b_principal_entity.sql` | Principal-entity relationships |
| `10_phase1b_validation.sql` | Comprehensive 4-layer validation |
| `11_phase1b_standalone_entities.sql` | **Standalone facility entities (100% coverage)** |

---

## Schema Overview (4-Layer Architecture)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                        3G HEALTHCARE REAL ESTATE ATLAS - 4-LAYER OWNERSHIP ERD                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 LAYER 1: ASSETS                LAYER 2: LEGAL ENTITIES           LAYER 3: PORTFOLIOS            LAYER 4: PEOPLE
┌─────────────────────┐        ┌─────────────────────┐           ┌─────────────────────┐        ┌─────────────────────┐
│   property_master   │        │      entities       │           │      companies      │        │     principals      │
│      (14,054)       │        │     (11,897)        │           │      (4,377)        │        │     (47,386)        │
├─────────────────────┤        ├─────────────────────┤           ├─────────────────────┤        ├─────────────────────┤
│ PK id               │        │ PK id               │           │ PK id               │        │ PK id               │
│ UK ccn              │        │    entity_name      │           │    company_name     │        │    first_name       │
│    facility_name    │        │    entity_type      │           │    company_type     │        │    last_name        │
│    address          │        │ FK company_id ──────┼──────────►│    dba_name         │        │    full_name        │
│    city/state/zip   │        │    dba_name         │           │    cms_affiliated_  │        │    title            │
│    lat/lng          │        │    cms_associate_id │           │      entity_id      │        │    cms_associate_id │
└──────────┬──────────┘        │    state_of_incorp  │           │    address/city/    │        │    address/city/    │
           │                   └──────────┬──────────┘           │    state/zip        │        │    state/zip        │
           │                              │                      └──────────┬──────────┘        └──────────┬──────────┘
           │ 1:N                          │ N:1                             │                              │
           ▼                              │                                 │ 1:N                          │
┌─────────────────────────────────┐       │                    ┌───────────┴───────────┐                   │
│ property_entity_relationships   │       │                    │                       │                   │
│          (14,054)               │       │                    ▼                       │                   │
├─────────────────────────────────┤       │    ┌─────────────────────────────────┐     │                   │
│ FK property_master_id ──────────┼───────┘    │ principal_company_relationships │     │                   │
│ FK entity_id ───────────────────┼────────────┤          (62,970)               │◄────┼───────────────────┘
│    relationship_type            │            ├─────────────────────────────────┤     │
│    (facility_operator/          │            │ FK principal_id                 │     │
│     property_owner/lender...)   │            │ FK company_id ──────────────────┼─────┘
│    data_source                  │            │    role (portfolio level)       │
└─────────────────────────────────┘            │    ownership_percentage         │
                                               └─────────────────────────────────┘
           │
           │ 1:N
           ▼
┌─────────────────────────────────┐            ┌─────────────────────────────────┐
│ principal_entity_relationships  │◄───────────┤       (Entity-level roles)      │
│          (98,788)               │            └─────────────────────────────────┘
├─────────────────────────────────┤
│ FK principal_id ────────────────┼───────────────────────────────────────────────► principals
│ FK entity_id ───────────────────┼───────────────────────────────────────────────► entities
│    role (entity level)          │
│    ownership_percentage         │
│    data_source                  │
└─────────────────────────────────┘
```

### Relationship Summary

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  property_master ◄──1:N──► property_entity_relationships ◄──N:1──► entities ◄──N:1──► companies        │
│                                                                                                         │
│  principals ◄──1:N──► principal_entity_relationships ◄──N:1──► entities (entity-level control)        │
│                                                                                                         │
│  principals ◄──1:N──► principal_company_relationships ◄──N:1──► companies (portfolio-level control)   │
│                                                                                                         │
│  property_master ◄──1:N──► deals ◄──1:1──► deals_chow | deals_sale | deals_mortgage                    │
│                                                                                                         │
│  deals ◄──1:N──► deals_parties ──► companies (optional) / principals (optional)                        │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Relationships

| From | To | Type | Via |
|------|-----|------|-----|
| Property | Entity | N:M | `property_entity_relationships` |
| Entity | Company | N:1 | `entities.company_id` |
| Principal | Entity | N:M | `principal_entity_relationships` (entity control) |
| Principal | Company | N:M | `principal_company_relationships` (portfolio control) |
| Property | Deal | 1:N | `deals.property_master_id` |
| Deal | Extension | 1:1 | `deals_chow`, `deals_sale`, `deals_mortgage` |
| Deal | Party | 1:N | `deals_parties` |

See full ERD documentation: [docs/ATLAS_ERD.md](docs/ATLAS_ERD.md)

---

## Documentation

### Playbook (Implementation Guides)

| Document | Description |
|----------|-------------|
| [01_Concept_Graph](playbook/01_Concept_Graph.md) | Property → Company → Principal relationships |
| [02_Data_Sources_Map](playbook/02_Data_Sources_Map.md) | CMS + REAPI + Zoho data flow |
| [03_Schema_ERD](playbook/03_Schema_ERD.md) | Database schema reference |
| [04_Zoho_Module_Map](playbook/04_Zoho_Module_Map.md) | CRM configuration guide |
| [05_Implementation_Roadmap](playbook/05_Implementation_Roadmap.md) | Sprint plan |
| [06_Walkthrough_Example](playbook/06_Walkthrough_Example.md) | End-to-end example |
| [07_Toolkit_Orchestration](playbook/07_Toolkit_Orchestration.md) | Tool integration patterns |

### Technical Docs

| Document | Description |
|----------|-------------|
| [ATLAS_ERD](docs/ATLAS_ERD.md) | Complete ERD with record counts |

---

## The Core Problem Atlas Solves

```
ONE Property → MULTIPLE Companies (different roles) → MULTIPLE Principals
```

- **Opco** (Operator) runs the facility → from CMS Affiliated Entities
- **Propco** (Landlord) owns real estate → from REAPI (Phase 2)
- **MgmtCo** provides services → from CMS

Each company has its OWN principal list and portfolio. **Operating portfolio ≠ Ownership portfolio.**

### The 60% Rule

~60% of CMS individual owners also appear in REAPI as property owners. When addresses match:

```
CMS Owner Address = REAPI Owner Address → Same Principal controls both Opco AND Propco
```

This reveals hidden beneficial ownership across operating and property-owning entities.

---

## Key Tables

| Table | Purpose |
|-------|---------|
| `property_master` | Rosetta Stone linking CCN ↔ REAPI ID ↔ Zoho ID |
| `entities` | **Legal entities (LLCs, Corps)** - the operator level |
| `companies` | **Portfolio layer** - groups multiple entities |
| `property_entity_relationships` | **Links properties to entities** with `relationship_type` |
| `principal_entity_relationships` | **Links principals to entities** (entity-level control) |
| `principals` | Individual people (owners, executives) |
| `principal_company_relationships` | Links people to companies (portfolio-level control) |
| `deals` | All transactions (CHOWs, sales, mortgages) |
| `deals_parties` | Buyer/seller/lender roles per transaction |
| `deals_chow` | CMS CHOW-specific fields |
| `deals_sale` | REAPI sale-specific fields |
| `deals_mortgage` | REAPI mortgage-specific fields |

---

## License

Proprietary - 3G Healthcare Real Estate
