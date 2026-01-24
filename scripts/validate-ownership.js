/**
 * Validate ownership/operator linking accuracy
 * Checks for inconsistencies and potential errors
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

  console.log('=== OWNERSHIP/OPERATOR VALIDATION ===\n');
  let issues = 0;

  // 1. Check "ownership" type companies that are operating
  console.log('--- CHECK 1: "ownership" companies that are operating (should be 0) ---\n');
  const [ownershipOperating] = await atlas.execute(`
    SELECT c.company_name, COUNT(DISTINCT per.property_master_id) as operating_count
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'facility_operator'
    WHERE c.company_type = 'ownership'
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY c.id, c.company_name
    ORDER BY operating_count DESC
    LIMIT 20
  `);

  if (ownershipOperating.length > 0) {
    console.log('WARNING: "ownership" type companies operating properties:');
    ownershipOperating.forEach(c => {
      console.log(`  ${c.company_name}: ${c.operating_count} properties`);
      issues++;
    });
  } else {
    console.log('PASS: No "ownership" companies are operating properties\n');
  }

  // 2. Check "operating" type companies that own properties
  console.log('\n--- CHECK 2: "operating" companies that own properties (review needed) ---\n');
  const [operatingOwning] = await atlas.execute(`
    SELECT c.company_name, COUNT(DISTINCT per.property_master_id) as owning_count
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'property_owner'
    WHERE c.company_type = 'operating'
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY c.id, c.company_name
    ORDER BY owning_count DESC
    LIMIT 20
  `);

  if (operatingOwning.length > 0) {
    console.log('WARNING: "operating" type companies owning properties (should be owner_operator?):');
    operatingOwning.forEach(c => {
      console.log(`  ${c.company_name}: ${c.owning_count} properties`);
      issues++;
    });
  } else {
    console.log('PASS: No "operating" companies own properties\n');
  }

  // 3. Check PropCo-named entities that are operators (not owners)
  console.log('\n--- CHECK 3: PropCo-named entities linked as operators (may be misclassified) ---\n');
  const [propcoOperators] = await atlas.execute(`
    SELECT e.entity_name, c.company_name, COUNT(DISTINCT per.property_master_id) as op_count,
           (SELECT COUNT(*) FROM property_entity_relationships per2
            WHERE per2.entity_id = e.id AND per2.relationship_type = 'property_owner') as own_count
    FROM entities e
    JOIN companies c ON c.id = e.company_id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'facility_operator'
    WHERE (e.entity_name LIKE '%PROPCO%'
           OR e.entity_name LIKE '%PROP CO%'
           OR e.entity_name LIKE '%PROPERTY HOLDINGS%'
           OR e.entity_name LIKE '%REAL ESTATE%LLC%'
           OR e.entity_name LIKE '%REALTY%LLC%')
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY e.id, e.entity_name, c.company_name
    HAVING own_count = 0
    ORDER BY op_count DESC
    LIMIT 20
  `);

  if (propcoOperators.length > 0) {
    console.log('WARNING: PropCo-named entities are operators but NOT owners:');
    propcoOperators.forEach(e => {
      console.log(`  ${e.entity_name}`);
      console.log(`    Company: ${e.company_name}, Operating: ${e.op_count}, Owning: ${e.own_count}`);
      issues++;
    });
  } else {
    console.log('PASS: No PropCo-named entities are only operators\n');
  }

  // 4. Check OpCo-named entities that are owners (not operators)
  console.log('\n--- CHECK 4: OpCo-named entities linked as owners only (may be misclassified) ---\n');
  const [opcoOwners] = await atlas.execute(`
    SELECT e.entity_name, c.company_name, COUNT(DISTINCT per.property_master_id) as own_count,
           (SELECT COUNT(*) FROM property_entity_relationships per2
            WHERE per2.entity_id = e.id AND per2.relationship_type = 'facility_operator') as op_count
    FROM entities e
    JOIN companies c ON c.id = e.company_id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'property_owner'
    WHERE (e.entity_name LIKE '%OPCO%'
           OR e.entity_name LIKE '%OP CO%'
           OR e.entity_name LIKE '%OPERATING%LLC%'
           OR e.entity_name LIKE '%OPERATIONS%LLC%')
      AND e.entity_name NOT LIKE '%PROPCO%'
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY e.id, e.entity_name, c.company_name
    HAVING op_count = 0
    ORDER BY own_count DESC
    LIMIT 20
  `);

  if (opcoOwners.length > 0) {
    console.log('WARNING: OpCo-named entities are owners but NOT operators:');
    opcoOwners.forEach(e => {
      console.log(`  ${e.entity_name}`);
      console.log(`    Company: ${e.company_name}, Owning: ${e.own_count}, Operating: ${e.op_count}`);
      issues++;
    });
  } else {
    console.log('PASS: No OpCo-named entities are only owners\n');
  }

  // 5. Check major REITs - should own but not operate
  console.log('\n--- CHECK 5: Major REIT validation (should own, not operate) ---\n');
  const reits = ['OMEGA HEALTHCARE INVESTORS', 'SABRA HEALTH CARE REIT', 'WELLTOWER',
                 'NATIONAL HEALTH INVESTORS', 'CARETRUST REIT', 'LTC PROPERTIES',
                 'HEALTHPEAK PROPERTIES', 'VENTAS'];

  for (const reit of reits) {
    const [[result]] = await atlas.execute(`
      SELECT c.company_name, c.company_type,
             (SELECT COUNT(DISTINCT per.property_master_id) FROM entities e
              JOIN property_entity_relationships per ON per.entity_id = e.id
              WHERE e.company_id = c.id AND per.relationship_type = 'property_owner') as owns,
             (SELECT COUNT(DISTINCT per.property_master_id) FROM entities e
              JOIN property_entity_relationships per ON per.entity_id = e.id
              WHERE e.company_id = c.id AND per.relationship_type = 'facility_operator') as operates
      FROM companies c
      WHERE c.company_name = ?
        AND c.company_name NOT LIKE '[MERGED]%'
    `, [reit]);

    if (result) {
      const status = result.operates > 0 ? 'WARNING' : 'PASS';
      if (result.operates > 0) issues++;
      console.log(`${status}: ${result.company_name} (${result.company_type})`);
      console.log(`       Owns: ${result.owns}, Operates: ${result.operates}`);
    } else {
      console.log(`INFO: ${reit} not found`);
    }
  }

  // 6. Check same entity is both owner AND operator for same property
  console.log('\n\n--- CHECK 6: Same entity is owner AND operator for same property ---\n');
  const [sameEntityBoth] = await atlas.execute(`
    SELECT e.entity_name, c.company_name, c.company_type, pm.facility_name, pm.state
    FROM property_entity_relationships per1
    JOIN property_entity_relationships per2 ON per1.property_master_id = per2.property_master_id
      AND per1.entity_id = per2.entity_id
    JOIN entities e ON e.id = per1.entity_id
    JOIN companies c ON c.id = e.company_id
    JOIN property_master pm ON pm.id = per1.property_master_id
    WHERE per1.relationship_type = 'property_owner'
      AND per2.relationship_type = 'facility_operator'
      AND c.company_name NOT LIKE '[MERGED]%'
    LIMIT 30
  `);

  console.log(`Found ${sameEntityBoth.length} properties where same entity is owner AND operator`);
  if (sameEntityBoth.length > 0) {
    console.log('Sample (may be valid for owner-operators):');
    sameEntityBoth.slice(0, 10).forEach(r => {
      console.log(`  ${r.facility_name} (${r.state})`);
      console.log(`    Entity: ${r.entity_name}`);
      console.log(`    Company: ${r.company_name} (${r.company_type})`);
    });
  }

  // 7. Properties with multiple owners
  console.log('\n\n--- CHECK 7: Properties with multiple owners (review for accuracy) ---\n');
  const [multipleOwners] = await atlas.execute(`
    SELECT pm.facility_name, pm.state, pm.city, COUNT(DISTINCT per.entity_id) as owner_count,
           GROUP_CONCAT(DISTINCT c.company_name SEPARATOR ', ') as owners
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id AND per.relationship_type = 'property_owner'
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE c.company_name NOT LIKE '[MERGED]%'
    GROUP BY pm.id, pm.facility_name, pm.state, pm.city
    HAVING owner_count > 1
    ORDER BY owner_count DESC
    LIMIT 20
  `);

  console.log(`Found ${multipleOwners.length} properties with multiple owners`);
  if (multipleOwners.length > 0) {
    multipleOwners.slice(0, 10).forEach(p => {
      console.log(`  ${p.facility_name} (${p.city}, ${p.state}): ${p.owner_count} owners`);
      console.log(`    Owners: ${p.owners}`);
    });
  }

  // 8. Spot check specific well-known owner-operators
  console.log('\n\n--- CHECK 8: Major owner-operator validation ---\n');
  const ownerOps = ['THE ENSIGN GROUP', 'PACS GROUP', 'GENESIS HEALTHCARE',
                    'LIFE CARE CENTERS OF AMERICA', 'TRILOGY HEALTH SERVICES'];

  for (const name of ownerOps) {
    const [[result]] = await atlas.execute(`
      SELECT c.company_name, c.company_type,
             (SELECT COUNT(DISTINCT per.property_master_id) FROM entities e
              JOIN property_entity_relationships per ON per.entity_id = e.id
              WHERE e.company_id = c.id AND per.relationship_type = 'property_owner') as owns,
             (SELECT COUNT(DISTINCT per.property_master_id) FROM entities e
              JOIN property_entity_relationships per ON per.entity_id = e.id
              WHERE e.company_id = c.id AND per.relationship_type = 'facility_operator') as operates
      FROM companies c
      WHERE c.company_name = ?
        AND c.company_name NOT LIKE '[MERGED]%'
    `, [name]);

    if (result) {
      const status = (result.owns > 0 && result.operates > 0) ? 'PASS' : 'WARNING';
      if (status === 'WARNING') issues++;
      console.log(`${status}: ${result.company_name} (${result.company_type})`);
      console.log(`       Owns: ${result.owns}, Operates: ${result.operates}`);
    }
  }

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
