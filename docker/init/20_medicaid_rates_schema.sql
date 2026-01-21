-- 3G Healthcare Real Estate Atlas - Medicaid Rates Schema
-- Phase: Medicaid Rate Integration
-- Purpose: Store facility-level Medicaid reimbursement rates linked to 14,054 nursing facilities

USE atlas;

-- ============================================
-- TABLE 1: Rate Source Configuration
-- Stores metadata from NF Medicaid Rates - Master - publicly_available.csv
-- Tracks 24 state Medicaid programs and collection requirements
-- ============================================

CREATE TABLE IF NOT EXISTS medicaid_rate_sources (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    state CHAR(2) NOT NULL UNIQUE COMMENT 'State code (FL, GA, etc.)',
    update_frequency ENUM('Annually', 'Quarterly', 'Biannually', 'Monthly') NOT NULL,
    base_url VARCHAR(500) COMMENT 'Agency website base URL',
    source_url VARCHAR(500) COMMENT 'Direct URL to rates page',
    requires_user_auth BOOLEAN DEFAULT FALSE COMMENT 'Requires login/manual download',
    file_type ENUM('xlsx', 'pdf', 'csv', 'html') DEFAULT 'xlsx',
    regex_pattern VARCHAR(500) COMMENT 'Pattern to identify rate files',
    google_drive_folder_id VARCHAR(100) COMMENT 'Storage folder ID',
    notes TEXT COMMENT 'Collection instructions and lookfor patterns',
    last_collected_at TIMESTAMP NULL COMMENT 'Last successful collection',
    last_rate_effective_date DATE NULL COMMENT 'Most recent rate period',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_state (state),
    INDEX idx_update_freq (update_frequency),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- TABLE 2: Medicaid Rates (Facility-Level)
-- Stores actual $/day rates per facility with temporal tracking
-- Links to property_master via CCN or name matching
-- ============================================

CREATE TABLE IF NOT EXISTS medicaid_rates (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NULL COMMENT 'FK to property_master (matched by CCN/name)',

    -- Facility identification
    state CHAR(2) NOT NULL COMMENT 'State code',
    facility_name VARCHAR(500) NOT NULL COMMENT 'Facility name from rate file',
    state_facility_id VARCHAR(50) NULL COMMENT 'State-specific ID (e.g., Medicaid provider #)',
    ccn VARCHAR(10) NULL COMMENT 'CMS Certification Number if matched',

    -- Rate details
    daily_rate DECIMAL(10, 2) NOT NULL COMMENT 'Medicaid daily rate ($/day)',
    rate_type ENUM('base', 'enhanced', 'total', 'case_mix', 'other') DEFAULT 'total',
    rate_component VARCHAR(100) NULL COMMENT 'Rate component name if broken out',

    -- Temporal
    effective_date DATE NOT NULL COMMENT 'When rate became effective',
    end_date DATE NULL COMMENT 'NULL = current rate',
    rate_period VARCHAR(20) NULL COMMENT 'e.g., Q1-2025, FY2025',

    -- Metadata
    data_source VARCHAR(100) DEFAULT 'state_medicaid' COMMENT 'Source identifier',
    source_file VARCHAR(255) NULL COMMENT 'Original filename',
    collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified BOOLEAN DEFAULT FALSE,
    notes TEXT,

    -- Indexes for common queries
    INDEX idx_property (property_master_id),
    INDEX idx_state (state),
    INDEX idx_ccn (ccn),
    INDEX idx_facility_name (facility_name(100)),
    INDEX idx_effective_date (effective_date),
    INDEX idx_state_date (state, effective_date),
    INDEX idx_current (state, end_date),

    -- Foreign key to property_master
    CONSTRAINT fk_mr_property
        FOREIGN KEY (property_master_id) REFERENCES property_master(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- TABLE 3: Rate Collection Log
-- Tracks scraping/collection attempts for automation monitoring
-- ============================================

CREATE TABLE IF NOT EXISTS medicaid_rate_collection_log (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rate_source_id INT UNSIGNED NOT NULL,
    collection_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('success', 'failed', 'partial', 'pending') NOT NULL,
    files_found INT UNSIGNED DEFAULT 0,
    records_loaded INT UNSIGNED DEFAULT 0,
    error_message TEXT NULL,

    INDEX idx_source (rate_source_id),
    INDEX idx_date (collection_date),
    INDEX idx_status (status),

    CONSTRAINT fk_rcl_source
        FOREIGN KEY (rate_source_id) REFERENCES medicaid_rate_sources(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- USEFUL VIEWS
-- ============================================

-- View: Current rates per facility (latest effective, no end date)
CREATE OR REPLACE VIEW v_current_medicaid_rates AS
SELECT
    mr.id,
    mr.state,
    mr.facility_name,
    mr.ccn,
    mr.daily_rate,
    mr.rate_type,
    mr.effective_date,
    mr.property_master_id,
    pm.facility_name AS matched_facility_name,
    pm.city,
    pm.zip
FROM medicaid_rates mr
LEFT JOIN property_master pm ON mr.property_master_id = pm.id
WHERE mr.end_date IS NULL;

-- View: Rate statistics by state
CREATE OR REPLACE VIEW v_medicaid_rate_stats AS
SELECT
    state,
    COUNT(*) AS total_rates,
    COUNT(property_master_id) AS matched_facilities,
    ROUND(COUNT(property_master_id) * 100.0 / COUNT(*), 1) AS match_pct,
    ROUND(AVG(daily_rate), 2) AS avg_rate,
    MIN(daily_rate) AS min_rate,
    MAX(daily_rate) AS max_rate,
    MIN(effective_date) AS earliest_date,
    MAX(effective_date) AS latest_date
FROM medicaid_rates
WHERE end_date IS NULL
GROUP BY state;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- After schema creation, run these to verify:
-- SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'atlas' AND table_name LIKE 'medicaid%';
-- SHOW CREATE TABLE medicaid_rate_sources;
-- SHOW CREATE TABLE medicaid_rates;
-- SHOW CREATE TABLE medicaid_rate_collection_log;
