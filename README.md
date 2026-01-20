# 3G Healthcare Real Estate Atlas

**Navigation and Intelligence System for SNF Ownership Networks**

> Start anywhere. Navigate everywhere.

---

## Overview

Atlas is a **two-tier system** for navigating skilled nursing facility (SNF) ownership networks:

- **Tier 1 (41 Navigation Tools)**: Graph navigation engine querying CMS, REAPI, Zoho, and Graph data
- **Tier 2 (11 Intelligence Tools)**: Orchestrates navigation + web research + AI synthesis into deliverables

**Core Architecture**: Property ↔ Company ↔ Principal (with Companies as the many-to-many bridge)

---

## Documentation Index

### Core Technical Series (Numbered)

| # | Document | Description |
|---|----------|-------------|
| 01 | [Concept Graph](playbook/01_Concept_Graph.md) | Visual diagram showing Property → Company → Principal relationships. Explains Opco/Propco/MgmtCo roles and why the graph structure matters. |
| 02 | [Data Sources Map](playbook/02_Data_Sources_Map.md) | Data flow from CMS + REAPI + Zoho into MySQL. The **60% rule** for address matching. Update frequencies and provenance tracking. |
| 03 | [Schema ERD](playbook/03_Schema_ERD.md) | Complete database schema - 6 tables with fields, indexes, foreign keys. Critical SQL queries for graph traversal. |
| 04 | [Zoho Module Map](playbook/04_Zoho_Module_Map.md) | CRM configuration guide. Companies module + junction modules (CompanyxProperty, CompanyxPrincipal). Picklists, validation rules, API endpoints. |
| 05 | [Implementation Roadmap](playbook/05_Implementation_Roadmap.md) | **10-day sprint to production**. Day-by-day tasks with SQL scripts, validation checkpoints, Python sync scripts. |
| 06 | [Walkthrough Example](playbook/06_Walkthrough_Example.md) | ST ANDREWS BAY SNF traced through the complete system. Shows exact SQL inserts, address matching, and hidden ownership discovery. |
| 07 | [Toolkit Orchestration](playbook/07_Toolkit_Orchestration.md) | How the 52 tools work together. Tier 1 navigation patterns, Tier 2 intelligence workflows, real-world orchestration examples. |

### Reference Documents

| Document | Description |
|----------|-------------|
| [Atlas Playbook](3G_Healthcare_Atlas_Playbook.md) | Comprehensive playbook covering entity model, tool catalog, MCP server architecture, use cases, deployment, and roadmap. |
| [Presentation Deck](3G_Healthcare_Atlas_Presentation_Deck.md) | 6-slide executive presentation structure. Palantir-style design with flip cards. VÄV Atlas design system tokens. |
| [Complete Data Architecture](Complete_Data_Architecture_PropertyxCompanyxPrincipal.md) | Full technical architecture for Property Master linking + many-to-many company relationships. CCN ↔ REAPI ID ↔ Zoho ID mapping. |
| [CMS SNF Data Fields](CMS_SNF_Data_Fields_For_Graph_Building.md) | CMS data dictionary. Provider Information, SNF All Owners, and CHOW datasets. Affiliated Entity logic and field mappings. |

---

## Quick Reference

### The Core Problem

```
ONE Property → MULTIPLE Companies (different roles) → MULTIPLE Principals
```

- **Propco** (Landlord) owns real estate → from REAPI
- **Opco** (Operator) runs the facility → from CMS Affiliated Entities  
- **MgmtCo** provides services → from CMS

Each company has its OWN principal list and portfolio. Operating portfolio ≠ Ownership portfolio.

### The 60% Rule

~60% of CMS individual owners also appear in REAPI as property owners. When addresses match:
```
CMS Owner Address = REAPI Owner Address → Same Principal controls both Opco AND Propco
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `property_master` | Rosetta Stone linking CCN ↔ REAPI ID ↔ Zoho ID |
| `companies` | Opco, Propco, MgmtCo entities |
| `property_company_relationships` | Links properties to companies with `relationship_type` |
| `principals` | Individual people (owners, executives) |
| `principal_company_relationships` | Links people to companies with `role` |
| `deals` | Transaction history (sales, CHOWs, refinances) |
| `deal_participants` | Buyer/seller/lender roles per transaction |
| `markets` | Geographic market definitions (state, MSA, custom) |
| `segments` | Behavioral/strategic company tags |
| `company_segments` | Links companies to segments with confidence scores |
| `market_activity` | Time-series market metrics (deal volume, pricing) |

### Tool Tiers

**Tier 1 - Navigation (41 tools)**
- Property Navigation (20): CMS, REAPI, Deals, CRM, Market queries
- Network Navigation (6): Ownership chains, portfolios, graph visualization
- Ownership Intelligence (4): History, partnerships, connected principals
- Market Intelligence (5): Trends, comparisons, benchmarks
- Markets & Segments (4): Geographic filtering, behavioral tagging
- Utility (2): Database stats, data quality

**Tier 2 - Intelligence (11 tools)**
- Contact Intelligence (3): `generate_contact_brief`, `research_principal`, `batch_research_principals`
- Network Intelligence (2): `generate_network_map`, `generate_network_report`
- Deals Intelligence (3): `calculate_relationship_strength`, `generate_acquisition_profile`, `identify_strategic_partnerships`
- Export Integration (3): Mailchimp, Terrakotta, PDF

---

## Getting Started

1. **Understand the concept**: Read [01_Concept_Graph.md](playbook/01_Concept_Graph.md)
2. **See the data flow**: Review [02_Data_Sources_Map.md](playbook/02_Data_Sources_Map.md)
3. **Study the schema**: Reference [03_Schema_ERD.md](playbook/03_Schema_ERD.md)
4. **Follow the walkthrough**: Trace [06_Walkthrough_Example.md](playbook/06_Walkthrough_Example.md)
5. **Implement**: Execute [05_Implementation_Roadmap.md](playbook/05_Implementation_Roadmap.md)

---

## Status

**Phase**: Planning & Architecture  
**Version**: 1.0  
**Last Updated**: January 2026
