/**
 * Link remaining borrowers by matching to company level
 * PropCo borrowers often share same parent company as OpCo
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
    // Remove PropCo/OpCo suffixes to match at company level
    .replace(/\bREALTY\b/g, '')
    .replace(/\bPROPCO\b/g, '')
    .replace(/\bOPCO\b/g, '')
    .replace(/\bOPERATIONS\b/g, '')
    .replace(/\bHOLDINGS\b/g, '')
    .replace(/\bPROPERTIES\b/g, '')
    .replace(/\bHEALTHCARE\b/g, '')
    .replace(/\bHEALTH CARE\b/g, '')
    .replace(/\bSNF\b/g, '')
    .replace(/\bNURSING\b/g, '')
    .replace(/\bREHAB\b/g, '')
    .trim();
}

// Extract location-based identifiers
function extractLocationKey(name) {
  if (!name) return '';
  // Try to extract city/location name
  const normalized = name.toUpperCase()
    .replace(/[.,\-'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Look for patterns like "CITY SNF" or "CITY HEALTHCARE"
  const words = normalized.split(' ');
  if (words.length >= 2) {
    return words[0]; // Return first word as location key
  }
  return '';
}

async function link() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('=== LINKING REMAINING BORROWERS BY COMPANY MATCH ===\n');

  // Get unlinked borrowers
  const [unlinkedBorrowers] = await db.execute(`
    SELECT dp.party_name, d.property_master_id, d.id as deal_id
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE dp.party_role = 'borrower'
      AND d.property_master_id IS NOT NULL
      AND d.property_master_id NOT IN (
        SELECT property_master_id FROM property_entity_relationships WHERE relationship_type = 'property_borrower'
      )
  `);

  console.log(`Unlinked borrowers: ${unlinkedBorrowers.length}\n`);

  // Get owner entities for these properties
  const propertyIds = [...new Set(unlinkedBorrowers.map(b => b.property_master_id))];
  console.log(`Unique properties: ${propertyIds.length}\n`);

  // Build map of property -> owner entity (for linking)
  const [ownerEntities] = await db.execute(`
    SELECT per.property_master_id, per.entity_id, e.entity_name, c.company_name
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.relationship_type = 'property_owner'
  `);

  const ownerMap = new Map();
  for (const row of ownerEntities) {
    ownerMap.set(row.property_master_id, {
      entityId: row.entity_id,
      entityName: row.entity_name,
      companyName: row.company_name,
      normalizedEntity: normalizeName(row.entity_name),
      normalizedCompany: normalizeName(row.company_name),
      locationKey: extractLocationKey(row.entity_name)
    });
  }

  // Try to match borrowers
  let matchedByNormalized = 0;
  let matchedByLocation = 0;
  let noMatch = 0;
  const noMatchExamples = [];

  for (const borrower of unlinkedBorrowers) {
    const owner = ownerMap.get(borrower.property_master_id);
    if (!owner) {
      noMatch++;
      continue;
    }

    const normalizedBorrower = normalizeName(borrower.party_name);
    const borrowerLocation = extractLocationKey(borrower.party_name);

    let matched = false;

    // Try normalized match (strips PropCo/OpCo suffixes)
    if (normalizedBorrower === owner.normalizedEntity || normalizedBorrower === owner.normalizedCompany) {
      try {
        await db.execute(`
          INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
          VALUES (?, ?, 'property_borrower')
        `, [borrower.property_master_id, owner.entityId]);
        matchedByNormalized++;
        matched = true;
      } catch (err) {
        // Duplicate
      }
    }
    // Try location-based match (e.g., "WHITESBURG SNF REALTY" matches "WHITESBURG SNF OPERATIONS")
    else if (borrowerLocation && borrowerLocation === owner.locationKey && borrowerLocation.length > 3) {
      try {
        await db.execute(`
          INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
          VALUES (?, ?, 'property_borrower')
        `, [borrower.property_master_id, owner.entityId]);
        matchedByLocation++;
        matched = true;
      } catch (err) {
        // Duplicate
      }
    }

    if (!matched) {
      noMatch++;
      if (noMatchExamples.length < 10) {
        noMatchExamples.push({
          borrower: borrower.party_name,
          normalizedBorrower,
          owner: owner.entityName,
          normalizedOwner: owner.normalizedEntity
        });
      }
    }
  }

  console.log('Results:');
  console.log(`  Matched by normalized name: ${matchedByNormalized}`);
  console.log(`  Matched by location key: ${matchedByLocation}`);
  console.log(`  No match: ${noMatch}`);

  console.log('\nNo-match examples:');
  noMatchExamples.forEach(ex => {
    console.log(`  Borrower: "${ex.borrower}" → "${ex.normalizedBorrower}"`);
    console.log(`  Owner: "${ex.owner}" → "${ex.normalizedOwner}"`);
    console.log('');
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
