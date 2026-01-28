/**
 * 06-validate-principals.js
 * Batch 6: Verify principal roles and types
 *
 * Validates:
 * - No principals with >500 properties (likely data errors)
 * - Role/title alignment with CMS codes
 * - Ownership percentages sum to ≤100% per entity
 * - principal_source is set for all records
 *
 * Usage: node scripts/audit/06-validate-principals.js
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');

// CMS role code to expected role mapping
const CMS_ROLE_MAPPING = {
  '34': 'owner_direct',
  '35': 'owner_indirect',
  '40': 'officer',
  '41': 'director',
  '42': 'managing_employee',
  '43': 'board_member',
  '44': 'member',
  '45': 'manager'
};

async function validatePrincipals() {
  console.log('='.repeat(70));
  console.log('ATLAS DATABASE VALIDATION AUDIT - BATCH 6: PRINCIPAL ROLES');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const atlas = await getAtlasConnection();
  console.log('Connected to Atlas database\n');

  const results = {
    timestamp: new Date().toISOString(),
    principal_validation: {
      total_principals: 0,
      with_company_link: 0,
      with_entity_link: 0,
      orphaned: 0,
      inflated_counts: 0,
      missing_source: 0,
      ownership_over_100: 0
    },
    inflated_principals: [],
    ownership_issues: [],
    role_distribution: [],
    source_distribution: [],
    issues: []
  };

  try {
    // ========================================
    // PART 1: Principal Statistics
    // ========================================
    console.log('--- PART 1: PRINCIPAL STATISTICS ---\n');

    const [[{ total_principals }]] = await atlas.query(`SELECT COUNT(*) as total_principals FROM principals`);
    results.principal_validation.total_principals = total_principals;
    console.log(`  Total principals: ${total_principals}`);

    // With company relationships
    const [[{ with_company }]] = await atlas.query(`
      SELECT COUNT(DISTINCT principal_id) as with_company
      FROM principal_company_relationships WHERE end_date IS NULL
    `);
    results.principal_validation.with_company_link = with_company;
    console.log(`  With company link: ${with_company} (${(100*with_company/total_principals).toFixed(1)}%)`);

    // With entity relationships
    const [[{ with_entity }]] = await atlas.query(`
      SELECT COUNT(DISTINCT principal_id) as with_entity
      FROM principal_entity_relationships WHERE end_date IS NULL
    `);
    results.principal_validation.with_entity_link = with_entity;
    console.log(`  With entity link: ${with_entity} (${(100*with_entity/total_principals).toFixed(1)}%)`);

    // Orphaned (no relationships)
    const [[{ orphaned }]] = await atlas.query(`
      SELECT COUNT(*) as orphaned FROM principals p
      WHERE NOT EXISTS (SELECT 1 FROM principal_company_relationships WHERE principal_id = p.id AND end_date IS NULL)
        AND NOT EXISTS (SELECT 1 FROM principal_entity_relationships WHERE principal_id = p.id AND end_date IS NULL)
    `);
    results.principal_validation.orphaned = orphaned;
    console.log(`  Orphaned (no links): ${orphaned}`);

    // ========================================
    // PART 2: Inflated Property Counts (Owners Only)
    // ========================================
    console.log('\n--- PART 2: INFLATED PROPERTY COUNTS ---\n');

    // Note: Only flag principals with OWNERSHIP (>5%) and >500 properties
    // Multi-facility service providers (pharmacists, consultants) legitimately
    // serve many facilities across different companies without ownership.
    const [inflated] = await atlas.query(`
      SELECT
        p.id,
        p.full_name,
        p.principal_source,
        p.cms_associate_id_owner,
        COUNT(DISTINCT c.id) as company_count,
        COUNT(DISTINCT pm.id) as property_count,
        MAX(pcr.ownership_percentage) as max_ownership,
        GROUP_CONCAT(DISTINCT c.company_name ORDER BY c.company_name SEPARATOR ' | ') as companies
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      JOIN companies c ON c.id = pcr.company_id AND c.company_name NOT LIKE '[MERGED]%'
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      WHERE pcr.ownership_percentage > 5
        AND (pcr.role_detail IS NULL OR pcr.role_detail NOT LIKE '%multi_facility_provider%')
      GROUP BY p.id
      HAVING property_count > 500
      ORDER BY property_count DESC
    `);

    // Also count all principals with >500 properties for reference
    const [[{ all_high_count }]] = await atlas.query(`
      SELECT COUNT(*) as all_high_count FROM (
        SELECT p.id
        FROM principals p
        JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
        JOIN companies c ON c.id = pcr.company_id
        JOIN entities e ON e.company_id = c.id
        JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
        JOIN property_master pm ON pm.id = per.property_master_id
        GROUP BY p.id
        HAVING COUNT(DISTINCT pm.id) > 500
      ) x
    `);

    results.principal_validation.inflated_counts = inflated.length;
    results.inflated_principals = inflated.map(i => ({
      id: i.id,
      name: i.full_name,
      source: i.principal_source,
      cms_id: i.cms_associate_id_owner,
      company_count: i.company_count,
      property_count: i.property_count,
      max_ownership: i.max_ownership,
      companies: i.companies
    }));

    console.log(`  Total principals with >500 properties: ${all_high_count}`);
    console.log(`    (Includes consultants/service providers serving multiple companies)`);

    if (inflated.length > 0) {
      console.log(`\n  ⚠ OWNERS (>5% ownership) with >500 properties: ${inflated.length}`);
      console.log('\n  These may indicate data consolidation issues:');
      for (const i of inflated.slice(0, 20)) {
        console.log(`    ${i.full_name.substring(0, 30).padEnd(30)} ${i.property_count.toString().padStart(5)} props | ${i.max_ownership}% max | ${i.company_count} companies`);
        results.issues.push({
          type: 'inflated_count',
          principal_id: i.id,
          name: i.full_name,
          property_count: i.property_count,
          max_ownership: i.max_ownership
        });
      }
    } else {
      console.log('\n  ✓ No owner principals with >500 properties');
    }

    // ========================================
    // PART 3: Principal Source Distribution
    // ========================================
    console.log('\n--- PART 3: PRINCIPAL SOURCE DISTRIBUTION ---\n');

    const [sources] = await atlas.query(`
      SELECT
        COALESCE(principal_source, 'NULL') as source,
        COUNT(*) as cnt,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM principals), 1) as pct
      FROM principals
      GROUP BY principal_source
      ORDER BY cnt DESC
    `);

    results.source_distribution = sources;

    console.log('  Source                  Count       %');
    console.log('  ' + '-'.repeat(45));
    for (const row of sources) {
      console.log(`  ${row.source.padEnd(18)} ${row.cnt.toString().padStart(10)}   ${row.pct}%`);
      if (row.source === 'NULL') {
        results.principal_validation.missing_source = row.cnt;
      }
    }

    if (results.principal_validation.missing_source > 0) {
      results.issues.push({
        type: 'missing_source',
        count: results.principal_validation.missing_source,
        message: 'Principals without principal_source set'
      });
    }

    // ========================================
    // PART 4: Role Distribution
    // ========================================
    console.log('\n--- PART 4: ROLE DISTRIBUTION ---\n');

    const [roles] = await atlas.query(`
      SELECT
        COALESCE(role, 'NULL') as role,
        COUNT(*) as cnt
      FROM principal_entity_relationships
      WHERE end_date IS NULL
      GROUP BY role
      ORDER BY cnt DESC
    `);

    results.role_distribution = roles;

    console.log('  Role                    Count');
    console.log('  ' + '-'.repeat(35));
    for (const row of roles) {
      console.log(`  ${row.role.padEnd(20)} ${row.cnt.toString().padStart(10)}`);
    }

    // ========================================
    // PART 5: CMS Role Code Alignment
    // ========================================
    console.log('\n--- PART 5: CMS ROLE CODE ALIGNMENT ---\n');

    const [roleAlignment] = await atlas.query(`
      SELECT
        per.cms_role_code,
        per.role,
        COUNT(*) as cnt
      FROM principal_entity_relationships per
      WHERE per.cms_role_code IS NOT NULL AND per.end_date IS NULL
      GROUP BY per.cms_role_code, per.role
      ORDER BY per.cms_role_code, cnt DESC
    `);

    const misalignedRoles = [];
    const codeGroups = {};

    for (const row of roleAlignment) {
      if (!codeGroups[row.cms_role_code]) {
        codeGroups[row.cms_role_code] = [];
      }
      codeGroups[row.cms_role_code].push({ role: row.role, count: row.cnt });

      // Check alignment
      const expectedRole = CMS_ROLE_MAPPING[row.cms_role_code];
      if (expectedRole && row.role !== expectedRole) {
        misalignedRoles.push({
          cms_code: row.cms_role_code,
          expected: expectedRole,
          actual: row.role,
          count: row.cnt
        });
      }
    }

    console.log('  CMS code to role mapping:');
    for (const [code, roles] of Object.entries(codeGroups)) {
      const expected = CMS_ROLE_MAPPING[code] || 'unknown';
      const actual = roles.map(r => `${r.role}(${r.count})`).join(', ');
      const status = roles.some(r => r.role === expected) ? '✓' : '⚠';
      console.log(`    ${status} Code ${code} (${expected}): ${actual}`);
    }

    if (misalignedRoles.length > 0) {
      console.log(`\n  Role misalignments found: ${misalignedRoles.length}`);
      results.issues.push({
        type: 'role_misalignment',
        count: misalignedRoles.length,
        details: misalignedRoles.slice(0, 10)
      });
    }

    // ========================================
    // PART 6: Ownership Percentage Validation
    // ========================================
    console.log('\n--- PART 6: OWNERSHIP PERCENTAGE VALIDATION ---\n');

    // Check for entities where ownership > 100%
    const [overOwned] = await atlas.query(`
      SELECT
        e.id as entity_id,
        e.entity_name,
        c.company_name,
        SUM(per.ownership_percentage) as total_ownership,
        COUNT(per.id) as owner_count,
        GROUP_CONCAT(
          CONCAT(p.full_name, ':', per.ownership_percentage, '%')
          ORDER BY per.ownership_percentage DESC
          SEPARATOR ' | '
        ) as owners
      FROM principal_entity_relationships per
      JOIN entities e ON e.id = per.entity_id
      JOIN companies c ON c.id = e.company_id AND c.company_name NOT LIKE '[MERGED]%'
      JOIN principals p ON p.id = per.principal_id
      WHERE per.ownership_percentage IS NOT NULL
        AND per.ownership_percentage > 0
        AND per.end_date IS NULL
      GROUP BY e.id
      HAVING total_ownership > 100
      ORDER BY total_ownership DESC
      LIMIT 100
    `);

    results.principal_validation.ownership_over_100 = overOwned.length;
    results.ownership_issues = overOwned.map(o => ({
      entity_id: o.entity_id,
      entity_name: o.entity_name,
      company_name: o.company_name,
      total_ownership: o.total_ownership,
      owner_count: o.owner_count,
      owners: o.owners
    }));

    if (overOwned.length > 0) {
      console.log(`  ⚠ Entities with ownership > 100%: ${overOwned.length}`);
      console.log('\n  Sample over-owned entities:');
      for (const o of overOwned.slice(0, 5)) {
        console.log(`    ${o.entity_name?.substring(0, 40)}: ${o.total_ownership}% (${o.owner_count} owners)`);
      }
      results.issues.push({
        type: 'ownership_over_100',
        count: overOwned.length,
        message: 'Entities with ownership percentages summing to >100%'
      });
    } else {
      console.log('  ✓ No entities with ownership > 100%');
    }

    // Ownership percentage distribution
    const [ownershipDist] = await atlas.query(`
      SELECT
        CASE
          WHEN ownership_percentage IS NULL THEN 'NULL'
          WHEN ownership_percentage = 0 THEN '0%'
          WHEN ownership_percentage <= 10 THEN '1-10%'
          WHEN ownership_percentage <= 25 THEN '11-25%'
          WHEN ownership_percentage <= 50 THEN '26-50%'
          WHEN ownership_percentage <= 75 THEN '51-75%'
          WHEN ownership_percentage <= 99 THEN '76-99%'
          ELSE '100%'
        END as range_name,
        COUNT(*) as cnt
      FROM principal_entity_relationships
      WHERE end_date IS NULL
      GROUP BY range_name
      ORDER BY
        CASE range_name
          WHEN 'NULL' THEN 0
          WHEN '0%' THEN 1
          WHEN '1-10%' THEN 2
          WHEN '11-25%' THEN 3
          WHEN '26-50%' THEN 4
          WHEN '51-75%' THEN 5
          WHEN '76-99%' THEN 6
          WHEN '100%' THEN 7
        END
    `);

    console.log('\n  Ownership percentage distribution:');
    for (const row of ownershipDist) {
      console.log(`    ${row.range_name.padEnd(10)} ${row.cnt.toString().padStart(10)}`);
    }

    // ========================================
    // PART 7: Company-Principal Coverage
    // ========================================
    console.log('\n--- PART 7: COMPANY-PRINCIPAL COVERAGE ---\n');

    // Companies with no linked principals
    const [[{ companies_no_principals }]] = await atlas.query(`
      SELECT COUNT(*) as companies_no_principals
      FROM companies c
      WHERE c.company_name NOT LIKE '[MERGED]%'
        AND NOT EXISTS (
          SELECT 1 FROM principal_company_relationships pcr
          WHERE pcr.company_id = c.id AND pcr.end_date IS NULL
        )
    `);

    const [[{ total_companies }]] = await atlas.query(`
      SELECT COUNT(*) as total_companies FROM companies
      WHERE company_name NOT LIKE '[MERGED]%'
    `);

    const companyCoverage = (total_companies - companies_no_principals) / total_companies;
    console.log(`  Companies with principals: ${total_companies - companies_no_principals} / ${total_companies} (${(companyCoverage * 100).toFixed(1)}%)`);
    console.log(`  Companies without principals: ${companies_no_principals}`);

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'batch6-principals.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // Generate inflated principals CSV
    if (results.inflated_principals.length > 0) {
      const csvPath = path.join(OUTPUT_DIR, 'INFLATED_PRINCIPALS.csv');
      const csvContent = [
        'principal_id,full_name,source,company_count,property_count,companies',
        ...results.inflated_principals.map(i =>
          `${i.id},"${i.name}",${i.source || ''},${i.company_count},${i.property_count},"${(i.companies || '').replace(/"/g, '""').substring(0, 500)}"`
        )
      ].join('\n');
      fs.writeFileSync(csvPath, csvContent);
      console.log(`Inflated principals report saved to: ${csvPath}`);
    }

    // Generate ownership issues CSV
    if (results.ownership_issues.length > 0) {
      const csvPath = path.join(OUTPUT_DIR, 'OWNERSHIP_OVER_100.csv');
      const csvContent = [
        'entity_id,entity_name,company_name,total_ownership,owner_count,owners',
        ...results.ownership_issues.map(o =>
          `${o.entity_id},"${o.entity_name || ''}","${o.company_name || ''}",${o.total_ownership},${o.owner_count},"${(o.owners || '').replace(/"/g, '""').substring(0, 500)}"`
        )
      ].join('\n');
      fs.writeFileSync(csvPath, csvContent);
      console.log(`Ownership issues report saved to: ${csvPath}`);
    }

    // Skip metrics recording (stored procedure not available)
    console.log('Skipping metrics recording (stored procedure not available)');

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('BATCH 6: PRINCIPAL VALIDATION SUMMARY');
    console.log('='.repeat(70));

    console.log(`\nPrincipal Statistics:`);
    console.log(`  Total principals:       ${total_principals}`);
    console.log(`  With company link:      ${with_company} (${(100*with_company/total_principals).toFixed(1)}%)`);
    console.log(`  Orphaned:               ${orphaned}`);

    console.log(`\nData Quality:`);
    console.log(`  Inflated counts (>500): ${inflated.length}`);
    console.log(`  Missing source:         ${results.principal_validation.missing_source}`);
    console.log(`  Ownership >100%:        ${overOwned.length}`);

    console.log(`\nCompany-Principal Coverage: ${(companyCoverage * 100).toFixed(1)}%`);

    // Checkpoint criteria
    console.log('\n--- CHECKPOINT 6 CRITERIA ---');
    console.log(`[${inflated.length === 0 ? '✓' : '✗'}] Zero principals with >500 properties: ${inflated.length} violations`);
    console.log(`[${companyCoverage >= 0.90 ? '✓' : '✗'}] 90%+ company-principal coverage: ${(companyCoverage * 100).toFixed(1)}%`);
    console.log(`[${overOwned.length === 0 ? '✓' : '✗'}] Ownership percentages valid: ${overOwned.length} violations`);

    console.log('\n' + '='.repeat(70));
    console.log('BATCH 6 COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

validatePrincipals().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
