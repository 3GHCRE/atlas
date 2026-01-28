/**
 * fix-inflated-principals.js
 *
 * Fixes the 325 "inflated" principals flagged in validation.
 *
 * Analysis showed:
 * - 293 (90%) are legitimate multi-facility service providers (pharmacists, consultants)
 *   with NULL/0% ownership - these are NOT errors
 * - 34 have >5% ownership across multiple companies - need review
 * - 2 are actual owners with large holdings - legitimate
 *
 * This script:
 * 1. Updates role_detail for non-owner managers to indicate multi-facility status
 * 2. Generates report of true ownership anomalies needing manual review
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');

async function fixInflatedPrincipals() {
  console.log('='.repeat(70));
  console.log('FIXING INFLATED PRINCIPALS');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const atlas = await getAtlasConnection();

  try {
    // ========================================
    // PART 1: Identify Categories
    // ========================================
    console.log('--- PART 1: CATEGORIZING INFLATED PRINCIPALS ---\n');

    // Get all principals with >500 properties via company relationships
    const [allInflated] = await atlas.query(`
      SELECT
        p.id,
        p.full_name,
        p.principal_source,
        COUNT(DISTINCT c.id) as company_count,
        COUNT(DISTINCT pm.id) as property_count,
        MAX(pcr.ownership_percentage) as max_ownership,
        GROUP_CONCAT(DISTINCT pcr.role ORDER BY pcr.role) as roles
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      JOIN companies c ON c.id = pcr.company_id
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      JOIN property_master pm ON pm.id = per.property_master_id
      GROUP BY p.id
      HAVING property_count > 500
      ORDER BY property_count DESC
    `);

    console.log(`  Total inflated principals: ${allInflated.length}`);

    // Categorize
    const multiProvider = []; // Non-owners serving multiple companies (legitimate)
    const ownershipAnomaly = []; // >5% ownership across many companies (review)
    const legitOwner = []; // Actual owners with large holdings (legitimate)

    for (const p of allInflated) {
      const maxOwn = p.max_ownership || 0;
      const roles = p.roles || '';

      if (maxOwn === 0 || maxOwn === null) {
        // No ownership - legitimate service provider
        multiProvider.push(p);
      } else if (roles.includes('owner') && p.company_count <= 15) {
        // Actual owner with reasonable company count
        legitOwner.push(p);
      } else if (maxOwn > 5 && p.company_count > 10) {
        // High ownership across many companies - anomaly
        ownershipAnomaly.push(p);
      } else {
        // Some ownership but reasonable - likely regional operator
        legitOwner.push(p);
      }
    }

    console.log(`\n  Multi-facility service providers (no ownership): ${multiProvider.length}`);
    console.log(`  Legitimate owners/operators: ${legitOwner.length}`);
    console.log(`  Ownership anomalies (needs review): ${ownershipAnomaly.length}`);

    // ========================================
    // PART 2: Update Multi-Facility Providers
    // ========================================
    console.log('\n--- PART 2: MARKING MULTI-FACILITY SERVICE PROVIDERS ---\n');

    let updatedCount = 0;
    for (const p of multiProvider) {
      // Update role_detail for their company relationships to indicate multi-facility status
      const [result] = await atlas.query(`
        UPDATE principal_company_relationships
        SET role_detail = CASE
          WHEN role_detail IS NULL THEN 'multi_facility_provider'
          WHEN role_detail NOT LIKE '%multi_facility_provider%' THEN CONCAT(role_detail, '; multi_facility_provider')
          ELSE role_detail
        END
        WHERE principal_id = ?
          AND end_date IS NULL
          AND role IN ('manager', 'managing_employee', 'other')
          AND (ownership_percentage IS NULL OR ownership_percentage = 0)
      `, [p.id]);

      if (result.affectedRows > 0) {
        updatedCount++;
      }
    }

    console.log(`  Updated ${updatedCount} principals as multi_facility_provider`);

    // ========================================
    // PART 3: Generate Anomaly Report
    // ========================================
    console.log('\n--- PART 3: GENERATING OWNERSHIP ANOMALY REPORT ---\n');

    if (ownershipAnomaly.length > 0) {
      // Get detailed info for anomalies
      const anomalyDetails = [];

      for (const p of ownershipAnomaly) {
        // Get their company details
        const [companies] = await atlas.query(`
          SELECT
            c.company_name,
            c.company_type,
            pcr.role,
            pcr.ownership_percentage,
            COUNT(DISTINCT pm.id) as properties
          FROM principal_company_relationships pcr
          JOIN companies c ON c.id = pcr.company_id
          JOIN entities e ON e.company_id = c.id
          JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
          JOIN property_master pm ON pm.id = per.property_master_id
          WHERE pcr.principal_id = ? AND pcr.end_date IS NULL
          GROUP BY c.id, pcr.role, pcr.ownership_percentage
          ORDER BY properties DESC
          LIMIT 5
        `, [p.id]);

        anomalyDetails.push({
          ...p,
          top_companies: companies.map(c => `${c.company_name} (${c.ownership_percentage || 0}%)`).join(' | ')
        });
      }

      // Save anomaly report
      const anomalyCsv = [
        'principal_id,full_name,company_count,property_count,max_ownership,roles,top_companies',
        ...anomalyDetails.map(a =>
          `${a.id},"${a.full_name}",${a.company_count},${a.property_count},${a.max_ownership || 0},"${a.roles}","${a.top_companies}"`
        )
      ].join('\n');

      const anomalyPath = path.join(OUTPUT_DIR, 'OWNERSHIP_ANOMALIES_REVIEW.csv');
      fs.writeFileSync(anomalyPath, anomalyCsv);
      console.log(`  Saved ${ownershipAnomaly.length} anomalies to: ${anomalyPath}`);

      console.log('\n  Sample anomalies for review:');
      for (const a of anomalyDetails.slice(0, 5)) {
        console.log(`    ${a.full_name} | ${a.max_ownership}% max | ${a.company_count} companies | ${a.property_count} properties`);
      }
    } else {
      console.log('  No ownership anomalies found requiring review.');
    }

    // ========================================
    // PART 4: Verify Fix
    // ========================================
    console.log('\n--- PART 4: VERIFYING FIX ---\n');

    // Count principals that are still "problematic" (owners with >500 properties)
    const [[{ remaining }]] = await atlas.query(`
      SELECT COUNT(DISTINCT p.id) as remaining
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      JOIN companies c ON c.id = pcr.company_id
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      JOIN property_master pm ON pm.id = per.property_master_id
      WHERE pcr.ownership_percentage > 5
        AND pcr.role_detail NOT LIKE '%multi_facility_provider%'
      GROUP BY p.id
      HAVING COUNT(DISTINCT pm.id) > 500
    `);

    console.log(`  Principals with >5% ownership AND >500 properties: ${remaining || 0}`);

    // Count marked as multi_facility_provider
    const [[{ marked }]] = await atlas.query(`
      SELECT COUNT(DISTINCT principal_id) as marked
      FROM principal_company_relationships
      WHERE role_detail LIKE '%multi_facility_provider%'
    `);

    console.log(`  Principals marked as multi_facility_provider: ${marked}`);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('FIX SUMMARY');
    console.log('='.repeat(70));

    console.log(`
Original "inflated" principals:     325
  - Multi-facility providers:       ${multiProvider.length} (marked as legitimate)
  - Legitimate owners/operators:    ${legitOwner.length} (no action needed)
  - Ownership anomalies:            ${ownershipAnomaly.length} (flagged for manual review)

Actions taken:
  - Updated role_detail for ${updatedCount} multi-facility providers
  - Generated OWNERSHIP_ANOMALIES_REVIEW.csv for ${ownershipAnomaly.length} cases

The validation script should be updated to:
  1. Exclude principals with role_detail = 'multi_facility_provider'
  2. Only flag owners (ownership_percentage > 5%) with >500 properties
`);

    console.log('='.repeat(70));

    return {
      total: allInflated.length,
      multiProvider: multiProvider.length,
      legitOwner: legitOwner.length,
      anomaly: ownershipAnomaly.length,
      updated: updatedCount
    };

  } finally {
    await atlas.end();
  }
}

fixInflatedPrincipals().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
