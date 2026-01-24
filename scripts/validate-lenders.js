/**
 * Validate lender data accuracy
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function validate() {
  const atlas = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('=== LENDER DATA VALIDATION ===\n');
  let issues = 0;

  // 1. Check lending companies have lender relationships
  console.log('--- CHECK 1: Lending companies without lender relationships ---\n');
  const [noRels] = await atlas.execute(`
    SELECT c.company_name,
           (SELECT COUNT(*) FROM entities WHERE company_id = c.id) as entity_count
    FROM companies c
    WHERE c.company_type = 'lending'
      AND c.company_name NOT LIKE '[MERGED]%'
      AND NOT EXISTS (
        SELECT 1 FROM entities e
        JOIN property_entity_relationships per ON per.entity_id = e.id
        WHERE e.company_id = c.id AND per.relationship_type = 'lender'
      )
    ORDER BY entity_count DESC
    LIMIT 20
  `);

  if (noRels.length > 0) {
    console.log(`WARNING: ${noRels.length} lending companies have no lender relationships:`);
    noRels.slice(0, 10).forEach(c => console.log(`  ${c.company_name}: ${c.entity_count} entities`));
    issues += noRels.length;
  } else {
    console.log('PASS: All lending companies have lender relationships\n');
  }

  // 2. Check for non-lending companies with lender relationships
  console.log('\n--- CHECK 2: Non-lending companies with lender relationships ---\n');
  const [nonLending] = await atlas.execute(`
    SELECT c.company_name, c.company_type, COUNT(DISTINCT per.property_master_id) as properties
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'lender'
    WHERE c.company_type != 'lending'
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY c.id, c.company_name, c.company_type
    ORDER BY properties DESC
    LIMIT 20
  `);

  if (nonLending.length > 0) {
    console.log(`WARNING: ${nonLending.length} non-lending companies have lender relationships:`);
    nonLending.forEach(c => {
      console.log(`  ${c.company_name} (${c.company_type}): ${c.properties} properties`);
      issues++;
    });
  } else {
    console.log('PASS: No non-lending companies have lender relationships\n');
  }

  // 3. Check for properties with multiple lenders (may be valid - refinancing)
  console.log('\n--- CHECK 3: Properties with multiple lenders (info only) ---\n');
  const [multiLender] = await atlas.execute(`
    SELECT pm.facility_name, pm.city, pm.state,
           COUNT(DISTINCT c.id) as lender_count,
           GROUP_CONCAT(DISTINCT c.company_name ORDER BY c.company_name SEPARATOR ', ') as lenders
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id AND per.relationship_type = 'lender'
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE c.company_name NOT LIKE '[MERGED]%'
    GROUP BY pm.id, pm.facility_name, pm.city, pm.state
    HAVING lender_count > 3
    ORDER BY lender_count DESC
    LIMIT 20
  `);

  console.log(`Properties with 4+ lenders (likely refinancing history): ${multiLender.length}`);
  if (multiLender.length > 0) {
    multiLender.slice(0, 5).forEach(p => {
      console.log(`  ${p.facility_name} (${p.city}, ${p.state}): ${p.lender_count} lenders`);
      console.log(`    ${p.lenders.substring(0, 100)}...`);
    });
  }

  // 4. Check major banks are correctly classified
  console.log('\n\n--- CHECK 4: Major bank validation ---\n');
  const majorBanks = [
    'JPMORGAN CHASE BANK', 'BANK OF AMERICA', 'WELLS FARGO BANK', 'CITIBANK',
    'US BANK', 'TRUIST BANK', 'KEYBANK', 'M&T BANK', 'HUNTINGTON NATIONAL BANK',
    'FIFTH THIRD BANK', 'REGIONS BANK', 'PNC BANK'
  ];

  for (const bank of majorBanks) {
    const [[result]] = await atlas.execute(`
      SELECT c.company_name, c.company_type,
             (SELECT COUNT(DISTINCT per.property_master_id)
              FROM entities e
              JOIN property_entity_relationships per ON per.entity_id = e.id
              WHERE e.company_id = c.id AND per.relationship_type = 'lender') as properties
      FROM companies c
      WHERE c.company_name = ?
        AND c.company_name NOT LIKE '[MERGED]%'
    `, [bank]);

    if (result) {
      const status = result.company_type === 'lending' ? 'PASS' : 'WARNING';
      if (status === 'WARNING') issues++;
      console.log(`${status}: ${result.company_name} (${result.company_type}): ${result.properties} properties`);
    } else {
      console.log(`INFO: ${bank} not found`);
    }
  }

  // 5. Check healthcare-specific lenders
  console.log('\n\n--- CHECK 5: Healthcare-specific lenders ---\n');
  const hcLenders = [
    'CAPITAL FUNDING', 'OXFORD FINANCE', 'HOUSING & HEALTHCARE FINANCE',
    'WHITE OAK HEALTHCARE FINANCE', 'GENERAL ELECTRIC CAPITAL'
  ];

  for (const lender of hcLenders) {
    const [[result]] = await atlas.execute(`
      SELECT c.company_name, c.company_type,
             (SELECT COUNT(DISTINCT per.property_master_id)
              FROM entities e
              JOIN property_entity_relationships per ON per.entity_id = e.id
              WHERE e.company_id = c.id AND per.relationship_type = 'lender') as properties
      FROM companies c
      WHERE c.company_name = ?
        AND c.company_name NOT LIKE '[MERGED]%'
    `, [lender]);

    if (result) {
      console.log(`${result.company_name}: ${result.properties} properties`);
    }
  }

  // 6. Check entity types for lenders
  console.log('\n\n--- CHECK 6: Entity types for lender entities ---\n');
  const [entityTypes] = await atlas.execute(`
    SELECT e.entity_type, COUNT(*) as count
    FROM entities e
    JOIN companies c ON c.id = e.company_id
    WHERE c.company_type = 'lending'
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY e.entity_type
    ORDER BY count DESC
  `);

  entityTypes.forEach(t => {
    const status = t.entity_type === 'lender' ? 'OK' : 'INFO';
    console.log(`${status}: ${t.entity_type}: ${t.count} entities`);
  });

  // 7. Check deals coverage
  console.log('\n\n--- CHECK 7: Deals to lender relationship coverage ---\n');
  const [[dealStats]] = await atlas.execute(`
    SELECT
      (SELECT COUNT(*) FROM deals WHERE deal_type = 'mortgage') as total_mortgages,
      (SELECT COUNT(DISTINCT dp.deal_id) FROM deals_parties dp WHERE dp.party_role = 'lender') as deals_with_lender_party,
      (SELECT COUNT(DISTINCT d.id)
       FROM deals d
       JOIN deals_parties dp ON dp.deal_id = d.id AND dp.party_role = 'lender'
       JOIN property_entity_relationships per ON per.property_master_id = d.property_master_id AND per.relationship_type = 'lender'
      ) as deals_with_lender_linked
  `);

  console.log(`Total mortgage deals: ${dealStats.total_mortgages}`);
  console.log(`Deals with lender party: ${dealStats.deals_with_lender_party}`);
  console.log(`Coverage: ${(dealStats.deals_with_lender_party / dealStats.total_mortgages * 100).toFixed(1)}%`);

  // 8. Check for same entity as both owner and lender (unusual)
  console.log('\n\n--- CHECK 8: Entities that are both owner and lender (unusual) ---\n');
  const [ownerLender] = await atlas.execute(`
    SELECT DISTINCT e.entity_name, c.company_name, c.company_type
    FROM entities e
    JOIN companies c ON c.id = e.company_id
    WHERE c.company_name NOT LIKE '[MERGED]%'
      AND EXISTS (SELECT 1 FROM property_entity_relationships WHERE entity_id = e.id AND relationship_type = 'property_owner')
      AND EXISTS (SELECT 1 FROM property_entity_relationships WHERE entity_id = e.id AND relationship_type = 'lender')
    LIMIT 20
  `);

  if (ownerLender.length > 0) {
    console.log(`Found ${ownerLender.length} entities with both owner AND lender relationships:`);
    ownerLender.forEach(e => {
      console.log(`  ${e.entity_name} (${e.company_name} - ${e.company_type})`);
      issues++;
    });
  } else {
    console.log('PASS: No entities are both owner and lender\n');
  }

  // 9. Geographic distribution of lender coverage
  console.log('\n\n--- CHECK 9: Lender coverage by state ---\n');
  const [byState] = await atlas.execute(`
    SELECT pm.state,
           COUNT(*) as total,
           SUM(CASE WHEN per.property_master_id IS NOT NULL THEN 1 ELSE 0 END) as with_lender,
           ROUND(SUM(CASE WHEN per.property_master_id IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as pct
    FROM property_master pm
    LEFT JOIN property_entity_relationships per ON per.property_master_id = pm.id AND per.relationship_type = 'lender'
    GROUP BY pm.state
    ORDER BY total DESC
    LIMIT 15
  `);

  console.log('Top states by property count:');
  byState.forEach(s => {
    console.log(`  ${s.state}: ${s.with_lender}/${s.total} (${s.pct}%) with lender data`);
  });

  // Summary
  console.log('\n\n========================================');
  console.log(`VALIDATION COMPLETE: ${issues} potential issues found`);
  console.log('========================================');

  await atlas.end();
}

validate().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
