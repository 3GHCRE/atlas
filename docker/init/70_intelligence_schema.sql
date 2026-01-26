-- =====================================================
-- Phase 7: Intelligence Tools Schema
-- SEC EDGAR and ProPublica integration columns
-- =====================================================

-- Add SEC/IRS identifiers to companies table
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sec_cik VARCHAR(10) NULL COMMENT 'SEC Central Index Key (10 digits with leading zeros)',
  ADD COLUMN IF NOT EXISTS sec_ticker VARCHAR(10) NULL COMMENT 'Stock ticker symbol',
  ADD COLUMN IF NOT EXISTS irs_ein VARCHAR(9) NULL COMMENT '9-digit IRS Employer ID Number',
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE COMMENT 'Whether company is publicly traded',
  ADD COLUMN IF NOT EXISTS is_nonprofit BOOLEAN DEFAULT FALSE COMMENT 'Whether company is a nonprofit (501c3)';

-- Create indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_companies_sec_cik ON companies(sec_cik);
CREATE INDEX IF NOT EXISTS idx_companies_sec_ticker ON companies(sec_ticker);
CREATE INDEX IF NOT EXISTS idx_companies_irs_ein ON companies(irs_ein);
CREATE INDEX IF NOT EXISTS idx_companies_is_public ON companies(is_public);
CREATE INDEX IF NOT EXISTS idx_companies_is_nonprofit ON companies(is_nonprofit);

-- Create intelligence cache table for API response caching
CREATE TABLE IF NOT EXISTS intelligence_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source ENUM('sec', 'propublica', 'state') NOT NULL COMMENT 'Data source',
  source_id VARCHAR(50) NOT NULL COMMENT 'External ID (CIK, EIN, etc.)',
  data_type VARCHAR(50) NOT NULL COMMENT 'Type of cached data (company, filings, 990, etc.)',
  data JSON NOT NULL COMMENT 'Cached API response',
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When data was fetched',
  expires_at TIMESTAMP NULL COMMENT 'When cache expires (NULL = never)',
  UNIQUE KEY source_lookup (source, source_id, data_type),
  INDEX idx_cache_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed known REIT data
-- These are the known public REITs in the Atlas database with their SEC CIKs
UPDATE companies SET sec_cik = '0000888491', sec_ticker = 'OHI', is_public = TRUE
WHERE id = 14598 AND company_name LIKE '%Omega Healthcare%';

UPDATE companies SET sec_cik = '0001492298', sec_ticker = 'SBRA', is_public = TRUE
WHERE id = 14603 AND company_name LIKE '%Sabra%';

UPDATE companies SET sec_cik = '0000766704', sec_ticker = 'WELL', is_public = TRUE
WHERE id = 14599 AND company_name LIKE '%Welltower%';

UPDATE companies SET sec_cik = '0001590717', sec_ticker = 'CTRE', is_public = TRUE
WHERE id = 14601 AND company_name LIKE '%CareTrust%';

UPDATE companies SET sec_cik = '0000887905', sec_ticker = 'LTC', is_public = TRUE
WHERE id = 14625 AND company_name LIKE '%LTC Properties%';

UPDATE companies SET sec_cik = '0000810765', sec_ticker = 'NHC', is_public = TRUE
WHERE id = 14615 AND company_name LIKE '%NHC%';

UPDATE companies SET sec_cik = '0000740260', sec_ticker = 'VTR', is_public = TRUE
WHERE id = 15515 AND company_name LIKE '%Ventas%';

-- Verify updates
SELECT id, company_name, sec_cik, sec_ticker, is_public
FROM companies
WHERE is_public = TRUE
ORDER BY company_name;
