#!/usr/bin/env node

/**
 * Fix Contract Service Provider Relationships
 *
 * Problem: Principals who provide contract services (therapy, consulting) to
 * multiple nursing home operators got incorrectly linked to ALL those companies
 * as if they were owners/officers.
 *
 * Solution: For principals linked to 5+ unrelated companies, keep only the
 * company where they have the highest property count (likely their actual employer)
 * and end-date the other relationships.
 *
 * Affected principals are typically:
 * - Contract therapy providers (PT/OT/Speech)
 * - Group purchasing organization consultants
 * - Multi-facility service providers
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function fixContractServiceProviders() {
  const connection = await mysql.createConnection({
    host: '192.168.65.254',
    port: 3306,
    user: 'root',
    password: 'devpass',
    database: 'atlas'
  });

  console.log('='.repeat(80));
  console.log('FIX CONTRACT SERVICE PROVIDER RELATIONSHIPS');
  console.log('='.repeat(80));
  console.log();

  // Get the 17 remaining inflated principals (>5% ownership, >500 properties)
  const [inflated] = await connection.query(`
    SELECT
      p.id as principal_id,
      p.full_name,
      COUNT(DISTINCT pcr.company_id) as company_count,
      COUNT(DISTINCT pm.id) as property_count,
      GROUP_CONCAT(DISTINCT c.company_name ORDER BY c.company_name SEPARATOR ' | ') as companies
    FROM principals p
    JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
    JOIN companies c ON c.id = pcr.company_id
    LEFT JOIN entities e ON e.company_id = c.id
    LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
    LEFT JOIN property_master pm ON pm.id = per.property_master_id
    WHERE pcr.ownership_percentage > 5
    GROUP BY p.id, p.full_name
    HAVING property_count > 500
    ORDER BY property_count DESC
    LIMIT 50
  `);

  console.log(`Found ${inflated.length} inflated principals to fix:\n`);

  for (const principal of inflated) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Principal: ${principal.full_name} (ID: ${principal.principal_id})`);
    console.log(`Linked to ${principal.company_count} companies, ${principal.property_count} properties`);
    console.log(`Companies: ${principal.companies}`);

    // Get detailed company relationships with property counts
    const [companyRels] = await connection.query(`
      SELECT
        pcr.id as pcr_id,
        pcr.company_id,
        c.company_name,
        pcr.role,
        pcr.ownership_percentage,
        COUNT(DISTINCT pm.id) as property_count
      FROM principal_company_relationships pcr
      JOIN companies c ON c.id = pcr.company_id
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      WHERE pcr.principal_id = ?
        AND pcr.end_date IS NULL
      GROUP BY pcr.id, pcr.company_id, c.company_name, pcr.role, pcr.ownership_percentage
      ORDER BY property_count DESC
    `, [principal.principal_id]);

    console.log('\nCompany relationships:');
    for (const rel of companyRels) {
      console.log(`  - ${rel.company_name}: ${rel.property_count} properties (${rel.ownership_percentage || 0}% ownership, role: ${rel.role || 'unknown'})`);
    }

    // Identify the primary company (likely their actual employer)
    // Heuristics:
    // 1. "CASCADES HEALTHCARE" for the Cascades founders
    // 2. Company with highest individual ownership percentage
    // 3. If all same %, the one with most properties in their name

    const cascadesRel = companyRels.find(r =>
      r.company_name.includes('CASCADES') ||
      r.company_name.includes('INDEPENDENCE')
    );

    const primaryCompany = cascadesRel || companyRels[0];

    console.log(`\nPrimary company (keep): ${primaryCompany.company_name}`);

    // End-date relationships with other companies
    const otherCompanies = companyRels.filter(r => r.pcr_id !== primaryCompany.pcr_id);

    if (otherCompanies.length > 0) {
      console.log(`Will end-date ${otherCompanies.length} other relationships:`);

      for (const rel of otherCompanies) {
        console.log(`  - Ending: ${rel.company_name} (${rel.property_count} properties)`);

        // End-date the relationship and mark it as contract_service_provider
        await connection.query(`
          UPDATE principal_company_relationships
          SET end_date = CURDATE(),
              role_detail = CONCAT(COALESCE(role_detail, ''), ' | contract_service_provider - ended by audit fix 2026-01-28')
          WHERE id = ?
        `, [rel.pcr_id]);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  // Re-count after fix
  const [remaining] = await connection.query(`
    SELECT COUNT(*) as count
    FROM (
      SELECT p.id
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      JOIN companies c ON c.id = pcr.company_id
      LEFT JOIN entities e ON e.company_id = c.id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      LEFT JOIN property_master pm ON pm.id = per.property_master_id
      WHERE pcr.ownership_percentage > 5
      GROUP BY p.id
      HAVING COUNT(DISTINCT pm.id) > 500
    ) x
  `);

  console.log(`Remaining inflated principals (>5% ownership, >500 properties): ${remaining[0].count}`);

  await connection.end();
}

fixContractServiceProviders().catch(console.error);
