#!/usr/bin/env node
/**
 * Check Atlas Deals & Parties Status
 * Reports on current deal types, party roles, and top participants
 */

const { Client } = require('pg');

async function checkDealsStatus() {
  const client = new Client({
    host: process.env.SUPABASE_DB_HOST || 'localhost',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres'
  });

  await client.connect();

  console.log('=== Atlas Deals & Parties Status ===');
  console.log('Generated:', new Date().toISOString());
  console.log('');

  // Deal types
  const dealTypes = await client.query(`
    SELECT deal_type, COUNT(*) as count,
           MIN(deal_date) as earliest, MAX(deal_date) as latest
    FROM deals
    GROUP BY deal_type
    ORDER BY count DESC
  `);
  console.log('Deal Types:');
  dealTypes.rows.forEach(r => {
    const earliest = r.earliest ? r.earliest.toISOString().slice(0,10) : 'N/A';
    const latest = r.latest ? r.latest.toISOString().slice(0,10) : 'N/A';
    console.log(`  ${r.deal_type}: ${Number(r.count).toLocaleString()} deals (${earliest} to ${latest})`);
  });

  // Party roles
  const partyRoles = await client.query(`
    SELECT party_role, COUNT(*) as count,
           COUNT(DISTINCT entity_id) as unique_entities
    FROM deals_parties
    GROUP BY party_role
    ORDER BY count DESC
  `);
  console.log('\nParty Roles:');
  partyRoles.rows.forEach(r => {
    console.log(`  ${r.party_role}: ${Number(r.count).toLocaleString()} records (${Number(r.unique_entities).toLocaleString()} unique entities)`);
  });

  // Data sources
  const sources = await client.query(`
    SELECT data_source, COUNT(*) as count
    FROM deals
    GROUP BY data_source
    ORDER BY count DESC
  `);
  console.log('\nData Sources:');
  sources.rows.forEach(r => {
    console.log(`  ${r.data_source}: ${Number(r.count).toLocaleString()} deals`);
  });

  // Top buyers
  const topBuyers = await client.query(`
    SELECT e.name, COUNT(*) as deal_count
    FROM deals_parties dp
    JOIN entities e ON dp.entity_id = e.id
    WHERE dp.party_role = 'buyer'
    GROUP BY e.name
    ORDER BY deal_count DESC
    LIMIT 5
  `);
  console.log('\nTop 5 Buyers:');
  topBuyers.rows.forEach((r, i) => {
    console.log(`  ${i+1}. ${r.name}: ${r.deal_count} acquisitions`);
  });

  // Top sellers
  const topSellers = await client.query(`
    SELECT e.name, COUNT(*) as deal_count
    FROM deals_parties dp
    JOIN entities e ON dp.entity_id = e.id
    WHERE dp.party_role = 'seller'
    GROUP BY e.name
    ORDER BY deal_count DESC
    LIMIT 5
  `);
  console.log('\nTop 5 Sellers:');
  topSellers.rows.forEach((r, i) => {
    console.log(`  ${i+1}. ${r.name}: ${r.deal_count} sales`);
  });

  // Mortgage readiness
  console.log('\n=== Mortgage Data Readiness ===');

  const mortgageTable = await client.query(`
    SELECT COUNT(*) as count FROM reapi_mortgages
  `);
  console.log(`reapi_mortgages rows: ${mortgageTable.rows[0].count}`);

  const mortgageBalances = await client.query(`
    SELECT COUNT(*) as props_with_mortgage,
           SUM(estimated_mortgage_balance) as total_balance
    FROM reapi_properties
    WHERE estimated_mortgage_balance > 0
  `);
  const balance = Number(mortgageBalances.rows[0].total_balance) / 1e9;
  console.log(`Properties with mortgage balance: ${Number(mortgageBalances.rows[0].props_with_mortgage).toLocaleString()}`);
  console.log(`Total estimated mortgage balance: $${balance.toFixed(2)}B`);

  if (mortgageTable.rows[0].count === '0') {
    console.log('\n⚠️  Mortgage transaction data not yet loaded.');
    console.log('   Run: node scripts/load-reapi-mortgages.js');
    console.log('   When reapi_mortgages has data from REAPI source.');
  }

  await client.end();
}

checkDealsStatus().catch(console.error);
