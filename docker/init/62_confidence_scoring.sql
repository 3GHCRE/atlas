-- 3G Healthcare Real Estate Atlas - Confidence-Scored Relationships
-- Adds confidence scoring and discovery source tracking to relationship tables
-- Run AFTER base schema is established

USE atlas;

-- ============================================
-- SECTION 1: Add confidence scoring columns to property_entity_relationships
-- ============================================

-- Check if columns exist before adding (idempotent)
SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'property_entity_relationships'
    AND COLUMN_NAME = 'confidence_score'
);

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE property_entity_relationships
     ADD COLUMN confidence_score DECIMAL(3,2) DEFAULT 1.00 COMMENT "Confidence in relationship (0.00-1.00)",
     ADD COLUMN discovery_source VARCHAR(50) DEFAULT NULL COMMENT "How this relationship was discovered"',
    'SELECT "confidence_score column already exists in property_entity_relationships" AS status'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for filtering by confidence
CREATE INDEX IF NOT EXISTS idx_per_confidence ON property_entity_relationships(confidence_score);

-- ============================================
-- SECTION 2: Add confidence scoring to principal_entity_relationships
-- ============================================

SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'principal_entity_relationships'
    AND COLUMN_NAME = 'confidence_score'
);

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE principal_entity_relationships
     ADD COLUMN confidence_score DECIMAL(3,2) DEFAULT 1.00 COMMENT "Confidence in relationship (0.00-1.00)",
     ADD COLUMN discovery_source VARCHAR(50) DEFAULT NULL COMMENT "How this relationship was discovered"',
    'SELECT "confidence_score column already exists in principal_entity_relationships" AS status'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE INDEX IF NOT EXISTS idx_pner_confidence ON principal_entity_relationships(confidence_score);

-- ============================================
-- SECTION 3: Add confidence scoring to principal_company_relationships
-- ============================================

SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'principal_company_relationships'
    AND COLUMN_NAME = 'confidence_score'
);

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE principal_company_relationships
     ADD COLUMN confidence_score DECIMAL(3,2) DEFAULT 1.00 COMMENT "Confidence in relationship (0.00-1.00)",
     ADD COLUMN discovery_source VARCHAR(50) DEFAULT NULL COMMENT "How this relationship was discovered"',
    'SELECT "confidence_score column already exists in principal_company_relationships" AS status'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE INDEX IF NOT EXISTS idx_pcr_confidence ON principal_company_relationships(confidence_score);

-- ============================================
-- SECTION 4: Create discovery_sources reference table
-- ============================================

CREATE TABLE IF NOT EXISTS discovery_sources (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    default_confidence DECIMAL(3,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert standard discovery sources with confidence levels
INSERT IGNORE INTO discovery_sources (code, name, default_confidence, description) VALUES
    ('cms_enrollment', 'CMS Enrollment Data', 1.00, 'Direct from CMS enrollment records - highest reliability'),
    ('acris', 'ACRIS Document', 0.95, 'NYC ACRIS deed/mortgage records - very high reliability'),
    ('sos_filing', 'Secretary of State Filing', 0.90, 'State SOS corporate filings - high reliability'),
    ('co_parsing', 'C/O Address Parsing', 0.85, 'Care-of address parsing from documents'),
    ('reapi', 'REAPI Data', 0.90, 'Real Estate API provider data'),
    ('address_match', 'Address Matching', 0.75, 'Matched by address similarity algorithm'),
    ('name_match', 'Name Matching', 0.70, 'Matched by name similarity algorithm'),
    ('web_enrichment', 'Web Enrichment', 0.70, 'Data from web scraping/enrichment'),
    ('zoho', 'Zoho CRM', 0.85, 'Data from Zoho CRM system'),
    ('manual', 'Manual Entry', 0.95, 'Manually verified/entered data');

-- ============================================
-- SECTION 5: Update existing records with default confidence
-- Based on data_source field where available
-- ============================================

-- Update property_entity_relationships
UPDATE property_entity_relationships per
LEFT JOIN discovery_sources ds ON per.data_source = ds.code
SET
    per.confidence_score = COALESCE(ds.default_confidence, 1.00),
    per.discovery_source = per.data_source
WHERE per.confidence_score IS NULL OR per.discovery_source IS NULL;

-- Update principal_entity_relationships
UPDATE principal_entity_relationships pner
LEFT JOIN discovery_sources ds ON pner.data_source = ds.code
SET
    pner.confidence_score = COALESCE(ds.default_confidence, 1.00),
    pner.discovery_source = pner.data_source
WHERE pner.confidence_score IS NULL OR pner.discovery_source IS NULL;

-- Update principal_company_relationships
UPDATE principal_company_relationships pcr
LEFT JOIN discovery_sources ds ON pcr.data_source = ds.code
SET
    pcr.confidence_score = COALESCE(ds.default_confidence, 1.00),
    pcr.discovery_source = pcr.data_source
WHERE pcr.confidence_score IS NULL OR pcr.discovery_source IS NULL;

-- ============================================
-- SECTION 6: Create view for relationship confidence summary
-- ============================================

CREATE OR REPLACE VIEW v_relationship_confidence_summary AS
SELECT
    'property_entity' AS relationship_type,
    COUNT(*) AS total_relationships,
    ROUND(AVG(confidence_score), 2) AS avg_confidence,
    SUM(CASE WHEN confidence_score >= 0.90 THEN 1 ELSE 0 END) AS high_confidence,
    SUM(CASE WHEN confidence_score >= 0.70 AND confidence_score < 0.90 THEN 1 ELSE 0 END) AS medium_confidence,
    SUM(CASE WHEN confidence_score < 0.70 THEN 1 ELSE 0 END) AS low_confidence
FROM property_entity_relationships

UNION ALL

SELECT
    'principal_entity' AS relationship_type,
    COUNT(*) AS total_relationships,
    ROUND(AVG(confidence_score), 2) AS avg_confidence,
    SUM(CASE WHEN confidence_score >= 0.90 THEN 1 ELSE 0 END) AS high_confidence,
    SUM(CASE WHEN confidence_score >= 0.70 AND confidence_score < 0.90 THEN 1 ELSE 0 END) AS medium_confidence,
    SUM(CASE WHEN confidence_score < 0.70 THEN 1 ELSE 0 END) AS low_confidence
FROM principal_entity_relationships

UNION ALL

SELECT
    'principal_company' AS relationship_type,
    COUNT(*) AS total_relationships,
    ROUND(AVG(confidence_score), 2) AS avg_confidence,
    SUM(CASE WHEN confidence_score >= 0.90 THEN 1 ELSE 0 END) AS high_confidence,
    SUM(CASE WHEN confidence_score >= 0.70 AND confidence_score < 0.90 THEN 1 ELSE 0 END) AS medium_confidence,
    SUM(CASE WHEN confidence_score < 0.70 THEN 1 ELSE 0 END) AS low_confidence
FROM principal_company_relationships;

-- ============================================
-- VALIDATION
-- ============================================
SELECT '=== CONFIDENCE SCORING SCHEMA COMPLETE ===' AS status;

SELECT * FROM v_relationship_confidence_summary;

SELECT
    discovery_source,
    COUNT(*) AS count,
    ROUND(AVG(confidence_score), 2) AS avg_confidence
FROM property_entity_relationships
WHERE discovery_source IS NOT NULL
GROUP BY discovery_source
ORDER BY count DESC;
