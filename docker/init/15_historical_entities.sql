-- 3G Healthcare Real Estate Atlas - Phase 1B: Historical Entities
-- Creates historical entities for CHOW sellers to complete transaction graph
-- Unified approach that also supports future REAPI sales data
-- entity_status: 'current' (from CMS/REAPI active) vs 'historical' (from transaction sellers)

USE atlas;

-- ============================================
-- STEP 1: Modify entities table for historical support
-- Allow NULL company_id for historical entities
-- ============================================

-- Make company_id nullable (historical entities won't have company linkage)
ALTER TABLE entities
MODIFY COLUMN company_id INT UNSIGNED NULL;

SELECT 'Made company_id nullable for historical entities' AS status;

-- Add data_source column if not exists (for tracking origin)
-- Check if column exists first
SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'atlas'
    AND TABLE_NAME = 'entities'
    AND COLUMN_NAME = 'data_source'
);

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE entities ADD COLUMN data_source ENUM(''cms'', ''reapi'', ''zoho'', ''manual'', ''chow_historical'') DEFAULT ''cms'' AFTER entity_status',
    'SELECT ''data_source column already exists'' AS status'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================
-- STEP 2: Create historical entities for unlinked sellers
-- Only create if associate_id doesn't already exist
-- ============================================

INSERT INTO entities (
    entity_name,
    entity_type,
    entity_status,
    data_source,
    company_id,
    cms_associate_id,
    created_at,
    updated_at
)
SELECT DISTINCT
    TRIM(dp.party_name) AS entity_name,
    'other' AS entity_type,
    'historical' AS entity_status,
    'chow_historical' AS data_source,
    NULL AS company_id,
    TRIM(dp.associate_id) AS cms_associate_id,
    NOW(),
    NOW()
FROM deals_parties dp
WHERE dp.party_role = 'seller'
  AND dp.entity_id IS NULL
  AND dp.associate_id IS NOT NULL
  AND TRIM(dp.associate_id) != ''
  -- Don't create duplicates - check by associate_id
  AND NOT EXISTS (
      SELECT 1 FROM entities e
      WHERE e.cms_associate_id = TRIM(dp.associate_id)
  )
GROUP BY TRIM(dp.associate_id), TRIM(dp.party_name);

SELECT 'Historical entities created (with associate_id)' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 3: Link sellers to historical entities
-- ============================================

UPDATE deals_parties dp
JOIN entities e ON e.cms_associate_id = TRIM(dp.associate_id)
    AND e.entity_status = 'historical'
SET dp.entity_id = e.id
WHERE dp.party_role = 'seller'
  AND dp.entity_id IS NULL
  AND dp.associate_id IS NOT NULL
  AND TRIM(dp.associate_id) != '';

SELECT 'Sellers linked to historical entities' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 4: Handle sellers without associate_id (name match only)
-- ============================================

-- Create historical entities for sellers with no associate_id but have names
INSERT INTO entities (
    entity_name,
    entity_type,
    entity_status,
    data_source,
    company_id,
    cms_associate_id,
    created_at,
    updated_at
)
SELECT DISTINCT
    TRIM(dp.party_name) AS entity_name,
    'other' AS entity_type,
    'historical' AS entity_status,
    'chow_historical' AS data_source,
    NULL AS company_id,
    NULL AS cms_associate_id,
    NOW(),
    NOW()
FROM deals_parties dp
WHERE dp.party_role = 'seller'
  AND dp.entity_id IS NULL
  AND (dp.associate_id IS NULL OR TRIM(dp.associate_id) = '')
  AND dp.party_name IS NOT NULL
  AND TRIM(dp.party_name) != ''
  -- Don't create duplicates by name
  AND NOT EXISTS (
      SELECT 1 FROM entities e
      WHERE UPPER(TRIM(e.entity_name)) = UPPER(TRIM(dp.party_name))
        AND e.entity_status = 'historical'
  )
GROUP BY TRIM(dp.party_name);

SELECT 'Historical entities created (no associate_id)' AS status, ROW_COUNT() AS count;

-- Link by name for those without associate_id
UPDATE deals_parties dp
JOIN entities e ON UPPER(TRIM(e.entity_name)) = UPPER(TRIM(dp.party_name))
    AND e.entity_status = 'historical'
SET dp.entity_id = e.id
WHERE dp.party_role = 'seller'
  AND dp.entity_id IS NULL
  AND (dp.associate_id IS NULL OR TRIM(dp.associate_id) = '');

SELECT 'Sellers linked by name' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 5: Update existing current entities with data_source
-- ============================================

UPDATE entities
SET data_source = 'cms'
WHERE entity_status = 'current'
  AND (data_source IS NULL OR data_source = 'cms');

SELECT 'Current entities marked with cms data_source' AS status, ROW_COUNT() AS count;

-- ============================================
-- VALIDATION
-- ============================================

SELECT '=== HISTORICAL ENTITIES COMPLETE ===' AS status;

-- Entity counts by status and source
SELECT
    entity_status,
    data_source,
    COUNT(*) AS entity_count
FROM entities
GROUP BY entity_status, data_source
ORDER BY entity_status, data_source;

-- Updated linkage by role
SELECT
    party_role,
    COUNT(*) AS total,
    SUM(CASE WHEN entity_id IS NOT NULL THEN 1 ELSE 0 END) AS has_entity,
    CONCAT(ROUND(SUM(CASE WHEN entity_id IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1), '%') AS entity_coverage
FROM deals_parties
GROUP BY party_role;

-- Sample historical entity with multiple sales
SELECT 'Top Repeat Sellers (Historical Entities)' AS test;
SELECT
    e.entity_name,
    e.entity_status,
    e.cms_associate_id,
    COUNT(DISTINCT dp.deal_id) AS deals_as_seller
FROM entities e
JOIN deals_parties dp ON dp.entity_id = e.id AND dp.party_role = 'seller'
WHERE e.entity_status = 'historical'
GROUP BY e.id, e.entity_name, e.entity_status, e.cms_associate_id
ORDER BY deals_as_seller DESC
LIMIT 10;

-- Full graph sample with historical seller
SELECT 'Sample CHOW with Complete Graph (Buyer + Seller)' AS test;
SELECT
    d.id AS deal_id,
    pm.facility_name,
    dp.party_role,
    e.entity_name,
    e.entity_status,
    COALESCE(c.company_name, '(no company - historical)') AS company_name
FROM deals d
JOIN property_master pm ON pm.id = d.property_master_id
JOIN deals_parties dp ON dp.deal_id = d.id
JOIN entities e ON e.id = dp.entity_id
LEFT JOIN companies c ON c.id = e.company_id
WHERE d.id IN (
    SELECT d2.id
    FROM deals d2
    JOIN deals_parties dp_buyer ON dp_buyer.deal_id = d2.id AND dp_buyer.party_role = 'buyer'
    JOIN deals_parties dp_seller ON dp_seller.deal_id = d2.id AND dp_seller.party_role = 'seller'
    JOIN entities e_buyer ON e_buyer.id = dp_buyer.entity_id
    JOIN entities e_seller ON e_seller.id = dp_seller.entity_id
    WHERE e_buyer.entity_status = 'current'
      AND e_seller.entity_status = 'historical'
    LIMIT 1
)
ORDER BY dp.party_role DESC;

-- Final totals
SELECT 'Final Table Counts' AS report;
SELECT 'entities (current)' AS table_name, COUNT(*) AS total FROM entities WHERE entity_status = 'current'
UNION ALL
SELECT 'entities (historical)', COUNT(*) FROM entities WHERE entity_status = 'historical'
UNION ALL
SELECT 'entities (total)', COUNT(*) FROM entities
UNION ALL
SELECT 'deals_parties', COUNT(*) FROM deals_parties
UNION ALL
SELECT 'deals_parties (with entity)', COUNT(*) FROM deals_parties WHERE entity_id IS NOT NULL;
