-- 3G Healthcare Real Estate Atlas - PropCo-to-Company Address Linkage Verification
-- Validates address relationships between PropCo entities and their parent companies
-- Run AFTER propco layer is loaded

USE atlas;

-- ============================================
-- SECTION 1: PropCo Entity Address Analysis
-- ============================================
SELECT '=== PROPCO ENTITY ADDRESS ANALYSIS ===' AS section;

-- Count PropCo entities with addresses
SELECT
    'PropCo entities with address data' AS metric,
    COUNT(*) AS total_propco_entities,
    SUM(CASE WHEN address IS NOT NULL AND address != '' THEN 1 ELSE 0 END) AS with_address,
    SUM(CASE WHEN city IS NOT NULL AND city != '' THEN 1 ELSE 0 END) AS with_city,
    SUM(CASE WHEN state IS NOT NULL AND state != '' THEN 1 ELSE 0 END) AS with_state,
    ROUND(SUM(CASE WHEN address IS NOT NULL AND address != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS address_coverage_pct
FROM entities
WHERE entity_type = 'propco';

-- ============================================
-- SECTION 2: PropCo to Company Address Comparison
-- ============================================
SELECT '=== PROPCO TO COMPANY ADDRESS COMPARISON ===' AS section;

-- Compare PropCo entity address vs parent company address
SELECT
    e.id AS entity_id,
    e.entity_name,
    e.entity_type,
    e.address AS entity_address,
    e.city AS entity_city,
    e.state AS entity_state,
    c.id AS company_id,
    c.company_name,
    c.address AS company_address,
    c.city AS company_city,
    c.state AS company_state,
    CASE
        WHEN e.address = c.address AND e.city = c.city AND e.state = c.state THEN 'EXACT_MATCH'
        WHEN e.state = c.state AND e.city = c.city THEN 'CITY_STATE_MATCH'
        WHEN e.state = c.state THEN 'STATE_ONLY_MATCH'
        WHEN e.address IS NULL OR c.address IS NULL THEN 'MISSING_DATA'
        ELSE 'NO_MATCH'
    END AS address_match_type
FROM entities e
JOIN companies c ON c.id = e.company_id
WHERE e.entity_type = 'propco'
ORDER BY address_match_type, c.company_name
LIMIT 100;

-- Summarize address match types
SELECT '=== ADDRESS MATCH SUMMARY ===' AS section;
SELECT
    CASE
        WHEN e.address = c.address AND e.city = c.city AND e.state = c.state THEN 'EXACT_MATCH'
        WHEN e.state = c.state AND e.city = c.city THEN 'CITY_STATE_MATCH'
        WHEN e.state = c.state THEN 'STATE_ONLY_MATCH'
        WHEN e.address IS NULL OR c.address IS NULL THEN 'MISSING_DATA'
        ELSE 'NO_MATCH'
    END AS match_type,
    COUNT(*) AS count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM entities WHERE entity_type = 'propco'), 1) AS percentage
FROM entities e
JOIN companies c ON c.id = e.company_id
WHERE e.entity_type = 'propco'
GROUP BY CASE
    WHEN e.address = c.address AND e.city = c.city AND e.state = c.state THEN 'EXACT_MATCH'
    WHEN e.state = c.state AND e.city = c.city THEN 'CITY_STATE_MATCH'
    WHEN e.state = c.state THEN 'STATE_ONLY_MATCH'
    WHEN e.address IS NULL OR c.address IS NULL THEN 'MISSING_DATA'
    ELSE 'NO_MATCH'
END
ORDER BY count DESC;

-- ============================================
-- SECTION 3: Property-to-PropCo Address Verification
-- ============================================
SELECT '=== PROPERTY TO PROPCO ADDRESS VERIFICATION ===' AS section;

-- Compare property address vs PropCo entity address (for property_owner relationships)
SELECT
    pm.id AS property_id,
    pm.facility_name,
    pm.address AS property_address,
    pm.city AS property_city,
    pm.state AS property_state,
    e.id AS entity_id,
    e.entity_name,
    e.address AS entity_address,
    e.city AS entity_city,
    e.state AS entity_state,
    c.company_name AS parent_company,
    CASE
        WHEN pm.state = e.state AND pm.city = e.city THEN 'SAME_CITY'
        WHEN pm.state = e.state THEN 'SAME_STATE'
        WHEN e.address IS NULL THEN 'ENTITY_MISSING_ADDRESS'
        ELSE 'DIFFERENT_LOCATION'
    END AS location_relationship
FROM property_master pm
JOIN property_entity_relationships per ON per.property_master_id = pm.id
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE per.relationship_type = 'property_owner'
  AND e.entity_type = 'propco'
ORDER BY location_relationship, pm.state, pm.city
LIMIT 100;

-- Summarize property-to-propco location relationships
SELECT '=== PROPERTY TO PROPCO LOCATION SUMMARY ===' AS section;
SELECT
    CASE
        WHEN pm.state = e.state AND pm.city = e.city THEN 'SAME_CITY'
        WHEN pm.state = e.state THEN 'SAME_STATE'
        WHEN e.address IS NULL THEN 'ENTITY_MISSING_ADDRESS'
        ELSE 'DIFFERENT_LOCATION'
    END AS location_relationship,
    COUNT(*) AS count
FROM property_master pm
JOIN property_entity_relationships per ON per.property_master_id = pm.id
JOIN entities e ON e.id = per.entity_id
WHERE per.relationship_type = 'property_owner'
  AND e.entity_type = 'propco'
GROUP BY CASE
    WHEN pm.state = e.state AND pm.city = e.city THEN 'SAME_CITY'
    WHEN pm.state = e.state THEN 'SAME_STATE'
    WHEN e.address IS NULL THEN 'ENTITY_MISSING_ADDRESS'
    ELSE 'DIFFERENT_LOCATION'
END
ORDER BY count DESC;

-- ============================================
-- SECTION 4: Identify Potential Address Mismatches
-- ============================================
SELECT '=== POTENTIAL ADDRESS MISMATCHES ===' AS section;

-- PropCo entities where entity address doesn't match property location
-- (PropCo entities are typically named after property location like "Panama City FL Propco LLC")
SELECT
    e.id AS entity_id,
    e.entity_name,
    e.address AS entity_address,
    e.city AS entity_city,
    e.state AS entity_state,
    pm.id AS property_id,
    pm.facility_name,
    pm.city AS property_city,
    pm.state AS property_state,
    c.company_name AS parent_company
FROM entities e
JOIN property_entity_relationships per ON per.entity_id = e.id
JOIN property_master pm ON pm.id = per.property_master_id
JOIN companies c ON c.id = e.company_id
WHERE e.entity_type = 'propco'
  AND per.relationship_type = 'property_owner'
  AND pm.state != e.state
  AND e.state IS NOT NULL
  AND pm.state IS NOT NULL
LIMIT 50;

-- ============================================
-- SECTION 5: Company Address Coverage by Company Type
-- ============================================
SELECT '=== COMPANY ADDRESS COVERAGE BY TYPE ===' AS section;

SELECT
    company_type,
    COUNT(*) AS total,
    SUM(CASE WHEN address IS NOT NULL AND address != '' THEN 1 ELSE 0 END) AS with_address,
    ROUND(SUM(CASE WHEN address IS NOT NULL AND address != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS coverage_pct
FROM companies
WHERE company_name NOT LIKE '[MERGED]%'
GROUP BY company_type
ORDER BY total DESC;

-- ============================================
-- SECTION 6: Orphaned PropCo Entities (no property relationship)
-- ============================================
SELECT '=== ORPHANED PROPCO ENTITIES ===' AS section;

SELECT
    e.id AS entity_id,
    e.entity_name,
    e.entity_type,
    c.company_name AS parent_company,
    e.address,
    e.city,
    e.state
FROM entities e
JOIN companies c ON c.id = e.company_id
LEFT JOIN property_entity_relationships per ON per.entity_id = e.id
WHERE e.entity_type = 'propco'
  AND per.id IS NULL
LIMIT 50;

-- Count orphaned propcos
SELECT
    'Orphaned PropCo entities (no property link)' AS metric,
    COUNT(*) AS count
FROM entities e
LEFT JOIN property_entity_relationships per ON per.entity_id = e.id
WHERE e.entity_type = 'propco'
  AND per.id IS NULL;

-- ============================================
-- SECTION 7: PropCo Naming Pattern Analysis
-- Validates that PropCo names contain location info
-- ============================================
SELECT '=== PROPCO NAMING PATTERN ANALYSIS ===' AS section;

-- Check if PropCo entity name contains its linked property's state
SELECT
    CASE
        WHEN e.entity_name LIKE CONCAT('%', pm.state, '%') THEN 'NAME_CONTAINS_STATE'
        WHEN e.entity_name LIKE CONCAT('%', pm.city, '%') THEN 'NAME_CONTAINS_CITY'
        ELSE 'NO_LOCATION_IN_NAME'
    END AS naming_pattern,
    COUNT(*) AS count
FROM entities e
JOIN property_entity_relationships per ON per.entity_id = e.id
JOIN property_master pm ON pm.id = per.property_master_id
WHERE e.entity_type = 'propco'
  AND per.relationship_type = 'property_owner'
GROUP BY CASE
    WHEN e.entity_name LIKE CONCAT('%', pm.state, '%') THEN 'NAME_CONTAINS_STATE'
    WHEN e.entity_name LIKE CONCAT('%', pm.city, '%') THEN 'NAME_CONTAINS_CITY'
    ELSE 'NO_LOCATION_IN_NAME'
END
ORDER BY count DESC;

-- ============================================
-- VALIDATION COMPLETE
-- ============================================
SELECT '=== PROPCO ADDRESS VERIFICATION COMPLETE ===' AS section;
