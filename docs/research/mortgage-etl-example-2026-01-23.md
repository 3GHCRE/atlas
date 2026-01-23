# Mortgage ETL Script Example Run

**Date:** 2026-01-23
**Purpose:** Document the mortgage data loading capability and current status

## Script Execution

```
=== REAPI Mortgages ETL ===

Mode: CHECK (verify data only)
Start time: 2026-01-23T18:02:33.295Z

Connecting to REAPI database (cms_data)...
✓ Connected to REAPI database

--- Checking REAPI Mortgage Data ---
reapi_mortgages rows: 0

⚠️  reapi_mortgages table has 0 rows.
   Mortgage data needs to be loaded into REAPI first.
   This script is ready for when data becomes available.

--- Available Property Mortgage Data ---
Properties with estimated_mortgage_balance: 5762
Total estimated mortgage balance: $407.94B
```

## Current Deals & Parties System Status

### Schema Support

| Party Role | Deal Type | Data Source | Status |
|------------|-----------|-------------|--------|
| buyer | chow, sale | cms, reapi | ✅ Active - 9,583 records |
| seller | chow, sale | cms, reapi | ✅ Active - 10,021 records |
| lender | mortgage | reapi | ⏳ Schema ready, awaiting data |
| borrower | mortgage | reapi | ⏳ Schema ready, awaiting data |

### Tables Involved

1. **deals** - Core transaction records
   - `deal_type`: 'chow', 'sale', 'mortgage'
   - `data_source`: 'cms', 'reapi'
   - Links to `property_master` via CCN

2. **deals_parties** - Transaction participants
   - `party_role`: 'buyer', 'seller', 'lender', 'borrower'
   - `entity_id`: Links to resolved entities
   - `party_name`: Raw party name from source

3. **deals_mortgage** - Mortgage-specific details
   - `loan_type`, `term_months`, `interest_rate`
   - `maturity_date`, `is_refinance`

## Mortgage Data Sources

### Currently Available (Estimated Balances)
- **5,762 properties** with estimated_mortgage_balance
- **$407.94B** total estimated mortgage exposure
- Source: REAPI property records (aggregate estimates)

### Pending (Detailed Transaction Data)
- **reapi_mortgages table**: 0 rows currently
- When populated, will contain:
  - Individual mortgage transactions
  - Lender and borrower names
  - Interest rates and terms
  - Document numbers and dates

## ETL Script Capabilities

The `scripts/load-reapi-mortgages.js` script will:

1. **Query** reapi_mortgages from REAPI (cms_data database)
2. **Create** deals records with `deal_type='mortgage'`
3. **Create** deals_parties records:
   - `party_role='lender'` from lender_name
   - `party_role='borrower'` from grantee_name
4. **Populate** deals_mortgage extension with loan details
5. **Link** to property_master via CCN when available

### Usage

```bash
# Check data availability
node scripts/load-reapi-mortgages.js --check

# Load when data available
node scripts/load-reapi-mortgages.js
```

## Next Steps

1. **REAPI Data Population**: Monitor reapi_mortgages table for incoming data
2. **Run Full ETL**: Execute load script once mortgage data arrives
3. **Validate**: Use `docker/init/50_sales_validation.sql` queries to verify
4. **Analytics**: Enable lender/borrower analytics in Metabase dashboards

## Related Files

- `scripts/load-reapi-mortgages.js` - ETL script
- `docker/init/50_sales_validation.sql` - Validation queries
- `docs/data/ATLAS_ERD_SCHEMA.md` - Schema documentation
