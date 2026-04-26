// ============================================================
//  WEDDING APPS SCRIPT  — Google Apps Script backend
//  Setup:
//  1. Open your Google Sheet → Extensions → Apps Script
//  2. Replace ALL existing code with this file
//  3. Click Deploy → Manage Deployments → click the pencil ✏️
//     on your existing deployment → set "Who has access" to
//     "Anyone" → click Deploy
//  4. Copy the Web App URL — paste it into WEDDING_CONFIG.SCRIPT_URL
//     in all HTML files
// ============================================================

// ── SHEET TAB NAMES ─────────────────────────────────────────
const SHEET_NAME         = 'Guests';       // existing check-in sheet
const RSVP_SHEET_NAME    = 'RSVPs';        // original RSVPs
const REVISED_SHEET_NAME = 'RevisedRSVP';  // NEW: date-change responses

// ── MAIN ROUTER ──────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action || '';
  let result;

  try {
    if      (action === 'getGuests')          result = getGuests();
    else if (action === 'checkIn')            result = checkIn(e.parameter.id, e.parameter.time);
    else if (action === 'addGuest')           result = addGuest(e.parameter);
    else if (action === 'selfCheckIn')        result = selfCheckIn(e.parameter.id);
    else if (action === 'recordWinner')       result = recordWinner(e.parameter.id, e.parameter.round);
    else if (action === 'clearWinners')       result = clearWinners();
    else if (action === 'submitRSVP')         result = submitRSVP(e.parameter);
    else if (action === 'getRSVPs')           result = getRSVPs();
    else if (action === 'syncRSVPsToGuests')  result = syncRSVPsToGuests();
    else if (action === 'submitRevisedRSVP')  result = submitRevisedRSVP(e.parameter);  // ← NEW
    else if (action === 'getRevisedRSVPs')    result = getRevisedRSVPs();                // ← NEW
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
    'manual',  // Source
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
//  ORIGINAL RSVP
// ════════════════════════════════════════════════════════════

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


// ════════════════════════════════════════════════════════════
//  REVISED RSVP  ← NEW
//  Records responses to the date-change landing page.
//
//  RevisedRSVP sheet columns:
//  A  Timestamp
//  B  Name
//  C  Phone
//  D  Status          "Still Coming" | "Cannot Attend"
// ════════════════════════════════════════════════════════════

function submitRevisedRSVP(p) {
  const sheet     = getRevisedRSVPSheet();
  const phone     = formatPhone(p.phone);
  const status    = p.status    || '';
  const timestamp = p.timestamp || new Date().toISOString();

  sheet.appendRow([
    timestamp,
    (p.name  || '').trim(),
    phone,
    status,
  ]);

  // Force phone column (C = col 3) to plain text
  const newRow = sheet.getLastRow();
  sheet.getRange(newRow, 3).setNumberFormat('@');

  return { success: true };
}

function getRevisedRSVPs() {
  const sheet = getRevisedRSVPSheet();
  const rows  = sheet.getDataRange().getValues();
  const headers = rows[0];
  const rsvps = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  return { rsvps, total: rsvps.length };
}


// ════════════════════════════════════════════════════════════
//  SYNC RSVPs → Guests
// ════════════════════════════════════════════════════════════

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

  const guestSheet = getSheet();
  const allGuestRows = guestSheet.getDataRange().getValues();

  const manualRows = allGuestRows.slice(1).filter(row => {
    const source = (row[8] || '').toString().trim();
    return source === 'manual';
  });

  const lastRow = guestSheet.getLastRow();
  if (lastRow > 1) {
    guestSheet.getRange(2, 1, lastRow - 1, guestSheet.getLastColumn()).clearContent();
    guestSheet.deleteRows(2, lastRow - 1);
  }

  manualRows.forEach(row => {
    guestSheet.appendRow(row);
  });

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

function addGuestFromRSVP(p) {
  const sheet     = getSheet();
  const rows      = sheet.getDataRange().getValues();
  const partySize = parseInt(p.partySize) || 1;

  const allNames     = (p.guestNames     || '').split(',').map(s => s.trim()).filter(Boolean);
  const allAllergies = (p.guestAllergies || '').split(',').map(s => s.trim());

  if (allNames.length === 0) {
    const fullName = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
    if (fullName) allNames.push(fullName);
  }

  const existingNames = rows.slice(1).map(r => (r[1] || '').toString().toLowerCase());

  allNames.forEach((name, idx) => {
    if (!name) return;
    if (existingNames.includes(name.toLowerCase())) return;

    const newId = sheet.getLastRow();
    const phone = formatPhone(p.phone);

    sheet.appendRow([
      newId,
      name,
      '',
      phone,
      '',
      false,
      '',
      '',
      'RSVP',
    ]);
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
    [50,200,70,130,100,100,120,140,80].forEach((w,i) => sheet.setColumnWidth(i+1, w));
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
    sheet.getRange('G:G').setNumberFormat('@');
  }
  return sheet;
}

// ── NEW: RevisedRSVP sheet ────────────────────────────────
function getRevisedRSVPSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(REVISED_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(REVISED_SHEET_NAME);

    const headers = ['Timestamp', 'Name', 'Phone', 'Status'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#2c2c2c');
    hRange.setFontColor('#c9a84c');
    hRange.setFontWeight('bold');
    sheet.setFrozenRows(1);

    sheet.setColumnWidth(1, 180);  // Timestamp
    sheet.setColumnWidth(2, 200);  // Name
    sheet.setColumnWidth(3, 140);  // Phone
    sheet.setColumnWidth(4, 140);  // Status

    // Status column: colour-coded conditional formatting
    const range    = sheet.getRange('D2:D1000');
    const ruleYes  = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Still Coming')
      .setBackground('#d4edda').setFontColor('#155724')
      .setRanges([range]).build();
    const ruleNo   = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Cannot Attend')
      .setBackground('#f8d7da').setFontColor('#721c24')
      .setRanges([range]).build();
    sheet.setConditionalFormatRules([ruleYes, ruleNo]);

    // Force phone column (C = col 3) to plain text
    sheet.getRange('C:C').setNumberFormat('@');
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

function formatPhone(raw) {
  if (!raw) return '';
  let digits = raw.toString().replace(/\D/g, '');
  if (digits.startsWith('660') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('66') && digits.length === 11) digits = '0' + digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) {
    return digits.slice(0,3) + '-' + digits.slice(3,6) + '-' + digits.slice(6);
  }
  return digits || raw.toString().trim();
}
