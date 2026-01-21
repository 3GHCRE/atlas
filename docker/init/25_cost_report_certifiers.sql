-- Cost Report Certifiers Schema
-- Links CMS HCRIS cost report preparers/certifiers to facilities

USE atlas;

-- ============================================
-- COST REPORT CERTIFIERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS cost_report_certifiers (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rpt_rec_num VARCHAR(20) NOT NULL COMMENT 'CMS Report Record Number',
    prvdr_num VARCHAR(10) NOT NULL COMMENT 'Provider Number (CCN)',
    npi VARCHAR(20) COMMENT 'NPI Number',
    prvdr_ctrl_type_cd VARCHAR(5) COMMENT 'Provider Control Type Code',
    fy_bgn_dt DATE COMMENT 'Fiscal Year Begin Date',
    fy_end_dt DATE COMMENT 'Fiscal Year End Date',
    rpt_stus_cd VARCHAR(5) COMMENT 'Report Status Code',

    -- Facility info from cost report
    facility_name VARCHAR(500) COMMENT 'Facility Name from S-2',
    address VARCHAR(500) COMMENT 'Address from S-2',
    city VARCHAR(100) COMMENT 'City from S-2',
    state CHAR(2) COMMENT 'State from S-2',
    zip VARCHAR(20) COMMENT 'ZIP from S-2',

    -- Certifier info from S Part II
    certifier_name VARCHAR(255) COMMENT 'Name of person who certified the report',
    certifier_printed_name VARCHAR(255) COMMENT 'Printed name of certifier',
    certifier_title VARCHAR(255) COMMENT 'Title of certifier',
    certifier_date DATE COMMENT 'Date of certification',

    -- Linkage
    property_master_id INT UNSIGNED COMMENT 'Linked property_master.id',

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_prvdr_num (prvdr_num),
    INDEX idx_certifier_name (certifier_name),
    INDEX idx_state (state),
    INDEX idx_fy_end (fy_end_dt),
    INDEX idx_property_master (property_master_id),

    CONSTRAINT fk_certifier_property
        FOREIGN KEY (property_master_id)
        REFERENCES property_master(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- CERTIFIER SUMMARY VIEW
-- ============================================

CREATE OR REPLACE VIEW v_certifier_summary AS
SELECT
    certifier_name,
    certifier_title,
    COUNT(DISTINCT prvdr_num) AS facility_count,
    COUNT(DISTINCT state) AS state_count,
    GROUP_CONCAT(DISTINCT state ORDER BY state SEPARATOR ', ') AS states,
    MIN(fy_bgn_dt) AS earliest_report,
    MAX(fy_end_dt) AS latest_report,
    CASE
        WHEN COUNT(DISTINCT state) >= 10 THEN 'External Preparer'
        WHEN COUNT(DISTINCT state) >= 5 AND COUNT(DISTINCT prvdr_num) >= 30 THEN 'Multi-State Chain or External'
        WHEN COUNT(DISTINCT state) <= 2 AND COUNT(DISTINCT prvdr_num) >= 20 THEN 'Single Chain Executive'
        WHEN COUNT(DISTINCT prvdr_num) < 5 THEN 'Small Operator'
        ELSE 'Regional Chain or Consultant'
    END AS classification
FROM cost_report_certifiers
WHERE certifier_name IS NOT NULL AND certifier_name != ''
GROUP BY certifier_name, certifier_title
ORDER BY facility_count DESC;

-- ============================================
-- CHAIN PORTFOLIO VIEW (via Certifier)
-- ============================================

CREATE OR REPLACE VIEW v_chain_portfolios_by_certifier AS
SELECT
    c.certifier_name,
    c.certifier_title,
    c.prvdr_num AS ccn,
    c.facility_name,
    c.city,
    c.state,
    c.fy_end_dt AS fiscal_year_end,
    pm.id AS property_master_id,
    pm.facility_name AS pm_facility_name
FROM cost_report_certifiers c
LEFT JOIN property_master pm ON c.prvdr_num = pm.ccn
WHERE c.certifier_name IS NOT NULL AND c.certifier_name != ''
ORDER BY c.certifier_name, c.state, c.facility_name;

-- ============================================
-- CHAIN ANALYSIS VIEW
-- ============================================

CREATE OR REPLACE VIEW v_chain_analysis AS
WITH certifier_chains AS (
    SELECT
        certifier_name,
        certifier_title,
        COUNT(DISTINCT prvdr_num) AS facility_count,
        COUNT(DISTINCT state) AS state_count,
        GROUP_CONCAT(DISTINCT state ORDER BY state SEPARATOR ', ') AS states
    FROM cost_report_certifiers
    WHERE certifier_name IS NOT NULL AND certifier_name != ''
    GROUP BY certifier_name, certifier_title
    HAVING COUNT(DISTINCT prvdr_num) >= 10
)
SELECT
    cc.*,
    -- Common facility name patterns can help identify chain
    (SELECT GROUP_CONCAT(DISTINCT
        SUBSTRING_INDEX(SUBSTRING_INDEX(UPPER(cr.facility_name), ' ', 1), ' ', -1)
     SEPARATOR ', ')
     FROM cost_report_certifiers cr
     WHERE cr.certifier_name = cc.certifier_name
     LIMIT 5) AS common_name_prefixes
FROM certifier_chains cc
ORDER BY cc.facility_count DESC;
