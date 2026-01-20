# 3G Healthcare Real Estate Atlas - Playbook

**Version:** 1.0  
**Date:** January 2026  
**Status:** Planning & Architecture Phase  
**Audience:** 3G Healthcare stakeholders, technical team, product managers

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [What Atlas Is](#what-atlas-is)
3. [The Problem We're Solving](#the-problem-were-solving)
4. [Data Architecture](#data-architecture)
5. [Tool Catalog](#tool-catalog)
6. [MCP Server Architecture](#mcp-server-architecture)
7. [Use Cases & Workflows](#use-cases--workflows)
8. [Deployment Architecture](#deployment-architecture)
9. [Development Roadmap](#development-roadmap)
10. [Success Metrics](#success-metrics)

---

## Executive Summary

### **What It Is**

Atlas is a **navigation and intelligence system** for SNF ownership networks in healthcare real estate markets.

**Two-tier architecture:**

1. **Tier 1: Navigation (The Foundation)** - Graph navigation engine that queries existing structured data (CMS, REAPI, CRM, Graph). Start anywhere (property, company, principal) and navigate everywhere through the ownership network. Pure navigation, no synthesis.

2. **Tier 2: Intelligence (Built on Navigation)** - Generates formatted deliverables (contact briefs, network maps, reports) by orchestrating navigation tools + web research + AI synthesis. Uses the navigation foundation to gather data, then adds research and AI to create outputs.

---

## Entity Model: The Bridge Architecture

### **Core Concept: Company is the Many-to-Many Bridge**

```
Property ←→ [Entity] ←→ Company ←→ Principal
              ↑
          (Legal Vehicle)
```

**Primary Navigation:** Property ↔ Company ↔ Principal
**Detail Layer:** Entity = Legal vehicle (LLC, Corp) connecting Property to Company

### **Entity Definitions**

| Entity Type | Definition | Source |
|-------------|------------|--------|
| **Property** | Healthcare facility (SNF, hospital, etc.) | CMS/REAPI data |
| **Entity** | Legal vehicle (LLC, Corp) - Propco/Opco structure | REAPI Owner Info, CMS data |
| **Company** | Portfolio/Group that controls entities | Many-to-many bridge |
| **Principal** | Individual who controls companies | CRM, SOS filings, web research |

### **Company Types**

- **Owner** - Controls propco entities (real estate ownership)
- **Operator** - Controls opco entities (operations/management)
- **Neither** - Lender, CPA, Attorney, Consultant, etc.

### **Relationships**

```
Property → Entity (one-to-many: one property can have Opco + Propco entities)
Entity → Company (many-to-one: multiple entities controlled by one company)
Company → Many Principals (one-to-many)
Principal → Many Companies (one-to-many)
```

**Company IS the many-to-many bridge** - this is the key architectural insight.

### **Example: St Andrew Bay**

**Property Layer:**
- St Andrew Bay (SNF Facility, Panama City, FL)

**Entity Layer (Legal Vehicles):**
- Panama City FL Opco LLC (Opco - operates the facility)
- Panama City FL Propco LLC (Propco - owns the real estate)

**Company Layer (Portfolios):**
- Simcha Hyman & Naftali Zanziper (Operator - controls Opco) - 12 facilities
- Portopicolo Group (Owner - controls Propco) - 8 facilities

**Principal Layer:**
- Simcha Hyman (appears in both Operator and potentially Owner companies)
- Naftali Zanziper (Operator principal)
- [Related Principals at Portopicolo Group]

---

### **The Problem It Solves**

**The Real Challenge: System Fragmentation**

**Current State - What's Working:**
- ✅ CMS and REAPI data are **perfectly combined** in your database
- ✅ Existing infrastructure and views are **excellent**
- ✅ Data quality and coverage are **strong**

**The Problem - What's Broken:**
- ✅ **CRM Property Data IS synced** to database (this works)
- ❌ **Principal Data IS Fragmented** - this is the core problem
- ❌ **Propco entities exist** in database (from REAPI Owner Info) but have **NO principal linking structure**
- ❌ **CMS operational ownership** is NOT synced to CRM principals
- ❌ Cannot navigate: CRM principal → propco entity → database property
- ❌ Missing: Principal linking structure connecting propco entities to actual principals/individuals

**What Atlas Does:**
- **Graph Navigation Engine** - IS the foundation/core infrastructure (not a layer on top)
- **Principal Linking Structure** - Built via SOS scrape + web research tools
- **Multi-Directional Navigation** - Start anywhere (property, entity, principal, portfolio, market) and navigate everywhere
- **Connects Fragmented Principal Data** - Establishes missing links between principals, entities, and properties
- **Primary Workflow** - Property → Entity → Principal (bidirectional navigation)
- **Bidirectional Navigation** - Navigate in any direction through the network

**Key Message:** Graph Navigation IS the foundation engine. Property data sync works. Principal data fragmentation is the problem we're solving.

---

### **How It Works**

**Correct Mental Model: Graph Navigation IS the Foundation**

**Foundation: Graph Navigation (The Engine)**
- The graph IS the core data infrastructure - it's the foundation that powers everything else
- Like a subway system: entities are stations, graph is the tracks/transit system
- Queries your existing MySQL database (read-only, no data replication)
- Stores principal linking structure (built via SOS scrape + web research)
- Maps connections: Properties ↔ Entities ↔ Principals (bidirectional navigation)
- Enables multi-directional navigation (bidirectional arrows, start anywhere)
- Performs multi-hop traversal through the network

**Graph Capabilities (Core Foundation):**
- Start at any property/entity/principal/portfolio/market
- Navigate through complete ownership networks (bidirectional)
- Primary workflow: Property → Entity → Principal (works both ways)
- Trace entity structures automatically (propco/opco relationships)
- Map principal partnerships and affiliations
- Find paths between any entities
- Navigate in any direction: Property ↔ Entity ↔ Principal (bidirectional)

**Built on Graph (Applications & Tools):**
- **Intelligence Applications** - Contact briefs, network maps, market reports
- **Workflow Synchronization** - Maintains context across systems
- **Research Tools** - SOS scraping, web research to build principal links
- **Batch Operations** - Process multiple principals/entities simultaneously

**Your Existing Infrastructure (Data Source):**
- ✅ MySQL database with CMS + REAPI data perfectly combined
- ✅ Optimized views (Gold Layer) - `Vw Reapi Property Summary`, `Vw Facility Owner Mapping`, etc.
- ✅ Excellent data quality and coverage
- ✅ Entities exist (propco/opco from REAPI Owner Info and CMS data)
- ✅ CMS operational data exists (attached to properties)
- ✅ Property data synced (this works)

**Example Flow: Navigation → Intelligence**

**User Request:** "Generate contact brief for John Doe"

**Step 1: Navigation (Tier 1) - Query Structured Data**
- `trace_ownership_network(principal="John Doe")` → Query Graph + CMS + REAPI
  - Find all entities where John Doe is principal
  - Find all properties connected to those entities
- `get_principal_partnerships(principal="John Doe")` → Query Graph + CRM
  - Find co-ownership relationships
- `get_owner_portfolio(owner="...")` → Query REAPI
  - Get portfolio details for each entity

**Step 2: Research (Tier 2) - Fill Gaps**
- SOS scraping → Corporate filings, extract officers/principals
- Web research → LinkedIn, company sites, news articles
- Enformion API → Contact enrichment (phone, email, address)

**Step 3: Intelligence (Tier 2) - Synthesize**
- AI synthesis → Combine navigation data + research → Formatted brief
- Export → Push to Mailchimp or generate PDF

**Key Point:** Navigation tools query existing structured data. Intelligence tools orchestrate navigation + research + AI to generate deliverables.

---

### **What 3G Gets**

**Tier 1: Navigation Engine (The Foundation) — 35 Tools**
- **Core Capability:** Graph navigation — start anywhere, navigate everywhere
- **Data Sources:** CMS, REAPI, CRM, Graph (read-only queries to existing structured data)
- **Features:**
  - Start at any facility/property/principal/propco entity/opco entity/portfolio/market
  - Navigate through complete ownership networks (bidirectional navigation)
  - Trace propco/opco structures automatically (propco = property company, opco = operating company)
  - Map principal partnerships and affiliations
  - Find paths between any entities (multi-directional, multi-hop traversal)
  - Navigate in any direction: Property → Principal, Principal → Property, Entity → Portfolio, etc.
- **Build Priority:** Phase 1 (foundation must be built first)

**Tier 2: Intelligence Applications (Built on Navigation) — 8 Tools**
- **Core Capability:** Generate formatted deliverables using navigation + research + AI
- **Data Sources:** Navigation tools + Web research + Enformion API + AI synthesis
- **Features:**
  - **Contact Briefs:** Auto-generate outreach briefs for principals with complete network context
  - **Network Maps:** Complete ownership visualizations for clients/presentations
  - **Principal Research:** Deep research on new principals (web scraping + SOS + Enformion)
  - **Batch Operations:** Process 50+ principals/entities at once
  - **Export Integration:** Push to Mailchimp, Terrakotta AI, PDF reports
- **Build Priority:** Phase 2 (requires Tier 1 foundation)

**Key Message:** Navigation is the foundation. Intelligence uses navigation to gather data, then adds research and AI to create deliverables.

---

### **The Technical Foundation**

**Built on Your Excellent Existing Infrastructure:**
- ✅ Graph layer queries your MySQL database directly (read-only, no data replication)
- ✅ Leverages your existing optimized views (Gold Layer)
- ✅ Respects your existing data model and relationships
- ✅ CMS + REAPI data already perfectly combined (we use what you have)
- ✅ Deployed on your infrastructure (you control access and security)
- ✅ CRM sync to database (coming soon) - graph layer ready to integrate

**What We're Adding:**
- ➕ Graph Navigation Engine (IS the foundation, not a layer on top)
- ➕ Principal linking structure (built via SOS scrape + web research tools)
- ➕ Multi-directional navigation capabilities (bidirectional, start anywhere)
- ➕ Research tools (SOS scraping, web research) to establish principal links

---

### **Delivery Model**

**"Build and hand over the keys"**
- Custom MCP servers built for 3G's data model
- Deployed on your infrastructure
- Full documentation and training
- You own and operate it

---

## What Atlas Is

### **The Simplest Explanation**

Atlas is a **Graph Navigation Engine** - the foundation/core infrastructure that enables multi-directional navigation through ownership networks.

Think: **Subway system infrastructure - start at any station (entity), navigate to any other station through the network**

---

### **The Killer Feature: Start Anywhere, Navigate Everywhere**

**Not just lookup. Navigation across systems.**

**Traditional approach (Fragmented):**
- Start in CRM principal → Lookup database property manually
- Switch systems → Lose context
- Start in database property → Lookup CRM principal manually
- Switch systems → Lose context again
- Dead end. Start over for each query.

**Atlas approach (Multi-Directional Navigation):**
- Start anywhere: Property, Entity, Principal, Portfolio, Market
- Navigate everywhere: Multi-directional, bidirectional navigation
- Primary workflow: Property → Entity → Principal (bidirectional: ↔)
- Start: Property → Navigate to Entity → Navigate to Principal → Navigate to Portfolio
- Start: Principal → Navigate to Entities → Navigate to Properties
- Start: Entity → Navigate to Properties → Navigate to Principals
- **Keep navigating** in any direction through the network (like a subway map)

**It's a subway map: start at any station, navigate to any other station through the network.**

---

### **Core Concepts**

**1. Entities = Stations (All Navigable Starting Points)**
- Properties/Facilities (same thing - healthcare facilities, real estate parcels)
- Entities (propco/opco - property companies, operating companies)
- Principals (individuals who control entities)
- Portfolios (collections of properties)
- Markets (geographic/market context)

**2. Graph Navigation = Transit System (Bidirectional)**
- The graph IS the transit system infrastructure (tracks, routes, connections)
- Navigation works in BOTH directions (bidirectional arrows: ↔)
- Start anywhere: Property, Entity, Principal, Portfolio, Market
- Navigate everywhere: Multi-directional, multi-hop traversal
- Primary Navigation Workflow: Property → Entity → Principal (bidirectional)
- Relationships = Subway Lines:
  - PROPERTY_TO_ENTITY (Property ↔ Entity) - bidirectional
  - ENTITY_TO_PRINCIPAL (Entity ↔ Principal) - bidirectional
  - PRINCIPAL_PARTNERSHIP (Principal ↔ Principal) - bidirectional
  - ENTITY_TO_ENTITY (Entity ↔ Entity) - bidirectional (for propco/opco relationships)

**3. Data = Context at Each Station**
- CRM data: Principal contacts, relationships, workflows
- Database data: CMS + REAPI combined (quality scores, valuations, sales)
- CMS Operational Data: Quality metrics, compliance, management (linked to Opco entities)
- Ownership data: Principals, effective dates, partnerships
- Principal linking structure: Connections between principals and propco/opco entities (built via SOS scrape + web research)

---

### **The "Weave" Concept**

**VAV means "weave" or "web"** in Swedish—and that's what Atlas does:

- **Weaves together** Principal Linking Structure (built via SOS scrape + web research)
- **Connects** Properties ↔ Entities ↔ Principals (bidirectional navigation)
- **Enables multi-directional navigation** through the ownership network (start anywhere: Property, Entity, Principal, Portfolio, Market)
- **Reveals patterns** that emerge from connections, not just individual records

**The value isn't in individual entities—it's in the navigation network connecting them.**

**Note:** CMS + REAPI data are already perfectly combined in your database. Property data sync works. Atlas builds the missing principal linking structure and enables navigation: Property → Entity → Principal (bidirectional).

---

## The Problem We're Solving

### **Principal Data Fragmentation: The Missing Linking Structure**

**What's Already Working (Your Excellent Infrastructure):**
- ✅ **CMS + REAPI Data**: Perfectly combined in your MySQL database
- ✅ **Optimized Views**: Gold Layer views (`Vw Reapi Property Summary`, etc.) are excellent
- ✅ **Data Quality**: High coverage, verified linkages, reliable data
- ✅ **Database Structure**: Well-designed, production-ready
- ✅ **Property Data Sync**: CRM property data IS synced to database (this works)

**The Real Problem: Principal Data Fragmentation**

**What Exists But Is Fragmented:**

**Entities (REAPI/CMS Data):**
- ✅ Entities exist in database (propco/opco from REAPI Owner Info and CMS data)
- ❌ NO principal linking structure connecting entities to actual principals/individuals
- Example: You can see "ABC Healthcare LLC" (entity) but cannot see which principals control it

**CMS Operational Data:**
- ✅ CMS operational data exists in database (attached to properties)
- ❌ Properties not connected to principals through entities
- ❌ No connection between properties/entities and CRM principal records

**CRM Principals:**
- ✅ Principal records exist in CRM
- ❌ Isolated, no connections to entities or properties
- ❌ Cannot navigate: CRM principal → entity → property

**The Principal Linking Gap:**
- Entities exist but have NO principal linking structure
- Properties exist but cannot connect to principals through entities
- Principal data is fragmented across systems with no connections
- Cannot navigate: Property → Entity → Principal
- Missing: Principal linking structure (the connections between principals and entities)

**Solution Requirements:**
- SOS (Secretary of State) scraping to establish entity → principal links
- Web research tools to build missing principal connections
- Graph Navigation Engine to store and navigate the linking structure
- Navigation workflow: Property → Entity → Principal (bidirectional, start anywhere)

---

### **Specific Pain Points**

**For acquisitions/due diligence:**
- "Who really owns this facility?" → Hours of research
- "What else does this owner control?" → Start from scratch for each property
- "What's the ownership history?" → Piece together CMS + REAPI data manually

**For portfolio management:**
- "Show me all facilities by this operator" → Manual database queries
- "How are these principals connected?" → No system tracks this
- "What's the quality/financial performance across the portfolio?" → Combine multiple data sources manually

**For market intelligence:**
- "Who's been acquiring facilities in this market?" → No visibility
- "What partnerships exist between these entities?" → Hidden in data
- "How do we compare to competitors?" → Limited benchmarking capability

---

### **What Atlas Solves**

**Before Atlas (Principal Data Fragmented):**
- Entities exist but cannot connect to principals
- Properties exist but cannot connect to principals through entities
- Cannot navigate: Property → Entity → Principal
- Missing principal linking structure entirely
- Manual research required (SOS lookups, web searches)
- Incomplete picture - principals, entities, and properties are isolated

**With Atlas (Principal Links Established):**
- Principal linking structure built via SOS scrape + web research
- Navigate: Property ↔ Entity ↔ Principal (bidirectional)
- Primary workflow: Property → Entity → Principal (works both ways)
- Start anywhere: property, entity, principal, portfolio, market
- Navigate everywhere: multi-directional, multi-hop traversal
- Complete network: properties connected to entities connected to principals
- Graph Navigation Engine IS the foundation (not a layer on top)

---

### **Establishing Principal Linking Structures**

**The Methodology: Building Principal Links**

Principal linking structures are established through three integrated approaches:

**1. CRM Context (Starting Points)**
- CRM provides principal records with names, titles, companies, contact information
- Company associations: "John Doe works for ABC Healthcare LLC"
- Relationship data: partnerships, affiliations, historical context
- **How it helps:** Source of truth for principal identities, provides company names to search/match

**2. Data Points (Matching & Cross-Reference)**
- Database provides entity names (from REAPI Owner Info and CMS data)
- Property ownership records, CMS operational data
- Company name variations (legal names, DBA names, LLC suffixes)
- **Matching strategies:**
  - Name matching: "ABC Healthcare LLC" (CRM) → "ABC Healthcare LLC" (Entity)
  - Fuzzy matching: "ABC Healthcare" → "ABC Healthcare, LLC" → "ABC Healthcare Inc"
  - Address matching: CRM contact address → Property owner address
  - Partial matches: Company name fragments, common variations

**3. Web Research (Filling the Gaps)**
- **SOS (Secretary of State) Scraping:**
  - Corporate filings: Extract registered agents, officers, principals
  - Entity records: Legal structure, parent companies, subsidiaries
  - Process: Take entity name → Search SOS records → Extract principals/officers → Match to CRM principals
- **Web Research:**
  - LinkedIn: Company pages, employee listings, principal associations
  - Company websites: About pages, team bios, leadership
  - News articles: Deals, acquisitions, partnerships
  - Business directories: Crunchbase, Bloomberg, industry databases

**Integrated Methodology:**
1. **Direct Matches (High Confidence):** Match CRM company names → Entity names (exact/fuzzy)
2. **SOS Research (Medium-High Confidence):** Scrape SOS records → Extract principals → Match to CRM
3. **Web Research Enrichment (Medium Confidence):** LinkedIn, company sites, news → Find associations
4. **Relationship Inference (Lower Confidence):** Use known connections to infer new links

**Result:**
Principal linking structure stored in graph, enabling navigation: Property ↔ Entity ↔ Principal (bidirectional workflow)

---

## Data Architecture

### **3G Healthcare Data Landscape**

**Data Sources (In Your MySQL Database):**

1. **CMS Data (Government - Monthly Updates)**
   - `Cms Facilities Monthly` - Facility master (CCN-based)
   - `Cms Snf Owners Monthly` - Owner records
   - `Cms Quality Measures Monthly` - Quality/compliance metrics
   - `Cms Enrollments Monthly` - Census data
   - `Cms Change Of Ownership` - Ownership transfers
   - `Cms State Averages Monthly` - State benchmarks

2. **REAPI Data (Real Estate - Weekly Updates)**
   - `Reapi Properties` - Property master (Property ID-based)
   - `Reapi Nursing Homes` - Healthcare facility subset (verified CCN linkage)
   - `Reapi Owner Info` - Property owners
   - `Reapi Sales History` - Transaction data
   - `Reapi Mortgages` - Financing information
   - `Reapi Property Features`, `Demographics`, `Tax Info` - Property details

3. **Calculated Tables (Pre-Aggregated Analytics)**
   - `Calc Facility Scores` - Scoring models
   - `Calc Principal Partnerships Monthly` - Network relationships
   - `Calc Affiliated Entity Summary Monthly` - Entity networks
   - `Calc Facility Owner Summary Monthly` - Portfolio aggregations

4. **Views (Gold Layer - Optimized for Queries)**
   - `Vw Reapi Property Summary` - **CCN ↔ Property ID link + aggregated data**
   - `Vw Facility Owner Mapping` - Ownership tracking over time
   - `Vw Facility Primary Owner` - Current primary owner
   - `Vw Owner Portfolio Analysis` - Portfolio analytics
   - `Vw Quality Measures Performance` - Quality trends
   - `Vw Geographic Market Analysis` - Market intelligence

---

### **The Critical Link: CCN ↔ REAPI Property ID**

**How CMS and REAPI data connect:**

- **CMS uses CCN** (Centers for Medicare/Medicaid Services identifier)
- **REAPI uses Property ID** (parcel-level real estate identifier)
- **Link verified manually** (one-to-one, stable, trustworthy)
- **Link source:** `Reapi Nursing Homes` table + `Vw Reapi Property Summary` view

**Data integrity:**
- ✅ One-to-one relationship (1 CCN → 1 Property ID)
- ✅ Stable identifiers (both permanent, never change)
- ✅ Manually verified (high confidence)
- ✅ High coverage (lion's majority of facilities linked)
- ✅ Production-ready (trust the linkage absolutely)

---

### **Entity Model Translation**

**Atlas concepts mapped to 3G Healthcare:**

| Atlas Concept | 3G Healthcare Equivalent | Data Source |
|---------------|-------------------------|-------------|
| **Property/Facility** | Healthcare facility (nursing home, hospital) - same thing | `Cms Facilities Monthly` (CCN), `Reapi Properties` (Property ID) |
| **Entity** | Property/operating company (propco/opco) | `Reapi Owner Info`, `Cms Snf Owners Monthly` |
| **Principal** | Individual (owner, executive, partner) | CRM Principals, Principal linking structure (built via SOS + web research) |
| **Portfolio** | Collection of properties | `Vw Owner Portfolio Analysis`, aggregated views |
| **Principal Linking Structure** | Connections: Principal ↔ Propco/Opco ↔ Property | Built via SOS scrape + web research tools |
| **Network** | Partnerships & Affiliations | `Calc Principal Partnerships Monthly` |
| **Transaction** | Ownership Change | `Cms Change Of Ownership`, `Reapi Sales History` |

---

### **Data Query Strategy**

**Primary approach: Query Views (Gold Layer)**

Views are pre-joined, optimized, and ready for fast queries:

```sql
-- Example: Get complete facility profile
SELECT * 
FROM vw_reapi_property_summary 
WHERE ccn = '123456';

-- Returns: CCN + Property ID + CMS data + REAPI data (all in one query)
```

**Why use views:**
- ✅ Data already joined (CMS + REAPI)
- ✅ Optimized for performance
- ✅ Consistent with 3G's existing analytics
- ✅ Maintained by your team

**When to use raw tables:**
- Advanced filtering (e.g., `verified = 1` flag)
- Custom joins not in views
- Specific edge cases

---

## Tool Catalog

### **Overview: Two-Tier Architecture**

**The Mental Model:**

Tools are organized by **capability tier**, not entity type. This reflects the build sequence: **Navigation first (foundation), Intelligence second (built on navigation)**.

**Tier 1: Navigation Tools (The Foundation)**
- **Purpose:** Core graph navigation — query existing structured data
- **Data Sources:** CMS, REAPI, CRM, Graph (read-only queries)
- **Capability:** Pure navigation, no synthesis — the "subway tracks"
- **Count:** 35 tools
- **Build Priority:** Phase 1 (foundation must be built first)

**Tier 2: Intelligence Tools (Built on Navigation)**
- **Purpose:** Generate formatted deliverables
- **Data Sources:** Navigation tools + Web research + Enformion API + AI synthesis
- **Capability:** Uses navigation to gather data, then adds research and AI to create outputs
- **Count:** 8 tools
- **Build Priority:** Phase 2 (requires Tier 1 foundation)

**Key Insight:** Navigation tools are the foundation. Intelligence tools orchestrate navigation + research + AI to generate deliverables.

**Total: 43 tools organized by capability tier**

---

## **Tier 1: Navigation Tools (The Foundation)**

**Purpose:** Core graph navigation — start anywhere, navigate everywhere through existing structured data

**Data Sources:** CMS, REAPI, CRM, Graph (read-only queries to existing structured data)

**Key Principle:** Pure navigation, no synthesis. These are the "subway tracks" — direct queries that enable bidirectional traversal.

---

### **Property Navigation Tools (20 tools)**

**Purpose:** Navigate and query property/facility data from structured sources

#### **CMS Navigation (4 tools)**
| Tool | Description | Data Source |
|------|-------------|------------|
| `get_facility` | Facility profile by CCN | CMS |
| `get_facility_metrics` | Quality scores, compliance ratings | CMS |
| `get_facility_chows` | Change of ownership history | CMS |
| `search_facilities` | Search by CCN, name, owner, state, county | CMS |

#### **REAPI Navigation (4 tools)**
| Tool | Description | Data Source |
|------|-------------|------------|
| `get_property_transactions` | Sales history, transaction details | REAPI |
| `get_property_mortgages` | Mortgage activity, lender info | REAPI |
| `get_property_details` | Property features, demographics, tax info | REAPI |
| `get_facility_by_property_id` | Lookup facility by REAPI Property ID | REAPI |

#### **Deals Navigation (6 tools) - NEW**
| Tool | Description | Data Source |
|------|-------------|------------|
| `get_property_transaction_history` | All deals for a property (sales, refinances, CHOWs) | Deals + Graph |
| `get_company_deal_activity` | Buyer/seller profile for a company | Deals + Graph |
| `find_buyer_seller_relationships` | Recurring transaction pairs (strategic partnerships) | Deals + Graph |
| `get_lender_relationships` | Which lenders finance which operators | Deals + Graph |
| `search_deals` | Filter deals by date, amount, parties, type | Deals + Graph |
| `get_market_transaction_volume` | Activity in specific markets | Deals + Graph |

#### **CRM Navigation (3 tools)**
| Tool | Description | Data Source |
|------|-------------|------------|
| `get_property_principals` | Associated principals from CRM | CRM |
| `get_property_record` | Full CRM record details | CRM |
| `get_property_history` | Record activity history | CRM |

#### **Market Navigation (3 tools)**
| Tool | Description | Data Source |
|------|-------------|------------|
| `get_top_buyers` | Top buyers by region | CMS + REAPI |
| `get_top_sellers` | Top sellers by region | CMS + REAPI |
| `get_recent_market_activity` | Recent sales, CHOWs, financing | CMS + REAPI |

---

### **Network Navigation Tools (6 tools)**

**Purpose:** Trace ownership chains and map relationships through the graph

| Tool | Description | Data Source |
|------|-------------|------------|
| `trace_ownership_network` | Follow Property → Entity → Company → Principal | Graph + CMS + REAPI |
| `get_owner_portfolio` | All properties owned by company | REAPI + Graph |
| `get_operator_portfolio` | All facilities operated by company | CMS + Graph |
| `find_affiliated_entities` | Related entities and partnerships | Graph + REAPI |
| `map_propco_opco_structure` | Identify propco vs opco relationships | Graph + CMS + REAPI |
| `get_network_graph` | D3-compatible graph for visualization | Graph |

---

### **Ownership Intelligence Tools (4 tools)**

**Purpose:** Query ownership history and portfolio analytics

| Tool | Description | Data Source |
|------|-------------|------------|
| `get_ownership_history` | Ownership tracking over time | CMS + REAPI |
| `get_principal_partnerships` | Co-ownership relationships | Graph + CRM |
| `get_related_principals` | Find connected principals | Graph + CRM |
| `get_principal_record` | Principal details from CRM | CRM |

---

### **Market Intelligence Navigation (5 tools)**

**Purpose:** Market-level queries and comparisons

| Tool | Description | Data Source |
|------|-------------|------------|
| `get_market_analysis` | Market-level trends | CMS + REAPI |
| `compare_facilities` | Facility comparison by metrics | CMS |
| `compare_portfolios` | Portfolio comparison | CMS + REAPI |
| `find_comparable_facilities` | Similar facilities by size, quality, location | CMS + REAPI |
| `get_medicaid_rates` | Rates by state/facility type | CMS (or external source) |

---

### **Utility Tools (2 tools)**

**Purpose:** System health and data quality monitoring

| Tool | Description | Data Source |
|------|-------------|------------|
| `get_database_stats` | Record counts, data freshness | Database metadata |
| `check_data_quality` | Sync status, missing data flags | Database metadata |

---

## **Tier 2: Intelligence Tools (Built on Navigation)**

**Purpose:** Generate formatted deliverables using navigation + research + AI synthesis

**Data Sources:** Navigation tools (CMS + REAPI + CRM + Graph) + Web research + Enformion API + AI synthesis

**Key Principle:** These tools **use** Navigation tools to gather base data, then add web research and AI synthesis to create formatted outputs.

---

### **Contact Intelligence Tools (3 tools)**

**Purpose:** Generate contact briefs and principal research deliverables

| Tool | Description | Uses Navigation + |
|------|-------------|-------------------|
| `generate_contact_brief` | AI-generated outreach brief with network context | Web + Enformion + AI + Deals |
| `research_principal` | Deep research on one principal | Web + SOS + Enformion + AI + Deals |
| `batch_research_principals` | Research 50+ principals in parallel | Web + SOS + Enformion + AI + Deals |

**Data Flow:**
1. Navigation tools gather base data (Principal → Entities → Properties via Graph)
2. Web research fills gaps (SOS scraping, LinkedIn, company sites)
3. Enformion API enriches contact info (phone, email)
4. AI synthesizes into formatted brief

---

### **Network Intelligence Tools (2 tools)**

**Purpose:** Generate network visualizations and relationship reports

| Tool | Description | Uses Navigation + |
|------|-------------|-------------------|
| `generate_network_map` | Network visualization + relationship report | Graph + AI |
| `generate_network_report` | PDF export of ownership network analysis | Graph + AI |

**Data Flow:**
1. Navigation tools trace network (Property ↔ Entity ↔ Principal via Graph)
2. AI synthesizes into visualization data + narrative report

---

### **Export Integration Tools (3 tools)**

**Purpose:** Export intelligence to external systems

| Tool | Description | Uses Navigation + |
|------|-------------|-------------------|
| `export_to_mailchimp` | Export contact briefs to Mailchimp campaign | Navigation + Formatting |
| `export_to_terrakotta` | Export to Terrakotta AI for voice campaigns | Navigation + Formatting |
| `export_pdf_report` | Generate PDF reports (briefs, network maps) | Navigation + AI + Formatting |

---

### **Deals Intelligence Tools (3 tools) - NEW**

**Purpose:** Generate acquisition profiles and relationship analysis using transaction history

| Tool | Description | Uses Navigation + |
|------|-------------|-------------------|
| `calculate_relationship_strength` | Score based on transaction history (0-100) | Deals + Graph + AI |
| `generate_acquisition_profile` | Company's M&A activity report | Deals + Graph + AI |
| `identify_strategic_partnerships` | Find repeat buyer/seller pairs | Deals + Graph + AI |

### **Tier 2 Tool Count Summary**

| Category | Tool Count | Primary Data Sources |
|----------|-----------|---------------------|
| **Contact Intelligence** | 3 | Navigation + Web + Enformion + AI + Deals |
| **Network Intelligence** | 2 | Navigation + AI |
| **Deals Intelligence** | 3 | Deals + Graph + AI |
| **Export Integration** | 3 | Navigation + Formatting |
| **TOTAL (Tier 2)** | **11 tools** | Built on Navigation foundation |

---

### **Complete Tool Count Summary**

| Tier | Tool Count | Data Sources |
|------|------------|--------------|
| **Tier 1: Navigation** | 41 tools | CMS, REAPI, CRM, Graph, Deals (read-only) |
| **Tier 2: Intelligence** | 11 tools | Navigation + Web + Enformion + AI |
| **TOTAL** | **52 tools** | Complete system |

---

### **Data Source Mapping by Tier**

**Tier 1: Navigation Tools — Structured Data Sources**

| Data Source | Purpose | Tool Categories | Query Type |
|-------------|---------|-----------------|------------|
| **CMS** | Government healthcare data | Facility profiles, quality metrics, ownership records | Read-only SQL queries |
| **REAPI** | Real estate data | Property details, transactions, mortgages, valuations | Read-only SQL queries |
| **CRM** | Principal records, relationships | Principal data, property associations | Read-only API queries |
| **Graph** | Principal linking structure | Network traversal, ownership chains | Graph queries |

**Tier 2: Intelligence Tools — Research & Synthesis Sources**

| Data Source | Purpose | Tool Categories | Access Method |
|-------------|---------|-----------------|---------------|
| **Navigation Tools** | Base data gathering | All intelligence tools | Calls Tier 1 tools |
| **Web** | Gap filling, enrichment | Contact intelligence | Web scraping (LinkedIn, company sites, news) |
| **SOS** | Corporate filings | Contact intelligence | SOS website scraping |
| **Enformion API** | Contact enrichment | Contact intelligence | API calls (phone, email, address) |
| **AI Synthesis** | Formatting, synthesis | All intelligence tools | Claude API (briefs, reports) |

**Key Principle:** Tier 1 queries existing structured data. Tier 2 orchestrates Tier 1 + external research + AI to generate deliverables.

---

## MCP Server Architecture

### **What is MCP?**

**MCP (Model Context Protocol)** is how Claude Desktop integrates with external data sources.

**For 3G Healthcare:**
- MCP servers run on your infrastructure
- Query your MySQL database directly (Tier 1: Navigation)
- Orchestrate web research when needed (Tier 2: Intelligence - SOS filings, web scraping)
- Expose 52 tools that Claude can use (41 Navigation + 11 Intelligence)
- No data leaves your environment (except for external research sources: Web, SOS, Enformion)

---

### **Two-Tier Architecture**

**Tier 1: Navigation Tools (The Foundation)**
- **Purpose:** Core graph navigation — query existing structured data
- **Data Sources:** CMS, REAPI, CRM, Graph, Deals (read-only queries)
- **Capability:** Pure navigation, no synthesis — the "subway tracks"
- **Count:** 41 tools (35 original + 6 new Deals tools)

**Tier 2: Intelligence Tools (Built on Navigation)**
- **Purpose:** Generate formatted deliverables
- **Data Sources:** Navigation tools + Web research + Enformion API + AI synthesis
- **Capability:** Uses navigation to gather data, then adds research and AI to create outputs
- **Count:** 11 tools (8 original + 3 new Deals Intelligence tools)

**Data Flow Example:**

```
User Request: "Generate contact brief for John Doe"
       ↓
Tier 2 Intelligence Tool: generate_contact_brief()
       ↓
Step 1: Uses Tier 1 Navigation Tools
  • trace_ownership_network() → Query Graph + CMS + REAPI
  • get_principal_partnerships() → Query Graph + CRM
  • get_owner_portfolio() → Query REAPI
       ↓
Step 2: Web Research (fills gaps)
  • SOS scraping → Corporate filings, officers
  • LinkedIn → Company pages, principal associations
  • Company websites → Team bios, leadership
       ↓
Step 3: Contact Enrichment
  • Enformion API → Phone, email, address
       ↓
Step 4: AI Synthesis
  • Synthesize all data → Formatted contact brief
       ↓
Return: Complete brief ready for outreach
```

**Key Insight:** Navigation tools query structured data. Intelligence tools orchestrate navigation + research + AI to generate deliverables.

---

### **Architecture Diagram**

```
┌─────────────────────────────────────────┐
│   User (Claude Desktop / Web UI)        │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│   MCP Server (Python - on 3G infra)     │
│   • 43 Healthcare Tools                 │
│   • Two-tier architecture:              │
│     - Tier 1: Navigation (35 tools)     │
│     - Tier 2: Intelligence (8 tools)   │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│   Service Layer                         │
│                                         │
│   ┌─────────────────────────────┐      │
│   │  Tier 1: Navigation Services│      │
│   │  • MySQLClient              │      │
│   │  • FacilityQueries          │      │
│   │  • PortfolioQueries         │      │
│   │  • GraphService             │      │
│   │  • NetworkTracer            │      │
│   │  Data Sources:              │      │
│   │  → CMS, REAPI, CRM, Graph   │      │
│   └─────────────────────────────┘      │
│                                         │
│   ┌─────────────────────────────┐      │
│   │  Tier 2: Research Services  │      │
│   │  • ResearchOrchestrator     │      │
│   │  • SOSScraperService        │      │
│   │  • WebScraperService        │      │
│   │  • EnformionClient          │      │
│   │  Data Sources:              │      │
│   │  → Web, SOS, Enformion API  │      │
│   └─────────────────────────────┘      │
│                                         │
│   ┌─────────────────────────────┐      │
│   │  Tier 2: Intelligence Gen   │      │
│   │  • IntelligenceGenerator    │      │
│   │  • NetworkReportBuilder     │      │
│   │  • ExportService            │      │
│   │    - Mailchimp integration  │      │
│   │    - Terrakotta integration │      │
│   │  Uses: Navigation + Research │      │
│   │  + AI Synthesis             │      │
│   └─────────────────────────────┘      │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│   Data Sources                          │
│                                         │
│   Tier 1 Navigation Sources:             │
│   • MySQL Database (CMS + REAPI)        │
│   • CRM (Zoho)                          │
│   • Graph (Principal linking structure) │
│                                         │
│   Tier 2 Intelligence Sources:          │
│   • Secretary of State websites (SOS)  │
│   • Web (LinkedIn, company sites, news) │
│   • Enformion API (contact enrichment)  │
│   • AI Synthesis (Claude)               │
└─────────────────────────────────────────┘
```

---

### **Code Structure**

```
3g-healthcare-atlas/
├── mcp_server.py                 # Main MCP server entry point
├── config.py                     # Configuration and credentials
│
├── tools/                        # 43 MCP tools organized by tier
│   ├── tier1_navigation/         # Navigation Tools (35 tools)
│   │   ├── property_tools.py     # Property navigation (14 tools)
│   │   │   ├── cms_tools.py      # CMS queries (4 tools)
│   │   │   ├── reapi_tools.py    # REAPI queries (4 tools)
│   │   │   ├── crm_tools.py      # CRM queries (3 tools)
│   │   │   └── market_tools.py   # Market queries (3 tools)
│   │   ├── network_tools.py      # Network navigation (6 tools)
│   │   ├── ownership_tools.py   # Ownership intelligence (4 tools)
│   │   ├── market_intelligence.py # Market navigation (5 tools)
│   │   ├── medicaid_tools.py     # Medicaid rates (2 tools)
│   │   └── utility_tools.py      # System tools (2 tools)
│   │
│   └── tier2_intelligence/       # Intelligence Tools (8 tools)
│       ├── contact_intelligence.py # Contact briefs (3 tools)
│       ├── network_intelligence.py # Network maps (2 tools)
│       └── export_tools.py       # Export integration (3 tools)
│
├── services/                     # Service layer (business logic)
│   ├── database/
│   │   ├── mysql_client.py       # Database connection & queries
│   │   ├── facility_queries.py   # Facility lookup queries
│   │   └── portfolio_queries.py  # Portfolio/ownership queries
│   │
│   ├── graph/
│   │   ├── graph_service.py      # Graph construction
│   │   ├── network_tracer.py     # Ownership chain traversal
│   │   └── path_finder.py        # Path finding algorithms
│   │
│   ├── research/
│   │   ├── research_orchestrator.py  # Coordinate multi-source research
│   │   ├── sos_scraper.py            # Secretary of State filings
│   │   ├── web_scraper.py            # General web scraping
│   │   └── enformion_client.py       # Enformion API integration
│   │
│   └── intelligence/
│       ├── intelligence_generator.py  # Brief generation logic
│       ├── network_reporter.py        # Network map generation
│       └── export_service.py          # Mailchimp/Terrakotta exports
│
└── tests/
    ├── test_navigation_tools.py
    ├── test_intelligence_tools.py
    ├── test_research_services.py
    └── ...
```

---

### **Service Layer Breakdown**

#### **1. Graph Navigation Services**

**MySQLClient** (`mysql_client.py`)
- Purpose: Single point of database access
- Methods:
  - `query_one(sql, params)` - Single row
  - `query_many(sql, params)` - Multiple rows
  - `execute(sql, params)` - Write operations (if needed)
- Features: Connection pooling, error handling, retry logic

**FacilityQueries** (`facility_queries.py`)
- Purpose: Facility search and lookup
- Methods:
  - `search_facilities(filters)` → Query `Vw Reapi Property Summary`
  - `get_facility_profile(ccn)` → Complete facility data
  - `get_facility_by_property_id(property_id)` → Reverse lookup
- Queries: Optimized views (gold layer)

**PortfolioQueries** (`portfolio_queries.py`)
- Purpose: Portfolio and ownership queries
- Methods:
  - `get_owner_portfolio(owner_name)` → Query `Vw Owner Portfolio Analysis`
  - `get_ownership_history(ccn)` → Query `Vw Facility Owner Mapping`
  - `get_principals(ccn)` → Extract principals from mapping

**GraphService** (`graph_service.py`)
- Purpose: Build graph structures from database relationships
- Methods:
  - `build_graph(starting_node, depth)` → Construct graph from relationships
  - `get_node_connections(node_id)` → Find all edges from node
  - `to_d3_format()` → Convert to D3-compatible structure
- Data sources: `Vw Facility Owner Mapping`, `Calc Principal Partnerships`, `Calc Affiliated Entity Summary`

**NetworkTracer** (`network_tracer.py`)
- Purpose: Trace ownership chains through the network
- Methods:
  - `trace_from_property(ccn)` → Property → Entity → Principal
  - `trace_from_principal(name)` → Principal → Entities → Properties
  - `find_propco_opco_structure(entity)` → Identify propco vs opco relationships
- Logic: Walk relationship tables, handle missing data, trigger research when needed

---

#### **2. Research & Enrichment Services**

**ResearchOrchestrator** (`research_orchestrator.py`)
- Purpose: Coordinate multi-source research (database + web + SOS)
- Methods:
  - `research_principal(name)` → Comprehensive principal research
  - `batch_research(principal_list)` → Parallel processing for 50+ principals
  - `orchestrate()` → Combine database, web, SOS, Enformion
- Features: Progress tracking, caching, error handling

**SOSScraperService** (`sos_scraper.py`)
- Purpose: Scrape Secretary of State websites for corporate filings
- Methods:
  - `lookup_entity(name, state)` → Corporate filing search
  - `get_officers(entity_id, state)` → Extract principals/officers
  - `get_filing_history(entity_id)` → Corporate history
- Features: Multi-state support, Playwright automation, rate limiting

**WebScraperService** (`web_scraper.py`)
- Purpose: General web scraping (LinkedIn, company sites, news)
- Methods:
  - `search_linkedin(name)` → Profile search
  - `scrape_company_site(url)` → Extract contact info, team bios
  - `search_news(entity_name)` → Recent news articles
- Features: Playwright automation, anti-bot detection handling

**EnformionClient** (`enformion_client.py`)
- Purpose: Contact enrichment via Enformion API
- Methods:
  - `enrich_contact(name, location)` → Phone, email, address
  - `batch_enrich(contact_list)` → Bulk enrichment
- Features: API authentication, rate limiting, caching

---

#### **3. Intelligence Generation Services**

**IntelligenceGenerator** (`intelligence_generator.py`)
- Purpose: Generate formatted intelligence outputs (briefs, reports)
- Methods:
  - `generate_contact_brief(principal)` → Formatted outreach brief
    - Uses: `NetworkTracer` to gather network data
    - Uses: `ResearchOrchestrator` for enrichment
    - Uses: AI (Claude) to synthesize
  - `generate_network_map(entity)` → Network visualization + report
  - `generate_market_report(region)` → Market intelligence summary

**NetworkReportBuilder** (`network_reporter.py`)
- Purpose: Build network diagrams and reports
- Methods:
  - `build_network_diagram(graph_data)` → D3 visualization data
  - `generate_pdf_report(network)` → PDF export
  - `generate_csv_export(portfolio)` → CSV export

**ExportService** (`export_service.py`)
- Purpose: Integration with external tools
- Methods:
  - `export_to_mailchimp(contacts)` → Format for Mailchimp API
  - `export_to_terrakotta(data)` → Format for Terrakotta AI
  - `export_csv(data, format)` → Generic CSV export

---

### **Tool Implementation Pattern**

**Example 1: Graph Navigation Tool**

```python
# tools/tier1_navigation/facility_tools.py

from services.database.facility_queries import FacilityQueries

async def get_facility(ccn: str) -> dict:
    """
    Get complete facility profile by CCN.
    
    Tier 1 tool - pure graph navigation, no intelligence generation.
    
    Args:
        ccn: CMS facility identifier (6-digit)
        
    Returns:
        Complete facility profile with graph navigation hints
    """
    facility_queries = FacilityQueries()
    
    # Query the gold layer view
    facility = await facility_queries.get_facility_profile(ccn)
    
    if not facility:
        return {"error": f"Facility with CCN {ccn} not found"}
    
    # Add graph navigation hints
    return {
        "facility": facility,
        "graph_navigation_hints": {
            "can_navigate_to": [
                {
                    "type": "owner",
                    "name": facility["primary_owner"],
                    "tool": "get_owner_portfolio"
                },
                {
                    "type": "property",
                    "id": facility["property_id"],
                    "tool": "get_property_valuation"
                },
                {
                    "type": "network",
                    "tool": "get_facility_connections"
                }
            ]
        }
    }
```

---

**Example 2: Intelligence Generation Tool**

```python
# tools/tier2_intelligence/brief_generation.py

from services.graph.network_tracer import NetworkTracer
from services.research.research_orchestrator import ResearchOrchestrator
from services.intelligence.intelligence_generator import IntelligenceGenerator

async def generate_contact_brief(principal_name: str) -> dict:
    """
    Generate comprehensive contact brief for outreach.
    
    Tier 2 tool - uses graph navigation + research + AI synthesis.
    
    Args:
        principal_name: Name of principal to research
        
    Returns:
        Formatted contact brief ready for outreach
    """
    # Step 1: Use graph navigation to find network
    tracer = NetworkTracer()
    network_data = await tracer.trace_from_principal(principal_name)
    
    # Step 2: If incomplete, trigger research
    if network_data.get("needs_research"):
        orchestrator = ResearchOrchestrator()
        enrichment = await orchestrator.research_principal(
            principal_name,
            known_data=network_data
        )
        # Merge enrichment into network_data
        network_data.update(enrichment)
    
    # Step 3: Generate formatted brief using AI
    generator = IntelligenceGenerator()
    brief = await generator.generate_contact_brief(
        principal=principal_name,
        network=network_data
    )
    
    return {
        "brief": brief,
        "network_summary": {
          "total_properties": len(network_data.get("properties", [])),
          "total_partnerships": len(network_data.get("partnerships", [])),
          "states_active": network_data.get("states", [])
        },
        "sources": network_data.get("sources", [])
    }
```

---

### **Graph Navigation Hints**

**Every Tier 1 tool response includes navigation hints:**

```json
{
  "facility": {
    "ccn": "123456",
    "name": "Memorial Nursing Home",
    "primary_owner": "ABC Healthcare LLC",
    "property_id": "789"
  },
  "graph_navigation_hints": {
    "can_navigate_to": [
      {
        "type": "entity",
        "name": "ABC Healthcare LLC",
        "tool": "get_owner_portfolio",
        "description": "Navigate Property → Entity: See all 23 properties owned by this entity"
      },
      {
        "type": "principals",
        "tool": "trace_ownership_network",
        "description": "Navigate Entity → Principal: Find who controls ABC Healthcare LLC"
      },
      {
        "type": "related_properties",
        "tool": "find_related_facilities",
        "description": "Find properties with shared ownership/entities"
      }
    ]
  }
}
```

**This enables the "subway map" navigation experience.**

---

## Use Cases & Workflows

### **Use Case 1: Acquisition Due Diligence**

**Scenario:** Evaluating a facility for acquisition

**Workflow:**
1. Start: `search_facilities(name="Memorial Nursing Home")` → Property
2. Navigate: `get_facility(ccn="123456")` → Property details
   - See: Quality scores, occupancy, property value
3. Navigate: Property → Entity → `get_owner_portfolio(owner="ABC Healthcare")`
   - See: 23 other properties owned by same entity
4. Navigate: Entity → Principal → `trace_ownership_network`
   - See: Principals who control this entity
5. Navigate: `get_quality_trends(ccn="123456")`
   - See: Performance over time
6. Navigate: `compare_to_benchmarks(ccn="123456")`
   - See: How it compares to county/state averages
7. Navigate: `get_ownership_history(ccn="123456")`
   - See: Previous owners and transfer dates

**Result:** Complete due diligence in minutes, not days (Property → Entity → Principal navigation)

---

### **Use Case 2: Portfolio Management**

**Scenario:** Managing portfolio performance

**Workflow:**
1. Start: `get_owner_portfolio(owner="XYZ REIT")` → Entity Portfolio
   - See: All 47 properties in portfolio
2. Navigate: Property → `get_facility(ccn="234567")`
   - See: Individual property performance
3. Navigate: Property → Entity → Principal
   - See: Who controls this entity
4. Navigate: `get_quality_trends(ccn="234567")`
   - See: Quality trends over time
5. Navigate: `get_census_trends(ccn="234567")`
   - See: Occupancy trends
6. Navigate: `find_comparable_facilities(ccn="234567")`
   - See: How it compares to market
7. Navigate: Back to portfolio → `get_quality_rankings(owner="XYZ REIT")`
   - See: Rankings across portfolio

**Result:** Portfolio analytics and performance tracking (Property → Entity → Principal navigation)

---

### **Use Case 3: Market Intelligence**

**Scenario:** Identifying acquisition opportunities

**Workflow:**
1. Start: `get_market_analysis(state="TX", county="Harris")`
   - See: Market-level trends
2. Navigate: `get_recent_sales(state="TX")`
   - See: Recent transactions
3. Navigate: Click buyer → `get_owner_portfolio(owner="Regional Health")`
   - See: What they've been acquiring
4. Navigate: `get_principal_partnerships(owner="Regional Health")`
   - See: Who they partner with
5. Navigate: Click partnership → `find_affiliated_entities(entity="...")`
   - See: Full network of affiliated entities
6. Navigate: `find_comparable_facilities(market="Houston")`
   - See: Potential targets

**Result:** Market intelligence and network mapping

---

### **Use Case 4: Medicaid Rate Analysis (Phase 1 Critical)**

**Scenario:** Understanding reimbursement landscape

**Workflow:**
1. Start: `get_facility(ccn="345678")`
   - See: Facility in Texas
2. Navigate: `get_medicaid_rates(state="TX", facility_type="SNF")`
   - See: Current Texas Medicaid rates
3. Navigate: `compare_rates_by_state(facility_type="SNF")`
   - See: Texas vs other states
4. Navigate: `get_owner_portfolio(owner="...")`
   - See: Other facilities in portfolio
5. Navigate: Check each facility's state → Compare rates
   - See: Reimbursement optimization opportunities

**Result:** Medicaid rate optimization across portfolio

---

## Deployment Architecture

### **Option B: Data Stays in Your Database**

**Architecture choice:** MCP servers run on 3G infrastructure and query existing MySQL database directly

```
┌─────────────────────────────────────────┐
│   User (Claude Desktop / Web UI)        │
└─────────────────┬───────────────────────┘
                  │ stdio/MCP protocol
                  ▼
┌─────────────────────────────────────────┐
│   MCP Server(s) - 3G Infrastructure     │
│   • Python application                  │
│   • 29 healthcare tools                 │
│   • MySQL client                        │
└─────────────────┬───────────────────────┘
                  │ MySQL queries
                  ▼
┌─────────────────────────────────────────┐
│   MySQL Database (3G's existing DB)     │
│   • Read-only access for MCP server     │
│   • CMS monthly tables                  │
│   • REAPI weekly tables                 │
│   • Calc/View tables                    │
└─────────────────────────────────────────┘
```

**Why this architecture:**
- ✅ Data never leaves 3G's infrastructure
- ✅ Compliance/security: You control database access
- ✅ No data replication needed
- ✅ Queries hit your existing optimized views
- ✅ You control container lifecycle, credentials, firewall rules

**Trade-offs:**
- Query latency depends on database performance
- No caching layer (unless added later)
- MCP server must be on infrastructure with database access

---

### **Deployment Requirements**

**Infrastructure:**
- Server/VM with Python 3.10+ runtime
- Network access to MySQL database
- Firewall rules: MySQL port (3306) access from MCP server

**Database Access:**
- Read-only MySQL user for MCP server
- Credentials stored in environment variables
- Connection pooling for performance

**Security:**
- MCP server runs in isolated container/VM
- Database credentials encrypted at rest
- Audit logging for all queries
- Optional: VPN/bastion host for database access

---

### **Source Freshness Tracking**

**Data update cadence:**
- **Zoho:** Daily
- **REAPI:** Weekly
- **CMS:** Monthly

**Requirement:** UI/API must show last successful ingestion watermark per source

**Implementation:**
```python
# Query ops tables for freshness
def get_data_freshness():
    query = """
        SELECT 
            source,
            MAX(last_sync_timestamp) as last_update
        FROM ops_data_load_log
        GROUP BY source
    """
    # Returns: {"CMS": "2026-01-01", "REAPI": "2026-01-03", "Zoho": "2026-01-03"}
```

**Display in facility profile:**
```
Facility: Memorial Hospital (CCN 123456)
CMS Data: Last updated Jan 1, 2026 (monthly)
REAPI Data: Last updated Jan 3, 2026 (weekly)
```

---

## Development Roadmap

### **Phase 1: MVP - Core Navigation (Tier 1 Foundation) (2 weeks)**

**Goal:** Working MCP server with core navigation tools — the foundation layer

**Deliverables:**
1. **MCP Server Setup**
   - Python MCP server skeleton
   - MySQL client with connection pooling
   - Error handling and logging
   
2. **Tier 1: Property Navigation Tools (14 tools)**
   - CMS tools (4): `search_facilities`, `get_facility`, `get_facility_metrics`, `get_facility_chows`
   - REAPI tools (4): `get_property_transactions`, `get_property_mortgages`, `get_property_details`, `get_facility_by_property_id`
   - CRM tools (3): `get_property_principals`, `get_property_record`, `get_property_history`
   - Market tools (3): `get_top_buyers`, `get_top_sellers`, `get_recent_market_activity`
   
3. **Tier 1: Network Navigation Tools (6 tools)**
   - `trace_ownership_network`
   - `get_owner_portfolio`
   - `get_operator_portfolio`
   - `find_affiliated_entities`
   - `map_propco_opco_structure`
   - `get_network_graph`
   
4. **Tier 1: Ownership Intelligence Tools (4 tools)**
   - `get_ownership_history`
   - `get_principal_partnerships`
   - `get_related_principals`
   - `get_principal_record`
   
5. **Tier 1: Utility Tools (2 tools)**
   - `get_database_stats`
   - `check_data_quality`

**Testing:**
- Unit tests for all navigation tools
- Integration tests with 3G database
- Manual testing via Claude Desktop

**Success Criteria:**
- Can search for any facility (CMS + REAPI queries)
- Can navigate from facility → owner → portfolio (Graph navigation)
- Can trace ownership chains (Property → Entity → Principal)
- Can map networks between entities (Graph traversal)
- **Foundation complete:** All Tier 1 navigation tools operational

---

### **Phase 1+: Tier 1 Navigation Completion (1.5 weeks)**

**Goal:** Complete Tier 1 navigation tools — remaining market and analytics tools

**Deliverables:**
1. **Tier 1: Market Intelligence Navigation (5 tools)**
   - `get_market_analysis`
   - `compare_facilities`
   - `compare_portfolios`
   - `find_comparable_facilities`
   - `get_medicaid_rates` (if data available)
   
2. **Tier 1: Additional Navigation Tools (as needed)**
   - Quality trend queries
   - Financial metrics queries
   - Additional market queries

**Success Criteria:**
- All Tier 1 navigation tools complete (35 tools total)
- Can analyze quality trends (CMS queries)
- Can compare facilities to benchmarks (CMS + REAPI)
- Can track market activity (CMS + REAPI)
- Can access property-level real estate data (REAPI)

---

### **Phase 2: Tier 2 Intelligence Tools (2 weeks)**

**Goal:** Build intelligence layer on top of navigation foundation

**Prerequisite:** Tier 1 navigation tools complete and tested

**Deliverables:**
1. **Tier 2: Research Services**
   - SOS scraper service (Secretary of State filings)
   - Web scraper service (LinkedIn, company sites, news)
   - Enformion API client (contact enrichment)
   - Research orchestrator (coordinates multi-source research)
   
2. **Tier 2: Contact Intelligence Tools (3 tools)**
   - `generate_contact_brief` (uses Navigation + Web + Enformion + AI)
   - `research_principal` (uses Navigation + Web + SOS + Enformion + AI)
   - `batch_research_principals` (parallel processing for 50+ principals)
   
3. **Tier 2: Network Intelligence Tools (2 tools)**
   - `generate_network_map` (uses Navigation + AI)
   - `generate_network_report` (uses Navigation + AI)
   
4. **Tier 2: Export Integration Tools (3 tools)**
   - `export_to_mailchimp` (formats contact briefs for Mailchimp)
   - `export_to_terrakotta` (formats for Terrakotta AI)
   - `export_pdf_report` (generates PDF reports)

**Success Criteria:**
- Can generate contact briefs using navigation + research + AI
- Can research principals via SOS scraping and web research
- Can generate network visualizations and reports
- Can export to Mailchimp, Terrakotta, PDF
- **Intelligence layer complete:** All Tier 2 tools operational (8 tools total)

---

### **Phase 3: Web UI (Optional - 2 weeks)**

**Goal:** Web-based interface (alternative to Claude Desktop)

**Deliverables:**
- React frontend
- Facility search and profile pages
- Network graph visualization (D3.js)
- Portfolio dashboards
- User authentication

**Success Criteria:**
- All MCP tools accessible via web UI
- Graph visualization working
- Production-ready deployment

---

### **Timeline Summary**

| Phase | Duration | Deliverable | Tool Count |
|-------|----------|-------------|------------|
| Phase 1: Tier 1 Navigation Foundation | 2 weeks | Core navigation tools | 26 tools |
| Phase 1+: Tier 1 Navigation Completion | 1.5 weeks | Remaining navigation tools | 9 tools (35 total) |
| Phase 2: Tier 2 Intelligence | 2 weeks | Intelligence tools | 8 tools |
| Phase 3: Web UI (Optional) | 2 weeks | Web interface | N/A |
| **Total** | **5.5-7.5 weeks** | **Full system** | **43 tools** |

---

## Success Metrics

### **User Success Metrics**

**Time savings:**
- Before: 2-4 hours to research one property ownership chain (Property → Entity → Principal)
- After: <5 minutes for complete ownership intelligence
- **Target:** 90%+ time reduction

**Coverage:**
- Before: Partial picture (only database records)
- After: Complete network (all connections visible via Property → Entity → Principal navigation)
- **Target:** 100% of properties navigable through entity → principal links

**Decision quality:**
- Before: Decisions with incomplete information
- After: Decisions with full network context
- **Target:** User-reported increase in confidence

---

### **System Performance Metrics**

**Query performance:**
- Average tool response time: <2 seconds
- 95th percentile: <5 seconds
- Database query optimization: Use views (gold layer)

**Data freshness:**
- CMS data: Monthly updates (track last sync)
- REAPI data: Weekly updates (track last sync)
- Zoho data: Daily updates (track last sync)
- **Target:** <24 hour staleness for time-sensitive data

**Coverage:**
- Properties with verified CCN ↔ Property ID link: 90%+
- Properties with ownership data: 95%+
- Properties with quality metrics: 100% (CMS requirement)
- Principal linking structure coverage: Target percentage TBD (built via SOS scrape + web research)

---

### **Adoption Metrics**

**Usage:**
- Active users per month
- Tools used per session (navigation depth)
- Most-used workflows (acquisition, portfolio, market intelligence)

**Value realization:**
- Acquisitions informed by Atlas
- Portfolio decisions based on network insights
- Market intelligence discoveries

---

## Appendix

### **Glossary**

**CCN (CMS Certification Number):** Unique identifier for healthcare facilities regulated by CMS

**REAPI:** Real estate data provider (property valuations, sales, demographics)

**Property ID:** REAPI's unique identifier for properties/parcels

**MCP (Model Context Protocol):** Protocol for integrating external data sources with Claude

**Gold Layer:** Pre-joined, optimized database views ready for queries

**Graph Navigation:** The "subway map" concept - start anywhere, navigate everywhere

**Paper Trail:** Following ownership chains through entities (Property → Entity → Principal)

**Network:** Connections between properties, entities, and principals (Property ↔ Entity ↔ Principal)

---

### **Technical Stack**

**MCP Server:**
- Python 3.10+
- `mcp` library (Model Context Protocol)
- `aiomysql` (async MySQL client)
- `pydantic` (data validation)

**Database:**
- MySQL (3G's existing database)
- Views as gold layer

**Deployment:**
- Docker containers (or bare metal Python)
- Linux (Ubuntu 22.04 recommended)
- Environment variable configuration

---

**Last Updated:** January 2026  
**Version:** 1.0  
**Status:** Planning & Architecture Phase
