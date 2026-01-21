const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'WI_SFY2026_MCO_rates.xlsx');

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

    // Look for provider/facility names and rate columns
    console.log('\n=== Looking for rate columns ===');
    for (let i = 0; i < Math.min(10, data.length); i++) {
        const row = data[i];
        if (!row) continue;
        for (let j = 0; j < row.length; j++) {
            const cell = String(row[j] || '');
            if (cell.toLowerCase().includes('provider') ||
                cell.toLowerCase().includes('facility') ||
                cell.toLowerCase().includes('rate') ||
                cell.toLowerCase().includes('per diem')) {
                console.log(`Row ${i}, Col ${j}: "${cell}"`);
            }
        }
    }

} catch (err) {
    console.error('Error:', err.message);
}
