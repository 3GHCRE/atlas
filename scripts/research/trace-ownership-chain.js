/**
 * Ownership Chain Tracer
 * Given a property (by name, CCN, or address), traces the full ownership network
 *
 * Usage: node trace-ownership-chain.js "PROPERTY NAME OR CCN"
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const searchTerm = process.argv[2];

if (!searchTerm) {
  console.log('Usage: node trace-ownership-chain.js "PROPERTY NAME OR CCN"');
  process.exit(1);
}

async function trace() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  // Find the property
  const [properties] = await db.execute(`
    SELECT id, ccn, facility_name, address, city, state, zip
    FROM property_master
    WHERE facility_name LIKE ? OR ccn = ? OR address LIKE ?
    LIMIT 5
  `, [`%${searchTerm}%`, searchTerm, `%${searchTerm}%`]);

  if (properties.length === 0) {
    console.log(`No property found matching "${searchTerm}"`);
    await db.end();
    return;
  }

  if (properties.length > 1) {
    console.log('Multiple matches found:');
    properties.forEach((p, i) => console.log(`  ${i+1}. ${p.facility_name} (${p.ccn}) - ${p.city}, ${p.state}`));
    console.log('\nUsing first match.\n');
  }

  const prop = properties[0];

  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log(`║  OWNERSHIP CHAIN: ${prop.facility_name.substring(0, 58).padEnd(58)}  ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Property: ${prop.facility_name}`);
  console.log(`CCN: ${prop.ccn}`);
  console.log(`Address: ${prop.address}, ${prop.city}, ${prop.state} ${prop.zip}\n`);

  // Get all relationships for this property
  const [relationships] = await db.execute(`
    SELECT per.relationship_type, e.id as entity_id, e.entity_name, e.entity_type,
           e.address as entity_address, e.city as entity_city, e.state as entity_state,
           c.id as company_id, c.company_name, c.company_type
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    LEFT JOIN companies c ON c.id = e.company_id
    WHERE per.property_master_id = ?
    ORDER BY
      CASE per.relationship_type
        WHEN 'property_owner' THEN 1
        WHEN 'facility_operator' THEN 2
        WHEN 'lender' THEN 3
        WHEN 'property_buyer' THEN 4
        WHEN 'property_seller' THEN 5
        ELSE 6
      END
  `, [prop.id]);

  // Group by relationship type
  const byType = {};
  for (const rel of relationships) {
    if (!byType[rel.relationship_type]) {
      byType[rel.relationship_type] = [];
    }
    byType[rel.relationship_type].push(rel);
  }

  // Display ownership structure
  console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  OWNERSHIP STRUCTURE                                                            │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const relationshipLabels = {
    'property_owner': '🏢 PROPERTY OWNER',
    'facility_operator': '⚙️  FACILITY OPERATOR',
    'lender': '🏦 LENDER',
    'property_buyer': '📥 BUYER (Historical)',
    'property_seller': '📤 SELLER (Historical)',
    'property_borrower': '💰 BORROWER'
  };

  for (const [type, rels] of Object.entries(byType)) {
    console.log(`${relationshipLabels[type] || type}:`);
    for (const rel of rels) {
      console.log(`  └─ ${rel.entity_name}`);
      if (rel.company_name && rel.company_name !== rel.entity_name) {
        console.log(`     └─ Parent Company: ${rel.company_name} (${rel.company_type})`);
      }
      if (rel.entity_address) {
        console.log(`     └─ Address: ${rel.entity_address}, ${rel.entity_city}, ${rel.entity_state}`);
      }
    }
    console.log('');
  }

  // Get related properties through same owner
  const ownerCompanyIds = relationships
    .filter(r => r.relationship_type === 'property_owner' && r.company_id)
    .map(r => r.company_id);

  if (ownerCompanyIds.length > 0) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│  RELATED PROPERTIES (Same Owner)                                               │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

    const [relatedProps] = await db.execute(`
      SELECT DISTINCT pm.facility_name, pm.city, pm.state, c.company_name
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      JOIN companies c ON c.id = e.company_id
      WHERE c.id IN (${ownerCompanyIds.join(',')})
        AND pm.id != ?
        AND per.relationship_type = 'property_owner'
      ORDER BY pm.state, pm.city
      LIMIT 20
    `, [prop.id]);

    if (relatedProps.length > 0) {
      const byState = {};
      for (const rp of relatedProps) {
        if (!byState[rp.state]) byState[rp.state] = [];
        byState[rp.state].push(rp);
      }

      for (const [state, props] of Object.entries(byState).sort()) {
        console.log(`  ${state}:`);
        props.forEach(p => console.log(`    - ${p.facility_name}, ${p.city}`));
      }

      const [[totalCount]] = await db.execute(`
        SELECT COUNT(DISTINCT pm.id) as cnt
        FROM property_master pm
        JOIN property_entity_relationships per ON per.property_master_id = pm.id
        JOIN entities e ON e.id = per.entity_id
        WHERE e.company_id IN (${ownerCompanyIds.join(',')})
          AND per.relationship_type = 'property_owner'
      `);
      console.log(`\n  Total portfolio: ${totalCount.cnt} properties`);
    } else {
      console.log('  No other properties found under same ownership.');
    }
  }

  // Get deal history
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  DEAL HISTORY                                                                   │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const [deals] = await db.execute(`
    SELECT d.id, d.deal_type, d.amount, d.effective_date, d.recorded_date,
           GROUP_CONCAT(DISTINCT CONCAT(dp.party_role, ':', dp.party_name) SEPARATOR '|') as parties
    FROM deals d
    LEFT JOIN deals_parties dp ON dp.deal_id = d.id
    WHERE d.property_master_id = ?
    GROUP BY d.id
    ORDER BY COALESCE(d.effective_date, d.recorded_date) DESC
  `, [prop.id]);

  if (deals.length > 0) {
    for (const deal of deals) {
      const date = deal.effective_date || deal.recorded_date;
      const dateStr = date ? new Date(date).toLocaleDateString() : 'N/A';
      const amount = deal.amount ? `$${(parseFloat(deal.amount)/1e6).toFixed(1)}M` : '';
      console.log(`  ${dateStr} - ${deal.deal_type.toUpperCase()} ${amount}`);

      if (deal.parties) {
        const parties = deal.parties.split('|');
        parties.forEach(p => {
          const [role, name] = p.split(':');
          console.log(`    └─ ${role}: ${name}`);
        });
      }
      console.log('');
    }
  } else {
    console.log('  No deal history found.');
  }

  // Get quality and financial data
  console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  QUALITY & FINANCIAL DATA                                                       │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const [[quality]] = await db.execute(`
    SELECT overall_rating, health_inspection_rating, staffing_rating,
           quality_measure_rating, rating_date
    FROM quality_ratings
    WHERE property_master_id = ?
    ORDER BY rating_date DESC
    LIMIT 1
  `, [prop.id]);

  if (quality) {
    const stars = (n) => n ? '★'.repeat(n) + '☆'.repeat(5-n) : 'N/A';
    console.log(`  Quality Ratings (${quality.rating_date ? new Date(quality.rating_date).toLocaleDateString() : 'N/A'}):`);
    console.log(`    Overall:    ${stars(quality.overall_rating)}`);
    console.log(`    Health:     ${stars(quality.health_inspection_rating)}`);
    console.log(`    Staffing:   ${stars(quality.staffing_rating)}`);
    console.log(`    Quality:    ${stars(quality.quality_measure_rating)}`);
  } else {
    console.log('  No quality ratings available.');
  }

  const [[costReport]] = await db.execute(`
    SELECT fiscal_year, total_beds, total_patient_revenue, total_operating_expenses,
           net_income, operating_margin, occupancy_rate, medicare_pct, medicaid_pct
    FROM cost_reports
    WHERE property_master_id = ?
    ORDER BY fiscal_year DESC
    LIMIT 1
  `, [prop.id]);

  if (costReport) {
    console.log(`\n  Cost Report (FY${costReport.fiscal_year}):`);
    console.log(`    Beds: ${costReport.total_beds}`);
    if (costReport.total_patient_revenue) {
      console.log(`    Revenue: $${(parseFloat(costReport.total_patient_revenue)/1e6).toFixed(1)}M`);
    }
    if (costReport.operating_margin) {
      console.log(`    Operating Margin: ${(parseFloat(costReport.operating_margin)*100).toFixed(1)}%`);
    }
    if (costReport.medicare_pct && costReport.medicaid_pct) {
      console.log(`    Payer Mix: Medicare ${(parseFloat(costReport.medicare_pct)*100).toFixed(0)}% / Medicaid ${(parseFloat(costReport.medicaid_pct)*100).toFixed(0)}%`);
    }
  }

  console.log('');
  await db.end();
}

trace().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
