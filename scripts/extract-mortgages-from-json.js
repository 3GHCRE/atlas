#!/usr/bin/env node
/**
 * Extract Mortgage Data from raw_json
 *
 * The mortgage data exists in reapi_properties.raw_json -> data.mortgageHistory
 * This script extracts and summarizes it.
 */

const mysql = require('mysql2/promise');

const REAPI_DB = {
  host: 'YOUR_DB_HOST_HERE',
  port: 25060,
  user: 'YOUR_DB_USER_HERE',
  password: 'YOUR_DB_PASSWORD_HERE',
  database: 'cms_data',
  ssl: { rejectUnauthorized: false }
};

async function main() {
  const conn = await mysql.createConnection(REAPI_DB);

  console.log('=== Extracting Mortgage Data from raw_json ===\n');

  // Count properties with raw_json
  const [countResult] = await conn.execute(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN raw_json IS NOT NULL THEN 1 ELSE 0 END) as with_json
    FROM reapi_properties
  `);
  console.log(`Properties: ${countResult[0].total} total, ${countResult[0].with_json} with raw_json`);

  // Extract mortgage data
  const [rows] = await conn.execute(`
    SELECT property_id, raw_json
    FROM reapi_properties
    WHERE raw_json IS NOT NULL
  `);

  let totalMortgages = 0;
  let propertiesWithMortgages = 0;
  const lenders = new Map();
  const mortgageList = [];

  for (const row of rows) {
    const json = typeof row.raw_json === 'object' ? row.raw_json : JSON.parse(row.raw_json);
    const data = json.data || json;

    const mortgageHistory = data.mortgageHistory || [];
    const currentMortgages = data.currentMortgages || [];

    // Combine and dedupe by mortgageId
    const allMortgages = [...mortgageHistory, ...currentMortgages];
    const seen = new Set();

    for (const m of allMortgages) {
      if (!m.mortgageId || seen.has(m.mortgageId)) continue;
      seen.add(m.mortgageId);

      totalMortgages++;

      if (m.lenderName) {
        const count = lenders.get(m.lenderName) || 0;
        lenders.set(m.lenderName, count + 1);
      }

      mortgageList.push({
        property_id: row.property_id,
        mortgage_id: m.mortgageId,
        amount: m.amount,
        lender_name: m.lenderName,
        lender_type: m.lenderType,
        borrower_name: m.granteeName,
        loan_type: m.loanType,
        interest_rate: m.interestRate,
        term: m.term,
        maturity_date: m.maturityDate,
        position: m.position,
        is_open: m.open
      });
    }

    if (seen.size > 0) propertiesWithMortgages++;
  }

  console.log(`\nProperties with mortgage data: ${propertiesWithMortgages}`);
  console.log(`Total unique mortgages: ${totalMortgages}`);
  console.log(`Unique lenders: ${lenders.size}`);

  // Top lenders
  console.log('\n=== Top 20 Lenders ===');
  const sortedLenders = [...lenders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  sortedLenders.forEach(([name, count], i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${name.substring(0, 50).padEnd(50)} ${count}`);
  });

  // Sample mortgages
  console.log('\n=== Sample Mortgage Records ===');
  mortgageList.slice(0, 5).forEach((m, i) => {
    console.log(`\n--- Mortgage ${i + 1} ---`);
    console.log(`Property ID: ${m.property_id}`);
    console.log(`Lender: ${m.lender_name} (${m.lender_type})`);
    console.log(`Borrower: ${m.borrower_name}`);
    console.log(`Amount: $${(m.amount || 0).toLocaleString()}`);
    console.log(`Loan Type: ${m.loan_type}`);
    console.log(`Interest Rate: ${m.interest_rate}%`);
    console.log(`Term: ${m.term} months`);
    console.log(`Position: ${m.position}`);
  });

  // Summary stats
  const totalAmount = mortgageList.reduce((sum, m) => sum + (m.amount || 0), 0);
  console.log(`\n=== Summary ===`);
  console.log(`Total mortgage amount: $${(totalAmount / 1e9).toFixed(2)}B`);
  console.log(`Average mortgage: $${(totalAmount / mortgageList.length / 1e6).toFixed(2)}M`);

  await conn.end();
}

main().catch(console.error);
