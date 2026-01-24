/**
 * Company Portfolio Breakdown by State
 * Usage: node company-portfolio-breakdown.js "COMPANY NAME"
 *
 * Shows: Properties, Operators, Cost Reports, Medicaid Rates, Quality, Deals, Lenders
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const companyName = process.argv[2] || 'GOLDEN LIVING';

async function breakdown() {
  const db = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log(`║  ${companyName.toUpperCase()} - FULL PORTFOLIO BREAKDOWN`.padEnd(84) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  // Find company
  const [companies] = await db.execute(`
    SELECT id, company_name, company_type
    FROM companies
    WHERE company_name LIKE ?
      AND company_name NOT LIKE '[MERGED]%'
    ORDER BY company_name
    LIMIT 5
  `, [`%${companyName}%`]);

  if (companies.length === 0) {
    console.log(`Company "${companyName}" not found`);
    await db.end();
    return;
  }

  if (companies.length > 1) {
    console.log('Multiple matches found:');
    companies.forEach((c, i) => console.log(`  ${i+1}. ${c.company_name} (${c.company_type})`));
    console.log('\nUsing first match.\n');
  }

  const company = companies[0];
  console.log(`Company: ${company.company_name}`);
  console.log(`Type: ${company.company_type}\n`);

  // Get unique properties with all their relationships
  const [properties] = await db.execute(`
    SELECT DISTINCT pm.id, pm.ccn, pm.facility_name, pm.address, pm.city, pm.state, pm.zip,
           GROUP_CONCAT(DISTINCT per.relationship_type) as roles
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    JOIN entities e ON e.id = per.entity_id
    WHERE e.company_id = ?
    GROUP BY pm.id, pm.ccn, pm.facility_name, pm.address, pm.city, pm.state, pm.zip
    ORDER BY pm.state, pm.city
  `, [company.id]);

  if (properties.length === 0) {
    console.log('No properties found for this company.');
    await db.end();
    return;
  }

  // Group by state
  const byState = {};
  for (const prop of properties) {
    if (!byState[prop.state]) {
      byState[prop.state] = [];
    }
    byState[prop.state].push(prop);
  }

  const states = Object.keys(byState).sort();
  const uniqueProps = properties.length;

  console.log(`States: ${states.length}`);
  console.log(`Properties: ${uniqueProps}\n`);

  // State summary
  console.log('┌──────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                              STATE SUMMARY                                       │');
  console.log('├───────┬───────┬────────────────────────────────────────────────────────────────┤');
  console.log('│ State │ Props │ Roles                                                          │');
  console.log('├───────┼───────┼────────────────────────────────────────────────────────────────┤');

  for (const state of states) {
    const stateProps = byState[state];
    const allRoles = new Set();
    stateProps.forEach(p => p.roles.split(',').forEach(r => allRoles.add(r)));
    const rolesStr = [...allRoles].join(', ').substring(0, 60);
    console.log(`│  ${state}   │  ${stateProps.length.toString().padStart(3)}  │ ${rolesStr.padEnd(62)}│`);
  }
  console.log('└───────┴───────┴────────────────────────────────────────────────────────────────┘\n');

  // Preload all data for efficiency
  const propIds = properties.map(p => p.id);

  // Get operators for all properties
  const [operators] = await db.execute(`
    SELECT per.property_master_id, c.company_name as operator
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.property_master_id IN (${propIds.join(',')})
      AND per.relationship_type = 'facility_operator'
      AND c.id != ?
      AND c.company_name NOT LIKE '[MERGED]%'
  `, [company.id]);

  const operatorMap = new Map();
  for (const op of operators) {
    operatorMap.set(op.property_master_id, op.operator);
  }

  // Get cost reports
  const [costReports] = await db.execute(`
    SELECT property_master_id, fiscal_year, total_beds, total_patient_revenue,
           total_operating_expenses, net_income, operating_margin, occupancy_rate,
           medicare_pct, medicaid_pct
    FROM cost_reports
    WHERE property_master_id IN (${propIds.join(',')})
    ORDER BY fiscal_year DESC
  `);

  const costMap = new Map();
  for (const cr of costReports) {
    if (!costMap.has(cr.property_master_id)) {
      costMap.set(cr.property_master_id, cr);
    }
  }

  // Get Medicaid rates
  const [medicaidRates] = await db.execute(`
    SELECT property_master_id, daily_rate, effective_date, rate_type
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
           staffing_rating, quality_measure_rating, rating_date
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

  // Get lenders
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

  // Output by state
  let portfolioTotalBeds = 0;
  let portfolioTotalRevenue = 0;
  let portfolioAvgRating = [];

  for (const state of states) {
    const stateProps = byState[state];

    console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
    console.log(`║  ${state} - ${stateProps.length} PROPERTIES`.padEnd(84) + '║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

    let stateBeds = 0;
    let stateRevenue = 0;
    let stateRates = [];
    let stateRatings = [];

    for (const prop of stateProps) {
      const operator = operatorMap.get(prop.id);
      const cr = costMap.get(prop.id);
      const rate = rateMap.get(prop.id);
      const qual = qualityMap.get(prop.id);
      const propLenders = lenderMap.get(prop.id) || [];
      const propDeals = dealMap.get(prop.id);

      console.log(`┌─ ${prop.facility_name}`);
      console.log(`│  ${prop.address}, ${prop.city} | CCN: ${prop.ccn}`);
      console.log(`│  Roles: ${prop.roles}`);

      if (operator) {
        console.log(`│  Operator: ${operator}`);
      }

      if (cr) {
        const revenue = cr.total_patient_revenue ? parseFloat(cr.total_patient_revenue) : 0;
        const margin = cr.operating_margin ? `${(parseFloat(cr.operating_margin)*100).toFixed(1)}%` : 'N/A';
        const beds = cr.total_beds || 0;
        const payerMix = cr.medicare_pct && cr.medicaid_pct
          ? `Medicare ${(parseFloat(cr.medicare_pct)*100).toFixed(0)}% / Medicaid ${(parseFloat(cr.medicaid_pct)*100).toFixed(0)}%`
          : '';
        console.log(`│  Cost Report (${cr.fiscal_year}): ${beds} beds | $${(revenue/1e6).toFixed(1)}M revenue | ${margin} margin`);
        if (payerMix) console.log(`│  Payer Mix: ${payerMix}`);
        stateBeds += beds;
        stateRevenue += revenue;
      }

      if (rate) {
        console.log(`│  Medicaid Rate: $${parseFloat(rate.daily_rate).toFixed(2)}/day (${new Date(rate.effective_date).toLocaleDateString()})`);
        stateRates.push(parseFloat(rate.daily_rate));
      }

      if (qual) {
        const stars = (n) => n ? '★'.repeat(n) + '☆'.repeat(5-n) : 'N/A';
        console.log(`│  Quality: ${stars(qual.overall_rating)} Overall | ${stars(qual.health_inspection_rating)} Health | ${stars(qual.staffing_rating)} Staff`);
        if (qual.overall_rating) {
          stateRatings.push(qual.overall_rating);
          portfolioAvgRating.push(qual.overall_rating);
        }
      }

      if (propLenders.length > 0) {
        console.log(`│  Lenders: ${propLenders.slice(0, 2).join(', ')}${propLenders.length > 2 ? ` (+${propLenders.length - 2})` : ''}`);
      }

      if (propDeals) {
        const dealStr = Object.entries(propDeals).map(([type, data]) => {
          return data.total ? `${type} $${(parseFloat(data.total)/1e6).toFixed(1)}M` : `${type} ${data.count}`;
        }).join(' | ');
        console.log(`│  Deals: ${dealStr}`);
      }

      console.log('└─────────────────────────────────────────────────────────────────────────────────\n');
    }

    // State summary
    const avgRate = stateRates.length > 0 ? stateRates.reduce((a,b) => a+b, 0) / stateRates.length : 0;
    const avgRating = stateRatings.length > 0 ? stateRatings.reduce((a,b) => a+b, 0) / stateRatings.length : 0;

    console.log(`  ${state} SUMMARY: ${stateProps.length} properties | ${stateBeds.toLocaleString()} beds | $${(stateRevenue/1e6).toFixed(1)}M revenue | $${avgRate.toFixed(2)}/day avg Medicaid | ${avgRating.toFixed(1)}★ avg quality\n`);

    portfolioTotalBeds += stateBeds;
    portfolioTotalRevenue += stateRevenue;
  }

  // Portfolio summary
  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              PORTFOLIO SUMMARY                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  const avgPortfolioRating = portfolioAvgRating.length > 0
    ? portfolioAvgRating.reduce((a,b) => a+b, 0) / portfolioAvgRating.length
    : 0;

  console.log(`  Total Properties: ${uniqueProps}`);
  console.log(`  Total States: ${states.length}`);
  console.log(`  Total Beds: ${portfolioTotalBeds.toLocaleString()}`);
  console.log(`  Total Revenue: $${(portfolioTotalRevenue/1e6).toFixed(1)}M`);
  console.log(`  Average Quality Rating: ${avgPortfolioRating.toFixed(1)}★\n`);

  // Top lenders
  const [topLenders] = await db.execute(`
    SELECT c.company_name, COUNT(DISTINCT per.property_master_id) as props
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN entities e_co ON e_co.company_id = ?
    JOIN property_entity_relationships per_co ON per_co.entity_id = e_co.id
      AND per_co.property_master_id = per.property_master_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.relationship_type = 'lender'
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY c.company_name
    ORDER BY props DESC
    LIMIT 10
  `, [company.id]);

  if (topLenders.length > 0) {
    console.log('Top Lenders:');
    topLenders.forEach((l, i) => {
      console.log(`  ${i+1}. ${l.company_name}: ${l.props} properties`);
    });
  }

  // Top operators (if this is an ownership company)
  if (company.company_type === 'ownership') {
    const [topOperators] = await db.execute(`
      SELECT c.company_name, COUNT(DISTINCT per_op.property_master_id) as props
      FROM property_entity_relationships per_own
      JOIN entities e_own ON e_own.id = per_own.entity_id AND e_own.company_id = ?
      JOIN property_entity_relationships per_op ON per_op.property_master_id = per_own.property_master_id
        AND per_op.relationship_type = 'facility_operator'
      JOIN entities e_op ON e_op.id = per_op.entity_id AND e_op.company_id != ?
      JOIN companies c ON c.id = e_op.company_id
      WHERE per_own.relationship_type = 'property_owner'
        AND c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.company_name
      ORDER BY props DESC
      LIMIT 10
    `, [company.id, company.id]);

    if (topOperators.length > 0) {
      console.log('\nTop Operators (for owned properties):');
      topOperators.forEach((op, i) => {
        console.log(`  ${i+1}. ${op.company_name}: ${op.props} properties`);
      });
    }
  }

  await db.end();
}

breakdown().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
