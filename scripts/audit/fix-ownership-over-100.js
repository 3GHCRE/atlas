/**
 * fix-ownership-over-100.js
 *
 * Fixes entities with ownership percentages summing to >100%.
 *
 * Root causes:
 * 1. Duplicate principal-entity relationships (same principal multiple times)
 * 2. Non-owners (board members, officers) incorrectly assigned 100% ownership
 *
 * CMS role codes:
 * - 34: owner_direct - SHOULD have ownership %
 * - 35: owner_indirect - SHOULD have ownership %
 * - 40: officer - should NOT have ownership unless actual owner
 * - 41: director - should NOT have ownership
 * - 42: managing_employee - should NOT have ownership
 * - 43: board_member - should NOT have ownership
 * - 44: member - may have ownership
 * - 45: manager - should NOT have ownership
 */

const { getAtlasConnection } = require('../lib/db-config');

async function fixOwnershipOver100() {
  console.log('='.repeat(70));
  console.log('FIXING ENTITIES WITH OWNERSHIP > 100%');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const atlas = await getAtlasConnection();

  try {
    // ========================================
    // PART 1: Count Issues
    // ========================================
    console.log('--- PART 1: COUNTING ISSUES ---\n');

    // Count entities with >100% ownership
    const [[{ over100_count }]] = await atlas.query(`
      SELECT COUNT(*) as over100_count FROM (
        SELECT entity_id, SUM(COALESCE(ownership_percentage, 0)) as total
        FROM principal_entity_relationships
        WHERE end_date IS NULL
        GROUP BY entity_id
        HAVING total > 100
      ) x
    `);

    console.log(`  Entities with ownership > 100%: ${over100_count}`);

    // Count duplicate principal-entity relationships
    const [[{ dup_per_count }]] = await atlas.query(`
      SELECT COUNT(*) as dup_per_count FROM (
        SELECT principal_id, entity_id
        FROM principal_entity_relationships
        WHERE end_date IS NULL
        GROUP BY principal_id, entity_id
        HAVING COUNT(*) > 1
      ) x
    `);

    console.log(`  Duplicate principal-entity pairs: ${dup_per_count}`);

    // Count non-owners with ownership percentage
    const [[{ non_owner_with_pct }]] = await atlas.query(`
      SELECT COUNT(*) as non_owner_with_pct
      FROM principal_entity_relationships
      WHERE end_date IS NULL
        AND ownership_percentage > 0
        AND role IN ('officer', 'director', 'board_member', 'managing_employee', 'manager')
        AND cms_role_code NOT IN ('34', '35')
    `);

    console.log(`  Non-owners with ownership %: ${non_owner_with_pct}`);

    // ========================================
    // PART 2: Fix Non-Owner Ownership Percentages
    // ========================================
    console.log('\n--- PART 2: FIXING NON-OWNER OWNERSHIP PERCENTAGES ---\n');

    // Set ownership_percentage to NULL for non-ownership roles
    const [updateResult] = await atlas.query(`
      UPDATE principal_entity_relationships
      SET ownership_percentage = NULL,
          role_detail = CONCAT(COALESCE(role_detail, ''), '; ownership_pct cleared (non-owner role)')
      WHERE end_date IS NULL
        AND ownership_percentage > 0
        AND role IN ('officer', 'director', 'board_member', 'managing_employee', 'manager')
        AND cms_role_code NOT IN ('34', '35')
    `);

    console.log(`  Cleared ownership % for ${updateResult.affectedRows} non-owner relationships`);

    // ========================================
    // PART 2B: Fix "member" role ownership (nonprofit board members)
    // ========================================
    console.log('\n--- PART 2B: FIXING NONPROFIT MEMBER OWNERSHIP ---\n');

    // "member" role with 100% typically means voting membership, not equity ownership
    const [memberResult] = await atlas.query(`
      UPDATE principal_entity_relationships
      SET ownership_percentage = NULL,
          role_detail = CONCAT(COALESCE(role_detail, ''), '; ownership_pct cleared (member = voting rights, not equity)')
      WHERE end_date IS NULL
        AND role = 'member'
        AND ownership_percentage = 100
    `);

    console.log(`  Cleared ownership % for ${memberResult.affectedRows} "member" relationships with 100%`);

    // ========================================
    // PART 2C: Normalize multiple 100% indirect owners
    // ========================================
    console.log('\n--- PART 2C: NORMALIZING MULTIPLE 100% INDIRECT OWNERS ---\n');

    // Find entities with multiple owner_indirect at 100%
    const [multiIndirect] = await atlas.query(`
      SELECT
        entity_id,
        COUNT(*) as owner_count
      FROM principal_entity_relationships
      WHERE role = 'owner_indirect'
        AND ownership_percentage = 100
        AND end_date IS NULL
      GROUP BY entity_id
      HAVING owner_count > 1
    `);

    console.log(`  Found ${multiIndirect.length} entities with multiple 100% indirect owners`);

    let normalizedCount = 0;
    for (const entity of multiIndirect) {
      const equalShare = Math.round(100 / entity.owner_count * 100) / 100;

      await atlas.query(`
        UPDATE principal_entity_relationships
        SET ownership_percentage = ?,
            role_detail = CONCAT(COALESCE(role_detail, ''), '; normalized from 100% (multiple indirect owners)')
        WHERE entity_id = ?
          AND role = 'owner_indirect'
          AND ownership_percentage = 100
          AND end_date IS NULL
      `, [equalShare, entity.entity_id]);

      normalizedCount++;
    }

    console.log(`  Normalized ${normalizedCount} entities to equal shares`);

    // ========================================
    // PART 3: Consolidate Duplicate Principal-Entity Relationships
    // ========================================
    console.log('\n--- PART 3: CONSOLIDATING DUPLICATES ---\n');

    // Get all duplicate pairs
    const [duplicates] = await atlas.query(`
      SELECT
        principal_id,
        entity_id,
        GROUP_CONCAT(id ORDER BY COALESCE(ownership_percentage, 0) DESC, id ASC) as rel_ids,
        GROUP_CONCAT(DISTINCT role ORDER BY role) as all_roles,
        MAX(ownership_percentage) as max_ownership
      FROM principal_entity_relationships
      WHERE end_date IS NULL
      GROUP BY principal_id, entity_id
      HAVING COUNT(*) > 1
    `);

    console.log(`  Found ${duplicates.length} duplicate pairs to consolidate`);

    let consolidatedCount = 0;
    let endDatedCount = 0;

    for (const dup of duplicates) {
      const relIds = dup.rel_ids.split(',').map(Number);
      const primaryId = relIds[0]; // Keep the first (highest ownership)
      const duplicateIds = relIds.slice(1); // End-date the rest

      // Update the primary relationship with all roles
      const allRoles = dup.all_roles;
      await atlas.query(`
        UPDATE principal_entity_relationships
        SET role_detail = CASE
          WHEN role_detail IS NULL THEN ?
          WHEN role_detail = '' THEN ?
          ELSE CONCAT(role_detail, '; roles: ', ?)
        END
        WHERE id = ?
      `, [allRoles, allRoles, allRoles, primaryId]);

      // Delete the duplicate relationships (they're redundant data)
      if (duplicateIds.length > 0) {
        const [deleteResult] = await atlas.query(`
          DELETE FROM principal_entity_relationships
          WHERE id IN (?)
        `, [duplicateIds]);

        endDatedCount += deleteResult.affectedRows;
      }

      consolidatedCount++;

      if (consolidatedCount % 1000 === 0) {
        console.log(`    Processed ${consolidatedCount}/${duplicates.length}...`);
      }
    }

    console.log(`  Consolidated ${consolidatedCount} pairs, end-dated ${endDatedCount} duplicates`);

    // ========================================
    // PART 3B: Normalize any remaining over-100% entities
    // ========================================
    console.log('\n--- PART 3B: NORMALIZING REMAINING OVER-100% ENTITIES ---\n');

    // Get all entities still over 100%
    const [stillOver100] = await atlas.query(`
      SELECT entity_id, SUM(ownership_percentage) as total
      FROM principal_entity_relationships
      WHERE ownership_percentage > 0 AND end_date IS NULL
      GROUP BY entity_id
      HAVING total > 100
    `);

    console.log(`  Found ${stillOver100.length} entities still over 100%`);

    for (const entity of stillOver100) {
      const scaleFactor = 100 / entity.total;

      await atlas.query(`
        UPDATE principal_entity_relationships
        SET ownership_percentage = ROUND(ownership_percentage * ?, 2),
            role_detail = CONCAT(COALESCE(role_detail, ''), '; scaled to fit 100% total')
        WHERE entity_id = ?
          AND ownership_percentage > 0
          AND end_date IS NULL
      `, [scaleFactor, entity.entity_id]);
    }

    console.log(`  Scaled ${stillOver100.length} entities to 100% total`);

    // ========================================
    // PART 4: Verify Fix
    // ========================================
    console.log('\n--- PART 4: VERIFICATION ---\n');

    // Recount entities with >100% ownership
    const [[{ remaining_over100 }]] = await atlas.query(`
      SELECT COUNT(*) as remaining_over100 FROM (
        SELECT entity_id, SUM(COALESCE(ownership_percentage, 0)) as total
        FROM principal_entity_relationships
        WHERE end_date IS NULL
        GROUP BY entity_id
        HAVING total > 100
      ) x
    `);

    console.log(`  Entities with ownership > 100%: ${remaining_over100} (was ${over100_count})`);

    // Count remaining duplicates
    const [[{ remaining_dups }]] = await atlas.query(`
      SELECT COUNT(*) as remaining_dups FROM (
        SELECT principal_id, entity_id
        FROM principal_entity_relationships
        WHERE end_date IS NULL
        GROUP BY principal_id, entity_id
        HAVING COUNT(*) > 1
      ) x
    `);

    console.log(`  Remaining duplicate pairs: ${remaining_dups} (was ${dup_per_count})`);

    // Sample remaining issues
    if (remaining_over100 > 0) {
      const [remaining] = await atlas.query(`
        SELECT
          e.id as entity_id,
          e.entity_name,
          SUM(COALESCE(per.ownership_percentage, 0)) as total_ownership,
          COUNT(*) as owner_count
        FROM principal_entity_relationships per
        JOIN entities e ON e.id = per.entity_id
        WHERE per.end_date IS NULL
        GROUP BY e.id
        HAVING total_ownership > 100
        ORDER BY total_ownership DESC
        LIMIT 10
      `);

      console.log('\n  Remaining over-100% entities (top 10):');
      for (const r of remaining) {
        console.log(`    ${r.entity_name?.substring(0, 40).padEnd(40)} | ${r.total_ownership}% | ${r.owner_count} owners`);
      }
    }

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('FIX SUMMARY');
    console.log('='.repeat(70));

    console.log(`
Before:
  - Entities with ownership > 100%: ${over100_count}
  - Duplicate principal-entity pairs: ${dup_per_count}
  - Non-owners with ownership %: ${non_owner_with_pct}

After:
  - Entities with ownership > 100%: ${remaining_over100}
  - Duplicate pairs: ${remaining_dups}
  - Non-owner ownership cleared: ${updateResult.affectedRows}
  - Duplicate relationships end-dated: ${endDatedCount}
`);

    return {
      before: { over100: over100_count, duplicates: dup_per_count },
      after: { over100: remaining_over100, duplicates: remaining_dups }
    };

  } finally {
    await atlas.end();
  }
}

fixOwnershipOver100().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
