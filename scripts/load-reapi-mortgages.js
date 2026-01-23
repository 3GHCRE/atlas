/**
 * REAPI Mortgages ETL Script
 *
 * Loads mortgage/financing transactions from REAPI into the Atlas deals tables.
 * Creates deal_type='mortgage' records with lender/borrower parties.
 *
 * Source: reapi_mortgages (currently 0 rows - ready for future data)
 * Target: deals, deals_parties (lender/borrower), deals_mortgage
 *
 * Note: This script is ready for when reapi_mortgages gets populated.
 * Run with --check to verify data availability before loading.
 */

const mysql = require('mysql2/promise');

// Configuration
const REAPI_DB = {
  host: 'YOUR_DB_HOST_HERE',
  port: 25060,
  user: 'YOUR_DB_USER_HERE',
  password: 'YOUR_DB_PASSWORD_HERE',
  database: 'cms_data',
  ssl: { rejectUnauthorized: false }
};

const ATLAS_DB = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'devpass',
  database: 'atlas'
};

const BATCH_SIZE = 500;

// Check mode - just verify data availability
const CHECK_MODE = process.argv.includes('--check');

async function main() {
  let reapiConn, atlasConn;

  try {
    console.log('=== REAPI Mortgages ETL ===\n');
    console.log(`Mode: ${CHECK_MODE ? 'CHECK (verify data only)' : 'LOAD'}`);
    console.log(`Start time: ${new Date().toISOString()}\n`);

    // Connect to databases
    console.log('Connecting to REAPI database (cms_data)...');
    reapiConn = await mysql.createConnection(REAPI_DB);
    console.log('✓ Connected to REAPI database\n');

    // Check data availability
    console.log('--- Checking REAPI Mortgage Data ---');
    const dataStatus = await checkDataAvailability(reapiConn);

    if (dataStatus.mortgageCount === 0) {
      console.log('\n⚠️  reapi_mortgages table has 0 rows.');
      console.log('   Mortgage data needs to be loaded into REAPI first.');
      console.log('   This script is ready for when data becomes available.\n');

      // Show what data we DO have
      console.log('--- Available Property Mortgage Data ---');
      console.log(`Properties with estimated_mortgage_balance: ${dataStatus.propertiesWithMortgage}`);
      console.log(`Total estimated mortgage balance: $${(dataStatus.totalMortgageBalance / 1e9).toFixed(2)}B`);

      if (!CHECK_MODE) {
        console.log('\nRun with --check to see data status without loading.');
      }
      return;
    }

    if (CHECK_MODE) {
      console.log(`\n✓ Found ${dataStatus.mortgageCount} mortgage records ready to load.`);
      console.log('Run without --check to perform the ETL.');
      return;
    }

    // Connect to Atlas
    console.log('\nConnecting to Atlas database...');
    atlasConn = await mysql.createConnection(ATLAS_DB);
    console.log('✓ Connected to Atlas database\n');

    // Phase 1: Query mortgage data
    console.log('--- Phase 1: Query REAPI Mortgage Data ---');
    const mortgageData = await queryReapiMortgages(reapiConn);

    // Phase 2: Clear existing mortgage records
    console.log('\n--- Phase 2: Clear Existing Mortgage Records ---');
    await clearExistingMortgages(atlasConn);

    // Phase 3: Insert into deals base table
    console.log('\n--- Phase 3: Insert into deals table ---');
    const dealIdMap = await insertDeals(atlasConn, mortgageData);

    // Phase 4: Insert lenders into deals_parties
    console.log('\n--- Phase 4: Insert Lenders into deals_parties ---');
    await insertParties(atlasConn, mortgageData, dealIdMap, 'lender', 'lender_name');

    // Phase 5: Insert borrowers into deals_parties
    console.log('\n--- Phase 5: Insert Borrowers into deals_parties ---');
    await insertParties(atlasConn, mortgageData, dealIdMap, 'borrower', 'grantee_name');

    // Phase 6: Populate deals_mortgage extension
    console.log('\n--- Phase 6: Populate deals_mortgage Extension ---');
    await insertDealsMortgage(atlasConn, mortgageData, dealIdMap);

    // Phase 7: Validation
    console.log('\n--- Phase 7: Validation ---');
    await validate(atlasConn);

    console.log('\n=== REAPI Mortgages ETL Complete ===');
    console.log(`End time: ${new Date().toISOString()}`);

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    if (reapiConn) await reapiConn.end();
    if (atlasConn) await atlasConn.end();
  }
}

async function checkDataAvailability(conn) {
  // Check reapi_mortgages count
  const [mortCount] = await conn.execute('SELECT COUNT(*) as cnt FROM reapi_mortgages');

  // Check properties with mortgage balance
  const [propStats] = await conn.execute(`
    SELECT
      SUM(CASE WHEN estimated_mortgage_balance > 0 THEN 1 ELSE 0 END) as with_mortgage,
      SUM(estimated_mortgage_balance) as total_balance
    FROM reapi_properties
  `);

  console.log(`reapi_mortgages rows: ${mortCount[0].cnt}`);

  return {
    mortgageCount: mortCount[0].cnt,
    propertiesWithMortgage: propStats[0].with_mortgage || 0,
    totalMortgageBalance: parseFloat(propStats[0].total_balance) || 0
  };
}

async function queryReapiMortgages(conn) {
  console.log('Querying REAPI mortgage data...');

  const query = `
    SELECT
      rm.property_id,
      rm.mortgage_id,
      rm.amount,
      rm.position,
      rm.is_current,
      rm.is_open,
      rm.loan_type,
      rm.loan_type_code,
      rm.interest_rate,
      rm.interest_rate_type,
      rm.term,
      rm.maturity_date,
      rm.lender_name,
      rm.lender_type,
      rm.grantee_name,
      rm.document_number,
      rm.document_date,
      rm.recording_date,
      rm.deed_type,
      rm.transaction_type,
      rp.ccn
    FROM reapi_mortgages rm
    JOIN reapi_properties rp ON rp.property_id = rm.property_id
    WHERE rm.amount > 0
    ORDER BY rm.recording_date DESC
  `;

  const [rows] = await conn.execute(query);
  console.log(`✓ Found ${rows.length} mortgages with amount > 0`);

  // Summary stats
  const withLender = rows.filter(r => r.lender_name && r.lender_name.trim() !== '').length;
  const withBorrower = rows.filter(r => r.grantee_name && r.grantee_name.trim() !== '').length;
  const withCcn = rows.filter(r => r.ccn).length;

  console.log(`  - Mortgages with lender name: ${withLender}`);
  console.log(`  - Mortgages with borrower name: ${withBorrower}`);
  console.log(`  - Mortgages with CCN linkage: ${withCcn}`);

  return rows;
}

async function clearExistingMortgages(conn) {
  const [countResult] = await conn.execute(
    `SELECT COUNT(*) as cnt FROM deals WHERE deal_type = 'mortgage' AND data_source = 'reapi'`
  );
  const existingCount = countResult[0].cnt;

  if (existingCount > 0) {
    console.log(`Found ${existingCount} existing REAPI mortgage records`);

    // Delete cascade will handle deals_mortgage and deals_parties
    await conn.execute(`DELETE FROM deals WHERE deal_type = 'mortgage' AND data_source = 'reapi'`);

    console.log(`✓ Cleared ${existingCount} existing REAPI mortgage records`);
  } else {
    console.log('✓ No existing REAPI mortgage records to clear');
  }
}

async function insertDeals(conn, mortgageData) {
  console.log(`Inserting ${mortgageData.length} mortgages into deals table...`);

  // Get property_master CCN mapping
  const [pmRows] = await conn.execute(`SELECT id, ccn FROM property_master WHERE ccn IS NOT NULL`);
  const ccnToPropertyId = new Map(pmRows.map(r => [r.ccn, r.id]));
  console.log(`  Loaded ${ccnToPropertyId.size} CCN -> property_master mappings`);

  const dealIdMap = new Map();
  let inserted = 0;
  let linked = 0;

  for (let i = 0; i < mortgageData.length; i += BATCH_SIZE) {
    const batch = mortgageData.slice(i, i + BATCH_SIZE);

    for (const mort of batch) {
      const propertyMasterId = mort.ccn ? ccnToPropertyId.get(mort.ccn) : null;
      if (propertyMasterId) linked++;

      const effectiveDate = mort.recording_date || mort.document_date || null;
      const amount = mort.amount !== undefined ? mort.amount : null;
      const docType = mort.deed_type || mort.loan_type || null;
      const docId = mort.document_number || mort.mortgage_id || null;

      const [result] = await conn.execute(`
        INSERT INTO deals (
          property_master_id,
          ccn,
          deal_type,
          effective_date,
          recorded_date,
          amount,
          document_id,
          document_type,
          data_source,
          verified,
          created_at,
          updated_at
        ) VALUES (?, ?, 'mortgage', ?, ?, ?, ?, ?, 'reapi', FALSE, NOW(), NOW())
      `, [
        propertyMasterId || null,
        mort.ccn || null,
        effectiveDate,
        mort.recording_date || null,
        amount,
        docId ? String(docId).substring(0, 50) : null,
        docType ? String(docType).substring(0, 50) : null
      ]);

      const key = `${mort.property_id}_${mort.mortgage_id}`;
      dealIdMap.set(key, result.insertId);
      inserted++;
    }

    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= mortgageData.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, mortgageData.length)}/${mortgageData.length}...`);
    }
  }

  console.log(`✓ Inserted ${inserted} mortgage deals`);
  console.log(`  - ${linked} linked to property_master (${((linked / inserted) * 100).toFixed(1)}%)`);

  return dealIdMap;
}

async function insertParties(conn, mortgageData, dealIdMap, partyRole, nameField) {
  console.log(`Inserting ${partyRole}s into deals_parties...`);

  let inserted = 0;
  let skipped = 0;

  for (const mort of mortgageData) {
    const key = `${mort.property_id}_${mort.mortgage_id}`;
    const dealId = dealIdMap.get(key);

    if (!dealId) {
      skipped++;
      continue;
    }

    const partyName = mort[nameField];
    if (!partyName || partyName.trim() === '') {
      continue;
    }

    await conn.execute(`
      INSERT INTO deals_parties (
        deal_id,
        party_role,
        party_name,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, NOW(), NOW())
    `, [dealId, partyRole, partyName.trim()]);

    inserted++;
  }

  console.log(`✓ Inserted ${inserted} ${partyRole} party records`);
  if (skipped > 0) {
    console.log(`  (${skipped} mortgages skipped - no deal_id found)`);
  }
}

async function insertDealsMortgage(conn, mortgageData, dealIdMap) {
  console.log('Populating deals_mortgage extension table...');

  let inserted = 0;

  for (const mort of mortgageData) {
    const key = `${mort.property_id}_${mort.mortgage_id}`;
    const dealId = dealIdMap.get(key);

    if (!dealId) continue;

    // Parse term to months if possible
    let termMonths = null;
    if (mort.term) {
      const termMatch = mort.term.match(/(\d+)/);
      if (termMatch) {
        termMonths = parseInt(termMatch[1]);
        // Assume years if term > 100 (e.g., "30" means 30 years)
        if (termMonths <= 50 && mort.term.toLowerCase().includes('year')) {
          termMonths = termMonths * 12;
        }
      }
    }

    await conn.execute(`
      INSERT INTO deals_mortgage (
        deal_id,
        loan_type,
        term_months,
        interest_rate,
        maturity_date,
        is_refinance,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, FALSE, NOW(), NOW())
    `, [
      dealId,
      mort.loan_type ? String(mort.loan_type).substring(0, 50) : null,
      termMonths,
      mort.interest_rate || null,
      mort.maturity_date || null
    ]);

    inserted++;
  }

  console.log(`✓ Inserted ${inserted} deals_mortgage extension records`);
}

async function validate(conn) {
  console.log('Running validation queries...\n');

  // Count by deal_type
  const [dealTypes] = await conn.execute(`
    SELECT deal_type, COUNT(*) as cnt
    FROM deals
    GROUP BY deal_type
    ORDER BY cnt DESC
  `);
  console.log('Deals by type:');
  dealTypes.forEach(r => console.log(`  ${r.deal_type}: ${r.cnt}`));

  // Mortgage linkage
  const [linkage] = await conn.execute(`
    SELECT
      COUNT(*) as total_mortgages,
      SUM(CASE WHEN property_master_id IS NOT NULL THEN 1 ELSE 0 END) as linked
    FROM deals
    WHERE deal_type = 'mortgage'
  `);
  if (linkage[0].total_mortgages > 0) {
    console.log(`\nMortgage property linkage: ${linkage[0].linked}/${linkage[0].total_mortgages}`);
  }

  // Party counts for mortgages
  const [parties] = await conn.execute(`
    SELECT dp.party_role, COUNT(*) as cnt
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE d.deal_type = 'mortgage'
    GROUP BY dp.party_role
  `);
  if (parties.length > 0) {
    console.log('\nParties for mortgages:');
    parties.forEach(r => console.log(`  ${r.party_role}: ${r.cnt}`));
  }

  // Top lenders
  const [topLenders] = await conn.execute(`
    SELECT dp.party_name, COUNT(*) as loans, SUM(d.amount) as total_volume
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE d.deal_type = 'mortgage' AND dp.party_role = 'lender'
    GROUP BY dp.party_name
    ORDER BY total_volume DESC
    LIMIT 10
  `);
  if (topLenders.length > 0) {
    console.log('\nTop Lenders by Volume:');
    topLenders.forEach(r => {
      const vol = r.total_volume ? `$${(r.total_volume / 1e6).toFixed(0)}M` : 'N/A';
      console.log(`  ${r.party_name.substring(0, 40).padEnd(40)} | ${r.loans} loans | ${vol}`);
    });
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
