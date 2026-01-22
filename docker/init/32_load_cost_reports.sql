-- 3G Healthcare Real Estate Atlas - Load HCRIS Cost Reports
-- Source: https://www.nber.org/research/data/hcris-snf
-- Files: snf10_2017_RPT.csv, snf10_2017_NMRC.csv
-- Created: January 2026

USE atlas;

-- ============================================
-- STEP 1: Load Report Metadata (RPT file)
-- Links provider numbers to fiscal years
-- ============================================

DROP TABLE IF EXISTS tmp_cost_rpt;
CREATE TABLE tmp_cost_rpt (
    rpt_rec_num BIGINT NOT NULL,
    prvdr_ctrl_type_cd VARCHAR(10),
    prvdr_num VARCHAR(20),
    npi VARCHAR(20),
    rpt_stus_cd INT,
    fy_bgn_dt DATE,
    fy_end_dt DATE,
    proc_dt DATE,
    initl_rpt_sw VARCHAR(5),
    last_rpt_sw VARCHAR(5),
    trnsmtl_num VARCHAR(20),
    fi_num VARCHAR(20),
    adr_vndr_cd VARCHAR(10),
    fi_creat_dt DATE,
    util_cd VARCHAR(10),
    npr_dt DATE,
    spec_ind VARCHAR(10),
    fi_rcpt_dt DATE,

    PRIMARY KEY (rpt_rec_num),
    INDEX idx_prvdr_num (prvdr_num),
    INDEX idx_fy_end_dt (fy_end_dt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Load 2017 RPT data
LOAD DATA INFILE '/data/snf10_2017_RPT.csv'
INTO TABLE tmp_cost_rpt
FIELDS TERMINATED BY ','
LINES TERMINATED BY '\n'
(rpt_rec_num, prvdr_ctrl_type_cd, prvdr_num, @npi, rpt_stus_cd,
 @fy_bgn_dt, @fy_end_dt, @proc_dt, initl_rpt_sw, last_rpt_sw,
 trnsmtl_num, fi_num, adr_vndr_cd, @fi_creat_dt, util_cd,
 @npr_dt, spec_ind, @fi_rcpt_dt)
SET
    npi = NULLIF(@npi, ''),
    fy_bgn_dt = IF(@fy_bgn_dt = '', NULL, STR_TO_DATE(@fy_bgn_dt, '%m/%d/%Y')),
    fy_end_dt = IF(@fy_end_dt = '', NULL, STR_TO_DATE(@fy_end_dt, '%m/%d/%Y')),
    proc_dt = IF(@proc_dt = '', NULL, STR_TO_DATE(@proc_dt, '%m/%d/%Y')),
    fi_creat_dt = IF(@fi_creat_dt = '', NULL, STR_TO_DATE(@fi_creat_dt, '%m/%d/%Y')),
    npr_dt = IF(@npr_dt = '', NULL, STR_TO_DATE(@npr_dt, '%m/%d/%Y')),
    fi_rcpt_dt = IF(@fi_rcpt_dt = '', NULL, STR_TO_DATE(@fi_rcpt_dt, '%m/%d/%Y'));

-- ============================================
-- STEP 2: Load Numeric Data (NMRC file)
-- This is a large file - loading into temp table
-- ============================================

DROP TABLE IF EXISTS tmp_cost_nmrc;
CREATE TABLE tmp_cost_nmrc (
    rpt_rec_num BIGINT NOT NULL,
    wksht_cd VARCHAR(10) NOT NULL,
    line_num VARCHAR(10) NOT NULL,
    clmn_num VARCHAR(10) NOT NULL,
    itm_val DECIMAL(20,2),

    INDEX idx_rpt_rec_num (rpt_rec_num),
    INDEX idx_wksht_line_col (wksht_cd, line_num, clmn_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Load 2017 NMRC data (this may take several minutes)
LOAD DATA INFILE '/data/snf10_2017_NMRC.csv'
INTO TABLE tmp_cost_nmrc
FIELDS TERMINATED BY ','
LINES TERMINATED BY '\n'
(rpt_rec_num, wksht_cd, line_num, clmn_num, @itm_val)
SET itm_val = NULLIF(@itm_val, '');

-- ============================================
-- STEP 3: Extract Key Financial Metrics
-- Worksheet S-3 Part I = Statistical Data
-- Worksheet G-2 = Revenue
-- Worksheet G-3 = Expenses
-- ============================================

-- Create a pivot table of key metrics per provider
DROP TABLE IF EXISTS tmp_cost_metrics;
CREATE TABLE tmp_cost_metrics (
    rpt_rec_num BIGINT NOT NULL,
    prvdr_num VARCHAR(20),
    fy_end_dt DATE,
    fiscal_year INT,

    -- From S-3 Part I (Statistical Data)
    beds INT COMMENT 'S300001 Line 1 Col 1',
    total_patient_days INT COMMENT 'S300001 Line 2 Col 6',
    medicare_days INT COMMENT 'S300001 Line 2 Col 1',
    medicaid_days INT COMMENT 'S300001 Line 2 Col 2',
    private_days INT COMMENT 'S300001 Line 2 Col 3-5',
    occupancy_rate DECIMAL(5,2),

    -- From G-2 (Revenue)
    total_patient_revenue DECIMAL(15,2) COMMENT 'G200000 Line 100 Col 1',
    medicare_revenue DECIMAL(15,2) COMMENT 'G200000 Line 100 Col 3',
    medicaid_revenue DECIMAL(15,2) COMMENT 'G200000 Line 100 Col 4',

    -- From G-3 (Expenses)
    total_operating_expenses DECIMAL(15,2) COMMENT 'G300000 Line 100 Col 1',

    -- Calculated
    net_income DECIMAL(15,2),
    operating_margin DECIMAL(6,4),
    medicare_pct DECIMAL(5,2),
    medicaid_pct DECIMAL(5,2),
    cost_per_day DECIMAL(10,2),

    PRIMARY KEY (rpt_rec_num),
    INDEX idx_prvdr_num (prvdr_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extract and pivot key metrics
INSERT INTO tmp_cost_metrics (rpt_rec_num, prvdr_num, fy_end_dt, fiscal_year)
SELECT rpt_rec_num, prvdr_num, fy_end_dt, YEAR(fy_end_dt)
FROM tmp_cost_rpt;

-- Update beds (S-3 Part I, Line 1, Column 1)
UPDATE tmp_cost_metrics m
JOIN tmp_cost_nmrc n ON m.rpt_rec_num = n.rpt_rec_num
SET m.beds = n.itm_val
WHERE n.wksht_cd = 'S300001' AND n.line_num = '00100' AND n.clmn_num = '0100';

-- Update total patient days (S-3 Part I, Line 2, Column 6 or 7)
UPDATE tmp_cost_metrics m
JOIN tmp_cost_nmrc n ON m.rpt_rec_num = n.rpt_rec_num
SET m.total_patient_days = n.itm_val
WHERE n.wksht_cd = 'S300001' AND n.line_num = '00200' AND n.clmn_num IN ('0600', '0700');

-- Update Medicare days (S-3 Part I, Line 2, Column 1)
UPDATE tmp_cost_metrics m
JOIN tmp_cost_nmrc n ON m.rpt_rec_num = n.rpt_rec_num
SET m.medicare_days = n.itm_val
WHERE n.wksht_cd = 'S300001' AND n.line_num = '00200' AND n.clmn_num = '0100';

-- Update Medicaid days (S-3 Part I, Line 2, Column 2)
UPDATE tmp_cost_metrics m
JOIN tmp_cost_nmrc n ON m.rpt_rec_num = n.rpt_rec_num
SET m.medicaid_days = n.itm_val
WHERE n.wksht_cd = 'S300001' AND n.line_num = '00200' AND n.clmn_num = '0200';

-- Update total revenue (G-2, Line 200, Column 3 - Total)
UPDATE tmp_cost_metrics m
JOIN tmp_cost_nmrc n ON m.rpt_rec_num = n.rpt_rec_num
SET m.total_patient_revenue = n.itm_val
WHERE n.wksht_cd = 'G200000' AND n.line_num = '20000' AND n.clmn_num = '0300';

-- Update total expenses (G-3, Line 200, Column 1 - Total)
UPDATE tmp_cost_metrics m
JOIN tmp_cost_nmrc n ON m.rpt_rec_num = n.rpt_rec_num
SET m.total_operating_expenses = n.itm_val
WHERE n.wksht_cd = 'G300000' AND n.line_num = '20000' AND n.clmn_num = '0100';

-- Calculate derived fields
UPDATE tmp_cost_metrics
SET
    net_income = COALESCE(total_patient_revenue, 0) - COALESCE(total_operating_expenses, 0),
    operating_margin = CASE
        WHEN total_patient_revenue > 0 THEN
            (COALESCE(total_patient_revenue, 0) - COALESCE(total_operating_expenses, 0)) / total_patient_revenue
        ELSE NULL
    END,
    occupancy_rate = CASE
        WHEN beds > 0 THEN
            (total_patient_days / (beds * 365.0)) * 100
        ELSE NULL
    END,
    medicare_pct = CASE
        WHEN total_patient_days > 0 THEN
            (medicare_days / total_patient_days) * 100
        ELSE NULL
    END,
    medicaid_pct = CASE
        WHEN total_patient_days > 0 THEN
            (medicaid_days / total_patient_days) * 100
        ELSE NULL
    END,
    cost_per_day = CASE
        WHEN total_patient_days > 0 THEN
            total_operating_expenses / total_patient_days
        ELSE NULL
    END;

-- ============================================
-- STEP 4: Insert into cost_reports table
-- ============================================

INSERT INTO cost_reports (
    property_master_id,
    fiscal_year_end,
    fiscal_year,
    total_patient_revenue,
    total_operating_expenses,
    net_income,
    operating_margin,
    total_beds,
    total_patient_days,
    medicare_days,
    medicaid_days,
    occupancy_rate,
    medicare_pct,
    medicaid_pct,
    cost_per_patient_day,
    rpt_rec_num,
    data_source
)
SELECT
    pm.id,
    m.fy_end_dt,
    m.fiscal_year,
    m.total_patient_revenue,
    m.total_operating_expenses,
    m.net_income,
    m.operating_margin,
    m.beds,
    m.total_patient_days,
    m.medicare_days,
    m.medicaid_days,
    m.occupancy_rate,
    m.medicare_pct,
    m.medicaid_pct,
    m.cost_per_day,
    m.rpt_rec_num,
    'cms_hcris_2017'
FROM tmp_cost_metrics m
JOIN property_master pm ON pm.ccn = m.prvdr_num
WHERE m.beds IS NOT NULL OR m.total_patient_revenue IS NOT NULL
ON DUPLICATE KEY UPDATE
    total_patient_revenue = VALUES(total_patient_revenue),
    total_operating_expenses = VALUES(total_operating_expenses),
    net_income = VALUES(net_income),
    operating_margin = VALUES(operating_margin),
    total_beds = VALUES(total_beds),
    total_patient_days = VALUES(total_patient_days),
    medicare_days = VALUES(medicare_days),
    medicaid_days = VALUES(medicaid_days),
    occupancy_rate = VALUES(occupancy_rate),
    medicare_pct = VALUES(medicare_pct),
    medicaid_pct = VALUES(medicaid_pct),
    cost_per_patient_day = VALUES(cost_per_patient_day);

-- ============================================
-- STEP 5: Validation
-- ============================================

SELECT 'RPT Records Loaded' AS metric, COUNT(*) AS count FROM tmp_cost_rpt;
SELECT 'NMRC Records Loaded' AS metric, COUNT(*) AS count FROM tmp_cost_nmrc;
SELECT 'Metrics Extracted' AS metric, COUNT(*) AS count FROM tmp_cost_metrics WHERE beds IS NOT NULL;
SELECT 'Matched to Properties' AS metric, COUNT(*) AS count FROM cost_reports WHERE data_source = 'cms_hcris_2017';

-- Sample output
SELECT
    pm.ccn,
    pm.facility_name,
    pm.state,
    cr.fiscal_year,
    cr.total_beds,
    cr.occupancy_rate,
    cr.total_patient_revenue,
    cr.total_operating_expenses,
    cr.operating_margin,
    cr.medicare_pct,
    cr.medicaid_pct
FROM cost_reports cr
JOIN property_master pm ON pm.id = cr.property_master_id
WHERE cr.data_source = 'cms_hcris_2017'
ORDER BY cr.total_patient_revenue DESC
LIMIT 10;

-- Log the load
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
    'cost_reports',
    'https://data.nber.org/hcris/snf2010/',
    'snf10_2017_RPT.csv, snf10_2017_NMRC.csv',
    '2017-12-31',
    (SELECT COUNT(*) FROM tmp_cost_rpt),
    (SELECT COUNT(*) FROM cost_reports WHERE data_source = 'cms_hcris_2017'),
    'success',
    NOW();

-- Cleanup (optional - keep for debugging)
-- DROP TABLE tmp_cost_rpt;
-- DROP TABLE tmp_cost_nmrc;
-- DROP TABLE tmp_cost_metrics;
