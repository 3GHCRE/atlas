-- 3G Healthcare Real Estate Atlas - Phase 1B: Fix Deals Entity Links
-- Adds entity_id to deals_parties and links parties to entities via associate_id
-- This enables proper graph traversal: Deal → Entity → Company → Principal

USE atlas;

-- ============================================
-- STEP 1: Add entity_id column to deals_parties
-- ============================================

ALTER TABLE deals_parties
ADD COLUMN entity_id INT UNSIGNED NULL AFTER party_dba_name,
ADD INDEX idx_entity_id (entity_id),
ADD CONSTRAINT fk_deals_parties_entity
    FOREIGN KEY (entity_id) REFERENCES entities(id);

SELECT 'Added entity_id column to deals_parties' AS status;

-- ============================================
-- STEP 2: Link parties to entities via associate_id
-- ============================================

UPDATE deals_parties dp
JOIN entities e ON e.cms_associate_id = TRIM(dp.associate_id)
SET dp.entity_id = e.id
WHERE dp.associate_id IS NOT NULL
  AND TRIM(dp.associate_id) != ''
  AND dp.entity_id IS NULL;

SELECT 'Parties linked to entities via associate_id' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 3: Update company_id based on entity linkage
-- (where entity has a company, propagate it)
-- ============================================

UPDATE deals_parties dp
JOIN entities e ON e.id = dp.entity_id
SET dp.company_id = e.company_id
WHERE dp.entity_id IS NOT NULL
  AND dp.company_id IS NULL
  AND e.company_id IS NOT NULL;

SELECT 'Company IDs updated from entity linkage' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 4: Try to link remaining parties by name matching
-- (for parties without associate_id)
-- ============================================

-- Match by exact entity name
UPDATE deals_parties dp
JOIN entities e ON UPPER(TRIM(e.entity_name)) = UPPER(TRIM(dp.party_name))
SET dp.entity_id = e.id,
    dp.company_id = COALESCE(dp.company_id, e.company_id)
WHERE dp.entity_id IS NULL
  AND dp.party_name IS NOT NULL
  AND TRIM(dp.party_name) != '';

SELECT 'Parties linked by name matching' AS status, ROW_COUNT() AS count;

-- ============================================
-- VALIDATION
-- ============================================

SELECT '=== DEALS ENTITY LINKAGE COMPLETE ===' AS status;

-- Linkage summary by role
SELECT
    party_role,
    COUNT(*) AS total,
    SUM(CASE WHEN entity_id IS NOT NULL THEN 1 ELSE 0 END) AS has_entity,
    CONCAT(ROUND(SUM(CASE WHEN entity_id IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1), '%') AS entity_coverage,
    SUM(CASE WHEN company_id IS NOT NULL THEN 1 ELSE 0 END) AS has_company,
    CONCAT(ROUND(SUM(CASE WHEN company_id IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1), '%') AS company_coverage
FROM deals_parties
GROUP BY party_role;

-- Sample linked deal
SELECT 'Sample Deal with Full Graph' AS test;
SELECT
    d.id AS deal_id,
    pm.facility_name,
    dp.party_role,
    dp.party_name,
    e.entity_name,
    c.company_name,
    c.cms_affiliated_entity_id
FROM deals d
JOIN property_master pm ON pm.id = d.property_master_id
JOIN deals_parties dp ON dp.deal_id = d.id
LEFT JOIN entities e ON e.id = dp.entity_id
LEFT JOIN companies c ON c.id = dp.company_id
WHERE dp.entity_id IS NOT NULL
LIMIT 10;

-- Total counts
SELECT 'deals_parties with entity links' AS metric,
    COUNT(*) AS total,
    SUM(CASE WHEN entity_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
FROM deals_parties;
