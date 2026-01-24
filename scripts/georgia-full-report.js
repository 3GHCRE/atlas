/**
 * Georgia Full Report - Generates comprehensive markdown report
 * Includes: Operating metrics, performance, rates, cost data by company
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
    if (rate.daily_rate) rate.daily_rate = parseFloat(rate.daily_rate);
    rates.push(rate);
  }
  return rates;
}

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);

  // Load rates
  const ratesFile = path.join(__dirname, '..', 'data', 'medicaid_rates', 'compiled', 'GA_2026-01_rates.csv');
  const rates = parseRatesCSV(ratesFile);
  const rateMap = new Map();
  for (const r of rates) {
    const key = r.facility_name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 20);
    rateMap.set(key, r.daily_rate);
  }

  // Get latest month
  const [latestMonth] = await conn.execute(`SELECT MAX(month_date) as latest FROM cms_facilities_monthly WHERE state = 'GA'`);
  const monthDate = latestMonth[0].latest;
  const reportDate = monthDate.toISOString().split('T')[0];

  let md = `# Georgia Skilled Nursing Facilities - Comprehensive Report

**Report Generated:** ${new Date().toISOString().split('T')[0]}
**CMS Data As Of:** ${reportDate}
**Medicaid Rates Effective:** 2026-01-01

---

## Table of Contents

1. [State Summary](#state-summary)
2. [Summary by Ownership Type](#summary-by-ownership-type)
3. [Top Operators by Facility Count](#top-operators-by-facility-count)
4. [Quality Performance by Company](#quality-performance-by-company)
5. [Staffing Metrics by Company](#staffing-metrics-by-company)
6. [Financial Estimates by Company](#financial-estimates-by-company)
7. [Medicaid Rates by Company](#medicaid-rates-by-company)
8. [Detailed Facility List](#detailed-facility-list)

---

`;

  // STATE SUMMARY
  const [stateSummary] = await conn.execute(`
    SELECT
      COUNT(*) as total_facilities,
      SUM(num_certified_beds) as total_beds,
      ROUND(AVG(census_percent), 1) as avg_occupancy,
      ROUND(AVG(overall_rating), 2) as avg_overall_rating,
      ROUND(AVG(health_inspection_rating), 2) as avg_health_rating,
      ROUND(AVG(staffing_rating), 2) as avg_staffing_rating,
      ROUND(AVG(qm_rating), 2) as avg_qm_rating,
      ROUND(AVG(reported_total_nurse_hprd), 2) as avg_total_hprd,
      ROUND(AVG(reported_rn_hprd), 2) as avg_rn_hprd,
      ROUND(AVG(total_nursing_staff_turnover), 1) as avg_turnover,
      SUM(num_fines) as total_fines_count,
      ROUND(SUM(total_fines_amount), 0) as total_fines_amount,
      SUM(CASE WHEN special_focus_status IS NOT NULL AND special_focus_status != '' THEN 1 ELSE 0 END) as sff_count,
      COUNT(DISTINCT COALESCE(affiliated_entity_name, legal_business_name)) as unique_companies
    FROM cms_facilities_monthly WHERE state = 'GA' AND month_date = ?
  `, [monthDate]);
  const s = stateSummary[0];

  md += `## State Summary

| Metric | Value |
|--------|-------|
| **Total Facilities** | ${s.total_facilities} |
| **Total Certified Beds** | ${s.total_beds?.toLocaleString()} |
| **Unique Companies** | ${s.unique_companies} |
| **Average Occupancy** | ${s.avg_occupancy}% |
| **Special Focus Facilities** | ${s.sff_count} |

### Quality Ratings (1-5 Stars)

| Rating Type | Average |
|-------------|---------|
| Overall | ${s.avg_overall_rating} |
| Health Inspection | ${s.avg_health_rating} |
| Staffing | ${s.avg_staffing_rating} |
| Quality Measures | ${s.avg_qm_rating} |

### Staffing Metrics

| Metric | Value |
|--------|-------|
| Total Nursing HPRD | ${s.avg_total_hprd} |
| RN HPRD | ${s.avg_rn_hprd} |
| Avg Staff Turnover | ${s.avg_turnover}% |

### Compliance & Penalties

| Metric | Value |
|--------|-------|
| Total Fines Count | ${s.total_fines_count} |
| Total Fines Amount | $${s.total_fines_amount?.toLocaleString()} |

---

`;

  // BY OWNERSHIP TYPE
  const [byOwnership] = await conn.execute(`
    SELECT
      ownership_type,
      COUNT(*) as facility_count,
      SUM(num_certified_beds) as total_beds,
      ROUND(AVG(census_percent), 1) as avg_occupancy,
      ROUND(AVG(overall_rating), 2) as avg_overall_rating,
      ROUND(AVG(health_inspection_rating), 2) as avg_health,
      ROUND(AVG(staffing_rating), 2) as avg_staffing,
      ROUND(AVG(reported_total_nurse_hprd), 2) as avg_hprd,
      ROUND(AVG(total_nursing_staff_turnover), 1) as avg_turnover,
      ROUND(SUM(total_fines_amount), 0) as total_fines
    FROM cms_facilities_monthly WHERE state = 'GA' AND month_date = ?
    GROUP BY ownership_type ORDER BY facility_count DESC
  `, [monthDate]);

  md += `## Summary by Ownership Type

| Ownership Type | Facilities | Beds | Occupancy | Stars | Health | Staffing | HPRD | Turnover | Fines |
|----------------|------------|------|-----------|-------|--------|----------|------|----------|-------|
`;
  for (const r of byOwnership) {
    md += `| ${r.ownership_type || 'Unknown'} | ${r.facility_count} | ${r.total_beds?.toLocaleString()} | ${r.avg_occupancy}% | ${r.avg_overall_rating} | ${r.avg_health} | ${r.avg_staffing} | ${r.avg_hprd} | ${r.avg_turnover}% | $${r.total_fines?.toLocaleString()} |\n`;
  }
  md += '\n---\n\n';

  // TOP OPERATORS
  const [byCompany] = await conn.execute(`
    SELECT
      COALESCE(affiliated_entity_name, legal_business_name, 'Independent') as company_name,
      COUNT(*) as facility_count,
      SUM(num_certified_beds) as total_beds,
      ROUND(AVG(census_percent), 1) as avg_occupancy,
      ROUND(AVG(overall_rating), 2) as avg_overall,
      ROUND(AVG(health_inspection_rating), 2) as avg_health,
      ROUND(AVG(staffing_rating), 2) as avg_staffing,
      ROUND(AVG(qm_rating), 2) as avg_qm,
      ROUND(AVG(reported_total_nurse_hprd), 2) as avg_hprd,
      ROUND(AVG(reported_rn_hprd), 2) as avg_rn_hprd,
      ROUND(AVG(total_nursing_staff_turnover), 1) as avg_turnover,
      SUM(num_fines) as fines_count,
      ROUND(SUM(total_fines_amount), 0) as total_fines,
      SUM(CASE WHEN special_focus_status IS NOT NULL AND special_focus_status != '' THEN 1 ELSE 0 END) as sff_count
    FROM cms_facilities_monthly WHERE state = 'GA' AND month_date = ?
    GROUP BY COALESCE(affiliated_entity_name, legal_business_name, 'Independent')
    ORDER BY facility_count DESC
  `, [monthDate]);

  md += `## Top Operators by Facility Count

| Company | Fac | Beds | Occ% | Stars | Health | Staff | QM | HPRD | RN | Turn% | Fines | SFF |
|---------|-----|------|------|-------|--------|-------|-----|------|-----|-------|-------|-----|
`;
  for (const r of byCompany.slice(0, 40)) {
    md += `| ${r.company_name} | ${r.facility_count} | ${r.total_beds?.toLocaleString()} | ${r.avg_occupancy}% | ${r.avg_overall} | ${r.avg_health} | ${r.avg_staffing} | ${r.avg_qm} | ${r.avg_hprd} | ${r.avg_rn_hprd} | ${r.avg_turnover}% | $${r.total_fines?.toLocaleString()} | ${r.sff_count} |\n`;
  }
  md += '\n---\n\n';

  // QUALITY BY COMPANY
  md += `## Quality Performance by Company

*Companies with 2+ facilities, sorted by overall rating*

| Company | Fac | Overall | Health | QM | Staffing | SFF | Abuse | Penalties |
|---------|-----|---------|--------|-----|----------|-----|-------|-----------|
`;
  const qualityCompanies = byCompany.filter(c => c.facility_count >= 2).sort((a, b) => (b.avg_overall || 0) - (a.avg_overall || 0));
  for (const r of qualityCompanies.slice(0, 30)) {
    const [extra] = await conn.execute(`
      SELECT SUM(CASE WHEN abuse_icon = 'Y' THEN 1 ELSE 0 END) as abuse, SUM(total_penalties) as penalties
      FROM cms_facilities_monthly WHERE state = 'GA' AND month_date = ?
      AND COALESCE(affiliated_entity_name, legal_business_name, 'Independent') = ?
    `, [monthDate, r.company_name]);
    md += `| ${r.company_name} | ${r.facility_count} | ${r.avg_overall} | ${r.avg_health} | ${r.avg_qm} | ${r.avg_staffing} | ${r.sff_count} | ${extra[0]?.abuse || 0} | ${extra[0]?.penalties || 0} |\n`;
  }
  md += '\n---\n\n';

  // STAFFING BY COMPANY
  const [staffing] = await conn.execute(`
    SELECT
      COALESCE(affiliated_entity_name, legal_business_name, 'Independent') as company_name,
      COUNT(*) as facility_count,
      ROUND(AVG(reported_total_nurse_hprd), 2) as total_hprd,
      ROUND(AVG(reported_rn_hprd), 2) as rn_hprd,
      ROUND(AVG(reported_lpn_hprd), 2) as lpn_hprd,
      ROUND(AVG(reported_nurse_aide_hprd), 2) as cna_hprd,
      ROUND(AVG(weekend_total_nurse_hprd), 2) as weekend_hprd,
      ROUND(AVG(total_nursing_staff_turnover), 1) as turnover,
      ROUND(AVG(rn_turnover), 1) as rn_turnover,
      ROUND(AVG(staffing_rating), 2) as staffing_rating
    FROM cms_facilities_monthly WHERE state = 'GA' AND month_date = ?
    GROUP BY COALESCE(affiliated_entity_name, legal_business_name, 'Independent')
    HAVING COUNT(*) >= 2 ORDER BY facility_count DESC
  `, [monthDate]);

  md += `## Staffing Metrics by Company

*Companies with 2+ facilities*

| Company | Fac | Total HPRD | RN | LPN | CNA | Weekend | Turnover | RN Turn | Rating |
|---------|-----|------------|-----|-----|-----|---------|----------|---------|--------|
`;
  for (const r of staffing.slice(0, 30)) {
    md += `| ${r.company_name} | ${r.facility_count} | ${r.total_hprd} | ${r.rn_hprd} | ${r.lpn_hprd} | ${r.cna_hprd} | ${r.weekend_hprd} | ${r.turnover}% | ${r.rn_turnover}% | ${r.staffing_rating} |\n`;
  }
  md += '\n---\n\n';

  // FINANCIAL BY COMPANY
  const [financial] = await conn.execute(`
    SELECT
      COALESCE(f.affiliated_entity_name, f.legal_business_name, 'Independent') as company_name,
      COUNT(*) as facility_count,
      ROUND(SUM(v.estimated_annual_revenue) / 1000000, 2) as total_rev_m,
      ROUND(AVG(v.estimated_annual_revenue) / 1000000, 2) as avg_rev_m,
      ROUND(AVG(v.estimated_margin_percent), 1) as avg_margin,
      ROUND(SUM(v.total_fines_amount), 0) as total_fines,
      SUM(v.num_payment_denials) as denials
    FROM cms_facilities_monthly f
    JOIN vw_facility_financial_summary v ON f.ccn = v.ccn AND f.month_date = v.month_date
    WHERE f.state = 'GA' AND f.month_date = ?
    GROUP BY COALESCE(f.affiliated_entity_name, f.legal_business_name, 'Independent')
    ORDER BY total_rev_m DESC LIMIT 40
  `, [monthDate]);

  md += `## Financial Estimates by Company

| Company | Fac | Total Rev ($M) | Avg Rev ($M) | Margin% | Fines | Denials |
|---------|-----|----------------|--------------|---------|-------|---------|
`;
  for (const r of financial) {
    md += `| ${r.company_name} | ${r.facility_count} | $${r.total_rev_m} | $${r.avg_rev_m} | ${r.avg_margin}% | $${r.total_fines?.toLocaleString()} | ${r.denials} |\n`;
  }
  md += '\n---\n\n';

  // MEDICAID RATES BY COMPANY
  md += `## Medicaid Rates by Company

**Rate Statistics (State-wide)**
- Average Daily Rate: **$272.47**
- Minimum: $170.12
- Maximum: $386.36
- Median: $272.83

| Company | Fac | Avg Rate | Min Rate | Max Rate | Spread |
|---------|-----|----------|----------|----------|--------|
`;

  // Match rates to companies
  const companyRates = new Map();
  const [allFacilities] = await conn.execute(`
    SELECT ccn, provider_name, COALESCE(affiliated_entity_name, legal_business_name, 'Independent') as company_name
    FROM cms_facilities_monthly WHERE state = 'GA' AND month_date = ?
  `, [monthDate]);

  for (const f of allFacilities) {
    const key = f.provider_name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 20);
    const rate = rateMap.get(key);
    if (rate) {
      if (!companyRates.has(f.company_name)) companyRates.set(f.company_name, []);
      companyRates.get(f.company_name).push(rate);
    }
  }

  const rateStats = [];
  for (const [company, rateList] of companyRates) {
    if (rateList.length > 0) {
      rateStats.push({
        company,
        count: rateList.length,
        avg: rateList.reduce((a, b) => a + b, 0) / rateList.length,
        min: Math.min(...rateList),
        max: Math.max(...rateList),
        spread: Math.max(...rateList) - Math.min(...rateList)
      });
    }
  }
  rateStats.sort((a, b) => b.count - a.count);

  for (const r of rateStats.slice(0, 40)) {
    md += `| ${r.company} | ${r.count} | $${r.avg.toFixed(2)} | $${r.min.toFixed(2)} | $${r.max.toFixed(2)} | $${r.spread.toFixed(2)} |\n`;
  }
  md += '\n---\n\n';

  // DETAILED FACILITY LIST
  const [facilities] = await conn.execute(`
    SELECT
      ccn, provider_name, city,
      COALESCE(affiliated_entity_name, legal_business_name, 'Independent') as company_name,
      ownership_type, num_certified_beds as beds,
      ROUND(census_percent, 1) as occupancy,
      overall_rating, health_inspection_rating, staffing_rating, qm_rating,
      ROUND(reported_total_nurse_hprd, 2) as hprd,
      ROUND(total_nursing_staff_turnover, 1) as turnover,
      ROUND(total_fines_amount, 0) as fines,
      special_focus_status as sff
    FROM cms_facilities_monthly WHERE state = 'GA' AND month_date = ?
    ORDER BY company_name, provider_name
  `, [monthDate]);

  md += `## Detailed Facility List

*All ${facilities.length} Georgia SNFs grouped by company*

`;

  let currentCompany = '';
  for (const f of facilities) {
    if (f.company_name !== currentCompany) {
      if (currentCompany !== '') md += '\n';
      currentCompany = f.company_name;
      const coData = byCompany.find(c => c.company_name === currentCompany);
      md += `### ${currentCompany}\n\n`;
      md += `**Portfolio:** ${coData?.facility_count || 1} facilities | ${coData?.total_beds?.toLocaleString() || f.beds} beds | Avg Stars: ${coData?.avg_overall || f.overall_rating || 'N/A'}\n\n`;
      md += `| CCN | Facility | City | Beds | Occ% | Stars | Health | QM | Staff | HPRD | Turn% | Fines |\n`;
      md += `|-----|----------|------|------|------|-------|--------|-----|-------|------|-------|-------|\n`;
    }
    const sffTag = f.sff ? ' ⚠️' : '';
    md += `| ${f.ccn} | ${f.provider_name}${sffTag} | ${f.city || ''} | ${f.beds || ''} | ${f.occupancy || ''}% | ${f.overall_rating || '-'} | ${f.health_inspection_rating || '-'} | ${f.qm_rating || '-'} | ${f.staffing_rating || '-'} | ${f.hprd || '-'} | ${f.turnover || '-'}% | $${f.fines?.toLocaleString() || 0} |\n`;
  }

  md += `\n---\n\n*Report generated by 3GHCRE Atlas Database*\n`;

  // Write the file
  const outputPath = path.join(__dirname, '..', 'data', 'GA_Facility_Report.md');
  fs.writeFileSync(outputPath, md);
  console.log(`Report saved to: ${outputPath}`);
  console.log(`Total size: ${(md.length / 1024).toFixed(1)} KB`);

  await conn.end();
}

main().catch(console.error);
