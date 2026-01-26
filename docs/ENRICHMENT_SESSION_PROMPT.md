# Atlas SNF Ownership Database Enrichment - Session Prompt

**Last Updated:** January 25, 2026
**Project:** 3GHCRE Atlas SNF Ownership Database

---

## Overarching Goal

Build the most comprehensive skilled nursing facility (SNF) ownership intelligence database by:

1. **Mapping true ownership structures** - Trace PropCo/OpCo relationships to identify ultimate beneficial owners
2. **Enriching principal data** - Add executive leadership (CEO, CFO, COO, etc.) to major companies
3. **Identifying network hubs** - Find principals connected to multiple companies (power brokers)
4. **Documenting ownership patterns** - Orthodox Jewish networks, PE firms, REITs, hospital district UPL arrangements

The database powers an MCP server (`mcp/`) that provides real-time ownership intelligence queries.

---

## What We Are Doing

### Web Enrichment Workflow

For companies with many properties but few/no principals:

1. **Research** company leadership via web search (LinkedIn, company websites, SEC filings, industry news)
2. **Create enrichment brief** as JSON in `data/enrichment-briefs/{company_id}-{date}.json`
3. **Apply enrichment** to database - create principals, link to companies with proper roles
4. **Update research docs** in `docs/research/` with findings

### Priority Targets

Companies prioritized by: `(PropertyCount × 1.0) + (NoPrincipalsPenalty × 10.0)`

Focus on:
- **REITs** - Omega, Sabra, Welltower, CareTrust, NHI, Strawberry Fields
- **PE Firms** - Portopiccolo, Cascade Capital, Formation Capital
- **Large Operators** - Genesis, Ensign, Complete Care, Autumn Lake
- **Orthodox Networks** - NY/NJ based ownership groups with complex structures

---

## What Has Been Accomplished

### Companies Enriched (January 25, 2026)

| Company | ID | Type | Props | Principals | Key Finding |
|---------|-----|------|-------|------------|-------------|
| Portopiccolo Group | 14607 | pe_firm | 188 | 9 | Simcha Hyman (CEO), Naftali Zanziper (Pres) |
| Autumn Lake Healthcare | 14646 | owner_operator | 68 | 6 | Josh Davis (CEO), Samuel Stern network |
| TL Management | 14647 | ownership | 37 | 2 | Eliezer Scheiner (CEO) - MAJOR HUB |
| Broadway 55 | 14884 | ownership | 29 | 0 | PropCo for Excelsior Care Group |
| Omega Healthcare | 14598 | reit | 441 | 7 | NYSE: OHI, C. Taylor Pickett (CEO) |
| Sabra Health Care REIT | 14603 | reit | 284 | 8 | NASDAQ: SBRA, Rick Matros (CEO) |
| Cascade Capital Group | 14600 | pe_firm | 152 | 11 | Skokie IL, major acquirer |
| Welltower | 14599 | reit | 219 | 9 | NYSE: WELL, largest senior housing REIT |
| Genesis Healthcare | 14628 | owner_operator | 204 | 6 | George V. Hager (CEO) |

### Major Network Hubs Identified

1. **Eliezer (Lou) Scheiner** (ID: 8429) - **~15 companies, ~200 properties** (PropCo owner, not operator)
   - TL Management, Hamilton County HD, Coryell County Hospital Authority
   - Texas hospital district UPL arrangements (PropCo owns, OpCo operates)
   - **Note:** Ensign, Nexion, Creative Solutions are OPERATORS of his properties, not his companies
   - See: `docs/research/SCHEINER_OWNERSHIP_STRUCTURE.md`

2. **Samuel Stern** (ID: 13758) - ~22 unique companies, ~200 unique properties, 23 states
   - Complete Care (10% owner), Autumn Lake, Excelsior, Benjamin Landa networks
   - NY/NJ Orthodox network - legitimate ownership relationships

### Research Documents Created/Updated

- `docs/research/ORTHODOX_OWNERSHIP_NETWORKS.md` - Network analysis
- `docs/research/SCHEINER_OWNERSHIP_STRUCTURE.md` - Scheiner PropCo/OpCo structure
- `data/enrichment-briefs/*.json` - 9 enrichment briefs

### Data Quality Fixes Applied (Jan 25, 2026)

**Issue:** CMS data incorrectly linked PropCo owners as principals at OpCos that merely operate their properties.

**Example:** Scheiner was listed as "manager" at Ensign Group. In reality, Ensign OPERATES facilities owned by Scheiner's hospital districts - Scheiner is not a principal at Ensign.

**Fix:** Removed 12 incorrect principal-company relationships for Scheiner where he was linked to operators (Ensign, Nexion, Creative Solutions, etc.) rather than his actual PropCos.

**Key Distinction:**
- **PropCo (Property Company):** Owns real estate - principal relationships are CORRECT
- **OpCo (Operating Company):** Operates facilities - principal relationships may be INCORRECT if the person is actually a PropCo owner

**When adding new relationships, verify:**
1. Is this person actually a principal at the COMPANY level?
2. Or are they a PropCo owner whose buildings are operated by this company?

---

## What To Do Next

### Immediate Priorities (Companies needing enrichment)

```sql
-- Run this query to find gaps:
SELECT c.id, c.company_name, c.company_type, c.state,
  COUNT(DISTINCT per.property_master_id) as props,
  COUNT(DISTINCT pcr.principal_id) as principals
FROM companies c
LEFT JOIN entities e ON e.company_id = c.id
LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
LEFT JOIN principal_company_relationships pcr ON pcr.company_id = c.id AND pcr.end_date IS NULL
WHERE c.company_name NOT LIKE '[MERGED]%'
  AND c.company_type IN ('owner_operator', 'ownership', 'pe_firm', 'reit')
GROUP BY c.id
HAVING props >= 50 AND principals <= 3
ORDER BY props DESC;
```

**Known gaps (as of Jan 25, 2026):**
- National Health Investors (194 props, 3 principals) - NYSE: NHI
- CareTrust REIT (118 props, 3 principals) - NYSE: CTRE
- Evangelical Lutheran Good Samaritan (126 props, 3 principals)
- Strawberry Fields REIT (68 props, 1 principal)
- Altitude Health Services (65 props, 1 principal)
- Aperion Care (63 props, 1 principal)

### Research Tasks

1. **Continue REIT enrichment** - NHI, CareTrust, Strawberry Fields
2. **Research CAREONE** - 37 props, NJ-based, needs leadership
3. **Map Texas UPL arrangements** - Hamilton County, Coryell County hospital districts
4. **Trace PropCo/OpCo relationships** - Link real estate holding companies to operators
5. **Cross-reference CMS quality scores** - Add performance context to ownership data

---

## How To Continue This Work

### Using MCP Tools

The Atlas MCP server (`mcp/src/tools/`) provides these key tools:

```javascript
// Find company details
mcp__3ghcre-atlas__get_company({ id: 14598 })

// Search for companies
mcp__3ghcre-atlas__search_companies({ name: "Omega", min_properties: 50 })

// Trace ownership chains
mcp__3ghcre-atlas__trace_owner({ ccn: "365001" })

// Find network hubs
mcp__3ghcre-atlas__trace_principal_network({ principal_id: 8429 })

// Get portfolio
mcp__3ghcre-atlas__get_portfolio({ company_id: 14598 })
```

### Enrichment Workflow

1. **Find gap**: Use query above or `search_companies` with low principal counts
2. **Research**: Web search for "[Company Name] CEO CFO executive team skilled nursing"
3. **Create brief**: Save JSON to `data/enrichment-briefs/{id}-{date}.json`
4. **Apply to DB**:
```javascript
const { getAtlasConnection } = require('./scripts/lib/db-config');
// Create principals, link with principal_company_relationships
// Use data_source = 'web_scrape', role from enum
```
5. **Update docs**: Add findings to `docs/research/ORTHODOX_OWNERSHIP_NETWORKS.md`

### Database Schema Reference

**Key tables:**
- `companies` - Parent companies (REITs, operators, PE firms)
- `entities` - PropCos/OpCos under companies
- `principals` - Individual people
- `principal_company_relationships` - Links principals to companies with roles
- `property_entity_relationships` - Links properties to entities

**Role enum values:**
`portfolio_owner, portfolio_manager, board_member, ceo, president, cfo, coo, managing_partner, general_partner, limited_partner, owner, owner_direct, owner_indirect, director, officer, manager, managing_employee, vp, other`

**Data source enum:**
`cms, reapi, zoho, manual, web_scrape`

---

## Key Files & Locations

```
C:\Users\MSuLL\dev\.projects\3GHCRE\
├── mcp/                              # MCP server for Atlas queries
│   └── src/tools/                    # Tool implementations
│       ├── graph/                    # Ownership tracing tools
│       ├── record/                   # Get/search tools
│       └── market/                   # Market analytics tools
├── docs/research/                    # Research documentation
│   ├── ORTHODOX_OWNERSHIP_NETWORKS.md
│   └── ENRICHMENT_SESSION_PROMPT.md  # This file
├── data/enrichment-briefs/           # JSON enrichment files
├── scripts/                          # Database scripts
│   ├── lib/db-config.js              # DB connection helper
│   └── apply-enrichment.js           # Bulk enrichment applicator
└── .env                              # Database credentials
```

---

## Success Metrics

- [ ] All companies with 50+ properties have at least 5 principals
- [ ] All major REITs (Omega, Sabra, Welltower, NHI, CareTrust) fully enriched
- [ ] Top 10 network hubs documented with full company connections
- [ ] PropCo/OpCo relationships mapped for Orthodox networks
- [ ] Texas UPL arrangements documented

---

*Use this prompt to resume enrichment work in future sessions.*
