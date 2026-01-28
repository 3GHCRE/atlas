/**
 * 01-validate-reits.js
 * Batch 1: Validate public REITs against SEC EDGAR
 *
 * Validates ~7-10 major healthcare REITs:
 * - Cross-reference SEC CIK with Atlas company records
 * - Compare portfolio counts (SEC 10-K vs Atlas)
 * - Verify relationship types (REITs should be property_owner, not facility_operator)
 * - Store SEC CIK in companies table if missing
 *
 * Usage: node scripts/audit/01-validate-reits.js
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');

// Known REIT mappings - ticker to CIK and expected Atlas info
const REITS = {
  'OHI': {
    name: 'Omega Healthcare Investors',
    cik: '0000908311',
    atlasId: 14598,
    expectedType: 'reit',
    approxProperties: 400
  },
  'SBRA': {
    name: 'Sabra Health Care REIT',
    cik: '0001492298',
    atlasId: 14603,
    expectedType: 'reit',
    approxProperties: 280
  },
  'WELL': {
    name: 'Welltower Inc',
    cik: '0000766704',
    atlasId: 14599,
    expectedType: 'reit',
    approxProperties: 200
  },
  'NHC': {
    name: 'National HealthCare Corporation',
    cik: '0000810765',
    atlasId: 14615,
    expectedType: 'owner_operator', // NHC operates their own facilities
    approxProperties: 180
  },
  'CTRE': {
    name: 'CareTrust REIT',
    cik: '0001590717',
    atlasId: 14601,
    expectedType: 'reit',
    approxProperties: 110
  },
  'LTC': {
    name: 'LTC Properties',
    cik: '0000887905',
    atlasId: 14625,
    expectedType: 'reit',
    approxProperties: 100
  },
  'VTR': {
    name: 'Ventas Inc',
    cik: '0000740260',
    atlasId: 15515,
    expectedType: 'reit',
    approxProperties: 100
  }
};

// Fetch SEC EDGAR company submissions
async function fetchSecSubmissions(cik) {
  const paddedCik = cik.replace(/^0+/, '').padStart(10, '0');
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': '3GHCRE Atlas audit@3ghcre.com',
        'Accept': 'application/json'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse SEC response: ${e.message}`));
          }
        } else {
          reject(new Error(`SEC API returned ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

// Extract company info from SEC submissions
function extractSecInfo(submissions) {
  return {
    name: submissions.name,
    cik: submissions.cik,
    ein: submissions.ein,
    tickers: submissions.tickers || [],
    exchanges: submissions.exchanges || [],
    sicDescription: submissions.sicDescription,
    stateOfIncorporation: submissions.stateOfIncorporation,
    fiscalYearEnd: submissions.fiscalYearEnd,
    recentFilingsCount: submissions.filings?.recent?.accessionNumber?.length || 0
  };
}

async function validateReits() {
  console.log('='.repeat(70));
  console.log('ATLAS DATABASE VALIDATION AUDIT - BATCH 1: PUBLIC REITs');
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
    reits: {},
    summary: {
      total_reits: Object.keys(REITS).length,
      validated: 0,
      cik_stored: 0,
      cik_missing: 0,
      type_correct: 0,
      type_incorrect: 0,
      relationship_correct: 0,
      relationship_incorrect: 0
    },
    issues: [],
    recommendations: []
  };

  try {
    console.log('Validating REITs...\n');

    for (const [ticker, reit] of Object.entries(REITS)) {
      console.log(`--- ${ticker}: ${reit.name} ---`);

      const reitResult = {
        ticker,
        expected: reit,
        atlas: null,
        sec: null,
        validation: {
          found_in_atlas: false,
          cik_stored: false,
          company_type_correct: false,
          relationship_type_correct: false,
          property_count_accuracy: null
        },
        issues: []
      };

      // 1. Look up company in Atlas
      const [atlasRows] = await atlas.query(`
        SELECT c.id, c.company_name, c.company_type, c.sec_cik, c.sec_ticker, c.is_public,
               c.cms_affiliated_entity_id, c.ein
        FROM companies c
        WHERE c.id = ? AND c.company_name NOT LIKE '[MERGED]%'
      `, [reit.atlasId]);

      if (atlasRows.length > 0) {
        reitResult.atlas = atlasRows[0];
        reitResult.validation.found_in_atlas = true;
        console.log(`  ✓ Found in Atlas: ID ${atlasRows[0].id}, "${atlasRows[0].company_name}"`);
      } else {
        // Try by name
        const [byNameRows] = await atlas.query(`
          SELECT c.id, c.company_name, c.company_type, c.sec_cik, c.sec_ticker, c.is_public
          FROM companies c
          WHERE c.company_name LIKE ? AND c.company_name NOT LIKE '[MERGED]%'
          LIMIT 1
        `, [`%${reit.name.split(' ')[0]}%`]);

        if (byNameRows.length > 0) {
          reitResult.atlas = byNameRows[0];
          reitResult.validation.found_in_atlas = true;
          reitResult.issues.push(`Expected Atlas ID ${reit.atlasId} but found as ID ${byNameRows[0].id}`);
          console.log(`  ⚠ Found by name: ID ${byNameRows[0].id} (expected ${reit.atlasId})`);
        } else {
          reitResult.issues.push(`Not found in Atlas`);
          console.log(`  ✗ Not found in Atlas`);
        }
      }

      // 2. Fetch SEC data
      try {
        console.log(`  Fetching SEC data for CIK ${reit.cik}...`);
        const secData = await fetchSecSubmissions(reit.cik);
        reitResult.sec = extractSecInfo(secData);
        console.log(`  ✓ SEC: "${reitResult.sec.name}", EIN: ${reitResult.sec.ein}`);

        // Small delay to be polite to SEC servers
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        reitResult.issues.push(`SEC fetch failed: ${err.message}`);
        console.log(`  ✗ SEC fetch failed: ${err.message}`);
      }

      // 3. Validate CIK storage
      if (reitResult.atlas && reitResult.atlas.sec_cik === reit.cik) {
        reitResult.validation.cik_stored = true;
        results.summary.cik_stored++;
        console.log(`  ✓ CIK stored correctly`);
      } else if (reitResult.atlas) {
        results.summary.cik_missing++;
        if (reitResult.atlas.sec_cik) {
          reitResult.issues.push(`CIK mismatch: stored ${reitResult.atlas.sec_cik}, expected ${reit.cik}`);
          console.log(`  ⚠ CIK mismatch: ${reitResult.atlas.sec_cik} vs ${reit.cik}`);
        } else {
          reitResult.issues.push(`CIK not stored in Atlas`);
          results.recommendations.push(`UPDATE companies SET sec_cik = '${reit.cik}', sec_ticker = '${ticker}' WHERE id = ${reitResult.atlas.id};`);
          console.log(`  ○ CIK not stored - recommend update`);
        }
      }

      // 4. Validate company type
      if (reitResult.atlas) {
        if (reitResult.atlas.company_type === reit.expectedType) {
          reitResult.validation.company_type_correct = true;
          results.summary.type_correct++;
          console.log(`  ✓ Company type correct: ${reit.expectedType}`);
        } else {
          results.summary.type_incorrect++;
          reitResult.issues.push(`Company type: found '${reitResult.atlas.company_type}', expected '${reit.expectedType}'`);
          console.log(`  ⚠ Company type: ${reitResult.atlas.company_type} (expected ${reit.expectedType})`);
        }
      }

      // 5. Get Atlas portfolio and validate relationship types
      if (reitResult.atlas) {
        // Get property count
        const [[propertyStats]] = await atlas.query(`
          SELECT
            COUNT(DISTINCT pm.id) as total_properties,
            SUM(CASE WHEN per.relationship_type = 'property_owner' THEN 1 ELSE 0 END) as owner_count,
            SUM(CASE WHEN per.relationship_type = 'facility_operator' THEN 1 ELSE 0 END) as operator_count,
            SUM(CASE WHEN per.relationship_type NOT IN ('property_owner', 'facility_operator') THEN 1 ELSE 0 END) as other_count
          FROM property_master pm
          JOIN property_entity_relationships per ON per.property_master_id = pm.id AND per.end_date IS NULL
          JOIN entities e ON e.id = per.entity_id
          WHERE e.company_id = ?
        `, [reitResult.atlas.id]);

        reitResult.atlas.property_stats = {
          total: propertyStats.total_properties,
          as_owner: propertyStats.owner_count,
          as_operator: propertyStats.operator_count,
          other: propertyStats.other_count
        };

        console.log(`  Properties: ${propertyStats.total_properties} total (${propertyStats.owner_count} owner, ${propertyStats.operator_count} operator)`);

        // Validate: REITs should be owners, not operators
        if (reit.expectedType === 'reit') {
          if (propertyStats.operator_count > 0) {
            results.summary.relationship_incorrect++;
            reitResult.issues.push(`REIT has ${propertyStats.operator_count} facility_operator relationships (should be 0)`);
            console.log(`  ✗ REIT has ${propertyStats.operator_count} operator relationships!`);

            // Get sample properties where REIT is incorrectly operator
            const [badRelations] = await atlas.query(`
              SELECT pm.id, pm.ccn, pm.facility_name, pm.state, per.relationship_type
              FROM property_master pm
              JOIN property_entity_relationships per ON per.property_master_id = pm.id AND per.end_date IS NULL
              JOIN entities e ON e.id = per.entity_id
              WHERE e.company_id = ? AND per.relationship_type = 'facility_operator'
              LIMIT 5
            `, [reitResult.atlas.id]);

            reitResult.bad_relationships = badRelations;
          } else {
            results.summary.relationship_correct++;
            reitResult.validation.relationship_type_correct = true;
            console.log(`  ✓ Relationship types correct (all property_owner)`);
          }
        } else {
          // NHC is owner_operator - can have both
          reitResult.validation.relationship_type_correct = true;
          results.summary.relationship_correct++;
        }

        // Calculate accuracy vs expected
        if (reit.approxProperties > 0) {
          const accuracy = propertyStats.total_properties / reit.approxProperties;
          reitResult.validation.property_count_accuracy = accuracy;

          if (accuracy < 0.7) {
            reitResult.issues.push(`Property count may be low: ${propertyStats.total_properties} vs ~${reit.approxProperties} expected (${(accuracy*100).toFixed(0)}%)`);
          } else if (accuracy > 1.5) {
            reitResult.issues.push(`Property count unusually high: ${propertyStats.total_properties} vs ~${reit.approxProperties} expected (${(accuracy*100).toFixed(0)}%)`);
          }
        }
      }

      results.reits[ticker] = reitResult;
      results.summary.validated++;

      // Collect all issues
      if (reitResult.issues.length > 0) {
        for (const issue of reitResult.issues) {
          results.issues.push({ ticker, issue });
        }
      }

      console.log('');
    }

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'batch1-reit-validation.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // Generate SQL patch file
    if (results.recommendations.length > 0) {
      const patchPath = path.join(OUTPUT_DIR, 'batch1-reit-cik-patch.sql');
      const patchContent = `-- Batch 1: REIT CIK Patch
-- Generated: ${new Date().toISOString()}
-- Review and run manually after validation

${results.recommendations.join('\n')}
`;
      fs.writeFileSync(patchPath, patchContent);
      console.log(`SQL patch saved to: ${patchPath}`);
    }

    // Record metrics
    console.log('Recording metrics to quality_metrics_snapshots...');
    const phase = 'batch1_reits';
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'reits_validated', results.summary.validated, null]);
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'reits_cik_stored', results.summary.cik_stored, null]);
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'reits_type_correct', results.summary.type_correct, null]);
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'reits_relationship_correct', results.summary.relationship_correct, null]);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('BATCH 1: REIT VALIDATION SUMMARY');
    console.log('='.repeat(70));

    console.log(`\nREITs validated:           ${results.summary.validated} / ${results.summary.total_reits}`);
    console.log(`CIK stored correctly:      ${results.summary.cik_stored} / ${results.summary.validated}`);
    console.log(`Company type correct:      ${results.summary.type_correct} / ${results.summary.validated}`);
    console.log(`Relationship type correct: ${results.summary.relationship_correct} / ${results.summary.validated}`);

    // Checkpoint criteria
    console.log('\n--- CHECKPOINT 1 CRITERIA ---');
    const cikCoverage = results.summary.cik_stored / results.summary.validated;
    const typeCorrect = results.summary.type_correct / results.summary.validated;
    const relationCorrect = results.summary.relationship_correct / results.summary.validated;

    console.log(`[${cikCoverage >= 1.0 ? '✓' : '✗'}] 100% REIT CIK coverage: ${(cikCoverage * 100).toFixed(0)}%`);
    console.log(`[${typeCorrect >= 0.95 ? '✓' : '✗'}] 95%+ company type accuracy: ${(typeCorrect * 100).toFixed(0)}%`);
    console.log(`[${relationCorrect >= 1.0 ? '✓' : '✗'}] Zero REITs marked as facility_operator: ${results.summary.relationship_incorrect} violations`);

    if (results.issues.length > 0) {
      console.log('\n--- ISSUES TO RESOLVE ---');
      for (const { ticker, issue } of results.issues) {
        console.log(`  ${ticker}: ${issue}`);
      }
    }

    if (results.recommendations.length > 0) {
      console.log('\n--- RECOMMENDATIONS ---');
      console.log(`  ${results.recommendations.length} CIK updates recommended (see batch1-reit-cik-patch.sql)`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('BATCH 1 COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

validateReits().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
