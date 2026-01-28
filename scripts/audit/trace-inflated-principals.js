#!/usr/bin/env node

/**
 * Trace why inflated principals have such high property counts
 * This shows the property aggregation across subsidiary companies
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

async function trace() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log('='.repeat(80));
  console.log('TRACING WHY INFLATED PRINCIPALS HAVE 689-729 PROPERTIES');
  console.log('='.repeat(80));
  console.log();

  // Get one of the 17 remaining inflated principals
  const principalId = 22267; // Chad Fullmer - shows 729 properties

  const [principal] = await connection.query(
    `SELECT id, full_name, principal_source FROM principals WHERE id = ?`,
    [principalId]
  );

  console.log(`Principal: ${principal[0].full_name} (ID: ${principalId})`);
  console.log(`Source: ${principal[0].principal_source}`);
  console.log();

  // Get all company relationships
  const [companyRels] = await connection.query(`
    SELECT
      pcr.company_id,
      c.company_name,
      c.company_type,
      pcr.role,
      pcr.ownership_percentage,
      COUNT(DISTINCT pm.id) as property_count
    FROM principal_company_relationships pcr
    JOIN companies c ON c.id = pcr.company_id
    LEFT JOIN entities e ON e.company_id = c.id
    LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
    LEFT JOIN property_master pm ON pm.id = per.property_master_id
    WHERE pcr.principal_id = ?
      AND pcr.end_date IS NULL
    GROUP BY pcr.company_id, c.company_name, c.company_type, pcr.role, pcr.ownership_percentage
    ORDER BY property_count DESC
  `, [principalId]);

  console.log('Companies this principal is linked to:');
  console.log('-'.repeat(80));

  let totalProperties = 0;
  for (const rel of companyRels) {
    console.log(`  ${rel.company_name}`);
    console.log(`    Type: ${rel.company_type || 'unknown'} | Role: ${rel.role} | Ownership: ${rel.ownership_percentage || 0}%`);
    console.log(`    Properties via this company: ${rel.property_count}`);
    totalProperties += rel.property_count;
    console.log();
  }

  console.log('-'.repeat(80));
  console.log(`TOTAL AGGREGATED PROPERTIES: ${totalProperties}`);
  console.log();

  // Now check if these companies are related (subsidiaries of THE ENSIGN GROUP)
  console.log('='.repeat(80));
  console.log('CHECKING COMPANY RELATIONSHIPS');
  console.log('='.repeat(80));

  // Look for THE ENSIGN GROUP
  const [ensign] = await connection.query(
    `SELECT id, company_name, company_type FROM companies WHERE company_name LIKE '%ENSIGN GROUP%'`
  );

  if (ensign.length > 0) {
    console.log(`\nParent Company: ${ensign[0].company_name} (ID: ${ensign[0].id})`);

    // Check if any of the principal's companies are subsidiaries
    const companyIds = companyRels.map(r => r.company_id);

    // Check for common ownership patterns
    console.log('\nSubsidiary/Affiliate Analysis:');
    for (const rel of companyRels) {
      if (rel.company_name.includes('ENSIGN')) {
        console.log(`  - ${rel.company_name}: DIRECT ENSIGN ENTITY`);
      } else {
        // Check if this company shares entities with Ensign
        const [shared] = await connection.query(`
          SELECT COUNT(DISTINCT pm.id) as shared_properties
          FROM property_entity_relationships per1
          JOIN entities e1 ON e1.id = per1.entity_id
          JOIN property_master pm ON pm.id = per1.property_master_id
          JOIN property_entity_relationships per2 ON per2.property_master_id = pm.id
          JOIN entities e2 ON e2.id = per2.entity_id
          WHERE e1.company_id = ?
            AND e2.company_id = ?
            AND per1.end_date IS NULL
            AND per2.end_date IS NULL
        `, [rel.company_id, ensign[0].id]);

        if (shared[0].shared_properties > 0) {
          console.log(`  - ${rel.company_name}: Shares ${shared[0].shared_properties} properties with Ensign`);
        } else {
          console.log(`  - ${rel.company_name}: Independent subsidiary/affiliate`);
        }
      }
    }
  }

  // Now explain what SHOULD happen
  console.log();
  console.log('='.repeat(80));
  console.log('THE PROBLEM:');
  console.log('='.repeat(80));
  console.log(`
This principal has ownership stakes in ${companyRels.length} companies.
Our current counting method sums properties from ALL ${companyRels.length} companies = ${totalProperties} total.

BUT: These are all SUBSIDIARY operating companies of the same parent group.
The ${totalProperties} count is misleading because:
1. Many properties are counted multiple times (via different subsidiaries)
2. Having an ownership stake in a subsidiary company does not mean owning all its properties

CORRECT INTERPRETATION:
- This person has ownership stakes in ${companyRels.length} Ensign-related operating companies
- The Ensign Group total portfolio is ~300-350 facilities
- Each subsidiary operates a subset of those facilities
`);

  // Get unique property count (de-duplicated)
  const [uniqueProps] = await connection.query(`
    SELECT COUNT(DISTINCT pm.id) as unique_count
    FROM principal_company_relationships pcr
    JOIN companies c ON c.id = pcr.company_id
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
    JOIN property_master pm ON pm.id = per.property_master_id
    WHERE pcr.principal_id = ?
      AND pcr.end_date IS NULL
  `, [principalId]);

  console.log(`UNIQUE PROPERTIES (de-duplicated): ${uniqueProps[0].unique_count}`);

  await connection.end();
}

trace().catch(console.error);
