/**
 * Analyze inflated principals to understand the root cause
 */
const { getAtlasConnection } = require('../lib/db-config');

async function analyze() {
  const atlas = await getAtlasConnection();

  try {
    console.log('='.repeat(70));
    console.log('ANALYZING INFLATED PRINCIPALS (>500 properties)');
    console.log('='.repeat(70));

    // Get role distribution for inflated principals
    const [roles] = await atlas.query(`
      SELECT
        per.role,
        COUNT(DISTINCT p.id) as principal_count,
        SUM(cnt.prop_count) as total_properties
      FROM principals p
      JOIN (
        SELECT p2.id, COUNT(DISTINCT pm.id) as prop_count
        FROM principals p2
        JOIN principal_entity_relationships per2 ON per2.principal_id = p2.id AND per2.end_date IS NULL
        JOIN entities e2 ON e2.id = per2.entity_id
        JOIN property_entity_relationships peper2 ON peper2.entity_id = e2.id AND peper2.end_date IS NULL
        JOIN property_master pm ON pm.id = peper2.property_master_id
        GROUP BY p2.id
        HAVING prop_count > 500
      ) cnt ON cnt.id = p.id
      JOIN principal_entity_relationships per ON per.principal_id = p.id AND per.end_date IS NULL
      GROUP BY per.role
      ORDER BY principal_count DESC
    `);

    console.log('\n--- ROLE TYPE DISTRIBUTION ---\n');
    for (const r of roles) {
      console.log(`  ${(r.role_type || 'NULL').padEnd(25)} ${r.principal_count.toString().padStart(5)} principals, ${r.total_properties.toString().padStart(8)} properties`);
    }

    // Get ownership percentages for inflated principals
    const [ownership] = await atlas.query(`
      SELECT
        CASE
          WHEN per.ownership_percentage IS NULL THEN 'NULL'
          WHEN per.ownership_percentage = 0 THEN '0%'
          WHEN per.ownership_percentage <= 5 THEN '1-5%'
          WHEN per.ownership_percentage <= 25 THEN '6-25%'
          WHEN per.ownership_percentage <= 50 THEN '26-50%'
          WHEN per.ownership_percentage <= 100 THEN '51-100%'
          ELSE '>100%'
        END as ownership_bucket,
        COUNT(*) as relationship_count
      FROM principals p
      JOIN (
        SELECT p2.id
        FROM principals p2
        JOIN principal_entity_relationships per2 ON per2.principal_id = p2.id AND per2.end_date IS NULL
        JOIN entities e2 ON e2.id = per2.entity_id
        JOIN property_entity_relationships peper2 ON peper2.entity_id = e2.id AND peper2.end_date IS NULL
        JOIN property_master pm ON pm.id = peper2.property_master_id
        GROUP BY p2.id
        HAVING COUNT(DISTINCT pm.id) > 500
      ) inflated ON inflated.id = p.id
      JOIN principal_entity_relationships per ON per.principal_id = p.id AND per.end_date IS NULL
      GROUP BY ownership_bucket
      ORDER BY relationship_count DESC
    `);

    console.log('\n--- OWNERSHIP PERCENTAGE DISTRIBUTION ---\n');
    for (const o of ownership) {
      console.log(`  ${o.ownership_bucket.padEnd(15)} ${o.relationship_count.toString().padStart(8)} relationships`);
    }

    // Look at the source of these relationships (cms_role_code)
    const [cmsCodes] = await atlas.query(`
      SELECT
        per.cms_role_code,
        COUNT(DISTINCT p.id) as principal_count,
        COUNT(*) as relationship_count
      FROM principals p
      JOIN (
        SELECT p2.id
        FROM principals p2
        JOIN principal_entity_relationships per2 ON per2.principal_id = p2.id AND per2.end_date IS NULL
        JOIN entities e2 ON e2.id = per2.entity_id
        JOIN property_entity_relationships peper2 ON peper2.entity_id = e2.id AND peper2.end_date IS NULL
        JOIN property_master pm ON pm.id = peper2.property_master_id
        GROUP BY p2.id
        HAVING COUNT(DISTINCT pm.id) > 500
      ) inflated ON inflated.id = p.id
      JOIN principal_entity_relationships per ON per.principal_id = p.id AND per.end_date IS NULL
      GROUP BY per.cms_role_code
      ORDER BY relationship_count DESC
    `);

    console.log('\n--- CMS ROLE CODE DISTRIBUTION ---\n');
    console.log('  Code descriptions: 34=owner_direct, 35=owner_indirect, 40=officer,');
    console.log('  41=director, 42=managing_employee, 43=board_member, 44=member, 45=manager\n');
    for (const c of cmsCodes) {
      console.log(`  Code ${(c.cms_role_code?.toString() || 'NULL').padEnd(8)} ${c.principal_count.toString().padStart(5)} principals, ${c.relationship_count.toString().padStart(8)} relationships`);
    }

    // Check how many distinct companies each inflated principal has
    const [companyDistribution] = await atlas.query(`
      SELECT
        CASE
          WHEN company_count <= 5 THEN '1-5 companies'
          WHEN company_count <= 10 THEN '6-10 companies'
          WHEN company_count <= 20 THEN '11-20 companies'
          WHEN company_count <= 30 THEN '21-30 companies'
          ELSE '30+ companies'
        END as company_bucket,
        COUNT(*) as principal_count
      FROM (
        SELECT
          p.id,
          COUNT(DISTINCT c.id) as company_count
        FROM principals p
        JOIN (
          SELECT p2.id
          FROM principals p2
          JOIN principal_entity_relationships per2 ON per2.principal_id = p2.id AND per2.end_date IS NULL
          JOIN entities e2 ON e2.id = per2.entity_id
          JOIN property_entity_relationships peper2 ON peper2.entity_id = e2.id AND peper2.end_date IS NULL
          JOIN property_master pm ON pm.id = peper2.property_master_id
          GROUP BY p2.id
          HAVING COUNT(DISTINCT pm.id) > 500
        ) inflated ON inflated.id = p.id
        JOIN principal_entity_relationships per ON per.principal_id = p.id AND per.end_date IS NULL
        JOIN entities e ON e.id = per.entity_id
        JOIN companies c ON c.id = e.company_id
        GROUP BY p.id
      ) x
      GROUP BY company_bucket
      ORDER BY company_bucket
    `);

    console.log('\n--- COMPANY COUNT DISTRIBUTION ---\n');
    for (const d of companyDistribution) {
      console.log(`  ${d.company_bucket.padEnd(20)} ${d.principal_count.toString().padStart(5)} principals`);
    }

    // Check if these are via company relationships instead
    const [companyRelCheck] = await atlas.query(`
      SELECT
        'via principal_entity_relationships' as path,
        COUNT(DISTINCT p.id) as principals_using_path
      FROM principals p
      JOIN principal_entity_relationships per ON per.principal_id = p.id AND per.end_date IS NULL
      JOIN entities e ON e.id = per.entity_id
      JOIN property_entity_relationships peper ON peper.entity_id = e.id AND peper.end_date IS NULL
      JOIN property_master pm ON pm.id = peper.property_master_id
      WHERE p.id IN (
        SELECT p2.id
        FROM principals p2
        JOIN principal_entity_relationships per2 ON per2.principal_id = p2.id AND per2.end_date IS NULL
        JOIN entities e2 ON e2.id = per2.entity_id
        JOIN property_entity_relationships peper2 ON peper2.entity_id = e2.id AND peper2.end_date IS NULL
        JOIN property_master pm ON pm.id = peper2.property_master_id
        GROUP BY p2.id
        HAVING COUNT(DISTINCT pm.id) > 500
      )
      UNION ALL
      SELECT
        'via principal_company_relationships' as path,
        COUNT(DISTINCT p.id) as principals_using_path
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      JOIN companies c ON c.id = pcr.company_id
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships peper ON peper.entity_id = e.id AND peper.end_date IS NULL
      JOIN property_master pm ON pm.id = peper.property_master_id
      WHERE p.id IN (
        SELECT p2.id
        FROM principals p2
        JOIN principal_entity_relationships per2 ON per2.principal_id = p2.id AND per2.end_date IS NULL
        JOIN entities e2 ON e2.id = per2.entity_id
        JOIN property_entity_relationships peper2 ON peper2.entity_id = e2.id AND peper2.end_date IS NULL
        JOIN property_master pm ON pm.id = peper2.property_master_id
        GROUP BY p2.id
        HAVING COUNT(DISTINCT pm.id) > 500
      )
    `);

    console.log('\n--- RELATIONSHIP PATH ---\n');
    for (const r of companyRelCheck) {
      console.log(`  ${r.path.padEnd(40)} ${r.principals_using_path} principals`);
    }

    // Examine one specific case in detail
    console.log('\n--- DETAILED CASE STUDY: PRAGNESHKUMAR N RADADIYA (id=19604) ---\n');

    const [caseStudy] = await atlas.query(`
      SELECT
        c.company_name,
        e.entity_name,
        per.role,
        per.cms_role_code,
        per.ownership_percentage,
        COUNT(DISTINCT pm.id) as property_count
      FROM principals p
      JOIN principal_entity_relationships per ON per.principal_id = p.id AND per.end_date IS NULL
      JOIN entities e ON e.id = per.entity_id
      JOIN companies c ON c.id = e.company_id
      JOIN property_entity_relationships peper ON peper.entity_id = e.id AND peper.end_date IS NULL
      JOIN property_master pm ON pm.id = peper.property_master_id
      WHERE p.id = 19604
      GROUP BY c.id, e.id, per.role, per.cms_role_code, per.ownership_percentage
      ORDER BY property_count DESC
      LIMIT 15
    `);

    for (const cs of caseStudy) {
      console.log(`  ${cs.company_name?.substring(0, 35).padEnd(35)} | ${cs.entity_name?.substring(0, 30).padEnd(30)} | ${(cs.role_type || 'null').padEnd(12)} | code ${cs.cms_role_code || 'N/A'} | ${cs.property_count} props`);
    }

    console.log('\n' + '='.repeat(70));

  } finally {
    await atlas.end();
  }
}

analyze().catch(console.error);
