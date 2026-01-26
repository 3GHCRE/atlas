/**
 * Consolidate Benedictine-related companies into single parent
 *
 * Problem: Benedictine Health System is fragmented across 10 company records in Atlas,
 * but they are all subsidiaries/affiliates of the same nonprofit parent.
 *
 * Web research confirms: Benedictine Health System operates 35+ communities through
 * various subsidiary entities, all rolling up to the parent (EIN 41-1531892).
 *
 * Solution: Move all entities from subsidiary company records to the main
 * BENEDICTINE HEALTH SYSTEM company (ID 20), then mark subsidiaries as merged.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const DRY_RUN = process.argv.includes('--dry-run');

async function consolidateBenedictine() {
  const atlas = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas',
    connectTimeout: 30000
  });

  console.log('=== CONSOLIDATING BENEDICTINE COMPANIES ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

  // The parent company to consolidate into
  const PARENT_COMPANY_ID = 20;
  const PARENT_COMPANY_NAME = 'BENEDICTINE HEALTH SYSTEM';

  // Find all Benedictine-related companies
  const [benedictineCompanies] = await atlas.execute(`
    SELECT c.id, c.company_name, c.company_type, c.state,
           COUNT(DISTINCT e.id) as entity_count,
           COUNT(DISTINCT per.property_master_id) as property_count
    FROM companies c
    LEFT JOIN entities e ON e.company_id = c.id
    LEFT JOIN property_entity_relationships per ON per.entity_id = e.id
    WHERE (c.company_name LIKE '%BENEDICTINE%' OR c.company_name LIKE '%BENEDICTIN%')
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY c.id, c.company_name, c.company_type, c.state
    ORDER BY c.id
  `);

  console.log('Found Benedictine companies:\n');
  console.log('ID     | Entities | Props | State | Name');
  console.log('-------|----------|-------|-------|' + '-'.repeat(50));

  let totalEntities = 0;
  let totalProperties = 0;

  benedictineCompanies.forEach(c => {
    const isParent = c.id === PARENT_COMPANY_ID;
    const marker = isParent ? ' (PARENT)' : '';
    console.log(
      `${String(c.id).padStart(6)} | ${String(c.entity_count).padStart(8)} | ${String(c.property_count).padStart(5)} | ${(c.state || 'N/A').padStart(5)} | ${c.company_name}${marker}`
    );
    totalEntities += c.entity_count;
    totalProperties += c.property_count;
  });

  console.log('-------|----------|-------|-------|' + '-'.repeat(50));
  console.log(`TOTAL  | ${String(totalEntities).padStart(8)} | ${String(totalProperties).padStart(5)} |       | ${benedictineCompanies.length} companies\n`);

  // Verify parent company exists
  const parentCompany = benedictineCompanies.find(c => c.id === PARENT_COMPANY_ID);
  if (!parentCompany) {
    console.error(`ERROR: Parent company ID ${PARENT_COMPANY_ID} not found!`);
    await atlas.end();
    return;
  }

  console.log(`Parent company: ${PARENT_COMPANY_NAME} (ID ${PARENT_COMPANY_ID})`);
  console.log(`Current entities: ${parentCompany.entity_count}`);
  console.log(`Current properties: ${parentCompany.property_count}\n`);

  // Companies to merge (all except parent)
  const companiesToMerge = benedictineCompanies.filter(c => c.id !== PARENT_COMPANY_ID);

  if (companiesToMerge.length === 0) {
    console.log('No companies to merge - already consolidated.');
    await atlas.end();
    return;
  }

  console.log(`Companies to merge into parent: ${companiesToMerge.length}\n`);

  // Process each company
  let totalEntitiesMoved = 0;
  let companiesMerged = 0;

  for (const company of companiesToMerge) {
    console.log(`\nProcessing: ${company.company_name} (ID ${company.id})`);
    console.log(`  Entities: ${company.entity_count}, Properties: ${company.property_count}`);

    if (company.entity_count > 0) {
      // Get entities to move
      const [entities] = await atlas.execute(
        'SELECT id, entity_name FROM entities WHERE company_id = ?',
        [company.id]
      );

      console.log(`  Entities to move:`);
      entities.forEach(e => {
        console.log(`    - ${e.entity_name} (ID ${e.id})`);
      });

      if (!DRY_RUN) {
        // Move entities to parent company
        const [updateResult] = await atlas.execute(
          'UPDATE entities SET company_id = ? WHERE company_id = ?',
          [PARENT_COMPANY_ID, company.id]
        );
        console.log(`  MOVED ${updateResult.affectedRows} entities to parent`);
        totalEntitiesMoved += updateResult.affectedRows;
      } else {
        console.log(`  [DRY RUN] Would move ${company.entity_count} entities`);
        totalEntitiesMoved += company.entity_count;
      }
    }

    // Mark company as merged
    if (!DRY_RUN) {
      await atlas.execute(
        'UPDATE companies SET company_name = ?, notes = CONCAT(COALESCE(notes, ""), ?) WHERE id = ?',
        [
          '[MERGED] ' + company.company_name,
          `\n[${new Date().toISOString()}] Merged into BENEDICTINE HEALTH SYSTEM (ID ${PARENT_COMPANY_ID})`,
          company.id
        ]
      );
      console.log(`  MARKED as merged`);
    } else {
      console.log(`  [DRY RUN] Would mark as merged`);
    }

    companiesMerged++;
  }

  // Update parent company stats
  if (!DRY_RUN) {
    // Get new counts
    const [[newStats]] = await atlas.execute(`
      SELECT
        COUNT(DISTINCT e.id) as entity_count,
        COUNT(DISTINCT CASE WHEN per.relationship_type = 'property_owner' THEN per.property_master_id END) as owns,
        COUNT(DISTINCT CASE WHEN per.relationship_type = 'facility_operator' THEN per.property_master_id END) as operates,
        COUNT(DISTINCT per.property_master_id) as total_properties
      FROM companies c
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id
      WHERE c.id = ?
    `, [PARENT_COMPANY_ID]);

    // Determine company type
    const newType = (newStats.owns > 0 && newStats.operates > 0) ? 'owner_operator' :
                    (newStats.owns > 0) ? 'ownership' :
                    (newStats.operates > 0) ? 'operating' : 'owner_operator';

    // Update parent with EIN and type
    await atlas.execute(`
      UPDATE companies
      SET company_type = ?,
          ein = '41-1531892',
          address = '6499 University Ave NE, Suite 300',
          city = 'Minneapolis',
          state = 'MN',
          zip = '55432',
          website = 'https://www.benedictineliving.org',
          notes = CONCAT(COALESCE(notes, ''), ?)
      WHERE id = ?
    `, [
      newType,
      `\n[${new Date().toISOString()}] Consolidated ${companiesMerged} subsidiary companies. Total entities: ${newStats.entity_count}`,
      PARENT_COMPANY_ID
    ]);

    console.log('\n=== CONSOLIDATION COMPLETE ===\n');
    console.log(`Parent Company: ${PARENT_COMPANY_NAME} (ID ${PARENT_COMPANY_ID})`);
    console.log(`  Type: ${newType}`);
    console.log(`  EIN: 41-1531892`);
    console.log(`  Entities: ${newStats.entity_count}`);
    console.log(`  Properties owned: ${newStats.owns}`);
    console.log(`  Properties operated: ${newStats.operates}`);
    console.log(`  Total properties: ${newStats.total_properties}`);
    console.log(`\nCompanies merged: ${companiesMerged}`);
    console.log(`Entities moved: ${totalEntitiesMoved}`);
  } else {
    console.log('\n=== DRY RUN SUMMARY ===\n');
    console.log(`Would merge ${companiesMerged} companies into ${PARENT_COMPANY_NAME}`);
    console.log(`Would move ${totalEntitiesMoved} entities`);
    console.log(`\nRun without --dry-run to execute changes.`);
  }

  await atlas.end();
}

consolidateBenedictine().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
