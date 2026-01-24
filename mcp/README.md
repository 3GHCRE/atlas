# 3GHCRE Atlas MCP Server

MCP (Model Context Protocol) server for the 3GHCRE Atlas SNF ownership database. Provides 15 tools for querying and navigating the ownership network.

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server (typically launched by Claude Desktop)
npm start
```

## Tools

### Record Tools (9 tools)
| Tool | Description |
|------|-------------|
| `get_property` | Get property by ID or CCN with all relationships |
| `get_entity` | Get entity by ID with company and principals |
| `get_company` | Get company by ID or name with entities and statistics |
| `get_principal` | Get principal by ID with company/entity relationships |
| `get_deal` | Get deal by ID with parties and type-specific details |
| `search_properties` | Filter properties by state, city, name, owner/operator |
| `search_companies` | Filter companies by name, type, state, property count |
| `search_principals` | Filter principals by name, company, role, state |
| `search_deals` | Filter deals by property, type, date range, company, amount |

### Graph/Navigation Tools (6 tools)
| Tool | Description |
|------|-------------|
| `trace_owner` | Trace Property → Entity → Company → Principals |
| `get_portfolio` | Get all properties for a company |
| `find_related_entities` | Find companies sharing properties (cross-reference) |
| `get_deal_history` | Get full deal timeline for a property |
| `get_deal_parties` | Get all participants in a deal |
| `trace_principal_network` | Trace Principal → Companies → Properties |

## Data Model

```
property_master (14,054)
    ↓ property_entity_relationships
entities (16,261)
    ↓ company_id FK
companies (4,144)
    ↓ principal_company_relationships
principals (47,386)
```

**Relationship Types:** property_owner, facility_operator, lender, property_buyer, property_seller, property_borrower

**Entity Types:** opco, propco, management, holding, pe_firm, reit

## Claude Desktop Configuration

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "3ghcre-atlas": {
      "command": "node",
      "args": ["C:/Users/MSuLL/dev/.projects/3GHCRE/mcp/dist/index.js"],
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

## Example Queries

After configuring Claude Desktop:

- "Who owns the most SNF properties in Texas?"
- "Show me Omega Healthcare's portfolio"
- "Trace the ownership of CCN 675432"
- "What deals happened in Florida in 2024?"
- "Find all properties operated by Ensign"

## Development

```bash
# Run in development mode
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| LOCAL_DB_HOST | MySQL host | localhost |
| LOCAL_DB_PORT | MySQL port | 3306 |
| LOCAL_DB_USER | MySQL user | root |
| LOCAL_DB_PASSWORD | MySQL password | (required) |
| LOCAL_DB_NAME | Database name | atlas |
