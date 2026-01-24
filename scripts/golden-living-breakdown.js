/**
 * Golden Living Full Breakdown by State
 * Combines: Properties, Cost Reports, Medicaid Rates, Quality, Deals, Lenders
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function breakdown() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    GOLDEN LIVING - FULL PORTFOLIO BREAKDOWN                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get Golden Living company
  const [[company]] = await db.execute(`
    SELECT id, company_name, company_type
    FROM companies
    WHERE company_name LIKE '%GOLDEN LIVING%'
      AND company_name NOT LIKE '[MERGED]%'
    LIMIT 1
  `);

  if (!company) {
    console.log('Golden Living not found');
    await db.end();
    return;
  }

  console.log(`Company: ${company.company_name} (${company.company_type})\n`);

  // Get all properties by state
  const [properties] = await db.execute(`
    SELECT pm.id, pm.ccn, pm.facility_name, pm.address, pm.city, pm.state, pm.zip,
           per.relationship_type
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    JOIN entities e ON e.id = per.entity_id
    WHERE e.company_id = ?
    ORDER BY pm.state, pm.city
  `, [company.id]);

  // Group by state
  const byState = {};
  for (const prop of properties) {
    if (!byState[prop.state]) {
      byState[prop.state] = { properties: [], roles: new Set() };
    }
    byState[prop.state].properties.push(prop);
    byState[prop.state].roles.add(prop.relationship_type);
  }

  const states = Object.keys(byState).sort();
  console.log(`Total States: ${states.length}`);
  console.log(`Total Properties: ${properties.length}\n`);

  // Summary by state
  console.log('┌──────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                              STATE SUMMARY                                       │');
  console.log('└──────────────────────────────────────────────────────────────────────────────────┘\n');

  console.log('State | Props | Roles');
  console.log('------|-------|------');
  for (const state of states) {
    const data = byState[state];
    console.log(`  ${state}  |  ${data.properties.length.toString().padStart(3)}  | ${[...data.roles].join(', ')}`);
  }

  // Detailed breakdown by state
  for (const state of states) {
    const stateProps = byState[state].properties;
    const propIds = stateProps.map(p => p.id);

    console.log('\n╔══════════════════════════════════════════════════════════════════════════════════╗');
    console.log(`║  ${state} - ${stateProps.length} PROPERTIES`.padEnd(84) + '║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

    // Get cost reports for these properties
    const [costReports] = await db.execute(`
      SELECT property_master_id, fiscal_year, total_beds, total_patient_revenue,
             total_operating_expenses, net_income, operating_margin, occupancy_rate
      FROM cost_reports
      WHERE property_master_id IN (${propIds.join(',')})
        AND fiscal_year = (SELECT MAX(fiscal_year) FROM cost_reports WHERE property_master_id IN (${propIds.join(',')}))
    `);

    const costMap = new Map();
    for (const cr of costReports) {
      costMap.set(cr.property_master_id, cr);
    }

    // Get Medicaid rates
    const [medicaidRates] = await db.execute(`
      SELECT property_master_id, daily_rate, effective_date
      FROM medicaid_rates
      WHERE property_master_id IN (${propIds.join(',')})
      ORDER BY effective_date DESC
    `);

    const rateMap = new Map();
    for (const rate of medicaidRates) {
      if (!rateMap.has(rate.property_master_id)) {
        rateMap.set(rate.property_master_id, rate);
      }
    }

    // Get quality ratings
    const [qualityRatings] = await db.execute(`
      SELECT property_master_id, overall_rating, health_inspection_rating,
             staffing_rating, quality_measure_rating
      FROM quality_ratings
      WHERE property_master_id IN (${propIds.join(',')})
      ORDER BY rating_date DESC
    `);

    const qualityMap = new Map();
    for (const qr of qualityRatings) {
      if (!qualityMap.has(qr.property_master_id)) {
        qualityMap.set(qr.property_master_id, qr);
      }
    }

    // Get lenders for these properties
    const [lenders] = await db.execute(`
      SELECT per.property_master_id, c.company_name as lender
      FROM property_entity_relationships per
      JOIN entities e ON e.id = per.entity_id
      JOIN companies c ON c.id = e.company_id
      WHERE per.property_master_id IN (${propIds.join(',')})
        AND per.relationship_type = 'lender'
        AND c.company_name NOT LIKE '[MERGED]%'
    `);

    const lenderMap = new Map();
    for (const l of lenders) {
      if (!lenderMap.has(l.property_master_id)) {
        lenderMap.set(l.property_master_id, []);
      }
      lenderMap.get(l.property_master_id).push(l.lender);
    }

    // Get deals
    const [deals] = await db.execute(`
      SELECT property_master_id, deal_type, COUNT(*) as cnt, SUM(amount) as total
      FROM deals
      WHERE property_master_id IN (${propIds.join(',')})
      GROUP BY property_master_id, deal_type
    `);

    const dealMap = new Map();
    for (const d of deals) {
      if (!dealMap.has(d.property_master_id)) {
        dealMap.set(d.property_master_id, {});
      }
      dealMap.get(d.property_master_id)[d.deal_type] = { count: d.cnt, total: d.total };
    }

    // Print each property
    for (const prop of stateProps) {
      console.log(`┌─ ${prop.facility_name} ─────────────────────────────────────────────────`);
      console.log(`│  CCN: ${prop.ccn} | ${prop.address}, ${prop.city}`);
      console.log(`│  Role: ${prop.relationship_type}`);

      // Cost Report
      const cr = costMap.get(prop.id);
      if (cr) {
        const revenue = cr.total_patient_revenue ? `$${(parseFloat(cr.total_patient_revenue)/1e6).toFixed(1)}M` : 'N/A';
        const margin = cr.operating_margin ? `${(parseFloat(cr.operating_margin)*100).toFixed(1)}%` : 'N/A';
        console.log(`│  Cost Report (${cr.fiscal_year}): ${cr.total_beds} beds, Revenue: ${revenue}, Margin: ${margin}`);
      }

      // Medicaid Rate
      const rate = rateMap.get(prop.id);
      if (rate) {
        console.log(`│  Medicaid Rate: $${parseFloat(rate.daily_rate).toFixed(2)}/day (${new Date(rate.effective_date).toLocaleDateString()})`);
      }

      // Quality
      const qual = qualityMap.get(prop.id);
      if (qual) {
        const stars = (n) => n ? '★'.repeat(n) + '☆'.repeat(5-n) : 'N/A';
        console.log(`│  Quality: Overall ${stars(qual.overall_rating)} | Health ${stars(qual.health_inspection_rating)} | Staff ${stars(qual.staffing_rating)}`);
      }

      // Lenders
      const propLenders = lenderMap.get(prop.id);
      if (propLenders && propLenders.length > 0) {
        console.log(`│  Lenders: ${propLenders.slice(0, 3).join(', ')}${propLenders.length > 3 ? ` (+${propLenders.length - 3} more)` : ''}`);
      }

      // Deals
      const propDeals = dealMap.get(prop.id);
      if (propDeals) {
        const dealSummary = Object.entries(propDeals).map(([type, data]) => {
          const amt = data.total ? `$${(parseFloat(data.total)/1e6).toFixed(1)}M` : '';
          return `${type}: ${data.count} ${amt}`;
        }).join(' | ');
        console.log(`│  Deals: ${dealSummary}`);
      }

      console.log('└──────────────────────────────────────────────────────────────────────────────────\n');
    }

    // State aggregates
    const stateRevenue = [...costMap.values()]
      .filter(cr => propIds.includes(cr.property_master_id))
      .reduce((sum, cr) => sum + (parseFloat(cr.total_patient_revenue) || 0), 0);

    const stateBeds = [...costMap.values()]
      .filter(cr => propIds.includes(cr.property_master_id))
      .reduce((sum, cr) => sum + (cr.total_beds || 0), 0);

    const stateRates = [...rateMap.values()]
      .filter(r => propIds.includes(r.property_master_id))
      .map(r => parseFloat(r.daily_rate));
    const avgRate = stateRates.length > 0 ? stateRates.reduce((a,b) => a+b, 0) / stateRates.length : 0;

    console.log(`  ${state} TOTALS:`);
    console.log(`    Properties: ${stateProps.length}`);
    console.log(`    Total Beds: ${stateBeds.toLocaleString()}`);
    console.log(`    Total Revenue: $${(stateRevenue/1e6).toFixed(1)}M`);
    console.log(`    Avg Medicaid Rate: $${avgRate.toFixed(2)}/day`);
  }

  // Overall summary
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              PORTFOLIO SUMMARY                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  // Top lenders across portfolio
  const [topLenders] = await db.execute(`
    SELECT c.company_name, COUNT(DISTINCT per.property_master_id) as props
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN entities e_gl ON e_gl.company_id = ?
    JOIN property_entity_relationships per_gl ON per_gl.entity_id = e_gl.id
      AND per_gl.property_master_id = per.property_master_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.relationship_type = 'lender'
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY c.company_name
    ORDER BY props DESC
    LIMIT 10
  `, [company.id]);

  console.log('Top Lenders to Golden Living Properties:');
  topLenders.forEach((l, i) => {
    console.log(`  ${i+1}. ${l.company_name}: ${l.props} properties`);
  });

  await db.end();
}

breakdown().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
