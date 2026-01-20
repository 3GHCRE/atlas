-- 3G Healthcare Real Estate Atlas - Database Schema
-- Phase 1A: property_master Foundation

USE atlas;

-- ============================================
-- STAGING TABLE: CMS Enrollments (Raw CSV Import)
-- ============================================

CREATE TABLE IF NOT EXISTS cms_enrollments_staging (
    enrollment_id VARCHAR(50),
    enrollment_state VARCHAR(10),
    provider_type_code VARCHAR(10),
    provider_type_text VARCHAR(100),
    npi VARCHAR(20),
    multiple_npi_flag VARCHAR(1),
    ccn VARCHAR(10),
    associate_id VARCHAR(50),
    organization_name VARCHAR(500),
    doing_business_as_name VARCHAR(500),
    incorporation_date VARCHAR(50),
    incorporation_state VARCHAR(10),
    organization_type_structure VARCHAR(50),
    organization_other_type_text VARCHAR(500),
    proprietary_nonprofit VARCHAR(1),
    nursing_home_provider_name VARCHAR(500),
    affiliation_entity_name VARCHAR(500),
    affiliation_entity_id VARCHAR(50),
    address_line_1 VARCHAR(500),
    address_line_2 VARCHAR(500),
    city VARCHAR(100),
    state VARCHAR(10),
    zip_code VARCHAR(20),
    
    -- Metadata
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ccn (ccn),
    INDEX idx_enrollment_id (enrollment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- MASTER TABLE: property_master
-- ============================================

CREATE TABLE IF NOT EXISTS property_master (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ccn VARCHAR(10) NOT NULL UNIQUE COMMENT 'CMS Certification Number (6-digit)',
    reapi_property_id INT UNSIGNED UNIQUE COMMENT 'REAPI Property ID (NULL until Phase 1A Day 2)',
    zoho_account_id VARCHAR(50) UNIQUE COMMENT 'Zoho Account/Property Record ID (NULL until Phase 1A Day 2)',
    facility_name VARCHAR(255) NOT NULL COMMENT 'Facility name from CMS',
    address VARCHAR(500) COMMENT 'Street address',
    city VARCHAR(100) COMMENT 'City',
    state CHAR(2) COMMENT 'State (2-letter code)',
    zip VARCHAR(10) COMMENT 'ZIP code',
    latitude DECIMAL(10, 8) COMMENT 'Geocoded latitude (NULL initially)',
    longitude DECIMAL(11, 8) COMMENT 'Geocoded longitude (NULL initially)',
    data_quality_score DECIMAL(3, 2) DEFAULT 0.00 COMMENT '0.00-1.00 linkage confidence',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_synced_from_zoho TIMESTAMP NULL COMMENT 'Last Zoho sync timestamp',
    last_synced_from_cms TIMESTAMP NULL COMMENT 'Last CMS sync timestamp',
    last_synced_from_reapi TIMESTAMP NULL COMMENT 'Last REAPI sync timestamp',
    
    -- Indexes from schema
    INDEX idx_state_city (state, city),
    INDEX idx_facility_name (facility_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
