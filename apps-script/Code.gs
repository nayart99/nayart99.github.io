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
//   KASHIER_MERCHANT_ID Kashier merchant ID (MID-xxx-xxx)            – online card / wallet payments
//   KASHIER_SECRET_KEY  Kashier secret key (dashboard → Integrations)
//   KASHIER_API_KEY     Kashier Payment API key (dashboard → Integrations)
//   KASHIER_MODE        test or live (default test)
const DEFAULTS = {
  SHEET_ID: '1w8IP62nrk7jwDoGb30MAtT_0u2LG1TyIHg50WYt0GDk', // the NAY ART Orders spreadsheet
  DASHBOARD_PASSWORD: '',
  NOTIFY_EMAIL: '',
  WHATSAPP_PHONE: '201033668842',
  TEXTMEBOT_KEY: '',
  CALLMEBOT_KEY: '',
  KASHIER_MODE: 'test',
  SITE_URL: 'https://nayarts.com',
};
const DASHBOARD_URL = 'https://nayarts.com/admin/';
const PHOTOS_FOLDER_NAME = 'NAY ART – Customer photos';
function book() { return SpreadsheetApp.openById(cfg('SHEET_ID')); }
function cfg(k) { return PropertiesService.getScriptProperties().getProperty(k) || DEFAULTS[k] || ''; }
// ======================

const STATUSES = ['جديد', 'تم التأكيد', 'بانتظار موافقة التصميم', 'قيد التجهيز', 'تم الشحن', 'تم التسليم', 'ملغي'];
const CANCELLED = 'ملغي';

const ORDERS_HEADERS = ['Date', 'Order ID', 'Status', 'Name', 'Phone', 'Governorate', 'Address', 'Payment', 'Items', 'Units', 'Subtotal (EGP)', 'Delivery (EGP)', 'Total (EGP)', 'Custom photos', 'Customer notes', 'Internal notes', 'Last update', 'Language', 'Source', 'Medium', 'Campaign', 'Landing page', 'Referrer', 'Items JSON', 'Photo IDs', 'Thumbs', 'Additional phone', 'Delivery latitude', 'Delivery longitude', 'Delivery map', 'Payment status', 'Payment ref', 'Kashier session', 'Transfer proof', 'Transfer ref', 'Transfer hash', 'Proof check'];
const C = {}; ORDERS_HEADERS.forEach(function (h, i) { C[h] = i; });
const ITEMS_HEADERS = ['Date', 'Order ID', 'Month', 'Product', 'Option', 'Qty', 'Unit price (EGP)', 'Line total (EGP)', 'Designer notes'];
const SUBS_HEADERS = ['Date', 'Email', 'Language', 'Source'];

/* ---------------- web endpoints ---------------- */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data && data.data && data.event && !data.type) return json(kashierWebhook(data));
    if (data.type === 'order') return json(saveOrder(data));
    if (data.type === 'pay_verify') return json(payVerify(data));
    if (data.type === 'pay_retry') return json(payRetry(data));
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
  if (['cod', 'instapay', 'vodafone', 'kashier'].indexOf(o.payment) < 0) return 'invalid_payment';
  if (o.payment === 'kashier' && !kashierReady()) return 'online_payment_unavailable';
  if ((o.payment === 'instapay' || o.payment === 'vodafone') && !/^data:image\/(jpeg|png|webp);base64,/.test(String((o.transfer || {}).data || ''))) return 'transfer_proof_required';
  if (o.items.some(function(i) { return i.custom || i.slug === 'custom'; }) && o.payment === 'cod') return 'custom_prepayment_required';
  return '';
}

function saveOrder(o) {
  const invalid = validateOrder(o);
  if (invalid) return { ok: false, error: invalid };
  // Automatic check of the transfer screenshot (OCR + duplicate detection). Clear junk is refused at checkout.
  let proofCheck = null;
  if (o.transfer && o.transfer.data && !findRow(sheet(book(), 'Orders', ORDERS_HEADERS), o.id)) {
    proofCheck = checkProof(o);
    if (proofCheck.level === 'reject') return { ok: false, error: 'proof_rejected' };
  }
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

    // transfer screenshot (InstaPay / Vodafone Cash) → Drive
    let proofId = '', proofLink = '';
    if (o.transfer && o.transfer.data) {
      try {
        const pm = String(o.transfer.data).match(/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/);
        if (pm && pm[2].length < 8000000) {
          const pf = folder().createFile(Utilities.newBlob(Utilities.base64Decode(pm[2]), pm[1], o.id + '-transfer.' + (pm[1].split('/')[1] === 'jpeg' ? 'jpg' : pm[1].split('/')[1])));
          pf.setDescription('NAY ART transfer proof ' + o.id);
          proofId = pf.getId(); proofLink = pf.getUrl();
        }
      } catch (err) { proofLink = 'Proof failed: ' + err; }
    }

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
    row[C['Payment status']] = o.payment === 'kashier' ? 'Awaiting online payment' : proofId ? 'Transfer submitted' : hasCustom ? 'Awaiting full payment' : 'Unconfirmed';
    row[C['Transfer proof']] = proofId; row[C['Transfer ref']] = String((o.transfer || {}).ref || '').slice(0, 60);
    if (proofCheck) { row[C['Transfer hash']] = proofCheck.hash; row[C['Proof check']] = proofCheck.level + (proofCheck.reasons.length ? ': ' + proofCheck.reasons.join(' · ') : ''); }
    orders.appendRow(row);
    (o.items || []).forEach(function (i) {
      items.appendRow([when, o.id, month, i.name, i.display || i.option, i.qty, i.price, i.line, i.note || '']);
    });
    updateMonthly(ss);

    notifyOwner(o, itemText, hasCustom, links, proofLink, proofCheck);
    if (o.payment === 'kashier') {
      const pay = kashierSession(o.id, o.id, Number(o.total || 0), o.lang, (o.customer || {}).phone);
      if (pay.url) setOrderField(orders, o.id, { 'Kashier session': pay.sessionId });
      return { ok: true, id: o.id, payUrl: pay.url || '', payError: pay.error || '' };
    }
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

/* ---------------- transfer screenshot check ---------------- */

const PROOF_WORDS = /instapay|insta pay|انستا|إنستا|انستاباي|vodafone|فودافون|cash|كاش|transfer|تحويل|حوال|successful|success|completed|بنجاح|ناجح|تمت|تم ال|sent|reference|ref\b|مرجع|egp|جنيه|ج\.م|amount|المبلغ|wallet|محفظ|ipa\b/i;

/** Returns { level: 'ok' | 'warn' | 'bad' | 'reject' | 'unchecked', reasons: [], hash, text }. */
function checkProof(o) {
  const out = { level: 'ok', reasons: [], hash: '', text: '' };
  const m = String((o.transfer || {}).data || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/);
  if (!m) return { level: 'reject', reasons: ['ليست صورة'], hash: '', text: '' };
  const bytes = Utilities.base64Decode(m[2]);
  out.hash = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));

  // the same screenshot or reference number already used on another order
  try {
    const sh = sheet(book(), 'Orders', ORDERS_HEADERS);
    if (sh.getLastRow() > 1) {
      const vals = sh.getRange(2, 1, sh.getLastRow() - 1, ORDERS_HEADERS.length).getValues();
      const ref = String((o.transfer || {}).ref || '').replace(/\s/g, '');
      vals.forEach(function (v) {
        if (String(v[C['Order ID']]) === String(o.id)) return;
        if (v[C['Transfer hash']] && v[C['Transfer hash']] === out.hash) out.reasons.push('نفس صورة التحويل اتبعتت قبل كده في طلب ' + v[C['Order ID']]);
        else if (ref.length >= 4 && String(v[C['Transfer ref']]).replace(/\s/g, '') === ref) out.reasons.push('رقم العملية ده اتستخدم قبل كده في طلب ' + v[C['Order ID']]);
      });
      if (out.reasons.length) out.level = 'bad';
    }
  } catch (err) {}

  let text = '';
  try { text = ocrText(Utilities.newBlob(bytes, m[1] === 'image/webp' ? 'image/jpeg' : m[1], 'proof')); }
  catch (err) { if (out.level === 'ok') { out.level = 'unchecked'; out.reasons.push('تعذّر الفحص الآلي للصورة'); } return out; }
  out.text = text.slice(0, 1500);
  const norm = text.replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); }).replace(/[,٬،]/g, '');
  const digits = norm.replace(/\D/g, '');
  const total = Math.round(Number(o.total || 0));
  const amountOk = total > 0 && new RegExp('(^|[^\\d])' + total + '([.٫]0+)?([^\\d]|$)').test(norm);
  const words = PROOF_WORDS.test(norm);
  const pay = String(cfg('PAY_NUMBER') || '01033668842').replace(/\D/g, '');
  const toOk = pay && (digits.indexOf(pay.slice(1)) >= 0 || norm.indexOf(pay.slice(-4)) >= 0);

  if (!norm.trim() || (!words && !amountOk && !toOk)) {
    out.level = 'reject'; out.reasons.push('الصورة لا تبدو إيصال تحويل');
    return out;
  }
  if (!amountOk) { out.level = 'bad'; out.reasons.push('المبلغ ' + total + ' ج.م مش ظاهر في الصورة'); }
  if (!toOk && out.level === 'ok') { out.level = 'warn'; }
  if (!toOk) out.reasons.push('رقم المحفظة/InstaPay بتاعنا مش ظاهر في الصورة');
  return out;
}

/** OCR through Google Drive: upload the image as a Google Doc, export its text, then move the temp doc to trash. */
function ocrText(blob) {
  const boundary = 'nayart' + Date.now();
  const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name: 'nay-ocr-tmp', mimeType: 'application/vnd.google-apps.document' }) +
    '\r\n--' + boundary + '\r\nContent-Type: ' + blob.getContentType() + '\r\n\r\n';
  const payload = Utilities.newBlob(head).getBytes().concat(blob.getBytes()).concat(Utilities.newBlob('\r\n--' + boundary + '--').getBytes());
  const auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  const up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=ar&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: payload, headers: auth, muteHttpExceptions: true });
  if (up.getResponseCode() !== 200) throw new Error('ocr upload ' + up.getResponseCode() + ' ' + up.getContentText().slice(0, 200));
  const id = JSON.parse(up.getContentText()).id;
  try {
    const ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', { headers: auth, muteHttpExceptions: true });
    if (ex.getResponseCode() !== 200) throw new Error('ocr export ' + ex.getResponseCode());
    return ex.getContentText('UTF-8');
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (err) {}
  }
}

/** Run from the editor to test the screenshot check on a sample image. */
function testProofCheck() {
  const url = 'https://raw.githubusercontent.com/nayart99/nayart99.github.io/main/apps-script/sample-transfer.jpg';
  const b = UrlFetchApp.fetch(url).getBlob();
  const r = checkProof({ id: 'TEST', total: 2320, transfer: { data: 'data:image/jpeg;base64,' + Utilities.base64Encode(b.getBytes()) } });
  Logger.log(JSON.stringify(r));
  const junk = Utilities.newBlob(Utilities.base64Decode('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), 'image/jpeg');
  Logger.log(JSON.stringify(checkProof({ id: 'TEST2', total: 2320, transfer: { data: 'data:image/jpeg;base64,' + Utilities.base64Encode(junk.getBytes()) } })));
}

/* ---------------- notifications ---------------- */

function notifyOwner(o, itemText, hasCustom, links, proofLink, proofCheck) {
  const c = o.customer || {};
  const flag = proofCheck && proofCheck.level === 'bad' ? '🔴 *تنبيه: صورة التحويل فيها مشكلة* — ' + proofCheck.reasons.join(' · ') + '\n' : proofCheck && proofCheck.level === 'warn' ? '🟠 راجع صورة التحويل كويس: ' + proofCheck.reasons.join(' · ') + '\n' : '';
  const wa = '🔔 *طلب جديد على NAY ART*\n' +
    'رقم الطلب: ' + o.id + '\n' +
    'العميل: ' + (c.name || '') + ' – ' + (c.city || '') + '\n' +
    'الإجمالي: ' + o.total + ' ج.م' + (hasCustom ? '\n📷 لوحة من صورة العميل' : '') + '\n\n' +
    'هاتف التواصل: ' + (c.phone || '') + (c.phone_extra ? '\nهاتف إضافي: ' + c.phone_extra : '') + '\n' +
    (deliveryMap(c) ? 'موقع التوصيل: ' + deliveryMap(c) + '\n' : '') +
    (proofLink ? '💳 العميل رفع صورة التحويل (' + (o.payment_label || o.payment) + ') — راجعها وأكد وصول المبلغ من اللوحة.\n' + flag : hasCustom ? '⚠️ سداد المبلغ كاملًا وتأكيد استلامه قبل التصميم والتنفيذ.\n' : '') +
    'افتح لوحة الطلبات:\n' + DASHBOARD_URL;
  sendWhatsApp(wa);

  try {
    MailApp.sendEmail({
      to: cfg('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail(),
      subject: 'طلب جديد ' + o.id + ' – ' + o.total + ' ج.م',
      body: 'طلب جديد على NAY ART\n\nرقم الطلب: ' + o.id + '\n\n' + itemText +
        '\n\nالتوصيل: ' + o.delivery + ' ج.م\nالإجمالي: ' + o.total + ' ج.م\nالدفع: ' + (o.payment_label || o.payment) +
        '\n\n' + (c.name || '') + '\n' + (c.phone || '') + (c.phone_extra ? '\nهاتف إضافي: ' + c.phone_extra : '') + (deliveryMap(c) ? '\nالموقع: ' + deliveryMap(c) : '') + (hasCustom ? '\nيشترط سداد المبلغ كاملًا قبل التنفيذ.' : '') + '\n' + (c.city || '') + ' – ' + (c.address || '') + (c.notes ? '\nملاحظات: ' + c.notes : '') +
        (links.length ? '\n\nصورة العميل:\n' + links.join('\n') : '') + (proofLink ? '\n\nصورة التحويل (راجعها قبل التأكيد):\n' + proofLink + (flag ? '\n' + flag.replace(/\*/g, '') : '') + ((o.transfer || {}).ref ? '\nرقم العملية: ' + o.transfer.ref : '') : '') + '\n\nلوحة الطلبات: ' + DASHBOARD_URL,
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

/* ---------------- Kashier online payments ---------------- */

function kashierReady() { return !!(cfg('KASHIER_MERCHANT_ID') && cfg('KASHIER_SECRET_KEY') && cfg('KASHIER_API_KEY')); }
function kashierBase() { return cfg('KASHIER_MODE') === 'live' ? 'https://api.kashier.io' : 'https://test-api.kashier.io'; }
function hex(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function kashierLog(kind, detail) {
  try { sheet(book(), 'Payments log', ['Date', 'Kind', 'Detail']).appendRow([new Date(), kind, String(detail).slice(0, 4000)]); } catch (e) {}
}
function setOrderField(sh, id, fields) {
  const r = findRow(sh, id); if (!r) return 0;
  Object.keys(fields).forEach(function (h) { sh.getRange(r, C[h] + 1).setValue(fields[h]); });
  sh.getRange(r, C['Last update'] + 1).setValue(new Date());
  return r;
}

/** Creates a Kashier hosted payment page for an order. kashierOrder must be unique per attempt. */
function kashierSession(orderId, kashierOrder, amount, lang, phone) {
  if (!kashierReady()) return { error: 'not_configured' };
  const back = cfg('SITE_URL') + (lang === 'ar' ? '/ar' : '') + '/pay/?o=' + encodeURIComponent(orderId);
  const body = {
    expireAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    maxFailureAttempts: 3, paymentType: 'credit', amount: amount.toFixed(2), currency: 'EGP',
    order: kashierOrder, merchantId: cfg('KASHIER_MERCHANT_ID'), merchantRedirect: encodeURIComponent(back),
    serverWebhook: ScriptApp.getService().getUrl(), type: 'external', display: lang === 'ar' ? 'ar' : 'en',
    allowedMethods: 'card,wallet', brandColor: '#7A1F2B', failureRedirect: true, mode: cfg('KASHIER_MODE') === 'live' ? 'live' : 'test',
    description: 'NAY ART order ' + orderId, customer: { reference: String(phone || orderId) },
  };
  try {
    const res = UrlFetchApp.fetch(kashierBase() + '/v3/payment/sessions', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: cfg('KASHIER_SECRET_KEY'), 'api-key': cfg('KASHIER_API_KEY') }, payload: JSON.stringify(body),
    });
    const j = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() >= 300 || !j.sessionUrl) { kashierLog('session_error', res.getResponseCode() + ' ' + res.getContentText()); return { error: 'session_failed' }; }
    return { url: j.sessionUrl, sessionId: j._id };
  } catch (err) { kashierLog('session_exception', err); return { error: 'session_failed' }; }
}

/** Kashier redirect signature: fixed parameter order, missing values signed as "null", HMAC-SHA256 with the Payment API key. */
function redirectSignatureOk(p) {
  const keys = ['paymentStatus', 'cardDataToken', 'maskedCard', 'merchantOrderId', 'orderId', 'cardBrand', 'orderReference', 'transactionId', 'amount', 'currency'];
  const sig = String(p.signature || '').toLowerCase(); if (!sig) return false;
  const build = function (enc) { return keys.map(function (k) { const v = p[k] == null || p[k] === '' ? 'null' : String(p[k]); return k + '=' + (enc ? encodeURIComponent(v) : v); }).join('&'); };
  return [build(false), build(true)].some(function (b) { return hex(Utilities.computeHmacSha256Signature(b, cfg('KASHIER_API_KEY'))) === sig; });
}

function markPaid(id, ref, amount, how) {
  const ss = book(), sh = sheet(ss, 'Orders', ORDERS_HEADERS), r = findRow(sh, id);
  if (!r) return { ok: false, error: 'not_found' };
  const row = sh.getRange(r, 1, 1, ORDERS_HEADERS.length).getValues()[0];
  if (Math.abs(Number(row[C['Total (EGP)']]) - Number(amount)) > 0.5) { kashierLog('amount_mismatch', id + ' paid ' + amount + ' expected ' + row[C['Total (EGP)']]); return { ok: false, error: 'amount_mismatch' }; }
  if (row[C['Payment status']] === 'Paid in full') return { ok: true, paid: true, already: true };
  setOrderField(sh, id, { 'Payment status': 'Paid in full', 'Payment ref': ref || '' });
  kashierLog('paid_' + how, id + ' ' + ref + ' ' + amount);
  sendWhatsApp('✅ *تم الدفع أونلاين*\nرقم الطلب: ' + id + '\nالمبلغ: ' + amount + ' ج.م\nرقم العملية: ' + (ref || '-') + '\n' + DASHBOARD_URL);
  try { MailApp.sendEmail(cfg('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail(), 'تم الدفع أونلاين – ' + id, 'تم دفع الطلب ' + id + ' أونلاين عن طريق Kashier.\nالمبلغ: ' + amount + ' ج.م\nرقم العملية: ' + (ref || '-') + '\n\n' + DASHBOARD_URL); } catch (e) {}
  return { ok: true, paid: true };
}

const baseOrderId = function (o) { return String(o || '').replace(/-R\d+$/, ''); };

/** Called by the /pay page after Kashier redirects the customer back. */
function payVerify(d) {
  const p = d.params || {}, id = baseOrderId(p.merchantOrderId || d.id);
  if (!kashierReady()) return { ok: false, error: 'not_configured' };
  if (!redirectSignatureOk(p)) { kashierLog('bad_signature', JSON.stringify(p)); return { ok: false, error: 'bad_signature' }; }
  if (String(p.paymentStatus).toUpperCase() !== 'SUCCESS') return { ok: true, paid: false, id: id, status: p.paymentStatus || '' };
  const r = markPaid(id, p.transactionId || p.orderReference || '', p.amount, 'redirect');
  r.id = id; return r;
}

/** Server-to-server notification. Apps Script can't read headers, so the payment is re-checked with Kashier before trusting it. */
function kashierWebhook(w) {
  const data = w.data || {}, id = baseOrderId(data.merchantOrderId);
  kashierLog('webhook', JSON.stringify(w).slice(0, 1500));
  if (!id || String(data.status).toUpperCase() !== 'SUCCESS' || ['pay', 'capture'].indexOf(w.event) < 0) return { ok: true };
  const sh = sheet(book(), 'Orders', ORDERS_HEADERS), r = findRow(sh, id); if (!r) return { ok: true };
  const session = sh.getRange(r, C['Kashier session'] + 1).getValue(); if (!session) return { ok: true };
  try {
    const res = UrlFetchApp.fetch(kashierBase() + '/v3/payment/sessions/' + encodeURIComponent(session) + '/payment', { headers: { Authorization: cfg('KASHIER_SECRET_KEY') }, muteHttpExceptions: true });
    const txt = res.getContentText(); kashierLog('webhook_check', txt.slice(0, 1500));
    const j = JSON.parse(txt || '{}'), st = String((j.data || j).status || '').toUpperCase();
    if (['PAID', 'SUCCESS', 'CAPTURED', 'COMPLETED'].indexOf(st) >= 0) markPaid(id, data.transactionId || data.orderReference || '', data.amount, 'webhook');
  } catch (err) { kashierLog('webhook_exception', err); }
  return { ok: true };
}

/** New payment page for an order that wasn't paid (e.g. card declined). */
function payRetry(d) {
  const sh = sheet(book(), 'Orders', ORDERS_HEADERS), r = findRow(sh, d.id);
  if (!r) return { ok: false, error: 'not_found' };
  const row = sh.getRange(r, 1, 1, ORDERS_HEADERS.length).getValues()[0];
  if (row[C['Payment status']] === 'Paid in full') return { ok: true, paid: true };
  if (row[C['Status']] === CANCELLED) return { ok: false, error: 'cancelled' };
  const cache = CacheService.getScriptCache(), k = 'retry_' + d.id, n = Number(cache.get(k) || 0) + 1;
  if (n > 6) return { ok: false, error: 'too_many' };
  cache.put(k, String(n), 21600);
  const pay = kashierSession(d.id, d.id + '-R' + n + String(Date.now()).slice(-4), Number(row[C['Total (EGP)']]), row[C['Language']], String(row[C['Phone']]).replace(/^'/, ''));
  if (!pay.url) return { ok: false, error: pay.error };
  setOrderField(sh, d.id, { 'Kashier session': pay.sessionId });
  return { ok: true, payUrl: pay.url };
}

/** Run from the editor after adding the Kashier keys: creates a 1 EGP test session and logs its link. */
function testKashier() {
  const r = kashierSession('TEST-' + Date.now(), 'TEST-' + Date.now(), 1, 'ar', '01000000000');
  Logger.log(JSON.stringify(r));
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
  if (d.action === 'archive') {
    // Moves orders out of the dashboard into "Archived orders" (nothing is lost; rows can be copied back).
    const ids = [].concat(d.ids || d.id || []).map(String).slice(0, 200);
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const arch = sheet(ss, 'Archived orders', ORDERS_HEADERS.concat(['Archived at']));
      const items = sheet(ss, 'Order items', ITEMS_HEADERS), archItems = sheet(ss, 'Archived items', ITEMS_HEADERS);
      let n = 0;
      ids.forEach(function (id) {
        const r = findRow(sh, id); if (!r) return;
        const row = sh.getRange(r, 1, 1, ORDERS_HEADERS.length).getValues()[0];
        ['Phone', 'Additional phone'].forEach(function (h) { if (row[C[h]] !== '') row[C[h]] = "'" + String(row[C[h]]).replace(/^'/, ''); });
        arch.appendRow(row.concat([new Date()]));
        sh.deleteRow(r); n++;
        if (items.getLastRow() > 1) {
          const vals = items.getRange(2, 2, items.getLastRow() - 1, 1).getValues();
          for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]) === id) { archItems.appendRow(items.getRange(i + 2, 1, 1, ITEMS_HEADERS.length).getValues()[0]); items.deleteRow(i + 2); }
        }
      });
      return { ok: true, archived: n };
    } finally { lock.releaseLock(); }
  }
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
  if (d.action === 'recheck') {
    const r = findRow(sh, d.id);
    if (!r) return { ok: false, error: 'not found' };
    const v = sh.getRange(r, 1, 1, ORDERS_HEADERS.length).getValues()[0];
    if (!v[C['Transfer proof']]) return { ok: false, error: 'no proof' };
    const blob = DriveApp.getFileById(v[C['Transfer proof']]).getBlob();
    const res = checkProof({ id: d.id, total: v[C['Total (EGP)']], transfer: { ref: v[C['Transfer ref']], data: 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes()) } });
    const level = res.level === 'reject' ? 'bad' : res.level;
    const txt = level + (res.reasons.length ? ': ' + res.reasons.join(' · ') : '');
    setOrderField(sh, d.id, { 'Transfer hash': res.hash, 'Proof check': txt });
    return { ok: true, proof_check: txt };
  }
  if (d.action === 'photo') {
    const r = findRow(sh, d.orderId);
    const ids = r ? String(sh.getRange(r, C['Photo IDs'] + 1).getValue()).split(',').concat([String(sh.getRange(r, C['Transfer proof'] + 1).getValue())]).filter(String) : [];
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
      payment_ref: v[C['Payment ref']] || '',
      transfer_proof: v[C['Transfer proof']] || '', transfer_ref: v[C['Transfer ref']] || '', proof_check: v[C['Proof check']] || '',
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
