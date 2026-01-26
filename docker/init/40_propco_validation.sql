-- 3G Healthcare Real Estate Atlas - Phase 2: Propco Layer Validation
-- Validates propco integration from REAPI data
-- Run AFTER executing scripts/load-propco-layer.js

USE atlas;

-- ============================================
-- VALIDATION 1: Propco Company Exists
-- ============================================
SELECT '=== VALIDATION 1: Propco Companies ===' AS section;

SELECT
    company_name,
    company_type,
    address,
    city,
    state,
    notes
FROM companies
WHERE company_type IN ('propco', 'reit')
ORDER BY company_name;

-- ============================================
-- VALIDATION 2: Propco Entity Counts
-- ============================================
SELECT '=== VALIDATION 2: Propco Entity Counts ===' AS section;

SELECT
    c.company_name,
    c.company_type,
    COUNT(e.id) AS propco_entity_count
FROM companies c
LEFT JOIN entities e ON e.company_id = c.id AND e.entity_type = 'propco'
WHERE c.company_type IN ('propco', 'reit')
GROUP BY c.id
ORDER BY propco_entity_count DESC;

-- Sample propco entities
SELECT '=== Sample Propco Entities (Ensign) ===' AS section;

SELECT
    e.entity_name,
    e.entity_type,
    c.company_name AS parent_company,
    e.address,
    e.city,
    e.state
FROM entities e
JOIN companies c ON c.id = e.company_id
WHERE e.entity_type = 'propco'
  AND c.company_name = 'Ensign Group'
LIMIT 10;

-- ============================================
-- VALIDATION 3: Property-Owner Relationships
-- ============================================
SELECT '=== VALIDATION 3: Property Owner Relationships ===' AS section;

SELECT
    c.company_name,
    COUNT(DISTINCT per.property_master_id) AS properties_owned,
    per.data_source
FROM property_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE per.relationship_type = 'property_owner'
GROUP BY c.id, per.data_source
ORDER BY properties_owned DESC;

-- ============================================
-- VALIDATION 4: Opco vs Propco Cross-Reference
-- ============================================
SELECT '=== VALIDATION 4: Opco vs Propco Comparison ===' AS section;

-- Properties where operator and owner are different
SELECT
    pm.facility_name,
    pm.state,
    pm.city,
    opco_c.company_name AS operator,
    propco_c.company_name AS owner,
    CASE WHEN opco_c.id = propco_c.id THEN 'Same' ELSE 'Different' END AS ownership_structure
FROM property_master pm
JOIN property_entity_relationships opco_per
    ON opco_per.property_master_id = pm.id
    AND opco_per.relationship_type = 'facility_operator'
JOIN entities opco_e ON opco_e.id = opco_per.entity_id
JOIN companies opco_c ON opco_c.id = opco_e.company_id
JOIN property_entity_relationships propco_per
    ON propco_per.property_master_id = pm.id
    AND propco_per.relationship_type = 'property_owner'
JOIN entities propco_e ON propco_e.id = propco_per.entity_id
JOIN companies propco_c ON propco_c.id = propco_e.company_id
WHERE propco_c.company_name = 'Ensign Group'
LIMIT 20;

-- ============================================
-- VALIDATION 5: Coverage Statistics
-- ============================================
SELECT '=== VALIDATION 5: Coverage Statistics ===' AS section;

SELECT
    'Total Properties' AS metric,
    COUNT(*) AS count
FROM property_master
UNION ALL
SELECT
    'Properties with Operator (CMS)',
    COUNT(DISTINCT property_master_id)
FROM property_entity_relationships
WHERE relationship_type = 'facility_operator'
UNION ALL
SELECT
    'Properties with Owner (REAPI)',
    COUNT(DISTINCT property_master_id)
FROM property_entity_relationships
WHERE relationship_type = 'property_owner'
UNION ALL
SELECT
    'Properties with Both',
    COUNT(DISTINCT pm.id)
FROM property_master pm
JOIN property_entity_relationships opco_per
    ON opco_per.property_master_id = pm.id
    AND opco_per.relationship_type = 'facility_operator'
JOIN property_entity_relationships propco_per
    ON propco_per.property_master_id = pm.id
    AND propco_per.relationship_type = 'property_owner';

-- ============================================
-- VALIDATION 6: Full Ownership Chain
-- ============================================
SELECT '=== VALIDATION 6: Full Ownership Chain (Sample) ===' AS section;

-- property -> propco entity -> Ensign Group company
SELECT
    pm.ccn,
    pm.facility_name,
    pm.state,
    e.entity_name AS propco_entity,
    c.company_name AS propco_company
FROM property_master pm
JOIN property_entity_relationships per
    ON per.property_master_id = pm.id
    AND per.relationship_type = 'property_owner'
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.company_name = 'Ensign Group'
  AND e.entity_type = 'propco'
LIMIT 10;

SELECT '=== Propco Validation Complete ===' AS section;
