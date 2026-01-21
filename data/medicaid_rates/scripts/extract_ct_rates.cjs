const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, 'CT_rate_comp_data_2012-2024.xlsx');

try {
    const workbook = XLSX.readFile(filePath);
    console.log('Sheet names:', workbook.SheetNames);

    // Read the 2024 sheet (most recent)
    const sheetName = '2024';
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    console.log('\n=== 2024 Sheet ===');
    console.log('Total rows:', data.length);

    // Print first 15 rows to understand structure
    console.log('\nFirst 15 rows:');
    for (let i = 0; i < Math.min(15, data.length); i++) {
        console.log(`Row ${i}: ${JSON.stringify(data[i])}`);
    }

    // Find the header row and rate column
    let headerRowIdx = -1;
    let facilityColIdx = -1;
    let rateColIdx = -1;

    for (let i = 0; i < Math.min(20, data.length); i++) {
        const row = data[i];
        if (!row) continue;
        for (let j = 0; j < row.length; j++) {
            const cell = String(row[j] || '').toLowerCase();
            if (cell.includes('facility') && cell.includes('name')) {
                headerRowIdx = i;
                facilityColIdx = j;
            }
            if (cell.includes('rate') || cell.includes('per diem')) {
                rateColIdx = j;
            }
        }
    }

    console.log('\nHeader row index:', headerRowIdx);
    console.log('Facility column index:', facilityColIdx);
    console.log('Rate column index:', rateColIdx);

    if (headerRowIdx >= 0) {
        console.log('\nHeader row:', data[headerRowIdx]);
    }

} catch (err) {
    console.error('Error:', err.message);
}
