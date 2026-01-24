/**
 * Load lenders from deals_parties into companies/entities
 * and create property relationships
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// Normalize company name for matching
function normalizeName(name) {
  if (!name) return '';
  return name.toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bLLC\b/g, '')
    .replace(/\bINC\b/g, '')
    .replace(/\bCORP\b/g, '')
    .replace(/\bNA\b/g, '')
    .replace(/\bN\.?A\.?\b/g, '')
    .replace(/\bCO\b/g, '')
    .replace(/\bTHE\b/g, '')
    .replace(/\bBANK\b/g, 'BK')
    .replace(/\bNATIONAL\b/g, 'NATL')
    .replace(/\bASSOCIATION\b/g, 'ASSN')
    .replace(/\bTRUST\b/g, 'TR')
    .trim();
}

// Canonical name mapping for known duplicates
const CANONICAL_NAMES = {
  'CAPITAL FUNDING': 'CAPITAL FUNDING',
  'CAPITAL FUNDING LLC': 'CAPITAL FUNDING',
  'JPMORGAN CHASE BANK NA': 'JPMORGAN CHASE BANK',
  'JPMORGAN CHASE BANK': 'JPMORGAN CHASE BANK',
  'JP MORGAN CHASE BANK': 'JPMORGAN CHASE BANK',
  'WELLS FARGO BANK NA': 'WELLS FARGO BANK',
  'WELLS FARGO BANK': 'WELLS FARGO BANK',
  'BANK OF AMERICA NA': 'BANK OF AMERICA',
  'BANK OF AMERICA': 'BANK OF AMERICA',
  'US BANK NA': 'US BANK',
  'US BANK': 'US BANK',
  'U S BANK NA': 'US BANK',
  'KEY BANK NA': 'KEYBANK',
  'KEYBANK NA': 'KEYBANK',
  'KEYBANK': 'KEYBANK',
  'CITIBANK NA': 'CITIBANK',
  'CITIBANK': 'CITIBANK',
  'M & T BANK': 'M&T BANK',
  'M&T BANK': 'M&T BANK',
  'MANUFACTURERS & TRADERS TRUST CO': 'M&T BANK',
  'TRUIST BANK': 'TRUIST BANK',
  'SUNTRUST BANK': 'TRUIST BANK',
  'BB&T': 'TRUIST BANK',
  'FIFTH THIRD BANK': 'FIFTH THIRD BANK',
  'FIFTH THIRD BANK NA': 'FIFTH THIRD BANK',
  'REGIONS BANK': 'REGIONS BANK',
  'PNC BANK NA': 'PNC BANK',
  'PNC BANK': 'PNC BANK',
};

function getCanonicalName(name) {
  const upper = name.toUpperCase().trim();
  return CANONICAL_NAMES[upper] || upper;
}

async function loadLenders() {
  const atlas = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('=== LOADING LENDERS AS COMPANIES ===\n');

  // Get all unique lenders from deals_parties
  const [lenders] = await atlas.execute(`
    SELECT
      dp.party_name,
      COUNT(DISTINCT dp.deal_id) as deal_count,
      COUNT(DISTINCT d.property_master_id) as property_count,
      SUM(d.amount) as total_loan_amount,
      GROUP_CONCAT(DISTINCT d.property_master_id) as property_ids
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE dp.party_role = 'lender'
      AND dp.party_name IS NOT NULL
      AND dp.party_name != ''
      AND d.property_master_id IS NOT NULL
    GROUP BY dp.party_name
    ORDER BY deal_count DESC
  `);

  console.log(`Found ${lenders.length} unique lenders\n`);

  // Group by canonical name to consolidate duplicates
  const byCanonical = new Map();
  for (const lender of lenders) {
    const canonical = getCanonicalName(lender.party_name);
    if (!byCanonical.has(canonical)) {
      byCanonical.set(canonical, {
        canonical_name: canonical,
        original_names: [],
        deal_count: 0,
        property_count: 0,
        total_loan_amount: 0,
        property_ids: new Set()
      });
    }
    const group = byCanonical.get(canonical);
    group.original_names.push(lender.party_name);
    group.deal_count += lender.deal_count;
    group.property_count += lender.property_count;
    group.total_loan_amount += parseFloat(lender.total_loan_amount || 0);
    if (lender.property_ids) {
      lender.property_ids.split(',').forEach(id => group.property_ids.add(id));
    }
  }

  console.log(`Consolidated to ${byCanonical.size} canonical lenders\n`);

  // Show top 20 lenders
  const sorted = [...byCanonical.values()].sort((a, b) => b.deal_count - a.deal_count);
  console.log('Top 20 lenders by deal count:');
  sorted.slice(0, 20).forEach(l => {
    console.log(`  ${l.canonical_name}: ${l.deal_count} deals, ${l.property_ids.size} properties, $${(l.total_loan_amount/1e9).toFixed(2)}B`);
  });

  // Create companies and entities
  console.log('\n=== CREATING LENDER COMPANIES ===\n');

  let companiesCreated = 0;
  let entitiesCreated = 0;
  let relationshipsCreated = 0;
  let skipped = 0;

  for (const lender of sorted) {
    // Skip lenders with very few deals (noise)
    if (lender.deal_count < 2) {
      skipped++;
      continue;
    }

    // Check if company already exists
    const [[existing]] = await atlas.execute(`
      SELECT id FROM companies
      WHERE company_name = ? AND company_name NOT LIKE '[MERGED]%'
    `, [lender.canonical_name]);

    let companyId;
    if (existing) {
      companyId = existing.id;
      // Update to lending type if not already
      await atlas.execute(`
        UPDATE companies SET company_type = 'lending'
        WHERE id = ? AND company_type NOT IN ('lending', 'owner_operator')
      `, [companyId]);
    } else {
      // Create new company
      const [result] = await atlas.execute(`
        INSERT INTO companies (company_name, company_type)
        VALUES (?, 'lending')
      `, [lender.canonical_name]);
      companyId = result.insertId;
      companiesCreated++;
    }

    // Check if entity exists for this company
    let [[entity]] = await atlas.execute(`
      SELECT id FROM entities
      WHERE company_id = ? AND entity_name = ?
    `, [companyId, lender.canonical_name]);

    let entityId;
    if (entity) {
      entityId = entity.id;
    } else {
      // Create entity
      const [result] = await atlas.execute(`
        INSERT INTO entities (entity_name, entity_type, company_id)
        VALUES (?, 'lender', ?)
      `, [lender.canonical_name, companyId]);
      entityId = result.insertId;
      entitiesCreated++;
    }

    // Create property relationships for lender
    for (const propId of lender.property_ids) {
      try {
        await atlas.execute(`
          INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
          VALUES (?, ?, 'lender')
        `, [propId, entityId]);
        relationshipsCreated++;
      } catch (err) {
        // Skip duplicates
        if (!err.message.includes('Duplicate')) {
          console.log(`  Error creating relationship: ${err.message}`);
        }
      }
    }
  }

  console.log(`\nCreated ${companiesCreated} new lender companies`);
  console.log(`Created ${entitiesCreated} new lender entities`);
  console.log(`Created ${relationshipsCreated} property-lender relationships`);
  console.log(`Skipped ${skipped} lenders with <2 deals`);

  // Summary
  console.log('\n=== FINAL SUMMARY ===\n');

  const [[stats]] = await atlas.execute(`
    SELECT
      (SELECT COUNT(*) FROM companies WHERE company_type = 'lending' AND company_name NOT LIKE '[MERGED]%') as lending_companies,
      (SELECT COUNT(*) FROM entities WHERE entity_type = 'lender') as lender_entities,
      (SELECT COUNT(*) FROM property_entity_relationships WHERE relationship_type = 'lender') as lender_relationships,
      (SELECT COUNT(DISTINCT property_master_id) FROM property_entity_relationships WHERE relationship_type = 'lender') as properties_with_lender
  `);

  console.log(`Lending companies: ${stats.lending_companies}`);
  console.log(`Lender entities: ${stats.lender_entities}`);
  console.log(`Lender relationships: ${stats.lender_relationships}`);
  console.log(`Properties with lender data: ${stats.properties_with_lender}`);

  // Top lenders after load
  const [topLenders] = await atlas.execute(`
    SELECT c.company_name, COUNT(DISTINCT per.property_master_id) as properties
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'lender'
    WHERE c.company_type = 'lending'
    GROUP BY c.id, c.company_name
    ORDER BY properties DESC
    LIMIT 15
  `);

  console.log('\nTop lenders by property count:');
  topLenders.forEach(l => console.log(`  ${l.company_name}: ${l.properties}`));

  await atlas.end();
}

loadLenders().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
