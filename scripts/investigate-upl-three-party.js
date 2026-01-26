/**
 * Investigate UPL three-party structure:
 * 1. PropCo (private landlord - owns real estate)
 * 2. Hospital System (holds license for UPL)
 * 3. Third-party Operator (actually runs the facility)
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

  console.log('=== INVESTIGATING UPL THREE-PARTY STRUCTURES ===\n');

  // Find properties where a hospital "operates" and see if there are other parties
  const [hospitalOps] = await conn.query(`
    SELECT
      pm.id as property_id,
      pm.facility_name,
      pm.ccn,
      pm.state,
      c.company_name as hospital_name,
      c.company_type as hospital_type
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    JOIN property_master pm ON pm.id = per.property_master_id
    WHERE per.relationship_type = 'facility_operator'
      AND per.end_date IS NULL
      AND (
        c.company_name LIKE '%HOSPITAL DISTRICT%'
        OR c.company_name LIKE '%HOSPITAL AUTHORITY%'
        OR c.company_name LIKE '%COUNTY HOSPITAL%'
        OR c.company_name LIKE '%MEMORIAL HOSPITAL%'
      )
    LIMIT 50
  `);

  console.log(`Found ${hospitalOps.length} properties with hospital system as operator\n`);

  // For each, check for other relationships
  for (const prop of hospitalOps.slice(0, 15)) {
    console.log(`\n${prop.facility_name} (${prop.ccn}) - ${prop.state}`);
    console.log(`  Hospital: ${prop.hospital_name}`);

    // Get ALL relationships for this property
    const [allRels] = await conn.query(`
      SELECT
        per.relationship_type,
        e.entity_name,
        e.entity_type,
        c.company_name,
        c.company_type,
        per.data_source
      FROM property_entity_relationships per
      JOIN entities e ON e.id = per.entity_id
      JOIN companies c ON c.id = e.company_id
      WHERE per.property_master_id = ?
        AND per.end_date IS NULL
      ORDER BY per.relationship_type
    `, [prop.property_id]);

    const owners = allRels.filter(r => r.relationship_type === 'property_owner');
    const operators = allRels.filter(r => r.relationship_type === 'facility_operator');
    const mgmt = allRels.filter(r => r.relationship_type === 'management_services');
    const other = allRels.filter(r => !['property_owner', 'facility_operator', 'management_services'].includes(r.relationship_type));

    if (owners.length > 0) {
      console.log('  OWNERS:');
      owners.forEach(r => console.log(`    - ${r.company_name} (${r.company_type}) via ${r.entity_name}`));
    }

    if (operators.length > 0) {
      console.log('  OPERATORS:');
      operators.forEach(r => console.log(`    - ${r.company_name} (${r.company_type}) via ${r.entity_name}`));
    }

    if (mgmt.length > 0) {
      console.log('  MANAGEMENT:');
      mgmt.forEach(r => console.log(`    - ${r.company_name} (${r.company_type}) via ${r.entity_name}`));
    }

    if (other.length > 0) {
      console.log('  OTHER:');
      other.forEach(r => console.log(`    - ${r.relationship_type}: ${r.company_name} (${r.company_type})`));
    }
  }

  // Look for Texas pattern specifically (high UPL activity)
  console.log('\n\n=== TEXAS HOSPITAL DISTRICT PATTERN ===\n');

  const [texasHospitals] = await conn.query(`
    SELECT
      c.company_name,
      COUNT(DISTINCT per.property_master_id) as property_count,
      GROUP_CONCAT(DISTINCT pm.state) as states
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    JOIN property_master pm ON pm.id = per.property_master_id
    WHERE per.relationship_type = 'facility_operator'
      AND per.end_date IS NULL
      AND c.company_name LIKE '%HOSPITAL DISTRICT%'
    GROUP BY c.company_name
    ORDER BY property_count DESC
    LIMIT 20
  `);

  console.log('Hospital districts by property count:');
  for (const h of texasHospitals) {
    console.log(`  ${h.company_name}: ${h.property_count} properties (${h.states})`);
  }

  // Check if these properties have separate management companies
  console.log('\n\n=== CHECKING FOR THIRD-PARTY OPERATORS/MANAGERS ===\n');

  const [thirdParty] = await conn.query(`
    SELECT
      pm.facility_name,
      hospital.company_name as hospital,
      operator.company_name as third_party_operator,
      operator.company_type as third_party_type
    FROM property_entity_relationships per_hospital
    JOIN entities e_hospital ON e_hospital.id = per_hospital.entity_id
    JOIN companies hospital ON hospital.id = e_hospital.company_id
    JOIN property_master pm ON pm.id = per_hospital.property_master_id
    JOIN property_entity_relationships per_operator ON per_operator.property_master_id = pm.id
      AND per_operator.relationship_type IN ('facility_operator', 'management_services')
      AND per_operator.end_date IS NULL
    JOIN entities e_operator ON e_operator.id = per_operator.entity_id
    JOIN companies operator ON operator.id = e_operator.company_id
    WHERE per_hospital.relationship_type = 'facility_operator'
      AND per_hospital.end_date IS NULL
      AND hospital.company_name LIKE '%HOSPITAL DISTRICT%'
      AND operator.id != hospital.id
    LIMIT 30
  `);

  if (thirdParty.length > 0) {
    console.log('Found properties with BOTH hospital and third-party operator:');
    for (const t of thirdParty) {
      console.log(`  ${t.facility_name}`);
      console.log(`    Hospital: ${t.hospital}`);
      console.log(`    Third-party: ${t.third_party_operator} (${t.third_party_type})`);
    }
  } else {
    console.log('No third-party operators found in current data.');
    console.log('This suggests the management relationships may not be captured in Atlas yet.');
  }

  // Check CMS principals for these hospital-operated properties
  console.log('\n\n=== CMS PRINCIPALS FOR HOSPITAL-OPERATED PROPERTIES ===\n');

  const [cmsPrincipals] = await conn.query(`
    SELECT
      pm.facility_name,
      pm.ccn,
      hospital.company_name as hospital,
      p.full_name as cms_principal,
      p.role,
      pc.company_name as principal_company,
      pc.company_type as principal_company_type
    FROM property_entity_relationships per_hospital
    JOIN entities e_hospital ON e_hospital.id = per_hospital.entity_id
    JOIN companies hospital ON hospital.id = e_hospital.company_id
    JOIN property_master pm ON pm.id = per_hospital.property_master_id
    LEFT JOIN principal_entity_relationships prin_rel ON prin_rel.property_id = pm.id AND prin_rel.end_date IS NULL
    LEFT JOIN principals p ON p.id = prin_rel.principal_id
    LEFT JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
    LEFT JOIN companies pc ON pc.id = pcr.company_id
    WHERE per_hospital.relationship_type = 'facility_operator'
      AND per_hospital.end_date IS NULL
      AND hospital.company_name LIKE '%HOSPITAL DISTRICT%'
      AND p.role IN ('administrator', 'operator', 'managing_employee')
    LIMIT 50
  `);

  if (cmsPrincipals.length > 0) {
    console.log('CMS operating principals for hospital district properties:');
    let currentFacility = '';
    for (const cp of cmsPrincipals) {
      if (cp.facility_name !== currentFacility) {
        currentFacility = cp.facility_name;
        console.log(`\n  ${cp.facility_name} (${cp.ccn})`);
        console.log(`    License holder: ${cp.hospital}`);
      }
      const companyInfo = cp.principal_company ? ` -> ${cp.principal_company} (${cp.principal_company_type})` : '';
      console.log(`    ${cp.role}: ${cp.cms_principal}${companyInfo}`);
    }
  } else {
    console.log('No CMS principals found via principal_entity_relationships.');
    console.log('Checking principals table directly...');

    // Check if principals have property associations differently
    const [directPrincipals] = await conn.query(`
      SELECT DISTINCT
        pm.facility_name,
        pm.ccn,
        p.full_name,
        p.role,
        p.crm_related_group
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      JOIN companies c ON c.id = e.company_id
      JOIN principals p ON p.crm_related_group LIKE CONCAT('%', SUBSTRING(c.company_name, 1, 20), '%')
      WHERE per.relationship_type = 'facility_operator'
        AND per.end_date IS NULL
        AND c.company_name LIKE '%HOSPITAL DISTRICT%'
      LIMIT 30
    `);

    if (directPrincipals.length > 0) {
      console.log('\nFound principals linked via CRM related_group:');
      for (const dp of directPrincipals) {
        console.log(`  ${dp.facility_name}: ${dp.full_name} (${dp.role}) - ${dp.crm_related_group}`);
      }
    }
  }

  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
