-- 3G Healthcare Real Estate Atlas - CMS Quality & Performance Data
-- High Priority Data Sources: Quality Ratings, Staffing (PBJ), Cost Reports
-- Supports multiple periods for performance tracking
-- Created: January 2026

USE atlas;

-- ============================================
-- STAGING: CMS Provider Info (Raw Import)
-- Source: https://data.cms.gov/provider-data/dataset/4pq5-n9py
-- ============================================

DROP TABLE IF EXISTS cms_provider_info_staging;
CREATE TABLE cms_provider_info_staging (
    federal_provider_number VARCHAR(20),
    provider_name VARCHAR(500),
    provider_address VARCHAR(500),
    provider_city VARCHAR(100),
    provider_state VARCHAR(10),
    provider_zip_code VARCHAR(20),
    provider_phone_number VARCHAR(50),
    provider_ssa_county_code VARCHAR(10),
    provider_county_name VARCHAR(100),
    ownership_type VARCHAR(100),
    number_of_certified_beds INT,
    number_of_residents INT,
    average_number_of_residents_per_day DECIMAL(10,2),
    provider_type VARCHAR(100),
    provider_resides_in_hospital VARCHAR(10),
    legal_business_name VARCHAR(500),
    date_first_approved_to_provide_medicare_and_medicaid_services DATE,
    continuing_care_retirement_community VARCHAR(10),
    special_focus_facility VARCHAR(100),
    special_focus_facility_candidate VARCHAR(100),
    abuse_icon VARCHAR(50),
    most_recent_health_inspection_more_than_2_years_ago VARCHAR(10),
    provider_changed_ownership_in_last_12_months VARCHAR(10),
    with_a_resident_and_family_council VARCHAR(50),
    automatic_sprinkler_systems_in_all_required_areas VARCHAR(10),
    overall_rating INT,
    health_inspection_rating INT,
    qm_rating INT,
    staffing_rating INT,
    rn_staffing_rating INT,
    long_stay_qm_rating INT,
    short_stay_qm_rating INT,
    reported_cna_staffing_hours_per_resident_per_day DECIMAL(10,4),
    reported_lpn_staffing_hours_per_resident_per_day DECIMAL(10,4),
    reported_rn_staffing_hours_per_resident_per_day DECIMAL(10,4),
    reported_licensed_staffing_hours_per_resident_per_day DECIMAL(10,4),
    reported_total_nurse_staffing_hours_per_resident_per_day DECIMAL(10,4),
    reported_physical_therapist_staffing_hours_per_resident_per_day DECIMAL(10,4),
    total_number_of_nurse_staff_hours DECIMAL(15,2),
    rn_hours DECIMAL(15,2),
    lpn_hours DECIMAL(15,2),
    nurse_aide_hours DECIMAL(15,2),
    physical_therapy_hours DECIMAL(15,2),
    total_weighted_health_survey_score DECIMAL(15,4),
    number_of_facility_reported_incidents INT,
    number_of_substantiated_complaints INT,
    number_of_fines INT,
    total_amount_of_fines_in_dollars DECIMAL(15,2),
    number_of_payment_denials INT,
    total_number_of_penalties INT,
    location VARCHAR(100),
    processing_date DATE,
    latitude DECIMAL(12,8),
    longitude DECIMAL(12,8),

    -- Import metadata
    file_date DATE COMMENT 'Date of source file for period tracking',
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_federal_provider_number (federal_provider_number),
    INDEX idx_file_date (file_date),
    INDEX idx_state (provider_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- MASTER: Quality Ratings (Multi-Period)
-- Tracks facility ratings over time
-- ============================================

DROP TABLE IF EXISTS quality_ratings;
CREATE TABLE quality_ratings (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NOT NULL,
    rating_date DATE NOT NULL COMMENT 'Date of this rating snapshot',

    -- Star Ratings (1-5)
    overall_rating TINYINT COMMENT '1-5 overall star rating',
    health_inspection_rating TINYINT COMMENT '1-5 health inspection rating',
    staffing_rating TINYINT COMMENT '1-5 staffing rating',
    quality_measure_rating TINYINT COMMENT '1-5 quality measure rating',
    rn_staffing_rating TINYINT COMMENT '1-5 RN staffing rating',
    long_stay_qm_rating TINYINT COMMENT '1-5 long-stay QM rating',
    short_stay_qm_rating TINYINT COMMENT '1-5 short-stay QM rating',

    -- Flags & Alerts
    special_focus_facility ENUM('SFF','SFF_Candidate','None') DEFAULT 'None',
    abuse_icon BOOLEAN DEFAULT FALSE COMMENT 'Abuse citation flag',
    recent_ownership_change BOOLEAN DEFAULT FALSE COMMENT 'Changed ownership in last 12 months',

    -- Survey Scores
    total_weighted_health_survey_score DECIMAL(10,4),
    number_of_facility_reported_incidents INT DEFAULT 0,
    number_of_substantiated_complaints INT DEFAULT 0,

    -- Penalties
    number_of_fines INT DEFAULT 0,
    total_fines_dollars DECIMAL(12,2) DEFAULT 0,
    number_of_payment_denials INT DEFAULT 0,
    total_penalties INT DEFAULT 0,

    -- Bed/Census Data
    certified_beds INT,
    average_residents_per_day DECIMAL(8,2),

    -- Metadata
    data_source VARCHAR(50) DEFAULT 'cms_provider_info',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (property_master_id) REFERENCES property_master(id),
    UNIQUE KEY uk_property_rating_date (property_master_id, rating_date),
    INDEX idx_rating_date (rating_date),
    INDEX idx_overall_rating (overall_rating),
    INDEX idx_sff (special_focus_facility)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- MASTER: Staffing Data (PBJ - Multi-Period)
-- Source: https://data.cms.gov/provider-data/dataset/g6vv-u9sr
-- ============================================

DROP TABLE IF EXISTS staffing_data;
CREATE TABLE staffing_data (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NOT NULL,
    report_quarter DATE NOT NULL COMMENT 'Quarter end date (e.g., 2025-03-31)',

    -- Hours per Resident Day (HPRD)
    cna_hprd DECIMAL(6,4) COMMENT 'CNA hours per resident day',
    lpn_hprd DECIMAL(6,4) COMMENT 'LPN hours per resident day',
    rn_hprd DECIMAL(6,4) COMMENT 'RN hours per resident day',
    total_nurse_hprd DECIMAL(6,4) COMMENT 'Total nursing HPRD',
    licensed_staff_hprd DECIMAL(6,4) COMMENT 'Licensed staff HPRD',
    physical_therapist_hprd DECIMAL(6,4) COMMENT 'PT hours per resident day',

    -- Total Hours
    total_nurse_hours DECIMAL(12,2),
    rn_hours DECIMAL(12,2),
    lpn_hours DECIMAL(12,2),
    cna_hours DECIMAL(12,2),
    pt_hours DECIMAL(12,2),

    -- Staffing Ratings
    staffing_rating TINYINT COMMENT '1-5 staffing rating',
    rn_staffing_rating TINYINT COMMENT '1-5 RN staffing rating',

    -- Weekend/Turnover Metrics
    weekend_staffing_deviation DECIMAL(6,4) COMMENT 'Weekend vs weekday variance',
    staff_turnover_rate DECIMAL(5,2) COMMENT 'Annual turnover %',
    rn_turnover_rate DECIMAL(5,2) COMMENT 'RN-specific turnover %',

    -- Census
    average_daily_census DECIMAL(8,2),

    -- Metadata
    data_source VARCHAR(50) DEFAULT 'cms_pbj',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (property_master_id) REFERENCES property_master(id),
    UNIQUE KEY uk_property_quarter (property_master_id, report_quarter),
    INDEX idx_report_quarter (report_quarter),
    INDEX idx_staffing_rating (staffing_rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STAGING: Cost Reports (HCRIS Raw Import)
-- Source: https://www.nber.org/research/data/hcris-snf
-- ============================================

DROP TABLE IF EXISTS cms_cost_report_staging;
CREATE TABLE cms_cost_report_staging (
    rpt_rec_num BIGINT COMMENT 'Report record number (unique)',
    prvdr_ctrl_type_cd VARCHAR(10),
    prvdr_num VARCHAR(20) COMMENT 'Provider number (CCN)',
    npi VARCHAR(20),
    rpt_stus_cd VARCHAR(10) COMMENT 'Report status code',
    fy_bgn_dt DATE COMMENT 'Fiscal year begin date',
    fy_end_dt DATE COMMENT 'Fiscal year end date',
    proc_dt DATE COMMENT 'Processing date',
    initl_rpt_sw VARCHAR(5),
    last_rpt_sw VARCHAR(5),
    trnsmtl_num VARCHAR(20),
    fi_num VARCHAR(20) COMMENT 'Fiscal intermediary number',
    adr_vndr_cd VARCHAR(10),
    fi_creat_dt DATE,
    util_cd VARCHAR(10),
    npr_dt DATE,
    spec_ind VARCHAR(10),
    fi_rcpt_dt DATE,

    -- Calculated/Parsed Fields (populated during load)
    fiscal_year INT COMMENT 'Derived fiscal year',

    -- Import metadata
    source_file VARCHAR(255),
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_prvdr_num (prvdr_num),
    INDEX idx_rpt_rec_num (rpt_rec_num),
    INDEX idx_fiscal_year (fiscal_year),
    INDEX idx_fy_end_dt (fy_end_dt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- MASTER: Cost Reports (Multi-Period)
-- Key financial metrics parsed from HCRIS
-- ============================================

DROP TABLE IF EXISTS cost_reports;
CREATE TABLE cost_reports (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NOT NULL,
    fiscal_year_end DATE NOT NULL COMMENT 'Fiscal year end date',
    fiscal_year INT COMMENT 'Fiscal year (e.g., 2024)',

    -- Revenue
    total_patient_revenue DECIMAL(15,2),
    medicare_revenue DECIMAL(15,2),
    medicaid_revenue DECIMAL(15,2),
    private_revenue DECIMAL(15,2),
    other_revenue DECIMAL(15,2),
    net_patient_revenue DECIMAL(15,2),

    -- Expenses
    total_operating_expenses DECIMAL(15,2),
    salary_wages DECIMAL(15,2),
    employee_benefits DECIMAL(15,2),
    contract_services DECIMAL(15,2),
    supplies DECIMAL(15,2),
    utilities DECIMAL(15,2),
    depreciation DECIMAL(15,2),
    interest_expense DECIMAL(15,2),

    -- Profitability
    net_income DECIMAL(15,2),
    operating_margin DECIMAL(6,4) COMMENT 'Net income / Revenue',

    -- Utilization
    total_beds INT,
    total_patient_days INT,
    medicare_days INT,
    medicaid_days INT,
    private_days INT,
    occupancy_rate DECIMAL(5,2) COMMENT 'Patient days / (beds * 365)',

    -- Payer Mix Percentages
    medicare_pct DECIMAL(5,2),
    medicaid_pct DECIMAL(5,2),
    private_pct DECIMAL(5,2),

    -- Per Diem Costs
    cost_per_patient_day DECIMAL(10,2),
    nursing_cost_per_day DECIMAL(10,2),

    -- Bad Debt & Charity
    bad_debt DECIMAL(15,2),
    charity_care DECIMAL(15,2),

    -- Report Metadata
    rpt_rec_num BIGINT COMMENT 'HCRIS report record number',
    report_status VARCHAR(20),

    -- Metadata
    data_source VARCHAR(50) DEFAULT 'cms_hcris',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (property_master_id) REFERENCES property_master(id),
    UNIQUE KEY uk_property_fiscal_year (property_master_id, fiscal_year_end),
    INDEX idx_fiscal_year (fiscal_year),
    INDEX idx_fiscal_year_end (fiscal_year_end),
    INDEX idx_occupancy (occupancy_rate),
    INDEX idx_operating_margin (operating_margin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- VIEWS: Performance Analytics
-- ============================================

-- Quality Rating Changes Period-over-Period
CREATE OR REPLACE VIEW v_quality_changes AS
SELECT
    pm.ccn,
    pm.facility_name,
    pm.state,
    q1.rating_date AS prior_date,
    q2.rating_date AS latest_date,
    q1.overall_rating AS prior_overall,
    q2.overall_rating AS current_overall,
    q2.overall_rating - q1.overall_rating AS rating_change,
    q1.health_inspection_rating AS prior_health,
    q2.health_inspection_rating AS current_health,
    q2.health_inspection_rating - q1.health_inspection_rating AS health_change,
    q1.staffing_rating AS prior_staffing,
    q2.staffing_rating AS current_staffing,
    q2.staffing_rating - q1.staffing_rating AS staffing_change,
    q2.special_focus_facility,
    q2.abuse_icon
FROM quality_ratings q1
JOIN quality_ratings q2 ON q1.property_master_id = q2.property_master_id
    AND q2.rating_date = (
        SELECT MIN(rating_date)
        FROM quality_ratings
        WHERE property_master_id = q1.property_master_id
        AND rating_date > q1.rating_date
    )
JOIN property_master pm ON pm.id = q1.property_master_id
ORDER BY rating_change DESC, pm.state, pm.facility_name;

-- Staffing Trends Period-over-Period
CREATE OR REPLACE VIEW v_staffing_trends AS
SELECT
    pm.ccn,
    pm.facility_name,
    pm.state,
    s1.report_quarter AS prior_quarter,
    s2.report_quarter AS current_quarter,
    s1.total_nurse_hprd AS prior_hprd,
    s2.total_nurse_hprd AS current_hprd,
    ROUND(s2.total_nurse_hprd - s1.total_nurse_hprd, 4) AS hprd_change,
    ROUND(((s2.total_nurse_hprd - s1.total_nurse_hprd) / s1.total_nurse_hprd) * 100, 2) AS hprd_pct_change,
    s1.rn_hprd AS prior_rn_hprd,
    s2.rn_hprd AS current_rn_hprd,
    s2.staffing_rating AS current_staffing_rating,
    s2.staff_turnover_rate
FROM staffing_data s1
JOIN staffing_data s2 ON s1.property_master_id = s2.property_master_id
    AND s2.report_quarter = (
        SELECT MIN(report_quarter)
        FROM staffing_data
        WHERE property_master_id = s1.property_master_id
        AND report_quarter > s1.report_quarter
    )
JOIN property_master pm ON pm.id = s1.property_master_id
ORDER BY hprd_pct_change DESC, pm.state, pm.facility_name;

-- Financial Performance Period-over-Period
CREATE OR REPLACE VIEW v_financial_trends AS
SELECT
    pm.ccn,
    pm.facility_name,
    pm.state,
    c1.fiscal_year AS prior_year,
    c2.fiscal_year AS current_year,
    c1.net_patient_revenue AS prior_revenue,
    c2.net_patient_revenue AS current_revenue,
    ROUND(c2.net_patient_revenue - c1.net_patient_revenue, 2) AS revenue_change,
    ROUND(((c2.net_patient_revenue - c1.net_patient_revenue) / NULLIF(c1.net_patient_revenue, 0)) * 100, 2) AS revenue_pct_change,
    c1.operating_margin AS prior_margin,
    c2.operating_margin AS current_margin,
    ROUND((c2.operating_margin - c1.operating_margin) * 100, 2) AS margin_change_bps,
    c1.occupancy_rate AS prior_occupancy,
    c2.occupancy_rate AS current_occupancy,
    c2.occupancy_rate - c1.occupancy_rate AS occupancy_change,
    c2.medicaid_pct,
    c2.medicare_pct
FROM cost_reports c1
JOIN cost_reports c2 ON c1.property_master_id = c2.property_master_id
    AND c2.fiscal_year = c1.fiscal_year + 1
JOIN property_master pm ON pm.id = c1.property_master_id
ORDER BY margin_change_bps DESC, pm.state, pm.facility_name;

-- Facility Performance Summary (Latest Period)
CREATE OR REPLACE VIEW v_facility_performance AS
SELECT
    pm.id AS property_master_id,
    pm.ccn,
    pm.facility_name,
    pm.state,
    pm.city,

    -- Quality (Latest)
    qr.rating_date AS quality_date,
    qr.overall_rating,
    qr.health_inspection_rating,
    qr.staffing_rating,
    qr.quality_measure_rating,
    qr.special_focus_facility,
    qr.abuse_icon,
    qr.total_penalties,
    qr.total_fines_dollars,
    qr.certified_beds,

    -- Staffing (Latest)
    sd.report_quarter AS staffing_quarter,
    sd.total_nurse_hprd,
    sd.rn_hprd,
    sd.cna_hprd,
    sd.staff_turnover_rate,

    -- Financial (Latest)
    cr.fiscal_year,
    cr.net_patient_revenue,
    cr.operating_margin,
    cr.occupancy_rate,
    cr.medicaid_pct,
    cr.medicare_pct,
    cr.cost_per_patient_day,

    -- Medicaid Rate (Latest)
    mr.daily_rate AS medicaid_daily_rate,
    mr.effective_date AS rate_effective_date

FROM property_master pm

LEFT JOIN quality_ratings qr ON qr.property_master_id = pm.id
    AND qr.rating_date = (SELECT MAX(rating_date) FROM quality_ratings WHERE property_master_id = pm.id)

LEFT JOIN staffing_data sd ON sd.property_master_id = pm.id
    AND sd.report_quarter = (SELECT MAX(report_quarter) FROM staffing_data WHERE property_master_id = pm.id)

LEFT JOIN cost_reports cr ON cr.property_master_id = pm.id
    AND cr.fiscal_year = (SELECT MAX(fiscal_year) FROM cost_reports WHERE property_master_id = pm.id)

LEFT JOIN medicaid_rates mr ON mr.property_master_id = pm.id
    AND mr.effective_date = (SELECT MAX(effective_date) FROM medicaid_rates WHERE property_master_id = pm.id);

-- ============================================
-- DATA SOURCE TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS cms_data_collection_log (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    data_source ENUM('provider_info', 'pbj_staffing', 'cost_reports', 'quality_measures') NOT NULL,
    source_url VARCHAR(500),
    source_file VARCHAR(255),
    file_date DATE COMMENT 'Date of the source data',
    records_loaded INT,
    records_matched INT COMMENT 'Records matched to property_master',
    load_status ENUM('success', 'partial', 'failed') DEFAULT 'success',
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,

    INDEX idx_data_source (data_source),
    INDEX idx_file_date (file_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
