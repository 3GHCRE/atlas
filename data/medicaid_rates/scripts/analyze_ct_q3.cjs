const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'CT_Q3_2025_case_mix.xlsx');

try {
    const workbook = XLSX.readFile(filePath);
    console.log('Sheet names:', workbook.SheetNames);

    // Read each sheet
    for (const sheetName of workbook.SheetNames) {
        console.log(`\n=== Sheet: ${sheetName} ===`);
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        console.log('Total rows:', data.length);
        console.log('\nFirst 10 rows:');
        for (let i = 0; i < Math.min(10, data.length); i++) {
            console.log(`Row ${i}: ${JSON.stringify(data[i]).substring(0, 300)}`);
        }
    }

} catch (err) {
    console.error('Error:', err.message);
}
