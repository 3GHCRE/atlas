/**
 * Load Zoho CRM Activity Data (Notes, Calls, Tasks, Deals) to Atlas
 *
 * Links CRM activity records to principals and properties via Zoho IDs.
 * Stores both resolved Atlas IDs AND original Zoho IDs for traceability.
 *
 * Usage: node scripts/load-zoho-crm-activity.js [crm_folder_path]
 *
 * Expected Files in CRM folder:
 * - Notes_Principals_2026_01_26.csv
 * - Calls_2026_01_26.csv
 * - Tasks_2026_01_26.csv
 * - Deals_2026_01_26.csv
 * - Deals__2026_01_26.csv (stage history)
 * - Principals_X_Properties_2026_01_26.csv (junction for validation)
 */

const fs = require('fs');
const path = require('path');
const { getAtlasConnection } = require('./lib/db-config');

// Default CRM folder path
const DEFAULT_CRM_PATH = path.resolve(__dirname, '../crm');

// ============================================
// CSV Parsing (handles quoted fields)
// ============================================

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseCSV(content) {
  const lines = content.split('\n');
  const headers = parseCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const record = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] || '';
    });
    records.push(record);
  }
  return records;
}

// ============================================
// Value Mappings
// ============================================

const callTypeMap = {
  'outbound': 'outbound',
  'inbound': 'inbound',
  'missed': 'missed'
};

const taskStatusMap = {
  'completed': 'completed',
  'not started': 'not_started',
  'deferred': 'deferred',
  'in progress': 'in_progress',
  'waiting on someone else': 'waiting',
  'waiting for input': 'waiting'
};

const taskPriorityMap = {
  'high': 'high',
  'highest': 'high',
  'normal': 'normal',
  'low': 'low',
  'lowest': 'low'
};

const dealTypeMap = {
  'portfolio sale': 'portfolio_sale',
  'single asset sale': 'single_asset_sale'
};

// ============================================
// ID Resolution Functions
// ============================================

async function resolvePrincipalId(atlas, zohoContactId) {
  if (!zohoContactId || !zohoContactId.startsWith('zcrm_')) return null;
  const [rows] = await atlas.query(
    'SELECT id FROM principals WHERE zoho_contact_id = ?',
    [zohoContactId]
  );
  return rows.length ? rows[0].id : null;
}

async function resolvePropertyId(atlas, zohoAccountId) {
  if (!zohoAccountId || !zohoAccountId.startsWith('zcrm_')) return null;
  const [rows] = await atlas.query(
    'SELECT id FROM property_master WHERE zoho_account_id = ?',
    [zohoAccountId]
  );
  return rows.length ? rows[0].id : null;
}

async function resolveDealId(atlas, zohoRecordId) {
  if (!zohoRecordId || !zohoRecordId.startsWith('zcrm_')) return null;
  const [rows] = await atlas.query(
    'SELECT id FROM crm_deals WHERE zoho_record_id = ?',
    [zohoRecordId]
  );
  return rows.length ? rows[0].id : null;
}

// ============================================
// Date/Time Parsing
// ============================================

function parseDateTime(str) {
  if (!str || str.trim() === '') return null;
  // Format: "2024-09-09 13:20:35"
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function parseDate(str) {
  if (!str || str.trim() === '') return null;
  // Format: "2024-09-09" or "2024-09-09 00:00:00"
  const parts = str.split(' ')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts)) return null;
  return parts;
}

function parseAmount(str) {
  if (!str || str.trim() === '') return null;
  const num = parseFloat(str.replace(/[,$]/g, ''));
  return isNaN(num) ? null : num;
}

function parseInt2(str) {
  if (!str || str.trim() === '') return null;
  const num = parseInt(str, 10);
  return isNaN(num) ? null : num;
}

function parseDuration(str) {
  if (!str || str.trim() === '') return 0;
  const num = parseInt(str, 10);
  return isNaN(num) ? 0 : num;
}

// ============================================
// Load Functions
// ============================================

async function loadNotes(atlas, crmPath) {
  console.log('\n--- Loading Notes ---');

  const csvPath = path.join(crmPath, 'Notes_Principals_2026_01_26.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('  Notes file not found, skipping');
    return { total: 0, loaded: 0, skipped: 0, resolved: 0 };
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);
  console.log(`  Total rows: ${records.length}`);

  let loaded = 0, skipped = 0, resolved = 0;

  for (const row of records) {
    const zohoRecordId = row['Record Id']?.trim();
    const zohoContactId = row['Parent ID.id']?.trim();

    if (!zohoRecordId || !zohoRecordId.startsWith('zcrm_')) {
      skipped++;
      continue;
    }

    // Skip notes with no parent principal reference
    if (!zohoContactId || !zohoContactId.startsWith('zcrm_')) {
      skipped++;
      continue;
    }

    const principalId = await resolvePrincipalId(atlas, zohoContactId);
    if (principalId) resolved++;

    try {
      await atlas.query(`
        INSERT INTO crm_notes (
          zoho_record_id, principal_id, zoho_contact_id, parent_name,
          note_title, note_content,
          created_by_name, created_by_zoho_id, note_owner_name, note_owner_zoho_id,
          created_time, modified_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          principal_id = VALUES(principal_id),
          note_title = VALUES(note_title),
          note_content = VALUES(note_content),
          modified_time = VALUES(modified_time),
          imported_at = NOW()
      `, [
        zohoRecordId,
        principalId,
        zohoContactId,
        row['Parent ID']?.trim() || null,
        row['Note Title']?.trim() || null,
        row['Note Content']?.trim() || null,
        row['Created By']?.trim() || null,
        row['Created By.id']?.trim() || null,
        row['Note Owner']?.trim() || null,
        row['Note Owner.id']?.trim() || null,
        parseDateTime(row['Created Time']),
        parseDateTime(row['Modified Time'])
      ]);
      loaded++;
    } catch (err) {
      console.error(`  Error loading note ${zohoRecordId}: ${err.message}`);
    }

    if (loaded % 500 === 0) {
      console.log(`    Loaded ${loaded}...`);
    }
  }

  console.log(`  Loaded: ${loaded} | Skipped: ${skipped} | Resolved principals: ${resolved} (${Math.round(100 * resolved / loaded)}%)`);
  return { total: records.length, loaded, skipped, resolved };
}

async function loadCalls(atlas, crmPath) {
  console.log('\n--- Loading Calls ---');

  const csvPath = path.join(crmPath, 'Calls_2026_01_26.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('  Calls file not found, skipping');
    return { total: 0, loaded: 0, skipped: 0, resolvedPrincipals: 0, resolvedProperties: 0 };
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);
  console.log(`  Total rows: ${records.length}`);

  let loaded = 0, skipped = 0, resolvedPrincipals = 0, resolvedProperties = 0;

  for (const row of records) {
    const zohoRecordId = row['Record Id']?.trim();

    if (!zohoRecordId || !zohoRecordId.startsWith('zcrm_')) {
      skipped++;
      continue;
    }

    const zohoContactId = row['Contact Name.id']?.trim() || null;
    const zohoRelatedToId = row['Related To.id']?.trim() || null;

    const principalId = await resolvePrincipalId(atlas, zohoContactId);
    const propertyId = await resolvePropertyId(atlas, zohoRelatedToId);

    if (principalId) resolvedPrincipals++;
    if (propertyId) resolvedProperties++;

    // Map call type
    const rawCallType = (row['Call Type'] || '').toLowerCase().trim();
    const callType = callTypeMap[rawCallType] || null;

    try {
      await atlas.query(`
        INSERT INTO crm_calls (
          zoho_record_id, principal_id, zoho_contact_id, contact_name,
          property_master_id, zoho_related_to_id, related_to_name,
          subject, call_type, call_purpose, call_start_time, call_duration_seconds,
          description, call_result, call_status,
          call_owner_name, call_owner_zoho_id, created_by_name, created_by_zoho_id,
          created_time, modified_time, last_activity_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          principal_id = VALUES(principal_id),
          property_master_id = VALUES(property_master_id),
          subject = VALUES(subject),
          call_status = VALUES(call_status),
          modified_time = VALUES(modified_time),
          imported_at = NOW()
      `, [
        zohoRecordId,
        principalId,
        zohoContactId,
        row['Contact Name']?.trim() || null,
        propertyId,
        zohoRelatedToId,
        row['Related To']?.trim() || null,
        row['Subject']?.trim() || null,
        callType,
        row['Call Purpose']?.trim() || null,
        parseDateTime(row['Call Start Time']),
        parseDuration(row['Call Duration (in seconds)']),
        row['Description']?.trim() || null,
        row['Call Result']?.trim() || null,
        row['Call Status']?.trim() || null,
        row['Call Owner']?.trim() || null,
        row['Call Owner.id']?.trim() || null,
        row['Created By']?.trim() || null,
        row['Created By.id']?.trim() || null,
        parseDateTime(row['Created Time']),
        parseDateTime(row['Modified Time']),
        parseDateTime(row['Last Activity Time'])
      ]);
      loaded++;
    } catch (err) {
      console.error(`  Error loading call ${zohoRecordId}: ${err.message}`);
    }

    if (loaded % 500 === 0) {
      console.log(`    Loaded ${loaded}...`);
    }
  }

  console.log(`  Loaded: ${loaded} | Skipped: ${skipped}`);
  console.log(`  Resolved principals: ${resolvedPrincipals} (${Math.round(100 * resolvedPrincipals / loaded)}%)`);
  console.log(`  Resolved properties: ${resolvedProperties} (${Math.round(100 * resolvedProperties / loaded)}%)`);
  return { total: records.length, loaded, skipped, resolvedPrincipals, resolvedProperties };
}

async function loadTasks(atlas, crmPath) {
  console.log('\n--- Loading Tasks ---');

  const csvPath = path.join(crmPath, 'Tasks_2026_01_26.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('  Tasks file not found, skipping');
    return { total: 0, loaded: 0, skipped: 0, resolvedPrincipals: 0, open: 0, completed: 0 };
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);
  console.log(`  Total rows: ${records.length}`);

  let loaded = 0, skipped = 0, resolvedPrincipals = 0, open = 0, completed = 0;

  for (const row of records) {
    const zohoRecordId = row['Record Id']?.trim();

    if (!zohoRecordId || !zohoRecordId.startsWith('zcrm_')) {
      skipped++;
      continue;
    }

    const zohoContactId = row['Contact Name.id']?.trim() || null;
    const zohoRelatedToId = row['Related To.id']?.trim() || null;

    const principalId = await resolvePrincipalId(atlas, zohoContactId);
    const propertyId = await resolvePropertyId(atlas, zohoRelatedToId);

    if (principalId) resolvedPrincipals++;

    // Map status and priority
    const rawStatus = (row['Status'] || '').toLowerCase().trim();
    const status = taskStatusMap[rawStatus] || 'not_started';

    const rawPriority = (row['Priority'] || '').toLowerCase().trim();
    const priority = taskPriorityMap[rawPriority] || 'normal';

    if (status === 'completed') completed++;
    else open++;

    try {
      await atlas.query(`
        INSERT INTO crm_tasks (
          zoho_record_id, principal_id, zoho_contact_id, contact_name,
          property_master_id, zoho_related_to_id, related_to_name,
          subject, description, due_date, status, priority, closed_time,
          task_owner_name, task_owner_zoho_id, created_by_name, created_by_zoho_id,
          created_time, modified_time, last_activity_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          principal_id = VALUES(principal_id),
          property_master_id = VALUES(property_master_id),
          subject = VALUES(subject),
          status = VALUES(status),
          closed_time = VALUES(closed_time),
          modified_time = VALUES(modified_time),
          imported_at = NOW()
      `, [
        zohoRecordId,
        principalId,
        zohoContactId,
        row['Contact Name']?.trim() || null,
        propertyId,
        zohoRelatedToId,
        row['Related To']?.trim() || null,
        row['Subject']?.trim() || null,
        row['Description']?.trim() || null,
        parseDate(row['Due Date']),
        status,
        priority,
        parseDateTime(row['Closed Time']),
        row['Task Owner']?.trim() || null,
        row['Task Owner.id']?.trim() || null,
        row['Created By']?.trim() || null,
        row['Created By.id']?.trim() || null,
        parseDateTime(row['Created Time']),
        parseDateTime(row['Modified Time']),
        parseDateTime(row['Last Activity Time'])
      ]);
      loaded++;
    } catch (err) {
      console.error(`  Error loading task ${zohoRecordId}: ${err.message}`);
    }

    if (loaded % 500 === 0) {
      console.log(`    Loaded ${loaded}...`);
    }
  }

  console.log(`  Loaded: ${loaded} | Skipped: ${skipped}`);
  console.log(`  Resolved principals: ${resolvedPrincipals} (${Math.round(100 * resolvedPrincipals / loaded)}%)`);
  console.log(`  Open tasks: ${open} | Completed: ${completed}`);
  return { total: records.length, loaded, skipped, resolvedPrincipals, open, completed };
}

async function loadDeals(atlas, crmPath) {
  console.log('\n--- Loading Deals ---');

  const csvPath = path.join(crmPath, 'Deals_2026_01_26.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('  Deals file not found, skipping');
    return { total: 0, loaded: 0, resolvedPrincipals: 0, resolvedProperties: 0, active: 0, dead: 0 };
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);
  console.log(`  Total rows: ${records.length}`);

  let loaded = 0, resolvedPrincipals = 0, resolvedProperties = 0, active = 0, dead = 0;

  for (const row of records) {
    const zohoRecordId = row['Record Id']?.trim();

    if (!zohoRecordId || !zohoRecordId.startsWith('zcrm_')) {
      continue;
    }

    const zohoContactId = row['Principal Name.id']?.trim() || null;
    const zohoPropertyId = row['Property Name.id']?.trim() || null;

    const principalId = await resolvePrincipalId(atlas, zohoContactId);
    const propertyId = await resolvePropertyId(atlas, zohoPropertyId);

    if (principalId) resolvedPrincipals++;
    if (propertyId) resolvedProperties++;

    // Map deal type
    const rawType = (row['Type'] || '').toLowerCase().trim();
    const dealType = dealTypeMap[rawType] || 'unknown';

    // Track active vs dead deals
    const stage = (row['Stage'] || '').toLowerCase();
    if (stage.includes('dead') || stage.includes('inactive') || stage.includes('lost')) {
      dead++;
    } else {
      active++;
    }

    try {
      await atlas.query(`
        INSERT INTO crm_deals (
          zoho_record_id, principal_id, zoho_principal_id, principal_name,
          property_master_id, zoho_property_id, property_name,
          deal_name, deal_type, stage, amount, probability_pct, closing_date,
          next_step, description, num_facilities, states_in_deal,
          earnest_money_due_date, earnest_money_amount, purchase_price,
          due_diligence_end_date, closing_date_per_psa,
          commission_rate, expected_commission, closing_price,
          deal_owner_name, deal_owner_zoho_id,
          created_time, modified_time, last_activity_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          principal_id = VALUES(principal_id),
          property_master_id = VALUES(property_master_id),
          deal_name = VALUES(deal_name),
          stage = VALUES(stage),
          amount = VALUES(amount),
          probability_pct = VALUES(probability_pct),
          closing_date = VALUES(closing_date),
          modified_time = VALUES(modified_time),
          last_activity_time = VALUES(last_activity_time),
          imported_at = NOW()
      `, [
        zohoRecordId,
        principalId,
        zohoContactId,
        row['Principal Name']?.trim() || null,
        propertyId,
        zohoPropertyId,
        row['Property Name']?.trim() || null,
        row['Deal Name']?.trim() || null,
        dealType,
        row['Stage']?.trim() || null,
        parseAmount(row['Amount']),
        parseInt2(row['Probability (%)']),
        parseDate(row['Closing Date']),
        row['Next Step']?.trim() || null,
        row['Description']?.trim() || null,
        parseInt2(row['Number of Facilities in Deal']),
        row['States Facilities are in']?.trim() || null,
        parseDate(row['Earnest Money Due Date']),
        parseAmount(row['Earnest Money Amount']),
        parseAmount(row['Purchase Price or Offer Amount in LOI']),
        parseDate(row['Due Diligence Period Ends']),
        parseDate(row['Closing Date Per PSA']),
        parseAmount(row['Commission Rate']),
        parseAmount(row['Expected Commission']),
        parseAmount(row['Closing Price']),
        row['Deal Owner']?.trim() || null,
        row['Deal Owner.id']?.trim() || null,
        parseDateTime(row['Created Time']),
        parseDateTime(row['Modified Time']),
        parseDateTime(row['Last Activity Time'])
      ]);
      loaded++;
    } catch (err) {
      console.error(`  Error loading deal ${zohoRecordId}: ${err.message}`);
    }
  }

  console.log(`  Loaded: ${loaded}`);
  console.log(`  Resolved principals: ${resolvedPrincipals} (${Math.round(100 * resolvedPrincipals / loaded)}%)`);
  console.log(`  Resolved properties: ${resolvedProperties} (${Math.round(100 * resolvedProperties / loaded)}%)`);
  console.log(`  Active (non-dead): ${active} | Dead/Inactive: ${dead}`);
  return { total: records.length, loaded, resolvedPrincipals, resolvedProperties, active, dead };
}

async function loadDealStages(atlas, crmPath) {
  console.log('\n--- Loading Deal Stages ---');

  const csvPath = path.join(crmPath, 'Deals__2026_01_26.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('  Deal Stages file not found, skipping');
    return { total: 0, loaded: 0, resolved: 0 };
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);
  console.log(`  Total rows: ${records.length}`);

  let loaded = 0, resolved = 0;

  for (const row of records) {
    const zohoRecordId = row['Record Id']?.trim();

    if (!zohoRecordId || !zohoRecordId.startsWith('zcrm_')) {
      continue;
    }

    const zohoDealId = row['Deal Name.id']?.trim() || null;
    const crmDealId = await resolveDealId(atlas, zohoDealId);

    if (crmDealId) resolved++;

    try {
      await atlas.query(`
        INSERT INTO crm_deal_stages (
          zoho_record_id, crm_deal_id, zoho_deal_id, deal_name,
          stage, stage_duration_days, probability_pct, moved_to,
          amount, expected_revenue, closing_date,
          modified_by_name, modified_by_zoho_id, modified_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          crm_deal_id = VALUES(crm_deal_id),
          stage = VALUES(stage),
          stage_duration_days = VALUES(stage_duration_days),
          moved_to = VALUES(moved_to),
          modified_time = VALUES(modified_time),
          imported_at = NOW()
      `, [
        zohoRecordId,
        crmDealId,
        zohoDealId,
        row['Deal Name']?.trim() || null,
        row['Stage']?.trim() || null,
        parseInt2(row['Stage Duration (Calendar Days)']),
        parseInt2(row['Probability (%)']),
        row['Moved To']?.trim() || null,
        parseAmount(row['Amount']),
        parseAmount(row['Expected Revenue']),
        parseDate(row['Closing Date']),
        row['Modified By']?.trim() || null,
        row['Modified By.id']?.trim() || null,
        parseDateTime(row['Modified Time'])
      ]);
      loaded++;
    } catch (err) {
      console.error(`  Error loading deal stage ${zohoRecordId}: ${err.message}`);
    }

    if (loaded % 500 === 0) {
      console.log(`    Loaded ${loaded}...`);
    }
  }

  console.log(`  Loaded: ${loaded}`);
  console.log(`  Resolved to crm_deals: ${resolved} (${loaded > 0 ? Math.round(100 * resolved / loaded) : 0}%)`);
  return { total: records.length, loaded, resolved };
}

async function loadJunction(atlas, crmPath) {
  console.log('\n--- Loading Junction (Principals X Properties) ---');

  const csvPath = path.join(crmPath, 'Principals_X_Properties_2026_01_26.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('  Junction file not found, skipping');
    return { total: 0, loaded: 0 };
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);
  console.log(`  Total rows: ${records.length}`);

  let loaded = 0;

  for (const row of records) {
    const zohoRecordId = row['Record Id']?.trim();

    if (!zohoRecordId || !zohoRecordId.startsWith('zcrm_')) {
      continue;
    }

    const zohoContactId = row['Principal.id']?.trim() || null;
    const zohoPropertyId = row['Properties.id']?.trim() || null;

    try {
      await atlas.query(`
        INSERT INTO crm_principal_properties_staging (
          zoho_record_id, zoho_principal_id, zoho_property_id,
          principal_name, property_name, principal_type, license_number,
          created_time, modified_time, validation_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        ON DUPLICATE KEY UPDATE
          principal_name = VALUES(principal_name),
          property_name = VALUES(property_name),
          principal_type = VALUES(principal_type),
          license_number = VALUES(license_number),
          modified_time = VALUES(modified_time),
          validation_status = 'pending',
          imported_at = NOW()
      `, [
        zohoRecordId,
        zohoContactId,
        zohoPropertyId,
        row['Principal']?.trim() || null,
        row['Properties']?.trim() || null,
        row['Principal Type']?.trim() || null,
        row['License Number']?.trim() || null,
        parseDateTime(row['Created Time']),
        parseDateTime(row['Modified Time'])
      ]);
      loaded++;
    } catch (err) {
      console.error(`  Error loading junction ${zohoRecordId}: ${err.message}`);
    }

    if (loaded % 1000 === 0) {
      console.log(`    Loaded ${loaded}...`);
    }
  }

  console.log(`  Loaded: ${loaded} (validation pending)`);
  return { total: records.length, loaded };
}

// ============================================
// Main
// ============================================

async function main() {
  const crmPath = process.argv[2] || DEFAULT_CRM_PATH;

  console.log('='.repeat(60));
  console.log('CRM ACTIVITY IMPORT');
  console.log('='.repeat(60));
  console.log(`CRM Folder: ${crmPath}`);
  console.log('');

  if (!fs.existsSync(crmPath)) {
    console.error(`CRM folder not found: ${crmPath}`);
    process.exit(1);
  }

  const atlas = await getAtlasConnection();
  console.log('Connected to Atlas database');

  try {
    const results = {};

    // Load in order
    results.notes = await loadNotes(atlas, crmPath);
    results.calls = await loadCalls(atlas, crmPath);
    results.tasks = await loadTasks(atlas, crmPath);
    results.deals = await loadDeals(atlas, crmPath);
    results.dealStages = await loadDealStages(atlas, crmPath);
    results.junction = await loadJunction(atlas, crmPath);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('CRM ACTIVITY IMPORT SUMMARY');
    console.log('='.repeat(60));

    console.log('\nNOTES:');
    console.log(`  - Total: ${results.notes.total} | Loaded: ${results.notes.loaded} | Skipped: ${results.notes.skipped}`);
    console.log(`  - Resolved principals: ${results.notes.resolved} (${results.notes.loaded > 0 ? Math.round(100 * results.notes.resolved / results.notes.loaded) : 0}%)`);

    console.log('\nCALLS:');
    console.log(`  - Total: ${results.calls.total} | Loaded: ${results.calls.loaded} | Skipped: ${results.calls.skipped}`);
    console.log(`  - Resolved principals: ${results.calls.resolvedPrincipals} (${results.calls.loaded > 0 ? Math.round(100 * results.calls.resolvedPrincipals / results.calls.loaded) : 0}%)`);
    console.log(`  - Resolved properties: ${results.calls.resolvedProperties} (${results.calls.loaded > 0 ? Math.round(100 * results.calls.resolvedProperties / results.calls.loaded) : 0}%)`);

    console.log('\nTASKS:');
    console.log(`  - Total: ${results.tasks.total} | Loaded: ${results.tasks.loaded} | Skipped: ${results.tasks.skipped}`);
    console.log(`  - Resolved principals: ${results.tasks.resolvedPrincipals} (${results.tasks.loaded > 0 ? Math.round(100 * results.tasks.resolvedPrincipals / results.tasks.loaded) : 0}%)`);
    console.log(`  - Open tasks: ${results.tasks.open} | Completed: ${results.tasks.completed}`);

    console.log('\nDEALS:');
    console.log(`  - Total: ${results.deals.total} | Loaded: ${results.deals.loaded}`);
    console.log(`  - Resolved principals: ${results.deals.resolvedPrincipals} (${results.deals.loaded > 0 ? Math.round(100 * results.deals.resolvedPrincipals / results.deals.loaded) : 0}%)`);
    console.log(`  - Resolved properties: ${results.deals.resolvedProperties} (${results.deals.loaded > 0 ? Math.round(100 * results.deals.resolvedProperties / results.deals.loaded) : 0}%)`);
    console.log(`  - Active (non-dead): ${results.deals.active} | Dead/Inactive: ${results.deals.dead}`);

    console.log('\nDEAL STAGES:');
    console.log(`  - Total: ${results.dealStages.total} | Loaded: ${results.dealStages.loaded}`);
    console.log(`  - Resolved to crm_deals: ${results.dealStages.resolved} (${results.dealStages.loaded > 0 ? Math.round(100 * results.dealStages.resolved / results.dealStages.loaded) : 0}%)`);

    console.log('\nJUNCTION (validation only):');
    console.log(`  - Total relationships: ${results.junction.total}`);
    console.log(`  - Loaded to staging: ${results.junction.loaded}`);
    console.log(`  - Run: node scripts/validate-crm-junction.js for validation report`);

    console.log('\n' + '='.repeat(60));
    console.log('DONE');
    console.log('='.repeat(60));

  } finally {
    await atlas.end();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
