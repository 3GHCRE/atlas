/**
 * Rollback incorrectly added owner relationships for hospital/UPL arrangements
 *
 * In UPL structures:
 * - Private landlord (PropCo) owns the real estate
 * - Hospital holds the license and operates (OpCo)
 *
 * We incorrectly added property_owner relationships for hospitals
 * that are actually just operators (license holders).
 *
 * Usage:
 *   node scripts/rollback-hospital-owner-relationships.js          # Dry run
 *   node scripts/rollback-hospital-owner-relationships.js --apply  # Actually delete
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = !process.argv.includes('--apply');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: 'atlas'
  });

  console.log('='.repeat(60));
  console.log('ROLLBACK HOSPITAL/UPL OWNER RELATIONSHIPS');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'APPLY (will delete from database)'}`);
  console.log('');

  // Find all property_owner relationships that:
  // 1. Were just added (data_source = 'zoho' and notes contain 'CRM junction')
  // 2. Belong to hospital/district/health system companies
  const [toRollback] = await conn.query(`
    SELECT
      per.id,
      pm.facility_name,
      pm.ccn,
      e.entity_name,
      c.id as company_id,
      c.company_name,
      c.company_type
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    JOIN property_master pm ON pm.id = per.property_master_id
    WHERE per.relationship_type = 'property_owner'
      AND per.data_source = 'zoho'
      AND per.notes LIKE '%CRM junction%'
      AND (
        c.company_name LIKE '%HOSPITAL%'
        OR c.company_name LIKE '%MEDICAL CENTER%'
        OR c.company_name LIKE '%HEALTH SYSTEM%'
        OR c.company_name LIKE '%HOSPITAL DISTRICT%'
        OR c.company_name LIKE '%HOSPITAL AUTHORITY%'
        OR c.company_name LIKE '%HEALTHCARE DISTRICT%'
        OR c.company_name LIKE '%COUNTY HOSPITAL%'
        OR c.company_name LIKE '%MEMORIAL HOSPITAL%'
        OR c.company_name LIKE '%REGIONAL HOSPITAL%'
      )
    ORDER BY c.company_name, pm.facility_name
  `);

  console.log(`Found ${toRollback.length} hospital/UPL owner relationships to rollback`);
  console.log('');

  if (toRollback.length === 0) {
    console.log('Nothing to rollback!');
    await conn.end();
    return;
  }

  // Group by company
  const byCompany = {};
  for (const row of toRollback) {
    if (!byCompany[row.company_name]) {
      byCompany[row.company_name] = [];
    }
    byCompany[row.company_name].push(row);
  }

  console.log('=== RELATIONSHIPS TO REMOVE ===\n');

  for (const [companyName, props] of Object.entries(byCompany).slice(0, 20)) {
    console.log(`${companyName} (${props.length} properties)`);
    for (const p of props.slice(0, 3)) {
      console.log(`  - ${p.facility_name} (${p.ccn})`);
    }
    if (props.length > 3) {
      console.log(`  ... and ${props.length - 3} more`);
    }
    console.log('');
  }

  if (Object.keys(byCompany).length > 20) {
    console.log(`... and ${Object.keys(byCompany).length - 20} more companies\n`);
  }

  console.log(`TOTAL: ${toRollback.length} property_owner relationships to remove`);
  console.log('');

  if (DRY_RUN) {
    console.log('='.repeat(60));
    console.log('DRY RUN - No changes made');
    console.log('Run with --apply to delete these relationships');
    console.log('='.repeat(60));
    await conn.end();
    return;
  }

  // Actually delete the relationships
  console.log('=== DELETING RELATIONSHIPS ===\n');

  const ids = toRollback.map(r => r.id);
  const [result] = await conn.query(
    'DELETE FROM property_entity_relationships WHERE id IN (?)',
    [ids]
  );

  console.log(`Deleted ${result.affectedRows} property_owner relationships`);
  console.log('');

  // Summary by company
  console.log('=== SUMMARY BY COMPANY ===\n');
  for (const [companyName, props] of Object.entries(byCompany).sort((a, b) => b[1].length - a[1].length).slice(0, 15)) {
    console.log(`  ${companyName}: ${props.length} removed`);
  }

  console.log('');
  console.log('Done!');

  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
