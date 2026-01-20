-- 3G Healthcare Real Estate Atlas - Phase 1B: CMS Company Layer (Opco)
-- Creates companies table and links facilities to operators

USE atlas;

-- ============================================
-- STEP 1: Create companies table
-- ============================================
CREATE TABLE IF NOT EXISTS companies (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL COMMENT 'Legal business name',
    company_type ENUM('opco','propco','management','holding','pe_firm','reit','other') NOT NULL COMMENT 'Company type',
    dba_name VARCHAR(255) COMMENT 'Doing business as',
    ein VARCHAR(20) COMMENT 'Employer Identification Number',
    cms_affiliated_entity_id VARCHAR(50) COMMENT 'Links to CMS affiliated entity',
    cms_affiliated_entity_name VARCHAR(255) COMMENT 'CMS affiliated entity name',
    address VARCHAR(500) COMMENT 'HQ address',
    city VARCHAR(100) COMMENT 'City',
    state CHAR(2) COMMENT 'State',
    zip VARCHAR(10) COMMENT 'ZIP',
    state_of_incorporation CHAR(2) COMMENT 'State of incorporation',
    primary_contact_principal_id INT UNSIGNED NULL COMMENT 'FK to principals (added later)',
    website VARCHAR(255),
    zoho_company_id VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_synced_from_zoho TIMESTAMP NULL,
    notes TEXT,

    INDEX idx_company_name (company_name),
    INDEX idx_company_type (company_type),
    INDEX idx_cms_affiliated_entity_id (cms_affiliated_entity_id),
    INDEX idx_state (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STEP 2: Insert CMS Affiliated Entities as Opco Companies
-- ============================================
INSERT INTO companies (
    company_name,
    company_type,
    cms_affiliated_entity_id,
    cms_affiliated_entity_name,
    created_at,
    updated_at
)
SELECT
    TRIM(affiliation_entity_name) AS company_name,
    'opco' AS company_type,
    TRIM(affiliation_entity_id) AS cms_affiliated_entity_id,
    TRIM(affiliation_entity_name) AS cms_affiliated_entity_name,
    NOW(),
    NOW()
FROM cms_enrollments_staging
WHERE affiliation_entity_id IS NOT NULL
  AND TRIM(affiliation_entity_id) != ''
  AND affiliation_entity_name IS NOT NULL
  AND TRIM(affiliation_entity_name) != ''
GROUP BY
    TRIM(affiliation_entity_id),
    TRIM(affiliation_entity_name);

-- ============================================
-- STEP 3: Create property_company_relationships Junction Table
-- ============================================
CREATE TABLE IF NOT EXISTS property_company_relationships (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NOT NULL,
    company_id INT UNSIGNED NOT NULL,
    relationship_type ENUM(
        'property_owner',
        'facility_operator',
        'management_services',
        'lender',
        'parent_company',
        'affiliate',
        'consultant',
        'other'
    ) NOT NULL COMMENT 'CRITICAL FIELD',
    ownership_percentage DECIMAL(5, 2) NULL,
    effective_date DATE NULL,
    end_date DATE DEFAULT NULL,
    data_source ENUM('cms','reapi','zoho','manual','web_scrape') NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    zoho_junction_record_id VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    notes TEXT,

    INDEX idx_property_current (property_master_id, end_date),
    INDEX idx_company_current (company_id, end_date),
    INDEX idx_relationship_type (relationship_type),
    INDEX idx_data_source (data_source),
    INDEX idx_property_role (property_master_id, relationship_type),

    CONSTRAINT fk_pcr_property
      FOREIGN KEY (property_master_id) REFERENCES property_master(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_pcr_company
      FOREIGN KEY (company_id) REFERENCES companies(id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STEP 4: Link Facilities to Opco Companies (facility_operator)
-- ============================================
INSERT INTO property_company_relationships (
    property_master_id,
    company_id,
    relationship_type,
    ownership_percentage,
    effective_date,
    end_date,
    data_source,
    verified,
    created_at,
    updated_at
)
SELECT DISTINCT
    pm.id AS property_master_id,
    c.id AS company_id,
    'facility_operator' AS relationship_type,
    NULL AS ownership_percentage,
    NULL AS effective_date,
    NULL AS end_date,
    'cms' AS data_source,
    FALSE AS verified,
    NOW(),
    NOW()
FROM property_master pm
JOIN cms_enrollments_staging ces
    ON TRIM(ces.ccn) = pm.ccn
JOIN companies c
    ON c.cms_affiliated_entity_id = TRIM(ces.affiliation_entity_id)
WHERE ces.affiliation_entity_id IS NOT NULL
  AND TRIM(ces.affiliation_entity_id) != ''
  AND ces.provider_type_code = '00-18';

-- ============================================
-- VALIDATION QUERIES
-- ============================================
SELECT 'Phase 1B Load Complete' as status;
SELECT COUNT(*) as opco_companies FROM companies WHERE company_type = 'opco';
SELECT COUNT(*) as facility_operator_links FROM property_company_relationships WHERE relationship_type = 'facility_operator';
