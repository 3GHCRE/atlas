#!/usr/bin/env node
/**
 * Diagnose why configured addresses aren't matching
 */
const { getAtlasConnection, getReapiConnection } = require('./lib/db-config');

async function main() {
  const atlas = await getAtlasConnection();
  const reapi = await getReapiConnection();

  // Test address: Omega Healthcare
  const testAddr = '303 International Cir Ste 200';

  console.log(`\nDiagnosing: "${testAddr}"\n`);
  console.log('='.repeat(60));

  // 1. Check total properties with this address in REAPI
  const [allProps] = await reapi.execute(`
    SELECT COUNT(*) as cnt FROM reapi_owner_info
    WHERE mail_address LIKE ?
  `, [`%${testAddr}%`]);
  console.log(`Total REAPI properties with address: ${allProps[0].cnt}`);

  // 2. Check how many have owner1_type = 'Company'
  const [companyProps] = await reapi.execute(`
    SELECT COUNT(*) as cnt FROM reapi_owner_info
    WHERE mail_address LIKE ? AND owner1_type = 'Company'
  `, [`%${testAddr}%`]);
  console.log(`With owner1_type='Company': ${companyProps[0].cnt}`);

  // 3. Check owner1_type distribution
  const [typeDistrib] = await reapi.execute(`
    SELECT owner1_type, COUNT(*) as cnt
    FROM reapi_owner_info
    WHERE mail_address LIKE ?
    GROUP BY owner1_type
    ORDER BY cnt DESC
  `, [`%${testAddr}%`]);
  console.log('\nOwner type distribution:');
  typeDistrib.forEach(r => console.log(`  ${r.owner1_type || 'NULL'}: ${r.cnt}`));

  // 4. Check how many are already linked in Atlas
  const [linkedCcns] = await reapi.execute(`
    SELECT rp.ccn
    FROM reapi_owner_info roi
    JOIN reapi_properties rp ON rp.property_id = roi.property_id
    WHERE roi.mail_address LIKE ?
  `, [`%${testAddr}%`]);

  const ccnList = linkedCcns.map(r => r.ccn);

  const [alreadyLinked] = await atlas.execute(`
    SELECT COUNT(DISTINCT pm.ccn) as cnt
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    WHERE per.relationship_type = 'property_owner'
    AND pm.ccn IN (${ccnList.map(() => '?').join(',')})
  `, ccnList);

  console.log(`\nAlready linked in Atlas: ${alreadyLinked[0].cnt}`);
  console.log(`Not yet linked: ${ccnList.length - alreadyLinked[0].cnt}`);

  // 5. Sample unlinked
  const [unlinked] = await reapi.execute(`
    SELECT roi.owner1_full_name, roi.owner1_type, roi.mail_address, rp.ccn
    FROM reapi_owner_info roi
    JOIN reapi_properties rp ON rp.property_id = roi.property_id
    WHERE roi.mail_address LIKE ?
    LIMIT 10
  `, [`%${testAddr}%`]);

  console.log('\nSample properties:');
  for (const row of unlinked) {
    // Check if linked
    const [[linked]] = await atlas.execute(`
      SELECT COUNT(*) as cnt FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      WHERE pm.ccn = ? AND per.relationship_type = 'property_owner'
    `, [row.ccn]);

    const status = linked.cnt > 0 ? '✓' : '✗';
    console.log(`  ${status} ${row.ccn}: ${row.owner1_full_name} (${row.owner1_type})`);
  }

  await atlas.end();
  await reapi.end();
}

main().catch(console.error);
