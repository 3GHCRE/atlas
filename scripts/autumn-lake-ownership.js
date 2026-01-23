#!/usr/bin/env node
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'devpass',
    database: 'atlas'
  });

  // Get all Autumn Lake CCNs
  const [props] = await conn.execute(`
    SELECT ccn, facility_name, city, state
    FROM property_master
    WHERE facility_name LIKE '%AUTUMN LAKE%'
    ORDER BY state, city
  `);

  const ccns = props.map(p => p.ccn);

  console.log('='.repeat(80));
  console.log('AUTUMN LAKE HEALTHCARE - OWNERSHIP NETWORK ANALYSIS');
  console.log('='.repeat(80));
  console.log(`\nAnalyzing ${props.length} properties...\n`);

  // Get all owners across these properties
  const [owners] = await conn.execute(`
    SELECT
      o.type_owner,
      CASE
        WHEN o.type_owner = 'I' THEN CONCAT(COALESCE(o.first_name_owner, ''), ' ', COALESCE(o.last_name_owner, ''))
        ELSE o.organization_name_owner
      END as owner_name,
      o.role_text_owner,
      o.percentage_ownership,
      o.city_owner,
      o.state_owner,
      e.ccn,
      o.llc_owner,
      o.corporation_owner,
      o.holding_company_owner,
      o.private_equity_company_owner,
      o.reit_owner
    FROM cms_enrollments_staging e
    JOIN cms_owners_staging o ON o.associate_id = e.associate_id
    WHERE e.ccn IN (${ccns.map(() => '?').join(',')})
    ORDER BY o.type_owner, owner_name
  `, ccns);

  // Group owners by name and count properties
  const ownerMap = new Map();

  owners.forEach(o => {
    const name = o.owner_name?.trim();
    if (!name) return;

    if (!ownerMap.has(name)) {
      ownerMap.set(name, {
        name,
        type: o.type_owner,
        role: o.role_text_owner,
        ownership: o.percentage_ownership,
        location: o.city_owner && o.state_owner ? `${o.city_owner}, ${o.state_owner}` : null,
        entityType: o.llc_owner === 'Y' ? 'LLC' :
                    o.corporation_owner === 'Y' ? 'Corp' :
                    o.holding_company_owner === 'Y' ? 'Holding Co' :
                    o.private_equity_company_owner === 'Y' ? 'PE' :
                    o.reit_owner === 'Y' ? 'REIT' : null,
        ccns: new Set()
      });
    }
    ownerMap.get(name).ccns.add(o.ccn);
  });

  // Sort by number of properties
  const sortedOwners = [...ownerMap.values()].sort((a, b) => b.ccns.size - a.ccns.size);

  // Individuals with ownership across multiple properties
  const multiPropIndividuals = sortedOwners.filter(o => o.type === 'I' && o.ccns.size > 1);
  const multiPropOrgs = sortedOwners.filter(o => o.type === 'O' && o.ccns.size > 1);

  console.log('--- KEY INDIVIDUALS (appearing at multiple properties) ---\n');

  multiPropIndividuals.slice(0, 20).forEach(o => {
    console.log(`${o.name}`);
    console.log(`  Properties: ${o.ccns.size}`);
    if (o.role) console.log(`  Role: ${o.role}`);
    if (o.ownership && o.ownership !== '0') console.log(`  Ownership: ${o.ownership}%`);
    if (o.location) console.log(`  Location: ${o.location}`);
    console.log('');
  });

  console.log('\n--- KEY ORGANIZATIONS (appearing at multiple properties) ---\n');

  multiPropOrgs.slice(0, 20).forEach(o => {
    const typeStr = o.entityType ? ` (${o.entityType})` : '';
    console.log(`${o.name}${typeStr}`);
    console.log(`  Properties: ${o.ccns.size}`);
    if (o.role) console.log(`  Role: ${o.role}`);
    if (o.ownership && o.ownership !== '0') console.log(`  Ownership: ${o.ownership}%`);
    if (o.location) console.log(`  Location: ${o.location}`);
    console.log('');
  });

  // Summary stats
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total unique owners/principals: ${ownerMap.size}`);
  console.log(`Individuals at multiple properties: ${multiPropIndividuals.length}`);
  console.log(`Organizations at multiple properties: ${multiPropOrgs.length}`);

  // Top controller
  if (multiPropIndividuals.length > 0) {
    const top = multiPropIndividuals[0];
    console.log(`\nTop individual: ${top.name} (${top.ccns.size} properties)`);
  }
  if (multiPropOrgs.length > 0) {
    const top = multiPropOrgs[0];
    console.log(`Top organization: ${top.name} (${top.ccns.size} properties)`);
  }

  await conn.end();
}

main().catch(console.error);
