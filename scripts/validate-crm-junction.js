/**
 * Validate CRM Principal X Properties Junction against Atlas
 *
 * Compares CRM relationships to Atlas entity_property_relationships.
 * Does NOT modify Atlas data - generates discrepancy report only.
 *
 * Validation Status:
 * - matched: Both principal and property resolved, relationship exists in Atlas
 * - principal_only: Principal found, property not in Atlas
 * - property_only: Property found, principal not in Atlas
 * - unmatched: Neither principal nor property found
 * - conflict: Different relationship type in CRM vs Atlas
 *
 * Usage: node scripts/validate-crm-junction.js [output_csv_path]
 */

const fs = require('fs');
const path = require('path');
const { getAtlasConnection } = require('./lib/db-config');

const DEFAULT_OUTPUT = path.resolve(__dirname, '../data/crm_junction_validation_report.csv');

// ============================================
// ID Resolution Functions
// ============================================

async function resolvePrincipalId(atlas, zohoContactId) {
  if (!zohoContactId || !zohoContactId.startsWith('zcrm_')) return null;
  const [rows] = await atlas.query(
    'SELECT id, full_name FROM principals WHERE zoho_contact_id = ?',
    [zohoContactId]
  );
  return rows.length ? rows[0] : null;
}

async function resolvePropertyId(atlas, zohoAccountId) {
  if (!zohoAccountId || !zohoAccountId.startsWith('zcrm_')) return null;
  const [rows] = await atlas.query(
    'SELECT id, facility_name, ccn FROM property_master WHERE zoho_account_id = ?',
    [zohoAccountId]
  );
  return rows.length ? rows[0] : null;
}

// ============================================
// Check Atlas for existing relationship
// ============================================

async function checkAtlasRelationship(atlas, principalId, propertyId) {
  if (!principalId || !propertyId) return null;

  // Check via principal -> company -> entity -> property chain
  const [rows] = await atlas.query(`
    SELECT DISTINCT
      per.relationship_type,
      e.entity_name,
      c.company_name
    FROM principal_company_relationships pcr
    JOIN companies c ON c.id = pcr.company_id
    JOIN entities e ON e.company_id = c.id
    JOIN property_entity_relationships per ON per.entity_id = e.id
    WHERE pcr.principal_id = ?
      AND per.property_master_id = ?
      AND pcr.end_date IS NULL
      AND per.end_date IS NULL
    LIMIT 1
  `, [principalId, propertyId]);

  return rows.length ? rows[0] : null;
}

// ============================================
// Main Validation
// ============================================

async function validateJunction() {
  const outputPath = process.argv[2] || DEFAULT_OUTPUT;

  console.log('='.repeat(60));
  console.log('CRM JUNCTION VALIDATION');
  console.log('='.repeat(60));
  console.log(`Output: ${outputPath}`);
  console.log('');

  const atlas = await getAtlasConnection();
  console.log('Connected to Atlas database');

  try {
    // Get all junction records
    const [records] = await atlas.query(`
      SELECT *
      FROM crm_principal_properties_staging
      WHERE validation_status = 'pending' OR validation_status IS NULL
      ORDER BY id
    `);

    console.log(`Total junction records to validate: ${records.length}`);
    console.log('');

    const stats = {
      matched: 0,
      principal_only: 0,
      property_only: 0,
      unmatched: 0,
      conflict: 0,
      total: records.length
    };

    const results = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];

      // Resolve IDs
      const principal = await resolvePrincipalId(atlas, row.zoho_principal_id);
      const property = await resolvePropertyId(atlas, row.zoho_property_id);

      const principalId = principal?.id || null;
      const propertyId = property?.id || null;

      let status = 'unmatched';
      let notes = '';

      if (principalId && propertyId) {
        // Both found - check for Atlas relationship
        const atlasRel = await checkAtlasRelationship(atlas, principalId, propertyId);

        if (atlasRel) {
          // Check for relationship type conflict
          const crmType = (row.principal_type || '').toLowerCase();
          const atlasType = (atlasRel.relationship_type || '').toLowerCase();

          // Simple conflict detection (CRM types are different from Atlas types)
          // CRM: Type1, Type2, Administrator, Owner/Operator, etc.
          // Atlas: property_owner, facility_operator, lender
          if (crmType && atlasType) {
            // Map CRM types to Atlas equivalents for comparison
            const crmToAtlas = {
              'owner': 'property_owner',
              'owner/operator': 'property_owner',
              'operator': 'facility_operator',
              'type1': 'property_owner', // Assumption
              'type2': 'facility_operator' // Assumption
            };
            const mappedCrm = crmToAtlas[crmType] || crmType;

            if (mappedCrm !== atlasType && !atlasType.includes(mappedCrm)) {
              status = 'conflict';
              notes = `CRM type '${row.principal_type}' vs Atlas type '${atlasRel.relationship_type}'`;
              stats.conflict++;
            } else {
              status = 'matched';
              notes = `Via ${atlasRel.company_name} / ${atlasRel.entity_name}`;
              stats.matched++;
            }
          } else {
            status = 'matched';
            notes = `Via ${atlasRel.company_name} / ${atlasRel.entity_name}`;
            stats.matched++;
          }
        } else {
          // Both resolved but no relationship found in Atlas
          status = 'matched';
          notes = 'Both resolved but no direct Atlas relationship found';
          stats.matched++;
        }
      } else if (principalId && !propertyId) {
        status = 'principal_only';
        notes = `Principal: ${principal.full_name} (ID: ${principalId})`;
        stats.principal_only++;
      } else if (!principalId && propertyId) {
        status = 'property_only';
        notes = `Property: ${property.facility_name} / ${property.ccn} (ID: ${propertyId})`;
        stats.property_only++;
      } else {
        status = 'unmatched';
        notes = 'Neither principal nor property found in Atlas';
        stats.unmatched++;
      }

      // Update staging table
      await atlas.query(`
        UPDATE crm_principal_properties_staging
        SET resolved_principal_id = ?,
            resolved_property_id = ?,
            validation_status = ?,
            validation_notes = ?,
            validated_at = NOW()
        WHERE id = ?
      `, [principalId, propertyId, status, notes, row.id]);

      results.push({
        zoho_record_id: row.zoho_record_id,
        zoho_principal_id: row.zoho_principal_id,
        zoho_property_id: row.zoho_property_id,
        principal_name: row.principal_name,
        property_name: row.property_name,
        crm_principal_type: row.principal_type,
        license_number: row.license_number,
        resolved_principal_id: principalId,
        resolved_property_id: propertyId,
        validation_status: status,
        validation_notes: notes
      });

      if ((i + 1) % 500 === 0) {
        console.log(`  Validated ${i + 1} / ${records.length}...`);
      }
    }

    // Write CSV report
    console.log('\nWriting report...');

    const headers = Object.keys(results[0] || {});
    const csvContent = [
      headers.join(','),
      ...results.map(r =>
        headers.map(h => {
          const val = r[h] || '';
          // Quote if contains comma or newline
          return val.toString().includes(',') || val.toString().includes('\n')
            ? `"${val.toString().replace(/"/g, '""')}"`
            : val;
        }).join(',')
      )
    ].join('\n');

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, csvContent);
    console.log(`Report written to: ${outputPath}`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total junction records: ${stats.total}`);
    console.log('');
    console.log(`  Matched to Atlas:  ${stats.matched} (${Math.round(100 * stats.matched / stats.total)}%)`);
    console.log(`  Principal only:    ${stats.principal_only} (${Math.round(100 * stats.principal_only / stats.total)}%)`);
    console.log(`  Property only:     ${stats.property_only} (${Math.round(100 * stats.property_only / stats.total)}%)`);
    console.log(`  Unmatched:         ${stats.unmatched} (${Math.round(100 * stats.unmatched / stats.total)}%)`);
    console.log(`  Conflicts:         ${stats.conflict} (${Math.round(100 * stats.conflict / stats.total)}%)`);

    if (stats.conflict > 0) {
      console.log('\n** Review conflicts in the output CSV for manual resolution **');
    }

    // Query for sample conflicts
    if (stats.conflict > 0) {
      console.log('\nSample conflicts:');
      const [conflicts] = await atlas.query(`
        SELECT zoho_record_id, principal_name, property_name, validation_notes
        FROM crm_principal_properties_staging
        WHERE validation_status = 'conflict'
        LIMIT 5
      `);
      for (const c of conflicts) {
        console.log(`  - ${c.principal_name} / ${c.property_name}: ${c.validation_notes}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('DONE');
    console.log('='.repeat(60));

  } finally {
    await atlas.end();
  }
}

validateJunction().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
