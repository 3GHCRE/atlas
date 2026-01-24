/**
 * Complete Atlas data summary - all entities and relationships
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function summary() {
  const atlas = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              ATLAS DATABASE - COMPLETE SUMMARY               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Core counts
  const [[counts]] = await atlas.execute(`
    SELECT
      (SELECT COUNT(*) FROM property_master) as properties,
      (SELECT COUNT(*) FROM companies WHERE company_name NOT LIKE '[MERGED]%') as companies,
      (SELECT COUNT(*) FROM entities) as entities,
      (SELECT COUNT(*) FROM principals) as principals,
      (SELECT COUNT(*) FROM deals) as deals
  `);

  console.log('=== CORE ENTITIES ===\n');
  console.log(`  Properties:    ${counts.properties.toLocaleString()}`);
  console.log(`  Companies:     ${counts.companies.toLocaleString()}`);
  console.log(`  Entities:      ${counts.entities.toLocaleString()}`);
  console.log(`  Principals:    ${counts.principals.toLocaleString()}`);
  console.log(`  Deals:         ${counts.deals.toLocaleString()}`);

  // Relationship coverage
  console.log('\n=== RELATIONSHIP COVERAGE ===\n');

  const [relTypes] = await atlas.execute(`
    SELECT relationship_type,
           COUNT(*) as total_rels,
           COUNT(DISTINCT property_master_id) as properties
    FROM property_entity_relationships
    GROUP BY relationship_type
    ORDER BY total_rels DESC
  `);

  console.log('  Relationship Type       | Relationships | Properties | Coverage');
  console.log('  ----------------------- | ------------- | ---------- | --------');
  for (const rel of relTypes) {
    const coverage = (rel.properties / counts.properties * 100).toFixed(1);
    const relName = rel.relationship_type.padEnd(23);
    const relCount = rel.total_rels.toLocaleString().padStart(13);
    const propCount = rel.properties.toLocaleString().padStart(10);
    console.log(`  ${relName} | ${relCount} | ${propCount} | ${coverage}%`);
  }

  // Company types
  console.log('\n=== COMPANY TYPES ===\n');

  const [companyTypes] = await atlas.execute(`
    SELECT company_type, COUNT(*) as count
    FROM companies
    WHERE company_name NOT LIKE '[MERGED]%'
    GROUP BY company_type
    ORDER BY count DESC
  `);

  companyTypes.forEach(c => {
    const pct = (c.count / counts.companies * 100).toFixed(1);
    console.log(`  ${c.company_type}: ${c.count.toLocaleString()} (${pct}%)`);
  });

  // Entity types
  console.log('\n=== ENTITY TYPES ===\n');

  const [entityTypes] = await atlas.execute(`
    SELECT entity_type, COUNT(*) as count
    FROM entities
    GROUP BY entity_type
    ORDER BY count DESC
  `);

  entityTypes.forEach(e => {
    const pct = (e.count / counts.entities * 100).toFixed(1);
    console.log(`  ${e.entity_type}: ${e.count.toLocaleString()} (${pct}%)`);
  });

  // Deal types
  console.log('\n=== DEAL TYPES ===\n');

  const [dealTypes] = await atlas.execute(`
    SELECT deal_type, COUNT(*) as count,
           COUNT(DISTINCT property_master_id) as properties
    FROM deals
    GROUP BY deal_type
    ORDER BY count DESC
  `);

  dealTypes.forEach(d => {
    console.log(`  ${d.deal_type}: ${d.count.toLocaleString()} deals (${d.properties.toLocaleString()} properties)`);
  });

  // Top 10 by each relationship
  console.log('\n=== TOP 10 BY RELATIONSHIP TYPE ===\n');

  const relTypeNames = ['property_owner', 'facility_operator', 'lender', 'property_buyer', 'property_seller', 'property_borrower'];

  for (const relType of relTypeNames) {
    const [top] = await atlas.execute(`
      SELECT c.company_name, COUNT(DISTINCT per.property_master_id) as properties
      FROM companies c
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id
      WHERE per.relationship_type = ?
        AND c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id, c.company_name
      ORDER BY properties DESC
      LIMIT 10
    `, [relType]);

    if (top.length > 0) {
      console.log(`--- ${relType.toUpperCase()} ---`);
      top.forEach((t, i) => {
        console.log(`  ${i + 1}. ${t.company_name}: ${t.properties}`);
      });
      console.log('');
    }
  }

  // Navigation test - can we go from property to all related entities?
  console.log('=== NAVIGATION TEST ===\n');

  // Pick a random property with multiple relationships
  const [[testProp]] = await atlas.execute(`
    SELECT pm.id, pm.facility_name, pm.city, pm.state
    FROM property_master pm
    WHERE pm.id IN (
      SELECT property_master_id FROM property_entity_relationships
      GROUP BY property_master_id
      HAVING COUNT(DISTINCT relationship_type) >= 4
    )
    ORDER BY RAND()
    LIMIT 1
  `);

  if (testProp) {
    console.log(`Test Property: ${testProp.facility_name} (${testProp.city}, ${testProp.state})`);
    console.log(`Property ID: ${testProp.id}\n`);

    // Get all relationships
    const [rels] = await atlas.execute(`
      SELECT per.relationship_type, e.entity_name, e.entity_type, c.company_name, c.company_type
      FROM property_entity_relationships per
      JOIN entities e ON e.id = per.entity_id
      JOIN companies c ON c.id = e.company_id
      WHERE per.property_master_id = ?
        AND c.company_name NOT LIKE '[MERGED]%'
      ORDER BY per.relationship_type
    `, [testProp.id]);

    console.log('Related entities:');
    rels.forEach(r => {
      console.log(`  [${r.relationship_type}] ${r.entity_name}`);
      console.log(`    → Company: ${r.company_name} (${r.company_type})`);
    });

    // Get deals for this property
    const [deals] = await atlas.execute(`
      SELECT deal_type, COUNT(*) as count, SUM(amount) as total_amount
      FROM deals
      WHERE property_master_id = ?
      GROUP BY deal_type
    `, [testProp.id]);

    console.log('\nDeals:');
    deals.forEach(d => {
      const amt = d.total_amount ? `$${(d.total_amount / 1e6).toFixed(1)}M` : 'N/A';
      console.log(`  ${d.deal_type}: ${d.count} (${amt})`);
    });
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     SUMMARY COMPLETE                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await atlas.end();
}

summary().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
