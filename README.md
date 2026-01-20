# 3G Healthcare Real Estate Atlas

**Navigation and Intelligence System for SNF Ownership Networks**

> Start anywhere. Navigate everywhere.

---

## Current Status: Phase 1 Complete (CMS Data Loaded)

**Last Updated:** January 2026

### Data Loaded from CMS

| Table | Records | Description |
|-------|---------|-------------|
| `property_master` | 14,054 | SNF facilities (unique by CCN) |
| `companies` | 619 | Operating companies (Opcos from CMS Affiliated Entities) |
| `principals` | 47,386 | Individual owners, officers, directors, managers |
| `property_company_relationships` | 9,928 | Facility → Operator links (70.6% coverage) |
| `principal_company_relationships` | 62,970 | Principal → Company role assignments |
| `deals` | 4,953 | Change of Ownership (CHOW) transactions |
| `deals_parties` | 9,906 | Buyers and sellers on CHOW deals |

### Linkage Quality

| Relationship | Coverage |
|--------------|----------|
| Properties linked to Operator | 70.6% |
| Principals linked to Company | 37.5% |
| CHOW Deals linked to Property | 97.0% |
| CHOW Buyers linked to Opco | 82.2% |

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

**Core Architecture**: Property ↔ Company ↔ Principal (with Companies as the many-to-many bridge)

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
| `04_phase1b_companies.sql` | Companies + property links |
| `05_phase1b_principals.sql` | Principals + company links |
| `06_deals_schema.sql` | Deals tables (base + extensions) |
| `07_phase1b_chow.sql` | Load CHOW into deals |

---

## Schema Overview

```
property_master (14,054)
    │
    ├──1:N──► property_company_relationships (9,928)
    │              │
    │              └──N:1──► companies (619)
    │                            │
    │                            └──1:N──► principal_company_relationships (62,970)
    │                                           │
    │                                           └──N:1──► principals (47,386)
    │
    └──1:N──► deals (4,953)
                  │
                  ├──1:1──► deals_chow (CMS CHOWs)
                  ├──1:1──► deals_sale (ready for REAPI)
                  ├──1:1──► deals_mortgage (ready for REAPI)
                  │
                  └──1:N──► deals_parties (9,906)
                                │
                                ├──► companies (if known opco)
                                └──► principals (if individual)
```

See full ERD: [docs/ATLAS_ERD.md](docs/ATLAS_ERD.md)

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
| `companies` | Opco, Propco, MgmtCo entities |
| `property_company_relationships` | Links properties to companies with `relationship_type` |
| `principals` | Individual people (owners, executives) |
| `principal_company_relationships` | Links people to companies with `role` |
| `deals` | All transactions (CHOWs, sales, mortgages) |
| `deals_parties` | Buyer/seller/lender roles per transaction |
| `deals_chow` | CMS CHOW-specific fields |
| `deals_sale` | REAPI sale-specific fields |
| `deals_mortgage` | REAPI mortgage-specific fields |

---

## License

Proprietary - 3G Healthcare Real Estate
