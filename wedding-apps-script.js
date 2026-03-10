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
    if      (action === 'getGuests')        result = getGuests();
    else if (action === 'checkIn')          result = checkIn(e.parameter.id, e.parameter.time);
    else if (action === 'addGuest')         result = addGuest(e.parameter);
    else if (action === 'selfCheckIn')      result = selfCheckIn(e.parameter.id);
    else if (action === 'recordWinner')     result = recordWinner(e.parameter.id, e.parameter.round);
    else if (action === 'clearWinners')     result = clearWinners();
    else if (action === 'submitRSVP')       result = submitRSVP(e.parameter);
    else if (action === 'getRSVPs')         result = getRSVPs();
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
//  GUEST CHECK-IN  (unchanged)
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
    params.seatNumber || '',  // Seat Number — to be assigned manually
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
  RSVP sheet columns (auto-created):
  A  Timestamp
  B  Attending          Yes / No
  C  First Name
  D  Last Name
  E  Full Name          (B + C, for easy reading)
  F  Email
  G  Phone
  H  Relation
  I  How They Met
  J  Party Size
  K  Guest Names        comma-separated
  L  Guest Meals        comma-separated
  M  Primary Meal
  N  Dietary Notes
  O  Transport
  P  Needs Accommodation
  Q  Looking Forward To comma-separated
  R  Song Request
  S  Wishes / Message
  T  How Heard
  U  Decline Reason
  V  Decline Message
*/

function submitRSVP(p) {
  const sheet = getRSVPSheet();

  const fullName  = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
  const attending = (p.attending || '').toLowerCase() === 'yes' ? 'Yes' : 'No';

  sheet.appendRow([
    p.timestamp    || new Date().toISOString(),  // A
    attending,                                    // B
    p.firstName    || '',                         // C
    p.lastName     || '',                         // D
    fullName,                                     // E
    p.email        || '',                         // F
    p.phone        || '',                         // G
    p.relation     || '',                         // H
    p.howKnow      || '',                         // I
    parseInt(p.partySize) || (attending === 'Yes' ? 1 : 0), // J
    p.guestNames   || '',                         // K
    p.guestMeals   || '',                         // L
    p.mealPrimary  || '',                         // M
    p.dietary      || '',                         // N
    p.transport    || '',                         // O
    p.needsAccommodation || '',                   // P
    p.highlights   || '',                         // Q
    p.songRequest  || '',                         // R
    p.wishes       || '',                         // S
    p.howHeard     || '',                         // T
    p.declineReason  || '',                       // U
    p.declineMessage || '',                       // V
  ]);

  // ── Optional: also pre-populate the Guests sheet ────────────
  // If the guest is attending, add them to the main Guests sheet
  // so staff can check them in on the day without manual entry.
  if (attending === 'Yes' && fullName) {
    addGuestFromRSVP(fullName, p);
  }

  return { success: true };
}

// Reads all RSVPs back (useful for a future admin RSVP dashboard)
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
  const rsvpSheet  = getRSVPSheet();
  const rsvpRows   = rsvpSheet.getDataRange().getValues();
  const headers    = rsvpRows[0];

  // Map header → column index
  const col = {};
  headers.forEach((h, i) => col[h] = i);

  let added = 0;
  rsvpRows.slice(1).forEach(row => {
    const attending  = (row[col['Attending']] || '').toString().trim();
    if (attending !== 'Yes') return;

    const firstName  = (row[col['First Name']] || '').trim();
    const lastName   = (row[col['Last Name']]  || '').trim();
    const fullName   = (firstName + ' ' + lastName).trim();
    const phone      = (row[col['Phone']]       || '').trim();
    const partySize  = parseInt(row[col['Party Size']]) || 1;
    const guestNames = (row[col['Guest Names']] || '').toString();

    if (!fullName) return;

    // Simulate the params object that addGuestFromRSVP expects
    const p = {
      phone,
      partySize,
      guestNames,
    };
    const before = getSheet().getLastRow();
    addGuestFromRSVP(fullName, p);
    added += getSheet().getLastRow() - before;
  });

  return { success: true, added };
}

// Add each guest from an RSVP as individual rows in the Guests sheet (1 per line)
function addGuestFromRSVP(primaryName, p) {
  const sheet   = getSheet();
  const rows    = sheet.getDataRange().getValues();

  // Build list of all guest names from this RSVP
  const partySize  = parseInt(p.partySize) || 1;
  const extraNames = (p.guestNames || '').split(',').map(s => s.trim()).filter(Boolean);

  // Collect all names: primary + additional guests
  const allNames = [primaryName];
  for (let i = 1; i < partySize; i++) {
    const extra = extraNames[i - 1];
    if (extra && extra.toLowerCase() !== primaryName.toLowerCase()) {
      allNames.push(extra);
    }
  }

  // Add each guest as a separate row (skip if already exists by name)
  const existingNames = rows.slice(1).map(r => (r[1] || '').toString().toLowerCase());

  allNames.forEach(name => {
    if (!name) return;
    if (existingNames.includes(name.toLowerCase())) return; // already there

    const newId = sheet.getLastRow(); // use current last row as ID
    sheet.appendRow([
      newId,
      name,
      '',     // Table — staff will assign later
      p.phone || '',
      '',     // Seat Number — staff will assign later
      false,  // not checked in yet
      '',     // no check-in time yet
    ]);
    existingNames.push(name.toLowerCase()); // prevent duplicates within same batch
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

    // Column widths
    sheet.setColumnWidth(1, 50);   // ID
    sheet.setColumnWidth(2, 200);  // Name
    sheet.setColumnWidth(3, 70);   // Table
    sheet.setColumnWidth(4, 130);  // Phone
    sheet.setColumnWidth(5, 100);  // Seat Number
    sheet.setColumnWidth(6, 100);  // Checked In
    sheet.setColumnWidth(7, 120);  // Check-In Time
    sheet.setColumnWidth(8, 140);  // Lucky Draw Prize
  }
  return sheet;
}

function getRSVPSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(RSVP_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(RSVP_SHEET_NAME);

    const headers = [
      'Timestamp',       // A
      'Attending',       // B
      'First Name',      // C
      'Last Name',       // D
      'Full Name',       // E
      'Email',           // F
      'Phone',           // G
      'Relation',        // H
      'How They Met',    // I
      'Party Size',      // J
      'Guest Names',     // K
      'Guest Meals',     // L
      'Primary Meal',    // M
      'Dietary Notes',   // N
      'Transport',       // O
      'Needs Accomm.',   // P
      'Looking Fwd To',  // Q
      'Song Request',    // R
      'Wishes',          // S
      'How Heard',       // T
      'Decline Reason',  // U
      'Decline Message', // V
    ];

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // Style header — rose/blush theme to distinguish from Guests sheet
    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#5a2030');
    hRange.setFontColor('#f0b8c8');
    hRange.setFontWeight('bold');
    sheet.setFrozenRows(1);

    // Alternating row banding
    const banding = sheet.getRange(2, 1, 1000, headers.length)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
    banding.setFirstRowColor('#fff8fa');
    banding.setSecondRowColor('#fdeef3');

    // Column widths
    sheet.setColumnWidth(1, 170);  // Timestamp
    sheet.setColumnWidth(2, 80);   // Attending
    sheet.setColumnWidth(3, 110);  // First Name
    sheet.setColumnWidth(4, 110);  // Last Name
    sheet.setColumnWidth(5, 180);  // Full Name
    sheet.setColumnWidth(6, 200);  // Email
    sheet.setColumnWidth(7, 130);  // Phone
    sheet.setColumnWidth(8, 150);  // Relation
    sheet.setColumnWidth(9, 170);  // How They Met
    sheet.setColumnWidth(10, 80);  // Party Size
    sheet.setColumnWidth(11, 230); // Guest Names
    sheet.setColumnWidth(12, 200); // Guest Meals
    sheet.setColumnWidth(13, 120); // Primary Meal
    sheet.setColumnWidth(14, 200); // Dietary Notes
    sheet.setColumnWidth(15, 130); // Transport
    sheet.setColumnWidth(16, 120); // Needs Accomm.
    sheet.setColumnWidth(17, 200); // Looking Fwd To
    sheet.setColumnWidth(18, 200); // Song Request
    sheet.setColumnWidth(19, 280); // Wishes
    sheet.setColumnWidth(20, 140); // How Heard
    sheet.setColumnWidth(21, 160); // Decline Reason
    sheet.setColumnWidth(22, 280); // Decline Message

    // Freeze the Full Name column so it stays visible when scrolling
    sheet.setFrozenColumns(5);

    // Conditional formatting: highlight "Yes" attending rows in soft green
    const range = sheet.getRange('B2:B1000');
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Yes')
      .setBackground('#d4edda')
      .setFontColor('#2d6a4f')
      .setRanges([range])
      .build();
    const rules = sheet.getConditionalFormatRules();
    rules.push(rule);
    sheet.setConditionalFormatRules(rules);

    // Conditional formatting: highlight "No" in soft pink
    const ruleNo = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('No')
      .setBackground('#fce4ec')
      .setFontColor('#a85570')
      .setRanges([range])
      .build();
    rules.push(ruleNo);
    sheet.setConditionalFormatRules(rules);
  }

  return sheet;
}

function formatTime(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{1,2}:\d{2}/.test(val)) return val.slice(0, 5);
  if (val instanceof Date) {
    const h = String(val.getHours()).padStart(2, '0');
    const m = String(val.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }
  try {
    const d = new Date(val);
    if (!isNaN(d)) {
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return h + ':' + m;
    }
  } catch(e) {}
  return String(val);
}

function now() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm');
}
