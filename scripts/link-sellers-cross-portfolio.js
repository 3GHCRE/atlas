/**
 * Link sellers by matching across the entire portfolio
 * A company that sold Property A might still own Property B
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

function normalizeName(name) {
  if (!name) return '';
  return name.toUpperCase()
    .replace(/[.,\-'"]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bLLC\b/g, '')
    .replace(/\bINC\b/g, '')
    .replace(/\bCORP\b/g, '')
    .replace(/\bCORPORATION\b/g, '')
    .replace(/\bL\.?P\.?$/g, '')
    .replace(/\bLTD\b/g, '')
    .replace(/\bTHE\b/g, '')
    .replace(/\bCO\b$/, '')
    .replace(/\bCOMPANY\b/g, '')
    .trim();
}

async function link() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('=== LINKING SELLERS ACROSS PORTFOLIO ===\n');

  // Build global entity lookup: normalized_name -> entity_id
  console.log('Building global entity lookup...');
  const [allEntities] = await db.execute(`
    SELECT e.id as entity_id, e.entity_name, c.company_name
    FROM entities e
    JOIN companies c ON c.id = e.company_id
    WHERE c.company_name NOT LIKE '[MERGED]%'
  `);

  const entityLookup = new Map();
  for (const row of allEntities) {
    const normalizedEntity = normalizeName(row.entity_name);
    const normalizedCompany = normalizeName(row.company_name);

    if (normalizedEntity && !entityLookup.has(normalizedEntity)) {
      entityLookup.set(normalizedEntity, row.entity_id);
    }
    if (normalizedCompany && !entityLookup.has(normalizedCompany)) {
      entityLookup.set(normalizedCompany, row.entity_id);
    }
  }
  console.log(`Loaded ${entityLookup.size} normalized names -> entity mappings\n`);

  // Get unlinked sellers
  const [unlinkedSellers] = await db.execute(`
    SELECT dp.party_name, d.property_master_id
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE dp.party_role = 'seller'
      AND d.property_master_id IS NOT NULL
      AND d.property_master_id NOT IN (
        SELECT property_master_id FROM property_entity_relationships WHERE relationship_type = 'property_seller'
      )
  `);

  console.log(`Unlinked sellers: ${unlinkedSellers.length}\n`);

  let matched = 0;
  let noMatch = 0;
  const noMatchExamples = [];
  const matchExamples = [];

  for (const seller of unlinkedSellers) {
    const normalizedSeller = normalizeName(seller.party_name);

    if (entityLookup.has(normalizedSeller)) {
      const entityId = entityLookup.get(normalizedSeller);

      try {
        await db.execute(`
          INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
          VALUES (?, ?, 'property_seller')
        `, [seller.property_master_id, entityId]);
        matched++;

        if (matchExamples.length < 5) {
          matchExamples.push(seller.party_name);
        }
      } catch (err) {
        // Duplicate, skip
      }
    } else {
      noMatch++;
      if (noMatchExamples.length < 15) {
        noMatchExamples.push(seller.party_name);
      }
    }
  }

  console.log('Results:');
  console.log(`  Matched to existing entity: ${matched}`);
  console.log(`  No match: ${noMatch}`);

  console.log('\nMatch examples:');
  matchExamples.forEach(s => console.log(`  ✓ ${s}`));

  console.log('\nNo-match examples:');
  noMatchExamples.forEach(s => console.log(`  ✗ ${s}`));

  // Final coverage
  console.log('\n=== FINAL COVERAGE ===\n');

  const [coverage] = await db.execute(`
    SELECT relationship_type,
           COUNT(DISTINCT property_master_id) as properties
    FROM property_entity_relationships
    GROUP BY relationship_type
    ORDER BY properties DESC
  `);

  const [[propCount]] = await db.execute(`SELECT COUNT(*) as cnt FROM property_master`);

  coverage.forEach(r => {
    const pct = (r.properties / propCount.cnt * 100).toFixed(1);
    console.log(`  ${r.relationship_type.padEnd(20)} ${r.properties.toLocaleString().padStart(6)} (${pct}%)`);
  });

  await db.end();
}

link().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
