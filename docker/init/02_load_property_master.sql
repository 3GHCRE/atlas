-- Load property_master from CMS Enrollments Staging Table
-- Phase 1A: Day 1 - CMS Data Load
--
-- FIXED: Previous version used GROUP BY + HAVING COUNT(*) = 1 which
-- excluded ALL duplicate CCNs entirely. This version uses ROW_NUMBER()
-- to keep the first occurrence of each CCN.

USE atlas;

-- Clear existing data (for re-runs)
TRUNCATE TABLE property_master;

-- Load from staging table using ROW_NUMBER for proper deduplication
INSERT INTO property_master (
    ccn,
    facility_name,
    address,
    city,
    state,
    zip,
    last_synced_from_cms,
    data_quality_score
)
SELECT
    ccn,
    facility_name,
    address,
    city,
    state,
    zip,
    NOW() as last_synced_from_cms,
    0.33 as data_quality_score  -- Has CCN only (1/3 of total score)
FROM (
    SELECT
        TRIM(ccn) as ccn,
        TRIM(COALESCE(nursing_home_provider_name, organization_name, '')) as facility_name,
        TRIM(CONCAT_WS(' ',
            COALESCE(address_line_1, ''),
            COALESCE(address_line_2, '')
        )) as address,
        TRIM(city) as city,
        UPPER(SUBSTRING(TRIM(COALESCE(state, '')), 1, 2)) as state,
        SUBSTRING(REPLACE(TRIM(COALESCE(zip_code, '')), '-', ''), 1, 5) as zip,
        ROW_NUMBER() OVER (PARTITION BY TRIM(ccn) ORDER BY enrollment_id) as rn
    FROM cms_enrollments_staging
    WHERE ccn IS NOT NULL
      AND TRIM(ccn) != ''
      AND TRIM(COALESCE(nursing_home_provider_name, organization_name, '')) != ''
      AND provider_type_code = '00-18'  -- Skilled Nursing Facility only
) ranked
WHERE rn = 1
ORDER BY ccn;

-- Show results
SELECT COUNT(*) as properties_loaded FROM property_master;
