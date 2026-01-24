/**
 * ENRICHED Navigation Showcase - Complete bidirectional data model demo
 * Demonstrates full power of Atlas database
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

  const output = [];
  const log = (line = '') => {
    console.log(line);
    output.push(line);
  };

  log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  log('║                    ATLAS DATABASE - ENRICHED NAVIGATION SHOWCASE                 ║');
  log('║                     Bidirectional Data Model Demonstration                       ║');
  log('╚══════════════════════════════════════════════════════════════════════════════════╝');
  log();

  // Find the property with most data richness
  const [[property]] = await atlas.execute(`
    SELECT pm.id, pm.ccn, pm.facility_name, pm.address, pm.city, pm.state, pm.zip,
           COUNT(DISTINCT per.relationship_type) as rel_types,
           COUNT(DISTINCT d.id) as deal_count,
           SUM(d.amount) as total_deal_value
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    LEFT JOIN deals d ON d.property_master_id = pm.id
    GROUP BY pm.id, pm.ccn, pm.facility_name, pm.address, pm.city, pm.state, pm.zip
    HAVING rel_types >= 5 AND deal_count >= 8
    ORDER BY rel_types DESC, deal_count DESC, total_deal_value DESC
    LIMIT 1
  `);

  if (!property) {
    log('No suitable property found');
    await atlas.end();
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SECTION 1: THE PROPERTY
  // ═══════════════════════════════════════════════════════════════════════════════════
  log('┌──────────────────────────────────────────────────────────────────────────────────┐');
  log('│                              📍 THE PROPERTY                                     │');
  log('└──────────────────────────────────────────────────────────────────────────────────┘');
  log();
  log(`  ${property.facility_name}`);
  log(`  ─────────────────────────────────────────────────`);
  log(`  Address:      ${property.address}`);
  log(`                ${property.city}, ${property.state} ${property.zip}`);
  log(`  CCN:          ${property.ccn || 'N/A'}`);
  log(`  Property ID:  ${property.id}`);
  log();

  // Get quality ratings if available
  const [[quality]] = await atlas.execute(`
    SELECT overall_rating, health_inspection_rating, staffing_rating, quality_measure_rating,
           rating_date
    FROM quality_ratings
    WHERE property_master_id = ?
    ORDER BY rating_date DESC
    LIMIT 1
  `, [property.id]);

  if (quality) {
    log(`  ┌─ CMS Quality Ratings ─────────────────────────┐`);
    log(`  │  Overall:           ${'★'.repeat(quality.overall_rating || 0)}${'☆'.repeat(5 - (quality.overall_rating || 0))} (${quality.overall_rating}/5)     │`);
    log(`  │  Health Inspection: ${'★'.repeat(quality.health_inspection_rating || 0)}${'☆'.repeat(5 - (quality.health_inspection_rating || 0))} (${quality.health_inspection_rating}/5)     │`);
    log(`  │  Staffing:          ${'★'.repeat(quality.staffing_rating || 0)}${'☆'.repeat(5 - (quality.staffing_rating || 0))} (${quality.staffing_rating}/5)     │`);
    log(`  │  Quality Measures:  ${'★'.repeat(quality.quality_measure_rating || 0)}${'☆'.repeat(5 - (quality.quality_measure_rating || 0))} (${quality.quality_measure_rating}/5)     │`);
    log(`  │  Rating Date:       ${quality.rating_date ? new Date(quality.rating_date).toLocaleDateString() : 'N/A'}              │`);
    log(`  └────────────────────────────────────────────────┘`);
    log();
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SECTION 2: ALL RELATIONSHIPS
  // ═══════════════════════════════════════════════════════════════════════════════════
  log('┌──────────────────────────────────────────────────────────────────────────────────┐');
  log('│                         🔗 ENTITY RELATIONSHIPS                                  │');
  log('└──────────────────────────────────────────────────────────────────────────────────┘');
  log();

  const [relationships] = await atlas.execute(`
    SELECT per.relationship_type, e.id as entity_id, e.entity_name, e.entity_type,
           c.id as company_id, c.company_name, c.company_type
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.property_master_id = ?
      AND c.company_name NOT LIKE '[MERGED]%'
    ORDER BY FIELD(per.relationship_type, 'property_owner', 'facility_operator', 'lender', 'property_buyer', 'property_seller', 'property_borrower')
  `, [property.id]);

  const relIcons = {
    'property_owner': '🏠 OWNER',
    'facility_operator': '⚙️  OPERATOR',
    'lender': '🏦 LENDER',
    'property_buyer': '🛒 BUYER',
    'property_seller': '💰 SELLER',
    'property_borrower': '📝 BORROWER'
  };

  let ownerCompany = null;
  let operatorCompany = null;
  const lenderCompanies = [];

  const groupedRels = {};
  for (const rel of relationships) {
    if (!groupedRels[rel.relationship_type]) {
      groupedRels[rel.relationship_type] = [];
    }
    groupedRels[rel.relationship_type].push(rel);

    if (rel.relationship_type === 'property_owner') ownerCompany = rel;
    if (rel.relationship_type === 'facility_operator') operatorCompany = rel;
    if (rel.relationship_type === 'lender') lenderCompanies.push(rel);
  }

  for (const [relType, rels] of Object.entries(groupedRels)) {
    log(`  ${relIcons[relType] || relType.toUpperCase()}`);
    for (const rel of rels) {
      log(`    ├─ Entity:  ${rel.entity_name}`);
      log(`    └─ Company: ${rel.company_name} (${rel.company_type})`);
      log();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SECTION 3: DEAL HISTORY & FINANCIAL ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════════════
  log('┌──────────────────────────────────────────────────────────────────────────────────┐');
  log('│                         💵 DEAL HISTORY & FINANCIALS                             │');
  log('└──────────────────────────────────────────────────────────────────────────────────┘');
  log();

  const [deals] = await atlas.execute(`
    SELECT d.id, d.deal_type, d.effective_date, d.amount,
           ds.price_per_bed, ds.cap_rate, ds.sale_type,
           dm.loan_type, dm.interest_rate, dm.term_months, dm.maturity_date,
           GROUP_CONCAT(DISTINCT
             CASE WHEN dp.party_role = 'lender' THEN dp.party_name END
           ) as lender_names,
           GROUP_CONCAT(DISTINCT
             CASE WHEN dp.party_role = 'buyer' THEN dp.party_name END
           ) as buyer_names,
           GROUP_CONCAT(DISTINCT
             CASE WHEN dp.party_role = 'seller' THEN dp.party_name END
           ) as seller_names
    FROM deals d
    LEFT JOIN deals_sale ds ON ds.deal_id = d.id
    LEFT JOIN deals_mortgage dm ON dm.deal_id = d.id
    LEFT JOIN deals_parties dp ON dp.deal_id = d.id
    WHERE d.property_master_id = ?
    GROUP BY d.id, d.deal_type, d.effective_date, d.amount,
             ds.price_per_bed, ds.cap_rate, ds.sale_type,
             dm.loan_type, dm.interest_rate, dm.term_months, dm.maturity_date
    ORDER BY d.effective_date DESC
  `, [property.id]);

  // Financial summary
  const mortgages = deals.filter(d => d.deal_type === 'mortgage');
  const sales = deals.filter(d => d.deal_type === 'sale');
  const chows = deals.filter(d => d.deal_type === 'chow');

  const totalMortgageValue = mortgages.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
  const totalSaleValue = sales.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

  log(`  ┌─ Financial Summary ───────────────────────────────┐`);
  log(`  │  Total Deals:        ${deals.length.toString().padStart(3)}                           │`);
  log(`  │  ─────────────────────────────────────────────── │`);
  log(`  │  Mortgages:          ${mortgages.length.toString().padStart(3)}  ($${(totalMortgageValue/1e9).toFixed(2)}B total)      │`);
  log(`  │  Sales:              ${sales.length.toString().padStart(3)}  ($${(totalSaleValue/1e6).toFixed(1)}M total)       │`);
  log(`  │  CHOWs:              ${chows.length.toString().padStart(3)}                           │`);
  log(`  └──────────────────────────────────────────────────┘`);
  log();

  log('  Deal Timeline:');
  log('  ─────────────────────────────────────────────────────────────────');

  for (const deal of deals.slice(0, 12)) {
    const date = deal.effective_date ? new Date(deal.effective_date).toLocaleDateString() : 'N/A';
    const amount = deal.amount ? `$${(deal.amount / 1e6).toFixed(1)}M` : '';

    if (deal.deal_type === 'mortgage') {
      log(`  📅 ${date.padEnd(12)} 🏦 MORTGAGE ${amount.padStart(10)}`);
      if (deal.loan_type) log(`                       Type: ${deal.loan_type}`);
      if (deal.interest_rate) log(`                       Rate: ${deal.interest_rate}%`);
      if (deal.lender_names) log(`                       Lender: ${deal.lender_names.substring(0, 50)}`);
    } else if (deal.deal_type === 'sale') {
      log(`  📅 ${date.padEnd(12)} 💵 SALE     ${amount.padStart(10)}`);
      if (deal.cap_rate) log(`                       Cap Rate: ${deal.cap_rate}%`);
      if (deal.buyer_names) log(`                       Buyer: ${deal.buyer_names.substring(0, 50)}`);
      if (deal.seller_names) log(`                       Seller: ${deal.seller_names.substring(0, 50)}`);
    } else if (deal.deal_type === 'chow') {
      log(`  📅 ${date.padEnd(12)} 📋 CHOW (Change of Ownership)`);
    }
  }
  if (deals.length > 12) log(`  ... and ${deals.length - 12} more deals`);
  log();

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SECTION 4: OWNER DEEP DIVE
  // ═══════════════════════════════════════════════════════════════════════════════════
  if (ownerCompany) {
    log('┌──────────────────────────────────────────────────────────────────────────────────┐');
    log('│                         🏢 OWNER COMPANY DEEP DIVE                               │');
    log('└──────────────────────────────────────────────────────────────────────────────────┘');
    log();
    log(`  Company: ${ownerCompany.company_name}`);
    log(`  Type:    ${ownerCompany.company_type}`);
    log();

    // Portfolio stats
    const [[ownerStats]] = await atlas.execute(`
      SELECT
        COUNT(DISTINCT pm.id) as total_owned,
        COUNT(DISTINCT pm.state) as states,
        GROUP_CONCAT(DISTINCT pm.state ORDER BY pm.state) as state_list
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ? AND per.relationship_type = 'property_owner'
    `, [ownerCompany.company_id]);

    log(`  ┌─ Portfolio Overview ─────────────────────────────┐`);
    log(`  │  Total Properties Owned:  ${ownerStats.total_owned.toString().padStart(4)}                   │`);
    log(`  │  Geographic Reach:        ${ownerStats.states.toString().padStart(4)} states               │`);
    log(`  └──────────────────────────────────────────────────┘`);
    log();

    // State breakdown
    const [stateBreakdown] = await atlas.execute(`
      SELECT pm.state, COUNT(*) as count
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ? AND per.relationship_type = 'property_owner'
      GROUP BY pm.state
      ORDER BY count DESC
      LIMIT 10
    `, [ownerCompany.company_id]);

    log('  Geographic Distribution (Top 10 States):');
    const maxCount = stateBreakdown[0]?.count || 1;
    for (const state of stateBreakdown) {
      const bar = '█'.repeat(Math.ceil(state.count / maxCount * 20));
      log(`    ${state.state}: ${bar} ${state.count}`);
    }
    log();

    // Sample properties
    const [ownerProps] = await atlas.execute(`
      SELECT pm.facility_name, pm.city, pm.state
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ? AND per.relationship_type = 'property_owner' AND pm.id != ?
      ORDER BY pm.state, pm.city
      LIMIT 8
    `, [ownerCompany.company_id, property.id]);

    log('  Sample Properties in Portfolio:');
    for (const p of ownerProps) {
      log(`    • ${p.facility_name} (${p.city}, ${p.state})`);
    }
    if (ownerStats.total_owned > 8) log(`    ... and ${ownerStats.total_owned - 8} more`);
    log();

    // Who operates owner's properties
    const [operators] = await atlas.execute(`
      SELECT c.company_name, COUNT(DISTINCT pm.id) as count
      FROM property_master pm
      JOIN property_entity_relationships per_own ON per_own.property_master_id = pm.id AND per_own.relationship_type = 'property_owner'
      JOIN entities e_own ON e_own.id = per_own.entity_id AND e_own.company_id = ?
      JOIN property_entity_relationships per_op ON per_op.property_master_id = pm.id AND per_op.relationship_type = 'facility_operator'
      JOIN entities e_op ON e_op.id = per_op.entity_id
      JOIN companies c ON c.id = e_op.company_id AND c.id != ?
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id, c.company_name
      ORDER BY count DESC
      LIMIT 10
    `, [ownerCompany.company_id, ownerCompany.company_id]);

    log('  Operating Partners (Companies who operate their properties):');
    if (operators.length > 0) {
      for (const op of operators) {
        log(`    • ${op.company_name}: ${op.count} properties`);
      }
    } else {
      log('    (Owner operates all their own properties)');
    }
    log();

    // Who finances owner's properties
    const [ownerLenders] = await atlas.execute(`
      SELECT c.company_name, COUNT(DISTINCT pm.id) as count,
             SUM(d.amount) as total_financed
      FROM property_master pm
      JOIN property_entity_relationships per_own ON per_own.property_master_id = pm.id AND per_own.relationship_type = 'property_owner'
      JOIN entities e_own ON e_own.id = per_own.entity_id AND e_own.company_id = ?
      JOIN property_entity_relationships per_lend ON per_lend.property_master_id = pm.id AND per_lend.relationship_type = 'lender'
      JOIN entities e_lend ON e_lend.id = per_lend.entity_id
      JOIN companies c ON c.id = e_lend.company_id
      LEFT JOIN deals d ON d.property_master_id = pm.id AND d.deal_type = 'mortgage'
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id, c.company_name
      ORDER BY count DESC
      LIMIT 10
    `, [ownerCompany.company_id]);

    log('  Financing Partners (Lenders to their properties):');
    for (const l of ownerLenders) {
      const vol = l.total_financed ? `($${(l.total_financed/1e9).toFixed(1)}B)` : '';
      log(`    • ${l.company_name}: ${l.count} properties ${vol}`);
    }
    log();
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SECTION 5: OPERATOR ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════════════
  if (operatorCompany && operatorCompany.company_id !== ownerCompany?.company_id) {
    log('┌──────────────────────────────────────────────────────────────────────────────────┐');
    log('│                         ⚙️  OPERATOR COMPANY ANALYSIS                            │');
    log('└──────────────────────────────────────────────────────────────────────────────────┘');
    log();
    log(`  Company: ${operatorCompany.company_name}`);
    log(`  Type:    ${operatorCompany.company_type}`);
    log();

    const [[opStats]] = await atlas.execute(`
      SELECT
        COUNT(DISTINCT pm.id) as total_operated,
        COUNT(DISTINCT pm.state) as states
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ? AND per.relationship_type = 'facility_operator'
    `, [operatorCompany.company_id]);

    log(`  ┌─ Operations Overview ────────────────────────────┐`);
    log(`  │  Total Properties Operated: ${opStats.total_operated.toString().padStart(4)}                │`);
    log(`  │  Geographic Reach:          ${opStats.states.toString().padStart(4)} states            │`);
    log(`  └──────────────────────────────────────────────────┘`);
    log();

    // Who owns the properties they operate
    const [propOwners] = await atlas.execute(`
      SELECT c.company_name, c.company_type, COUNT(DISTINCT pm.id) as count
      FROM property_master pm
      JOIN property_entity_relationships per_op ON per_op.property_master_id = pm.id AND per_op.relationship_type = 'facility_operator'
      JOIN entities e_op ON e_op.id = per_op.entity_id AND e_op.company_id = ?
      JOIN property_entity_relationships per_own ON per_own.property_master_id = pm.id AND per_own.relationship_type = 'property_owner'
      JOIN entities e_own ON e_own.id = per_own.entity_id
      JOIN companies c ON c.id = e_own.company_id AND c.id != ?
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id, c.company_name, c.company_type
      ORDER BY count DESC
      LIMIT 10
    `, [operatorCompany.company_id, operatorCompany.company_id]);

    log('  Property Owners They Work With:');
    if (propOwners.length > 0) {
      for (const owner of propOwners) {
        log(`    • ${owner.company_name} (${owner.company_type}): ${owner.count} properties`);
      }
    } else {
      log('    (They own all properties they operate)');
    }
    log();
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SECTION 6: LENDER ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════════════
  if (lenderCompanies.length > 0) {
    log('┌──────────────────────────────────────────────────────────────────────────────────┐');
    log('│                         🏦 LENDER ANALYSIS                                       │');
    log('└──────────────────────────────────────────────────────────────────────────────────┘');
    log();
    log(`  This property has ${lenderCompanies.length} lenders in its history:`);
    log();

    for (const lender of lenderCompanies.slice(0, 3)) {
      const [[lenderStats]] = await atlas.execute(`
        SELECT COUNT(DISTINCT pm.id) as properties_financed,
               COUNT(DISTINCT pm.state) as states
        FROM property_master pm
        JOIN property_entity_relationships per ON per.property_master_id = pm.id
        JOIN entities e ON e.id = per.entity_id
        WHERE e.company_id = ? AND per.relationship_type = 'lender'
      `, [lender.company_id]);

      log(`  🏦 ${lender.company_name}`);
      log(`     Portfolio: ${lenderStats.properties_financed} properties across ${lenderStats.states} states`);
      log();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SECTION 7: MARKET INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════════════════════════
  log('┌──────────────────────────────────────────────────────────────────────────────────┐');
  log('│                         📊 MARKET INTELLIGENCE                                    │');
  log('└──────────────────────────────────────────────────────────────────────────────────┘');
  log();

  // Other properties in same city
  const [sameCity] = await atlas.execute(`
    SELECT pm.facility_name, c_own.company_name as owner, c_op.company_name as operator
    FROM property_master pm
    LEFT JOIN property_entity_relationships per_own ON per_own.property_master_id = pm.id AND per_own.relationship_type = 'property_owner'
    LEFT JOIN entities e_own ON e_own.id = per_own.entity_id
    LEFT JOIN companies c_own ON c_own.id = e_own.company_id AND c_own.company_name NOT LIKE '[MERGED]%'
    LEFT JOIN property_entity_relationships per_op ON per_op.property_master_id = pm.id AND per_op.relationship_type = 'facility_operator'
    LEFT JOIN entities e_op ON e_op.id = per_op.entity_id
    LEFT JOIN companies c_op ON c_op.id = e_op.company_id AND c_op.company_name NOT LIKE '[MERGED]%'
    WHERE pm.city = ? AND pm.state = ? AND pm.id != ?
    LIMIT 10
  `, [property.city, property.state, property.id]);

  log(`  Competitors in ${property.city}, ${property.state}:`);
  if (sameCity.length > 0) {
    for (const comp of sameCity) {
      log(`    • ${comp.facility_name}`);
      log(`      Owner: ${comp.owner || 'Unknown'} | Operator: ${comp.operator || 'Unknown'}`);
    }
  } else {
    log('    (No other facilities found in this city)');
  }
  log();

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SECTION 8: NAVIGATION SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════════════
  log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  log('║                          NAVIGATION PATHS DEMONSTRATED                           ║');
  log('╠══════════════════════════════════════════════════════════════════════════════════╣');
  log('║                                                                                  ║');
  log('║  From this ONE property, we navigated to:                                        ║');
  log('║                                                                                  ║');
  log('║    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                      ║');
  log('║    │   OWNER     │────▶│  PORTFOLIO  │────▶│  OPERATORS  │                      ║');
  log('║    │  COMPANY    │     │ (283 props) │     │  (partners) │                      ║');
  log('║    └─────────────┘     └─────────────┘     └─────────────┘                      ║');
  log('║           │                                       │                              ║');
  log('║           ▼                                       ▼                              ║');
  log('║    ┌─────────────┐                         ┌─────────────┐                      ║');
  log('║    │   LENDERS   │◀────────────────────────│  FINANCING  │                      ║');
  log('║    │  (6 banks)  │                         │   HISTORY   │                      ║');
  log('║    └─────────────┘                         └─────────────┘                      ║');
  log('║           │                                       │                              ║');
  log('║           ▼                                       ▼                              ║');
  log('║    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                      ║');
  log('║    │   OTHER     │     │   DEALS     │     │   MARKET    │                      ║');
  log('║    │ PROPERTIES  │     │  (12 deals) │     │   COMPS     │                      ║');
  log('║    └─────────────┘     └─────────────┘     └─────────────┘                      ║');
  log('║                                                                                  ║');
  log('║  Ready for CRM Principals to complete the network!                               ║');
  log('║                                                                                  ║');
  log('╚══════════════════════════════════════════════════════════════════════════════════╝');

  // Save to file
  const fs = require('fs');
  const outputPath = 'docs/research/navigation-showcase-output.txt';
  fs.mkdirSync('docs/research', { recursive: true });
  fs.writeFileSync(outputPath, output.join('\n'));
  console.log(`\n\n📄 Output saved to: ${outputPath}`);

  await atlas.end();
}

showcase().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
