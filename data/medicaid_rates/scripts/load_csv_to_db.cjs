/**
 * Load Medicaid rates from CSV files to MySQL database
 * Loads states that exist in CSV but not in DB
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const mysql = require('mysql2/promise');

const BASE_DIR = path.join(__dirname, '..');
const INPUT_DIR = path.join(BASE_DIR, 'compiled');

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'atlas',
    user: process.env.DB_USER || 'atlas_user',
    password: process.env.DB_PASSWORD || 'atlas_pass',
};

// States to load (exist in CSV but not in DB)
const STATES_TO_LOAD = ['AK', 'HI', 'KS'];

async function loadCSV(filepath) {
    const records = [];
    const fileStream = fs.createReadStream(filepath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isHeader = true;
    let headers = [];

    for await (const line of rl) {
        if (isHeader) {
            headers = line.split(',');
            isHeader = false;
            continue;
        }

        // Parse CSV (handle quoted fields)
        const parts = [];
        let current = '';
        let inQuotes = false;
        for (const char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                parts.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        parts.push(current);

        const record = {};
        headers.forEach((h, i) => record[h] = parts[i] || '');
        records.push(record);
    }

    return records;
}

async function main() {
    console.log('Loading Medicaid Rates from CSV to MySQL');
    console.log('='.repeat(60));

    // Connect to MySQL
    console.log('\nConnecting to MySQL...');
    const connection = await mysql.createConnection(DB_CONFIG);
    console.log('  Connected successfully');

    // Find CSV files for states to load
    const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('_rates.csv'));

    const insertSQL = `
        INSERT INTO medicaid_rates
        (state, facility_name, state_facility_id, daily_rate, effective_date,
         rate_type, data_source, source_file)
        VALUES (?, ?, ?, ?, ?, 'total', 'state_medicaid', ?)
    `;

    let totalLoaded = 0;

    for (const state of STATES_TO_LOAD) {
        // Find file for this state
        const stateFile = files.find(f => f.startsWith(`${state}_`));
        if (!stateFile) {
            console.log(`\nNo CSV file found for ${state}, skipping`);
            continue;
        }

        const filepath = path.join(INPUT_DIR, stateFile);
        console.log(`\nLoading ${state} from ${stateFile}...`);

        // Check if state already has records
        const [existing] = await connection.execute(
            'SELECT COUNT(*) as count FROM medicaid_rates WHERE state = ?',
            [state]
        );

        if (existing[0].count > 0) {
            console.log(`  State ${state} already has ${existing[0].count} records, clearing...`);
            await connection.execute('DELETE FROM medicaid_rates WHERE state = ?', [state]);
        }

        // Load CSV
        const records = await loadCSV(filepath);
        console.log(`  Read ${records.length} records from CSV`);

        // Insert records
        let inserted = 0;
        for (const record of records) {
            try {
                await connection.execute(insertSQL, [
                    record.state,
                    record.facility_name,
                    record.provider_number || null,
                    parseFloat(record.daily_rate),
                    record.effective_date,
                    stateFile
                ]);
                inserted++;
            } catch (err) {
                console.error(`  Error inserting ${record.facility_name}: ${err.message}`);
            }
        }

        console.log(`  Inserted ${inserted} records`);
        totalLoaded += inserted;
    }

    // Match to property_master by facility name
    console.log('\nMatching to property_master...');
    for (const state of STATES_TO_LOAD) {
        const [result] = await connection.execute(`
            UPDATE medicaid_rates mr
            JOIN property_master pm ON
                mr.state = pm.state
                AND (
                    LOWER(mr.facility_name) = LOWER(pm.facility_name)
                    OR LOWER(mr.facility_name) LIKE CONCAT('%', LOWER(pm.facility_name), '%')
                    OR LOWER(pm.facility_name) LIKE CONCAT('%', LOWER(mr.facility_name), '%')
                )
            SET mr.property_master_id = pm.id,
                mr.ccn = pm.ccn
            WHERE mr.state = ? AND mr.property_master_id IS NULL
        `, [state]);
        console.log(`  ${state}: Matched ${result.affectedRows} records`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const [stats] = await connection.execute(`
        SELECT
            state,
            COUNT(*) as total,
            COUNT(property_master_id) as matched,
            ROUND(AVG(daily_rate), 2) as avg_rate
        FROM medicaid_rates
        WHERE state IN ('AK', 'HI', 'KS')
        GROUP BY state
        ORDER BY state
    `);

    console.log(`\n${'State'.padEnd(6)} ${'Total'.padStart(8)} ${'Matched'.padStart(8)} ${'Avg Rate'.padStart(10)}`);
    console.log('-'.repeat(35));
    for (const row of stats) {
        console.log(
            `${row.state.padEnd(6)} ` +
            `${row.total.toString().padStart(8)} ` +
            `${row.matched.toString().padStart(8)} ` +
            `$${row.avg_rate.toString().padStart(9)}`
        );
    }

    console.log(`\nTotal loaded: ${totalLoaded.toLocaleString()} records`);

    await connection.end();
    console.log('\nDone!');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
