#!/usr/bin/env node
/**
 * E2E Example: Autumn Lake Healthcare at Bridgepark
 * Property with CHOW, Sale, Mortgage, and CMS Principals
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

  const ccn = '215195';

  // Get property info
  const [props] = await conn.execute(`
    SELECT id, ccn, facility_name, city, state, address, zip
    FROM property_master WHERE ccn = ?
  `, [ccn]);

  const prop = props[0];
  console.log('======================================================================');
  console.log('PROPERTY PROFILE: ' + prop.facility_name);
  console.log('======================================================================');
  console.log('CCN:', prop.ccn);
  console.log('Location:', prop.city + ', ' + prop.state);
  console.log('Address:', prop.address || 'N/A');
  console.log('Property Master ID:', prop.id);

  // Get all deals
  const [deals] = await conn.execute(`
    SELECT
      d.id, d.deal_type, d.effective_date, d.recorded_date, d.amount, d.document_id, d.data_source
    FROM deals d
    WHERE d.property_master_id = ?
    ORDER BY COALESCE(d.effective_date, d.recorded_date) DESC
  `, [prop.id]);

  console.log('\n--- Transaction History (' + deals.length + ' deals) ---');

  for (const deal of deals) {
    const date = deal.effective_date || deal.recorded_date || 'Unknown date';
    const dateStr = date instanceof Date ? date.toISOString().slice(0, 10) : date;

    console.log('\n[' + deal.deal_type.toUpperCase() + '] ' + dateStr);
    if (deal.amount) {
      console.log('  Amount: $' + Number(deal.amount).toLocaleString());
    }
    console.log('  Document ID:', deal.document_id || 'N/A');
    console.log('  Source:', deal.data_source);

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
        console.log('    - ' + p.party_role + ': ' + name);
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
        if (m.loan_type) console.log('    - Type:', m.loan_type);
        if (m.term_months) console.log('    - Term:', m.term_months, 'months');
        if (m.interest_rate) console.log('    - Rate:', m.interest_rate + '%');
        if (m.maturity_date) {
          const maturity = m.maturity_date instanceof Date ?
            m.maturity_date.toISOString().slice(0, 10) : m.maturity_date;
          console.log('    - Maturity:', maturity);
        }
      }
    }
  }

  // Get CMS Principals
  console.log('\n--- CMS Ownership Structure ---');

  const [principals] = await conn.execute(`
    SELECT DISTINCT
      o.type_owner,
      o.role_text_owner,
      COALESCE(CONCAT(o.first_name_owner, ' ', o.last_name_owner), o.organization_name_owner) as owner_name,
      o.first_name_owner,
      o.last_name_owner,
      o.organization_name_owner,
      o.percentage_ownership,
      o.association_date_owner,
      o.city_owner,
      o.state_owner,
      o.corporation_owner,
      o.llc_owner,
      o.private_equity_company_owner,
      o.holding_company_owner,
      o.reit_owner,
      o.title_owner
    FROM cms_enrollments_staging e
    JOIN cms_owners_staging o ON o.associate_id = e.associate_id
    WHERE e.ccn = ?
    ORDER BY o.type_owner, o.role_text_owner, owner_name
  `, [ccn]);

  if (principals.length > 0) {
    // Group by type
    const byType = {};
    principals.forEach(p => {
      const type = p.type_owner === 'I' ? 'Individual' : 'Organization';
      if (!byType[type]) byType[type] = [];
      byType[type].push(p);
    });

    for (const [type, owners] of Object.entries(byType)) {
      console.log('\n' + type + 's:');
      owners.forEach(o => {
        let entityType = '';
        if (o.llc_owner === 'Y') entityType = ' (LLC)';
        else if (o.corporation_owner === 'Y') entityType = ' (Corp)';
        else if (o.private_equity_company_owner === 'Y') entityType = ' (PE)';
        else if (o.holding_company_owner === 'Y') entityType = ' (Holding Co)';
        else if (o.reit_owner === 'Y') entityType = ' (REIT)';

        const displayName = o.type_owner === 'I'
          ? (o.first_name_owner + ' ' + o.last_name_owner).trim()
          : o.organization_name_owner;

        console.log('  - ' + displayName + entityType);
        if (o.title_owner) console.log('      Title: ' + o.title_owner);
        console.log('      Role: ' + (o.role_text_owner || 'N/A'));
        if (o.percentage_ownership && o.percentage_ownership !== '0') {
          console.log('      Ownership: ' + o.percentage_ownership + '%');
        }
        if (o.city_owner && o.state_owner) {
          console.log('      Location: ' + o.city_owner + ', ' + o.state_owner);
        }
        if (o.association_date_owner) {
          console.log('      Association Date: ' + o.association_date_owner);
        }
      });
    }
  } else {
    console.log('No CMS principal data available');
  }

  // Summary
  console.log('\n======================================================================');
  console.log('SUMMARY');
  console.log('======================================================================');

  const totalMortgageAmount = deals
    .filter(d => d.deal_type === 'mortgage')
    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  const totalSaleAmount = deals
    .filter(d => d.deal_type === 'sale')
    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  console.log('Total CHOWs:', deals.filter(d => d.deal_type === 'chow').length);
  console.log('Total Sales:', deals.filter(d => d.deal_type === 'sale').length, '($' + totalSaleAmount.toLocaleString() + ')');
  console.log('Total Mortgages:', deals.filter(d => d.deal_type === 'mortgage').length, '($' + totalMortgageAmount.toLocaleString() + ')');
  console.log('Total Principals:', principals.length);

  await conn.end();
}

main().catch(console.error);
