/**
 * Analyze certifiers to identify chains/organizations they represent.
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(BASE_DIR, 'output');
const INPUT_FILE = path.join(OUTPUT_DIR, 'snf_preparers_2024.csv');

async function main() {
    console.log('Analyzing Certifiers and Their Organizations');
    console.log('='.repeat(60));

    // Load data
    const certifierFacilities = new Map();
    const fileStream = fs.createReadStream(INPUT_FILE);
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

        const certifier = record.certifier_name?.toUpperCase().trim();
        const title = record.certifier_title?.toUpperCase().trim();
        const facility = record.facility_name?.trim();
        const city = record.city?.trim();
        const state = record.state?.trim();
        const prvdrNum = record.prvdr_num?.trim();

        if (certifier) {
            const key = `${certifier}|||${title}`;
            if (!certifierFacilities.has(key)) {
                certifierFacilities.set(key, {
                    name: certifier,
                    title: title,
                    facilities: [],
                    states: new Set(),
                    providerNums: []
                });
            }
            const entry = certifierFacilities.get(key);
            entry.facilities.push(facility);
            entry.states.add(state);
            entry.providerNums.push(prvdrNum);
        }
    }

    // Sort by facility count
    const sorted = [...certifierFacilities.values()]
        .sort((a, b) => b.facilities.length - a.facilities.length);

    // Output top certifiers with sample facilities
    console.log('\n' + '='.repeat(80));
    console.log('TOP 25 CERTIFIERS WITH SAMPLE FACILITIES');
    console.log('='.repeat(80));

    for (const cert of sorted.slice(0, 25)) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`CERTIFIER: ${cert.name}`);
        console.log(`TITLE: ${cert.title}`);
        console.log(`FACILITIES: ${cert.facilities.length}`);
        console.log(`STATES: ${[...cert.states].sort().join(', ')}`);

        // Identify common patterns in facility names
        const facilityNames = cert.facilities;
        const words = {};
        for (const name of facilityNames) {
            for (const word of (name || '').toUpperCase().split(/\s+/)) {
                if (word.length > 3) {
                    words[word] = (words[word] || 0) + 1;
                }
            }
        }
        const commonWords = Object.entries(words)
            .filter(([_, count]) => count >= Math.min(5, facilityNames.length * 0.3))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([word, count]) => `${word} (${count})`);

        if (commonWords.length > 0) {
            console.log(`COMMON TERMS: ${commonWords.join(', ')}`);
        }

        // Sample facilities
        console.log(`SAMPLE FACILITIES:`);
        const samples = facilityNames.slice(0, 8);
        for (const fac of samples) {
            console.log(`  • ${fac}`);
        }
        if (facilityNames.length > 8) {
            console.log(`  ... and ${facilityNames.length - 8} more`);
        }
    }

    // Identify likely external preparers (those serving multiple chains)
    console.log('\n\n' + '='.repeat(80));
    console.log('LIKELY EXTERNAL PREPARERS / CONSULTING FIRMS');
    console.log('(Based on diverse facility naming patterns across multiple states)');
    console.log('='.repeat(80));

    const likelyExternal = sorted.filter(c => {
        // Multiple states + diverse naming = likely external
        return c.states.size >= 5 && c.facilities.length >= 20;
    });

    for (const cert of likelyExternal.slice(0, 15)) {
        console.log(`\n${cert.name} (${cert.title})`);
        console.log(`  Facilities: ${cert.facilities.length} across ${cert.states.size} states`);
        console.log(`  States: ${[...cert.states].sort().join(', ')}`);
    }

    // Identify likely chain executives
    console.log('\n\n' + '='.repeat(80));
    console.log('LIKELY CHAIN EXECUTIVES');
    console.log('(Based on concentrated state presence or naming patterns)');
    console.log('='.repeat(80));

    const chainPatterns = [
        { pattern: /GENESIS|SKILLED|HEALTHCARE/i, chain: 'Genesis Healthcare' },
        { pattern: /ENSIGN|TOUCHSTONE|KEYSTONE/i, chain: 'Ensign Group' },
        { pattern: /SABRA|CARE SPRINGS/i, chain: 'Sabra Healthcare' },
        { pattern: /PACS|PACIFIC/i, chain: 'PACS Group' },
        { pattern: /DIVERSIFIED|DHSC/i, chain: 'Diversified Health' },
        { pattern: /LIFE CARE|LIFECARE/i, chain: 'Life Care Centers' },
        { pattern: /SAVA|SAVANNAH/i, chain: 'SavaSeniorCare' },
        { pattern: /CENTER|NURSING|REHAB/i, chain: 'Generic (multiple chains)' },
    ];

    for (const cert of sorted.slice(0, 30)) {
        if (cert.states.size <= 3 && cert.facilities.length >= 30) {
            // Identify potential chain
            const sampleNames = cert.facilities.slice(0, 20).join(' ');
            let likelyChain = 'Unknown Chain';
            for (const { pattern, chain } of chainPatterns) {
                if (pattern.test(sampleNames)) {
                    likelyChain = chain;
                    break;
                }
            }

            console.log(`\n${cert.name} (${cert.title})`);
            console.log(`  Facilities: ${cert.facilities.length} in ${[...cert.states].join(', ')}`);
            console.log(`  Likely Chain: ${likelyChain}`);
        }
    }

    // Save detailed output
    const outputFile = path.join(OUTPUT_DIR, 'certifier_chain_analysis.csv');
    const out = fs.createWriteStream(outputFile);
    out.write('certifier_name,title,facility_count,state_count,states,sample_facilities,classification\n');

    for (const cert of sorted) {
        const stateCount = cert.states.size;
        const states = [...cert.states].sort().join(';');
        const samples = cert.facilities.slice(0, 5).join('; ').replace(/,/g, '').slice(0, 200);

        let classification = 'Unknown';
        if (stateCount >= 10) classification = 'Likely External Preparer';
        else if (stateCount >= 5 && cert.facilities.length >= 30) classification = 'Multi-State Chain or External';
        else if (stateCount <= 2 && cert.facilities.length >= 20) classification = 'Likely Single Chain';
        else if (cert.facilities.length < 5) classification = 'Small Operator';
        else classification = 'Regional Chain or Consultant';

        out.write(`"${cert.name}","${cert.title}",${cert.facilities.length},${stateCount},"${states}","${samples}","${classification}"\n`);
    }
    out.end();
    console.log(`\n\nSaved detailed analysis to: ${outputFile}`);
}

main().catch(console.error);
