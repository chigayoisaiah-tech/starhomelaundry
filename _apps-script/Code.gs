/**
 * =====================================================================
 *  STARHOME CLEANERS & LAUNDRY — Booking Calendar, Quotes & Reminder System v4
 *  Google Apps Script (bound to a Google Sheet)
 * =====================================================================
 *
 *  WHAT IT DOES
 *   1. Receives booking requests from starhomecleaners.co.za (doPost)
 *   2. Logs each request in the "Bookings" sheet with Status = Pending
 *   3. Adds it to the "Starhome Bookings" Google Calendar
 *        grey = pending · blue = cleaning · green = laundry pickup
 *   4. Emails the customer "request received" + emails you a new-booking alert
 *   5. ADMIN APP (Admin.html), left panel:
 *        Calendar      – staff-column day view + week view, drag to reschedule
 *        Quotes        – quick quotes from the price list; WhatsApp/email/print, convert to booking
 *        Clients       – every customer, built from bookings, with history
 *        Staff         – add / edit / deactivate cleaners & drivers
 *        Notifications – live activity feed with unread badge
 *   6. Changes update the Google Calendar and email the customer
 *      (Confirmed / Rescheduled / Cancelled)
 *   7. Staff with an email in the Staff tab are added as guests to their jobs
 *   8. Hourly: reminder emails ~24h before CONFIRMED jobs
 *   9. Daily 06:00: digest email to you (today, tomorrow, pending)
 *
 *  FILES IN THIS APPS SCRIPT PROJECT
 *   - Code.gs     (this file)
 *   - Admin.html  (the admin app — name it exactly "Admin")
 * =====================================================================
 */

const CONFIG = {
  BUSINESS_NAME: 'Starhome Cleaners & Laundry',
  ADMIN_EMAIL: 'info@starhomecleaners.co.za',        // where alerts & digests go
  CALENDAR_NAME: 'Starhome Bookings',
  SHEET_NAME: 'Bookings',
  STAFF_SHEET_NAME: 'Staff',
  LOG_SHEET_NAME: 'Activity',
  PRICES_SHEET_NAME: 'Prices',
  QUOTES_SHEET_NAME: 'Quotes',
  USERS_SHEET_NAME: 'Admin Users',
  PORTAL_SHEET_NAME: 'Client Logins',
  PHONE: '065 299 2030',
  WHATSAPP: '062 496 1315',
  WEBSITE: 'https://starhomecleaners.co.za',

  // Optional: paste your Web app /exec URL here after deploying,
  // so menu links and emails point at the live admin app.
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbyx357GxGWv1O7km22GbVHTJXlPJ8-E-7VIWFgeil9GadUTXxSMjWP9ej1N7mxFbGTQ/exec',

  // Time windows customers can request (label -> [start hour, end hour])
  TIME_WINDOWS: {
    'Morning (08:00–12:00)': [8, 12],
    'Afternoon (12:00–16:00)': [12, 16],
  },

  DAY_START_HOUR: 7,           // admin calendar shows 07:00 ...
  DAY_END_HOUR: 18,            // ... to 18:00
  REMINDER_HOURS_BEFORE: 24,   // customer reminder lead time
  DIGEST_HOUR: 6,              // daily digest to you (06:00)
  LOG_KEEP_ROWS: 500,          // activity entries kept

  // Quotes (same rules as the website price list)
  LAUNDRY_MIN_CHARGE: 450,     // "Minimum charge: R450"
  EXPRESS_SURCHARGE: 0.5,      // "Express (Same Day) +50%"
  QUOTE_VALID_DAYS: 7,

  // Logins
  ADMIN_SESSION_DAYS: 7,       // admin stays signed in on a device for 7 days
  CLIENT_SESSION_DAYS: 30,     // clients stay signed in for 30 days
  PORTAL_MIN_NOTICE_HOURS: 12, // clients can cancel/reschedule online up to 12h before
  LAUNDRY_SLOTS: ['06:00-08:00', '08:00-10:00', '10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'],
};

const TZ = 'Africa/Johannesburg';
const HEADERS = [
  'Booking ID', 'Created', 'Service', 'Name', 'Phone', 'Email', 'Address',
  'Suburb', 'Preferred Date', 'Time Window', 'Details', 'Estimate',
  'Status', 'Event ID', 'Reminder Sent', 'Notes',
  'Staff', 'Start Time', 'End Time',
];
const STAFF_HEADERS = ['Name', 'Role', 'Colour', 'Email', 'Active', 'Phone'];
const LOG_HEADERS = ['Time', 'Type', 'Booking ID', 'Customer', 'Message'];
const PRICE_HEADERS = ['Service', 'Category', 'Item', 'Unit', 'Price', 'Active'];
const QUOTE_HEADERS = [
  'Quote ID', 'Created', 'Service', 'Name', 'Phone', 'Email', 'Suburb', 'Lines',
  'Express', 'Discount', 'Subtotal', 'Total', 'Status', 'Valid Until', 'Notes', 'Booking ID', 'Sent',
];
const QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Booked'];
const USER_HEADERS = ['Email', 'Name', 'Role', 'Active', 'Last Login', 'Salt', 'Hash'];
const PORTAL_HEADERS = ['Client Key', 'Name', 'Phone', 'Email', 'Active', 'Created', 'Last Login', 'Salt', 'Hash'];
const STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
const C = HEADERS.reduce((o, h, i) => { o[h] = i + 1; return o; }, {});
const Q = QUOTE_HEADERS.reduce((o, h, i) => { o[h] = i + 1; return o; }, {});

// Seed price list — copied from starhomecleaners.co.za (index.html price list + book.js calculator).
// Edit prices any time in the Prices tab of the Sheet.
const DEFAULT_PRICES = [
  ['Laundry', 'Laundry (per kg)', 'Wash, Dry & Iron', 'kg', 55],
  ['Laundry', 'Laundry (per kg)', 'Wash, Dry & Fold', 'kg', 45],
  ['Laundry', 'Laundry (per kg)', 'Ironing Only', 'kg', 50],
  ['Laundry', 'Dry Cleaning - Clothing', 'Shirt / Blouse', 'item', 120],
  ['Laundry', 'Dry Cleaning - Clothing', 'Trouser / Skirt', 'item', 140],
  ['Laundry', 'Dry Cleaning - Clothing', 'Suit (2-Piece)', 'item', 295],
  ['Laundry', 'Dry Cleaning - Clothing', 'Suit (3-Piece)', 'item', 350],
  ['Laundry', 'Dry Cleaning - Clothing', 'Suit Jacket / Blazer', 'item', 190],
  ['Laundry', 'Dry Cleaning - Clothing', 'School Blazer', 'item', 170],
  ['Laundry', 'Dry Cleaning - Clothing', 'Sweater / Cardigan', 'item', 190],
  ['Laundry', 'Dry Cleaning - Clothing', 'Vest / Waist Coat', 'item', 190],
  ['Laundry', 'Dry Cleaning - Clothing', 'Jersey / Tracksuit', 'item', 200],
  ['Laundry', 'Dry Cleaning - Clothing', 'Tie', 'item', 95],
  ['Laundry', 'Dry Cleaning - Clothing', 'Bow Tie', 'item', 80],
  ['Laundry', 'Dry Cleaning - Clothing', 'Berets', 'item', 100],
  ['Laundry', 'Coats & Dresses', 'Coat - Short (Above Knee)', 'item', 235],
  ['Laundry', 'Coats & Dresses', 'Coat - Medium', 'item', 265],
  ['Laundry', 'Coats & Dresses', 'Coat - Long (Ankle Length)', 'item', 310],
  ['Laundry', 'Coats & Dresses', 'Dress - Plain Short', 'item', 240],
  ['Laundry', 'Coats & Dresses', 'Dress - Plain Medium', 'item', 260],
  ['Laundry', 'Coats & Dresses', 'Dress - Plain Long', 'item', 400],
  ['Laundry', 'Coats & Dresses', 'Wedding Dress (from)', 'item', 1500],
  ['Laundry', 'Coats & Dresses', 'Outerwear', 'item', 170],
  ['Laundry', 'Coats & Dresses', 'Fur Jacket', 'item', 440],
  ['Laundry', 'Leather & Suede', 'Suede/Leather Jacket - Short', 'item', 570],
  ['Laundry', 'Leather & Suede', 'Suede/Leather Jacket - Above Knee', 'item', 720],
  ['Laundry', 'Leather & Suede', 'Suede/Leather Jacket - Above Ankle', 'item', 870],
  ['Laundry', 'Leather & Suede', 'Leather / Suede Shoes', 'pair', 250],
  ['Laundry', 'Leather & Suede', 'Sneakers (Canvas/Synthetic)', 'pair', 110],
  ['Laundry', 'Handbags', 'Small Handbag (<25cm)', 'item', 280],
  ['Laundry', 'Handbags', 'Medium Handbag (26-34cm)', 'item', 350],
  ['Laundry', 'Handbags', 'Large Handbag (35-45cm)', 'item', 490],
  ['Laundry', 'Bedding & Home', 'Single Down Duvet', 'item', 200],
  ['Laundry', 'Bedding & Home', 'Duvet / Blanket - Double', 'item', 250],
  ['Laundry', 'Bedding & Home', 'Duvet / Blanket - Queen', 'item', 270],
  ['Laundry', 'Bedding & Home', 'Duvet / Blanket - King', 'item', 300],
  ['Laundry', 'Bedding & Home', 'Pillow - Medium', 'item', 60],
  ['Laundry', 'Bedding & Home', 'Curtains - Normal', 'kg', 90],
  ['Laundry', 'Bedding & Home', 'Curtains - Blockout', 'kg', 120],
  ['Cleaning', 'Standard Cleaning', 'Standard clean - base', 'visit', 200],
  ['Cleaning', 'Standard Cleaning', 'Bedroom (standard)', 'room', 60],
  ['Cleaning', 'Standard Cleaning', 'Bathroom (standard)', 'room', 80],
  ['Cleaning', 'Deep Cleaning', 'Deep clean - base', 'visit', 800],
  ['Cleaning', 'Deep Cleaning', 'Bedroom (deep)', 'room', 120],
  ['Cleaning', 'Deep Cleaning', 'Bathroom (deep)', 'room', 150],
  ['Cleaning', 'Extras', 'Oven cleaning', 'item', 150],
  ['Cleaning', 'Extras', 'Window cleaning', 'item', 150],
  ['Cleaning', 'Extras', 'Wall cleaning', 'item', 200],
  ['Cleaning', 'Extras', 'Detergents supplied', 'item', 150],
  ['Cleaning', 'Moving Services', 'Moving - small', 'move', 1000],
  ['Cleaning', 'Moving Services', 'Moving - medium', 'move', 1500],
  ['Cleaning', 'Moving Services', 'Moving - large', 'move', 3000],
  ['Cleaning', 'Care Giving', 'Care giving - 3 hours', 'visit', 300],
  ['Cleaning', 'Care Giving', 'Care giving - 4 hours', 'visit', 350],
  ['Cleaning', 'Care Giving', 'Care giving - 5 hours', 'visit', 500],
  ['Cleaning', 'Care Giving', 'Care giving - 6 hours', 'visit', 450],
  ['Cleaning', 'Care Giving', 'Care giving - 8 hours', 'visit', 500],
  ['Cleaning', 'Garden Landscaping', 'Garden landscaping (after on-site assessment)', 'visit', 0],
];

// Fields the admin app may change -> sheet column
const EDITABLE = {
  status: 'Status', staff: 'Staff', date: 'Preferred Date',
  startTime: 'Start Time', endTime: 'End Time', timeWindow: 'Time Window',
  service: 'Service', name: 'Name', phone: 'Phone', email: 'Email',
  address: 'Address', suburb: 'Suburb', details: 'Details',
  estimate: 'Estimate', notes: 'Notes',
};


/* =====================================================================
 *  ONE-TIME SETUP  (safe to run again)
 * ===================================================================== */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  // ---- Staff tab ----
  let st = ss.getSheetByName(CONFIG.STAFF_SHEET_NAME);
  if (!st) {
    st = ss.insertSheet(CONFIG.STAFF_SHEET_NAME);
    st.getRange(2, 1, 3, 6).setValues([
      ['Cleaner 1', 'Cleaner', '#3b82f6', '', true, ''],
      ['Cleaner 2', 'Cleaner', '#ec4899', '', true, ''],
      ['Laundry Driver', 'Driver', '#10b981', '', true, ''],
    ]);
  }
  styleHeader_(st.getRange(1, 1, 1, STAFF_HEADERS.length).setValues([STAFF_HEADERS]));
  st.setFrozenRows(1);
  st.getRange(2, 5, 98, 1).insertCheckboxes();
  st.getRange(2, 6, 98, 1).setNumberFormat('@');
  st.getRange(2, 2, 98, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Cleaner', 'Driver', 'Supervisor'], true).setAllowInvalid(true).build()
  );
  st.setColumnWidth(1, 170); st.setColumnWidth(4, 220);

  // ---- Activity, Prices & Quotes tabs ----
  getLogSheet_();
  getPricesSheet_();
  getQuotesSheet_();
  getUsersSheet_();
  getPortalSheet_();

  // ---- Bookings tab ----
  const sh = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME, 0);
  styleHeader_(sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]));
  sh.setFrozenRows(1);

  const n = sh.getMaxRows() - 1;
  const list = (vals, allowInvalid) => SpreadsheetApp.newDataValidation()
    .requireValueInList(vals, true).setAllowInvalid(!!allowInvalid).build();

  sh.getRange(2, C['Status'], n, 1).setDataValidation(list(STATUSES));
  sh.getRange(2, C['Time Window'], n, 1).setDataValidation(list(Object.keys(CONFIG.TIME_WINDOWS)));
  sh.getRange(2, C['Service'], n, 1).setDataValidation(list(['Cleaning', 'Laundry']));
  sh.getRange(2, C['Staff'], n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(st.getRange('A2:A100'), true).setAllowInvalid(true).build()
  );
  sh.getRange(2, C['Preferred Date'], n, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build())
    .setNumberFormat('ddd dd mmm yyyy');
  sh.getRange(2, C['Created'], n, 1).setNumberFormat('dd mmm yyyy hh:mm');
  sh.getRange(2, C['Reminder Sent'], n, 1).setNumberFormat('dd mmm yyyy hh:mm');
  sh.getRange(2, C['Start Time'], n, 2).setNumberFormat('@');   // keep "09:30" as text

  const statusRange = sh.getRange(2, C['Status'], n, 1);
  sh.setConditionalFormatRules([
    ['Pending', '#fff2cc'], ['Confirmed', '#d9ead3'],
    ['Completed', '#cfe2f3'], ['Cancelled', '#f4cccc'],
  ].map(([v, colour]) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(v).setBackground(colour).setRanges([statusRange]).build()));

  sh.hideColumns(C['Event ID']);

  getCalendar_();
  getAdminKey_();

  // ---- Triggers (fresh) ----
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('sendReminders').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(CONFIG.DIGEST_HOUR).everyDays(1).inTimezone(TZ).create();

  ss.toast('Setup complete — calendar "' + CONFIG.CALENDAR_NAME + '" is ready.', 'Starhome', 8);
}

function styleHeader_(range) {
  range.setFontWeight('bold').setBackground('#0b5394').setFontColor('#ffffff');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Starhome')
    .addItem('Open admin app', 'showAdminLink')
    .addItem('Set / reset an admin login', 'setAdminLogin')
    .addSeparator()
    .addItem('Sync all bookings to calendar', 'syncAll')
    .addItem('Send due reminders now', 'sendReminders')
    .addItem('Email me today\'s digest now', 'dailyDigest')
    .addSeparator()
    .addItem('Add test booking', 'addTestBooking')
    .addToUi();
}

function showAdminLink() {
  const base = appBaseUrl_();
  const body = base
    ? '<p><b>Admin login page</b> (sign in with your email &amp; password):<br>' +
      '<a href="' + base + '?page=admin" target="_blank">' + base + '?page=admin</a></p>' +
      '<p><b>Client portal</b> (clients sign in with phone + PIN):<br>' +
      '<a href="' + base + '?page=portal" target="_blank">' + base + '?page=portal</a></p>' +
      '<p style="color:#666;font-size:12px">Emergency master link (no password — keep private):<br>' +
      '<textarea style="width:100%;height:52px" onclick="this.select()">' + adminUrl_() + '</textarea></p>' +
      (/\/dev(\?|$)/.test(base) ? '<p style="color:#b45f06">These are test (/dev) links. Paste your /exec Web app URL into CONFIG.WEB_APP_URL for the live ones.</p>' : '')
    : '<p>Deploy first: <b>Deploy → New deployment → Web app</b>, then open this menu again.</p>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput('<div style="font-family:Arial;font-size:14px">' + body + '</div>').setWidth(520).setHeight(320),
    'Starhome links'
  );
}

// Sheet menu: create the first admin login, or reset a forgotten password
function setAdminLogin() {
  const ui = SpreadsheetApp.getUi();
  const e = ui.prompt('Admin login (1/3)', 'Email address to sign in with:', ui.ButtonSet.OK_CANCEL);
  if (e.getSelectedButton() !== ui.Button.OK) return;
  const email = e.getResponseText().trim().toLowerCase();
  if (!isEmail_(email)) return ui.alert('That email address doesn\'t look right.');
  const n = ui.prompt('Admin login (2/3)', 'Name to show in the app:', ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK) return;
  const p = ui.prompt('Admin login (3/3)', 'Password (at least 8 characters):', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  const pw = p.getResponseText();
  if (pw.length < 8) return ui.alert('Password must be at least 8 characters.');
  saveUser_({ email: email, name: n.getResponseText().trim() || email, role: 'Owner', active: true, password: pw });
  ui.alert('Saved. Sign in at:\n' + (appBaseUrl_() ? appBaseUrl_() + '?page=admin' : '(deploy the Web app first)'));
}


/* =====================================================================
 *  WEB ENDPOINTS
 * ===================================================================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.page === 'portal') {
    const boot = {
      business: CONFIG.BUSINESS_NAME, phone: CONFIG.PHONE, whatsapp: CONFIG.WHATSAPP, website: CONFIG.WEBSITE,
      today: ymd_(new Date()),
      sso: takeSso_(p.sso, 'portal'),
    };
    const t = HtmlService.createTemplateFromFile('Portal');
    t.bootstrap = JSON.stringify(boot).replace(/</g, '\\u003c');
    return t.evaluate()
      .setTitle('My Starhome — bookings & orders')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  if (p.page === 'admin') {
    // Signed in by email + password (login screen), or by the private master key link
    const boot = {
      key: String(p.key || '') === getAdminKey_() ? p.key : '',
      sso: takeSso_(p.sso, 'admin'),
      today: ymd_(new Date()),
      dayStart: CONFIG.DAY_START_HOUR,
      dayEnd: CONFIG.DAY_END_HOUR,
      windows: Object.keys(CONFIG.TIME_WINDOWS),
      statuses: STATUSES,
      sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
      business: CONFIG.BUSINESS_NAME,
      tab: ['calendar', 'quotes', 'clients', 'staff', 'notifs'].indexOf(p.tab) >= 0 ? p.tab : 'calendar',
      quote: {
        minCharge: CONFIG.LAUNDRY_MIN_CHARGE,
        express: CONFIG.EXPRESS_SURCHARGE,
        validDays: CONFIG.QUOTE_VALID_DAYS,
        phone: CONFIG.PHONE,
        whatsapp: CONFIG.WHATSAPP,
        website: CONFIG.WEBSITE,
      },
      portalUrl: appBaseUrl_() ? appBaseUrl_() + '?page=portal' : '',
    };
    const t = HtmlService.createTemplateFromFile('Admin');
    t.bootstrap = JSON.stringify(boot).replace(/</g, '\\u003c');
    return t.evaluate()
      .setTitle('Starhome Admin')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return json_({ ok: true, service: CONFIG.BUSINESS_NAME + ' booking API' });
}

// Website booking form -> Pending booking
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const d = parseRequest_(e);

    if (d.action === 'login') return json_(siteLogin_(d.id, d.secret));  // website "Sign in" box
    if (d.action === 'signup') return json_(d.website ? { ok: false, error: 'Could not sign up' } : siteSignup_(d));  // website "Sign up"

    if (d.website) return json_({ ok: true }); // honeypot: bots fill hidden "website" field

    const missing = ['service', 'name', 'phone', 'date'].filter(k => !String(d[k] || '').trim());
    if (missing.length) return json_({ ok: false, error: 'Missing: ' + missing.join(', ') });
    if (!parseDate_(d.date)) return json_({ ok: false, error: 'Invalid date' });

    // Website requests never set staff or internal notes.
    // A requested slot (e.g. laundry pickup 08:00–10:00) is kept as the job's time.
    delete d.staff; delete d.notes;
    const okTime = s => { const t = normTime_(s); return t && t >= '05:00' && t <= '21:00' ? t : ''; };
    const st = okTime(d.startTime), en = okTime(d.endTime);
    d.startTime = st && en && en > st ? st : '';
    d.endTime = d.startTime ? en : '';
    const windows = Object.keys(CONFIG.TIME_WINDOWS);
    if (d.startTime && windows.indexOf(d.timeWindow) < 0) {
      d.timeWindow = Number(d.startTime.slice(0, 2)) < 12 ? windows[0] : windows[windows.length - 1];
    }

    const b = createBooking_(d, 'Pending', validRef_(d.ref));
    logActivity_('new', b, 'New website request: ' + jobLabel_(b) + ' on ' + fmtShort_(b.date) + ', ' + timeText_(b) +
      (b.suburb ? ' — ' + b.suburb : ''));

    // Starhome is ALWAYS alerted from here (the website's EmailJS alert can't be relied on).
    // The customer email is skipped only when the site says EmailJS already sent it.
    const skip = d.skipEmails === true || d.skipEmails === 'true';
    try { notifyAdminNew_(b); } catch (e) { console.error('Admin alert failed: ' + e); }
    if (!skip) sendCustomerEmail_(b, 'received');

    return json_({ ok: true, id: b.id });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}


/* =====================================================================
 *  ADMIN API  (called from Admin.html via google.script.run)
 * ===================================================================== */

// --- Calendar ---
function adminGetData(key, fromYmd, toYmd) {
  checkKey_(key);
  const today = ymd_(new Date());
  const all = readAll_().filter(b => b.date instanceof Date);
  const inRange = all.filter(b => { const d = ymd_(b.date); return d >= fromYmd && d <= toYmd; });
  const pending = all.filter(b => b.status === 'Pending' && ymd_(b.date) >= today)
    .sort((a, b) => getTimes_(a).start - getTimes_(b).start);

  return {
    staff: getStaff_().filter(s => s.active).map(s => ({ name: s.name, role: s.role, colour: s.colour })),
    bookings: inRange.map(toClient_),
    pending: pending.map(toClient_),
    notif: notifSummary_(),
  };
}

function adminGetBooking(key, id) {
  checkKey_(key);
  const sh = getSheet_();
  const row = findRow_(sh, id);
  if (!row) throw new Error('Booking ' + id + ' not found');
  return toClient_(readRow_(sh, row));
}

function adminUpdateBooking(key, id, changes, notify) {
  checkKey_(key);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_();
    const row = findRow_(sh, id);
    if (!row) throw new Error('Booking ' + id + ' not found');
    const before = readRow_(sh, row);

    Object.keys(changes || {}).forEach(k => {
      const header = EDITABLE[k];
      if (!header) return;
      let val = changes[k];
      if (k === 'date') { val = parseDate_(val); if (!val) return; }
      else if (k === 'startTime' || k === 'endTime') val = normTime_(val);
      else if (k === 'phone') val = phoneCell_(val);
      else if (k === 'service') val = normaliseService_(val);
      else if (k === 'status') { if (STATUSES.indexOf(val) < 0) return; }
      else if (k === 'timeWindow') { if (!CONFIG.TIME_WINDOWS[val]) return; }
      else val = clean_(val);
      sh.getRange(row, C[header]).setValue(val);
    });

    SpreadsheetApp.flush();
    return toClient_(afterChange_(sh, row, before, notify !== false));
  } finally {
    lock.releaseLock();
  }
}

function adminCreateBooking(key, d, notify) {
  checkKey_(key);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!String(d.name || '').trim()) throw new Error('Name is required');
    if (!parseDate_(d.date)) throw new Error('Valid date is required');
    const status = STATUSES.indexOf(d.status) >= 0 ? d.status : 'Confirmed';
    const b = createBooking_(d, status);
    logActivity_('created', b, 'Booking added by admin: ' + jobLabel_(b) + ' on ' + fmtShort_(b.date) + ' ' + timeText_(b) +
      (b.staff ? ' — ' + b.staff : '') + (d.quoteId ? ' (from quote ' + d.quoteId + ')' : ''));
    if (d.quoteId) setQuoteFields_(d.quoteId, { 'Status': 'Booked', 'Booking ID': b.id });
    if (notify !== false) {
      if (status === 'Confirmed') sendCustomerEmail_(b, 'confirmed');
      else if (status === 'Pending') sendCustomerEmail_(b, 'received');
    }
    return toClient_(b);
  } finally {
    lock.releaseLock();
  }
}

// --- Notifications ---
function adminGetNotifications(key) {
  checkKey_(key);
  const seen = notifSeen_();
  const sh = getLogSheet_();
  const last = sh.getLastRow();
  const items = last < 2 ? [] : sh.getRange(2, 1, Math.min(last - 1, 100), LOG_HEADERS.length).getValues()
    .filter(r => r[0] instanceof Date)
    .map(r => ({
      time: r[0].toISOString(), type: String(r[1]), id: String(r[2] || ''),
      name: String(r[3] || ''), message: String(r[4] || ''), unread: r[0].getTime() > seen,
    }));
  return { items: items, unread: items.filter(i => i.unread).length };
}

function adminMarkSeen(key) {
  checkKey_(key);
  PropertiesService.getScriptProperties().setProperty('NOTIF_SEEN', String(Date.now()));
  return true;
}

function adminPing(key) {
  checkKey_(key);
  const today = ymd_(new Date());
  const pending = readAll_().filter(b => b.status === 'Pending' && b.date instanceof Date && ymd_(b.date) >= today).length;
  return { notif: notifSummary_(), pending: pending };
}

// --- Staff ---
function adminGetStaff(key) {
  checkKey_(key);
  STAFF_CACHE_ = null;
  const today = ymd_(new Date());
  const monthAgo = ymd_(new Date(Date.now() - 30 * 86400000));
  const bookings = readAll_().filter(b => b.date instanceof Date && b.staff);

  return getStaff_().map(s => {
    const mine = bookings.filter(b => b.staff === s.name);
    const upcoming = mine.filter(b => ymd_(b.date) >= today && (b.status === 'Confirmed' || b.status === 'Pending'))
      .sort((a, b) => getTimes_(a).start - getTimes_(b).start);
    return {
      name: s.name, role: s.role, colour: s.colour, email: s.email, phone: s.phone, active: s.active,
      upcoming: upcoming.length,
      todayJobs: upcoming.filter(b => ymd_(b.date) === today).length,
      completed30: mine.filter(b => b.status === 'Completed' && ymd_(b.date) >= monthAgo).length,
      next: upcoming.length ? toClient_(upcoming[0]) : null,
    };
  });
}

function adminSaveStaff(key, s, originalName) {
  checkKey_(key);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const name = String(s.name || '').trim().slice(0, 60);
    if (!name) throw new Error('Name is required');
    const colour = /^#[0-9a-f]{6}$/i.test(String(s.colour || '')) ? s.colour : '#64748b';
    if (s.email && !isEmail_(s.email)) throw new Error('That email address doesn\'t look right');

    const st = getStaffSheet_();
    const last = st.getLastRow();
    const names = last < 2 ? [] : st.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]).trim());
    const orig = String(originalName || '').trim();
    const clash = names.findIndex(n => n.toLowerCase() === name.toLowerCase());
    const origIdx = orig ? names.indexOf(orig) : -1;
    if (clash >= 0 && clash !== origIdx) throw new Error('Someone called "' + name + '" already exists');

    const row = origIdx >= 0 ? origIdx + 2 : Math.max(last, 1) + 1;
    st.getRange(row, 1, 1, STAFF_HEADERS.length).setValues([[
      clean_(name), clean_(s.role), colour, String(s.email || '').trim(), s.active !== false,
      s.phone ? "'" + String(s.phone).trim().slice(0, 30) : '',
    ]]);
    st.getRange(row, 5).insertCheckboxes().setValue(s.active !== false);
    STAFF_CACHE_ = null;

    // Renamed? carry the new name onto their bookings and calendar events
    if (orig && orig !== name) {
      const sh = getSheet_();
      const lastB = sh.getLastRow();
      if (lastB >= 2) {
        const col = sh.getRange(2, C['Staff'], lastB - 1, 1);
        const vals = col.getValues();
        const changed = [];
        vals.forEach((r, i) => { if (String(r[0]).trim() === orig) { r[0] = name; changed.push(i + 2); } });
        if (changed.length) {
          col.setValues(vals);
          changed.forEach(r => syncEvent_(sh, r));
        }
      }
    } else if (orig) {
      // email may have changed -> refresh guest lists on upcoming jobs
      const sh = getSheet_();
      const today = ymd_(new Date());
      readAll_().filter(b => b.staff === name && b.date instanceof Date && ymd_(b.date) >= today)
        .forEach(b => syncEvent_(sh, b.row));
    }

    logActivity_('staff', null, (origIdx >= 0 ? 'Staff updated: ' : 'Staff added: ') + name +
      (s.role ? ' (' + s.role + ')' : '') + (s.active === false ? ' — inactive' : ''));
    return adminGetStaff(key);
  } finally {
    lock.releaseLock();
  }
}

// --- Clients (built from bookings, grouped by phone > email > name) ---
function adminGetClients(key) {
  checkKey_(key);
  const today = ymd_(new Date());
  const map = {};
  const portal = portalAccounts_();

  readAll_().forEach(b => {
    const k = clientKey_(b);
    if (!k) return;
    const c = map[k] || (map[k] = { key: k, bookings: [] });
    c.bookings.push(toClient_(b));
  });

  return Object.keys(map).map(k => {
    const c = map[k];
    const bs = c.bookings.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
    const latest = f => (bs.find(b => b[f]) || {})[f] || '';
    const past = bs.filter(b => b.date && b.date < today && b.status !== 'Cancelled');
    const future = bs.filter(b => b.date && b.date >= today && (b.status === 'Confirmed' || b.status === 'Pending'))
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const services = [];
    bs.forEach(b => { if (services.indexOf(b.service) < 0) services.push(b.service); });
    return {
      key: k,
      name: latest('name'), phone: latest('phone'), email: latest('email'),
      address: latest('address'), suburb: latest('suburb'),
      total: bs.length,
      completed: bs.filter(b => b.status === 'Completed').length,
      cancelled: bs.filter(b => b.status === 'Cancelled').length,
      upcoming: future.length,
      lastVisit: past.length ? past[0].date : '',
      next: future.length ? future[0].date : '',
      services: services,
      lastActivity: bs.length ? bs[0].date : '',
      portal: portal[k] ? { active: portal[k].active, lastLogin: portal[k].lastLogin } : null,
      bookings: bs,
    };
  }).sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)));
}

function clientKey_(b) {
  let p = String(b.phone || '').replace(/\D/g, '');
  if (p.indexOf('27') === 0 && p.length === 11) p = '0' + p.slice(2);
  if (p.length >= 9) return 'p' + p;
  if (isEmail_(b.email)) return 'e' + b.email.toLowerCase();
  const n = String(b.name || '').trim().toLowerCase();
  return n ? 'n' + n : '';
}


/* =====================================================================
 *  QUOTES  (quick quotes — only a name OR phone needed)
 * ===================================================================== */

function adminGetQuotes(key) {
  checkKey_(key);
  return { quotes: readQuotes_(), prices: getPrices_() };
}

function adminSaveQuote(key, q) {
  checkKey_(key);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const service = normaliseService_(q.service);
    const calc = computeQuote_({ service: service, lines: q.lines, express: q.express, discount: q.discount });
    if (!calc.lines.length) throw new Error('Add at least one item with a quantity');

    const sh = getQuotesSheet_();
    let row = q.id ? findQuoteRow_(q.id) : 0;
    const isNew = !row;
    const id = isNew ? makeQuoteId_() : q.id;
    const valid = parseDate_(q.validUntil) || new Date(Date.now() + CONFIG.QUOTE_VALID_DAYS * 86400000);
    const status = QUOTE_STATUSES.indexOf(q.status) >= 0 ? q.status : 'Draft';

    const rec = {
      'Quote ID': id,
      'Service': service,
      'Name': clean_(q.name) || 'Quick quote',
      'Phone': phoneCell_(q.phone),
      'Email': clean_(q.email),
      'Suburb': clean_(q.suburb),
      'Lines': JSON.stringify(calc.lines.map(l => ({ item: l.item, unit: l.unit, qty: l.qty, price: l.price }))),
      'Express': service === 'Laundry' && !!q.express,
      'Discount': calc.discount,
      'Subtotal': calc.subtotal,
      'Total': calc.total,
      'Status': status,
      'Valid Until': valid,
      'Notes': clean_(q.notes),
    };

    if (isNew) {
      rec['Created'] = new Date();
      sh.appendRow(QUOTE_HEADERS.map(h => rec[h] === undefined ? '' : rec[h]));
      row = sh.getLastRow();
    } else {
      Object.keys(rec).forEach(h => sh.getRange(row, Q[h]).setValue(rec[h]));
    }
    SpreadsheetApp.flush();
    const saved = readQuoteRow_(sh, row);
    logActivity_('quote', null, (isNew ? 'Quote created: ' : 'Quote updated: ') + saved.id + ' for ' + saved.name +
      ' — ' + fmtR_(saved.total) + ' (' + service + ')');
    return saved;
  } finally {
    lock.releaseLock();
  }
}

// channel: 'email' (sent from here, with PDF) or 'whatsapp' (opened on the admin's phone; we just record it)
function adminSendQuote(key, id, channel) {
  checkKey_(key);
  const row = findQuoteRow_(id);
  if (!row) throw new Error('Quote ' + id + ' not found');
  const sh = getQuotesSheet_();
  const q = readQuoteRow_(sh, row);

  if (channel === 'email') {
    if (!isEmail_(q.email)) throw new Error('Add the customer\'s email address first');
    const html = quoteHtml_(q);
    const pdf = HtmlService.createHtmlOutput(html).getBlob().getAs(MimeType.PDF).setName('Starhome-Quote-' + q.id + '.pdf');
    MailApp.sendEmail({
      to: q.email,
      subject: 'Your Starhome quote ' + q.id + ' – ' + fmtR_(q.total),
      htmlBody: html,
      attachments: [pdf],
      name: CONFIG.BUSINESS_NAME,
      replyTo: CONFIG.ADMIN_EMAIL,
    });
  }
  if (q.status === 'Draft') sh.getRange(row, Q['Status']).setValue('Sent');
  sh.getRange(row, Q['Sent']).setValue(new Date());
  logActivity_('quote', null, 'Quote ' + q.id + ' sent by ' + (channel === 'email' ? 'email' : 'WhatsApp') +
    ' to ' + q.name + ' — ' + fmtR_(q.total));
  return readQuoteRow_(sh, row);
}

function adminSetQuoteStatus(key, id, status) {
  checkKey_(key);
  if (QUOTE_STATUSES.indexOf(status) < 0) throw new Error('Unknown status');
  const q = setQuoteFields_(id, { 'Status': status });
  logActivity_('quote', null, 'Quote ' + id + ' marked ' + status + ' — ' + q.name);
  return q;
}

function setQuoteFields_(id, fields) {
  const row = findQuoteRow_(id);
  if (!row) throw new Error('Quote ' + id + ' not found');
  const sh = getQuotesSheet_();
  Object.keys(fields).forEach(h => { if (Q[h]) sh.getRange(row, Q[h]).setValue(fields[h]); });
  return readQuoteRow_(sh, row);
}

// Same maths as the admin page: lines -> subtotal -> laundry minimum -> express -> discount
function computeQuote_(q) {
  const r2 = n => Math.round(n * 100) / 100;
  const lines = (q.lines || []).map(l => ({
    item: String(l.item || '').trim().slice(0, 120),
    unit: String(l.unit || 'item').trim().slice(0, 20),
    qty: Math.max(0, Number(l.qty) || 0),
    price: Math.max(0, Number(l.price) || 0),
  })).filter(l => l.item && l.qty > 0);
  lines.forEach(l => { l.total = r2(l.qty * l.price); });
  const subtotal = r2(lines.reduce((s, l) => s + l.total, 0));
  const laundry = q.service === 'Laundry';
  const topUp = laundry && subtotal > 0 ? Math.max(0, r2(CONFIG.LAUNDRY_MIN_CHARGE - subtotal)) : 0;
  const base = subtotal + topUp;
  const express = laundry && q.express ? r2(base * CONFIG.EXPRESS_SURCHARGE) : 0;
  const discount = Math.min(Math.max(0, r2(Number(q.discount) || 0)), base + express);
  return { lines: lines, subtotal: subtotal, topUp: topUp, express: express, discount: discount, total: r2(base + express - discount) };
}

function quoteHtml_(q) {
  const rows = q.lines.map(l =>
    '<tr><td style="padding:8px;border-bottom:1px solid #eee">' + esc_(l.item) + '</td>' +
    '<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">' + esc_(l.qty) + ' ' + esc_(l.unit) + '</td>' +
    '<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">' + fmtR_(l.price) + '</td>' +
    '<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">' + fmtR_(l.total) + '</td></tr>').join('');
  const extra = (label, val, neg) => val ? '<tr><td colspan="3" style="padding:6px 8px;text-align:right;color:#555">' + label +
    '</td><td style="padding:6px 8px;text-align:right">' + (neg ? '− ' : '') + fmtR_(val) + '</td></tr>' : '';
  return '<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#14213d">' +
    '<div style="background:#0b5394;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">' +
    '<div style="font-size:20px;font-weight:bold">' + esc_(CONFIG.BUSINESS_NAME) + '</div>' +
    '<div style="font-size:13px;opacity:.85">Quote ' + esc_(q.id) + ' · ' + esc_(fmtShort_(parseDate_(q.created))) + '</div></div>' +
    '<div style="border:1px solid #e5e5e5;border-top:0;padding:20px 22px;border-radius:0 0 8px 8px">' +
    '<p style="margin-top:0">Hi ' + esc_(q.name) + ',<br>Thank you for your enquiry. Here is your ' +
    (q.service === 'Laundry' ? 'laundry &amp; dry cleaning' : 'cleaning') + ' quote:</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '<tr style="background:#f5f7fa"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:right">Qty</th>' +
    '<th style="padding:8px;text-align:right">Price</th><th style="padding:8px;text-align:right">Amount</th></tr>' + rows +
    extra('Subtotal', q.subtotal) +
    extra('Minimum charge top-up', q.topUp) +
    extra('Express same-day (+' + Math.round(CONFIG.EXPRESS_SURCHARGE * 100) + '%)', q.express) +
    extra('Discount', q.discount, true) +
    '<tr><td colspan="3" style="padding:10px 8px;text-align:right;font-weight:bold;font-size:16px">Total</td>' +
    '<td style="padding:10px 8px;text-align:right;font-weight:bold;font-size:16px">' + fmtR_(q.total) + '</td></tr></table>' +
    (q.notes ? '<p style="background:#f5f7fa;padding:10px;border-radius:6px;font-size:13px">' + esc_(q.notes) + '</p>' : '') +
    '<p style="font-size:13px;color:#555">Valid until ' + esc_(fmtDate_(parseDate_(q.validUntil))) + '. ' +
    (q.service === 'Laundry' ? 'Per-kg items are weighed at collection, so the final amount may differ slightly. ' : '') +
    'Free pickup &amp; delivery.</p>' +
    '<p style="font-size:14px">To book, reply to this email, call <b>' + CONFIG.PHONE + '</b> or WhatsApp <b>' + CONFIG.WHATSAPP + '</b>.</p>' +
    '<p style="font-size:12px;color:#888">' + CONFIG.WEBSITE.replace('https://', '') + '</p></div></div>';
}

function getQuotesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.QUOTES_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.QUOTES_SHEET_NAME);
    styleHeader_(sh.getRange(1, 1, 1, QUOTE_HEADERS.length).setValues([QUOTE_HEADERS]));
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('dd mmm yyyy hh:mm');
    sh.getRange('N:N').setNumberFormat('dd mmm yyyy');
    sh.getRange('Q:Q').setNumberFormat('dd mmm yyyy hh:mm');
    sh.getRange('E:E').setNumberFormat('@');
    sh.getRange('J:L').setNumberFormat('"R"#,##0.00');
    sh.hideColumns(Q['Lines']);
  }
  return sh;
}

function getPricesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.PRICES_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.PRICES_SHEET_NAME);
    styleHeader_(sh.getRange(1, 1, 1, PRICE_HEADERS.length).setValues([PRICE_HEADERS]));
    sh.setFrozenRows(1);
    sh.getRange(2, 1, DEFAULT_PRICES.length, 6).setValues(DEFAULT_PRICES.map(r => r.concat([true])));
    sh.getRange(2, 6, DEFAULT_PRICES.length, 1).insertCheckboxes();
    sh.getRange('E:E').setNumberFormat('"R"#,##0.00');
    sh.setColumnWidth(2, 190); sh.setColumnWidth(3, 260);
  }
  return sh;
}

function getPrices_() {
  const sh = getPricesSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, PRICE_HEADERS.length).getValues()
    .filter(r => String(r[2]).trim() && r[5] !== false)
    .map(r => ({
      service: normaliseService_(r[0]), category: String(r[1] || 'Other'),
      item: String(r[2]).trim(), unit: String(r[3] || 'item'), price: Number(r[4]) || 0,
    }));
}

function readQuotes_() {
  const sh = getQuotesSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rng = sh.getRange(2, 1, last - 1, QUOTE_HEADERS.length);
  const v = rng.getValues(), dv = rng.getDisplayValues();
  return v.map((r, i) => toQuote_(r, dv[i])).filter(q => q.id)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

function readQuoteRow_(sh, row) {
  const rng = sh.getRange(row, 1, 1, QUOTE_HEADERS.length);
  return toQuote_(rng.getValues()[0], rng.getDisplayValues()[0]);
}

function toQuote_(v, dv) {
  const g = h => v[Q[h] - 1];
  let lines = [];
  try { lines = JSON.parse(g('Lines') || '[]'); } catch (_) { lines = []; }
  const service = normaliseService_(g('Service'));
  const calc = computeQuote_({ service: service, lines: lines, express: g('Express') === true, discount: g('Discount') });
  const d = x => x instanceof Date ? ymd_(x) : '';
  return {
    id: String(g('Quote ID') || ''),
    created: g('Created') instanceof Date ? Utilities.formatDate(g('Created'), TZ, "yyyy-MM-dd'T'HH:mm") : '',
    service: service,
    name: String(g('Name') || ''),
    phone: String(dv[Q['Phone'] - 1] || ''),
    email: String(g('Email') || ''),
    suburb: String(g('Suburb') || ''),
    lines: calc.lines,
    express: g('Express') === true,
    discount: calc.discount, subtotal: calc.subtotal, topUp: calc.topUp, expressAmt: calc.express, total: calc.total,
    status: String(g('Status') || 'Draft'),
    validUntil: d(g('Valid Until')),
    notes: String(g('Notes') || ''),
    bookingId: String(g('Booking ID') || ''),
    sent: g('Sent') instanceof Date ? g('Sent').toISOString() : '',
  };
}

function findQuoteRow_(id) {
  const sh = getQuotesSheet_();
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function makeQuoteId_() {
  return 'Q-' + Utilities.formatDate(new Date(), TZ, 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}

function fmtR_(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const parts = v.toFixed(v % 1 ? 2 : 0).split('.');
  return 'R' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
}


/* =====================================================================
 *  LOGINS — sessions, admin users, client portal accounts
 *  Passwords/PINs are stored only as salted hashes. Sessions are random
 *  tokens; only a hash of each token is kept (Script Properties).
 * ===================================================================== */

function hashSecret_(salt, secret) {
  let h = salt + '|' + secret;
  for (let i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  }
  return h;
}
function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }
function newToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function tokenKey_(t) {
  return 'S_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(t))).slice(0, 32);
}

function createSession_(data, days) {
  const t = newToken_();
  data.exp = Date.now() + days * 86400000;
  PropertiesService.getScriptProperties().setProperty(tokenKey_(t), JSON.stringify(data));
  return t;
}

function getSession_(t) {
  if (!t || String(t).length < 40) return null;
  const p = PropertiesService.getScriptProperties();
  const raw = p.getProperty(tokenKey_(t));
  if (!raw) return null;
  let s; try { s = JSON.parse(raw); } catch (_) { return null; }
  if (!s.exp || s.exp < Date.now()) { p.deleteProperty(tokenKey_(t)); return null; }
  return s;
}

function endSession_(t) { if (t) PropertiesService.getScriptProperties().deleteProperty(tokenKey_(t)); }

// Remove expired sessions, and optionally every session for one person
function purgeSessions_(matchType, matchId) {
  const p = PropertiesService.getScriptProperties();
  const all = p.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('S_') !== 0) return;
    let s; try { s = JSON.parse(all[k]); } catch (_) { p.deleteProperty(k); return; }
    if (s.exp < Date.now() || (matchType && s.type === matchType && (s.email === matchId || s.key === matchId))) p.deleteProperty(k);
  });
}

// 5 wrong attempts -> locked for 15 minutes
function throttle_(id) {
  const c = CacheService.getScriptCache();
  const k = 'F_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(id)));
  const n = Number(c.get(k) || 0);
  if (n >= 5) throw new Error('Too many attempts — please try again in 15 minutes');
  return { fail: () => c.put(k, String(n + 1), 900), ok: () => c.remove(k) };
}

// ---------- Admin users ----------
function getUsersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.USERS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.USERS_SHEET_NAME);
    styleHeader_(sh.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]));
    sh.setFrozenRows(1);
    sh.getRange('E:E').setNumberFormat('dd mmm yyyy hh:mm');
    sh.hideColumns(6, 2);
    sh.setColumnWidth(1, 240);
  }
  return sh;
}

function readUsers_() {
  const sh = getUsersSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, USER_HEADERS.length).getValues().map((r, i) => ({
    row: i + 2, email: String(r[0]).trim().toLowerCase(), name: String(r[1] || ''), role: String(r[2] || 'Admin'),
    active: r[3] !== false && String(r[3]).toLowerCase() !== 'false',
    lastLogin: r[4] instanceof Date ? r[4].toISOString() : '', salt: String(r[5] || ''), hash: String(r[6] || ''),
  })).filter(u => u.email);
}

function saveUser_(u) {
  const sh = getUsersSheet_();
  const email = String(u.email || '').trim().toLowerCase();
  if (!isEmail_(email)) throw new Error('Enter a valid email address');
  const existing = readUsers_().filter(x => x.email === email)[0];
  if (!existing && !u.password) throw new Error('Set a password for the new login');
  if (u.password && String(u.password).length < 8) throw new Error('Password must be at least 8 characters');
  const salt = u.password ? newSalt_() : existing.salt;
  const hash = u.password ? hashSecret_(salt, String(u.password)) : existing.hash;
  const row = existing ? existing.row : Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(row, 1, 1, USER_HEADERS.length).setValues([[
    email, clean_(u.name) || email, ['Owner', 'Admin', 'Staff'].indexOf(u.role) >= 0 ? u.role : 'Admin',
    u.active !== false, existing ? (existing.lastLogin ? new Date(existing.lastLogin) : '') : '', salt, hash,
  ]]);
  if (u.password || u.active === false) purgeSessions_('admin', email);  // sign out everywhere
}

function authLogin(email, password) {
  email = String(email || '').trim().toLowerCase();
  const t = throttle_('a:' + email);
  const u = readUsers_().filter(x => x.email === email && x.active)[0];
  if (!u || !u.hash || hashSecret_(u.salt, String(password || '')) !== u.hash) {
    t.fail();
    throw new Error('Wrong email or password');
  }
  t.ok();
  getUsersSheet_().getRange(u.row, 5).setValue(new Date());
  purgeSessions_();
  const token = createSession_({ type: 'admin', email: u.email, name: u.name, role: u.role }, CONFIG.ADMIN_SESSION_DAYS);
  logActivity_('login', null, u.name + ' signed in to the admin app');
  return { token: token, name: u.name, role: u.role, email: u.email };
}

// ---------- One sign-in on the website ----------
// Admin email + password -> admin app; phone + PIN -> client portal.
// Returns a one-time code (valid 2 minutes) that the app page swaps for the
// session, so no password or session token ever appears in a URL.
function siteLogin_(id, secret) {
  id = String(id || '').trim();
  try {
    let page, r;
    if (id.indexOf('@') > 0) { r = authLogin(id, secret); page = 'admin'; }
    else { r = portalLogin(id, secret); page = 'portal'; }
    return { ok: true, page: page, code: ssoCode_(page, r.token), name: r.name };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

function ssoCode_(page, token) {
  const code = newToken_();
  CacheService.getScriptCache().put('SSO_' + code, JSON.stringify({ page: page, token: token }), 120);
  return code;
}

// New client signs themselves up on the website (name, phone, optional email, own PIN).
// Creates their My Starhome login and signs them straight in. Staff/admin logins
// can't be created this way — those are only added from the Sheet / admin app.
function siteSignup_(d) {
  try {
    const name = String(d.name || '').trim();
    const phone = String(d.phone || '').trim();
    const email = String(d.email || '').trim();
    const pin = String(d.pin || '').trim();
    if (name.length < 2) throw new Error('Enter your name');
    const ck = clientKey_({ phone: phone });
    if (!ck || ck.charAt(0) !== 'p') throw new Error('Enter a valid phone number');
    if (email && !isEmail_(email)) throw new Error('Enter a valid email address, or leave it blank');
    if (!/^\d{4,6}$/.test(pin)) throw new Error('Choose a PIN of 4–6 digits');
    const t = throttle_('s:' + ck);
    const existing = readPortal_().filter(a => a.key === ck)[0];
    if (existing) {
      t.fail();
      throw new Error(existing.active
        ? 'This phone number already has an account — please sign in instead.'
        : 'This account has been switched off — please WhatsApp us on ' + CONFIG.WHATSAPP + '.');
    }
    const sh = getPortalSheet_();
    const salt = newSalt_();
    const row = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(row, 1, 1, PORTAL_HEADERS.length).setValues([[
      ck, clean_(name), "'" + phone, clean_(email), true, new Date(), '', salt, hashSecret_(salt, pin),
    ]]);
    t.ok();
    logActivity_('staff', null, 'New client sign-up on the website: ' + name + ' (' + phone + ')');
    try {
      MailApp.sendEmail(CONFIG.ADMIN_EMAIL, 'New My Starhome sign-up: ' + name,
        name + ' signed up on the website.\nPhone: ' + phone + (email ? '\nEmail: ' + email : '') +
        '\n\nThey can now book and manage orders in My Starhome.');
    } catch (_) {}
    const r = portalLogin(phone, pin);
    return { ok: true, page: 'portal', code: ssoCode_('portal', r.token), name: r.name };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

function takeSso_(code, page) {
  if (!code) return '';
  const c = CacheService.getScriptCache();
  const raw = c.get('SSO_' + String(code));
  if (!raw) return '';
  c.remove('SSO_' + String(code));
  try { const o = JSON.parse(raw); return o.page === page ? o.token : ''; } catch (_) { return ''; }
}

function authCheck(token) {
  if (token && String(token) === getAdminKey_()) return { name: 'Owner', role: 'Owner', email: '' };
  const s = getSession_(token);
  return s && s.type === 'admin' ? { name: s.name, role: s.role, email: s.email } : null;
}

function authLogout(token) { endSession_(token); return true; }

function adminListUsers(key) {
  checkKey_(key);
  return readUsers_().map(u => ({ email: u.email, name: u.name, role: u.role, active: u.active, lastLogin: u.lastLogin }));
}

function adminSaveUser(key, u) {
  const me = checkKey_(key);
  const users = readUsers_();
  const target = users.filter(x => x.email === String(u.email || '').trim().toLowerCase())[0];
  const owners = users.filter(x => x.role === 'Owner' && x.active);
  if (target && target.role === 'Owner' && owners.length === 1 && (u.active === false || u.role !== 'Owner')) {
    throw new Error('Keep at least one active Owner');
  }
  saveUser_(u);
  logActivity_('staff', null, 'Admin login ' + (target ? 'updated' : 'added') + ': ' + u.email + ' (by ' + (me.name || 'admin') + ')');
  return adminListUsers(key);
}

// ---------- Client portal accounts ----------
function getPortalSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.PORTAL_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.PORTAL_SHEET_NAME);
    styleHeader_(sh.getRange(1, 1, 1, PORTAL_HEADERS.length).setValues([PORTAL_HEADERS]));
    sh.setFrozenRows(1);
    sh.getRange('C:C').setNumberFormat('@');
    sh.getRange('F:G').setNumberFormat('dd mmm yyyy hh:mm');
    sh.hideColumns(8, 2);
  }
  return sh;
}

function readPortal_() {
  const sh = getPortalSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rng = sh.getRange(2, 1, last - 1, PORTAL_HEADERS.length);
  const dv = rng.getDisplayValues();
  return rng.getValues().map((r, i) => ({
    row: i + 2, key: String(r[0]), name: String(r[1] || ''), phone: String(dv[i][2] || ''), email: String(r[3] || ''),
    active: r[4] !== false && String(r[4]).toLowerCase() !== 'false',
    lastLogin: r[6] instanceof Date ? r[6].toISOString() : '', salt: String(r[7] || ''), hash: String(r[8] || ''),
  })).filter(a => a.key);
}

function portalAccounts_() {
  const m = {};
  readPortal_().forEach(a => { m[a.key] = a; });
  return m;
}

// Admin: give a client portal access (or reset their PIN). Returns the new PIN once.
function adminGrantPortal(key, c) {
  checkKey_(key);
  const ck = clientKey_(c);
  if (!ck || ck.charAt(0) !== 'p') throw new Error('The client needs a phone number to get a login');
  const pin = String(100000 + Math.floor(Math.random() * 900000));
  const salt = newSalt_();
  const sh = getPortalSheet_();
  const existing = readPortal_().filter(a => a.key === ck)[0];
  const row = existing ? existing.row : Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(row, 1, 1, PORTAL_HEADERS.length).setValues([[
    ck, clean_(c.name), "'" + String(c.phone || '').trim(), clean_(c.email), true,
    existing ? sh.getRange(row, 6).getValue() : new Date(), existing ? sh.getRange(row, 7).getValue() : '',
    salt, hashSecret_(salt, pin),
  ]]);
  purgeSessions_('client', ck);
  logActivity_('staff', null, (existing ? 'Client login PIN reset: ' : 'Client portal access given: ') + c.name);
  return { pin: pin, url: appBaseUrl_() ? appBaseUrl_() + '?page=portal' : '' };
}

function adminRevokePortal(key, c) {
  checkKey_(key);
  const ck = clientKey_(c);
  const a = readPortal_().filter(x => x.key === ck)[0];
  if (!a) return true;
  getPortalSheet_().getRange(a.row, 5).setValue(false);
  purgeSessions_('client', ck);
  logActivity_('staff', null, 'Client portal access removed: ' + a.name);
  return true;
}

function checkClient_(t) {
  const s = getSession_(t);
  if (!s || s.type !== 'client') throw new Error('Please sign in again');
  const a = readPortal_().filter(x => x.key === s.key && x.active)[0];
  if (!a) { endSession_(t); throw new Error('Your login is no longer active — please contact us'); }
  return s;
}

function portalLogin(phone, pin) {
  const ck = clientKey_({ phone: phone });
  if (!ck) throw new Error('Enter the phone number you booked with');
  const t = throttle_('c:' + ck);
  const a = readPortal_().filter(x => x.key === ck && x.active)[0];
  if (!a || hashSecret_(a.salt, String(pin || '').trim()) !== a.hash) {
    t.fail();
    throw new Error('Wrong phone number or PIN');
  }
  t.ok();
  getPortalSheet_().getRange(a.row, 7).setValue(new Date());
  purgeSessions_();
  const token = createSession_({ type: 'client', key: ck, name: a.name, phone: a.phone, email: a.email }, CONFIG.CLIENT_SESSION_DAYS);
  logActivity_('login', null, a.name + ' signed in to the client portal');
  return { token: token, name: a.name };
}

function portalCheck(token) {
  try { const s = checkClient_(token); return { name: s.name }; } catch (_) { return null; }
}

function portalLogout(token) { endSession_(token); return true; }

function portalChangePin(token, oldPin, newPin) {
  const s = checkClient_(token);
  newPin = String(newPin || '').trim();
  if (!/^\d{4,6}$/.test(newPin)) throw new Error('Your new PIN must be 4–6 digits');
  const a = readPortal_().filter(x => x.key === s.key)[0];
  if (hashSecret_(a.salt, String(oldPin || '').trim()) !== a.hash) throw new Error('Your current PIN is wrong');
  const salt = newSalt_();
  getPortalSheet_().getRange(a.row, 8, 1, 2).setValues([[salt, hashSecret_(salt, newPin)]]);
  return true;
}


/* =====================================================================
 *  CLIENT PORTAL API  (called from Portal.html with the client's token)
 * ===================================================================== */

function portalGetData(token) {
  const s = checkClient_(token);
  const mine = readAll_().filter(b => clientKey_(b) === s.key && b.date instanceof Date);
  const latest = mine.slice().sort((a, b) => b.row - a.row);
  const pick = f => (latest.filter(b => b[f])[0] || {})[f] || '';
  const quotes = readQuotes_().filter(q => clientKey_(q) === s.key && ['Sent', 'Accepted', 'Booked'].indexOf(q.status) >= 0);
  return {
    profile: { name: s.name, phone: s.phone, email: s.email || pick('email'), address: pick('address'), suburb: pick('suburb') },
    bookings: mine.map(portalBooking_).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)),
    quotes: quotes.map(q => ({
      id: q.id, service: q.service, lines: q.lines, subtotal: q.subtotal, topUp: q.topUp, expressAmt: q.expressAmt,
      discount: q.discount, total: q.total, status: q.status, validUntil: q.validUntil, notes: q.notes, bookingId: q.bookingId,
    })),
    prices: getPrices_(),
    windows: Object.keys(CONFIG.TIME_WINDOWS),
    slots: CONFIG.LAUNDRY_SLOTS,
    rules: { minCharge: CONFIG.LAUNDRY_MIN_CHARGE, express: CONFIG.EXPRESS_SURCHARGE, noticeHours: CONFIG.PORTAL_MIN_NOTICE_HOURS },
  };
}

function portalBooking_(b) {
  const t = getTimes_(b);
  const changeable = (b.status === 'Pending' || b.status === 'Confirmed') && t &&
    t.start.getTime() - Date.now() > CONFIG.PORTAL_MIN_NOTICE_HOURS * 3600000;
  return {
    id: b.id, service: b.service, status: b.status,
    date: ymd_(b.date), start: t ? hm_(t.start) : '', end: t ? hm_(t.end) : '',
    exactTime: !!b.startTime, timeWindow: b.window,
    address: b.address, suburb: b.suburb, details: b.details, estimate: b.estimate,
    staff: b.staff ? b.staff.split(' ')[0] : '', canChange: !!changeable,
  };
}

// Applies a client's chosen date + time (laundry slot like "08:00-10:00", or a cleaning window)
function portalSlot_(service, date, time) {
  const d = parseDate_(date);
  if (!d) throw new Error('Choose a date');
  if (ymd_(d) <= ymd_(new Date())) throw new Error('Online bookings are for tomorrow onwards — WhatsApp us for today');
  const out = { date: d, timeWindow: '', startTime: '', endTime: '' };
  const m = String(time || '').match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (service === 'Laundry' && m && CONFIG.LAUNDRY_SLOTS.indexOf(time) >= 0) {
    out.startTime = m[1]; out.endTime = m[2];
    const w = Object.keys(CONFIG.TIME_WINDOWS);
    out.timeWindow = Number(m[1].slice(0, 2)) < 12 ? w[0] : w[w.length - 1];
  } else if (CONFIG.TIME_WINDOWS[time]) {
    out.timeWindow = time;
  } else {
    throw new Error('Choose a time');
  }
  return out;
}

function linesSummary_(calc, express) {
  return calc.lines.map(l => l.qty + ' ' + l.unit + ' ' + l.item).join('; ') + (express ? ' · EXPRESS same-day' : '');
}

function portalCreateBooking(token, d) {
  const s = checkClient_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const service = normaliseService_(d.service);
    const slot = portalSlot_(service, d.date, d.time);
    if (!String(d.address || '').trim()) throw new Error('Add the address');
    const calc = computeQuote_({ service: service, lines: d.lines || [], express: d.express });
    const details = [calc.lines.length ? linesSummary_(calc, service === 'Laundry' && d.express) : '', d.notes ? 'Notes: ' + d.notes : '']
      .filter(Boolean).join(' | ');
    const b = createBooking_({
      service: service, name: s.name, phone: s.phone, email: d.email || s.email,
      address: d.address, suburb: d.suburb, date: slot.date, timeWindow: slot.timeWindow,
      startTime: slot.startTime, endTime: slot.endTime, details: details,
      estimate: calc.total ? fmtR_(calc.total) + ' (online estimate)' : '',
    }, 'Pending');
    logActivity_('new', b, 'Client portal request: ' + jobLabel_(b) + ' on ' + fmtShort_(b.date) + ', ' + timeText_(b) +
      (b.suburb ? ' — ' + b.suburb : ''));
    notifyAdminNew_(b);
    sendCustomerEmail_(b, 'received');
    return portalBooking_(b);
  } finally {
    lock.releaseLock();
  }
}

function portalOwnRow_(s, id) {
  const sh = getSheet_();
  const row = findRow_(sh, id);
  if (!row) throw new Error('Booking not found');
  const b = readRow_(sh, row);
  if (clientKey_(b) !== s.key) throw new Error('Booking not found');
  return { sh: sh, row: row, b: b };
}

function portalCancelBooking(token, id) {
  const s = checkClient_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const o = portalOwnRow_(s, id);
    if (!portalBooking_(o.b).canChange) {
      throw new Error('This booking is less than ' + CONFIG.PORTAL_MIN_NOTICE_HOURS + ' hours away — please WhatsApp us on ' + CONFIG.WHATSAPP);
    }
    o.sh.getRange(o.row, C['Status']).setValue('Cancelled');
    SpreadsheetApp.flush();
    return portalBooking_(afterChange_(o.sh, o.row, o.b, true, 'by client'));
  } finally {
    lock.releaseLock();
  }
}

// Client moves a booking: it goes back to Pending so the team re-confirms the new time
function portalReschedule(token, id, date, time, note) {
  const s = checkClient_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const o = portalOwnRow_(s, id);
    if (!portalBooking_(o.b).canChange) {
      throw new Error('This booking is less than ' + CONFIG.PORTAL_MIN_NOTICE_HOURS + ' hours away — please WhatsApp us on ' + CONFIG.WHATSAPP);
    }
    const slot = portalSlot_(o.b.service, date, time);
    const sh = o.sh, row = o.row;
    sh.getRange(row, C['Preferred Date']).setValue(slot.date);
    sh.getRange(row, C['Time Window']).setValue(slot.timeWindow);
    sh.getRange(row, C['Start Time']).setValue(slot.startTime);
    sh.getRange(row, C['End Time']).setValue(slot.endTime);
    sh.getRange(row, C['Status']).setValue('Pending');
    sh.getRange(row, C['Reminder Sent']).setValue('');
    if (note) sh.getRange(row, C['Notes']).setValue(clean_(('Client note: ' + note + '\n' + o.b.notes).trim()));
    SpreadsheetApp.flush();
    syncEvent_(sh, row);
    const b = readRow_(sh, row);
    logActivity_('rescheduled', b, 'Client asked to move ' + jobLabel_(b) + ' to ' + fmtShort_(b.date) + ' ' + timeText_(b) +
      ' — needs your confirmation');
    sendCustomerEmail_(b, 'received');
    return portalBooking_(b);
  } finally {
    lock.releaseLock();
  }
}

function portalAcceptQuote(token, quoteId, d) {
  const s = checkClient_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const q = readQuotes_().filter(x => x.id === quoteId && clientKey_(x) === s.key)[0];
    if (!q) throw new Error('Quote not found');
    if (q.status === 'Booked') throw new Error('This quote is already booked');
    if (q.validUntil && q.validUntil < ymd_(new Date())) throw new Error('This quote has expired — please ask us for an updated one');
    const slot = portalSlot_(q.service, d.date, d.time);
    if (!String(d.address || '').trim()) throw new Error('Add the address');
    const b = createBooking_({
      service: q.service, name: s.name, phone: s.phone, email: s.email || q.email,
      address: d.address, suburb: d.suburb || q.suburb, date: slot.date, timeWindow: slot.timeWindow,
      startTime: slot.startTime, endTime: slot.endTime,
      details: linesSummary_(q, q.expressAmt > 0) + (d.notes ? ' | Notes: ' + d.notes : ''),
      estimate: fmtR_(q.total) + ' (quote ' + q.id + ')',
    }, 'Pending');
    setQuoteFields_(q.id, { 'Status': 'Booked', 'Booking ID': b.id });
    logActivity_('quote', b, 'Client accepted quote ' + q.id + ' (' + fmtR_(q.total) + ') and booked ' + fmtShort_(b.date) + ' ' + timeText_(b));
    notifyAdminNew_(b);
    sendCustomerEmail_(b, 'received');
    return portalBooking_(b);
  } finally {
    lock.releaseLock();
  }
}


/* =====================================================================
 *  BOOKING CORE
 * ===================================================================== */

function createBooking_(d, status, id) {
  const date = parseDate_(d.date);
  if (!date) throw new Error('Invalid date');
  const windows = Object.keys(CONFIG.TIME_WINDOWS);
  const sh = getSheet_();
  const rec = {
    'Booking ID': id || makeId_(),
    'Created': new Date(),
    'Service': normaliseService_(d.service),
    'Name': clean_(d.name),
    'Phone': phoneCell_(d.phone),
    'Email': clean_(d.email),
    'Address': clean_(d.address),
    'Suburb': clean_(d.suburb),
    'Preferred Date': date,
    'Time Window': windows.indexOf(d.timeWindow) >= 0 ? d.timeWindow : windows[0],
    'Details': clean_(d.details),
    'Estimate': clean_(d.estimate),
    'Status': status,
    'Notes': clean_(d.notes),
    'Staff': clean_(d.staff),
    'Start Time': normTime_(d.startTime),
    'End Time': normTime_(d.endTime),
  };
  sh.appendRow(HEADERS.map(h => rec[h] === undefined ? '' : rec[h]));
  const row = sh.getLastRow();
  syncEvent_(sh, row);
  return readRow_(sh, row);
}

// After any admin change: sync calendar, log it, email the customer if needed
function afterChange_(sh, row, before, notify, actor) {
  syncEvent_(sh, row);
  const b = readRow_(sh, row);
  const statusChanged = before.status !== b.status;
  const timeChanged = slotKey_(before) !== slotKey_(b);
  const staffChanged = before.staff !== b.staff;
  const when = fmtShort_(b.date) + ' ' + timeText_(b) + (actor ? ' (' + actor + ')' : '');

  if (statusChanged && b.status === 'Confirmed') {
    sh.getRange(row, C['Reminder Sent']).setValue('');
    if (notify) sendCustomerEmail_(b, 'confirmed');
    logActivity_('confirmed', b, 'Confirmed: ' + jobLabel_(b) + ' on ' + when + (b.staff ? ' — ' + b.staff : ''));
  } else if (statusChanged && b.status === 'Cancelled') {
    if (notify) sendCustomerEmail_(b, 'cancelled');
    logActivity_('cancelled', b, 'Cancelled: ' + jobLabel_(b) + ' on ' + when);
  } else if (statusChanged && b.status === 'Completed') {
    logActivity_('completed', b, 'Completed: ' + jobLabel_(b) + (b.staff ? ' by ' + b.staff : ''));
  } else if (statusChanged) {
    logActivity_('updated', b, 'Status changed to ' + b.status);
  } else if (timeChanged) {
    if (b.status === 'Confirmed') {
      sh.getRange(row, C['Reminder Sent']).setValue('');
      if (notify) sendCustomerEmail_(b, 'rescheduled');
    }
    logActivity_('rescheduled', b, 'Rescheduled to ' + when + (staffChanged ? ' — ' + (b.staff || 'Unassigned') : ''));
  }
  if (staffChanged && !timeChanged) {
    logActivity_('assigned', b, (b.staff ? 'Assigned to ' + b.staff : 'Unassigned') + ': ' + jobLabel_(b) + ' on ' + when);
  }
  return readRow_(sh, row);
}

function slotKey_(b) {
  const t = getTimes_(b);
  return t ? t.start.getTime() + '-' + t.end.getTime() : '';
}


/* =====================================================================
 *  SHEET EDITS -> CALENDAR + CUSTOMER EMAILS
 * ===================================================================== */

function handleEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== CONFIG.SHEET_NAME) return;

  const r0 = e.range.getRow(), r1 = e.range.getLastRow();
  const c0 = e.range.getColumn(), c1 = e.range.getLastColumn();
  const touches = h => C[h] >= c0 && C[h] <= c1;

  const watched = ['Service', 'Name', 'Phone', 'Address', 'Suburb', 'Preferred Date',
    'Time Window', 'Details', 'Status', 'Staff', 'Start Time', 'End Time', 'Notes'];
  if (!watched.some(touches)) return;

  const singleCell = r0 === r1 && c0 === c1;   // emails only on single-cell edits (avoids mass emails on paste)
  const statusEdited = touches('Status');
  const timeEdited = touches('Preferred Date') || touches('Time Window') || touches('Start Time') || touches('End Time');

  for (let row = Math.max(2, r0); row <= r1; row++) {
    syncEvent_(sh, row);
    if (!singleCell) continue;

    const b = readRow_(sh, row);
    if (statusEdited && b.status !== e.oldValue) {
      if (b.status === 'Confirmed') {
        sh.getRange(row, C['Reminder Sent']).setValue('');
        sendCustomerEmail_(b, 'confirmed');
      } else if (b.status === 'Cancelled') {
        sendCustomerEmail_(b, 'cancelled');
      }
      logActivity_(b.status === 'Confirmed' ? 'confirmed' : b.status === 'Cancelled' ? 'cancelled' :
        b.status === 'Completed' ? 'completed' : 'updated', b, b.status + ' (edited in sheet): ' + jobLabel_(b) + ' on ' + fmtShort_(b.date));
    } else if (timeEdited && b.status === 'Confirmed') {
      sh.getRange(row, C['Reminder Sent']).setValue('');
      sendCustomerEmail_(b, 'rescheduled');
      logActivity_('rescheduled', b, 'Rescheduled (edited in sheet) to ' + fmtShort_(b.date) + ' ' + timeText_(b));
    } else if (touches('Staff')) {
      logActivity_('assigned', b, (b.staff ? 'Assigned to ' + b.staff : 'Unassigned') + ' (edited in sheet)');
    }
  }
}

function syncAll() {
  const sh = getSheet_();
  for (let row = 2; row <= sh.getLastRow(); row++) syncEvent_(sh, row);
  SpreadsheetApp.getActive().toast('All bookings synced to the calendar.', 'Starhome', 5);
}


/* =====================================================================
 *  ACTIVITY LOG / NOTIFICATIONS
 * ===================================================================== */

function getLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    styleHeader_(sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]));
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150); sh.setColumnWidth(5, 520);
    sh.getRange('A:A').setNumberFormat('dd mmm yyyy hh:mm');
  }
  return sh;
}

// Newest entries go to the top (row 2)
function logActivity_(type, b, message) {
  try {
    const sh = getLogSheet_();
    sh.insertRowBefore(2);
    sh.getRange(2, 1, 1, LOG_HEADERS.length).setValues([[
      new Date(), type, b ? b.id : '', b ? b.name : '', String(message || '').slice(0, 500),
    ]]);
    const extra = sh.getLastRow() - 1 - CONFIG.LOG_KEEP_ROWS;
    if (extra > 0) sh.deleteRows(CONFIG.LOG_KEEP_ROWS + 2, extra);
  } catch (err) {
    console.warn('Activity log skipped: ' + err);
  }
}

function notifSeen_() {
  return Number(PropertiesService.getScriptProperties().getProperty('NOTIF_SEEN') || 0);
}

function notifSummary_() {
  const seen = notifSeen_();
  const sh = getLogSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { unread: 0, latest: null };
  const rows = sh.getRange(2, 1, Math.min(last - 1, 100), LOG_HEADERS.length).getValues();
  let unread = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] instanceof Date && rows[i][0].getTime() > seen) unread++; else break;
  }
  const r = rows[0];
  return {
    unread: unread,
    latest: r[0] instanceof Date ? { time: r[0].toISOString(), type: String(r[1]), message: String(r[4]), name: String(r[3]) } : null,
  };
}


/* =====================================================================
 *  GOOGLE CALENDAR
 * ===================================================================== */

function getCalendar_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CALENDAR_ID');
  let cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) {
    const found = CalendarApp.getCalendarsByName(CONFIG.CALENDAR_NAME);
    cal = found.length ? found[0]
      : CalendarApp.createCalendar(CONFIG.CALENDAR_NAME, { timeZone: TZ, color: CalendarApp.Color.BLUE });
    props.setProperty('CALENDAR_ID', cal.getId());
  }
  return cal;
}

function syncEvent_(sh, row) {
  const b = readRow_(sh, row);
  if (!b.id) return;

  const cal = getCalendar_();
  let ev = null;
  if (b.eventId) {
    try { ev = cal.getEventById(b.eventId); } catch (_) { ev = null; }
  }

  if (b.status === 'Cancelled') {
    if (ev) ev.deleteEvent();
    sh.getRange(row, C['Event ID']).setValue('');
    return;
  }

  const t = getTimes_(b);
  if (!t) return;

  const title = eventTitle_(b);
  const desc = eventDescription_(b);
  const loc = fullAddress_(b);

  if (ev) {
    ev.setTitle(title);
    ev.setTime(t.start, t.end);
    ev.setDescription(desc);
    ev.setLocation(loc);
  } else {
    ev = cal.createEvent(title, t.start, t.end, { description: desc, location: loc });
    sh.getRange(row, C['Event ID']).setValue(ev.getId());
  }
  ev.setColor(eventColor_(b));
  syncGuests_(ev, b);
}

// Assigned staff member (if they have an email in the Staff tab) is added as a guest
function syncGuests_(ev, b) {
  try {
    const staff = getStaff_();
    const want = ((staff.filter(s => s.name === b.staff)[0] || {}).email || '').toLowerCase();
    const staffEmails = staff.map(s => s.email.toLowerCase()).filter(Boolean);
    ev.getGuestList().forEach(g => {
      const em = g.getEmail().toLowerCase();
      if (staffEmails.indexOf(em) >= 0 && em !== want) ev.removeGuest(g.getEmail());
    });
    if (want && !ev.getGuestList().some(g => g.getEmail().toLowerCase() === want)) ev.addGuest(want);
  } catch (err) {
    console.warn('Guest sync skipped: ' + err);
  }
}

function eventTitle_(b) {
  const prefix = b.status === 'Pending' ? '⏳ PENDING – ' : b.status === 'Completed' ? '✔ ' : '';
  const icon = b.service === 'Laundry' ? '🧺 Laundry pickup' : '🧹 Cleaning';
  return prefix + icon + ' – ' + b.name + (b.suburb ? ' (' + b.suburb + ')' : '') + (b.staff ? ' · ' + b.staff : '');
}

function eventDescription_(b) {
  return [
    'Booking ID: ' + b.id,
    'Status: ' + b.status,
    b.staff ? 'Assigned to: ' + b.staff : 'Assigned to: (unassigned)',
    'Customer: ' + b.name,
    'Phone: ' + b.phone,
    b.email ? 'Email: ' + b.email : '',
    'Address: ' + fullAddress_(b),
    b.details ? 'Details: ' + b.details : '',
    b.estimate ? 'Estimate: ' + b.estimate : '',
    b.notes ? 'Notes: ' + b.notes : '',
    '',
    'WhatsApp customer: ' + waLink_(b.phone, 'Hi ' + b.name + ', this is ' + CONFIG.BUSINESS_NAME + ' about your booking ' + b.id + '.'),
  ].filter(Boolean).join('\n');
}

function eventColor_(b) {
  if (b.status === 'Pending') return CalendarApp.EventColor.GRAY;
  return b.service === 'Laundry' ? CalendarApp.EventColor.GREEN : CalendarApp.EventColor.BLUE;
}


/* =====================================================================
 *  REMINDERS & DIGEST
 * ===================================================================== */

function sendReminders() {
  const sh = getSheet_();
  const now = Date.now();
  const horizon = now + CONFIG.REMINDER_HOURS_BEFORE * 3600 * 1000;

  readAll_().forEach(b => {
    if (b.status !== 'Confirmed' || !isEmail_(b.email) || b.reminderSent) return;
    const t = getTimes_(b);
    if (!t) return;
    const s = t.start.getTime();
    if (s > now && s <= horizon) {
      sendCustomerEmail_(b, 'reminder');
      sh.getRange(b.row, C['Reminder Sent']).setValue(new Date());
      logActivity_('reminder', b, 'Reminder emailed for ' + fmtShort_(b.date) + ' ' + timeText_(b));
    }
  });
}

function dailyDigest() {
  const rows = readAll_().filter(b => b.date instanceof Date);
  const today = ymd_(new Date());
  const tomorrow = ymd_(new Date(Date.now() + 86400000));
  const active = b => b.status === 'Pending' || b.status === 'Confirmed';
  const byTime = (a, b) => getTimes_(a).start - getTimes_(b).start;

  const todays = rows.filter(b => active(b) && ymd_(b.date) === today).sort(byTime);
  const tomorrows = rows.filter(b => active(b) && ymd_(b.date) === tomorrow).sort(byTime);
  const pending = rows.filter(b => b.status === 'Pending' && ymd_(b.date) >= today).sort(byTime);

  const table = (list) => !list.length ? '<p style="color:#666">None.</p>' :
    '<table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px">' +
    '<tr style="background:#0b5394;color:#fff"><th align="left">When</th><th align="left">Service</th><th align="left">Customer</th><th align="left">Area</th><th align="left">Status</th></tr>' +
    list.map(b => {
      const t = getTimes_(b);
      return '<tr style="border-bottom:1px solid #ddd">' +
        '<td>' + esc_(fmtShort_(b.date)) + '<br><small>' + esc_(hm_(t.start) + '–' + hm_(t.end)) + '</small></td>' +
        '<td>' + esc_(b.service) + '<br><small>' + esc_(b.staff || 'Unassigned') + '</small></td>' +
        '<td>' + esc_(b.name) + '<br><small><a href="tel:' + esc_(b.phone) + '">' + esc_(b.phone) + '</a> · ' +
          '<a href="' + waLink_(b.phone, 'Hi ' + b.name + ', this is ' + CONFIG.BUSINESS_NAME + ' about your booking ' + b.id + '.') + '">WhatsApp</a></small></td>' +
        '<td>' + esc_(b.suburb || b.address) + '</td>' +
        '<td>' + esc_(b.status) + '</td></tr>';
    }).join('') + '</table>';

  const adminLink = adminUrl_();
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:720px">' +
    '<h2 style="color:#0b5394">' + esc_(CONFIG.BUSINESS_NAME) + ' — Daily jobs</h2>' +
    '<h3>Today · ' + esc_(fmtDate_(new Date())) + ' (' + todays.length + ')</h3>' + table(todays) +
    '<h3>Tomorrow (' + tomorrows.length + ')</h3>' + table(tomorrows) +
    '<h3 style="color:#b45f06">Waiting for your confirmation (' + pending.length + ')</h3>' + table(pending) +
    '<p>' + (adminLink ? '<a href="' + adminLink + '">Open the admin app</a> · ' : '') +
    '<a href="' + SpreadsheetApp.getActiveSpreadsheet().getUrl() + '">Open the bookings sheet</a></p></div>';

  MailApp.sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: 'Starhome jobs: ' + todays.length + ' today, ' + tomorrows.length + ' tomorrow, ' + pending.length + ' pending',
    htmlBody: html,
    name: CONFIG.BUSINESS_NAME,
  });
}


/* =====================================================================
 *  EMAILS
 * ===================================================================== */

function notifyAdminNew_(b) {
  const adminLink = adminUrl_();
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:640px">' +
    '<h2 style="color:#0b5394">New booking request — ' + esc_(b.service) + '</h2>' +
    summaryTable_(b) +
    '<p><a href="' + waLink_(b.phone, 'Hi ' + b.name + ', thank you for booking with ' + CONFIG.BUSINESS_NAME + '. ') + '">WhatsApp the customer</a>' +
    (adminLink ? ' · <a href="' + adminLink + '">Open admin app</a>' : '') +
    ' · <a href="' + SpreadsheetApp.getActiveSpreadsheet().getUrl() + '">Open bookings sheet</a></p>' +
    '<p style="color:#666">To confirm: open the admin app, assign a staff member and time, then press <b>Confirm</b>. The customer is emailed automatically.</p></div>';

  MailApp.sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: 'New ' + b.service + ' booking: ' + b.name + ' – ' + fmtShort_(b.date),
    htmlBody: html,
    name: CONFIG.BUSINESS_NAME,
    replyTo: isEmail_(b.email) ? b.email : CONFIG.ADMIN_EMAIL,
  });
}

function sendCustomerEmail_(b, type) {
  if (!isEmail_(b.email)) return;
  const job = b.service === 'Laundry' ? 'laundry pickup' : 'home cleaning';
  const when = fmtDate_(b.date) + ', ' + timeText_(b);
  const T = {
    received: {
      subject: 'We\'ve received your booking request – ' + b.id,
      heading: 'Thank you, ' + b.name + '!',
      body: 'We\'ve received your ' + job + ' request for <b>' + esc_(when) + '</b>. ' +
            'Our team will confirm your booking shortly by email or WhatsApp.',
    },
    confirmed: {
      subject: 'Your Starhome booking is confirmed – ' + fmtShort_(b.date),
      heading: 'Your booking is confirmed ✅',
      body: 'Great news, ' + esc_(b.name) + ' — your ' + job + ' is confirmed for <b>' + esc_(when) + '</b>. ' +
            'We\'ll send you a reminder the day before.',
    },
    reminder: {
      subject: 'Reminder: your Starhome ' + job + ' is coming up – ' + fmtShort_(b.date),
      heading: 'See you soon!',
      body: 'This is a friendly reminder that your ' + job + ' is booked for <b>' + esc_(when) + '</b>. ' +
            (b.service === 'Laundry'
              ? 'Please have your laundry bagged and ready for collection.'
              : 'Please make sure we can access the property at the scheduled time.'),
    },
    rescheduled: {
      subject: 'Your Starhome booking has been updated – ' + fmtShort_(b.date),
      heading: 'Booking updated',
      body: 'Your ' + job + ' has been moved to <b>' + esc_(when) + '</b>. ' +
            'If this time doesn\'t suit you, please let us know.',
    },
    cancelled: {
      subject: 'Your Starhome booking has been cancelled – ' + b.id,
      heading: 'Booking cancelled',
      body: 'Your ' + job + ' booked for ' + esc_(when) + ' has been cancelled. ' +
            'If this is a mistake or you\'d like to rebook, just reply to this email or WhatsApp us.',
    },
  }[type];
  if (!T) return;

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden">' +
    '<div style="background:#0b5394;color:#fff;padding:18px 22px;font-size:20px;font-weight:bold">' + esc_(CONFIG.BUSINESS_NAME) + '</div>' +
    '<div style="padding:22px">' +
    '<h2 style="margin-top:0;color:#0b5394">' + esc_(T.heading) + '</h2>' +
    '<p style="font-size:15px;line-height:1.5">' + T.body + '</p>' +
    summaryTable_(b) +
    (cleanKind_(b) && (type === 'received' || type === 'confirmed') ? cleanSneakPeek_(b, cleanKind_(b)) + cleanChecklistHtml_(b, cleanKind_(b)) : '') +
    '<p style="font-size:14px">Questions? Call <b>' + CONFIG.PHONE + '</b> or WhatsApp <b>' + CONFIG.WHATSAPP + '</b>.</p>' +
    '</div>' +
    '<div style="background:#f5f7fa;padding:12px 22px;font-size:12px;color:#777">' +
    '<a href="' + CONFIG.WEBSITE + '">' + CONFIG.WEBSITE.replace('https://', '') + '</a> · Booking ref ' + esc_(b.id) +
    '</div></div>';

  MailApp.sendEmail({
    to: b.email,
    subject: T.subject,
    htmlBody: html,
    name: CONFIG.BUSINESS_NAME,
    replyTo: CONFIG.ADMIN_EMAIL,
  });
}

/* ---------- Cleaning bookings: "what's included" checklist + price sneak peek ---------- */
const CLEAN_CHECKLISTS = {
  standard: [
    ['Kitchen', ['Emptying trash cans/bins', 'Clean counter tops, sinks and cupboards', 'Clean stove, microwave & fridge', 'Wiping tables and chairs', 'Washing dishes', 'Wiping floors & cleaning windows']],
    ['Living area', ['Cleaning electronic gadgets', 'Cleaning wall electrical switches', 'Cleaning furniture & wall frames', 'Vacuum & mop floor surfaces', 'Clean interior windows', 'Dusting sofas']],
    ['Bathroom', ['Clean counters & cabinets', 'Wiping & shining mirrors', 'Clean & disinfect toilet seats', 'Clean & disinfect shower & bathtub', 'Clean interior windows & sills', 'Mopping floors & empty bins']],
    ['Bedroom', ['Vacuum carpets or mop floors', 'Make beds', 'Fold clothes', 'Cleaning and dusting furniture', 'Clean interior windows', 'Arrange wardrobe on request']],
  ],
  deep: [
    ['Kitchen', ['Emptying trash cans/bins', 'Clean counter tops, sinks and cupboards', 'Clean stove, microwave & fridge', 'Wiping tables and chairs', 'Washing dishes', 'Scrubbing floors & cleaning windows']],
    ['Living area', ['Cleaning electronic gadgets', 'Cleaning wall electrical switches', 'Cleaning furniture & wall frames', 'Vacuum & scrubbing floor surfaces', 'Clean interior & exterior windows']],
    ['Bathroom', ['Clean counters & cabinets', 'Wiping & shining mirrors', 'Clean & disinfect toilet seats', 'Clean & disinfect shower & bathtub', 'Clean interior windows & sills', 'Scrubbing floors & empty bins']],
    ['Bedroom', ['Vacuum carpets or mop floors', 'Make beds', 'Fold clothes', 'Clean interior & exterior windows']],
  ],
  moving: [
    ['Loading', ['Careful loading of furniture, boxes & appliances', 'Furniture wrapped & protected with blankets', 'Heavy and bulky items handled by our team']],
    ['Transport', ['Vehicle sized to your move', 'Direct trip from pickup to drop-off', 'Items strapped & secured for the trip']],
    ['Offloading', ['Offloading into the rooms you choose', 'Furniture placed where you want it', 'Basic bed re-assembly on request']],
  ],
  care: [
    ['Personal care', ['Help with bathing, dressing & grooming', 'Toileting & hygiene support', 'Help with walking, mobility & transfers']],
    ['Daily living', ['Preparing light, healthy meals', 'Help with eating if needed', 'Light tidying of the client\'s room', 'Washing the client\'s clothes & bedding']],
    ['Wellbeing', ['Medication reminders (as prescribed)', 'Companionship, conversation & activities', 'Updates to the family on how the day went']],
    ['Elderly & special needs', ['Patient, respectful support adapted to each person', 'Day or night shifts (night shift +15%)']],
  ],
};
const SERVICE_TITLES = { standard: 'General Cleaning', deep: 'Deep Cleaning', moving: 'Moving', care: 'Care Giving' };
const KIND_NOTES = {
  moving: 'Please note: please pack and label your boxes before moving day. Extra stops, stairs or long carries, and extra trips may be charged extra.',
  care: 'Please note: our caregivers do not perform medical or nursing procedures. Please share any care plan, allergies and emergency contacts before the first visit.',
};
const CARPET_NOTE = 'Please note: carpets are vacuumed normally. Professional wet & dry carpet deep cleaning is charged extra.';

// 'deep', 'standard' (general cleaning), 'moving', 'care' or '' (laundry…)
function cleanKind_(b) {
  if (!b || b.service === 'Laundry') return '';
  const t = String(b.details || '') + ' ' + String(b.notes || '');
  if (/deep/i.test(t)) return 'deep';
  if (/standard|general clean/i.test(t)) return 'standard';
  if (/moving|move size/i.test(t)) return 'moving';
  if (/care ?giv|elderly|special needs|care \d+h/i.test(t)) return 'care';
  return '';
}

// Booking details without internal price lines, e.g. "3 bed, 2 bath · Weekly · Extras: Oven cleaning x1"
function publicDetails_(b) {
  return String(b.details || '').split('|').map(p => p.trim())
    .filter(p => p && !/^((deep|standard) clean(ing)?|moving|care giving)$/i.test(p) && !/R\s?\d/.test(p) && !/^notes:/i.test(p))
    .join(' · ');
}

function cleanSneakPeek_(b, kind) {
  const title = (SERVICE_TITLES[kind] || 'Cleaning').toUpperCase();
  const price = String(b.estimate || '').replace(/\s*\(.*\)\s*$/, '') || 'Confirmed on assessment';
  const det = publicDetails_(b);
  const wa = 'https://wa.me/27' + String(CONFIG.WHATSAPP).replace(/\D/g, '').replace(/^0/, '');
  return '<div style="background:#14213d;background:linear-gradient(135deg,#14213d,#0b5394);border-radius:14px;padding:22px;margin:18px 0;color:#fff">' +
    '<div style="font-size:12px;letter-spacing:1px;opacity:.8">YOUR ' + title + ' · SNEAK PEEK</div>' +
    '<div style="background:#fff;color:#14213d;border-radius:12px;padding:18px;margin-top:10px">' +
      '<div style="color:#0b5394;font-weight:bold;font-size:14px">' + title + '</div>' +
      (det ? '<div style="font-size:15px;margin-top:6px">' + esc_(det) + '</div>' : '') +
      '<div style="color:#6b7280;font-size:13px;margin-top:14px">Estimated total</div>' +
      '<div style="font-size:40px;font-weight:bold;line-height:1.1">' + esc_(price) + '</div>' +
      '<div style="color:#6b7280;font-size:12px;margin-top:8px">Final price confirmed on the day.</div>' +
    '</div>' +
    '<div style="margin-top:14px">' +
      '<a href="' + CONFIG.WEBSITE + '/book.html" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:20px;margin:4px 6px 0 0">Book again</a>' +
      '<a href="' + wa + '" style="display:inline-block;background:#fff;color:#14213d;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:20px;margin:4px 0 0">WhatsApp ' + esc_(CONFIG.WHATSAPP) + '</a>' +
    '</div></div>';
}

function cleanChecklistHtml_(b, kind) {
  const list = CLEAN_CHECKLISTS[kind] || CLEAN_CHECKLISTS.standard;
  const ownSupplies = !/detergent/i.test(String(b.details || ''));
  return '<h3 style="color:#0b5394;margin:22px 0 6px">' + (SERVICE_TITLES[kind] || 'General Cleaning') + ' — what\'s included</h3>' +
    '<table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px"><tr>' +
    list.map(([room, items], i) =>
      (i === 2 ? '</tr><tr>' : '') +
      '<td valign="top" style="width:50%;padding:6px 10px 10px 0"><b>' + esc_(room) + '</b>' +
      '<ul style="margin:4px 0 0;padding-left:18px;line-height:1.5">' + items.map(t => '<li>' + esc_(t) + '</li>').join('') + '</ul></td>').join('') +
    '</tr></table>' +
    '<p style="font-size:13px;background:#fff8e1;border-radius:8px;padding:10px 12px;margin:10px 0">' + esc_(KIND_NOTES[kind] || CARPET_NOTE) +
      (kind === 'standard' ? '<br><br><b>NB:</b> For general cleaning we use your cleaning brooms, mops' + (ownSupplies ? ' and detergents.' : ' (detergents supplied by us).') : '') + '</p>' +
    '<p style="font-size:14px;line-height:1.5">We hope all is in order. Please feel free to contact us if you need any clarification.<br><br>Regards<br><b>Starhome Cleaners Team</b></p>';
}

function summaryTable_(b) {
  const rows = [
    ['Booking ref', b.id],
    ['Service', b.service === 'Laundry' ? 'Laundry pickup & delivery' : 'Home cleaning'],
    ['Date', fmtDate_(b.date)],
    ['Time', timeText_(b)],
    ['Address', fullAddress_(b)],
    ['Phone', b.phone],
    ['Details', b.details],
    ['Estimate', b.estimate],
  ].filter(r => r[1]);
  return '<table cellpadding="6" style="border-collapse:collapse;font-size:14px;margin:12px 0">' +
    rows.map(r => '<tr><td style="color:#666;padding-right:14px">' + esc_(r[0]) + '</td><td><b>' + esc_(r[1]) + '</b></td></tr>').join('') +
    '</table>';
}


/* =====================================================================
 *  TEST HELPER
 * ===================================================================== */

function addTestBooking() {
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), TZ, 'yyyy-MM-dd');
  const res = doPost({ postData: { contents: JSON.stringify({
    service: 'Cleaning', name: 'Test Customer', phone: '0652992030',
    email: CONFIG.ADMIN_EMAIL, address: '1 Test Street', suburb: 'Rosettenville',
    date: tomorrow, timeWindow: Object.keys(CONFIG.TIME_WINDOWS)[0],
    details: '2 bedrooms, 1 bathroom', estimate: 'R —',
  }) } });
  SpreadsheetApp.getActive().toast(res.getContent(), 'Test booking', 8);
}


/* =====================================================================
 *  DATA HELPERS
 * ===================================================================== */

function getSheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) throw new Error('Sheet "' + CONFIG.SHEET_NAME + '" not found — run setup() first.');
  return sh;
}

function getStaffSheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.STAFF_SHEET_NAME);
  if (!sh) throw new Error('Sheet "' + CONFIG.STAFF_SHEET_NAME + '" not found — run setup() first.');
  return sh;
}

let STAFF_CACHE_ = null;
function getStaff_() {
  if (STAFF_CACHE_) return STAFF_CACHE_;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.STAFF_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return (STAFF_CACHE_ = []);
  const rng = sh.getRange(2, 1, sh.getLastRow() - 1, STAFF_HEADERS.length);
  const dv = rng.getDisplayValues();
  STAFF_CACHE_ = rng.getValues()
    .map((r, i) => ({ r: r, d: dv[i] }))
    .filter(x => String(x.r[0]).trim())
    .map(x => ({
      name: String(x.r[0]).trim(),
      role: String(x.r[1] || ''),
      colour: /^#[0-9a-f]{3,8}$/i.test(String(x.r[2]).trim()) ? String(x.r[2]).trim() : '#64748b',
      email: isEmail_(x.r[3]) ? String(x.r[3]).trim() : '',
      active: x.r[4] === true || x.r[4] === '' || /^(yes|y|true|1)$/i.test(String(x.r[4])),
      phone: String(x.d[5] || '').trim(),
    }));
  return STAFF_CACHE_;
}

function readAll_() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rng = sh.getRange(2, 1, last - 1, HEADERS.length);
  const v = rng.getValues(), dv = rng.getDisplayValues();
  return v.map((row, i) => toBooking_(row, i + 2, dv[i])).filter(b => b.id);
}

function readRow_(sh, row) {
  const rng = sh.getRange(row, 1, 1, HEADERS.length);
  return toBooking_(rng.getValues()[0], row, rng.getDisplayValues()[0]);
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, C['Booking ID'], last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function toBooking_(v, row, dv) {
  const g = h => v[C[h] - 1];
  const gd = h => dv ? dv[C[h] - 1] : g(h);
  return {
    row: row,
    id: String(g('Booking ID') || ''),
    service: String(g('Service') || 'Cleaning'),
    name: String(g('Name') || ''),
    phone: String(gd('Phone') || ''),
    email: String(g('Email') || '').trim(),
    address: String(g('Address') || ''),
    suburb: String(g('Suburb') || ''),
    date: g('Preferred Date'),
    window: String(g('Time Window') || Object.keys(CONFIG.TIME_WINDOWS)[0]),
    details: String(g('Details') || ''),
    estimate: String(g('Estimate') || ''),
    status: String(g('Status') || 'Pending'),
    eventId: String(g('Event ID') || ''),
    reminderSent: g('Reminder Sent'),
    notes: String(g('Notes') || ''),
    staff: String(g('Staff') || '').trim(),
    startTime: normTime_(gd('Start Time')),
    endTime: normTime_(gd('End Time')),
  };
}

// Shape sent to the admin page (no Date objects — google.script.run can't return them)
function toClient_(b) {
  const t = getTimes_(b);
  return {
    id: b.id, service: b.service, name: b.name, phone: b.phone, email: b.email,
    address: b.address, suburb: b.suburb, details: b.details, estimate: b.estimate,
    status: b.status, staff: b.staff, notes: b.notes, timeWindow: b.window,
    date: b.date instanceof Date ? ymd_(b.date) : '',
    start: t ? hm_(t.start) : '', end: t ? hm_(t.end) : '',
    startTime: b.startTime, endTime: b.endTime,
    reminderSent: !!b.reminderSent,
  };
}

// Exact Start/End Time wins; otherwise the customer's requested window
function getTimes_(b) {
  if (!(b.date instanceof Date)) return null;
  const w = CONFIG.TIME_WINDOWS[b.window] || CONFIG.TIME_WINDOWS[Object.keys(CONFIG.TIME_WINDOWS)[0]];
  const st = normTime_(b.startTime), en = normTime_(b.endTime);
  const start = st ? atTime_(b.date, st) : atHour_(b.date, w[0]);
  let end = en ? atTime_(b.date, en)
    : st ? new Date(start.getTime() + (w[1] - w[0]) * 3600000)
    : atHour_(b.date, w[1]);
  if (end <= start) end = new Date(start.getTime() + 3600000);
  return { start: start, end: end };
}

function timeText_(b) {
  const t = getTimes_(b);
  return (b.startTime && t) ? hm_(t.start) + '–' + hm_(t.end) : b.window;
}

function jobLabel_(b) {
  return (b.service === 'Laundry' ? 'Laundry pickup' : 'Cleaning') + ' for ' + b.name;
}

function atHour_(dateVal, hour) {
  const pad = n => ('0' + n).slice(-2);
  const h = Math.floor(hour), m = Math.round((hour - h) * 60);
  return atTime_(dateVal, pad(h) + ':' + pad(m));
}

function atTime_(dateVal, hhmm) {
  return Utilities.parseDate(ymd_(dateVal) + ' ' + hhmm, TZ, 'yyyy-MM-dd HH:mm');
}

function normTime_(s) {
  if (s instanceof Date) return Utilities.formatDate(s, TZ, 'HH:mm');
  const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return '';
  return ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
}

function parseDate_(s) {
  if (s instanceof Date) return s;
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Utilities.parseDate(m[1] + '-' + m[2] + '-' + m[3], TZ, 'yyyy-M-d');
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // DD/MM/YYYY
  if (m) return Utilities.parseDate(m[3] + '-' + m[2] + '-' + m[1], TZ, 'yyyy-M-d');
  return null;
}

function parseRequest_(e) {
  let body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents); } catch (_) { body = {}; }
  }
  return Object.assign({}, (e && e.parameter) || {}, body);
}

function normaliseService_(s) {
  return /laund|wash|dry/i.test(String(s)) ? 'Laundry' : 'Cleaning';
}

function clean_(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 1000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;   // block spreadsheet formula injection
}

function phoneCell_(v) {
  const s = String(v || '').trim().slice(0, 30);
  return s ? "'" + s : '';                   // keep leading 0 / +27
}

function isEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

function fullAddress_(b) {
  return [b.address, b.suburb].filter(Boolean).join(', ');
}

function waLink_(phone, msg) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.indexOf('0') === 0) d = '27' + d.slice(1);
  return 'https://wa.me/' + d + '?text=' + encodeURIComponent(msg || '');
}

// Keep the website's own booking ref (e.g. SHL-261016-482) when it's well-formed and unused
function validRef_(ref) {
  const r = String(ref || '').trim().toUpperCase();
  if (!/^SH[A-Z]?-\d{6}-[A-Z0-9]{3,5}$/.test(r)) return null;
  return findRow_(getSheet_(), r) ? null : r;
}

function makeId_() {
  return 'SH-' + Utilities.formatDate(new Date(), TZ, 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}

function getAdminKey_() {
  const p = PropertiesService.getScriptProperties();
  let k = p.getProperty('ADMIN_KEY');
  if (!k) { k = Utilities.getUuid().replace(/-/g, ''); p.setProperty('ADMIN_KEY', k); }
  return k;
}

// Admin API guard: a signed-in admin session token, or the private master key
function checkKey_(k) {
  if (k && String(k) === getAdminKey_()) return { type: 'admin', name: 'Owner', role: 'Owner' };
  const s = getSession_(k);
  if (s && s.type === 'admin') return s;
  throw new Error('Not authorised — please sign in again');
}

function appBaseUrl_() {
  let base = CONFIG.WEB_APP_URL;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (_) { base = ''; } }
  return base || '';
}

function adminUrl_() {
  const base = appBaseUrl_();
  return base ? base + '?page=admin&key=' + encodeURIComponent(getAdminKey_()) : '';
}

function ymd_(d) { return Utilities.formatDate(new Date(d), TZ, 'yyyy-MM-dd'); }
function hm_(d) { return Utilities.formatDate(d, TZ, 'HH:mm'); }
function fmtDate_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'EEEE, d MMMM yyyy') : String(d || ''); }
function fmtShort_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'EEE d MMM') : String(d || ''); }

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
