/**
 * REIT Disposition Tracker
 * Tracks what major healthcare REITs are selling and to whom
 *
 * Usage: node reit-disposition-tracker.js [REIT_NAME]
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const reitFilter = process.argv[2];

async function track() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  REIT DISPOSITION TRACKER                                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get major REITs
  const reitQuery = reitFilter
    ? `SELECT id, company_name FROM companies WHERE company_type = 'ownership' AND company_name LIKE ?`
    : `SELECT c.id, c.company_name, COUNT(DISTINCT per.property_master_id) as props
       FROM companies c
       JOIN entities e ON e.company_id = c.id
       JOIN property_entity_relationships per ON per.entity_id = e.id
       WHERE c.company_type = 'ownership'
         AND (c.company_name LIKE '%REIT%'
              OR c.company_name LIKE '%OMEGA%'
              OR c.company_name LIKE '%SABRA%'
              OR c.company_name LIKE '%WELLTOWER%'
              OR c.company_name LIKE '%VENTAS%'
              OR c.company_name LIKE '%CARETRUST%'
              OR c.company_name LIKE '%NATIONAL HEALTH%'
              OR c.company_name LIKE '%LTC PROPERTIES%'
              OR c.company_name LIKE '%MEDICAL PROPERTIES%')
       GROUP BY c.id
       HAVING props >= 10
       ORDER BY props DESC`;

  const [reits] = reitFilter
    ? await db.execute(reitQuery, [`%${reitFilter}%`])
    : await db.execute(reitQuery);

  if (reits.length === 0) {
    console.log('No REITs found matching criteria.');
    await db.end();
    return;
  }

  console.log('Major Healthcare REITs Tracked:\n');
  reits.forEach(r => console.log(`  - ${r.company_name}: ${r.props || 'N/A'} properties`));
  console.log('');

  // For each REIT, find dispositions
  for (const reit of reits) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log(`│  ${reit.company_name.substring(0, 75).padEnd(75)}  │`);
    console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

    // Find sales where this REIT was the seller
    const [dispositions] = await db.execute(`
      SELECT d.id, d.amount, COALESCE(d.effective_date, d.recorded_date) as deal_date,
             pm.facility_name, pm.city, pm.state,
             dp_buyer.party_name as buyer
      FROM deals d
      JOIN deals_parties dp_seller ON dp_seller.deal_id = d.id AND dp_seller.party_role = 'seller'
      JOIN entities e ON LOWER(dp_seller.party_name) LIKE CONCAT('%', LOWER(SUBSTRING_INDEX(e.entity_name, ' ', 3)), '%')
      JOIN companies c ON c.id = e.company_id AND c.id = ?
      JOIN property_master pm ON pm.id = d.property_master_id
      LEFT JOIN deals_parties dp_buyer ON dp_buyer.deal_id = d.id AND dp_buyer.party_role = 'buyer'
      WHERE d.deal_type = 'sale'
        AND d.amount > 1000000
      GROUP BY d.id
      ORDER BY deal_date DESC
      LIMIT 20
    `, [reit.id]);

    // Alternative: search by company name pattern in seller
    const [dispositions2] = await db.execute(`
      SELECT d.id, d.amount, COALESCE(d.effective_date, d.recorded_date) as deal_date,
             pm.facility_name, pm.city, pm.state,
             dp_buyer.party_name as buyer,
             dp_seller.party_name as seller
      FROM deals d
      JOIN deals_parties dp_seller ON dp_seller.deal_id = d.id AND dp_seller.party_role = 'seller'
      JOIN property_master pm ON pm.id = d.property_master_id
      LEFT JOIN deals_parties dp_buyer ON dp_buyer.deal_id = d.id AND dp_buyer.party_role = 'buyer'
      WHERE d.deal_type = 'sale'
        AND d.amount > 1000000
        AND (dp_seller.party_name LIKE ? OR dp_seller.party_name LIKE ?)
      ORDER BY deal_date DESC
      LIMIT 25
    `, [`%${reit.company_name.split(' ')[0]}%`, `%${reit.company_name.replace(/\s+/g, '%')}%`]);

    const allDispositions = [...dispositions, ...dispositions2];
    const uniqueDeals = new Map();
    allDispositions.forEach(d => {
      if (!uniqueDeals.has(d.id)) uniqueDeals.set(d.id, d);
    });

    const deals = Array.from(uniqueDeals.values())
      .sort((a, b) => new Date(b.deal_date) - new Date(a.deal_date));

    if (deals.length > 0) {
      let totalValue = 0;
      const byYear = {};
      const buyers = {};

      console.log('  Recent Dispositions:\n');
      console.log('  Date       | Amount    | Property                           | Buyer');
      console.log('  -----------|-----------|------------------------------------|--------------------------');

      for (const deal of deals.slice(0, 15)) {
        const dateStr = deal.deal_date ? new Date(deal.deal_date).toLocaleDateString().padEnd(10) : 'N/A       ';
        const amount = deal.amount ? `$${(parseFloat(deal.amount)/1e6).toFixed(1)}M`.padEnd(9) : 'N/A      ';
        const facility = deal.facility_name.substring(0, 34).padEnd(34);
        const buyer = (deal.buyer || 'Unknown').substring(0, 24);

        console.log(`  ${dateStr} | ${amount} | ${facility} | ${buyer}`);

        if (deal.amount) totalValue += parseFloat(deal.amount);

        const year = deal.deal_date ? new Date(deal.deal_date).getFullYear() : 'Unknown';
        byYear[year] = (byYear[year] || 0) + 1;

        if (deal.buyer) {
          const buyerKey = deal.buyer.substring(0, 30);
          buyers[buyerKey] = (buyers[buyerKey] || 0) + 1;
        }
      }

      console.log(`\n  Summary:`);
      console.log(`    Total Dispositions Tracked: ${deals.length}`);
      console.log(`    Total Value: $${(totalValue/1e6).toFixed(1)}M`);

      console.log(`\n  By Year:`);
      Object.entries(byYear).sort((a, b) => b[0] - a[0]).forEach(([year, count]) => {
        console.log(`    ${year}: ${count} deals`);
      });

      const topBuyers = Object.entries(buyers).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (topBuyers.length > 0) {
        console.log(`\n  Top Buyers:`);
        topBuyers.forEach(([buyer, count]) => {
          console.log(`    ${buyer}: ${count} properties`);
        });
      }
    } else {
      console.log('  No dispositions found in deal records.');
    }

    console.log('');
  }

  // Overall market summary
  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  MARKET SUMMARY                                                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  const [recentSales] = await db.execute(`
    SELECT YEAR(COALESCE(d.effective_date, d.recorded_date)) as year,
           COUNT(*) as deals,
           SUM(d.amount) as total_value
    FROM deals d
    WHERE d.deal_type = 'sale'
      AND d.amount > 5000000
      AND COALESCE(d.effective_date, d.recorded_date) >= '2020-01-01'
    GROUP BY year
    ORDER BY year DESC
  `);

  console.log('  SNF Sales Activity (>$5M deals):\n');
  console.log('  Year  | Deals | Total Value');
  console.log('  ------|-------|------------');
  recentSales.forEach(r => {
    if (r.year) {
      console.log(`  ${r.year}  |  ${r.deals.toString().padStart(3)}  | $${(r.total_value/1e9).toFixed(2)}B`);
    }
  });

  await db.end();
}

track().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
