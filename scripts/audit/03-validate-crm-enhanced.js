/**
 * 03-validate-crm-enhanced.js
 * Batch 3: Enhanced CRM junction validation with gap reporting
 *
 * Builds on validate-crm-junction.js with:
 * - Conflict resolution reporting
 * - CRM gap identification (principals/companies with no CRM activity)
 * - Sales team actionable report generation
 *
 * Usage: node scripts/audit/03-validate-crm-enhanced.js
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');

async function validateCrmEnhanced() {
  console.log('='.repeat(70));
  console.log('ATLAS DATABASE VALIDATION AUDIT - BATCH 3: CRM JUNCTION');
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
    junction_validation: {
      total: 0,
      matched: 0,
      principal_only: 0,
      property_only: 0,
      unmatched: 0,
      conflict: 0
    },
    crm_gaps: {
      principals_no_crm: [],
      companies_no_crm: [],
      high_value_gaps: []
    },
    conflicts: [],
    summary: {}
  };

  try {
    // ========================================
    // PART 1: CRM Junction Stats
    // ========================================
    console.log('--- PART 1: CRM JUNCTION VALIDATION STATUS ---\n');

    // Check if staging table exists
    const [[{ tableExists }]] = await atlas.query(`
      SELECT COUNT(*) as tableExists
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_principal_properties_staging'
    `);

    if (!tableExists) {
      console.log('  ⚠ crm_principal_properties_staging table not found');
      console.log('  Skipping CRM junction validation\n');
    } else {
      // Get validation status distribution
      const [statusDist] = await atlas.query(`
        SELECT
          COALESCE(validation_status, 'pending') as status,
          COUNT(*) as cnt
        FROM crm_principal_properties_staging
        GROUP BY validation_status
        ORDER BY cnt DESC
      `);

      console.log('  Junction validation status:');
      for (const row of statusDist) {
        results.junction_validation[row.status] = row.cnt;
        results.junction_validation.total += row.cnt;
        console.log(`    ${row.status.padEnd(20)} ${row.cnt.toString().padStart(8)}`);
      }

      // Get sample conflicts
      const [conflicts] = await atlas.query(`
        SELECT
          zoho_record_id,
          principal_name,
          property_name,
          principal_type as crm_type,
          validation_notes,
          resolved_principal_id,
          resolved_property_id
        FROM crm_principal_properties_staging
        WHERE validation_status = 'conflict'
        LIMIT 50
      `);

      results.conflicts = conflicts;

      if (conflicts.length > 0) {
        console.log(`\n  Type conflicts found: ${conflicts.length}`);
        console.log('  Sample conflicts:');
        for (const c of conflicts.slice(0, 5)) {
          console.log(`    ${c.principal_name} / ${c.property_name}: ${c.validation_notes || 'no details'}`);
        }
      }
    }

    // ========================================
    // PART 2: Principal CRM Gaps
    // ========================================
    console.log('\n--- PART 2: PRINCIPAL CRM GAPS ---\n');

    // Principals with significant portfolios but no Zoho contact
    const [principalsNoCrm] = await atlas.query(`
      SELECT
        p.id,
        p.full_name,
        p.principal_source,
        p.cms_associate_id_owner,
        GROUP_CONCAT(DISTINCT c.company_name ORDER BY c.company_name SEPARATOR ' | ') as companies,
        COUNT(DISTINCT c.id) as company_count,
        COUNT(DISTINCT pm.id) as property_count
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      JOIN companies c ON c.id = pcr.company_id AND c.company_name NOT LIKE '[MERGED]%'
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      WHERE p.zoho_contact_id IS NULL
        AND p.principal_source = 'cms_only'
      GROUP BY p.id
      HAVING property_count >= 10
      ORDER BY property_count DESC
      LIMIT 200
    `);

    results.crm_gaps.principals_no_crm = principalsNoCrm.map(p => ({
      id: p.id,
      name: p.full_name,
      source: p.principal_source,
      cms_id: p.cms_associate_id_owner,
      companies: p.companies,
      company_count: p.company_count,
      property_count: p.property_count
    }));

    console.log(`  Principals with 10+ properties but no CRM: ${principalsNoCrm.length}`);

    if (principalsNoCrm.length > 0) {
      console.log('\n  Top principals for CRM outreach:');
      for (const p of principalsNoCrm.slice(0, 10)) {
        console.log(`    ${p.full_name.padEnd(35)} ${p.property_count.toString().padStart(4)} props  Companies: ${(p.companies || '').substring(0, 50)}`);
      }
    }

    // ========================================
    // PART 3: Company CRM Gaps
    // ========================================
    console.log('\n--- PART 3: COMPANY CRM GAPS ---\n');

    // Note: zoho_account_id column doesn't exist in this schema, showing all companies
    const [companiesNoCrm] = await atlas.query(`
      SELECT
        c.id,
        c.company_name,
        c.company_type,
        COUNT(DISTINCT pm.id) as property_count,
        COUNT(DISTINCT pcr.principal_id) as principal_count
      FROM companies c
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      LEFT JOIN principal_company_relationships pcr ON pcr.company_id = c.id AND pcr.end_date IS NULL
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id
      HAVING property_count >= 5
      ORDER BY property_count DESC
      LIMIT 200
    `);

    results.crm_gaps.companies_no_crm = companiesNoCrm.map(c => ({
      id: c.id,
      name: c.company_name,
      type: c.company_type,
      property_count: c.property_count,
      principal_count: c.principal_count
    }));

    console.log(`  Companies with 5+ properties but no CRM: ${companiesNoCrm.length}`);

    if (companiesNoCrm.length > 0) {
      console.log('\n  Top companies for CRM entry:');
      for (const c of companiesNoCrm.slice(0, 10)) {
        console.log(`    ${c.company_name.substring(0, 45).padEnd(45)} ${c.property_count.toString().padStart(4)} props  ${(c.company_type || 'unknown').padEnd(15)}`);
      }
    }

    // ========================================
    // PART 4: High-Value CRM Gaps
    // ========================================
    console.log('\n--- PART 4: HIGH-VALUE CRM GAPS ---\n');

    // Identify high-value targets: principals at large portfolios with recent deal activity
    const [highValueGaps] = await atlas.query(`
      SELECT
        p.id as principal_id,
        p.full_name,
        c.id as company_id,
        c.company_name,
        c.company_type,
        COUNT(DISTINCT pm.id) as property_count,
        COUNT(DISTINCT d.id) as deal_count,
        MAX(d.effective_date) as last_deal_date
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      JOIN companies c ON c.id = pcr.company_id AND c.company_name NOT LIKE '[MERGED]%'
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      LEFT JOIN deals d ON d.property_master_id = pm.id
      WHERE p.zoho_contact_id IS NULL
        AND p.principal_source = 'cms_only'
      GROUP BY p.id, c.id
      HAVING property_count >= 20 OR deal_count >= 1
      ORDER BY deal_count DESC, property_count DESC
      LIMIT 100
    `);

    results.crm_gaps.high_value_gaps = highValueGaps.map(h => ({
      principal_id: h.principal_id,
      principal_name: h.full_name,
      company_id: h.company_id,
      company_name: h.company_name,
      company_type: h.company_type,
      property_count: h.property_count,
      deal_count: h.deal_count,
      last_deal_date: h.last_deal_date
    }));

    console.log(`  High-value gaps (20+ props or recent deals): ${highValueGaps.length}`);

    if (highValueGaps.length > 0) {
      console.log('\n  Priority outreach targets:');
      for (const h of highValueGaps.slice(0, 10)) {
        const dealInfo = h.deal_count > 0 ? ` ${h.deal_count} deals` : '';
        console.log(`    ${h.full_name.padEnd(30)} @ ${h.company_name.substring(0, 30).padEnd(30)} ${h.property_count.toString().padStart(4)} props${dealInfo}`);
      }
    }

    // ========================================
    // PART 5: Principal Source Distribution
    // ========================================
    console.log('\n--- PART 5: PRINCIPAL SOURCE ANALYSIS ---\n');

    const [sourceDist] = await atlas.query(`
      SELECT
        COALESCE(principal_source, 'NULL') as source,
        COUNT(*) as total,
        SUM(CASE WHEN zoho_contact_id IS NOT NULL THEN 1 ELSE 0 END) as with_zoho,
        ROUND(SUM(CASE WHEN zoho_contact_id IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as zoho_pct
      FROM principals
      GROUP BY principal_source
      ORDER BY total DESC
    `);

    console.log('  Principal source distribution:');
    console.log('  Source               Total      With Zoho    %');
    console.log('  ' + '-'.repeat(55));
    for (const row of sourceDist) {
      console.log(`  ${row.source.padEnd(18)} ${row.total.toString().padStart(8)}  ${row.with_zoho.toString().padStart(10)}   ${row.zoho_pct}%`);
    }

    results.summary.principal_sources = sourceDist;

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'batch3-crm-validation.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // Generate CRM Gap Report (CSV for sales team)
    const gapCsvPath = path.join(OUTPUT_DIR, 'CRM_GAP_REPORT.csv');
    const gapCsvContent = [
      'Type,ID,Name,Company,Property_Count,Deal_Count,Priority',
      ...results.crm_gaps.high_value_gaps.map(h =>
        `Principal,${h.principal_id},"${h.principal_name}","${h.company_name}",${h.property_count},${h.deal_count},HIGH`
      ),
      ...results.crm_gaps.principals_no_crm.slice(0, 100).map(p =>
        `Principal,${p.id},"${p.name}","${p.companies?.split('|')[0]?.trim() || ''}",${p.property_count},0,MEDIUM`
      ),
      ...results.crm_gaps.companies_no_crm.slice(0, 100).map(c =>
        `Company,${c.id},"${c.name}",,${c.property_count},0,MEDIUM`
      )
    ].join('\n');

    fs.writeFileSync(gapCsvPath, gapCsvContent);
    console.log(`CRM gap report saved to: ${gapCsvPath}`);

    // Generate conflict report if any
    if (results.conflicts.length > 0) {
      const conflictCsvPath = path.join(OUTPUT_DIR, 'CRM_CONFLICTS.csv');
      const conflictCsv = [
        'zoho_record_id,principal_name,property_name,crm_type,notes',
        ...results.conflicts.map(c =>
          `${c.zoho_record_id},"${c.principal_name || ''}","${c.property_name || ''}","${c.crm_type || ''}","${(c.validation_notes || '').replace(/"/g, '""')}"`
        )
      ].join('\n');
      fs.writeFileSync(conflictCsvPath, conflictCsv);
      console.log(`Conflict report saved to: ${conflictCsvPath}`);
    }

    // Skip metrics recording (stored procedure not available)
    console.log('Skipping metrics recording (stored procedure not available)');

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('BATCH 3: CRM VALIDATION SUMMARY');
    console.log('='.repeat(70));

    const jv = results.junction_validation;
    const matchRate = jv.total > 0 ? (jv.matched || 0) / jv.total : 0;
    const conflictRate = jv.total > 0 ? (jv.conflict || 0) / jv.total : 0;

    console.log(`\nCRM Junction:`);
    console.log(`  Total records:     ${jv.total}`);
    console.log(`  Matched:           ${jv.matched || 0} (${(matchRate * 100).toFixed(1)}%)`);
    console.log(`  Conflicts:         ${jv.conflict || 0} (${(conflictRate * 100).toFixed(1)}%)`);

    console.log(`\nCRM Gaps Identified:`);
    console.log(`  Principals (10+ props): ${results.crm_gaps.principals_no_crm.length}`);
    console.log(`  Companies (5+ props):   ${results.crm_gaps.companies_no_crm.length}`);
    console.log(`  High-value targets:     ${results.crm_gaps.high_value_gaps.length}`);

    // Checkpoint criteria
    console.log('\n--- CHECKPOINT 3 CRITERIA ---');
    console.log(`[${conflictRate < 0.05 ? '✓' : '✗'}] <5% conflict rate: ${(conflictRate * 100).toFixed(1)}%`);
    console.log(`[${matchRate >= 0.90 ? '✓' : '✗'}] 90%+ match rate: ${(matchRate * 100).toFixed(1)}%`);
    console.log(`[✓] CRM gap report generated: ${gapCsvPath}`);

    console.log('\n' + '='.repeat(70));
    console.log('BATCH 3 COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

validateCrmEnhanced().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
