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

### Source Tables in REAPI (cms_data)

| Table | Data Type | Status |
|-------|-----------|--------|
| `reapi_properties.raw_json` | **Full mortgage history in JSON** | ✅ **19,966 mortgages found!** |
| `reapi_properties` | Estimated balances (aggregates) | ✅ 5,762 with balance data |
| `reapi_sales_history` | Implied mortgages via LTV/down_payment | ✅ 522 financed purchases |
| `reapi_mortgages` | Detailed mortgage transactions | ❌ Empty (data is in raw_json instead) |

### **DISCOVERED: Full Mortgage Data in raw_json**

The detailed mortgage data exists in `reapi_properties.raw_json` → `data.mortgageHistory` and `data.currentMortgages`:

**Coverage:**
- **8,163 properties** with mortgage data
- **19,966 unique mortgages**
- **4,395 unique lenders**
- **$1.18 trillion** total mortgage amount

**Top 10 Lenders:**
| Rank | Lender | Mortgages |
|------|--------|-----------|
| 1 | Capital Funding | 498 |
| 2 | Column Financial Inc | 399 |
| 3 | JPMorgan Chase Bank NA | 374 |
| 4 | Key Bank NA | 335 |
| 5 | Oxford Finance LLC | 305 |
| 6 | General Electric Capital Corp | 296 |
| 7 | CIBC Bank USA | 272 |
| 8 | The Huntington National Bank | 233 |
| 9 | Wells Fargo Bank NA | 211 |
| 10 | Bank of America NA | 210 |

**JSON Structure:**
```json
{
  "data": {
    "mortgageHistory": [
      {
        "mortgageId": "749988",
        "lenderName": "Walker & Dunlop Llc",
        "lenderType": "Other (Company Or Corporation)",
        "granteeName": "555 W Kahler Llc",  // borrower
        "amount": 16240000,
        "loanType": "Fha",
        "interestRate": 0,
        "term": "320",
        "maturityDate": "2048-10-01",
        "position": "First"
      }
    ],
    "currentMortgages": [...]
  }
}
```

### Available: Estimated Balances (reapi_properties)
- **5,762 properties** with `estimated_mortgage_balance`
- **$407.94B** total estimated mortgage exposure
- Source: Property valuation models (not actual recorded mortgages)
- Fields: `estimated_mortgage_balance`, `open_mortgage_balance`, `estimated_mortgage_payment`

### Available: Implied Mortgages (reapi_sales_history)
- **522 financed purchases** with `purchase_method = 'Financed'`
- LTV data allows calculating implied mortgage amount
- Example: $19.2M sale @ 80% LTV → $15.36M mortgage
- **Missing**: Lender names, interest rates, terms

Sample financed purchases:
```
Jupiter Fl Realty Llc: $19.2M @ 80% LTV ($15.4M implied mortgage)
Mountain Trace Nursing Adk Llc: $6.1M @ 81% LTV ($4.9M implied mortgage)
Buena Sands Apartments Llc: $7.2M @ 57% LTV ($4.1M implied mortgage)
```

### Pending: Detailed Transactions (reapi_mortgages)
- Schema ready with full mortgage details
- When populated, will contain:
  - Individual mortgage transactions
  - Lender and borrower names (`lender_name`, `grantee_name`)
  - Interest rates and terms (`interest_rate`, `term`, `maturity_date`)
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
