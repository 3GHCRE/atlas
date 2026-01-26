# REAPI Schema Documentation

**Database:** `cms_data` (DigitalOcean MySQL)
**Last Updated:** 2026-01-23
**Total Properties:** 14,597

## Overview

REAPI (Real Estate API) provides property ownership and transaction data for nursing homes. This data complements CMS operator data to create a complete picture of property ownership (propco) vs. facility operations (opco).

## Key Tables for Propco Integration

### reapi_properties (14,597 rows)
Main property table with CCN linkage to CMS data.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| property_id | bigint | PRI | REAPI property ID |
| ccn | varchar(6) | MUL | CMS Certification Number - links to property_master |
| property_type | varchar(50) | MUL | Property classification |
| estimated_value | decimal(12,2) | MUL | Estimated property value |
| last_sale_date | date | MUL | Last sale date |
| last_sale_price | decimal(12,2) | | Last sale price |
| equity | decimal(12,2) | | Property equity |
| equity_percent | decimal(5,2) | | Equity percentage |
| estimated_mortgage_balance | decimal(12,2) | | Mortgage balance |
| corporate_owned | tinyint(1) | | Corporate ownership flag |
| absentee_owner | tinyint(1) | | Absentee owner flag |

### reapi_owner_info (14,597 rows)
Property ownership information with mail addresses for propco identification.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| id | bigint | PRI | Record ID |
| property_id | bigint | UNI | Links to reapi_properties |
| company_name | varchar(255) | MUL | Company name |
| owner1_full_name | varchar(255) | MUL | **Primary owner entity name** |
| owner1_type | varchar(50) | | Individual or Company |
| owner2_full_name | varchar(255) | | Secondary owner |
| corporate_owned | tinyint(1) | MUL | Corporate ownership flag |
| absentee_owner | tinyint(1) | | Absentee owner flag |
| ownership_length | int | | Months of ownership |
| **mail_address** | varchar(255) | | **Key field for company matching** |
| mail_city | varchar(100) | | Mail city |
| mail_state | char(2) | MUL | Mail state |
| mail_zip | varchar(10) | | Mail ZIP |
| mail_label | varchar(500) | | Full formatted mail address |

### reapi_nursing_homes (14,654 rows)
CCN to provider name mapping.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| ccn | varchar(6) | PRI | CMS Certification Number |
| provider_name | varchar(255) | MUL | Facility name |
| verified | varchar(10) | | Verification status |

### reapi_property_addresses (14,597 rows)
Physical property addresses.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| property_id | bigint | UNI | Links to reapi_properties |
| address | varchar(255) | | Street address |
| city | varchar(100) | MUL | City |
| state | char(2) | MUL | State |
| zip | varchar(10) | MUL | ZIP code |
| county | varchar(100) | MUL | County |
| latitude | decimal(10,8) | MUL | Latitude |
| longitude | decimal(11,8) | | Longitude |
| label | varchar(500) | | Full formatted address |

### reapi_sales_history (14,597 rows)
Property transaction history.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| property_id | bigint | MUL | Links to reapi_properties |
| sale_date | date | MUL | Sale date |
| sale_amount | decimal(12,2) | | Sale price |
| buyer_names | varchar(500) | MUL | Buyer name(s) |
| seller_names | varchar(500) | MUL | Seller name(s) |
| transaction_type | varchar(100) | | Transaction type |
| document_type | varchar(50) | | Document type |

### reapi_tax_info (14,597 rows)
Property tax assessment data.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| property_id | bigint | MUL | Links to reapi_properties |
| assessed_value | decimal(12,2) | | Assessed value |
| market_value | decimal(12,2) | | Market value |
| tax_amount | decimal(10,2) | | Annual tax amount |
| tax_year | int | MUL | Tax year |

### vw_reapi_property_summary (View - 14,597 rows)
Denormalized view combining all property data.

Key columns:
- `ccn` - CCN linkage
- `ownerInfo_companyName` - Company name
- `ownerInfo_owner1FullName` - Owner entity name
- `ownerInfo_mailAddress_label` - Full mailing address
- `propertyInfo_address_label` - Physical address
- `linkedProperties_totalOwned` - Owner's total properties

## Linkage Diagram

```
property_master (CCN)
        |
        v
reapi_properties (CCN) <--> reapi_nursing_homes (CCN)
        |
        v (property_id)
reapi_owner_info (owner1_full_name, mail_address)
        |
        +---> reapi_property_addresses
        +---> reapi_tax_info
        +---> reapi_sales_history
        +---> reapi_linked_properties_summary
```

## Propco Integration Pattern

### Step 1: Match mail_address to companies
Using `owner_mappings.csv`, match `reapi_owner_info.mail_address` to known companies:

```sql
SELECT mail_address, COUNT(*) as property_count
FROM reapi_owner_info
WHERE mail_address LIKE '%27101 Puerta Real%'  -- Ensign HQ
GROUP BY mail_address;
```

### Step 2: Create propco entities from owner names
Each unique `owner1_full_name` becomes a propco entity:

```sql
SELECT DISTINCT owner1_full_name as propco_entity
FROM reapi_owner_info
WHERE mail_address LIKE '%27101 Puerta Real%'
  AND owner1_type = 'Company';
-- Results: "Expressway Health Holdings Llc", "Congaree Health Holdings Llc", etc.
```

### Step 3: Link to property_master via CCN

```sql
SELECT pm.id, pm.ccn, pm.facility_name, roi.owner1_full_name
FROM property_master pm
JOIN reapi_properties rp ON rp.ccn = pm.ccn
JOIN reapi_owner_info roi ON roi.property_id = rp.property_id
WHERE roi.mail_address LIKE '%27101 Puerta Real%';
```

## Ensign Group Test Case

**Mailing Addresses:**
- `Po Box 128109`, Nashville, TN - 80 properties
- `29222 Rancho Viejo Rd`, San Juan Capistrano, CA - 63 properties
- `27101 Puerta Real`, Mission Viejo, CA - 30 properties
- **Total: ~173 properties**

**Sample Propco Entities (owner1_full_name):**
- Expressway Health Holdings Llc
- Congaree Health Holdings Llc
- Ives Health Holdings Llc
- Arc Parklane Inc

**Pattern:** Ensign uses "* Health Holdings LLC" naming convention for propco entities.

## Additional REAPI Tables

| Table | Rows | Purpose |
|-------|------|---------|
| reapi_demographics | 14,597 | HUD Fair Market Rent data |
| reapi_lot_info | 14,597 | Lot/parcel information |
| reapi_property_features | 14,597 | Building features |
| reapi_mortgages | 0 | Mortgage records |
| reapi_foreclosures | 0 | Foreclosure data |
| reapi_mls_listings | 0 | MLS listing data |
| reapi_linked_properties | 0 | Cross-property links |
| reapi_linked_properties_summary | 8,700 | Owner portfolio summary |
| reapi_api_sync_log | 0 | API sync tracking |
| reapi_batch_load_tracking | 0 | Batch load tracking |
| reapi_sync_log | 5 | Sync history |
