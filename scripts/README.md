# Atlas Scripts

Utility scripts for data loading, enrichment, analysis, and research.

## Directory Structure

```
scripts/
├── lib/                    # Shared utilities
│   └── db-config.js        # Database connection configuration
├── research/               # Research workflow scripts
│   ├── trace-ownership-chain.js
│   ├── reit-disposition-tracker.js
│   ├── operator-expansion-monitor.js
│   ├── lender-exposure-analyzer.js
│   └── market-activity-analyzer.js
└── *.js                    # Flat structure (271 scripts)
```

## Database Configuration

All scripts should use the shared database configuration:

```javascript
const { getAtlasConnection, getReapiConnection } = require('./lib/db-config');

async function main() {
  const atlas = await getAtlasConnection();  // Local Atlas database
  const reapi = await getReapiConnection();  // Remote REAPI database

  // Your queries here...

  await atlas.end();
  await reapi.end();
}
```

**Required `.env` variables:**
```
# Local Atlas (Docker)
LOCAL_DB_HOST=localhost
LOCAL_DB_PORT=3306
LOCAL_DB_NAME=atlas
LOCAL_DB_USER=root
LOCAL_DB_PASSWORD=your_password

# Remote REAPI (if needed)
DB_HOST=your_host
DB_PORT=25060
DB_NAME=cms_data
DB_USER=your_user
DB_PASSWORD=your_password
```

## Script Categories

### Data Loading (`load-*.js`)
Import data from external sources into Atlas.

| Script | Purpose |
|--------|---------|
| `load-propco-batch.js` | Load PropCo ownership data |
| `load-zoho-principals.js` | Import principals from Zoho CRM |
| `load-reapi-sales.js` | Load sales data from REAPI |
| `load-deal-parties.js` | Load deal party relationships |
| `load-cms-certifiers-to-principals.js` | Create principals from CMS certifiers |

### Enrichment (`enrich-*.js`)
Add principals, relationships, and metadata to existing records.

| Script | Purpose |
|--------|---------|
| `enrich-critical-gaps.js` | Fill gaps in principal coverage |
| `enrich-nonprofits-990-officers.js` | Add nonprofit officers from 990s |
| `enrich-genesis-healthcare.js` | Genesis Healthcare network |
| `enrich-portopiccolo-executives.js` | Portopiccolo Group executives |

### Quality & Analysis (`analyze-*.js`, `find-*.js`, `check-*.js`)
Data quality assessment and gap analysis.

| Script | Purpose |
|--------|---------|
| `find-principal-gaps.js` | Find companies missing principals |
| `find-duplicate-principals.js` | Identify potential duplicates |
| `analyze-coverage-gaps.js` | Assess data coverage |
| `check-db-status.js` | Database health check |
| `summarize-enrichment.js` | Enrichment progress report |

### Consolidation (`consolidate-*.js`, `merge-*.js`)
Deduplicate and clean up records.

| Script | Purpose |
|--------|---------|
| `consolidate-duplicates.js` | Merge duplicate companies |
| `merge-duplicates.js` | Merge principal records |
| `consolidate-lenders.js` | Clean up lender entities |

### Linking (`link-*.js`)
Create relationships between entities.

| Script | Purpose |
|--------|---------|
| `link-entity-principals-to-company.js` | Promote entity principals to company level |
| `link-owner-operators.js` | Link owner-operator relationships |
| `link-multistate-principals.js` | Link principals across states |

### Research (`research/*.js`)
Production research workflows for market intelligence.

| Script | Purpose |
|--------|---------|
| `trace-ownership-chain.js` | Property → Entity → Company → Principals |
| `reit-disposition-tracker.js` | Track REIT sales and buyers |
| `operator-expansion-monitor.js` | Monitor operator acquisitions |
| `lender-exposure-analyzer.js` | Lender portfolio risk analysis |
| `market-activity-analyzer.js` | State/national transaction trends |

## Running Scripts

```bash
# From project root
node scripts/script-name.js

# With arguments
node scripts/query-company.js "SABRA"

# Research workflows
node scripts/research/trace-ownership-chain.js "Mulberry Creek"
```

## Common Patterns

### Query a company
```bash
node scripts/query-company.js "OMEGA"
```

### Check enrichment status
```bash
node scripts/summarize-enrichment.js
```

### Find gaps in data
```bash
node scripts/find-principal-gaps.js
```

### Generate research report
```bash
node scripts/research/reit-disposition-tracker.js "Omega"
```
