/**
 * Database Connection Status Checker
 * Verifies connectivity to both REAPI and Atlas databases
 */

const { getAtlasConnection, getReapiConnection, ATLAS_CONFIG, REAPI_CONFIG } = require('./lib/db-config');

async function checkDatabase(name, getConnection) {
  console.log(`\nChecking ${name} database...`);
  try {
    const conn = await getConnection();
    const [rows] = await conn.execute('SELECT 1 as test');

    // Get table count
    const [tables] = await conn.execute('SHOW TABLES');
    console.log(`✓ ${name}: Connected (${tables.length} tables)`);

    await conn.end();
    return true;
  } catch (err) {
    console.log(`✗ ${name}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('=== Database Connection Status ===');

  const atlasOk = await checkDatabase('Atlas (local)', getAtlasConnection);

  let reapiOk = false;
  if (REAPI_CONFIG.host && REAPI_CONFIG.password) {
    reapiOk = await checkDatabase('REAPI (cms_data)', getReapiConnection);
  } else {
    console.log('\n⚠ REAPI: Not configured (DB_HOST/DB_PASSWORD missing from .env)');
  }

  console.log('\n=== Summary ===');
  console.log(`Atlas Database: ${atlasOk ? '✓ Ready' : '✗ Not available'}`);
  console.log(`REAPI Database: ${reapiOk ? '✓ Ready' : '✗ Not configured or unavailable'}`);

  if (atlasOk) {
    console.log('\n→ Atlas ready. MCP server can start.');
  } else {
    console.log('\n→ Start Atlas database: cd docker && docker-compose up -d');
  }
}

main().catch(console.error);
