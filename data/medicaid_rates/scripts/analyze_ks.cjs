const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, 'KS_2026-01_rates.xlsx');

try {
    const workbook = XLSX.readFile(filePath);
    console.log('Sheet names:', workbook.SheetNames);

    // Read first sheet
    const sheetName = workbook.SheetNames[0];
    console.log(`\n=== Sheet: ${sheetName} ===`);
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    console.log('Total rows:', data.length);
    console.log('\nFirst 15 rows:');
    for (let i = 0; i < Math.min(15, data.length); i++) {
        console.log(`Row ${i}: ${JSON.stringify(data[i]).substring(0, 400)}`);
    }

    // Look for facility names and rate columns
    let facilityCount = 0;
    for (let i = 5; i < data.length; i++) {
        const row = data[i];
        if (row && row[0] && typeof row[0] === 'string' && row[0].length > 5) {
            facilityCount++;
        }
    }
    console.log('\nEstimated facility count:', facilityCount);

} catch (err) {
    console.error('Error:', err.message);
}
