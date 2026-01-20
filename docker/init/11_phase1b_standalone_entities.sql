-- 3G Healthcare Real Estate Atlas - Phase 1B: Standalone Facility Entities
-- Creates companies and entities for facilities without affiliation_entity_id
-- These are independent operators not part of a larger portfolio/chain

USE atlas;

-- ============================================
-- STEP 1: Create companies for standalone facilities
-- One company per unique organization (by associate_id)
-- ============================================

INSERT INTO companies (
    company_name,
    company_type,
    cms_affiliated_entity_id,
    cms_affiliated_entity_name,
    address,
    city,
    state,
    zip,
    state_of_incorporation,
    notes,
    created_at,
    updated_at
)
SELECT
    org_name AS company_name,
    CASE
        WHEN proprietary_nonprofit = 'N' THEN 'other'  -- Non-profit standalone
        ELSE 'opco'  -- For-profit standalone
    END AS company_type,
    CONCAT('STANDALONE-', associate_id) AS cms_affiliated_entity_id,  -- Synthetic ID
    org_name AS cms_affiliated_entity_name,
    address,
    city,
    state,
    zip,
    state_of_incorporation,
    'Standalone operator - no CMS affiliation' AS notes,
    NOW(),
    NOW()
FROM (
    SELECT
        TRIM(ces.organization_name) AS org_name,
        TRIM(ces.associate_id) AS associate_id,
        ces.proprietary_nonprofit,
        TRIM(CONCAT_WS(' ',
            NULLIF(TRIM(ces.address_line_1), ''),
            NULLIF(TRIM(ces.address_line_2), '')
        )) AS address,
        TRIM(ces.city) AS city,
        UPPER(SUBSTRING(TRIM(COALESCE(ces.state, '')), 1, 2)) AS state,
        SUBSTRING(REPLACE(TRIM(COALESCE(ces.zip_code, '')), '-', ''), 1, 5) AS zip,
        UPPER(SUBSTRING(TRIM(COALESCE(ces.incorporation_state, '')), 1, 2)) AS state_of_incorporation,
        ROW_NUMBER() OVER (PARTITION BY TRIM(ces.associate_id) ORDER BY ces.enrollment_id) AS rn
    FROM property_master pm
    LEFT JOIN property_entity_relationships pre ON pre.property_master_id = pm.id
    JOIN cms_enrollments_staging ces ON ces.ccn = pm.ccn
    WHERE pre.id IS NULL  -- Facilities without entity links
      AND ces.associate_id IS NOT NULL
      AND TRIM(ces.associate_id) != ''
      AND ces.organization_name IS NOT NULL
      AND TRIM(ces.organization_name) != ''
) ranked
WHERE rn = 1;

SELECT 'Standalone companies created' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 2: Create entities for standalone facilities
-- Links to the newly created standalone companies
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
    ranked.org_name AS entity_name,
    CASE
        WHEN ranked.proprietary_nonprofit = 'N' THEN 'other'  -- Non-profit
        ELSE 'opco'  -- For-profit
    END AS entity_type,
    c.id AS company_id,
    ranked.dba_name,
    ranked.associate_id AS cms_associate_id,
    CONCAT('STANDALONE-', ranked.associate_id) AS cms_affiliated_entity_id,
    ranked.address,
    ranked.city,
    ranked.state,
    ranked.zip,
    ranked.state_of_incorporation,
    NOW(),
    NOW()
FROM (
    SELECT
        TRIM(ces.organization_name) AS org_name,
        TRIM(ces.associate_id) AS associate_id,
        ces.proprietary_nonprofit,
        NULLIF(TRIM(ces.doing_business_as_name), '') AS dba_name,
        TRIM(CONCAT_WS(' ',
            NULLIF(TRIM(ces.address_line_1), ''),
            NULLIF(TRIM(ces.address_line_2), '')
        )) AS address,
        TRIM(ces.city) AS city,
        UPPER(SUBSTRING(TRIM(COALESCE(ces.state, '')), 1, 2)) AS state,
        SUBSTRING(REPLACE(TRIM(COALESCE(ces.zip_code, '')), '-', ''), 1, 5) AS zip,
        UPPER(SUBSTRING(TRIM(COALESCE(ces.incorporation_state, '')), 1, 2)) AS state_of_incorporation,
        ROW_NUMBER() OVER (PARTITION BY TRIM(ces.associate_id) ORDER BY ces.enrollment_id) AS rn
    FROM property_master pm
    LEFT JOIN property_entity_relationships pre ON pre.property_master_id = pm.id
    JOIN cms_enrollments_staging ces ON ces.ccn = pm.ccn
    WHERE pre.id IS NULL
      AND ces.associate_id IS NOT NULL
      AND TRIM(ces.associate_id) != ''
      AND ces.organization_name IS NOT NULL
      AND TRIM(ces.organization_name) != ''
) ranked
JOIN companies c ON c.cms_affiliated_entity_id = CONCAT('STANDALONE-', ranked.associate_id)
WHERE rn = 1;

SELECT 'Standalone entities created' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 3: Link standalone facilities to their entities
-- ============================================

INSERT INTO property_entity_relationships (
    property_master_id,
    entity_id,
    relationship_type,
    data_source,
    verified,
    notes,
    created_at,
    updated_at
)
SELECT DISTINCT
    pm.id AS property_master_id,
    e.id AS entity_id,
    'facility_operator' AS relationship_type,
    'cms' AS data_source,
    FALSE AS verified,
    'Standalone operator - no CMS chain affiliation' AS notes,
    NOW(),
    NOW()
FROM property_master pm
LEFT JOIN property_entity_relationships pre_existing ON pre_existing.property_master_id = pm.id
JOIN cms_enrollments_staging ces ON ces.ccn = pm.ccn
JOIN entities e ON e.cms_associate_id = TRIM(ces.associate_id)
    AND e.cms_affiliated_entity_id LIKE 'STANDALONE-%'
WHERE pre_existing.id IS NULL
  AND ces.associate_id IS NOT NULL
  AND TRIM(ces.associate_id) != '';

SELECT 'Standalone facility links created' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 4: Link principals to standalone entities
-- (if they have ownership records in cms_owners_staging)
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
    AND e.cms_affiliated_entity_id LIKE 'STANDALONE-%'
JOIN principals p ON p.cms_associate_id_owner = TRIM(cos.associate_id_owner)
LEFT JOIN principal_entity_relationships per_existing
    ON per_existing.principal_id = p.id
    AND per_existing.entity_id = e.id
WHERE cos.type_owner = 'I'
  AND cos.role_code_owner IN ('34', '35', '40', '41', '42', '43', '44', '45')
  AND cos.associate_id_owner IS NOT NULL
  AND TRIM(cos.associate_id_owner) != ''
  AND ces.associate_id IS NOT NULL
  AND TRIM(ces.associate_id) != ''
  AND per_existing.id IS NULL;  -- Don't duplicate

SELECT 'Standalone principal-entity links created' AS status, ROW_COUNT() AS count;

-- ============================================
-- VALIDATION QUERIES
-- ============================================
SELECT '=== STANDALONE ENTITIES LOAD COMPLETE ===' AS status;

-- New totals
SELECT 'companies' AS table_name, COUNT(*) AS total FROM companies
UNION ALL
SELECT 'entities', COUNT(*) FROM entities
UNION ALL
SELECT 'property_entity_relationships', COUNT(*) FROM property_entity_relationships
UNION ALL
SELECT 'principal_entity_relationships', COUNT(*) FROM principal_entity_relationships;

-- Coverage check
SELECT
    'Facility Coverage' AS metric,
    COUNT(DISTINCT pre.property_master_id) AS linked,
    (SELECT COUNT(*) FROM property_master) AS total,
    CONCAT(ROUND(COUNT(DISTINCT pre.property_master_id) * 100.0 /
        (SELECT COUNT(*) FROM property_master), 1), '%') AS coverage
FROM property_entity_relationships pre;

-- Standalone vs Chain breakdown
SELECT
    CASE
        WHEN c.cms_affiliated_entity_id LIKE 'STANDALONE-%' THEN 'Standalone'
        ELSE 'Chain/Portfolio'
    END AS operator_type,
    COUNT(DISTINCT c.id) AS companies,
    COUNT(DISTINCT e.id) AS entities,
    COUNT(DISTINCT pre.property_master_id) AS facilities
FROM companies c
LEFT JOIN entities e ON e.company_id = c.id
LEFT JOIN property_entity_relationships pre ON pre.entity_id = e.id
GROUP BY CASE
    WHEN c.cms_affiliated_entity_id LIKE 'STANDALONE-%' THEN 'Standalone'
    ELSE 'Chain/Portfolio'
END;

-- Verify no remaining unlinked facilities
SELECT
    'Remaining unlinked facilities' AS check_type,
    COUNT(*) AS count
FROM property_master pm
LEFT JOIN property_entity_relationships pre ON pre.property_master_id = pm.id
WHERE pre.id IS NULL;
