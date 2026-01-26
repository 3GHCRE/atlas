/**
 * Ensign Group Acquisition & Financing Analysis
 * Gathers transaction, CHOW, and real estate data for intelligence brief
 */

const { getAtlasConnection, getReapiConnection } = require('./lib/db-config');

// Ensign mailing addresses
const ENSIGN_ADDRESSES = [
  'Po Box 128109',
  '29222 Rancho Viejo Rd',
  '27101 Puerta Real'
];

async function main() {
  const reapi = await getReapiConnection();
  const atlas = await getAtlasConnection();

  console.log('=== ENSIGN GROUP ACQUISITION & FINANCING ANALYSIS ===\n');

  // 1. Sales History from REAPI
  console.log('--- 1. REAPI SALES HISTORY ---\n');
  await getSalesHistory(reapi);

  // 2. Property Values & Equity
  console.log('\n--- 2. PROPERTY VALUES & EQUITY ---\n');
  await getPropertyValues(reapi);

  // 3. CHOW Data from Atlas
  console.log('\n--- 3. CHANGE OF OWNERSHIP (CHOW) DATA ---\n');
  await getChowData(atlas);

  // 4. Recent Acquisitions (last 3 years)
  console.log('\n--- 4. RECENT ACQUISITIONS (2022-2025) ---\n');
  await getRecentAcquisitions(reapi);

  // 5. Portfolio by Acquisition Year
  console.log('\n--- 5. PORTFOLIO BY ACQUISITION YEAR ---\n');
  await getAcquisitionTimeline(reapi);

  // 6. Linked Properties Summary (Portfolio Size)
  console.log('\n--- 6. LINKED PROPERTIES / PORTFOLIO METRICS ---\n');
  await getPortfolioMetrics(reapi);

  // 7. Tax Assessment Data
  console.log('\n--- 7. TAX ASSESSMENT VALUES ---\n');
  await getTaxData(reapi);

  // 8. Geographic Acquisition Patterns
  console.log('\n--- 8. GEOGRAPHIC ACQUISITION PATTERNS ---\n');
  await getGeographicPatterns(reapi);

  // 9. Seller Analysis
  console.log('\n--- 9. TOP SELLERS TO ENSIGN ---\n');
  await getSellerAnalysis(reapi);

  // 10. Deal Structure Analysis
  console.log('\n--- 10. DEAL STRUCTURE ANALYSIS ---\n');
  await getDealStructures(reapi);

  await reapi.end();
  await atlas.end();
}

async function getSalesHistory(conn) {
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      rsh.sale_date,
      rsh.sale_amount,
      rsh.buyer_names,
      rsh.seller_names,
      rsh.transaction_type,
      rsh.document_type,
      rsh.purchase_method,
      rpa.state,
      rpa.city,
      rp.ccn
    FROM reapi_sales_history rsh
    JOIN reapi_properties rp ON rp.property_id = rsh.property_id
    JOIN reapi_owner_info roi ON roi.property_id = rsh.property_id
    JOIN reapi_property_addresses rpa ON rpa.property_id = rsh.property_id
    WHERE (${addressConditions})
      AND rsh.sale_amount > 0
    ORDER BY rsh.sale_date DESC
    LIMIT 30
  `);

  console.log(`Found ${rows.length} sales transactions with price > $0\n`);
  console.log('Recent Sales:');
  rows.slice(0, 15).forEach(r => {
    const date = r.sale_date ? new Date(r.sale_date).toISOString().split('T')[0] : 'Unknown';
    console.log(`  ${date} | $${(r.sale_amount/1000000).toFixed(1)}M | ${r.state} | ${r.buyer_names?.substring(0,40) || 'N/A'}`);
  });

  // Summary stats
  const totalValue = rows.reduce((sum, r) => sum + Number(r.sale_amount || 0), 0);
  console.log(`\nTotal Transaction Value: $${(totalValue/1000000).toFixed(1)}M across ${rows.length} transactions`);
}

async function getPropertyValues(conn) {
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      rpa.state,
      COUNT(*) as properties,
      SUM(rp.estimated_value) as total_value,
      AVG(rp.estimated_value) as avg_value,
      SUM(rp.equity) as total_equity,
      AVG(rp.equity_percent) as avg_equity_pct,
      SUM(rp.estimated_mortgage_balance) as total_mortgage
    FROM reapi_properties rp
    JOIN reapi_owner_info roi ON roi.property_id = rp.property_id
    JOIN reapi_property_addresses rpa ON rpa.property_id = rp.property_id
    WHERE (${addressConditions})
    GROUP BY rpa.state
    ORDER BY SUM(rp.estimated_value) DESC
  `);

  console.log('Portfolio Value by State:');
  console.log('State | Props | Est Value    | Avg Value   | Equity      | Equity % | Mortgage');
  console.log('-'.repeat(90));
  rows.forEach(r => {
    const equityPct = r.avg_equity_pct ? Number(r.avg_equity_pct).toFixed(0) : '0';
    console.log(`${r.state.padEnd(5)} | ${String(r.properties).padStart(5)} | $${((r.total_value||0)/1000000).toFixed(1).padStart(8)}M | $${((r.avg_value||0)/1000000).toFixed(2).padStart(6)}M | $${((r.total_equity||0)/1000000).toFixed(1).padStart(8)}M | ${equityPct.padStart(5)}% | $${((r.total_mortgage||0)/1000000).toFixed(1)}M`);
  });

  // Totals
  const totals = rows.reduce((acc, r) => ({
    props: acc.props + r.properties,
    value: acc.value + Number(r.total_value || 0),
    equity: acc.equity + Number(r.total_equity || 0),
    mortgage: acc.mortgage + Number(r.total_mortgage || 0)
  }), { props: 0, value: 0, equity: 0, mortgage: 0 });

  console.log('-'.repeat(90));
  console.log(`TOTAL | ${String(totals.props).padStart(5)} | $${(totals.value/1000000).toFixed(1).padStart(8)}M |            | $${(totals.equity/1000000).toFixed(1).padStart(8)}M |       | $${(totals.mortgage/1000000).toFixed(1)}M`);
}

async function getChowData(conn) {
  const [rows] = await conn.execute(`
    SELECT
      d.effective_date,
      d.deal_type,
      pm.ccn,
      pm.facility_name,
      pm.state,
      d.from_entity_name,
      d.to_entity_name
    FROM deals d
    JOIN property_master pm ON pm.id = d.property_master_id
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE c.company_name LIKE '%ENSIGN%'
      AND d.deal_type = 'chow'
    ORDER BY d.effective_date DESC
    LIMIT 25
  `);

  console.log(`Found ${rows.length} CHOW transactions for Ensign\n`);
  console.log('Recent CHOWs:');
  rows.slice(0, 15).forEach(r => {
    const date = r.effective_date ? new Date(r.effective_date).toISOString().split('T')[0] : 'Unknown';
    console.log(`  ${date} | ${r.state} | ${r.facility_name?.substring(0,35) || 'N/A'}`);
    console.log(`           From: ${r.from_entity_name?.substring(0,50) || 'N/A'}`);
    console.log(`           To:   ${r.to_entity_name?.substring(0,50) || 'N/A'}`);
  });
}

async function getRecentAcquisitions(conn) {
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      rsh.sale_date,
      rsh.sale_amount,
      rsh.buyer_names,
      rsh.seller_names,
      rsh.purchase_method,
      rpa.state,
      rpa.city,
      rpa.label as address,
      rp.ccn,
      rpf.bedrooms as beds
    FROM reapi_sales_history rsh
    JOIN reapi_properties rp ON rp.property_id = rsh.property_id
    JOIN reapi_owner_info roi ON roi.property_id = rsh.property_id
    JOIN reapi_property_addresses rpa ON rpa.property_id = rsh.property_id
    LEFT JOIN reapi_property_features rpf ON rpf.property_id = rsh.property_id
    WHERE (${addressConditions})
      AND rsh.sale_date >= '2022-01-01'
      AND rsh.sale_amount > 0
    ORDER BY rsh.sale_date DESC
  `);

  console.log(`Acquisitions since 2022: ${rows.length}\n`);

  // Group by year
  const byYear = {};
  rows.forEach(r => {
    const year = new Date(r.sale_date).getFullYear();
    if (!byYear[year]) byYear[year] = { count: 0, value: 0, properties: [] };
    byYear[year].count++;
    byYear[year].value += Number(r.sale_amount || 0);
    byYear[year].properties.push(r);
  });

  console.log('By Year:');
  Object.entries(byYear).sort((a,b) => b[0] - a[0]).forEach(([year, data]) => {
    console.log(`  ${year}: ${data.count} acquisitions, $${(data.value/1000000).toFixed(1)}M total`);
  });

  console.log('\nRecent Deals (2024-2025):');
  rows.filter(r => new Date(r.sale_date) >= new Date('2024-01-01')).slice(0, 10).forEach(r => {
    const date = new Date(r.sale_date).toISOString().split('T')[0];
    console.log(`  ${date} | $${(r.sale_amount/1000000).toFixed(1)}M | ${r.city}, ${r.state}`);
    console.log(`           Seller: ${r.seller_names?.substring(0,50) || 'N/A'}`);
  });
}

async function getAcquisitionTimeline(conn) {
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      roi.ownership_length,
      COUNT(*) as properties,
      rpa.state
    FROM reapi_owner_info roi
    JOIN reapi_property_addresses rpa ON rpa.property_id = roi.property_id
    WHERE (${addressConditions})
    GROUP BY
      CASE
        WHEN roi.ownership_length <= 12 THEN '0-1 years'
        WHEN roi.ownership_length <= 36 THEN '1-3 years'
        WHEN roi.ownership_length <= 60 THEN '3-5 years'
        WHEN roi.ownership_length <= 120 THEN '5-10 years'
        ELSE '10+ years'
      END,
      rpa.state
    ORDER BY roi.ownership_length
  `);

  // Aggregate by ownership period
  const byPeriod = {};
  rows.forEach(r => {
    const months = r.ownership_length;
    let period;
    if (months <= 12) period = '0-1 years';
    else if (months <= 36) period = '1-3 years';
    else if (months <= 60) period = '3-5 years';
    else if (months <= 120) period = '5-10 years';
    else period = '10+ years';

    if (!byPeriod[period]) byPeriod[period] = 0;
    byPeriod[period] += r.properties;
  });

  console.log('Portfolio by Ownership Length:');
  Object.entries(byPeriod).forEach(([period, count]) => {
    console.log(`  ${period.padEnd(12)}: ${count} properties`);
  });
}

async function getPortfolioMetrics(conn) {
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      rlps.total_owned,
      rlps.purchased_last_6mos,
      rlps.purchased_last_12mos,
      rlps.total_value,
      rlps.total_equity,
      rlps.total_mortgage_balance
    FROM reapi_linked_properties_summary rlps
    JOIN reapi_owner_info roi ON roi.property_id = rlps.property_id
    WHERE (${addressConditions})
    LIMIT 10
  `);

  if (rows.length > 0) {
    console.log('Sample Owner Portfolio Metrics:');
    rows.slice(0, 5).forEach((r, i) => {
      console.log(`\nOwner ${i+1}:`);
      console.log(`  Total Properties Owned: ${r.total_owned}`);
      console.log(`  Purchased Last 6 Months: ${r.purchased_last_6mos}`);
      console.log(`  Purchased Last 12 Months: ${r.purchased_last_12mos}`);
      console.log(`  Total Portfolio Value: $${(r.total_value/1000000).toFixed(1)}M`);
      console.log(`  Total Equity: $${(r.total_equity/1000000).toFixed(1)}M`);
      console.log(`  Total Mortgage Balance: $${(r.total_mortgage_balance/1000000).toFixed(1)}M`);
    });
  }
}

async function getTaxData(conn) {
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      rpa.state,
      COUNT(*) as properties,
      SUM(rti.assessed_value) as total_assessed,
      AVG(rti.assessed_value) as avg_assessed,
      SUM(rti.market_value) as total_market,
      SUM(rti.tax_amount) as total_taxes
    FROM reapi_tax_info rti
    JOIN reapi_owner_info roi ON roi.property_id = rti.property_id
    JOIN reapi_property_addresses rpa ON rpa.property_id = rti.property_id
    WHERE (${addressConditions})
    GROUP BY rpa.state
    ORDER BY SUM(rti.market_value) DESC
  `);

  console.log('Tax Assessment by State:');
  console.log('State | Props | Assessed Val  | Market Val    | Annual Taxes');
  console.log('-'.repeat(70));
  rows.forEach(r => {
    console.log(`${r.state.padEnd(5)} | ${String(r.properties).padStart(5)} | $${((r.total_assessed||0)/1000000).toFixed(1).padStart(9)}M | $${((r.total_market||0)/1000000).toFixed(1).padStart(9)}M | $${((r.total_taxes||0)/1000).toFixed(0).padStart(8)}K`);
  });

  const totals = rows.reduce((acc, r) => ({
    assessed: acc.assessed + Number(r.total_assessed || 0),
    market: acc.market + Number(r.total_market || 0),
    taxes: acc.taxes + Number(r.total_taxes || 0)
  }), { assessed: 0, market: 0, taxes: 0 });

  console.log('-'.repeat(70));
  console.log(`TOTAL |       | $${(totals.assessed/1000000).toFixed(1).padStart(9)}M | $${(totals.market/1000000).toFixed(1).padStart(9)}M | $${(totals.taxes/1000).toFixed(0).padStart(8)}K`);
}

async function getGeographicPatterns(conn) {
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      rpa.state,
      rpa.city,
      COUNT(*) as properties,
      AVG(roi.ownership_length) as avg_ownership_months
    FROM reapi_owner_info roi
    JOIN reapi_property_addresses rpa ON rpa.property_id = roi.property_id
    WHERE (${addressConditions})
    GROUP BY rpa.state, rpa.city
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `);

  console.log('Top Markets (2+ properties):');
  rows.forEach(r => {
    const years = (r.avg_ownership_months / 12).toFixed(1);
    console.log(`  ${r.city}, ${r.state}: ${r.properties} properties (avg ${years} yrs owned)`);
  });
}

async function getSellerAnalysis(conn) {
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      rsh.seller_names,
      COUNT(*) as deals,
      SUM(rsh.sale_amount) as total_value,
      MIN(rsh.sale_date) as first_deal,
      MAX(rsh.sale_date) as last_deal
    FROM reapi_sales_history rsh
    JOIN reapi_owner_info roi ON roi.property_id = rsh.property_id
    WHERE (${addressConditions})
      AND rsh.sale_amount > 0
      AND rsh.seller_names IS NOT NULL
      AND rsh.seller_names != ''
    GROUP BY rsh.seller_names
    HAVING COUNT(*) >= 1
    ORDER BY SUM(rsh.sale_amount) DESC
    LIMIT 15
  `);

  console.log('Top Sellers to Ensign:');
  rows.forEach(r => {
    console.log(`  ${r.seller_names?.substring(0,45) || 'Unknown'}`);
    console.log(`    ${r.deals} deal(s), $${(r.total_value/1000000).toFixed(1)}M total`);
  });
}

async function getDealStructures(conn) {
  const addressConditions = ENSIGN_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      rsh.purchase_method,
      rsh.transaction_type,
      COUNT(*) as deals,
      SUM(rsh.sale_amount) as total_value,
      AVG(rsh.sale_amount) as avg_value
    FROM reapi_sales_history rsh
    JOIN reapi_owner_info roi ON roi.property_id = rsh.property_id
    WHERE (${addressConditions})
      AND rsh.sale_amount > 0
    GROUP BY rsh.purchase_method, rsh.transaction_type
    ORDER BY COUNT(*) DESC
  `);

  console.log('Deal Structure Breakdown:');
  rows.forEach(r => {
    console.log(`  ${r.purchase_method || 'Unknown'} / ${r.transaction_type || 'Unknown'}`);
    console.log(`    ${r.deals} deals, $${(r.total_value/1000000).toFixed(1)}M total, $${(r.avg_value/1000000).toFixed(2)}M avg`);
  });
}

main().catch(console.error);
