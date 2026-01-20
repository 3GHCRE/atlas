-- 3G Healthcare Real Estate Atlas - Phase 1B REVISED: Principal-Entity Relationships
-- Creates principal_entity_relationships for entity-level control
-- Architecture: Property -> Entity (Legal Entity) -> Company (Portfolio) -> Principal

USE atlas;

-- ============================================
-- STEP 1: Create principal_entity_relationships Junction Table
-- This links principals to specific legal entities (not portfolios)
-- ============================================
CREATE TABLE IF NOT EXISTS principal_entity_relationships (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    principal_id INT UNSIGNED NOT NULL COMMENT 'FK to principals',
    entity_id INT UNSIGNED NOT NULL COMMENT 'FK to entities',
    role ENUM(
        'ceo',
        'president',
        'cfo',
        'coo',
        'board_member',
        'managing_partner',
        'general_partner',
        'limited_partner',
        'owner_direct',
        'owner_indirect',
        'officer',
        'manager',
        'member',
        'managing_employee',
        'director',
        'other'
    ) NOT NULL COMMENT 'Role at entity level',
    role_detail VARCHAR(255) COMMENT 'Additional role details from CMS',
    cms_role_code VARCHAR(10) COMMENT 'CMS role code for reference',
    ownership_percentage DECIMAL(5, 2) NULL COMMENT 'Ownership percentage if applicable',
    effective_date DATE NULL COMMENT 'Start date of role',
    end_date DATE DEFAULT NULL COMMENT 'End date (NULL = current)',
    is_primary BOOLEAN DEFAULT FALSE COMMENT 'Primary role flag',
    data_source ENUM('cms', 'zoho', 'manual', 'web_scrape', 'sos_filing') NOT NULL COMMENT 'Data source',
    zoho_junction_record_id VARCHAR(50) UNIQUE COMMENT 'Zoho junction record ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_principal_current (principal_id, end_date),
    INDEX idx_entity_current (entity_id, end_date),
    INDEX idx_role (role),
    INDEX idx_cms_role_code (cms_role_code),
    INDEX idx_data_source (data_source),

    CONSTRAINT fk_per_principal
        FOREIGN KEY (principal_id) REFERENCES principals(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_per_entity_link
        FOREIGN KEY (entity_id) REFERENCES entities(id)
        ON DELETE CASCADE,

    UNIQUE KEY unique_active_role (principal_id, entity_id, role, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STEP 2: Update principal_company_relationships for Portfolio-Level Control
-- Add new roles for portfolio-level relationships
-- ============================================
ALTER TABLE principal_company_relationships
MODIFY COLUMN role ENUM(
    'portfolio_owner',
    'portfolio_manager',
    'board_member',
    'ceo',
    'president',
    'cfo',
    'coo',
    'managing_partner',
    'general_partner',
    'limited_partner',
    'owner',
    'owner_direct',
    'owner_indirect',
    'director',
    'officer',
    'manager',
    'managing_employee',
    'vp',
    'other'
) NOT NULL COMMENT 'Role in company (portfolio level)';

-- ============================================
-- STEP 3: Link Principals to Entities
-- Maps CMS ownership data to entity-level relationships
-- ============================================
INSERT INTO principal_entity_relationships (
    principal_id,
    entity_id,
    role,
    role_detail,
    cms_role_code,
    ownership_percentage,
    effective_date,
    end_date,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    p.id AS principal_id,
    e.id AS entity_id,
    CASE
        WHEN cos.role_code_owner = '34' THEN 'owner_direct'
        WHEN cos.role_code_owner = '35' THEN 'owner_indirect'
        WHEN cos.role_code_owner = '40' THEN 'officer'
        WHEN cos.role_code_owner = '41' THEN 'director'
        WHEN cos.role_code_owner = '42' THEN 'managing_employee'
        WHEN cos.role_code_owner = '43' THEN 'board_member'
        WHEN cos.role_code_owner = '44' THEN 'member'
        WHEN cos.role_code_owner = '45' THEN 'manager'
        ELSE 'other'
    END AS role,
    cos.role_text_owner AS role_detail,
    cos.role_code_owner AS cms_role_code,
    CASE
        WHEN cos.percentage_ownership IS NOT NULL
             AND cos.percentage_ownership != ''
             AND cos.percentage_ownership REGEXP '^[0-9.]+$'
        THEN CAST(cos.percentage_ownership AS DECIMAL(5,2))
        ELSE NULL
    END AS ownership_percentage,
    CASE
        WHEN cos.association_date_owner IS NOT NULL
             AND cos.association_date_owner != ''
             AND cos.association_date_owner REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        THEN STR_TO_DATE(cos.association_date_owner, '%m/%d/%Y')
        ELSE NULL
    END AS effective_date,
    NULL AS end_date,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM cms_owners_staging cos
JOIN cms_enrollments_staging ces ON TRIM(ces.enrollment_id) = TRIM(cos.enrollment_id)
JOIN entities e ON e.cms_associate_id = TRIM(ces.associate_id)
JOIN principals p ON p.cms_associate_id_owner = TRIM(cos.associate_id_owner)
WHERE cos.type_owner = 'I'
  AND cos.role_code_owner IN ('34', '35', '40', '41', '42', '43', '44', '45')
  AND cos.associate_id_owner IS NOT NULL
  AND TRIM(cos.associate_id_owner) != ''
  AND ces.associate_id IS NOT NULL
  AND TRIM(ces.associate_id) != '';

-- ============================================
-- VALIDATION QUERIES
-- ============================================
SELECT '=== Phase 1B Principal-Entity Relationships Load Complete ===' AS status;

-- Principal-Entity relationship counts
SELECT COUNT(*) AS total_principal_entity_links FROM principal_entity_relationships;

-- Role distribution at entity level
SELECT role, COUNT(*) AS count
FROM principal_entity_relationships
GROUP BY role
ORDER BY count DESC;

-- Principals with entity relationships
SELECT COUNT(DISTINCT principal_id) AS principals_with_entity_role
FROM principal_entity_relationships;

-- Entities with principal relationships
SELECT COUNT(DISTINCT entity_id) AS entities_with_principals
FROM principal_entity_relationships;

-- Coverage statistics
SELECT
    (SELECT COUNT(DISTINCT entity_id) FROM principal_entity_relationships) AS entities_with_principals,
    (SELECT COUNT(*) FROM entities) AS total_entities,
    ROUND(
        (SELECT COUNT(DISTINCT entity_id) FROM principal_entity_relationships) * 100.0 /
        (SELECT COUNT(*) FROM entities), 1
    ) AS coverage_percent;

-- Sample principal-entity links
SELECT
    p.full_name,
    per.role,
    per.ownership_percentage,
    e.entity_name,
    c.company_name AS portfolio_name
FROM principal_entity_relationships per
JOIN principals p ON p.id = per.principal_id
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE per.ownership_percentage IS NOT NULL
LIMIT 10;
