# 3G Healthcare Real Estate Atlas

**Navigation and Intelligence System for SNF Ownership Networks**

> Start anywhere. Navigate everywhere.

---

## Current Status: Bidirectional Navigation Complete

**Last Updated:** January 2026

### The Power of Atlas

From **ONE property**, navigate the entire ownership network:

```
Property → Owner (283 properties) → Operating Partners (10 companies)
    ↓                                        ↓
Lenders (6 banks) ←──────────────── Financing History ($3.7B)
    ↓                                        ↓
Other Properties ←── Deal History (12 deals) ←── Market Comps
```

**See it in action:** [Navigation Showcase](docs/research/navigation-showcase.md)

---

## Database Summary

### Core Entities

| Entity | Count | Description |
|--------|-------|-------------|
| Properties | 14,054 | SNF facilities (unique by CCN) |
| Companies | 9,749 | Consolidated ownership groups |
| Entities | 29,508 | Legal entities (LLCs, Corps) |
| Principals | 47,386 | Individual owners, officers, directors |
| Deals | 29,365 | Transactions (mortgages, sales, CHOWs) |

### Relationship Coverage

| Relationship | Count | Properties | Coverage |
|--------------|-------|------------|----------|
| property_owner | 14,094 | 14,054 | **100%** |
| facility_operator | 14,054 | 14,054 | **100%** |
| lender | 12,200 | 6,871 | 48.9% |
| property_borrower | 4,818 | 3,859 | 27.5% |
| property_buyer | 2,242 | 2,172 | 15.5% |
| property_seller | 2,061 | 1,894 | 13.5% |

### Deal Types

| Type | Count | Properties |
|------|-------|------------|
| Mortgage | 19,966 | 7,668 |
| CHOW | 4,953 | 4,804 |
| Sale | 4,446 | 4,149 |

---

## 4-Layer Architecture

```
Property (14,054) → Entity (29,508) → Company (9,749) → Principal (47,386)
```

- **Property** = SNF facility (CCN)
- **Entity** = Legal entity (LLC, Corp) with role (opco, propco, lender, buyer, seller, borrower)
- **Company** = Consolidated ownership group with type (ownership, operating, owner_operator, lending)
- **Principal** = Individual (owner, officer, director)

### Company Types

| Type | Count | Description |
|------|-------|-------------|
| other | 3,955 | Miscellaneous/unclassified |
| owner_operator | 3,903 | Both owns and operates |
| lending | 1,495 | Banks and financial institutions |
| operating | 315 | Pure operators (no ownership) |
| ownership | 81 | Pure REITs/PropCos |

---

## Top Players

### By Ownership (Properties Owned)

| Company | Properties |
|---------|------------|
| OMEGA HEALTHCARE INVESTORS | 438 |
| SABRA HEALTH CARE REIT | 283 |
| THE ENSIGN GROUP | 239 |
| PACS GROUP | 214 |
| WELLTOWER | 213 |
| NATIONAL HEALTH INVESTORS | 188 |
| PORTOPICCOLO GROUP | 175 |
| GOLDEN LIVING | 156 |
| CASCADE CAPITAL GROUP | 152 |
| CARETRUST REIT | 118 |

### By Operations (Properties Operated)

| Company | Properties |
|---------|------------|
| PACS GROUP | 248 |
| THE ENSIGN GROUP | 224 |
| GENESIS HEALTHCARE | 188 |
| LIFE CARE CENTERS OF AMERICA | 179 |
| SABER HEALTHCARE GROUP | 124 |
| NEXION HEALTH | 116 |
| COMMUNICARE HEALTH | 104 |
| PORTOPICCOLO GROUP | 103 |
| TRILOGY HEALTH SERVICES | 100 |

### By Lending (Properties Financed)

| Lender | Properties |
|--------|------------|
| CAPITAL FUNDING | 334 |
| GENERAL ELECTRIC CAPITAL | 219 |
| COLUMN FINANCIAL | 210 |
| JPMORGAN CHASE BANK | 210 |
| KEYBANK | 206 |
| CIBC BANK USA | 199 |
| OXFORD FINANCE | 187 |
| HUNTINGTON NATIONAL BANK | 177 |
| M&T BANK | 172 |
| TRUIST BANK | 171 |

---

## Data Sources

### Loaded

| Source | Data |
|--------|------|
| CMS Enrollments | Facilities, operators, principals |
| CMS CHOW | Change of ownership transactions |
| REAPI | Sales, mortgages, property details |
| CMS Quality | Star ratings, inspection scores |

### Pending

| Source | Data |
|--------|------|
| Zoho CRM | Principals (enhanced contact data) |

---

## Quick Start

### Prerequisites

- Docker Desktop
- Node.js 18+
- CMS data files (from data.cms.gov)

### Setup

```bash
# 1. Clone and setup
git clone https://github.com/3GHCRE/atlas.git
cd atlas
npm install
cp .env.example .env  # Configure credentials

# 2. Start database
cd docker && docker-compose up -d

# 3. Run initialization scripts
docker exec -i 3ghcre-mysql mysql -u root -pdevpass atlas < init/00_create_schema.sql
# ... run remaining init scripts in order

# 4. Run data loading scripts
node scripts/load-lenders.js
node scripts/load-deal-parties-v2.js
```

### Explore the Data

```bash
# Full database summary
node scripts/full-atlas-summary.js

# Navigation showcase
node scripts/showcase-enriched.js

# Query a specific company
node scripts/query-company.js "SABRA"
```

---

## Schema Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ property_master │────▶│    entities     │────▶│   companies     │
│    (14,054)     │     │    (29,508)     │     │    (9,749)      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              property_entity_relationships (49,469)              │
│  relationship_type: property_owner | facility_operator | lender │
│                     property_buyer | property_seller | borrower │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     deals       │────▶│  deals_parties  │     │   principals    │
│    (29,365)     │     │    (19,951)     │     │    (47,386)     │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐ ┌────────┐
│ _chow  │ │ _sale  │ │_mortg. │
│(4,953) │ │(4,446) │ │(19,966)│
└────────┘ └────────┘ └────────┘
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `property_master` | SNF facilities (CCN is unique key) |
| `entities` | Legal entities with type (opco, propco, lender, buyer, seller, borrower) |
| `companies` | Consolidated groups with type (ownership, operating, owner_operator, lending) |
| `property_entity_relationships` | Links properties to entities with relationship type |
| `principals` | Individual people |
| `deals` | All transactions |
| `deals_chow` / `deals_sale` / `deals_mortgage` | Deal type extensions |
| `deals_parties` | Buyer/seller/lender roles per deal |
| `quality_ratings` | CMS star ratings and inspection data |

---

## Documentation

| Document | Description |
|----------|-------------|
| [Navigation Showcase](docs/research/navigation-showcase.md) | E2E example of bidirectional navigation |
| [ATLAS_ERD](docs/ATLAS_ERD.md) | Complete ERD with record counts |
| [REAPI Schema](docs/data/REAPI_SCHEMA.md) | Real estate data schema |

---

## Scripts

### Data Loading

| Script | Purpose |
|--------|---------|
| `load-lenders.js` | Load lenders from deals into companies/entities |
| `load-deal-parties-v2.js` | Load buyers, sellers, borrowers |
| `load-propco-batch.js` | Batch load PropCo ownership data |

### Validation

| Script | Purpose |
|--------|---------|
| `validate-ownership.js` | Validate owner/operator data quality |
| `validate-lenders.js` | Validate lender data quality |
| `full-atlas-summary.js` | Complete database summary |

### Analysis

| Script | Purpose |
|--------|---------|
| `showcase-enriched.js` | Generate navigation showcase |
| `showcase-navigation.js` | Simple navigation demo |
| `query-company.js` | Query company details |

---

## Next Steps

- [ ] Load CRM Principals for complete people network
- [ ] Build MCP tools for Claude integration
- [ ] Create API endpoints for navigation queries
- [ ] Add real-time CMS data sync

---

## License

Proprietary - 3G Healthcare Real Estate
