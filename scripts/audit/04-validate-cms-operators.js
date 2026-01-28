/**
 * 04-validate-cms-operators.js
 * Batch 4: Validate CMS operators against enrollment data
 *
 * Validates that:
 * - Atlas entity_name aligns with CMS organization_name for each CCN
 * - Each property has exactly one active facility_operator
 * - CHOW deal records correlate with ownership change flags
 *
 * Usage: node scripts/audit/04-validate-cms-operators.js
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');

// Normalize company names for comparison
function normalizeName(name) {
  if (!name) return '';
  return name
    .toUpperCase()
    .replace(/[,.'"\-]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bINC\b|\bLLC\b|\bLTD\b|\bCORP\b|\bCORPORATION\b|\bCOMPANY\b|\bCO\b/g, '')
    .replace(/\bSNF\b|\bNURSING\b|\bCENTER\b|\bFACILITY\b|\bHOME\b|\bHEALTH\b|\bCARE\b/g, '')
    .trim();
}

// Calculate string similarity (Jaccard on words)
function nameSimilarity(name1, name2) {
  const words1 = new Set(normalizeName(name1).split(' ').filter(w => w.length > 2));
  const words2 = new Set(normalizeName(name2).split(' ').filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

async function validateCmsOperators() {
  console.log('='.repeat(70));
  console.log('ATLAS DATABASE VALIDATION AUDIT - BATCH 4: CMS OPERATORS');
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
    operator_validation: {
      total_properties: 0,
      with_operator: 0,
      without_operator: 0,
      multiple_operators: 0,
      name_aligned: 0,
      name_misaligned: 0
    },
    misalignments: [],
    multiple_operator_cases: [],
    chow_correlation: {
      total_chow_deals: 0,
      matched_to_operator_change: 0
    },
    issues: []
  };

  try {
    // ========================================
    // PART 1: Operator Coverage
    // ========================================
    console.log('--- PART 1: OPERATOR COVERAGE ---\n');

    // Total properties
    const [[{ total_properties }]] = await atlas.query(`SELECT COUNT(*) as total_properties FROM property_master`);
    results.operator_validation.total_properties = total_properties;
    console.log(`  Total properties: ${total_properties}`);

    // Properties with facility_operator relationship
    const [[{ with_operator }]] = await atlas.query(`
      SELECT COUNT(DISTINCT pm.id) as with_operator
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      WHERE per.relationship_type = 'facility_operator' AND per.end_date IS NULL
    `);
    results.operator_validation.with_operator = with_operator;
    console.log(`  With operator:    ${with_operator} (${(100*with_operator/total_properties).toFixed(1)}%)`);

    // Properties without operator
    const [[{ without_operator }]] = await atlas.query(`
      SELECT COUNT(*) as without_operator FROM property_master pm
      WHERE NOT EXISTS (
        SELECT 1 FROM property_entity_relationships per
        WHERE per.property_master_id = pm.id
          AND per.relationship_type = 'facility_operator'
          AND per.end_date IS NULL
      )
    `);
    results.operator_validation.without_operator = without_operator;
    console.log(`  Without operator: ${without_operator}`);

    // Properties with multiple active operators
    const [multiOps] = await atlas.query(`
      SELECT pm.id, pm.ccn, pm.facility_name, pm.state,
             COUNT(per.id) as operator_count,
             GROUP_CONCAT(e.entity_name SEPARATOR ' | ') as operators
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
        AND per.relationship_type = 'facility_operator' AND per.end_date IS NULL
      JOIN entities e ON e.id = per.entity_id
      GROUP BY pm.id
      HAVING operator_count > 1
      ORDER BY operator_count DESC
      LIMIT 100
    `);

    results.operator_validation.multiple_operators = multiOps.length;
    results.multiple_operator_cases = multiOps.map(m => ({
      property_id: m.id,
      ccn: m.ccn,
      facility_name: m.facility_name,
      state: m.state,
      operator_count: m.operator_count,
      operators: m.operators
    }));

    console.log(`  Multiple operators: ${multiOps.length}`);

    if (multiOps.length > 0) {
      console.log('\n  Sample properties with multiple operators:');
      for (const m of multiOps.slice(0, 5)) {
        console.log(`    CCN ${m.ccn}: ${m.operator_count} operators - ${m.operators?.substring(0, 80)}`);
      }
    }

    // ========================================
    // PART 2: Name Alignment Check
    // ========================================
    console.log('\n--- PART 2: OPERATOR NAME ALIGNMENT ---\n');

    // Compare Atlas entity name to CMS staging organization name
    const [nameComparisons] = await atlas.query(`
      SELECT
        pm.id as property_id,
        pm.ccn,
        pm.facility_name,
        pm.state,
        e.id as entity_id,
        e.entity_name as atlas_operator,
        ces.organization_name as cms_operator
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
        AND per.relationship_type = 'facility_operator' AND per.end_date IS NULL
      JOIN entities e ON e.id = per.entity_id
      LEFT JOIN cms_enrollments_staging ces ON ces.ccn = pm.ccn
      WHERE ces.organization_name IS NOT NULL
      LIMIT 5000
    `);

    let aligned = 0;
    let misaligned = 0;
    const misalignments = [];

    for (const row of nameComparisons) {
      const similarity = nameSimilarity(row.atlas_operator, row.cms_operator);

      if (similarity >= 0.5) {
        aligned++;
      } else {
        misaligned++;
        if (misalignments.length < 200) {
          misalignments.push({
            ccn: row.ccn,
            facility_name: row.facility_name,
            state: row.state,
            atlas_operator: row.atlas_operator,
            cms_operator: row.cms_operator,
            similarity: Math.round(similarity * 100)
          });
        }
      }
    }

    results.operator_validation.name_aligned = aligned;
    results.operator_validation.name_misaligned = misaligned;
    results.misalignments = misalignments;

    const alignRate = nameComparisons.length > 0 ? aligned / nameComparisons.length : 0;
    console.log(`  Compared: ${nameComparisons.length} properties`);
    console.log(`  Aligned (50%+ similarity): ${aligned} (${(alignRate * 100).toFixed(1)}%)`);
    console.log(`  Misaligned: ${misaligned}`);

    if (misalignments.length > 0) {
      console.log('\n  Sample misalignments:');
      for (const m of misalignments.slice(0, 5)) {
        console.log(`    CCN ${m.ccn} (${m.state}): Atlas "${m.atlas_operator?.substring(0, 35)}" vs CMS "${m.cms_operator?.substring(0, 35)}" (${m.similarity}%)`);
      }
    }

    // ========================================
    // PART 3: CHOW Deal Correlation
    // ========================================
    console.log('\n--- PART 3: CHOW DEAL CORRELATION ---\n');

    // Get CHOW deals
    const [[{ chow_count }]] = await atlas.query(`
      SELECT COUNT(*) as chow_count FROM deals WHERE deal_type = 'CHOW'
    `);
    results.chow_correlation.total_chow_deals = chow_count;
    console.log(`  Total CHOW deals: ${chow_count}`);

    // Check for deals with corresponding historical operator relationships
    const [[{ chow_with_history }]] = await atlas.query(`
      SELECT COUNT(DISTINCT d.id) as chow_with_history
      FROM deals d
      JOIN property_entity_relationships per ON per.property_master_id = d.property_master_id
      WHERE d.deal_type = 'CHOW'
        AND per.relationship_type = 'facility_operator'
        AND per.end_date IS NOT NULL
        AND ABS(DATEDIFF(per.end_date, d.effective_date)) <= 90
    `);
    results.chow_correlation.matched_to_operator_change = chow_with_history;
    console.log(`  CHOW with operator history: ${chow_with_history}`);

    // ========================================
    // PART 4: Entity Type Consistency
    // ========================================
    console.log('\n--- PART 4: ENTITY TYPE CONSISTENCY ---\n');

    // Check that operator entities have opco type
    const [entityTypeIssues] = await atlas.query(`
      SELECT e.entity_type, per.relationship_type, COUNT(*) as cnt
      FROM entities e
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      GROUP BY e.entity_type, per.relationship_type
      HAVING
        (per.relationship_type = 'facility_operator' AND e.entity_type NOT IN ('opco', 'owner_operator', NULL))
        OR (per.relationship_type = 'property_owner' AND e.entity_type NOT IN ('propco', 'holding', 'reit', 'owner_operator', NULL))
    `);

    if (entityTypeIssues.length > 0) {
      console.log('  Entity type / relationship type mismatches:');
      for (const row of entityTypeIssues) {
        console.log(`    ${row.entity_type || 'NULL'} as ${row.relationship_type}: ${row.cnt} cases`);
        results.issues.push({
          type: 'entity_type_mismatch',
          entity_type: row.entity_type,
          relationship_type: row.relationship_type,
          count: row.cnt
        });
      }
    } else {
      console.log('  ✓ No entity type / relationship type mismatches');
    }

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'batch4-cms-operators.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // Generate misalignment CSV
    if (results.misalignments.length > 0) {
      const csvPath = path.join(OUTPUT_DIR, 'OPERATOR_NAME_MISMATCHES.csv');
      const csvContent = [
        'ccn,state,facility_name,atlas_operator,cms_operator,similarity_pct',
        ...results.misalignments.map(m =>
          `${m.ccn},${m.state},"${m.facility_name || ''}","${m.atlas_operator || ''}","${m.cms_operator || ''}",${m.similarity}`
        )
      ].join('\n');
      fs.writeFileSync(csvPath, csvContent);
      console.log(`Misalignment report saved to: ${csvPath}`);
    }

    // Generate multiple operators CSV
    if (results.multiple_operator_cases.length > 0) {
      const multiCsvPath = path.join(OUTPUT_DIR, 'MULTIPLE_OPERATORS.csv');
      const multiCsv = [
        'ccn,state,facility_name,operator_count,operators',
        ...results.multiple_operator_cases.map(m =>
          `${m.ccn},${m.state},"${m.facility_name || ''}",${m.operator_count},"${(m.operators || '').replace(/"/g, '""')}"`
        )
      ].join('\n');
      fs.writeFileSync(multiCsvPath, multiCsv);
      console.log(`Multiple operators report saved to: ${multiCsvPath}`);
    }

    // Skip metrics recording (stored procedure not available)
    console.log('Skipping metrics recording (stored procedure not available)');

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('BATCH 4: CMS OPERATOR VALIDATION SUMMARY');
    console.log('='.repeat(70));

    console.log(`\nOperator Coverage:`);
    console.log(`  Total properties:      ${total_properties}`);
    console.log(`  With operator:         ${with_operator} (${(100*with_operator/total_properties).toFixed(1)}%)`);
    console.log(`  Without operator:      ${without_operator}`);
    console.log(`  Multiple operators:    ${multiOps.length}`);

    console.log(`\nName Alignment:`);
    console.log(`  Aligned (50%+ sim):    ${aligned} (${(alignRate * 100).toFixed(1)}%)`);
    console.log(`  Misaligned:            ${misaligned}`);

    console.log(`\nCHOW Correlation:`);
    console.log(`  Total CHOW deals:      ${chow_count}`);
    console.log(`  With operator history: ${chow_with_history}`);

    // Checkpoint criteria
    console.log('\n--- CHECKPOINT 4 CRITERIA ---');
    console.log(`[${alignRate >= 0.85 ? '✓' : '✗'}] 85%+ operator name alignment: ${(alignRate * 100).toFixed(1)}%`);
    console.log(`[${multiOps.length === 0 ? '✓' : '✗'}] 100% single-operator per property: ${multiOps.length} violations`);
    console.log(`[${chow_with_history > 0 ? '✓' : '○'}] CHOW correlation verified: ${chow_with_history} matched`);

    console.log('\n' + '='.repeat(70));
    console.log('BATCH 4 COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

validateCmsOperators().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
