/**
 * REAPI Propco Layer Integration Script
 *
 * This script loads propco (property ownership) data from REAPI into the atlas database.
 * Test case: Ensign Group only (~168 properties)
 *
 * Architecture:
 *   CMS (Opco):    property > entity (opco) > company (operating portfolio) > principal
 *   REAPI (Propco): property > entity (propco) > company (ownership portfolio) > principal
 */

const fs = require('fs');
const path = require('path');
const { getAtlasConnection, getReapiConnection } = require('./lib/db-config');

// Ensign Group mailing addresses from owner_mappings.csv
const ENSIGN_ADDRESSES = [
  'Po Box 128109',           // Nashville, TN - 80 properties
  '29222 Rancho Viejo Rd',   // San Juan Capistrano, CA - 60 properties
  '27101 Puerta Real'        // Mission Viejo, CA - 28 properties (includes Ste 450)
];

async function main() {
  let reapiConn, atlasConn;

  try {
    console.log('=== REAPI Propco Layer Integration ===\n');

    // Connect to databases
    console.log('Connecting to REAPI database (cms_data)...');
    reapiConn = await getReapiConnection();
    console.log('✓ Connected to REAPI database\n');

    console.log('Connecting to Atlas database...');
    atlasConn = await getAtlasConnection();
    console.log('✓ Connected to Atlas database\n');

    // Phase 1: Create Ensign Group propco company
    console.log('--- Phase 1: Create Propco Company ---');
    await createPropcoCompany(atlasConn);

    // Phase 2: Get REAPI owner data for Ensign addresses
    console.log('\n--- Phase 2: Query REAPI Owner Data ---');
    const reapiOwners = await getEnsignOwnerData(reapiConn);

    // Phase 3: Create propco entities
    console.log('\n--- Phase 3: Create Propco Entities ---');
    const entityMap = await createPropcoEntities(atlasConn, reapiOwners);

    // Phase 4: Link properties to propco entities
    console.log('\n--- Phase 4: Link Properties to Propco Entities ---');
    await linkPropertiesToPropcos(atlasConn, reapiConn, reapiOwners, entityMap);

    // Phase 5: Validation
    console.log('\n--- Phase 5: Validation ---');
    await validatePropcoLayer(atlasConn);

    console.log('\n=== Propco Layer Integration Complete ===');

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    if (reapiConn) await reapiConn.end();
    if (atlasConn) await atlasConn.end();
  }
}

async function createPropcoCompany(conn) {
  // Check if Ensign Group propco company already exists
  const [existing] = await conn.execute(
    `SELECT id FROM companies WHERE company_name = 'Ensign Group' AND company_type IN ('propco', 'reit')`
  );

  if (existing.length > 0) {
    console.log(`✓ Ensign Group propco company already exists (id: ${existing[0].id})`);
    return existing[0].id;
  }

  // Insert Ensign Group as propco company
  const [result] = await conn.execute(`
    INSERT INTO companies (company_name, company_type, address, city, state, notes)
    VALUES ('Ensign Group', 'propco', '27101 Puerta Real', 'Mission Viejo', 'CA',
            'Propco layer - Health Holdings LLC entities from REAPI owner data')
  `);

  console.log(`✓ Created Ensign Group propco company (id: ${result.insertId})`);
  return result.insertId;
}

async function getEnsignOwnerData(conn) {
  // Build WHERE clause for Ensign addresses
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `mail_address LIKE '%${addr}%'`).join(' OR ');

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
      roi.corporate_owned,
      rp.ccn,
      rnh.provider_name
    FROM reapi_owner_info roi
    JOIN reapi_properties rp ON rp.property_id = roi.property_id
    LEFT JOIN reapi_nursing_homes rnh ON rnh.ccn = rp.ccn
    WHERE (${addressConditions})
      AND roi.owner1_type = 'Company'
    ORDER BY roi.owner1_full_name
  `;

  const [rows] = await conn.execute(query);
  console.log(`✓ Found ${rows.length} Ensign-owned properties in REAPI`);

  // Count unique propco entities
  const uniqueEntities = new Set(rows.map(r => r.owner1_full_name));
  console.log(`✓ Found ${uniqueEntities.size} unique propco entities`);

  // Sample output
  console.log('\nSample propco entities:');
  [...uniqueEntities].slice(0, 5).forEach(e => console.log(`  - ${e}`));
  if (uniqueEntities.size > 5) console.log(`  ... and ${uniqueEntities.size - 5} more`);

  return rows;
}

async function createPropcoEntities(conn, reapiOwners) {
  // Get Ensign propco company id
  const [companies] = await conn.execute(
    `SELECT id FROM companies WHERE company_name = 'Ensign Group' AND company_type IN ('propco', 'reit')`
  );

  if (companies.length === 0) {
    throw new Error('Ensign Group propco company not found');
  }

  const companyId = companies[0].id;

  // Get unique owner entities
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

  console.log(`Creating ${uniqueEntities.size} propco entities...`);

  const entityMap = new Map(); // owner_name -> entity_id
  let created = 0;
  let skipped = 0;

  for (const [ownerName, data] of uniqueEntities) {
    // Check if entity already exists
    const [existing] = await conn.execute(
      `SELECT id FROM entities WHERE entity_name = ? AND entity_type = 'propco'`,
      [ownerName]
    );

    if (existing.length > 0) {
      entityMap.set(ownerName, existing[0].id);
      skipped++;
      continue;
    }

    // Insert new propco entity
    const [result] = await conn.execute(`
      INSERT INTO entities (entity_name, entity_type, company_id, address, city, state, zip)
      VALUES (?, 'propco', ?, ?, ?, ?, ?)
    `, [ownerName, companyId, data.mail_address, data.mail_city, data.mail_state, data.mail_zip]);

    entityMap.set(ownerName, result.insertId);
    created++;
  }

  console.log(`✓ Created ${created} new propco entities`);
  if (skipped > 0) console.log(`  (${skipped} already existed)`);

  return entityMap;
}

async function linkPropertiesToPropcos(atlasConn, reapiConn, reapiOwners, entityMap) {
  let linked = 0;
  let notFound = 0;
  let alreadyLinked = 0;

  for (const row of reapiOwners) {
    if (!row.ccn) {
      notFound++;
      continue;
    }

    // Find property_master by CCN
    const [properties] = await atlasConn.execute(
      `SELECT id FROM property_master WHERE ccn = ?`,
      [row.ccn]
    );

    if (properties.length === 0) {
      notFound++;
      continue;
    }

    const propertyId = properties[0].id;
    const entityId = entityMap.get(row.owner1_full_name);

    if (!entityId) {
      console.warn(`  Warning: No entity found for ${row.owner1_full_name}`);
      continue;
    }

    // Check if relationship already exists
    const [existing] = await atlasConn.execute(`
      SELECT id FROM property_entity_relationships
      WHERE property_master_id = ? AND entity_id = ? AND relationship_type = 'property_owner'
    `, [propertyId, entityId]);

    if (existing.length > 0) {
      alreadyLinked++;
      continue;
    }

    // Create property-owner relationship
    await atlasConn.execute(`
      INSERT INTO property_entity_relationships
      (property_master_id, entity_id, relationship_type, data_source, verified)
      VALUES (?, ?, 'property_owner', 'reapi', FALSE)
    `, [propertyId, entityId]);

    linked++;
  }

  console.log(`✓ Linked ${linked} properties to propco entities`);
  if (alreadyLinked > 0) console.log(`  (${alreadyLinked} already linked)`);
  if (notFound > 0) console.log(`  (${notFound} CCNs not found in property_master)`);
}

async function validatePropcoLayer(conn) {
  // Count propco entities for Ensign
  const [entityCount] = await conn.execute(`
    SELECT COUNT(*) as cnt FROM entities e
    JOIN companies c ON c.id = e.company_id
    WHERE e.entity_type = 'propco' AND c.company_name = 'Ensign Group'
  `);
  console.log(`✓ Ensign propco entities: ${entityCount[0].cnt}`);

  // Count property-owner relationships
  const [relCount] = await conn.execute(`
    SELECT COUNT(DISTINCT per.property_master_id) as cnt
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.relationship_type = 'property_owner'
      AND c.company_name = 'Ensign Group'
  `);
  console.log(`✓ Properties with Ensign propco ownership: ${relCount[0].cnt}`);

  // Sample cross-reference query
  console.log('\nSample opco vs propco comparison:');
  const [samples] = await conn.execute(`
    SELECT
      pm.facility_name,
      pm.state,
      opco_c.company_name AS operator,
      propco_c.company_name AS owner
    FROM property_master pm
    LEFT JOIN property_entity_relationships opco_per
      ON opco_per.property_master_id = pm.id AND opco_per.relationship_type = 'facility_operator'
    LEFT JOIN entities opco_e ON opco_e.id = opco_per.entity_id
    LEFT JOIN companies opco_c ON opco_c.id = opco_e.company_id
    LEFT JOIN property_entity_relationships propco_per
      ON propco_per.property_master_id = pm.id AND propco_per.relationship_type = 'property_owner'
    LEFT JOIN entities propco_e ON propco_e.id = propco_per.entity_id
    LEFT JOIN companies propco_c ON propco_c.id = propco_e.company_id
    WHERE propco_c.company_name = 'Ensign Group'
    LIMIT 5
  `);

  samples.forEach(s => {
    console.log(`  ${s.facility_name} (${s.state})`);
    console.log(`    Operator: ${s.operator || 'Unknown'}`);
    console.log(`    Owner: ${s.owner || 'Unknown'}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
