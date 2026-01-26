# 3G Healthcare Real Estate Atlas

**Navigation and Intelligence System for SNF Ownership Networks**

> Start anywhere. Navigate everywhere.

---

## Current Status: Production Ready

**Last Updated:** January 26, 2026

### Recent Accomplishments

- **MCP Server Complete** - 70 tools across 9 categories for Claude integration
- **CMS Certifier Linkage** - Automated principal discovery from CMS enrollment data
- **90.6% Principal Coverage** - Companies with 5+ properties now have linked principals
- **PropCo/OpCo Architecture** - Proper entity-level ownership structure linked to parent companies
- **SEC/Nonprofit Integration** - EDGAR filings and Form 990 lookup for REITs and nonprofits

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
| Companies | 10,489 | Consolidated ownership groups |
| Entities | 29,574 | Legal entities (LLCs, Corps) |
| Principals | 54,714 | Individual owners, officers, directors |
| Deals | 29,365 | Transactions (mortgages, sales, CHOWs) |

### Relationship Coverage

| Relationship | Count | Properties | Coverage |
|--------------|-------|------------|----------|
| property_owner | 14,094 | 14,054 | **100%** |
| facility_operator | 14,054 | 14,054 | **100%** |
| lender | 12,200 | 6,871 | 48.9% |
| property_buyer | 5,953 | 5,953 | **42.4%** |
| property_borrower | 5,680 | 5,680 | **40.4%** |
| property_seller | 2,599 | 2,599 | 18.5% |

### Deal Types

| Type | Count | Properties |
|------|-------|------------|
| Mortgage | 19,966 | 7,668 |
| CHOW | 4,953 | 4,804 |
| Sale | 4,446 | 4,149 |

---

## 4-Layer Architecture

```
Property (14,054) → Entity (29,574) → Company (10,489) → Principal (54,714)
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
│    (14,054)     │     │    (29,574)     │     │    (10,489)     │
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
│    (29,365)     │     │    (59,464)     │     │    (54,714)     │
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

## Research Workflows

Atlas includes powerful research workflow scripts for market intelligence:

```bash
# Trace full ownership chain for any property
node scripts/research/trace-ownership-chain.js "Mulberry Creek"

# Track REIT disposition activity
node scripts/research/reit-disposition-tracker.js "Omega"

# Monitor operator acquisition activity
node scripts/research/operator-expansion-monitor.js "Ensign"

# Analyze lender portfolio exposure
node scripts/research/lender-exposure-analyzer.js "Capital Funding"

# State or national market analysis
node scripts/research/market-activity-analyzer.js VA
node scripts/research/market-activity-analyzer.js  # National overview
```

| Workflow | Purpose |
|----------|---------|
| `trace-ownership-chain.js` | Property → Entity → Company → Related Properties → Deal History |
| `reit-disposition-tracker.js` | Track REIT sales, identify buyers, disposition trends |
| `operator-expansion-monitor.js` | Monitor operator acquisitions, portfolio growth |
| `lender-exposure-analyzer.js` | Portfolio risk by operator/owner/geography/quality |
| `market-activity-analyzer.js` | Transaction trends, price per bed, top buyers |

**See example output:** [Comprehensive Research Brief](docs/research/comprehensive-research-example.md)

---

## Documentation

| Document | Description |
|----------|-------------|
| [Navigation Showcase](docs/research/navigation-showcase.md) | E2E example of bidirectional navigation |
| [Comprehensive Research Example](docs/research/comprehensive-research-example.md) | Full workflow chain demonstration |
| [NC Portfolio Restructuring](docs/research/nc-portfolio-restructuring-2025.md) | Internal restructuring case study |
| [Kissito-CareTrust Acquisition](docs/research/kissito-caretrust-acquisition-2025.md) | Third-party sale analysis |
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

### Research (scripts/research/)

| Script | Purpose |
|--------|---------|
| `trace-ownership-chain.js` | Full ownership network trace |
| `reit-disposition-tracker.js` | REIT sales and buyer tracking |
| `operator-expansion-monitor.js` | Operator acquisition activity |
| `lender-exposure-analyzer.js` | Lender portfolio risk analysis |
| `market-activity-analyzer.js` | State/national transaction trends |

---

## MCP Server

The Atlas MCP server provides **70 tools** for Claude integration across 9 categories:

| Category | Tools | Description |
|----------|-------|-------------|
| Record | 9 | Get/search properties, entities, companies, principals, deals |
| Graph | 12 | Trace ownership chains, navigate networks, find paths |
| Market | 5 | Market statistics, top buyers/sellers/lenders, hot markets |
| Hierarchy | 4 | PropCo/OpCo portfolios, parent company hierarchy |
| Performance | 5 | CMS quality ratings, staffing, cost reports, Medicaid rates |
| Intelligence | 15 | SEC EDGAR, ProPublica 990s, CMS compliance, legal/court, news |
| Analytics | 9 | Portfolio benchmarking, quality scoring, trend analysis, risk |
| Geographic | 4 | Radius search, market competition, spatial analysis |
| Workflow | 7 | Watchlists, saved searches, change detection |

**[Full MCP Documentation →](mcp/README.md)**

---

## Next Steps

- [x] ~~Load deal party relationships~~ ✓ 42.4% buyer, 40.4% borrower coverage
- [x] ~~Build research workflow scripts~~ ✓ 5 workflows complete
- [x] ~~Build MCP tools for Claude integration~~ ✓ 70 tools across 9 categories
- [ ] Integrate Zoho CRM for prospect tracking
- [ ] Create API endpoints for navigation queries
- [ ] Add real-time CMS data sync

---

## License

Proprietary - 3G Healthcare Real Estate
