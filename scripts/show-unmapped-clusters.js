#!/usr/bin/env node
/**
 * Show unmapped address clusters for propco mapping
 */
const { getAtlasConnection, getReapiConnection } = require('./lib/db-config');

async function main() {
  const atlas = await getAtlasConnection();
  const reapi = await getReapiConnection();

  // Get CCNs that already have propco links
  const [linked] = await atlas.execute(`
    SELECT DISTINCT pm.ccn
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    WHERE per.relationship_type = 'property_owner'
  `);
  const linkedCcns = new Set(linked.map(r => r.ccn));
  console.log(`Properties already linked: ${linkedCcns.size}`);

  // Get all properties from REAPI with mailing addresses
  const [props] = await reapi.execute(`
    SELECT
      rp.ccn,
      roi.owner1_full_name,
      roi.mail_address,
      roi.mail_city,
      roi.mail_state
    FROM reapi_owner_info roi
    JOIN reapi_properties rp ON rp.property_id = roi.property_id
    WHERE roi.mail_address IS NOT NULL AND roi.mail_address != ''
  `);
  console.log(`Total REAPI properties with mail address: ${props.length}`);

  // Filter to unmapped properties and group by address
  const addressMap = new Map();
  let unmappedCount = 0;

  props.forEach(p => {
    if (linkedCcns.has(p.ccn)) return; // Skip already linked
    unmappedCount++;

    const addr = p.mail_address?.trim();
    if (!addr) return;

    const key = `${addr}|${p.mail_city}|${p.mail_state}`;
    if (!addressMap.has(key)) {
      addressMap.set(key, {
        address: addr,
        city: p.mail_city,
        state: p.mail_state,
        count: 0,
        owners: new Set()
      });
    }
    const entry = addressMap.get(key);
    entry.count++;
    if (p.owner1_full_name) entry.owners.add(p.owner1_full_name);
  });

  // Sort by count descending
  const sorted = [...addressMap.values()].sort((a, b) => b.count - a.count);

  console.log('');
  console.log('='.repeat(80));
  console.log('UNMAPPED ADDRESS CLUSTERS');
  console.log('='.repeat(80));
  console.log(`Unique unmapped addresses: ${addressMap.size}`);
  console.log(`Total unmapped properties: ${unmappedCount}`);
  console.log('');

  // Show top 60 clusters
  console.log('Top 60 unmapped clusters:');
  console.log('-'.repeat(80));

  sorted.slice(0, 60).forEach((a, i) => {
    const ownerSample = [...a.owners].slice(0, 2).join('; ');
    const ownerStr = ownerSample ? `\n    Owners: ${ownerSample.substring(0, 70)}` : '';
    console.log(`${String(i + 1).padStart(2)}. ${a.address}`);
    console.log(`    ${a.city}, ${a.state} - ${a.count} properties${ownerStr}`);
    console.log('');
  });

  // Summary by state
  const stateMap = new Map();
  sorted.forEach(a => {
    const st = a.state || 'Unknown';
    stateMap.set(st, (stateMap.get(st) || 0) + a.count);
  });

  const sortedStates = [...stateMap.entries()].sort((a, b) => b[1] - a[1]);
  console.log('-'.repeat(80));
  console.log('Unmapped properties by state:');
  sortedStates.slice(0, 15).forEach(([st, cnt]) => {
    console.log(`  ${st}: ${cnt}`);
  });

  await atlas.end();
  await reapi.end();
}

main().catch(console.error);
