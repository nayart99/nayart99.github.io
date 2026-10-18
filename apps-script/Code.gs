/**
 * NAY ART – order receiver (Google Apps Script)
 *
 * What it does:
 *  - Receives every order from the website and writes it to the "Orders" sheet
 *  - Writes one row per product to "Order items" (for product reports)
 *  - Saves custom-canvas photos to a Google Drive folder and puts the link in the sheet
 *  - Emails you each new order
 *  - Saves newsletter sign-ups to "Subscribers"
 *  - Keeps a "Monthly" summary sheet (orders, revenue, average order) up to date
 *
 * Setup: see docs/SETUP-ORDERS.md (5 minutes).
 */

// ====== CHANGE THESE ======
const NOTIFY_EMAIL = 'your-store-email@gmail.com'; // where new-order emails go
const PHOTOS_FOLDER_NAME = 'NAY ART – Custom photos';
// ==========================

const ORDERS_HEADERS = ['Date', 'Order ID', 'Status', 'Name', 'Phone', 'Governorate', 'Address', 'Payment', 'Items', 'Units', 'Subtotal (EGP)', 'Delivery (EGP)', 'Total (EGP)', 'Custom photo', 'Notes', 'Language', 'Source', 'Medium', 'Campaign', 'Landing page', 'Referrer'];
const ITEMS_HEADERS = ['Date', 'Order ID', 'Month', 'Product', 'Option', 'Qty', 'Unit price (EGP)', 'Line total (EGP)', 'Designer notes'];
const SUBS_HEADERS = ['Date', 'Email', 'Language', 'Source'];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.type === 'subscribe') return json(saveSubscriber(data));
    if (data.type === 'order') return json(saveOrder(data));
    return json({ ok: false, error: 'unknown type' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'NAY ART orders' });
}

function saveOrder(o) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orders = sheet(ss, 'Orders', ORDERS_HEADERS);
  const items = sheet(ss, 'Order items', ITEMS_HEADERS);
  const when = new Date(o.created || Date.now());
  const month = Utilities.formatDate(when, 'Africa/Cairo', 'yyyy-MM');

  // custom photos → Drive
  const photoLinks = [];
  (o.photos || []).forEach(function (p, i) {
    try {
      const m = String(p.data).match(/^data:(.+?);base64,(.*)$/);
      if (!m) return;
      const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], o.id + '-' + (i + 1) + '-' + (p.name || 'photo.jpg'));
      const file = folder().createFile(blob);
      photoLinks.push(file.getUrl());
    } catch (err) {
      photoLinks.push('Photo failed: ' + err);
    }
  });

  const c = o.customer || {};
  const s = o.source || {};
  const units = (o.items || []).reduce(function (n, i) { return n + Number(i.qty || 0); }, 0);
  const itemText = (o.items || []).map(function (i) { return i.name + ' (' + i.option + ') x' + i.qty; }).join('\n');
  orders.appendRow([when, o.id, 'New', c.name, "'" + c.phone, c.city, c.address, o.payment_label || o.payment, itemText, units, o.subtotal, o.delivery, o.total, photoLinks.join('\n'), c.notes || '', o.lang, s.utm_source || (s.fbclid ? 'facebook' : s.gclid ? 'google' : ''), s.utm_medium || '', s.utm_campaign || '', s.landing || '', s.referrer || '']);
  (o.items || []).forEach(function (i) {
    items.appendRow([when, o.id, month, i.name, i.option, i.qty, i.price, i.line, i.note || '']);
  });
  updateMonthly(ss);

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: 'New NAY ART order ' + o.id + ' – EGP ' + o.total,
      body: 'Order ' + o.id + '\n\n' + itemText + '\n\nDelivery: EGP ' + o.delivery + '\nTotal: EGP ' + o.total + '\nPayment: ' + (o.payment_label || o.payment) +
        '\n\n' + c.name + '\n' + c.phone + '\n' + c.city + ' – ' + c.address + (c.notes ? '\nNotes: ' + c.notes : '') +
        (photoLinks.length ? '\n\nCustom photo:\n' + photoLinks.join('\n') : '') + '\n\nOpen the sheet: ' + ss.getUrl(),
    });
  } catch (err) { /* email quota or address problem – the order is still saved */ }

  return { ok: true, id: o.id };
}

function saveSubscriber(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const subs = sheet(ss, 'Subscribers', SUBS_HEADERS);
  subs.appendRow([new Date(d.created || Date.now()), d.email, d.lang, (d.source && (d.source.utm_source || d.source.referrer)) || '']);
  return { ok: true };
}

/** Monthly summary built with formulas, so it always matches the Orders sheet. */
function updateMonthly(ss) {
  const sh = ss.getSheetByName('Monthly') || ss.insertSheet('Monthly');
  if (sh.getRange('A1').getValue() === 'Month') return;
  sh.getRange('A1').setFormula(
    '=QUERY({ARRAYFORMULA(IF(Orders!A2:A="",,TEXT(Orders!A2:A,"yyyy-mm"))),Orders!M2:M,Orders!J2:J},' +
    '"select Col1, count(Col1), sum(Col2), sum(Col3), avg(Col2) where Col1 is not null group by Col1 order by Col1 desc ' +
    'label Col1 \'Month\', count(Col1) \'Orders\', sum(Col2) \'Revenue (EGP)\', sum(Col3) \'Units\', avg(Col2) \'Average order (EGP)\'",0)');
  sh.getRange('G1').setValue('Top products');
  sh.getRange('G2').setFormula('=QUERY(\'Order items\'!A2:I,"select D, sum(F), sum(H) where D is not null group by D order by sum(H) desc label D \'Product\', sum(F) \'Units\', sum(H) \'Revenue (EGP)\'",0)');
  sh.setFrozenRows(1);
}

/** Run once from the editor: creates the sheets and asks for permissions. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  sheet(ss, 'Orders', ORDERS_HEADERS);
  sheet(ss, 'Order items', ITEMS_HEADERS);
  sheet(ss, 'Subscribers', SUBS_HEADERS);
  updateMonthly(ss);
  folder();
  const st = ss.getSheetByName('Orders');
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['New', 'Confirmed', 'Paid', 'Shipped', 'Delivered', 'Cancelled'], true).build();
  st.getRange('C2:C').setDataValidation(rule);
  const s1 = ss.getSheetByName('Sheet1'); if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
}

function sheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#7A1F2B').setFontColor('#F7F3EC');
    sh.setFrozenRows(1);
  }
  return sh;
}

function folder() {
  const it = DriveApp.getFoldersByName(PHOTOS_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTOS_FOLDER_NAME);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
