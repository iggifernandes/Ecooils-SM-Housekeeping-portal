/**
 * MENTARI HOUSEKEEPING — Google Apps Script backend
 * Version 1.0.0
 *
 * Paste this whole file into Extensions > Apps Script of the housekeeping Google Sheet.
 * Then use the "Housekeeping" menu in the sheet: Setup, Install triggers.
 * Deploy as Web app: Execute as = Me, Who has access = Anyone.
 */

var APP_VERSION = '1.1.2';
var TZ = 'Asia/Jakarta';
var HK_ROLES_ALL = ['cleaner', 'supervisor', 'admin'];
var HK_ROLES_MGR = ['supervisor', 'admin'];
var CONCERN_CATEGORIES = [
  { id: 'toilet',  en: 'Toilets',              id_: 'Toilet',                ms: 'Tandas' },
  { id: 'waste',   en: 'Waste / Bins',         id_: 'Sampah / Tempat sampah', ms: 'Sampah / Tong sampah' },
  { id: 'spill',   en: 'Spillage',             id_: 'Tumpahan',              ms: 'Tumpahan' },
  { id: 'pest',    en: 'Pest',                 id_: 'Hama',                  ms: 'Perosak' },
  { id: 'walkway', en: 'Walkway obstruction',  id_: 'Jalur terhalang',       ms: 'Laluan terhalang' },
  { id: 'pantry',  en: 'Pantry',               id_: 'Pantri',                ms: 'Pantri' },
  { id: 'supply',  en: 'Supplies',             id_: 'Perlengkapan',          ms: 'Bekalan' },
  { id: 'action',  en: 'Needs action (inspection)', id_: 'Perlu tindakan (inspeksi)', ms: 'Perlu tindakan (pemeriksaan)' },
  { id: 'other',   en: 'Other',                id_: 'Lainnya',               ms: 'Lain-lain' }
];

var SCHEMA = {
  Config:      ['key', 'value', 'note'],
  Rounds:      ['roundId', 'nameEn', 'nameId', 'nameMs', 'start', 'end', 'template'],
  Rooms:       ['roomId', 'key', 'nameEn', 'nameId', 'nameMs', 'location', 'type', 'rounds', 'days', 'checklists', 'photoRequired', 'active'],
  Checklists:  ['template', 'itemId', 'order', 'type', 'en', 'id', 'ms', 'days', 'rounds'],
  Users:       ['userId', 'name', 'initials', 'role', 'pinHash', 'salt', 'active'],
  Inspections: ['insId', 'ts', 'date', 'roomId', 'roundId', 'userId', 'userName', 'durationSec', 'windowStatus', 'counts', 'photoId', 'note', 'startedTs', 'itemsJson'],
  Concerns:    ['ref', 'ts', 'roomId', 'category', 'text', 'reporter', 'photoId', 'source', 'status', 'updatedTs', 'closedTs', 'afterPhotoId', 'closeNote', 'itemKey', 'handledBy'],
  Inventory:   ['itemId', 'group', 'category', 'nameId', 'nameEn', 'qty', 'unit', 'note'],
  Holidays:    ['date', 'name'],
  Alerts:      ['key', 'ts']
};
var INSP_LIGHT_COLS = 13; // everything except itemsJson

var CFG_DEFAULTS = [
  ['OFFICE_EMAILS', '', 'Housekeeping office staff emails, comma separated. New concerns, missed rounds and the daily summary are emailed here.'],
  ['REMINDER_EMAILS', '', 'Optional. Cleaner Gmail addresses that get a reminder email when a round starts.'],
  ['APP_URL', '', 'Your app address, e.g. https://iggifernandes.github.io/mentari-housekeeping/ (used for links in emails)'],
  ['PHOTO_FOLDER_ID', '', 'Optional. ID of an existing Drive folder for inspection and concern photos (the part of the folder link after /folders/). Empty = the script creates its own folder.'],
  ['MAIL_FROM', '', 'Optional. The housekeeping Gmail address emails should appear to come from. It must first be added in the script owner Gmail under Settings > Accounts > Send mail as. If empty or it fails, emails come from the script owner.'],
  ['HK_PHONE', '', 'Housekeeping office phone for the Call button (example +6281234567890)'],
  ['HK_WHATSAPP', '', 'Housekeeping office WhatsApp number (leave empty to use HK_PHONE)'],
  ['HR_PHONE', '', 'HR phone, shown as Escalate to HR'],
  ['HR_WHATSAPP', '', 'HR WhatsApp number (leave empty to use HR_PHONE)'],
  ['MIN_DWELL_SEC', '60', 'Minimum seconds between scanning the room QR and submitting the checklist'],
  ['EARLY_MIN', '20', 'A scan up to this many minutes before a round starts is accepted'],
  ['LATE_MAX_MIN', '120', 'A scan up to this many minutes after a round ended still counts as Late; after that it is an extra check'],
  ['GRACE_MIN', '15', 'Minutes after a round ends before a missed-round alert is emailed'],
  ['REQUIRE_AFTER_PHOTO', 'TRUE', 'TRUE = a concern can only be closed with an after photo'],
  ['PUBLIC_NAME_MODE', 'initials', 'What the public room record shows for who inspected: name | initials | none'],
  ['PUBLIC_MONTHS_BACK', '3', 'How many past months the public room record shows (staff see all)'],
  ['TOKEN_HOURS', '12', 'Hours a staff login stays valid'],
  ['DAILY_SUMMARY_HOUR', '18', 'Hour (0-23, Jakarta time) when the daily summary email is sent']
];

/* ============================ small helpers ============================ */

function now_() { return new Date(); }
function fmt_(d, p) { return Utilities.formatDate(d, TZ, p); }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function toMin_(hm) { var p = String(hm).split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }
function stamp_(d) { return fmt_(d || now_(), 'yyyy-MM-dd HH:mm:ss'); }
function parseLocal_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 7 * 3600 * 1000;
}
function dowOf_(dateStr) {
  var p = dateStr.split('-');
  var w = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  return w === 0 ? 7 : w;
}
function bool_(v) {
  if (v === true) return true;
  var s = String(v).toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}
function txt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}
function hm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  var s = String(v === null || v === undefined ? '' : v).trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? pad2_(+m[1]) + ':' + m[2] : s;
}
function list_(v) { return String(v || '').split(/[,+;]/).map(function (x) { return x.trim(); }).filter(Boolean); }
function parseDays_(s) {
  var out = {};
  String(s || '').split(',').forEach(function (p) {
    p = p.trim();
    if (!p) return;
    var m = p.match(/^(\d)-(\d)$/);
    if (m) { for (var i = +m[1]; i <= +m[2]; i++) out[i] = 1; }
    else if (/^\d$/.test(p)) out[+p] = 1;
  });
  return out;
}
function initials_(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 3).map(function (p) { return p.charAt(0).toUpperCase(); }).join('');
}
function log_(m) { try { Logger.log(m); } catch (e) {} try { console.log(m); } catch (e2) {} }
function fail_(code, message) { throw { hk: true, code: code, message: message || code }; }
function sleepRand_() { return Utilities.getUuid().replace(/-/g, ''); }
function props_() { return PropertiesService.getScriptProperties(); }

/* ============================ sheet access ============================ */

function ss_() {
  var id = props_().getProperty('SSID');
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) fail_('setup', 'Sheet "' + name + '" is missing. Run Housekeeping > Setup.');
  return sh;
}
function table_(name, ncols) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var cols = ncols || SCHEMA[name].length;
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, cols).getValues();
  var h = SCHEMA[name];
  return vals.map(function (r) {
    var o = {};
    for (var i = 0; i < cols; i++) o[h[i]] = r[i];
    return o;
  });
}
function safeText_(v) {
  var s = v === undefined || v === null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function appendRow_(name, obj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(name);
    var h = SCHEMA[name];
    var row = sh.getLastRow() + 1;
    var vals = h.map(function (k) { return safeText_(obj[k]); });
    var rng = sh.getRange(row, 1, 1, h.length);
    rng.setNumberFormat('@');
    rng.setValues([vals]);
    return row;
  } finally { lock.releaseLock(); }
}
/** Read one sheet row (2-based) as an object. */
function getRow_(name, row) {
  var h = SCHEMA[name];
  var v = sheet_(name).getRange(row, 1, 1, h.length).getValues()[0];
  var o = {};
  for (var i = 0; i < h.length; i++) o[h[i]] = v[i];
  return o;
}
/** Find the sheet row of the record whose first column equals value (rows are 2-based). */
function findRow_(name, value) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) if (txt_(col[i][0]) === value) return i + 2;
  return 0;
}
function updateCells_(name, row, patch) {
  var sh = sheet_(name);
  var h = SCHEMA[name];
  Object.keys(patch).forEach(function (k) {
    var c = h.indexOf(k) + 1;
    if (c < 1) return;
    var cell = sh.getRange(row, c);
    cell.setNumberFormat('@');
    cell.setValue(safeText_(patch[k]));
  });
}

/* ============================ configuration bundle ============================ */

function loadBundle_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('bundle');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var cfg = {};
  CFG_DEFAULTS.forEach(function (d) { cfg[d[0]] = d[1]; });
  table_('Config').forEach(function (r) { if (r.key !== '') cfg[txt_(r.key)] = txt_(r.value); });

  var roundList = [], rounds = {};
  table_('Rounds').forEach(function (r) {
    if (!r.roundId) return;
    var o = {
      roundId: txt_(r.roundId), nameEn: txt_(r.nameEn), nameId: txt_(r.nameId), nameMs: txt_(r.nameMs),
      start: hm_(r.start), end: hm_(r.end), template: txt_(r.template)
    };
    o.startMin = toMin_(o.start); o.endMin = toMin_(o.end);
    rounds[o.roundId] = o; roundList.push(o);
  });

  var rooms = [], roomMap = {};
  table_('Rooms').forEach(function (r) {
    if (!r.roomId) return;
    var o = {
      roomId: txt_(r.roomId), key: txt_(r.key), nameEn: txt_(r.nameEn), nameId: txt_(r.nameId), nameMs: txt_(r.nameMs) || txt_(r.nameId),
      location: txt_(r.location), type: txt_(r.type), rounds: list_(r.rounds), days: parseDays_(txt_(r.days) || '1-6'),
      checklists: list_(r.checklists), photoRequired: bool_(r.photoRequired),
      active: r.active === '' ? true : bool_(r.active)
    };
    rooms.push(o); roomMap[o.roomId] = o;
  });

  var cl = {};
  table_('Checklists').forEach(function (r) {
    if (!r.template || !r.itemId) return;
    var t = txt_(r.template);
    (cl[t] = cl[t] || []).push({
      itemId: txt_(r.itemId), order: Number(r.order) || 0, type: txt_(r.type) || 'check',
      en: txt_(r.en), id: txt_(r.id), ms: txt_(r.ms) || txt_(r.id),
      days: parseDays_(txt_(r.days)), hasDays: !!txt_(r.days), rounds: list_(r.rounds)
    });
  });
  Object.keys(cl).forEach(function (t) { cl[t].sort(function (a, b) { return a.order - b.order; }); });

  var hol = {};
  table_('Holidays').forEach(function (r) { var d = txt_(r.date); if (d) hol[d] = txt_(r.name) || 'Holiday'; });

  var b = { cfg: cfg, rounds: rounds, roundList: roundList, rooms: rooms, roomMap: roomMap, cl: cl, hol: hol };
  try { cache.put('bundle', JSON.stringify(b), 60); } catch (e2) {}
  return b;
}
function cfgNum_(b, k, d) { var n = Number(b.cfg[k]); return isNaN(n) || b.cfg[k] === '' ? d : n; }

/* ============================ schedule engine ============================ */

function nowInfo_() {
  var n = now_();
  return { ts: n, date: fmt_(n, 'yyyy-MM-dd'), min: toMin_(fmt_(n, 'HH:mm')), stamp: stamp_(n) };
}
/** Rounds that apply to a room on a given date (empty on non-working days and holidays). */
function roundsFor_(b, room, dateStr) {
  if (!room.active) return [];
  if (!room.days[dowOf_(dateStr)] || b.hol[dateStr]) return [];
  return room.rounds.map(function (id) { return b.rounds[id]; }).filter(Boolean)
    .sort(function (a, c) { return a.startMin - c.startMin; });
}
/** Checklist items due for a room, round and date. */
function itemsFor_(b, room, round, dateStr) {
  var templates = round && round.template ? list_(round.template) : room.checklists;
  var dow = dowOf_(dateStr), out = [];
  templates.forEach(function (t) {
    (b.cl[t] || []).forEach(function (it) {
      if (it.hasDays && !it.days[dow]) return;
      if (it.rounds.length && (!round || it.rounds.indexOf(round.roundId) < 0)) return;
      out.push(it);
    });
  });
  return out;
}
function inspLight_(sinceDate) {
  var rows = table_('Inspections', INSP_LIGHT_COLS);
  return rows.filter(function (r) { return !sinceDate || txt_(r.date) >= sinceDate; });
}
function inspIndex_(rows) {
  var idx = {};
  rows.forEach(function (r) {
    if (txt_(r.roundId) === 'EXTRA') return;
    var k = txt_(r.date) + '|' + txt_(r.roomId) + '|' + txt_(r.roundId);
    if (!idx[k] || txt_(r.ts) < txt_(idx[k].ts)) idx[k] = r;
  });
  return idx;
}
function stateOf_(round, dateStr, rec, tn) {
  if (rec) return txt_(rec.windowStatus) === 'Late' ? 'late' : 'done';
  if (dateStr < tn.date) return 'missed';
  if (dateStr > tn.date) return 'pending';
  if (tn.min > round.endMin) return 'missed';
  if (tn.min >= round.startMin) return 'due';
  return 'pending';
}
function whoLabel_(rec, mode) {
  var n = txt_(rec.userName);
  if (mode === 'none') return '';
  if (mode === 'name') return n;
  return initials_(n);
}

/** Month grid for one room. */
function monthData_(b, room, month, idx, tn, mode) {
  var y = +month.slice(0, 4), m = +month.slice(5, 7);
  var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  var days = [], due = 0, done = 0, late = 0, missed = 0;
  for (var d = 1; d <= dim; d++) {
    var ds = month + '-' + pad2_(d);
    var rs = roundsFor_(b, room, ds), cells = {};
    rs.forEach(function (r) {
      var rec = idx[ds + '|' + room.roomId + '|' + r.roundId];
      var st = stateOf_(r, ds, rec, tn);
      cells[r.roundId] = { s: st, t: rec ? txt_(rec.ts).slice(11, 16) : '', by: rec ? whoLabel_(rec, mode) : '' };
      if (st === 'done' || st === 'late') { done++; due++; if (st === 'late') late++; }
      else if (st === 'missed') { due++; missed++; }
    });
    days.push({ d: d, off: rs.length === 0, holiday: b.hol[ds] || '', cells: cells });
  }
  var roundMeta = room.rounds.map(function (id) { return b.rounds[id]; }).filter(Boolean)
    .sort(function (a, c) { return a.startMin - c.startMin; })
    .map(function (r) { return { roundId: r.roundId, nameEn: r.nameEn, nameId: r.nameId, nameMs: r.nameMs, start: r.start, end: r.end }; });
  return {
    month: month, days: days, rounds: roundMeta,
    totals: { due: due, done: done, late: late, missed: missed, pct: due ? Math.round(done * 100 / due) : null }
  };
}

/* ============================ seed data (edit freely in the sheet afterwards) ============================ */

var SEED_ROUNDS = [
  ['A1', 'Morning round', 'Putaran pagi', 'Pusingan pagi', '08:00', '10:00', ''],
  ['A2', 'Midday round', 'Putaran siang', 'Pusingan tengah hari', '12:30', '14:30', ''],
  ['A3', 'Afternoon round', 'Putaran sore', 'Pusingan petang', '15:30', '17:30', ''],
  ['P1', 'Prayer room, before Zuhur', 'Mushola, sebelum Zuhur', 'Surau, sebelum Zohor', '10:30', '11:45', ''],
  ['P2', 'Prayer room, before Ashar', 'Mushola, sebelum Ashar', 'Surau, sebelum Asar', '14:30', '15:15', ''],
  ['M1', 'MMC morning clean (once a day)', 'MMC bersih pagi (1x sehari)', 'MMC pembersihan pagi (sekali sehari)', '07:30', '10:30', 'meeting'],
  ['M2', 'MMC afternoon visit (check only)', 'MMC kunjungan sore (cek saja)', 'MMC lawatan petang (semak sahaja)', '13:00', '16:00', 'mmc_check']
];

// roomId, nameEn, nameId, nameMs, location, type, rounds, days, checklists, photoRequired
var SEED_ROOMS = [
  ['ADM-01', 'Main Office', 'Kantor Utama', 'Pejabat Utama', 'Admin Building', 'office', 'A1', '1-6', 'office+printer+special', 'FALSE'],
  ['ADM-02', 'Cubicle Area', 'Area Kubikel', 'Kawasan Kubikel', 'Admin Building', 'office', 'A1', '1-6', 'office+special', 'FALSE'],
  ['ADM-03', 'Meeting Room 1', 'Ruang Rapat 1', 'Bilik Mesyuarat 1', 'Admin Building', 'meeting', 'A1', '1-6', 'meeting', 'FALSE'],
  ['ADM-04', 'Meeting Room 2', 'Ruang Rapat 2', 'Bilik Mesyuarat 2', 'Admin Building', 'meeting', 'A1', '1-6', 'meeting', 'FALSE'],
  ['ADM-05', 'Training Room', 'Ruang Pelatihan', 'Bilik Latihan', 'Admin Building', 'training', 'A1', '1-6', 'training', 'FALSE'],
  ['ADM-06', 'Entrance and Stairways', 'Pintu Masuk dan Tangga', 'Pintu Masuk dan Tangga', 'Admin Building', 'entrance', 'A1,A3', '1-6', 'entrance+special', 'FALSE'],
  ['ADM-07', 'Corridor, Ground Floor', 'Koridor Lantai Dasar', 'Koridor Tingkat Bawah', 'Admin Building', 'corridor', 'A1,A2,A3', '1-6', 'corridor', 'FALSE'],
  ['ADM-08', 'Corridor, First Floor', 'Koridor Lantai 1', 'Koridor Tingkat 1', 'Admin Building', 'corridor', 'A1,A2,A3', '1-6', 'corridor', 'FALSE'],
  ['ADM-09', 'Toilet, Male', 'Toilet Pria', 'Tandas Lelaki', 'Admin Building', 'toilet', 'A1,A2,A3', '1-6', 'toilet', 'TRUE'],
  ['ADM-10', 'Toilet, Female', 'Toilet Wanita', 'Tandas Wanita', 'Admin Building', 'toilet', 'A1,A2,A3', '1-6', 'toilet', 'TRUE'],
  ['ADM-11', 'Pantry', 'Pantri', 'Pantri', 'Admin Building', 'pantry', 'A1,A2,A3', '1-6', 'pantry', 'TRUE'],
  ['ADM-12', 'Prayer Room', 'Mushola', 'Surau', 'Admin Building', 'prayer', 'P1,P2', '1-6', 'prayer', 'FALSE'],
  ['MMC-01', 'MMC Room', 'Ruang MMC', 'Bilik MMC', 'MMC', 'mmc', 'M1,M2', '1-6', 'meeting', 'FALSE']
];

var AIR_FRESH = ['refill', 'Air freshener', 'Pewangi ruangan', 'Pengharum udara'];

// template, items: [type, en, id, ms]  (type: check | refill | mmc)
var SEED_CHECKLISTS = {
  office: [
    ['check', 'Floors swept and mopped', 'Lantai disapu dan dipel', 'Lantai disapu dan dimop'],
    ['check', 'Desks and cubicle surfaces wiped', 'Meja dan sekat kubikel dilap', 'Meja dan permukaan kubikel dilap'],
    ['check', 'Bins emptied, bag replaced', 'Tempat sampah dikosongkan, plastik diganti', 'Tong sampah dikosongkan, beg diganti'],
    ['check', 'Windows and glass partitions clean', 'Jendela dan kaca partisi bersih', 'Tingkap dan partition kaca bersih'],
    ['check', 'Walkways clear, no clutter on floor', 'Jalur bebas hambatan, tidak ada barang berserakan', 'Laluan bebas halangan, tiada barang bersepah'],
    ['check', 'Partition tops dusted, spills removed', 'Atas sekat dibersihkan, tumpahan dilap', 'Bahagian atas partition dibersihkan, tumpahan dilap'],
    AIR_FRESH
  ],
  printer: [
    ['check', 'Printer cleaned and wiped, no dust', 'Printer dibersihkan dan dilap, bebas debu', 'Pencetak dibersihkan dan dilap, bebas habuk'],
    ['check', 'Paper in and around the printer arranged neatly', 'Kertas di printer dan sekitarnya tertata rapi', 'Kertas di pencetak dan sekelilingnya tersusun kemas'],
    ['check', 'Paper tray tidy, not overfilled or jammed (report to office staff if empty)', 'Baki kertas rapi, tidak terlalu penuh atau macet (lapor staf kantor jika kosong)', 'Dulang kertas kemas, tidak terlalu penuh atau tersekat (laporkan kepada staf pejabat jika kosong)'],
    ['check', 'Area around the printer clear of loose paper and clutter', 'Area sekitar printer bebas kertas berserakan dan barang', 'Kawasan sekitar pencetak bebas kertas bersepah dan barang']
  ],
  meeting: [
    ['check', 'Table and chairs wiped', 'Meja dan kursi dilap', 'Meja dan kerusi dilap'],
    ['check', 'Floor swept and mopped', 'Lantai disapu dan dipel', 'Lantai disapu dan dimop'],
    ['check', 'Bin emptied', 'Tempat sampah dikosongkan', 'Tong sampah dikosongkan'],
    ['check', 'Cups, glasses and leftovers removed', 'Gelas dan sisa makanan diambil', 'Cawan, gelas dan sisa makanan diambil'],
    ['check', 'Room generally clean and tidy', 'Ruangan bersih dan rapi', 'Bilik bersih dan kemas'],
    AIR_FRESH
  ],
  entrance: [
    ['check', 'Floor swept and mopped, not slippery', 'Lantai disapu dan dipel, tidak licin', 'Lantai disapu dan dimop, tidak licin'],
    ['check', 'Wet Floor sign placed while mopping and removed after', 'Rambu lantai basah dipasang saat mengepel dan diambil setelah kering', 'Papan tanda lantai basah diletakkan semasa mop dan diambil selepas kering'],
    ['check', 'Handrails wiped', 'Pegangan tangga dilap', 'Pemegang tangga dilap'],
    ['check', 'Door glass and mats clean', 'Kaca pintu dan keset bersih', 'Kaca pintu dan pelapik kaki bersih'],
    ['check', 'Steps clear of items', 'Anak tangga bebas barang', 'Anak tangga bebas barang']
  ],
  training: [
    ['check', 'Tables and chairs wiped', 'Meja dan kursi dilap', 'Meja dan kerusi dilap'],
    ['check', 'Floor swept and mopped', 'Lantai disapu dan dipel', 'Lantai disapu dan dimop'],
    ['check', 'Bin emptied', 'Tempat sampah dikosongkan', 'Tong sampah dikosongkan'],
    ['check', 'Chairs arranged as per layout', 'Kursi ditata sesuai tata letak', 'Kerusi disusun mengikut susun atur'],
    ['check', 'Drinking water available', 'Air minum tersedia', 'Air minuman tersedia'],
    AIR_FRESH
  ],
  toilet: [
    ['check', 'Bowls, urinals and seats cleaned', 'Kloset, urinal dan dudukan dibersihkan', 'Mangkuk tandas, urinal dan tempat duduk dibersihkan'],
    ['check', 'Sinks, taps and mirrors clean', 'Wastafel, keran dan cermin bersih', 'Singki, paip dan cermin bersih'],
    ['check', 'Floor mopped, dry, no bad odour', 'Lantai dipel, kering, tidak bau', 'Lantai dimop, kering, tiada bau busuk'],
    ['check', 'Toilet tissue, hand soap and hand tissue stocked', 'Tisu toilet, sabun cuci tangan dan tisu tangan tersedia', 'Tisu tandas, sabun tangan dan tisu tangan tersedia'],
    ['check', 'Bin emptied', 'Tempat sampah dikosongkan', 'Tong sampah dikosongkan'],
    ['check', 'Water running, no leaks, flush working (report if not)', 'Air mengalir, tidak bocor, flush berfungsi (lapor jika tidak)', 'Air mengalir, tiada kebocoran, flush berfungsi (laporkan jika tidak)'],
    ['check', 'Toilet brush clean and in place', 'Sikat toilet bersih dan pada tempatnya', 'Berus tandas bersih dan di tempatnya'],
    AIR_FRESH
  ],
  corridor: [
    ['check', 'Floor swept and mopped', 'Lantai disapu dan dipel', 'Lantai disapu dan dimop'],
    ['check', 'Walkways clear, nothing stored', 'Jalur bebas barang, tidak ada penyimpanan', 'Laluan bebas barang, tiada simpanan'],
    ['check', 'Window sills free from dust, cleaned', 'Kusen jendela bebas debu, dibersihkan', 'Ambang tingkap bebas habuk, dibersihkan'],
    ['check', 'Walls and door handles wiped', 'Dinding dan gagang pintu dilap', 'Dinding dan pemegang pintu dilap'],
    ['check', 'Bins emptied', 'Tempat sampah dikosongkan', 'Tong sampah dikosongkan']
  ],
  pantry: [
    ['check', 'Counter top clean', 'Meja dibersihkan', 'Kaunter dibersihkan'],
    ['check', 'Sink clean', 'Bak cuci bersih', 'Singki bersih'],
    ['check', 'Dishes washed and put on the rack', 'Piring dan gelas dicuci dan ditaruh di rak', 'Pinggan dan gelas dibasuh dan diletakkan di rak'],
    ['check', 'Coffee machine, electric kettle and dispenser cleaned', 'Mesin kopi, teko listrik dan dispenser dibersihkan', 'Mesin kopi, cerek elektrik dan dispenser dibersihkan'],
    ['check', 'Refrigerator wiped, no expired food', 'Kulkas dilap, tidak ada makanan kedaluwarsa', 'Peti sejuk dilap, tiada makanan luput tarikh'],
    ['check', 'Oven cleaned', 'Oven dibersihkan', 'Ketuhar dibersihkan'],
    ['check', 'Bins emptied, floor mopped and dry', 'Tempat sampah dikosongkan, lantai dipel dan kering', 'Tong sampah dikosongkan, lantai dimop dan kering'],
    ['check', 'Snacks and drinks refilled', 'Snack dan minuman diisi ulang', 'Snek dan minuman diisi semula']
  ],
  prayer: [
    ['check', 'Floor swept and mopped', 'Lantai disapu dan dipel', 'Lantai disapu dan dimop'],
    ['check', 'Carpet and prayer mats clean and tidy', 'Karpet dan sajadah bersih dan rapi', 'Permaidani dan sejadah bersih dan kemas'],
    ['check', 'Ablution area clean and dry', 'Tempat wudhu bersih dan kering', 'Tempat wuduk bersih dan kering'],
    ['check', 'Shoe rack tidy', 'Rak sepatu rapi', 'Rak kasut kemas'],
    ['check', 'Bin emptied', 'Tempat sampah dikosongkan', 'Tong sampah dikosongkan'],
    AIR_FRESH
  ],
  mmc_check: [
    ['mmc', 'Floor and tables look clean', 'Lantai dan meja tampak bersih', 'Lantai dan meja kelihatan bersih'],
    ['mmc', 'Bin not full', 'Tempat sampah tidak penuh', 'Tong sampah tidak penuh'],
    ['mmc', 'Room tidy, no leftovers', 'Ruangan rapi, tidak ada sisa makanan', 'Bilik kemas, tiada sisa makanan'],
    AIR_FRESH
  ]
};
// special tasks: [type, en, id, ms, days, rounds]
var SEED_SPECIAL = [
  ['check', 'Cobwebs cleaned (ceiling and corners), weekly', 'Sarang laba-laba dibersihkan (plafon dan sudut), mingguan', 'Sarang labah-labah dibersihkan (siling dan sudut), mingguan', '5', 'A1'],
  ['check', 'Plants watered, soil checked, dead leaves removed', 'Tanaman disiram, tanah dicek, daun kering dibuang', 'Tanaman disiram, tanah disemak, daun kering dibuang', '', 'A1']
];

// group, category (EN | ID), nameId, nameEn, qty, note
var SEED_INVENTORY = [
  ['snacks', 'Snacks | Snack', 'Roti Malkis', 'Malkist crackers', '', ''],
  ['snacks', 'Snacks | Snack', 'Roti Marie', 'Marie biscuits', '', ''],
  ['snacks', 'Snacks | Snack', 'Keripik', 'Chips', '', ''],
  ['snacks', 'Snacks | Snack', 'Kacang', 'Nuts', '', ''],
  ['snacks', 'Drinks | Minuman', 'Nescafe', 'Nescafe', '', ''],
  ['snacks', 'Drinks | Minuman', 'Coffee (Kopi)', 'Coffee', '', ''],
  ['snacks', 'Drinks | Minuman', 'Susu kental manis', 'Condensed milk', '', ''],
  ['snacks', 'Drinks | Minuman', 'Susu evaporasi', 'Evaporated milk', '', ''],
  ['snacks', 'Drinks | Minuman', 'Aqua galon', 'Water gallon', '11', ''],
  ['snacks', 'Drinks | Minuman', 'Aqua botol', 'Bottled water', '', ''],

  ['other', 'Paper, hygiene and disposables | Kertas, kebersihan diri dan sekali pakai', 'Tisu makan', 'Table tissue', '', ''],
  ['other', 'Paper, hygiene and disposables | Kertas, kebersihan diri dan sekali pakai', 'Tisu toilet', 'Toilet tissue', '', ''],
  ['other', 'Paper, hygiene and disposables | Kertas, kebersihan diri dan sekali pakai', 'Tisu tangan', 'Hand tissue', '', ''],
  ['other', 'Paper, hygiene and disposables | Kertas, kebersihan diri dan sekali pakai', 'Cup', 'Cups', '', ''],
  ['other', 'Paper, hygiene and disposables | Kertas, kebersihan diri dan sekali pakai', 'Plastik wrap', 'Cling wrap', '', ''],
  ['other', 'Paper, hygiene and disposables | Kertas, kebersihan diri dan sekali pakai', 'Sabun cuci tangan', 'Hand soap', '', ''],
  ['other', 'Paper, hygiene and disposables | Kertas, kebersihan diri dan sekali pakai', 'Masker', 'Masks', '', ''],
  ['other', 'Paper, hygiene and disposables | Kertas, kebersihan diri dan sekali pakai', 'Sarung tangan', 'Gloves', '', ''],
  ['other', 'Paper, hygiene and disposables | Kertas, kebersihan diri dan sekali pakai', 'Plastik sampah', 'Garbage bags', '', ''],

  ['other', 'Cleaning supplies | Bahan pembersih', 'Sabun cuci piring', 'Dish soap', '', ''],
  ['other', 'Cleaning supplies | Bahan pembersih', 'Pewangi ruangan', 'Air freshener', '', ''],
  ['other', 'Cleaning supplies | Bahan pembersih', 'Wipol', 'Floor cleaner (Wipol)', '', ''],
  ['other', 'Cleaning supplies | Bahan pembersih', 'Cling kaca', 'Glass cleaner', '', ''],
  ['other', 'Cleaning supplies | Bahan pembersih', 'Spons cuci', 'Washing sponge', '2', ''],
  ['other', 'Cleaning supplies | Bahan pembersih', 'Spons kawat', 'Scouring pad', '4', ''],
  ['other', 'Cleaning supplies | Bahan pembersih', 'Kain lap', 'Cleaning cloth', '3', ''],
  ['other', 'Cleaning supplies | Bahan pembersih', 'Kanebo', 'Chamois cloth', '2', ''],
  ['other', 'Cleaning supplies | Bahan pembersih', 'Paper kaca', 'Glass wiping paper', '3', ''],

  ['other', 'Crockery and cutlery | Peralatan makan', 'Piring besar', 'Large plates', '10', ''],
  ['other', 'Crockery and cutlery | Peralatan makan', 'Piring kecil', 'Small plates', '19', ''],
  ['other', 'Crockery and cutlery | Peralatan makan', 'Mangkuk', 'Bowls', '6', ''],
  ['other', 'Crockery and cutlery | Peralatan makan', 'Gelas', 'Glasses', '38', ''],
  ['other', 'Crockery and cutlery | Peralatan makan', 'Sendok garpu', 'Forks', '15', ''],
  ['other', 'Crockery and cutlery | Peralatan makan', 'Sendok makan', 'Tablespoons', '30', ''],
  ['other', 'Crockery and cutlery | Peralatan makan', 'Sendok kecil', 'Teaspoons', '', ''],
  ['other', 'Crockery and cutlery | Peralatan makan', 'Pisau cake', 'Cake knives', '4', ''],
  ['other', 'Crockery and cutlery | Peralatan makan', 'Pisau', 'Knives', '4', ''],
  ['other', 'Crockery and cutlery | Peralatan makan', 'Rak piring', 'Dish rack', '', ''],

  ['other', 'Tools and equipment | Alat kerja', 'Kemoceng', 'Feather duster', '2', ''],
  ['other', 'Tools and equipment | Alat kerja', 'Sapu', 'Broom', '2', ''],
  ['other', 'Tools and equipment | Alat kerja', 'Pel', 'Mop', '2', ''],
  ['other', 'Tools and equipment | Alat kerja', 'Wiper lantai', 'Floor squeegee', '2', ''],
  ['other', 'Tools and equipment | Alat kerja', 'Sikat toilet', 'Toilet brush', '2', ''],
  ['other', 'Tools and equipment | Alat kerja', 'Sekop', 'Dustpan / shovel', '2', ''],
  ['other', 'Tools and equipment | Alat kerja', 'Ember', 'Bucket', '2', ''],
  ['other', 'Tools and equipment | Alat kerja', 'Tempat sampah', 'Bins', '12', ''],
  ['other', 'Tools and equipment | Alat kerja', 'Wet Floor Sign', 'Wet Floor sign', '2', ''],

  ['other', 'Appliances | Peralatan elektronik', 'Oven', 'Oven', '1', 'Listed as "Open 1", please confirm it is the oven'],
  ['other', 'Appliances | Peralatan elektronik', 'Mesin kopi', 'Coffee machine', '1', ''],
  ['other', 'Appliances | Peralatan elektronik', 'Kulkas', 'Refrigerator', '1', ''],
  ['other', 'Appliances | Peralatan elektronik', 'Dispenser', 'Water dispenser', '1', ''],
  ['other', 'Appliances | Peralatan elektronik', 'Lemari', 'Cabinet', '1', ''],
  ['other', 'Appliances | Peralatan elektronik', 'Teko listrik', 'Electric kettle', '1', '']
];

/* ============================ setup ============================ */

function randPin_() { return String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 6), 16) % 9000 + 1000); }
function hashPin_(salt, pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length < 2 ? '0' + v : v; }).join('');
}
function newUserRow_(userId, name, role, pin) {
  var salt = sleepRand_().slice(0, 12);
  return { userId: userId, name: name, initials: initials_(name), role: role, pinHash: hashPin_(salt, pin), salt: salt, active: 'TRUE' };
}

/** Creates the sheets, fills them with starter data (only when empty), creates the secret and the photo folder. */
function setup_(ss) {
  var created = { pins: [] };
  props_().setProperty('SSID', ss.getId());
  if (!props_().getProperty('SECRET')) props_().setProperty('SECRET', sleepRand_() + sleepRand_());

  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var h = SCHEMA[name];
    if (sh.getLastRow() < 1) {
      sh.getRange(1, 1, 1, h.length).setValues([h]);
      sh.getRange(1, 1, 1, h.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // keep typed values like "1-6" or "08:00" as plain text
    var maxRows = Math.max(sh.getMaxRows() - 1, 1);
    sh.getRange(2, 1, maxRows, h.length).setNumberFormat('@');
  });

  function empty(name) { return sheet_(name).getLastRow() < 2; }
  function put(name, rows) {
    if (!rows.length) return;
    var sh = sheet_(name), w = SCHEMA[name].length;
    var out = rows.map(function (r) { var c = r.slice(); while (c.length < w) c.push(''); return c.map(String); });
    sh.getRange(2, 1, out.length, w).setNumberFormat('@');
    sh.getRange(2, 1, out.length, w).setValues(out);
  }

  if (empty('Config')) put('Config', CFG_DEFAULTS);
  if (empty('Rounds')) put('Rounds', SEED_ROUNDS);
  if (empty('Rooms')) {
    put('Rooms', SEED_ROOMS.map(function (r) {
      return [r[0], sleepRand_().slice(0, 8), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], 'TRUE'];
    }));
  }
  if (empty('Checklists')) {
    var rows = [];
    Object.keys(SEED_CHECKLISTS).forEach(function (t) {
      SEED_CHECKLISTS[t].forEach(function (it, i) { rows.push([t, t + '-' + (i + 1), i + 1, it[0], it[1], it[2], it[3], '', '']); });
    });
    SEED_SPECIAL.forEach(function (it, i) { rows.push(['special', 'special-' + (i + 1), i + 1, it[0], it[1], it[2], it[3], it[4], it[5]]); });
    put('Checklists', rows);
  }
  if (empty('Inventory')) {
    put('Inventory', SEED_INVENTORY.map(function (r, i) { return ['I' + ('00' + (i + 1)).slice(-3), r[0], r[1], r[2], r[3], r[4], '', r[5]]; }));
  }
  if (empty('Holidays')) put('Holidays', [['2026-12-25', 'Christmas Day (example, edit or delete)']]);
  if (empty('Users')) {
    var seedUsers = [['U01', 'Iggy', 'admin'], ['U02', 'Office Staff', 'supervisor'], ['U03', 'Cleaner 1', 'cleaner'], ['U04', 'Cleaner 2', 'cleaner'], ['U05', 'Cleaner 3', 'cleaner']];
    var userRows = seedUsers.map(function (u) {
      var pin = randPin_();
      var r = newUserRow_(u[0], u[1], u[2], pin);
      created.pins.push({ userId: u[0], name: u[1], role: u[2], pin: pin });
      return [r.userId, r.name, r.initials, r.role, r.pinHash, r.salt, r.active];
    });
    put('Users', userRows);
  }

  photoFolder_();
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) { try { ss.deleteSheet(s1); } catch (e) {} }
  CacheService.getScriptCache().remove('bundle');
  return created;
}

/* ============================ auth ============================ */

function b64u_(x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); }
function sign_(obj) {
  var body = b64u_(JSON.stringify(obj));
  return body + '.' + b64u_(Utilities.computeHmacSha256Signature(body, props_().getProperty('SECRET')));
}
function verify_(tok) {
  var parts = String(tok || '').split('.');
  if (parts.length !== 2) fail_('auth', 'Please log in again.');
  var sig = b64u_(Utilities.computeHmacSha256Signature(parts[0], props_().getProperty('SECRET')));
  if (sig !== parts[1]) fail_('auth', 'Please log in again.');
  try { return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); }
  catch (e) { fail_('auth', 'Please log in again.'); }
}
function userById_(id) {
  var rows = table_('Users');
  for (var i = 0; i < rows.length; i++) {
    if (txt_(rows[i].userId) === id) {
      var r = rows[i];
      return { userId: txt_(r.userId), name: txt_(r.name), initials: txt_(r.initials) || initials_(r.name), role: txt_(r.role),
               active: bool_(r.active), pinHash: txt_(r.pinHash), salt: txt_(r.salt) };
    }
  }
  return null;
}
function auth_(req, roles) {
  var t = verify_(req.token);
  if (!t.u || !t.exp || t.exp < Date.now()) fail_('auth', 'Session expired. Please log in again.');
  var u = userById_(t.u);
  if (!u || !u.active) fail_('auth', 'This account is not active.');
  if (roles && roles.indexOf(u.role) < 0) fail_('forbidden', 'You are not allowed to do this.');
  return u;
}
function login_(req) {
  var b = loadBundle_();
  var uid = String(req.userId || ''), pin = String(req.pin || '');
  var cache = CacheService.getScriptCache(), fk = 'fail|' + uid;
  var fails = Number(cache.get(fk) || 0);
  if (fails >= 5) fail_('locked', 'Too many wrong PINs. Try again in 10 minutes.');
  var u = userById_(uid);
  if (!u || !u.active || hashPin_(u.salt, pin) !== u.pinHash) {
    cache.put(fk, String(fails + 1), 600);
    fail_('badpin', 'Wrong PIN.');
  }
  cache.remove(fk);
  var hours = cfgNum_(b, 'TOKEN_HOURS', 12);
  return { token: sign_({ u: u.userId, exp: Date.now() + hours * 3600000 }), user: { userId: u.userId, name: u.name, role: u.role, initials: u.initials } };
}
function changePin_(req, user) {
  var pin = String(req.newPin || '');
  if (!/^\d{4,6}$/.test(pin)) fail_('invalid', 'The new PIN must be 4 to 6 digits.');
  if (hashPin_(user.salt, String(req.oldPin || '')) !== user.pinHash) fail_('badpin', 'Wrong PIN.');
  var row = findRow_('Users', user.userId);
  var salt = sleepRand_().slice(0, 12);
  updateCells_('Users', row, { salt: salt, pinHash: hashPin_(salt, pin) });
  return {};
}

/* ============================ photos ============================ */

function photoFolder_() {
  var id = '';
  try { id = String(loadBundle_().cfg.PHOTO_FOLDER_ID || '').trim(); } catch (e0) {}
  if (id) { try { return DriveApp.getFolderById(id); } catch (e1) { log_('PHOTO_FOLDER_ID not usable: ' + e1); } }
  id = props_().getProperty('PHOTO_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('Mentari Housekeeping Photos');
  props_().setProperty('PHOTO_FOLDER', f.getId());
  return f;
}
function savePhoto_(dataUrl, prefix) {
  if (!dataUrl) return '';
  var m = String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/);
  if (!m) fail_('photo', 'Photo format is not supported.');
  if (m[2].length > 2200000) fail_('photo', 'The photo is too large.');
  var ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
  var name = 'HK_' + prefix + '_' + fmt_(now_(), 'yyyyMMdd_HHmmss') + '.' + ext;
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
  return photoFolder_().createFile(blob).getId();
}
function getPhoto_(id) {
  var f = DriveApp.getFileById(String(id || ''));
  if (String(f.getName()).indexOf('HK_') !== 0) fail_('forbidden', 'You are not allowed to do this.');
  var blob = f.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ============================ notifications ============================ */

function esc_(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function mail_(to, subject, html) {
  if (!to) return false;
  try {
    var from = '';
    try { from = String(loadBundle_().cfg.MAIL_FROM || '').trim(); } catch (e0) {}
    if (from) {
      try {
        GmailApp.sendEmail(to, subject, 'Open this email in an HTML-capable mail app.', { htmlBody: html, name: 'Mentari Housekeeping', from: from });
        return true;
      } catch (e1) { log_('Send-as failed, using default sender: ' + e1); }
    }
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: 'Mentari Housekeeping' });
    return true;
  } catch (e) { log_('Mail failed: ' + e); return false; }
}
function telegram_(text) {
  var t = props_().getProperty('TG_TOKEN'), c = props_().getProperty('TG_CHAT');
  if (!t || !c) return false;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/sendMessage', { method: 'post', payload: { chat_id: c, text: text }, muteHttpExceptions: true });
    return true;
  } catch (e) { log_('Telegram failed: ' + e); return false; }
}
function emailShell_(b, title, bodyHtml) {
  var link = b.cfg.APP_URL ? '<p><a href="' + esc_(b.cfg.APP_URL) + '">Open the housekeeping app</a></p>' : '';
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:640px">' +
    '<div style="border-top:4px solid #FBCE07;padding-top:10px;letter-spacing:.15em;color:#666;font-size:13px">MENTARI HOUSEKEEPING</div>' +
    '<h3 style="margin:10px 0">' + esc_(title) + '</h3>' + bodyHtml + link + '</div>';
}
function catLabel_(id) {
  for (var i = 0; i < CONCERN_CATEGORIES.length; i++) if (CONCERN_CATEGORIES[i].id === id) return CONCERN_CATEGORIES[i];
  return CONCERN_CATEGORIES[CONCERN_CATEGORIES.length - 1];
}
function notifyConcerns_(b, items) {
  if (!items.length) return;
  var rows = items.map(function (c) {
    var room = b.roomMap[c.roomId] || {};
    return '<tr><td style="padding:4px 8px;border-bottom:1px solid #eee"><b>' + esc_(c.ref) + '</b></td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #eee">' + esc_(room.nameEn || c.roomId) + '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #eee">' + esc_(catLabel_(c.category).en) + '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #eee">' + esc_(c.text) + (c.reporter ? '<br><span style="color:#777">From: ' + esc_(c.reporter) + '</span>' : '') + '</td></tr>';
  }).join('');
  var first = items[0], r1 = b.roomMap[first.roomId] || {};
  var subject = items.length === 1
    ? '[Housekeeping] New concern ' + first.ref + ': ' + (r1.nameEn || first.roomId) + ' (' + catLabel_(first.category).en + ')'
    : '[Housekeeping] ' + items.length + ' new concerns';
  var html = emailShell_(b, items.length === 1 ? 'New concern' : items.length + ' new concerns', '<table style="border-collapse:collapse;width:100%">' + rows + '</table>');
  mail_(b.cfg.OFFICE_EMAILS, subject, html);
  telegram_(subject + '\n' + items.map(function (c) { return c.ref + ': ' + c.text; }).join('\n'));
}

/* ============================ concerns ============================ */

function nextRef_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ym = fmt_(now_(), 'yyMM'), k = 'REFSEQ_' + ym;
    var n = Number(props_().getProperty(k) || 0) + 1;
    props_().setProperty(k, String(n));
    return 'HK-' + ym + '-' + ('0000' + n).slice(-4);
  } finally { lock.releaseLock(); }
}
function createConcern_(c) {
  var ref = nextRef_(), ts = stamp_();
  appendRow_('Concerns', {
    ref: ref, ts: ts, roomId: c.roomId, category: c.category, text: c.text, reporter: c.reporter || '', photoId: c.photoId || '',
    source: c.source || 'Personnel', status: 'Open', updatedTs: ts, closedTs: '', afterPhotoId: '', closeNote: '', itemKey: c.itemKey || '', handledBy: ''
  });
  return ref;
}
function roomOut_(room) {
  return { roomId: room.roomId, nameEn: room.nameEn, nameId: room.nameId, nameMs: room.nameMs, location: room.location, type: room.type, photoRequired: room.photoRequired };
}
function concernOut_(b, r) {
  var room = b.roomMap[txt_(r.roomId)] || { roomId: txt_(r.roomId), nameEn: txt_(r.roomId), nameId: txt_(r.roomId), nameMs: txt_(r.roomId) };
  return {
    ref: txt_(r.ref), ts: txt_(r.ts), room: roomOut_(room), category: txt_(r.category), text: txt_(r.text), reporter: txt_(r.reporter),
    photoId: txt_(r.photoId), source: txt_(r.source), status: txt_(r.status), updatedTs: txt_(r.updatedTs), closedTs: txt_(r.closedTs),
    afterPhotoId: txt_(r.afterPhotoId), closeNote: txt_(r.closeNote), handledBy: txt_(r.handledBy)
  };
}
function concernCreate_(req) {
  var b = loadBundle_();
  if (req.website) fail_('invalid', 'Could not send the report.');
  var room = b.roomMap[String(req.roomId || '')];
  if (!room || !room.active) fail_('invalid', 'Please choose a room.');
  var cat = String(req.category || '');
  if (!CONCERN_CATEGORIES.some(function (c) { return c.id === cat && c.id !== 'action'; })) fail_('invalid', 'Please choose a category.');
  var text = String(req.text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (text.length < 3) fail_('invalid', 'Please describe the concern.');
  if (text.length > 500) text = text.slice(0, 500);
  var reporter = String(req.name || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 40);
  var cache = CacheService.getScriptCache(), hour = fmt_(now_(), 'yyyyMMddHH');
  var k1 = 'thr|' + hour, k2 = 'thr|' + room.roomId + '|' + hour;
  var n1 = Number(cache.get(k1) || 0), n2 = Number(cache.get(k2) || 0);
  if (n1 >= 60 || n2 >= 12) fail_('throttle', 'Too many reports right now. Please tell the office directly.');
  cache.put(k1, String(n1 + 1), 3700); cache.put(k2, String(n2 + 1), 3700);
  var photoId = savePhoto_(req.photo, 'CONCERN');
  var c = { roomId: room.roomId, category: cat, text: text, reporter: reporter, photoId: photoId, source: 'Personnel' };
  c.ref = createConcern_(c);
  notifyConcerns_(b, [c]);
  return { ref: c.ref };
}
function concernStatus_(req) {
  var b = loadBundle_();
  var ref = String(req.ref || '').trim().toUpperCase();
  var row = ref ? findRow_('Concerns', ref) : 0;
  if (!row) fail_('notfound', 'No concern found with that reference.');
  var o = concernOut_(b, getRow_('Concerns', row));
  return { ref: o.ref, status: o.status, ts: o.ts, updatedTs: o.updatedTs, category: o.category, room: o.room };
}
function concernsList_(req) {
  var b = loadBundle_();
  var rows = table_('Concerns').map(function (r) { return concernOut_(b, r); });
  var rank = { 'Open': 0, 'In Progress': 1, 'Closed': 2 };
  rows.sort(function (a, c) { return (rank[a.status] - rank[c.status]) || (a.ts < c.ts ? 1 : a.ts > c.ts ? -1 : 0); });
  var open = rows.filter(function (r) { return r.status !== 'Closed'; });
  var closed = rows.filter(function (r) { return r.status === 'Closed'; }).slice(0, 80);
  return { concerns: open.concat(closed) };
}
function concernUpdate_(req, user) {
  var b = loadBundle_();
  var ref = String(req.ref || '');
  var row = findRow_('Concerns', ref);
  if (!row) fail_('notfound', 'Concern not found.');
  var cur = getRow_('Concerns', row), ts = stamp_();
  var to = String(req.to || '');
  if (to === 'inprogress') {
    if (txt_(cur.status) === 'Closed') fail_('invalid', 'This concern is already closed.');
    updateCells_('Concerns', row, { status: 'In Progress', updatedTs: ts, handledBy: user.name });
  } else if (to === 'closed') {
    var needPhoto = bool_(b.cfg.REQUIRE_AFTER_PHOTO);
    if (needPhoto && !req.photo) fail_('photo', 'An after photo is required to close this concern.');
    var pid = savePhoto_(req.photo, 'AFTER');
    updateCells_('Concerns', row, { status: 'Closed', updatedTs: ts, closedTs: ts, afterPhotoId: pid, closeNote: String(req.note || '').slice(0, 300), handledBy: user.name });
  } else if (to === 'open') {
    if (HK_ROLES_MGR.indexOf(user.role) < 0) fail_('forbidden', 'Only the office can reopen a concern.');
    updateCells_('Concerns', row, { status: 'Open', updatedTs: ts, closedTs: '', afterPhotoId: '', closeNote: '' });
  } else fail_('invalid', 'Unknown action.');
  return { concern: concernOut_(b, getRow_('Concerns', row)) };
}

/* ============================ inspections ============================ */

var ANSWER_OPTIONS = {
  check:  ['done', 'notdone', 'action'],
  refill: ['present', 'refill'],
  mmc:    ['clean', 'cleaned', 'action']
};

function startInspection_(req, user) {
  var b = loadBundle_();
  var room = b.roomMap[String(req.roomId || '')];
  if (!room || !room.active || !room.key || room.key !== String(req.key || '')) fail_('invalid', 'This QR code is not valid. Ask the office for a new label.');
  var tn = nowInfo_();
  var idx = inspIndex_(inspLight_(tn.date));
  var early = cfgNum_(b, 'EARLY_MIN', 20), lateMax = cfgNum_(b, 'LATE_MAX_MIN', 120);
  var notDone = roundsFor_(b, room, tn.date).filter(function (r) { return !idx[tn.date + '|' + room.roomId + '|' + r.roundId]; });
  var pick = null, status = 'OnTime', i;
  for (i = 0; i < notDone.length; i++) {
    if (tn.min >= notDone[i].startMin - early && tn.min <= notDone[i].endMin) { pick = notDone[i]; break; }
  }
  if (!pick) {
    var past = notDone.filter(function (r) { return r.endMin < tn.min; });
    if (past.length) {
      var last = past[past.length - 1];
      if (tn.min - last.endMin <= lateMax) { pick = last; status = 'Late'; }
    }
  }
  if (!pick) {
    var future = notDone.filter(function (r) { return r.startMin - early > tn.min; });
    if (future.length) fail_('early', 'The next round for this room starts at ' + future[0].start + '.');
    status = 'Extra';
  }
  var items = itemsFor_(b, room, pick, tn.date);
  if (!items.length) fail_('invalid', 'No checklist is set up for this room.');
  var token = sign_({ k: 'ins', u: user.userId, r: room.roomId, rd: pick ? pick.roundId : 'EXTRA', w: status, st: Date.now(), n: sleepRand_().slice(0, 10), d: tn.date });
  return {
    startToken: token, room: roomOut_(room), windowStatus: status,
    round: pick ? { roundId: pick.roundId, nameEn: pick.nameEn, nameId: pick.nameId, nameMs: pick.nameMs, start: pick.start, end: pick.end } : null,
    items: items.map(function (it) { return { itemId: it.itemId, type: it.type, en: it.en, id: it.id, ms: it.ms }; }),
    minSeconds: cfgNum_(b, 'MIN_DWELL_SEC', 60), startedAt: tn.stamp
  };
}

function submitInspection_(req, user) {
  var b = loadBundle_();
  var t = verify_(req.startToken);
  if (t.k !== 'ins' || t.u !== user.userId) fail_('invalid', 'Scan the room QR code again.');
  var ageMs = Date.now() - t.st;
  if (ageMs > 3 * 3600 * 1000) fail_('expired', 'This inspection timed out. Scan the room again.');
  var minSec = cfgNum_(b, 'MIN_DWELL_SEC', 60);
  if (ageMs < minSec * 1000) fail_('dwell', 'Please finish the checklist first. Wait ' + Math.ceil(minSec - ageMs / 1000) + ' more seconds.');
  var cache = CacheService.getScriptCache();
  if (cache.get('used|' + t.n)) fail_('used', 'This inspection was already submitted.');
  var room = b.roomMap[t.r];
  if (!room) fail_('invalid', 'Room not found.');
  var round = t.rd === 'EXTRA' ? null : b.rounds[t.rd];
  if (round) {
    var already = inspIndex_(inspLight_(t.d))[t.d + '|' + room.roomId + '|' + round.roundId];
    if (already) fail_('dup', 'This round was already recorded by ' + txt_(already.userName) + '.');
  }
  var items = itemsFor_(b, room, round, t.d);
  var ans = {};
  (req.answers || []).forEach(function (a) { if (a && a.itemId) ans[String(a.itemId)] = a; });
  var counts = { ok: 0, nd: 0, ac: 0, rf: 0 }, saved = [], hard = 0;
  items.forEach(function (it) {
    var a = ans[it.itemId];
    var allowed = ANSWER_OPTIONS[it.type] || ANSWER_OPTIONS.check;
    if (!a || allowed.indexOf(a.v) < 0) fail_('invalid', 'Please answer every item.');
    var note = String(a.note || '').trim().slice(0, 200);
    if ((a.v === 'notdone' || a.v === 'action') && note.length < 3) fail_('notes', 'Add a short note for each item that is not done or needs action.');
    if (a.v === 'notdone') { counts.nd++; hard++; }
    else if (a.v === 'action') { counts.ac++; hard++; }
    else if (a.v === 'refill') counts.rf++;
    else counts.ok++;
    saved.push({ i: it.itemId, v: a.v, n: note });
  });
  if ((room.photoRequired || hard > 0) && !req.photo) fail_('photo', 'A photo is required for this inspection.');
  var photoId = savePhoto_(req.photo, 'INS_' + room.roomId);
  var tn = nowInfo_();
  var insId = 'I' + fmt_(tn.ts, 'yyMMddHHmmss') + sleepRand_().slice(0, 3);
  appendRow_('Inspections', {
    insId: insId, ts: tn.stamp, date: t.d, roomId: room.roomId, roundId: t.rd, userId: user.userId, userName: user.name,
    durationSec: Math.round(ageMs / 1000), windowStatus: t.w, counts: JSON.stringify(counts), photoId: photoId,
    note: String(req.note || '').slice(0, 300), startedTs: stamp_(new Date(t.st)), itemsJson: JSON.stringify(saved)
  });
  cache.put('used|' + t.n, '1', 21600);

  // concerns from "needs action" and "needs refill" answers (no duplicate while one is still open)
  var openKeys = {};
  table_('Concerns').forEach(function (r) { if (txt_(r.status) !== 'Closed' && txt_(r.itemKey)) openKeys[txt_(r.itemKey)] = 1; });
  var made = [];
  items.forEach(function (it) {
    var a = ans[it.itemId], key = room.roomId + '|' + it.itemId;
    if (a.v !== 'action' && a.v !== 'refill') return;
    if (openKeys[key]) return;
    var c = {
      roomId: room.roomId, category: a.v === 'refill' ? 'supply' : 'action', source: 'Inspection', reporter: user.name, itemKey: key,
      text: a.v === 'refill' ? it.en + ': needs refill' : it.en + ': ' + String(a.note || '').trim().slice(0, 200)
    };
    c.ref = createConcern_(c);
    made.push(c);
  });
  notifyConcerns_(b, made);
  return { insId: insId, windowStatus: t.w, counts: counts, concerns: made.map(function (c) { return c.ref; }) };
}

/* ============================ views for the app ============================ */

function phone_(v) {
  var x = String(v == null ? '' : v).replace(/[^0-9+]/g, '');
  if (x.charAt(0) === '+') x = '+' + x.slice(1).replace(/\+/g, ''); else x = x.replace(/\+/g, '');
  return x.replace(/[^0-9]/g, '').length >= 6 ? x : '';
}
function configPublic_() {
  var b = loadBundle_();
  var tn = nowInfo_();
  return {
    version: APP_VERSION, serverNow: tn.stamp, today: tn.date,
    publicNameMode: b.cfg.PUBLIC_NAME_MODE, publicMonthsBack: cfgNum_(b, 'PUBLIC_MONTHS_BACK', 3),
    requireAfterPhoto: bool_(b.cfg.REQUIRE_AFTER_PHOTO),
    contacts: {
      hkPhone: phone_(b.cfg.HK_PHONE), hkWa: phone_(b.cfg.HK_WHATSAPP) || phone_(b.cfg.HK_PHONE),
      hrPhone: phone_(b.cfg.HR_PHONE), hrWa: phone_(b.cfg.HR_WHATSAPP) || phone_(b.cfg.HR_PHONE)
    },
    rooms: b.rooms.filter(function (r) { return r.active; }).map(function (r) {
      var o = roomOut_(r); o.rounds = r.rounds; return o;
    }),
    rounds: b.roundList.map(function (r) { return { roundId: r.roundId, nameEn: r.nameEn, nameId: r.nameId, nameMs: r.nameMs, start: r.start, end: r.end }; }),
    categories: CONCERN_CATEGORIES.filter(function (c) { return c.id !== 'action'; })
  };
}
function monthsDiff_(a, bm) { return (+a.slice(0, 4) - +bm.slice(0, 4)) * 12 + (+a.slice(5, 7) - +bm.slice(5, 7)); }
function roomMonth_(req, user) {
  var b = loadBundle_();
  var room = b.roomMap[String(req.roomId || '')];
  if (!room || !room.active) fail_('notfound', 'Room not found.');
  var tn = nowInfo_();
  var month = /^\d{4}-\d{2}$/.test(String(req.month || '')) ? req.month : tn.date.slice(0, 7);
  var back = monthsDiff_(tn.date.slice(0, 7), month);
  if (back < 0) month = tn.date.slice(0, 7);
  else if (!user && back > cfgNum_(b, 'PUBLIC_MONTHS_BACK', 3)) fail_('old', 'Older records are available to staff only.');
  var mode = user ? 'name' : b.cfg.PUBLIC_NAME_MODE;
  var rows = inspLight_(month + '-01').filter(function (r) { return txt_(r.date).slice(0, 7) === month; });
  var data = monthData_(b, room, month, inspIndex_(rows), tn, mode);
  data.room = roomOut_(room);
  data.today = tn.date;
  return data;
}
function optionalUser_(req) {
  if (!req.token) return null;
  try { return auth_(req, HK_ROLES_ALL); } catch (e) { return null; }
}
function todayView_(b, tn, idx) {
  var out = [];
  b.rooms.forEach(function (room) {
    var rs = roundsFor_(b, room, tn.date);
    if (!rs.length) return;
    out.push(Object.assign(roomOut_(room), {
      cells: rs.map(function (r) {
        var rec = idx[tn.date + '|' + room.roomId + '|' + r.roundId];
        return { roundId: r.roundId, nameEn: r.nameEn, nameId: r.nameId, nameMs: r.nameMs, start: r.start, end: r.end,
                 s: stateOf_(r, tn.date, rec, tn), t: rec ? txt_(rec.ts).slice(11, 16) : '', by: rec ? txt_(rec.userName) : '' };
      })
    }));
  });
  return out;
}
function today_(req, user) {
  var b = loadBundle_(), tn = nowInfo_();
  var idx = inspIndex_(inspLight_(tn.date));
  return { today: tn.date, now: tn.stamp, holiday: b.hol[tn.date] || '', rooms: todayView_(b, tn, idx) };
}
function pulse_(req, user) {
  var b = loadBundle_(), tn = nowInfo_(), since = String(req.since || '');
  var idx = inspIndex_(inspLight_(tn.date));
  var concerns = table_('Concerns');
  var fresh = concerns.filter(function (r) { return since && txt_(r.ts) > since; }).map(function (r) { return concernOut_(b, r); });
  var dueMap = {}, missed = [];
  b.rooms.forEach(function (room) {
    roundsFor_(b, room, tn.date).forEach(function (r) {
      if (idx[tn.date + '|' + room.roomId + '|' + r.roundId]) return;
      if (tn.min >= r.startMin && tn.min <= r.endMin) {
        var d = dueMap[r.roundId] = dueMap[r.roundId] || { roundId: r.roundId, nameEn: r.nameEn, nameId: r.nameId, nameMs: r.nameMs, start: r.start, end: r.end, rooms: [] };
        d.rooms.push(room.roomId);
      } else if (tn.min > r.endMin) missed.push({ roomId: room.roomId, roundId: r.roundId });
    });
  });
  return {
    now: tn.stamp,
    openConcerns: concerns.filter(function (r) { return txt_(r.status) !== 'Closed'; }).length,
    fresh: fresh,
    due: Object.keys(dueMap).map(function (k) { return dueMap[k]; }),
    missed: missed
  };
}
function inventory_() {
  var rows = table_('Inventory').filter(function (r) { return r.itemId; }).map(function (r) {
    return { itemId: txt_(r.itemId), group: txt_(r.group), category: txt_(r.category), nameId: txt_(r.nameId), nameEn: txt_(r.nameEn), qty: txt_(r.qty), unit: txt_(r.unit), note: txt_(r.note) };
  });
  return { items: rows };
}
function labels_() {
  var b = loadBundle_();
  return { rooms: b.rooms.filter(function (r) { return r.active; }).map(function (r) { var o = roomOut_(r); o.key = r.key; return o; }) };
}

/* ---------- dashboard ---------- */

function addDays_(dateStr, n) {
  var p = dateStr.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}
function rangeStats_(b, idx, tn, dates) {
  var due = 0, done = 0, late = 0, missed = 0;
  dates.forEach(function (ds) {
    b.rooms.forEach(function (room) {
      roundsFor_(b, room, ds).forEach(function (r) {
        var st = stateOf_(r, ds, idx[ds + '|' + room.roomId + '|' + r.roundId], tn);
        if (st === 'done' || st === 'late') { done++; due++; if (st === 'late') late++; }
        else if (st === 'missed') { due++; missed++; }
      });
    });
  });
  return { due: due, done: done, late: late, missed: missed, pct: due ? Math.round(done * 100 / due) : null };
}
function concernStats_(rows, fromTs, toTs) {
  var raised = 0, closed = 0, open = 0, prog = 0, hrs = [];
  rows.forEach(function (r) {
    var ts = txt_(r.ts), st = txt_(r.status), ct = txt_(r.closedTs);
    if (ts >= fromTs && ts <= toTs) raised++;
    if (st === 'Closed' && ct >= fromTs && ct <= toTs) {
      closed++;
      var h = (parseLocal_(ct) - parseLocal_(ts)) / 3600000;
      if (!isNaN(h) && h >= 0) hrs.push(h);
    }
    if (st === 'Open') open++;
    if (st === 'In Progress') prog++;
  });
  var avg = hrs.length ? Math.round(hrs.reduce(function (a, c) { return a + c; }, 0) / hrs.length * 10) / 10 : null;
  return { raised: raised, closed: closed, open: open, inProgress: prog, avgCloseHours: avg };
}
function weeklyText_(b, tn, idx, concerns) {
  var dates = []; for (var i = 6; i >= 0; i--) dates.push(addDays_(tn.date, -i));
  var rs = rangeStats_(b, idx, tn, dates);
  var cs = concernStats_(concerns, dates[0] + ' 00:00:00', tn.date + ' 23:59:59');
  return 'Housekeeping, ' + dates[0] + ' to ' + tn.date + ': rounds completed ' + rs.done + ' of ' + rs.due + (rs.pct !== null ? ' (' + rs.pct + '%)' : '') +
    ', late ' + rs.late + ', missed ' + rs.missed + '. Concerns raised ' + cs.raised + ', closed ' + cs.closed + ', open now ' + (cs.open + cs.inProgress) +
    (cs.avgCloseHours !== null ? ', average time to close ' + cs.avgCloseHours + ' h' : '') + '.';
}
function dashboard_(req, user) {
  var b = loadBundle_(), tn = nowInfo_();
  var month = tn.date.slice(0, 7);
  var since = addDays_(month + '-01', -7);
  var rows = inspLight_(since);
  var idx = inspIndex_(rows);
  var concerns = table_('Concerns');
  var roomsMonth = [], tdue = 0, tdone = 0;
  b.rooms.filter(function (r) { return r.active; }).forEach(function (room) {
    var md = monthData_(b, room, month, idx, tn, 'name');
    tdue += md.totals.due; tdone += md.totals.done;
    roomsMonth.push(Object.assign(roomOut_(room), { totals: md.totals }));
  });
  var todayRows = rows.filter(function (r) { return txt_(r.date) === tn.date; });
  var byUser = {};
  rows.filter(function (r) { return txt_(r.date).slice(0, 7) === month; }).forEach(function (r) {
    var n = txt_(r.userName); var u = byUser[n] = byUser[n] || { name: n, count: 0, late: 0 };
    u.count++; if (txt_(r.windowStatus) === 'Late') u.late++;
  });
  // inspections submitted very close together by the same person
  var fast = [], perUser = {};
  todayRows.slice().sort(function (a, c) { return txt_(a.ts) < txt_(c.ts) ? -1 : 1; }).forEach(function (r) {
    var u = txt_(r.userId), prev = perUser[u];
    if (prev) {
      var gap = (parseLocal_(txt_(r.ts)) - parseLocal_(txt_(prev.ts))) / 1000;
      if (gap < 90) fast.push({ name: txt_(r.userName), gapSec: Math.round(gap), rooms: [txt_(prev.roomId), txt_(r.roomId)], ts: txt_(r.ts) });
    }
    perUser[u] = r;
  });
  var monthCon = concerns.filter(function (r) { return txt_(r.ts).slice(0, 7) === month; });
  var byRoom = {};
  monthCon.forEach(function (r) { var k = txt_(r.roomId); byRoom[k] = (byRoom[k] || 0) + 1; });
  var repeat = Object.keys(byRoom).map(function (k) { return { room: roomOut_(b.roomMap[k] || { roomId: k, nameEn: k, nameId: k, nameMs: k }), count: byRoom[k] }; })
    .sort(function (a, c) { return c.count - a.count; }).slice(0, 5);
  return {
    today: tn.date, month: month, todayRooms: todayView_(b, tn, idx),
    month_: { due: tdue, done: tdone, pct: tdue ? Math.round(tdone * 100 / tdue) : null },
    rooms: roomsMonth,
    concerns: Object.assign(concernStats_(concerns, month + '-01 00:00:00', month + '-31 23:59:59'), { repeat: repeat }),
    byUser: Object.keys(byUser).map(function (k) { return byUser[k]; }).sort(function (a, c) { return c.count - a.count; }),
    fast: fast,
    weeklyText: weeklyText_(b, tn, idx, concerns)
  };
}

/* ============================ web app entry points ============================ */

var PUBLIC_ACTIONS = {
  config: function () { return configPublic_(); },
  users: function () {
    return { users: table_('Users').filter(function (r) { return bool_(r.active); }).map(function (r) { return { userId: txt_(r.userId), name: txt_(r.name) }; }) };
  },
  login: login_,
  roomMonth: function (req) { return roomMonth_(req, optionalUser_(req)); },
  concernCreate: concernCreate_,
  concernStatus: concernStatus_
};
var STAFF_ACTIONS = {
  today:            [HK_ROLES_ALL, today_],
  pulse:            [HK_ROLES_ALL, pulse_],
  startInspection:  [HK_ROLES_ALL, startInspection_],
  submitInspection: [HK_ROLES_ALL, submitInspection_],
  concerns:         [HK_ROLES_ALL, concernsList_],
  concernUpdate:    [HK_ROLES_ALL, concernUpdate_],
  photo:            [HK_ROLES_ALL, function (req) { return { data: getPhoto_(req.id) }; }],
  inventory:        [HK_ROLES_ALL, inventory_],
  changePin:        [HK_ROLES_ALL, changePin_],
  dashboard:        [HK_ROLES_MGR, dashboard_],
  labels:           [['admin'], labels_]
};

function route_(req) {
  var a = String(req.action || '');
  if (PUBLIC_ACTIONS[a]) return PUBLIC_ACTIONS[a](req);
  var s = STAFF_ACTIONS[a];
  if (!s) fail_('invalid', 'Unknown action.');
  return s[1](req, auth_(req, s[0]));
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function errOut_(err) {
  if (err && err.hk) return { ok: false, code: err.code, error: err.message };
  log_('ERROR ' + (err && err.stack ? err.stack : err));
  return { ok: false, code: 'server', error: 'Something went wrong. Please try again.' };
}
function doGet() { return json_({ ok: true, app: 'Mentari Housekeeping', version: APP_VERSION }); }
function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    out = route_(req);
    out.ok = true;
  } catch (err) { out = errOut_(err); }
  return json_(out);
}

/* ============================ scheduled jobs ============================ */

function alertKeys_() {
  var m = {};
  table_('Alerts').forEach(function (r) { m[txt_(r.key)] = 1; });
  return m;
}
function alertAdd_(key) { appendRow_('Alerts', { key: key, ts: stamp_() }); }
function roundLabel_(r) { return r.roundId + ' ' + r.nameEn + ' (' + r.start + ' to ' + r.end + ')'; }

/** Runs every 10 minutes: round reminders and missed-round alerts. */
function checkRounds() {
  var b = loadBundle_(), tn = nowInfo_();
  var idx = inspIndex_(inspLight_(tn.date));
  var seen = alertKeys_();
  var grace = cfgNum_(b, 'GRACE_MIN', 15);
  var remind = {}, missed = [];
  b.rooms.forEach(function (room) {
    roundsFor_(b, room, tn.date).forEach(function (r) {
      if (idx[tn.date + '|' + room.roomId + '|' + r.roundId]) return;
      var rk = 'REM|' + tn.date + '|' + r.roundId, mk = 'MISS|' + tn.date + '|' + room.roomId + '|' + r.roundId;
      if (tn.min >= r.startMin && tn.min <= r.endMin && !seen[rk]) {
        (remind[r.roundId] = remind[r.roundId] || { round: r, rooms: [] }).rooms.push(room);
      }
      if (tn.min > r.endMin + grace && tn.min <= r.endMin + grace + 180 && !seen[mk]) missed.push({ room: room, round: r, key: mk });
    });
  });
  Object.keys(remind).forEach(function (id) {
    var g = remind[id];
    var names = g.rooms.map(function (r) { return r.nameEn; }).join(', ');
    var subject = 'Housekeeping round due: ' + g.round.nameEn + ' (' + g.round.start + ' to ' + g.round.end + ')';
    telegram_(subject + '\nRooms: ' + names);
    if (b.cfg.REMINDER_EMAILS) {
      mail_(b.cfg.REMINDER_EMAILS, subject, emailShell_(b, 'Round due now', '<p>' + esc_(g.round.nameEn) + ', ' + esc_(g.round.start) + ' to ' + esc_(g.round.end) + '</p><p>Rooms: ' + esc_(names) + '</p><p>Scan each room QR in the app to start.</p>'));
    }
    alertAdd_('REM|' + tn.date + '|' + id);
  });
  if (missed.length) {
    var rows = missed.map(function (m) {
      return '<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">' + esc_(m.room.nameEn) + '</td><td style="padding:4px 8px;border-bottom:1px solid #eee">' + esc_(roundLabel_(m.round)) + '</td></tr>';
    }).join('');
    var subj = '[Housekeeping] ' + missed.length + ' round' + (missed.length > 1 ? 's' : '') + ' not inspected';
    mail_(b.cfg.OFFICE_EMAILS, subj, emailShell_(b, 'Rounds not inspected', '<table style="border-collapse:collapse;width:100%"><tr><th align="left">Room</th><th align="left">Round</th></tr>' + rows + '</table>'));
    telegram_(subj + '\n' + missed.map(function (m) { return m.room.nameEn + ' ' + m.round.roundId; }).join(', '));
    missed.forEach(function (m) { alertAdd_(m.key); });
  }
}

/** Runs once a day: summary email to the office staff. */
function dailySummary() {
  var b = loadBundle_(), tn = nowInfo_();
  var rowsToday = inspLight_(tn.date).filter(function (r) { return txt_(r.date) === tn.date; });
  var idx = inspIndex_(rowsToday);
  var any = false, done = 0, due = 0, late = 0, missedRows = [];
  b.rooms.forEach(function (room) {
    roundsFor_(b, room, tn.date).forEach(function (r) {
      any = true;
      var st = stateOf_(r, tn.date, idx[tn.date + '|' + room.roomId + '|' + r.roundId], tn);
      if (st === 'done' || st === 'late') { done++; due++; if (st === 'late') late++; }
      else if (st === 'missed') { due++; missedRows.push(room.nameEn + ' ' + r.roundId); }
    });
  });
  if (any) {
    var nd = 0, ac = 0, rf = 0;
    rowsToday.forEach(function (r) { try { var c = JSON.parse(txt_(r.counts)); nd += c.nd || 0; ac += c.ac || 0; rf += c.rf || 0; } catch (e) {} });
    var cs = concernStats_(table_('Concerns'), tn.date + ' 00:00:00', tn.date + ' 23:59:59');
    var html = emailShell_(b, 'Daily summary ' + tn.date,
      '<p>Rounds inspected: <b>' + done + ' of ' + due + '</b>' + (due ? ' (' + Math.round(done * 100 / due) + '%)' : '') + ', late ' + late + ', missed ' + missedRows.length + '</p>' +
      (missedRows.length ? '<p>Missed: ' + esc_(missedRows.join(', ')) + '</p>' : '') +
      '<p>Items marked not done: ' + nd + ', needs action: ' + ac + ', needs refill: ' + rf + '</p>' +
      '<p>Concerns raised today: ' + cs.raised + ', closed today: ' + cs.closed + ', open now: ' + (cs.open + cs.inProgress) + '</p>');
    mail_(b.cfg.OFFICE_EMAILS, '[Housekeeping] Daily summary ' + tn.date + ': ' + done + ' of ' + due + ' rounds', html);
    telegram_('Housekeeping daily summary ' + tn.date + ': ' + done + ' of ' + due + ' rounds inspected, ' + missedRows.length + ' missed, ' + (cs.open + cs.inProgress) + ' concerns open.');
  }
  // keep the Alerts sheet small
  var sh = sheet_('Alerts'), last = sh.getLastRow();
  if (last > 400) sh.deleteRows(2, last - 300);
}

/* ============================ sheet menu ============================ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Housekeeping')
    .addItem('1. Setup (first time only)', 'menuSetup')
    .addItem('2. Install reminders and alerts', 'menuInstallTriggers')
    .addSeparator()
    .addItem('Set or reset a PIN', 'menuSetPin')
    .addItem('Send a test email', 'menuTestEmail')
    .addItem('Telegram alerts (optional)', 'menuTelegram')
    .addItem('Check everything', 'menuCheck')
    .addToUi();
}
function menuSetup() {
  var ui = SpreadsheetApp.getUi();
  var res = setup_(SpreadsheetApp.getActiveSpreadsheet());
  if (res.pins.length) {
    var lines = res.pins.map(function (p) { return p.name + ' (' + p.role + ')  PIN ' + p.pin; }).join('\n');
    ui.alert('Setup complete', 'Write these PINs down now, they are shown only once.\nChange names in the Users sheet, and use Housekeeping > Set or reset a PIN to change a PIN.\n\n' + lines, ui.ButtonSet.OK);
  } else {
    ui.alert('Setup checked', 'Everything was already set up. Nothing was overwritten.', ui.ButtonSet.OK);
  }
}
function menuInstallTriggers() {
  var ui = SpreadsheetApp.getUi(), b = loadBundle_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'checkRounds' || f === 'dailySummary') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkRounds').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('dailySummary').timeBased().everyDays(1).atHour(cfgNum_(b, 'DAILY_SUMMARY_HOUR', 18)).create();
  ui.alert('Installed', 'Round reminders and missed-round alerts run every 10 minutes. The daily summary runs at ' + cfgNum_(b, 'DAILY_SUMMARY_HOUR', 18) + ':00.', ui.ButtonSet.OK);
}
function menuSetPin() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('Set or reset a PIN', 'Enter the user ID from the Users sheet (for example U03):', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var uid = a.getResponseText().trim();
  var row = findRow_('Users', uid);
  if (!row) { ui.alert('User ' + uid + ' was not found.'); return; }
  var p = ui.prompt('New PIN for ' + uid, 'Enter 4 to 6 digits:', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var pin = p.getResponseText().trim();
  if (!/^\d{4,6}$/.test(pin)) { ui.alert('The PIN must be 4 to 6 digits.'); return; }
  var salt = sleepRand_().slice(0, 12);
  updateCells_('Users', row, { salt: salt, pinHash: hashPin_(salt, pin) });
  ui.alert('PIN updated for ' + uid + '.');
}
function menuTestEmail() {
  var ui = SpreadsheetApp.getUi(), b = loadBundle_();
  if (!b.cfg.OFFICE_EMAILS) { ui.alert('Put the office staff emails in the Config sheet first (OFFICE_EMAILS).'); return; }
  var ok = mail_(b.cfg.OFFICE_EMAILS, '[Housekeeping] Test email', emailShell_(b, 'Test email', '<p>If you can read this, housekeeping emails work.</p>'));
  ui.alert(ok ? 'Test email sent to ' + b.cfg.OFFICE_EMAILS : 'The email could not be sent. Check the addresses in Config.');
}
function menuTelegram() {
  var ui = SpreadsheetApp.getUi();
  var t = ui.prompt('Telegram bot token', 'Paste the token from BotFather (leave empty to switch Telegram off):', ui.ButtonSet.OK_CANCEL);
  if (t.getSelectedButton() !== ui.Button.OK) return;
  var token = t.getResponseText().trim();
  if (!token) { props_().deleteProperty('TG_TOKEN'); props_().deleteProperty('TG_CHAT'); ui.alert('Telegram is off.'); return; }
  var c = ui.prompt('Telegram chat ID', 'Enter the chat or group ID that should receive the alerts:', ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  props_().setProperty('TG_TOKEN', token); props_().setProperty('TG_CHAT', c.getResponseText().trim());
  ui.alert(telegram_('Mentari Housekeeping: Telegram test message') ? 'Test message sent.' : 'Could not send. Check the token and chat ID.');
}
function menuCheck() {
  var ui = SpreadsheetApp.getUi(), lines = [], b;
  try { b = loadBundle_(); } catch (e) { ui.alert('Run Housekeeping > Setup first.'); return; }
  lines.push('Rooms: ' + b.rooms.length + ', rounds: ' + b.roundList.length + ', checklist templates: ' + Object.keys(b.cl).length);
  lines.push('Users: ' + table_('Users').length);
  lines.push('Office emails: ' + (b.cfg.OFFICE_EMAILS || 'NOT SET (Config sheet)'));
  lines.push('App address (APP_URL): ' + (b.cfg.APP_URL || 'not set (only used for links in emails)'));
  var trig = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  lines.push('Reminder jobs installed: ' + (trig.indexOf('checkRounds') >= 0 && trig.indexOf('dailySummary') >= 0 ? 'yes' : 'NO (run step 2)'));
  var url = ''; try { url = ScriptApp.getService().getUrl(); } catch (e2) {}
  lines.push('Web app address: ' + (url || 'not deployed yet'));
  lines.push('Emails left today: ' + MailApp.getRemainingDailyQuota());
  lines.push('Telegram: ' + (props_().getProperty('TG_TOKEN') ? 'on' : 'off'));
  ui.alert('Check', lines.join('\n'), ui.ButtonSet.OK);
}
