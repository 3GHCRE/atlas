#!/usr/bin/env node
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: 'YOUR_DB_HOST_HERE',
    port: 25060,
    user: 'YOUR_DB_USER_HERE',
    password: 'YOUR_DB_PASSWORD_HERE',
    database: 'cms_data',
    ssl: { rejectUnauthorized: false }
  });

  // Check raw_json column for mortgage data
  console.log('=== Sample raw_json with mortgage data ===\n');

  const [rows] = await conn.execute(`
    SELECT property_id, raw_json
    FROM reapi_properties
    WHERE estimated_mortgage_balance > 0
      AND raw_json IS NOT NULL
    LIMIT 1
  `);

  if (rows.length > 0) {
    const raw = rows[0].raw_json;
    let parsed;
    if (typeof raw === 'object') {
      parsed = raw;
    } else {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.log('raw_json is not valid JSON:', String(raw).substring(0, 500));
        await conn.end();
        return;
      }
    }

    // Look for mortgage-related keys
    console.log('Top-level keys:', Object.keys(parsed));

    // Check for currentMortgages or similar
    const mortgageKeys = ['currentMortgages', 'mortgages', 'mortgage', 'financing', 'loans', 'loanInfo'];
    for (const key of mortgageKeys) {
      if (parsed[key]) {
        console.log(`\n=== Found: ${key} ===`);
        console.log(JSON.stringify(parsed[key], null, 2));
      }
    }

    // Deep search for lender
    function findLender(obj, path = '') {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) {
        const newPath = path ? `${path}.${k}` : k;
        if (k.toLowerCase().includes('lender') || k.toLowerCase().includes('mortgage')) {
          console.log(`\nFound at ${newPath}:`, JSON.stringify(v, null, 2).substring(0, 500));
        }
        if (typeof v === 'object') {
          findLender(v, newPath);
        }
      }
    }

    console.log('\n=== Deep search for lender/mortgage keys ===');
    findLender(parsed);

    // Print full structure keys at each level
    console.log('\n=== Full JSON structure (keys only) ===');
    function printKeys(obj, indent = 0) {
      if (!obj || typeof obj !== 'object') return;
      const prefix = '  '.repeat(indent);
      for (const [k, v] of Object.entries(obj)) {
        const type = Array.isArray(v) ? `array[${v.length}]` : typeof v;
        console.log(`${prefix}${k}: ${type}`);
        if (typeof v === 'object' && !Array.isArray(v) && indent < 2) {
          printKeys(v, indent + 1);
        } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && indent < 2) {
          console.log(`${prefix}  [0]:`);
          printKeys(v[0], indent + 2);
        }
      }
    }
    printKeys(parsed);

  } else {
    console.log('No rows with raw_json found');
  }

  await conn.end();
}

main().catch(console.error);
