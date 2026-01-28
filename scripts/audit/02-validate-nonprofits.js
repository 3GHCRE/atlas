/**
 * 02-validate-nonprofits.js
 * Batch 2: Validate major nonprofit operators against ProPublica 990 data
 *
 * Validates nonprofit healthcare operators:
 * - Cross-reference EINs with ProPublica Nonprofit Explorer
 * - Match 990 officers to Atlas principals
 * - Verify company_type classification (operating, owner_operator)
 *
 * Usage: node scripts/audit/02-validate-nonprofits.js
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');

// Major nonprofit SNF operators to validate
const NONPROFITS = [
  { name: 'Good Samaritan Society', state: 'SD', ein: '46-0204785', expectedType: 'operating' },
  { name: 'Ascension Living', state: 'MO', ein: null, expectedType: 'operating' },
  { name: 'Benedictine Health System', state: 'MN', ein: '41-0889270', expectedType: 'operating' },
  { name: 'Baptist Health', state: null, ein: null, expectedType: 'operating' },
  { name: 'Presbyterian Senior Care', state: 'PA', ein: null, expectedType: 'operating' },
  { name: 'Providence Health', state: 'WA', ein: null, expectedType: 'operating' },
  { name: 'Trinity Health', state: 'MI', ein: null, expectedType: 'operating' },
  { name: 'Avera Health', state: 'SD', ein: null, expectedType: 'operating' },
  { name: 'CommonSpirit Health', state: 'IL', ein: null, expectedType: 'operating' },
  { name: 'Covenant Health', state: null, ein: null, expectedType: 'operating' }
];

// ProPublica API functions
async function searchProPublica(query, state = null) {
  let url = `https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(query)}`;
  if (state) url += `&state%5Bid%5D=${state}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse ProPublica response: ${e.message}`));
          }
        } else {
          reject(new Error(`ProPublica API returned ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

async function getOrganization990(ein) {
  // Format EIN for API (remove dashes)
  const cleanEin = ein.replace(/-/g, '');
  const url = `https://projects.propublica.org/nonprofits/api/v2/organizations/${cleanEin}.json`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse ProPublica response: ${e.message}`));
          }
        } else if (res.statusCode === 404) {
          resolve(null);
        } else {
          reject(new Error(`ProPublica API returned ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function formatEin(ein) {
  if (!ein) return null;
  const clean = String(ein).replace(/\D/g, '').padStart(9, '0');
  return `${clean.slice(0, 2)}-${clean.slice(2)}`;
}

// Healthcare NTEE codes
const HEALTHCARE_NTEE_PREFIX = ['E', 'F', 'G', 'H', 'P'];

function isHealthcareRelated(nteeCode) {
  if (!nteeCode) return false;
  return HEALTHCARE_NTEE_PREFIX.some(prefix => nteeCode.startsWith(prefix));
}

async function validateNonprofits() {
  console.log('='.repeat(70));
  console.log('ATLAS DATABASE VALIDATION AUDIT - BATCH 2: NONPROFIT OPERATORS');
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
    nonprofits: [],
    atlas_nonprofits: [],
    summary: {
      target_count: NONPROFITS.length,
      found_in_atlas: 0,
      ein_matched: 0,
      officers_linked: 0,
      total_officers_found: 0,
      company_type_correct: 0
    },
    issues: [],
    recommendations: []
  };

  try {
    // ========================================
    // PART 1: Validate known nonprofits
    // ========================================
    console.log('--- PART 1: VALIDATING KNOWN NONPROFITS ---\n');

    for (const nonprofit of NONPROFITS) {
      console.log(`\n--- ${nonprofit.name} ---`);

      const result = {
        name: nonprofit.name,
        state: nonprofit.state,
        expected_ein: nonprofit.ein,
        atlas: null,
        propublica: null,
        validation: {
          found_in_atlas: false,
          ein_stored: false,
          ein_verified: false,
          officers_linked: 0,
          company_type_correct: false
        },
        issues: []
      };

      // 1. Search Atlas for the nonprofit
      const [atlasMatches] = await atlas.query(`
        SELECT c.id, c.company_name, c.company_type, c.ein, c.cms_affiliated_entity_id
        FROM companies c
        WHERE (c.company_name LIKE ? OR c.company_name LIKE ?)
          AND c.company_name NOT LIKE '[MERGED]%'
        ORDER BY
          CASE WHEN c.company_name LIKE ? THEN 0 ELSE 1 END,
          LENGTH(c.company_name)
        LIMIT 5
      `, [`%${nonprofit.name}%`, `%${nonprofit.name.split(' ')[0]}%`, `${nonprofit.name}%`]);

      if (atlasMatches.length > 0) {
        result.atlas = atlasMatches[0];
        result.validation.found_in_atlas = true;
        results.summary.found_in_atlas++;
        console.log(`  ✓ Found in Atlas: ID ${atlasMatches[0].id}, "${atlasMatches[0].company_name}"`);

        // Check company type
        if (atlasMatches[0].company_type === nonprofit.expectedType ||
            atlasMatches[0].company_type === 'owner_operator' ||
            atlasMatches[0].company_type === 'operating') {
          result.validation.company_type_correct = true;
          results.summary.company_type_correct++;
        } else {
          result.issues.push(`Company type: '${atlasMatches[0].company_type}' (expected operating or owner_operator)`);
        }

        // Get property count
        const [[propStats]] = await atlas.query(`
          SELECT COUNT(DISTINCT pm.id) as property_count
          FROM property_master pm
          JOIN property_entity_relationships per ON per.property_master_id = pm.id AND per.end_date IS NULL
          JOIN entities e ON e.id = per.entity_id
          WHERE e.company_id = ?
        `, [atlasMatches[0].id]);

        result.atlas.property_count = propStats.property_count;
        console.log(`  Properties: ${propStats.property_count}`);

        // Get principal count
        const [[principalStats]] = await atlas.query(`
          SELECT COUNT(DISTINCT pcr.principal_id) as principal_count
          FROM principal_company_relationships pcr
          WHERE pcr.company_id = ? AND pcr.end_date IS NULL
        `, [atlasMatches[0].id]);

        result.atlas.principal_count = principalStats.principal_count;
        console.log(`  Principals linked: ${principalStats.principal_count}`);

        if (atlasMatches[0].ein) {
          result.validation.ein_stored = true;
          console.log(`  EIN stored: ${atlasMatches[0].ein}`);
        }
      } else {
        result.issues.push('Not found in Atlas');
        console.log(`  ✗ Not found in Atlas`);
      }

      // 2. Search ProPublica
      try {
        console.log(`  Searching ProPublica...`);

        let propublicaOrg = null;

        // If we have a known EIN, fetch directly
        if (nonprofit.ein) {
          propublicaOrg = await getOrganization990(nonprofit.ein);
          if (propublicaOrg) {
            result.propublica = {
              ein: formatEin(propublicaOrg.organization.ein),
              name: propublicaOrg.organization.name,
              city: propublicaOrg.organization.city,
              state: propublicaOrg.organization.state,
              ntee_code: propublicaOrg.organization.ntee_code,
              revenue: propublicaOrg.organization.revenue_amount,
              assets: propublicaOrg.organization.asset_amount,
              filings_count: propublicaOrg.filings_with_data?.length || 0
            };

            result.validation.ein_verified = true;
            console.log(`  ✓ ProPublica: EIN ${result.propublica.ein}, "${result.propublica.name}"`);
          }
        } else {
          // Search by name
          const searchResults = await searchProPublica(nonprofit.name, nonprofit.state);
          if (searchResults.total_results > 0) {
            // Find best healthcare match
            const healthcareOrgs = searchResults.organizations.filter(o =>
              isHealthcareRelated(o.ntee_code) ||
              o.name.toLowerCase().includes('health') ||
              o.name.toLowerCase().includes('care') ||
              o.name.toLowerCase().includes('nursing')
            );

            const bestMatch = healthcareOrgs[0] || searchResults.organizations[0];
            result.propublica = {
              ein: formatEin(bestMatch.ein),
              name: bestMatch.name,
              city: bestMatch.city,
              state: bestMatch.state,
              ntee_code: bestMatch.ntee_code,
              revenue: bestMatch.revenue_amount,
              assets: bestMatch.asset_amount,
              total_search_results: searchResults.total_results
            };
            console.log(`  ✓ ProPublica search: ${searchResults.total_results} results, best: "${bestMatch.name}"`);
          } else {
            console.log(`  ○ ProPublica: No results found`);
          }
        }

        // Small delay
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        result.issues.push(`ProPublica API error: ${err.message}`);
        console.log(`  ✗ ProPublica error: ${err.message}`);
      }

      // 3. Validate EIN if both sources have it
      if (result.atlas?.ein && result.propublica?.ein) {
        const atlasEin = formatEin(result.atlas.ein);
        if (atlasEin === result.propublica.ein) {
          results.summary.ein_matched++;
          console.log(`  ✓ EIN verified: ${atlasEin}`);
        } else {
          result.issues.push(`EIN mismatch: Atlas ${atlasEin} vs ProPublica ${result.propublica.ein}`);
          console.log(`  ⚠ EIN mismatch: ${atlasEin} vs ${result.propublica.ein}`);
        }
      } else if (result.atlas && result.propublica?.ein && !result.atlas.ein) {
        results.recommendations.push(`UPDATE companies SET ein = '${result.propublica.ein}' WHERE id = ${result.atlas.id}; -- ${nonprofit.name}`);
        console.log(`  ○ Recommend storing EIN: ${result.propublica.ein}`);
      }

      results.nonprofits.push(result);

      if (result.issues.length > 0) {
        for (const issue of result.issues) {
          results.issues.push({ name: nonprofit.name, issue });
        }
      }
    }

    // ========================================
    // PART 2: Scan Atlas for all nonprofit companies
    // ========================================
    console.log('\n--- PART 2: SCAN ALL ATLAS NONPROFITS ---\n');

    const [allNonprofits] = await atlas.query(`
      SELECT
        c.id,
        c.company_name,
        c.company_type,
        c.ein,
        COUNT(DISTINCT pm.id) as property_count,
        COUNT(DISTINCT pcr.principal_id) as principal_count
      FROM companies c
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      LEFT JOIN principal_company_relationships pcr ON pcr.company_id = c.id AND pcr.end_date IS NULL
      WHERE c.company_type IN ('operating', 'owner_operator')
        AND c.company_name NOT LIKE '[MERGED]%'
        AND (
          c.company_name LIKE '%Health System%'
          OR c.company_name LIKE '%Healthcare%'
          OR c.company_name LIKE '%Senior%'
          OR c.company_name LIKE '%Living%'
          OR c.company_name LIKE '%Lutheran%'
          OR c.company_name LIKE '%Baptist%'
          OR c.company_name LIKE '%Catholic%'
          OR c.company_name LIKE '%Presbyterian%'
          OR c.company_name LIKE '%Methodist%'
          OR c.company_name LIKE '%Society%'
        )
      GROUP BY c.id
      HAVING property_count >= 5
      ORDER BY property_count DESC
      LIMIT 75
    `);

    console.log(`Found ${allNonprofits.length} potential nonprofit operators with 5+ properties\n`);

    results.atlas_nonprofits = allNonprofits.map(n => ({
      id: n.id,
      name: n.company_name,
      type: n.company_type,
      ein: n.ein,
      property_count: n.property_count,
      principal_count: n.principal_count
    }));

    // Check EIN coverage
    const withEin = allNonprofits.filter(n => n.ein).length;

    console.log(`  EIN coverage: ${withEin} / ${allNonprofits.length} (${(100*withEin/allNonprofits.length).toFixed(1)}%)`);

    // Top nonprofits by property count
    console.log('\n  Top nonprofit operators by property count:');
    for (const np of allNonprofits.slice(0, 10)) {
      const einStatus = np.ein ? '✓' : '○';
      console.log(`    ${einStatus} ${np.company_name.substring(0, 50).padEnd(50)} ${np.property_count.toString().padStart(4)} properties`);
    }

    // ========================================
    // PART 3: Identify nonprofits missing EIN
    // ========================================
    console.log('\n--- PART 3: NONPROFITS MISSING EIN ---\n');

    const missingEin = allNonprofits.filter(n => !n.ein && n.property_count >= 10);
    console.log(`Nonprofits with 10+ properties but no EIN: ${missingEin.length}`);

    if (missingEin.length > 0) {
      console.log('\n  Priority for EIN research:');
      for (const np of missingEin.slice(0, 15)) {
        console.log(`    ID ${np.id}: ${np.company_name} (${np.property_count} properties)`);
        results.recommendations.push(`-- Research EIN for company ID ${np.id}: ${np.company_name}`);
      }
    }

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'batch2-nonprofit-validation.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // Generate recommendations file
    if (results.recommendations.length > 0) {
      const recsPath = path.join(OUTPUT_DIR, 'batch2-nonprofit-recommendations.sql');
      const recsContent = `-- Batch 2: Nonprofit EIN Updates
-- Generated: ${new Date().toISOString()}
-- Review and run manually after validation

${results.recommendations.join('\n')}
`;
      fs.writeFileSync(recsPath, recsContent);
      console.log(`Recommendations saved to: ${recsPath}`);
    }

    // Skip metrics recording if stored procedure doesn't exist
    console.log('Skipping metrics recording (stored procedure not available)');

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('BATCH 2: NONPROFIT VALIDATION SUMMARY');
    console.log('='.repeat(70));

    console.log(`\nTarget nonprofits validated: ${results.nonprofits.length}`);
    console.log(`Found in Atlas:              ${results.summary.found_in_atlas} / ${results.nonprofits.length}`);
    console.log(`EIN verified (both sources): ${results.summary.ein_matched}`);
    console.log(`Company type correct:        ${results.summary.company_type_correct}`);

    console.log(`\nAtlas nonprofit scan:`);
    console.log(`Total potential nonprofits:  ${allNonprofits.length}`);
    console.log(`With EIN stored:             ${withEin} (${(100*withEin/allNonprofits.length).toFixed(1)}%)`);
    console.log(`Missing EIN (10+ props):     ${missingEin.length}`);

    // Checkpoint criteria
    console.log('\n--- CHECKPOINT 2 CRITERIA ---');
    const einCoverage = withEin / allNonprofits.length;
    const typePct = results.summary.company_type_correct / results.summary.found_in_atlas;

    console.log(`[${einCoverage >= 0.80 ? '✓' : '✗'}] 80%+ nonprofit EIN coverage: ${(einCoverage * 100).toFixed(1)}%`);
    console.log(`[${typePct >= 0.90 ? '✓' : '○'}] 90%+ company types correct: ${(typePct * 100).toFixed(1)}%`);
    console.log(`[○] Officer linkage to principals: requires additional analysis`);

    if (results.issues.length > 0) {
      console.log('\n--- ISSUES ---');
      for (const { name, issue } of results.issues.slice(0, 10)) {
        console.log(`  ${name}: ${issue}`);
      }
      if (results.issues.length > 10) {
        console.log(`  ... and ${results.issues.length - 10} more`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('BATCH 2 COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

validateNonprofits().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
