-- 3G Healthcare Real Estate Atlas - Phase 1B: Consolidate Standalone Portfolios
-- Groups standalone facilities by majority owner (principal with 50%+ ownership)
-- Creates one company per multi-facility owner using their name

USE atlas;

-- ============================================
-- STEP 1: Identify majority owners with multiple standalone facilities
-- ============================================

DROP TEMPORARY TABLE IF EXISTS standalone_portfolios;
CREATE TEMPORARY TABLE standalone_portfolios AS
SELECT
    p.id AS principal_id,
    p.full_name AS principal_name,
    p.city AS principal_city,
    p.state AS principal_state,
    COUNT(DISTINCT e.id) AS entity_count,
    COUNT(DISTINCT pre.property_master_id) AS facility_count,
    GROUP_CONCAT(DISTINCT e.id) AS entity_ids,
    GROUP_CONCAT(DISTINCT c.id) AS old_company_ids
FROM principals p
JOIN principal_entity_relationships per ON per.principal_id = p.id
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
JOIN property_entity_relationships pre ON pre.entity_id = e.id
WHERE c.cms_affiliated_entity_id LIKE 'STANDALONE-%'
  AND per.role IN ('owner_direct', 'owner_indirect')
  AND (per.ownership_percentage >= 50 OR per.ownership_percentage IS NULL)
GROUP BY p.id, p.full_name, p.city, p.state
HAVING facility_count >= 2;

SELECT 'Multi-facility standalone portfolios identified' AS status, COUNT(*) AS count FROM standalone_portfolios;

-- ============================================
-- STEP 2: Create consolidated companies for multi-facility owners
-- ============================================

INSERT INTO companies (
    company_name,
    company_type,
    cms_affiliated_entity_id,
    cms_affiliated_entity_name,
    city,
    state,
    notes,
    created_at,
    updated_at
)
SELECT DISTINCT
    sp.principal_name AS company_name,
    'opco' AS company_type,
    CONCAT('PRINCIPAL-', sp.principal_id) AS cms_affiliated_entity_id,
    sp.principal_name AS cms_affiliated_entity_name,
    sp.principal_city AS city,
    sp.principal_state AS state,
    CONCAT('Consolidated standalone portfolio - ', sp.facility_count, ' facilities') AS notes,
    NOW(),
    NOW()
FROM standalone_portfolios sp;

SELECT 'Consolidated portfolio companies created' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 3: Update entities to point to consolidated companies
-- ============================================

-- Create mapping of entity_id to new company_id
DROP TEMPORARY TABLE IF EXISTS entity_company_mapping;
CREATE TEMPORARY TABLE entity_company_mapping AS
SELECT DISTINCT
    e.id AS entity_id,
    c_new.id AS new_company_id,
    e.company_id AS old_company_id
FROM standalone_portfolios sp
JOIN principal_entity_relationships per ON per.principal_id = sp.principal_id
    AND per.role IN ('owner_direct', 'owner_indirect')
    AND (per.ownership_percentage >= 50 OR per.ownership_percentage IS NULL)
JOIN entities e ON e.id = per.entity_id
JOIN companies c_old ON c_old.id = e.company_id
    AND c_old.cms_affiliated_entity_id LIKE 'STANDALONE-%'
JOIN companies c_new ON c_new.cms_affiliated_entity_id = CONCAT('PRINCIPAL-', sp.principal_id);

SELECT 'Entity-company mappings created' AS status, COUNT(*) AS count FROM entity_company_mapping;

-- Update entities to new consolidated companies
UPDATE entities e
JOIN entity_company_mapping ecm ON ecm.entity_id = e.id
SET e.company_id = ecm.new_company_id,
    e.cms_affiliated_entity_id = (SELECT cms_affiliated_entity_id FROM companies WHERE id = ecm.new_company_id),
    e.updated_at = NOW();

SELECT 'Entities updated to consolidated companies' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 4: Delete orphaned standalone companies
-- ============================================

-- Find companies that no longer have any entities
DELETE FROM companies
WHERE cms_affiliated_entity_id LIKE 'STANDALONE-%'
  AND id NOT IN (SELECT DISTINCT company_id FROM entities WHERE company_id IS NOT NULL);

SELECT 'Orphaned standalone companies deleted' AS status, ROW_COUNT() AS count;

-- ============================================
-- VALIDATION QUERIES
-- ============================================

SELECT '=== CONSOLIDATION COMPLETE ===' AS status;

-- Company counts by type
SELECT
    CASE
        WHEN cms_affiliated_entity_id LIKE 'STANDALONE-%' THEN 'Standalone (single facility)'
        WHEN cms_affiliated_entity_id LIKE 'PRINCIPAL-%' THEN 'Consolidated (multi-facility owner)'
        ELSE 'Chain/Portfolio (CMS Affiliated)'
    END AS company_type,
    COUNT(*) AS companies
FROM companies
GROUP BY CASE
    WHEN cms_affiliated_entity_id LIKE 'STANDALONE-%' THEN 'Standalone (single facility)'
    WHEN cms_affiliated_entity_id LIKE 'PRINCIPAL-%' THEN 'Consolidated (multi-facility owner)'
    ELSE 'Chain/Portfolio (CMS Affiliated)'
END
ORDER BY companies DESC;

-- Verify PRATAP PODDATOORI consolidation
SELECT 'Verification: PRATAP PODDATOORI Portfolio' AS test;
SELECT
    c.company_name,
    c.cms_affiliated_entity_id,
    COUNT(DISTINCT e.id) AS entities,
    COUNT(DISTINCT pre.property_master_id) AS facilities
FROM companies c
JOIN entities e ON e.company_id = c.id
JOIN property_entity_relationships pre ON pre.entity_id = e.id
WHERE c.company_name = 'PRATAP PODDATOORI'
GROUP BY c.id, c.company_name, c.cms_affiliated_entity_id;

-- Show sample consolidated portfolio
SELECT 'Sample Consolidated Portfolio' AS report;
SELECT
    c.company_name AS portfolio_owner,
    e.entity_name AS legal_entity,
    pm.facility_name,
    pm.city,
    pm.state
FROM companies c
JOIN entities e ON e.company_id = c.id
JOIN property_entity_relationships pre ON pre.entity_id = e.id
JOIN property_master pm ON pm.id = pre.property_master_id
WHERE c.cms_affiliated_entity_id LIKE 'PRINCIPAL-%'
ORDER BY c.company_name, pm.state, pm.city
LIMIT 20;

-- Final totals
SELECT 'Final Table Counts' AS report;
SELECT 'companies' AS table_name, COUNT(*) AS total FROM companies
UNION ALL
SELECT 'entities', COUNT(*) FROM entities
UNION ALL
SELECT 'property_entity_relationships', COUNT(*) FROM property_entity_relationships;
