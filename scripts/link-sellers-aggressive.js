/**
 * Aggressive seller matching:
 * 1. Match by company name (not just entity)
 * 2. Try partial/fuzzy matching for common patterns
 * 3. Create new entities for major sellers (2+ deals)
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

function normalizeAggressive(name) {
  if (!name) return '';
  return normalizeName(name)
    .replace(/\bREHAB\b/g, '')
    .replace(/\bREHABILITATION\b/g, '')
    .replace(/\bNURSING\b/g, '')
    .replace(/\bCARE\b/g, '')
    .replace(/\bCENTER\b/g, '')
    .replace(/\bHEALTH\b/g, '')
    .replace(/\bHEALTHCARE\b/g, '')
    .replace(/\bSNF\b/g, '')
    .replace(/\bOPERATIONS\b/g, '')
    .replace(/\bHOLDINGS\b/g, '')
    .replace(/\bINVESTMENTS\b/g, '')
    .replace(/\bPROPERTIES\b/g, '')
    .replace(/\bGROUP\b/g, '')
    .replace(/\bMANAGEMENT\b/g, '')
    .replace(/\bSERVICES\b/g, '')
    .replace(/\s+/g, ' ')
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

  console.log('=== AGGRESSIVE SELLER MATCHING ===\n');

  // Build multiple lookup maps
  console.log('Building entity/company lookups...');

  // Map 1: normalized entity name -> entity_id
  const [allEntities] = await db.execute(`
    SELECT e.id as entity_id, e.entity_name, c.id as company_id, c.company_name
    FROM entities e
    JOIN companies c ON c.id = e.company_id
    WHERE c.company_name NOT LIKE '[MERGED]%'
  `);

  const exactLookup = new Map();
  const aggressiveLookup = new Map();
  const companyLookup = new Map(); // company_name -> { company_id, any_entity_id }

  for (const row of allEntities) {
    const normEntity = normalizeName(row.entity_name);
    const normCompany = normalizeName(row.company_name);
    const aggEntity = normalizeAggressive(row.entity_name);
    const aggCompany = normalizeAggressive(row.company_name);

    if (normEntity && !exactLookup.has(normEntity)) {
      exactLookup.set(normEntity, row.entity_id);
    }
    if (normCompany && !exactLookup.has(normCompany)) {
      exactLookup.set(normCompany, row.entity_id);
    }

    if (aggEntity && aggEntity.length > 3 && !aggressiveLookup.has(aggEntity)) {
      aggressiveLookup.set(aggEntity, row.entity_id);
    }
    if (aggCompany && aggCompany.length > 3 && !aggressiveLookup.has(aggCompany)) {
      aggressiveLookup.set(aggCompany, row.entity_id);
    }

    if (!companyLookup.has(normCompany)) {
      companyLookup.set(normCompany, { companyId: row.company_id, entityId: row.entity_id });
    }
  }

  console.log(`  Exact lookup: ${exactLookup.size} entries`);
  console.log(`  Aggressive lookup: ${aggressiveLookup.size} entries`);
  console.log(`  Company lookup: ${companyLookup.size} entries\n`);

  // Get unlinked sellers with deal counts
  const [unlinkedSellers] = await db.execute(`
    SELECT dp.party_name,
           d.property_master_id,
           COUNT(DISTINCT d.id) as deal_count
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE dp.party_role = 'seller'
      AND d.property_master_id IS NOT NULL
      AND d.property_master_id NOT IN (
        SELECT property_master_id FROM property_entity_relationships WHERE relationship_type = 'property_seller'
      )
    GROUP BY dp.party_name, d.property_master_id
    ORDER BY deal_count DESC
  `);

  console.log(`Unlinked seller records: ${unlinkedSellers.length}\n`);

  let matchedExact = 0;
  let matchedAggressive = 0;
  let createdNew = 0;
  let noMatch = 0;

  const newCompanies = new Map(); // For sellers we'll create

  for (const seller of unlinkedSellers) {
    const normSeller = normalizeName(seller.party_name);
    const aggSeller = normalizeAggressive(seller.party_name);

    let entityId = null;

    // Try exact match first
    if (exactLookup.has(normSeller)) {
      entityId = exactLookup.get(normSeller);
      matchedExact++;
    }
    // Try aggressive match
    else if (aggSeller.length > 3 && aggressiveLookup.has(aggSeller)) {
      entityId = aggressiveLookup.get(aggSeller);
      matchedAggressive++;
    }

    if (entityId) {
      try {
        await db.execute(`
          INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
          VALUES (?, ?, 'property_seller')
        `, [seller.property_master_id, entityId]);
      } catch (err) {
        // Duplicate
      }
    } else {
      // Track for potential creation (if 2+ deals)
      if (!newCompanies.has(normSeller)) {
        newCompanies.set(normSeller, {
          name: seller.party_name,
          properties: [],
          dealCount: 0
        });
      }
      const entry = newCompanies.get(normSeller);
      entry.properties.push(seller.property_master_id);
      entry.dealCount += seller.deal_count;
      noMatch++;
    }
  }

  console.log('Matching results:');
  console.log(`  Exact match: ${matchedExact}`);
  console.log(`  Aggressive match: ${matchedAggressive}`);
  console.log(`  No match: ${noMatch}`);

  // Create entities for major sellers (2+ properties or 2+ deals)
  console.log('\n--- CREATING ENTITIES FOR MAJOR SELLERS ---\n');

  const majorSellers = [...newCompanies.entries()]
    .filter(([_, v]) => v.properties.length >= 2 || v.dealCount >= 2)
    .sort((a, b) => b[1].properties.length - a[1].properties.length);

  console.log(`Major sellers to create: ${majorSellers.length}`);
  console.log('Top 10:');
  majorSellers.slice(0, 10).forEach(([name, data]) => {
    console.log(`  ${data.name}: ${data.properties.length} properties, ${data.dealCount} deals`);
  });

  for (const [normName, data] of majorSellers) {
    // Create company
    const [companyResult] = await db.execute(`
      INSERT INTO companies (company_name, company_type)
      VALUES (?, 'other')
    `, [data.name]);
    const companyId = companyResult.insertId;

    // Create entity
    const [entityResult] = await db.execute(`
      INSERT INTO entities (entity_name, entity_type, company_id)
      VALUES (?, 'seller', ?)
    `, [data.name, companyId]);
    const entityId = entityResult.insertId;

    // Create relationships
    for (const propId of data.properties) {
      try {
        await db.execute(`
          INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
          VALUES (?, ?, 'property_seller')
        `, [propId, entityId]);
        createdNew++;
      } catch (err) {
        // Duplicate
      }
    }
  }

  console.log(`\nCreated new: ${createdNew} relationships`);

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
