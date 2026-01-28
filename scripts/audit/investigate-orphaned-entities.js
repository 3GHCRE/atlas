/**
 * Investigate orphaned entities (entities without valid company_id)
 */
const mysql = require('mysql2/promise');

async function investigate() {
  const conn = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || '192.168.65.254',
    port: 3306,
    user: 'root',
    password: 'devpass',
    database: 'atlas'
  });

  console.log('='.repeat(70));
  console.log('INVESTIGATING ORPHANED ENTITIES (entities without valid company)');
  console.log('='.repeat(70));
  console.log('');

  // 1. Count and categorize orphaned entities
  const [orphanedByType] = await conn.query(`
    SELECT e.entity_type, COUNT(*) as cnt
    FROM entities e
    LEFT JOIN companies c ON c.id = e.company_id
    WHERE c.id IS NULL
    GROUP BY e.entity_type
    ORDER BY cnt DESC
  `);

  console.log('--- ORPHANED ENTITIES BY TYPE ---');
  let total = 0;
  for (const row of orphanedByType) {
    console.log('  ' + (row.entity_type || 'NULL').padEnd(20) + row.cnt.toString().padStart(6));
    total += row.cnt;
  }
  console.log('  ' + '-'.repeat(26));
  console.log('  ' + 'TOTAL'.padEnd(20) + total.toString().padStart(6));

  // 2. Check what company_id values these orphaned entities have
  console.log('');
  console.log('--- ORPHANED ENTITY company_id VALUES ---');
  const [companyIdDist] = await conn.query(`
    SELECT
      CASE
        WHEN e.company_id IS NULL THEN 'NULL'
        WHEN e.company_id = 0 THEN '0'
        ELSE 'non-existent ID'
      END as company_id_status,
      COUNT(*) as cnt,
      MIN(e.company_id) as min_id,
      MAX(e.company_id) as max_id
    FROM entities e
    LEFT JOIN companies c ON c.id = e.company_id
    WHERE c.id IS NULL
    GROUP BY
      CASE
        WHEN e.company_id IS NULL THEN 'NULL'
        WHEN e.company_id = 0 THEN '0'
        ELSE 'non-existent ID'
      END
  `);

  for (const row of companyIdDist) {
    const idRange = row.min_id != null ? ` (IDs: ${row.min_id}-${row.max_id})` : '';
    console.log('  ' + row.company_id_status.padEnd(20) + row.cnt.toString().padStart(6) + idRange);
  }

  // 3. Sample orphaned entities
  console.log('');
  console.log('--- SAMPLE ORPHANED ENTITIES (by property count) ---');
  const [samples] = await conn.query(`
    SELECT e.id, e.entity_name, e.entity_type, e.company_id,
           (SELECT COUNT(*) FROM property_entity_relationships WHERE entity_id = e.id) as property_count
    FROM entities e
    LEFT JOIN companies c ON c.id = e.company_id
    WHERE c.id IS NULL
    ORDER BY
      (SELECT COUNT(*) FROM property_entity_relationships WHERE entity_id = e.id) DESC
    LIMIT 20
  `);

  console.log('  ID       Type          Props   Company_ID  Entity Name');
  console.log('  ' + '-'.repeat(85));
  for (const row of samples) {
    const name = (row.entity_name || '').substring(0, 40);
    console.log('  ' + row.id.toString().padEnd(8) + ' ' +
                (row.entity_type || 'NULL').padEnd(12) + ' ' +
                row.property_count.toString().padStart(5) + '   ' +
                (row.company_id === null ? 'NULL' : row.company_id.toString()).padEnd(10) + '  ' +
                name);
  }

  // 4. Check if orphaned entities have property relationships
  console.log('');
  console.log('--- ORPHANED ENTITIES WITH PROPERTY RELATIONSHIPS ---');
  const [[withProps]] = await conn.query(`
    SELECT COUNT(DISTINCT e.id) as cnt
    FROM entities e
    LEFT JOIN companies c ON c.id = e.company_id
    JOIN property_entity_relationships per ON per.entity_id = e.id
    WHERE c.id IS NULL
  `);
  console.log('  Orphaned entities WITH property links: ' + withProps.cnt);

  const [[withoutProps]] = await conn.query(`
    SELECT COUNT(*) as cnt
    FROM entities e
    LEFT JOIN companies c ON c.id = e.company_id
    WHERE c.id IS NULL
      AND NOT EXISTS (SELECT 1 FROM property_entity_relationships WHERE entity_id = e.id)
  `);
  console.log('  Orphaned entities WITHOUT property links: ' + withoutProps.cnt);

  // 5. Check if these are historical/merged entities
  console.log('');
  console.log('--- NAME PATTERNS IN ORPHANED ENTITIES ---');

  const [namePatterns] = await conn.query(`
    SELECT
      CASE
        WHEN e.entity_name LIKE '[MERGED]%' THEN '[MERGED] prefix'
        WHEN e.entity_name LIKE '%LLC%' THEN 'Contains LLC'
        WHEN e.entity_name LIKE '%Inc%' THEN 'Contains Inc'
        WHEN e.entity_name LIKE '%LP%' OR e.entity_name LIKE '%L.P.%' THEN 'Contains LP'
        WHEN e.entity_name LIKE '%Health%' THEN 'Contains Health'
        WHEN e.entity_name LIKE '%Care%' THEN 'Contains Care'
        ELSE 'Other'
      END as pattern,
      COUNT(*) as cnt
    FROM entities e
    LEFT JOIN companies c ON c.id = e.company_id
    WHERE c.id IS NULL
    GROUP BY
      CASE
        WHEN e.entity_name LIKE '[MERGED]%' THEN '[MERGED] prefix'
        WHEN e.entity_name LIKE '%LLC%' THEN 'Contains LLC'
        WHEN e.entity_name LIKE '%Inc%' THEN 'Contains Inc'
        WHEN e.entity_name LIKE '%LP%' OR e.entity_name LIKE '%L.P.%' THEN 'Contains LP'
        WHEN e.entity_name LIKE '%Health%' THEN 'Contains Health'
        WHEN e.entity_name LIKE '%Care%' THEN 'Contains Care'
        ELSE 'Other'
      END
    ORDER BY cnt DESC
  `);

  for (const row of namePatterns) {
    console.log('  ' + row.pattern.padEnd(25) + row.cnt.toString().padStart(6));
  }

  // 6. Check the range of missing company IDs
  console.log('');
  console.log('--- MISSING COMPANY ID ANALYSIS ---');
  const [missingIds] = await conn.query(`
    SELECT e.company_id, COUNT(*) as entity_count
    FROM entities e
    LEFT JOIN companies c ON c.id = e.company_id
    WHERE c.id IS NULL AND e.company_id IS NOT NULL
    GROUP BY e.company_id
    ORDER BY entity_count DESC
    LIMIT 15
  `);

  if (missingIds.length > 0) {
    console.log('  Top missing company IDs (entities pointing to non-existent companies):');
    for (const row of missingIds) {
      console.log('    Company ID ' + row.company_id.toString().padEnd(8) + ': ' + row.entity_count + ' entities');
    }

    // Check if these IDs ever existed
    const [[maxCompanyId]] = await conn.query('SELECT MAX(id) as max_id FROM companies');
    console.log('');
    console.log('  Max company ID in database: ' + maxCompanyId.max_id);

    const aboveMax = missingIds.filter(r => r.company_id > maxCompanyId.max_id);
    console.log('  Missing IDs above max: ' + aboveMax.length);

    // Check if these might be from merged companies
    console.log('');
    console.log('--- CHECKING IF MISSING IDs WERE MERGED ---');
    for (const row of missingIds.slice(0, 5)) {
      const [merged] = await conn.query(`
        SELECT id, company_name FROM companies
        WHERE company_name LIKE '[MERGED]%' AND id = ?
      `, [row.company_id]);

      if (merged.length > 0) {
        console.log('  ID ' + row.company_id + ' is a merged company: ' + merged[0].company_name);
      }
    }
  } else {
    console.log('  All orphaned entities have NULL company_id');
  }

  // 7. Check relationship types of orphaned entities
  console.log('');
  console.log('--- RELATIONSHIP TYPES OF ORPHANED ENTITIES ---');
  const [relTypes] = await conn.query(`
    SELECT per.relationship_type, COUNT(*) as cnt
    FROM entities e
    LEFT JOIN companies c ON c.id = e.company_id
    JOIN property_entity_relationships per ON per.entity_id = e.id
    WHERE c.id IS NULL
    GROUP BY per.relationship_type
    ORDER BY cnt DESC
  `);

  for (const row of relTypes) {
    console.log('  ' + (row.relationship_type || 'NULL').padEnd(25) + row.cnt.toString().padStart(6));
  }

  // 8. Identify potential fixes
  console.log('');
  console.log('='.repeat(70));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(70));

  if (withoutProps.cnt > 0) {
    console.log(`\n1. DELETE ${withoutProps.cnt} orphaned entities with no property relationships:`);
    console.log('   DELETE FROM entities WHERE company_id IS NULL');
    console.log('     AND NOT EXISTS (SELECT 1 FROM property_entity_relationships WHERE entity_id = entities.id);');
  }

  if (withProps.cnt > 0) {
    console.log(`\n2. INVESTIGATE ${withProps.cnt} orphaned entities that have property relationships.`);
    console.log('   These need companies created or reassigned.');
  }

  if (missingIds.length > 0) {
    console.log('\n3. Fix entities pointing to non-existent company IDs:');
    console.log('   - Either create the missing companies');
    console.log('   - Or reassign entities to existing companies');
    console.log('   - Or set company_id to NULL if standalone');
  }

  await conn.end();
}

investigate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
