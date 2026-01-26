/**
 * REAPI Sales History ETL Script
 *
 * Loads property sales transactions from REAPI into the Atlas deals tables.
 * Complements existing CMS CHOW data to create a unified deals subsystem.
 *
 * Architecture:
 *   REAPI reapi_sales_history -> deals (deal_type='sale')
 *                            -> deals_parties (buyers/sellers)
 *                            -> deals_sale (extension table)
 *
 * Source: reapi_sales_history (~14,597 rows, ~10,000+ with valid sale data)
 * Target: deals, deals_parties, deals_sale tables
 */

const { getAtlasConnection, getReapiConnection } = require('./lib/db-config');

// Batch size for inserts
const BATCH_SIZE = 500;

/**
 * Parse concatenated party names into individual names
 * Handles comma, semicolon, and "AND" separators
 * Preserves LLC, Inc, LP suffixes as single entities
 */
function parsePartyNames(nameString) {
  if (!nameString || nameString.trim() === '') {
    return [];
  }

  // Normalize the string
  let normalized = nameString.trim();

  // Split on common separators
  // Handle " AND " (with spaces) as separator but not "LAND" or similar
  normalized = normalized.replace(/\s+AND\s+/gi, ';');
  normalized = normalized.replace(/\s*,\s*/g, ';');

  // Split and clean
  const names = normalized
    .split(';')
    .map(name => name.trim())
    .filter(name => name.length > 0)
    // Filter out obvious non-names
    .filter(name => !/^(N\/A|NA|NONE|UNKNOWN|\d+)$/i.test(name));

  return names;
}

async function main() {
  let reapiConn, atlasConn;

  try {
    console.log('=== REAPI Sales History ETL ===\n');
    console.log(`Start time: ${new Date().toISOString()}\n`);

    // Connect to databases
    console.log('Connecting to REAPI database (cms_data)...');
    reapiConn = await getReapiConnection();
    console.log('✓ Connected to REAPI database\n');

    console.log('Connecting to Atlas database...');
    atlasConn = await getAtlasConnection();
    console.log('✓ Connected to Atlas database\n');

    // Phase 1: Query REAPI sales data with enrichment
    console.log('--- Phase 1: Query REAPI Sales Data ---');
    const salesData = await queryReapiSales(reapiConn);

    // Phase 2: Clear existing sale records (if any)
    console.log('\n--- Phase 2: Clear Existing Sale Records ---');
    await clearExistingSales(atlasConn);

    // Phase 3: Insert into deals base table
    console.log('\n--- Phase 3: Insert into deals table ---');
    const dealIdMap = await insertDeals(atlasConn, salesData);

    // Phase 4: Insert buyers into deals_parties
    console.log('\n--- Phase 4: Insert Buyers into deals_parties ---');
    await insertParties(atlasConn, salesData, dealIdMap, 'buyer');

    // Phase 5: Insert sellers into deals_parties
    console.log('\n--- Phase 5: Insert Sellers into deals_parties ---');
    await insertParties(atlasConn, salesData, dealIdMap, 'seller');

    // Phase 6: Populate deals_sale extension table
    console.log('\n--- Phase 6: Populate deals_sale Extension ---');
    await insertDealsSale(atlasConn, salesData, dealIdMap);

    // Phase 7: Validation
    console.log('\n--- Phase 7: Validation ---');
    await validate(atlasConn);

    console.log('\n=== REAPI Sales ETL Complete ===');
    console.log(`End time: ${new Date().toISOString()}`);

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    if (reapiConn) await reapiConn.end();
    if (atlasConn) await atlasConn.end();
  }
}

async function queryReapiSales(conn) {
  console.log('Querying REAPI sales data with enrichment...');

  const query = `
    SELECT
      rsh.property_id,
      rsh.sale_date,
      rsh.sale_amount,
      rsh.buyer_names,
      rsh.seller_names,
      rsh.transaction_type,
      rsh.document_type,
      rp.ccn,
      rpf.bedrooms,
      rpf.bathrooms,
      rpf.building_square_feet AS building_sqft,
      rpf.year_built
    FROM reapi_sales_history rsh
    JOIN reapi_properties rp ON rp.property_id = rsh.property_id
    LEFT JOIN reapi_property_features rpf ON rpf.property_id = rsh.property_id
    WHERE rsh.sale_amount > 0
      AND rsh.sale_date IS NOT NULL
    ORDER BY rsh.sale_date DESC
  `;

  const [rows] = await conn.execute(query);
  console.log(`✓ Found ${rows.length} sales with valid sale_amount and sale_date`);

  // Summary stats
  const withBuyer = rows.filter(r => r.buyer_names && r.buyer_names.trim() !== '').length;
  const withSeller = rows.filter(r => r.seller_names && r.seller_names.trim() !== '').length;
  const withCcn = rows.filter(r => r.ccn).length;
  const withBedrooms = rows.filter(r => r.bedrooms && r.bedrooms > 0).length;

  console.log(`  - Sales with buyer names: ${withBuyer}`);
  console.log(`  - Sales with seller names: ${withSeller}`);
  console.log(`  - Sales with CCN linkage: ${withCcn}`);
  console.log(`  - Sales with bedroom data: ${withBedrooms}`);

  return rows;
}

async function clearExistingSales(conn) {
  // Get count of existing sales
  const [countResult] = await conn.execute(
    `SELECT COUNT(*) as cnt FROM deals WHERE deal_type = 'sale' AND data_source = 'reapi'`
  );
  const existingCount = countResult[0].cnt;

  if (existingCount > 0) {
    console.log(`Found ${existingCount} existing REAPI sale records`);

    // Delete from deals_sale (cascade will handle this, but be explicit)
    await conn.execute(`
      DELETE ds FROM deals_sale ds
      INNER JOIN deals d ON ds.deal_id = d.id
      WHERE d.deal_type = 'sale' AND d.data_source = 'reapi'
    `);

    // Delete from deals_parties (cascade will handle this, but be explicit)
    await conn.execute(`
      DELETE dp FROM deals_parties dp
      INNER JOIN deals d ON dp.deal_id = d.id
      WHERE d.deal_type = 'sale' AND d.data_source = 'reapi'
    `);

    // Delete from deals
    await conn.execute(`DELETE FROM deals WHERE deal_type = 'sale' AND data_source = 'reapi'`);

    console.log(`✓ Cleared ${existingCount} existing REAPI sale records`);
  } else {
    console.log('✓ No existing REAPI sale records to clear');
  }
}

async function insertDeals(conn, salesData) {
  console.log(`Inserting ${salesData.length} sales into deals table...`);

  // First, get property_master CCN mapping
  const [pmRows] = await conn.execute(`SELECT id, ccn FROM property_master WHERE ccn IS NOT NULL`);
  const ccnToPropertyId = new Map(pmRows.map(r => [r.ccn, r.id]));
  console.log(`  Loaded ${ccnToPropertyId.size} CCN -> property_master mappings`);

  const dealIdMap = new Map(); // property_id + sale_date -> deal_id
  let inserted = 0;
  let linked = 0;

  // Process in batches
  for (let i = 0; i < salesData.length; i += BATCH_SIZE) {
    const batch = salesData.slice(i, i + BATCH_SIZE);

    for (const sale of batch) {
      const propertyMasterId = sale.ccn ? ccnToPropertyId.get(sale.ccn) : null;
      if (propertyMasterId) linked++;

      // Ensure no undefined values - convert to null
      const saleDate = sale.sale_date !== undefined ? sale.sale_date : null;
      const saleAmount = sale.sale_amount !== undefined ? sale.sale_amount : null;
      const docType = sale.document_type || sale.transaction_type || null;

      const [result] = await conn.execute(`
        INSERT INTO deals (
          property_master_id,
          ccn,
          deal_type,
          effective_date,
          amount,
          document_type,
          data_source,
          verified,
          created_at,
          updated_at
        ) VALUES (?, ?, 'sale', ?, ?, ?, 'reapi', FALSE, NOW(), NOW())
      `, [
        propertyMasterId || null,
        sale.ccn || null,
        saleDate,
        saleAmount,
        docType
      ]);

      const key = `${sale.property_id}_${sale.sale_date}`;
      dealIdMap.set(key, result.insertId);
      inserted++;
    }

    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= salesData.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, salesData.length)}/${salesData.length} sales...`);
    }
  }

  console.log(`✓ Inserted ${inserted} deals`);
  console.log(`  - ${linked} linked to property_master (${((linked / inserted) * 100).toFixed(1)}%)`);
  console.log(`  - ${inserted - linked} without property_master link`);

  return dealIdMap;
}

async function insertParties(conn, salesData, dealIdMap, partyRole) {
  const nameField = partyRole === 'buyer' ? 'buyer_names' : 'seller_names';
  console.log(`Inserting ${partyRole}s into deals_parties...`);

  let inserted = 0;
  let skipped = 0;

  for (const sale of salesData) {
    const key = `${sale.property_id}_${sale.sale_date}`;
    const dealId = dealIdMap.get(key);

    if (!dealId) {
      skipped++;
      continue;
    }

    const names = parsePartyNames(sale[nameField]);

    for (const name of names) {
      await conn.execute(`
        INSERT INTO deals_parties (
          deal_id,
          party_role,
          party_name,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, NOW(), NOW())
      `, [dealId, partyRole, name]);

      inserted++;
    }
  }

  console.log(`✓ Inserted ${inserted} ${partyRole} party records`);
  if (skipped > 0) {
    console.log(`  (${skipped} sales skipped - no deal_id found)`);
  }
}

async function insertDealsSale(conn, salesData, dealIdMap) {
  console.log('Populating deals_sale extension table...');

  let inserted = 0;

  for (const sale of salesData) {
    const key = `${sale.property_id}_${sale.sale_date}`;
    const dealId = dealIdMap.get(key);

    if (!dealId) continue;

    const bedCount = sale.bedrooms && sale.bedrooms > 0 ? sale.bedrooms : null;
    const pricePerBed = bedCount && sale.sale_amount ?
      parseFloat((sale.sale_amount / bedCount).toFixed(2)) : null;
    const pricePerSqft = sale.building_sqft && sale.building_sqft > 0 && sale.sale_amount ?
      parseFloat((sale.sale_amount / sale.building_sqft).toFixed(2)) : null;

    // Truncate sale_type to 50 chars (column limit)
    const saleType = sale.transaction_type ? sale.transaction_type.substring(0, 50) : null;

    await conn.execute(`
      INSERT INTO deals_sale (
        deal_id,
        sale_type,
        price_per_bed,
        price_per_sqft,
        bed_count,
        building_sqft,
        year_built,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      dealId,
      saleType,
      pricePerBed,
      pricePerSqft,
      bedCount,
      sale.building_sqft || null,
      sale.year_built || null
    ]);

    inserted++;
  }

  console.log(`✓ Inserted ${inserted} deals_sale extension records`);
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

  // Sales linked to property_master
  const [linkage] = await conn.execute(`
    SELECT
      COUNT(*) as total_sales,
      SUM(CASE WHEN property_master_id IS NOT NULL THEN 1 ELSE 0 END) as linked,
      SUM(CASE WHEN property_master_id IS NULL THEN 1 ELSE 0 END) as unlinked
    FROM deals
    WHERE deal_type = 'sale'
  `);
  console.log(`\nProperty linkage:
  Total sales: ${linkage[0].total_sales}
  Linked: ${linkage[0].linked} (${((linkage[0].linked / linkage[0].total_sales) * 100).toFixed(1)}%)
  Unlinked: ${linkage[0].unlinked}`);

  // Party counts
  const [parties] = await conn.execute(`
    SELECT dp.party_role, COUNT(*) as cnt
    FROM deals_parties dp
    JOIN deals d ON d.id = dp.deal_id
    WHERE d.deal_type = 'sale'
    GROUP BY dp.party_role
  `);
  console.log('\nParties for sales:');
  parties.forEach(r => console.log(`  ${r.party_role}: ${r.cnt}`));

  // Extension table
  const [extension] = await conn.execute(`
    SELECT COUNT(*) as cnt FROM deals_sale
  `);
  console.log(`\nDeals_sale extension records: ${extension[0].cnt}`);

  // Sales by year
  const [byYear] = await conn.execute(`
    SELECT
      YEAR(effective_date) as year,
      COUNT(*) as deals,
      SUM(amount) as total_volume,
      AVG(amount) as avg_amount
    FROM deals
    WHERE deal_type = 'sale' AND effective_date IS NOT NULL
    GROUP BY YEAR(effective_date)
    ORDER BY year DESC
    LIMIT 10
  `);
  console.log('\nSales by year (last 10 years):');
  byYear.forEach(r => {
    const vol = r.total_volume ? `$${(r.total_volume / 1e9).toFixed(2)}B` : 'N/A';
    const avg = r.avg_amount ? `$${(r.avg_amount / 1e6).toFixed(2)}M` : 'N/A';
    console.log(`  ${r.year}: ${r.deals} deals, ${vol} total, ${avg} avg`);
  });

  // Sample sales with Ensign/Health Holdings
  const [ensignSales] = await conn.execute(`
    SELECT
      d.effective_date,
      d.amount,
      d.ccn,
      dp.party_name,
      dp.party_role
    FROM deals d
    JOIN deals_parties dp ON dp.deal_id = d.id
    WHERE d.deal_type = 'sale'
      AND dp.party_name LIKE '%Health Holdings%'
    ORDER BY d.effective_date DESC
    LIMIT 5
  `);
  if (ensignSales.length > 0) {
    console.log('\nSample Health Holdings transactions:');
    ensignSales.forEach(r => {
      const amt = r.amount ? `$${(r.amount / 1e6).toFixed(2)}M` : 'N/A';
      console.log(`  ${r.effective_date} | ${r.party_role}: ${r.party_name.substring(0, 40)} | ${amt}`);
    });
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
