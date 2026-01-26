/**
 * List all tables in the cms_data database
 */

const { getReapiConnection } = require('./lib/db-config');

async function main() {
  const conn = await getReapiConnection();

  console.log('=== TABLES IN cms_data ===\n');

  const [tables] = await conn.execute('SHOW TABLES');
  for (const row of tables) {
    const tableName = Object.values(row)[0];
    console.log(tableName);
  }

  await conn.end();
}

main().catch(console.error);
