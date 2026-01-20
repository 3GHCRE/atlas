-- 3G Healthcare Real Estate Atlas - Phase 1B: Fix Principal-Company Links
-- Adds principal_company_relationships for consolidated PRINCIPAL-* companies
-- Mirrors the pattern used for chain/affiliated entity companies

USE atlas;

-- ============================================
-- STEP 1: Add controlling principal as owner
-- The principal whose name matches the company
-- ============================================

INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    p.id AS principal_id,
    c.id AS company_id,
    'owner' AS role,
    -- Get the max ownership percentage from their entity relationships
    (SELECT MAX(per2.ownership_percentage)
     FROM principal_entity_relationships per2
     JOIN entities e2 ON e2.id = per2.entity_id
     WHERE per2.principal_id = p.id
       AND e2.company_id = c.id
       AND per2.role IN ('owner_direct', 'owner_indirect')) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM companies c
JOIN principals p ON p.full_name = c.company_name
WHERE c.cms_affiliated_entity_id LIKE 'PRINCIPAL-%'
  -- Avoid duplicates
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = p.id AND pcr.company_id = c.id AND pcr.role = 'owner'
  );

SELECT 'Controlling principals linked as owners' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 2: Add other principals with roles at entity level
-- Aggregate their entity-level roles to company level
-- ============================================

-- Officers
INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    per.principal_id,
    e.company_id,
    'officer' AS role,
    MAX(per.ownership_percentage) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM principal_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.cms_affiliated_entity_id LIKE 'PRINCIPAL-%'
  AND per.role = 'officer'
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = per.principal_id
        AND pcr.company_id = e.company_id
        AND pcr.role = 'officer'
  )
GROUP BY per.principal_id, e.company_id;

SELECT 'Officers linked to consolidated companies' AS status, ROW_COUNT() AS count;

-- Directors
INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    per.principal_id,
    e.company_id,
    'director' AS role,
    MAX(per.ownership_percentage) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM principal_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.cms_affiliated_entity_id LIKE 'PRINCIPAL-%'
  AND per.role = 'director'
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = per.principal_id
        AND pcr.company_id = e.company_id
        AND pcr.role = 'director'
  )
GROUP BY per.principal_id, e.company_id;

SELECT 'Directors linked to consolidated companies' AS status, ROW_COUNT() AS count;

-- Managers
INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    per.principal_id,
    e.company_id,
    'manager' AS role,
    MAX(per.ownership_percentage) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM principal_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.cms_affiliated_entity_id LIKE 'PRINCIPAL-%'
  AND per.role IN ('manager', 'member')
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = per.principal_id
        AND pcr.company_id = e.company_id
        AND pcr.role = 'manager'
  )
GROUP BY per.principal_id, e.company_id;

SELECT 'Managers linked to consolidated companies' AS status, ROW_COUNT() AS count;

-- Managing employees
INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    per.principal_id,
    e.company_id,
    'managing_employee' AS role,
    MAX(per.ownership_percentage) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM principal_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.cms_affiliated_entity_id LIKE 'PRINCIPAL-%'
  AND per.role = 'managing_employee'
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = per.principal_id
        AND pcr.company_id = e.company_id
        AND pcr.role = 'managing_employee'
  )
GROUP BY per.principal_id, e.company_id;

SELECT 'Managing employees linked to consolidated companies' AS status, ROW_COUNT() AS count;

-- ============================================
-- STEP 3: Also fix standalone single-facility companies
-- They should have principal_company_relationships too
-- ============================================

-- Owners for standalone companies
INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    per.principal_id,
    e.company_id,
    'owner' AS role,
    MAX(per.ownership_percentage) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM principal_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.cms_affiliated_entity_id LIKE 'STANDALONE-%'
  AND per.role IN ('owner_direct', 'owner_indirect')
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = per.principal_id
        AND pcr.company_id = e.company_id
        AND pcr.role = 'owner'
  )
GROUP BY per.principal_id, e.company_id;

SELECT 'Owners linked to standalone companies' AS status, ROW_COUNT() AS count;

-- Officers for standalone
INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    per.principal_id,
    e.company_id,
    'officer' AS role,
    MAX(per.ownership_percentage) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM principal_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.cms_affiliated_entity_id LIKE 'STANDALONE-%'
  AND per.role = 'officer'
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = per.principal_id
        AND pcr.company_id = e.company_id
        AND pcr.role = 'officer'
  )
GROUP BY per.principal_id, e.company_id;

SELECT 'Officers linked to standalone companies' AS status, ROW_COUNT() AS count;

-- Directors for standalone
INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    per.principal_id,
    e.company_id,
    'director' AS role,
    MAX(per.ownership_percentage) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM principal_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.cms_affiliated_entity_id LIKE 'STANDALONE-%'
  AND per.role = 'director'
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = per.principal_id
        AND pcr.company_id = e.company_id
        AND pcr.role = 'director'
  )
GROUP BY per.principal_id, e.company_id;

SELECT 'Directors linked to standalone companies' AS status, ROW_COUNT() AS count;

-- Managers for standalone
INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    per.principal_id,
    e.company_id,
    'manager' AS role,
    MAX(per.ownership_percentage) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM principal_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.cms_affiliated_entity_id LIKE 'STANDALONE-%'
  AND per.role IN ('manager', 'member')
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = per.principal_id
        AND pcr.company_id = e.company_id
        AND pcr.role = 'manager'
  )
GROUP BY per.principal_id, e.company_id;

SELECT 'Managers linked to standalone companies' AS status, ROW_COUNT() AS count;

-- Managing employees for standalone
INSERT INTO principal_company_relationships (
    principal_id,
    company_id,
    role,
    ownership_percentage,
    data_source,
    created_at,
    updated_at
)
SELECT DISTINCT
    per.principal_id,
    e.company_id,
    'managing_employee' AS role,
    MAX(per.ownership_percentage) AS ownership_percentage,
    'cms' AS data_source,
    NOW(),
    NOW()
FROM principal_entity_relationships per
JOIN entities e ON e.id = per.entity_id
JOIN companies c ON c.id = e.company_id
WHERE c.cms_affiliated_entity_id LIKE 'STANDALONE-%'
  AND per.role = 'managing_employee'
  AND NOT EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = per.principal_id
        AND pcr.company_id = e.company_id
        AND pcr.role = 'managing_employee'
  )
GROUP BY per.principal_id, e.company_id;

SELECT 'Managing employees linked to standalone companies' AS status, ROW_COUNT() AS count;

-- ============================================
-- VALIDATION
-- ============================================

SELECT '=== PRINCIPAL-COMPANY LINKS COMPLETE ===' AS status;

-- Count by company type
SELECT
    CASE
        WHEN c.cms_affiliated_entity_id LIKE 'STANDALONE-%' THEN 'Standalone'
        WHEN c.cms_affiliated_entity_id LIKE 'PRINCIPAL-%' THEN 'Principal Portfolio'
        ELSE 'Chain/Affiliated'
    END AS company_type,
    COUNT(DISTINCT pcr.id) AS principal_company_links,
    COUNT(DISTINCT pcr.company_id) AS companies_with_links
FROM principal_company_relationships pcr
JOIN companies c ON c.id = pcr.company_id
GROUP BY CASE
    WHEN c.cms_affiliated_entity_id LIKE 'STANDALONE-%' THEN 'Standalone'
    WHEN c.cms_affiliated_entity_id LIKE 'PRINCIPAL-%' THEN 'Principal Portfolio'
    ELSE 'Chain/Affiliated'
END;

-- Verify PRATAP PODDATOORI
SELECT 'Verification: PRATAP PODDATOORI Company-Level Principals' AS test;
SELECT
    p.full_name,
    pcr.role,
    pcr.ownership_percentage
FROM companies c
JOIN principal_company_relationships pcr ON pcr.company_id = c.id
JOIN principals p ON p.id = pcr.principal_id
WHERE c.company_name = 'PRATAP PODDATOORI'
ORDER BY pcr.role, p.full_name;

-- Total counts
SELECT 'Final principal_company_relationships count' AS metric, COUNT(*) AS total
FROM principal_company_relationships;
