/**
 * Georgia PropCo Research
 * Analyzes transactions, buyers, sellers, lenders, financing for GA SNFs
 */

const { getReapiConnection } = require('./lib/db-config');

async function main() {
  const conn = await getReapiConnection();

  console.log('=== GEORGIA PROPCO / TRANSACTION RESEARCH ===\n');

  // 1. CMS Change of Ownership (CHOW) for GA
  console.log('='.repeat(120));
  console.log('SECTION 1: CMS CHANGE OF OWNERSHIP (CHOW) EVENTS');
  console.log('='.repeat(120));

  const [gaChows] = await conn.execute(`
    SELECT
      c.*,
      f.provider_name,
      f.city,
      f.num_certified_beds
    FROM cms_change_of_ownership c
    JOIN cms_facilities_monthly f ON c.ccn_buyer = f.ccn
      AND f.month_date = (SELECT MAX(month_date) FROM cms_facilities_monthly)
    WHERE f.state = 'GA'
    ORDER BY c.effective_date DESC
  `);

  console.log(`\nTotal GA CHOW events: ${gaChows.length}\n`);

  // Recent CHOWs
  console.log('--- Recent Change of Ownership Events ---\n');
  console.log('Date       | CCN    | Facility                              | City           | Beds');
  console.log('-'.repeat(100));
  for (const c of gaChows.slice(0, 25)) {
    const date = c.effective_date ? c.effective_date.toISOString().split('T')[0] : 'N/A';
    console.log(`${date} | ${c.ccn_buyer} | ${(c.provider_name || '').substring(0, 37).padEnd(37)} | ${(c.city || '').padEnd(14)} | ${c.num_certified_beds || ''}`);
    console.log(`           Seller: ${(c.organization_name_seller || 'N/A').substring(0, 60)}`);
    console.log(`           Buyer:  ${(c.organization_name_buyer || 'N/A').substring(0, 60)}`);
    console.log('');
  }

  // Top Buyers
  console.log('\n--- TOP BUYERS (by # of acquisitions) ---\n');
  const [topBuyers] = await conn.execute(`
    SELECT
      c.organization_name_buyer as buyer,
      COUNT(*) as acquisitions,
      GROUP_CONCAT(DISTINCT f.provider_name ORDER BY c.effective_date DESC SEPARATOR '; ') as facilities
    FROM cms_change_of_ownership c
    JOIN cms_facilities_monthly f ON c.ccn_buyer = f.ccn
      AND f.month_date = (SELECT MAX(month_date) FROM cms_facilities_monthly)
    WHERE f.state = 'GA'
    GROUP BY c.organization_name_buyer
    ORDER BY acquisitions DESC
    LIMIT 20
  `);

  console.log('Buyer                                                    | Acq | Facilities');
  console.log('-'.repeat(120));
  for (const b of topBuyers) {
    console.log(`${(b.buyer || 'Unknown').substring(0, 55).padEnd(55)} | ${String(b.acquisitions).padStart(3)} | ${(b.facilities || '').substring(0, 55)}`);
  }

  // Top Sellers
  console.log('\n\n--- TOP SELLERS (by # of divestitures) ---\n');
  const [topSellers] = await conn.execute(`
    SELECT
      c.organization_name_seller as seller,
      COUNT(*) as divestitures,
      GROUP_CONCAT(DISTINCT f.provider_name ORDER BY c.effective_date DESC SEPARATOR '; ') as facilities
    FROM cms_change_of_ownership c
    JOIN cms_facilities_monthly f ON c.ccn_buyer = f.ccn
      AND f.month_date = (SELECT MAX(month_date) FROM cms_facilities_monthly)
    WHERE f.state = 'GA'
    GROUP BY c.organization_name_seller
    ORDER BY divestitures DESC
    LIMIT 20
  `);

  console.log('Seller                                                   | Div | Facilities');
  console.log('-'.repeat(120));
  for (const s of topSellers) {
    console.log(`${(s.seller || 'Unknown').substring(0, 55).padEnd(55)} | ${String(s.divestitures).padStart(3)} | ${(s.facilities || '').substring(0, 55)}`);
  }

  // CHOWs by Year
  console.log('\n\n--- CHOW ACTIVITY BY YEAR ---\n');
  const [chowsByYear] = await conn.execute(`
    SELECT
      YEAR(c.effective_date) as year,
      COUNT(*) as chow_count
    FROM cms_change_of_ownership c
    JOIN cms_facilities_monthly f ON c.ccn_buyer = f.ccn
      AND f.month_date = (SELECT MAX(month_date) FROM cms_facilities_monthly)
    WHERE f.state = 'GA' AND c.effective_date IS NOT NULL
    GROUP BY YEAR(c.effective_date)
    ORDER BY year DESC
  `);

  console.log('Year | CHOW Count');
  console.log('-'.repeat(20));
  for (const y of chowsByYear) {
    console.log(`${y.year} | ${y.chow_count}`);
  }

  // 2. REAPI Sales Data
  console.log('\n\n' + '='.repeat(120));
  console.log('SECTION 2: REAPI SALES HISTORY');
  console.log('='.repeat(120));

  const [gaSales] = await conn.execute(`
    SELECT
      s.*,
      p.ccn,
      f.provider_name,
      f.city,
      f.num_certified_beds
    FROM reapi_sales_history s
    JOIN reapi_properties p ON s.property_id = p.property_id
    JOIN cms_facilities_monthly f ON p.ccn COLLATE utf8mb4_unicode_ci = f.ccn
      AND f.month_date = (SELECT MAX(month_date) FROM cms_facilities_monthly)
    WHERE f.state = 'GA' AND p.ccn IS NOT NULL
    ORDER BY s.recording_date DESC
  `);

  console.log(`\nTotal GA SNF sales records: ${gaSales.length}\n`);

  if (gaSales.length > 0) {
    console.log('--- Recent Sales ---\n');
    console.log('Date       | Facility                              | City           | Beds | Sale Price   | $/Bed');
    console.log('-'.repeat(110));
    for (const s of gaSales.slice(0, 25)) {
      const date = (s.recording_date || s.sale_date)?.toISOString().split('T')[0] || 'N/A';
      const price = s.sale_amount ? `$${(s.sale_amount / 1000000).toFixed(2)}M` : 'N/A';
      const perBed = (s.sale_amount && s.num_certified_beds) ? `$${Math.round(s.sale_amount / s.num_certified_beds).toLocaleString()}` : 'N/A';
      console.log(`${date} | ${(s.provider_name || '').substring(0, 37).padEnd(37)} | ${(s.city || '').padEnd(14)} | ${String(s.num_certified_beds || '').padStart(4)} | ${price.padStart(12)} | ${perBed.padStart(10)}`);
      if (s.buyer_names) console.log(`           Buyer: ${s.buyer_names.substring(0, 80)}`);
      if (s.seller_names) console.log(`           Seller: ${s.seller_names.substring(0, 80)}`);
      console.log('');
    }

    // Sales stats
    const salesWithPrice = gaSales.filter(s => s.sale_amount && s.sale_amount > 0);
    if (salesWithPrice.length > 0) {
      const avgPrice = salesWithPrice.reduce((sum, s) => sum + parseFloat(s.sale_amount), 0) / salesWithPrice.length;
      const maxSale = salesWithPrice.reduce((max, s) => parseFloat(s.sale_amount) > parseFloat(max.sale_amount) ? s : max);
      const salesWithBeds = salesWithPrice.filter(s => s.num_certified_beds > 0);
      const avgPricePerBed = salesWithBeds.length > 0
        ? salesWithBeds.reduce((sum, s) => sum + parseFloat(s.sale_amount) / s.num_certified_beds, 0) / salesWithBeds.length
        : 0;

      console.log('\n--- SALES STATISTICS ---');
      console.log(`Total sales with price data: ${salesWithPrice.length}`);
      console.log(`Average sale price: $${(avgPrice / 1000000).toFixed(2)}M`);
      console.log(`Largest sale: ${maxSale.provider_name} - $${(parseFloat(maxSale.sale_amount) / 1000000).toFixed(2)}M`);
      console.log(`Average price per bed: $${Math.round(avgPricePerBed).toLocaleString()}`);
    }
  }

  // 3. REAPI Mortgages
  console.log('\n\n' + '='.repeat(120));
  console.log('SECTION 3: MORTGAGE / FINANCING DATA');
  console.log('='.repeat(120));

  const [gaMortgages] = await conn.execute(`
    SELECT
      m.*,
      p.ccn,
      f.provider_name,
      f.city,
      f.num_certified_beds
    FROM reapi_mortgages m
    JOIN reapi_properties p ON m.property_id = p.property_id
    JOIN cms_facilities_monthly f ON p.ccn COLLATE utf8mb4_unicode_ci = f.ccn
      AND f.month_date = (SELECT MAX(month_date) FROM cms_facilities_monthly)
    WHERE f.state = 'GA' AND p.ccn IS NOT NULL
    ORDER BY m.recording_date DESC
  `);

  console.log(`\nTotal GA SNF mortgage records: ${gaMortgages.length}\n`);

  if (gaMortgages.length > 0) {
    console.log('--- Recent Mortgages ---\n');
    console.log('Date       | Facility                              | City           | Amount       | Rate   | Lender');
    console.log('-'.repeat(130));
    for (const m of gaMortgages.slice(0, 25)) {
      const date = m.recording_date?.toISOString().split('T')[0] || 'N/A';
      const amount = m.amount ? `$${(m.amount / 1000000).toFixed(2)}M` : 'N/A';
      const rate = m.interest_rate ? `${m.interest_rate}%` : 'N/A';
      console.log(`${date} | ${(m.provider_name || '').substring(0, 37).padEnd(37)} | ${(m.city || '').padEnd(14)} | ${amount.padStart(12)} | ${rate.padStart(6)} | ${(m.lender_name || 'N/A').substring(0, 30)}`);
    }

    // Top Lenders
    console.log('\n\n--- TOP LENDERS ---\n');
    const lenderCounts = {};
    const lenderAmounts = {};
    for (const m of gaMortgages) {
      const lender = m.lender_name || 'Unknown';
      lenderCounts[lender] = (lenderCounts[lender] || 0) + 1;
      lenderAmounts[lender] = (lenderAmounts[lender] || 0) + (parseFloat(m.amount) || 0);
    }

    const lenderStats = Object.entries(lenderCounts)
      .map(([lender, count]) => ({ lender, count, amount: lenderAmounts[lender] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    console.log('Lender                                            | Loans | Total Amount');
    console.log('-'.repeat(80));
    for (const l of lenderStats) {
      const amount = l.amount ? `$${(l.amount / 1000000).toFixed(2)}M` : 'N/A';
      console.log(`${l.lender.substring(0, 48).padEnd(48)} | ${String(l.count).padStart(5)} | ${amount.padStart(12)}`);
    }

    // Mortgage stats
    const mortgagesWithAmount = gaMortgages.filter(m => m.amount && m.amount > 0);
    if (mortgagesWithAmount.length > 0) {
      const totalDebt = mortgagesWithAmount.reduce((sum, m) => sum + parseFloat(m.amount), 0);
      const avgLoan = totalDebt / mortgagesWithAmount.length;
      const mortgagesWithRate = mortgagesWithAmount.filter(m => m.interest_rate);
      const avgRate = mortgagesWithRate.length > 0
        ? mortgagesWithRate.reduce((sum, m) => sum + parseFloat(m.interest_rate), 0) / mortgagesWithRate.length
        : 0;

      console.log('\n--- MORTGAGE STATISTICS ---');
      console.log(`Total mortgage records: ${mortgagesWithAmount.length}`);
      console.log(`Total debt volume: $${(totalDebt / 1000000).toFixed(2)}M`);
      console.log(`Average loan size: $${(avgLoan / 1000000).toFixed(2)}M`);
      if (avgRate > 0) console.log(`Average interest rate: ${avgRate.toFixed(2)}%`);
    }
  }

  // 4. Property Values
  console.log('\n\n' + '='.repeat(120));
  console.log('SECTION 4: PROPERTY VALUES & COMPARABLES');
  console.log('='.repeat(120));

  const [gaValues] = await conn.execute(`
    SELECT
      p.estimated_value,
      p.last_sale_price,
      p.last_sale_date,
      t.assessed_value,
      t.market_value,
      f.provider_name,
      f.city,
      p.ccn,
      f.num_certified_beds,
      f.overall_rating
    FROM reapi_properties p
    JOIN cms_facilities_monthly f ON p.ccn COLLATE utf8mb4_unicode_ci = f.ccn
      AND f.month_date = (SELECT MAX(month_date) FROM cms_facilities_monthly)
    LEFT JOIN reapi_tax_info t ON p.property_id = t.property_id
    WHERE f.state = 'GA' AND p.ccn IS NOT NULL
    ORDER BY COALESCE(p.estimated_value, p.last_sale_price, t.market_value) DESC
  `);

  console.log(`\nGA facilities with REAPI property data: ${gaValues.length}\n`);

  if (gaValues.length > 0) {
    console.log('--- Property Valuations ---\n');
    console.log('CCN    | Facility                              | City           | Beds | Stars | Est Value    | Last Sale    | $/Bed');
    console.log('-'.repeat(130));

    for (const v of gaValues.slice(0, 40)) {
      const estVal = v.estimated_value ? `$${(v.estimated_value / 1000000).toFixed(2)}M` : '-';
      const salePrice = v.last_sale_price ? `$${(v.last_sale_price / 1000000).toFixed(2)}M` : '-';
      const perBed = v.estimated_value && v.num_certified_beds
        ? `$${Math.round(v.estimated_value / v.num_certified_beds).toLocaleString()}`
        : (v.last_sale_price && v.num_certified_beds ? `$${Math.round(v.last_sale_price / v.num_certified_beds).toLocaleString()}` : '-');

      console.log(
        `${v.ccn} | ${(v.provider_name || '').substring(0, 37).padEnd(37)} | ${(v.city || '').padEnd(14)} | ` +
        `${String(v.num_certified_beds || '').padStart(4)} | ${String(v.overall_rating || '-').padStart(5)} | ` +
        `${estVal.padStart(12)} | ${salePrice.padStart(12)} | ${perBed.padStart(10)}`
      );
    }

    // Value stats
    const withEstValue = gaValues.filter(v => v.estimated_value > 0);
    const withSalePrice = gaValues.filter(v => v.last_sale_price > 0);

    if (withEstValue.length > 0 || withSalePrice.length > 0) {
      console.log('\n--- VALUATION STATISTICS ---');
      console.log(`Facilities with estimated value: ${withEstValue.length}`);
      console.log(`Facilities with last sale price: ${withSalePrice.length}`);

      if (withEstValue.length > 0) {
        const totalValue = withEstValue.reduce((sum, v) => sum + parseFloat(v.estimated_value), 0);
        const avgValue = totalValue / withEstValue.length;
        const withBeds = withEstValue.filter(v => v.num_certified_beds > 0);
        const avgPerBed = withBeds.length > 0
          ? withBeds.reduce((sum, v) => sum + parseFloat(v.estimated_value) / v.num_certified_beds, 0) / withBeds.length
          : 0;

        console.log(`Total estimated value: $${(totalValue / 1000000).toFixed(2)}M`);
        console.log(`Average estimated value: $${(avgValue / 1000000).toFixed(2)}M`);
        if (avgPerBed > 0) console.log(`Average value per bed: $${Math.round(avgPerBed).toLocaleString()}`);
      }
    }
  }

  // 5. Summary
  console.log('\n\n' + '='.repeat(120));
  console.log('SUMMARY: GEORGIA SNF PROPCO DATA AVAILABILITY');
  console.log('='.repeat(120));

  const [linkCount] = await conn.execute(`
    SELECT COUNT(DISTINCT p.ccn) as count
    FROM reapi_properties p
    JOIN cms_facilities_monthly f ON p.ccn COLLATE utf8mb4_unicode_ci = f.ccn
      AND f.month_date = (SELECT MAX(month_date) FROM cms_facilities_monthly)
    WHERE f.state = 'GA' AND p.ccn IS NOT NULL
  `);

  console.log(`
  CMS CHOW Events:           ${gaChows.length}
  REAPI Sales Records:       ${gaSales.length}
  REAPI Mortgage Records:    ${gaMortgages.length}
  Properties with Values:    ${gaValues.length}
  Facilities with REAPI Link: ${linkCount[0].count}
  `);

  await conn.end();
  console.log('\n=== END OF PROPCO RESEARCH ===\n');
}

main().catch(console.error);
