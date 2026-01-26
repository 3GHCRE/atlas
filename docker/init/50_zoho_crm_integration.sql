-- 3G Healthcare Real Estate Atlas - Zoho CRM Integration Schema
-- Adds CRM-specific columns and staging tables for Zoho property/principal import

USE atlas;

-- ============================================
-- ADD CRM COLUMNS TO PRINCIPALS
-- ============================================

-- Add principal_source to distinguish CMS-only, CRM-only, and both
ALTER TABLE principals
ADD COLUMN IF NOT EXISTS principal_source ENUM('cms_only', 'crm_only', 'both') DEFAULT NULL
    COMMENT 'Source: cms_only=CMS filings only, crm_only=CRM contacts only, both=matched in both',
ADD COLUMN IF NOT EXISTS crm_property_count INT UNSIGNED DEFAULT 0
    COMMENT 'Property count from CRM',
ADD COLUMN IF NOT EXISTS crm_related_group VARCHAR(255)
    COMMENT 'Company/Group affiliation from CRM RELATED GROUP field',
ADD COLUMN IF NOT EXISTS crm_principal_types TEXT
    COMMENT 'Principal types from CRM (Administrator, Owner/Operator, etc.)',
ADD COLUMN IF NOT EXISTS mailing_street VARCHAR(255)
    COMMENT 'Mailing address street from CRM',
ADD COLUMN IF NOT EXISTS mailing_city VARCHAR(100)
    COMMENT 'Mailing address city from CRM',
ADD COLUMN IF NOT EXISTS mailing_state CHAR(2)
    COMMENT 'Mailing address state from CRM',
ADD COLUMN IF NOT EXISTS mailing_zip VARCHAR(10)
    COMMENT 'Mailing address ZIP from CRM';

-- Add index on principal_source for filtering decision makers
CREATE INDEX IF NOT EXISTS idx_principal_source ON principals(principal_source);

-- ============================================
-- ADD CRM COLUMNS TO PROPERTY_MASTER
-- ============================================

ALTER TABLE property_master
ADD COLUMN IF NOT EXISTS crm_owner_type VARCHAR(100)
    COMMENT 'PROPCO Owner Type from CRM (REIT, Private Equity, etc.)',
ADD COLUMN IF NOT EXISTS crm_notes TEXT
    COMMENT 'Research notes from CRM Description field';

-- ============================================
-- CREATE ZOHO PROPERTIES STAGING TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS zoho_properties_staging (
    record_id VARCHAR(50) PRIMARY KEY COMMENT 'Zoho Account ID (zcrm_*)',
    provider_no VARCHAR(20) COMMENT 'CCN - CMS Certification Number',
    propco_owner_type VARCHAR(100) COMMENT 'PROPCO Owner Type classification',
    affiliated_entity_name VARCHAR(255) COMMENT 'Affiliated Entity Name from CRM',
    description TEXT COMMENT 'Description/research notes',
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_provider_no (provider_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- CREATE ZOHO PRINCIPALS STAGING TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS zoho_principals_staging (
    record_id VARCHAR(50) PRIMARY KEY COMMENT 'Zoho Contact ID (zcrm_*)',
    principal_name VARCHAR(255) COMMENT 'Principal Name from CRM',
    normalized_name VARCHAR(255) COMMENT 'Normalized name for matching',
    related_group VARCHAR(255) COMMENT 'RELATED GROUP - company affiliation',
    num_properties INT COMMENT 'No. of Properties from CRM',
    states_owned VARCHAR(255) COMMENT 'States owned in from CRM',
    principal_types TEXT COMMENT 'PRINCIPLE TYPE- SELECT ALL',
    quick_notes TEXT COMMENT 'Quick notes from CRM',
    mailing_street VARCHAR(255) COMMENT 'Mailing Street',
    mailing_street_2 VARCHAR(255) COMMENT 'Mailing Street 2',
    mailing_city VARCHAR(100) COMMENT 'Mailing City',
    mailing_state CHAR(2) COMMENT 'Mailing State',
    mailing_zip VARCHAR(10) COMMENT 'Mailing Zip',
    tag VARCHAR(500) COMMENT 'Tags from CRM',
    actually_spoke_to VARCHAR(10) COMMENT 'Actually Spoke to (ever)',
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_normalized_name (normalized_name),
    INDEX idx_related_group (related_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- UPDATE EXISTING CMS PRINCIPALS TO cms_only SOURCE
-- ============================================

UPDATE principals
SET principal_source = 'cms_only'
WHERE principal_source IS NULL AND zoho_contact_id IS NULL;

-- ============================================
-- DECISION MAKERS VIEW
-- ============================================

-- CRM principals = decision makers (the ones you've talked to)
CREATE OR REPLACE VIEW v_decision_makers AS
SELECT
    p.id,
    p.full_name,
    p.principal_source,
    p.crm_related_group,
    p.crm_property_count,
    p.crm_principal_types,
    p.mailing_street,
    p.mailing_city,
    p.mailing_state,
    p.mailing_zip,
    p.zoho_contact_id,
    p.email,
    p.phone,
    GROUP_CONCAT(DISTINCT c.company_name ORDER BY c.company_name SEPARATOR '; ') as companies,
    GROUP_CONCAT(DISTINCT c.company_type ORDER BY c.company_type SEPARATOR '; ') as company_types,
    COUNT(DISTINCT c.id) as company_count
FROM principals p
LEFT JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
LEFT JOIN companies c ON c.id = pcr.company_id
WHERE p.principal_source IN ('crm_only', 'both')
GROUP BY p.id;

-- ============================================
-- VALIDATION
-- ============================================

SELECT 'Zoho CRM Integration Schema Complete' as status;

SELECT
    'principals' as table_name,
    COUNT(*) as total_rows,
    SUM(CASE WHEN principal_source = 'cms_only' THEN 1 ELSE 0 END) as cms_only,
    SUM(CASE WHEN principal_source = 'crm_only' THEN 1 ELSE 0 END) as crm_only,
    SUM(CASE WHEN principal_source = 'both' THEN 1 ELSE 0 END) as both_sources,
    SUM(CASE WHEN principal_source IS NULL THEN 1 ELSE 0 END) as null_source
FROM principals;

SELECT
    'property_master' as table_name,
    COUNT(*) as total_rows,
    SUM(CASE WHEN zoho_account_id IS NOT NULL THEN 1 ELSE 0 END) as with_zoho_id,
    SUM(CASE WHEN crm_owner_type IS NOT NULL THEN 1 ELSE 0 END) as with_owner_type
FROM property_master;
