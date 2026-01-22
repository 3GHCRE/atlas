-- 3G Healthcare Real Estate Atlas - Load CMS Provider Info
-- Source: https://data.cms.gov/provider-data/dataset/4pq5-n9py
-- Downloaded: January 2026

USE atlas;

-- ============================================
-- STEP 1: Create temp staging table with exact CSV columns
-- ============================================

DROP TABLE IF EXISTS tmp_provider_info;
CREATE TABLE tmp_provider_info (
    ccn VARCHAR(20),
    provider_name VARCHAR(500),
    provider_address VARCHAR(500),
    city VARCHAR(100),
    state VARCHAR(10),
    zip_code VARCHAR(20),
    telephone VARCHAR(50),
    ssa_county_code VARCHAR(10),
    county VARCHAR(100),
    urban VARCHAR(10),
    ownership_type VARCHAR(100),
    certified_beds INT,
    avg_residents_per_day DECIMAL(10,2),
    avg_residents_footnote VARCHAR(100),
    provider_type VARCHAR(100),
    in_hospital VARCHAR(10),
    legal_business_name VARCHAR(500),
    date_first_approved DATE,
    chain_name VARCHAR(255),
    chain_id VARCHAR(50),
    num_facilities_in_chain INT,
    chain_avg_overall_rating DECIMAL(3,1),
    chain_avg_health_rating DECIMAL(3,1),
    chain_avg_staffing_rating DECIMAL(3,1),
    chain_avg_qm_rating DECIMAL(3,1),
    ccrc VARCHAR(10),
    special_focus_status VARCHAR(100),
    abuse_icon VARCHAR(10),
    health_inspection_over_2yrs VARCHAR(10),
    ownership_change_12mo VARCHAR(10),
    resident_family_council VARCHAR(100),
    sprinkler_systems VARCHAR(50),
    overall_rating INT,
    overall_rating_footnote VARCHAR(50),
    health_inspection_rating INT,
    health_inspection_footnote VARCHAR(50),
    qm_rating INT,
    qm_rating_footnote VARCHAR(50),
    long_stay_qm_rating INT,
    long_stay_qm_footnote VARCHAR(50),
    short_stay_qm_rating INT,
    short_stay_qm_footnote VARCHAR(50),
    staffing_rating INT,
    staffing_rating_footnote VARCHAR(50),
    reported_staffing_footnote VARCHAR(100),
    pt_staffing_footnote VARCHAR(100),
    reported_cna_hprd DECIMAL(10,5),
    reported_lpn_hprd DECIMAL(10,5),
    reported_rn_hprd DECIMAL(10,5),
    reported_licensed_hprd DECIMAL(10,5),
    reported_total_nurse_hprd DECIMAL(10,5),
    weekend_total_nurse_hprd DECIMAL(10,5),
    weekend_rn_hprd DECIMAL(10,5),
    reported_pt_hprd DECIMAL(10,5),
    total_nurse_turnover DECIMAL(10,2),
    total_nurse_turnover_footnote VARCHAR(100),
    rn_turnover DECIMAL(10,2),
    rn_turnover_footnote VARCHAR(100),
    num_admin_left INT,
    admin_turnover_footnote VARCHAR(100),
    nursing_case_mix_index DECIMAL(10,5),
    nursing_case_mix_ratio DECIMAL(10,5),
    case_mix_cna_hprd DECIMAL(10,5),
    case_mix_lpn_hprd DECIMAL(10,5),
    case_mix_rn_hprd DECIMAL(10,5),
    case_mix_total_nurse_hprd DECIMAL(10,5),
    case_mix_weekend_total_hprd DECIMAL(10,5),
    adjusted_cna_hprd DECIMAL(10,5),
    adjusted_lpn_hprd DECIMAL(10,5),
    adjusted_rn_hprd DECIMAL(10,5),
    adjusted_total_nurse_hprd DECIMAL(10,5),
    adjusted_weekend_total_hprd DECIMAL(10,5),
    cycle1_survey_date DATE,
    cycle1_total_deficiencies INT,
    cycle1_standard_deficiencies INT,
    cycle1_complaint_deficiencies INT,
    cycle1_deficiency_score INT,
    cycle1_revisits INT,
    cycle1_revisit_score INT,
    cycle1_total_score INT,
    cycle2_survey_date DATE,
    cycle2_total_deficiencies INT,
    cycle2_standard_deficiencies INT,
    cycle2_complaint_deficiencies INT,
    cycle2_deficiency_score INT,
    cycle2_revisits INT,
    cycle2_revisit_score INT,
    cycle2_total_score INT,
    total_weighted_health_score DECIMAL(10,3),
    num_facility_reported_incidents INT,
    num_substantiated_complaints INT,
    num_infection_control_citations INT,
    num_fines INT,
    total_fines_dollars DECIMAL(15,2),
    num_payment_denials INT,
    total_penalties INT,
    location_full VARCHAR(500),
    latitude DECIMAL(12,8),
    longitude DECIMAL(12,8),
    geocoding_footnote VARCHAR(100),
    processing_date DATE,

    INDEX idx_ccn (ccn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STEP 2: Load CSV into temp table
-- ============================================

LOAD DATA INFILE '/data/NH_ProviderInfo_Jan2026.csv'
INTO TABLE tmp_provider_info
CHARACTER SET utf8mb4
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
(ccn, provider_name, provider_address, city, state, zip_code, telephone,
 ssa_county_code, county, urban, ownership_type,
 @certified_beds, @avg_residents_per_day, avg_residents_footnote,
 provider_type, in_hospital, legal_business_name, @date_first_approved,
 chain_name, chain_id, @num_facilities_in_chain,
 @chain_avg_overall_rating, @chain_avg_health_rating, @chain_avg_staffing_rating, @chain_avg_qm_rating,
 ccrc, special_focus_status, abuse_icon, health_inspection_over_2yrs,
 ownership_change_12mo, resident_family_council, sprinkler_systems,
 @overall_rating, overall_rating_footnote,
 @health_inspection_rating, health_inspection_footnote,
 @qm_rating, qm_rating_footnote,
 @long_stay_qm_rating, long_stay_qm_footnote,
 @short_stay_qm_rating, short_stay_qm_footnote,
 @staffing_rating, staffing_rating_footnote,
 reported_staffing_footnote, pt_staffing_footnote,
 @reported_cna_hprd, @reported_lpn_hprd, @reported_rn_hprd,
 @reported_licensed_hprd, @reported_total_nurse_hprd,
 @weekend_total_nurse_hprd, @weekend_rn_hprd, @reported_pt_hprd,
 @total_nurse_turnover, total_nurse_turnover_footnote,
 @rn_turnover, rn_turnover_footnote,
 @num_admin_left, admin_turnover_footnote,
 @nursing_case_mix_index, @nursing_case_mix_ratio,
 @case_mix_cna_hprd, @case_mix_lpn_hprd, @case_mix_rn_hprd,
 @case_mix_total_nurse_hprd, @case_mix_weekend_total_hprd,
 @adjusted_cna_hprd, @adjusted_lpn_hprd, @adjusted_rn_hprd,
 @adjusted_total_nurse_hprd, @adjusted_weekend_total_hprd,
 @cycle1_survey_date, @cycle1_total_deficiencies, @cycle1_standard_deficiencies,
 @cycle1_complaint_deficiencies, @cycle1_deficiency_score, @cycle1_revisits,
 @cycle1_revisit_score, @cycle1_total_score,
 @cycle2_survey_date, @cycle2_total_deficiencies, @cycle2_standard_deficiencies,
 @cycle2_complaint_deficiencies, @cycle2_deficiency_score, @cycle2_revisits,
 @cycle2_revisit_score, @cycle2_total_score,
 @total_weighted_health_score, @num_facility_reported_incidents,
 @num_substantiated_complaints, @num_infection_control_citations,
 @num_fines, @total_fines_dollars, @num_payment_denials, @total_penalties,
 location_full, @latitude, @longitude, geocoding_footnote, @processing_date)
SET
    certified_beds = NULLIF(@certified_beds, ''),
    avg_residents_per_day = NULLIF(@avg_residents_per_day, ''),
    date_first_approved = NULLIF(@date_first_approved, ''),
    num_facilities_in_chain = NULLIF(@num_facilities_in_chain, ''),
    chain_avg_overall_rating = NULLIF(@chain_avg_overall_rating, ''),
    chain_avg_health_rating = NULLIF(@chain_avg_health_rating, ''),
    chain_avg_staffing_rating = NULLIF(@chain_avg_staffing_rating, ''),
    chain_avg_qm_rating = NULLIF(@chain_avg_qm_rating, ''),
    overall_rating = NULLIF(@overall_rating, ''),
    health_inspection_rating = NULLIF(@health_inspection_rating, ''),
    qm_rating = NULLIF(@qm_rating, ''),
    long_stay_qm_rating = NULLIF(@long_stay_qm_rating, ''),
    short_stay_qm_rating = NULLIF(@short_stay_qm_rating, ''),
    staffing_rating = NULLIF(@staffing_rating, ''),
    reported_cna_hprd = NULLIF(@reported_cna_hprd, ''),
    reported_lpn_hprd = NULLIF(@reported_lpn_hprd, ''),
    reported_rn_hprd = NULLIF(@reported_rn_hprd, ''),
    reported_licensed_hprd = NULLIF(@reported_licensed_hprd, ''),
    reported_total_nurse_hprd = NULLIF(@reported_total_nurse_hprd, ''),
    weekend_total_nurse_hprd = NULLIF(@weekend_total_nurse_hprd, ''),
    weekend_rn_hprd = NULLIF(@weekend_rn_hprd, ''),
    reported_pt_hprd = NULLIF(@reported_pt_hprd, ''),
    total_nurse_turnover = NULLIF(@total_nurse_turnover, ''),
    rn_turnover = NULLIF(@rn_turnover, ''),
    num_admin_left = NULLIF(@num_admin_left, ''),
    nursing_case_mix_index = NULLIF(@nursing_case_mix_index, ''),
    nursing_case_mix_ratio = NULLIF(@nursing_case_mix_ratio, ''),
    case_mix_cna_hprd = NULLIF(@case_mix_cna_hprd, ''),
    case_mix_lpn_hprd = NULLIF(@case_mix_lpn_hprd, ''),
    case_mix_rn_hprd = NULLIF(@case_mix_rn_hprd, ''),
    case_mix_total_nurse_hprd = NULLIF(@case_mix_total_nurse_hprd, ''),
    case_mix_weekend_total_hprd = NULLIF(@case_mix_weekend_total_hprd, ''),
    adjusted_cna_hprd = NULLIF(@adjusted_cna_hprd, ''),
    adjusted_lpn_hprd = NULLIF(@adjusted_lpn_hprd, ''),
    adjusted_rn_hprd = NULLIF(@adjusted_rn_hprd, ''),
    adjusted_total_nurse_hprd = NULLIF(@adjusted_total_nurse_hprd, ''),
    adjusted_weekend_total_hprd = NULLIF(@adjusted_weekend_total_hprd, ''),
    cycle1_survey_date = NULLIF(@cycle1_survey_date, ''),
    cycle1_total_deficiencies = NULLIF(@cycle1_total_deficiencies, ''),
    cycle1_standard_deficiencies = NULLIF(@cycle1_standard_deficiencies, ''),
    cycle1_complaint_deficiencies = NULLIF(@cycle1_complaint_deficiencies, ''),
    cycle1_deficiency_score = NULLIF(@cycle1_deficiency_score, ''),
    cycle1_revisits = NULLIF(@cycle1_revisits, ''),
    cycle1_revisit_score = NULLIF(@cycle1_revisit_score, ''),
    cycle1_total_score = NULLIF(@cycle1_total_score, ''),
    cycle2_survey_date = NULLIF(@cycle2_survey_date, ''),
    cycle2_total_deficiencies = NULLIF(@cycle2_total_deficiencies, ''),
    cycle2_standard_deficiencies = NULLIF(@cycle2_standard_deficiencies, ''),
    cycle2_complaint_deficiencies = NULLIF(@cycle2_complaint_deficiencies, ''),
    cycle2_deficiency_score = NULLIF(@cycle2_deficiency_score, ''),
    cycle2_revisits = NULLIF(@cycle2_revisits, ''),
    cycle2_revisit_score = NULLIF(@cycle2_revisit_score, ''),
    cycle2_total_score = NULLIF(@cycle2_total_score, ''),
    total_weighted_health_score = NULLIF(@total_weighted_health_score, ''),
    num_facility_reported_incidents = NULLIF(@num_facility_reported_incidents, ''),
    num_substantiated_complaints = NULLIF(@num_substantiated_complaints, ''),
    num_infection_control_citations = NULLIF(@num_infection_control_citations, ''),
    num_fines = NULLIF(@num_fines, ''),
    total_fines_dollars = NULLIF(@total_fines_dollars, ''),
    num_payment_denials = NULLIF(@num_payment_denials, ''),
    total_penalties = NULLIF(@total_penalties, ''),
    latitude = NULLIF(@latitude, ''),
    longitude = NULLIF(@longitude, ''),
    processing_date = NULLIF(@processing_date, '');

-- ============================================
-- STEP 3: Insert into quality_ratings table
-- ============================================

-- Set the file date for this load
SET @file_date = '2026-01-22';

INSERT INTO quality_ratings (
    property_master_id,
    rating_date,
    overall_rating,
    health_inspection_rating,
    staffing_rating,
    quality_measure_rating,
    rn_staffing_rating,
    long_stay_qm_rating,
    short_stay_qm_rating,
    special_focus_facility,
    abuse_icon,
    recent_ownership_change,
    total_weighted_health_survey_score,
    number_of_facility_reported_incidents,
    number_of_substantiated_complaints,
    number_of_fines,
    total_fines_dollars,
    number_of_payment_denials,
    total_penalties,
    certified_beds,
    average_residents_per_day,
    data_source
)
SELECT
    pm.id,
    @file_date,
    t.overall_rating,
    t.health_inspection_rating,
    t.staffing_rating,
    t.qm_rating,
    NULL, -- RN staffing rating not in standard output
    t.long_stay_qm_rating,
    t.short_stay_qm_rating,
    CASE
        WHEN t.special_focus_status LIKE '%SFF - Current%' THEN 'SFF'
        WHEN t.special_focus_status LIKE '%SFF - Candidate%' THEN 'SFF_Candidate'
        ELSE 'None'
    END,
    t.abuse_icon = 'Y' OR t.abuse_icon = 'Yes',
    t.ownership_change_12mo = 'Y' OR t.ownership_change_12mo = 'Yes',
    t.total_weighted_health_score,
    t.num_facility_reported_incidents,
    t.num_substantiated_complaints,
    t.num_fines,
    t.total_fines_dollars,
    t.num_payment_denials,
    t.total_penalties,
    t.certified_beds,
    t.avg_residents_per_day,
    'cms_provider_info'
FROM tmp_provider_info t
JOIN property_master pm ON pm.ccn = t.ccn
ON DUPLICATE KEY UPDATE
    overall_rating = VALUES(overall_rating),
    health_inspection_rating = VALUES(health_inspection_rating),
    staffing_rating = VALUES(staffing_rating),
    quality_measure_rating = VALUES(quality_measure_rating),
    long_stay_qm_rating = VALUES(long_stay_qm_rating),
    short_stay_qm_rating = VALUES(short_stay_qm_rating),
    special_focus_facility = VALUES(special_focus_facility),
    abuse_icon = VALUES(abuse_icon),
    recent_ownership_change = VALUES(recent_ownership_change),
    total_weighted_health_survey_score = VALUES(total_weighted_health_survey_score),
    number_of_facility_reported_incidents = VALUES(number_of_facility_reported_incidents),
    number_of_substantiated_complaints = VALUES(number_of_substantiated_complaints),
    number_of_fines = VALUES(number_of_fines),
    total_fines_dollars = VALUES(total_fines_dollars),
    number_of_payment_denials = VALUES(number_of_payment_denials),
    total_penalties = VALUES(total_penalties),
    certified_beds = VALUES(certified_beds),
    average_residents_per_day = VALUES(average_residents_per_day);

-- ============================================
-- STEP 4: Insert into staffing_data table
-- ============================================

INSERT INTO staffing_data (
    property_master_id,
    report_quarter,
    cna_hprd,
    lpn_hprd,
    rn_hprd,
    total_nurse_hprd,
    licensed_staff_hprd,
    physical_therapist_hprd,
    staffing_rating,
    rn_staffing_rating,
    weekend_staffing_deviation,
    staff_turnover_rate,
    rn_turnover_rate,
    average_daily_census,
    data_source
)
SELECT
    pm.id,
    @file_date,
    t.reported_cna_hprd,
    t.reported_lpn_hprd,
    t.reported_rn_hprd,
    t.reported_total_nurse_hprd,
    t.reported_licensed_hprd,
    t.reported_pt_hprd,
    t.staffing_rating,
    NULL, -- RN staffing rating
    CASE
        WHEN t.reported_total_nurse_hprd > 0 AND t.weekend_total_nurse_hprd > 0
        THEN (t.weekend_total_nurse_hprd - t.reported_total_nurse_hprd) / t.reported_total_nurse_hprd
        ELSE NULL
    END,
    t.total_nurse_turnover,
    t.rn_turnover,
    t.avg_residents_per_day,
    'cms_provider_info'
FROM tmp_provider_info t
JOIN property_master pm ON pm.ccn = t.ccn
WHERE t.reported_total_nurse_hprd IS NOT NULL
ON DUPLICATE KEY UPDATE
    cna_hprd = VALUES(cna_hprd),
    lpn_hprd = VALUES(lpn_hprd),
    rn_hprd = VALUES(rn_hprd),
    total_nurse_hprd = VALUES(total_nurse_hprd),
    licensed_staff_hprd = VALUES(licensed_staff_hprd),
    physical_therapist_hprd = VALUES(physical_therapist_hprd),
    staffing_rating = VALUES(staffing_rating),
    weekend_staffing_deviation = VALUES(weekend_staffing_deviation),
    staff_turnover_rate = VALUES(staff_turnover_rate),
    rn_turnover_rate = VALUES(rn_turnover_rate),
    average_daily_census = VALUES(average_daily_census);

-- ============================================
-- STEP 5: Log the data load
-- ============================================

INSERT INTO cms_data_collection_log (
    data_source,
    source_url,
    source_file,
    file_date,
    records_loaded,
    records_matched,
    load_status,
    completed_at
)
SELECT
    'provider_info',
    'https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0/download?format=csv',
    'NH_ProviderInfo_Jan2026.csv',
    @file_date,
    (SELECT COUNT(*) FROM tmp_provider_info),
    (SELECT COUNT(*) FROM tmp_provider_info t JOIN property_master pm ON pm.ccn = t.ccn),
    'success',
    NOW();

-- ============================================
-- STEP 6: Validation queries
-- ============================================

SELECT 'Quality Ratings Loaded' AS metric, COUNT(*) AS count FROM quality_ratings WHERE rating_date = @file_date;
SELECT 'Staffing Data Loaded' AS metric, COUNT(*) AS count FROM staffing_data WHERE report_quarter = @file_date;
SELECT 'Unmatched Facilities' AS metric, COUNT(*) AS count FROM tmp_provider_info t LEFT JOIN property_master pm ON pm.ccn = t.ccn WHERE pm.id IS NULL;

-- Rating Distribution
SELECT overall_rating, COUNT(*) AS facilities
FROM quality_ratings
WHERE rating_date = @file_date
GROUP BY overall_rating
ORDER BY overall_rating;

-- SFF Status
SELECT special_focus_facility, COUNT(*) AS count
FROM quality_ratings
WHERE rating_date = @file_date
GROUP BY special_focus_facility;

-- Keep tmp table for analysis (optional - drop if not needed)
-- DROP TABLE tmp_provider_info;
