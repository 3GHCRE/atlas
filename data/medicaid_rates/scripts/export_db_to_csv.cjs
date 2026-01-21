/**
 * Export Medicaid rates from MySQL database to CSV files
 * Exports states that exist in DB but not in CSV files
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BASE_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(BASE_DIR, 'compiled');

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'atlas',
    user: process.env.DB_USER || 'atlas_user',
    password: process.env.DB_PASSWORD || 'atlas_pass',
};

// States to export (exist in DB but not in CSV)
const STATES_TO_EXPORT = ['CA', 'FL', 'IA', 'MA', 'MT', 'ND', 'NH', 'NY', 'SD', 'UT', 'VT', 'WA'];

async function main() {
    console.log('Exporting Medicaid Rates from MySQL to CSV');
    console.log('='.repeat(60));

    // Connect to MySQL
    console.log('\nConnecting to MySQL...');
    const connection = await mysql.createConnection(DB_CONFIG);
    console.log('  Connected successfully');

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    let totalExported = 0;

    for (const state of STATES_TO_EXPORT) {
        console.log(`\nExporting ${state}...`);

        // Query rates for this state
        const [rows] = await connection.execute(`
            SELECT
                state,
                state_facility_id as provider_number,
                facility_name,
                daily_rate,
                DATE_FORMAT(effective_date, '%Y-%m-%d') as effective_date,
                COALESCE(
                    (SELECT city FROM property_master pm WHERE pm.id = mr.property_master_id),
                    ''
                ) as city
            FROM medicaid_rates mr
            WHERE state = ?
            AND end_date IS NULL
            ORDER BY facility_name
        `, [state]);

        if (rows.length === 0) {
            console.log(`  No records found for ${state}, skipping`);
            continue;
        }

        // Get max effective date for filename
        const maxDate = rows.reduce((max, row) => {
            return row.effective_date > max ? row.effective_date : max;
        }, rows[0].effective_date);

        const dateForFile = maxDate.substring(0, 7); // YYYY-MM
        const filename = `${state}_${dateForFile}_rates.csv`;
        const filepath = path.join(OUTPUT_DIR, filename);

        // Write CSV
        const header = 'state,provider_number,facility_name,daily_rate,effective_date,city\n';
        const csvRows = rows.map(row => {
            const name = row.facility_name.includes(',') ? `"${row.facility_name}"` : row.facility_name;
            const city = (row.city || '').includes(',') ? `"${row.city}"` : (row.city || '');
            return `${row.state},${row.provider_number || ''},${name},${row.daily_rate},${row.effective_date},${city}`;
        });

        fs.writeFileSync(filepath, header + csvRows.join('\n') + '\n');
        console.log(`  Exported ${rows.length} records to ${filename}`);
        totalExported += rows.length;
    }

    await connection.end();

    console.log('\n' + '='.repeat(60));
    console.log(`SUMMARY: Exported ${totalExported.toLocaleString()} total records`);
    console.log(`Files created in: ${OUTPUT_DIR}`);
    console.log('Done!');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
