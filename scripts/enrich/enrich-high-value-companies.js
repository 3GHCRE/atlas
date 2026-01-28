/**
 * enrich-high-value-companies.js
 * Phase 2: Enrich high-value companies (20+ properties) with principals
 *
 * Strategy:
 * 1. Identify companies with 20+ properties but no principals
 * 2. For REITs: Pull officers from SEC EDGAR filings
 * 3. For Nonprofits: Pull officers from ProPublica 990 data
 * 4. For Operators: Re-validate against CMS enrollment data
 *
 * Usage: node scripts/enrich/enrich-high-value-companies.js [--dry-run] [--type reit|nonprofit|operator]
 */

const { getAtlasConnection } = require('../lib/db-config');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../data/audit');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TYPE_FILTER = args.includes('--type') ? args[args.indexOf('--type') + 1] : null;

// Role mapping for SEC officer titles
const SEC_ROLE_MAPPING = {
  'chief executive officer': 'ceo',
  'ceo': 'ceo',
  'president': 'president',
  'chief financial officer': 'cfo',
  'cfo': 'cfo',
  'chief operating officer': 'coo',
  'coo': 'coo',
  'chairman': 'director',
  'director': 'director',
  'executive vice president': 'vp',
  'senior vice president': 'vp',
  'vice president': 'vp',
  'secretary': 'officer',
  'treasurer': 'officer',
  'general counsel': 'officer'
};

// Role mapping for nonprofit 990 officers
const NONPROFIT_ROLE_MAPPING = {
  'executive director': 'ceo',
  'president': 'president',
  'ceo': 'ceo',
  'cfo': 'cfo',
  'treasurer': 'officer',
  'secretary': 'officer',
  'director': 'director',
  'trustee': 'director',
  'board member': 'director',
  'chairman': 'director',
  'vice president': 'vp'
};

async function enrichHighValueCompanies() {
  console.log('='.repeat(70));
  console.log('PHASE 2: ENRICH HIGH-VALUE COMPANIES');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will create principals)'}`);
  if (TYPE_FILTER) console.log(`Filter: ${TYPE_FILTER} companies only`);
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const atlas = await getAtlasConnection();
  console.log('Connected to Atlas database\n');

  const results = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? 'dry_run' : 'live',
    targets: {
      reits: [],
      nonprofits: [],
      operators: []
    },
    enriched: {
      reits: { companies: 0, principals: 0 },
      nonprofits: { companies: 0, principals: 0 },
      operators: { companies: 0, principals: 0 }
    },
    errors: []
  };

  try {
    // ========================================
    // IDENTIFY HIGH-VALUE COMPANIES WITHOUT PRINCIPALS
    // ========================================
    console.log('--- IDENTIFYING HIGH-VALUE TARGETS ---\n');

    const [targets] = await atlas.query(`
      SELECT
        c.id,
        c.company_name,
        c.company_type,
        c.sec_cik,
        c.ein,
        COUNT(DISTINCT pm.id) as property_count
      FROM companies c
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      JOIN property_master pm ON pm.id = per.property_master_id
      WHERE c.company_name NOT LIKE '[MERGED]%'
        AND NOT EXISTS (
          SELECT 1 FROM principal_company_relationships pcr
          WHERE pcr.company_id = c.id AND pcr.end_date IS NULL
        )
      GROUP BY c.id
      HAVING property_count >= 20
      ORDER BY property_count DESC
    `);

    console.log(`  Found ${targets.length} companies with 20+ properties and no principals\n`);

    // Categorize by type
    const reits = targets.filter(t => t.company_type === 'reit' || t.sec_cik);
    const nonprofits = targets.filter(t => t.ein && !t.sec_cik);
    const operators = targets.filter(t =>
      ['operating', 'owner_operator'].includes(t.company_type) && !t.sec_cik && !t.ein
    );
    const lenders = targets.filter(t => t.company_type === 'lending');
    const other = targets.filter(t =>
      !reits.includes(t) && !nonprofits.includes(t) && !operators.includes(t) && !lenders.includes(t)
    );

    console.log('  By category:');
    console.log(`    REITs/Public:     ${reits.length} (have SEC CIK)`);
    console.log(`    Nonprofits:       ${nonprofits.length} (have EIN)`);
    console.log(`    Operators:        ${operators.length}`);
    console.log(`    Lenders:          ${lenders.length} (excluded - don't need principals)`);
    console.log(`    Other:            ${other.length}`);

    results.targets.reits = reits.map(r => ({ id: r.id, name: r.company_name, cik: r.sec_cik, props: r.property_count }));
    results.targets.nonprofits = nonprofits.map(n => ({ id: n.id, name: n.company_name, ein: n.ein, props: n.property_count }));
    results.targets.operators = operators.map(o => ({ id: o.id, name: o.company_name, props: o.property_count }));

    // ========================================
    // PHASE 2A: ENRICH REITs FROM SEC
    // ========================================
    if (!TYPE_FILTER || TYPE_FILTER === 'reit') {
      console.log('\n--- PHASE 2A: ENRICH REITs FROM SEC ---\n');

      if (reits.length === 0) {
        console.log('  No REITs to enrich');
      } else {
        console.log(`  Processing ${reits.length} REITs...\n`);

        for (const reit of reits) {
          console.log(`  ${reit.company_name} (CIK: ${reit.sec_cik || 'none'}, ${reit.property_count} props)`);

          if (!reit.sec_cik) {
            console.log('    ⚠ No CIK - needs manual lookup');
            results.errors.push({
              type: 'reit_no_cik',
              company_id: reit.id,
              company_name: reit.company_name
            });
            continue;
          }

          // Query SEC for officers using existing MCP tool pattern
          // In production, this would call the SEC API
          const officers = await getSecOfficers(atlas, reit.sec_cik, reit.id);

          if (officers.length > 0) {
            console.log(`    Found ${officers.length} officers from SEC filings`);

            if (!DRY_RUN) {
              const created = await createPrincipalsFromOfficers(atlas, reit.id, officers, 'sec');
              results.enriched.reits.principals += created;
              results.enriched.reits.companies++;
            }
          } else {
            console.log('    No officers found in SEC data');
          }
        }
      }
    }

    // ========================================
    // PHASE 2B: ENRICH NONPROFITS FROM 990s
    // ========================================
    if (!TYPE_FILTER || TYPE_FILTER === 'nonprofit') {
      console.log('\n--- PHASE 2B: ENRICH NONPROFITS FROM 990s ---\n');

      if (nonprofits.length === 0) {
        console.log('  No nonprofits to enrich');
      } else {
        console.log(`  Processing ${nonprofits.length} nonprofits...\n`);

        for (const np of nonprofits) {
          console.log(`  ${np.company_name} (EIN: ${np.ein}, ${np.property_count} props)`);

          // Query ProPublica/990 data for officers
          const officers = await get990Officers(atlas, np.ein, np.id);

          if (officers.length > 0) {
            console.log(`    Found ${officers.length} officers from 990 filings`);

            if (!DRY_RUN) {
              const created = await createPrincipalsFromOfficers(atlas, np.id, officers, 'nonprofit');
              results.enriched.nonprofits.principals += created;
              results.enriched.nonprofits.companies++;
            }
          } else {
            console.log('    No officers found in 990 data');
          }
        }
      }
    }

    // ========================================
    // PHASE 2C: RE-VALIDATE OPERATORS FROM CMS
    // ========================================
    if (!TYPE_FILTER || TYPE_FILTER === 'operator') {
      console.log('\n--- PHASE 2C: RE-VALIDATE OPERATORS FROM CMS ---\n');

      if (operators.length === 0) {
        console.log('  No operators to enrich');
      } else {
        console.log(`  Processing ${operators.length} operators...\n`);

        for (const op of operators) {
          console.log(`  ${op.company_name} (${op.property_count} props)`);

          // Get CCNs for this company's properties
          const [ccns] = await atlas.query(`
            SELECT DISTINCT pm.ccn
            FROM property_master pm
            JOIN property_entity_relationships per ON per.property_master_id = pm.id AND per.end_date IS NULL
            JOIN entities e ON e.id = per.entity_id
            WHERE e.company_id = ?
              AND pm.ccn IS NOT NULL
          `, [op.id]);

          if (ccns.length === 0) {
            console.log('    No CCNs found for properties');
            continue;
          }

          // Find principals from CMS owners staging for these CCNs
          const ccnList = ccns.map(c => c.ccn);
          const [cmsOfficers] = await atlas.query(`
            SELECT DISTINCT
              cos.first_name_owner as first_name,
              cos.middle_name_owner as middle_name,
              cos.last_name_owner as last_name,
              cos.title_owner as title,
              cos.role_code_owner as role_code,
              cos.role_text_owner as role_text,
              cos.percentage_ownership,
              cos.associate_id_owner
            FROM cms_owners_staging cos
            JOIN cms_enrollments_staging ces ON TRIM(ces.associate_id) = TRIM(cos.associate_id)
            WHERE ces.ccn IN (?)
              AND cos.type_owner = 'I'
              AND cos.role_code_owner IN ('34', '35', '40', '41', '42', '43', '44', '45')
              AND cos.first_name_owner IS NOT NULL
              AND TRIM(cos.first_name_owner) != ''
          `, [ccnList]);

          if (cmsOfficers.length > 0) {
            console.log(`    Found ${cmsOfficers.length} principals from CMS for ${ccnList.length} CCNs`);

            if (!DRY_RUN) {
              const created = await createPrincipalsFromCms(atlas, op.id, cmsOfficers);
              results.enriched.operators.principals += created;
              results.enriched.operators.companies++;
            }
          } else {
            console.log('    No principals found in CMS data');
          }
        }
      }
    }

    // ========================================
    // GENERATE MANUAL RESEARCH LIST
    // ========================================
    console.log('\n--- GENERATING MANUAL RESEARCH LIST ---\n');

    const manualResearch = [];

    // REITs without CIK
    for (const r of reits.filter(x => !x.sec_cik)) {
      manualResearch.push({
        company_id: r.id,
        company_name: r.company_name,
        type: 'reit',
        properties: r.property_count,
        action: 'Lookup SEC CIK and add to database',
        source: 'SEC EDGAR'
      });
    }

    // Nonprofits without EIN
    for (const n of results.targets.nonprofits.filter(x => !x.ein)) {
      manualResearch.push({
        company_id: n.id,
        company_name: n.name,
        type: 'nonprofit',
        properties: n.props,
        action: 'Lookup EIN and add to database',
        source: 'ProPublica Nonprofit Explorer'
      });
    }

    // Other high-value companies
    for (const o of other.slice(0, 20)) {
      manualResearch.push({
        company_id: o.id,
        company_name: o.company_name,
        type: o.company_type,
        properties: o.property_count,
        action: 'Manual research needed',
        source: 'State SOS, LinkedIn, Company website'
      });
    }

    if (manualResearch.length > 0) {
      const csvPath = path.join(OUTPUT_DIR, 'MANUAL_RESEARCH_NEEDED.csv');
      const csvContent = [
        'company_id,company_name,type,properties,action,source',
        ...manualResearch.map(m =>
          `${m.company_id},"${m.company_name}",${m.type},${m.properties},"${m.action}","${m.source}"`
        )
      ].join('\n');
      fs.writeFileSync(csvPath, csvContent);
      console.log(`  Manual research list saved to: ${csvPath}`);
      console.log(`  ${manualResearch.length} companies need manual research`);
    }

    // ========================================
    // SAVE RESULTS
    // ========================================
    console.log('\n--- SAVING RESULTS ---\n');

    const outputPath = path.join(OUTPUT_DIR, 'phase2-high-value.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}`);

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 2 SUMMARY');
    console.log('='.repeat(70));

    console.log(`\nTargets Identified:`);
    console.log(`  REITs:       ${results.targets.reits.length}`);
    console.log(`  Nonprofits:  ${results.targets.nonprofits.length}`);
    console.log(`  Operators:   ${results.targets.operators.length}`);

    console.log(`\nEnriched (${DRY_RUN ? 'would be' : 'actual'}):`);
    console.log(`  REITs:       ${results.enriched.reits.companies} companies, ${results.enriched.reits.principals} principals`);
    console.log(`  Nonprofits:  ${results.enriched.nonprofits.companies} companies, ${results.enriched.nonprofits.principals} principals`);
    console.log(`  Operators:   ${results.enriched.operators.companies} companies, ${results.enriched.operators.principals} principals`);

    if (results.errors.length > 0) {
      console.log(`\nErrors/Warnings: ${results.errors.length}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('PHASE 2 COMPLETE');
    console.log('='.repeat(70));

    return results;

  } finally {
    await atlas.end();
  }
}

/**
 * Get officers from SEC filings (stub - would use SEC API in production)
 */
async function getSecOfficers(atlas, cik, companyId) {
  // Check if we have cached SEC officer data
  const [cached] = await atlas.query(`
    SELECT officer_name, officer_title, filing_date
    FROM sec_officers_cache
    WHERE company_id = ? AND filing_date > DATE_SUB(NOW(), INTERVAL 2 YEAR)
    ORDER BY filing_date DESC
  `, [companyId]).catch(() => [[]]);

  if (cached && cached.length > 0) {
    return cached.map(c => ({
      name: c.officer_name,
      title: c.officer_title,
      source: 'sec_cache'
    }));
  }

  // In production, would call SEC EDGAR API here
  // For now, return empty - manual research needed
  return [];
}

/**
 * Get officers from 990 filings (stub - would use ProPublica API in production)
 */
async function get990Officers(atlas, ein, companyId) {
  // Check if we have cached 990 officer data
  const [cached] = await atlas.query(`
    SELECT officer_name, officer_title, tax_year
    FROM nonprofit_officers_cache
    WHERE company_id = ? AND tax_year >= YEAR(NOW()) - 2
    ORDER BY tax_year DESC
  `, [companyId]).catch(() => [[]]);

  if (cached && cached.length > 0) {
    return cached.map(c => ({
      name: c.officer_name,
      title: c.officer_title,
      source: 'nonprofit_cache'
    }));
  }

  // In production, would call ProPublica Nonprofit Explorer API here
  return [];
}

/**
 * Create principals from officer list
 */
async function createPrincipalsFromOfficers(atlas, companyId, officers, source) {
  let created = 0;

  for (const officer of officers) {
    try {
      // Parse name
      const nameParts = officer.name.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts[nameParts.length - 1] || '';
      const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';
      const fullName = officer.name.trim();

      // Check if principal already exists
      const [[existing]] = await atlas.query(`
        SELECT id FROM principals
        WHERE normalized_full_name = UPPER(?)
        LIMIT 1
      `, [fullName]);

      let principalId;

      if (existing) {
        principalId = existing.id;
      } else {
        // Create new principal
        const [result] = await atlas.query(`
          INSERT INTO principals (first_name, middle_name, last_name, full_name, normalized_full_name, title, principal_source)
          VALUES (?, ?, ?, ?, UPPER(?), ?, ?)
        `, [firstName, middleName, lastName, fullName, fullName, officer.title, source === 'sec' ? 'sec' : 'nonprofit']);

        principalId = result.insertId;
      }

      // Map role
      const roleLower = (officer.title || '').toLowerCase();
      let role = 'officer';
      for (const [pattern, mappedRole] of Object.entries(source === 'sec' ? SEC_ROLE_MAPPING : NONPROFIT_ROLE_MAPPING)) {
        if (roleLower.includes(pattern)) {
          role = mappedRole;
          break;
        }
      }

      // Create relationship
      await atlas.query(`
        INSERT INTO principal_company_relationships
          (principal_id, company_id, role, role_detail, data_source)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE updated_at = NOW()
      `, [principalId, companyId, role, officer.title, source === 'sec' ? 'manual' : 'manual']);

      created++;
    } catch (err) {
      console.log(`      Error creating principal ${officer.name}: ${err.message}`);
    }
  }

  return created;
}

/**
 * Create principals from CMS officer data
 */
async function createPrincipalsFromCms(atlas, companyId, cmsOfficers) {
  let created = 0;

  for (const officer of cmsOfficers) {
    try {
      const fullName = [officer.first_name, officer.middle_name, officer.last_name]
        .filter(Boolean)
        .map(s => s.trim())
        .join(' ');

      if (!fullName) continue;

      // Check if principal already exists by CMS associate ID
      let [[existing]] = await atlas.query(`
        SELECT id FROM principals
        WHERE cms_associate_id_owner = ?
        LIMIT 1
      `, [officer.associate_id_owner]);

      if (!existing) {
        // Check by normalized name
        [[existing]] = await atlas.query(`
          SELECT id FROM principals
          WHERE normalized_full_name = UPPER(?)
          LIMIT 1
        `, [fullName]);
      }

      let principalId;

      if (existing) {
        principalId = existing.id;
      } else {
        // Create new principal
        const [result] = await atlas.query(`
          INSERT INTO principals
            (first_name, middle_name, last_name, full_name, normalized_full_name, title, cms_associate_id_owner, principal_source)
          VALUES (?, ?, ?, ?, UPPER(?), ?, ?, 'cms_only')
        `, [
          officer.first_name?.trim(),
          officer.middle_name?.trim(),
          officer.last_name?.trim(),
          fullName,
          fullName,
          officer.title?.trim(),
          officer.associate_id_owner
        ]);

        principalId = result.insertId;
      }

      // Map CMS role
      const roleMap = {
        '34': 'owner',
        '35': 'owner',
        '40': 'officer',
        '41': 'director',
        '42': 'managing_employee',
        '43': 'manager',
        '44': 'other',
        '45': 'other'
      };
      const role = roleMap[officer.role_code] || 'other';

      // Parse ownership percentage
      let ownershipPct = null;
      if (officer.percentage_ownership && /^[\d.]+$/.test(officer.percentage_ownership)) {
        ownershipPct = parseFloat(officer.percentage_ownership);
      }

      // Create relationship
      await atlas.query(`
        INSERT INTO principal_company_relationships
          (principal_id, company_id, role, role_detail, cms_role_code, ownership_percentage, data_source)
        VALUES (?, ?, ?, ?, ?, ?, 'cms')
        ON DUPLICATE KEY UPDATE updated_at = NOW()
      `, [principalId, companyId, role, officer.role_text, officer.role_code, ownershipPct]);

      created++;
    } catch (err) {
      console.log(`      Error creating principal: ${err.message}`);
    }
  }

  return created;
}

enrichHighValueCompanies().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
