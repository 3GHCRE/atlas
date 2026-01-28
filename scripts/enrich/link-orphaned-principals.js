/**
 * link-orphaned-principals.js
 * Phase 1: Link orphaned principals to companies/entities
 *
 * Strategy:
 * 1. CMS reassociation - use cms_owners_staging to find missed links
 * 2. Entity name matching - principals whose names appear in entity names
 * 3. Company name matching - principals whose names appear in company names
 *
 * Usage: node scripts/enrich/link-orphaned-principals.js [--dry-run] [--limit N]
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;

async function linkOrphanedPrincipals() {
  console.log('='.repeat(70));
  console.log('PHASE 1: LINK ORPHANED PRINCIPALS');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will create relationships)'}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} principals per method`);
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const atlas = await getAtlasConnection();
  console.log('Connected to Atlas database\n');

  const results = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? 'dry_run' : 'live',
    before: { orphaned: 0, total: 0 },
    after: { orphaned: 0, total: 0 },
    methods: {
      cms_reassociation: { found: 0, linked: 0 },
      entity_name_match: { found: 0, linked: 0 },
      company_name_match: { found: 0, linked: 0 }
    },
    errors: []
  };

  try {
    // ========================================
    // BASELINE: Count orphaned principals
    // ========================================
    console.log('--- BASELINE COUNTS ---\n');

    const [[{ total }]] = await atlas.query('SELECT COUNT(*) as total FROM principals');
    const [[{ orphaned }]] = await atlas.query(`
      SELECT COUNT(*) as orphaned FROM principals p
      WHERE NOT EXISTS (
        SELECT 1 FROM principal_company_relationships pcr
        WHERE pcr.principal_id = p.id AND pcr.end_date IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM principal_entity_relationships per
        WHERE per.principal_id = p.id AND per.end_date IS NULL
      )
    `);

    results.before.total = total;
    results.before.orphaned = orphaned;
    console.log(`  Total principals: ${total}`);
    console.log(`  Orphaned (no links): ${orphaned} (${(100 * orphaned / total).toFixed(1)}%)`);

    // ========================================
    // METHOD 1: CMS Reassociation
    // ========================================
    console.log('\n--- METHOD 1: CMS REASSOCIATION ---\n');
    console.log('Finding orphaned principals with cms_associate_id_owner that can be linked via CMS data...');

    // Find orphaned principals that have CMS associate IDs
    // and can be linked to entities via cms_owners_staging → property_master → entities
    const [cmsMatches] = await atlas.query(`
      SELECT DISTINCT
        p.id as principal_id,
        p.full_name,
        p.cms_associate_id_owner,
        e.id as entity_id,
        e.entity_name,
        c.id as company_id,
        c.company_name,
        cos.role_code_owner,
        cos.role_text_owner,
        CASE
          WHEN cos.percentage_ownership IS NOT NULL
               AND cos.percentage_ownership != ''
               AND cos.percentage_ownership REGEXP '^[0-9.]+$'
          THEN CAST(cos.percentage_ownership AS DECIMAL(5,2))
          ELSE NULL
        END as ownership_pct
      FROM principals p
      JOIN cms_owners_staging cos ON TRIM(cos.associate_id_owner) = p.cms_associate_id_owner
      JOIN cms_enrollments_staging ces ON TRIM(ces.associate_id) = TRIM(cos.associate_id)
      JOIN property_master pm ON pm.ccn = ces.ccn
      JOIN property_entity_relationships per ON per.property_master_id = pm.id AND per.end_date IS NULL
      JOIN entities e ON e.id = per.entity_id
      JOIN companies c ON c.id = e.company_id AND c.company_name NOT LIKE '[MERGED]%'
      WHERE p.cms_associate_id_owner IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM principal_company_relationships pcr
          WHERE pcr.principal_id = p.id AND pcr.end_date IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM principal_entity_relationships perx
          WHERE perx.principal_id = p.id AND perx.end_date IS NULL
        )
        AND cos.type_owner = 'I'
        AND cos.role_code_owner IN ('34', '35', '40', '41', '42', '43', '44', '45')
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}
    `);

    results.methods.cms_reassociation.found = cmsMatches.length;
    console.log(`  Found ${cmsMatches.length} potential matches via CMS data`);

    if (cmsMatches.length > 0) {
      console.log('\n  Sample matches:');
      for (const m of cmsMatches.slice(0, 5)) {
        console.log(`    ${m.full_name.substring(0, 25).padEnd(25)} → ${m.company_name.substring(0, 30)} (role ${m.role_code_owner})`);
      }

      if (!DRY_RUN) {
        console.log('\n  Creating relationships...');
        let linked = 0;

        for (const m of cmsMatches) {
          try {
            // Create principal_company_relationship
            const role = mapCmsRole(m.role_code_owner);
            await atlas.query(`
              INSERT INTO principal_company_relationships
                (principal_id, company_id, role, role_detail, cms_role_code, ownership_percentage, data_source)
              VALUES (?, ?, ?, ?, ?, ?, 'cms')
              ON DUPLICATE KEY UPDATE updated_at = NOW()
            `, [m.principal_id, m.company_id, role, m.role_text_owner, m.role_code_owner, m.ownership_pct]);

            // Create principal_entity_relationship
            const entityRole = mapCmsRoleToEntity(m.role_code_owner);
            await atlas.query(`
              INSERT INTO principal_entity_relationships
                (principal_id, entity_id, role, role_detail, cms_role_code, ownership_percentage, data_source)
              VALUES (?, ?, ?, ?, ?, ?, 'cms')
              ON DUPLICATE KEY UPDATE updated_at = NOW()
            `, [m.principal_id, m.entity_id, entityRole, m.role_text_owner, m.role_code_owner, m.ownership_pct]);

            linked++;
          } catch (err) {
            results.errors.push({ method: 'cms_reassociation', principal_id: m.principal_id, error: err.message });
          }
        }

        results.methods.cms_reassociation.linked = linked;
        console.log(`  Created ${linked} relationships`);
      }
    }

    // ========================================
    // METHOD 2: Entity Name Matching
    // ========================================
    console.log('\n--- METHOD 2: ENTITY NAME MATCHING ---\n');
    console.log('Finding orphaned principals whose names appear in entity names...');

    // This catches cases like "JOHN SMITH" appearing in "JOHN SMITH LLC"
    const [entityMatches] = await atlas.query(`
      SELECT DISTINCT
        p.id as principal_id,
        p.full_name,
        e.id as entity_id,
        e.entity_name,
        c.id as company_id,
        c.company_name,
        e.entity_type
      FROM principals p
      JOIN entities e ON (
        -- Full name appears in entity name
        UPPER(e.entity_name) LIKE CONCAT('%', UPPER(p.full_name), '%')
        -- Or last name matches for shorter entity names
        OR (LENGTH(p.last_name) >= 4 AND UPPER(e.entity_name) LIKE CONCAT(UPPER(p.last_name), '%'))
      )
      JOIN companies c ON c.id = e.company_id AND c.company_name NOT LIKE '[MERGED]%'
      WHERE NOT EXISTS (
        SELECT 1 FROM principal_company_relationships pcr
        WHERE pcr.principal_id = p.id AND pcr.end_date IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM principal_entity_relationships per
        WHERE per.principal_id = p.id AND per.end_date IS NULL
      )
      AND p.full_name IS NOT NULL
      AND LENGTH(p.full_name) >= 5
      -- Avoid matching common words
      AND p.last_name NOT IN ('HEALTH', 'CARE', 'MEDICAL', 'CENTER', 'HOME', 'NURSING', 'LIVING')
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}
    `);

    results.methods.entity_name_match.found = entityMatches.length;
    console.log(`  Found ${entityMatches.length} potential matches`);

    if (entityMatches.length > 0) {
      console.log('\n  Sample matches:');
      for (const m of entityMatches.slice(0, 5)) {
        console.log(`    ${m.full_name.substring(0, 25).padEnd(25)} → ${m.entity_name.substring(0, 40)}`);
      }

      if (!DRY_RUN) {
        console.log('\n  Creating relationships...');
        let linked = 0;

        for (const m of entityMatches) {
          try {
            // For name matches, assume owner role
            await atlas.query(`
              INSERT INTO principal_company_relationships
                (principal_id, company_id, role, role_detail, data_source)
              VALUES (?, ?, 'owner', 'Inferred from entity name match', 'manual')
              ON DUPLICATE KEY UPDATE updated_at = NOW()
            `, [m.principal_id, m.company_id]);

            await atlas.query(`
              INSERT INTO principal_entity_relationships
                (principal_id, entity_id, role, role_detail, data_source)
              VALUES (?, ?, 'owner_direct', 'Inferred from entity name match', 'manual')
              ON DUPLICATE KEY UPDATE updated_at = NOW()
            `, [m.principal_id, m.entity_id]);

            linked++;
          } catch (err) {
            results.errors.push({ method: 'entity_name_match', principal_id: m.principal_id, error: err.message });
          }
        }

        results.methods.entity_name_match.linked = linked;
        console.log(`  Created ${linked} relationships`);
      }
    }

    // ========================================
    // METHOD 3: Company Name Matching
    // ========================================
    console.log('\n--- METHOD 3: COMPANY NAME MATCHING ---\n');
    console.log('Finding orphaned principals whose names appear in company names...');

    const [companyMatches] = await atlas.query(`
      SELECT DISTINCT
        p.id as principal_id,
        p.full_name,
        c.id as company_id,
        c.company_name,
        c.company_type
      FROM principals p
      JOIN companies c ON (
        UPPER(c.company_name) LIKE CONCAT('%', UPPER(p.full_name), '%')
        OR (LENGTH(p.last_name) >= 4 AND UPPER(c.company_name) LIKE CONCAT(UPPER(p.last_name), '%'))
      )
      WHERE c.company_name NOT LIKE '[MERGED]%'
        AND NOT EXISTS (
          SELECT 1 FROM principal_company_relationships pcr
          WHERE pcr.principal_id = p.id AND pcr.end_date IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM principal_entity_relationships per
          WHERE per.principal_id = p.id AND per.end_date IS NULL
        )
        AND p.full_name IS NOT NULL
        AND LENGTH(p.full_name) >= 5
        AND p.last_name NOT IN ('HEALTH', 'CARE', 'MEDICAL', 'CENTER', 'HOME', 'NURSING', 'LIVING', 'CAPITAL', 'GROUP')
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}
    `);

    results.methods.company_name_match.found = companyMatches.length;
    console.log(`  Found ${companyMatches.length} potential matches`);

    if (companyMatches.length > 0) {
      console.log('\n  Sample matches:');
      for (const m of companyMatches.slice(0, 5)) {
        console.log(`    ${m.full_name.substring(0, 25).padEnd(25)} → ${m.company_name.substring(0, 40)}`);
      }

      if (!DRY_RUN) {
        console.log('\n  Creating relationships...');
        let linked = 0;

        for (const m of companyMatches) {
          try {
            await atlas.query(`
              INSERT INTO principal_company_relationships
                (principal_id, company_id, role, role_detail, data_source)
              VALUES (?, ?, 'owner', 'Inferred from company name match', 'manual')
              ON DUPLICATE KEY UPDATE updated_at = NOW()
            `, [m.principal_id, m.company_id]);

            linked++;
          } catch (err) {
            results.errors.push({ method: 'company_name_match', principal_id: m.principal_id, error: err.message });
          }
        }

        results.methods.company_name_match.linked = linked;
        console.log(`  Created ${linked} relationships`);
      }
    }

    // ========================================
    // AFTER: Recount orphaned principals
    // ========================================
    console.log('\n--- AFTER COUNTS ---\n');

    const [[{ orphanedAfter }]] = await atlas.query(`
      SELECT COUNT(*) as orphanedAfter FROM principals p
      WHERE NOT EXISTS (
        SELECT 1 FROM principal_company_relationships pcr
        WHERE pcr.principal_id = p.id AND pcr.end_date IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM principal_entity_relationships per
        WHERE per.principal_id = p.id AND per.end_date IS NULL
      )
    `);

    results.after.total = total;
    results.after.orphaned = orphanedAfter;

    const reduced = results.before.orphaned - orphanedAfter;
    console.log(`  Orphaned before: ${results.before.orphaned}`);
    console.log(`  Orphaned after:  ${orphanedAfter}`);
    console.log(`  Reduction:       ${reduced} (${(100 * reduced / results.before.orphaned).toFixed(1)}%)`);

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'phase1-link-orphans.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 1 SUMMARY');
    console.log('='.repeat(70));

    console.log(`\nMethod Results:`);
    console.log(`  CMS Reassociation:   ${results.methods.cms_reassociation.found} found, ${results.methods.cms_reassociation.linked} linked`);
    console.log(`  Entity Name Match:   ${results.methods.entity_name_match.found} found, ${results.methods.entity_name_match.linked} linked`);
    console.log(`  Company Name Match:  ${results.methods.company_name_match.found} found, ${results.methods.company_name_match.linked} linked`);

    console.log(`\nOrphaned Principals:`);
    console.log(`  Before: ${results.before.orphaned} (${(100 * results.before.orphaned / results.before.total).toFixed(1)}%)`);
    console.log(`  After:  ${results.after.orphaned} (${(100 * results.after.orphaned / results.after.total).toFixed(1)}%)`);

    if (results.errors.length > 0) {
      console.log(`\nErrors: ${results.errors.length}`);
      for (const e of results.errors.slice(0, 5)) {
        console.log(`  - ${e.method}: principal ${e.principal_id} - ${e.error}`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('PHASE 1 COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

// Map CMS role code to principal_company_relationships role
function mapCmsRole(code) {
  const mapping = {
    '34': 'owner',     // Direct owner
    '35': 'owner',     // Indirect owner
    '40': 'officer',
    '41': 'director',
    '42': 'managing_employee',
    '43': 'manager',
    '44': 'other',     // Member
    '45': 'other'      // Manager (LLC)
  };
  return mapping[code] || 'other';
}

// Map CMS role code to principal_entity_relationships role
function mapCmsRoleToEntity(code) {
  const mapping = {
    '34': 'owner_direct',
    '35': 'owner_indirect',
    '40': 'officer',
    '41': 'director',
    '42': 'managing_employee',
    '43': 'board_member',
    '44': 'member',
    '45': 'manager'
  };
  return mapping[code] || 'other';
}

linkOrphanedPrincipals().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
