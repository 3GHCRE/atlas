/**
 * Investigate hospital/UPL ownership patterns
 *
 * UPL (Upper Payment Limit) structures typically have:
 * - Private landlord (PropCo) owns the real estate
 * - Hospital holds the license and operates (OpCo)
 *
 * We may have incorrectly added property_owner relationships
 * for hospital operators who don't actually own the real estate.
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: 'atlas'
  });

  // Look at Adams County Memorial Hospital
  console.log('=== ADAMS COUNTY MEMORIAL HOSPITAL ===\n');

  const [[company]] = await conn.query(
    "SELECT id, company_name, company_type FROM companies WHERE company_name LIKE '%ADAMS COUNTY MEMORIAL%'"
  );
  console.log('Company:', company.company_name, '(', company.company_type, ')');
  console.log('Company ID:', company.id);
  console.log('');

  // Get entities
  const [entities] = await conn.query(
    'SELECT id, entity_name, entity_type FROM entities WHERE company_id = ?',
    [company.id]
  );
  console.log('Entities:');
  entities.forEach(e => console.log('  ', e.id, '-', e.entity_name, '(', e.entity_type, ')'));
  console.log('');

  // Get property relationships - show the pattern
  const [rels] = await conn.query(`
    SELECT
      pm.facility_name,
      pm.ccn,
      per.relationship_type,
      e.entity_name,
      per.data_source,
      per.notes,
      per.created_at
    FROM property_entity_relationships per
    JOIN property_master pm ON pm.id = per.property_master_id
    JOIN entities e ON e.id = per.entity_id
    WHERE e.company_id = ?
      AND per.end_date IS NULL
    ORDER BY pm.facility_name, per.relationship_type
  `, [company.id]);

  console.log('Property relationships:');
  let currentFacility = '';
  for (const r of rels) {
    if (r.facility_name !== currentFacility) {
      currentFacility = r.facility_name;
      console.log('\n  ' + r.facility_name + ' (' + r.ccn + ')');
    }
    const isNew = r.notes && r.notes.includes('CRM junction') ? ' ** JUST ADDED **' : '';
    console.log('    -', r.relationship_type, '(' + r.data_source + ')' + isNew);
  }

  // Check if there are OTHER owners for these properties
  console.log('\n\n=== CHECKING FOR SEPARATE PROPCO OWNERS ===\n');
  const [otherOwners] = await conn.query(`
    SELECT DISTINCT
      pm.facility_name,
      pm.ccn,
      per.relationship_type,
      e.entity_name,
      c.company_name as owner_company,
      c.company_type
    FROM property_entity_relationships per
    JOIN property_master pm ON pm.id = per.property_master_id
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE pm.id IN (
      SELECT per2.property_master_id
      FROM property_entity_relationships per2
      JOIN entities e2 ON e2.id = per2.entity_id
      WHERE e2.company_id = ? AND per2.end_date IS NULL
    )
    AND e.company_id != ?
    AND per.relationship_type = 'property_owner'
    AND per.end_date IS NULL
  `, [company.id, company.id]);

  if (otherOwners.length > 0) {
    console.log('Found separate PropCo owners for Adams County operated properties:');
    otherOwners.forEach(r => {
      console.log('  ', r.facility_name);
      console.log('    Owner:', r.owner_company, '(' + r.company_type + ')');
      console.log('    Via entity:', r.entity_name);
    });
  } else {
    console.log('No separate PropCo owners found for these properties');
  }

  // Find all hospital-related companies that we may have incorrectly updated
  console.log('\n\n=== IDENTIFYING POTENTIAL HOSPITAL/UPL PATTERNS ===\n');
  const [hospitalCompanies] = await conn.query(`
    SELECT
      c.id,
      c.company_name,
      c.company_type,
      COUNT(DISTINCT CASE WHEN per.relationship_type = 'property_owner' AND per.notes LIKE '%CRM junction%' THEN per.id END) as new_owner_rels,
      COUNT(DISTINCT CASE WHEN per.relationship_type = 'facility_operator' THEN per.property_master_id END) as operated_count
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
    WHERE (
      c.company_name LIKE '%HOSPITAL%'
      OR c.company_name LIKE '%MEDICAL CENTER%'
      OR c.company_name LIKE '%HEALTH SYSTEM%'
      OR c.company_name LIKE '%HEALTHCARE DISTRICT%'
      OR c.company_name LIKE '%HOSPITAL DISTRICT%'
    )
    GROUP BY c.id, c.company_name, c.company_type
    HAVING new_owner_rels > 0
    ORDER BY new_owner_rels DESC
    LIMIT 30
  `);

  console.log('Hospital/medical companies with newly added owner relationships:');
  console.log('(These may be UPL arrangements where hospital is OpCo, not PropCo)\n');

  let totalSuspect = 0;
  for (const h of hospitalCompanies) {
    console.log(`${h.company_name} (${h.company_type})`);
    console.log(`  Operates: ${h.operated_count} properties`);
    console.log(`  NEW owner relationships added: ${h.new_owner_rels}`);
    totalSuspect += h.new_owner_rels;
    console.log('');
  }

  console.log(`\nTotal suspect hospital owner relationships: ${totalSuspect}`);
  console.log('These should be reviewed - hospitals in UPL arrangements typically do NOT own the real estate.');

  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
