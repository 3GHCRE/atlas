/**
 * Extract cost report preparer/certifier information from CMS HCRIS SNF data.
 * Uses streaming to handle large files efficiently.
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..');
const RAW_DIR = path.join(BASE_DIR, 'raw');
const OUTPUT_DIR = path.join(BASE_DIR, 'output');
const RPT_FILE = path.join(RAW_DIR, 'SNF10_2024_rpt.csv');
const ALPHA_FILE = path.join(RAW_DIR, 'SNF10_2024_alpha.csv');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'snf_preparers_2024.csv');
const SUMMARY_FILE = path.join(OUTPUT_DIR, 'snf_certifier_summary_2024.csv');

// Fields to extract from Worksheet S000002 (Certification)
const CERT_FIELDS = {
    'S000002|00100|00100': 'certifier_name',
    'S000002|00200|00100': 'certifier_printed_name',
    'S000002|00300|00100': 'certifier_title',
    'S000002|00400|00100': 'certifier_date',
};

// Fields from S200001 (Provider Identification)
const S2_FIELDS = {
    'S200001|00100|00100': 'address',
    'S200001|00200|00100': 'city',
    'S200001|00200|00200': 'state',
    'S200001|00200|00300': 'zip',
    'S200001|00400|00100': 'facility_name',
};

async function loadRptData() {
    console.log(`Loading report file: ${RPT_FILE}`);
    const reports = new Map();

    const fileStream = fs.createReadStream(RPT_FILE);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
        const parts = line.split(',');
        const rptRecNum = parts[0];
        reports.set(rptRecNum, {
            rpt_rec_num: rptRecNum,
            prvdr_ctrl_type_cd: parts[1],
            prvdr_num: parts[2],
            npi: parts[3],
            rpt_stus_cd: parts[4],
            fy_bgn_dt: parts[5],
            fy_end_dt: parts[6],
        });
    }

    console.log(`  Loaded ${reports.size.toLocaleString()} cost reports`);
    return reports;
}

async function extractAlphaFields(reports) {
    console.log(`\nLoading alpha file: ${ALPHA_FILE}`);

    const allFields = { ...CERT_FIELDS, ...S2_FIELDS };
    let lineCount = 0;
    let matchCount = 0;

    const fileStream = fs.createReadStream(ALPHA_FILE);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
        lineCount++;
        if (lineCount % 1000000 === 0) {
            console.log(`  Processed ${(lineCount / 1000000).toFixed(1)}M lines...`);
        }

        const parts = line.split(',');
        const rptRecNum = parts[0];
        const wksht = parts[1];
        const lineNum = parts[2];
        const colNum = parts[3];
        const value = parts.slice(4).join(','); // Handle commas in values

        const key = `${wksht}|${lineNum}|${colNum}`;
        const fieldName = allFields[key];

        if (fieldName && reports.has(rptRecNum)) {
            reports.get(rptRecNum)[fieldName] = value.trim();
            matchCount++;
        }
    }

    console.log(`  Processed ${lineCount.toLocaleString()} alpha records`);
    console.log(`  Extracted ${matchCount.toLocaleString()} field values`);
    return reports;
}

function analyzeCertifiers(reports) {
    console.log('\n' + '='.repeat(70));
    console.log('CERTIFIER ANALYSIS');
    console.log('='.repeat(70));

    // Count by certifier
    const certifierCounts = new Map();
    let withCertifier = 0;

    for (const [_, record] of reports) {
        const name = (record.certifier_name || '').toUpperCase().trim();
        const title = (record.certifier_title || '').toUpperCase().trim();

        if (name) {
            withCertifier++;
            const key = `${name}|||${title}`;
            certifierCounts.set(key, (certifierCounts.get(key) || 0) + 1);
        }
    }

    // Sort by count
    const sorted = [...certifierCounts.entries()]
        .map(([key, count]) => {
            const [name, title] = key.split('|||');
            return { name, title, count };
        })
        .sort((a, b) => b.count - a.count);

    console.log(`\nTop 30 Certifiers by Facility Count:\n`);
    console.log(`${'Certifier Name'.padEnd(40)} ${'Title'.padEnd(30)} ${'Facilities'.padStart(10)}`);
    console.log('-'.repeat(85));

    for (const { name, title, count } of sorted.slice(0, 30)) {
        console.log(`${name.slice(0, 40).padEnd(40)} ${title.slice(0, 30).padEnd(30)} ${count.toString().padStart(10)}`);
    }

    // Title analysis
    console.log('\n\nTop Certifier Titles:');
    const titleCounts = new Map();
    for (const { title, count } of sorted) {
        if (title) {
            titleCounts.set(title, (titleCounts.get(title) || 0) + count);
        }
    }
    const sortedTitles = [...titleCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [title, count] of sortedTitles.slice(0, 15)) {
        console.log(`  ${title}: ${count.toLocaleString()}`);
    }

    // Summary stats
    console.log(`\n\nSummary Statistics:`);
    console.log(`  Total cost reports: ${reports.size.toLocaleString()}`);
    console.log(`  Reports with certifier: ${withCertifier.toLocaleString()}`);
    console.log(`  Unique certifiers: ${certifierCounts.size.toLocaleString()}`);
    console.log(`  Avg facilities per certifier: ${(withCertifier / certifierCounts.size).toFixed(1)}`);

    return sorted;
}

async function saveResults(reports, certifiers) {
    // Save full dataset
    console.log(`\nSaving full dataset to: ${OUTPUT_FILE}`);
    const headers = [
        'rpt_rec_num', 'prvdr_num', 'npi', 'prvdr_ctrl_type_cd',
        'fy_bgn_dt', 'fy_end_dt', 'rpt_stus_cd',
        'facility_name', 'address', 'city', 'state', 'zip',
        'certifier_name', 'certifier_printed_name', 'certifier_title', 'certifier_date'
    ];

    const output = fs.createWriteStream(OUTPUT_FILE);
    output.write(headers.join(',') + '\n');

    for (const [_, record] of reports) {
        const row = headers.map(h => {
            const val = record[h] || '';
            // Escape commas and quotes
            if (val.includes(',') || val.includes('"')) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        });
        output.write(row.join(',') + '\n');
    }
    output.end();
    console.log(`  Saved ${reports.size.toLocaleString()} records`);

    // Save certifier summary
    console.log(`\nSaving certifier summary to: ${SUMMARY_FILE}`);
    const summaryOutput = fs.createWriteStream(SUMMARY_FILE);
    summaryOutput.write('certifier_name,certifier_title,facility_count\n');
    for (const { name, title, count } of certifiers) {
        const safeName = name.includes(',') ? `"${name}"` : name;
        const safeTitle = title.includes(',') ? `"${title}"` : title;
        summaryOutput.write(`${safeName},${safeTitle},${count}\n`);
    }
    summaryOutput.end();
    console.log(`  Saved ${certifiers.length.toLocaleString()} unique certifiers`);
}

async function main() {
    console.log('CMS HCRIS SNF Cost Report Preparer Extraction');
    console.log('='.repeat(50));

    const reports = await loadRptData();
    await extractAlphaFields(reports);
    const certifiers = analyzeCertifiers(reports);
    await saveResults(reports, certifiers);

    console.log('\nDone!');
}

main().catch(console.error);
