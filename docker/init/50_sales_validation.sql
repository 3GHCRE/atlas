-- 3G Healthcare Real Estate Atlas - Deals Validation Queries
-- Validates REAPI sales and mortgage data loaded into deals tables

USE atlas;

-- ============================================
-- BASIC COUNTS
-- ============================================
SELECT '=== Deals Table Summary ===' AS section;

SELECT deal_type, data_source, COUNT(*) as count
FROM deals
GROUP BY deal_type, data_source
ORDER BY deal_type, data_source;

-- ============================================
-- SALES OVERVIEW
-- ============================================
SELECT '=== Sales Overview ===' AS section;

SELECT
  COUNT(*) as total_sales,
  COUNT(DISTINCT property_master_id) as unique_properties,
  COUNT(DISTINCT ccn) as unique_ccns,
  SUM(amount) as total_volume,
  AVG(amount) as avg_sale_amount,
  MIN(effective_date) as earliest_sale,
  MAX(effective_date) as latest_sale
FROM deals
WHERE deal_type = 'sale';

-- ============================================
-- PROPERTY LINKAGE
-- ============================================
SELECT '=== Property Linkage ===' AS section;

SELECT
  SUM(CASE WHEN property_master_id IS NOT NULL THEN 1 ELSE 0 END) as linked_to_property_master,
  SUM(CASE WHEN property_master_id IS NULL THEN 1 ELSE 0 END) as unlinked,
  COUNT(*) as total,
  ROUND(SUM(CASE WHEN property_master_id IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as pct_linked
FROM deals
WHERE deal_type = 'sale';

-- ============================================
-- SALES BY YEAR
-- ============================================
SELECT '=== Sales by Year ===' AS section;

SELECT
  YEAR(effective_date) as year,
  COUNT(*) as deals,
  SUM(amount) as total_volume,
  AVG(amount) as avg_amount,
  MIN(amount) as min_amount,
  MAX(amount) as max_amount
FROM deals
WHERE deal_type = 'sale'
  AND effective_date IS NOT NULL
GROUP BY YEAR(effective_date)
ORDER BY year DESC
LIMIT 15;

-- ============================================
-- PARTIES SUMMARY
-- ============================================
SELECT '=== Parties Summary ===' AS section;

SELECT
  dp.party_role,
  COUNT(*) as total_parties,
  COUNT(DISTINCT dp.party_name) as unique_names,
  COUNT(dp.company_id) as linked_to_company,
  ROUND(COUNT(dp.company_id) * 100.0 / COUNT(*), 1) as pct_company_linked
FROM deals_parties dp
JOIN deals d ON d.id = dp.deal_id
WHERE d.deal_type = 'sale'
GROUP BY dp.party_role;

-- ============================================
-- PARTIES PER DEAL
-- ============================================
SELECT '=== Parties per Deal (Sample) ===' AS section;

SELECT
  d.id as deal_id,
  d.effective_date,
  d.amount,
  SUM(CASE WHEN dp.party_role = 'buyer' THEN 1 ELSE 0 END) as buyers,
  SUM(CASE WHEN dp.party_role = 'seller' THEN 1 ELSE 0 END) as sellers
FROM deals d
LEFT JOIN deals_parties dp ON dp.deal_id = d.id
WHERE d.deal_type = 'sale'
GROUP BY d.id, d.effective_date, d.amount
ORDER BY d.effective_date DESC
LIMIT 20;

-- ============================================
-- DEALS_SALE EXTENSION
-- ============================================
SELECT '=== Deals Sale Extension ===' AS section;

SELECT
  COUNT(*) as total_extension_records,
  COUNT(sale_type) as with_sale_type,
  COUNT(bed_count) as with_bed_count,
  COUNT(price_per_bed) as with_price_per_bed,
  COUNT(building_sqft) as with_building_sqft,
  COUNT(year_built) as with_year_built
FROM deals_sale;

-- Price per bed statistics
SELECT
  MIN(price_per_bed) as min_ppb,
  AVG(price_per_bed) as avg_ppb,
  MAX(price_per_bed) as max_ppb,
  STDDEV(price_per_bed) as stddev_ppb
FROM deals_sale
WHERE price_per_bed IS NOT NULL AND price_per_bed > 0;

-- ============================================
-- TOP BUYERS
-- ============================================
SELECT '=== Top Buyers by Deal Count ===' AS section;

SELECT
  dp.party_name,
  COUNT(*) as deal_count,
  SUM(d.amount) as total_volume
FROM deals_parties dp
JOIN deals d ON d.id = dp.deal_id
WHERE d.deal_type = 'sale'
  AND dp.party_role = 'buyer'
  AND dp.party_name IS NOT NULL
  AND TRIM(dp.party_name) != ''
GROUP BY dp.party_name
ORDER BY deal_count DESC
LIMIT 20;

-- ============================================
-- TOP SELLERS
-- ============================================
SELECT '=== Top Sellers by Deal Count ===' AS section;

SELECT
  dp.party_name,
  COUNT(*) as deal_count,
  SUM(d.amount) as total_volume
FROM deals_parties dp
JOIN deals d ON d.id = dp.deal_id
WHERE d.deal_type = 'sale'
  AND dp.party_role = 'seller'
  AND dp.party_name IS NOT NULL
  AND TRIM(dp.party_name) != ''
GROUP BY dp.party_name
ORDER BY deal_count DESC
LIMIT 20;

-- ============================================
-- HEALTH HOLDINGS TRANSACTIONS (Ensign Group)
-- ============================================
SELECT '=== Health Holdings Transactions ===' AS section;

SELECT
  d.effective_date,
  d.amount,
  d.ccn,
  pm.facility_name,
  dp.party_name,
  dp.party_role
FROM deals d
JOIN deals_parties dp ON dp.deal_id = d.id
LEFT JOIN property_master pm ON pm.id = d.property_master_id
WHERE d.deal_type = 'sale'
  AND dp.party_name LIKE '%Health Holdings%'
ORDER BY d.effective_date DESC
LIMIT 20;

-- ============================================
-- CASCADE / SKOKIE TRANSACTIONS
-- ============================================
SELECT '=== Cascade/Skokie Transactions ===' AS section;

SELECT
  d.effective_date,
  d.amount,
  d.ccn,
  pm.facility_name,
  dp.party_name,
  dp.party_role
FROM deals d
JOIN deals_parties dp ON dp.deal_id = d.id
LEFT JOIN property_master pm ON pm.id = d.property_master_id
WHERE d.deal_type = 'sale'
  AND (dp.party_name LIKE '%Cascade%'
       OR dp.party_name LIKE '%Property Holdings%'
       OR dp.party_name LIKE '%Oakton%'
       OR dp.party_name LIKE '%Skokie%')
ORDER BY d.effective_date DESC
LIMIT 20;

-- ============================================
-- CHOW VS SALE OVERLAP CHECK
-- ============================================
SELECT '=== CHOW vs Sale Overlap ===' AS section;

-- Find properties that have both CHOW and Sale records
SELECT
  pm.ccn,
  pm.facility_name,
  chow.chow_count,
  sale.sale_count,
  chow.earliest_chow,
  chow.latest_chow,
  sale.earliest_sale,
  sale.latest_sale
FROM property_master pm
JOIN (
  SELECT property_master_id, COUNT(*) as chow_count,
         MIN(effective_date) as earliest_chow, MAX(effective_date) as latest_chow
  FROM deals WHERE deal_type = 'chow' GROUP BY property_master_id
) chow ON chow.property_master_id = pm.id
JOIN (
  SELECT property_master_id, COUNT(*) as sale_count,
         MIN(effective_date) as earliest_sale, MAX(effective_date) as latest_sale
  FROM deals WHERE deal_type = 'sale' GROUP BY property_master_id
) sale ON sale.property_master_id = pm.id
ORDER BY (chow.chow_count + sale.sale_count) DESC
LIMIT 20;

-- ============================================
-- LINKED COMPANY SUMMARY
-- ============================================
SELECT '=== Linked Company Deal Summary ===' AS section;

SELECT
  c.company_name,
  c.company_type,
  SUM(CASE WHEN dp.party_role = 'buyer' THEN 1 ELSE 0 END) as buys,
  SUM(CASE WHEN dp.party_role = 'seller' THEN 1 ELSE 0 END) as sells,
  SUM(d.amount) as total_volume
FROM deals_parties dp
JOIN deals d ON d.id = dp.deal_id
JOIN companies c ON c.id = dp.company_id
WHERE d.deal_type = 'sale'
  AND dp.company_id IS NOT NULL
GROUP BY c.company_name, c.company_type
ORDER BY total_volume DESC
LIMIT 20;

-- ============================================
-- UNIFIED DEALS VIEW (CHOW + Sales)
-- ============================================
SELECT '=== Unified Deals Sample ===' AS section;

SELECT
  d.deal_type,
  d.effective_date,
  d.amount,
  d.ccn,
  pm.facility_name,
  pm.state,
  buyer.party_name as buyer,
  seller.party_name as seller
FROM deals d
LEFT JOIN property_master pm ON pm.id = d.property_master_id
LEFT JOIN deals_parties buyer ON buyer.deal_id = d.id AND buyer.party_role = 'buyer'
LEFT JOIN deals_parties seller ON seller.deal_id = d.id AND seller.party_role = 'seller'
WHERE d.effective_date >= '2020-01-01'
ORDER BY d.effective_date DESC
LIMIT 30;

-- ============================================
-- MORTGAGE DEALS (when reapi_mortgages populated)
-- ============================================
SELECT '=== Mortgage Deals ===' AS section;

SELECT
  COUNT(*) as total_mortgages,
  SUM(CASE WHEN property_master_id IS NOT NULL THEN 1 ELSE 0 END) as linked,
  SUM(amount) as total_volume
FROM deals
WHERE deal_type = 'mortgage';

-- Top lenders
SELECT '=== Top Lenders ===' AS section;

SELECT
  dp.party_name AS lender,
  COUNT(*) as loans,
  SUM(d.amount) as total_volume
FROM deals_parties dp
JOIN deals d ON d.id = dp.deal_id
WHERE d.deal_type = 'mortgage'
  AND dp.party_role = 'lender'
GROUP BY dp.party_name
ORDER BY total_volume DESC
LIMIT 15;

-- Top borrowers
SELECT '=== Top Borrowers ===' AS section;

SELECT
  dp.party_name AS borrower,
  COUNT(*) as loans,
  SUM(d.amount) as total_volume
FROM deals_parties dp
JOIN deals d ON d.id = dp.deal_id
WHERE d.deal_type = 'mortgage'
  AND dp.party_role = 'borrower'
GROUP BY dp.party_name
ORDER BY total_volume DESC
LIMIT 15;

-- Mortgage extension data
SELECT '=== Mortgage Extension Data ===' AS section;

SELECT
  COUNT(*) as total_records,
  COUNT(loan_type) as with_loan_type,
  COUNT(interest_rate) as with_interest_rate,
  COUNT(maturity_date) as with_maturity,
  AVG(interest_rate) as avg_rate
FROM deals_mortgage;

-- ============================================
-- ALL PARTY ROLES SUMMARY
-- ============================================
SELECT '=== All Party Roles Summary ===' AS section;

SELECT
  d.deal_type,
  dp.party_role,
  COUNT(*) as party_count,
  COUNT(dp.company_id) as linked_to_company
FROM deals d
JOIN deals_parties dp ON dp.deal_id = d.id
GROUP BY d.deal_type, dp.party_role
ORDER BY d.deal_type, dp.party_role;

SELECT '=== Validation Complete ===' AS section;
