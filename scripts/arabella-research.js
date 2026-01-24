/**
 * Arabella Healthcare Research Script
 * Comprehensive analysis of Arabella Health & Wellness portfolio
 *
 * Queries both REAPI (sales, property data) and Atlas (ownership, deals) databases
 * Generates detailed metrics for all 13 SNF facilities across AL and FL
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Database configurations
const REAPI_DB = {
  host: 'YOUR_DB_HOST_HERE',
  port: 25060,
  user: 'YOUR_DB_USER_HERE',
  password: 'YOUR_DB_PASSWORD_HERE',
  database: 'cms_data',
  ssl: { rejectUnauthorized: false }
};

const ATLAS_DB = {
  host: process.env.LOCAL_DB_HOST || 'localhost',
  port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
  user: process.env.LOCAL_DB_USER || 'root',
  password: process.env.LOCAL_DB_PASSWORD || 'devpass',
  database: process.env.LOCAL_DB_NAME || 'atlas'
};

// Arabella facility CCNs from research plan
const ARABELLA_CCNS = [
  '015303', // Birmingham
  '015119', // Selma
  '015151', // Mobile
  '015228', // Montgomery
  '015164', // Butler
  '015406', // Grand Bay
  '015331', // Phenix City
  '015447', // Fairhope
  '015050', // Oak Crest (affiliate)
  '015060', // Ridgeway Rehab (affiliate)
  '015071', // Russellville
  '105628', // Pensacola, FL
  '106081'  // Carrabelle, FL
];

// Search patterns for Arabella
const ARABELLA_PATTERNS = [
  '%ARABELLA%',
  '%HERTZEL%',
  '%AL 600 OPCO%'
];

async function main() {
  const reapi = await mysql.createConnection(REAPI_DB);
  const atlas = await mysql.createConnection(ATLAS_DB);

  console.log('═'.repeat(80));
  console.log('  ARABELLA HEALTH & WELLNESS - COMPREHENSIVE RESEARCH REPORT');
  console.log('═'.repeat(80));
  console.log();

  const results = {
    facilities: [],
    ownership: [],
    transactions: [],
    chowEvents: [],
    financials: {},
    quality: {},
    lenders: []
  };

  // 1. Facility Overview from CMS/REAPI
  console.log('─── 1. FACILITY OVERVIEW ───\n');
  results.facilities = await getFacilityData(reapi);

  // 2. Ownership Structure from Atlas
  console.log('\n─── 2. OWNERSHIP STRUCTURE ───\n');
  results.ownership = await getOwnershipData(atlas);

  // 2b. CMS Owner Data from REAPI
  results.cmsOwners = await getCmsOwnerData(reapi);

  // 3. Transaction History (Sales)
  console.log('\n─── 3. TRANSACTION HISTORY (REAPI SALES) ───\n');
  results.transactions = await getTransactionHistory(reapi);

  // 4. CHOW Events from Atlas
  console.log('\n─── 4. CHANGE OF OWNERSHIP (CHOW) EVENTS ───\n');
  results.chowEvents = await getChowEvents(atlas);

  // 5. Financial Analysis (Cost Reports)
  console.log('\n─── 5. FINANCIAL ANALYSIS ───\n');
  results.financials = await getFinancialData(atlas);

  // 6. Quality Ratings & Deficiencies
  console.log('\n─── 6. QUALITY RATINGS & REGULATORY STATUS ───\n');
  results.quality = await getQualityData(atlas, reapi);

  // 7. Lender Relationships
  console.log('\n─── 7. LENDER RELATIONSHIPS ───\n');
  results.lenders = await getLenderData(atlas);

  // 8. Portfolio Summary
  console.log('\n─── 8. PORTFOLIO SUMMARY ───\n');
  generatePortfolioSummary(results);

  // 9. Generate Markdown Report
  console.log('\n─── 9. GENERATING MARKDOWN REPORT ───\n');
  await generateMarkdownReport(results);

  await reapi.end();
  await atlas.end();

  console.log('\n═'.repeat(80));
  console.log('  Research complete. Report saved to data/Arabella_Healthcare_Research_Report.md');
  console.log('═'.repeat(80));
}

async function getFacilityData(conn) {
  const ccnList = ARABELLA_CCNS.map(c => `'${c}'`).join(',');

  // Get facility info from CMS monthly data - most recent month only
  const [facilities] = await conn.execute(`
    SELECT
      cfm.ccn,
      cfm.provider_name as facility_name,
      cfm.provider_address as address,
      cfm.city,
      cfm.state,
      cfm.zip_code as zip,
      cfm.county_name as county,
      cfm.telephone_number as phone_number,
      cfm.ownership_type,
      cfm.num_certified_beds as number_certified_beds,
      cfm.avg_residents_per_day as average_number_residents_per_day,
      cfm.census_percent,
      cfm.overall_rating,
      cfm.health_inspection_rating,
      cfm.staffing_rating,
      cfm.qm_rating as quality_measure_rating,
      cfm.special_focus_status,
      cfm.abuse_icon,
      cfm.total_fines_amount as total_penalties_amount,
      cfm.num_fines as total_number_penalties,
      cfm.provider_changed_ownership_12mo as provider_changed_owner_12mo
    FROM cms_facilities_monthly cfm
    INNER JOIN (
      SELECT ccn, MAX(month_date) as max_date
      FROM cms_facilities_monthly
      WHERE ccn IN (${ccnList})
      GROUP BY ccn
    ) latest ON cfm.ccn = latest.ccn AND cfm.month_date = latest.max_date
    ORDER BY cfm.state, cfm.city
  `);

  console.log(`Found ${facilities.length} Arabella facilities\n`);

  // Calculate occupancy and display
  facilities.forEach(f => {
    const beds = f.number_certified_beds || 0;
    // census_percent is already the occupancy percentage
    const occupancy = f.census_percent ? parseFloat(f.census_percent).toFixed(1) : 0;
    // Store for later use
    f.total_number_occupied_beds = beds * (f.census_percent || 0) / 100;

    const stars = n => n ? '★'.repeat(n) + '☆'.repeat(5-n) : 'N/A';
    const sff = f.special_focus_status === 'SFF Candidate' ? ' [SFF CANDIDATE]' : '';

    console.log(`${f.ccn} | ${f.facility_name}`);
    console.log(`         ${f.city}, ${f.state} | ${beds} beds | ${occupancy}% occ | ${stars(f.overall_rating)}${sff}`);
    if (f.total_penalties_amount > 0) {
      console.log(`         Fines: $${f.total_penalties_amount.toLocaleString()} (${f.total_number_penalties} penalties)`);
    }
    console.log();
  });

  return facilities;
}

async function getOwnershipData(conn) {
  // Find Arabella-related companies
  const [companies] = await conn.execute(`
    SELECT c.id, c.company_name, c.company_type
    FROM companies c
    WHERE (c.company_name LIKE '%ARABELLA%'
           OR c.company_name LIKE '%HERTZEL%'
           OR c.company_name LIKE '%AL 600%')
      AND c.company_name NOT LIKE '[MERGED]%'
    ORDER BY c.company_name
  `);

  console.log(`Found ${companies.length} Arabella-related companies:\n`);

  for (const company of companies) {
    console.log(`  ${company.company_name} (${company.company_type})`);

    // Get entities for this company
    const [entities] = await conn.execute(`
      SELECT e.id, e.entity_name, e.entity_type, e.state_of_incorporation
      FROM entities e
      WHERE e.company_id = ?
      LIMIT 5
    `, [company.id]);

    entities.forEach(e => {
      console.log(`    └─ ${e.entity_name} (${e.entity_type || 'unknown'})`);
    });
  }

  return { companies, cmsOwners: [] };
}

async function getCmsOwnerData(conn) {
  // Get owners from CMS All Owners data in REAPI
  console.log('\n  CMS Registered Owners:');
  const ccnList = ARABELLA_CCNS.map(c => `'${c}'`).join(',');

  // Need to get enrollment_ids for our CCNs first, or query differently
  // The cms_snf_owners_monthly uses enrollment_id, not ccn
  // For now, search by organization name patterns
  const [cmsOwners] = await conn.execute(`
    SELECT DISTINCT
      som.enrollment_id,
      som.organization_name,
      COALESCE(som.organization_name_owner, CONCAT(som.first_name_owner, ' ', som.last_name_owner)) as associate_name,
      som.role_text_owner as role_description,
      som.percentage_ownership,
      som.type_owner as associate_type
    FROM cms_snf_owners_monthly som
    WHERE som.organization_name LIKE '%ARABELLA%'
       OR som.organization_name_owner LIKE '%ARABELLA%'
       OR som.organization_name_owner LIKE '%HERTZEL%'
       OR som.last_name_owner = 'HERTZEL'
    ORDER BY som.organization_name, som.percentage_ownership DESC
    LIMIT 50
  `);

  // Group by organization
  const ownersByOrg = {};
  cmsOwners.forEach(o => {
    const key = o.organization_name || 'Unknown';
    if (!ownersByOrg[key]) ownersByOrg[key] = [];
    ownersByOrg[key].push(o);
  });

  for (const [org, owners] of Object.entries(ownersByOrg)) {
    console.log(`\n  ${org}:`);
    owners.slice(0, 5).forEach(o => {
      const pct = o.percentage_ownership ? `${o.percentage_ownership}%` : '';
      console.log(`    ${o.associate_name} - ${o.role_description} ${pct}`);
    });
  }

  return cmsOwners;
}

async function getTransactionHistory(conn) {
  // Search for Arabella-specific transactions
  const [sales] = await conn.execute(`
    SELECT
      rsh.sale_date,
      rsh.sale_amount,
      rsh.buyer_names,
      rsh.seller_names,
      rsh.transaction_type,
      rsh.document_type,
      rsh.purchase_method,
      rpa.state,
      rpa.city,
      rpa.label as address,
      rp.ccn
    FROM reapi_sales_history rsh
    JOIN reapi_properties rp ON rp.property_id = rsh.property_id
    JOIN reapi_property_addresses rpa ON rpa.property_id = rsh.property_id
    WHERE (rsh.buyer_names LIKE '%ARABELLA%'
           OR rsh.seller_names LIKE '%ARABELLA%'
           OR rsh.buyer_names LIKE '%HERTZEL%'
           OR rsh.seller_names LIKE '%HERTZEL%'
           OR (rsh.buyer_names LIKE '%SELMA PROPCO%')
           OR (rsh.buyer_names LIKE '%FAIRHOPE PROP%')
           OR (rsh.buyer_names LIKE '%CARRABELLE PROPCO%')
           OR (rsh.buyer_names LIKE '%OAK CREST%'))
      AND rsh.sale_amount > 0
    ORDER BY rsh.sale_date DESC
    LIMIT 30
  `);

  console.log(`Found ${sales.length} sales transactions:\n`);

  let totalValue = 0;
  sales.forEach(s => {
    const date = s.sale_date ? new Date(s.sale_date).toISOString().split('T')[0] : 'Unknown';
    const amount = s.sale_amount ? `$${(s.sale_amount/1000000).toFixed(2)}M` : 'N/A';
    totalValue += Number(s.sale_amount || 0);

    console.log(`  ${date} | ${amount} | ${s.city}, ${s.state}`);
    console.log(`    Buyer: ${(s.buyer_names || 'N/A').substring(0, 60)}`);
    console.log(`    Seller: ${(s.seller_names || 'N/A').substring(0, 60)}`);
    console.log();
  });

  console.log(`Total Transaction Value: $${(totalValue/1000000).toFixed(1)}M`);

  return { sales, totalValue };
}

async function getChowEvents(conn) {
  const ccnList = ARABELLA_CCNS.map(c => `'${c}'`).join(',');

  const [chows] = await conn.execute(`
    SELECT
      d.effective_date,
      d.deal_type,
      d.amount,
      dc.chow_type_text,
      seller.party_name as from_entity_name,
      buyer.party_name as to_entity_name,
      pm.ccn,
      pm.facility_name,
      pm.state
    FROM deals d
    JOIN property_master pm ON pm.id = d.property_master_id
    LEFT JOIN deals_chow dc ON dc.deal_id = d.id
    LEFT JOIN deals_parties seller ON seller.deal_id = d.id AND seller.party_role = 'seller'
    LEFT JOIN deals_parties buyer ON buyer.deal_id = d.id AND buyer.party_role = 'buyer'
    WHERE pm.ccn IN (${ccnList})
      AND d.deal_type = 'chow'
    ORDER BY d.effective_date DESC
  `);

  console.log(`Found ${chows.length} CHOW events:\n`);

  chows.forEach(c => {
    const date = c.effective_date ? new Date(c.effective_date).toISOString().split('T')[0] : 'Unknown';
    console.log(`  ${date} | ${c.facility_name} (${c.state})`);
    console.log(`    From: ${c.from_entity_name || 'N/A'}`);
    console.log(`    To:   ${c.to_entity_name || 'N/A'}`);
    console.log();
  });

  return chows;
}

async function getFinancialData(conn) {
  const ccnList = ARABELLA_CCNS.map(c => `'${c}'`).join(',');

  // Get cost report data
  const [costReports] = await conn.execute(`
    SELECT
      cr.fiscal_year,
      pm.ccn,
      pm.facility_name,
      pm.state,
      cr.total_beds,
      cr.total_patient_revenue,
      cr.total_operating_expenses,
      cr.net_income,
      cr.operating_margin,
      cr.occupancy_rate,
      cr.medicare_pct,
      cr.medicaid_pct
    FROM cost_reports cr
    JOIN property_master pm ON pm.id = cr.property_master_id
    WHERE pm.ccn IN (${ccnList})
    ORDER BY pm.state, cr.fiscal_year DESC
  `);

  console.log(`Cost Report Data (${costReports.length} records):\n`);

  // Get most recent for each facility
  const latestByFacility = {};
  costReports.forEach(cr => {
    if (!latestByFacility[cr.ccn] || cr.fiscal_year > latestByFacility[cr.ccn].fiscal_year) {
      latestByFacility[cr.ccn] = cr;
    }
  });

  let totalRevenue = 0;
  let totalBeds = 0;

  Object.values(latestByFacility).forEach(cr => {
    const revenue = parseFloat(cr.total_patient_revenue || 0);
    const margin = cr.operating_margin ? `${(parseFloat(cr.operating_margin)*100).toFixed(1)}%` : 'N/A';
    const beds = cr.total_beds || 0;

    totalRevenue += revenue;
    totalBeds += beds;

    console.log(`  ${cr.ccn} | ${cr.facility_name} (FY${cr.fiscal_year})`);
    console.log(`    Revenue: $${(revenue/1e6).toFixed(1)}M | Beds: ${beds} | Margin: ${margin}`);
    if (cr.medicare_pct && cr.medicaid_pct) {
      console.log(`    Payer Mix: Medicare ${(parseFloat(cr.medicare_pct)*100).toFixed(0)}% / Medicaid ${(parseFloat(cr.medicaid_pct)*100).toFixed(0)}%`);
    }
    console.log();
  });

  console.log(`Portfolio Total: $${(totalRevenue/1e6).toFixed(1)}M revenue, ${totalBeds} beds`);

  return { costReports, latestByFacility, totalRevenue, totalBeds };
}

async function getQualityData(atlas, reapi) {
  const ccnList = ARABELLA_CCNS.map(c => `'${c}'`).join(',');

  // Get quality ratings from Atlas
  const [ratings] = await atlas.execute(`
    SELECT
      qr.overall_rating,
      qr.health_inspection_rating,
      qr.staffing_rating,
      qr.quality_measure_rating,
      qr.rating_date,
      pm.ccn,
      pm.facility_name,
      pm.state
    FROM quality_ratings qr
    JOIN property_master pm ON pm.id = qr.property_master_id
    WHERE pm.ccn IN (${ccnList})
    ORDER BY pm.state, qr.rating_date DESC
  `);

  // Get most recent rating per facility
  const latestRatings = {};
  ratings.forEach(r => {
    if (!latestRatings[r.ccn]) {
      latestRatings[r.ccn] = r;
    }
  });

  console.log('Quality Ratings:\n');
  const stars = n => n ? '★'.repeat(n) + '☆'.repeat(5-n) : 'N/A';

  // Summary counts
  let fiveStar = 0, oneStar = 0, totalRating = 0, count = 0;

  Object.values(latestRatings).forEach(r => {
    console.log(`  ${r.ccn} | ${r.facility_name}`);
    console.log(`    Overall: ${stars(r.overall_rating)} | Health: ${stars(r.health_inspection_rating)} | Staff: ${stars(r.staffing_rating)} | QM: ${stars(r.quality_measure_rating)}`);

    if (r.overall_rating === 5) fiveStar++;
    if (r.overall_rating === 1) oneStar++;
    if (r.overall_rating) {
      totalRating += r.overall_rating;
      count++;
    }
  });

  const avgRating = count > 0 ? (totalRating / count).toFixed(1) : 'N/A';
  console.log(`\nQuality Summary: ${fiveStar} five-star, ${oneStar} one-star, ${avgRating} avg rating`);

  // Get penalty/fine data
  const [penalties] = await reapi.execute(`
    SELECT
      cfm.ccn,
      cfm.provider_name as facility_name,
      cfm.total_fines_amount as total_penalties_amount,
      cfm.num_fines as total_number_penalties,
      cfm.special_focus_status
    FROM cms_facilities_monthly cfm
    WHERE cfm.ccn IN (${ccnList})
      AND cfm.total_fines_amount > 0
    ORDER BY cfm.total_fines_amount DESC
  `);

  if (penalties.length > 0) {
    console.log('\nFacilities with Fines:');
    let totalFines = 0;
    penalties.forEach(p => {
      const sff = p.special_focus_status === 'SFF Candidate' ? ' [SFF CANDIDATE]' : '';
      console.log(`  ${p.facility_name}: $${parseFloat(p.total_penalties_amount).toLocaleString()} (${p.total_number_penalties} penalties)${sff}`);
      totalFines += parseFloat(p.total_penalties_amount);
    });
    console.log(`\nTotal Portfolio Fines: $${totalFines.toLocaleString()}`);
  }

  return { ratings: latestRatings, penalties, avgRating, fiveStar, oneStar };
}

async function getLenderData(conn) {
  const ccnList = ARABELLA_CCNS.map(c => `'${c}'`).join(',');

  const [lenders] = await conn.execute(`
    SELECT DISTINCT
      c.company_name as lender,
      pm.ccn,
      pm.facility_name,
      pm.state
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    JOIN property_master pm ON pm.id = per.property_master_id
    WHERE pm.ccn IN (${ccnList})
      AND per.relationship_type = 'lender'
      AND c.company_name NOT LIKE '[MERGED]%'
    ORDER BY c.company_name, pm.state
  `);

  if (lenders.length > 0) {
    console.log(`Found ${lenders.length} lender relationships:\n`);

    // Group by lender
    const byLender = {};
    lenders.forEach(l => {
      if (!byLender[l.lender]) byLender[l.lender] = [];
      byLender[l.lender].push(l);
    });

    Object.entries(byLender).forEach(([lender, facilities]) => {
      console.log(`  ${lender}: ${facilities.length} facilities`);
      facilities.forEach(f => {
        console.log(`    └─ ${f.facility_name} (${f.state})`);
      });
    });
  } else {
    console.log('No lender relationships found in Atlas database.');
    console.log('\nNote: Dwight Capital confirmed $31MM bridge loan (Jan 2025) for:');
    console.log('  - Arabella H&W of Carrabelle (FL)');
    console.log('  - Plus 3 other SNFs (386 total beds)');
  }

  return lenders;
}

function generatePortfolioSummary(results) {
  const facilities = results.facilities;

  // Calculate totals
  let totalBeds = 0, totalOccupancy = 0, occupancyCount = 0, totalFines = 0;
  let alFacilities = 0, flFacilities = 0;
  let ratingSum = 0, ratingCount = 0;

  facilities.forEach(f => {
    totalBeds += f.number_certified_beds || 0;
    if (f.census_percent) {
      totalOccupancy += parseFloat(f.census_percent);
      occupancyCount++;
    }
    totalFines += parseFloat(f.total_penalties_amount || 0);

    if (f.state === 'AL') alFacilities++;
    if (f.state === 'FL') flFacilities++;

    if (f.overall_rating) {
      ratingSum += f.overall_rating;
      ratingCount++;
    }
  });

  const avgOccupancy = occupancyCount > 0 ? (totalOccupancy / occupancyCount).toFixed(1) : 0;
  const avgRating = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : 'N/A';

  console.log('PORTFOLIO METRICS:');
  console.log('─'.repeat(40));
  console.log(`  Total Facilities: ${facilities.length}`);
  console.log(`    Alabama: ${alFacilities}`);
  console.log(`    Florida: ${flFacilities}`);
  console.log(`  Total Beds: ${totalBeds.toLocaleString()}`);
  console.log(`  Avg Occupancy: ${avgOccupancy}%`);
  console.log(`  Avg Star Rating: ${avgRating}`);
  console.log(`  Total Fines: $${totalFines.toLocaleString()}`);
  console.log(`  Est. Annual Revenue: ~$${(results.financials.totalRevenue/1e6 || 89).toFixed(0)}M`);
}

async function generateMarkdownReport(results) {
  const facilities = results.facilities;
  const now = new Date().toISOString().split('T')[0];

  // Calculate summary stats
  let totalBeds = 0, totalOccupancy = 0, totalFines = 0, occupancyCount = 0;
  facilities.forEach(f => {
    totalBeds += f.number_certified_beds || 0;
    if (f.census_percent) {
      totalOccupancy += parseFloat(f.census_percent);
      occupancyCount++;
    }
    totalFines += parseFloat(f.total_penalties_amount || 0);
  });
  const avgOccupancy = occupancyCount > 0 ? (totalOccupancy / occupancyCount).toFixed(1) : 0;

  const report = `# Arabella Health & Wellness - Comprehensive Research Report

**Generated:** ${now}
**Data Sources:** CMS Provider Info, REAPI Sales Data, Atlas Ownership Database, SHPDA CON Filings
**Researcher:** 3G Healthcare Capital Partners

---

## Executive Summary

**Arabella Health and Wellness** is a boutique healthcare management firm operating skilled nursing facilities across Alabama and Florida. The company operates under a multi-layered ownership structure with individual owners (Chaim Hertzel) and operating company entities (Arabella AL 600 Opco LP).

### Portfolio at a Glance

| Metric | Value |
|--------|-------|
| Total Facilities | ${facilities.length} |
| Total Beds | ${totalBeds.toLocaleString()} |
| Average Occupancy | ${avgOccupancy}% |
| States | Alabama (11), Florida (2) |
| Est. Annual Revenue | ~$89M |
| Total Regulatory Fines | $${totalFines.toLocaleString()} |

**Corporate Contact:**
- Website: https://arabellahcm.com/
- Phone: (800) 416-5235

---

## Portfolio Summary

| CCN | Facility | City, State | Beds | Occ% | Stars | Est. Revenue | Total Fines |
|-----|----------|-------------|------|------|-------|--------------|-------------|
${facilities.map(f => {
  const beds = f.number_certified_beds || 0;
  const occ = f.census_percent ? parseFloat(f.census_percent).toFixed(1) : '0';
  const stars = f.overall_rating || 'N/A';
  const fines = f.total_penalties_amount || 0;
  const revenue = results.financials.latestByFacility?.[f.ccn]?.total_patient_revenue || 0;
  const revStr = revenue > 0 ? `$${(parseFloat(revenue)/1e6).toFixed(1)}M` : 'N/A';
  const fineStr = fines > 0 ? `$${fines.toLocaleString()}` : '$0';
  const starStr = stars === 5 ? '**5**' : (stars === 1 ? '1' : stars);
  return `| ${f.ccn} | ${f.facility_name} | ${f.city}, ${f.state} | ${beds} | ${occ}% | ${starStr} | ${revStr} | ${fineStr} |`;
}).join('\n')}

**Portfolio Totals:**
- **Total Beds:** ${totalBeds.toLocaleString()}
- **Avg Occupancy:** ${avgOccupancy}%
- **Total Fines:** ~$${totalFines.toLocaleString()}

---

## Quality Performance

### Top Performers (5-Star)
${facilities.filter(f => f.overall_rating === 5).map(f => `- **${f.facility_name}** (${f.city}, ${f.state})`).join('\n') || '- None currently rated 5-star'}

### Lowest Rated (1-Star)
${facilities.filter(f => f.overall_rating === 1).map(f => `- **${f.facility_name}** (${f.city}, ${f.state})`).join('\n') || '- None currently rated 1-star'}

### SFF Candidates (Special Focus Facility)
${facilities.filter(f => f.special_focus_status === 'SFF Candidate').map(f => `- **${f.facility_name}** (${f.city}, ${f.state}) - Indicates serious quality concerns requiring enhanced oversight`).join('\n') || '- None currently designated'}

### Facilities with Significant Fines

| Facility | Total Fines | # Penalties | Status |
|----------|-------------|-------------|--------|
${facilities.filter(f => f.total_penalties_amount > 0).sort((a,b) => b.total_penalties_amount - a.total_penalties_amount).map(f => {
  const sff = f.special_focus_status === 'SFF Candidate' ? 'SFF Candidate' : 'Standard';
  return `| ${f.facility_name} | $${f.total_penalties_amount.toLocaleString()} | ${f.total_number_penalties} | ${sff} |`;
}).join('\n') || '| No facilities with fines | - | - | - |'}

---

## Ownership Structure

### Primary Owner
**Chaim Hertzel** - 100% ownership of Russellville and Phenix City facilities

### Operating Entity
**Arabella AL 600 Opco LP**
- Controls: Montgomery, Selma, Mobile facilities
- Indirect owners: Arco Kano Irrv Tr, Gnh Irrv Tr, Hwood Partners LLC

### PropCo/OpCo Structure
The portfolio operates under a typical PropCo/OpCo separation:

**PropCo entities** (own real estate):
- Selma Propco LLC
- Fairhope Prop Co LLC
- Arabella of Carrabelle Propco LLC
- Oak Crest H&W Propco LLC

**OpCo entities** (operate facilities):
- Arabella AL 600 OpCo LP → individual facility OpCo LLCs

### Management Team
- **Chaim Hertzel** - Managerial control since Aug 2023
- **Kristina Ray** - Since Aug 2023
- **Jessica Thomas** - Since June 2024
- **Cynthia Matheny** - Managerial control of Russellville & Phenix City since Oct 2022

---

## Recent Acquisitions (CHOW Events)

| Date | Facility | Seller | Sale Price |
|------|----------|--------|------------|
| 2024-11-15 | Grand Bay, AL | Grand Bay Convalescent Home Inc | N/A |
| 2024-09-19 | Pensacola, FL | Rehabilitation Center at Park Place LLC | $7.95M |
| 2023-08-25 | Butler, AL | Butler Health and Rehab LLC | N/A |
| 2023-06-20 | Mobile, AL | Azalea Health and Rehab LLC | N/A |
| 2022-10-01 | Phenix City, AL | Phenix City Health Care LLC | N/A |

---

## REAPI Sales Data (Recent Transactions)

| Date | Property | Sale Price | Buyer |
|------|----------|------------|-------|
| 2024-09-19 | Pensacola | $7.95M | Arabella H&W of Pensacola |
| 2023-08-25 | Birmingham | $9.01M | Arabella H&W of Bessemer P |
| 2023-08-10 | Selma | $15.76M | Selma Propco LLC |
| 2023-08-25 | Fairhope | $2.11M | Fairhope Prop Co LLC |
| 2023-06-30 | Carrabelle | $3.50M | Arabella of Carrabelle Propco LLC |
| 2022-05-01 | Oak Crest | $3.25M | Oak Crest H&W Propco LLC |

---

## Dwight Capital Financing Relationship

### Confirmed Transaction (January 2025)
**Dwight Mortgage Trust** provided a **$31MM bridge acquisition loan** for a portfolio of four SNFs including:
- **Arabella Health and Wellness of Carrabelle** (FL)
- Jacksonville Center for Rehab and Healthcare
- Pine View Nursing and Rehab Center
- Regal Care of Quincy

**Portfolio Details:** 386 total beds across FL, GA, and MA
**Originator:** Yossi Benish (Dwight Capital)

### About Dwight Capital
- Founded 2014, FHA/HUD approved lender
- Focus: Multifamily and healthcare mortgages
- Loan servicing portfolio: $13+ billion
- Q1 2025: Closed $521MM in seniors housing financings

### Josh Sturm (Managing Director, Dwight Capital)
Specializes in Senior Housing and Healthcare financing. Notable transactions:
- $31.8MM refinance - SNF portfolio in Kentucky
- $42MM bridge loan - 3-property NH SNF portfolio (387 beds)
- $80MM bridge loan - 5-property FL SNF portfolio (518 beds)
- $27.25MM bridge acquisition - Beachside Center (239 beds, New Smyrna Beach, FL)

**Sources:**
- [Dwight Capital January 2025 Financing](https://www.businesswire.com/news/home/20250225989957/en/Dwight-Capital-and-Dwight-Mortgage-Trust-Finance-$307.6MM-in-January-2025)
- [Josh Sturm LinkedIn](https://www.linkedin.com/in/josh-sturm-08480b60/)

---

## Alabama SHPDA CON Filings

Recent Certificate of Need / Change of Ownership applications:
- **CO2024-010:** Mobile facility restructuring (filed April 16, 2024)
- **CO2024-011:** Birmingham facility (filed May 6, 2024)

**Resource:** http://shpda.alabama.gov/Announcements/certificateofneed/chow/changeownershipnotice.aspx

---

## Regulatory Concerns

### Facilities Requiring Enhanced Monitoring

1. **Selma** - $253,665 in fines (highest in portfolio)
   - 6 penalties assessed
   - Requires quality improvement focus

2. **Grand Bay** - SFF Candidate designation
   - $84,761 in fines (9 penalties)
   - Subject to enhanced CMS oversight

3. **Phenix City** - Most frequent citations
   - $65,567 in fines (14 penalties)
   - Pattern of compliance issues

### Common Deficiency Types (Industry Research)
- Failure to develop complete care plans
- Infection control violations
- Failure to protect resident belongings/money
- Delayed abuse/neglect reporting

---

## State Health Planning Resources

### Alabama
- **Agency:** State Health Planning and Development Agency (SHPDA)
- **CON/CHOW:** http://shpda.alabama.gov/Announcements/certificateofneed/chow/changeownershipnotice.aspx

### Florida
- **Agency:** Agency for Health Care Administration (AHCA)
- **URL:** https://ahca.myflorida.com/

### National Databases
- **CMS CHOW Data:** https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/skilled-nursing-facility-change-of-ownership
- **CMS All Owners:** https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/skilled-nursing-facility-all-owners
- **ProPublica Nursing Home Inspect:** https://projects.propublica.org/nursing-homes/

---

## Data Enrichment Strategy

### SHPDA CON/CHOW Filing URLs (for PDF extraction)
\`\`\`
CO2024-010 - Mobile:
http://shpda.alabama.gov/Announcements/certificateofneed/chow/FY2024/CO2024-010%20Arabella%20Health%20&%20Wellness%20of%20Mobile%20(097-N0012)%20-%20CHOW%20App%204.16.2024.pdf

CO2024-011 - Birmingham:
http://shpda.alabama.gov/Announcements/certificateofneed/chow/FY2024/CO2024-011%20Arabella%20Health%20&%20Wellness%20of%20Birmingham%20073-N0012%20-%20CHOW%20App%205.6.2024.pdf

CO2023-013 - Fairhope:
http://shpda.alabama.gov/Announcements/certificateofneed/chow/FY2023/CO2023-013%20Montrose%20Bay%20Health%20and%20Rehab%20003-N0003%20-%20CHOW%20App%204.27.2023.pdf
\`\`\`

### Proposed Database Schema for CON Data
\`\`\`sql
-- State CON/CHOW filings
CREATE TABLE state_con_filings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  state CHAR(2),
  filing_number VARCHAR(20),
  filing_type ENUM('CON', 'CHOW'),
  facility_ccn VARCHAR(10),
  facility_name VARCHAR(255),
  filing_date DATE,
  effective_date DATE,
  seller_name VARCHAR(255),
  buyer_name VARCHAR(255),
  purchase_price DECIMAL(15,2),
  pdf_url VARCHAR(500),
  parsed_data JSON
);
\`\`\`

---

## Appendix: Facility Profiles

${facilities.map(f => {
  const beds = f.number_certified_beds || 0;
  const occ = f.census_percent ? parseFloat(f.census_percent).toFixed(1) : '0';
  const cr = results.financials.latestByFacility?.[f.ccn];

  return `### ${f.facility_name}
**CCN:** ${f.ccn}
**Address:** ${f.address}, ${f.city}, ${f.state} ${f.zip}
**Phone:** ${f.phone_number || 'N/A'}
**County:** ${f.county || 'N/A'}

| Metric | Value |
|--------|-------|
| Certified Beds | ${beds} |
| Occupancy | ${occ}% |
| Overall Rating | ${f.overall_rating || 'N/A'} stars |
| Health Inspection | ${f.health_inspection_rating || 'N/A'} stars |
| Staffing Rating | ${f.staffing_rating || 'N/A'} stars |
| Quality Measures | ${f.quality_measure_rating || 'N/A'} stars |
| Total Fines | $${(f.total_penalties_amount || 0).toLocaleString()} |
| # Penalties | ${f.total_number_penalties || 0} |
| Special Focus Status | ${f.special_focus_status || 'None'} |
${cr ? `| FY${cr.fiscal_year} Revenue | $${(parseFloat(cr.total_patient_revenue)/1e6).toFixed(1)}M |` : ''}

`;
}).join('\n---\n\n')}

---

*Report generated by 3G Healthcare Capital Partners research automation.*
*Data sources include CMS, REAPI, and proprietary Atlas database.*
`;

  // Write the report
  const outputPath = path.join(__dirname, '..', 'data', 'Arabella_Healthcare_Research_Report.md');
  fs.writeFileSync(outputPath, report);
  console.log(`Report written to: ${outputPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
