/**
 * Cascade Capital Group Acquisition & Financing Analysis
 * Gathers transaction, and real estate data for intelligence brief
 */

const { getAtlasConnection, getReapiConnection } = require('./lib/db-config');

// Cascade Capital Group mailing address from owner_mappings.csv
const CASCADE_ADDRESSES = [
  '3450 Oakton St'  // Skokie, IL - 161 properties
];

async function main() {
  const reapi = await getReapiConnection();
  const atlas = await getAtlasConnection();

  console.log('=== CASCADE CAPITAL GROUP ACQUISITION & FINANCING ANALYSIS ===\n');

  // 0. Property Count Verification
  console.log('--- 0. PROPERTY COUNT VERIFICATION ---\n');
  await verifyPropertyCount(reapi);

  // 1. Sales History from REAPI
  console.log('\n--- 1. REAPI SALES HISTORY ---\n');
  await getSalesHistory(reapi);

  // 2. Property Values & Equity
  console.log('\n--- 2. PROPERTY VALUES & EQUITY ---\n');
  await getPropertyValues(reapi);

  // 3. Recent Acquisitions (last 3 years)
  console.log('\n--- 3. RECENT ACQUISITIONS (2022-2025) ---\n');
  await getRecentAcquisitions(reapi);

  // 4. Portfolio by Acquisition Year
  console.log('\n--- 4. PORTFOLIO BY OWNERSHIP LENGTH ---\n');
  await getAcquisitionTimeline(reapi);

  // 5. Tax Assessment Data
  console.log('\n--- 5. TAX ASSESSMENT VALUES ---\n');
  await getTaxData(reapi);

  // 6. Geographic Distribution
  console.log('\n--- 6. GEOGRAPHIC DISTRIBUTION ---\n');
  await getGeographicPatterns(reapi);

  // 7. Seller Analysis
  console.log('\n--- 7. TOP SELLERS TO CASCADE ---\n');
  await getSellerAnalysis(reapi);

  // 8. Deal Structure Analysis
  console.log('\n--- 8. DEAL STRUCTURE ANALYSIS ---\n');
  await getDealStructures(reapi);

  // 9. Entity Names (Propco Pattern)
  console.log('\n--- 9. PROPCO ENTITY NAMES ---\n');
  await getPropcoEntities(reapi);

  // 10. Linked Properties Summary
  console.log('\n--- 10. PORTFOLIO METRICS ---\n');
  await getPortfolioMetrics(reapi);

  // 11. Check Atlas for company info
  console.log('\n--- 11. ATLAS COMPANY DATA ---\n');
  await getAtlasData(atlas);

  await reapi.end();
  await atlas.end();
}

async function verifyPropertyCount(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT COUNT(*) as total FROM reapi_owner_info WHERE (${addressConditions})
  `);
  console.log(`Total properties at Cascade addresses: ${rows[0].total}`);
}

async function getSalesHistory(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

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
    LIMIT 50
  `);

  console.log(`Found ${rows.length} sales transactions with price > $0\n`);
  console.log('Recent Sales:');
  rows.slice(0, 20).forEach(r => {
    const date = r.sale_date ? new Date(r.sale_date).toISOString().split('T')[0] : 'Unknown';
    console.log(`  ${date} | $${(r.sale_amount/1000000).toFixed(1)}M | ${r.state} | ${r.city || 'N/A'}`);
    if (r.buyer_names) console.log(`           Buyer: ${r.buyer_names.substring(0,50)}`);
    if (r.seller_names) console.log(`           Seller: ${r.seller_names.substring(0,50)}`);
  });

  // Summary stats
  const totalValue = rows.reduce((sum, r) => sum + Number(r.sale_amount || 0), 0);
  console.log(`\nTotal Transaction Value: $${(totalValue/1000000).toFixed(1)}M across ${rows.length} transactions`);
}

async function getPropertyValues(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

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

  let totals = { props: 0, value: 0, equity: 0, mortgage: 0 };

  rows.forEach(r => {
    const equityPct = r.avg_equity_pct ? Number(r.avg_equity_pct).toFixed(0) : '0';
    console.log(`${r.state.padEnd(5)} | ${String(r.properties).padStart(5)} | $${((r.total_value||0)/1000000).toFixed(1).padStart(8)}M | $${((r.avg_value||0)/1000000).toFixed(2).padStart(6)}M | $${((r.total_equity||0)/1000000).toFixed(1).padStart(8)}M | ${equityPct.padStart(5)}% | $${((r.total_mortgage||0)/1000000).toFixed(1)}M`);
    totals.props += r.properties;
    totals.value += Number(r.total_value || 0);
    totals.equity += Number(r.total_equity || 0);
    totals.mortgage += Number(r.total_mortgage || 0);
  });

  console.log('-'.repeat(90));
  console.log(`TOTAL | ${String(totals.props).padStart(5)} | $${(totals.value/1000000).toFixed(1).padStart(8)}M |            | $${(totals.equity/1000000).toFixed(1).padStart(8)}M |       | $${(totals.mortgage/1000000).toFixed(1)}M`);
}

async function getRecentAcquisitions(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

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
      rp.ccn
    FROM reapi_sales_history rsh
    JOIN reapi_properties rp ON rp.property_id = rsh.property_id
    JOIN reapi_owner_info roi ON roi.property_id = rsh.property_id
    JOIN reapi_property_addresses rpa ON rpa.property_id = rsh.property_id
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

  console.log('\nRecent Deals (2023-2025):');
  rows.filter(r => new Date(r.sale_date) >= new Date('2023-01-01')).slice(0, 15).forEach(r => {
    const date = new Date(r.sale_date).toISOString().split('T')[0];
    console.log(`  ${date} | $${(r.sale_amount/1000000).toFixed(1)}M | ${r.city}, ${r.state}`);
    if (r.seller_names) console.log(`           Seller: ${r.seller_names.substring(0,50)}`);
  });
}

async function getAcquisitionTimeline(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      CASE
        WHEN roi.ownership_length <= 12 THEN '0-1 years'
        WHEN roi.ownership_length <= 36 THEN '1-3 years'
        WHEN roi.ownership_length <= 60 THEN '3-5 years'
        WHEN roi.ownership_length <= 120 THEN '5-10 years'
        ELSE '10+ years'
      END as period,
      COUNT(*) as properties,
      AVG(roi.ownership_length) as avg_months
    FROM reapi_owner_info roi
    WHERE (${addressConditions})
    GROUP BY
      CASE
        WHEN roi.ownership_length <= 12 THEN '0-1 years'
        WHEN roi.ownership_length <= 36 THEN '1-3 years'
        WHEN roi.ownership_length <= 60 THEN '3-5 years'
        WHEN roi.ownership_length <= 120 THEN '5-10 years'
        ELSE '10+ years'
      END
    ORDER BY AVG(roi.ownership_length)
  `);

  console.log('Portfolio by Ownership Length:');
  rows.forEach(r => {
    const avgYears = (r.avg_months / 12).toFixed(1);
    console.log(`  ${r.period.padEnd(12)}: ${r.properties} properties (avg ${avgYears} yrs)`);
  });
}

async function getTaxData(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

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

  let totals = { assessed: 0, market: 0, taxes: 0 };

  rows.forEach(r => {
    console.log(`${r.state.padEnd(5)} | ${String(r.properties).padStart(5)} | $${((r.total_assessed||0)/1000000).toFixed(1).padStart(9)}M | $${((r.total_market||0)/1000000).toFixed(1).padStart(9)}M | $${((r.total_taxes||0)/1000).toFixed(0).padStart(8)}K`);
    totals.assessed += Number(r.total_assessed || 0);
    totals.market += Number(r.total_market || 0);
    totals.taxes += Number(r.total_taxes || 0);
  });

  console.log('-'.repeat(70));
  console.log(`TOTAL |       | $${(totals.assessed/1000000).toFixed(1).padStart(9)}M | $${(totals.market/1000000).toFixed(1).padStart(9)}M | $${(totals.taxes/1000).toFixed(0).padStart(8)}K`);
}

async function getGeographicPatterns(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      rpa.state,
      rpa.city,
      COUNT(*) as properties,
      AVG(roi.ownership_length) as avg_ownership_months,
      SUM(rp.estimated_value) as total_value
    FROM reapi_owner_info roi
    JOIN reapi_property_addresses rpa ON rpa.property_id = roi.property_id
    JOIN reapi_properties rp ON rp.property_id = roi.property_id
    WHERE (${addressConditions})
    GROUP BY rpa.state, rpa.city
    ORDER BY COUNT(*) DESC
    LIMIT 25
  `);

  console.log('Top Markets:');
  rows.forEach(r => {
    const years = (r.avg_ownership_months / 12).toFixed(1);
    const value = (r.total_value / 1000000).toFixed(1);
    console.log(`  ${r.city}, ${r.state}: ${r.properties} props, $${value}M value, ${years} yrs avg owned`);
  });
}

async function getSellerAnalysis(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

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
    ORDER BY SUM(rsh.sale_amount) DESC
    LIMIT 15
  `);

  console.log('Top Sellers to Cascade:');
  rows.forEach(r => {
    console.log(`  ${r.seller_names?.substring(0,50) || 'Unknown'}`);
    console.log(`    ${r.deals} deal(s), $${(r.total_value/1000000).toFixed(1)}M total`);
  });
}

async function getDealStructures(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

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

async function getPropcoEntities(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

  const [rows] = await conn.execute(`
    SELECT
      roi.owner1_full_name,
      roi.owner1_type,
      COUNT(*) as properties
    FROM reapi_owner_info roi
    WHERE (${addressConditions})
      AND roi.owner1_full_name IS NOT NULL
    GROUP BY roi.owner1_full_name, roi.owner1_type
    ORDER BY COUNT(*) DESC
    LIMIT 30
  `);

  console.log('Top Propco Entities (owner1_full_name):');
  rows.forEach(r => {
    console.log(`  ${r.owner1_full_name} (${r.owner1_type || 'Unknown'}): ${r.properties} properties`);
  });

  // Look for naming patterns
  console.log('\nEntity Naming Patterns:');
  const patterns = {};
  rows.forEach(r => {
    const name = r.owner1_full_name || '';
    if (name.includes('Holdings')) patterns['*Holdings*'] = (patterns['*Holdings*'] || 0) + r.properties;
    if (name.includes('Llc')) patterns['*LLC'] = (patterns['*LLC'] || 0) + r.properties;
    if (name.includes('Property')) patterns['*Property*'] = (patterns['*Property*'] || 0) + r.properties;
    if (name.includes('Health')) patterns['*Health*'] = (patterns['*Health*'] || 0) + r.properties;
  });
  Object.entries(patterns).forEach(([pattern, count]) => {
    console.log(`  ${pattern}: ${count} properties`);
  });
}

async function getPortfolioMetrics(conn) {
  const addressConditions = CASCADE_ADDRESSES.map(addr => `roi.mail_address LIKE '%${addr}%'`).join(' OR ');

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

async function getAtlasData(conn) {
  // Check if Cascade Capital Group exists in Atlas
  const [companies] = await conn.execute(`
    SELECT * FROM companies WHERE company_name LIKE '%Cascade%' OR company_name LIKE '%Legacy%'
  `);

  if (companies.length > 0) {
    console.log('Found in Atlas companies table:');
    companies.forEach(c => {
      console.log(`  ID: ${c.id}, Name: ${c.company_name}, Type: ${c.company_type}`);
    });
  } else {
    console.log('Cascade Capital Group not found in Atlas companies table');
  }

  // Check for related entities
  const [entities] = await conn.execute(`
    SELECT e.*, c.company_name
    FROM entities e
    JOIN companies c ON c.id = e.company_id
    WHERE e.entity_name LIKE '%Property Holdings%'
       OR e.entity_name LIKE '%Cascade%'
    LIMIT 10
  `);

  if (entities.length > 0) {
    console.log('\nRelated entities found:');
    entities.forEach(e => {
      console.log(`  ${e.entity_name} -> ${e.company_name}`);
    });
  }
}

main().catch(console.error);
