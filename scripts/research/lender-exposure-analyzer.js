/**
 * Lender Exposure Analyzer
 * Analyzes lender exposure by operator, owner, geography, and quality
 *
 * Usage: node lender-exposure-analyzer.js [LENDER_NAME]
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const lenderFilter = process.argv[2];

async function analyze() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  LENDER EXPOSURE ANALYZER                                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get major lenders
  const lenderQuery = lenderFilter
    ? `SELECT c.id, c.company_name FROM companies c WHERE c.company_type = 'lending' AND c.company_name LIKE ? LIMIT 5`
    : `SELECT c.id, c.company_name, COUNT(DISTINCT per.property_master_id) as props
       FROM companies c
       JOIN entities e ON e.company_id = c.id
       JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'lender'
       WHERE c.company_type = 'lending'
       GROUP BY c.id
       HAVING props >= 20
       ORDER BY props DESC
       LIMIT 15`;

  const [lenders] = lenderFilter
    ? await db.execute(lenderQuery, [`%${lenderFilter}%`])
    : await db.execute(lenderQuery);

  if (lenders.length === 0) {
    console.log('No lenders found matching criteria.');
    await db.end();
    return;
  }

  if (!lenderFilter) {
    console.log('Top Healthcare Lenders by Portfolio Size:\n');
    console.log('Lender                                         | Properties');
    console.log('-----------------------------------------------|----------');
    lenders.forEach(l => {
      console.log(`${l.company_name.substring(0, 45).padEnd(45)} | ${l.props}`);
    });
    console.log('');
  }

  // Analyze each lender
  const analyzeLenders = lenderFilter ? lenders : lenders.slice(0, 5);

  for (const lender of analyzeLenders) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log(`│  ${lender.company_name.substring(0, 75).padEnd(75)}  │`);
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

    // Get total exposure
    const [[totals]] = await db.execute(`
      SELECT COUNT(DISTINCT per.property_master_id) as properties,
             COUNT(DISTINCT pm.state) as states
      FROM property_entity_relationships per
      JOIN entities e ON e.id = per.entity_id
      JOIN property_master pm ON pm.id = per.property_master_id
      WHERE e.company_id = ?
        AND per.relationship_type = 'lender'
    `, [lender.id]);

    console.log(`  Portfolio Overview:`);
    console.log(`    Properties: ${totals.properties}`);
    console.log(`    States: ${totals.states}`);

    // Get mortgage volume
    const [[mortgageVolume]] = await db.execute(`
      SELECT COUNT(*) as loans, SUM(d.amount) as total_volume
      FROM deals d
      JOIN deals_parties dp ON dp.deal_id = d.id AND dp.party_role = 'lender'
      JOIN entities e ON LOWER(dp.party_name) LIKE CONCAT('%', LOWER(SUBSTRING(e.entity_name, 1, 15)), '%')
      JOIN companies c ON c.id = e.company_id AND c.id = ?
      WHERE d.deal_type = 'mortgage'
    `, [lender.id]);

    if (mortgageVolume.total_volume) {
      console.log(`    Mortgage Volume: $${(mortgageVolume.total_volume/1e9).toFixed(2)}B across ${mortgageVolume.loans} loans`);
    }

    // Exposure by operator
    console.log(`\n  Exposure by Operator:`);
    const [byOperator] = await db.execute(`
      SELECT c_op.company_name as operator, COUNT(DISTINCT per_lend.property_master_id) as props
      FROM property_entity_relationships per_lend
      JOIN entities e_lend ON e_lend.id = per_lend.entity_id AND e_lend.company_id = ?
      JOIN property_entity_relationships per_op ON per_op.property_master_id = per_lend.property_master_id
        AND per_op.relationship_type = 'facility_operator'
      JOIN entities e_op ON e_op.id = per_op.entity_id
      JOIN companies c_op ON c_op.id = e_op.company_id
      WHERE per_lend.relationship_type = 'lender'
      GROUP BY c_op.id
      ORDER BY props DESC
      LIMIT 10
    `, [lender.id]);

    byOperator.forEach(op => {
      const pct = ((op.props / totals.properties) * 100).toFixed(1);
      console.log(`    ${op.operator.substring(0, 40).padEnd(40)} ${op.props} (${pct}%)`);
    });

    // Exposure by owner
    console.log(`\n  Exposure by Owner:`);
    const [byOwner] = await db.execute(`
      SELECT c_own.company_name as owner, COUNT(DISTINCT per_lend.property_master_id) as props
      FROM property_entity_relationships per_lend
      JOIN entities e_lend ON e_lend.id = per_lend.entity_id AND e_lend.company_id = ?
      JOIN property_entity_relationships per_own ON per_own.property_master_id = per_lend.property_master_id
        AND per_own.relationship_type = 'property_owner'
      JOIN entities e_own ON e_own.id = per_own.entity_id
      JOIN companies c_own ON c_own.id = e_own.company_id
      WHERE per_lend.relationship_type = 'lender'
      GROUP BY c_own.id
      ORDER BY props DESC
      LIMIT 10
    `, [lender.id]);

    byOwner.forEach(own => {
      const pct = ((own.props / totals.properties) * 100).toFixed(1);
      console.log(`    ${own.owner.substring(0, 40).padEnd(40)} ${own.props} (${pct}%)`);
    });

    // Geographic concentration
    console.log(`\n  Geographic Concentration:`);
    const [byState] = await db.execute(`
      SELECT pm.state, COUNT(DISTINCT pm.id) as props
      FROM property_entity_relationships per
      JOIN entities e ON e.id = per.entity_id AND e.company_id = ?
      JOIN property_master pm ON pm.id = per.property_master_id
      WHERE per.relationship_type = 'lender'
      GROUP BY pm.state
      ORDER BY props DESC
      LIMIT 10
    `, [lender.id]);

    const stateStr = byState.map(s => `${s.state}(${s.props})`).join(', ');
    console.log(`    ${stateStr}`);

    // Quality risk analysis
    console.log(`\n  Quality Risk Analysis:`);
    const [qualityDist] = await db.execute(`
      SELECT
        CASE
          WHEN qr.overall_rating >= 4 THEN 'High (4-5★)'
          WHEN qr.overall_rating = 3 THEN 'Medium (3★)'
          ELSE 'Low (1-2★)'
        END as quality_tier,
        COUNT(DISTINCT per.property_master_id) as props
      FROM property_entity_relationships per
      JOIN entities e ON e.id = per.entity_id AND e.company_id = ?
      JOIN quality_ratings qr ON qr.property_master_id = per.property_master_id
      WHERE per.relationship_type = 'lender'
        AND qr.rating_date = (SELECT MAX(qr2.rating_date) FROM quality_ratings qr2 WHERE qr2.property_master_id = qr.property_master_id)
      GROUP BY quality_tier
      ORDER BY quality_tier
    `, [lender.id]);

    qualityDist.forEach(q => {
      const pct = ((q.props / totals.properties) * 100).toFixed(1);
      console.log(`    ${q.quality_tier.padEnd(15)} ${q.props} properties (${pct}%)`);
    });

    // Recent loan activity
    console.log(`\n  Recent Loan Activity:`);
    const [recentLoans] = await db.execute(`
      SELECT d.amount, COALESCE(d.effective_date, d.recorded_date) as deal_date,
             pm.facility_name, pm.state,
             dp_borr.party_name as borrower
      FROM deals d
      JOIN property_master pm ON pm.id = d.property_master_id
      JOIN deals_parties dp_lend ON dp_lend.deal_id = d.id AND dp_lend.party_role = 'lender'
      LEFT JOIN deals_parties dp_borr ON dp_borr.deal_id = d.id AND dp_borr.party_role = 'borrower'
      WHERE d.deal_type = 'mortgage'
        AND dp_lend.party_name LIKE ?
      ORDER BY deal_date DESC
      LIMIT 5
    `, [`%${lender.company_name.split(' ')[0]}%`]);

    if (recentLoans.length > 0) {
      recentLoans.forEach(loan => {
        const dateStr = loan.deal_date ? new Date(loan.deal_date).toLocaleDateString() : 'N/A';
        const amount = loan.amount ? `$${(parseFloat(loan.amount)/1e6).toFixed(1)}M` : '';
        console.log(`    ${dateStr} - ${amount} - ${loan.facility_name}, ${loan.state}`);
      });
    } else {
      console.log('    No recent loan activity in records.');
    }

    console.log('');
  }

  // Market overview
  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  LENDING MARKET OVERVIEW                                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  const [lendingByYear] = await db.execute(`
    SELECT YEAR(COALESCE(d.effective_date, d.recorded_date)) as year,
           COUNT(*) as loans,
           SUM(d.amount) as volume
    FROM deals d
    WHERE d.deal_type = 'mortgage'
      AND d.amount > 1000000
      AND COALESCE(d.effective_date, d.recorded_date) >= '2020-01-01'
    GROUP BY year
    ORDER BY year DESC
  `);

  console.log('  Mortgage Activity by Year:\n');
  console.log('  Year | Loans | Volume');
  console.log('  -----|-------|--------');
  lendingByYear.forEach(y => {
    if (y.year) {
      console.log(`  ${y.year} |  ${y.loans.toString().padStart(3)}  | $${(y.volume/1e9).toFixed(2)}B`);
    }
  });

  await db.end();
}

analyze().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
