/**
 * Generate list of missing owner relationships from CRM junction conflicts
 *
 * These are properties where:
 * - CRM says principal is "Owner"
 * - Atlas only has "facility_operator" relationship
 * - Should have property_owner relationship added
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
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

  // Get all conflicts with resolved IDs
  const [conflicts] = await conn.query(`
    SELECT
      cps.zoho_record_id,
      cps.principal_name,
      cps.property_name,
      cps.principal_type as crm_type,
      cps.resolved_principal_id,
      cps.resolved_property_id,
      cps.validation_notes,
      pm.ccn,
      pm.facility_name,
      p.full_name,
      c.id as company_id,
      c.company_name,
      c.company_type
    FROM crm_principal_properties_staging cps
    JOIN property_master pm ON pm.id = cps.resolved_property_id
    JOIN principals p ON p.id = cps.resolved_principal_id
    LEFT JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
    LEFT JOIN companies c ON c.id = pcr.company_id
    WHERE cps.validation_status = 'conflict'
    ORDER BY c.company_name, pm.facility_name
  `);

  console.log(`Found ${conflicts.length} conflict records`);
  console.log('');

  // Group by company
  const byCompany = {};
  for (const row of conflicts) {
    const key = row.company_name || 'Unknown';
    if (!byCompany[key]) {
      byCompany[key] = {
        company_id: row.company_id,
        company_type: row.company_type,
        properties: new Set(),
        propertyDetails: []
      };
    }
    const propKey = row.resolved_property_id + '-' + row.facility_name;
    if (!byCompany[key].properties.has(propKey)) {
      byCompany[key].properties.add(propKey);
      byCompany[key].propertyDetails.push({
        property_id: row.resolved_property_id,
        ccn: row.ccn,
        facility_name: row.facility_name,
        crm_type: row.crm_type,
        notes: row.validation_notes
      });
    }
  }

  // Output summary
  console.log('=== MISSING OWNER RELATIONSHIPS BY COMPANY ===');
  console.log('');

  let totalMissing = 0;
  const outputRows = [];

  const sortedCompanies = Object.entries(byCompany)
    .sort((a, b) => b[1].propertyDetails.length - a[1].propertyDetails.length);

  for (const [companyName, data] of sortedCompanies) {
    console.log(`${companyName} (${data.company_type}) - ${data.propertyDetails.length} properties missing owner relationship`);
    totalMissing += data.propertyDetails.length;

    for (const prop of data.propertyDetails) {
      // Extract current Atlas type from validation notes
      const atlasTypeMatch = prop.notes.match(/Atlas type '([^']+)'/);
      const currentAtlasType = atlasTypeMatch ? atlasTypeMatch[1] : '';

      outputRows.push({
        company_id: data.company_id,
        company_name: companyName,
        company_type: data.company_type,
        property_id: prop.property_id,
        ccn: prop.ccn,
        facility_name: prop.facility_name,
        crm_type: prop.crm_type,
        current_atlas_type: currentAtlasType
      });
    }
  }

  console.log('');
  console.log(`Total properties missing owner relationship: ${totalMissing}`);

  // Write CSV
  const headers = ['company_id', 'company_name', 'company_type', 'property_id', 'ccn', 'facility_name', 'crm_type', 'current_atlas_type'];
  const csv = [
    headers.join(','),
    ...outputRows.map(r => headers.map(h => {
      const val = (r[h] || '').toString();
      return val.includes(',') ? `"${val}"` : val;
    }).join(','))
  ].join('\n');

  const outputPath = path.resolve(__dirname, '../data/missing-owner-relationships.csv');
  fs.writeFileSync(outputPath, csv);
  console.log('');
  console.log(`CSV written to: ${outputPath}`);

  // Also check: which entities need the property_owner relationship added?
  console.log('');
  console.log('=== ENTITIES NEEDING PROPERTY_OWNER RELATIONSHIPS ===');
  console.log('');

  // For each property missing owner, find which entity operates it
  const [entitiesToFix] = await conn.query(`
    SELECT DISTINCT
      e.id as entity_id,
      e.entity_name,
      e.entity_type,
      c.company_name,
      COUNT(DISTINCT per.property_master_id) as properties_to_fix
    FROM crm_principal_properties_staging cps
    JOIN property_entity_relationships per ON per.property_master_id = cps.resolved_property_id
      AND per.relationship_type = 'facility_operator'
      AND per.end_date IS NULL
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE cps.validation_status = 'conflict'
    GROUP BY e.id, e.entity_name, e.entity_type, c.company_name
    ORDER BY properties_to_fix DESC
  `);

  for (const row of entitiesToFix.slice(0, 20)) {
    console.log(`  ${row.entity_name} (${row.entity_type}) - ${row.properties_to_fix} properties`);
  }
  if (entitiesToFix.length > 20) {
    console.log(`  ... and ${entitiesToFix.length - 20} more entities`);
  }

  console.log('');
  console.log(`Total entities needing property_owner relationships: ${entitiesToFix.length}`);

  // Write entity fix list
  const entityCsv = [
    'entity_id,entity_name,entity_type,company_name,properties_to_fix',
    ...entitiesToFix.map(r => `${r.entity_id},"${r.entity_name}",${r.entity_type},"${r.company_name}",${r.properties_to_fix}`)
  ].join('\n');

  const entityOutputPath = path.resolve(__dirname, '../data/entities-needing-owner-relationships.csv');
  fs.writeFileSync(entityOutputPath, entityCsv);
  console.log(`Entity CSV written to: ${entityOutputPath}`);

  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
