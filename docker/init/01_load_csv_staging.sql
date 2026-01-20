-- 3G Healthcare Real Estate Atlas - CSV Import Script
-- Phase 1A: Load CMS Enrollments CSV into staging table

USE atlas;

-- Clear any existing staging data
TRUNCATE TABLE cms_enrollments_staging;

-- Load CSV into staging table
-- CSV is mounted at /data/ via docker-compose volume mapping
LOAD DATA INFILE '/data/SNF_Enrollments_2025.12.02.csv'
INTO TABLE cms_enrollments_staging
CHARACTER SET latin1
FIELDS TERMINATED BY ','
OPTIONALLY ENCLOSED BY '"'
LINES TERMINATED BY '\r\n'
IGNORE 1 ROWS
(
    enrollment_id,
    enrollment_state,
    provider_type_code,
    provider_type_text,
    npi,
    multiple_npi_flag,
    ccn,
    associate_id,
    organization_name,
    doing_business_as_name,
    incorporation_date,
    incorporation_state,
    organization_type_structure,
    organization_other_type_text,
    proprietary_nonprofit,
    nursing_home_provider_name,
    affiliation_entity_name,
    affiliation_entity_id,
    address_line_1,
    address_line_2,
    city,
    state,
    zip_code
);

-- Quick validation: show row count
SELECT COUNT(*) as rows_imported FROM cms_enrollments_staging;
SELECT COUNT(DISTINCT ccn) as unique_ccns FROM cms_enrollments_staging WHERE ccn IS NOT NULL AND TRIM(ccn) != '';
