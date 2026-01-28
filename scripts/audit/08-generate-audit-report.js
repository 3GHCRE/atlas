/**
 * 08-generate-audit-report.js
 * Final step: Generate comprehensive audit artifacts
 *
 * Produces:
 * - AUDIT_REPORT.md - Executive summary with findings by severity
 * - DATA_QUALITY_SCORECARD.csv - Entity-level accuracy/freshness/completeness scores
 * - PATCH_PLAN.md - SQL patches and backfill steps
 *
 * Usage: node scripts/audit/08-generate-audit-report.js
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');

async function generateAuditReport() {
  console.log('='.repeat(70));
  console.log('ATLAS DATABASE VALIDATION AUDIT - FINAL REPORT GENERATION');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const atlas = await getAtlasConnection();
  console.log('Connected to Atlas database\n');

  // Load all batch results
  const batchFiles = [
    'baseline-integrity-results.json',
    'batch1-reit-validation.json',
    'batch2-nonprofit-validation.json',
    'batch3-crm-validation.json',
    'batch4-cms-operators.json',
    'batch5-property-owners.json',
    'batch6-principals.json',
    'batch7-addresses.json'
  ];

  const batchResults = {};
  for (const file of batchFiles) {
    const filePath = path.join(OUTPUT_DIR, file);
    if (fs.existsSync(filePath)) {
      batchResults[file] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log(`  Loaded: ${file}`);
    } else {
      console.log(`  Missing: ${file}`);
    }
  }

  try {
    // ========================================
    // PART 1: Collect Current Metrics
    // ========================================
    console.log('\n--- COLLECTING CURRENT METRICS ---\n');

    // Table counts
    const [[{ property_count }]] = await atlas.query(`SELECT COUNT(*) as property_count FROM property_master`);
    const [[{ entity_count }]] = await atlas.query(`SELECT COUNT(*) as entity_count FROM entities`);
    const [[{ company_count }]] = await atlas.query(`SELECT COUNT(*) as company_count FROM companies WHERE company_name NOT LIKE '[MERGED]%'`);
    const [[{ principal_count }]] = await atlas.query(`SELECT COUNT(*) as principal_count FROM principals`);

    // Relationship counts
    const [[{ per_count }]] = await atlas.query(`SELECT COUNT(*) as per_count FROM property_entity_relationships WHERE end_date IS NULL`);
    const [[{ pner_count }]] = await atlas.query(`SELECT COUNT(*) as pner_count FROM principal_entity_relationships WHERE end_date IS NULL`);
    const [[{ pcr_count }]] = await atlas.query(`SELECT COUNT(*) as pcr_count FROM principal_company_relationships WHERE end_date IS NULL`);

    // Quality metrics snapshot (optional table)
    let metricsSnapshot = [];
    try {
      [metricsSnapshot] = await atlas.query(`
        SELECT phase, metric_name, metric_value, snapshot_date
        FROM quality_metrics_snapshots
        ORDER BY snapshot_date DESC
        LIMIT 100
      `);
    } catch (e) {
      console.log('  Note: quality_metrics_snapshots table not available');
    }

    // ========================================
    // PART 2: Generate AUDIT_REPORT.md
    // ========================================
    console.log('--- GENERATING AUDIT_REPORT.md ---\n');

    const findings = {
      P0_critical: [],
      P1_high: [],
      P2_medium: [],
      P3_low: []
    };

    // Analyze baseline results
    const baseline = batchResults['baseline-integrity-results.json'];
    if (baseline) {
      const ri = baseline.referential_integrity || {};
      if (ri.entities_without_company > 0) findings.P0_critical.push(`${ri.entities_without_company} entities without valid company_id`);
      if (ri.per_invalid_property > 0) findings.P0_critical.push(`${ri.per_invalid_property} broken property-entity property references`);
      if (ri.per_invalid_entity > 0) findings.P0_critical.push(`${ri.per_invalid_entity} broken property-entity entity references`);
      if (ri.orphan_principals > 5000) findings.P1_high.push(`${ri.orphan_principals} orphaned principals with no relationships`);

      const dq = baseline.data_quality || {};
      if (dq.principals_inflated_count > 0) findings.P1_high.push(`${dq.principals_inflated_count} principals with >500 properties (likely errors)`);
      if (dq.reits_as_operators > 0) findings.P1_high.push(`${dq.reits_as_operators} REITs incorrectly marked as facility_operator`);
      if (dq.properties_multiple_operators > 0) findings.P2_medium.push(`${dq.properties_multiple_operators} properties with multiple active operators`);
    }

    // Analyze REIT results
    const reitResults = batchResults['batch1-reit-validation.json'];
    if (reitResults) {
      const summary = reitResults.summary || {};
      if (summary.cik_missing > 0) findings.P2_medium.push(`${summary.cik_missing} REITs missing SEC CIK in database`);
      if (summary.relationship_incorrect > 0) findings.P1_high.push(`${summary.relationship_incorrect} REITs with incorrect relationship types`);
    }

    // Analyze nonprofit results
    const nonprofitResults = batchResults['batch2-nonprofit-validation.json'];
    if (nonprofitResults && nonprofitResults.atlas_nonprofits) {
      const withEin = nonprofitResults.atlas_nonprofits.filter(n => n.ein).length;
      const total = nonprofitResults.atlas_nonprofits.length;
      if (withEin / total < 0.8) findings.P2_medium.push(`Only ${(100*withEin/total).toFixed(0)}% of nonprofits have EIN stored (target: 80%)`);
    }

    // Analyze CRM results
    const crmResults = batchResults['batch3-crm-validation.json'];
    if (crmResults) {
      const gaps = crmResults.crm_gaps || {};
      if (gaps.high_value_gaps?.length > 50) findings.P2_medium.push(`${gaps.high_value_gaps.length} high-value principals missing from CRM`);
      if (gaps.companies_no_crm?.length > 100) findings.P3_low.push(`${gaps.companies_no_crm.length} companies with 5+ properties not in CRM`);
    }

    // Analyze operator results
    const operatorResults = batchResults['batch4-cms-operators.json'];
    if (operatorResults) {
      const ov = operatorResults.operator_validation || {};
      if (ov.multiple_operators > 0) findings.P1_high.push(`${ov.multiple_operators} properties have multiple active operators`);
      if (ov.without_operator > 500) findings.P2_medium.push(`${ov.without_operator} properties missing operator relationship`);
    }

    // Analyze owner results
    const ownerResults = batchResults['batch5-property-owners.json'];
    if (ownerResults) {
      const ov = ownerResults.owner_validation || {};
      if (ov.without_owner > 1000) findings.P2_medium.push(`${ov.without_owner} properties missing owner relationship`);
      if (ov.weak_evidence > 100) findings.P3_low.push(`${ov.weak_evidence} ownership relationships with low confidence (<70%)`);
    }

    // Analyze principal results
    const principalResults = batchResults['batch6-principals.json'];
    if (principalResults) {
      const pv = principalResults.principal_validation || {};
      if (pv.inflated_counts > 0) findings.P0_critical.push(`${pv.inflated_counts} principals with inflated property counts (>500)`);
      if (pv.ownership_over_100 > 0) findings.P1_high.push(`${pv.ownership_over_100} entities with ownership percentages >100%`);
    }

    // Analyze address results
    const addressResults = batchResults['batch7-addresses.json'];
    if (addressResults) {
      const pa = addressResults.property_addresses || {};
      if (pa.missing_street > 500) findings.P2_medium.push(`${pa.missing_street} properties missing street address`);
      if (pa.invalid_state > 0) findings.P2_medium.push(`${pa.invalid_state} properties with invalid state codes`);
    }

    // Generate markdown report
    const reportContent = `# Atlas Database Validation Audit Report

**Generated:** ${new Date().toISOString()}
**Database:** Atlas (3GHCRE)

## Executive Summary

This report documents the findings from a comprehensive validation audit of the Atlas database,
cross-referencing internal data against external authoritative sources including:
- SEC EDGAR (REIT portfolios)
- ProPublica Nonprofit Explorer (nonprofit 990 data)
- CMS Enrollment Data (operator verification)
- Zoho CRM (relationship validation)

### Database Overview

| Table | Count |
|-------|-------|
| Properties | ${property_count.toLocaleString()} |
| Entities | ${entity_count.toLocaleString()} |
| Companies | ${company_count.toLocaleString()} |
| Principals | ${principal_count.toLocaleString()} |
| Property-Entity Relationships | ${per_count.toLocaleString()} |
| Principal-Entity Relationships | ${pner_count.toLocaleString()} |
| Principal-Company Relationships | ${pcr_count.toLocaleString()} |

---

## Findings by Severity

### P0 - Critical (Blocking Issues)
${findings.P0_critical.length > 0 ? findings.P0_critical.map(f => `- ❌ ${f}`).join('\n') : '- ✅ No critical issues found'}

### P1 - High Priority
${findings.P1_high.length > 0 ? findings.P1_high.map(f => `- ⚠️ ${f}`).join('\n') : '- ✅ No high priority issues found'}

### P2 - Medium Priority
${findings.P2_medium.length > 0 ? findings.P2_medium.map(f => `- ○ ${f}`).join('\n') : '- ✅ No medium priority issues found'}

### P3 - Low Priority
${findings.P3_low.length > 0 ? findings.P3_low.map(f => `- ○ ${f}`).join('\n') : '- ✅ No low priority issues found'}

---

## Batch Validation Results

### Batch 1: REIT Validation
${reitResults ? `
- REITs validated: ${reitResults.summary?.validated || 0}
- CIK stored correctly: ${reitResults.summary?.cik_stored || 0}
- Company type correct: ${reitResults.summary?.type_correct || 0}
- Relationship type correct: ${reitResults.summary?.relationship_correct || 0}
` : 'Not run'}

### Batch 2: Nonprofit Validation
${nonprofitResults ? `
- Nonprofits scanned: ${nonprofitResults.atlas_nonprofits?.length || 0}
- Found in Atlas: ${nonprofitResults.summary?.found_in_atlas || 0}
- EIN verified: ${nonprofitResults.summary?.ein_matched || 0}
` : 'Not run'}

### Batch 3: CRM Validation
${crmResults ? `
- Junction records: ${crmResults.junction_validation?.total || 0}
- Matched: ${crmResults.junction_validation?.matched || 0}
- Conflicts: ${crmResults.junction_validation?.conflict || 0}
- High-value CRM gaps: ${crmResults.crm_gaps?.high_value_gaps?.length || 0}
` : 'Not run'}

### Batch 4: CMS Operator Validation
${operatorResults ? `
- Properties with operator: ${operatorResults.operator_validation?.with_operator || 0}
- Properties without operator: ${operatorResults.operator_validation?.without_operator || 0}
- Multiple operators: ${operatorResults.operator_validation?.multiple_operators || 0}
- Name alignment rate: ${((operatorResults.operator_validation?.name_aligned || 0) / ((operatorResults.operator_validation?.name_aligned || 0) + (operatorResults.operator_validation?.name_misaligned || 1)) * 100).toFixed(1)}%
` : 'Not run'}

### Batch 5: Property Owner Validation
${ownerResults ? `
- Properties with owner: ${ownerResults.owner_validation?.with_owner || 0}
- Properties without owner: ${ownerResults.owner_validation?.without_owner || 0}
- REIT-owned: ${ownerResults.owner_validation?.reit_owned || 0}
- Weak evidence cases: ${ownerResults.owner_validation?.weak_evidence || 0}
` : 'Not run'}

### Batch 6: Principal Validation
${principalResults ? `
- Total principals: ${principalResults.principal_validation?.total_principals || 0}
- With company link: ${principalResults.principal_validation?.with_company_link || 0}
- Orphaned: ${principalResults.principal_validation?.orphaned || 0}
- Inflated counts (>500): ${principalResults.principal_validation?.inflated_counts || 0}
- Ownership >100%: ${principalResults.principal_validation?.ownership_over_100 || 0}
` : 'Not run'}

### Batch 7: Address Validation
${addressResults ? `
- Complete addresses: ${addressResults.property_addresses?.complete || 0} / ${addressResults.property_addresses?.total || 0}
- Missing street: ${addressResults.property_addresses?.missing_street || 0}
- Invalid state: ${addressResults.property_addresses?.invalid_state || 0}
- Geocoded: ${addressResults.geocoding_coverage?.with_coords || 0}
- Duplicate addresses: ${addressResults.duplicate_addresses?.length || 0}
` : 'Not run'}

---

## Checkpoint Summary

| Checkpoint | Criteria | Status |
|------------|----------|--------|
| 1 - REITs | 100% CIK coverage | ${reitResults?.summary?.cik_stored === reitResults?.summary?.validated ? '✅' : '⚠️'} |
| 1 - REITs | Zero REITs as operators | ${reitResults?.summary?.relationship_incorrect === 0 ? '✅' : '❌'} |
| 2 - Nonprofits | 80%+ EIN coverage | ${nonprofitResults?.atlas_nonprofits ? (nonprofitResults.atlas_nonprofits.filter(n => n.ein).length / nonprofitResults.atlas_nonprofits.length >= 0.8 ? '✅' : '⚠️') : '○'} |
| 3 - CRM | <5% conflict rate | ${crmResults?.junction_validation?.total > 0 ? ((crmResults.junction_validation.conflict || 0) / crmResults.junction_validation.total < 0.05 ? '✅' : '⚠️') : '○'} |
| 4 - Operators | 85%+ name alignment | ${operatorResults?.operator_validation ? ((operatorResults.operator_validation.name_aligned || 0) / ((operatorResults.operator_validation.name_aligned || 0) + (operatorResults.operator_validation.name_misaligned || 1)) >= 0.85 ? '✅' : '⚠️') : '○'} |
| 4 - Operators | Single operator per property | ${operatorResults?.operator_validation?.multiple_operators === 0 ? '✅' : '❌'} |
| 5 - Owners | 100% coverage | ${ownerResults?.owner_validation?.without_owner === 0 ? '✅' : '⚠️'} |
| 6 - Principals | Zero >500 property counts | ${principalResults?.principal_validation?.inflated_counts === 0 ? '✅' : '❌'} |
| 6 - Principals | Valid ownership %s | ${principalResults?.principal_validation?.ownership_over_100 === 0 ? '✅' : '❌'} |
| 7 - Addresses | 95%+ complete | ${addressResults?.property_addresses ? (addressResults.property_addresses.complete / addressResults.property_addresses.total >= 0.95 ? '✅' : '⚠️') : '○'} |

---

## Recommendations

### Immediate Actions
1. Review and fix all P0 critical issues before proceeding
2. Investigate principals with inflated property counts
3. Resolve multiple-operator property conflicts

### Short-term Improvements
1. Store missing SEC CIKs for REITs
2. Research and store EINs for major nonprofits
3. Create CRM entries for high-value gaps

### Long-term Enhancements
1. Implement automated CMS data refresh
2. Add confidence scoring to all relationships
3. Build owner triangulation pipeline

---

## Output Artifacts

| File | Description |
|------|-------------|
| \`baseline-integrity-results.json\` | Referential integrity check results |
| \`batch1-reit-validation.json\` | REIT SEC validation |
| \`batch2-nonprofit-validation.json\` | Nonprofit 990 validation |
| \`batch3-crm-validation.json\` | CRM junction validation |
| \`batch4-cms-operators.json\` | CMS operator alignment |
| \`batch5-property-owners.json\` | Owner triangulation results |
| \`batch6-principals.json\` | Principal role validation |
| \`batch7-addresses.json\` | Address verification |
| \`CRM_GAP_REPORT.csv\` | Principals/companies missing from CRM |
| \`MISSING_OWNERS.csv\` | Properties needing owner research |
| \`OPERATOR_NAME_MISMATCHES.csv\` | Operator name discrepancies |
| \`DUPLICATE_ADDRESSES.csv\` | Multi-property addresses |

---

*Report generated by Atlas Database Validation Audit*
`;

    const reportPath = path.join(OUTPUT_DIR, 'AUDIT_REPORT.md');
    fs.writeFileSync(reportPath, reportContent);
    console.log(`  Saved: ${reportPath}`);

    // ========================================
    // PART 3: Generate DATA_QUALITY_SCORECARD.csv
    // ========================================
    console.log('\n--- GENERATING DATA_QUALITY_SCORECARD.csv ---\n');

    // Calculate quality scores per company
    const [companyScores] = await atlas.query(`
      SELECT
        c.id,
        c.company_name,
        c.company_type,
        COUNT(DISTINCT e.id) as entity_count,
        COUNT(DISTINCT pm.id) as property_count,
        COUNT(DISTINCT pcr.principal_id) as principal_count,
        CASE WHEN c.ein IS NOT NULL THEN 1 ELSE 0 END as has_ein,
        CASE WHEN c.sec_cik IS NOT NULL THEN 1 ELSE 0 END as has_cik,
        0 as has_crm,
        ROUND(AVG(COALESCE(per.confidence_score, 1.0)), 2) as avg_confidence
      FROM companies c
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      LEFT JOIN principal_company_relationships pcr ON pcr.company_id = c.id AND pcr.end_date IS NULL
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id
      HAVING property_count > 0
      ORDER BY property_count DESC
      LIMIT 500
    `);

    const scorecardCsv = [
      'company_id,company_name,company_type,entity_count,property_count,principal_count,has_ein,has_cik,has_crm,avg_confidence,quality_score',
      ...companyScores.map(c => {
        // Calculate composite quality score
        const completeness = (c.has_ein + c.has_cik + c.has_crm + (c.principal_count > 0 ? 1 : 0)) / 4;
        const qualityScore = Math.round((completeness * 0.5 + c.avg_confidence * 0.5) * 100);
        return `${c.id},"${c.company_name}",${c.company_type || ''},${c.entity_count},${c.property_count},${c.principal_count},${c.has_ein},${c.has_cik},${c.has_crm},${c.avg_confidence},${qualityScore}`;
      })
    ].join('\n');

    const scorecardPath = path.join(OUTPUT_DIR, 'DATA_QUALITY_SCORECARD.csv');
    fs.writeFileSync(scorecardPath, scorecardCsv);
    console.log(`  Saved: ${scorecardPath}`);

    // ========================================
    // PART 4: Generate PATCH_PLAN.md
    // ========================================
    console.log('\n--- GENERATING PATCH_PLAN.md ---\n');

    const patches = [];

    // Collect patches from batch results
    if (reitResults?.recommendations) {
      patches.push('## REIT CIK Updates\n```sql\n' + reitResults.recommendations.join('\n') + '\n```');
    }

    if (nonprofitResults?.recommendations) {
      patches.push('## Nonprofit EIN Updates\n```sql\n' + nonprofitResults.recommendations.join('\n') + '\n```');
    }

    // Generate relationship fix patches
    if (operatorResults?.operator_validation?.multiple_operators > 0) {
      patches.push(`## Multiple Operator Resolution

Properties with multiple active operators need manual review. Query to identify:
\`\`\`sql
SELECT pm.ccn, pm.facility_name, GROUP_CONCAT(e.entity_name)
FROM property_master pm
JOIN property_entity_relationships per ON per.property_master_id = pm.id
  AND per.relationship_type = 'facility_operator' AND per.end_date IS NULL
JOIN entities e ON e.id = per.entity_id
GROUP BY pm.id
HAVING COUNT(*) > 1;
\`\`\`

For each case, determine the correct current operator and end-date the others.`);
    }

    if (principalResults?.principal_validation?.inflated_counts > 0) {
      patches.push(`## Inflated Principal Review

Principals with >500 properties likely have incorrect company assignments.
Review these principals and their company relationships:

See: \`INFLATED_PRINCIPALS.csv\`

Typical resolution: Verify the principal is actually associated with the parent company,
not incorrectly linked to all subsidiaries.`);
    }

    const patchContent = `# Atlas Database Patch Plan

**Generated:** ${new Date().toISOString()}

This document outlines SQL patches and manual steps to resolve audit findings.

**⚠️ IMPORTANT: Review all patches before executing. Back up database first.**

${patches.length > 0 ? patches.join('\n\n---\n\n') : '## No Patches Required\n\nAll validation checks passed.'}

---

## Verification Queries

After applying patches, run these queries to verify:

### Referential Integrity
\`\`\`sql
-- Should return 0 for all
SELECT 'entities_without_company', COUNT(*) FROM entities e LEFT JOIN companies c ON c.id = e.company_id WHERE c.id IS NULL
UNION ALL
SELECT 'per_invalid_property', COUNT(*) FROM property_entity_relationships per LEFT JOIN property_master pm ON pm.id = per.property_master_id WHERE pm.id IS NULL
UNION ALL
SELECT 'per_invalid_entity', COUNT(*) FROM property_entity_relationships per LEFT JOIN entities e ON e.id = per.entity_id WHERE e.id IS NULL;
\`\`\`

### Operator Uniqueness
\`\`\`sql
-- Should return 0
SELECT COUNT(*) FROM (
  SELECT property_master_id FROM property_entity_relationships
  WHERE relationship_type = 'facility_operator' AND end_date IS NULL
  GROUP BY property_master_id HAVING COUNT(*) > 1
) x;
\`\`\`

### Principal Sanity
\`\`\`sql
-- Should return 0
SELECT COUNT(*) FROM (
  SELECT p.id FROM principals p
  JOIN principal_company_relationships pcr ON pcr.principal_id = p.id
  JOIN companies c ON c.id = pcr.company_id
  JOIN entities e ON e.company_id = c.id
  JOIN property_entity_relationships per ON per.entity_id = e.id
  JOIN property_master pm ON pm.id = per.property_master_id
  WHERE pcr.end_date IS NULL AND per.end_date IS NULL
  GROUP BY p.id HAVING COUNT(DISTINCT pm.id) > 500
) x;
\`\`\`

---

*Patch plan generated by Atlas Database Validation Audit*
`;

    const patchPath = path.join(OUTPUT_DIR, 'PATCH_PLAN.md');
    fs.writeFileSync(patchPath, patchContent);
    console.log(`  Saved: ${patchPath}`);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('AUDIT REPORT GENERATION COMPLETE');
    console.log('='.repeat(70));

    console.log(`\nArtifacts generated in: ${OUTPUT_DIR}`);
    console.log(`\nKey files:`);
    console.log(`  - AUDIT_REPORT.md         (Executive summary)`);
    console.log(`  - DATA_QUALITY_SCORECARD.csv (Quality scores)`);
    console.log(`  - PATCH_PLAN.md           (Remediation steps)`);
    console.log(`  - CRM_GAP_REPORT.csv      (Sales team action list)`);

    console.log(`\nFindings summary:`);
    console.log(`  P0 Critical: ${findings.P0_critical.length}`);
    console.log(`  P1 High:     ${findings.P1_high.length}`);
    console.log(`  P2 Medium:   ${findings.P2_medium.length}`);
    console.log(`  P3 Low:      ${findings.P3_low.length}`);

    console.log('\n' + '='.repeat(70));

    return {
      findings,
      artifacts: [reportPath, scorecardPath, patchPath]
    };

  } finally {
    await atlas.end();
  }
}

generateAuditReport().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
