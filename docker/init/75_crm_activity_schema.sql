-- 3G Healthcare Real Estate Atlas - CRM Activity Schema
-- Stores Notes, Calls, Tasks, Deals from Zoho CRM exports
-- Links to principals and properties via zoho_contact_id and zoho_account_id

USE atlas;

-- ============================================
-- 1. CRM_NOTES - Activity notes linked to principals
-- ============================================

CREATE TABLE IF NOT EXISTS crm_notes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    zoho_record_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'Zoho Note Record ID (zcrm_*)',

    -- Principal linkage (dual ID storage)
    principal_id INT UNSIGNED DEFAULT NULL COMMENT 'Resolved Atlas principal ID',
    zoho_contact_id VARCHAR(50) DEFAULT NULL COMMENT 'Original Zoho Contact ID from Parent ID.id',
    parent_name VARCHAR(255) DEFAULT NULL COMMENT 'Original parent name from CRM',

    -- Note content
    note_title VARCHAR(255) DEFAULT NULL,
    note_content TEXT DEFAULT NULL,

    -- Ownership/audit
    created_by_name VARCHAR(100) DEFAULT NULL COMMENT 'Created By (CRM user name)',
    created_by_zoho_id VARCHAR(50) DEFAULT NULL COMMENT 'Created By.id',
    note_owner_name VARCHAR(100) DEFAULT NULL COMMENT 'Note Owner (CRM user)',
    note_owner_zoho_id VARCHAR(50) DEFAULT NULL COMMENT 'Note Owner.id',

    -- Timestamps
    created_time DATETIME DEFAULT NULL COMMENT 'Original CRM created time',
    modified_time DATETIME DEFAULT NULL COMMENT 'Original CRM modified time',
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When imported to Atlas',

    -- Indexes
    INDEX idx_principal_id (principal_id),
    INDEX idx_zoho_contact_id (zoho_contact_id),
    INDEX idx_created_time (created_time),

    -- Foreign key (nullable for unresolved)
    CONSTRAINT fk_crm_notes_principal FOREIGN KEY (principal_id)
        REFERENCES principals(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================
-- 2. CRM_CALLS - Call activity logs
-- ============================================

CREATE TABLE IF NOT EXISTS crm_calls (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    zoho_record_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'Zoho Call Record ID (zcrm_*)',

    -- Principal linkage (dual ID storage)
    principal_id INT UNSIGNED DEFAULT NULL COMMENT 'Resolved Atlas principal ID',
    zoho_contact_id VARCHAR(50) DEFAULT NULL COMMENT 'Original Zoho Contact ID from Contact Name.id',
    contact_name VARCHAR(255) DEFAULT NULL COMMENT 'Original contact name from CRM',

    -- Property linkage (dual ID storage)
    property_master_id INT UNSIGNED DEFAULT NULL COMMENT 'Resolved Atlas property ID',
    zoho_related_to_id VARCHAR(50) DEFAULT NULL COMMENT 'Original Zoho Account ID from Related To.id',
    related_to_name VARCHAR(255) DEFAULT NULL COMMENT 'Original property/account name from CRM',

    -- Call details
    subject VARCHAR(500) DEFAULT NULL,
    call_type ENUM('inbound', 'outbound', 'missed') DEFAULT NULL,
    call_purpose VARCHAR(100) DEFAULT NULL,
    call_start_time DATETIME DEFAULT NULL,
    call_duration_seconds INT UNSIGNED DEFAULT 0,
    description TEXT DEFAULT NULL,
    call_result VARCHAR(100) DEFAULT NULL,
    call_status VARCHAR(50) DEFAULT NULL COMMENT 'Scheduled, Completed, Overdue, etc.',

    -- Ownership/audit
    call_owner_name VARCHAR(100) DEFAULT NULL,
    call_owner_zoho_id VARCHAR(50) DEFAULT NULL,
    created_by_name VARCHAR(100) DEFAULT NULL,
    created_by_zoho_id VARCHAR(50) DEFAULT NULL,

    -- Timestamps
    created_time DATETIME DEFAULT NULL,
    modified_time DATETIME DEFAULT NULL,
    last_activity_time DATETIME DEFAULT NULL,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_principal_id (principal_id),
    INDEX idx_property_id (property_master_id),
    INDEX idx_zoho_contact_id (zoho_contact_id),
    INDEX idx_call_start_time (call_start_time),
    INDEX idx_call_type (call_type),

    -- Foreign keys
    CONSTRAINT fk_crm_calls_principal FOREIGN KEY (principal_id)
        REFERENCES principals(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_crm_calls_property FOREIGN KEY (property_master_id)
        REFERENCES property_master(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================
-- 3. CRM_TASKS - Follow-up tasks
-- ============================================

CREATE TABLE IF NOT EXISTS crm_tasks (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    zoho_record_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'Zoho Task Record ID (zcrm_*)',

    -- Principal linkage
    principal_id INT UNSIGNED DEFAULT NULL,
    zoho_contact_id VARCHAR(50) DEFAULT NULL COMMENT 'From Contact Name.id',
    contact_name VARCHAR(255) DEFAULT NULL,

    -- Property linkage
    property_master_id INT UNSIGNED DEFAULT NULL,
    zoho_related_to_id VARCHAR(50) DEFAULT NULL COMMENT 'From Related To.id',
    related_to_name VARCHAR(255) DEFAULT NULL,

    -- Task details
    subject VARCHAR(500) DEFAULT NULL,
    description TEXT DEFAULT NULL,
    due_date DATE DEFAULT NULL,
    status ENUM('not_started', 'deferred', 'in_progress', 'completed', 'waiting') DEFAULT 'not_started',
    priority ENUM('low', 'normal', 'high') DEFAULT 'normal',
    closed_time DATETIME DEFAULT NULL,

    -- Ownership/audit
    task_owner_name VARCHAR(100) DEFAULT NULL,
    task_owner_zoho_id VARCHAR(50) DEFAULT NULL,
    created_by_name VARCHAR(100) DEFAULT NULL,
    created_by_zoho_id VARCHAR(50) DEFAULT NULL,

    -- Timestamps
    created_time DATETIME DEFAULT NULL,
    modified_time DATETIME DEFAULT NULL,
    last_activity_time DATETIME DEFAULT NULL,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_principal_id (principal_id),
    INDEX idx_property_id (property_master_id),
    INDEX idx_due_date (due_date),
    INDEX idx_status (status),

    -- Foreign keys
    CONSTRAINT fk_crm_tasks_principal FOREIGN KEY (principal_id)
        REFERENCES principals(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_crm_tasks_property FOREIGN KEY (property_master_id)
        REFERENCES property_master(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================
-- 4. CRM_DEALS - CRM pipeline deals (separate from Atlas transaction deals)
-- ============================================

CREATE TABLE IF NOT EXISTS crm_deals (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    zoho_record_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'Zoho Deal Record ID (zcrm_*)',

    -- Principal linkage
    principal_id INT UNSIGNED DEFAULT NULL,
    zoho_principal_id VARCHAR(50) DEFAULT NULL COMMENT 'From Principal Name.id',
    principal_name VARCHAR(255) DEFAULT NULL,

    -- Property linkage
    property_master_id INT UNSIGNED DEFAULT NULL,
    zoho_property_id VARCHAR(50) DEFAULT NULL COMMENT 'From Property Name.id',
    property_name VARCHAR(255) DEFAULT NULL,

    -- Deal details
    deal_name VARCHAR(500) DEFAULT NULL,
    deal_type ENUM('portfolio_sale', 'single_asset_sale', 'unknown') DEFAULT 'unknown',
    stage VARCHAR(100) DEFAULT NULL COMMENT 'Raw CRM stage value',
    amount DECIMAL(15, 2) DEFAULT NULL,
    probability_pct TINYINT UNSIGNED DEFAULT NULL,
    closing_date DATE DEFAULT NULL,
    next_step TEXT DEFAULT NULL,
    description TEXT DEFAULT NULL,

    -- Portfolio details
    num_facilities INT UNSIGNED DEFAULT NULL,
    states_in_deal VARCHAR(255) DEFAULT NULL,

    -- Financial details (if available)
    earnest_money_due_date DATE DEFAULT NULL,
    earnest_money_amount DECIMAL(15, 2) DEFAULT NULL,
    purchase_price DECIMAL(15, 2) DEFAULT NULL,
    due_diligence_end_date DATE DEFAULT NULL,
    closing_date_per_psa DATE DEFAULT NULL,
    commission_rate DECIMAL(5, 2) DEFAULT NULL,
    expected_commission DECIMAL(15, 2) DEFAULT NULL,
    closing_price DECIMAL(15, 2) DEFAULT NULL,

    -- Ownership/audit
    deal_owner_name VARCHAR(100) DEFAULT NULL,
    deal_owner_zoho_id VARCHAR(50) DEFAULT NULL,

    -- Timestamps
    created_time DATETIME DEFAULT NULL,
    modified_time DATETIME DEFAULT NULL,
    last_activity_time DATETIME DEFAULT NULL,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_principal_id (principal_id),
    INDEX idx_property_id (property_master_id),
    INDEX idx_stage (stage),
    INDEX idx_deal_type (deal_type),
    INDEX idx_closing_date (closing_date),

    -- Foreign keys
    CONSTRAINT fk_crm_deals_principal FOREIGN KEY (principal_id)
        REFERENCES principals(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_crm_deals_property FOREIGN KEY (property_master_id)
        REFERENCES property_master(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================
-- 5. CRM_DEAL_STAGES - Stage progression history
-- ============================================

CREATE TABLE IF NOT EXISTS crm_deal_stages (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    zoho_record_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'Zoho Deal Stage Record ID (zcrm_*)',

    -- Deal linkage
    crm_deal_id INT UNSIGNED DEFAULT NULL COMMENT 'Resolved Atlas crm_deals ID',
    zoho_deal_id VARCHAR(50) DEFAULT NULL COMMENT 'From Deal Name.id',
    deal_name VARCHAR(500) DEFAULT NULL,

    -- Stage details
    stage VARCHAR(100) DEFAULT NULL,
    stage_duration_days INT UNSIGNED DEFAULT NULL COMMENT 'Calendar days in this stage',
    probability_pct TINYINT UNSIGNED DEFAULT NULL,
    moved_to VARCHAR(100) DEFAULT NULL COMMENT 'Next stage moved to',

    -- Financial snapshot at this stage
    amount DECIMAL(15, 2) DEFAULT NULL,
    expected_revenue DECIMAL(15, 2) DEFAULT NULL,
    closing_date DATE DEFAULT NULL,

    -- Audit
    modified_by_name VARCHAR(100) DEFAULT NULL,
    modified_by_zoho_id VARCHAR(50) DEFAULT NULL,
    modified_time DATETIME DEFAULT NULL,

    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_crm_deal_id (crm_deal_id),
    INDEX idx_zoho_deal_id (zoho_deal_id),
    INDEX idx_stage (stage),

    -- Foreign key
    CONSTRAINT fk_crm_deal_stages_deal FOREIGN KEY (crm_deal_id)
        REFERENCES crm_deals(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================
-- 6. CRM_PRINCIPAL_PROPERTIES_STAGING - Junction for validation
-- ============================================

CREATE TABLE IF NOT EXISTS crm_principal_properties_staging (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    zoho_record_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'Zoho Junction Record ID (zcrm_*)',

    -- Original Zoho IDs
    zoho_principal_id VARCHAR(50) DEFAULT NULL COMMENT 'From Principal.id',
    zoho_property_id VARCHAR(50) DEFAULT NULL COMMENT 'From Properties.id',

    -- Original names for reference
    principal_name VARCHAR(255) DEFAULT NULL,
    property_name VARCHAR(255) DEFAULT NULL,

    -- CRM relationship details
    principal_type VARCHAR(100) DEFAULT NULL COMMENT 'Type1, Type2, etc.',
    license_number VARCHAR(50) DEFAULT NULL,

    -- Resolved Atlas IDs (populated during validation)
    resolved_principal_id INT UNSIGNED DEFAULT NULL,
    resolved_property_id INT UNSIGNED DEFAULT NULL,

    -- Validation status
    validation_status ENUM('pending', 'matched', 'principal_only', 'property_only', 'unmatched', 'conflict') DEFAULT 'pending',
    validation_notes TEXT DEFAULT NULL,

    -- Timestamps
    created_time DATETIME DEFAULT NULL,
    modified_time DATETIME DEFAULT NULL,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    validated_at DATETIME DEFAULT NULL,

    -- Indexes
    INDEX idx_zoho_principal_id (zoho_principal_id),
    INDEX idx_zoho_property_id (zoho_property_id),
    INDEX idx_validation_status (validation_status),
    INDEX idx_license_number (license_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================
-- VALIDATION
-- ============================================

SELECT 'CRM Activity Schema Complete' as status;

SELECT
    'crm_notes' as table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'atlas' AND table_name = 'crm_notes') as columns
UNION ALL
SELECT 'crm_calls', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'atlas' AND table_name = 'crm_calls')
UNION ALL
SELECT 'crm_tasks', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'atlas' AND table_name = 'crm_tasks')
UNION ALL
SELECT 'crm_deals', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'atlas' AND table_name = 'crm_deals')
UNION ALL
SELECT 'crm_deal_stages', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'atlas' AND table_name = 'crm_deal_stages')
UNION ALL
SELECT 'crm_principal_properties_staging', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'atlas' AND table_name = 'crm_principal_properties_staging');
