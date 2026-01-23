#!/usr/bin/env node
/**
 * Fix 2071 Flatbush mapping: CareRite -> TL Management
 */
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'devpass',
    database: 'atlas'
  });

  // Get or create TL Management company
  let [[tlManagement]] = await conn.execute(`
    SELECT id, company_name FROM companies WHERE company_name = 'TL Management'
  `);

  if (!tlManagement) {
    const [result] = await conn.execute(`
      INSERT INTO companies (company_name, company_type, address, city, state)
      VALUES ('TL Management', 'opco', '2071 Flatbush Ave', 'Brooklyn', 'NY')
    `);
    tlManagement = { id: result.insertId, company_name: 'TL Management' };
    console.log('Created TL Management company with ID:', tlManagement.id);
  } else {
    console.log('TL Management company already exists with ID:', tlManagement.id);
  }

  // Find entities with 2071 Flatbush address linked to CareRite
  const [entities] = await conn.execute(`
    SELECT e.id, e.entity_name, e.company_id, c.company_name
    FROM entities e
    JOIN companies c ON e.company_id = c.id
    WHERE e.address LIKE '%2071 Flatbush%'
    AND c.company_name = 'CareRite Centers'
  `);

  console.log('\nEntities to reassign from CareRite to TL Management:', entities.length);

  if (entities.length > 0) {
    // Update entities to point to TL Management
    const entityIds = entities.map(e => e.id);
    await conn.execute(`
      UPDATE entities
      SET company_id = ?
      WHERE id IN (${entityIds.join(',')})
    `, [tlManagement.id]);

    console.log(`✓ Reassigned ${entities.length} entities to TL Management`);

    // Verify the change
    const [[countResult]] = await conn.execute(`
      SELECT COUNT(*) as cnt
      FROM entities e
      JOIN companies c ON e.company_id = c.id
      WHERE e.address LIKE '%2071 Flatbush%'
      AND c.company_name = 'TL Management'
    `);
    console.log('Entities now linked to TL Management:', countResult.cnt);
  }

  // Show property count for TL Management
  const [[propCount]] = await conn.execute(`
    SELECT COUNT(DISTINCT per.property_master_id) as cnt
    FROM entities e
    JOIN property_entity_relationships per ON per.entity_id = e.id
    WHERE e.company_id = ?
    AND per.relationship_type = 'property_owner'
  `, [tlManagement.id]);

  console.log('\nTL Management now has', propCount.cnt, 'properties linked');

  await conn.end();
}

main().catch(console.error);
