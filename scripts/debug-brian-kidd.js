/**
 * Debug script to explain Brian Kidd conflict
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: 'atlas'
  });

  // Find Brian Kidd
  const [[brian]] = await conn.query(
    "SELECT id, full_name, zoho_contact_id FROM principals WHERE full_name LIKE '%Brian Kidd%' LIMIT 1"
  );
  console.log('=== BRIAN KIDD IN ATLAS ===');
  console.log('Principal ID:', brian.id);
  console.log('Name:', brian.full_name);
  console.log('Zoho ID:', brian.zoho_contact_id);
  console.log('');

  // Get his company relationships
  const [companyRels] = await conn.query(`
    SELECT c.id, c.company_name, c.company_type, pcr.role
    FROM principal_company_relationships pcr
    JOIN companies c ON c.id = pcr.company_id
    WHERE pcr.principal_id = ? AND pcr.end_date IS NULL
  `, [brian.id]);

  console.log('=== HIS COMPANIES (Atlas) ===');
  companyRels.forEach(r => {
    console.log(`  ${r.company_name} (${r.company_type}) - Role: ${r.role || 'N/A'}`);
  });
  console.log('');

  // For each company, get the entities and their property relationships
  console.log('=== PROPERTY CHAIN (Principal -> Company -> Entity -> Property) ===');
  for (const company of companyRels) {
    const [entities] = await conn.query(`
      SELECT e.id, e.entity_name, e.entity_type
      FROM entities e
      WHERE e.company_id = ?
    `, [company.id]);

    for (const entity of entities) {
      const [props] = await conn.query(`
        SELECT pm.facility_name, per.relationship_type
        FROM property_entity_relationships per
        JOIN property_master pm ON pm.id = per.property_master_id
        WHERE per.entity_id = ? AND per.end_date IS NULL
        LIMIT 5
      `, [entity.id]);

      if (props.length > 0) {
        console.log(`\n  Company: ${company.company_name} (${company.company_type})`);
        console.log(`  Entity: ${entity.entity_name} (${entity.entity_type})`);
        console.log(`  Properties (showing up to 5):`);
        props.forEach(p => {
          console.log(`    - ${p.facility_name}`);
          console.log(`      Atlas relationship_type: ${p.relationship_type}`);
        });
      }
    }
  }

  // Now check what CRM says
  console.log('\n\n=== CRM JUNCTION RECORDS FOR BRIAN KIDD ===');
  const [crmRecs] = await conn.query(`
    SELECT principal_name, property_name, principal_type, validation_status, validation_notes
    FROM crm_principal_properties_staging
    WHERE zoho_principal_id = ?
    LIMIT 10
  `, [brian.zoho_contact_id]);

  crmRecs.forEach(r => {
    console.log(`  ${r.property_name}`);
    console.log(`    CRM principal_type: ${r.principal_type || '(none)'}`);
    console.log(`    Validation status: ${r.validation_status}`);
    if (r.validation_notes) console.log(`    Notes: ${r.validation_notes}`);
    console.log('');
  });

  console.log('\n=== EXPLANATION ===');
  console.log('The "conflict" occurs because:');
  console.log('');
  console.log('1. CRM marks Brian Kidd as "Owner" for these NHC properties');
  console.log('   (This is the principal_type field in CRM junction)');
  console.log('');
  console.log('2. Atlas tracks the ENTITY relationship to the property as "facility_operator"');
  console.log('   (This is property_entity_relationships.relationship_type)');
  console.log('');
  console.log('If NHC both OWNS the real estate AND operates the facilities,');
  console.log('the correct Atlas relationship_type should be "property_owner" (for ownership)');
  console.log('or both owner AND operator relationships should exist.');
  console.log('');
  console.log('This appears to be a DATA QUALITY ISSUE in Atlas:');
  console.log('  - NHC is an owner-operator but Atlas only has "facility_operator"');
  console.log('  - Should have property_owner relationship as well');
  console.log('');
  console.log('ACTION: These 376 conflicts may indicate missing owner relationships in Atlas.');

  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
