/**
 * Load deal parties (buyers, sellers, borrowers) as companies/entities
 * and create property relationships for bidirectional navigation
 *
 * Optimized version with bulk operations
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

function normalizeName(name) {
  if (!name) return '';
  return name.toUpperCase()
    .replace(/[.,\-'"]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bLLC\b/g, '')
    .replace(/\bINC\b/g, '')
    .replace(/\bCORP\b/g, '')
    .replace(/\bCORPORATION\b/g, '')
    .replace(/\bL\.?P\.?\b/g, '')
    .replace(/\bLTD\b/g, '')
    .replace(/\bTHE\b/g, '')
    .replace(/\bCO\b$/, '')
    .trim();
}

async function loadDealParties() {
  const atlas = await mysql.createConnection({
    host: process.env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
    user: process.env.LOCAL_DB_USER || 'root',
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME || 'atlas'
  });

  console.log('=== LOADING DEAL PARTIES (BUYERS, SELLERS, BORROWERS) ===\n');

  // Step 1: Update entity_type enum
  console.log('--- Updating entity_type enum ---\n');
  try {
    await atlas.execute(`
      ALTER TABLE entities
      MODIFY COLUMN entity_type ENUM('opco','propco','management','holding','pe_firm','reit','lender','buyer','seller','borrower','other') NOT NULL
    `);
    console.log('Updated entity_type enum');
  } catch (err) {
    console.log('entity_type already updated or error:', err.message);
  }

  // Step 2: Update relationship_type enum
  console.log('\n--- Updating relationship_type enum ---\n');
  try {
    await atlas.execute(`
      ALTER TABLE property_entity_relationships
      MODIFY COLUMN relationship_type ENUM('property_owner','facility_operator','management_services','lender','property_buyer','property_seller','property_borrower','parent_company','affiliate','consultant','other') NOT NULL
    `);
    console.log('Updated relationship_type enum');
  } catch (err) {
    console.log('relationship_type already updated or error:', err.message);
  }

  // Step 3: Build lookup map of existing companies (normalized name -> company)
  console.log('\n--- Building company lookup map ---\n');
  const [existingCompanies] = await atlas.execute(`
    SELECT id, company_name, company_type FROM companies
    WHERE company_name NOT LIKE '[MERGED]%'
  `);

  const companyLookup = new Map();
  for (const company of existingCompanies) {
    const normalized = normalizeName(company.company_name);
    if (!companyLookup.has(normalized)) {
      companyLookup.set(normalized, company);
    }
  }
  console.log(`Loaded ${companyLookup.size} companies into lookup map`);

  // Step 4: Build lookup map of existing entities
  const [existingEntities] = await atlas.execute(`
    SELECT id, entity_name, entity_type, company_id FROM entities
  `);
  const entityLookup = new Map(); // key: company_id + entity_type
  for (const entity of existingEntities) {
    const key = `${entity.company_id}_${entity.entity_type}`;
    entityLookup.set(key, entity);
  }
  console.log(`Loaded ${entityLookup.size} entities into lookup map`);

  // Process each party role
  const partyRoles = ['buyer', 'seller', 'borrower'];
  const relationshipTypes = {
    'buyer': 'property_buyer',
    'seller': 'property_seller',
    'borrower': 'property_borrower'
  };

  const stats = {
    companiesCreated: 0,
    entitiesCreated: 0,
    relationshipsCreated: 0,
    linkedToExisting: 0,
    skippedSingleDeal: 0
  };

  for (const role of partyRoles) {
    console.log(`\n--- Processing ${role}s ---\n`);

    // Get all parties for this role with property info
    const [parties] = await atlas.execute(`
      SELECT dp.party_name,
             COUNT(DISTINCT dp.deal_id) as deal_count,
             COUNT(DISTINCT d.property_master_id) as property_count,
             GROUP_CONCAT(DISTINCT d.property_master_id) as property_ids
      FROM deals_parties dp
      JOIN deals d ON d.id = dp.deal_id
      WHERE dp.party_role = ?
        AND dp.party_name IS NOT NULL
        AND dp.party_name != ''
        AND d.property_master_id IS NOT NULL
      GROUP BY dp.party_name
      ORDER BY deal_count DESC
    `, [role]);

    console.log(`Found ${parties.length} unique ${role}s`);

    // Show top parties
    console.log(`Top 5 ${role}s:`);
    parties.slice(0, 5).forEach(p => {
      console.log(`  ${p.party_name}: ${p.deal_count} deals`);
    });

    let roleStats = { companies: 0, entities: 0, rels: 0, linked: 0, skipped: 0 };

    for (const party of parties) {
      const normalizedName = normalizeName(party.party_name);
      const propertyIds = party.property_ids ? party.property_ids.split(',').filter(id => id) : [];

      if (propertyIds.length === 0) continue;

      // Try to find existing company
      let existingCompany = companyLookup.get(normalizedName);

      let companyId;
      let entityId;

      if (existingCompany) {
        // Use existing company
        companyId = existingCompany.id;
        roleStats.linked++;

        // Find or create entity
        const entityKey = `${companyId}_${role}`;
        let entity = entityLookup.get(entityKey);

        if (entity) {
          entityId = entity.id;
        } else {
          // Create entity
          const [result] = await atlas.execute(`
            INSERT INTO entities (entity_name, entity_type, company_id)
            VALUES (?, ?, ?)
          `, [party.party_name, role, companyId]);
          entityId = result.insertId;
          entityLookup.set(entityKey, { id: entityId, entity_name: party.party_name, entity_type: role, company_id: companyId });
          roleStats.entities++;
        }
      } else {
        // Only create new company for parties with 2+ deals
        if (party.deal_count < 2) {
          roleStats.skipped++;
          continue;
        }

        // Create new company
        const [companyResult] = await atlas.execute(`
          INSERT INTO companies (company_name, company_type)
          VALUES (?, 'other')
        `, [party.party_name]);
        companyId = companyResult.insertId;
        companyLookup.set(normalizedName, { id: companyId, company_name: party.party_name, company_type: 'other' });
        roleStats.companies++;

        // Create entity
        const [entityResult] = await atlas.execute(`
          INSERT INTO entities (entity_name, entity_type, company_id)
          VALUES (?, ?, ?)
        `, [party.party_name, role, companyId]);
        entityId = entityResult.insertId;
        const entityKey = `${companyId}_${role}`;
        entityLookup.set(entityKey, { id: entityId, entity_name: party.party_name, entity_type: role, company_id: companyId });
        roleStats.entities++;
      }

      // Create property relationships
      const relType = relationshipTypes[role];
      for (const propId of propertyIds) {
        try {
          await atlas.execute(`
            INSERT INTO property_entity_relationships (property_master_id, entity_id, relationship_type)
            VALUES (?, ?, ?)
          `, [propId, entityId, relType]);
          roleStats.rels++;
        } catch (err) {
          // Skip duplicates silently
        }
      }
    }

    console.log(`\n${role} results:`);
    console.log(`  Companies created: ${roleStats.companies}`);
    console.log(`  Entities created: ${roleStats.entities}`);
    console.log(`  Relationships created: ${roleStats.rels}`);
    console.log(`  Linked to existing: ${roleStats.linked}`);
    console.log(`  Skipped (single deal): ${roleStats.skipped}`);

    stats.companiesCreated += roleStats.companies;
    stats.entitiesCreated += roleStats.entities;
    stats.relationshipsCreated += roleStats.rels;
    stats.linkedToExisting += roleStats.linked;
    stats.skippedSingleDeal += roleStats.skipped;
  }

  // Summary
  console.log('\n\n=== FINAL SUMMARY ===\n');
  console.log(`Total companies created: ${stats.companiesCreated}`);
  console.log(`Total entities created: ${stats.entitiesCreated}`);
  console.log(`Total relationships created: ${stats.relationshipsCreated}`);
  console.log(`Linked to existing companies: ${stats.linkedToExisting}`);
  console.log(`Skipped single-deal parties: ${stats.skippedSingleDeal}`);

  // Relationship type counts
  const [relCounts] = await atlas.execute(`
    SELECT relationship_type, COUNT(*) as count,
           COUNT(DISTINCT property_master_id) as properties
    FROM property_entity_relationships
    GROUP BY relationship_type
    ORDER BY count DESC
  `);

  console.log('\nRelationship types:');
  relCounts.forEach(r => console.log(`  ${r.relationship_type}: ${r.count} (${r.properties} properties)`));

  await atlas.end();
}

loadDealParties().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
