/**
 * 00-baseline-integrity.js
 * Run referential integrity checks and capture baseline metrics
 * Part of the Atlas Database Validation Audit
 *
 * Usage: node scripts/audit/00-baseline-integrity.js
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');

async function runBaselineChecks() {
  console.log('='.repeat(70));
  console.log('ATLAS DATABASE VALIDATION AUDIT - BASELINE INTEGRITY CHECKS');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const atlas = await getAtlasConnection();
  console.log('Connected to Atlas database\n');

  const results = {
    timestamp: new Date().toISOString(),
    table_counts: {},
    referential_integrity: {},
    duplicates: {},
    crm_coverage: {},
    relationship_types: {},
    data_quality: {}
  };

  try {
    // ========================================
    // SECTION 1: TABLE ROW COUNTS
    // ========================================
    console.log('--- SECTION 1: TABLE ROW COUNTS ---\n');

    const tableCounts = [
      'property_master',
      'entities',
      'companies',
      'principals',
      'property_entity_relationships',
      'principal_entity_relationships',
      'principal_company_relationships',
      'deals',
      'crm_principal_properties_staging'
    ];

    for (const table of tableCounts) {
      try {
        const [[{ cnt }]] = await atlas.query(`SELECT COUNT(*) as cnt FROM ${table}`);
        results.table_counts[table] = cnt;
        console.log(`  ${table.padEnd(40)} ${cnt.toLocaleString().padStart(10)}`);
      } catch (e) {
        results.table_counts[table] = 'TABLE_NOT_FOUND';
        console.log(`  ${table.padEnd(40)} TABLE NOT FOUND`);
      }
    }

    // ========================================
    // SECTION 2: REFERENTIAL INTEGRITY
    // ========================================
    console.log('\n--- SECTION 2: REFERENTIAL INTEGRITY ---\n');

    // Entities without valid company
    const [[{ orphan_entities }]] = await atlas.query(`
      SELECT COUNT(*) as orphan_entities FROM entities e
      LEFT JOIN companies c ON c.id = e.company_id
      WHERE c.id IS NULL
    `);
    results.referential_integrity.entities_without_company = orphan_entities;
    console.log(`  Entities without valid company:        ${orphan_entities}`);

    // Property-entity relationships with invalid property_master_id
    const [[{ broken_per_property }]] = await atlas.query(`
      SELECT COUNT(*) as broken_per_property FROM property_entity_relationships per
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      WHERE pm.id IS NULL
    `);
    results.referential_integrity.per_invalid_property = broken_per_property;
    console.log(`  Property-Entity links (bad property):  ${broken_per_property}`);

    // Property-entity relationships with invalid entity_id
    const [[{ broken_per_entity }]] = await atlas.query(`
      SELECT COUNT(*) as broken_per_entity FROM property_entity_relationships per
      LEFT JOIN entities e ON e.id = per.entity_id
      WHERE e.id IS NULL
    `);
    results.referential_integrity.per_invalid_entity = broken_per_entity;
    console.log(`  Property-Entity links (bad entity):    ${broken_per_entity}`);

    // Principal-entity relationships with invalid principal_id
    const [[{ broken_pner_principal }]] = await atlas.query(`
      SELECT COUNT(*) as broken_pner_principal FROM principal_entity_relationships per
      LEFT JOIN principals p ON p.id = per.principal_id
      WHERE p.id IS NULL
    `);
    results.referential_integrity.pner_invalid_principal = broken_pner_principal;
    console.log(`  Principal-Entity links (bad principal): ${broken_pner_principal}`);

    // Principal-entity relationships with invalid entity_id
    const [[{ broken_pner_entity }]] = await atlas.query(`
      SELECT COUNT(*) as broken_pner_entity FROM principal_entity_relationships per
      LEFT JOIN entities e ON e.id = per.entity_id
      WHERE e.id IS NULL
    `);
    results.referential_integrity.pner_invalid_entity = broken_pner_entity;
    console.log(`  Principal-Entity links (bad entity):   ${broken_pner_entity}`);

    // Principal-company relationships with invalid refs
    const [[{ broken_pcr_principal }]] = await atlas.query(`
      SELECT COUNT(*) as broken_pcr_principal FROM principal_company_relationships pcr
      LEFT JOIN principals p ON p.id = pcr.principal_id
      WHERE p.id IS NULL
    `);
    results.referential_integrity.pcr_invalid_principal = broken_pcr_principal;
    console.log(`  Principal-Company links (bad principal): ${broken_pcr_principal}`);

    const [[{ broken_pcr_company }]] = await atlas.query(`
      SELECT COUNT(*) as broken_pcr_company FROM principal_company_relationships pcr
      LEFT JOIN companies c ON c.id = pcr.company_id
      WHERE c.id IS NULL
    `);
    results.referential_integrity.pcr_invalid_company = broken_pcr_company;
    console.log(`  Principal-Company links (bad company):  ${broken_pcr_company}`);

    // Orphaned principals (no relationships at all)
    const [[{ orphan_principals }]] = await atlas.query(`
      SELECT COUNT(*) as orphan_principals FROM principals p
      WHERE NOT EXISTS (SELECT 1 FROM principal_entity_relationships WHERE principal_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM principal_company_relationships WHERE principal_id = p.id)
    `);
    results.referential_integrity.orphan_principals = orphan_principals;
    console.log(`  Orphaned principals (no relationships): ${orphan_principals}`);

    // ========================================
    // SECTION 3: DUPLICATE DETECTION
    // ========================================
    console.log('\n--- SECTION 3: DUPLICATE DETECTION ---\n');

    // Companies with same CMS affiliated entity ID
    const [dupAffiliatedEntity] = await atlas.query(`
      SELECT cms_affiliated_entity_id, COUNT(*) as cnt, GROUP_CONCAT(company_name SEPARATOR ' | ') as names
      FROM companies
      WHERE cms_affiliated_entity_id IS NOT NULL
        AND company_name NOT LIKE '[MERGED]%'
      GROUP BY cms_affiliated_entity_id
      HAVING cnt > 1
      ORDER BY cnt DESC
      LIMIT 10
    `);
    results.duplicates.companies_same_affiliated_entity = dupAffiliatedEntity.length;
    console.log(`  Companies with duplicate affiliated_entity_id: ${dupAffiliatedEntity.length}`);

    if (dupAffiliatedEntity.length > 0) {
      console.log('    Sample duplicates:');
      for (const row of dupAffiliatedEntity.slice(0, 3)) {
        console.log(`      ID ${row.cms_affiliated_entity_id}: ${row.cnt} companies`);
      }
    }

    // Principals with same cms_associate_id_owner
    const [dupAssociateId] = await atlas.query(`
      SELECT cms_associate_id_owner, COUNT(*) as cnt, GROUP_CONCAT(full_name SEPARATOR ' | ') as names
      FROM principals
      WHERE cms_associate_id_owner IS NOT NULL
      GROUP BY cms_associate_id_owner
      HAVING cnt > 1
      ORDER BY cnt DESC
      LIMIT 10
    `);
    results.duplicates.principals_same_associate_id = dupAssociateId.length;
    console.log(`  Principals with duplicate associate_id_owner:  ${dupAssociateId.length}`);

    // Duplicate property-entity relationships (same property, entity, type, active)
    const [[{ dup_per }]] = await atlas.query(`
      SELECT COUNT(*) as dup_per FROM (
        SELECT property_master_id, entity_id, relationship_type, COUNT(*) as cnt
        FROM property_entity_relationships
        WHERE end_date IS NULL
        GROUP BY property_master_id, entity_id, relationship_type
        HAVING cnt > 1
      ) dups
    `);
    results.duplicates.duplicate_property_entity_links = dup_per;
    console.log(`  Duplicate property-entity links (active):      ${dup_per}`);

    // ========================================
    // SECTION 4: CRM COVERAGE METRICS
    // ========================================
    console.log('\n--- SECTION 4: CRM COVERAGE METRICS ---\n');

    // Principal source distribution
    const [principalSources] = await atlas.query(`
      SELECT
        COALESCE(principal_source, 'NULL') as source,
        COUNT(*) as cnt,
        ROUND(COUNT(*)*100.0/(SELECT COUNT(*) FROM principals), 1) as pct
      FROM principals
      GROUP BY principal_source
      ORDER BY cnt DESC
    `);
    results.crm_coverage.principal_sources = principalSources;
    console.log('  Principal source distribution:');
    for (const row of principalSources) {
      console.log(`    ${(row.source || 'NULL').padEnd(20)} ${row.cnt.toString().padStart(8)} (${row.pct}%)`);
    }

    // Principals with Zoho contact ID
    const [[{ with_zoho }]] = await atlas.query(`
      SELECT COUNT(*) as with_zoho FROM principals WHERE zoho_contact_id IS NOT NULL
    `);
    const [[{ total_principals }]] = await atlas.query(`SELECT COUNT(*) as total_principals FROM principals`);
    results.crm_coverage.principals_with_zoho = with_zoho;
    results.crm_coverage.principals_total = total_principals;
    console.log(`\n  Principals with Zoho contact ID: ${with_zoho} / ${total_principals} (${(100*with_zoho/total_principals).toFixed(1)}%)`);

    // Companies with Zoho account ID (check if column exists first)
    const [[{ total_companies }]] = await atlas.query(`
      SELECT COUNT(*) as total_companies FROM companies WHERE company_name NOT LIKE '[MERGED]%'
    `);
    results.crm_coverage.companies_total = total_companies;

    // Check if zoho_account_id column exists
    const [zohoColCheck] = await atlas.query(`
      SELECT COUNT(*) as col_exists FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'zoho_account_id'
    `);

    if (zohoColCheck[0].col_exists > 0) {
      const [[{ companies_with_zoho }]] = await atlas.query(`
        SELECT COUNT(*) as companies_with_zoho FROM companies WHERE zoho_account_id IS NOT NULL
      `);
      results.crm_coverage.companies_with_zoho = companies_with_zoho;
      console.log(`  Companies with Zoho account ID:  ${companies_with_zoho} / ${total_companies} (${(100*companies_with_zoho/total_companies).toFixed(1)}%)`);
    } else {
      results.crm_coverage.companies_with_zoho = 0;
      console.log(`  Companies with Zoho account ID:  N/A (column not present)`);
    }

    // ========================================
    // SECTION 5: RELATIONSHIP TYPE DISTRIBUTION
    // ========================================
    console.log('\n--- SECTION 5: RELATIONSHIP TYPE DISTRIBUTION ---\n');

    // Property-Entity relationship types
    const [perTypes] = await atlas.query(`
      SELECT relationship_type, COUNT(*) as cnt
      FROM property_entity_relationships
      WHERE end_date IS NULL
      GROUP BY relationship_type
      ORDER BY cnt DESC
    `);
    results.relationship_types.property_entity = perTypes;
    console.log('  Property-Entity relationship types:');
    for (const row of perTypes) {
      console.log(`    ${(row.relationship_type || 'NULL').padEnd(25)} ${row.cnt.toString().padStart(8)}`);
    }

    // Entity types
    const [entityTypes] = await atlas.query(`
      SELECT entity_type, COUNT(*) as cnt
      FROM entities
      GROUP BY entity_type
      ORDER BY cnt DESC
    `);
    results.relationship_types.entity_types = entityTypes;
    console.log('\n  Entity types:');
    for (const row of entityTypes) {
      console.log(`    ${(row.entity_type || 'NULL').padEnd(25)} ${row.cnt.toString().padStart(8)}`);
    }

    // Company types
    const [companyTypes] = await atlas.query(`
      SELECT company_type, COUNT(*) as cnt
      FROM companies
      WHERE company_name NOT LIKE '[MERGED]%'
      GROUP BY company_type
      ORDER BY cnt DESC
    `);
    results.relationship_types.company_types = companyTypes;
    console.log('\n  Company types:');
    for (const row of companyTypes) {
      console.log(`    ${(row.company_type || 'NULL').padEnd(25)} ${row.cnt.toString().padStart(8)}`);
    }

    // ========================================
    // SECTION 6: DATA QUALITY INDICATORS
    // ========================================
    console.log('\n--- SECTION 6: DATA QUALITY INDICATORS ---\n');

    // Properties without any entity relationships
    const [[{ properties_no_entity }]] = await atlas.query(`
      SELECT COUNT(*) as properties_no_entity FROM property_master pm
      WHERE NOT EXISTS (SELECT 1 FROM property_entity_relationships WHERE property_master_id = pm.id AND end_date IS NULL)
    `);
    results.data_quality.properties_without_entity = properties_no_entity;
    console.log(`  Properties without entity link:        ${properties_no_entity}`);

    // Properties with operator but no owner
    const [[{ operator_no_owner }]] = await atlas.query(`
      SELECT COUNT(DISTINCT pm.id) as operator_no_owner
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id AND per.end_date IS NULL
      WHERE per.relationship_type = 'facility_operator'
        AND NOT EXISTS (
          SELECT 1 FROM property_entity_relationships per2
          WHERE per2.property_master_id = pm.id
            AND per2.relationship_type = 'property_owner'
            AND per2.end_date IS NULL
        )
    `);
    results.data_quality.properties_operator_no_owner = operator_no_owner;
    console.log(`  Properties with operator but no owner: ${operator_no_owner}`);

    // Properties with multiple active operators
    const [[{ multi_operator }]] = await atlas.query(`
      SELECT COUNT(*) as multi_operator FROM (
        SELECT property_master_id, COUNT(*) as cnt
        FROM property_entity_relationships
        WHERE relationship_type = 'facility_operator' AND end_date IS NULL
        GROUP BY property_master_id
        HAVING cnt > 1
      ) x
    `);
    results.data_quality.properties_multiple_operators = multi_operator;
    console.log(`  Properties with multiple operators:    ${multi_operator}`);

    // Principals with excessive property counts (>500)
    const [inflatedPrincipals] = await atlas.query(`
      SELECT p.id, p.full_name, COUNT(DISTINCT pm.id) as property_count
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      JOIN companies c ON c.id = pcr.company_id
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      JOIN property_master pm ON pm.id = per.property_master_id
      GROUP BY p.id
      HAVING property_count > 500
      ORDER BY property_count DESC
    `);
    results.data_quality.principals_inflated_count = inflatedPrincipals.length;
    console.log(`  Principals with >500 properties:       ${inflatedPrincipals.length}`);
    if (inflatedPrincipals.length > 0) {
      console.log('    WARNING - Review for data errors:');
      for (const p of inflatedPrincipals.slice(0, 5)) {
        console.log(`      ${p.full_name}: ${p.property_count} properties`);
      }
    }

    // Check for REITs incorrectly marked as operators
    const [reitsAsOperators] = await atlas.query(`
      SELECT c.id, c.company_name, c.company_type, per.relationship_type, COUNT(DISTINCT pm.id) as property_count
      FROM companies c
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      JOIN property_master pm ON pm.id = per.property_master_id
      WHERE c.company_type = 'reit'
        AND per.relationship_type = 'facility_operator'
        AND c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id, c.company_name, c.company_type, per.relationship_type
    `);
    results.data_quality.reits_as_operators = reitsAsOperators.length;
    console.log(`  REITs marked as facility_operator:     ${reitsAsOperators.length}`);

    // Check company type consistency with relationship type
    const [typeConflicts] = await atlas.query(`
      SELECT c.company_type, per.relationship_type, COUNT(*) as cnt
      FROM companies c
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.company_type, per.relationship_type
      HAVING
        (c.company_type = 'reit' AND per.relationship_type = 'facility_operator')
        OR (c.company_type = 'operating' AND per.relationship_type = 'property_owner')
      ORDER BY cnt DESC
    `);
    results.data_quality.type_relationship_conflicts = typeConflicts;
    if (typeConflicts.length > 0) {
      console.log('\n  Type/Relationship conflicts:');
      for (const row of typeConflicts) {
        console.log(`    ${row.company_type} as ${row.relationship_type}: ${row.cnt} cases`);
      }
    }

    // ========================================
    // SECTION 7: SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'baseline-integrity-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // Record baseline metrics to database (if stored procedure exists)
    console.log('Recording baseline metrics to quality_metrics_snapshots...');

    // Check if the stored procedure exists
    const [procCheck] = await atlas.query(`
      SELECT COUNT(*) as proc_exists FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'record_quality_metric'
    `);

    if (procCheck[0].proc_exists > 0) {
      const phase = 'audit_baseline';
      const metricsToRecord = [
        ['total_properties', results.table_counts.property_master],
        ['total_entities', results.table_counts.entities],
        ['total_companies', results.table_counts.companies],
        ['total_principals', results.table_counts.principals],
        ['orphan_principals', results.referential_integrity.orphan_principals],
        ['properties_without_entity', results.data_quality.properties_without_entity],
        ['properties_operator_no_owner', results.data_quality.properties_operator_no_owner],
        ['principals_with_zoho_pct', (100 * results.crm_coverage.principals_with_zoho / results.crm_coverage.principals_total)],
      ];

      for (const [name, value] of metricsToRecord) {
        if (typeof value === 'number') {
          await atlas.query(
            'CALL record_quality_metric(?, ?, ?, ?)',
            [phase, name, value, JSON.stringify({ source: 'baseline_integrity_check' })]
          );
        }
      }
      console.log(`Recorded ${metricsToRecord.length} metrics`);
    } else {
      console.log('  Note: record_quality_metric procedure not found - skipping metric recording');
      console.log('  Run docker/init/63_match_audit_log.sql to enable metric tracking');
    }

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('BASELINE INTEGRITY CHECK SUMMARY');
    console.log('='.repeat(70));

    const criticalIssues = [];
    const warnings = [];

    // Critical: referential integrity
    if (orphan_entities > 0) criticalIssues.push(`${orphan_entities} entities without company`);
    if (broken_per_property > 0) criticalIssues.push(`${broken_per_property} broken property-entity property refs`);
    if (broken_per_entity > 0) criticalIssues.push(`${broken_per_entity} broken property-entity entity refs`);
    if (broken_pner_principal > 0) criticalIssues.push(`${broken_pner_principal} broken principal-entity principal refs`);
    if (dup_per > 0) warnings.push(`${dup_per} duplicate property-entity links`);

    // Warnings: data quality
    if (inflatedPrincipals.length > 0) warnings.push(`${inflatedPrincipals.length} principals with >500 properties`);
    if (reitsAsOperators.length > 0) warnings.push(`${reitsAsOperators.length} REITs marked as operators`);
    if (multi_operator > 0) warnings.push(`${multi_operator} properties with multiple operators`);
    if (properties_no_entity > 100) warnings.push(`${properties_no_entity} properties without entity links`);

    if (criticalIssues.length > 0) {
      console.log('\nCRITICAL ISSUES (P0):');
      for (const issue of criticalIssues) {
        console.log(`  ❌ ${issue}`);
      }
    } else {
      console.log('\n✅ No critical referential integrity issues found');
    }

    if (warnings.length > 0) {
      console.log('\nWARNINGS (P1-P2):');
      for (const warning of warnings) {
        console.log(`  ⚠️  ${warning}`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('BASELINE CHECK COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

runBaselineChecks().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
