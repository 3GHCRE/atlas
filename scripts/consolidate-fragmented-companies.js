/**
 * Consolidate fragmented company records into their parent companies
 *
 * Problem: Several major companies have fragmented records in Atlas due to:
 * - Name truncation in source data
 * - Multiple entity name variations
 * - Separate records for different relationship types
 *
 * This script consolidates the following:
 * 1. Good Samaritan Society - 3 fragments (truncated names)
 * 2. Omega Healthcare Investors - 1 fragment (truncated name)
 * 3. National Health Investors - 1 fragment (truncated name)
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const DRY_RUN = process.argv.includes('--dry-run');
const SPECIFIC_COMPANY = process.argv.find(arg => arg.startsWith('--company='))?.split('=')[1];

// Define consolidation targets
const CONSOLIDATION_TARGETS = [
  {
    name: 'Good Samaritan Society',
    parentId: 15280,
    parentName: 'The Evangelical Lutheran Good Samaritan Society',
    fragmentIds: [17308, 17376, 17470],
    notes: 'Truncated/abbreviated name variants - all seller relationships'
  },
  {
    name: 'Omega Healthcare Investors',
    parentId: 14598,
    parentName: 'OMEGA HEALTHCARE INVESTORS',
    fragmentIds: [16959],
    notes: 'Truncated name "OMEGA HEALTHCARE INV" - lending relationships'
  },
  {
    name: 'National Health Investors',
    parentId: 14602,
    parentName: 'National Health Investors, Inc.',
    fragmentIds: [16930],
    notes: 'Truncated name "NATIONAL HEALTH INVES" - lending relationships'
  }
];

async function consolidateCompanies() {
  const atlas = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas',
    connectTimeout: 30000
  });

  console.log('=== CONSOLIDATING FRAGMENTED COMPANIES ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (SPECIFIC_COMPANY) {
    console.log(`Filter: Only processing "${SPECIFIC_COMPANY}"`);
  }
  console.log('');

  let totalEntitiesMoved = 0;
  let totalCompaniesMerged = 0;

  for (const target of CONSOLIDATION_TARGETS) {
    // Skip if specific company filter is set and doesn't match
    if (SPECIFIC_COMPANY && !target.name.toLowerCase().includes(SPECIFIC_COMPANY.toLowerCase())) {
      continue;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`CONSOLIDATING: ${target.name}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Parent: ${target.parentName} (ID ${target.parentId})`);
    console.log(`Fragments: ${target.fragmentIds.join(', ')}`);
    console.log(`Notes: ${target.notes}`);
    console.log('');

    // Get parent company details
    const [[parentCompany]] = await atlas.execute(`
      SELECT c.id, c.company_name, c.company_type,
             COUNT(DISTINCT e.id) as entity_count,
             COUNT(DISTINCT per.property_master_id) as property_count
      FROM companies c
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id
      WHERE c.id = ?
      GROUP BY c.id, c.company_name, c.company_type
    `, [target.parentId]);

    if (!parentCompany) {
      console.log(`ERROR: Parent company ID ${target.parentId} not found!`);
      continue;
    }

    console.log(`Parent current state:`);
    console.log(`  Entities: ${parentCompany.entity_count}`);
    console.log(`  Properties: ${parentCompany.property_count}`);
    console.log('');

    // Get fragment details
    const [fragments] = await atlas.execute(`
      SELECT c.id, c.company_name, c.company_type,
             COUNT(DISTINCT e.id) as entity_count,
             COUNT(DISTINCT per.property_master_id) as property_count
      FROM companies c
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id
      WHERE c.id IN (${target.fragmentIds.map(() => '?').join(',')})
        AND c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id, c.company_name, c.company_type
    `, target.fragmentIds);

    if (fragments.length === 0) {
      console.log('No unmerged fragments found - already consolidated.');
      continue;
    }

    console.log('Fragments to merge:');
    console.log('ID     | Entities | Props | Name');
    console.log('-------|----------|-------|' + '-'.repeat(50));

    for (const frag of fragments) {
      console.log(
        `${String(frag.id).padStart(6)} | ${String(frag.entity_count).padStart(8)} | ${String(frag.property_count).padStart(5)} | ${frag.company_name}`
      );
    }
    console.log('');

    // Process each fragment
    for (const fragment of fragments) {
      console.log(`Processing: ${fragment.company_name} (ID ${fragment.id})`);

      if (fragment.entity_count > 0) {
        // Get entities to move
        const [entities] = await atlas.execute(
          'SELECT id, entity_name FROM entities WHERE company_id = ?',
          [fragment.id]
        );

        console.log(`  Entities to move:`);
        entities.forEach(e => {
          console.log(`    - ${e.entity_name} (ID ${e.id})`);
        });

        if (!DRY_RUN) {
          // Move entities to parent company
          const [updateResult] = await atlas.execute(
            'UPDATE entities SET company_id = ? WHERE company_id = ?',
            [target.parentId, fragment.id]
          );
          console.log(`  MOVED ${updateResult.affectedRows} entities to parent`);
          totalEntitiesMoved += updateResult.affectedRows;
        } else {
          console.log(`  [DRY RUN] Would move ${fragment.entity_count} entities`);
          totalEntitiesMoved += fragment.entity_count;
        }
      }

      // Mark fragment as merged
      if (!DRY_RUN) {
        await atlas.execute(
          'UPDATE companies SET company_name = ?, notes = CONCAT(COALESCE(notes, ""), ?) WHERE id = ?',
          [
            '[MERGED] ' + fragment.company_name,
            `\n[${new Date().toISOString()}] Merged into ${target.parentName} (ID ${target.parentId})`,
            fragment.id
          ]
        );
        console.log(`  MARKED as merged`);
      } else {
        console.log(`  [DRY RUN] Would mark as merged`);
      }

      totalCompaniesMerged++;
    }

    // Show updated parent stats
    if (!DRY_RUN) {
      const [[newStats]] = await atlas.execute(`
        SELECT
          COUNT(DISTINCT e.id) as entity_count,
          COUNT(DISTINCT per.property_master_id) as property_count
        FROM companies c
        LEFT JOIN entities e ON e.company_id = c.id
        LEFT JOIN property_entity_relationships per ON per.entity_id = e.id
        WHERE c.id = ?
      `, [target.parentId]);

      console.log(`\nParent updated state:`);
      console.log(`  Entities: ${newStats.entity_count}`);
      console.log(`  Properties: ${newStats.property_count}`);
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  if (DRY_RUN) {
    console.log('=== DRY RUN SUMMARY ===');
    console.log(`Would merge ${totalCompaniesMerged} fragment companies`);
    console.log(`Would move ${totalEntitiesMoved} entities`);
    console.log('\nRun without --dry-run to execute changes.');
  } else {
    console.log('=== CONSOLIDATION COMPLETE ===');
    console.log(`Merged ${totalCompaniesMerged} fragment companies`);
    console.log(`Moved ${totalEntitiesMoved} entities`);
  }

  await atlas.end();
}

consolidateCompanies().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
