/**
 * Georgia Properties Summary by Company
 * Operating metrics, performance, rates, and cost report data
 */

const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: 'YOUR_DB_HOST_HERE',
  port: 25060,
  user: 'YOUR_DB_USER_HERE',
  password: 'YOUR_DB_PASSWORD_HERE',
  database: 'cms_data',
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30000
};

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);

  // Get the most recent month
  const [latestMonth] = await conn.execute(`
    SELECT MAX(month_date) as latest FROM cms_facilities_monthly WHERE state = 'GA'
  `);
  const monthDate = latestMonth[0].latest;
  console.log(`\n=== GEORGIA SKILLED NURSING FACILITIES - SUMMARY BY COMPANY ===`);
  console.log(`Data as of: ${monthDate.toISOString().split('T')[0]}\n`);

  // 1. Summary by Affiliated Entity (parent company)
  console.log('='.repeat(120));
  console.log('SECTION 1: PROPERTIES BY AFFILIATED ENTITY (Parent Company)');
  console.log('='.repeat(120));

  const [byAffiliated] = await conn.execute(`
    SELECT
      COALESCE(affiliated_entity_name, legal_business_name, 'Independent/Not Listed') as company_name,
      affiliated_entity_id,
      COUNT(*) as facility_count,
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
      SUM(CASE WHEN special_focus_status IS NOT NULL AND special_focus_status != '' THEN 1 ELSE 0 END) as sff_count
    FROM cms_facilities_monthly
    WHERE state = 'GA' AND month_date = ?
    GROUP BY COALESCE(affiliated_entity_name, legal_business_name, 'Independent/Not Listed'), affiliated_entity_id
    ORDER BY facility_count DESC
  `, [monthDate]);

  console.log('\nCompany Name                                          | Fac | Beds  | Occ%  | Stars | Hlth | Staff | QM   | HPRD  | RN    | Turn% | Fines$');
  console.log('-'.repeat(140));
  for (const row of byAffiliated) {
    console.log(
      `${row.company_name.substring(0, 52).padEnd(52)} | ` +
      `${String(row.facility_count).padStart(3)} | ` +
      `${String(row.total_beds || 0).padStart(5)} | ` +
      `${String(row.avg_occupancy || '-').padStart(4)}% | ` +
      `${String(row.avg_overall_rating || '-').padStart(5)} | ` +
      `${String(row.avg_health_rating || '-').padStart(4)} | ` +
      `${String(row.avg_staffing_rating || '-').padStart(5)} | ` +
      `${String(row.avg_qm_rating || '-').padStart(4)} | ` +
      `${String(row.avg_total_hprd || '-').padStart(5)} | ` +
      `${String(row.avg_rn_hprd || '-').padStart(5)} | ` +
      `${String(row.avg_turnover || '-').padStart(4)}% | ` +
      `$${String(row.total_fines_amount || 0).padStart(7)}`
    );
  }
  console.log(`\nTotal parent companies/groups: ${byAffiliated.length}`);

  // 2. Summary by Ownership Type
  console.log('\n\n' + '='.repeat(120));
  console.log('SECTION 2: SUMMARY BY OWNERSHIP TYPE');
  console.log('='.repeat(120));

  const [byOwnershipType] = await conn.execute(`
    SELECT
      ownership_type,
      COUNT(*) as facility_count,
      SUM(num_certified_beds) as total_beds,
      ROUND(AVG(census_percent), 1) as avg_occupancy,
      ROUND(AVG(overall_rating), 2) as avg_overall_rating,
      ROUND(AVG(health_inspection_rating), 2) as avg_health_rating,
      ROUND(AVG(staffing_rating), 2) as avg_staffing_rating,
      ROUND(AVG(reported_total_nurse_hprd), 2) as avg_total_hprd,
      ROUND(AVG(total_nursing_staff_turnover), 1) as avg_turnover,
      SUM(num_fines) as total_fines_count,
      ROUND(SUM(total_fines_amount), 0) as total_fines_amount
    FROM cms_facilities_monthly
    WHERE state = 'GA' AND month_date = ?
    GROUP BY ownership_type
    ORDER BY facility_count DESC
  `, [monthDate]);

  console.log('\nOwnership Type                       | Fac | Beds  | Occ%  | Stars | Health | Staff | HPRD  | Turnover | Fines$');
  console.log('-'.repeat(115));
  for (const row of byOwnershipType) {
    console.log(
      `${(row.ownership_type || 'Unknown').substring(0, 35).padEnd(35)} | ` +
      `${String(row.facility_count).padStart(3)} | ` +
      `${String(row.total_beds || 0).padStart(5)} | ` +
      `${String(row.avg_occupancy || '-').padStart(4)}% | ` +
      `${String(row.avg_overall_rating || '-').padStart(5)} | ` +
      `${String(row.avg_health_rating || '-').padStart(6)} | ` +
      `${String(row.avg_staffing_rating || '-').padStart(5)} | ` +
      `${String(row.avg_total_hprd || '-').padStart(5)} | ` +
      `${String(row.avg_turnover || '-').padStart(7)}% | ` +
      `$${String(row.total_fines_amount || 0).padStart(8)}`
    );
  }

  // 3. Financial Summary by Company (using the view)
  console.log('\n\n' + '='.repeat(120));
  console.log('SECTION 3: ESTIMATED FINANCIALS BY COMPANY');
  console.log('='.repeat(120));

  const [financialByCompany] = await conn.execute(`
    SELECT
      COALESCE(f.affiliated_entity_name, f.legal_business_name, 'Independent') as company_name,
      COUNT(*) as facility_count,
      ROUND(SUM(v.estimated_annual_revenue) / 1000000, 2) as total_annual_rev_m,
      ROUND(AVG(v.estimated_annual_revenue) / 1000000, 2) as avg_annual_rev_m,
      ROUND(AVG(v.estimated_margin_percent), 1) as avg_margin_pct,
      ROUND(SUM(v.total_fines_amount), 0) as total_fines,
      SUM(v.num_fines) as num_fines,
      SUM(v.num_payment_denials) as payment_denials
    FROM cms_facilities_monthly f
    JOIN vw_facility_financial_summary v ON f.ccn = v.ccn AND f.month_date = v.month_date
    WHERE f.state = 'GA' AND f.month_date = ?
    GROUP BY COALESCE(f.affiliated_entity_name, f.legal_business_name, 'Independent')
    ORDER BY total_annual_rev_m DESC
    LIMIT 40
  `, [monthDate]);

  console.log('\nCompany Name                                          | Fac | Total Rev $M | Avg Rev $M | Margin% | Fines$ | Denials');
  console.log('-'.repeat(115));
  for (const row of financialByCompany) {
    console.log(
      `${row.company_name.substring(0, 52).padEnd(52)} | ` +
      `${String(row.facility_count).padStart(3)} | ` +
      `$${String(row.total_annual_rev_m || 0).padStart(11)} | ` +
      `$${String(row.avg_annual_rev_m || 0).padStart(9)} | ` +
      `${String(row.avg_margin_pct || '-').padStart(6)}% | ` +
      `$${String(row.total_fines || 0).padStart(6)} | ` +
      `${String(row.payment_denials || 0).padStart(7)}`
    );
  }

  // 4. Staffing Details by Company
  console.log('\n\n' + '='.repeat(120));
  console.log('SECTION 4: STAFFING METRICS BY COMPANY');
  console.log('='.repeat(120));

  const [staffingByCompany] = await conn.execute(`
    SELECT
      COALESCE(affiliated_entity_name, legal_business_name, 'Independent') as company_name,
      COUNT(*) as facility_count,
      ROUND(AVG(reported_total_nurse_hprd), 2) as avg_total_hprd,
      ROUND(AVG(reported_rn_hprd), 2) as avg_rn_hprd,
      ROUND(AVG(reported_lpn_hprd), 2) as avg_lpn_hprd,
      ROUND(AVG(reported_nurse_aide_hprd), 2) as avg_cna_hprd,
      ROUND(AVG(weekend_total_nurse_hprd), 2) as avg_weekend_hprd,
      ROUND(AVG(weekend_rn_hprd), 2) as avg_weekend_rn_hprd,
      ROUND(AVG(total_nursing_staff_turnover), 1) as avg_turnover,
      ROUND(AVG(rn_turnover), 1) as avg_rn_turnover,
      ROUND(AVG(staffing_rating), 2) as avg_staffing_rating
    FROM cms_facilities_monthly
    WHERE state = 'GA' AND month_date = ?
    GROUP BY COALESCE(affiliated_entity_name, legal_business_name, 'Independent')
    HAVING COUNT(*) >= 2
    ORDER BY facility_count DESC
  `, [monthDate]);

  console.log('\nCompany Name                                    | Fac | Total | RN    | LPN   | CNA   | WkEnd | Turn% | RN Turn | Staff*');
  console.log('-'.repeat(115));
  for (const row of staffingByCompany) {
    console.log(
      `${row.company_name.substring(0, 45).padEnd(45)} | ` +
      `${String(row.facility_count).padStart(3)} | ` +
      `${String(row.avg_total_hprd || '-').padStart(5)} | ` +
      `${String(row.avg_rn_hprd || '-').padStart(5)} | ` +
      `${String(row.avg_lpn_hprd || '-').padStart(5)} | ` +
      `${String(row.avg_cna_hprd || '-').padStart(5)} | ` +
      `${String(row.avg_weekend_hprd || '-').padStart(5)} | ` +
      `${String(row.avg_turnover || '-').padStart(4)}% | ` +
      `${String(row.avg_rn_turnover || '-').padStart(6)}% | ` +
      `${String(row.avg_staffing_rating || '-').padStart(6)}`
    );
  }
  console.log('* Staffing Rating (1-5 stars)');

  // 5. Quality Performance by Company
  console.log('\n\n' + '='.repeat(120));
  console.log('SECTION 5: QUALITY PERFORMANCE BY COMPANY');
  console.log('='.repeat(120));

  const [qualityByCompany] = await conn.execute(`
    SELECT
      COALESCE(affiliated_entity_name, legal_business_name, 'Independent') as company_name,
      COUNT(*) as facility_count,
      ROUND(AVG(overall_rating), 2) as avg_overall,
      ROUND(AVG(health_inspection_rating), 2) as avg_health,
      ROUND(AVG(qm_rating), 2) as avg_qm,
      ROUND(AVG(long_stay_qm_rating), 2) as avg_ls_qm,
      ROUND(AVG(short_stay_qm_rating), 2) as avg_ss_qm,
      ROUND(AVG(staffing_rating), 2) as avg_staffing,
      SUM(CASE WHEN special_focus_status IS NOT NULL AND special_focus_status != '' THEN 1 ELSE 0 END) as sff_count,
      SUM(CASE WHEN abuse_icon = 'Y' THEN 1 ELSE 0 END) as abuse_count,
      ROUND(AVG(total_weighted_health_survey_score), 1) as avg_survey_score,
      SUM(num_infection_control_citations) as infection_citations,
      SUM(total_penalties) as total_penalties
    FROM cms_facilities_monthly
    WHERE state = 'GA' AND month_date = ?
    GROUP BY COALESCE(affiliated_entity_name, legal_business_name, 'Independent')
    HAVING COUNT(*) >= 2
    ORDER BY avg_overall DESC
  `, [monthDate]);

  console.log('\nCompany Name                                    | Fac | Ovrl* | Hlth | QM   | Staff | SFF | Abuse | Survey | Penalties');
  console.log('-'.repeat(115));
  for (const row of qualityByCompany) {
    console.log(
      `${row.company_name.substring(0, 45).padEnd(45)} | ` +
      `${String(row.facility_count).padStart(3)} | ` +
      `${String(row.avg_overall || '-').padStart(5)} | ` +
      `${String(row.avg_health || '-').padStart(4)} | ` +
      `${String(row.avg_qm || '-').padStart(4)} | ` +
      `${String(row.avg_staffing || '-').padStart(5)} | ` +
      `${String(row.sff_count).padStart(3)} | ` +
      `${String(row.abuse_count).padStart(5)} | ` +
      `${String(row.avg_survey_score || '-').padStart(6)} | ` +
      `${String(row.total_penalties || 0).padStart(9)}`
    );
  }
  console.log('* All ratings on 1-5 star scale');

  // 6. Detailed Facility List
  console.log('\n\n' + '='.repeat(140));
  console.log('SECTION 6: DETAILED FACILITY LIST (Grouped by Company)');
  console.log('='.repeat(140));

  const [facilityList] = await conn.execute(`
    SELECT
      ccn,
      provider_name,
      city,
      COALESCE(affiliated_entity_name, legal_business_name, 'Independent') as company_name,
      ownership_type,
      num_certified_beds as beds,
      ROUND(census_percent, 1) as occupancy,
      overall_rating,
      health_inspection_rating,
      staffing_rating,
      qm_rating,
      ROUND(reported_total_nurse_hprd, 2) as total_hprd,
      ROUND(total_nursing_staff_turnover, 1) as turnover,
      ROUND(total_fines_amount, 0) as fines,
      special_focus_status as sff
    FROM cms_facilities_monthly
    WHERE state = 'GA' AND month_date = ?
    ORDER BY COALESCE(affiliated_entity_name, legal_business_name, 'ZZZZZ'), provider_name
  `, [monthDate]);

  let currentCompany = '';
  let companyFacCount = 0;

  console.log('\nCCN    | Facility Name                           | City           | Beds | Occ%  | Star | Hlth | QM   | Staff | HPRD  | Turn% | Fines$');
  console.log('-'.repeat(145));

  for (const row of facilityList) {
    if (row.company_name !== currentCompany) {
      if (currentCompany !== '') {
        console.log('-'.repeat(145));
      }
      currentCompany = row.company_name;
      companyFacCount = 0;
      console.log(`\n>>> ${row.company_name} (${row.ownership_type || 'Unknown Type'})`);
      console.log('-'.repeat(145));
    }
    companyFacCount++;
    console.log(
      `${row.ccn} | ` +
      `${row.provider_name.substring(0, 39).padEnd(39)} | ` +
      `${(row.city || '').substring(0, 14).padEnd(14)} | ` +
      `${String(row.beds || 0).padStart(4)} | ` +
      `${String(row.occupancy || '-').padStart(4)}% | ` +
      `${String(row.overall_rating || '-').padStart(4)} | ` +
      `${String(row.health_inspection_rating || '-').padStart(4)} | ` +
      `${String(row.qm_rating || '-').padStart(4)} | ` +
      `${String(row.staffing_rating || '-').padStart(5)} | ` +
      `${String(row.total_hprd || '-').padStart(5)} | ` +
      `${String(row.turnover || '-').padStart(4)}% | ` +
      `$${String(row.fines || 0).padStart(6)}` +
      (row.sff ? ` [SFF]` : '')
    );
  }

  // 7. State-level Summary
  console.log('\n\n' + '='.repeat(120));
  console.log('SECTION 7: GEORGIA STATE SUMMARY');
  console.log('='.repeat(120));

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
    FROM cms_facilities_monthly
    WHERE state = 'GA' AND month_date = ?
  `, [monthDate]);

  const s = stateSummary[0];
  console.log(`
  Total Facilities:        ${s.total_facilities}
  Total Certified Beds:    ${s.total_beds?.toLocaleString() || 'N/A'}
  Unique Companies:        ${s.unique_companies}

  OCCUPANCY & CENSUS
  ------------------
  Average Occupancy:       ${s.avg_occupancy}%

  QUALITY RATINGS (1-5 Stars)
  ---------------------------
  Overall Rating:          ${s.avg_overall_rating}
  Health Inspection:       ${s.avg_health_rating}
  Staffing Rating:         ${s.avg_staffing_rating}
  Quality Measures:        ${s.avg_qm_rating}

  STAFFING (Hours Per Resident Day)
  ---------------------------------
  Total Nursing HPRD:      ${s.avg_total_hprd}
  RN HPRD:                 ${s.avg_rn_hprd}
  Avg Staff Turnover:      ${s.avg_turnover}%

  COMPLIANCE & PENALTIES
  ----------------------
  Total Fines Count:       ${s.total_fines_count}
  Total Fines Amount:      $${s.total_fines_amount?.toLocaleString() || 0}
  Special Focus Facilities: ${s.sff_count}
  `);

  await conn.end();
  console.log('\n=== END OF REPORT ===\n');
}

main().catch(console.error);
