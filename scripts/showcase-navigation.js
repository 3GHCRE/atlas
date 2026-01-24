/**
 * Showcase bidirectional navigation - find a rich example
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function showcase() {
  const atlas = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║          ATLAS NAVIGATION SHOWCASE - BIDIRECTIONAL DATA MODEL           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // Find a property with the most diverse relationships
  const [[bestProperty]] = await atlas.execute(`
    SELECT pm.id, pm.facility_name, pm.address, pm.city, pm.state, pm.zip,
           COUNT(DISTINCT per.relationship_type) as rel_types,
           COUNT(DISTINCT d.id) as deal_count
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    LEFT JOIN deals d ON d.property_master_id = pm.id
    GROUP BY pm.id, pm.facility_name, pm.address, pm.city, pm.state, pm.zip
    HAVING rel_types >= 4 AND deal_count >= 5
    ORDER BY rel_types DESC, deal_count DESC
    LIMIT 1
  `);

  if (!bestProperty) {
    console.log('No suitable property found');
    await atlas.end();
    return;
  }

  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('                         STARTING POINT: PROPERTY');
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  console.log(`  📍 ${bestProperty.facility_name}`);
  console.log(`     ${bestProperty.address}`);
  console.log(`     ${bestProperty.city}, ${bestProperty.state} ${bestProperty.zip}`);
  console.log(`     Property ID: ${bestProperty.id}`);
  console.log(`     Relationships: ${bestProperty.rel_types} types | Deals: ${bestProperty.deal_count}`);

  // Get all relationships for this property
  console.log('\n════════════════════════════════════════════════════════════════════════════');
  console.log('                    STEP 1: PROPERTY → ALL RELATED ENTITIES');
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  const [relationships] = await atlas.execute(`
    SELECT per.relationship_type, e.id as entity_id, e.entity_name, e.entity_type,
           c.id as company_id, c.company_name, c.company_type
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.property_master_id = ?
      AND c.company_name NOT LIKE '[MERGED]%'
    ORDER BY FIELD(per.relationship_type, 'property_owner', 'facility_operator', 'lender', 'property_buyer', 'property_seller', 'property_borrower')
  `, [bestProperty.id]);

  const relIcons = {
    'property_owner': '🏠',
    'facility_operator': '⚙️',
    'lender': '🏦',
    'property_buyer': '🛒',
    'property_seller': '💰',
    'property_borrower': '📝'
  };

  let ownerCompany = null;
  let operatorCompany = null;
  let lenderCompany = null;

  for (const rel of relationships) {
    console.log(`  ${relIcons[rel.relationship_type] || '📌'} ${rel.relationship_type.toUpperCase()}`);
    console.log(`     Entity: ${rel.entity_name}`);
    console.log(`     Company: ${rel.company_name} (${rel.company_type})`);
    console.log('');

    if (rel.relationship_type === 'property_owner') ownerCompany = rel;
    if (rel.relationship_type === 'facility_operator') operatorCompany = rel;
    if (rel.relationship_type === 'lender') lenderCompany = rel;
  }

  // Get deals for this property
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('                    STEP 2: PROPERTY → DEAL HISTORY');
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  const [deals] = await atlas.execute(`
    SELECT d.id, d.deal_type, d.effective_date, d.amount,
           ds.price_per_bed, ds.cap_rate,
           dm.loan_type, dm.interest_rate, dm.term_months
    FROM deals d
    LEFT JOIN deals_sale ds ON ds.deal_id = d.id
    LEFT JOIN deals_mortgage dm ON dm.deal_id = d.id
    WHERE d.property_master_id = ?
    ORDER BY d.effective_date DESC
    LIMIT 10
  `, [bestProperty.id]);

  for (const deal of deals) {
    const date = deal.effective_date ? new Date(deal.effective_date).toLocaleDateString() : 'N/A';
    const amount = deal.amount ? `$${(deal.amount / 1e6).toFixed(2)}M` : '';

    if (deal.deal_type === 'mortgage') {
      console.log(`  🏦 MORTGAGE (${date}) ${amount}`);
      if (deal.loan_type) console.log(`     Type: ${deal.loan_type}`);
      if (deal.interest_rate) console.log(`     Rate: ${deal.interest_rate}%`);
      if (deal.term_months) console.log(`     Term: ${deal.term_months} months`);
    } else if (deal.deal_type === 'sale') {
      console.log(`  💵 SALE (${date}) ${amount}`);
      if (deal.price_per_bed) console.log(`     Price/Bed: $${deal.price_per_bed.toLocaleString()}`);
      if (deal.cap_rate) console.log(`     Cap Rate: ${deal.cap_rate}%`);
    } else if (deal.deal_type === 'chow') {
      console.log(`  📋 CHOW (${date})`);
    }
    console.log('');
  }

  // Navigate from owner company to other properties
  if (ownerCompany) {
    console.log('════════════════════════════════════════════════════════════════════════════');
    console.log(`         STEP 3: OWNER COMPANY → OTHER OWNED PROPERTIES`);
    console.log('════════════════════════════════════════════════════════════════════════════\n');

    console.log(`  🏢 ${ownerCompany.company_name}\n`);

    const [otherOwned] = await atlas.execute(`
      SELECT pm.facility_name, pm.city, pm.state
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ?
        AND per.relationship_type = 'property_owner'
        AND pm.id != ?
      ORDER BY pm.state, pm.city
      LIMIT 10
    `, [ownerCompany.company_id, bestProperty.id]);

    const [[ownerTotal]] = await atlas.execute(`
      SELECT COUNT(DISTINCT pm.id) as total
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ? AND per.relationship_type = 'property_owner'
    `, [ownerCompany.company_id]);

    console.log(`  Total properties owned: ${ownerTotal.total}\n`);
    console.log('  Sample properties:');
    otherOwned.forEach(p => {
      console.log(`    • ${p.facility_name} (${p.city}, ${p.state}) `);
    });
    if (ownerTotal.total > 10) console.log(`    ... and ${ownerTotal.total - 10} more`);
  }

  // Navigate from operator company to other properties
  if (operatorCompany && operatorCompany.company_id !== ownerCompany?.company_id) {
    console.log('\n════════════════════════════════════════════════════════════════════════════');
    console.log(`         STEP 4: OPERATOR COMPANY → OTHER OPERATED PROPERTIES`);
    console.log('════════════════════════════════════════════════════════════════════════════\n');

    console.log(`  ⚙️ ${operatorCompany.company_name}\n`);

    const [otherOperated] = await atlas.execute(`
      SELECT pm.facility_name, pm.city, pm.state
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ?
        AND per.relationship_type = 'facility_operator'
        AND pm.id != ?
      ORDER BY pm.state, pm.city
      LIMIT 10
    `, [operatorCompany.company_id, bestProperty.id]);

    const [[opTotal]] = await atlas.execute(`
      SELECT COUNT(DISTINCT pm.id) as total
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ? AND per.relationship_type = 'facility_operator'
    `, [operatorCompany.company_id]);

    console.log(`  Total properties operated: ${opTotal.total}\n`);
    console.log('  Sample properties:');
    otherOperated.forEach(p => {
      console.log(`    • ${p.facility_name} (${p.city}, ${p.state}) `);
    });
    if (opTotal.total > 10) console.log(`    ... and ${opTotal.total - 10} more`);
  }

  // Navigate from lender to other financed properties
  if (lenderCompany) {
    console.log('\n════════════════════════════════════════════════════════════════════════════');
    console.log(`         STEP 5: LENDER → OTHER FINANCED PROPERTIES`);
    console.log('════════════════════════════════════════════════════════════════════════════\n');

    console.log(`  🏦 ${lenderCompany.company_name}\n`);

    const [otherFinanced] = await atlas.execute(`
      SELECT pm.facility_name, pm.city, pm.state
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ?
        AND per.relationship_type = 'lender'
        AND pm.id != ?
      ORDER BY pm.state, pm.city
      LIMIT 10
    `, [lenderCompany.company_id, bestProperty.id]);

    const [[lenderTotal]] = await atlas.execute(`
      SELECT COUNT(DISTINCT pm.id) as total
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ? AND per.relationship_type = 'lender'
    `, [lenderCompany.company_id]);

    console.log(`  Total properties financed: ${lenderTotal.total}\n`);
    console.log('  Sample properties:');
    otherFinanced.forEach(p => {
      console.log(`    • ${p.facility_name} (${p.city}, ${p.state}) `);
    });
    if (lenderTotal.total > 10) console.log(`    ... and ${lenderTotal.total - 10} more`);
  }

  // Cross-company analysis
  console.log('\n════════════════════════════════════════════════════════════════════════════');
  console.log('         STEP 6: CROSS-REFERENCE - WHO ELSE DOES THE OWNER WORK WITH?');
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  if (ownerCompany) {
    // Find other operators who operate this owner's properties
    const [otherOperators] = await atlas.execute(`
      SELECT c.company_name, COUNT(DISTINCT pm.id) as shared_properties
      FROM property_master pm
      JOIN property_entity_relationships per_own ON per_own.property_master_id = pm.id AND per_own.relationship_type = 'property_owner'
      JOIN entities e_own ON e_own.id = per_own.entity_id AND e_own.company_id = ?
      JOIN property_entity_relationships per_op ON per_op.property_master_id = pm.id AND per_op.relationship_type = 'facility_operator'
      JOIN entities e_op ON e_op.id = per_op.entity_id
      JOIN companies c ON c.id = e_op.company_id AND c.id != ?
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id, c.company_name
      ORDER BY shared_properties DESC
      LIMIT 5
    `, [ownerCompany.company_id, ownerCompany.company_id]);

    console.log(`  Operators who run ${ownerCompany.company_name}'s properties:`);
    if (otherOperators.length > 0) {
      otherOperators.forEach(o => {
        console.log(`    • ${o.company_name}: ${o.shared_properties} properties`);
      });
    } else {
      console.log('    (Owner operates all their own properties)');
    }

    // Find lenders who finance this owner's properties
    const [ownerLenders] = await atlas.execute(`
      SELECT c.company_name, COUNT(DISTINCT pm.id) as financed_properties
      FROM property_master pm
      JOIN property_entity_relationships per_own ON per_own.property_master_id = pm.id AND per_own.relationship_type = 'property_owner'
      JOIN entities e_own ON e_own.id = per_own.entity_id AND e_own.company_id = ?
      JOIN property_entity_relationships per_lend ON per_lend.property_master_id = pm.id AND per_lend.relationship_type = 'lender'
      JOIN entities e_lend ON e_lend.id = per_lend.entity_id
      JOIN companies c ON c.id = e_lend.company_id
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id, c.company_name
      ORDER BY financed_properties DESC
      LIMIT 5
    `, [ownerCompany.company_id]);

    console.log(`\n  Lenders who finance ${ownerCompany.company_name}'s properties:`);
    ownerLenders.forEach(l => {
      console.log(`    • ${l.company_name}: ${l.financed_properties} properties`);
    });
  }

  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                        NAVIGATION COMPLETE                              ║');
  console.log('║                                                                          ║');
  console.log('║  From ONE property, we navigated to:                                    ║');
  console.log('║    → Owner company and their full portfolio                             ║');
  console.log('║    → Operator company and their managed properties                      ║');
  console.log('║    → Lender and their other financed properties                         ║');
  console.log('║    → Deal history (sales, mortgages, CHOWs)                            ║');
  console.log('║    → Cross-company relationships (who works with whom)                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  await atlas.end();
}

showcase().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
