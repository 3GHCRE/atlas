# How The Atlas Toolkit Orchestrates Together

**Version:** 2.0
**Vertical:** Healthcare (SNF/Skilled Nursing Facilities)
**Based on:** VÄV OS Universal Template

---

## The GPS Navigation System

Think of Atlas as a GPS navigation system for healthcare ownership networks:

**Tier I: Data Layer Tools (41 tools)** - The core GPS functions
- **Record Tools** - Points of Interest (find any facility, company, or principal)
- **Navigation Tools** - Route Engine (trace ownership chains, map portfolios)
- **Utility Tools** - System Diagnostics (health checks, data quality)

**Tier II: Intelligence Tools (11 tools)** - The Trip Planner
- Plans complete journeys (contact briefs, research reports)
- Orchestrates all GPS functions
- Adds real-time traffic (web research, SOS filings, Enformion)
- Creates actionable itineraries (Mailchimp campaigns, PDF reports)

The AI conductor orchestrates them together to create intelligence.

---

## Tool Categorization: Color System

| Category | Metaphor | Color | Hex | Purpose |
|----------|----------|-------|-----|---------|
| Record Tools | Points of Interest | Lavender Blue | #C1D2FF | Fetch any node by ID or search criteria |
| Navigation Tools | Route Engine | Orange | #F59E0B | Traverse graph connections, find paths |
| Utility Tools | System Diagnostics | Slate | #64748B | Health checks, conversions, maintenance |
| Intelligence Tools | Trip Planner | Purple | #8B5CF6 | Orchestrate tools + research + synthesis |
| Connection Lines | — | Banana Yellow | #FFE7A7 | Visual: edges/relationships |
| Graph Hub | — | Orange | #F59E0B | Visual: central orchestrator |

---

## The Two-Tier System

```
┌──────────────────────────────────────────────────────────────────┐
│                    THE GPS NAVIGATION SYSTEM                      │
│                    (Atlas Healthcare Edition)                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │        TIER II: INTELLIGENCE TOOLS (Purple)              │    │
│   │                  "The Trip Planner"                       │    │
│   │   Plans complete journeys, orchestrates everything       │    │
│   └──────────────────────────┬──────────────────────────────┘    │
│                              ↓                                    │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │              TIER I: DATA LAYER TOOLS (41)                │   │
│   │                                                            │   │
│   │  ┌────────────────┐  ┌────────────────┐  ┌────────────┐  │   │
│   │  │ RECORD TOOLS   │  │ NAVIGATION     │  │ UTILITY    │  │   │
│   │  │ (Lavender Blue)│→→│ TOOLS (Orange) │→→│ (Slate)    │  │   │
│   │  │                │  │                │  │            │  │   │
│   │  │ "Points of     │  │ "Route Engine" │  │ "System    │  │   │
│   │  │  Interest"     │  │                │  │ Diagnostics"│ │   │
│   │  │                │  │                │  │            │  │   │
│   │  │ • get_facility │  │ • trace_network│  │ • get_stats│  │   │
│   │  │ • get_company  │  │ • get_portfolio│  │ • quality  │  │   │
│   │  │ • get_principal│  │ • find_path    │  │   monitor  │  │   │
│   │  │ • search_*     │  │ • traverse_*   │  │            │  │   │
│   │  └────────────────┘  └────────────────┘  └────────────┘  │   │
│   │                                                            │   │
│   └──────────────────────────────────────────────────────────┘   │
│                              ↓                                    │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                    GRAPH DATABASE                          │   │
│   │   ┌──────┐    ┌─────────┐    ┌───────────┐               │   │
│   │   │FACILITY│←→│ COMPANY │←→│ PRINCIPAL │               │   │
│   │   └──────┘    └─────────┘    └───────────┘               │   │
│   └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## The Complete 52-Tool Breakdown

### Tier I: Data Layer Tools (41 tools)

---

### Record Tools - "Points of Interest" (Lavender Blue #C1D2FF)

**What they do:** Look up any destination on the healthcare map
**Function:** Fetch any single node or search by criteria
**Output:** Raw entity data (facilities, companies, principals, deals, markets)

#### CMS Data Queries (4 tools)

| Tool | Purpose | Data Source |
|------|---------|-------------|
| `get_facility()` | Single facility by CCN | CMS Provider Info |
| `get_quality_scores()` | Star ratings, deficiencies | CMS Quality |
| `get_chow_events()` | Change of ownership history | CMS CHOW |
| `search_facilities()` | Filter by state, stars, ownership | CMS Combined |

#### REAPI Data Queries (4 tools)

| Tool | Purpose | Data Source |
|------|---------|-------------|
| `get_property_details()` | Property characteristics | REAPI Property |
| `get_property_transactions()` | Sale history | REAPI Sales |
| `get_mortgage_history()` | Lender relationships | REAPI Mortgages |
| `search_properties()` | Filter by geography, value | REAPI Combined |

#### Deals & Transactions (6 tools)

| Tool | Purpose | Data Source |
|------|---------|-------------|
| `get_deal_history()` | Transaction timeline | Deals DB |
| `get_buyer_seller_patterns()` | Repeat transaction pairs | Deals Analysis |
| `get_lender_relationships()` | Who lends to whom | Deals + REAPI |
| `get_deal_participants()` | All parties in a deal | Deals DB |
| `get_transaction_volume()` | Market activity metrics | Deals Aggregate |
| `compare_deal_terms()` | Side-by-side deal analysis | Deals DB |

#### CRM & Principal Data (3 tools)

| Tool | Purpose | Data Source |
|------|---------|-------------|
| `get_principal()` | Single principal by ID | Zoho + Graph |
| `get_principal_partnerships()` | Co-investors, partners | Graph Analysis |
| `get_principal_companies()` | All companies controlled | Graph Traversal |

#### Market & Segment Data (3 tools)

| Tool | Purpose | Data Source |
|------|---------|-------------|
| `get_market_stats()` | Market activity summary | Markets DB |
| `get_top_buyers()` | Leading acquirers | Deals Aggregate |
| `get_top_sellers()` | Active sellers | Deals Aggregate |

**Record Tools Characteristics:**
- Pure facts, no interpretation
- Fast, deterministic responses
- Universal across any node type
- "Get me this facility" or "Search for facilities matching X"

---

### Navigation Tools - "Route Engine" (Orange #F59E0B)

**What they do:** Calculate paths between healthcare entities
**Function:** Traverse graph relationships, many-to-many
**Output:** Connected entities, paths, ownership networks

#### Network Traversal (6 tools)

| Tool | Purpose | Traversal Type |
|------|---------|----------------|
| `trace_ownership_network()` | Facility → Company → Principal chain | Full chain |
| `get_portfolio()` | All facilities controlled by company | Company → Facilities |
| `get_related_properties()` | Facilities via shared ownership | Cross-reference |
| `get_neighborhood()` | 1-hop connections from any node | Single hop |
| `find_ownership_path()` | Shortest path between entities | BFS pathfinding |
| `traverse_ownership_network()` | Multi-hop traversal with depth | Multi-hop |

#### Ownership Intelligence (4 tools)

| Tool | Purpose | Analysis Type |
|------|---------|---------------|
| `get_ownership_timeline()` | Ownership history over time | Temporal |
| `list_related_entities()` | Find connected entities | Graph query |
| `find_connected_principals()` | Discover network connections | Network analysis |
| `get_network_centrality()` | Most-connected entities | Centrality score |

#### Markets & Segments (4 tools)

| Tool | Purpose | Scope |
|------|---------|-------|
| `get_hot_markets()` | Activity breakdown by geography | Geographic |
| `search_market_activity()` | Filter transactions by criteria | Market-wide |
| `get_segment_behavior()` | Behavioral pattern analysis | Segment-based |
| `filter_by_segment()` | Multi-tag filtering | Flexible |

**Navigation Tools Characteristics:**
- Graph traversal operations
- Many-to-many relationship handling
- Path finding and network mapping
- "Show me connections" or "Trace ownership from A to B"

---

### Utility Tools - "System Diagnostics" (Slate #64748B)

**What they do:** Health checks, conversions, maintenance
**Function:** System utilities and data quality
**Output:** Status information, quality metrics

| Tool | Purpose |
|------|---------|
| `get_database_stats()` | System health and metrics |
| `get_data_quality()` | Data completeness monitoring |

**Utility Tools Characteristics:**
- System operations
- Data quality monitoring
- Maintenance utilities
- "Is the system healthy?" or "What's our data coverage?"

---

### Tier II: Intelligence Tools (11 tools) - "Trip Planner" (Purple #8B5CF6)

**What they do:** Plan complete journeys with context
**Function:** Orchestrate Tier I tools + external research + AI synthesis
**Output:** Formatted briefs, reports, exports (ready to use)

---

#### Contact Intelligence Suite (3 tools)

**generate_contact_brief** - Single principal, complete brief
- Calls: 5-8 Tier I tools + web research + Enformion + AI
- Output: Formatted brief ready for outreach

**research_principal** - Deep research on one principal
- Calls: 8-12 Tier I tools + extensive web + SOS + Enformion + AI
- Output: Comprehensive research report

**batch_research_principals** - 50+ principals in parallel
- Calls: All above, parallelized
- Output: Mailchimp-ready contact list with briefs

---

#### Network Intelligence Suite (2 tools)

**generate_network_map** - Visual network diagram
- Calls: Navigation tools + graph queries
- Output: D3.js visualization + relationship summary

**generate_network_report** - PDF network report
- Calls: Navigation tools + AI synthesis
- Output: Client-ready PDF with ownership analysis

---

#### Deals Intelligence Suite (3 tools)

**calculate_relationship_strength** - Score buyer/seller relationships
- Calls: Deal navigation tools + pattern analysis
- Output: 0-100 score with supporting evidence

**generate_acquisition_profile** - Company's M&A activity
- Calls: Deal navigation + portfolio tools + AI
- Output: Acquisition strategy report

**identify_strategic_partnerships** - Repeat deal pairs
- Calls: Deal navigation + relationship queries
- Output: Partnership analysis with deal history

---

#### Export Integration Suite (3 tools)

| Tool | Input | Output |
|------|-------|--------|
| `export_to_mailchimp` | contact_list, campaign | Segmented outreach campaigns |
| `export_to_terrakotta` | contact_list, script | AI voice campaign ready |
| `export_pdf_report` | report_data, template | PDF document |

---

## How They Work Together (Real Example)

**User Request:** "Generate contact brief for John Rosatti"

```
┌────────────────────────────────────────────────────────────┐
│  Tier II: generate_contact_brief("John Rosatti")           │
│  (Trip Planner - Orchestrates everything)                   │
└────────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────┐
│  STEP 1: Call Tier I Tools                                  │
│                                                             │
│  RECORD TOOLS (Points of Interest):                        │
│  → get_principal("John Rosatti")                           │
│  → get_principal_partnerships("John Rosatti")              │
│  → get_deal_history("Portopicolo Group")                   │
│                                                             │
│  NAVIGATION TOOLS (Route Engine):                          │
│  → trace_ownership_network("John Rosatti")                 │
│    Returns: All companies he controls + properties         │
│  → get_portfolio("Portopicolo Group")                      │
│    Returns: Complete property portfolio with metrics       │
└────────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────┐
│  STEP 2: Web Research (Fill Gaps)                          │
│                                                             │
│  → SOS Scraper: Search NJ Secretary of State               │
│    Returns: Corporate filings, officer names, dates        │
│                                                             │
│  → Web Scraper: LinkedIn + Company sites                   │
│    Returns: Bio info, recent news, company updates         │
│                                                             │
│  → Enformion API: Contact enrichment                       │
│    Returns: Phone number, email, verified address          │
└────────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────┐
│  STEP 3: AI Synthesis                                       │
│                                                             │
│  → Combine all data sources                                │
│  → Generate narrative structure                            │
│  → Format for outreach context                             │
│  → Add strategic insights                                  │
└────────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────┐
│  OUTPUT: Complete Contact Brief (Ready to Use)             │
│                                                             │
│  JOHN ROSATTI - CONTACT BRIEF                             │
│  ────────────────────────────────────                      │
│  Controls: Portopicolo Group (75 facilities)               │
│  Structure: Vertical integration (Opco + Propco)           │
│  Acquisition Profile: 12 deals last 18 months ($145M)      │
│  Geographic Focus: FL, NY, NJ markets                      │
│  Primary Lender: National Healthcare Capital               │
│  Contact: [phone], [email], [LinkedIn]                     │
│  Outreach Strategy: [AI-generated recommendations]         │
└────────────────────────────────────────────────────────────┘
```

---

## The Orchestration Patterns

### Pattern 1: Simple Navigation (Tier I only)

**User:** "Who owns Memorial Nursing Home?"

```
Orchestration:
RECORD: get_facility("Memorial")
  → Returns: CCN, operator name, address

NAVIGATION: trace_ownership_network(ccn="105678")
  → Returns: Companies + Principals + Roles

OUTPUT: "Owned by XYZ Propco (John Doe), operated by ABC Healthcare (John Doe)"
```

- **Tools used:** 1 Record + 1 Navigation
- **Time:** ~2 seconds
- **AI synthesis:** None needed

---

### Pattern 2: Light Intelligence (Tier I + minimal Tier II)

**User:** "Show me John Doe's complete portfolio"

```
Orchestration:
RECORD:
  get_principal("John Doe")
  get_principal_partnerships("John Doe")

NAVIGATION:
  trace_ownership_network("John Doe")
  get_portfolio(all companies controlled by John)

INTELLIGENCE (minimal):
  AI formats the results into readable summary

OUTPUT: Formatted portfolio list with totals
```

- **Tools used:** 2 Record + 2 Navigation + light AI
- **Time:** ~5 seconds
- **AI synthesis:** Formatting only

---

### Pattern 3: Full Intelligence (Complete Tier II)

**User:** "Generate contact brief for acquisition prospects in Florida"

```
Orchestration:
RECORD (parallel):
  search_facilities(state="FL", deal_activity=recent)
  → Returns: 50 properties with recent deals

NAVIGATION (for each property):
  trace_ownership_network()
  get_portfolio()

  Filter by segment_relationships(segment="Quality-First Operator")
  → 25 qualified principals

INTELLIGENCE:
  Web scraping (LinkedIn, company sites, news)
  SOS scraping (corporate filings)
  Enformion (contact enrichment)
  AI generates individual briefs
  Scores relationship strength
  Prioritizes by acquisition likelihood

EXPORT:
  export_to_mailchimp(segmented campaign)

OUTPUT: Complete outreach campaign with 25 prioritized prospects
```

- **Tools used:** 15-25 Tier I + 3 Tier II
- **Time:** ~5-10 minutes
- **AI synthesis:** Full narrative generation

---

## Real-World Orchestration Examples

### Example 1: Morning Market Brief

**User:** "What happened in Florida SNF market last week?"

```
Orchestration:
RECORD:
  get_transaction_volume(market="Florida SNF", days=7)
  → Returns: 3 deals totaling $28M

  For each deal:
    get_deal_participants()
    → Returns: Buyer, seller, lender, amount

NAVIGATION:
  get_portfolio(each buyer)
  → Returns: Acquisition patterns

  get_lender_relationships(each lender)
  → Returns: Lender's typical borrowers

INTELLIGENCE:
  AI creates narrative summary with patterns

OUTPUT: Weekly market brief (email-ready)
Time: 2 minutes
Tools used: 10 Record/Nav + 1 Intelligence
```

### Example 2: Competitive Intelligence

**User:** "How aggressive is Portopicolo compared to competitors?"

```
Orchestration:
RECORD (parallel):
  get_deal_history("Portopicolo")
  → 12 deals, $145M, 18 months

  get_market_stats(markets where Portopicolo operates)
  → FL, NY, NJ market data

NAVIGATION:
  For each market:
    get_top_buyers()
    → Compare Portopicolo to market leaders

  get_buyer_seller_patterns("Portopicolo")
  → Strategic partnerships revealed

  filter_by_segment(segment="Private Equity")
  → PE peer group for comparison

INTELLIGENCE:
  calculate_relationship_strength() for all partnerships
  generate_acquisition_profile("Portopicolo")

OUTPUT: Competitive positioning report
Time: 3 minutes
Tools used: 15 Tier I + 2 Tier II
```

### Example 3: Pipeline Generation

**User:** "Build outreach list for retiring owners in Southeast"

```
Orchestration:
RECORD (parallel across regions):
  search_facilities(states=["FL","GA","SC","NC","AL"])
  → 3,200 properties

  filter_by_segment(segment="Family-Owned Operators")
  → 890 properties

NAVIGATION (for each property):
  trace_ownership_network()
  → Get principals

  Filter principals by patterns:
  - Original owner (>15 years)
  - Small portfolio (3-8 properties)
  - Strong quality (4+ stars avg)
  → 67 principals qualified

  get_principal_partnerships() for each
  → Identify co-owners who might also sell

INTELLIGENCE (parallel for 67 principals):
  batch_research_principals()
  → Web + SOS + Enformion for all 67
  → Generates 67 contact briefs

EXPORT:
  export_to_mailchimp(
    campaign="Southeast Retiring Owners Q1 2026",
    segments=qualified_principals
  )

OUTPUT: 67-contact Mailchimp campaign, fully researched
Time: 10 minutes for 67 complete briefs
Tools used: 25+ Tier I + 3 Tier II
```

---

## The Data Flow (Complete System)

```
┌──────────────────────────────────────────────────────────────┐
│                     USER REQUEST                              │
│  "Find aggressive acquirers in Florida with quality focus"   │
└───────────────────────┬──────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│              TIER II INTELLIGENCE TOOL                        │
│         (Trip Planner - Orchestrates the workflow)            │
└───────────────────────┬──────────────────────────────────────┘
                        ↓
        ┌───────────────┴───────────────┐
        ↓                               ↓
┌─────────────────┐           ┌─────────────────────┐
│  TIER I TOOLS   │           │  EXTERNAL RESEARCH  │
│                 │           │                     │
│ RECORD (Blue)   │           │  Web/SOS/Enformion  │
│ NAVIGATION (Or) │           │                     │
│ UTILITY (Slate) │           │                     │
└────────┬────────┘           └──────────┬──────────┘
         ↓                               ↓
┌────────────────────────────────────────────────────┐
│              3G'S MYSQL DATABASE                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ property │  │ companies│  │principals│         │
│  │ _master  │  │          │  │          │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                     │
│  ┌──────────────────┐  ┌──────────────────┐       │
│  │ property_company │  │ principal_company│       │
│  │ _relationships   │  │ _relationships   │       │
│  │                  │  │                  │       │
│  │ relationship_type│  │ role = KEY FIELD│       │
│  │ = KEY FIELD      │  │                  │       │
│  └──────────────────┘  └──────────────────┘       │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │  deals   │  │  markets │  │ segments │         │
│  └──────────┘  └──────────┘  └──────────┘         │
└─────────────────────────────────────────────────────┘
         ↓                               ↓
        Structured Data          Enrichment Data
         ↓                               ↓
        └───────────────┬───────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│                   AI SYNTHESIS                                │
│  Combines navigation results + research + context            │
└───────────────────────┬──────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│                 FORMATTED OUTPUT                              │
│                                                               │
│  FLORIDA ACQUISITION PROSPECTS                               │
│  ────────────────────────────────────                        │
│  1. John Rosatti - Portopicolo Group                         │
│     • 12 FL properties, 4.2 avg stars                        │
│     • 5 acquisitions last 18 months                          │
│     • Aggressive acquirer, quality-first                     │
│     • Contact: [details]                                     │
│                                                               │
│  2. Jane Smith - ABC Healthcare                              │
│     • 8 FL properties, 4.5 avg stars                         │
│     • 3 acquisitions last 12 months                          │
│     • Strategic buyer, premium quality                       │
│     • Contact: [details]                                     │
│                                                               │
│  [Export to Mailchimp] [Generate PDFs] [Add to Terrakotta]  │
└──────────────────────────────────────────────────────────────┘
```

---

## Why This Orchestration is Powerful

### 1. Composability

Each tool does ONE thing well, but they combine infinitely:

```
Want just basic info?
  → Use 1 Record tool

Want ownership network?
  → Combine Record + Navigation tools

Want complete intelligence?
  → Use 1 Intelligence tool (orchestrates 8+ tools + research)

Want batch processing?
  → Intelligence tool parallelizes dozens of workflows
```

Like GPS routes - same roads, unlimited destinations.

### 2. Progressive Enhancement

You can add intelligence layers incrementally:

| Level | Description | Tools | Time |
|-------|-------------|-------|------|
| 1 | Just navigation | 1 Record | 2 sec |
| 2 | Navigation + context | Record + Navigation | 5 sec |
| 3 | Navigation + research | Tier I + web | 30 sec |
| 4 | Navigation + research + batch | Tier I + Tier II | 5 min |

### 3. Separation of Concerns

**Tier I: The "What"** (Data Layer)
- What facilities exist (Record - CMS)
- What companies control them (Navigation)
- What principals own them (Navigation)
- What deals happened (Record - Deals)
- What markets they're in (Record - Markets)
- What segments they belong to (Record - Segments)

Pure facts, no interpretation.

**Tier II: The "So What"** (Intelligence Layer)
- So what does this mean for outreach?
- So what partnerships exist?
- So what's the acquisition strategy?
- So what should we prioritize?

Context, synthesis, actionability.

---

## Healthcare Vertical Configuration

Atlas extends the VÄV OS universal pattern with healthcare-specific data:

| Component | Universal | Healthcare (Atlas) |
|-----------|-----------|-------------------|
| **Property (Node)** | property | facility (SNF) |
| **Company (Node)** | company | opco/propco |
| **Principal (Node)** | principal | owner/operator |
| **Entity (Junction)** | entity | property_company_relationships |
| **relationship_type** | owner, operator, lender | + management_services, affiliate |
| **role** | ceo, board, owner | + administrator, medical_director |
| **Data Sources** | Graph + CRM | CMS, REAPI, Zoho, Deals |
| **Enrichment APIs** | Contact, Corporate | Enformion, SOS, LinkedIn |

### 8 Behavioral Segments

| Segment | Description |
|---------|-------------|
| Quality-First | 4+ star average, invests in quality |
| Aggressive Acquirer | 5+ deals in 18 months |
| PE-Backed | Private equity ownership |
| Family-Owned | Single family control, often long tenure |
| REIT-Owned | Real estate investment trust structure |
| Distressed | Quality issues, potential seller |
| Growth Platform | Building regional presence |
| Exit Candidate | Long tenure, small portfolio, aging owner |

---

## The Result

**Before Atlas:**
"Who owns this property?" = 2-4 hours of manual research

**With Atlas:**
"Generate acquisition intelligence for 50 prospects in my target market" = 10 minutes, export-ready

---

That's how the toolkit orchestrates: **52 tools working as one system**, with Tier I providing the data foundation and Tier II delivering the intelligence.
