/**
 * Find principals for a specific property (CCN 396003 - MONROEVILLE POST ACUTE)
 * investigating the orphaned entity "885 MACBETH DRIVE OPERATIONS LLC"
 */
const mysql = require('mysql2/promise');

async function findPrincipals() {
  const conn = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || '192.168.65.254',
    port: 3306,
    user: 'root',
    password: 'devpass',
    database: 'atlas'
  });

  const CCN = '396003';

  console.log('='.repeat(80));
  console.log('PRINCIPALS FOR CCN ' + CCN + ' (MONROEVILLE POST ACUTE)');
  console.log('Investigating orphaned entity: 885 MACBETH DRIVE OPERATIONS LLC');
  console.log('='.repeat(80));

  // Get principals for PACS GROUP (ID 65 - the operator)
  console.log('\n--- PACS GROUP PRINCIPALS (Operator - Company ID 65) ---');
  const [pacsPrincipals] = await conn.query(`
    SELECT p.id, p.full_name, p.title, pcr.role, pcr.ownership_percentage
    FROM principals p
    JOIN principal_company_relationships pcr ON pcr.principal_id = p.id
    WHERE pcr.company_id = 65
    ORDER BY COALESCE(pcr.ownership_percentage, 0) DESC, p.full_name
    LIMIT 25
  `);

  console.log('Found ' + pacsPrincipals.length + ' principals');
  for (const p of pacsPrincipals) {
    const ownership = p.ownership_percentage ? p.ownership_percentage + '%' : 'N/A';
    console.log('  ' + (p.full_name || '').padEnd(35) + ' | ' + (p.role || '').padEnd(15) + ' | ' + ownership.padStart(6) + ' | ' + (p.title || ''));
  }

  // Get principals for WELLTOWER (ID 14599 - the REIT property owner)
  console.log('\n--- WELLTOWER PRINCIPALS (Property Owner - Company ID 14599 - REIT) ---');
  const [welltowerPrincipals] = await conn.query(`
    SELECT p.id, p.full_name, p.title, pcr.role, pcr.ownership_percentage
    FROM principals p
    JOIN principal_company_relationships pcr ON pcr.principal_id = p.id
    WHERE pcr.company_id = 14599
    ORDER BY COALESCE(pcr.ownership_percentage, 0) DESC, p.full_name
    LIMIT 25
  `);

  console.log('Found ' + welltowerPrincipals.length + ' principals');
  for (const p of welltowerPrincipals) {
    const ownership = p.ownership_percentage ? p.ownership_percentage + '%' : 'N/A';
    console.log('  ' + (p.full_name || '').padEnd(35) + ' | ' + (p.role || '').padEnd(15) + ' | ' + ownership.padStart(6) + ' | ' + (p.title || ''));
  }

  // Check principals linked via entity relationships for this specific property
  console.log('\n--- PRINCIPALS LINKED DIRECTLY TO CCN ' + CCN + ' VIA ENTITIES ---');
  const [entityPrincipals] = await conn.query(`
    SELECT DISTINCT p.id, p.full_name, p.title,
           pner.role as entity_role,
           e.id as entity_id, e.entity_name, e.entity_type,
           c.id as company_id, c.company_name, c.company_type,
           per.relationship_type as property_relationship
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    JOIN entities e ON e.id = per.entity_id
    JOIN principal_entity_relationships pner ON pner.entity_id = e.id
    JOIN principals p ON p.id = pner.principal_id
    LEFT JOIN companies c ON c.id = e.company_id
    WHERE pm.ccn = ?
    ORDER BY per.relationship_type, e.entity_name, p.full_name
  `, [CCN]);

  console.log('Found ' + entityPrincipals.length + ' principal-entity links for this property\n');

  let lastEntity = null;
  for (const p of entityPrincipals) {
    if (p.entity_id !== lastEntity) {
      console.log('\n  ENTITY: ' + p.entity_name);
      console.log('    Type: ' + p.entity_type + ' | Relationship: ' + p.property_relationship);
      console.log('    Company: ' + (p.company_name || 'NONE') + ' (' + (p.company_type || '') + ')');
      console.log('    Principals:');
      lastEntity = p.entity_id;
    }
    console.log('      - ' + (p.full_name || '').padEnd(30) + ' | ' + (p.entity_role || 'no role').padEnd(15) + ' | ' + (p.title || ''));
  }

  // Now check what happened to the orphaned entity - trace its history
  console.log('\n' + '='.repeat(80));
  console.log('ORPHANED ENTITY ANALYSIS: 885 MACBETH DRIVE OPERATIONS LLC');
  console.log('='.repeat(80));

  const [orphanedEntity] = await conn.query(`
    SELECT * FROM entities WHERE entity_name = '885 MACBETH DRIVE OPERATIONS LLC'
  `);

  if (orphanedEntity.length > 0) {
    const e = orphanedEntity[0];
    console.log('\nEntity Details:');
    console.log('  ID: ' + e.id);
    console.log('  Name: ' + e.entity_name);
    console.log('  Type: ' + e.entity_type);
    console.log('  Status: ' + e.entity_status);
    console.log('  Data Source: ' + e.data_source);
    console.log('  CMS Associate ID: ' + e.cms_associate_id);
    console.log('  Company ID: ' + e.company_id);

    // Check if there are any principal relationships for this orphaned entity
    const [orphanPrincipals] = await conn.query(`
      SELECT p.full_name, p.title, pner.role, pner.ownership_percentage
      FROM principal_entity_relationships pner
      JOIN principals p ON p.id = pner.principal_id
      WHERE pner.entity_id = ?
    `, [e.id]);

    console.log('\nPrincipals linked to orphaned entity: ' + orphanPrincipals.length);
    for (const p of orphanPrincipals) {
      console.log('  - ' + p.full_name + ' | ' + (p.role || '') + ' | ' + (p.ownership_percentage || '') + '%');
    }

    // Check if any other entities have the same CMS associate ID
    if (e.cms_associate_id) {
      const [sameAssocId] = await conn.query(`
        SELECT e.id, e.entity_name, e.entity_type, e.entity_status, e.company_id, c.company_name
        FROM entities e
        LEFT JOIN companies c ON c.id = e.company_id
        WHERE e.cms_associate_id = ? AND e.id != ?
      `, [e.cms_associate_id, e.id]);

      console.log('\nOther entities with same CMS Associate ID (' + e.cms_associate_id + '): ' + sameAssocId.length);
      for (const other of sameAssocId) {
        console.log('  - ID ' + other.id + ': ' + other.entity_name + ' (' + other.entity_type + ') - ' + other.entity_status);
        console.log('    Company: ' + (other.company_name || 'NONE'));
      }
    }

    // Check deals/CHOWs related to this property
    console.log('\n--- DEAL/CHOW HISTORY FOR CCN ' + CCN + ' ---');
    const [deals] = await conn.query(`
      SELECT d.id, d.deal_date, d.deal_type, d.sale_price,
             buyer.entity_name as buyer_name, bc.company_name as buyer_company,
             seller.entity_name as seller_name, sc.company_name as seller_company
      FROM deals d
      JOIN property_master pm ON pm.id = d.property_master_id
      LEFT JOIN entities buyer ON buyer.id = d.buyer_entity_id
      LEFT JOIN companies bc ON bc.id = buyer.company_id
      LEFT JOIN entities seller ON seller.id = d.seller_entity_id
      LEFT JOIN companies sc ON sc.id = seller.company_id
      WHERE pm.ccn = ?
      ORDER BY d.deal_date DESC
    `, [CCN]);

    console.log('Found ' + deals.length + ' deals');
    for (const d of deals) {
      const price = d.sale_price ? '$' + Number(d.sale_price).toLocaleString() : 'N/A';
      console.log('  ' + (d.deal_date ? d.deal_date.toISOString().split('T')[0] : 'Unknown') +
                  ' | ' + (d.deal_type || 'Unknown') + ' | ' + price);
      console.log('    Buyer: ' + (d.buyer_name || 'N/A') + ' (' + (d.buyer_company || '') + ')');
      console.log('    Seller: ' + (d.seller_name || 'N/A') + ' (' + (d.seller_company || '') + ')');
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('\nProperty: CCN ' + CCN + ' - MONROEVILLE POST ACUTE');
  console.log('Address: 885 MACBETH DR, MONROEVILLE, PA');
  console.log('\nCurrent Ownership Structure:');
  console.log('  Property Owner (REIT): WELLTOWER - ' + welltowerPrincipals.length + ' principals');
  console.log('  Facility Operator: PACS GROUP - ' + pacsPrincipals.length + ' principals');
  console.log('\nOrphaned Entity: 885 MACBETH DRIVE OPERATIONS LLC');
  console.log('  This appears to be a HISTORICAL entity from CHOW data');
  console.log('  It has company_id=NULL and is NOT linked to current operations');

  await conn.end();
}

findPrincipals().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
