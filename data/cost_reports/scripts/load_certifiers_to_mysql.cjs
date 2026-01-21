/**
 * Load cost report certifier data into MySQL and match to property_master
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const mysql = require('mysql2/promise');

const BASE_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(BASE_DIR, 'output');
const INPUT_FILE = path.join(OUTPUT_DIR, 'snf_preparers_2024.csv');

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'atlas',
    user: process.env.DB_USER || 'atlas_user',
    password: process.env.DB_PASSWORD || 'atlas_pass',
};

async function parseDate(dateStr) {
    if (!dateStr || dateStr.trim() === '') return null;
    // Handle MM/DD/YYYY format
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
        const [_, month, day, year] = match;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    // Handle YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }
    return null;
}

async function main() {
    console.log('Loading Cost Report Certifiers to MySQL');
    console.log('='.repeat(60));

    // Connect to MySQL
    console.log('\nConnecting to MySQL...');
    const connection = await mysql.createConnection(DB_CONFIG);
    console.log('  Connected successfully');

    // Create table if not exists
    console.log('\nCreating cost_report_certifiers table...');
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS cost_report_certifiers (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            rpt_rec_num VARCHAR(20) NOT NULL,
            prvdr_num VARCHAR(10) NOT NULL,
            npi VARCHAR(20),
            prvdr_ctrl_type_cd VARCHAR(5),
            fy_bgn_dt DATE,
            fy_end_dt DATE,
            rpt_stus_cd VARCHAR(5),
            facility_name VARCHAR(500),
            address VARCHAR(500),
            city VARCHAR(100),
            state CHAR(2),
            zip VARCHAR(20),
            certifier_name VARCHAR(255),
            certifier_printed_name VARCHAR(255),
            certifier_title VARCHAR(255),
            certifier_date DATE,
            property_master_id INT UNSIGNED,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_prvdr_num (prvdr_num),
            INDEX idx_certifier_name (certifier_name),
            INDEX idx_state (state),
            INDEX idx_property_master (property_master_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Table ready');

    // Clear existing data
    console.log('\nClearing existing data...');
    await connection.execute('DELETE FROM cost_report_certifiers');

    // Load CSV data
    console.log(`\nLoading data from: ${INPUT_FILE}`);
    const fileStream = fs.createReadStream(INPUT_FILE);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isHeader = true;
    let headers = [];
    let rowCount = 0;
    let batch = [];
    const BATCH_SIZE = 500;

    const insertSQL = `
        INSERT INTO cost_report_certifiers
        (rpt_rec_num, prvdr_num, npi, prvdr_ctrl_type_cd, fy_bgn_dt, fy_end_dt,
         rpt_stus_cd, facility_name, address, city, state, zip,
         certifier_name, certifier_printed_name, certifier_title, certifier_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for await (const line of rl) {
        if (isHeader) {
            headers = line.split(',');
            isHeader = false;
            continue;
        }

        // Parse CSV line (handle quoted fields)
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

        const values = [
            record.rpt_rec_num || '',
            record.prvdr_num || '',
            record.npi || null,
            record.prvdr_ctrl_type_cd || null,
            await parseDate(record.fy_bgn_dt),
            await parseDate(record.fy_end_dt),
            record.rpt_stus_cd || null,
            record.facility_name || null,
            record.address || null,
            record.city || null,
            record.state || null,
            record.zip || null,
            record.certifier_name || null,
            record.certifier_printed_name || null,
            record.certifier_title || null,
            await parseDate(record.certifier_date),
        ];

        batch.push(values);
        rowCount++;

        if (batch.length >= BATCH_SIZE) {
            for (const row of batch) {
                await connection.execute(insertSQL, row);
            }
            batch = [];
            if (rowCount % 2000 === 0) {
                console.log(`  Loaded ${rowCount.toLocaleString()} records...`);
            }
        }
    }

    // Insert remaining batch
    for (const row of batch) {
        await connection.execute(insertSQL, row);
    }
    console.log(`  Loaded ${rowCount.toLocaleString()} total records`);

    // Match to property_master by CCN
    console.log('\nMatching to property_master by CCN...');
    const [matchResult] = await connection.execute(`
        UPDATE cost_report_certifiers cr
        JOIN property_master pm ON cr.prvdr_num = pm.ccn
        SET cr.property_master_id = pm.id
    `);
    console.log(`  Matched ${matchResult.affectedRows.toLocaleString()} records`);

    // Generate summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const [totalStats] = await connection.execute(`
        SELECT
            COUNT(*) as total,
            COUNT(property_master_id) as matched,
            COUNT(DISTINCT prvdr_num) as unique_facilities,
            COUNT(DISTINCT certifier_name) as unique_certifiers,
            COUNT(DISTINCT state) as states
        FROM cost_report_certifiers
    `);

    const stats = totalStats[0];
    console.log(`\nTotal cost reports: ${stats.total.toLocaleString()}`);
    console.log(`Matched to property_master: ${stats.matched.toLocaleString()} (${(stats.matched/stats.total*100).toFixed(1)}%)`);
    console.log(`Unique facilities (CCN): ${stats.unique_facilities.toLocaleString()}`);
    console.log(`Unique certifiers: ${stats.unique_certifiers.toLocaleString()}`);
    console.log(`States covered: ${stats.states}`);

    // Top certifiers
    console.log('\n' + '-'.repeat(60));
    console.log('TOP 20 CERTIFIERS (by facility count):');
    console.log('-'.repeat(60));

    const [topCertifiers] = await connection.execute(`
        SELECT
            certifier_name,
            certifier_title,
            COUNT(DISTINCT prvdr_num) as facilities,
            COUNT(DISTINCT state) as states,
            GROUP_CONCAT(DISTINCT state ORDER BY state SEPARATOR ', ') as state_list
        FROM cost_report_certifiers
        WHERE certifier_name IS NOT NULL AND certifier_name != ''
        GROUP BY certifier_name, certifier_title
        ORDER BY facilities DESC
        LIMIT 20
    `);

    console.log(`\n${'Certifier'.padEnd(35)} ${'Title'.padEnd(25)} ${'Fac'.padStart(5)} ${'St'.padStart(3)} States`);
    console.log('-'.repeat(100));
    for (const row of topCertifiers) {
        console.log(
            `${(row.certifier_name || '').slice(0,35).padEnd(35)} ` +
            `${(row.certifier_title || '').slice(0,25).padEnd(25)} ` +
            `${row.facilities.toString().padStart(5)} ` +
            `${row.states.toString().padStart(3)} ` +
            `${row.state_list}`
        );
    }

    // Classification summary
    console.log('\n' + '-'.repeat(60));
    console.log('CERTIFIER CLASSIFICATION:');
    console.log('-'.repeat(60));

    const [classification] = await connection.execute(`
        SELECT
            CASE
                WHEN state_count >= 10 THEN 'External Preparer (10+ states)'
                WHEN state_count >= 5 AND facilities >= 30 THEN 'Multi-State Chain (5+ states)'
                WHEN state_count <= 2 AND facilities >= 20 THEN 'Single Chain Executive'
                WHEN facilities < 5 THEN 'Small Operator (<5 facilities)'
                ELSE 'Regional Chain/Consultant'
            END as category,
            COUNT(*) as certifier_count,
            SUM(facilities) as total_facilities
        FROM (
            SELECT
                certifier_name,
                COUNT(DISTINCT prvdr_num) as facilities,
                COUNT(DISTINCT state) as state_count
            FROM cost_report_certifiers
            WHERE certifier_name IS NOT NULL AND certifier_name != ''
            GROUP BY certifier_name
        ) sub
        GROUP BY category
        ORDER BY total_facilities DESC
    `);

    for (const row of classification) {
        console.log(`  ${row.category}: ${row.certifier_count} certifiers, ${row.total_facilities.toLocaleString()} facilities`);
    }

    await connection.end();
    console.log('\nDone!');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
