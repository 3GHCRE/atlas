-- 3G Healthcare Real Estate Atlas - Match Audit Log
-- Tracks all principal, company, and entity matching operations
-- Run AFTER confidence scoring schema (62_confidence_scoring.sql)

USE atlas;

-- ============================================
-- SECTION 1: Create match_audit_log table
-- ============================================

CREATE TABLE IF NOT EXISTS match_audit_log (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    match_type ENUM('principal', 'company', 'entity') NOT NULL COMMENT 'Type of match operation',
    source_id INT UNSIGNED NOT NULL COMMENT 'ID of the source record being matched',
    target_id INT UNSIGNED NOT NULL COMMENT 'ID of the target record matched to',
    match_strategy VARCHAR(50) NOT NULL COMMENT 'Algorithm/strategy used for matching',
    confidence_score DECIMAL(3,2) NOT NULL COMMENT 'Confidence in the match (0.00-1.00)',
    discovery_source VARCHAR(50) NOT NULL COMMENT 'How match was discovered',
    match_evidence JSON COMMENT 'Evidence supporting the match (names, addresses, etc.)',
    matched_by VARCHAR(100) DEFAULT 'system' COMMENT 'User or script that created the match',
    notes TEXT COMMENT 'Additional notes about the match',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_match_type (match_type),
    INDEX idx_match_type_date (match_type, created_at),
    INDEX idx_source_id (match_type, source_id),
    INDEX idx_target_id (match_type, target_id),
    INDEX idx_match_strategy (match_strategy),
    INDEX idx_confidence (confidence_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SECTION 2: Create quality_metrics_snapshots table
-- ============================================

CREATE TABLE IF NOT EXISTS quality_metrics_snapshots (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    snapshot_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    phase VARCHAR(50) NOT NULL COMMENT 'Phase of enrichment (baseline, phase1, phase2, etc.)',
    metric_name VARCHAR(100) NOT NULL COMMENT 'Name of the metric',
    metric_value DECIMAL(15,2) NOT NULL COMMENT 'Value of the metric',
    metric_details JSON COMMENT 'Additional details about the metric',

    INDEX idx_phase (phase),
    INDEX idx_metric (metric_name),
    INDEX idx_date (snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SECTION 3: Add additional discovery sources
-- ============================================

INSERT IGNORE INTO discovery_sources (code, name, default_confidence, description) VALUES
    ('crm_match', 'CRM to CMS Match', 0.85, 'Matched CRM principal to CMS record'),
    ('name_nickname', 'Name with Nickname', 0.85, 'Matched using nickname variants (e.g., ROBERT->BOB)'),
    ('cms_associate_id', 'CMS Associate ID', 0.98, 'Matched via CMS associate ID'),
    ('consolidated', 'Manual Consolidation', 0.95, 'Consolidated via manual review script'),
    ('unknown', 'Unknown Source', 0.50, 'Source could not be determined');

-- ============================================
-- SECTION 4: Create view for match audit summary
-- ============================================

CREATE OR REPLACE VIEW v_match_audit_summary AS
SELECT
    match_type,
    match_strategy,
    discovery_source,
    COUNT(*) AS match_count,
    ROUND(AVG(confidence_score), 2) AS avg_confidence,
    MIN(created_at) AS first_match,
    MAX(created_at) AS last_match
FROM match_audit_log
GROUP BY match_type, match_strategy, discovery_source
ORDER BY match_type, match_count DESC;

-- ============================================
-- SECTION 5: Create stored procedure for recording metrics
-- ============================================

DROP PROCEDURE IF EXISTS record_quality_metric;

DELIMITER //

CREATE PROCEDURE record_quality_metric(
    IN p_phase VARCHAR(50),
    IN p_metric_name VARCHAR(100),
    IN p_metric_value DECIMAL(15,2),
    IN p_metric_details JSON
)
BEGIN
    INSERT INTO quality_metrics_snapshots (phase, metric_name, metric_value, metric_details)
    VALUES (p_phase, p_metric_name, p_metric_value, p_metric_details);
END //

DELIMITER ;

-- ============================================
-- VALIDATION
-- ============================================

SELECT '=== MATCH AUDIT LOG SCHEMA COMPLETE ===' AS status;

SELECT
    'match_audit_log' AS table_name,
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_audit_log') AS column_count;

SELECT
    'quality_metrics_snapshots' AS table_name,
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quality_metrics_snapshots') AS column_count;

SELECT code, name, default_confidence FROM discovery_sources ORDER BY default_confidence DESC;
