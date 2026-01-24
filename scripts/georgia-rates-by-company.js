/**
 * Georgia Medicaid Rates Summary by Company
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const DB_CONFIG = {
  host: 'YOUR_DB_HOST_HERE',
  port: 25060,
  user: 'YOUR_DB_USER_HERE',
  password: 'YOUR_DB_PASSWORD_HERE',
  database: 'cms_data',
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30000
};

// Parse the CSV file
function parseRatesCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  const rates = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const rate = {};
    headers.forEach((h, idx) => {
      rate[h.trim()] = values[idx]?.trim().replace(/^"|"$/g, '');
    });
    if (rate.daily_rate) {
      rate.daily_rate = parseFloat(rate.daily_rate);
    }
    rates.push(rate);
  }
  return rates;
}

async function main() {
  // Load rates from CSV
  const ratesFile = path.join(__dirname, '..', 'data', 'medicaid_rates', 'compiled', 'GA_2026-01_rates.csv');
  const rates = parseRatesCSV(ratesFile);

  console.log(`\n=== GEORGIA MEDICAID RATES BY COMPANY ===`);
  console.log(`Rate data effective: 2026-01-01`);
  console.log(`Total facilities with rates: ${rates.length}\n`);

  // Connect to database
  const conn = await mysql.createConnection(DB_CONFIG);

  // Get facility names and company affiliations
  const [latestMonth] = await conn.execute(`
    SELECT MAX(month_date) as latest FROM cms_facilities_monthly WHERE state = 'GA'
  `);
  const monthDate = latestMonth[0].latest;

  const [facilities] = await conn.execute(`
    SELECT
      ccn,
      provider_name,
      COALESCE(affiliated_entity_name, legal_business_name, 'Independent') as company_name,
      ownership_type,
      num_certified_beds,
      ROUND(census_percent, 1) as occupancy,
      overall_rating
    FROM cms_facilities_monthly
    WHERE state = 'GA' AND month_date = ?
  `, [monthDate]);

  // Create lookup by facility name (fuzzy matching)
  const facilityMap = new Map();
  for (const f of facilities) {
    facilityMap.set(f.provider_name.toUpperCase().replace(/[^A-Z0-9]/g, ''), f);
    // Also try without common suffixes
    const simplified = f.provider_name.toUpperCase()
      .replace(/LLC|INC|NURSING|REHABILITATION|REHAB|CENTER|HEALTH|CARE|AND|THE|OF/g, '')
      .replace(/[^A-Z0-9]/g, '');
    if (simplified.length > 5) {
      facilityMap.set(simplified, f);
    }
  }

  // Match rates to facilities
  const matched = [];
  const unmatched = [];

  for (const rate of rates) {
    const rateName = rate.facility_name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const simplified = rate.facility_name.toUpperCase()
      .replace(/LLC|INC|NURSING|REHABILITATION|REHAB|CENTER|HEALTH|CARE|AND|THE|OF/g, '')
      .replace(/[^A-Z0-9]/g, '');

    let facility = facilityMap.get(rateName) || facilityMap.get(simplified);

    // Try partial match
    if (!facility) {
      for (const [key, f] of facilityMap) {
        if (key.includes(simplified.substring(0, 10)) || simplified.includes(key.substring(0, 10))) {
          facility = f;
          break;
        }
      }
    }

    if (facility) {
      matched.push({
        ...rate,
        ccn: facility.ccn,
        company_name: facility.company_name,
        ownership_type: facility.ownership_type,
        beds: facility.num_certified_beds,
        occupancy: facility.occupancy,
        stars: facility.overall_rating
      });
    } else {
      unmatched.push(rate);
    }
  }

  console.log(`Matched to CMS data: ${matched.length} facilities`);
  console.log(`Unmatched: ${unmatched.length} facilities\n`);

  // Aggregate by company
  const byCompany = new Map();

  for (const m of matched) {
    if (!byCompany.has(m.company_name)) {
      byCompany.set(m.company_name, {
        company_name: m.company_name,
        facilities: [],
        rates: [],
        total_beds: 0
      });
    }
    const co = byCompany.get(m.company_name);
    co.facilities.push(m);
    co.rates.push(m.daily_rate);
    co.total_beds += m.beds || 0;
  }

  // Calculate stats
  const companyStats = [];
  for (const [name, data] of byCompany) {
    const rates = data.rates.filter(r => r && !isNaN(r));
    companyStats.push({
      company_name: name,
      facility_count: data.facilities.length,
      total_beds: data.total_beds,
      avg_rate: rates.length > 0 ? (rates.reduce((a, b) => a + b, 0) / rates.length) : null,
      min_rate: rates.length > 0 ? Math.min(...rates) : null,
      max_rate: rates.length > 0 ? Math.max(...rates) : null,
      rate_spread: rates.length > 1 ? Math.max(...rates) - Math.min(...rates) : 0,
      facilities: data.facilities
    });
  }

  // Sort by facility count
  companyStats.sort((a, b) => b.facility_count - a.facility_count);

  // Print summary by company
  console.log('='.repeat(120));
  console.log('MEDICAID RATES BY COMPANY');
  console.log('='.repeat(120));
  console.log('\nCompany Name                                          | Fac | Beds  | Avg Rate | Min Rate | Max Rate | Spread');
  console.log('-'.repeat(120));

  for (const co of companyStats.slice(0, 50)) {
    console.log(
      `${co.company_name.substring(0, 52).padEnd(52)} | ` +
      `${String(co.facility_count).padStart(3)} | ` +
      `${String(co.total_beds).padStart(5)} | ` +
      `$${co.avg_rate ? co.avg_rate.toFixed(2).padStart(7) : '    N/A'} | ` +
      `$${co.min_rate ? co.min_rate.toFixed(2).padStart(7) : '    N/A'} | ` +
      `$${co.max_rate ? co.max_rate.toFixed(2).padStart(7) : '    N/A'} | ` +
      `$${co.rate_spread ? co.rate_spread.toFixed(2).padStart(6) : '   N/A'}`
    );
  }

  // State-wide rate statistics
  const allRates = matched.map(m => m.daily_rate).filter(r => r && !isNaN(r));
  console.log('\n\n' + '='.repeat(120));
  console.log('GEORGIA STATE-WIDE MEDICAID RATE STATISTICS');
  console.log('='.repeat(120));
  console.log(`
  Total Facilities with Rates: ${allRates.length}

  RATE STATISTICS
  ---------------
  Average Daily Rate:     $${(allRates.reduce((a, b) => a + b, 0) / allRates.length).toFixed(2)}
  Minimum Daily Rate:     $${Math.min(...allRates).toFixed(2)}
  Maximum Daily Rate:     $${Math.max(...allRates).toFixed(2)}
  Rate Spread:            $${(Math.max(...allRates) - Math.min(...allRates)).toFixed(2)}

  RATE PERCENTILES
  ----------------
  25th Percentile:        $${allRates.sort((a, b) => a - b)[Math.floor(allRates.length * 0.25)].toFixed(2)}
  50th Percentile (Med):  $${allRates.sort((a, b) => a - b)[Math.floor(allRates.length * 0.5)].toFixed(2)}
  75th Percentile:        $${allRates.sort((a, b) => a - b)[Math.floor(allRates.length * 0.75)].toFixed(2)}
  `);

  // Detailed facility list with rates
  console.log('\n' + '='.repeat(140));
  console.log('DETAILED FACILITY RATES (Grouped by Company)');
  console.log('='.repeat(140));

  let currentCompany = '';
  for (const co of companyStats) {
    console.log(`\n>>> ${co.company_name} (Avg: $${co.avg_rate?.toFixed(2) || 'N/A'}/day)`);
    console.log('-'.repeat(140));
    console.log('Facility Name                                    | Daily Rate | Beds | Occ%  | Stars');
    console.log('-'.repeat(140));

    for (const f of co.facilities.sort((a, b) => (b.daily_rate || 0) - (a.daily_rate || 0))) {
      console.log(
        `${f.facility_name.substring(0, 47).padEnd(47)} | ` +
        `$${f.daily_rate ? f.daily_rate.toFixed(2).padStart(9) : '      N/A'} | ` +
        `${String(f.beds || '-').padStart(4)} | ` +
        `${String(f.occupancy || '-').padStart(4)}% | ` +
        `${String(f.stars || '-').padStart(5)}`
      );
    }
  }

  await conn.end();
  console.log('\n=== END OF RATES REPORT ===\n');
}

main().catch(console.error);
