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

  const [props] = await conn.execute(`
    SELECT
      pm.id,
      pm.ccn,
      pm.facility_name,
      pm.city,
      pm.state,
      pm.address,
      COUNT(DISTINCT CASE WHEN d.deal_type = 'chow' THEN d.id END) as chows,
      COUNT(DISTINCT CASE WHEN d.deal_type = 'sale' THEN d.id END) as sales,
      COUNT(DISTINCT CASE WHEN d.deal_type = 'mortgage' THEN d.id END) as mortgages
    FROM property_master pm
    LEFT JOIN deals d ON d.property_master_id = pm.id
    WHERE pm.facility_name LIKE '%AUTUMN LAKE%'
    GROUP BY pm.id, pm.ccn, pm.facility_name, pm.city, pm.state, pm.address
    ORDER BY pm.state, pm.city
  `);

  console.log('Autumn Lake Properties (' + props.length + ' total):\n');

  props.forEach(p => {
    console.log(`${p.facility_name}`);
    console.log(`  CCN: ${p.ccn} | ${p.city}, ${p.state}`);
    console.log(`  Deals: ${p.chows} CHOWs, ${p.sales} Sales, ${p.mortgages} Mortgages`);
    console.log('');
  });

  await conn.end();
}

main().catch(console.error);
