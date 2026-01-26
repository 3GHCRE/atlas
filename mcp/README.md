# 3GHCRE Atlas MCP Server

MCP (Model Context Protocol) server for the 3GHCRE Atlas SNF ownership database. Provides **41 tools** across 6 categories for querying, navigating, and analyzing skilled nursing facility ownership networks.

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server (typically launched by Claude Desktop)
npm start
```

## Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| Record | 9 | Get/search properties, entities, companies, principals, deals |
| Graph | 12 | Trace ownership chains, navigate networks, find paths |
| Market | 5 | Market statistics, top buyers/sellers/lenders, hot markets |
| Hierarchy | 4 | PropCo/OpCo portfolios, parent company hierarchy |
| Performance | 5 | CMS quality ratings, staffing, cost reports, Medicaid rates |
| Intelligence | 6 | SEC EDGAR filings, ProPublica nonprofit 990s, REIT verification |

---

## Record Tools (9 tools)

Core CRUD operations for database entities.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_property` | Get property by ID or CCN with all relationships | `id`, `ccn` |
| `get_entity` | Get entity by ID with company and principals | `id` |
| `get_company` | Get company by ID or name with statistics | `id`, `name` |
| `get_principal` | Get principal by ID with relationships (resolves merged records) | `id`, `include_merged` |
| `get_deal` | Get deal by ID with parties and type-specific details | `id` |
| `search_properties` | Filter properties by state, city, name, owner/operator | `state`, `city`, `facility_name`, `owner_company_id`, `operator_company_id` |
| `search_companies` | Filter companies by name, type, state, property count | `name`, `type`, `state`, `min_properties` |
| `search_principals` | Filter principals by name, company, role, state | `name`, `company_id`, `role`, `state` |
| `search_deals` | Filter deals by property, type, date range, company, amount | `property_id`, `ccn`, `deal_type`, `date_from`, `date_to`, `company_id`, `min_amount` |

---

## Graph Tools (12 tools)

Network navigation and relationship tracing.

### Ownership Chain Tracing

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `trace_owner` | Property → Owner Entity → Parent Company → Officers | `property_id`, `ccn`, `include_all_principals` |
| `trace_operator` | Property → Operator Entity → Operating Company → Officers | `property_id`, `ccn`, `include_all_principals` |
| `trace_lender` | Property → Lender Entity → Lending Company → Officers | `property_id`, `ccn`, `include_all_principals` |
| `trace_principal_network` | Principal → Companies → All Properties | `principal_id`, `include_historical` |

### Portfolio & Relationships

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_portfolio` | Get all properties for a company | `company_id`, `relationship_type`, `state` |
| `find_related_entities` | Find companies sharing properties | `company_id`, `relationship_type`, `related_type` |
| `get_deal_history` | Full transaction timeline for a property | `property_id`, `ccn` |
| `get_deal_parties` | All participants in a deal by role | `deal_id` |

### Advanced Network Analysis

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `traverse_ownership_network` | D3-compatible graph traversal from any node | `start_type`, `start_id`, `direction`, `max_depth` |
| `find_ownership_path` | Shortest path between two nodes (BFS) | `source_type`, `source_id`, `target_type`, `target_id` |
| `get_network_centrality` | Rank most connected nodes | `node_type`, `metric`, `state` |
| `get_relationship_strength` | Analyze strength between two companies | `company_id_1`, `company_id_2` |

---

## Market Tools (5 tools)

Transaction analytics and market intelligence.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_market_stats` | Aggregate stats by state, deal type, or month | `group_by`, `state`, `deal_type`, `days` |
| `get_top_buyers` | Most active acquirers ranked by deal count | `state`, `deal_type`, `days`, `limit` |
| `get_top_sellers` | Most active disposers ranked by deal count | `state`, `deal_type`, `days`, `limit` |
| `get_top_lenders` | Most active financers ranked by loan count | `state`, `days`, `limit` |
| `get_hot_markets` | State-level market activity rankings | `deal_type`, `days`, `min_deals`, `limit` |

---

## Hierarchy Tools (4 tools)

PropCo/OpCo structure and parent company relationships.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `identify_parent_company` | Pattern-match entity name to find parent company | `entity_id`, `company_id`, `name` |
| `get_propco_portfolio` | PropCo details with owned properties and siblings | `entity_id`, `entity_name` |
| `get_parent_company_portfolio` | Full parent company view: entities, properties, principals | `company_id`, `include_operator_properties` |
| `get_portfolio_hierarchy` | Multi-level ownership hierarchy from any starting point | `property_id`, `ccn`, `entity_id`, `company_id`, `include_siblings` |

---

## Performance Tools (5 tools)

CMS quality metrics, staffing data, and financial performance.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_quality_ratings` | Star ratings, inspection scores, SFF status, penalties | `property_id`, `ccn`, `include_history`, `limit` |
| `get_staffing_data` | PBJ staffing (HPRD), turnover, census by quarter | `property_id`, `ccn`, `include_history`, `limit` |
| `get_cost_reports` | HCRIS revenue, expenses, profitability, utilization | `property_id`, `ccn`, `include_history`, `limit` |
| `get_medicaid_rates` | Medicaid $/day with state comparison | `property_id`, `ccn`, `include_history`, `limit` |
| `get_facility_performance` | Combined summary: quality + staffing + financial | `property_id`, `ccn` |

---

## Intelligence Tools (6 tools)

External data integration for REITs and nonprofits.

### SEC EDGAR (for publicly traded REITs)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `sec_company_lookup` | Find CIK by company name or ticker (OHI, SBRA, WELL, CTRE, LTC) | `name`, `ticker` |
| `sec_get_filings` | Get 10-K/10-Q filings by CIK | `cik`, `form_type`, `limit` |
| `sec_get_filing_content` | Extract data from SEC filing (properties, summary) | `cik`, `accession_number`, `extract` |

### ProPublica (for nonprofit operators)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `nonprofit_search` | Search ProPublica Nonprofit Explorer by name | `q`, `state`, `page` |
| `nonprofit_get_990` | Get IRS Form 990 details by EIN | `ein` |

### Cross-Reference

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `verify_reit_portfolio` | Compare SEC data against Atlas database | `company_id`, `company_name`, `ticker` |

---

## Data Model

```
property_master (14,054)
    ↓ property_entity_relationships
entities (29,508)
    ↓ company_id FK
companies (9,749)
    ↓ principal_company_relationships
principals (47,386)
```

### Record Counts (as of January 2026)

| Table | Count | Description |
|-------|-------|-------------|
| `property_master` | 14,054 | SNF facilities (unique by CCN) |
| `entities` | 29,508 | Legal entities (LLCs, Corps) |
| `companies` | 9,749 | Consolidated ownership groups |
| `principals` | 47,386 | Individual owners, officers, directors |
| `deals` | 29,365 | Transactions (mortgages, sales, CHOWs) |
| `property_entity_relationships` | 49,469 | Property ↔ Entity links |

### Relationship Types

- `property_owner` - Who owns the property
- `facility_operator` - Who operates the facility (may differ from owner)
- `lender` - Mortgage/financing relationship
- `property_buyer` - Buyer in a transaction
- `property_seller` - Seller in a transaction
- `property_borrower` - Borrower in a financing

### Company Types

| Type | Count | Description |
|------|-------|-------------|
| `owner_operator` | 3,903 | Both owns and operates |
| `other` | 3,955 | Miscellaneous/unclassified |
| `lending` | 1,495 | Banks and financial institutions |
| `operating` | 315 | Pure operators (no ownership) |
| `ownership` | 81 | Pure REITs/PropCos |

---

## Claude Desktop Configuration

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac):

```json
{
  "mcpServers": {
    "3ghcre-atlas": {
      "command": "node",
      "args": ["C:/path/to/3GHCRE/mcp/dist/index.js"],
      "env": {
        "LOCAL_DB_HOST": "localhost",
        "LOCAL_DB_PORT": "3306",
        "LOCAL_DB_USER": "root",
        "LOCAL_DB_PASSWORD": "YOUR_PASSWORD_HERE",
        "LOCAL_DB_NAME": "atlas"
      }
    }
  }
}
```

---

## Example Queries

### Basic Lookups
- "Who owns the most SNF properties in Texas?"
- "Show me Omega Healthcare's portfolio"
- "Get details for CCN 675432"

### Ownership Tracing
- "Trace the ownership chain for Sunrise Care Center"
- "Who are the principals behind Portopiccolo Group?"
- "Find the path between Sabra REIT and Genesis Healthcare"

### Market Intelligence
- "What were the top 10 SNF acquisitions in Florida last quarter?"
- "Which lenders are most active in skilled nursing?"
- "Show me hot markets for SNF transactions"

### Performance Analysis
- "What's the quality rating for CCN 675432?"
- "Show staffing trends for this facility over the past 2 years"
- "Get the cost report data for Omega's Texas properties"

### External Verification
- "Look up Omega Healthcare in SEC EDGAR"
- "Find the 990 for Good Samaritan Society"
- "Verify CareTrust REIT portfolio against Atlas"

---

## Development

```bash
# Run in development mode (watch for changes)
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOCAL_DB_HOST` | MySQL host | localhost |
| `LOCAL_DB_PORT` | MySQL port | 3306 |
| `LOCAL_DB_USER` | MySQL user | root |
| `LOCAL_DB_PASSWORD` | MySQL password | (required) |
| `LOCAL_DB_NAME` | Database name | atlas |

---

## Architecture

```
mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── db.ts                 # Database connection pool
│   └── tools/
│       ├── index.ts          # Tool registry (41 tools)
│       ├── record/           # CRUD operations (9 tools)
│       ├── graph/            # Network navigation (12 tools)
│       ├── market/           # Market analytics (5 tools)
│       ├── hierarchy/        # PropCo/parent hierarchy (4 tools)
│       ├── performance/      # CMS quality/financial (5 tools)
│       └── intelligence/     # SEC/nonprofit lookup (6 tools)
├── dist/                     # Compiled JavaScript
├── package.json
└── tsconfig.json
```
