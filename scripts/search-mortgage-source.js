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

  // Check for JSON columns that might have mortgage data
  console.log('=== JSON/TEXT columns in reapi tables ===');
  const [jsonCols] = await conn.execute(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'cms_data'
      AND table_name LIKE 'reapi%'
      AND data_type IN ('json', 'text', 'longtext', 'mediumtext')
  `);
  jsonCols.forEach(c => console.log((c.TABLE_NAME||c.table_name) + '.' + (c.COLUMN_NAME||c.column_name)));

  // Check reapi_linked_properties_summary - it has total_mortgage_balance
  console.log('\n=== reapi_linked_properties_summary sample ===');
  const [linked] = await conn.execute(`
    SELECT * FROM reapi_linked_properties_summary
    WHERE total_mortgage_balance > 0
    LIMIT 3
  `);
  linked.forEach(r => console.log(JSON.stringify(r, null, 2)));

  // Check if there's raw API response data stored
  console.log('\n=== Check for raw_data or api_response columns ===');
  const [rawCols] = await conn.execute(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'cms_data'
      AND (column_name LIKE '%raw%' OR column_name LIKE '%response%' OR column_name LIKE '%json%' OR column_name LIKE '%data%')
  `);
  rawCols.forEach(c => console.log((c.TABLE_NAME||c.table_name) + '.' + (c.COLUMN_NAME||c.column_name)));

  // Check reapi_batch_load_tracking for API info
  console.log('\n=== reapi_batch_load_tracking ===');
  const [tracking] = await conn.execute(`SELECT * FROM reapi_batch_load_tracking LIMIT 5`);
  tracking.forEach(r => console.log(JSON.stringify(r)));

  await conn.end();
}

main().catch(console.error);
