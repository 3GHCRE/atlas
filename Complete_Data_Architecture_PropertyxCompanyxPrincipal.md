# Complete Data Architecture: Property Master Linking + Many-to-Many Company Relationships
## CCN ↔ REAPI ID ↔ Zoho ID + OpCo/PropCo/Management Companies

---

## CRITICAL COMPLEXITY: The Full Graph Structure

**THE KEY INSIGHT:** One property can have MULTIPLE companies simultaneously, each with DIFFERENT roles and DIFFERENT principal portfolios.

```
EXAMPLE: St. Mary's Nursing Home (CCN 015432)
│
├─> COMPANY A: "ABC Real Estate Holdings" (PROPCO/LANDLORD)
│   ├─ Relationship: PROPERTY_OWNER (owns the real estate)
│   ├─ Principals: John Smith (CEO), Jane Doe (CFO)
│   ├─ Ownership Portfolio: 150 properties (50 NH, 100 commercial)
│   └─ Data Source: REAPI (Owner1Full field)
│
├─> COMPANY B: "XYZ Healthcare Operations" (OPCO/OPERATOR)
│   ├─ Relationship: FACILITY_OPERATOR (runs the nursing home)
│   ├─ Principals: Mike Chen (President), Sarah Lee (COO)
│   ├─ Operating Portfolio: 75 nursing homes (only owns 10, leases 65)
│   └─ Data Source: CMS (Affiliated Entity)
│
└─> COMPANY C: "Premier Management Services" (MANAGEMENT CO)
    ├─ Relationship: MANAGEMENT_SERVICES (provides admin/consulting)
    ├─ Principals: David Brown (Managing Partner)
    ├─ Service Portfolio: 200 facilities nationwide
    └─ Data Source: CMS (Owner with ROLE = Management Services)

RESULT: 
- ONE property
- THREE companies
- SEVEN principals
- NONE of the portfolios overlap perfectly
- Operating portfolio ≠ Ownership portfolio ≠ Management portfolio
```

**The Complexity Malcolm Is Emphasizing:**
- Company A (landlord) owns 150 properties but only 50 are nursing homes
- Company B (operator) runs 75 nursing homes but only owns 10 of them
- 65 of Company B's facilities are LEASED from OTHER landlords (like Company A)
- John Smith may be a principal in BOTH Company A and Company B
- Each company has its OWN principal list
- Each company has its OWN property portfolio

---

## Phase 1: Master Property Linking Table

### Purpose
**Single source of truth** that links all three identifier systems together.

### Schema

```sql
CREATE TABLE property_master (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Three Core Identifiers (The Rosetta Stone)
    ccn VARCHAR(10) NOT NULL UNIQUE COMMENT 'CMS Certification Number',
    reapi_property_id INT UNSIGNED UNIQUE COMMENT 'REAPI Property ID',
    zoho_account_id VARCHAR(50) UNIQUE COMMENT 'Zoho CRM Account/Property Record ID',
    
    -- Property Basic Info
    facility_name VARCHAR(255) NOT NULL,
    address VARCHAR(500),
    city VARCHAR(100),
    state CHAR(2),
    zip VARCHAR(10),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Metadata
    data_quality_score DECIMAL(3, 2) COMMENT 'Confidence score for ID linkages (0.00-1.00)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_synced_from_zoho TIMESTAMP NULL,
    last_synced_from_cms TIMESTAMP NULL,
    last_synced_from_reapi TIMESTAMP NULL,
    
    -- Indexes for fast lookups
    INDEX idx_ccn (ccn),
    INDEX idx_reapi (reapi_property_id),
    INDEX idx_zoho (zoho_account_id),
    INDEX idx_location (state, city),
    INDEX idx_name (facility_name)
    
) ENGINE=InnoDB COMMENT='Master linking table - every facility has CCN, REAPI ID, and Zoho ID';
```

### Critical Notes on ID Linkage

**CCN ↔ REAPI Property ID:**
- Linked via `Reapi_Nursing_Homes` table in 3G's database
- Field: `reapi_nursing_homes.ccn = cms_facilities_monthly.ccn`
- Coverage: ~90% (verified one-to-one relationships)
- This linkage is STABLE and production-ready

**CCN ↔ Zoho Account ID:**
- Populated from Zoho CRM sync
- Zoho Account represents the property/facility record
- User manually entered CCN in Zoho → We match to CMS data
- OR we push CCN to Zoho during initial data load

**REAPI Property ID ↔ Zoho Account ID:**
- Transitive link via CCN
- If CCN links both, then all three are linked

### ETL Logic for Master Linking Table

```python
def build_property_master():
    """
    Build master property linking table from three data sources.
    Priority: Start with CMS (most comprehensive), then add REAPI and Zoho IDs.
    """
    
    # Step 1: Load from CMS (primary source - 15K facilities)
    INSERT INTO property_master (ccn, facility_name, address, city, state, zip)
    SELECT 
        ccn,
        provider_name as facility_name,
        provider_address as address,
        provider_city as city,
        provider_state as state,
        provider_zip_code as zip
    FROM cms_facilities_monthly
    WHERE ccn IS NOT NULL;
    
    # Step 2: Add REAPI Property IDs where linkage exists
    UPDATE property_master pm
    JOIN reapi_nursing_homes rnh ON rnh.ccn = pm.ccn
    SET pm.reapi_property_id = rnh.property_id,
        pm.last_synced_from_reapi = NOW();
    
    # Step 3: Add Zoho Account IDs from CRM sync
    UPDATE property_master pm
    JOIN zoho_accounts za ON za.ccn = pm.ccn
    SET pm.zoho_account_id = za.zoho_account_id,
        pm.last_synced_from_zoho = NOW();
    
    # Step 4: Calculate data quality score
    UPDATE property_master
    SET data_quality_score = (
        CASE WHEN ccn IS NOT NULL THEN 0.33 ELSE 0 END +
        CASE WHEN reapi_property_id IS NOT NULL THEN 0.33 ELSE 0 END +
        CASE WHEN zoho_account_id IS NOT NULL THEN 0.34 ELSE 0 END
    );
```

---

## Phase 2: Zoho CRM Module Structure

### Current Zoho Structure (What Exists)

**Modules:**
1. **Accounts** (or Properties) - Facility records
2. **Contacts** (or Principals) - Individual people
3. **PrincipalxProperty** - Junction module (already exists)

**Junction Table Pattern:**
```
PrincipalxProperty (Linking Module)
├─ Principal_Lookup (relates to Contacts/Principals)
├─ Property_Lookup (relates to Accounts/Properties)
└─ Relationship metadata (role, effective_date, etc.)
```

### NEW Zoho Structure (What We're Adding)

**New Module:**
4. **Companies** - Company/entity records

**New Junction Modules:**
5. **CompanyxProperty** - Links companies to properties with ROLE
6. **CompanyxPrincipal** - Links principals to companies with ROLE

### Schema Design: Companies Module

**Zoho CRM Custom Module: "Companies"**

| Field Name | Field Type | Description |
|------------|------------|-------------|
| Company_Name | Text | Legal business name |
| Company_Type | Picklist | Opco, Propco, Management Co, Holding Co, PE Firm, REIT |
| DBA_Name | Text | Doing business as name |
| EIN | Text | Employer Identification Number |
| CMS_Affiliated_Entity_ID | Number | Links to CMS affiliated entity |
| Company_Address | Address | Headquarters address |
| Company_State | Text | State of incorporation |
| Primary_Contact | Lookup (Contacts) | Main contact person |
| Website | URL | Company website |
| Notes | Text Area | Additional info |

### Schema Design: CompanyxProperty Junction Module

**Critical Field: ROLE determines the TYPE of relationship**

**Zoho CRM Junction Module: "CompanyxProperty"**

| Field Name | Field Type | Description | Example Values |
|------------|------------|-------------|----------------|
| Property_Lookup | Lookup (Accounts/Properties) | Property record | St. Mary's Nursing Home |
| Company_Lookup | Lookup (Companies) | Company record | ABC Real Estate Holdings |
| Relationship_Type | Picklist | **TYPE OF RELATIONSHIP** | Property Owner, Facility Operator, Management Services, Lender, Consultant |
| Ownership_Percentage | Decimal | % ownership (if applicable) | 100.00, 50.00, 25.00 |
| Effective_Date | Date | When relationship started | 2020-01-15 |
| End_Date | Date | When relationship ended (NULL = current) | NULL or 2024-12-31 |
| Data_Source | Picklist | Where this came from | CMS, REAPI, Manual Entry |
| Verified | Checkbox | Human-verified relationship | True/False |
| Notes | Text Area | Additional context | "Lease agreement expires 2025" |

**Relationship Type Picklist Values:**
- **Property Owner** (Propco / Landlord)
- **Facility Operator** (Opco / Runs the nursing home)
- **Management Services** (Admin/consulting services)
- **Lender** (Mortgage holder)
- **Parent Company** (Corporate parent)
- **Affiliate** (Related entity)
- **Consultant** (Advisory services)
- **Other**

### Schema Design: CompanyxPrincipal Junction Module

**Zoho CRM Junction Module: "CompanyxPrincipal"**

| Field Name | Field Type | Description | Example Values |
|------------|------------|-------------|----------------|
| Principal_Lookup | Lookup (Contacts/Principals) | Individual person | John Smith |
| Company_Lookup | Lookup (Companies) | Company record | ABC Real Estate Holdings |
| Role | Picklist | Principal's role in company | CEO, President, CFO, Board Member, Managing Partner, Owner (5%+) |
| Ownership_Percentage | Decimal | % ownership stake | 25.00, 10.00 |
| Effective_Date | Date | When they assumed this role | 2018-03-01 |
| End_Date | Date | When they left (NULL = current) | NULL |
| Is_Primary | Checkbox | Primary decision maker | True/False |
| Data_Source | Picklist | Where this came from | CMS, Manual Entry |

**Role Picklist Values:**
- **CEO / Chief Executive Officer**
- **President**
- **CFO / Chief Financial Officer**
- **COO / Chief Operating Officer**
- **Board Member / Director**
- **Managing Partner**
- **General Partner**
- **Limited Partner**
- **Owner (5%+ Direct Ownership)**
- **Owner (5%+ Indirect Ownership)**
- **Other**

---

## Phase 3: SQL Database Schema (MySQL)

**The SQL database mirrors the Zoho structure but optimized for querying.**

### Companies Table

```sql
CREATE TABLE companies (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Company Identity
    company_name VARCHAR(255) NOT NULL,
    company_type ENUM('opco', 'propco', 'management', 'holding', 'pe_firm', 'reit', 'other') NOT NULL,
    dba_name VARCHAR(255),
    ein VARCHAR(20),
    
    -- CMS Linkage
    cms_affiliated_entity_id VARCHAR(50) COMMENT 'Links to CMS affiliated entity',
    cms_affiliated_entity_name VARCHAR(255),
    
    -- Location
    address VARCHAR(500),
    city VARCHAR(100),
    state CHAR(2),
    zip VARCHAR(10),
    state_of_incorporation CHAR(2),
    
    -- Contact
    primary_contact_principal_id INT UNSIGNED COMMENT 'FK to principals table',
    website VARCHAR(500),
    
    -- CRM Linkage
    zoho_company_id VARCHAR(50) UNIQUE COMMENT 'Zoho Companies module record ID',
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_synced_from_zoho TIMESTAMP NULL,
    notes TEXT,
    
    -- Indexes
    INDEX idx_name (company_name),
    INDEX idx_type (company_type),
    INDEX idx_cms_entity (cms_affiliated_entity_id),
    INDEX idx_zoho (zoho_company_id),
    INDEX idx_state (state),
    
    -- Foreign Keys
    FOREIGN KEY (primary_contact_principal_id) REFERENCES principals(id)
    
) ENGINE=InnoDB COMMENT='Company/entity master table - Opcos, Propcos, Management Cos, etc.';
```

### Property-Company Junction Table

```sql
CREATE TABLE property_company_relationships (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- The Two Entities Being Linked
    property_master_id INT UNSIGNED NOT NULL,
    company_id INT UNSIGNED NOT NULL,
    
    -- The Relationship Type (THE CRITICAL FIELD)
    relationship_type ENUM(
        'property_owner',        -- Propco/Landlord
        'facility_operator',     -- Opco/Runs the facility
        'management_services',   -- Admin/consulting
        'lender',                -- Mortgage holder
        'parent_company',        -- Corporate parent
        'affiliate',             -- Related entity
        'consultant',            -- Advisory
        'other'
    ) NOT NULL,
    
    -- Relationship Details
    ownership_percentage DECIMAL(5, 2) COMMENT '0.00 to 100.00',
    effective_date DATE NOT NULL,
    end_date DATE DEFAULT NULL COMMENT 'NULL = current relationship',
    
    -- Data Provenance
    data_source ENUM('cms', 'reapi', 'zoho', 'manual', 'web_scrape') NOT NULL,
    verified BOOLEAN DEFAULT FALSE COMMENT 'Human-verified',
    
    -- CRM Linkage
    zoho_junction_record_id VARCHAR(50) UNIQUE COMMENT 'Zoho CompanyxProperty record ID',
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    notes TEXT,
    
    -- Indexes (Critical for Graph Navigation)
    INDEX idx_property_current (property_master_id, end_date),
    INDEX idx_company_current (company_id, end_date),
    INDEX idx_relationship_type (relationship_type),
    INDEX idx_data_source (data_source),
    INDEX idx_property_company_type (property_master_id, relationship_type),
    INDEX idx_zoho (zoho_junction_record_id),
    
    -- Foreign Keys
    FOREIGN KEY (property_master_id) REFERENCES property_master(id),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    
    -- Unique Constraint (Can't have duplicate active relationships of same type)
    UNIQUE KEY unique_active_relationship (property_master_id, company_id, relationship_type, end_date)
    
) ENGINE=InnoDB COMMENT='Many-to-many: Properties ↔ Companies with ROLE field';
```

### Principal-Company Junction Table

```sql
CREATE TABLE principal_company_relationships (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- The Two Entities Being Linked
    principal_id INT UNSIGNED NOT NULL,
    company_id INT UNSIGNED NOT NULL,
    
    -- The Relationship Type
    role ENUM(
        'ceo',
        'president',
        'cfo',
        'coo',
        'board_member',
        'managing_partner',
        'general_partner',
        'limited_partner',
        'owner_direct',         -- 5%+ direct ownership
        'owner_indirect',       -- 5%+ indirect ownership
        'officer',
        'manager',
        'member',
        'other'
    ) NOT NULL,
    
    -- Relationship Details
    ownership_percentage DECIMAL(5, 2) COMMENT '0.00 to 100.00',
    effective_date DATE,
    end_date DATE DEFAULT NULL COMMENT 'NULL = current relationship',
    is_primary BOOLEAN DEFAULT FALSE COMMENT 'Primary decision maker for this company',
    
    -- Data Provenance
    data_source ENUM('cms', 'zoho', 'manual', 'web_scrape', 'sos_filing') NOT NULL,
    
    -- CRM Linkage
    zoho_junction_record_id VARCHAR(50) UNIQUE COMMENT 'Zoho CompanyxPrincipal record ID',
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes (Critical for Graph Navigation)
    INDEX idx_principal_current (principal_id, end_date),
    INDEX idx_company_current (company_id, end_date),
    INDEX idx_role (role),
    INDEX idx_zoho (zoho_junction_record_id),
    
    -- Foreign Keys
    FOREIGN KEY (principal_id) REFERENCES principals(id),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    
    -- Unique Constraint
    UNIQUE KEY unique_active_role (principal_id, company_id, role, end_date)
    
) ENGINE=InnoDB COMMENT='Many-to-many: Principals ↔ Companies with ROLE field';
```

### Principals Table (For Completeness)

```sql
CREATE TABLE principals (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Identity
    first_name VARCHAR(100),
    last_name VARCHAR(100) NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    normalized_full_name VARCHAR(200) NOT NULL COMMENT 'For fuzzy matching',
    
    -- Contact
    email VARCHAR(255),
    phone VARCHAR(50),
    linkedin_url VARCHAR(500),
    
    -- CRM Linkage
    zoho_contact_id VARCHAR(50) UNIQUE COMMENT 'Zoho Contacts/Principals record ID',
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_name (normalized_full_name),
    INDEX idx_zoho (zoho_contact_id),
    UNIQUE KEY unique_normalized_name (normalized_full_name)
    
) ENGINE=InnoDB COMMENT='Individual people - principals, owners, officers';
```

---

## Phase 4: Zoho API Integration - Fetching Related Records

### How Zoho Related Records Work

**Zoho uses "Linking Modules" for many-to-many relationships.**

When you create a junction module like `CompanyxProperty`, Zoho automatically creates a linking table behind the scenes that stores:
- The parent record ID (e.g., Property ID)
- The related record ID (e.g., Company ID)
- Any custom fields you added to the junction module (e.g., Relationship_Type, Ownership_Percentage)

### Fetching Related Records via Zoho API

#### Step 1: Get Property Record with Its Related Companies

```python
import requests

def get_property_with_companies(zoho_property_id, access_token):
    """
    Fetch a property record and all its related company records.
    """
    
    # API endpoint for related records
    url = f"https://www.zohoapis.com/crm/v8/Accounts/{zoho_property_id}/CompanyxProperty"
    
    headers = {
        "Authorization": f"Zoho-oauthtoken {access_token}"
    }
    
    params = {
        "fields": "Company_Lookup,Relationship_Type,Ownership_Percentage,Effective_Date,End_Date",
        "per_page": 200
    }
    
    response = requests.get(url, headers=headers, params=params)
    
    if response.status_code == 200:
        data = response.json()
        companies = data.get('data', [])
        
        # Each record in 'companies' is a junction record with:
        # - Company_Lookup (the related company record)
        # - Relationship_Type (property_owner, facility_operator, etc.)
        # - Ownership_Percentage, Effective_Date, End_Date
        
        return companies
    else:
        print(f"Error: {response.status_code} - {response.text}")
        return []

# Example usage:
property_companies = get_property_with_companies("4150868000001944196", access_token)

for rel in property_companies:
    company_name = rel['Company_Lookup']['name']
    company_id = rel['Company_Lookup']['id']
    relationship = rel['Relationship_Type']
    ownership = rel.get('Ownership_Percentage', 0)
    
    print(f"{company_name} ({company_id}): {relationship} - {ownership}% ownership")
```

#### Step 2: Get Company Record with Its Related Properties

```python
def get_company_with_properties(zoho_company_id, access_token):
    """
    Fetch a company record and all its related property records.
    Returns DIFFERENT lists for each relationship type.
    """
    
    url = f"https://www.zohoapis.com/crm/v8/Companies/{zoho_company_id}/CompanyxProperty"
    
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        all_relationships = data.get('data', [])
        
        # Separate properties by relationship type
        owned_properties = []
        operated_properties = []
        managed_properties = []
        
        for rel in all_relationships:
            relationship_type = rel['Relationship_Type']
            property_record = rel['Property_Lookup']
            
            if relationship_type == 'Property Owner':
                owned_properties.append(property_record)
            elif relationship_type == 'Facility Operator':
                operated_properties.append(property_record)
            elif relationship_type == 'Management Services':
                managed_properties.append(property_record)
        
        return {
            'owned': owned_properties,
            'operated': operated_properties,
            'managed': managed_properties
        }

# Example usage:
company_portfolios = get_company_with_properties("4150868000009876543", access_token)

print(f"Properties OWNED: {len(company_portfolios['owned'])}")
print(f"Properties OPERATED: {len(company_portfolios['operated'])}")
print(f"Properties MANAGED: {len(company_portfolios['managed'])}")
```

#### Step 3: Get Principal with All Their Companies

```python
def get_principal_with_companies(zoho_principal_id, access_token):
    """
    Fetch a principal and all companies they're associated with.
    """
    
    url = f"https://www.zohoapis.com/crm/v8/Contacts/{zoho_principal_id}/CompanyxPrincipal"
    
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        relationships = data.get('data', [])
        
        companies = []
        for rel in relationships:
            companies.append({
                'company_name': rel['Company_Lookup']['name'],
                'company_id': rel['Company_Lookup']['id'],
                'role': rel['Role'],
                'ownership_percentage': rel.get('Ownership_Percentage', 0)
            })
        
        return companies
```

---

## Phase 5: Daily Zoho → SQL Sync Pipeline

### Sync Strategy

**Approach:** Daily full sync of junction records + incremental updates for master records

```python
import requests
import mysql.connector
from datetime import datetime, timedelta

class ZohoSyncPipeline:
    def __init__(self, zoho_access_token, mysql_config):
        self.zoho_token = zoho_access_token
        self.db = mysql.connector.connect(**mysql_config)
        self.cursor = self.db.cursor(dictionary=True)
    
    def sync_property_company_relationships(self):
        """
        Sync CompanyxProperty junction records from Zoho to SQL.
        """
        
        # Step 1: Get all junction records from Zoho
        url = "https://www.zohoapis.com/crm/v8/CompanyxProperty"
        headers = {"Authorization": f"Zoho-oauthtoken {self.zoho_token}"}
        params = {"per_page": 200}
        
        all_records = []
        page = 1
        
        while True:
            params['page'] = page
            response = requests.get(url, headers=headers, params=params)
            
            if response.status_code != 200:
                break
            
            data = response.json()
            records = data.get('data', [])
            
            if not records:
                break
            
            all_records.extend(records)
            page += 1
        
        # Step 2: Upsert into SQL database
        for record in all_records:
            property_zoho_id = record['Property_Lookup']['id']
            company_zoho_id = record['Company_Lookup']['id']
            relationship_type = record['Relationship_Type'].lower().replace(' ', '_')
            
            # Get SQL IDs from Zoho IDs
            property_sql_id = self.get_property_id_from_zoho(property_zoho_id)
            company_sql_id = self.get_company_id_from_zoho(company_zoho_id)
            
            if not property_sql_id or not company_sql_id:
                continue  # Skip if can't map IDs
            
            # Upsert relationship
            sql = """
                INSERT INTO property_company_relationships 
                (property_master_id, company_id, relationship_type, ownership_percentage, 
                 effective_date, end_date, data_source, zoho_junction_record_id)
                VALUES (%s, %s, %s, %s, %s, %s, 'zoho', %s)
                ON DUPLICATE KEY UPDATE
                    ownership_percentage = VALUES(ownership_percentage),
                    effective_date = VALUES(effective_date),
                    end_date = VALUES(end_date),
                    updated_at = NOW()
            """
            
            values = (
                property_sql_id,
                company_sql_id,
                relationship_type,
                record.get('Ownership_Percentage'),
                record.get('Effective_Date'),
                record.get('End_Date'),
                record['id']  # Zoho junction record ID
            )
            
            self.cursor.execute(sql, values)
        
        self.db.commit()
        print(f"Synced {len(all_records)} property-company relationships")
    
    def get_property_id_from_zoho(self, zoho_id):
        """Helper: Map Zoho Account ID to SQL property_master.id"""
        sql = "SELECT id FROM property_master WHERE zoho_account_id = %s"
        self.cursor.execute(sql, (zoho_id,))
        result = self.cursor.fetchone()
        return result['id'] if result else None
    
    def get_company_id_from_zoho(self, zoho_id):
        """Helper: Map Zoho Company ID to SQL companies.id"""
        sql = "SELECT id FROM companies WHERE zoho_company_id = %s"
        self.cursor.execute(sql, (zoho_id,))
        result = self.cursor.fetchone()
        return result['id'] if result else None
```

---

## Phase 6: Critical Graph Queries

### Query 1: Get All Companies for a Property (With Roles)

```sql
-- Get all companies related to a specific property, grouped by relationship type
SELECT 
    pm.facility_name,
    pm.ccn,
    c.company_name,
    c.company_type,
    pcr.relationship_type,
    pcr.ownership_percentage,
    pcr.data_source
FROM property_master pm
JOIN property_company_relationships pcr ON pcr.property_master_id = pm.id
JOIN companies c ON c.id = pcr.company_id
WHERE pm.ccn = '015432'
  AND pcr.end_date IS NULL  -- Current relationships only
ORDER BY pcr.relationship_type;

-- Result:
-- St. Mary's | 015432 | ABC Real Estate Holdings   | propco     | property_owner       | 100.00 | reapi
-- St. Mary's | 015432 | XYZ Healthcare Operations  | opco       | facility_operator    | NULL   | cms
-- St. Mary's | 015432 | Premier Management Services| management | management_services  | NULL   | cms
```

### Query 2: Get Company's Full Portfolio (Separated by Role)

```sql
-- Get all properties for a company, showing which ones they OWN vs OPERATE
SELECT 
    c.company_name,
    pcr.relationship_type,
    COUNT(DISTINCT pm.id) as property_count,
    GROUP_CONCAT(DISTINCT pm.facility_name SEPARATOR ', ') as sample_facilities
FROM companies c
JOIN property_company_relationships pcr ON pcr.company_id = c.id
JOIN property_master pm ON pm.id = pcr.property_master_id
WHERE c.company_name = 'XYZ Healthcare Operations'
  AND pcr.end_date IS NULL
GROUP BY c.company_name, pcr.relationship_type;

-- Result:
-- XYZ Healthcare Operations | property_owner      | 10  | Facility A, Facility B, ...
-- XYZ Healthcare Operations | facility_operator   | 75  | Facility C, Facility D, ...
```

### Query 3: Get Principal's Complete Network (All Companies + Roles)

```sql
-- Get all companies a principal is involved with and their roles
SELECT 
    pr.full_name as principal_name,
    c.company_name,
    c.company_type,
    pcr.role,
    pcr.ownership_percentage,
    COUNT(DISTINCT pcompany.property_master_id) as company_property_count
FROM principals pr
JOIN principal_company_relationships pcr ON pcr.principal_id = pr.id
JOIN companies c ON c.id = pcr.company_id
LEFT JOIN property_company_relationships pcompany ON pcompany.company_id = c.id AND pcompany.end_date IS NULL
WHERE pr.full_name = 'John Smith'
  AND pcr.end_date IS NULL
GROUP BY pr.id, c.id, pcr.role
ORDER BY c.company_name;

-- Result:
-- John Smith | ABC Real Estate Holdings   | propco | ceo           | 25.00 | 150
-- John Smith | XYZ Healthcare Operations  | opco   | board_member  | 10.00 | 75
```

### Query 4: Find Lease Relationships (Property Owner ≠ Facility Operator)

```sql
-- Find properties where the owner and operator are DIFFERENT companies
SELECT 
    pm.facility_name,
    pm.ccn,
    owner.company_name as property_owner,
    operator.company_name as facility_operator
FROM property_master pm
JOIN property_company_relationships pcr_owner 
    ON pcr_owner.property_master_id = pm.id 
    AND pcr_owner.relationship_type = 'property_owner' 
    AND pcr_owner.end_date IS NULL
JOIN companies owner ON owner.id = pcr_owner.company_id
JOIN property_company_relationships pcr_operator 
    ON pcr_operator.property_master_id = pm.id 
    AND pcr_operator.relationship_type = 'facility_operator' 
    AND pcr_operator.end_date IS NULL
JOIN companies operator ON operator.id = pcr_operator.company_id
WHERE owner.id != operator.id
LIMIT 100;

-- Result: Properties where landlord ≠ operator (lease situations)
```

---

## Phase 7: Implementation Checklist (Days 1-10)

### Day 1-2: Master Linking Table
- [ ] Create `property_master` table
- [ ] ETL from CMS → `property_master` (CCN + facility info)
- [ ] ETL from REAPI → add `reapi_property_id`
- [ ] ETL from Zoho → add `zoho_account_id`
- [ ] Calculate data quality scores
- [ ] Validate linkages (spot check 100 random properties)

### Day 3-4: Zoho CRM Setup
- [ ] Create `Companies` custom module in Zoho
- [ ] Create `CompanyxProperty` junction module with Relationship_Type field
- [ ] Create `CompanyxPrincipal` junction module with Role field
- [ ] Configure picklist values for Relationship_Type and Role
- [ ] Set up Zoho API credentials and test access

### Day 5-6: SQL Database Setup
- [ ] Create `companies` table
- [ ] Create `property_company_relationships` table
- [ ] Create `principal_company_relationships` table
- [ ] Create `principals` table (if not exists)
- [ ] Set up foreign keys and indexes
- [ ] Validate schema with test data

### Day 7-8: Initial Data Load
- [ ] Load CMS Affiliated Entities → `companies` (Opco layer)
- [ ] Link CMS facilities to companies → `property_company_relationships` (relationship_type = 'facility_operator')
- [ ] Load REAPI owners → `companies` (Propco layer)
- [ ] Link REAPI properties to owner companies → `property_company_relationships` (relationship_type = 'property_owner')
- [ ] Match CMS individual owners to principals
- [ ] Create principal-company links → `principal_company_relationships`

### Day 9-10: Zoho Sync Pipeline
- [ ] Write Python sync script for Companies module
- [ ] Write Python sync script for CompanyxProperty junction
- [ ] Write Python sync script for CompanyxPrincipal junction
- [ ] Set up daily cron job
- [ ] Test end-to-end sync
- [ ] Validate data accuracy (spot check 50 properties)

---

## Critical Success Metrics

**After Day 10, you should be able to:**

1. ✅ Query any property and see ALL its companies (owner, operator, manager)
2. ✅ Query any company and see its full portfolio (owned vs operated vs managed)
3. ✅ Query any principal and see all companies they're involved with
4. ✅ Identify lease situations (owner ≠ operator)
5. ✅ Trace ownership chains: Property → Companies → Principals
6. ✅ Sync Zoho ↔ SQL daily without data loss

**Key Validation Query:**
```sql
-- This should return data for ~15,000 properties
SELECT 
    COUNT(*) as total_properties,
    COUNT(DISTINCT zoho_account_id) as with_zoho_id,
    COUNT(DISTINCT reapi_property_id) as with_reapi_id,
    AVG(data_quality_score) as avg_quality_score
FROM property_master;
```

---

## Appendix: Example Data Flow

### Scenario: Panama City FL Property

**Data Sources:**
```
CMS Data:
  CCN: 105678
  Facility: ST ANDREWS BAY SNF & REHABILITATION
  Affiliated Entity ID: 1234
  Affiliated Entity Name: "Portopicolo Group"
  
REAPI Data:
  Property ID: 98765
  Owner1Full: "Panama City FL Propco LLC"
  OwnerAddress: "980 Sylvan Ave, Englewood Cliffs, NJ 07632"
  
Zoho Data:
  Account ID: ZA_001234
  Property Name: "St Andrews Bay SNF"
```

**Result in SQL:**

**property_master:**
| id | ccn | reapi_property_id | zoho_account_id | facility_name |
|----|-----|-------------------|-----------------|---------------|
| 1 | 105678 | 98765 | ZA_001234 | ST ANDREWS BAY SNF |

**companies:**
| id | company_name | company_type | cms_affiliated_entity_id |
|----|-------------|--------------|--------------------------|
| 100 | Portopicolo Group | opco | 1234 |
| 200 | Panama City FL Propco LLC | propco | NULL |

**property_company_relationships:**
| property_master_id | company_id | relationship_type | data_source |
|--------------------|------------|-------------------|-------------|
| 1 | 100 | facility_operator | cms |
| 1 | 200 | property_owner | reapi |

**Graph Visualization:**
```
St Andrews Bay SNF (Property)
├─> Portopicolo Group (Opco) → OPERATES the facility
│   └─> John Rosatti (Principal, CEO)
└─> Panama City FL Propco LLC (Propco) → OWNS the real estate
    └─> John Rosatti (Principal, Owner)
```

**The Insight:** John Rosatti controls BOTH the operating company AND the property company. This is a vertically integrated ownership structure.

---

## Phase 8: Deals - The Temporal Dimension

### **EXCELLENT Addition: Deals Add Critical TEMPORAL Dimension**

**The Deals Node: What It Captures**

**Definition:**
A Deal is a transaction event that creates or changes relationships between Properties and Companies.

**Deal Types:**
- **Sales** - Propco A sells property to Propco B
- **Refinances** - Borrower refinances with new lender
- **CHOWs (Change of Ownership)** - CMS-reported ownership transfers
- **New Financing** - Lender provides mortgage to borrower
- **Lease Assignments** - Operator changes (Opco A → Opco B)

**Why It Matters:**
- **Historical Context:** Shows how ownership evolved over time
- **Relationship Discovery:** Find recurring buyer/seller pairs (strategic partnerships)
- **Market Intelligence:** Track who's active in specific markets
- **Lender Networks:** Discover which lenders finance which operators
- **Transaction Velocity:** See how frequently properties change hands

### **Updated Data Model with Deals**

**New Architecture:**
```
Property ←→ Company ←→ Principal
    ↕           ↕
   Deal    (transactions)
    ↕
Lender Company
```

**Complete Graph Example:**
```
ST ANDREWS BAY SNF
│
├─ CURRENT OWNERSHIP (Static Relationships)
│  ├─ Operated by: Portopicolo Group (Opco)
│  └─ Owned by: Panama City FL Propco LLC (Propco)
│
└─ TRANSACTION HISTORY (Temporal Relationships via Deals)
   ├─ Deal #1 (2020-01-15): Original Purchase
   │  ├─ Buyer: Panama City FL Propco LLC
   │  ├─ Seller: Previous Owner LLC
   │  ├─ Lender: Regional Bank
   │  └─ Amount: $8.5M
   │
   ├─ Deal #2 (2021-06-01): Refinance
   │  ├─ Borrower: Panama City FL Propco LLC
   │  ├─ Lender: National Healthcare Capital
   │  └─ Amount: $10M
   │
   └─ Deal #3 (2022-03-15): CHOW
      ├─ Previous Operator: ABC Healthcare
      ├─ New Operator: Portopicolo Group
      └─ CMS Effective Date: 2022-03-15
```

### **The deals Table**

```sql
CREATE TABLE deals (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Deal metadata
    deal_type ENUM(
        'sale',              -- Property sale
        'refinance',         -- Mortgage refinance
        'chow',              -- CMS Change of Ownership
        'new_financing',     -- New mortgage/loan
        'lease_assignment',  -- Operator change
        'recapitalization',  -- Ownership restructuring
        'foreclosure',
        'other'
    ) NOT NULL,
    
    deal_date DATE NOT NULL,
    transaction_amount DECIMAL(15, 2),  -- Deal value
    
    -- Property
    property_master_id INT UNSIGNED,  -- Which property (can be NULL for portfolio deals)
    
    -- Document reference
    document_type VARCHAR(50),  -- 'ACRIS_DEED', 'CMS_CHOW', 'REAPI_SALE', etc.
    document_id VARCHAR(100),   -- External document ID
    document_url TEXT,          -- Link to source document
    
    -- Data provenance
    data_source ENUM('reapi', 'acris', 'cms_chow', 'manual', 'web_scrape') NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_property (property_master_id),
    INDEX idx_deal_date (deal_date),
    INDEX idx_deal_type (deal_type),
    INDEX idx_data_source (data_source),
    
    -- Foreign key
    FOREIGN KEY (property_master_id) REFERENCES property_master(id)
) ENGINE=InnoDB;
```

### **The deal_participants Table**

```sql
CREATE TABLE deal_participants (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    deal_id INT UNSIGNED NOT NULL,
    company_id INT UNSIGNED NOT NULL,
    
    -- Role in the deal
    participant_role ENUM(
        'buyer',             -- Purchased the property
        'seller',            -- Sold the property
        'lender',            -- Provided financing
        'borrower',          -- Received financing
        'previous_operator', -- Lost operating license
        'new_operator',      -- Gained operating license
        'guarantor',         -- Guaranteed the loan
        'investor',          -- Equity investor
        'broker',            -- Facilitated transaction
        'other'
    ) NOT NULL,
    
    -- Participation details
    ownership_percentage DECIMAL(5, 2),  -- For partial sales/equity deals
    investment_amount DECIMAL(15, 2),     -- Their specific contribution
    
    -- Metadata
    data_source ENUM('reapi', 'acris', 'cms_chow', 'manual', 'web_scrape') NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_deal (deal_id),
    INDEX idx_company (company_id),
    INDEX idx_role (participant_role),
    UNIQUE KEY unique_deal_company_role (deal_id, company_id, participant_role),
    
    -- Foreign keys
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
    FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;
```

### **Data Sources for Deals**

#### **1. REAPI Sales History (Already have this!)**

**Load Strategy:**
```sql
-- Create deals from REAPI sales
INSERT INTO deals (deal_type, deal_date, transaction_amount, property_master_id, data_source)
SELECT 
    'sale',
    sh.sale_date,
    sh.sale_price,
    pm.id,
    'reapi'
FROM reapi_sales_history sh
JOIN property_master pm ON pm.reapi_property_id = sh.property_id;

-- Link buyer as participant
INSERT INTO deal_participants (deal_id, company_id, participant_role, data_source)
SELECT 
    d.id,
    c.id,
    'buyer',
    'reapi'
FROM deals d
JOIN reapi_sales_history sh ON sh.property_id = d.property_master_id
JOIN companies c ON c.company_name = sh.buyer_name;

-- Link seller as participant
INSERT INTO deal_participants (deal_id, company_id, participant_role, data_source)
SELECT 
    d.id,
    c.id,
    'seller',
    'reapi'
FROM deals d
JOIN reapi_sales_history sh ON sh.property_id = d.property_master_id
JOIN companies c ON c.company_name = sh.seller_name;
```

#### **2. CMS CHOW (Change of Ownership) Data**

**What it is:** CMS requires SNFs to report ownership changes

**Load Strategy:**
```sql
-- Create CHOW deals
INSERT INTO deals (deal_type, deal_date, property_master_id, data_source, document_type)
SELECT 
    'chow',
    chow.effective_date,
    pm.id,
    'cms_chow',
    'CMS_CHOW'
FROM cms_chow_events chow
JOIN property_master pm ON pm.ccn = chow.ccn;
```

#### **3. ACRIS Mortgage Data (If you want lender relationships)**

**What it is:** Property document records (NYC-specific, but model applies elsewhere)

**Load Strategy:**
```sql
-- Create mortgage deals
INSERT INTO deals (deal_type, deal_date, transaction_amount, property_master_id, data_source)
SELECT 
    'new_financing',
    acris.recorded_date,
    acris.document_amount,
    pm.id,
    'acris'
FROM acris_documents acris
JOIN property_master pm ON pm.reapi_property_id = acris.property_id
WHERE acris.document_type = 'MTGE';
```

### **Critical Queries Enabled by Deals**

#### **Query 1: Transaction History for a Property**

```sql
SELECT 
    d.deal_date,
    d.deal_type,
    d.transaction_amount,
    buyer_c.company_name as buyer,
    seller_c.company_name as seller,
    lender_c.company_name as lender
FROM deals d
JOIN property_master pm ON pm.id = d.property_master_id
LEFT JOIN deal_participants buyer_dp ON buyer_dp.deal_id = d.id AND buyer_dp.participant_role = 'buyer'
LEFT JOIN companies buyer_c ON buyer_c.id = buyer_dp.company_id
LEFT JOIN deal_participants seller_dp ON seller_dp.deal_id = d.id AND seller_dp.participant_role = 'seller'
LEFT JOIN companies seller_c ON seller_c.id = seller_dp.company_id
LEFT JOIN deal_participants lender_dp ON lender_dp.deal_id = d.id AND lender_dp.participant_role = 'lender'
LEFT JOIN companies lender_c ON lender_c.id = lender_dp.company_id
WHERE pm.ccn = '105678'
ORDER BY d.deal_date DESC;
```

#### **Query 2: Find Buyer/Seller Relationships (Strategic Partnerships)**

```sql
-- Who buys from whom repeatedly?
SELECT 
    buyer_c.company_name as buyer,
    seller_c.company_name as seller,
    COUNT(*) as transaction_count,
    SUM(d.transaction_amount) as total_volume,
    MIN(d.deal_date) as first_deal,
    MAX(d.deal_date) as most_recent_deal
FROM deals d
JOIN deal_participants buyer_dp ON buyer_dp.deal_id = d.id AND buyer_dp.participant_role = 'buyer'
JOIN companies buyer_c ON buyer_c.id = buyer_dp.company_id
JOIN deal_participants seller_dp ON seller_dp.deal_id = d.id AND seller_dp.participant_role = 'seller'
JOIN companies seller_c ON seller_c.id = seller_dp.company_id
WHERE d.deal_type = 'sale'
GROUP BY buyer_c.id, seller_c.id
HAVING transaction_count > 1
ORDER BY transaction_count DESC, total_volume DESC;
```

#### **Query 3: Lender Relationships (Who Finances Whom)**

```sql
-- Which lenders finance which operators?
SELECT 
    lender_c.company_name as lender,
    borrower_c.company_name as borrower,
    COUNT(*) as loan_count,
    SUM(d.transaction_amount) as total_financing,
    AVG(d.transaction_amount) as avg_loan_size
FROM deals d
JOIN deal_participants lender_dp ON lender_dp.deal_id = d.id AND lender_dp.participant_role = 'lender'
JOIN companies lender_c ON lender_c.id = lender_dp.company_id
JOIN deal_participants borrower_dp ON borrower_dp.deal_id = d.id AND borrower_dp.participant_role = 'borrower'
JOIN companies borrower_c ON borrower_c.id = borrower_dp.company_id
WHERE d.deal_type IN ('new_financing', 'refinance')
GROUP BY lender_c.id, borrower_c.id
ORDER BY total_financing DESC;
```

#### **Query 4: Company Deal Activity (Acquisitions Profile)**

```sql
-- How active is a company in buying/selling?
SELECT 
    c.company_name,
    COUNT(CASE WHEN dp.participant_role = 'buyer' THEN 1 END) as properties_bought,
    COUNT(CASE WHEN dp.participant_role = 'seller' THEN 1 END) as properties_sold,
    SUM(CASE WHEN dp.participant_role = 'buyer' THEN d.transaction_amount END) as total_spent,
    SUM(CASE WHEN dp.participant_role = 'seller' THEN d.transaction_amount END) as total_received
FROM companies c
JOIN deal_participants dp ON dp.company_id = c.id
JOIN deals d ON d.id = dp.deal_id
WHERE d.deal_type = 'sale'
  AND d.deal_date >= DATE_SUB(CURRENT_DATE, INTERVAL 3 YEAR)
GROUP BY c.id
HAVING properties_bought > 0 OR properties_sold > 0
ORDER BY properties_bought DESC;
```

### **Intelligence Use Cases Unlocked by Deals**

#### **1. Contact Brief Enhancement**

**Before (without deals):**
```
John Rosatti
CEO, Portopicolo Group
Controls 75 facilities
```

**After (with deals):**
```
John Rosatti
CEO, Portopicolo Group

PORTFOLIO: 75 facilities (12 acquired in last 3 years)
ACQUISITION PROFILE: Active buyer - $145M spent since 2021
STRATEGIC RELATIONSHIPS:
  - Repeat buyer from XYZ Seller LLC (5 deals)
  - Primary lender: National Healthcare Capital ($95M)
TRANSACTION VELOCITY: Acquiring ~4 properties/year
LAST DEAL: 2024-11-15 ($12M facility in Tampa, FL)
```

#### **2. Market Intelligence Reports**

**Query: Who's buying in Florida?**
```sql
SELECT 
    buyer_c.company_name,
    COUNT(*) as deals,
    SUM(d.transaction_amount) as total_invested
FROM deals d
JOIN deal_participants dp ON dp.deal_id = d.id AND dp.participant_role = 'buyer'
JOIN companies buyer_c ON buyer_c.id = dp.company_id
JOIN property_master pm ON pm.id = d.property_master_id
WHERE pm.state = 'FL'
  AND d.deal_date >= '2023-01-01'
  AND d.deal_type = 'sale'
GROUP BY buyer_c.id
ORDER BY deals DESC;
```

#### **3. Relationship Strength Scoring**

**Algorithm:**
```python
def calculate_relationship_strength(company_a_id, company_b_id):
    """
    Score 0-100 based on transaction history
    """
    # Query all deals between these companies
    deals = query_deals_between_companies(company_a_id, company_b_id)
    
    score = 0
    score += len(deals) * 10  # 10 points per deal
    score += sum(d.transaction_amount) / 1_000_000  # 1 point per $1M
    
    # Recency bonus
    most_recent = max(d.deal_date for d in deals)
    days_since = (today - most_recent).days
    if days_since < 365:
        score += 20  # Recent relationship
    
    return min(score, 100)
```

**Use case:** "Are these two companies likely to do another deal?"

---

## Final Notes

**THIS ARCHITECTURE SUPPORTS:**
✅ Multiple companies per property with different roles
✅ Multiple properties per company with different roles
✅ Multiple principals per company with different roles
✅ Operating portfolios ≠ Ownership portfolios
✅ Lease relationships (landlord ≠ operator)
✅ Vertically integrated structures (same principal owns both)
✅ Temporal tracking (effective dates + end dates)
✅ **Transaction history via Deals (temporal dimension)**
✅ **Buyer/seller relationship discovery**
✅ **Lender network mapping**
✅ **Acquisition velocity tracking**
✅ **Strategic partnership identification**
✅ Data provenance (CMS vs REAPI vs Zoho vs manual)
✅ Zoho ↔ SQL bidirectional sync

**THE KEY INNOVATION:**
The `relationship_type` field in the junction tables allows one property to be linked to multiple companies simultaneously, each serving a different function. This mirrors the real-world complexity of healthcare real estate where ownership, operations, and management are often separate entities.
