const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, 'WI_SFY2026_MCO_rates.xlsx');

try {
    const workbook = XLSX.readFile(filePath);

    // Read the Final Rates sheet
    const sheetName = 'Final Rates 7.1.25';
    console.log(`\n=== Sheet: ${sheetName} ===`);
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    console.log('Total rows:', data.length);
    console.log('\nFirst 20 rows:');
    for (let i = 0; i < Math.min(20, data.length); i++) {
        console.log(`Row ${i}: ${JSON.stringify(data[i]).substring(0, 500)}`);
    }

    // Find column headers
    console.log('\n=== Looking for header row ===');
    for (let i = 0; i < Math.min(15, data.length); i++) {
        const row = data[i];
        if (!row) continue;

        // Check if this row has multiple header-like values
        let headerCount = 0;
        for (let j = 0; j < Math.min(20, row.length); j++) {
            const cell = String(row[j] || '').toLowerCase();
            if (cell.includes('facility') || cell.includes('rate') || cell.includes('name') ||
                cell.includes('popid') || cell.includes('city') || cell.includes('nursing')) {
                headerCount++;
            }
        }
        if (headerCount >= 2) {
            console.log(`Possible header row ${i}:`, row.slice(0, 15));
        }
    }

} catch (err) {
    console.error('Error:', err.message);
}
