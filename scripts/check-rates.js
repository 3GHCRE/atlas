/**
 * Check for rate data in cms_data database
 */

const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: 'YOUR_DB_HOST_HERE',
  port: 25060,
  user: 'YOUR_DB_USER_HERE',
  password: 'YOUR_DB_PASSWORD_HERE',
  database: 'cms_data',
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30000
};

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);

  // Check for rate-related tables
  console.log('=== SEARCHING FOR RATE DATA ===\n');

  const [tables] = await conn.execute('SHOW TABLES');
  console.log('Tables containing "rate":');
  for (const row of tables) {
    const tableName = Object.values(row)[0];
    if (tableName.toLowerCase().includes('rate')) {
      console.log(`  - ${tableName}`);
    }
  }

  // Check if there's rate data in the financial view
  console.log('\n--- Checking vw_facility_financial_summary for rate columns ---');
  const [finCols] = await conn.execute('DESCRIBE vw_facility_financial_summary');
  for (const col of finCols) {
    console.log(`  ${col.Field} (${col.Type})`);
  }

  // Check if there's any cost/revenue data we can use to derive rates
  console.log('\n--- Sample financial data for GA facilities ---');
  const [sample] = await conn.execute(`
    SELECT
      ccn,
      provider_name,
      census_percent,
      avg_residents_per_day,
      num_certified_beds,
      total_fines_amount,
      estimated_monthly_revenue,
      estimated_annual_revenue,
      estimated_margin_percent
    FROM vw_facility_financial_summary
    WHERE state = 'GA'
    LIMIT 5
  `);
  console.log(JSON.stringify(sample, null, 2));

  // Check REAPI tables for any rate/cost data
  console.log('\n--- Checking REAPI tables for rate data ---');
  const [reapiTables] = await conn.execute("SHOW TABLES LIKE 'reapi%'");
  for (const row of reapiTables) {
    const tableName = Object.values(row)[0];
    console.log(`\nTable: ${tableName}`);
    try {
      const [cols] = await conn.execute(`DESCRIBE ${tableName}`);
      const rateRelated = cols.filter(c =>
        c.Field.toLowerCase().includes('rate') ||
        c.Field.toLowerCase().includes('price') ||
        c.Field.toLowerCase().includes('cost') ||
        c.Field.toLowerCase().includes('value') ||
        c.Field.toLowerCase().includes('revenue')
      );
      if (rateRelated.length > 0) {
        console.log('  Rate-related columns:');
        for (const col of rateRelated) {
          console.log(`    - ${col.Field} (${col.Type})`);
        }
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // Check if state averages has rate data
  console.log('\n--- Checking cms_state_averages_monthly ---');
  const [stateCols] = await conn.execute('DESCRIBE cms_state_averages_monthly');
  for (const col of stateCols) {
    console.log(`  ${col.Field} (${col.Type})`);
  }

  // Get GA state averages
  console.log('\n--- Georgia State Averages ---');
  const [gaAvg] = await conn.execute(`
    SELECT * FROM cms_state_averages_monthly
    WHERE state = 'GA'
    ORDER BY month_date DESC
    LIMIT 1
  `);
  if (gaAvg.length > 0) {
    console.log(JSON.stringify(gaAvg[0], null, 2));
  }

  await conn.end();
}

main().catch(console.error);
