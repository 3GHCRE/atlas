const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, 'KS_2026-01_rates.xlsx');

try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Create CSV output
    let csv = 'state,provider_number,facility_name,daily_rate,effective_date,city\n';
    let count = 0;

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[0]) continue;

        const facilityName = String(row[0]).trim();
        const city = String(row[1] || '').trim();
        const rate = row[3]; // FINAL 1/1/26 Rate

        if (facilityName && rate && !isNaN(parseFloat(rate))) {
            // Use row index as provider number since not provided
            const providerNum = String(100000 + i).padStart(6, '0');
            const rateValue = parseFloat(rate).toFixed(2);

            // Escape facility name for CSV
            const escapedName = facilityName.includes(',') ? `"${facilityName}"` : facilityName;
            const escapedCity = city.includes(',') ? `"${city}"` : city;

            csv += `KS,${providerNum},${escapedName},${rateValue},2026-01-01,${escapedCity}\n`;
            count++;
        }
    }

    // Write to file
    const outputPath = path.join(__dirname, 'KS_2026-01_rates.csv');
    fs.writeFileSync(outputPath, csv);

    console.log(`Successfully extracted ${count} Kansas facilities`);
    console.log(`Output: ${outputPath}`);

    // Show first few lines
    console.log('\nFirst 10 lines:');
    const lines = csv.split('\n').slice(0, 11);
    lines.forEach(line => console.log(line));

} catch (err) {
    console.error('Error:', err.message);
}
