#!/usr/bin/env node
/**
 * E2E Example: Property with CHOW, Sale, and Mortgage
 * Shows complete transaction history for a property with all deal types
 */

const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'devpass',
    database: 'atlas'
  });

  console.log('=== Finding Properties with CHOW + Sale + Mortgage ===\n');

  // Find properties with all 3 deal types
  const [props] = await conn.execute(`
    SELECT
      pm.id as property_master_id,
      pm.ccn,
      pm.facility_name,
      pm.city,
      pm.state,
      COUNT(DISTINCT CASE WHEN d.deal_type = 'chow' THEN d.id END) as chow_count,
      COUNT(DISTINCT CASE WHEN d.deal_type = 'sale' THEN d.id END) as sale_count,
      COUNT(DISTINCT CASE WHEN d.deal_type = 'mortgage' THEN d.id END) as mortgage_count
    FROM property_master pm
    JOIN deals d ON d.property_master_id = pm.id
    GROUP BY pm.id, pm.ccn, pm.facility_name, pm.city, pm.state
    HAVING chow_count > 0 AND sale_count > 0 AND mortgage_count > 0
    ORDER BY (chow_count + sale_count + mortgage_count) DESC
    LIMIT 5
  `);

  console.log('Top 5 properties with all deal types:');
  props.forEach((p, i) => {
    console.log(`${i + 1}. ${p.facility_name} (${p.city}, ${p.state}) - CCN: ${p.ccn}`);
    console.log(`   CHOWs: ${p.chow_count}, Sales: ${p.sale_count}, Mortgages: ${p.mortgage_count}`);
  });

  if (props.length === 0) {
    console.log('No properties found with all 3 deal types');
    await conn.end();
    return;
  }

  // Get detailed info for the first property
  const prop = props[0];
  console.log('\n' + '='.repeat(70));
  console.log(`PROPERTY PROFILE: ${prop.facility_name}`);
  console.log('='.repeat(70));
  console.log(`CCN: ${prop.ccn}`);
  console.log(`Location: ${prop.city}, ${prop.state}`);
  console.log(`Property Master ID: ${prop.property_master_id}`);

  // Get all deals for this property ordered by date
  const [deals] = await conn.execute(`
    SELECT
      d.id,
      d.deal_type,
      d.effective_date,
      d.recorded_date,
      d.amount,
      d.document_id,
      d.data_source
    FROM deals d
    WHERE d.property_master_id = ?
    ORDER BY COALESCE(d.effective_date, d.recorded_date) DESC
  `, [prop.property_master_id]);

  console.log(`\n--- Transaction History (${deals.length} deals) ---`);

  for (const deal of deals) {
    const date = deal.effective_date || deal.recorded_date || 'Unknown date';
    const dateStr = date instanceof Date ? date.toISOString().slice(0, 10) : date;

    console.log(`\n[${deal.deal_type.toUpperCase()}] ${dateStr}`);
    if (deal.amount) {
      console.log(`  Amount: $${Number(deal.amount).toLocaleString()}`);
    }
    console.log(`  Document ID: ${deal.document_id || 'N/A'}`);
    console.log(`  Source: ${deal.data_source}`);

    // Get parties for this deal
    const [parties] = await conn.execute(`
      SELECT dp.party_role, dp.party_name, e.entity_name
      FROM deals_parties dp
      LEFT JOIN entities e ON dp.entity_id = e.id
      WHERE dp.deal_id = ?
      ORDER BY dp.party_role
    `, [deal.id]);

    if (parties.length > 0) {
      console.log('  Parties:');
      parties.forEach(p => {
        const name = p.entity_name || p.party_name;
        console.log(`    - ${p.party_role}: ${name}`);
      });
    }

    // Get mortgage details if applicable
    if (deal.deal_type === 'mortgage') {
      const [mortgageDetails] = await conn.execute(`
        SELECT loan_type, term_months, interest_rate, maturity_date
        FROM deals_mortgage WHERE deal_id = ?
      `, [deal.id]);

      if (mortgageDetails.length > 0) {
        const m = mortgageDetails[0];
        console.log('  Loan Details:');
        if (m.loan_type) console.log(`    - Type: ${m.loan_type}`);
        if (m.term_months) console.log(`    - Term: ${m.term_months} months`);
        if (m.interest_rate) console.log(`    - Rate: ${m.interest_rate}%`);
        if (m.maturity_date) {
          const maturity = m.maturity_date instanceof Date ?
            m.maturity_date.toISOString().slice(0, 10) : m.maturity_date;
          console.log(`    - Maturity: ${maturity}`);
        }
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const totalMortgageAmount = deals
    .filter(d => d.deal_type === 'mortgage')
    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  const totalSaleAmount = deals
    .filter(d => d.deal_type === 'sale')
    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  console.log(`Total CHOWs: ${deals.filter(d => d.deal_type === 'chow').length}`);
  console.log(`Total Sales: ${deals.filter(d => d.deal_type === 'sale').length} ($${totalSaleAmount.toLocaleString()})`);
  console.log(`Total Mortgages: ${deals.filter(d => d.deal_type === 'mortgage').length} ($${totalMortgageAmount.toLocaleString()})`);

  await conn.end();
}

main().catch(console.error);
