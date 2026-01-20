-- 3G Healthcare Real Estate Atlas - Deals Schema
-- Unified transaction tracking for CHOWs, Sales, Mortgages, etc.

USE atlas;

-- ============================================
-- DEALS BASE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS deals (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_master_id INT UNSIGNED NULL COMMENT 'FK to property_master',
    ccn VARCHAR(10) NULL COMMENT 'CMS Certification Number (backup if no property link)',

    deal_type ENUM(
        'chow',           -- Change of ownership (CMS)
        'sale',           -- Property sale (REAPI/ACRIS)
        'mortgage',       -- New mortgage (REAPI/ACRIS)
        'assignment',     -- Mortgage assignment
        'satisfaction',   -- Mortgage satisfaction/payoff
        'lease',          -- Ground lease or master lease
        'refinance',      -- Refinance (mortgage + satisfaction)
        'other'
    ) NOT NULL,

    effective_date DATE NULL COMMENT 'Date deal took effect',
    recorded_date DATE NULL COMMENT 'Date recorded in public records',

    amount DECIMAL(15, 2) NULL COMMENT 'Sale price or mortgage amount',

    document_id VARCHAR(50) NULL COMMENT 'ACRIS document ID or other reference',
    document_type VARCHAR(50) NULL COMMENT 'DEED, MTGE, AGMT, etc.',

    data_source ENUM('cms', 'reapi', 'acris', 'zoho', 'manual', 'web_scrape') NOT NULL,
    verified BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    notes TEXT,

    INDEX idx_property (property_master_id),
    INDEX idx_ccn (ccn),
    INDEX idx_deal_type (deal_type),
    INDEX idx_effective_date (effective_date),
    INDEX idx_recorded_date (recorded_date),
    INDEX idx_document (document_id),
    INDEX idx_data_source (data_source),

    CONSTRAINT fk_deals_property
        FOREIGN KEY (property_master_id) REFERENCES property_master(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DEALS_PARTIES JUNCTION TABLE
-- Supports multiple parties per deal (multi-buyer, syndicated loans, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS deals_parties (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    deal_id INT UNSIGNED NOT NULL,

    party_role ENUM(
        'buyer',          -- Sale/CHOW buyer
        'seller',         -- Sale/CHOW seller
        'borrower',       -- Mortgage borrower
        'lender',         -- Mortgage lender
        'assignor',       -- Assignment from
        'assignee',       -- Assignment to
        'grantor',        -- General grantor
        'grantee',        -- General grantee
        'lessor',         -- Lease lessor
        'lessee',         -- Lease lessee
        'other'
    ) NOT NULL,

    party_name VARCHAR(500) NOT NULL COMMENT 'Organization or individual name',
    party_dba_name VARCHAR(500) NULL COMMENT 'DBA name if applicable',

    -- Link to companies table (only if party is a known opco)
    company_id INT UNSIGNED NULL COMMENT 'FK to companies if matched',

    -- Link to principals table (only if party is an individual)
    principal_id INT UNSIGNED NULL COMMENT 'FK to principals if matched',

    -- CMS-specific identifiers
    enrollment_id VARCHAR(50) NULL COMMENT 'CMS enrollment ID',
    associate_id VARCHAR(50) NULL COMMENT 'CMS associate ID',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_deal (deal_id),
    INDEX idx_party_role (party_role),
    INDEX idx_party_name (party_name(100)),
    INDEX idx_company (company_id),
    INDEX idx_principal (principal_id),
    INDEX idx_deal_role (deal_id, party_role),

    CONSTRAINT fk_dp_deal
        FOREIGN KEY (deal_id) REFERENCES deals(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_dp_company
        FOREIGN KEY (company_id) REFERENCES companies(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_dp_principal
        FOREIGN KEY (principal_id) REFERENCES principals(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DEALS_CHOW EXTENSION TABLE (CMS-specific)
-- ============================================
CREATE TABLE IF NOT EXISTS deals_chow (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    deal_id INT UNSIGNED NOT NULL UNIQUE COMMENT 'FK to deals (1:1)',

    chow_type_code VARCHAR(10) COMMENT 'CMS CHOW type code',
    chow_type_text VARCHAR(100) COMMENT 'CMS CHOW type description',

    -- Buyer CMS identifiers
    buyer_enrollment_id VARCHAR(50) COMMENT 'Buyer CMS enrollment ID',
    buyer_associate_id VARCHAR(50) COMMENT 'Buyer CMS associate ID',

    -- Seller CMS identifiers
    seller_enrollment_id VARCHAR(50) COMMENT 'Seller CMS enrollment ID',
    seller_associate_id VARCHAR(50) COMMENT 'Seller CMS associate ID',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_chow_type (chow_type_code),
    INDEX idx_buyer_enrollment (buyer_enrollment_id),
    INDEX idx_seller_enrollment (seller_enrollment_id),

    CONSTRAINT fk_dc_deal
        FOREIGN KEY (deal_id) REFERENCES deals(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DEALS_SALE EXTENSION TABLE (for REAPI data)
-- ============================================
CREATE TABLE IF NOT EXISTS deals_sale (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    deal_id INT UNSIGNED NOT NULL UNIQUE COMMENT 'FK to deals (1:1)',

    sale_type VARCHAR(50) COMMENT 'Arms-length, REO, Auction, 1031 Exchange, etc.',

    -- Price details
    price_per_bed DECIMAL(12, 2) COMMENT 'Sale price per licensed bed',
    price_per_sqft DECIMAL(10, 2) COMMENT 'Sale price per square foot',

    -- Property details at time of sale
    bed_count INT UNSIGNED COMMENT 'Licensed beds at sale',
    building_sqft INT UNSIGNED COMMENT 'Building square footage',
    land_sqft INT UNSIGNED COMMENT 'Land square footage',
    year_built SMALLINT UNSIGNED COMMENT 'Year built',

    -- Sale context
    days_on_market INT UNSIGNED COMMENT 'Days listed before sale',
    cap_rate DECIMAL(5, 2) COMMENT 'Cap rate at sale',
    occupancy_at_sale DECIMAL(5, 2) COMMENT 'Occupancy percentage at sale',

    -- Financing
    seller_financing BOOLEAN DEFAULT FALSE,
    assumption_of_debt BOOLEAN DEFAULT FALSE,

    -- REAPI specific
    reapi_transaction_id VARCHAR(50) COMMENT 'REAPI transaction reference',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_sale_type (sale_type),
    INDEX idx_price_per_bed (price_per_bed),
    INDEX idx_cap_rate (cap_rate),
    INDEX idx_reapi_id (reapi_transaction_id),

    CONSTRAINT fk_ds_deal
        FOREIGN KEY (deal_id) REFERENCES deals(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DEALS_MORTGAGE EXTENSION TABLE (for REAPI data)
-- ============================================
CREATE TABLE IF NOT EXISTS deals_mortgage (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    deal_id INT UNSIGNED NOT NULL UNIQUE COMMENT 'FK to deals (1:1)',

    loan_type VARCHAR(50) COMMENT 'Conventional, FHA, SBA, HUD, etc.',
    term_months INT UNSIGNED COMMENT 'Loan term in months',
    interest_rate DECIMAL(5, 3) COMMENT 'Interest rate percentage',
    maturity_date DATE COMMENT 'Loan maturity date',

    is_refinance BOOLEAN DEFAULT FALSE,
    is_construction BOOLEAN DEFAULT FALSE,
    is_mezzanine BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_loan_type (loan_type),
    INDEX idx_maturity (maturity_date),

    CONSTRAINT fk_dm_deal
        FOREIGN KEY (deal_id) REFERENCES deals(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- VALIDATION
-- ============================================
-- NOTE: CHOW data is loaded via 06_phase1b_chow.sql
-- This script only creates the schema structure
SELECT 'Deals Schema Created' as status;
SHOW TABLES LIKE 'deals%';
