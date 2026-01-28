/**
 * reclassify-company-types.js
 * Phase 3: Reclassify companies with type "other" to proper types
 *
 * Strategy:
 * 1. Identify lenders by name patterns (BANK, LENDING, MORTGAGE, etc.)
 * 2. Identify operators by relationship type (facility_operator)
 * 3. Identify owners by relationship type (property_owner)
 * 4. Identify REITs by SEC CIK or name patterns
 * 5. Identify nonprofits by EIN or name patterns
 *
 * Usage: node scripts/enrich/reclassify-company-types.js [--dry-run]
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// Name patterns for classification
const LENDER_PATTERNS = [
  '%BANK%', '%BANKING%', '%LENDING%', '%MORTGAGE%', '%CAPITAL%',
  '%FINANCIAL%', '%CREDIT UNION%', '%SAVINGS%', '%LOAN%',
  '%FANNIE%', '%FREDDIE%', '%HUD%', '%FHA%'
];

const REIT_PATTERNS = [
  '%REIT%', '%REAL ESTATE INVESTMENT%', '%HEALTHCARE TRUST%',
  '%PROPERTY TRUST%', '%REALTY TRUST%'
];

const NONPROFIT_PATTERNS = [
  '%FOUNDATION%', '%CHARITABLE%', '%MINISTRY%', '%MINISTRIES%',
  '%CHURCH%', '%DIOCESE%', '%CATHOLIC%', '%LUTHERAN%',
  '%METHODIST%', '%BAPTIST%', '%JEWISH%', '%MENNONITE%'
];

const OPERATOR_PATTERNS = [
  '%HEALTHCARE%', '%HEALTH CARE%', '%NURSING%', '%SKILLED NURSING%',
  '%SNF%', '%CARE CENTER%', '%REHABILITATION%', '%REHAB%',
  '%LONG TERM CARE%', '%POST ACUTE%', '%SENIOR LIVING%'
];

async function reclassifyCompanyTypes() {
  console.log('='.repeat(70));
  console.log('PHASE 3: RECLASSIFY COMPANY TYPES');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will update types)'}`);
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const atlas = await getAtlasConnection();
  console.log('Connected to Atlas database\n');

  const results = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? 'dry_run' : 'live',
    before: {},
    after: {},
    reclassified: {
      to_lending: 0,
      to_operating: 0,
      to_ownership: 0,
      to_reit: 0,
      to_nonprofit: 0,
      to_propco: 0
    },
    details: []
  };

  try {
    // ========================================
    // BASELINE: Company type distribution
    // ========================================
    console.log('--- BASELINE: COMPANY TYPE DISTRIBUTION ---\n');

    const [baseline] = await atlas.query(`
      SELECT company_type, COUNT(*) as cnt
      FROM companies
      WHERE company_name NOT LIKE '[MERGED]%'
      GROUP BY company_type
      ORDER BY cnt DESC
    `);

    for (const row of baseline) {
      results.before[row.company_type || 'NULL'] = row.cnt;
      console.log(`  ${(row.company_type || 'NULL').padEnd(20)} ${row.cnt.toString().padStart(6)}`);
    }

    const [[{ other_count }]] = await atlas.query(`
      SELECT COUNT(*) as other_count FROM companies
      WHERE company_type = 'other' AND company_name NOT LIKE '[MERGED]%'
    `);
    console.log(`\n  Companies with type "other": ${other_count}`);

    // ========================================
    // STEP 1: Identify Lenders by Name
    // ========================================
    console.log('\n--- STEP 1: IDENTIFY LENDERS BY NAME ---\n');

    const lenderConditions = LENDER_PATTERNS.map(p => `company_name LIKE '${p}'`).join(' OR ');
    const [lenderMatches] = await atlas.query(`
      SELECT id, company_name, company_type
      FROM companies
      WHERE company_type = 'other'
        AND company_name NOT LIKE '[MERGED]%'
        AND (${lenderConditions})
    `);

    console.log(`  Found ${lenderMatches.length} potential lenders by name pattern`);

    if (lenderMatches.length > 0) {
      console.log('\n  Sample matches:');
      for (const m of lenderMatches.slice(0, 5)) {
        console.log(`    ${m.company_name.substring(0, 50)}`);
      }

      if (!DRY_RUN) {
        const [updateResult] = await atlas.query(`
          UPDATE companies
          SET company_type = 'lending', updated_at = NOW()
          WHERE company_type = 'other'
            AND company_name NOT LIKE '[MERGED]%'
            AND (${lenderConditions})
        `);
        results.reclassified.to_lending = updateResult.affectedRows;
        console.log(`\n  Updated ${updateResult.affectedRows} companies to type 'lending'`);
      } else {
        results.reclassified.to_lending = lenderMatches.length;
      }
    }

    // ========================================
    // STEP 2: Identify Operators by Relationship
    // ========================================
    console.log('\n--- STEP 2: IDENTIFY OPERATORS BY RELATIONSHIP ---\n');

    const [operatorMatches] = await atlas.query(`
      SELECT DISTINCT c.id, c.company_name
      FROM companies c
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      WHERE c.company_type = 'other'
        AND c.company_name NOT LIKE '[MERGED]%'
        AND per.relationship_type = 'facility_operator'
    `);

    console.log(`  Found ${operatorMatches.length} companies with facility_operator relationships`);

    if (operatorMatches.length > 0) {
      console.log('\n  Sample matches:');
      for (const m of operatorMatches.slice(0, 5)) {
        console.log(`    ${m.company_name.substring(0, 50)}`);
      }

      if (!DRY_RUN) {
        const ids = operatorMatches.map(m => m.id);
        const [updateResult] = await atlas.query(`
          UPDATE companies
          SET company_type = 'operating', updated_at = NOW()
          WHERE id IN (?) AND company_type = 'other'
        `, [ids]);
        results.reclassified.to_operating = updateResult.affectedRows;
        console.log(`\n  Updated ${updateResult.affectedRows} companies to type 'operating'`);
      } else {
        results.reclassified.to_operating = operatorMatches.length;
      }
    }

    // ========================================
    // STEP 3: Identify Owners by Relationship
    // ========================================
    console.log('\n--- STEP 3: IDENTIFY OWNERS BY RELATIONSHIP ---\n');

    const [ownerMatches] = await atlas.query(`
      SELECT DISTINCT c.id, c.company_name
      FROM companies c
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      WHERE c.company_type = 'other'
        AND c.company_name NOT LIKE '[MERGED]%'
        AND per.relationship_type = 'property_owner'
        AND c.id NOT IN (
          SELECT DISTINCT c2.id FROM companies c2
          JOIN entities e2 ON e2.company_id = c2.id
          JOIN property_entity_relationships per2 ON per2.entity_id = e2.id
          WHERE per2.relationship_type = 'facility_operator'
        )
    `);

    console.log(`  Found ${ownerMatches.length} companies with property_owner relationships (not operators)`);

    if (ownerMatches.length > 0) {
      console.log('\n  Sample matches:');
      for (const m of ownerMatches.slice(0, 5)) {
        console.log(`    ${m.company_name.substring(0, 50)}`);
      }

      if (!DRY_RUN) {
        const ids = ownerMatches.map(m => m.id);
        const [updateResult] = await atlas.query(`
          UPDATE companies
          SET company_type = 'ownership', updated_at = NOW()
          WHERE id IN (?) AND company_type = 'other'
        `, [ids]);
        results.reclassified.to_ownership = updateResult.affectedRows;
        console.log(`\n  Updated ${updateResult.affectedRows} companies to type 'ownership'`);
      } else {
        results.reclassified.to_ownership = ownerMatches.length;
      }
    }

    // ========================================
    // STEP 4: Identify REITs
    // ========================================
    console.log('\n--- STEP 4: IDENTIFY REITs ---\n');

    const reitConditions = REIT_PATTERNS.map(p => `company_name LIKE '${p}'`).join(' OR ');
    const [reitMatches] = await atlas.query(`
      SELECT id, company_name, sec_cik
      FROM companies
      WHERE company_type = 'other'
        AND company_name NOT LIKE '[MERGED]%'
        AND (sec_cik IS NOT NULL OR (${reitConditions}))
    `);

    console.log(`  Found ${reitMatches.length} potential REITs (by CIK or name pattern)`);

    if (reitMatches.length > 0) {
      console.log('\n  Sample matches:');
      for (const m of reitMatches.slice(0, 5)) {
        console.log(`    ${m.company_name.substring(0, 50)} ${m.sec_cik ? `(CIK: ${m.sec_cik})` : ''}`);
      }

      if (!DRY_RUN) {
        const ids = reitMatches.map(m => m.id);
        const [updateResult] = await atlas.query(`
          UPDATE companies
          SET company_type = 'reit', updated_at = NOW()
          WHERE id IN (?) AND company_type = 'other'
        `, [ids]);
        results.reclassified.to_reit = updateResult.affectedRows;
        console.log(`\n  Updated ${updateResult.affectedRows} companies to type 'reit'`);
      } else {
        results.reclassified.to_reit = reitMatches.length;
      }
    }

    // ========================================
    // STEP 5: Identify Nonprofits
    // ========================================
    console.log('\n--- STEP 5: IDENTIFY NONPROFITS ---\n');

    const nonprofitConditions = NONPROFIT_PATTERNS.map(p => `company_name LIKE '${p}'`).join(' OR ');
    const [nonprofitMatches] = await atlas.query(`
      SELECT id, company_name, ein
      FROM companies
      WHERE company_type = 'other'
        AND company_name NOT LIKE '[MERGED]%'
        AND (ein IS NOT NULL OR (${nonprofitConditions}))
    `);

    console.log(`  Found ${nonprofitMatches.length} potential nonprofits (by EIN or name pattern)`);

    if (nonprofitMatches.length > 0) {
      console.log('\n  Sample matches:');
      for (const m of nonprofitMatches.slice(0, 5)) {
        console.log(`    ${m.company_name.substring(0, 50)} ${m.ein ? `(EIN: ${m.ein})` : ''}`);
      }

      if (!DRY_RUN) {
        const ids = nonprofitMatches.map(m => m.id);
        const [updateResult] = await atlas.query(`
          UPDATE companies
          SET company_type = 'nonprofit', updated_at = NOW()
          WHERE id IN (?) AND company_type = 'other'
        `, [ids]);
        results.reclassified.to_nonprofit = updateResult.affectedRows;
        console.log(`\n  Updated ${updateResult.affectedRows} companies to type 'nonprofit'`);
      } else {
        results.reclassified.to_nonprofit = nonprofitMatches.length;
      }
    }

    // ========================================
    // STEP 6: Identify PropCos (SPVs)
    // ========================================
    console.log('\n--- STEP 6: IDENTIFY PROPCOS (SPVs) ---\n');

    // Companies with exactly 1 property and LLC/LP in name are likely PropCos
    const [propcoMatches] = await atlas.query(`
      SELECT c.id, c.company_name, COUNT(DISTINCT pm.id) as prop_count
      FROM companies c
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      JOIN property_master pm ON pm.id = per.property_master_id
      WHERE c.company_type = 'other'
        AND c.company_name NOT LIKE '[MERGED]%'
        AND (c.company_name LIKE '%LLC%' OR c.company_name LIKE '%L.L.C.%'
             OR c.company_name LIKE '%LP%' OR c.company_name LIKE '%L.P.%')
      GROUP BY c.id
      HAVING prop_count = 1
    `);

    console.log(`  Found ${propcoMatches.length} single-property LLCs/LPs (likely PropCos)`);

    if (propcoMatches.length > 0) {
      console.log('\n  Sample matches:');
      for (const m of propcoMatches.slice(0, 5)) {
        console.log(`    ${m.company_name.substring(0, 50)}`);
      }

      if (!DRY_RUN) {
        const ids = propcoMatches.map(m => m.id);
        const [updateResult] = await atlas.query(`
          UPDATE companies
          SET company_type = 'propco', updated_at = NOW()
          WHERE id IN (?) AND company_type = 'other'
        `, [ids]);
        results.reclassified.to_propco = updateResult.affectedRows;
        console.log(`\n  Updated ${updateResult.affectedRows} companies to type 'propco'`);
      } else {
        results.reclassified.to_propco = propcoMatches.length;
      }
    }

    // ========================================
    // AFTER: Company type distribution
    // ========================================
    console.log('\n--- AFTER: COMPANY TYPE DISTRIBUTION ---\n');

    const [after] = await atlas.query(`
      SELECT company_type, COUNT(*) as cnt
      FROM companies
      WHERE company_name NOT LIKE '[MERGED]%'
      GROUP BY company_type
      ORDER BY cnt DESC
    `);

    for (const row of after) {
      results.after[row.company_type || 'NULL'] = row.cnt;
      const before = results.before[row.company_type || 'NULL'] || 0;
      const diff = row.cnt - before;
      const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '';
      console.log(`  ${(row.company_type || 'NULL').padEnd(20)} ${row.cnt.toString().padStart(6)} ${diffStr}`);
    }

    // ========================================
    // REMAINING "OTHER" ANALYSIS
    // ========================================
    console.log('\n--- REMAINING "OTHER" COMPANIES ---\n');

    const [[{ remaining_other }]] = await atlas.query(`
      SELECT COUNT(*) as remaining_other FROM companies
      WHERE company_type = 'other' AND company_name NOT LIKE '[MERGED]%'
    `);

    console.log(`  Remaining "other" type: ${remaining_other}`);

    if (remaining_other > 0) {
      // Sample remaining "other" companies
      const [remaining] = await atlas.query(`
        SELECT c.id, c.company_name,
               COUNT(DISTINCT pm.id) as prop_count
        FROM companies c
        LEFT JOIN entities e ON e.company_id = c.id
        LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
        LEFT JOIN property_master pm ON pm.id = per.property_master_id
        WHERE c.company_type = 'other' AND c.company_name NOT LIKE '[MERGED]%'
        GROUP BY c.id
        ORDER BY prop_count DESC
        LIMIT 20
      `);

      console.log('\n  Sample remaining (by property count):');
      for (const r of remaining) {
        console.log(`    [${r.prop_count} props] ${r.company_name.substring(0, 50)}`);
      }

      // Save remaining for manual review
      const csvPath = path.join(OUTPUT_DIR, 'REMAINING_OTHER_TYPE.csv');
      const [allRemaining] = await atlas.query(`
        SELECT c.id, c.company_name,
               COUNT(DISTINCT pm.id) as prop_count
        FROM companies c
        LEFT JOIN entities e ON e.company_id = c.id
        LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
        LEFT JOIN property_master pm ON pm.id = per.property_master_id
        WHERE c.company_type = 'other' AND c.company_name NOT LIKE '[MERGED]%'
        GROUP BY c.id
        ORDER BY prop_count DESC
      `);

      const csvContent = [
        'company_id,company_name,property_count',
        ...allRemaining.map(r => `${r.id},"${r.company_name}",${r.prop_count}`)
      ].join('\n');
      fs.writeFileSync(csvPath, csvContent);
      console.log(`\n  Full list saved to: ${csvPath}`);
    }

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'phase3-reclassify.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 3 SUMMARY');
    console.log('='.repeat(70));

    console.log(`\nReclassified (${DRY_RUN ? 'would be' : 'actual'}):`);
    console.log(`  → lending:    ${results.reclassified.to_lending}`);
    console.log(`  → operating:  ${results.reclassified.to_operating}`);
    console.log(`  → ownership:  ${results.reclassified.to_ownership}`);
    console.log(`  → reit:       ${results.reclassified.to_reit}`);
    console.log(`  → nonprofit:  ${results.reclassified.to_nonprofit}`);
    console.log(`  → propco:     ${results.reclassified.to_propco}`);

    const totalReclassified = Object.values(results.reclassified).reduce((a, b) => a + b, 0);
    console.log(`\n  Total reclassified: ${totalReclassified}`);
    console.log(`  "Other" before: ${other_count}`);
    console.log(`  "Other" after:  ${remaining_other}`);
    console.log(`  Reduction: ${((other_count - remaining_other) / other_count * 100).toFixed(1)}%`);

    console.log('\n' + '='.repeat(70));
    console.log('PHASE 3 COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

reclassifyCompanyTypes().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
