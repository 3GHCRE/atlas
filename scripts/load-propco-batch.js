/**
 * REAPI Propco Layer - Batch Integration Script
 *
 * Loads propco data for multiple companies from owner_mappings.csv
 * Usage: node scripts/load-propco-batch.js [company_name]
 *        node scripts/load-propco-batch.js --all    (process all mapped companies)
 *        node scripts/load-propco-batch.js --list   (list available companies)
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Database configs
const REAPI_DB = {
  host: 'YOUR_DB_HOST_HERE',
  port: 25060,
  user: 'YOUR_DB_USER_HERE',
  password: 'YOUR_DB_PASSWORD_HERE',
  database: 'cms_data',
  ssl: { rejectUnauthorized: false }
};

const ATLAS_DB = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'devpass',
  database: 'atlas'
};

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
    reapiConn = await mysql.createConnection(REAPI_DB);
    atlasConn = await mysql.createConnection(ATLAS_DB);
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
      AND roi.owner1_type = 'Company'
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
