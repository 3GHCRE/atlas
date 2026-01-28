/**
 * sync-crm-principals.js
 * Phase 4: Sync principals from CRM (Zoho) to Atlas
 *
 * Strategy:
 * 1. Find CRM contacts not linked to Atlas principals
 * 2. Find Atlas companies not linked to CRM accounts
 * 3. Create missing principal records from CRM data
 * 4. Link existing principals to companies via CRM relationships
 *
 * Usage: node scripts/enrich/sync-crm-principals.js [--dry-run] [--export-gaps]
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const EXPORT_GAPS = args.includes('--export-gaps');

async function syncCrmPrincipals() {
  console.log('='.repeat(70));
  console.log('PHASE 4: SYNC CRM PRINCIPALS');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will sync data)'}`);
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const atlas = await getAtlasConnection();
  console.log('Connected to Atlas database\n');

  const results = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? 'dry_run' : 'live',
    crm_stats: {
      total_contacts: 0,
      linked_to_principals: 0,
      unlinked: 0
    },
    company_stats: {
      total_companies: 0,
      with_crm_account: 0,
      without_crm_account: 0
    },
    actions: {
      principals_created: 0,
      relationships_created: 0,
      companies_matched_to_crm: 0
    },
    gaps: {
      high_value_no_crm: [],
      crm_contacts_no_principal: []
    },
    errors: []
  };

  try {
    // ========================================
    // CHECK CRM TABLES EXIST
    // ========================================
    console.log('--- CHECKING CRM TABLES ---\n');

    const [tables] = await atlas.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'atlas'
        AND table_name LIKE 'crm_%' OR table_name LIKE 'zoho_%'
    `);

    console.log(`  Found ${tables.length} CRM-related tables:`);
    for (const t of tables) {
      console.log(`    - ${t.table_name || t.TABLE_NAME}`);
    }

    if (tables.length === 0) {
      console.log('\n  ⚠ No CRM tables found. Skipping CRM sync.');
      results.errors.push({ type: 'no_crm_tables', message: 'CRM tables not found in database' });
      return results;
    }

    // ========================================
    // STEP 1: Analyze CRM Contact Coverage
    // ========================================
    console.log('\n--- STEP 1: CRM CONTACT ANALYSIS ---\n');

    // Check if crm_contacts or similar table exists
    const [[crmContactsTable]] = await atlas.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'atlas'
        AND (table_name = 'crm_contacts' OR table_name = 'zoho_contacts'
             OR table_name = 'crm_principal_properties_staging')
      LIMIT 1
    `);

    if (crmContactsTable) {
      const tableName = crmContactsTable.table_name || crmContactsTable.TABLE_NAME;
      console.log(`  Using CRM table: ${tableName}`);

      // Count total CRM contacts
      const [[{ total }]] = await atlas.query(`SELECT COUNT(*) as total FROM ${tableName}`);
      results.crm_stats.total_contacts = total;
      console.log(`  Total CRM contacts: ${total}`);

      // Count CRM contacts linked to principals
      const [[{ linked }]] = await atlas.query(`
        SELECT COUNT(DISTINCT p.zoho_contact_id) as linked
        FROM principals p
        WHERE p.zoho_contact_id IS NOT NULL
      `);
      results.crm_stats.linked_to_principals = linked;
      console.log(`  Linked to principals: ${linked}`);
      console.log(`  Unlinked: ${total - linked}`);
      results.crm_stats.unlinked = total - linked;
    }

    // ========================================
    // STEP 2: Analyze Company-CRM Account Coverage
    // ========================================
    console.log('\n--- STEP 2: COMPANY-CRM ACCOUNT ANALYSIS ---\n');

    const [[{ total_companies }]] = await atlas.query(`
      SELECT COUNT(*) as total_companies FROM companies
      WHERE company_name NOT LIKE '[MERGED]%'
    `);
    results.company_stats.total_companies = total_companies;

    const [[{ with_crm }]] = await atlas.query(`
      SELECT COUNT(*) as with_crm FROM companies
      WHERE company_name NOT LIKE '[MERGED]%'
        AND zoho_account_id IS NOT NULL
    `);
    results.company_stats.with_crm_account = with_crm;
    results.company_stats.without_crm_account = total_companies - with_crm;

    console.log(`  Total companies: ${total_companies}`);
    console.log(`  With CRM account: ${with_crm} (${(100 * with_crm / total_companies).toFixed(1)}%)`);
    console.log(`  Without CRM account: ${total_companies - with_crm}`);

    // ========================================
    // STEP 3: Find High-Value Companies Not in CRM
    // ========================================
    console.log('\n--- STEP 3: HIGH-VALUE COMPANIES NOT IN CRM ---\n');

    const [highValueNoCrm] = await atlas.query(`
      SELECT
        c.id,
        c.company_name,
        c.company_type,
        COUNT(DISTINCT pm.id) as property_count,
        COUNT(DISTINCT pcr.principal_id) as principal_count
      FROM companies c
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      LEFT JOIN principal_company_relationships pcr ON pcr.company_id = c.id AND pcr.end_date IS NULL
      WHERE c.company_name NOT LIKE '[MERGED]%'
        AND c.zoho_account_id IS NULL
        AND c.company_type IN ('operating', 'owner_operator', 'ownership', 'reit')
      GROUP BY c.id
      HAVING property_count >= 5
      ORDER BY property_count DESC
    `);

    console.log(`  Found ${highValueNoCrm.length} high-value companies not in CRM`);
    results.gaps.high_value_no_crm = highValueNoCrm.slice(0, 100).map(c => ({
      id: c.id,
      name: c.company_name,
      type: c.company_type,
      properties: c.property_count,
      principals: c.principal_count
    }));

    if (highValueNoCrm.length > 0) {
      console.log('\n  Top 10 by property count:');
      for (const c of highValueNoCrm.slice(0, 10)) {
        console.log(`    [${c.property_count} props] ${c.company_name.substring(0, 45)} (${c.principal_count} principals)`);
      }

      if (EXPORT_GAPS) {
        const csvPath = path.join(OUTPUT_DIR, 'CRM_GAP_REPORT.csv');
        const csvContent = [
          'company_id,company_name,company_type,property_count,principal_count,action',
          ...highValueNoCrm.map(c =>
            `${c.id},"${c.company_name}",${c.company_type},${c.property_count},${c.principal_count},"Create CRM Account"`
          )
        ].join('\n');
        fs.writeFileSync(csvPath, csvContent);
        console.log(`\n  Gap report saved to: ${csvPath}`);
      }
    }

    // ========================================
    // STEP 4: Match CRM Accounts to Companies
    // ========================================
    console.log('\n--- STEP 4: MATCH CRM ACCOUNTS TO COMPANIES ---\n');

    // Check if crm_accounts or similar table exists
    const [[crmAccountsTable]] = await atlas.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'atlas'
        AND (table_name = 'crm_accounts' OR table_name = 'zoho_accounts')
      LIMIT 1
    `);

    if (crmAccountsTable) {
      const tableName = crmAccountsTable.table_name || crmAccountsTable.TABLE_NAME;

      // Find CRM accounts that can be matched to companies by name
      const [unmatchedAccounts] = await atlas.query(`
        SELECT a.id as crm_id, a.account_name
        FROM ${tableName} a
        WHERE NOT EXISTS (
          SELECT 1 FROM companies c WHERE c.zoho_account_id = a.id
        )
      `);

      console.log(`  CRM accounts not linked to companies: ${unmatchedAccounts.length}`);

      if (unmatchedAccounts.length > 0 && !DRY_RUN) {
        let matched = 0;

        for (const acc of unmatchedAccounts) {
          // Try exact name match
          const [[company]] = await atlas.query(`
            SELECT id FROM companies
            WHERE UPPER(company_name) = UPPER(?)
              AND company_name NOT LIKE '[MERGED]%'
              AND zoho_account_id IS NULL
            LIMIT 1
          `, [acc.account_name]);

          if (company) {
            await atlas.query(`
              UPDATE companies SET zoho_account_id = ?, updated_at = NOW()
              WHERE id = ?
            `, [acc.crm_id, company.id]);
            matched++;
          }
        }

        results.actions.companies_matched_to_crm = matched;
        console.log(`  Matched ${matched} CRM accounts to companies`);
      }
    }

    // ========================================
    // STEP 5: Create Principals from CRM Contacts
    // ========================================
    console.log('\n--- STEP 5: CREATE PRINCIPALS FROM CRM CONTACTS ---\n');

    // Find CRM contacts that should become principals
    // Using the crm_principal_properties_staging if it exists
    const [[stagingTable]] = await atlas.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'atlas'
        AND table_name = 'crm_principal_properties_staging'
      LIMIT 1
    `);

    if (stagingTable) {
      // Get CRM contacts not yet in principals table
      const [unlinkedContacts] = await atlas.query(`
        SELECT DISTINCT
          s.contact_id,
          s.contact_name,
          s.contact_email,
          s.contact_phone,
          s.account_id,
          s.account_name,
          s.role
        FROM crm_principal_properties_staging s
        WHERE s.contact_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM principals p WHERE p.zoho_contact_id = s.contact_id
          )
        LIMIT 1000
      `);

      console.log(`  CRM contacts not in principals: ${unlinkedContacts.length}`);
      results.gaps.crm_contacts_no_principal = unlinkedContacts.slice(0, 50).map(c => ({
        contact_id: c.contact_id,
        name: c.contact_name,
        account: c.account_name
      }));

      if (unlinkedContacts.length > 0) {
        console.log('\n  Sample:');
        for (const c of unlinkedContacts.slice(0, 5)) {
          console.log(`    ${(c.contact_name || 'Unknown').substring(0, 30).padEnd(30)} @ ${(c.account_name || 'No Account').substring(0, 30)}`);
        }

        if (!DRY_RUN) {
          let created = 0;
          let linked = 0;

          for (const contact of unlinkedContacts) {
            try {
              if (!contact.contact_name) continue;

              // Parse name
              const nameParts = contact.contact_name.trim().split(/\s+/);
              const firstName = nameParts[0] || '';
              const lastName = nameParts[nameParts.length - 1] || '';
              const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';
              const fullName = contact.contact_name.trim();

              // Create principal
              const [result] = await atlas.query(`
                INSERT INTO principals
                  (first_name, middle_name, last_name, full_name, normalized_full_name,
                   email, phone, zoho_contact_id, principal_source, last_synced_from_zoho)
                VALUES (?, ?, ?, ?, UPPER(?), ?, ?, ?, 'crm_only', NOW())
                ON DUPLICATE KEY UPDATE
                  email = COALESCE(VALUES(email), email),
                  phone = COALESCE(VALUES(phone), phone),
                  last_synced_from_zoho = NOW()
              `, [firstName, middleName, lastName, fullName, fullName,
                  contact.contact_email, contact.contact_phone, contact.contact_id]);

              if (result.insertId) {
                created++;

                // Try to link to company
                if (contact.account_id) {
                  const [[company]] = await atlas.query(`
                    SELECT id FROM companies WHERE zoho_account_id = ?
                  `, [contact.account_id]);

                  if (company) {
                    const role = mapCrmRole(contact.role);
                    await atlas.query(`
                      INSERT INTO principal_company_relationships
                        (principal_id, company_id, role, role_detail, data_source)
                      VALUES (?, ?, ?, ?, 'zoho')
                      ON DUPLICATE KEY UPDATE updated_at = NOW()
                    `, [result.insertId, company.id, role, contact.role]);
                    linked++;
                  }
                }
              }
            } catch (err) {
              results.errors.push({
                type: 'create_principal',
                contact_id: contact.contact_id,
                error: err.message
              });
            }
          }

          results.actions.principals_created = created;
          results.actions.relationships_created = linked;
          console.log(`\n  Created ${created} principals, ${linked} company relationships`);
        }
      }
    } else {
      console.log('  crm_principal_properties_staging table not found');
      console.log('  Run validate-crm-junction.js first to populate staging data');
    }

    // ========================================
    // STEP 6: Link Existing Principals to Companies via CRM
    // ========================================
    console.log('\n--- STEP 6: LINK EXISTING PRINCIPALS VIA CRM ---\n');

    // Find principals with CRM contact IDs that have unlinked company relationships
    const [unlinkablePrincipals] = await atlas.query(`
      SELECT
        p.id as principal_id,
        p.full_name,
        p.zoho_contact_id,
        s.account_id,
        s.account_name,
        s.role,
        c.id as company_id,
        c.company_name
      FROM principals p
      JOIN crm_principal_properties_staging s ON s.contact_id = p.zoho_contact_id
      JOIN companies c ON c.zoho_account_id = s.account_id
      WHERE p.zoho_contact_id IS NOT NULL
        AND c.company_name NOT LIKE '[MERGED]%'
        AND NOT EXISTS (
          SELECT 1 FROM principal_company_relationships pcr
          WHERE pcr.principal_id = p.id
            AND pcr.company_id = c.id
            AND pcr.end_date IS NULL
        )
      LIMIT 500
    `).catch(() => [[]]);

    if (unlinkablePrincipals && unlinkablePrincipals.length > 0) {
      console.log(`  Found ${unlinkablePrincipals.length} principals to link via CRM relationships`);

      if (!DRY_RUN) {
        let linked = 0;

        for (const p of unlinkablePrincipals) {
          try {
            const role = mapCrmRole(p.role);
            await atlas.query(`
              INSERT INTO principal_company_relationships
                (principal_id, company_id, role, role_detail, data_source)
              VALUES (?, ?, ?, ?, 'zoho')
              ON DUPLICATE KEY UPDATE updated_at = NOW()
            `, [p.principal_id, p.company_id, role, p.role]);
            linked++;
          } catch (err) {
            results.errors.push({
              type: 'link_principal',
              principal_id: p.principal_id,
              error: err.message
            });
          }
        }

        results.actions.relationships_created += linked;
        console.log(`  Created ${linked} new company relationships`);
      }
    } else {
      console.log('  No additional principals to link via CRM');
    }

    // ========================================
    // FINAL COVERAGE CHECK
    // ========================================
    console.log('\n--- FINAL COVERAGE CHECK ---\n');

    const [[{ final_orphaned }]] = await atlas.query(`
      SELECT COUNT(*) as final_orphaned FROM principals p
      WHERE NOT EXISTS (
        SELECT 1 FROM principal_company_relationships pcr
        WHERE pcr.principal_id = p.id AND pcr.end_date IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM principal_entity_relationships per
        WHERE per.principal_id = p.id AND per.end_date IS NULL
      )
    `);

    const [[{ total_principals }]] = await atlas.query('SELECT COUNT(*) as total_principals FROM principals');

    console.log(`  Total principals: ${total_principals}`);
    console.log(`  Orphaned (no links): ${final_orphaned} (${(100 * final_orphaned / total_principals).toFixed(1)}%)`);
    console.log(`  Linked: ${total_principals - final_orphaned} (${(100 * (total_principals - final_orphaned) / total_principals).toFixed(1)}%)`);

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'phase4-crm-sync.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 4 SUMMARY');
    console.log('='.repeat(70));

    console.log(`\nCRM Coverage:`);
    console.log(`  CRM contacts: ${results.crm_stats.total_contacts}`);
    console.log(`  Linked to principals: ${results.crm_stats.linked_to_principals}`);

    console.log(`\nCompany Coverage:`);
    console.log(`  Companies with CRM account: ${results.company_stats.with_crm_account} / ${results.company_stats.total_companies}`);

    console.log(`\nActions (${DRY_RUN ? 'would be' : 'actual'}):`);
    console.log(`  Principals created: ${results.actions.principals_created}`);
    console.log(`  Relationships created: ${results.actions.relationships_created}`);
    console.log(`  Companies matched to CRM: ${results.actions.companies_matched_to_crm}`);

    console.log(`\nGaps Identified:`);
    console.log(`  High-value companies not in CRM: ${results.gaps.high_value_no_crm.length}`);
    console.log(`  CRM contacts without principals: ${results.gaps.crm_contacts_no_principal.length}`);

    if (results.errors.length > 0) {
      console.log(`\nErrors: ${results.errors.length}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('PHASE 4 COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

/**
 * Map CRM role to principal_company_relationships role
 */
function mapCrmRole(crmRole) {
  if (!crmRole) return 'other';

  const roleLower = crmRole.toLowerCase();

  if (roleLower.includes('ceo') || roleLower.includes('chief executive')) return 'ceo';
  if (roleLower.includes('cfo') || roleLower.includes('chief financial')) return 'cfo';
  if (roleLower.includes('coo') || roleLower.includes('chief operating')) return 'coo';
  if (roleLower.includes('president')) return 'president';
  if (roleLower.includes('vp') || roleLower.includes('vice president')) return 'vp';
  if (roleLower.includes('director')) return 'director';
  if (roleLower.includes('owner')) return 'owner';
  if (roleLower.includes('manager')) return 'manager';
  if (roleLower.includes('officer')) return 'officer';

  return 'other';
}

syncCrmPrincipals().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
