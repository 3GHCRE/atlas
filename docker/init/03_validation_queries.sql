-- Validation Queries for property_master
-- Phase 1A: Complete validation suite for CMS data load
-- Run these after loading data to verify success

USE atlas;

-- ============================================
-- STAGING TABLE CHECKS (Run after CSV import)
-- ============================================

-- Staging Query 1: Total Row Count
SELECT 'STAGING: Total Rows' as check_name, COUNT(*) as value FROM cms_enrollments_staging;
-- Expected: 14,437

-- Staging Query 2: Unique CCNs vs Total
SELECT
    'STAGING: CCN Analysis' as check_name,
    COUNT(DISTINCT ccn) as unique_ccns,
    COUNT(*) as total_with_ccn,
    COUNT(*) - COUNT(DISTINCT ccn) as duplicate_rows
FROM cms_enrollments_staging
WHERE ccn IS NOT NULL AND TRIM(ccn) != '';

-- Staging Query 3: Show duplicates (top 10)
SELECT 'STAGING: Duplicate CCNs' as check_name;
SELECT ccn, COUNT(*) as occurrences
FROM cms_enrollments_staging
WHERE ccn IS NOT NULL AND TRIM(ccn) != ''
GROUP BY ccn
HAVING COUNT(*) > 1
ORDER BY occurrences DESC
LIMIT 10;

-- Staging Query 4: SNF-only filter check
SELECT
    'STAGING: Provider Type Distribution' as check_name,
    provider_type_code,
    COUNT(*) as count
FROM cms_enrollments_staging
GROUP BY provider_type_code
ORDER BY count DESC
LIMIT 5;

-- ============================================
-- PROPERTY_MASTER CHECKS (Run after load)
-- ============================================

-- PM Query 1: Row Count & Uniqueness
SELECT
    'PM: Row Count & Uniqueness' as check_name,
    COUNT(*) as total_properties,
    COUNT(DISTINCT ccn) as unique_ccns,
    COUNT(*) - COUNT(DISTINCT ccn) as duplicate_ccn_count
FROM property_master;
-- Expected: ~14,400, 0 duplicates

-- PM Query 2: Data Completeness
SELECT
    'PM: Data Completeness' as check_name,
    COUNT(*) as total,
    COUNT(ccn) as has_ccn,
    COUNT(facility_name) as has_name,
    COUNT(NULLIF(address, '')) as has_address,
    COUNT(NULLIF(city, '')) as has_city,
    COUNT(NULLIF(state, '')) as has_state,
    COUNT(NULLIF(zip, '')) as has_zip,
    COUNT(reapi_property_id) as has_reapi_id,
    COUNT(zoho_account_id) as has_zoho_id
FROM property_master;
-- Expected: reapi_id and zoho_id should be 0

-- PM Query 3: Quality Score Distribution
SELECT
    'PM: Quality Score Distribution' as check_name,
    data_quality_score,
    COUNT(*) as count
FROM property_master
GROUP BY data_quality_score
ORDER BY data_quality_score DESC;
-- Expected: All should be 0.33

-- PM Query 4: State Distribution (Top 10)
SELECT 'PM: Top 10 States' as check_name;
SELECT
    state,
    COUNT(*) as facility_count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM property_master), 2) as percentage
FROM property_master
WHERE state IS NOT NULL AND state != ''
GROUP BY state
ORDER BY facility_count DESC
LIMIT 10;
-- Expected: TX, CA, FL, OH should be in top 5

-- PM Query 5: Invalid State Codes
SELECT 'PM: Invalid State Codes' as check_name;
SELECT state, COUNT(*) as count
FROM property_master
WHERE state IS NOT NULL AND LENGTH(state) != 2
GROUP BY state;
-- Expected: 0 rows

-- PM Query 6: Invalid ZIP Codes
SELECT 'PM: Invalid ZIP Codes' as check_name;
SELECT zip, COUNT(*) as count
FROM property_master
WHERE zip IS NOT NULL
  AND (LENGTH(zip) < 5 OR zip NOT REGEXP '^[0-9]+$')
GROUP BY zip
LIMIT 10;
-- Expected: Minimal or 0 rows

-- PM Query 7: Sample Records
SELECT 'PM: Sample Records' as check_name;
SELECT
    ccn,
    facility_name,
    city,
    state,
    zip,
    data_quality_score,
    last_synced_from_cms
FROM property_master
ORDER BY ccn
LIMIT 5;

-- ============================================
-- RECONCILIATION CHECK
-- ============================================

SELECT
    'RECONCILIATION' as check_name,
    staging.staging_ccns,
    staging.snf_only_ccns,
    master.master_count,
    staging.snf_only_ccns - master.master_count as difference
FROM (
    SELECT
        COUNT(DISTINCT ccn) as staging_ccns,
        (SELECT COUNT(DISTINCT ccn)
         FROM cms_enrollments_staging
         WHERE provider_type_code = '00-18'
           AND ccn IS NOT NULL
           AND TRIM(ccn) != ''
           AND TRIM(COALESCE(nursing_home_provider_name, organization_name, '')) != ''
        ) as snf_only_ccns
    FROM cms_enrollments_staging
    WHERE ccn IS NOT NULL AND TRIM(ccn) != ''
) staging
CROSS JOIN (
    SELECT COUNT(*) as master_count FROM property_master
) master;
-- Expected: difference should be 0 (all eligible CCNs loaded)

-- ============================================
-- FINAL SUCCESS CHECK
-- ============================================

SELECT
    'FINAL VALIDATION' as check_name,
    CASE
        WHEN COUNT(*) >= 14000
             AND COUNT(*) = COUNT(DISTINCT ccn)
             AND AVG(data_quality_score) = 0.33
             AND COUNT(reapi_property_id) = 0
             AND COUNT(zoho_account_id) = 0
        THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    COUNT(*) as total_properties,
    COUNT(DISTINCT ccn) as unique_ccns,
    ROUND(AVG(data_quality_score), 2) as avg_quality_score,
    COUNT(reapi_property_id) as with_reapi,
    COUNT(zoho_account_id) as with_zoho
FROM property_master;
-- Expected: PASS, ~14400, ~14400, 0.33, 0, 0
