// ============================================================
//  WEDDING APP — Google Apps Script Backend
//  Covers: Guest Check-In, Lucky Draw, and RSVP
//
//  HOW TO USE:
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

// Column indices in the Guests sheet (1-based):
// A=1 ID, B=2 Name, C=3 Table, D=4 Phone, E=5 Seat Number, F=6 Checked In, G=7 Check-In Time, H=8 Lucky Draw Prize

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
  K  Guest Names        comma-separated (includes primary guest as guest 1)
  L  Guest Allergies    comma-separated (one entry per guest, matching K)
  M  Wishes / Message
*/

function submitRSVP(p) {
  const sheet = getRSVPSheet();

  const fullName  = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
  const attending = (p.attending || '').toLowerCase() === 'yes' ? 'Yes' : 'No';

  // FIX: Only write columns that the form actually populates (A–M = 13 columns)
  sheet.appendRow([
    p.timestamp    || new Date().toISOString(),                   // A Timestamp
    attending,                                                     // B Attending
    p.firstName    || '',                                         // C First Name
    p.lastName     || '',                                         // D Last Name
    fullName,                                                      // E Full Name
    p.email        || '',                                         // F Email
    p.phone        || '',                                         // G Phone
    p.relation     || '',                                         // H Relation
    p.howKnow      || '',                                         // I How They Met
    parseInt(p.partySize) || (attending === 'Yes' ? 1 : 0),      // J Party Size
    p.guestNames      || '',                                      // K Guest Names
    p.guestAllergies  || '',                                      // L Guest Allergies
    p.wishes          || '',                                      // M Wishes / Message
  ]);

  // Auto-populate Guests sheet for check-in on the day
  if (attending === 'Yes' && fullName) {
    addGuestFromRSVP(p);
  }

  return { success: true };
}

// Reads all RSVPs back
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

// Manually re-sync all attending RSVPs → Guests sheet (1 row per guest)
function syncRSVPsToGuests() {
  const rsvpSheet = getRSVPSheet();
  const rsvpRows  = rsvpSheet.getDataRange().getValues();

  if (!rsvpRows || rsvpRows.length < 2) {
    return { success: true, added: 0, message: 'RSVPs sheet is empty — submit an RSVP first.' };
  }

  const headers = rsvpRows[0];
  if (!headers || headers.length === 0) {
    return { success: true, added: 0, message: 'RSVPs sheet has no headers yet.' };
  }

  const col = {};
  headers.forEach((h, i) => { col[h] = i; });

  if (col['Attending'] === undefined || col['First Name'] === undefined) {
    return { error: 'RSVPs sheet is missing expected columns. Submit at least one RSVP first to create the structure.' };
  }

  let added = 0;
  rsvpRows.slice(1).forEach(row => {
    const attending = (row[col['Attending']] || '').toString().trim();
    if (attending !== 'Yes') return;

    const firstName = (row[col['First Name']]     || '').trim();
    const lastName  = (row[col['Last Name']]      || '').trim();
    const fullName  = (firstName + ' ' + lastName).trim();
    if (!fullName) return;

    const p = {
      firstName,
      lastName,
      phone:           (row[col['Phone']]            || '').trim(),
      partySize:       parseInt(row[col['Party Size']]) || 1,
      guestNames:      (row[col['Guest Names']]      || '').toString(),
      guestAllergies:  (row[col['Guest Allergies']]  || '').toString(),
    };

    const before = getSheet().getLastRow();
    addGuestFromRSVP(p);
    added += getSheet().getLastRow() - before;
  });

  return { success: true, added };
}

// ── Add each guest from an RSVP as individual rows in the Guests sheet ──
//
// FIX: guestNames from rsvp.html is "Primary Name, Guest 2, Guest 3, …"
// (the form includes the primary person as guest 1 in the comma-separated list).
// So we simply split the full list — no separate primaryName logic needed.
//
function addGuestFromRSVP(p) {
  const sheet    = getSheet();
  const rows     = sheet.getDataRange().getValues();
  const partySize = parseInt(p.partySize) || 1;

  // Split the full comma-separated guest names list (primary is included as first entry)
  const allNames     = (p.guestNames     || '').split(',').map(s => s.trim()).filter(Boolean);
  const allAllergies = (p.guestAllergies || '').split(',').map(s => s.trim());

  // Fallback: if guestNames is empty, at least add the primary submitter
  if (allNames.length === 0) {
    const fullName = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
    if (fullName) allNames.push(fullName);
  }

  // Deduplicate against names already in the Guests sheet
  const existingNames = rows.slice(1).map(r => (r[1] || '').toString().toLowerCase());

  allNames.forEach((name, idx) => {
    if (!name) return;
    if (existingNames.includes(name.toLowerCase())) return; // already there

    const newId  = sheet.getLastRow();
    const allergy = allAllergies[idx] || '';

    sheet.appendRow([
      newId,
      name,
      '',              // Table — staff will assign later
      p.phone || '',
      '',              // Seat Number — staff will assign later
      false,           // not checked in yet
      '',              // no check-in time yet
    ]);
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

    const headers = ['ID', 'Name', 'Table', 'Phone', 'Seat Number', 'Checked In', 'Check-In Time', 'Lucky Draw Prize'];
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
  }
  return sheet;
}

function getRSVPSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(RSVP_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(RSVP_SHEET_NAME);

    // FIX: Headers match only the 13 columns the form actually sends
    const headers = [
      'Timestamp',        // A
      'Attending',        // B
      'First Name',       // C
      'Last Name',        // D
      'Full Name',        // E
      'Email',            // F
      'Phone',            // G
      'Relation',         // H
      'How They Met',     // I
      'Party Size',       // J
      'Guest Names',      // K
      'Guest Allergies',  // L
      'Wishes',           // M
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#2c2c2c');
    hRange.setFontColor('#c9a84c');
    hRange.setFontWeight('bold');
    sheet.setFrozenRows(1);

    sheet.setColumnWidth(1, 160);  // Timestamp
    sheet.setColumnWidth(2, 80);   // Attending
    sheet.setColumnWidth(3, 110);  // First Name
    sheet.setColumnWidth(4, 110);  // Last Name
    sheet.setColumnWidth(5, 160);  // Full Name
    sheet.setColumnWidth(6, 180);  // Email
    sheet.setColumnWidth(7, 120);  // Phone
    sheet.setColumnWidth(8, 120);  // Relation
    sheet.setColumnWidth(9, 150);  // How They Met
    sheet.setColumnWidth(10, 80);  // Party Size
    sheet.setColumnWidth(11, 220); // Guest Names
    sheet.setColumnWidth(12, 220); // Guest Allergies
    sheet.setColumnWidth(13, 260); // Wishes
  }
  return sheet;
}

function formatTime(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d)) return val.toString();
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function now() {
  return new Date().toISOString();
}