/**
 * consolidate-principal-company-duplicates.js
 *
 * Consolidates duplicate principal_company_relationships where the same
 * principal has multiple active relationships to the same company.
 *
 * CMS data records each role separately (owner, director, officer, manager, etc.),
 * causing 5-6 duplicate relationships per principal-company pair.
 *
 * This script:
 * 1. Keeps the relationship with the highest ownership percentage
 * 2. Merges all roles into role_detail
 * 3. End-dates the duplicate records
 */

const { getAtlasConnection } = require('../lib/db-config');

async function consolidateDuplicates() {
  console.log('='.repeat(70));
  console.log('CONSOLIDATING DUPLICATE PRINCIPAL-COMPANY RELATIONSHIPS');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const atlas = await getAtlasConnection();

  try {
    // ========================================
    // PART 1: Count Duplicates
    // ========================================
    console.log('--- PART 1: COUNTING DUPLICATES ---\n');

    const [[{ total_dups }]] = await atlas.query(`
      SELECT COUNT(*) as total_dups FROM (
        SELECT principal_id, company_id
        FROM principal_company_relationships
        WHERE end_date IS NULL
        GROUP BY principal_id, company_id
        HAVING COUNT(*) > 1
      ) x
    `);

    console.log(`  Total duplicate principal-company pairs: ${total_dups}`);

    // Count total excess relationships
    const [[{ excess_rels }]] = await atlas.query(`
      SELECT SUM(cnt - 1) as excess_rels FROM (
        SELECT principal_id, company_id, COUNT(*) as cnt
        FROM principal_company_relationships
        WHERE end_date IS NULL
        GROUP BY principal_id, company_id
        HAVING COUNT(*) > 1
      ) x
    `);

    console.log(`  Total excess relationships to consolidate: ${excess_rels}`);

    // ========================================
    // PART 2: Get All Duplicates
    // ========================================
    console.log('\n--- PART 2: LOADING DUPLICATES ---\n');

    const [duplicates] = await atlas.query(`
      SELECT
        pcr.principal_id,
        pcr.company_id,
        GROUP_CONCAT(pcr.id ORDER BY COALESCE(pcr.ownership_percentage, 0) DESC, pcr.id ASC) as rel_ids,
        GROUP_CONCAT(DISTINCT pcr.role ORDER BY pcr.role) as all_roles,
        MAX(pcr.ownership_percentage) as max_ownership
      FROM principal_company_relationships pcr
      WHERE pcr.end_date IS NULL
      GROUP BY pcr.principal_id, pcr.company_id
      HAVING COUNT(*) > 1
    `);

    console.log(`  Loaded ${duplicates.length} duplicate pairs to process`);

    // ========================================
    // PART 3: Consolidate Duplicates
    // ========================================
    console.log('\n--- PART 3: CONSOLIDATING ---\n');

    let processedCount = 0;
    let updatedCount = 0;
    let endDatedCount = 0;

    for (const dup of duplicates) {
      const relIds = dup.rel_ids.split(',').map(Number);
      const primaryId = relIds[0]; // Keep the first (highest ownership)
      const duplicateIds = relIds.slice(1); // End-date the rest

      // Update the primary relationship with all roles
      const allRoles = dup.all_roles;
      const [updateResult] = await atlas.query(`
        UPDATE principal_company_relationships
        SET role_detail = CASE
          WHEN role_detail IS NULL THEN ?
          WHEN role_detail = '' THEN ?
          ELSE CONCAT(role_detail, '; roles: ', ?)
        END
        WHERE id = ?
      `, [allRoles, allRoles, allRoles, primaryId]);

      if (updateResult.affectedRows > 0) {
        updatedCount++;
      }

      // End-date the duplicate relationships
      if (duplicateIds.length > 0) {
        const [endDateResult] = await atlas.query(`
          UPDATE principal_company_relationships
          SET end_date = CURDATE(),
              role_detail = CONCAT(COALESCE(role_detail, ''), '; consolidated into id:', ?)
          WHERE id IN (?)
        `, [primaryId, duplicateIds]);

        endDatedCount += endDateResult.affectedRows;
      }

      processedCount++;

      if (processedCount % 1000 === 0) {
        console.log(`    Processed ${processedCount}/${duplicates.length} pairs...`);
      }
    }

    console.log(`\n  Processed: ${processedCount} duplicate pairs`);
    console.log(`  Updated (primary): ${updatedCount} relationships`);
    console.log(`  End-dated (duplicates): ${endDatedCount} relationships`);

    // ========================================
    // PART 4: Verify Results
    // ========================================
    console.log('\n--- PART 4: VERIFICATION ---\n');

    const [[{ remaining_dups }]] = await atlas.query(`
      SELECT COUNT(*) as remaining_dups FROM (
        SELECT principal_id, company_id
        FROM principal_company_relationships
        WHERE end_date IS NULL
        GROUP BY principal_id, company_id
        HAVING COUNT(*) > 1
      ) x
    `);

    console.log(`  Remaining duplicate pairs: ${remaining_dups}`);

    // Count active relationships
    const [[{ active_rels }]] = await atlas.query(`
      SELECT COUNT(*) as active_rels
      FROM principal_company_relationships
      WHERE end_date IS NULL
    `);

    console.log(`  Active relationships after consolidation: ${active_rels}`);

    // Recount inflated principals
    const [[{ inflated_after }]] = await atlas.query(`
      SELECT COUNT(DISTINCT p.id) as inflated_after
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      JOIN companies c ON c.id = pcr.company_id
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      JOIN property_master pm ON pm.id = per.property_master_id
      GROUP BY p.id
      HAVING COUNT(DISTINCT pm.id) > 500
    `);

    console.log(`  Principals with >500 properties after consolidation: ${inflated_after || 0}`);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('CONSOLIDATION COMPLETE');
    console.log('='.repeat(70));

    console.log(`
Before:
  - Duplicate principal-company pairs: ${total_dups}
  - Excess relationships: ${excess_rels}

After:
  - Remaining duplicates: ${remaining_dups}
  - End-dated relationships: ${endDatedCount}
  - Principals with >500 properties: ${inflated_after || 0}

The consolidation preserved the relationship with the highest ownership
percentage and merged all role information into role_detail.
`);

    return {
      before: { duplicates: total_dups, excess: excess_rels },
      after: { duplicates: remaining_dups, endDated: endDatedCount, inflated: inflated_after }
    };

  } finally {
    await atlas.end();
  }
}

consolidateDuplicates().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
