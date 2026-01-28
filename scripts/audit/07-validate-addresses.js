/**
 * 07-validate-addresses.js
 * Address Validation: Verify all addresses associated with companies
 *
 * Validates addresses from multiple sources:
 * - Real Estate API property addresses
 * - CMS enrollment addresses
 * - Entity/Company registered addresses
 * - PropCo mailing addresses
 *
 * Checks for:
 * - Address completeness (street, city, state, zip)
 * - Address consistency across sources
 * - Geographic clustering validation
 * - Duplicate address detection
 *
 * Usage: node scripts/audit/07-validate-addresses.js
 */

const { getAtlasConnection } = require('../lib/db-config');
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
    .trim();
}

// Calculate address similarity
function addressSimilarity(addr1, addr2) {
  const norm1 = normalizeAddress(addr1);
  const norm2 = normalizeAddress(addr2);

  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;

  // Token-based similarity
  const tokens1 = new Set(norm1.split(' ').filter(t => t.length > 1));
  const tokens2 = new Set(norm2.split(' ').filter(t => t.length > 1));

  const intersection = [...tokens1].filter(t => tokens2.has(t)).length;
  const union = new Set([...tokens1, ...tokens2]).size;

  return union > 0 ? intersection / union : 0;
}

// Validate US ZIP code format
function isValidZip(zip) {
  if (!zip) return false;
  const clean = zip.replace(/\D/g, '');
  return clean.length === 5 || clean.length === 9;
}

// Validate US state code
const VALID_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
]);

function isValidState(state) {
  if (!state) return false;
  return VALID_STATES.has(state.toUpperCase().trim());
}

async function validateAddresses() {
  console.log('='.repeat(70));
  console.log('ATLAS DATABASE VALIDATION AUDIT - ADDRESS VERIFICATION');
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
    property_addresses: {
      total: 0,
      complete: 0,
      missing_street: 0,
      missing_city: 0,
      missing_state: 0,
      missing_zip: 0,
      invalid_state: 0,
      invalid_zip: 0
    },
    entity_addresses: {
      total: 0,
      with_address: 0,
      missing_address: 0
    },
    company_addresses: {
      total: 0,
      with_address: 0,
      missing_address: 0
    },
    address_consistency: {
      cms_vs_reapi_matches: 0,
      cms_vs_reapi_mismatches: 0,
      sample_mismatches: []
    },
    duplicate_addresses: [],
    geocoding_coverage: {
      with_coords: 0,
      without_coords: 0
    },
    issues: []
  };

  try {
    // ========================================
    // PART 1: Property Address Completeness
    // ========================================
    console.log('--- PART 1: PROPERTY ADDRESS COMPLETENESS ---\n');

    const [[{ total_properties }]] = await atlas.query(`SELECT COUNT(*) as total_properties FROM property_master`);
    results.property_addresses.total = total_properties;

    // Complete addresses (all fields present)
    const [[{ complete }]] = await atlas.query(`
      SELECT COUNT(*) as complete FROM property_master
      WHERE address IS NOT NULL AND address != ''
        AND city IS NOT NULL AND city != ''
        AND state IS NOT NULL AND state != ''
        AND zip IS NOT NULL AND zip != ''
    `);
    results.property_addresses.complete = complete;

    // Missing components
    const [[{ missing_street }]] = await atlas.query(`
      SELECT COUNT(*) as missing_street FROM property_master
      WHERE address IS NULL OR address = ''
    `);
    results.property_addresses.missing_street = missing_street;

    const [[{ missing_city }]] = await atlas.query(`
      SELECT COUNT(*) as missing_city FROM property_master
      WHERE city IS NULL OR city = ''
    `);
    results.property_addresses.missing_city = missing_city;

    const [[{ missing_state }]] = await atlas.query(`
      SELECT COUNT(*) as missing_state FROM property_master
      WHERE state IS NULL OR state = ''
    `);
    results.property_addresses.missing_state = missing_state;

    const [[{ missing_zip }]] = await atlas.query(`
      SELECT COUNT(*) as missing_zip FROM property_master
      WHERE zip IS NULL OR zip = ''
    `);
    results.property_addresses.missing_zip = missing_zip;

    console.log(`  Total properties:     ${total_properties}`);
    console.log(`  Complete addresses:   ${complete} (${(100*complete/total_properties).toFixed(1)}%)`);
    console.log(`  Missing street:       ${missing_street}`);
    console.log(`  Missing city:         ${missing_city}`);
    console.log(`  Missing state:        ${missing_state}`);
    console.log(`  Missing zip:          ${missing_zip}`);

    // Invalid state codes
    const [invalidStates] = await atlas.query(`
      SELECT state, COUNT(*) as cnt
      FROM property_master
      WHERE state IS NOT NULL AND state != ''
        AND LENGTH(state) != 2
      GROUP BY state
      ORDER BY cnt DESC
      LIMIT 20
    `);

    if (invalidStates.length > 0) {
      results.property_addresses.invalid_state = invalidStates.reduce((sum, r) => sum + r.cnt, 0);
      console.log(`\n  Invalid state codes: ${results.property_addresses.invalid_state}`);
      for (const row of invalidStates.slice(0, 5)) {
        console.log(`    "${row.state}": ${row.cnt}`);
      }
    }

    // Geocoding coverage
    const [[{ with_coords }]] = await atlas.query(`
      SELECT COUNT(*) as with_coords FROM property_master
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `);
    results.geocoding_coverage.with_coords = with_coords;
    results.geocoding_coverage.without_coords = total_properties - with_coords;

    console.log(`\n  Geocoded:            ${with_coords} (${(100*with_coords/total_properties).toFixed(1)}%)`);
    console.log(`  Not geocoded:        ${total_properties - with_coords}`);

    // ========================================
    // PART 2: CMS vs Property Address Consistency
    // ========================================
    console.log('\n--- PART 2: CMS vs PROPERTY ADDRESS CONSISTENCY ---\n');

    // Check if CMS staging table exists and has address data
    const [[{ cmsTableExists }]] = await atlas.query(`
      SELECT COUNT(*) as cmsTableExists
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cms_enrollments_staging'
    `);

    if (cmsTableExists) {
      const [addressComparison] = await atlas.query(`
        SELECT
          pm.id,
          pm.ccn,
          pm.address as atlas_address,
          pm.city as atlas_city,
          pm.state as atlas_state,
          pm.zip as atlas_zip,
          ces.address_line_1 as cms_address,
          ces.city as cms_city,
          ces.state as cms_state,
          ces.zip_code as cms_zip
        FROM property_master pm
        JOIN cms_enrollments_staging ces ON ces.ccn = pm.ccn
        WHERE pm.address IS NOT NULL AND ces.address_line_1 IS NOT NULL
        LIMIT 2000
      `);

      let matches = 0;
      let mismatches = 0;
      const mismatchSamples = [];

      for (const row of addressComparison) {
        const addrSim = addressSimilarity(row.atlas_address, row.cms_address);
        const cityMatch = (row.atlas_city || '').toUpperCase() === (row.cms_city || '').toUpperCase();
        const stateMatch = (row.atlas_state || '').toUpperCase() === (row.cms_state || '').toUpperCase();

        if (addrSim >= 0.7 && cityMatch && stateMatch) {
          matches++;
        } else {
          mismatches++;
          if (mismatchSamples.length < 100) {
            mismatchSamples.push({
              ccn: row.ccn,
              atlas: `${row.atlas_address}, ${row.atlas_city}, ${row.atlas_state} ${row.atlas_zip}`,
              cms: `${row.cms_address}, ${row.cms_city}, ${row.cms_state} ${row.cms_zip}`,
              similarity: Math.round(addrSim * 100)
            });
          }
        }
      }

      results.address_consistency.cms_vs_reapi_matches = matches;
      results.address_consistency.cms_vs_reapi_mismatches = mismatches;
      results.address_consistency.sample_mismatches = mismatchSamples;

      const alignmentRate = addressComparison.length > 0 ? matches / addressComparison.length : 0;
      console.log(`  Compared: ${addressComparison.length} properties`);
      console.log(`  Aligned:  ${matches} (${(alignmentRate * 100).toFixed(1)}%)`);
      console.log(`  Mismatch: ${mismatches}`);

      if (mismatchSamples.length > 0) {
        console.log('\n  Sample address mismatches:');
        for (const m of mismatchSamples.slice(0, 5)) {
          console.log(`    CCN ${m.ccn} (${m.similarity}% similar):`);
          console.log(`      Atlas: ${m.atlas}`);
          console.log(`      CMS:   ${m.cms}`);
        }
      }
    } else {
      console.log('  CMS staging table not found - skipping comparison');
    }

    // ========================================
    // PART 3: Entity Address Coverage
    // ========================================
    console.log('\n--- PART 3: ENTITY ADDRESS COVERAGE ---\n');

    // Check if entities table has address columns
    const [entityColumns] = await atlas.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entities'
        AND COLUMN_NAME IN ('address', 'street', 'city', 'state', 'zip', 'mailing_address')
    `);

    if (entityColumns.length > 0) {
      const [[{ total_entities }]] = await atlas.query(`SELECT COUNT(*) as total_entities FROM entities`);
      results.entity_addresses.total = total_entities;

      // Try different possible column names
      const addrCol = entityColumns.find(c => c.COLUMN_NAME === 'address' || c.COLUMN_NAME === 'street' || c.COLUMN_NAME === 'mailing_address');
      if (addrCol) {
        const [[{ with_address }]] = await atlas.query(`
          SELECT COUNT(*) as with_address FROM entities
          WHERE ${addrCol.COLUMN_NAME} IS NOT NULL AND ${addrCol.COLUMN_NAME} != ''
        `);
        results.entity_addresses.with_address = with_address;
        results.entity_addresses.missing_address = total_entities - with_address;

        console.log(`  Total entities:       ${total_entities}`);
        console.log(`  With address:         ${with_address} (${(100*with_address/total_entities).toFixed(1)}%)`);
        console.log(`  Missing address:      ${total_entities - with_address}`);
      }
    } else {
      console.log('  Entity table does not have address columns');
    }

    // ========================================
    // PART 4: Company Address Coverage
    // ========================================
    console.log('\n--- PART 4: COMPANY ADDRESS COVERAGE ---\n');

    const [companyColumns] = await atlas.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies'
        AND COLUMN_NAME IN ('address', 'street', 'city', 'state', 'zip', 'headquarters_address')
    `);

    if (companyColumns.length > 0) {
      const [[{ total_companies }]] = await atlas.query(`
        SELECT COUNT(*) as total_companies FROM companies WHERE company_name NOT LIKE '[MERGED]%'
      `);
      results.company_addresses.total = total_companies;

      const addrCol = companyColumns.find(c => ['address', 'street', 'headquarters_address'].includes(c.COLUMN_NAME));
      if (addrCol) {
        const [[{ with_address }]] = await atlas.query(`
          SELECT COUNT(*) as with_address FROM companies
          WHERE ${addrCol.COLUMN_NAME} IS NOT NULL AND ${addrCol.COLUMN_NAME} != ''
            AND company_name NOT LIKE '[MERGED]%'
        `);
        results.company_addresses.with_address = with_address;
        results.company_addresses.missing_address = total_companies - with_address;

        console.log(`  Total companies:      ${total_companies}`);
        console.log(`  With address:         ${with_address} (${(100*with_address/total_companies).toFixed(1)}%)`);
        console.log(`  Missing address:      ${total_companies - with_address}`);
      }
    } else {
      console.log('  Company table does not have dedicated address columns');
    }

    // ========================================
    // PART 5: Duplicate Address Detection
    // ========================================
    console.log('\n--- PART 5: DUPLICATE ADDRESS DETECTION ---\n');

    // Find properties with identical addresses (potential duplicates or multi-facility sites)
    const [duplicateAddresses] = await atlas.query(`
      SELECT
        UPPER(CONCAT(address, ', ', city, ', ', state)) as full_address,
        COUNT(*) as property_count,
        GROUP_CONCAT(ccn ORDER BY ccn SEPARATOR ', ') as ccns,
        GROUP_CONCAT(facility_name ORDER BY ccn SEPARATOR ' | ') as facilities
      FROM property_master
      WHERE address IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL
      GROUP BY UPPER(CONCAT(address, ', ', city, ', ', state))
      HAVING COUNT(*) > 1
      ORDER BY property_count DESC
      LIMIT 50
    `);

    results.duplicate_addresses = duplicateAddresses.map(d => ({
      address: d.full_address,
      count: d.property_count,
      ccns: d.ccns,
      facilities: d.facilities
    }));

    console.log(`  Addresses with multiple properties: ${duplicateAddresses.length}`);

    if (duplicateAddresses.length > 0) {
      console.log('\n  Sample duplicate addresses:');
      for (const d of duplicateAddresses.slice(0, 5)) {
        console.log(`    "${d.full_address.substring(0, 50)}": ${d.property_count} properties`);
        console.log(`      CCNs: ${d.ccns}`);
      }
    }

    // ========================================
    // PART 6: State Distribution
    // ========================================
    console.log('\n--- PART 6: STATE DISTRIBUTION ---\n');

    const [stateDistribution] = await atlas.query(`
      SELECT state, COUNT(*) as cnt
      FROM property_master
      WHERE state IS NOT NULL AND state != ''
      GROUP BY state
      ORDER BY cnt DESC
      LIMIT 15
    `);

    console.log('  Top states by property count:');
    console.log('  State     Count');
    console.log('  ' + '-'.repeat(20));
    for (const row of stateDistribution) {
      console.log(`  ${row.state.padEnd(8)} ${row.cnt.toString().padStart(6)}`);
    }

    // ========================================
    // PART 7: ZIP Code Analysis
    // ========================================
    console.log('\n--- PART 7: ZIP CODE ANALYSIS ---\n');

    // Invalid ZIP formats
    const [invalidZips] = await atlas.query(`
      SELECT zip, COUNT(*) as cnt
      FROM property_master
      WHERE zip IS NOT NULL AND zip != ''
        AND (LENGTH(REPLACE(zip, '-', '')) NOT IN (5, 9)
             OR zip NOT REGEXP '^[0-9]{5}(-[0-9]{4})?$')
      GROUP BY zip
      ORDER BY cnt DESC
      LIMIT 20
    `);

    if (invalidZips.length > 0) {
      const invalidCount = invalidZips.reduce((sum, r) => sum + r.cnt, 0);
      results.property_addresses.invalid_zip = invalidCount;
      console.log(`  Invalid ZIP formats: ${invalidCount}`);
      console.log('\n  Sample invalid ZIPs:');
      for (const row of invalidZips.slice(0, 5)) {
        console.log(`    "${row.zip}": ${row.cnt} properties`);
      }
    } else {
      console.log('  ✓ All ZIP codes appear valid');
    }

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'batch7-addresses.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // Generate address mismatch CSV
    if (results.address_consistency.sample_mismatches.length > 0) {
      const csvPath = path.join(OUTPUT_DIR, 'ADDRESS_MISMATCHES.csv');
      const csvContent = [
        'ccn,atlas_address,cms_address,similarity_pct',
        ...results.address_consistency.sample_mismatches.map(m =>
          `${m.ccn},"${m.atlas}","${m.cms}",${m.similarity}`
        )
      ].join('\n');
      fs.writeFileSync(csvPath, csvContent);
      console.log(`Address mismatch report saved to: ${csvPath}`);
    }

    // Generate duplicate addresses CSV
    if (results.duplicate_addresses.length > 0) {
      const dupCsvPath = path.join(OUTPUT_DIR, 'DUPLICATE_ADDRESSES.csv');
      const dupCsv = [
        'address,property_count,ccns,facilities',
        ...results.duplicate_addresses.map(d =>
          `"${d.address}",${d.count},"${d.ccns}","${(d.facilities || '').replace(/"/g, '""').substring(0, 500)}"`
        )
      ].join('\n');
      fs.writeFileSync(dupCsvPath, dupCsv);
      console.log(`Duplicate addresses report saved to: ${dupCsvPath}`);
    }

    // Record metrics
    console.log('Recording metrics...');
    const phase = 'batch7_addresses';
    const completePct = total_properties > 0 ? (complete / total_properties) * 100 : 0;
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'address_complete_pct', completePct, null]);
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'address_missing_street', missing_street, null]);
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'geocoding_coverage_pct', (with_coords / total_properties) * 100, null]);
    await atlas.query('CALL record_quality_metric(?, ?, ?, ?)', [phase, 'duplicate_addresses', duplicateAddresses.length, null]);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('ADDRESS VALIDATION SUMMARY');
    console.log('='.repeat(70));

    const completeness = total_properties > 0 ? complete / total_properties : 0;

    console.log(`\nProperty Addresses:`);
    console.log(`  Complete:            ${complete} / ${total_properties} (${(completeness * 100).toFixed(1)}%)`);
    console.log(`  Missing street:      ${missing_street}`);
    console.log(`  Invalid state:       ${results.property_addresses.invalid_state || 0}`);
    console.log(`  Invalid ZIP:         ${results.property_addresses.invalid_zip || 0}`);

    console.log(`\nGeocoding:`);
    console.log(`  With coordinates:    ${with_coords} (${(100*with_coords/total_properties).toFixed(1)}%)`);

    console.log(`\nAddress Consistency:`);
    console.log(`  CMS aligned:         ${results.address_consistency.cms_vs_reapi_matches}`);
    console.log(`  CMS mismatched:      ${results.address_consistency.cms_vs_reapi_mismatches}`);

    console.log(`\nDuplicates:`);
    console.log(`  Shared addresses:    ${duplicateAddresses.length}`);

    // Checkpoint criteria
    console.log('\n--- ADDRESS VALIDATION CRITERIA ---');
    console.log(`[${completeness >= 0.95 ? '✓' : '✗'}] 95%+ address completeness: ${(completeness * 100).toFixed(1)}%`);
    console.log(`[${(results.property_addresses.invalid_state || 0) === 0 ? '✓' : '✗'}] Zero invalid states: ${results.property_addresses.invalid_state || 0}`);
    console.log(`[${with_coords / total_properties >= 0.80 ? '✓' : '○'}] 80%+ geocoding coverage: ${(100*with_coords/total_properties).toFixed(1)}%`);

    if (results.issues.length > 0) {
      console.log('\n--- ISSUES ---');
      for (const issue of results.issues.slice(0, 10)) {
        console.log(`  ${issue.type}: ${issue.message || issue.count}`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('ADDRESS VALIDATION COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

validateAddresses().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
