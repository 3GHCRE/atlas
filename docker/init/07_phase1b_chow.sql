-- 3G Healthcare Real Estate Atlas - Phase 1B: CHOW Data Load
-- Loads Change of Ownership (CHOW) events into deals schema

USE atlas;

-- ============================================
-- STEP 1: Create CHOW staging table
-- ============================================
CREATE TABLE IF NOT EXISTS cms_chow_staging (
    ccn VARCHAR(20),
    chow_type_code VARCHAR(10),
    chow_type_text VARCHAR(100),
    effective_date VARCHAR(50),
    associate_id_buyer VARCHAR(50),
    organization_name_buyer VARCHAR(500),
    doing_business_as_name_buyer VARCHAR(500),
    associate_id_seller VARCHAR(50),
    organization_name_seller VARCHAR(500),
    doing_business_as_name_seller VARCHAR(500),
    enrollment_id_buyer VARCHAR(50),
    enrollment_id_seller VARCHAR(50),
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ccn (ccn),
    INDEX idx_effective_date (effective_date),
    INDEX idx_buyer_associate (associate_id_buyer),
    INDEX idx_seller_associate (associate_id_seller)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STEP 2: Create CHOW owners staging table
-- ============================================
CREATE TABLE IF NOT EXISTS cms_chow_owners_staging (
    enrollment_id VARCHAR(50),
    associate_id VARCHAR(50),
    organization_name VARCHAR(500),
    associate_id_owner VARCHAR(50),
    type_owner VARCHAR(10),
    role_code_owner VARCHAR(10),
    role_text_owner VARCHAR(255),
    association_date_owner VARCHAR(50),
    first_name_owner VARCHAR(255),
    middle_name_owner VARCHAR(255),
    last_name_owner VARCHAR(255),
    title_owner VARCHAR(255),
    organization_name_owner VARCHAR(500),
    doing_business_as_name_owner VARCHAR(500),
    address_line_1_owner VARCHAR(500),
    address_line_2_owner VARCHAR(500),
    city_owner VARCHAR(100),
    state_owner VARCHAR(10),
    zip_code_owner VARCHAR(20),
    percentage_ownership VARCHAR(20),
    created_for_acquisition_owner VARCHAR(10),
    corporation_owner VARCHAR(10),
    llc_owner VARCHAR(10),
    medical_provider_supplier_owner VARCHAR(10),
    management_services_company_owner VARCHAR(10),
    medical_staffing_company_owner VARCHAR(10),
    holding_company_owner VARCHAR(10),
    investment_firm_owner VARCHAR(10),
    financial_institution_owner VARCHAR(10),
    consulting_firm_owner VARCHAR(10),
    for_profit_owner VARCHAR(10),
    non_profit_owner VARCHAR(10),
    private_equity_company_owner VARCHAR(10),
    reit_owner VARCHAR(10),
    chain_home_office_owner VARCHAR(10),
    trust_or_trustee_owner VARCHAR(10),
    other_type_owner VARCHAR(10),
    other_type_text_owner VARCHAR(500),
    parent_company_owner VARCHAR(10),
    owned_by_another_org_or_ind_owner VARCHAR(10),
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_enrollment_id (enrollment_id),
    INDEX idx_associate_id (associate_id),
    INDEX idx_associate_id_owner (associate_id_owner),
    INDEX idx_type_owner (type_owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STEP 3: Load CHOW CSV (run as root)
-- ============================================
-- LOAD DATA INFILE '/data/SNF_CHOW_2025.12.02.csv'
-- INTO TABLE cms_chow_staging
-- CHARACTER SET latin1
-- FIELDS TERMINATED BY ','
-- OPTIONALLY ENCLOSED BY '"'
-- LINES TERMINATED BY '\r\n'
-- IGNORE 1 ROWS
-- (ccn, chow_type_code, chow_type_text, effective_date,
--  associate_id_buyer, organization_name_buyer, doing_business_as_name_buyer,
--  associate_id_seller, organization_name_seller, doing_business_as_name_seller,
--  enrollment_id_buyer, enrollment_id_seller);

-- ============================================
-- STEP 4: Load CHOW Owners CSV (run as root)
-- ============================================
-- LOAD DATA INFILE '/data/SNF_CHOW_Owners_2025.12.02.csv'
-- INTO TABLE cms_chow_owners_staging
-- CHARACTER SET latin1
-- FIELDS TERMINATED BY ','
-- OPTIONALLY ENCLOSED BY '"'
-- LINES TERMINATED BY '\r\n'
-- IGNORE 1 ROWS
-- (...all 40 columns...);

-- ============================================
-- STEP 5: Insert CHOW records into deals (base table)
-- ============================================
INSERT INTO deals (
    property_master_id,
    ccn,
    deal_type,
    effective_date,
    recorded_date,
    amount,
    document_id,
    document_type,
    data_source,
    verified,
    created_at,
    updated_at
)
SELECT
    pm.id as property_master_id,
    TRIM(cs.ccn) as ccn,
    'chow' as deal_type,
    STR_TO_DATE(cs.effective_date, '%m/%d/%Y') as effective_date,
    NULL as recorded_date,
    NULL as amount,
    NULL as document_id,
    TRIM(cs.chow_type_code) as document_type,
    'cms' as data_source,
    FALSE as verified,
    NOW(),
    NOW()
FROM cms_chow_staging cs
LEFT JOIN property_master pm ON pm.ccn = TRIM(cs.ccn)
WHERE cs.effective_date IS NOT NULL
  AND cs.effective_date != ''
  AND cs.effective_date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$';

-- ============================================
-- STEP 6: Insert into deals_chow (extension table)
-- ============================================
INSERT INTO deals_chow (
    deal_id,
    chow_type_code,
    chow_type_text,
    buyer_enrollment_id,
    buyer_associate_id,
    seller_enrollment_id,
    seller_associate_id,
    created_at,
    updated_at
)
SELECT
    d.id as deal_id,
    TRIM(cs.chow_type_code) as chow_type_code,
    TRIM(cs.chow_type_text) as chow_type_text,
    TRIM(cs.enrollment_id_buyer) as buyer_enrollment_id,
    TRIM(cs.associate_id_buyer) as buyer_associate_id,
    TRIM(cs.enrollment_id_seller) as seller_enrollment_id,
    TRIM(cs.associate_id_seller) as seller_associate_id,
    NOW(),
    NOW()
FROM cms_chow_staging cs
JOIN deals d ON d.ccn = TRIM(cs.ccn)
    AND d.effective_date = STR_TO_DATE(cs.effective_date, '%m/%d/%Y')
    AND d.deal_type = 'chow'
WHERE cs.effective_date IS NOT NULL
  AND cs.effective_date != ''
  AND cs.effective_date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$';

-- ============================================
-- STEP 7: Insert BUYERS into deals_parties
-- ============================================
INSERT INTO deals_parties (
    deal_id,
    party_role,
    party_name,
    party_dba_name,
    company_id,
    principal_id,
    enrollment_id,
    associate_id,
    created_at,
    updated_at
)
SELECT
    d.id as deal_id,
    'buyer' as party_role,
    TRIM(cs.organization_name_buyer) as party_name,
    TRIM(cs.doing_business_as_name_buyer) as party_dba_name,
    NULL as company_id,
    NULL as principal_id,
    TRIM(cs.enrollment_id_buyer) as enrollment_id,
    TRIM(cs.associate_id_buyer) as associate_id,
    NOW(),
    NOW()
FROM cms_chow_staging cs
JOIN deals d ON d.ccn = TRIM(cs.ccn)
    AND d.effective_date = STR_TO_DATE(cs.effective_date, '%m/%d/%Y')
    AND d.deal_type = 'chow'
WHERE cs.organization_name_buyer IS NOT NULL
  AND TRIM(cs.organization_name_buyer) != ''
  AND cs.effective_date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$';

-- ============================================
-- STEP 8: Insert SELLERS into deals_parties
-- ============================================
INSERT INTO deals_parties (
    deal_id,
    party_role,
    party_name,
    party_dba_name,
    company_id,
    principal_id,
    enrollment_id,
    associate_id,
    created_at,
    updated_at
)
SELECT
    d.id as deal_id,
    'seller' as party_role,
    TRIM(cs.organization_name_seller) as party_name,
    TRIM(cs.doing_business_as_name_seller) as party_dba_name,
    NULL as company_id,
    NULL as principal_id,
    TRIM(cs.enrollment_id_seller) as enrollment_id,
    TRIM(cs.associate_id_seller) as associate_id,
    NOW(),
    NOW()
FROM cms_chow_staging cs
JOIN deals d ON d.ccn = TRIM(cs.ccn)
    AND d.effective_date = STR_TO_DATE(cs.effective_date, '%m/%d/%Y')
    AND d.deal_type = 'chow'
WHERE cs.organization_name_seller IS NOT NULL
  AND TRIM(cs.organization_name_seller) != ''
  AND cs.effective_date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$';

-- ============================================
-- STEP 9: Link buyers to companies via enrollment
-- (Only links to existing opco companies from CMS Affiliated Entities)
-- ============================================
UPDATE deals_parties dp
JOIN deals d ON d.id = dp.deal_id
JOIN cms_enrollments_staging ces ON TRIM(ces.enrollment_id) = dp.enrollment_id
JOIN companies c ON c.cms_affiliated_entity_id = TRIM(ces.affiliation_entity_id)
SET dp.company_id = c.id
WHERE dp.party_role = 'buyer'
  AND dp.enrollment_id IS NOT NULL
  AND dp.company_id IS NULL
  AND d.deal_type = 'chow';

-- ============================================
-- STEP 10: Link sellers to existing companies by name
-- (Only links to existing opco companies, does not create new records)
-- ============================================
UPDATE deals_parties dp
JOIN companies c ON UPPER(TRIM(c.company_name)) = UPPER(TRIM(dp.party_name))
SET dp.company_id = c.id
WHERE dp.party_role = 'seller'
  AND dp.party_name IS NOT NULL
  AND dp.company_id IS NULL;

-- ============================================
-- STEP 11: Add new principals from CHOW owners
-- ============================================
INSERT INTO principals (
    first_name, middle_name, last_name, full_name, normalized_full_name,
    title, cms_associate_id_owner, address, city, state, zip,
    created_at, updated_at
)
SELECT
    first_name, middle_name, last_name, full_name, normalized_full_name,
    title, cms_associate_id_owner, address, city, state, zip,
    NOW(), NOW()
FROM (
    SELECT
        TRIM(first_name_owner) as first_name,
        TRIM(middle_name_owner) as middle_name,
        TRIM(last_name_owner) as last_name,
        TRIM(CONCAT_WS(' ',
            NULLIF(TRIM(first_name_owner), ''),
            NULLIF(TRIM(middle_name_owner), ''),
            NULLIF(TRIM(last_name_owner), '')
        )) as full_name,
        UPPER(TRIM(CONCAT_WS(' ',
            NULLIF(TRIM(first_name_owner), ''),
            NULLIF(TRIM(last_name_owner), '')
        ))) as normalized_full_name,
        TRIM(title_owner) as title,
        CONCAT('CHOW_', TRIM(associate_id_owner)) as cms_associate_id_owner,
        TRIM(CONCAT_WS(' ',
            NULLIF(TRIM(address_line_1_owner), ''),
            NULLIF(TRIM(address_line_2_owner), '')
        )) as address,
        TRIM(city_owner) as city,
        UPPER(SUBSTRING(TRIM(COALESCE(state_owner, '')), 1, 2)) as state,
        SUBSTRING(REPLACE(TRIM(COALESCE(zip_code_owner, '')), '-', ''), 1, 5) as zip,
        ROW_NUMBER() OVER (PARTITION BY TRIM(associate_id_owner) ORDER BY enrollment_id) as rn
    FROM cms_chow_owners_staging
    WHERE type_owner = 'I'
      AND role_code_owner IN ('34', '35', '40', '41', '42', '43', '44', '45')
      AND associate_id_owner IS NOT NULL
      AND TRIM(associate_id_owner) != ''
      AND TRIM(associate_id_owner) NOT IN (
          SELECT REPLACE(cms_associate_id_owner, 'CHOW_', '')
          FROM principals
          WHERE cms_associate_id_owner IS NOT NULL
      )
) ranked
WHERE rn = 1
  AND full_name IS NOT NULL
  AND full_name != '';

-- ============================================
-- VALIDATION
-- ============================================
SELECT 'Phase 1B CHOW Load Complete' as status;

SELECT 'Staging Tables' as category;
SELECT
    (SELECT COUNT(*) FROM cms_chow_staging) as chow_staging,
    (SELECT COUNT(*) FROM cms_chow_owners_staging) as chow_owners_staging;

SELECT 'Deals Tables' as category;
SELECT
    (SELECT COUNT(*) FROM deals WHERE deal_type = 'chow') as chow_deals,
    (SELECT COUNT(*) FROM deals_chow) as deals_chow_ext,
    (SELECT COUNT(*) FROM deals_parties WHERE party_role = 'buyer') as buyers,
    (SELECT COUNT(*) FROM deals_parties WHERE party_role = 'seller') as sellers;

SELECT 'Company Linkage' as category;
SELECT
    party_role,
    COUNT(*) as total,
    COUNT(company_id) as linked_to_opco,
    ROUND(COUNT(company_id) * 100.0 / COUNT(*), 1) as pct_linked
FROM deals_parties
GROUP BY party_role;

SELECT 'Principals' as category;
SELECT COUNT(*) as total_principals FROM principals;
