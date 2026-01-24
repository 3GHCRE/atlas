/**
 * Market Activity Analyzer
 * Analyzes SNF transaction activity by state, region, and time period
 *
 * Usage: node market-activity-analyzer.js [STATE_CODE]
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const stateFilter = process.argv[2]?.toUpperCase();

async function analyze() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  MARKET ACTIVITY ANALYZER                                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  if (stateFilter) {
    // State-specific analysis
    await analyzeState(db, stateFilter);
  } else {
    // National overview
    await nationalOverview(db);
  }

  await db.end();
}

async function nationalOverview(db) {
  console.log('NATIONAL SNF TRANSACTION OVERVIEW\n');

  // Activity by state
  console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  TOP STATES BY TRANSACTION VOLUME (2023-2025)                                   │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const [byState] = await db.execute(`
    SELECT pm.state,
           COUNT(DISTINCT d.id) as deals,
           COUNT(DISTINCT d.property_master_id) as properties,
           SUM(CASE WHEN d.deal_type = 'sale' THEN d.amount ELSE 0 END) as sale_volume,
           SUM(CASE WHEN d.deal_type = 'mortgage' THEN d.amount ELSE 0 END) as mortgage_volume
    FROM deals d
    JOIN property_master pm ON pm.id = d.property_master_id
    WHERE d.amount > 1000000
      AND COALESCE(d.effective_date, d.recorded_date) >= '2023-01-01'
    GROUP BY pm.state
    ORDER BY sale_volume DESC
    LIMIT 20
  `);

  console.log('State | Deals | Props | Sales Volume | Mortgage Volume');
  console.log('------|-------|-------|--------------|----------------');
  byState.forEach(s => {
    const sales = s.sale_volume ? `$${(s.sale_volume/1e6).toFixed(0)}M`.padEnd(12) : 'N/A         ';
    const mortgages = s.mortgage_volume ? `$${(s.mortgage_volume/1e6).toFixed(0)}M` : 'N/A';
    console.log(`  ${s.state}  |  ${s.deals.toString().padStart(3)}  |  ${s.properties.toString().padStart(3)}  | ${sales} | ${mortgages}`);
  });

  // Quarterly trends
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  QUARTERLY TRANSACTION TRENDS                                                   │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const [quarterly] = await db.execute(`
    SELECT
      CONCAT(YEAR(COALESCE(d.effective_date, d.recorded_date)), ' Q',
             QUARTER(COALESCE(d.effective_date, d.recorded_date))) as quarter,
      COUNT(DISTINCT CASE WHEN d.deal_type = 'sale' THEN d.id END) as sales,
      COUNT(DISTINCT CASE WHEN d.deal_type = 'mortgage' THEN d.id END) as mortgages,
      SUM(CASE WHEN d.deal_type = 'sale' THEN d.amount ELSE 0 END) as sale_vol,
      SUM(CASE WHEN d.deal_type = 'mortgage' THEN d.amount ELSE 0 END) as mortgage_vol
    FROM deals d
    WHERE d.amount > 1000000
      AND COALESCE(d.effective_date, d.recorded_date) >= '2023-01-01'
    GROUP BY quarter
    ORDER BY quarter DESC
    LIMIT 12
  `);

  console.log('Quarter  | Sales | Mortgages | Sale Volume  | Mortgage Volume');
  console.log('---------|-------|-----------|--------------|----------------');
  quarterly.forEach(q => {
    if (q.quarter) {
      const saleVol = q.sale_vol ? `$${(q.sale_vol/1e6).toFixed(0)}M`.padEnd(12) : 'N/A         ';
      const mortVol = q.mortgage_vol ? `$${(q.mortgage_vol/1e6).toFixed(0)}M` : 'N/A';
      console.log(`${q.quarter.padEnd(8)} |  ${q.sales.toString().padStart(3)}  |    ${q.mortgages.toString().padStart(3)}    | ${saleVol} | ${mortVol}`);
    }
  });

  // Top buyers nationally
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  MOST ACTIVE BUYERS (2023-2025)                                                 │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const [topBuyers] = await db.execute(`
    SELECT c.company_name, c.company_type,
           COUNT(DISTINCT d.property_master_id) as properties,
           SUM(d.amount) as total_invested
    FROM deals d
    JOIN deals_parties dp ON dp.deal_id = d.id AND dp.party_role = 'buyer'
    JOIN entities e ON LOWER(e.entity_name) LIKE CONCAT('%', LOWER(SUBSTRING(dp.party_name, 1, 20)), '%')
    JOIN companies c ON c.id = e.company_id
    WHERE d.deal_type = 'sale'
      AND d.amount > 1000000
      AND COALESCE(d.effective_date, d.recorded_date) >= '2023-01-01'
    GROUP BY c.id
    HAVING properties >= 3
    ORDER BY total_invested DESC
    LIMIT 15
  `);

  console.log('Buyer                                    | Type          | Props | Invested');
  console.log('-----------------------------------------|---------------|-------|----------');
  topBuyers.forEach(b => {
    const invested = b.total_invested ? `$${(b.total_invested/1e6).toFixed(0)}M` : 'N/A';
    console.log(`${b.company_name.substring(0, 40).padEnd(40)} | ${b.company_type.padEnd(13)} | ${b.properties.toString().padStart(4)}  | ${invested}`);
  });

  // Price per bed analysis
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  PRICE PER BED ANALYSIS BY STATE (Sales > $5M)                                  │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const [pricePerBed] = await db.execute(`
    SELECT pm.state,
           COUNT(*) as deals,
           AVG(d.amount / NULLIF(cr.total_beds, 0)) as avg_price_per_bed,
           MIN(d.amount / NULLIF(cr.total_beds, 0)) as min_ppb,
           MAX(d.amount / NULLIF(cr.total_beds, 0)) as max_ppb
    FROM deals d
    JOIN property_master pm ON pm.id = d.property_master_id
    JOIN cost_reports cr ON cr.property_master_id = pm.id
    WHERE d.deal_type = 'sale'
      AND d.amount > 5000000
      AND cr.total_beds > 0
      AND COALESCE(d.effective_date, d.recorded_date) >= '2022-01-01'
    GROUP BY pm.state
    HAVING deals >= 3
    ORDER BY avg_price_per_bed DESC
    LIMIT 15
  `);

  console.log('State | Deals | Avg $/Bed  | Min $/Bed  | Max $/Bed');
  console.log('------|-------|------------|------------|----------');
  pricePerBed.forEach(p => {
    const avg = p.avg_price_per_bed ? `$${(p.avg_price_per_bed/1000).toFixed(0)}K`.padEnd(10) : 'N/A       ';
    const min = p.min_ppb ? `$${(p.min_ppb/1000).toFixed(0)}K`.padEnd(10) : 'N/A       ';
    const max = p.max_ppb ? `$${(p.max_ppb/1000).toFixed(0)}K` : 'N/A';
    console.log(`  ${p.state}  |  ${p.deals.toString().padStart(3)}  | ${avg} | ${min} | ${max}`);
  });
}

async function analyzeState(db, state) {
  console.log(`${state} STATE MARKET ANALYSIS\n`);

  // State overview
  const [[stateOverview]] = await db.execute(`
    SELECT COUNT(DISTINCT pm.id) as total_facilities,
           SUM(cr.total_beds) as total_beds,
           AVG(qr.overall_rating) as avg_quality
    FROM property_master pm
    LEFT JOIN cost_reports cr ON cr.property_master_id = pm.id
    LEFT JOIN quality_ratings qr ON qr.property_master_id = pm.id
    WHERE pm.state = ?
  `, [state]);

  console.log(`  Total Facilities: ${stateOverview.total_facilities}`);
  console.log(`  Total Beds: ${stateOverview.total_beds?.toLocaleString() || 'N/A'}`);
  console.log(`  Average Quality: ${stateOverview.avg_quality ? parseFloat(stateOverview.avg_quality).toFixed(1) + '★' : 'N/A'}`);

  // Recent transactions
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log(`│  RECENT TRANSACTIONS IN ${state}                                                     │`);
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const [recentDeals] = await db.execute(`
    SELECT d.deal_type, d.amount, COALESCE(d.effective_date, d.recorded_date) as deal_date,
           pm.facility_name, pm.city,
           dp_buyer.party_name as buyer,
           dp_seller.party_name as seller
    FROM deals d
    JOIN property_master pm ON pm.id = d.property_master_id
    LEFT JOIN deals_parties dp_buyer ON dp_buyer.deal_id = d.id AND dp_buyer.party_role = 'buyer'
    LEFT JOIN deals_parties dp_seller ON dp_seller.deal_id = d.id AND dp_seller.party_role = 'seller'
    WHERE pm.state = ?
      AND d.amount > 1000000
    ORDER BY deal_date DESC
    LIMIT 20
  `, [state]);

  recentDeals.forEach(deal => {
    const dateStr = deal.deal_date ? new Date(deal.deal_date).toLocaleDateString() : 'N/A';
    const amount = deal.amount ? `$${(parseFloat(deal.amount)/1e6).toFixed(1)}M` : '';
    console.log(`  ${dateStr} - ${deal.deal_type.toUpperCase()} ${amount}`);
    console.log(`    ${deal.facility_name}, ${deal.city}`);
    if (deal.buyer) console.log(`    Buyer: ${deal.buyer}`);
    if (deal.seller) console.log(`    Seller: ${deal.seller}`);
    console.log('');
  });

  // Major owners in state
  console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log(`│  MAJOR OWNERS IN ${state}                                                            │`);
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const [majorOwners] = await db.execute(`
    SELECT c.company_name, c.company_type, COUNT(DISTINCT per.property_master_id) as props
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'property_owner'
    JOIN property_master pm ON pm.id = per.property_master_id
    WHERE pm.state = ?
    GROUP BY c.id
    ORDER BY props DESC
    LIMIT 15
  `, [state]);

  majorOwners.forEach(own => {
    console.log(`  ${own.company_name} (${own.company_type}): ${own.props} properties`);
  });

  // Major operators in state
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log(`│  MAJOR OPERATORS IN ${state}                                                         │`);
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const [majorOps] = await db.execute(`
    SELECT c.company_name, c.company_type, COUNT(DISTINCT per.property_master_id) as props,
           AVG(qr.overall_rating) as avg_quality
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.relationship_type = 'facility_operator'
    JOIN property_master pm ON pm.id = per.property_master_id
    LEFT JOIN quality_ratings qr ON qr.property_master_id = pm.id
    WHERE pm.state = ?
    GROUP BY c.id
    ORDER BY props DESC
    LIMIT 15
  `, [state]);

  majorOps.forEach(op => {
    const quality = op.avg_quality ? `${op.avg_quality.toFixed(1)}★` : 'N/A';
    console.log(`  ${op.company_name}: ${op.props} properties (avg quality: ${quality})`);
  });
}

analyze().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
