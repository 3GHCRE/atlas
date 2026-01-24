/**
 * Analyze how many unlinked buyers/borrowers can be matched to existing owners
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

async function analyze() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('=== MATCHING BUYERS/BORROWERS TO EXISTING OWNERS ===\n');

  // Get all properties with their owners/operators
  console.log('Loading owner/operator data...');
  const [ownerData] = await db.execute(`
    SELECT pm.id as property_id,
           e_own.entity_name as owner_entity,
           c_own.company_name as owner_company,
           e_op.entity_name as operator_entity,
           c_op.company_name as operator_company
    FROM property_master pm
    LEFT JOIN property_entity_relationships per_own
      ON per_own.property_master_id = pm.id AND per_own.relationship_type = 'property_owner'
    LEFT JOIN entities e_own ON e_own.id = per_own.entity_id
    LEFT JOIN companies c_own ON c_own.id = e_own.company_id
    LEFT JOIN property_entity_relationships per_op
      ON per_op.property_master_id = pm.id AND per_op.relationship_type = 'facility_operator'
    LEFT JOIN entities e_op ON e_op.id = per_op.entity_id
    LEFT JOIN companies c_op ON c_op.id = e_op.company_id
  `);

  // Build lookup map: property_id -> normalized names
  const ownerMap = new Map();
  for (const row of ownerData) {
    const names = new Set();
    if (row.owner_entity) names.add(normalizeName(row.owner_entity));
    if (row.owner_company) names.add(normalizeName(row.owner_company));
    if (row.operator_entity) names.add(normalizeName(row.operator_entity));
    if (row.operator_company) names.add(normalizeName(row.operator_company));
    ownerMap.set(row.property_id, names);
  }
  console.log(`Loaded ${ownerMap.size} properties with owner data\n`);

  // Get unlinked buyers
  console.log('--- BUYERS ---\n');
  const [unlinkedBuyers] = await db.execute(`
    SELECT dp.party_name, d.property_master_id
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE dp.party_role = 'buyer'
      AND d.property_master_id IS NOT NULL
      AND d.property_master_id NOT IN (
        SELECT property_master_id FROM property_entity_relationships WHERE relationship_type = 'property_buyer'
      )
  `);

  let buyerMatchCount = 0;
  let buyerNoMatchCount = 0;
  const buyerNoMatchExamples = [];

  for (const buyer of unlinkedBuyers) {
    const normalizedBuyer = normalizeName(buyer.party_name);
    const ownerNames = ownerMap.get(buyer.property_master_id);

    if (ownerNames && ownerNames.has(normalizedBuyer)) {
      buyerMatchCount++;
    } else {
      buyerNoMatchCount++;
      if (buyerNoMatchExamples.length < 10) {
        buyerNoMatchExamples.push({
          buyer: buyer.party_name,
          owners: ownerNames ? Array.from(ownerNames).slice(0, 2) : []
        });
      }
    }
  }

  console.log(`Unlinked buyers: ${unlinkedBuyers.length}`);
  console.log(`  Match existing owner/operator: ${buyerMatchCount} (${(buyerMatchCount/unlinkedBuyers.length*100).toFixed(1)}%)`);
  console.log(`  No match: ${buyerNoMatchCount}`);

  console.log('\nNo-match examples:');
  buyerNoMatchExamples.forEach(ex => {
    console.log(`  Buyer: "${ex.buyer}"`);
    console.log(`  Owners: ${ex.owners.join(', ') || 'none'}`);
    console.log('');
  });

  // Get unlinked borrowers
  console.log('--- BORROWERS ---\n');
  const [unlinkedBorrowers] = await db.execute(`
    SELECT dp.party_name, d.property_master_id
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE dp.party_role = 'borrower'
      AND d.property_master_id IS NOT NULL
      AND d.property_master_id NOT IN (
        SELECT property_master_id FROM property_entity_relationships WHERE relationship_type = 'property_borrower'
      )
  `);

  let borrowerMatchCount = 0;
  let borrowerNoMatchCount = 0;
  const borrowerNoMatchExamples = [];

  for (const borrower of unlinkedBorrowers) {
    const normalizedBorrower = normalizeName(borrower.party_name);
    const ownerNames = ownerMap.get(borrower.property_master_id);

    if (ownerNames && ownerNames.has(normalizedBorrower)) {
      borrowerMatchCount++;
    } else {
      borrowerNoMatchCount++;
      if (borrowerNoMatchExamples.length < 10) {
        borrowerNoMatchExamples.push({
          borrower: borrower.party_name,
          owners: ownerNames ? Array.from(ownerNames).slice(0, 2) : []
        });
      }
    }
  }

  console.log(`Unlinked borrowers: ${unlinkedBorrowers.length}`);
  console.log(`  Match existing owner/operator: ${borrowerMatchCount} (${(borrowerMatchCount/unlinkedBorrowers.length*100).toFixed(1)}%)`);
  console.log(`  No match: ${borrowerNoMatchCount}`);

  console.log('\nNo-match examples:');
  borrowerNoMatchExamples.forEach(ex => {
    console.log(`  Borrower: "${ex.borrower}"`);
    console.log(`  Owners: ${ex.owners.join(', ') || 'none'}`);
    console.log('');
  });

  // Summary
  console.log('\n=== SUMMARY ===\n');
  const [[propCount]] = await db.execute(`SELECT COUNT(*) as cnt FROM property_master`);

  const currentBuyer = 2172;
  const currentBorrower = 3859;

  const potentialBuyer = currentBuyer + buyerMatchCount;
  const potentialBorrower = currentBorrower + borrowerMatchCount;

  console.log('If we link matching buyers/borrowers to existing owner entities:');
  console.log(`  property_buyer:    ${currentBuyer} → ${potentialBuyer} (${(potentialBuyer/propCount.cnt*100).toFixed(1)}%)`);
  console.log(`  property_borrower: ${currentBorrower} → ${potentialBorrower} (${(potentialBorrower/propCount.cnt*100).toFixed(1)}%)`);

  await db.end();
}

analyze().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
