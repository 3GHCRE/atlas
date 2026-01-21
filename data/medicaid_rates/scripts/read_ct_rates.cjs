const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'CT_rate_comp_data_2012-2024.xlsx');

try {
    const workbook = XLSX.readFile(filePath);
    console.log('Sheet names:', workbook.SheetNames);

    // Read first sheet
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    console.log('\nFirst 10 rows:');
    for (let i = 0; i < Math.min(10, data.length); i++) {
        console.log(JSON.stringify(data[i]));
    }

    console.log('\nTotal rows:', data.length);

    // Look for the most recent rate year columns
    const headers = data[0];
    console.log('\nAll columns:', headers);

} catch (err) {
    console.error('Error:', err.message);
}
