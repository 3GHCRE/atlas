-- 3G Healthcare Real Estate Atlas - Principal Deduplication Infrastructure
-- Creates merge tracking table and procedures for handling duplicate principals
-- Run AFTER 05_phase1b_principals.sql

USE atlas;

-- ============================================
-- STEP 1: Create principal_merges tracking table
-- ============================================
CREATE TABLE IF NOT EXISTS principal_merges (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    canonical_id INT UNSIGNED NOT NULL COMMENT 'The surviving/primary principal record',
    merged_id INT UNSIGNED NOT NULL COMMENT 'The duplicate record being merged',
    merge_reason ENUM(
        'name_match',           -- Exact or fuzzy name match
        'cms_associate_id',     -- Same CMS associate ID
        'zoho_contact',         -- Same Zoho contact ID
        'address_match',        -- Same address + similar name
        'manual'                -- Manual review confirmed duplicate
    ) NOT NULL,
    confidence_score DECIMAL(3,2) DEFAULT 1.00 COMMENT 'Confidence in merge (0.00-1.00)',
    merged_by VARCHAR(100) DEFAULT 'system' COMMENT 'User/process that performed merge',
    merge_notes TEXT COMMENT 'Additional context about the merge',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_merged_id (merged_id),
    INDEX idx_canonical_id (canonical_id),
    INDEX idx_merge_reason (merge_reason),

    CONSTRAINT fk_merge_canonical
        FOREIGN KEY (canonical_id) REFERENCES principals(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_merge_merged
        FOREIGN KEY (merged_id) REFERENCES principals(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STEP 2: Create view for canonical principals
-- Returns all principals with their canonical ID (self if not merged)
-- ============================================
CREATE OR REPLACE VIEW v_canonical_principals AS
SELECT
    p.id AS original_id,
    COALESCE(pm.canonical_id, p.id) AS canonical_id,
    CASE WHEN pm.merged_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_merged,
    p.full_name,
    p.normalized_full_name,
    p.cms_associate_id_owner,
    p.address,
    p.city,
    p.state,
    p.zip
FROM principals p
LEFT JOIN principal_merges pm ON pm.merged_id = p.id;

-- ============================================
-- STEP 3: Create function to get canonical principal ID
-- ============================================
DELIMITER //

CREATE FUNCTION IF NOT EXISTS get_canonical_principal_id(input_principal_id INT UNSIGNED)
RETURNS INT UNSIGNED
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE canonical INT UNSIGNED;

    SELECT COALESCE(pm.canonical_id, input_principal_id)
    INTO canonical
    FROM principals p
    LEFT JOIN principal_merges pm ON pm.merged_id = p.id
    WHERE p.id = input_principal_id;

    RETURN canonical;
END //

DELIMITER ;

-- ============================================
-- STEP 4: Identify potential duplicates
-- ============================================

-- Find principals with same normalized name
SELECT 'Potential duplicates by normalized name' AS report;
SELECT
    normalized_full_name,
    COUNT(*) AS count,
    GROUP_CONCAT(id ORDER BY id) AS principal_ids,
    GROUP_CONCAT(full_name ORDER BY id SEPARATOR ' | ') AS names
FROM principals
WHERE normalized_full_name IS NOT NULL
  AND normalized_full_name != ''
GROUP BY normalized_full_name
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- Find principals with same cms_associate_id_owner
SELECT 'Potential duplicates by CMS associate ID' AS report;
SELECT
    cms_associate_id_owner,
    COUNT(*) AS count,
    GROUP_CONCAT(id ORDER BY id) AS principal_ids,
    GROUP_CONCAT(full_name ORDER BY id SEPARATOR ' | ') AS names
FROM principals
WHERE cms_associate_id_owner IS NOT NULL
  AND cms_associate_id_owner != ''
GROUP BY cms_associate_id_owner
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- ============================================
-- STEP 5: Known duplicates to merge
-- Execute specific merges identified during analysis
-- ============================================

-- Example: EPHRAM LAHASKY merge (from plan)
-- Canonical: ID 5647 (if exists)
-- Merged: ID 76417 "EPHRAM LAHASKY - MORDY" (if exists)

-- First verify these records exist
SELECT 'Verifying Lahasky records' AS report;
SELECT id, full_name, normalized_full_name, cms_associate_id_owner
FROM principals
WHERE full_name LIKE '%LAHASKY%'
   OR normalized_full_name LIKE '%LAHASKY%'
ORDER BY id;

-- The actual merge would be:
-- INSERT INTO principal_merges (canonical_id, merged_id, merge_reason, confidence_score, merge_notes)
-- SELECT 5647, 76417, 'name_match', 0.95, 'EPHRAM LAHASKY and EPHRAM LAHASKY - MORDY are same person'
-- WHERE EXISTS (SELECT 1 FROM principals WHERE id = 5647)
--   AND EXISTS (SELECT 1 FROM principals WHERE id = 76417);

-- ============================================
-- VALIDATION
-- ============================================
SELECT 'Principal merge infrastructure created' AS status;
SELECT COUNT(*) AS total_principals FROM principals;
SELECT COUNT(*) AS merged_principals FROM principal_merges;

-- Show canonical vs total counts
SELECT
    (SELECT COUNT(*) FROM principals) AS total_records,
    (SELECT COUNT(DISTINCT canonical_id) FROM v_canonical_principals) AS unique_individuals,
    (SELECT COUNT(*) FROM principal_merges) AS merged_records;
