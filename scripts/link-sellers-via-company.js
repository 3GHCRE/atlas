/**
 * Link sellers by finding their company across the portfolio
 * If seller "WINDSOR CHICO CARE CENTER" has a parent company that owns other properties,
 * link through that company
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

// Extract company "root" name (first significant words)
function extractRoot(name) {
  const norm = normalizeName(name);
  const words = norm.split(' ').filter(w => w.length > 2);
  // Return first 2-3 significant words
  return words.slice(0, 3).join(' ');
}

async function link() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('=== LINKING SELLERS VIA COMPANY ROOT MATCHING ===\n');

  // Build lookup: company root -> { company_id, entity_id }
  console.log('Building company root lookup...');
  const [companies] = await db.execute(`
    SELECT c.id as company_id, c.company_name, e.id as entity_id
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    WHERE c.company_name NOT LIKE '[MERGED]%'
  `);

  const rootLookup = new Map();
  for (const row of companies) {
    const root = extractRoot(row.company_name);
    if (root.length > 5 && !rootLookup.has(root)) {
      rootLookup.set(root, { companyId: row.company_id, entityId: row.entity_id, name: row.company_name });
    }
  }
  console.log(`Root lookup: ${rootLookup.size} entries\n`);

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
  const matchExamples = [];
  const noMatchExamples = [];

  for (const seller of unlinkedSellers) {
    const sellerRoot = extractRoot(seller.party_name);

    if (sellerRoot.length > 5 && rootLookup.has(sellerRoot)) {
      const match = rootLookup.get(sellerRoot);
      try {
        await db.execute(`
          INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
          VALUES (?, ?, 'property_seller')
        `, [seller.property_master_id, match.entityId]);
        matched++;
        if (matchExamples.length < 10) {
          matchExamples.push({ seller: seller.party_name, company: match.name, root: sellerRoot });
        }
      } catch (err) {
        // Duplicate
      }
    } else {
      noMatch++;
      if (noMatchExamples.length < 10) {
        noMatchExamples.push({ seller: seller.party_name, root: sellerRoot });
      }
    }
  }

  console.log('Results:');
  console.log(`  Matched by root: ${matched}`);
  console.log(`  No match: ${noMatch}`);

  console.log('\nMatch examples:');
  matchExamples.forEach(m => {
    console.log(`  "${m.seller}"`);
    console.log(`    -> root "${m.root}" -> company "${m.company}"`);
  });

  console.log('\nNo-match examples:');
  noMatchExamples.forEach(m => {
    console.log(`  "${m.seller}" (root: "${m.root}")`);
  });

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
