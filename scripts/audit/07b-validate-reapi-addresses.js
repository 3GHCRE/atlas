/**
 * 07b-validate-reapi-addresses.js
 * Address Validation: Verify REAPI addresses against Atlas and CMS
 *
 * Specifically validates addresses from Real Estate API sources:
 * - reapi_property_addresses (physical addresses)
 * - reapi_owner_info (mail addresses / owner addresses)
 * - Cross-validates with property_master addresses
 * - Identifies company address patterns (mail_address clustering)
 *
 * Usage: node scripts/audit/07b-validate-reapi-addresses.js
 */

const { getAtlasConnection, getReapiConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');

// Normalize address for comparison
function normalizeAddress(address) {
  if (!address) return '';
  return address
    .toUpperCase()
    .replace(/[,.'#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bCOURT\b/g, 'CT')
    .replace(/\bAPARTMENT\b/g, 'APT')
    .replace(/\bSUITE\b/g, 'STE')
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bWEST\b/g, 'W')
    .replace(/\bPO\s*BOX\b/g, 'PO BOX')
    .trim();
}

// Calculate address similarity
function addressSimilarity(addr1, addr2) {
  const norm1 = normalizeAddress(addr1);
  const norm2 = normalizeAddress(addr2);

  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;

  const tokens1 = new Set(norm1.split(' ').filter(t => t.length > 1));
  const tokens2 = new Set(norm2.split(' ').filter(t => t.length > 1));

  const intersection = [...tokens1].filter(t => tokens2.has(t)).length;
  const union = new Set([...tokens1, ...tokens2]).size;

  return union > 0 ? intersection / union : 0;
}

async function validateReapiAddresses() {
  console.log('='.repeat(70));
  console.log('ATLAS DATABASE VALIDATION AUDIT - REAPI ADDRESS VERIFICATION');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let atlas, reapi;

  const results = {
    timestamp: new Date().toISOString(),
    reapi_coverage: {
      total_reapi_properties: 0,
      with_property_address: 0,
      with_owner_mail_address: 0,
      ccn_linked: 0
    },
    atlas_reapi_comparison: {
      total_compared: 0,
      address_match: 0,
      address_mismatch: 0,
      city_match: 0,
      state_match: 0,
      zip_match: 0
    },
    company_mail_addresses: [],
    owner_address_clusters: [],
    address_mismatches: [],
    issues: []
  };

  try {
    atlas = await getAtlasConnection();
    console.log('Connected to Atlas database');

    try {
      reapi = await getReapiConnection();
      console.log('Connected to REAPI database\n');
    } catch (e) {
      console.log('⚠ Could not connect to REAPI database - using Atlas local copy\n');
      reapi = null;
    }

    // ========================================
    // PART 1: REAPI Address Coverage
    // ========================================
    console.log('--- PART 1: REAPI ADDRESS COVERAGE ---\n');

    // Check if we have REAPI tables in Atlas
    const [[{ hasReapiTables }]] = await atlas.query(`
      SELECT COUNT(*) > 0 as hasReapiTables
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('reapi_property_addresses', 'reapi_owner_info', 'reapi_properties')
    `);

    if (hasReapiTables) {
      console.log('  Using REAPI tables from Atlas database');

      // Total REAPI properties
      const [[{ total_reapi }]] = await atlas.query(`
        SELECT COUNT(*) as total_reapi FROM reapi_properties
      `);
      results.reapi_coverage.total_reapi_properties = total_reapi;
      console.log(`  Total REAPI properties: ${total_reapi}`);

      // With property address
      const [[{ with_addr }]] = await atlas.query(`
        SELECT COUNT(*) as with_addr FROM reapi_property_addresses
        WHERE address IS NOT NULL AND address != ''
      `);
      results.reapi_coverage.with_property_address = with_addr;
      console.log(`  With property address: ${with_addr}`);

      // With owner mail address
      const [[{ with_mail }]] = await atlas.query(`
        SELECT COUNT(*) as with_mail FROM reapi_owner_info
        WHERE mail_address IS NOT NULL AND mail_address != ''
      `);
      results.reapi_coverage.with_owner_mail_address = with_mail;
      console.log(`  With owner mail address: ${with_mail}`);

      // CCN linked
      const [[{ ccn_linked }]] = await atlas.query(`
        SELECT COUNT(*) as ccn_linked FROM reapi_properties rp
        JOIN property_master pm ON pm.ccn = rp.ccn
      `);
      results.reapi_coverage.ccn_linked = ccn_linked;
      console.log(`  CCN linked to Atlas: ${ccn_linked}`);

      // ========================================
      // PART 2: REAPI vs Atlas Address Comparison
      // ========================================
      console.log('\n--- PART 2: REAPI vs ATLAS ADDRESS COMPARISON ---\n');

      const [addressComparison] = await atlas.query(`
        SELECT
          pm.id as property_id,
          pm.ccn,
          pm.facility_name,
          pm.address as atlas_address,
          pm.city as atlas_city,
          pm.state as atlas_state,
          pm.zip as atlas_zip,
          rpa.address as reapi_address,
          rpa.city as reapi_city,
          rpa.state as reapi_state,
          rpa.zip as reapi_zip,
          roi.mail_address as owner_mail_address,
          roi.mail_city as owner_mail_city,
          roi.mail_state as owner_mail_state,
          roi.mail_zip as owner_mail_zip,
          roi.owner1_full_name as owner_name,
          roi.company_name as owner_company
        FROM property_master pm
        JOIN reapi_properties rp ON rp.ccn = pm.ccn
        LEFT JOIN reapi_property_addresses rpa ON rpa.property_id = rp.property_id
        LEFT JOIN reapi_owner_info roi ON roi.property_id = rp.property_id
        WHERE pm.address IS NOT NULL AND rpa.address IS NOT NULL
        LIMIT 5000
      `);

      let addrMatch = 0, addrMismatch = 0;
      let cityMatch = 0, stateMatch = 0, zipMatch = 0;
      const mismatches = [];

      for (const row of addressComparison) {
        results.atlas_reapi_comparison.total_compared++;

        // Compare addresses
        const addrSim = addressSimilarity(row.atlas_address, row.reapi_address);
        const cityEq = (row.atlas_city || '').toUpperCase().trim() === (row.reapi_city || '').toUpperCase().trim();
        const stateEq = (row.atlas_state || '').toUpperCase().trim() === (row.reapi_state || '').toUpperCase().trim();
        const zipEq = (row.atlas_zip || '').replace(/\D/g, '').substring(0, 5) === (row.reapi_zip || '').replace(/\D/g, '').substring(0, 5);

        if (addrSim >= 0.7) {
          addrMatch++;
        } else {
          addrMismatch++;
          if (mismatches.length < 200) {
            mismatches.push({
              ccn: row.ccn,
              facility_name: row.facility_name,
              atlas_full: `${row.atlas_address}, ${row.atlas_city}, ${row.atlas_state} ${row.atlas_zip}`,
              reapi_full: `${row.reapi_address}, ${row.reapi_city}, ${row.reapi_state} ${row.reapi_zip}`,
              owner_mail: row.owner_mail_address ? `${row.owner_mail_address}, ${row.owner_mail_city}, ${row.owner_mail_state}` : null,
              owner_name: row.owner_name,
              similarity: Math.round(addrSim * 100)
            });
          }
        }

        if (cityEq) cityMatch++;
        if (stateEq) stateMatch++;
        if (zipEq) zipMatch++;
      }

      results.atlas_reapi_comparison.address_match = addrMatch;
      results.atlas_reapi_comparison.address_mismatch = addrMismatch;
      results.atlas_reapi_comparison.city_match = cityMatch;
      results.atlas_reapi_comparison.state_match = stateMatch;
      results.atlas_reapi_comparison.zip_match = zipMatch;
      results.address_mismatches = mismatches;

      const total = results.atlas_reapi_comparison.total_compared;
      console.log(`  Compared: ${total} properties`);
      console.log(`  Address match (70%+ sim): ${addrMatch} (${(100*addrMatch/total).toFixed(1)}%)`);
      console.log(`  Address mismatch: ${addrMismatch}`);
      console.log(`  City match: ${cityMatch} (${(100*cityMatch/total).toFixed(1)}%)`);
      console.log(`  State match: ${stateMatch} (${(100*stateMatch/total).toFixed(1)}%)`);
      console.log(`  ZIP match: ${zipMatch} (${(100*zipMatch/total).toFixed(1)}%)`);

      if (mismatches.length > 0) {
        console.log('\n  Sample address mismatches:');
        for (const m of mismatches.slice(0, 5)) {
          console.log(`    CCN ${m.ccn} (${m.similarity}% similar):`);
          console.log(`      Atlas: ${m.atlas_full}`);
          console.log(`      REAPI: ${m.reapi_full}`);
        }
      }

      // ========================================
      // PART 3: Owner Mail Address Clustering (Company Identification)
      // ========================================
      console.log('\n--- PART 3: OWNER MAIL ADDRESS CLUSTERING ---\n');

      const [mailClusters] = await atlas.query(`
        SELECT
          CONCAT(mail_address, ', ', mail_city, ', ', mail_state) as full_mail_address,
          mail_address,
          mail_city,
          mail_state,
          COUNT(*) as property_count,
          COUNT(DISTINCT owner1_full_name) as unique_owners,
          GROUP_CONCAT(DISTINCT owner1_full_name ORDER BY owner1_full_name SEPARATOR ' | ') as owner_names,
          GROUP_CONCAT(DISTINCT company_name ORDER BY company_name SEPARATOR ' | ') as company_names
        FROM reapi_owner_info
        WHERE mail_address IS NOT NULL AND mail_address != ''
        GROUP BY mail_address, mail_city, mail_state
        HAVING property_count >= 5
        ORDER BY property_count DESC
        LIMIT 100
      `);

      results.owner_address_clusters = mailClusters.map(c => ({
        mail_address: c.full_mail_address,
        property_count: c.property_count,
        unique_owners: c.unique_owners,
        owner_names: c.owner_names,
        company_names: c.company_names
      }));

      console.log(`  Mail address clusters (5+ properties): ${mailClusters.length}`);
      console.log('\n  Top owner mailing address clusters (potential portfolio companies):');

      for (const cluster of mailClusters.slice(0, 15)) {
        console.log(`    ${cluster.full_mail_address?.substring(0, 50).padEnd(50)} ${cluster.property_count.toString().padStart(4)} props, ${cluster.unique_owners} entities`);
      }

      // ========================================
      // PART 4: Company Address Pattern Analysis
      // ========================================
      console.log('\n--- PART 4: COMPANY ADDRESS PATTERN ANALYSIS ---\n');

      // Find addresses associated with multiple owner entities (likely parent company addresses)
      const [companyPatterns] = await atlas.query(`
        SELECT
          COALESCE(company_name, 'N/A') as company_name,
          mail_address,
          mail_city,
          mail_state,
          COUNT(*) as property_count,
          GROUP_CONCAT(DISTINCT owner1_full_name ORDER BY owner1_full_name SEPARATOR ' | ') as propco_entities
        FROM reapi_owner_info
        WHERE company_name IS NOT NULL AND company_name != ''
        GROUP BY company_name, mail_address, mail_city, mail_state
        HAVING property_count >= 3
        ORDER BY property_count DESC
        LIMIT 75
      `);

      results.company_mail_addresses = companyPatterns.map(p => ({
        company: p.company_name,
        address: `${p.mail_address}, ${p.mail_city}, ${p.mail_state}`,
        property_count: p.property_count,
        propco_entities: p.propco_entities
      }));

      console.log(`  Company address patterns (3+ properties): ${companyPatterns.length}`);
      console.log('\n  Top company mailing addresses:');

      for (const pattern of companyPatterns.slice(0, 10)) {
        console.log(`    ${(pattern.company_name || 'Unknown').substring(0, 35).padEnd(35)} ${pattern.property_count.toString().padStart(4)} props @ ${pattern.mail_address?.substring(0, 40)}`);
      }

      // ========================================
      // PART 5: Atlas Company Address Verification
      // ========================================
      console.log('\n--- PART 5: ATLAS COMPANY ADDRESS VERIFICATION ---\n');

      // Check if Atlas companies have address columns
      const [companyAddrCols] = await atlas.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies'
          AND COLUMN_NAME LIKE '%address%' OR COLUMN_NAME LIKE '%street%'
      `);

      if (companyAddrCols.length > 0) {
        console.log(`  Companies table has address columns: ${companyAddrCols.map(c => c.COLUMN_NAME).join(', ')}`);

        // Compare top REAPI company addresses to Atlas
        console.log('\n  Checking if REAPI company addresses match Atlas companies...');

        for (const pattern of companyPatterns.slice(0, 10)) {
          // Try to find matching Atlas company
          const [atlasMatch] = await atlas.query(`
            SELECT id, company_name FROM companies
            WHERE company_name LIKE ? AND company_name NOT LIKE '[MERGED]%'
            LIMIT 1
          `, [`%${pattern.company_name.split(' ')[0]}%`]);

          if (atlasMatch.length > 0) {
            console.log(`    ✓ ${pattern.company_name?.substring(0, 35)} → Atlas ID ${atlasMatch[0].id}`);
          } else {
            console.log(`    ○ ${pattern.company_name?.substring(0, 35)} → Not in Atlas`);
          }
        }
      } else {
        console.log('  Companies table does not have dedicated address columns');
      }

      // ========================================
      // PART 6: Geocoding Coverage from REAPI
      // ========================================
      console.log('\n--- PART 6: REAPI GEOCODING COVERAGE ---\n');

      const [[{ reapi_geocoded }]] = await atlas.query(`
        SELECT COUNT(*) as reapi_geocoded FROM reapi_property_addresses
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      `);

      const [[{ atlas_geocoded }]] = await atlas.query(`
        SELECT COUNT(*) as atlas_geocoded FROM property_master
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      `);

      console.log(`  REAPI geocoded: ${reapi_geocoded}`);
      console.log(`  Atlas geocoded: ${atlas_geocoded}`);

      // Check for REAPI coords that could fill Atlas gaps
      const [[{ can_backfill }]] = await atlas.query(`
        SELECT COUNT(*) as can_backfill
        FROM property_master pm
        JOIN reapi_properties rp ON rp.ccn = pm.ccn
        JOIN reapi_property_addresses rpa ON rpa.property_id = rp.property_id
        WHERE pm.latitude IS NULL
          AND rpa.latitude IS NOT NULL
      `);

      console.log(`  Atlas gaps that REAPI can fill: ${can_backfill}`);

      if (can_backfill > 0) {
        results.issues.push({
          type: 'geocoding_gap',
          count: can_backfill,
          message: `${can_backfill} properties can be geocoded from REAPI data`
        });
      }

    } else {
      console.log('  REAPI tables not found in Atlas database');

      // Check if we can query REAPI directly
      if (reapi) {
        console.log('  Querying REAPI database directly...');

        const [[{ total_reapi }]] = await reapi.query(`SELECT COUNT(*) as total_reapi FROM reapi_properties`);
        results.reapi_coverage.total_reapi_properties = total_reapi;
        console.log(`  Total REAPI properties: ${total_reapi}`);

        // Run similar queries against REAPI...
        // (abbreviated for when REAPI tables aren't in Atlas)
      }
    }

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'batch7b-reapi-addresses.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // Generate address mismatch CSV
    if (results.address_mismatches.length > 0) {
      const csvPath = path.join(OUTPUT_DIR, 'REAPI_ADDRESS_MISMATCHES.csv');
      const csvContent = [
        'ccn,facility_name,atlas_address,reapi_address,owner_mail_address,owner_name,similarity_pct',
        ...results.address_mismatches.map(m =>
          `${m.ccn},"${m.facility_name || ''}","${m.atlas_full}","${m.reapi_full}","${m.owner_mail || ''}","${m.owner_name || ''}",${m.similarity}`
        )
      ].join('\n');
      fs.writeFileSync(csvPath, csvContent);
      console.log(`Address mismatch report saved to: ${csvPath}`);
    }

    // Generate company address clusters CSV
    if (results.owner_address_clusters.length > 0) {
      const clusterCsvPath = path.join(OUTPUT_DIR, 'OWNER_ADDRESS_CLUSTERS.csv');
      const clusterCsv = [
        'mail_address,property_count,unique_owners,owner_names,company_names',
        ...results.owner_address_clusters.map(c =>
          `"${c.mail_address}",${c.property_count},${c.unique_owners},"${(c.owner_names || '').replace(/"/g, '""').substring(0, 500)}","${(c.company_names || '').replace(/"/g, '""').substring(0, 200)}"`
        )
      ].join('\n');
      fs.writeFileSync(clusterCsvPath, clusterCsv);
      console.log(`Owner address clusters saved to: ${clusterCsvPath}`);
    }

    // Generate company mail addresses CSV
    if (results.company_mail_addresses.length > 0) {
      const companyCsvPath = path.join(OUTPUT_DIR, 'COMPANY_MAIL_ADDRESSES.csv');
      const companyCsv = [
        'company,mail_address,property_count,propco_entities',
        ...results.company_mail_addresses.map(c =>
          `"${c.company}","${c.address}",${c.property_count},"${(c.propco_entities || '').replace(/"/g, '""').substring(0, 500)}"`
        )
      ].join('\n');
      fs.writeFileSync(companyCsvPath, companyCsv);
      console.log(`Company mail addresses saved to: ${companyCsvPath}`);
    }

    // Record metrics
    console.log('Recording metrics...');
    const phase = 'batch7b_reapi_addresses';
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'reapi_properties_total', results.reapi_coverage.total_reapi_properties, null]);
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'reapi_ccn_linked', results.reapi_coverage.ccn_linked, null]);
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'atlas_reapi_address_match', results.atlas_reapi_comparison.address_match, null]);
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'owner_address_clusters', results.owner_address_clusters.length, null]);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('REAPI ADDRESS VALIDATION SUMMARY');
    console.log('='.repeat(70));

    console.log(`\nREAPI Coverage:`);
    console.log(`  Total REAPI properties:  ${results.reapi_coverage.total_reapi_properties}`);
    console.log(`  CCN linked to Atlas:     ${results.reapi_coverage.ccn_linked}`);
    console.log(`  With property address:   ${results.reapi_coverage.with_property_address}`);
    console.log(`  With owner mail address: ${results.reapi_coverage.with_owner_mail_address}`);

    const comp = results.atlas_reapi_comparison;
    if (comp.total_compared > 0) {
      console.log(`\nAtlas vs REAPI Address Comparison:`);
      console.log(`  Compared:        ${comp.total_compared}`);
      console.log(`  Address match:   ${comp.address_match} (${(100*comp.address_match/comp.total_compared).toFixed(1)}%)`);
      console.log(`  City match:      ${comp.city_match} (${(100*comp.city_match/comp.total_compared).toFixed(1)}%)`);
      console.log(`  State match:     ${comp.state_match} (${(100*comp.state_match/comp.total_compared).toFixed(1)}%)`);
    }

    console.log(`\nOwner Address Analysis:`);
    console.log(`  Address clusters (5+ props): ${results.owner_address_clusters.length}`);
    console.log(`  Company address patterns:    ${results.company_mail_addresses.length}`);

    // Checkpoint criteria
    console.log('\n--- REAPI ADDRESS VALIDATION CRITERIA ---');
    const addrMatchRate = comp.total_compared > 0 ? comp.address_match / comp.total_compared : 0;
    console.log(`[${addrMatchRate >= 0.90 ? '✓' : '✗'}] 90%+ Atlas/REAPI address match: ${(addrMatchRate * 100).toFixed(1)}%`);
    console.log(`[${results.owner_address_clusters.length > 0 ? '✓' : '○'}] Owner address clusters identified: ${results.owner_address_clusters.length}`);

    console.log('\n' + '='.repeat(70));
    console.log('REAPI ADDRESS VALIDATION COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    if (atlas) await atlas.end();
    if (reapi) await reapi.end();
  }
}

validateReapiAddresses().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
