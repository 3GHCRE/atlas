/**
 * REAPI Propco Layer - Batch Integration Script
 *
 * Loads propco data for multiple companies from owner_mappings.csv
 * Usage: node scripts/load-propco-batch.js [company_name]
 *        node scripts/load-propco-batch.js --all    (process all mapped companies)
 *        node scripts/load-propco-batch.js --list   (list available companies)
 */

const fs = require('fs');
const path = require('path');
const { getAtlasConnection, getReapiConnection } = require('./lib/db-config');

// Company configurations from owner_mappings.csv (top companies by property count)
const COMPANY_CONFIGS = {
  'Omega Healthcare Investors': {
    type: 'reit',
    addresses: [
      '303 International Cir Ste 200',
      '303 International Cir',
      '200 International Cir',
      '4445 Willard Ave',
      '200 International Cir Ste 3500',
      '303 Intl Cir Ste 200'
    ],
    hq: { address: '303 International Cir Ste 200', city: 'Hunt Valley', state: 'MD' },
    notes: 'OHI Asset entities, Sterling Acquisition Corp'
  },
  'Welltower': {
    type: 'reit',
    addresses: [
      '4500 Dorr St',
      '885 3rd Ave',
      '885 3rd Ave Fl 29'
    ],
    hq: { address: '4500 Dorr St', city: 'Toledo', state: 'OH' },
    notes: 'Welltower NNN Group, various Owner Llc entities'
  },
  'Cascade Capital Group': {
    type: 'reit',
    addresses: ['3450 Oakton St'],
    hq: { address: '3450 Oakton St', city: 'Skokie', state: 'IL' },
    notes: 'Property Holdings Llc entities'
  },
  'CareTrust REIT': {
    type: 'reit',
    addresses: [
      '905 Calle Amanecer',
      '905 Calle Amanecer Ste 300'
    ],
    hq: { address: '905 Calle Amanecer', city: 'San Clemente', state: 'CA' },
    notes: 'CTR Partnership Lp entities'
  },
  'National Health Investors': {
    type: 'reit',
    addresses: [
      '3570 Keith St Nw',
      '3001 Keith St Nw',
      '222 Robert Rose Dr',
      '3555 Keith St Nw'
    ],
    hq: { address: '3570 Keith St Nw', city: 'Cleveland', state: 'TN' },
    notes: 'NHI REIT - Real Estate Investors Llc entities'
  },
  'Sabra Health Care REIT': {
    type: 'reit',
    addresses: [
      '45 Broadway',
      '45 Broadway Fl 25',
      '45 Broadway Ste 520',
      '45 Broadway # 25th',
      'Po Box 92129',
      'Po Box 71970',
      '18500 Von Karman Ave Ste 550',
      '18500 Von Karman Ave #550',
      '18500 Von Karman Ave',
      '21001 N Tatum Blvd',
      '21001 N Tatum Blvd # 1630-630',
      '353 N Clark St',
      '130 S Jefferson St Ste 300'
    ],
    hq: { address: '45 Broadway', city: 'New York', state: 'NY' },
    notes: 'SMV Llc, CCP (Care Capital Properties) entities'
  },
  'Golden Living': {
    type: 'operator',
    addresses: [
      'Po Box 160488',
      '4 Embarcadero Ctr',
      '1000 Fianna Way'
    ],
    hq: { address: 'Po Box 160488', city: 'Altamonte Springs', state: 'FL' },
    notes: 'GPH entities - Golden Property Holdings'
  },
  'American Healthcare REIT': {
    type: 'reit',
    addresses: [
      '18191 Von Karman Ave Ste 300',
      '18191 Von Karman Ave'
    ],
    hq: { address: '18191 Von Karman Ave Ste 300', city: 'Irvine', state: 'CA' },
    notes: 'NYSE: AHR - Trilogy REIT Holdings LLC'
  },
  'Strawberry Fields REIT': {
    type: 'reit',
    addresses: ['6101 Nimtz Pkwy'],
    hq: { address: '6101 Nimtz Pkwy', city: 'South Bend', state: 'IN' },
    notes: 'Various address-based LLCs'
  },
  'Portopiccolo Group': {
    type: 'reit',
    addresses: [
      '980 Sylvan Ave',
      '440 Sylvan Ave Ste 240',
      '440 Sylvan Ave'
    ],
    hq: { address: '980 Sylvan Ave', city: 'Englewood Cliffs', state: 'NJ' },
    notes: 'Propco Llc entities'
  },
  'PruittHealth': {
    type: 'operator',
    addresses: ['1626 Jeurgens Ct'],
    hq: { address: '1626 Jeurgens Ct', city: 'Norcross', state: 'GA' },
    notes: 'Healthcare Properties Inc entities'
  },
  'Saber Healthcare Group': {
    type: 'operator',
    addresses: ['23700 Commerce Park'],
    hq: { address: '23700 Commerce Park', city: 'Beachwood', state: 'OH' },
    notes: 'RE Group Llc entities'
  },
  'Aperion Care': {
    type: 'operator',
    addresses: ['4655 W Chase Ave'],
    hq: { address: '4655 W Chase Ave', city: 'Lincolnwood', state: 'IL' },
    notes: 'Brands: Elevate Care, Arcadia Care, Aliya'
  },
  'Trilogy Health Services': {
    type: 'operator',
    addresses: [
      '303 N Hurstbourne Pkwy Ste 200',
      '303 N Hurstbourne Pkwy'
    ],
    hq: { address: '303 N Hurstbourne Pkwy Ste 200', city: 'Louisville', state: 'KY' },
    notes: 'Trilogy Real Estate entities'
  },
  'Marquis Health Services': {
    type: 'operator',
    addresses: [
      '575 Route 70',
      '1608 Route 88 Ste 200',
      '1608 Route 88',
      '1608 Route 88 Ste 301'
    ],
    hq: { address: '575 Route 70', city: 'Brick', state: 'NJ' },
    notes: 'SNF Realty Llc pattern'
  },
  // === BATCH 2: Mid-tier operators ===
  'Altitude Health Services': {
    type: 'operator',
    addresses: ['2201 Main St'],
    hq: { address: '2201 Main St', city: 'Evanston', state: 'IL' },
    notes: 'OMG entities, various Property Llc'
  },
  'Britthaven': {
    type: 'operator',
    addresses: ['Po Box 6159'],
    hq: { address: 'Po Box 6159', city: 'Kinston', state: 'NC' },
    notes: 'Britthaven Inc, Hillco Ltd, Neil Realty'
  },
  'NHC': {
    type: 'operator',
    addresses: ['100 E Vine St', 'Po Box 1398'],
    hq: { address: '100 E Vine St', city: 'Murfreesboro', state: 'TN' },
    notes: 'NHC Healthcare entities - distinct from NHI REIT'
  },
  'NHS Management': {
    type: 'operator',
    addresses: ['931 Fairfax Park'],
    hq: { address: '931 Fairfax Park', city: 'Tuscaloosa', state: 'AL' },
    notes: 'Health Realty Llc entities'
  },
  'Landmark Properties': {
    type: 'operator',
    addresses: ['Po Box 6016'],
    hq: { address: 'Po Box 6016', city: 'Ridgeland', state: 'MS' },
    notes: 'LA/MS healthcare entities'
  },
  'Centennial Healthcare': {
    type: 'operator',
    addresses: ['262 N University Ave', '140 N Union Ave Ste 230'],
    hq: { address: '262 N University Ave', city: 'Farmington', state: 'UT' },
    notes: 'Various address-based LLCs'
  },
  'Emerald Healthcare': {
    type: 'operator',
    addresses: ['1777 Avenue Of The States Ste 204', '1777 Avenue Of The States'],
    hq: { address: '1777 Avenue Of The States Ste 204', city: 'Lakewood', state: 'NJ' },
    notes: 'SNF Realty Llc pattern'
  },
  'Liberty Healthcare Properties': {
    type: 'operator',
    addresses: ['2334 41st St'],
    hq: { address: '2334 41st St', city: 'Wilmington', state: 'NC' },
    notes: 'Liberty Healthcare Properties of * pattern'
  },
  'YAD Healthcare': {
    type: 'operator',
    addresses: ['211 Boulevard Of Americas', '211 Boulevard Of Americas Ste 306'],
    hq: { address: '211 Boulevard Of Americas', city: 'Lakewood', state: 'NJ' },
    notes: 'Lakewood NJ operator - Propco Llc pattern'
  },
  'MFA Healthcare': {
    type: 'operator',
    addresses: ['400 Boulevard Of Americas Unit 401', '400 Boulevard Of Americas'],
    hq: { address: '400 Boulevard Of Americas Unit 401', city: 'Lakewood', state: 'NJ' },
    notes: 'Charles/Edward/Saul Family Trusts'
  },
  'LME Family Holdings': {
    type: 'operator',
    addresses: ['34 Lord Ave'],
    hq: { address: '34 Lord Ave', city: 'Lawrence', state: 'NY' },
    notes: 'Kennedy KY Holdings - 20+ facilities'
  },
  'Monarch Healthcare Management': {
    type: 'operator',
    addresses: ['638 Southbend Ave'],
    hq: { address: '638 Southbend Ave', city: 'Mankato', state: 'MN' },
    notes: 'Minnesota operator - founded 2005'
  },
  'LTC Properties': {
    type: 'reit',
    addresses: ['Po Box 20197'],
    hq: { address: 'Po Box 20197', city: 'Atlanta', state: 'GA' },
    notes: 'NYSE: LTC - senior housing REIT'
  },
  'Communicare Health Services': {
    type: 'operator',
    addresses: ['10123 Alliance Rd'],
    hq: { address: '10123 Alliance Rd', city: 'Blue Ash', state: 'OH' },
    notes: 'Ohio operator - OHI Asset and Leasing Co entities'
  },
  'CareRite Centers': {
    type: 'operator',
    addresses: ['2071 Flatbush Ave', '2071 Flatbush Ave # 22', '2420 Knapp St'],
    hq: { address: '2071 Flatbush Ave', city: 'Brooklyn', state: 'NY' },
    notes: 'Texas Operations Management, Recover-Care Healthcare'
  },
  'Genesis Healthcare': {
    type: 'operator',
    addresses: ['101 E State St'],
    hq: { address: '101 E State St', city: 'Kennett Square', state: 'PA' },
    notes: 'National operator - 200+ facilities'
  },
  'Black River Healthcare': {
    type: 'operator',
    addresses: ['362 E Kennedy Blvd'],
    hq: { address: '362 E Kennedy Blvd', city: 'Lakewood', state: 'NJ' },
    notes: 'Black River Healthcare LLC, Red River Management LLC, El Dorado Healthcare'
  },
  'Bluegrass Health Partners': {
    type: 'operator',
    addresses: ['300 Provider Ct'],
    hq: { address: '300 Provider Ct', city: 'Richmond', state: 'KY' },
    notes: 'Provider Management - Operating Propco Llc pattern'
  },
  'Care Initiatives': {
    type: 'operator',
    addresses: ['1611 West Lakes Pkwy', '1611 Westlakes Pkwy'],
    hq: { address: '1611 West Lakes Pkwy', city: 'West Des Moines', state: 'IA' },
    notes: 'Iowa largest nonprofit SNF operator - 43+ facilities'
  },
  'Complete Care Management': {
    type: 'operator',
    addresses: ['1730 Route 37 W'],
    hq: { address: '1730 Route 37 W', city: 'Toms River', state: 'NJ' },
    notes: 'Peace Capital Holdings LLC, Sam Stein - largest for-profit NJ SNF operator'
  },
  'Cantex Continuing Care': {
    type: 'operator',
    addresses: ['2537 Golden Bear Dr'],
    hq: { address: '2537 Golden Bear Dr', city: 'Carrollton', state: 'TX' },
    notes: 'Texas operator - 37 nursing centers, founded 1978'
  },
  'Vetter Senior Living': {
    type: 'operator',
    addresses: ['20220 Harney St'],
    hq: { address: '20220 Harney St', city: 'Elkhorn', state: 'NE' },
    notes: 'VSL entities - Nebraska nonprofit operator, 32 locations'
  },
  'Diversicare Healthcare': {
    type: 'operator',
    addresses: ['1621 Galleria Blvd'],
    hq: { address: '1621 Galleria Blvd', city: 'Brentwood', state: 'TN' },
    notes: '~50 SNFs in Southeast/Midwest/Southwest'
  },
  'Ethica Health': {
    type: 'operator',
    addresses: ['1005 Boulder Dr'],
    hq: { address: '1005 Boulder Dr', city: 'Gray', state: 'GA' },
    notes: 'Georgia operator - Holdings Llc pattern'
  },
  'Americare Senior Living': {
    type: 'operator',
    addresses: ['214 N Scott St'],
    hq: { address: '214 N Scott St', city: 'Sikeston', state: 'MO' },
    notes: 'Missouri operator - Nursing Llc pattern'
  },
  'Apple Healthcare': {
    type: 'operator',
    addresses: ['21 Waterville Rd'],
    hq: { address: '21 Waterville Rd', city: 'Avon', state: 'CT' },
    notes: 'Connecticut operator - Realty Llc pattern, 25+ homes'
  },
  'American Senior Communities': {
    type: 'operator',
    addresses: ['6900 Gray Rd'],
    hq: { address: '6900 Gray Rd', city: 'Indianapolis', state: 'IN' },
    notes: 'ASC - Indiana largest SNF operator, 59 CMS facilities'
  },
  'HCF Management': {
    type: 'operator',
    addresses: ['1100 Shawnee Rd'],
    hq: { address: '1100 Shawnee Rd', city: 'Lima', state: 'OH' },
    notes: 'Ohio/PA operator - HCF Realty entities, 26 facilities'
  },
  'DTD HC / Tara Cares': {
    type: 'operator',
    addresses: ['3690 Southwestern Blvd'],
    hq: { address: '3690 Southwestern Blvd', city: 'Orchard Park', state: 'NY' },
    notes: 'Leslie Wilson - Tara Therapy, Aurora Cares - NY SNF operator'
  },
  'HumanGood': {
    type: 'operator',
    addresses: ['1900 Huntington Dr'],
    hq: { address: '1900 Huntington Dr', city: 'Duarte', state: 'CA' },
    notes: 'CA largest nonprofit senior living - 122 communities'
  },
  'CommCare Corporation': {
    type: 'operator',
    addresses: ['950 W Causeway Approach'],
    hq: { address: '950 W Causeway Approach', city: 'Mandeville', state: 'LA' },
    notes: 'Louisiana nonprofit - 14 SNFs, founded 1994'
  },
  'Marquis Companies': {
    type: 'operator',
    addresses: ['4560 Se International Way Ste 100'],
    hq: { address: '4560 Se International Way Ste 100', city: 'Milwaukie', state: 'OR' },
    notes: 'Family-owned 39 years - OR/CA/NV senior living'
  },
  'Ciena Healthcare': {
    type: 'operator',
    addresses: ['4000 Town Ctr', '4000 Town Ctr Ste 2000', '4000 Town Ctr Ste 700'],
    hq: { address: '4000 Town Ctr', city: 'Southfield', state: 'MI' },
    notes: '83 facilities across 5 states'
  },
  'Autumn Lake Healthcare': {
    type: 'operator',
    addresses: ['4201 Us Highway 9'],
    hq: { address: '4201 Us Highway 9', city: 'Howell', state: 'NJ' },
    notes: 'Founded 2014 - NJ/CT/MD/WV/WI nursing homes and rehab centers'
  },
  'TL Management': {
    type: 'operator',
    addresses: ['2071 Flatbush Ave', '2071 Flatbush Ave # 22'],
    hq: { address: '2071 Flatbush Ave', city: 'Brooklyn', state: 'NY' },
    notes: 'Brooklyn SNF operator - distinct from CareRite'
  }
};

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('Available companies:\n');
    Object.entries(COMPANY_CONFIGS).forEach(([name, config]) => {
      console.log(`  ${name} (${config.type}) - ${config.addresses.length} address patterns`);
    });
    return;
  }

  let companies = [];

  if (args.includes('--all')) {
    companies = Object.keys(COMPANY_CONFIGS);
  } else if (args.length > 0) {
    const companyName = args.join(' ');
    if (!COMPANY_CONFIGS[companyName]) {
      console.error(`Company not found: ${companyName}`);
      console.error('Use --list to see available companies');
      process.exit(1);
    }
    companies = [companyName];
  } else {
    console.log('Usage:');
    console.log('  node scripts/load-propco-batch.js "Company Name"');
    console.log('  node scripts/load-propco-batch.js --all');
    console.log('  node scripts/load-propco-batch.js --list');
    return;
  }

  let reapiConn, atlasConn;

  try {
    console.log('=== REAPI Propco Layer Batch Integration ===\n');

    // Connect to databases
    console.log('Connecting to databases...');
    reapiConn = await getReapiConnection();
    atlasConn = await getAtlasConnection();
    console.log('✓ Connected to both databases\n');

    const results = [];

    for (const companyName of companies) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Processing: ${companyName}`);
      console.log('='.repeat(60));

      const config = COMPANY_CONFIGS[companyName];
      const result = await processCompany(reapiConn, atlasConn, companyName, config);
      results.push({ company: companyName, ...result });
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('BATCH SUMMARY');
    console.log('='.repeat(60));

    let totalProperties = 0;
    let totalEntities = 0;
    let totalLinked = 0;

    results.forEach(r => {
      console.log(`\n${r.company}:`);
      console.log(`  Properties found: ${r.propertiesFound}`);
      console.log(`  Entities created: ${r.entitiesCreated}`);
      console.log(`  Properties linked: ${r.propertiesLinked}`);
      totalProperties += r.propertiesFound;
      totalEntities += r.entitiesCreated;
      totalLinked += r.propertiesLinked;
    });

    console.log(`\nTOTALS:`);
    console.log(`  Properties found: ${totalProperties}`);
    console.log(`  Entities created: ${totalEntities}`);
    console.log(`  Properties linked: ${totalLinked}`);

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    if (reapiConn) await reapiConn.end();
    if (atlasConn) await atlasConn.end();
  }
}

async function processCompany(reapiConn, atlasConn, companyName, config) {
  const result = {
    propertiesFound: 0,
    entitiesCreated: 0,
    propertiesLinked: 0
  };

  // Phase 1: Create/get propco company
  const companyId = await getOrCreateCompany(atlasConn, companyName, config);

  // Phase 2: Get REAPI owner data
  const reapiOwners = await getOwnerData(reapiConn, config.addresses);
  result.propertiesFound = reapiOwners.length;
  console.log(`✓ Found ${reapiOwners.length} properties in REAPI`);

  if (reapiOwners.length === 0) {
    console.log('  No properties found - skipping');
    return result;
  }

  // Phase 3: Create propco entities
  const { entityMap, created } = await createEntities(atlasConn, companyId, reapiOwners);
  result.entitiesCreated = created;
  console.log(`✓ Created ${created} new propco entities`);

  // Phase 4: Link properties
  const linked = await linkProperties(atlasConn, reapiOwners, entityMap);
  result.propertiesLinked = linked;
  console.log(`✓ Linked ${linked} properties`);

  return result;
}

async function getOrCreateCompany(conn, companyName, config) {
  const [existing] = await conn.execute(
    `SELECT id FROM companies WHERE company_name = ? AND company_type IN ('propco', 'reit', 'operator')`,
    [companyName]
  );

  if (existing.length > 0) {
    console.log(`✓ Company exists (id: ${existing[0].id})`);
    return existing[0].id;
  }

  const companyType = config.type === 'reit' ? 'reit' : 'propco';
  const [result] = await conn.execute(`
    INSERT INTO companies (company_name, company_type, address, city, state, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [companyName, companyType, config.hq.address, config.hq.city, config.hq.state, config.notes]);

  console.log(`✓ Created company (id: ${result.insertId})`);
  return result.insertId;
}

async function getOwnerData(conn, addresses) {
  const addressConditions = addresses.map(addr => `mail_address LIKE '%${addr}%'`).join(' OR ');

  // Include Company type OR names that look like companies (LLC, Inc, LP, Trust, etc.)
  const query = `
    SELECT
      roi.property_id,
      roi.owner1_full_name,
      roi.owner1_type,
      roi.company_name,
      roi.mail_address,
      roi.mail_city,
      roi.mail_state,
      roi.mail_zip,
      rp.ccn
    FROM reapi_owner_info roi
    JOIN reapi_properties rp ON rp.property_id = roi.property_id
    WHERE (${addressConditions})
      AND (
        roi.owner1_type = 'Company'
        OR roi.owner1_full_name LIKE '%Llc%'
        OR roi.owner1_full_name LIKE '%LLC%'
        OR roi.owner1_full_name LIKE '%Inc%'
        OR roi.owner1_full_name LIKE '% Lp%'
        OR roi.owner1_full_name LIKE '% LP%'
        OR roi.owner1_full_name LIKE '%Trust%'
        OR roi.owner1_full_name LIKE '%Corp%'
        OR roi.owner1_full_name LIKE '%Property%'
        OR roi.owner1_full_name LIKE '%Realty%'
        OR roi.owner1_full_name LIKE '%Holdings%'
        OR roi.owner1_full_name LIKE '%Asset%'
      )
    ORDER BY roi.owner1_full_name
  `;

  const [rows] = await conn.execute(query);
  return rows;
}

async function createEntities(conn, companyId, reapiOwners) {
  const uniqueEntities = new Map();
  for (const row of reapiOwners) {
    if (!uniqueEntities.has(row.owner1_full_name)) {
      uniqueEntities.set(row.owner1_full_name, {
        entity_name: row.owner1_full_name,
        mail_address: row.mail_address,
        mail_city: row.mail_city,
        mail_state: row.mail_state,
        mail_zip: row.mail_zip
      });
    }
  }

  const entityMap = new Map();
  let created = 0;

  for (const [ownerName, data] of uniqueEntities) {
    const [existing] = await conn.execute(
      `SELECT id FROM entities WHERE entity_name = ? AND entity_type = 'propco'`,
      [ownerName]
    );

    if (existing.length > 0) {
      entityMap.set(ownerName, existing[0].id);
      continue;
    }

    const [result] = await conn.execute(`
      INSERT INTO entities (entity_name, entity_type, company_id, address, city, state, zip)
      VALUES (?, 'propco', ?, ?, ?, ?, ?)
    `, [ownerName, companyId, data.mail_address, data.mail_city, data.mail_state, data.mail_zip]);

    entityMap.set(ownerName, result.insertId);
    created++;
  }

  return { entityMap, created };
}

async function linkProperties(atlasConn, reapiOwners, entityMap) {
  let linked = 0;

  for (const row of reapiOwners) {
    if (!row.ccn) continue;

    const [properties] = await atlasConn.execute(
      `SELECT id FROM property_master WHERE ccn = ?`,
      [row.ccn]
    );

    if (properties.length === 0) continue;

    const propertyId = properties[0].id;
    const entityId = entityMap.get(row.owner1_full_name);

    if (!entityId) continue;

    const [existing] = await atlasConn.execute(`
      SELECT id FROM property_entity_relationships
      WHERE property_master_id = ? AND entity_id = ? AND relationship_type = 'property_owner'
    `, [propertyId, entityId]);

    if (existing.length > 0) continue;

    await atlasConn.execute(`
      INSERT INTO property_entity_relationships
      (property_master_id, entity_id, relationship_type, data_source, verified)
      VALUES (?, ?, 'property_owner', 'reapi', FALSE)
    `, [propertyId, entityId]);

    linked++;
  }

  return linked;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
