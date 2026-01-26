/**
 * Add missing property_owner relationships for owner-operators
 *
 * VALIDATION APPROACH (not blindly trusting CRM):
 * 1. Company must be type 'owner_operator' in Atlas (we've already classified them)
 * 2. Entity must already have facility_operator relationship (proves they operate it)
 * 3. Entity should be type 'opco' or 'propco' (not management/holding/other)
 * 4. Company should have consistent ownership pattern (owns other properties too)
 *
 * For properties where:
 * - Atlas company is type 'owner_operator' (our classification, not CRM's)
 * - Atlas already has "facility_operator" relationship for the entity
 * - Missing the property_owner relationship for the same entity
 *
 * Usage:
 *   node scripts/add-missing-owner-relationships.js          # Dry run (preview)
 *   node scripts/add-missing-owner-relationships.js --apply  # Actually add relationships
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = !process.argv.includes('--apply');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: 'atlas'
  });

  console.log('='.repeat(60));
  console.log('ADD MISSING OWNER RELATIONSHIPS');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'APPLY (will modify database)'}`);
  console.log('');

  // Step 1: Find owner-operator companies that have SOME properties with both relationships
  // This validates they're actually owner-operators (not just operators)
  console.log('Step 1: Identifying validated owner-operator companies...');
  const [validatedOwnerOperators] = await conn.query(`
    SELECT DISTINCT
      c.id as company_id,
      c.company_name,
      COUNT(DISTINCT CASE WHEN per.relationship_type = 'property_owner' THEN per.property_master_id END) as owned_count,
      COUNT(DISTINCT CASE WHEN per.relationship_type = 'facility_operator' THEN per.property_master_id END) as operated_count
    FROM companies c
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
    WHERE c.company_type = 'owner_operator'
    GROUP BY c.id, c.company_name
    HAVING owned_count > 0 AND operated_count > 0
  `);

  const validCompanyIds = new Set(validatedOwnerOperators.map(r => r.company_id));
  console.log(`  Found ${validatedOwnerOperators.length} companies with BOTH owner and operator relationships`);
  console.log('  (These are confirmed owner-operators based on Atlas data, not CRM)');
  console.log('');

  // Step 2: Find properties missing owner relationship for these validated companies
  console.log('Step 2: Finding properties missing owner relationship...');
  const [toFix] = await conn.query(`
    SELECT DISTINCT
      per.property_master_id as property_id,
      pm.facility_name,
      pm.ccn,
      per.entity_id,
      e.entity_name,
      e.entity_type,
      c.id as company_id,
      c.company_name,
      c.company_type,
      per.effective_date,
      per.data_source
    FROM property_entity_relationships per
    JOIN property_master pm ON pm.id = per.property_master_id
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    LEFT JOIN property_entity_relationships existing ON existing.property_master_id = per.property_master_id
      AND existing.entity_id = per.entity_id
      AND existing.relationship_type = 'property_owner'
      AND existing.end_date IS NULL
    WHERE per.relationship_type = 'facility_operator'
      AND per.end_date IS NULL
      AND c.company_type = 'owner_operator'
      AND e.entity_type IN ('opco', 'propco')  -- Only opco/propco entities, not management
      AND existing.id IS NULL  -- No existing property_owner relationship
    ORDER BY c.company_name, pm.facility_name
  `);

  // Filter to only validated companies
  const filtered = toFix.filter(r => validCompanyIds.has(r.company_id));

  console.log(`  Total properties with missing owner relationship: ${toFix.length}`);
  console.log(`  Properties from VALIDATED owner-operators: ${filtered.length}`);
  console.log(`  Skipped (company not validated as owner-operator): ${toFix.length - filtered.length}`);
  console.log('');

  if (filtered.length === 0) {
    console.log('Nothing to do!');
    await conn.end();
    return;
  }

  // Group by company for display
  const byCompany = {};
  for (const row of filtered) {
    if (!byCompany[row.company_name]) {
      byCompany[row.company_name] = [];
    }
    byCompany[row.company_name].push(row);
  }

  // Show validation stats
  console.log('Step 3: Validation summary per company...');
  console.log('');

  console.log('=== RELATIONSHIPS TO ADD (VALIDATED) ===');
  console.log('');

  // Show company validation context
  for (const [companyName, props] of Object.entries(byCompany).slice(0, 15)) {
    // Get validation stats for this company
    const companyStats = validatedOwnerOperators.find(v => v.company_name === companyName);
    const ownedCount = companyStats ? companyStats.owned_count : 0;
    const operatedCount = companyStats ? companyStats.operated_count : 0;

    console.log(`${companyName}`);
    console.log(`  Atlas validation: ${ownedCount} owned, ${operatedCount} operated`);
    console.log(`  Missing owner relationship: ${props.length} properties`);
    for (const p of props.slice(0, 2)) {
      console.log(`    - ${p.facility_name} (${p.ccn}) via ${p.entity_name}`);
    }
    if (props.length > 2) {
      console.log(`    ... and ${props.length - 2} more`);
    }
    console.log('');
  }

  if (Object.keys(byCompany).length > 15) {
    console.log(`... and ${Object.keys(byCompany).length - 15} more companies`);
    console.log('');
  }

  console.log(`TOTAL: ${filtered.length} properties to add owner relationship`);
  console.log('');

  if (DRY_RUN) {
    console.log('='.repeat(60));
    console.log('DRY RUN - No changes made');
    console.log('Run with --apply to add these relationships');
    console.log('='.repeat(60));
    await conn.end();
    return;
  }

  // Actually add the relationships
  console.log('=== ADDING RELATIONSHIPS ===');
  console.log('');

  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of filtered) {
    try {
      // Double-check no existing relationship (race condition protection)
      const [[existing]] = await conn.query(`
        SELECT id FROM property_entity_relationships
        WHERE property_master_id = ?
          AND entity_id = ?
          AND relationship_type = 'property_owner'
          AND end_date IS NULL
      `, [row.property_id, row.entity_id]);

      if (existing) {
        skipped++;
        continue;
      }

      // Add the property_owner relationship
      await conn.query(`
        INSERT INTO property_entity_relationships (
          property_master_id,
          entity_id,
          relationship_type,
          effective_date,
          data_source,
          verified,
          confidence_score,
          notes,
          created_at,
          updated_at
        ) VALUES (?, ?, 'property_owner', ?, 'zoho', 0, 0.70, ?, NOW(), NOW())
      `, [
        row.property_id,
        row.entity_id,
        row.effective_date || null,
        `Added via CRM junction validation - entity already has facility_operator role`
      ]);

      added++;

      if (added % 100 === 0) {
        console.log(`  Added ${added}...`);
      }
    } catch (err) {
      console.error(`  Error adding relationship for property ${row.property_id}: ${err.message}`);
      errors++;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Added:   ${added}`);
  console.log(`Skipped: ${skipped} (already existed)`);
  console.log(`Errors:  ${errors}`);
  console.log('');

  // Update the validation status for fixed conflicts
  if (added > 0) {
    console.log('Updating validation status for fixed records...');

    const [updateResult] = await conn.query(`
      UPDATE crm_principal_properties_staging cps
      JOIN property_entity_relationships per ON per.property_master_id = cps.resolved_property_id
        AND per.relationship_type = 'property_owner'
        AND per.end_date IS NULL
      SET cps.validation_status = 'matched',
          cps.validation_notes = CONCAT(COALESCE(cps.validation_notes, ''), ' [FIXED: property_owner added]'),
          cps.validated_at = NOW()
      WHERE cps.validation_status = 'conflict'
    `);

    console.log(`Updated ${updateResult.affectedRows} junction records to 'matched'`);
  }

  console.log('');
  console.log('Done!');

  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
