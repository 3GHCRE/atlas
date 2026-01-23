#!/usr/bin/env node
/**
 * Load Mortgage Data from raw_json into Atlas Deals
 *
 * Source: reapi_properties.raw_json -> data.mortgageHistory / data.currentMortgages
 * Target: deals, deals_parties (lender/borrower), deals_mortgage
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

const ATLAS_DB = {
  host: process.env.LOCAL_DB_HOST || 'localhost',
  port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
  user: 'root',
  password: 'devpass',
  database: 'atlas'
};

const BATCH_SIZE = 100;
const CHECK_MODE = process.argv.includes('--check');
const LIMIT = process.argv.includes('--limit') ?
  parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : null;

async function main() {
  let reapiConn, atlasConn;

  try {
    console.log('=== Load Mortgages from raw_json ===\n');
    console.log(`Mode: ${CHECK_MODE ? 'CHECK' : 'LOAD'}`);
    if (LIMIT) console.log(`Limit: ${LIMIT} properties`);
    console.log(`Start: ${new Date().toISOString()}\n`);

    // Connect to REAPI
    console.log('Connecting to REAPI...');
    reapiConn = await mysql.createConnection(REAPI_DB);
    console.log('✓ Connected to REAPI\n');

    // Extract mortgage data from raw_json
    console.log('--- Extracting Mortgages from raw_json ---');
    const mortgages = await extractMortgages(reapiConn, LIMIT);
    console.log(`✓ Extracted ${mortgages.length} mortgages from ${new Set(mortgages.map(m => m.property_id)).size} properties`);

    if (CHECK_MODE) {
      // Show summary and exit
      showSummary(mortgages);
      return;
    }

    // Connect to Atlas (MySQL)
    console.log('\nConnecting to Atlas...');
    atlasConn = await mysql.createConnection(ATLAS_DB);
    console.log('✓ Connected to Atlas\n');

    // Get CCN -> property_master mapping
    console.log('--- Loading Property Mappings ---');
    const ccnMap = await loadCcnMapping(atlasConn);
    console.log(`✓ Loaded ${ccnMap.size} CCN mappings`);

    // Get CCN for each property from REAPI
    const propertyIds = [...new Set(mortgages.map(m => m.property_id))];
    const propertyCcns = await getPropertyCcns(reapiConn, propertyIds);
    console.log(`✓ Found CCNs for ${propertyCcns.size} properties`);

    // Clear existing mortgage deals from this source
    console.log('\n--- Clearing Existing Mortgage Deals ---');
    await clearExistingMortgages(atlasConn);

    // Insert deals
    console.log('\n--- Inserting Deals ---');
    const dealIdMap = await insertDeals(atlasConn, mortgages, propertyCcns, ccnMap);

    // Insert lender parties
    console.log('\n--- Inserting Lender Parties ---');
    const lenderCount = await insertParties(atlasConn, mortgages, dealIdMap, 'lender', 'lender_name');

    // Insert borrower parties
    console.log('\n--- Inserting Borrower Parties ---');
    const borrowerCount = await insertParties(atlasConn, mortgages, dealIdMap, 'borrower', 'borrower_name');

    // Insert mortgage details
    console.log('\n--- Inserting Mortgage Details ---');
    const detailCount = await insertMortgageDetails(atlasConn, mortgages, dealIdMap);

    // Validation
    console.log('\n--- Validation ---');
    await validate(atlasConn);

    console.log('\n=== Complete ===');
    console.log(`Deals: ${dealIdMap.size}`);
    console.log(`Lenders: ${lenderCount}`);
    console.log(`Borrowers: ${borrowerCount}`);
    console.log(`Mortgage details: ${detailCount}`);

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    if (reapiConn) await reapiConn.end();
    if (atlasConn) await atlasConn.end();
  }
}

async function extractMortgages(conn, limit) {
  const limitClause = limit ? `LIMIT ${limit}` : '';
  const [rows] = await conn.execute(`
    SELECT property_id, raw_json
    FROM reapi_properties
    WHERE raw_json IS NOT NULL
    ${limitClause}
  `);

  const mortgages = [];
  const seen = new Set();

  for (const row of rows) {
    const json = typeof row.raw_json === 'object' ? row.raw_json : JSON.parse(row.raw_json);
    const data = json.data || json;

    const mortgageHistory = data.mortgageHistory || [];
    const currentMortgages = data.currentMortgages || [];

    for (const m of [...mortgageHistory, ...currentMortgages]) {
      if (!m.mortgageId) continue;

      const key = `${row.property_id}_${m.mortgageId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      mortgages.push({
        property_id: row.property_id,
        mortgage_id: m.mortgageId,
        amount: m.amount || null,
        lender_name: m.lenderName || null,
        lender_type: m.lenderType || null,
        borrower_name: m.granteeName || null,
        loan_type: m.loanType || null,
        loan_type_code: m.loanTypeCode || null,
        interest_rate: m.interestRate || null,
        term: m.term || null,
        term_type: m.termType || null,
        maturity_date: m.maturityDate || null,
        document_date: m.documentDate || null,
        recording_date: m.recordingDate || null,
        document_number: m.documentNumber || null,
        position: m.position || null,
        is_open: m.open || false,
        assumable: m.assumable || false
      });
    }
  }

  return mortgages;
}

function showSummary(mortgages) {
  const lenders = new Map();
  const borrowers = new Map();
  let totalAmount = 0;

  for (const m of mortgages) {
    if (m.lender_name) {
      lenders.set(m.lender_name, (lenders.get(m.lender_name) || 0) + 1);
    }
    if (m.borrower_name) {
      borrowers.set(m.borrower_name, (borrowers.get(m.borrower_name) || 0) + 1);
    }
    totalAmount += m.amount || 0;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total mortgages: ${mortgages.length}`);
  console.log(`Unique lenders: ${lenders.size}`);
  console.log(`Unique borrowers: ${borrowers.size}`);
  console.log(`Total amount: $${(totalAmount / 1e9).toFixed(2)}B`);

  console.log(`\nTop 10 Lenders:`);
  [...lenders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([name, count], i) => console.log(`  ${i + 1}. ${name}: ${count}`));
}

async function getPropertyCcns(conn, propertyIds) {
  const ccnMap = new Map();

  // Query in batches
  for (let i = 0; i < propertyIds.length; i += 500) {
    const batch = propertyIds.slice(i, i + 500);
    const placeholders = batch.map(() => '?').join(',');
    const [rows] = await conn.execute(
      `SELECT property_id, raw_json FROM reapi_properties WHERE property_id IN (${placeholders})`,
      batch
    );

    for (const row of rows) {
      const json = typeof row.raw_json === 'object' ? row.raw_json : JSON.parse(row.raw_json);
      const ccn = json.metadata?.ccn;
      if (ccn) {
        ccnMap.set(row.property_id, ccn);
      }
    }
  }

  return ccnMap;
}

async function loadCcnMapping(conn) {
  const [rows] = await conn.execute(`SELECT id, ccn FROM property_master WHERE ccn IS NOT NULL`);
  return new Map(rows.map(r => [r.ccn, r.id]));
}

async function clearExistingMortgages(conn) {
  const [result] = await conn.execute(
    `DELETE FROM deals WHERE deal_type = 'mortgage' AND data_source = 'reapi'`
  );
  console.log(`✓ Cleared ${result.affectedRows} existing mortgage deals`);
}

async function insertDeals(conn, mortgages, propertyCcns, ccnMap) {
  const dealIdMap = new Map();
  let inserted = 0;
  let linked = 0;

  for (let i = 0; i < mortgages.length; i += BATCH_SIZE) {
    const batch = mortgages.slice(i, i + BATCH_SIZE);

    for (const m of batch) {
      const ccn = propertyCcns.get(m.property_id);
      const propertyMasterId = ccn ? ccnMap.get(ccn) : null;
      if (propertyMasterId) linked++;

      const effectiveDate = m.recording_date || m.document_date || null;

      // Convert ISO dates to MySQL format (YYYY-MM-DD) and ensure null not undefined
      const formatDate = (d) => (d !== null && d !== undefined) ? String(d).substring(0, 10) : null;
      const docId = m.document_number ? String(m.document_number).substring(0, 50) : (m.mortgage_id || null);

      const [result] = await conn.execute(`
        INSERT INTO deals (
          property_master_id, ccn, deal_type, effective_date, recorded_date,
          amount, document_id, data_source, verified, created_at, updated_at
        ) VALUES (?, ?, 'mortgage', ?, ?, ?, ?, 'reapi', false, NOW(), NOW())
      `, [
        propertyMasterId || null,
        ccn || null,
        formatDate(m.document_date),
        formatDate(m.recording_date),
        m.amount || null,
        docId
      ]);

      const key = `${m.property_id}_${m.mortgage_id}`;
      dealIdMap.set(key, result.insertId);
      inserted++;
    }

    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= mortgages.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, mortgages.length)}/${mortgages.length}...`);
    }
  }

  console.log(`✓ Inserted ${inserted} deals (${linked} linked to property_master)`);
  return dealIdMap;
}

async function insertParties(conn, mortgages, dealIdMap, role, nameField) {
  let inserted = 0;

  for (const m of mortgages) {
    const key = `${m.property_id}_${m.mortgage_id}`;
    const dealId = dealIdMap.get(key);
    if (!dealId) continue;

    const name = m[nameField];
    if (!name || name.trim() === '') continue;

    await conn.execute(`
      INSERT INTO deals_parties (deal_id, party_role, party_name, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
    `, [dealId, role, name.trim().substring(0, 255)]);

    inserted++;
  }

  console.log(`✓ Inserted ${inserted} ${role} parties`);
  return inserted;
}

async function insertMortgageDetails(conn, mortgages, dealIdMap) {
  let inserted = 0;

  for (const m of mortgages) {
    const key = `${m.property_id}_${m.mortgage_id}`;
    const dealId = dealIdMap.get(key);
    if (!dealId) continue;

    // Parse term to months - cap at reasonable max (50 years = 600 months)
    let termMonths = null;
    if (m.term) {
      const termNum = parseInt(m.term);
      if (!isNaN(termNum) && termNum > 0) {
        termMonths = m.term_type === 'Year' ? termNum * 12 : termNum;
        // Cap at 600 months (50 years) to avoid out of range
        if (termMonths > 600) termMonths = 600;
      }
    }

    // Convert ISO date to MySQL format
    const maturityDate = (m.maturity_date !== null && m.maturity_date !== undefined)
      ? String(m.maturity_date).substring(0, 10) : null;

    await conn.execute(`
      INSERT INTO deals_mortgage (
        deal_id, loan_type, term_months, interest_rate, maturity_date,
        is_refinance, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, false, NOW(), NOW())
    `, [
      dealId,
      m.loan_type ? String(m.loan_type).substring(0, 50) : null,
      termMonths,
      m.interest_rate,
      maturityDate
    ]);

    inserted++;
  }

  console.log(`✓ Inserted ${inserted} mortgage details`);
  return inserted;
}

async function validate(conn) {
  // Count by deal type
  const [dealTypes] = await conn.execute(`
    SELECT deal_type, COUNT(*) as cnt FROM deals GROUP BY deal_type ORDER BY cnt DESC
  `);
  console.log('\nDeals by type:');
  dealTypes.forEach(r => console.log(`  ${r.deal_type}: ${r.cnt}`));

  // Party counts for mortgages
  const [parties] = await conn.execute(`
    SELECT dp.party_role, COUNT(*) as cnt
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE d.deal_type = 'mortgage'
    GROUP BY dp.party_role
  `);
  console.log('\nMortgage parties:');
  parties.forEach(r => console.log(`  ${r.party_role}: ${r.cnt}`));

  // Top lenders
  const [topLenders] = await conn.execute(`
    SELECT dp.party_name, COUNT(*) as loans, SUM(d.amount) as volume
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE d.deal_type = 'mortgage' AND dp.party_role = 'lender'
    GROUP BY dp.party_name
    ORDER BY volume DESC
    LIMIT 10
  `);
  console.log('\nTop Lenders by Volume:');
  topLenders.forEach(r => {
    const vol = r.volume ? `$${(r.volume / 1e6).toFixed(0)}M` : 'N/A';
    console.log(`  ${r.party_name.substring(0, 40).padEnd(40)} | ${r.loans} loans | ${vol}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
