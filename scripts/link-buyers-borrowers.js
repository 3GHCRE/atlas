/**
 * Link unlinked buyers and borrowers to existing owner/operator entities
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

  console.log('=== LINKING BUYERS/BORROWERS TO EXISTING ENTITIES ===\n');

  // Build lookup: property_id -> { entity_id, normalized_name } for owners and operators
  console.log('Loading owner/operator entity data...');
  const [ownerEntities] = await db.execute(`
    SELECT pm.id as property_id,
           per.entity_id,
           e.entity_name,
           c.company_name,
           per.relationship_type
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.relationship_type IN ('property_owner', 'facility_operator')
  `);

  // Map: property_id -> { normalized_name -> entity_id }
  const propertyEntityMap = new Map();
  for (const row of ownerEntities) {
    if (!propertyEntityMap.has(row.property_id)) {
      propertyEntityMap.set(row.property_id, new Map());
    }
    const map = propertyEntityMap.get(row.property_id);
    map.set(normalizeName(row.entity_name), row.entity_id);
    map.set(normalizeName(row.company_name), row.entity_id);
  }
  console.log(`Loaded entity data for ${propertyEntityMap.size} properties\n`);

  // ===== LINK BUYERS =====
  console.log('--- LINKING BUYERS ---\n');

  const [unlinkedBuyers] = await db.execute(`
    SELECT dp.id as party_id, dp.party_name, d.property_master_id
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE dp.party_role = 'buyer'
      AND d.property_master_id IS NOT NULL
      AND d.property_master_id NOT IN (
        SELECT property_master_id FROM property_entity_relationships WHERE relationship_type = 'property_buyer'
      )
  `);

  let buyerLinked = 0;
  let buyerSkipped = 0;

  for (const buyer of unlinkedBuyers) {
    const normalizedBuyer = normalizeName(buyer.party_name);
    const entityMap = propertyEntityMap.get(buyer.property_master_id);

    if (entityMap && entityMap.has(normalizedBuyer)) {
      const entityId = entityMap.get(normalizedBuyer);

      try {
        await db.execute(`
          INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
          VALUES (?, ?, 'property_buyer')
        `, [buyer.property_master_id, entityId]);
        buyerLinked++;
      } catch (err) {
        // Duplicate, skip
      }
    } else {
      buyerSkipped++;
    }
  }

  console.log(`Buyers linked: ${buyerLinked}`);
  console.log(`Buyers skipped (no match): ${buyerSkipped}`);

  // ===== LINK BORROWERS =====
  console.log('\n--- LINKING BORROWERS ---\n');

  const [unlinkedBorrowers] = await db.execute(`
    SELECT dp.id as party_id, dp.party_name, d.property_master_id
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE dp.party_role = 'borrower'
      AND d.property_master_id IS NOT NULL
      AND d.property_master_id NOT IN (
        SELECT property_master_id FROM property_entity_relationships WHERE relationship_type = 'property_borrower'
      )
  `);

  let borrowerLinked = 0;
  let borrowerSkipped = 0;

  for (const borrower of unlinkedBorrowers) {
    const normalizedBorrower = normalizeName(borrower.party_name);
    const entityMap = propertyEntityMap.get(borrower.property_master_id);

    if (entityMap && entityMap.has(normalizedBorrower)) {
      const entityId = entityMap.get(normalizedBorrower);

      try {
        await db.execute(`
          INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
          VALUES (?, ?, 'property_borrower')
        `, [borrower.property_master_id, entityId]);
        borrowerLinked++;
      } catch (err) {
        // Duplicate, skip
      }
    } else {
      borrowerSkipped++;
    }
  }

  console.log(`Borrowers linked: ${borrowerLinked}`);
  console.log(`Borrowers skipped (no match): ${borrowerSkipped}`);

  // ===== FINAL COVERAGE =====
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
