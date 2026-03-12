// ============================================================
//  WEDDING APPS SCRIPT  — Google Apps Script backend
//  Setup:
//  1. Open your Google Sheet → Extensions → Apps Script
//  2. Replace ALL existing code with this file
//  3. Click Deploy → Manage Deployments → click the pencil ✏️
//     on your existing deployment → set "Who has access" to
//     "Anyone" → click Deploy
//  4. Copy the Web App URL — paste it into WEDDING_CONFIG.SCRIPT_URL
//     in all three HTML files
// ============================================================

// ── SHEET TAB NAMES ─────────────────────────────────────────
const SHEET_NAME      = 'Guests';  // existing check-in sheet
const RSVP_SHEET_NAME = 'RSVPs';   // new sheet, auto-created on first submit

// Guests sheet columns (1-based):
// A=1 ID | B=2 Name | C=3 Table | D=4 Phone | E=5 Seat Number
// F=6 Checked In | G=7 Check-In Time | H=8 Lucky Draw Prize | I=9 Source
//
// Column I "Source" is used internally:
//   "RSVP"  → row was auto-imported by syncRSVPsToGuests / submitRSVP
//   ""      → row was manually added via the Add Guest button
// This lets Sync know which rows to safely wipe and rebuild.

// ── MAIN ROUTER ──────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action || '';
  let result;

  try {
    if      (action === 'getGuests')         result = getGuests();
    else if (action === 'checkIn')           result = checkIn(e.parameter.id, e.parameter.time);
    else if (action === 'addGuest')          result = addGuest(e.parameter);
    else if (action === 'selfCheckIn')       result = selfCheckIn(e.parameter.id);
    else if (action === 'recordWinner')      result = recordWinner(e.parameter.id, e.parameter.round);
    else if (action === 'clearWinners')      result = clearWinners();
    else if (action === 'submitRSVP')        result = submitRSVP(e.parameter);
    else if (action === 'getRSVPs')          result = getRSVPs();
    else if (action === 'syncRSVPsToGuests') result = syncRSVPsToGuests();
    else result = { error: 'Unknown action' };
  } catch(err) {
    result = { error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) { return doGet(e); }


// ════════════════════════════════════════════════════════════
//  GUEST CHECK-IN
// ════════════════════════════════════════════════════════════

function getGuests() {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();

  const guests = rows.slice(1).map((row, i) => ({
    id:          row[0] || (i + 2),
    name:        row[1] || '',
    table:       row[2] || '',
    phone:       row[3] || '',
    seatNumber:  row[4] || '',
    checkedIn:   row[5] === true || row[5] === 'TRUE' || row[5] === 'Yes',
    checkinTime: formatTime(row[6]),
  })).filter(g => g.name);

  return { guests, total: guests.length };
}

function checkIn(id, time) {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.getRange(i + 1, 6).setValue(true);
      sheet.getRange(i + 1, 7).setValue(time || now());
      return { success: true, name: rows[i][1] };
    }
  }
  return { error: 'Guest not found' };
}

function selfCheckIn(id) {
  const result = checkIn(id, now());
  if (result.success) {
    return { success: true, message: `Welcome, ${result.name}! You are checked in. 🎉` };
  }
  return result;
}

function addGuest(params) {
  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();
  const newId   = lastRow;

  sheet.appendRow([
    newId,
    params.name       || '',
    params.table      || '',
    params.phone      || '',
    params.seatNumber || '',
    false,
    '',
    '',        // Lucky Draw Prize
    'manual',  // Source — explicit manual entry, preserved by Sync
  ]);

  return { success: true, id: newId };
}

function recordWinner(id, round) {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.getRange(i + 1, 8).setValue(round);
      return { success: true };
    }
  }
  return { error: 'Guest not found' };
}

function clearWinners() {
  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };
  sheet.getRange(2, 8, lastRow - 1, 1).clearContent();
  return { success: true };
}


// ════════════════════════════════════════════════════════════
//  RSVP
// ════════════════════════════════════════════════════════════

/*
  RSVP sheet columns — trimmed to exactly what rsvp.html sends:
  A  Timestamp
  B  Attending          Yes / No
  C  First Name
  D  Last Name
  E  Full Name
  F  Email
  G  Phone
  H  Relation
  I  How They Met
  J  Party Size
  K  Guest Names        comma-separated (primary guest is always first entry)
  L  Guest Allergies    comma-separated (one entry per guest, matching K)
  M  Wishes / Message
*/

function submitRSVP(p) {
  const sheet = getRSVPSheet();

  const fullName  = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
  const attending = (p.attending || '').toLowerCase() === 'yes' ? 'Yes' : 'No';
  const phone     = formatPhone(p.phone);

  sheet.appendRow([
    p.timestamp    || new Date().toISOString(),
    attending,
    p.firstName    || '',
    p.lastName     || '',
    fullName,
    p.email        || '',
    phone,
    p.relation     || '',
    p.howKnow      || '',
    parseInt(p.partySize) || (attending === 'Yes' ? 1 : 0),
    p.guestNames      || '',
    p.guestAllergies  || '',
    p.wishes          || '',
  ]);

  // Force phone column (G = col 7) on the new row to plain text
  // so Sheets never strips the leading zero
  const newRow = sheet.getLastRow();
  sheet.getRange(newRow, 7).setNumberFormat('@');

  if (attending === 'Yes' && fullName) {
    addGuestFromRSVP(p);
  }

  return { success: true };
}

function getRSVPs() {
  const sheet = getRSVPSheet();
  const rows  = sheet.getDataRange().getValues();
  const headers = rows[0];
  const rsvps = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  return { rsvps, total: rsvps.length };
}

// ── SYNC RSVPs → Guests (FULL REBUILD) ──────────────────────
//
// Strategy:
//   1. Preserve manually-added rows (Source = "" or anything ≠ "RSVP")
//      AND their check-in state
//   2. Delete ALL rows that are either tagged "RSVP" or have no Source
//      tag at all (legacy rows written before the Source column existed)
//      — effectively: wipe everything except manually-added rows that
//      were explicitly saved via addGuest() with Source = "manual"
//   3. Re-import fresh from the RSVPs sheet
//
// Simpler read: we keep rows where Source = "manual" (explicit),
// and wipe everything else (Source = "RSVP", Source = "", or missing).
//
function syncRSVPsToGuests() {
  const rsvpSheet = getRSVPSheet();
  const rsvpRows  = rsvpSheet.getDataRange().getValues();

  if (!rsvpRows || rsvpRows.length < 2) {
    return { success: true, added: 0, message: 'RSVPs sheet is empty.' };
  }

  const headers = rsvpRows[0];
  const col = {};
  headers.forEach((h, i) => { col[h] = i; });

  if (col['Attending'] === undefined || col['First Name'] === undefined) {
    return { error: 'RSVPs sheet is missing expected columns. Submit at least one RSVP first.' };
  }

  // ── Step 1: Snapshot Guests sheet, separate manual rows from RSVP rows ──
  const guestSheet = getSheet();
  const allGuestRows = guestSheet.getDataRange().getValues();

  // "manual" rows = Source column (index 8) explicitly equals "manual"
  // Everything else (blank, "RSVP", or missing col) gets wiped and rebuilt
  const manualRows = allGuestRows.slice(1).filter(row => {
    const source = (row[8] || '').toString().trim();
    return source === 'manual';
  });

  // ── Step 2: Wipe all data rows, then restore only manual rows ──
  const lastRow = guestSheet.getLastRow();
  if (lastRow > 1) {
    guestSheet.getRange(2, 1, lastRow - 1, guestSheet.getLastColumn()).clearContent();
    // Delete the now-empty rows so appendRow starts clean
    guestSheet.deleteRows(2, lastRow - 1);
  }

  // Re-write manual rows first (preserving their IDs, check-in state, etc.)
  manualRows.forEach(row => {
    guestSheet.appendRow(row);
  });

  // ── Step 3: Re-import all attending RSVPs ───────────────────
  let added = 0;
  rsvpRows.slice(1).forEach(row => {
    const attending = (row[col['Attending']] || '').toString().trim();
    if (attending !== 'Yes') return;

    const firstName = (row[col['First Name']] || '').toString().trim();
    const lastName  = (row[col['Last Name']]  || '').toString().trim();
    const fullName  = (firstName + ' ' + lastName).trim();
    if (!fullName) return;

    const p = {
      firstName,
      lastName,
      phone:          (row[col['Phone']]           || '').toString().trim(),
      partySize:      parseInt(row[col['Party Size']]) || 1,
      guestNames:     (row[col['Guest Names']]     || '').toString().trim(),
      guestAllergies: (row[col['Guest Allergies']] || '').toString().trim(),
    };

    const before = guestSheet.getLastRow();
    addGuestFromRSVP(p);
    added += guestSheet.getLastRow() - before;
  });

  return { success: true, added };
}

// ── Add each guest from an RSVP as individual rows ──────────
//
// guestNames from rsvp.html = "Primary Name, Guest 2, Guest 3, …"
// The primary submitter is always included as the first entry.
// We split on commas and write one row per name.
// Column I is set to "RSVP" so Sync can safely wipe these on rebuild.
//
function addGuestFromRSVP(p) {
  const sheet     = getSheet();
  const rows      = sheet.getDataRange().getValues();
  const partySize = parseInt(p.partySize) || 1;

  const allNames     = (p.guestNames     || '').split(',').map(s => s.trim()).filter(Boolean);
  const allAllergies = (p.guestAllergies || '').split(',').map(s => s.trim());

  // Fallback: if guestNames somehow empty, use the primary submitter's name
  if (allNames.length === 0) {
    const fullName = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
    if (fullName) allNames.push(fullName);
  }

  // Deduplicate against names already in the Guests sheet
  const existingNames = rows.slice(1).map(r => (r[1] || '').toString().toLowerCase());

  allNames.forEach((name, idx) => {
    if (!name) return;
    if (existingNames.includes(name.toLowerCase())) return;

    const newId   = sheet.getLastRow();
    const phone   = formatPhone(p.phone);

    sheet.appendRow([
      newId,
      name,
      '',       // Table — staff assigns later
      phone,
      '',       // Seat Number — staff assigns later
      false,    // Checked In
      '',       // Check-In Time
      '',       // Lucky Draw Prize
      'RSVP',   // Source
    ]);
    // Force phone cell (col D = 4) to plain text
    sheet.getRange(sheet.getLastRow(), 4).setNumberFormat('@');
    existingNames.push(name.toLowerCase());
  });
}


// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════

function getSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);

    const headers = ['ID', 'Name', 'Table', 'Phone', 'Seat Number', 'Checked In', 'Check-In Time', 'Lucky Draw Prize', 'Source'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#2c2c2c');
    hRange.setFontColor('#c9a84c');
    hRange.setFontWeight('bold');
    sheet.setFrozenRows(1);

    sheet.setColumnWidth(1, 50);
    sheet.setColumnWidth(2, 200);
    sheet.setColumnWidth(3, 70);
    sheet.setColumnWidth(4, 130);
    sheet.setColumnWidth(5, 100);
    sheet.setColumnWidth(6, 100);
    sheet.setColumnWidth(7, 120);
    sheet.setColumnWidth(8, 140);
    sheet.setColumnWidth(9, 80);  // Source column — narrow, for internal use

    // Force phone column (D=4) to plain text so leading zeros are preserved
    sheet.getRange('D:D').setNumberFormat('@');
  }
  return sheet;
}

function getRSVPSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(RSVP_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(RSVP_SHEET_NAME);

    const headers = [
      'Timestamp', 'Attending', 'First Name', 'Last Name', 'Full Name',
      'Email', 'Phone', 'Relation', 'How They Met', 'Party Size',
      'Guest Names', 'Guest Allergies', 'Wishes / Message',
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#2c2c2c');
    hRange.setFontColor('#c9a84c');
    hRange.setFontWeight('bold');
    sheet.setFrozenRows(1);

    // Force phone column (G=7) to plain text so leading zeros are preserved
    sheet.getRange('G:G').setNumberFormat('@');
  }
  return sheet;
}

function now() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm');
}

function formatTime(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
  return String(val);
}

// Normalise Thai phone numbers to 0XX-XXX-XXXX format.
// Handles: 0830112222 / 083-011-2222 / 083 011 2222 / +66830112222
function formatPhone(raw) {
  if (!raw) return '';
  let digits = raw.toString().replace(/\D/g, '');

  // Convert +66 / 66 country code → leading 0
  if (digits.startsWith('660') && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith('66') && digits.length === 11) {
    digits = '0' + digits.slice(2);
  }

  // Standard 10-digit Thai mobile: 0XX-XXX-XXXX
  if (digits.length === 10 && digits.startsWith('0')) {
    return digits.slice(0,3) + '-' + digits.slice(3,6) + '-' + digits.slice(6);
  }

  // Fallback — return raw but preserve leading zero
  return digits || raw.toString().trim();
}