/**
 * NAY ART – orders backend (Google Apps Script)
 *
 * - Receives every website order and saves it to the "Orders" sheet
 * - Saves customer photos (custom canvases) to a Google Drive folder
 * - Sends the owner a WhatsApp message + an email for every new order
 * - Powers the owner dashboard at https://nayarts.com/admin/ (password protected)
 * - Keeps a "Monthly" sheet with orders, revenue and top products
 *
 * Setup guide: docs/DASHBOARD-SETUP-AR.md
 */

// ====== SETTINGS ======
// Change these in Apps Script: Project Settings (gear icon) → Script properties.
// Changes there work right away, no redeploy needed. The values below are only defaults.
//   DASHBOARD_PASSWORD  password for nayarts.com/admin
//   NOTIFY_EMAIL        where new-order emails go (empty = the account that owns this script)
//   WHATSAPP_PHONE      owner's WhatsApp with country code, no + or spaces (e.g. 201033668842)
//   TEXTMEBOT_KEY       TextMeBot API key (textmebot.com, about $1/month)
//   CALLMEBOT_KEY       or a free CallMeBot API key (callmebot.com)
const DEFAULTS = {
  SHEET_ID: '1w8IP62nrk7jwDoGb30MAtT_0u2LG1TyIHg50WYt0GDk', // the NAY ART Orders spreadsheet
  DASHBOARD_PASSWORD: '',
  NOTIFY_EMAIL: '',
  WHATSAPP_PHONE: '201033668842',
  TEXTMEBOT_KEY: '',
  CALLMEBOT_KEY: '',
};
const DASHBOARD_URL = 'https://nayarts.com/admin/';
const PHOTOS_FOLDER_NAME = 'NAY ART – Customer photos';
function book() { return SpreadsheetApp.openById(cfg('SHEET_ID')); }
function cfg(k) { return PropertiesService.getScriptProperties().getProperty(k) || DEFAULTS[k] || ''; }
// ======================

const STATUSES = ['جديد', 'تم التأكيد', 'بانتظار موافقة التصميم', 'قيد التجهيز', 'تم الشحن', 'تم التسليم', 'ملغي'];
const CANCELLED = 'ملغي';

const ORDERS_HEADERS = ['Date', 'Order ID', 'Status', 'Name', 'Phone', 'Governorate', 'Address', 'Payment', 'Items', 'Units', 'Subtotal (EGP)', 'Delivery (EGP)', 'Total (EGP)', 'Custom photos', 'Customer notes', 'Internal notes', 'Last update', 'Language', 'Source', 'Medium', 'Campaign', 'Landing page', 'Referrer', 'Items JSON', 'Photo IDs', 'Thumbs', 'Additional phone', 'Delivery latitude', 'Delivery longitude', 'Delivery map', 'Payment status'];
const C = {}; ORDERS_HEADERS.forEach(function (h, i) { C[h] = i; });
const ITEMS_HEADERS = ['Date', 'Order ID', 'Month', 'Product', 'Option', 'Qty', 'Unit price (EGP)', 'Line total (EGP)', 'Designer notes'];
const SUBS_HEADERS = ['Date', 'Email', 'Language', 'Source'];

/* ---------------- web endpoints ---------------- */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.type === 'order') return json(saveOrder(data));
    if (data.type === 'subscribe') return json(saveSubscriber(data));
    if (data.type === 'admin') return json(admin(data));
    return json({ ok: false, error: 'unknown type' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'NAY ART orders' });
}

/* ---------------- orders ---------------- */

function deliveryMap(c) {
  const p = c.location;
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
    ? 'https://www.google.com/maps?q=' + p.lat + ',' + p.lng : '';
}

function validateOrder(o) {
  const c = o.customer || {};
  if (String(c.name || '').trim().length < 3 || String(c.address || '').trim().length < 8 || !c.city) return 'customer_required';
  if (!/^01[0125]\d{8}$/.test(c.phone || '') || (c.phone_extra && !/^01[0125]\d{8}$/.test(c.phone_extra))) return 'invalid_phone';
  if (!deliveryMap(c)) return 'location_required';
  if (!Array.isArray(o.items) || !o.items.length) return 'items_required';
  if (['cod', 'instapay', 'vodafone'].indexOf(o.payment) < 0) return 'invalid_payment';
  if (o.items.some(function(i) { return i.custom || i.slug === 'custom'; }) && o.payment === 'cod') return 'custom_prepayment_required';
  return '';
}

function saveOrder(o) {
  const invalid = validateOrder(o);
  if (invalid) return { ok: false, error: invalid };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = book();
    const orders = sheet(ss, 'Orders', ORDERS_HEADERS);
    const items = sheet(ss, 'Order items', ITEMS_HEADERS);
    if (findRow(orders, o.id)) return { ok: true, id: o.id, duplicate: true };

    const when = new Date(o.created || Date.now());
    const month = Utilities.formatDate(when, 'Africa/Cairo', 'yyyy-MM');
    const thumbs = {};
    (o.items || []).forEach(function (i) { if (i.thumb) thumbs[i.key] = i.thumb; });

    // customer photos → Drive (private to the owner)
    const links = [], ids = [], thumbList = [];
    (o.photos || []).forEach(function (p, n) {
      try {
        const m = String(p.data).match(/^data:(.+?);base64,(.*)$/);
        if (!m) return;
        const ext = (m[1].split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], o.id + '-' + (n + 1) + '.' + ext);
        const file = folder().createFile(blob);
        file.setDescription('NAY ART order ' + o.id + ' – ' + ((o.customer || {}).name || ''));
        links.push(file.getUrl()); ids.push(file.getId()); thumbList.push(thumbs[p.key] || '');
      } catch (err) {
        links.push('Photo failed: ' + err);
      }
    });

    const c = o.customer || {};
    const s = o.source || {};
    const units = (o.items || []).reduce(function (n, i) { return n + Number(i.qty || 0); }, 0);
    const itemText = (o.items || []).map(function (i) { return i.name + ' (' + (i.display || i.option) + ') × ' + i.qty; }).join('\n');
    const hasCustom = (o.items || []).some(function (i) { return i.custom || i.slug === 'custom'; });
    const cleanItems = (o.items || []).map(function (i) { return { name: i.name, option: i.display || i.option, qty: i.qty, price: i.price, line: i.line, custom: !!i.custom || i.slug === 'custom', note: i.note || '' }; });

    const row = new Array(ORDERS_HEADERS.length).fill('');
    row[C['Date']] = when; row[C['Order ID']] = o.id; row[C['Status']] = STATUSES[0];
    row[C['Name']] = c.name || ''; row[C['Phone']] = "'" + (c.phone || ''); row[C['Governorate']] = c.city || ''; row[C['Address']] = c.address || '';
    row[C['Payment']] = o.payment_label || o.payment || ''; row[C['Items']] = itemText; row[C['Units']] = units;
    row[C['Subtotal (EGP)']] = Number(o.subtotal || 0); row[C['Delivery (EGP)']] = Number(o.delivery || 0); row[C['Total (EGP)']] = Number(o.total || 0);
    row[C['Custom photos']] = links.join('\n'); row[C['Customer notes']] = c.notes || ''; row[C['Last update']] = new Date();
    row[C['Language']] = o.lang || ''; row[C['Source']] = s.utm_source || (s.fbclid ? 'facebook' : s.gclid ? 'google' : '');
    row[C['Medium']] = s.utm_medium || ''; row[C['Campaign']] = s.utm_campaign || ''; row[C['Landing page']] = s.landing || ''; row[C['Referrer']] = s.referrer || '';
    row[C['Items JSON']] = JSON.stringify(cleanItems); row[C['Photo IDs']] = ids.join(','); row[C['Thumbs']] = JSON.stringify(thumbList).slice(0, 49000);
    row[C['Additional phone']] = c.phone_extra ? "'" + c.phone_extra : '';
    row[C['Delivery latitude']] = c.location.lat; row[C['Delivery longitude']] = c.location.lng;
    row[C['Delivery map']] = deliveryMap(c);
    row[C['Payment status']] = hasCustom ? 'Awaiting full payment' : 'Unconfirmed';
    orders.appendRow(row);
    (o.items || []).forEach(function (i) {
      items.appendRow([when, o.id, month, i.name, i.display || i.option, i.qty, i.price, i.line, i.note || '']);
    });
    updateMonthly(ss);

    notifyOwner(o, itemText, hasCustom, links);
    return { ok: true, id: o.id };
  } finally {
    lock.releaseLock();
  }
}

function saveSubscriber(d) {
  const ss = book();
  sheet(ss, 'Subscribers', SUBS_HEADERS).appendRow([new Date(d.created || Date.now()), d.email, d.lang, (d.source && (d.source.utm_source || d.source.referrer)) || '']);
  return { ok: true };
}

/* ---------------- notifications ---------------- */

function notifyOwner(o, itemText, hasCustom, links) {
  const c = o.customer || {};
  const wa = '🔔 *طلب جديد على NAY ART*\n' +
    'رقم الطلب: ' + o.id + '\n' +
    'العميل: ' + (c.name || '') + ' – ' + (c.city || '') + '\n' +
    'الإجمالي: ' + o.total + ' ج.م' + (hasCustom ? '\n📷 لوحة من صورة العميل' : '') + '\n\n' +
    'هاتف التواصل: ' + (c.phone || '') + (c.phone_extra ? '\nهاتف إضافي: ' + c.phone_extra : '') + '\n' +
    (deliveryMap(c) ? 'موقع التوصيل: ' + deliveryMap(c) + '\n' : '') +
    (hasCustom ? '⚠️ سداد المبلغ كاملًا وتأكيد استلامه قبل التصميم والتنفيذ.\n' : '') +
    'افتح لوحة الطلبات:\n' + DASHBOARD_URL;
  sendWhatsApp(wa);

  try {
    MailApp.sendEmail({
      to: cfg('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail(),
      subject: 'طلب جديد ' + o.id + ' – ' + o.total + ' ج.م',
      body: 'طلب جديد على NAY ART\n\nرقم الطلب: ' + o.id + '\n\n' + itemText +
        '\n\nالتوصيل: ' + o.delivery + ' ج.م\nالإجمالي: ' + o.total + ' ج.م\nالدفع: ' + (o.payment_label || o.payment) +
        '\n\n' + (c.name || '') + '\n' + (c.phone || '') + (c.phone_extra ? '\nهاتف إضافي: ' + c.phone_extra : '') + (deliveryMap(c) ? '\nالموقع: ' + deliveryMap(c) : '') + (hasCustom ? '\nيشترط سداد المبلغ كاملًا قبل التنفيذ.' : '') + '\n' + (c.city || '') + ' – ' + (c.address || '') + (c.notes ? '\nملاحظات: ' + c.notes : '') +
        (links.length ? '\n\nصورة العميل:\n' + links.join('\n') : '') + '\n\nلوحة الطلبات: ' + DASHBOARD_URL,
    });
  } catch (err) { /* email quota – the order is still saved */ }
}

function sendWhatsApp(text) {
  try {
    const TEXTMEBOT_KEY = cfg('TEXTMEBOT_KEY'), CALLMEBOT_KEY = cfg('CALLMEBOT_KEY'), WHATSAPP_PHONE = cfg('WHATSAPP_PHONE');
    if (TEXTMEBOT_KEY) {
      UrlFetchApp.fetch('https://api.textmebot.com/send.php?recipient=%2B' + WHATSAPP_PHONE + '&apikey=' + encodeURIComponent(TEXTMEBOT_KEY) + '&text=' + encodeURIComponent(text), { muteHttpExceptions: true });
    } else if (CALLMEBOT_KEY) {
      UrlFetchApp.fetch('https://api.callmebot.com/whatsapp.php?phone=%2B' + WHATSAPP_PHONE + '&apikey=' + encodeURIComponent(CALLMEBOT_KEY) + '&text=' + encodeURIComponent(text), { muteHttpExceptions: true });
    }
  } catch (err) { /* WhatsApp service down – email still goes out */ }
}

/** Run once from the editor to check WhatsApp + email work. */
function testNotify() {
  sendWhatsApp('✅ تجربة: إشعارات NAY ART شغالة.\n' + DASHBOARD_URL);
  MailApp.sendEmail(cfg('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail(), 'NAY ART – تجربة الإشعارات', 'الإشعارات شغالة.\n' + DASHBOARD_URL);
}

/* ---------------- dashboard API ---------------- */

function admin(d) {
  const cache = CacheService.getScriptCache();
  const tries = Number(cache.get('bad') || 0);
  if (tries >= 8) return { ok: false, error: 'locked' };
  const PW = cfg('DASHBOARD_PASSWORD');
  if (!PW || String(d.pw || '') !== PW) {
    cache.put('bad', String(tries + 1), 600);
    return { ok: false, error: 'auth' };
  }
  const ss = book();
  const sh = sheet(ss, 'Orders', ORDERS_HEADERS);
  if (d.action === 'list') return { ok: true, statuses: STATUSES, orders: listOrders(sh) };
  if (d.action === 'confirm_payment') {
    const r = findRow(sh, d.id);
    if (!r) return { ok: false, error: 'not found' };
    sh.getRange(r, C['Payment status'] + 1).setValue('Paid in full');
    sh.getRange(r, C['Last update'] + 1).setValue(new Date());
    return { ok: true };
  }
  if (d.action === 'update') {
    const r = findRow(sh, d.id);
    if (!r) return { ok: false, error: 'not found' };
    if (d.status != null) {
      if (STATUSES.indexOf(d.status) < 0) return { ok: false, error: 'bad status' };
      let orderItems = [];
      try { orderItems = JSON.parse(sh.getRange(r, C['Items JSON'] + 1).getValue() || '[]'); } catch (e) {}
      if (orderItems.some(function(i) { return i.custom; }) && ['بانتظار موافقة التصميم', 'قيد التجهيز', 'تم الشحن', 'تم التسليم'].indexOf(d.status) >= 0 && sh.getRange(r, C['Payment status'] + 1).getValue() !== 'Paid in full') return { ok: false, error: 'payment_required' };
      sh.getRange(r, C['Status'] + 1).setValue(d.status);
    }
    if (d.note != null) sh.getRange(r, C['Internal notes'] + 1).setValue(String(d.note).slice(0, 2000));
    sh.getRange(r, C['Last update'] + 1).setValue(new Date());
    return { ok: true };
  }
  if (d.action === 'photo') {
    const r = findRow(sh, d.orderId);
    const ids = r ? String(sh.getRange(r, C['Photo IDs'] + 1).getValue()).split(',') : [];
    if (ids.indexOf(d.fileId) < 0) return { ok: false, error: 'not found' };
    const blob = DriveApp.getFileById(d.fileId).getBlob();
    return { ok: true, data: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()), name: blob.getName() };
  }
  return { ok: false, error: 'unknown action' };
}

function listOrders(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const start = Math.max(2, sh.getLastRow() - 999); // newest 1000 orders
  const vals = sh.getRange(start, 1, sh.getLastRow() - start + 1, ORDERS_HEADERS.length).getValues();
  return vals.filter(function (v) { return v[C['Order ID']]; }).map(function (v) {
    let items = [], thumbs = [];
    try { items = JSON.parse(v[C['Items JSON']] || '[]'); } catch (e) {}
    try { thumbs = JSON.parse(v[C['Thumbs']] || '[]'); } catch (e) {}
    const ids = String(v[C['Photo IDs']] || '').split(',').filter(String);
    return {
      id: v[C['Order ID']], date: v[C['Date']] instanceof Date ? v[C['Date']].toISOString() : String(v[C['Date']]),
      status: v[C['Status']] || STATUSES[0], name: v[C['Name']], phone: String(v[C['Phone']]).replace(/^'/, ''),
      city: v[C['Governorate']], address: v[C['Address']], payment: v[C['Payment']],
      phone_extra: String(v[C['Additional phone']] || '').replace(/^'/, ''),
      location: v[C['Delivery latitude']] !== '' && v[C['Delivery longitude']] !== '' ? { lat: Number(v[C['Delivery latitude']]), lng: Number(v[C['Delivery longitude']]) } : null,
      payment_status: v[C['Payment status']] || 'Unconfirmed',
      items: items.length ? items : [{ name: v[C['Items']], option: '', qty: v[C['Units']], line: v[C['Subtotal (EGP)']] }],
      units: v[C['Units']], subtotal: v[C['Subtotal (EGP)']], delivery: v[C['Delivery (EGP)']], total: v[C['Total (EGP)']],
      notes: v[C['Customer notes']], internal: v[C['Internal notes']],
      updated: v[C['Last update']] instanceof Date ? v[C['Last update']].toISOString() : '',
      source: v[C['Source']], campaign: v[C['Campaign']],
      photos: ids.map(function (id, i) { return { id: id, thumb: thumbs[i] || '', url: 'https://drive.google.com/file/d/' + id + '/view' }; }),
    };
  }).reverse();
}

/* ---------------- sheets ---------------- */

/** Monthly summary with formulas, so it always matches the Orders sheet (cancelled orders excluded). */
function updateMonthly(ss) {
  const sh = ss.getSheetByName('Monthly') || ss.insertSheet('Monthly');
  if (sh.getRange('A1').getValue() === 'Month') return;
  sh.getRange('A1').setFormula(
    '=QUERY({ARRAYFORMULA(IF(Orders!A2:A="",,TEXT(Orders!A2:A,"yyyy-mm"))),Orders!M2:M,Orders!J2:J,Orders!C2:C},' +
    '"select Col1, count(Col1), sum(Col2), sum(Col3), avg(Col2) where Col1 is not null and Col4 <> \'' + CANCELLED + '\' group by Col1 order by Col1 desc ' +
    'label Col1 \'Month\', count(Col1) \'Orders\', sum(Col2) \'Revenue (EGP)\', sum(Col3) \'Units\', avg(Col2) \'Average order (EGP)\'",0)');
  sh.getRange('G1').setValue('Top products');
  sh.getRange('G2').setFormula('=QUERY(\'Order items\'!A2:I,"select D, sum(F), sum(H) where D is not null group by D order by sum(H) desc label D \'Product\', sum(F) \'Units\', sum(H) \'Revenue (EGP)\'",0)');
  sh.setFrozenRows(1);
}

/** Run once from the editor: creates the sheets, the photos folder, and asks for permissions. */
function setup() {
  const ss = book();
  const st = sheet(ss, 'Orders', ORDERS_HEADERS);
  sheet(ss, 'Order items', ITEMS_HEADERS);
  sheet(ss, 'Subscribers', SUBS_HEADERS);
  updateMonthly(ss);
  folder();
  st.getRange(2, C['Status'] + 1, st.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  [C['Items JSON'], C['Photo IDs'], C['Thumbs']].forEach(function (i) { st.hideColumns(i + 1); });
  const s1 = ss.getSheetByName('Sheet1'); if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true }); // asks for the "connect to external service" permission now
  if (!cfg('DASHBOARD_PASSWORD')) {
    const pw = 'nay-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    PropertiesService.getScriptProperties().setProperty('DASHBOARD_PASSWORD', pw);
    Logger.log('Dashboard password: ' + pw);
  }
}

function sheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#7A1F2B').setFontColor('#F7F3EC');
    sh.setFrozenRows(1);
  }
  // Append new fields without changing existing column positions or order history.
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  if (sh.getLastColumn() < headers.length) sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#7A1F2B').setFontColor('#F7F3EC');
  return sh;
}

function findRow(sh, id) {
  if (!id || sh.getLastRow() < 2) return 0;
  const f = sh.getRange(2, C['Order ID'] + 1, sh.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}

function folder() {
  const it = DriveApp.getFoldersByName(PHOTOS_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTOS_FOLDER_NAME);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
