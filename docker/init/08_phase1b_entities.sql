-- 3G Healthcare Real Estate Atlas - Phase 1B REVISED: Entity Layer
-- Creates entities table (Legal Entity layer) between Property and Company
-- Architecture: Property -> Entity (Legal Entity) -> Company (Portfolio) -> Principal

USE atlas;

-- ============================================
-- STEP 0: Drop existing property_company_relationships
-- (Fresh start - pre-production database)
-- ============================================
DROP TABLE IF EXISTS property_company_relationships;

-- ============================================
-- STEP 1: Create entities table (Legal Entity Layer)
-- ============================================
-- Entity = Specific legal entity (LLC, Corp) - e.g., "Panama City FL Propco LLC"
-- Company = Portfolio/grouping layer - e.g., "Portopicolo Group" (groups multiple entities)

CREATE TABLE IF NOT EXISTS entities (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entity_name VARCHAR(255) NOT NULL COMMENT 'Legal entity name',
    entity_type ENUM('opco', 'propco', 'management', 'holding', 'pe_firm', 'reit', 'other') NOT NULL COMMENT 'Entity type classification',
    company_id INT UNSIGNED NOT NULL COMMENT 'FK to companies (portfolio layer)',
    dba_name VARCHAR(255) COMMENT 'Doing business as name',
    ein VARCHAR(20) COMMENT 'Employer Identification Number',
    cms_associate_id VARCHAR(50) COMMENT 'CMS Associate ID (legal entity level)',
    cms_affiliated_entity_id VARCHAR(50) COMMENT 'CMS Affiliated Entity ID (links to portfolio)',
    address VARCHAR(500) COMMENT 'Entity address',
    city VARCHAR(100) COMMENT 'City',
    state CHAR(2) COMMENT 'State',
    zip VARCHAR(10) COMMENT 'ZIP code',
    state_of_incorporation CHAR(2) COMMENT 'State of incorporation',
    zoho_entity_id VARCHAR(50) UNIQUE COMMENT 'Zoho Entity record ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_entity_name (entity_name),
    INDEX idx_entity_type (entity_type),
    INDEX idx_company_id (company_id),
    INDEX idx_cms_associate_id (cms_associate_id),
    INDEX idx_cms_affiliated_entity_id (cms_affiliated_entity_id),
    INDEX idx_state (state),

    CONSTRAINT fk_entity_company
        FOREIGN KEY (company_id) REFERENCES companies(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STEP 2: Load Entities from CMS Enrollments
-- Source: cms_enrollments_staging.associate_id = legal entity level
-- ============================================
INSERT INTO entities (
    entity_name,
    entity_type,
    company_id,
    dba_name,
    cms_associate_id,
    cms_affiliated_entity_id,
    address,
    city,
    state,
    zip,
    state_of_incorporation,
    created_at,
    updated_at
)
SELECT
    entity_name,
    entity_type,
    company_id,
    dba_name,
    cms_associate_id,
    cms_affiliated_entity_id,
    address,
    city,
    state,
    zip,
    state_of_incorporation,
    NOW(),
    NOW()
FROM (
    SELECT
        TRIM(ces.organization_name) AS entity_name,
        'opco' AS entity_type,
        c.id AS company_id,
        NULLIF(TRIM(ces.doing_business_as_name), '') AS dba_name,
        TRIM(ces.associate_id) AS cms_associate_id,
        TRIM(ces.affiliation_entity_id) AS cms_affiliated_entity_id,
        TRIM(CONCAT_WS(' ',
            NULLIF(TRIM(ces.address_line_1), ''),
            NULLIF(TRIM(ces.address_line_2), '')
        )) AS address,
        TRIM(ces.city) AS city,
        UPPER(SUBSTRING(TRIM(COALESCE(ces.state, '')), 1, 2)) AS state,
        SUBSTRING(REPLACE(TRIM(COALESCE(ces.zip_code, '')), '-', ''), 1, 5) AS zip,
        UPPER(SUBSTRING(TRIM(COALESCE(ces.incorporation_state, '')), 1, 2)) AS state_of_incorporation,
        ROW_NUMBER() OVER (PARTITION BY TRIM(ces.associate_id) ORDER BY ces.enrollment_id) AS rn
    FROM cms_enrollments_staging ces
    JOIN companies c ON c.cms_affiliated_entity_id = TRIM(ces.affiliation_entity_id)
    WHERE ces.associate_id IS NOT NULL
      AND TRIM(ces.associate_id) != ''
      AND ces.organization_name IS NOT NULL
      AND TRIM(ces.organization_name) != ''
      AND ces.affiliation_entity_id IS NOT NULL
      AND TRIM(ces.affiliation_entity_id) != ''
) ranked
WHERE rn = 1;

-- ============================================
-- STEP 3: Create property_entity_relationships Junction Table
-- ============================================
CREATE TABLE IF NOT EXISTS property_entity_relationships (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NOT NULL COMMENT 'FK to property_master',
    entity_id INT UNSIGNED NOT NULL COMMENT 'FK to entities',
    relationship_type ENUM(
        'property_owner',
        'facility_operator',
        'management_services',
        'lender',
        'parent_company',
        'affiliate',
        'consultant',
        'other'
    ) NOT NULL COMMENT 'Type of relationship',
    ownership_percentage DECIMAL(5, 2) NULL COMMENT 'Ownership percentage if applicable',
    effective_date DATE NULL COMMENT 'Start date of relationship',
    end_date DATE DEFAULT NULL COMMENT 'End date (NULL = current)',
    data_source ENUM('cms', 'reapi', 'zoho', 'manual', 'web_scrape') NOT NULL COMMENT 'Data source',
    verified BOOLEAN DEFAULT FALSE COMMENT 'Manual verification flag',
    zoho_junction_record_id VARCHAR(50) UNIQUE COMMENT 'Zoho junction record ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    notes TEXT,

    INDEX idx_property_current (property_master_id, end_date),
    INDEX idx_entity_current (entity_id, end_date),
    INDEX idx_relationship_type (relationship_type),
    INDEX idx_data_source (data_source),
    INDEX idx_property_role (property_master_id, relationship_type),

    CONSTRAINT fk_per_property
        FOREIGN KEY (property_master_id) REFERENCES property_master(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_per_entity
        FOREIGN KEY (entity_id) REFERENCES entities(id)
        ON DELETE CASCADE,

    UNIQUE KEY unique_active_relationship (property_master_id, entity_id, relationship_type, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STEP 4: Link Facilities to Entities
-- ============================================
INSERT INTO property_entity_relationships (
    property_master_id,
    entity_id,
    relationship_type,
    data_source,
    verified,
    created_at,
    updated_at
)
SELECT DISTINCT
    pm.id AS property_master_id,
    e.id AS entity_id,
    'facility_operator' AS relationship_type,
    'cms' AS data_source,
    FALSE AS verified,
    NOW(),
    NOW()
FROM property_master pm
JOIN cms_enrollments_staging ces ON TRIM(ces.ccn) = pm.ccn
JOIN entities e ON e.cms_associate_id = TRIM(ces.associate_id)
WHERE ces.associate_id IS NOT NULL
  AND TRIM(ces.associate_id) != ''
  AND ces.provider_type_code = '00-18';

-- ============================================
-- VALIDATION QUERIES
-- ============================================
SELECT '=== Phase 1B Entities Layer Load Complete ===' AS status;

-- Entity counts
SELECT COUNT(*) AS total_entities FROM entities;
SELECT entity_type, COUNT(*) AS count FROM entities GROUP BY entity_type;

-- Entities per company (portfolio) statistics
SELECT
    'Entities per Company Stats' AS metric,
    MIN(cnt) AS min_entities,
    AVG(cnt) AS avg_entities,
    MAX(cnt) AS max_entities
FROM (
    SELECT company_id, COUNT(*) AS cnt
    FROM entities
    GROUP BY company_id
) x;

-- Property-Entity relationship counts
SELECT COUNT(*) AS total_property_entity_links FROM property_entity_relationships;
SELECT relationship_type, COUNT(*) AS count
FROM property_entity_relationships
GROUP BY relationship_type;

-- Coverage statistics
SELECT
    (SELECT COUNT(DISTINCT property_master_id) FROM property_entity_relationships) AS facilities_with_entity,
    (SELECT COUNT(*) FROM property_master) AS total_facilities,
    ROUND(
        (SELECT COUNT(DISTINCT property_master_id) FROM property_entity_relationships) * 100.0 /
        (SELECT COUNT(*) FROM property_master), 1
    ) AS coverage_percent;

-- Sample data verification
SELECT
    pm.facility_name,
    e.entity_name,
    c.company_name AS portfolio_name,
    per.relationship_type
FROM property_master pm
JOIN property_entity_relationships per ON per.property_master_id = pm.id
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
LIMIT 10;
