/**
 * Operator Expansion Monitor
 * Tracks which operators are growing their portfolios through acquisitions
 *
 * Usage: node operator-expansion-monitor.js [OPERATOR_NAME]
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const operatorFilter = process.argv[2];

async function monitor() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  OPERATOR EXPANSION MONITOR                                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  // Find operators with buyer activity
  const [expandingOperators] = await db.execute(`
    SELECT c.id, c.company_name, c.company_type,
           COUNT(DISTINCT d.property_master_id) as acquisitions,
           SUM(d.amount) as total_invested,
           MIN(COALESCE(d.effective_date, d.recorded_date)) as first_acq,
           MAX(COALESCE(d.effective_date, d.recorded_date)) as last_acq
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'property_buyer'
    JOIN deals d ON d.property_master_id = per.property_master_id AND d.deal_type = 'sale'
    WHERE c.company_type IN ('operating', 'owner_operator')
      ${operatorFilter ? 'AND c.company_name LIKE ?' : ''}
    GROUP BY c.id
    HAVING acquisitions >= 2
    ORDER BY last_acq DESC, acquisitions DESC
    LIMIT 30
  `, operatorFilter ? [`%${operatorFilter}%`] : []);

  if (expandingOperators.length === 0) {
    console.log('No expanding operators found.');
    await db.end();
    return;
  }

  console.log('Operators with Recent Acquisition Activity:\n');
  console.log('Operator                                  | Type          | Acq | Invested   | Last Acq');
  console.log('------------------------------------------|---------------|-----|------------|----------');

  for (const op of expandingOperators) {
    const name = op.company_name.substring(0, 40).padEnd(40);
    const type = op.company_type.padEnd(13);
    const acq = op.acquisitions.toString().padStart(3);
    const invested = op.total_invested ? `$${(op.total_invested/1e6).toFixed(0)}M`.padEnd(10) : 'N/A       ';
    const lastAcq = op.last_acq ? new Date(op.last_acq).toLocaleDateString() : 'N/A';
    console.log(`${name} | ${type} | ${acq} | ${invested} | ${lastAcq}`);
  }

  // Detailed view for top expanders or filtered operator
  const detailOperators = operatorFilter ? expandingOperators : expandingOperators.slice(0, 5);

  for (const op of detailOperators) {
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log(`│  ${op.company_name.substring(0, 75).padEnd(75)}  │`);
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

    // Get current portfolio
    const [[portfolio]] = await db.execute(`
      SELECT COUNT(DISTINCT per.property_master_id) as total_props,
             COUNT(DISTINCT CASE WHEN per.relationship_type = 'property_owner' THEN per.property_master_id END) as owned,
             COUNT(DISTINCT CASE WHEN per.relationship_type = 'facility_operator' THEN per.property_master_id END) as operated
      FROM property_entity_relationships per
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ?
    `, [op.id]);

    console.log(`  Current Portfolio:`);
    console.log(`    Total Properties: ${portfolio.total_props}`);
    console.log(`    Owned: ${portfolio.owned} | Operated: ${portfolio.operated}`);

    // Get geographic distribution
    const [geoDistrib] = await db.execute(`
      SELECT pm.state, COUNT(DISTINCT pm.id) as cnt
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ?
      GROUP BY pm.state
      ORDER BY cnt DESC
      LIMIT 10
    `, [op.id]);

    console.log(`\n  Geographic Footprint:`);
    console.log(`    ${geoDistrib.map(g => `${g.state}(${g.cnt})`).join(', ')}`);

    // Get acquisition timeline
    const [acquisitions] = await db.execute(`
      SELECT d.amount, COALESCE(d.effective_date, d.recorded_date) as deal_date,
             pm.facility_name, pm.city, pm.state,
             dp_seller.party_name as seller
      FROM deals d
      JOIN property_master pm ON pm.id = d.property_master_id
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
        AND per.relationship_type = 'property_buyer'
      JOIN entities e ON e.id = per.entity_id AND e.company_id = ?
      LEFT JOIN deals_parties dp_seller ON dp_seller.deal_id = d.id AND dp_seller.party_role = 'seller'
      WHERE d.deal_type = 'sale'
      ORDER BY deal_date DESC
      LIMIT 10
    `, [op.id]);

    if (acquisitions.length > 0) {
      console.log(`\n  Recent Acquisitions:`);
      for (const acq of acquisitions) {
        const dateStr = acq.deal_date ? new Date(acq.deal_date).toLocaleDateString() : 'N/A';
        const amount = acq.amount ? `$${(parseFloat(acq.amount)/1e6).toFixed(1)}M` : '';
        console.log(`    ${dateStr} - ${acq.facility_name}, ${acq.state} ${amount}`);
        if (acq.seller) {
          console.log(`      └─ From: ${acq.seller}`);
        }
      }
    }

    // Get quality metrics for portfolio
    const [[qualityMetrics]] = await db.execute(`
      SELECT AVG(qr.overall_rating) as avg_rating,
             COUNT(CASE WHEN qr.overall_rating >= 4 THEN 1 END) as high_rated,
             COUNT(CASE WHEN qr.overall_rating <= 2 THEN 1 END) as low_rated
      FROM quality_ratings qr
      JOIN property_master pm ON pm.id = qr.property_master_id
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id = ?
        AND qr.rating_date = (
          SELECT MAX(qr2.rating_date) FROM quality_ratings qr2 WHERE qr2.property_master_id = qr.property_master_id
        )
    `, [op.id]);

    if (qualityMetrics.avg_rating) {
      console.log(`\n  Portfolio Quality:`);
      console.log(`    Average Rating: ${parseFloat(qualityMetrics.avg_rating).toFixed(1)}★`);
      console.log(`    High Rated (4-5★): ${qualityMetrics.high_rated} facilities`);
      console.log(`    Low Rated (1-2★): ${qualityMetrics.low_rated} facilities`);
    }
  }

  // Market trends
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  EXPANSION TRENDS                                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  const [byYear] = await db.execute(`
    SELECT YEAR(COALESCE(d.effective_date, d.recorded_date)) as year,
           COUNT(DISTINCT c.id) as active_buyers,
           COUNT(DISTINCT d.property_master_id) as properties_traded,
           SUM(d.amount) as total_value
    FROM deals d
    JOIN property_entity_relationships per ON per.property_master_id = d.property_master_id
      AND per.relationship_type = 'property_buyer'
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id AND c.company_type IN ('operating', 'owner_operator')
    WHERE d.deal_type = 'sale'
      AND COALESCE(d.effective_date, d.recorded_date) >= '2020-01-01'
    GROUP BY year
    ORDER BY year DESC
  `);

  console.log('  Operator Acquisition Activity by Year:\n');
  console.log('  Year | Active Buyers | Properties | Volume');
  console.log('  -----|---------------|------------|--------');
  byYear.forEach(y => {
    if (y.year) {
      const value = y.total_value ? `$${(y.total_value/1e9).toFixed(2)}B` : 'N/A';
      console.log(`  ${y.year} |      ${y.active_buyers.toString().padStart(3)}      |     ${y.properties_traded.toString().padStart(3)}    | ${value}`);
    }
  });

  await db.end();
}

monitor().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
