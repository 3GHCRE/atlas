-- 3G Healthcare Real Estate Atlas - Phase 1B REVISED: Comprehensive Validation
-- Validates the complete 4-layer ownership architecture:
-- Property -> Entity (Legal Entity) -> Company (Portfolio) -> Principal

USE atlas;

-- ============================================
-- SECTION 1: TABLE ROW COUNTS
-- ============================================
SELECT '=== PHASE 1B REVISED: COMPREHENSIVE VALIDATION ===' AS section;
SELECT '' AS '';

SELECT '--- 1. TABLE ROW COUNTS ---' AS subsection;

SELECT 'property_master' AS table_name, COUNT(*) AS row_count FROM property_master
UNION ALL
SELECT 'entities', COUNT(*) FROM entities
UNION ALL
SELECT 'companies', COUNT(*) FROM companies
UNION ALL
SELECT 'principals', COUNT(*) FROM principals
UNION ALL
SELECT 'property_entity_relationships', COUNT(*) FROM property_entity_relationships
UNION ALL
SELECT 'principal_entity_relationships', COUNT(*) FROM principal_entity_relationships
UNION ALL
SELECT 'principal_company_relationships', COUNT(*) FROM principal_company_relationships;

-- ============================================
-- SECTION 2: ENTITY LAYER VALIDATION
-- ============================================
SELECT '' AS '';
SELECT '--- 2. ENTITY LAYER VALIDATION ---' AS subsection;

-- Entity type distribution
SELECT entity_type, COUNT(*) AS count
FROM entities
GROUP BY entity_type
ORDER BY count DESC;

-- Entities per company (portfolio) distribution
SELECT
    CASE
        WHEN cnt = 1 THEN '1 entity'
        WHEN cnt BETWEEN 2 AND 5 THEN '2-5 entities'
        WHEN cnt BETWEEN 6 AND 10 THEN '6-10 entities'
        WHEN cnt BETWEEN 11 AND 20 THEN '11-20 entities'
        ELSE '20+ entities'
    END AS entities_per_portfolio,
    COUNT(*) AS portfolio_count
FROM (
    SELECT company_id, COUNT(*) AS cnt
    FROM entities
    GROUP BY company_id
) x
GROUP BY
    CASE
        WHEN cnt = 1 THEN '1 entity'
        WHEN cnt BETWEEN 2 AND 5 THEN '2-5 entities'
        WHEN cnt BETWEEN 6 AND 10 THEN '6-10 entities'
        WHEN cnt BETWEEN 11 AND 20 THEN '11-20 entities'
        ELSE '20+ entities'
    END
ORDER BY portfolio_count DESC;

-- Top 10 portfolios by entity count
SELECT
    c.company_name AS portfolio_name,
    COUNT(e.id) AS entity_count
FROM companies c
JOIN entities e ON e.company_id = c.id
GROUP BY c.id, c.company_name
ORDER BY entity_count DESC
LIMIT 10;

-- ============================================
-- SECTION 3: PROPERTY-ENTITY LINK VALIDATION
-- ============================================
SELECT '' AS '';
SELECT '--- 3. PROPERTY-ENTITY LINK VALIDATION ---' AS subsection;

-- Relationship type distribution
SELECT relationship_type, COUNT(*) AS count
FROM property_entity_relationships
GROUP BY relationship_type
ORDER BY count DESC;

-- Facilities coverage
SELECT
    (SELECT COUNT(DISTINCT property_master_id) FROM property_entity_relationships) AS linked_facilities,
    (SELECT COUNT(*) FROM property_master) AS total_facilities,
    ROUND(
        (SELECT COUNT(DISTINCT property_master_id) FROM property_entity_relationships) * 100.0 /
        (SELECT COUNT(*) FROM property_master), 2
    ) AS coverage_percent;

-- Entities coverage (entities with at least one property link)
SELECT
    (SELECT COUNT(DISTINCT entity_id) FROM property_entity_relationships) AS linked_entities,
    (SELECT COUNT(*) FROM entities) AS total_entities,
    ROUND(
        (SELECT COUNT(DISTINCT entity_id) FROM property_entity_relationships) * 100.0 /
        (SELECT COUNT(*) FROM entities), 2
    ) AS coverage_percent;

-- ============================================
-- SECTION 4: PRINCIPAL-ENTITY VALIDATION
-- ============================================
SELECT '' AS '';
SELECT '--- 4. PRINCIPAL-ENTITY VALIDATION ---' AS subsection;

-- Role distribution at entity level
SELECT role, COUNT(*) AS count
FROM principal_entity_relationships
GROUP BY role
ORDER BY count DESC;

-- Principals with entity roles
SELECT
    (SELECT COUNT(DISTINCT principal_id) FROM principal_entity_relationships) AS principals_with_entity_role,
    (SELECT COUNT(*) FROM principals) AS total_principals,
    ROUND(
        (SELECT COUNT(DISTINCT principal_id) FROM principal_entity_relationships) * 100.0 /
        (SELECT COUNT(*) FROM principals), 2
    ) AS coverage_percent;

-- Ownership percentage distribution
SELECT
    CASE
        WHEN ownership_percentage IS NULL THEN 'Unknown'
        WHEN ownership_percentage = 0 THEN '0%'
        WHEN ownership_percentage BETWEEN 0.01 AND 10 THEN '0-10%'
        WHEN ownership_percentage BETWEEN 10.01 AND 25 THEN '10-25%'
        WHEN ownership_percentage BETWEEN 25.01 AND 50 THEN '25-50%'
        WHEN ownership_percentage BETWEEN 50.01 AND 75 THEN '50-75%'
        WHEN ownership_percentage BETWEEN 75.01 AND 99.99 THEN '75-99%'
        WHEN ownership_percentage >= 100 THEN '100%'
        ELSE 'Other'
    END AS ownership_range,
    COUNT(*) AS count
FROM principal_entity_relationships
GROUP BY
    CASE
        WHEN ownership_percentage IS NULL THEN 'Unknown'
        WHEN ownership_percentage = 0 THEN '0%'
        WHEN ownership_percentage BETWEEN 0.01 AND 10 THEN '0-10%'
        WHEN ownership_percentage BETWEEN 10.01 AND 25 THEN '10-25%'
        WHEN ownership_percentage BETWEEN 25.01 AND 50 THEN '25-50%'
        WHEN ownership_percentage BETWEEN 50.01 AND 75 THEN '50-75%'
        WHEN ownership_percentage BETWEEN 75.01 AND 99.99 THEN '75-99%'
        WHEN ownership_percentage >= 100 THEN '100%'
        ELSE 'Other'
    END
ORDER BY count DESC;

-- ============================================
-- SECTION 5: COMPLETE GRAPH TRAVERSAL
-- ============================================
SELECT '' AS '';
SELECT '--- 5. COMPLETE GRAPH TRAVERSAL EXAMPLES ---' AS subsection;

-- Example 1: Full ownership chain for a specific facility
SELECT
    'Property -> Entity -> Company -> Principal' AS chain_type,
    pm.ccn,
    pm.facility_name,
    e.entity_name,
    c.company_name AS portfolio_name,
    p.full_name AS principal_name,
    per.role AS entity_role,
    per.ownership_percentage
FROM property_master pm
JOIN property_entity_relationships pre ON pre.property_master_id = pm.id
JOIN entities e ON e.id = pre.entity_id
JOIN companies c ON c.id = e.company_id
LEFT JOIN principal_entity_relationships per ON per.entity_id = e.id
LEFT JOIN principals p ON p.id = per.principal_id
WHERE pm.state = 'TX'
LIMIT 20;

-- Example 2: Portfolio summary with facility and principal counts
SELECT
    c.company_name AS portfolio_name,
    COUNT(DISTINCT e.id) AS entity_count,
    COUNT(DISTINCT pre.property_master_id) AS facility_count,
    COUNT(DISTINCT per.principal_id) AS principal_count,
    SUM(CASE WHEN per.role IN ('owner_direct', 'owner_indirect') THEN 1 ELSE 0 END) AS owner_count
FROM companies c
LEFT JOIN entities e ON e.company_id = c.id
LEFT JOIN property_entity_relationships pre ON pre.entity_id = e.id
LEFT JOIN principal_entity_relationships per ON per.entity_id = e.id
GROUP BY c.id, c.company_name
HAVING facility_count > 0
ORDER BY facility_count DESC
LIMIT 15;

-- ============================================
-- SECTION 6: DATA QUALITY CHECKS
-- ============================================
SELECT '' AS '';
SELECT '--- 6. DATA QUALITY CHECKS ---' AS subsection;

-- Orphaned entities (no property links)
SELECT
    'Entities without property links' AS check_type,
    COUNT(*) AS count
FROM entities e
LEFT JOIN property_entity_relationships pre ON pre.entity_id = e.id
WHERE pre.id IS NULL;

-- Entities without principals
SELECT
    'Entities without principals' AS check_type,
    COUNT(*) AS count
FROM entities e
LEFT JOIN principal_entity_relationships per ON per.entity_id = e.id
WHERE per.id IS NULL;

-- Duplicate entity-property links (should be 0)
SELECT
    'Duplicate property-entity links' AS check_type,
    COUNT(*) AS count
FROM (
    SELECT property_master_id, entity_id, relationship_type, COUNT(*) AS cnt
    FROM property_entity_relationships
    WHERE end_date IS NULL
    GROUP BY property_master_id, entity_id, relationship_type
    HAVING cnt > 1
) dups;

-- ============================================
-- SECTION 7: EXPECTED VS ACTUAL SUMMARY
-- ============================================
SELECT '' AS '';
SELECT '--- 7. EXPECTED VS ACTUAL SUMMARY ---' AS subsection;

SELECT
    'companies (Portfolio)' AS layer,
    '~619' AS expected,
    (SELECT COUNT(*) FROM companies) AS actual
UNION ALL
SELECT
    'entities (Legal Entity)',
    '~2,000-3,000',
    (SELECT COUNT(*) FROM entities)
UNION ALL
SELECT
    'property_entity_relationships',
    '~9,928 (70.6% coverage)',
    (SELECT COUNT(*) FROM property_entity_relationships)
UNION ALL
SELECT
    'principal_entity_relationships',
    '~62,970',
    (SELECT COUNT(*) FROM principal_entity_relationships)
UNION ALL
SELECT
    'principals',
    '~47,386',
    (SELECT COUNT(*) FROM principals);

-- ============================================
-- SECTION 8: ARCHITECTURE VERIFICATION
-- ============================================
SELECT '' AS '';
SELECT '--- 8. ARCHITECTURE VERIFICATION ---' AS subsection;

-- Verify foreign key integrity: All entities have valid company_id
SELECT
    'Entities with invalid company_id' AS check_type,
    COUNT(*) AS count
FROM entities e
LEFT JOIN companies c ON c.id = e.company_id
WHERE c.id IS NULL;

-- Verify foreign key integrity: All property_entity_relationships have valid refs
SELECT
    'Property-Entity links with invalid property_master_id' AS check_type,
    COUNT(*) AS count
FROM property_entity_relationships pre
LEFT JOIN property_master pm ON pm.id = pre.property_master_id
WHERE pm.id IS NULL;

SELECT
    'Property-Entity links with invalid entity_id' AS check_type,
    COUNT(*) AS count
FROM property_entity_relationships pre
LEFT JOIN entities e ON e.id = pre.entity_id
WHERE e.id IS NULL;

-- Verify foreign key integrity: All principal_entity_relationships have valid refs
SELECT
    'Principal-Entity links with invalid principal_id' AS check_type,
    COUNT(*) AS count
FROM principal_entity_relationships per
LEFT JOIN principals p ON p.id = per.principal_id
WHERE p.id IS NULL;

SELECT
    'Principal-Entity links with invalid entity_id' AS check_type,
    COUNT(*) AS count
FROM principal_entity_relationships per
LEFT JOIN entities e ON e.id = per.entity_id
WHERE e.id IS NULL;

-- ============================================
-- FINAL STATUS
-- ============================================
SELECT '' AS '';
SELECT '=== PHASE 1B REVISED VALIDATION COMPLETE ===' AS final_status;
SELECT 'Architecture: Property -> Entity -> Company -> Principal' AS architecture;
SELECT NOW() AS validation_timestamp;
