-- 3G Healthcare Real Estate Atlas - Phase 1B: CMS Principals Layer
-- Creates principals table and links to companies

USE atlas;

-- ============================================
-- Create staging table for CMS Owners
-- ============================================
CREATE TABLE IF NOT EXISTS cms_owners_staging (
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
    INDEX idx_type_owner (type_owner),
    INDEX idx_role_code_owner (role_code_owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Load CSV (run as root for FILE privilege)
-- ============================================
-- LOAD DATA INFILE '/data/SNF_All_Owners_2025.12.02.csv'
-- INTO TABLE cms_owners_staging
-- CHARACTER SET latin1
-- FIELDS TERMINATED BY ','
-- OPTIONALLY ENCLOSED BY '"'
-- LINES TERMINATED BY '\r\n'
-- IGNORE 1 ROWS
-- (...all 40 columns...);

-- ============================================
-- Create principals table
-- ============================================
CREATE TABLE IF NOT EXISTS principals (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(100) COMMENT 'First name',
    middle_name VARCHAR(100) COMMENT 'Middle name',
    last_name VARCHAR(100) COMMENT 'Last name',
    full_name VARCHAR(255) NOT NULL COMMENT 'Full name (computed)',
    normalized_full_name VARCHAR(255) COMMENT 'Normalized for deduplication',
    title VARCHAR(100) COMMENT 'Professional title',
    email VARCHAR(255) COMMENT 'Email address',
    phone VARCHAR(50) COMMENT 'Phone number',
    linkedin_url VARCHAR(500) COMMENT 'LinkedIn profile URL',
    cms_associate_id_owner VARCHAR(50) COMMENT 'CMS owner associate ID',
    address VARCHAR(500) COMMENT 'Address',
    city VARCHAR(100) COMMENT 'City',
    state CHAR(2) COMMENT 'State',
    zip VARCHAR(10) COMMENT 'ZIP',
    zoho_contact_id VARCHAR(50) UNIQUE COMMENT 'Zoho Contact ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_synced_from_zoho TIMESTAMP NULL,
    notes TEXT,
    INDEX idx_full_name (full_name),
    INDEX idx_normalized_name (normalized_full_name),
    INDEX idx_last_name (last_name),
    INDEX idx_cms_associate_id (cms_associate_id_owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Create principal_company_relationships junction table
-- ============================================
CREATE TABLE IF NOT EXISTS principal_company_relationships (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    principal_id INT UNSIGNED NOT NULL,
    company_id INT UNSIGNED NOT NULL,
    role ENUM(
        'owner',
        'director',
        'officer',
        'ceo',
        'cfo',
        'coo',
        'president',
        'vp',
        'manager',
        'managing_employee',
        'other'
    ) NOT NULL COMMENT 'Role in company',
    role_detail VARCHAR(255) COMMENT 'Additional role details from CMS',
    cms_role_code VARCHAR(10) COMMENT 'CMS role code',
    ownership_percentage DECIMAL(5, 2) NULL COMMENT 'Ownership percentage if applicable',
    effective_date DATE NULL,
    end_date DATE DEFAULT NULL,
    data_source ENUM('cms','reapi','zoho','manual','web_scrape') NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    zoho_junction_record_id VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    notes TEXT,
    INDEX idx_principal_current (principal_id, end_date),
    INDEX idx_company_current (company_id, end_date),
    INDEX idx_role (role),
    INDEX idx_data_source (data_source),
    INDEX idx_cms_role_code (cms_role_code),
    CONSTRAINT fk_pcr2_principal
      FOREIGN KEY (principal_id) REFERENCES principals(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_pcr2_company
      FOREIGN KEY (company_id) REFERENCES companies(id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Insert principals (individuals with key roles)
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
        TRIM(associate_id_owner) as cms_associate_id_owner,
        TRIM(CONCAT_WS(' ',
            NULLIF(TRIM(address_line_1_owner), ''),
            NULLIF(TRIM(address_line_2_owner), '')
        )) as address,
        TRIM(city_owner) as city,
        UPPER(SUBSTRING(TRIM(COALESCE(state_owner, '')), 1, 2)) as state,
        SUBSTRING(REPLACE(TRIM(COALESCE(zip_code_owner, '')), '-', ''), 1, 5) as zip,
        ROW_NUMBER() OVER (PARTITION BY TRIM(associate_id_owner) ORDER BY enrollment_id) as rn
    FROM cms_owners_staging
    WHERE type_owner = 'I'
      AND role_code_owner IN ('34', '35', '40', '41', '42', '43', '44', '45')
      AND associate_id_owner IS NOT NULL
      AND TRIM(associate_id_owner) != ''
) ranked
WHERE rn = 1
  AND full_name IS NOT NULL
  AND full_name != '';

-- ============================================
-- Link principals to companies
-- ============================================
INSERT INTO principal_company_relationships (
    principal_id, company_id, role, role_detail, cms_role_code,
    ownership_percentage, effective_date, end_date, data_source, verified,
    created_at, updated_at
)
SELECT DISTINCT
    p.id as principal_id,
    c.id as company_id,
    CASE
        WHEN cos.role_code_owner IN ('34', '35') THEN 'owner'
        WHEN cos.role_code_owner = '40' THEN 'officer'
        WHEN cos.role_code_owner = '41' THEN 'director'
        WHEN cos.role_code_owner = '42' THEN 'managing_employee'
        WHEN cos.role_code_owner = '43' THEN 'manager'
        WHEN cos.role_code_owner IN ('44', '45') THEN 'other'
        ELSE 'other'
    END as role,
    cos.role_text_owner as role_detail,
    cos.role_code_owner as cms_role_code,
    CASE
        WHEN cos.percentage_ownership IS NOT NULL
             AND cos.percentage_ownership != ''
             AND cos.percentage_ownership REGEXP '^[0-9.]+$'
        THEN CAST(cos.percentage_ownership AS DECIMAL(5,2))
        ELSE NULL
    END as ownership_percentage,
    CASE
        WHEN cos.association_date_owner IS NOT NULL
             AND cos.association_date_owner != ''
             AND cos.association_date_owner REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        THEN STR_TO_DATE(cos.association_date_owner, '%m/%d/%Y')
        ELSE NULL
    END as effective_date,
    NULL as end_date,
    'cms' as data_source,
    FALSE as verified,
    NOW(), NOW()
FROM principals p
JOIN cms_owners_staging cos
    ON TRIM(cos.associate_id_owner) = p.cms_associate_id_owner
JOIN cms_enrollments_staging ces
    ON TRIM(ces.associate_id) = TRIM(cos.associate_id)
JOIN companies c
    ON c.cms_affiliated_entity_id = TRIM(ces.affiliation_entity_id)
WHERE cos.type_owner = 'I'
  AND cos.role_code_owner IN ('34', '35', '40', '41', '42', '43', '44', '45')
  AND ces.affiliation_entity_id IS NOT NULL
  AND TRIM(ces.affiliation_entity_id) != '';

-- ============================================
-- VALIDATION
-- ============================================
SELECT 'Phase 1B Principals Load Complete' as status;
SELECT COUNT(*) as principals FROM principals;
SELECT COUNT(*) as principal_company_links FROM principal_company_relationships;
