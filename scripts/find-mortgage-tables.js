#!/usr/bin/env node
/**
 * Find mortgage-related tables in REAPI database
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

  // List ALL tables
  console.log('=== All Tables in cms_data ===');
  const [tables] = await conn.execute(`
    SELECT table_name, table_rows
    FROM information_schema.tables
    WHERE table_schema = 'cms_data'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  tables.forEach(t => {
    const name = t.TABLE_NAME || t.table_name;
    const rows = t.TABLE_ROWS || t.table_rows;
    console.log(`${name}: ~${rows} rows`);
  });

  // Find tables with mortgage/loan/lender columns
  console.log('\n=== Tables with Mortgage/Loan/Lender Columns ===');
  const [mortCols] = await conn.execute(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'cms_data'
      AND (column_name LIKE '%mortgage%'
           OR column_name LIKE '%loan%'
           OR column_name LIKE '%lender%'
           OR column_name LIKE '%interest_rate%')
    ORDER BY table_name, column_name
  `);

  let currentTable = '';
  mortCols.forEach(c => {
    const tbl = c.TABLE_NAME || c.table_name;
    const col = c.COLUMN_NAME || c.column_name;
    const typ = c.DATA_TYPE || c.data_type;
    if (tbl !== currentTable) {
      console.log(`\n${tbl}:`);
      currentTable = tbl;
    }
    console.log(`  - ${col} (${typ})`);
  });

  await conn.end();
}

main().catch(e => console.error(e));
