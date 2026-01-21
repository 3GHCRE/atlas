-- 3G Healthcare Real Estate Atlas - Load Rate Source Configuration
-- Loads data from rate_sources.csv (24 state Medicaid programs)
-- NOTE: Run this after 20_medicaid_rates_schema.sql

USE atlas;

-- ============================================
-- LOAD RATE SOURCE CONFIGURATION FROM CSV
-- Path assumes Docker volume mount: ../:/data
-- So CSV at: /data/data/medicaid_rates/rate_sources.csv
-- ============================================

-- Clear existing data for clean reload
TRUNCATE TABLE medicaid_rate_sources;

-- Load the CSV with proper field mapping
LOAD DATA LOCAL INFILE '/data/data/medicaid_rates/rate_sources.csv'
INTO TABLE medicaid_rate_sources
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
(
    state,
    @update_freq,
    base_url,
    source_url,
    @requires_user,
    regex_pattern,
    @file_type,
    google_drive_folder_id,
    @state_rules,
    notes,
    @compiled_on
)
SET
    update_frequency = CASE
        WHEN @update_freq = 'Annually' THEN 'Annually'
        WHEN @update_freq = 'Quarterly' THEN 'Quarterly'
        WHEN @update_freq = 'Biannually' THEN 'Biannually'
        WHEN @update_freq = 'Monthly' THEN 'Monthly'
        ELSE 'Annually'
    END,
    requires_user_auth = IF(@requires_user = 'TRUE', TRUE, FALSE),
    file_type = CASE
        WHEN @file_type = 'xlsx' THEN 'xlsx'
        WHEN @file_type = 'pdf' THEN 'pdf'
        WHEN @file_type = 'csv' THEN 'csv'
        WHEN @file_type = 'html' THEN 'html'
        ELSE 'xlsx'
    END,
    is_active = IF(state IS NOT NULL AND TRIM(state) != '', TRUE, FALSE);

-- Remove any rows that had empty state codes (trailing blank rows in CSV)
DELETE FROM medicaid_rate_sources WHERE state IS NULL OR TRIM(state) = '';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check total loaded (should be ~24 active states)
SELECT
    COUNT(*) as total_sources,
    SUM(is_active) as active_sources,
    SUM(requires_user_auth) as manual_download_required
FROM medicaid_rate_sources;

-- Show loaded data by update frequency
SELECT
    update_frequency,
    COUNT(*) as state_count,
    GROUP_CONCAT(state ORDER BY state) as states
FROM medicaid_rate_sources
WHERE is_active = TRUE
GROUP BY update_frequency
ORDER BY FIELD(update_frequency, 'Quarterly', 'Biannually', 'Annually', 'Monthly');

-- States requiring manual download (5 expected: FL, KY, IA, NY, CA)
SELECT state, base_url, notes
FROM medicaid_rate_sources
WHERE requires_user_auth = TRUE
ORDER BY state;

-- States with compiled data available (9 states)
-- These match the Excel files in data/medicaid_rates/compiled/Compiled NF Rates/
SELECT state, file_type, source_url
FROM medicaid_rate_sources
WHERE state IN ('FL', 'GA', 'IL', 'IN', 'MS', 'NY', 'OH', 'PA', 'VA')
ORDER BY state;
