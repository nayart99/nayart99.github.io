// NAY ART – browser behaviour for every page.
const $ = (id) => document.getElementById(id);
const DATA = JSON.parse($('store-data').textContent);
const { lang, settings: S, products: PRODUCTS } = DATA;
const T = DATA.t;
const tr = (k, vars) => { let s = T[k] ?? k; if (vars) for (const v in vars) s = s.replace(`{${v}}`, vars[v]); return s; };
const cmL = (s) => (lang === 'ar' ? String(s).replace(/cm/g, 'سم') : s);
const money = (n) => { const v = Number(n).toLocaleString('en-US'); return lang === 'ar' ? `${v} ج.م` : `EGP ${v}`; };
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ---------- analytics ---------- */
function track(event, p = {}) {
  try {
    if (window.gtag) window.gtag('event', event, p);
    if (window.fbq) {
      const map = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', generate_lead: 'Lead', contact: 'Contact' };
      if (map[event]) window.fbq('track', map[event], { value: p.value, currency: 'EGP', content_ids: (p.items || []).map((i) => i.item_id), content_type: 'product' });
    }
    if (window.clarity) window.clarity('event', event);
  } catch {}
}
// remember where the visitor came from (first visit only)
(() => {
  try {
    if (sessionStorage.getItem('nay-src')) return;
    const q = new URLSearchParams(location.search);
    const src = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid', 'gclid'].forEach((k) => { if (q.get(k)) src[k] = q.get(k); });
    src.referrer = document.referrer || '';
    src.landing = location.pathname;
    sessionStorage.setItem('nay-src', JSON.stringify(src));
  } catch {}
})();
const source = () => { try { return JSON.parse(sessionStorage.getItem('nay-src')) || {}; } catch { return {}; } };

/* ---------- toast ---------- */
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2200); }

/* ---------- cart ---------- */
let cart = store.get('nay-cart', []).filter((c) => c.kind === 'custom' ? S.custom_sizes[c.size] : PRODUCTS.some((p) => p.slug === c.slug));
const photos = {}; // custom photos kept in memory as a fallback
// Custom photos are large, so they live in IndexedDB (survives page changes), not localStorage.
const photoDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { try { const r = indexedDB.open('nay-photos', 1); r.onupgradeneeded = () => r.result.createObjectStore('p'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }));
  const run = (mode, fn) => open().then((db) => new Promise((res, rej) => { const tx = db.transaction('p', mode); const q = fn(tx.objectStore('p')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); })).catch(() => null);
  return { put: (k, v) => run('readwrite', (s) => s.put(v, k)), get: (k) => run('readonly', (s) => s.get(k)), del: (k) => run('readwrite', (s) => s.delete(k)) };
})();
const dropPhoto = (k) => { delete photos[k]; store.del('nay-photo-' + k); photoDB.del(k); };
const productBySlug = (s) => PRODUCTS.find((p) => p.slug === s);
function lineInfo(c) {
  if (c.kind === 'custom') {
    const s = S.custom_sizes[c.size];
    return { name: tr('custom_card_title'), sub: `${cmL(s.label)} · ${c.orLabel || c.or}`, img: c.thumb || S.custom_example_num, price: s.price, option: `${s.label} / ${c.or}`, display: `${cmL(s.label)} / ${c.orLabel || c.or}` };
  }
  const p = productBySlug(c.slug);
  return { name: p.name, sub: tr('card_sub'), img: p.img, price: p.price, option: '40×50 cm', display: cmL('40×50 cm') };
}
const save = () => store.set('nay-cart', cart);
function counts() { $('cartCount').textContent = cart.reduce((s, c) => s + c.q, 0); }
function bump() { const b = $('cartBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
function totals() { const sub = cart.reduce((s, c) => s + lineInfo(c).price * c.q, 0); const ship = cart.length ? Number(S.delivery_fee) : 0; return { sub, ship, total: sub + ship }; }
function gaItems() { return cart.map((c) => { const l = lineInfo(c); return { item_id: c.kind === 'custom' ? 'custom-' + S.custom_sizes[c.size].label : c.slug, item_name: l.name, item_variant: l.option, price: l.price, quantity: c.q }; }); }

function addKit(slug, q = 1) {
  const ex = cart.find((c) => c.key === slug);
  if (ex) ex.q += q; else cart.push({ key: slug, kind: 'kit', slug, q });
  save(); counts(); bump();
  const p = productBySlug(slug);
  toast(`${p.name} ${tr('added')}`);
  track('add_to_cart', { currency: 'EGP', value: p.price * q, items: [{ item_id: slug, item_name: p.name, price: p.price, quantity: q }] });
}

let view = 'cart';
function openDrawer(v = 'cart') { view = v; renderDrawer(); $('drawer').classList.add('on'); $('scrim').classList.add('on'); $('drawer').setAttribute('aria-hidden', 'false'); if (v === 'checkout') track('begin_checkout', { currency: 'EGP', value: totals().total, items: gaItems() }); }
function closeDrawer() { $('drawer').classList.remove('on'); $('scrim').classList.remove('on'); $('drawer').setAttribute('aria-hidden', 'true'); if (view === 'done') view = 'cart'; }

function renderDrawer() {
  const body = $('drawerBody'), foot = $('drawerFoot'), t = totals();
  if (view === 'done') return;
  if (view === 'cart') {
    $('drawerTitle').textContent = tr('your_cart');
    if (!cart.length) { body.innerHTML = `<div class="empty"><img src="/media/brand/mark.png" alt=""><p>${tr('cart_empty')}</p><a class="btn" href="${DATA.base}#shop" data-close>${tr('see_canvases')}</a></div>`; foot.innerHTML = ''; return; }
    body.innerHTML = cart.map((c) => { const l = lineInfo(c); return `<div class="line"><img src="${l.img}" alt=""><div style="min-width:0"><div class="t">${l.name}</div><div class="s">${l.sub}</div>
      <div class="qty"><button data-dec="${c.key}" aria-label="${tr('dec')}">−</button><span>${c.q}</span><button data-inc="${c.key}" aria-label="${tr('inc')}">+</button></div><button class="rm" data-rm="${c.key}">${tr('remove')}</button></div>
      <div class="p price">${money(l.price * c.q)}</div></div>`; }).join('');
    foot.innerHTML = `<div class="row"><span>${tr('subtotal')}</span><span class="price">${money(t.sub)}</span></div>
      <div class="row"><span>${tr('delivery')}</span><span class="price">${money(t.ship)}</span></div>
      <div class="row total"><span>${tr('total')}</span><span class="price">${money(t.total)}</span></div>
      <button class="btn btn-primary" id="toCheckout">${tr('checkout')}</button>`;
    return;
  }
  // checkout
  $('drawerTitle').textContent = tr('delivery_details');
  const hasCustom = cart.some((c) => c.kind === 'custom');
  const saved = store.get('nay-customer', {});
  const esc = (v) => String(v || '').replace(/"/g, '&quot;');
  const pays = [S.payments.cod && ['cod', tr('pay_cod')], S.payments.instapay && ['instapay', tr('pay_instapay')], S.payments.vodafone_cash && ['vodafone', tr('pay_vodafone')]].filter(Boolean);
  body.innerHTML = `<button class="back" id="backCart">${tr('back_cart')}</button>
  <form class="checkout" id="coForm" novalidate>
    <div class="field"><label for="f-name">${tr('f_name')}</label><input id="f-name" autocomplete="name" value="${esc(saved.name)}"><span class="err" hidden></span></div>
    <div class="field"><label for="f-phone">${hasCustom ? tr('f_phone_wa') : tr('f_phone')}</label><input id="f-phone" inputmode="tel" autocomplete="tel" placeholder="01xxxxxxxxx" value="${esc(saved.phone)}"><span class="err" hidden></span></div>
    <div class="field"><label for="f-city">${tr('f_city')}</label><select id="f-city">${T.gov.map((g, i) => `<option value="${i}" ${String(saved.city) === String(i) ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
    <div class="field"><label for="f-addr">${tr('f_addr')}</label><textarea id="f-addr" rows="2" autocomplete="street-address">${saved.addr || ''}</textarea><span class="err" hidden></span></div>
    <div class="field"><label>${tr('f_pay')}</label><div class="pay">${pays.map(([v, l], i) => `<label><input type="radio" name="pay" id="pay-${v}" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
    <div class="field"><label for="f-note">${tr('f_note')}</label><input id="f-note"></div>
  </form>`;
  foot.innerHTML = `<div class="row"><span>${tr('delivery')}</span><span class="price">${money(t.ship)}</span></div><div class="row total"><span>${tr('total')}</span><span class="price">${money(t.total)}</span></div><button class="btn btn-primary" id="placeOrder">${tr('place_order')}</button>`;
}

function orderText(o) {
  const lines = o.items.map((i) => `• ${i.name} (${i.display}) × ${i.qty} = ${money(i.line)}`).join('\n');
  return `${lang === "ar" ? "طلب NAY ART رقم" : "NAY ART order"} ${o.id}\n${lines}\n${tr('delivery')}: ${money(o.delivery)}\n${tr('total')}: ${money(o.total)}\n${tr('payment')}: ${o.payment_label}\n\n${o.customer.name}\n${o.customer.phone}\n${o.customer.city} – ${o.customer.address}${o.customer.notes ? '\n' + o.customer.notes : ''}${o.items.some((i) => i.custom) ? '\n\n' + (lang === 'ar' ? '(سأرسل لكم الصورة المطلوبة للوحة في هذه المحادثة)' : '(I will send the custom photo in this chat)') : ''}`;
}
const waLink = (text) => `https://wa.me/${S.whatsapp_intl}?text=${encodeURIComponent(text)}`;

async function placeOrder(btn) {
  const rules = [['f-name', (v) => v.trim().length >= 3, 'err_name'], ['f-phone', (v) => /^01[0125]\d{8}$/.test(v.replace(/\s/g, '')), 'err_phone'], ['f-addr', (v) => v.trim().length >= 8, 'err_addr']];
  let ok = true;
  rules.forEach(([id, test, msg]) => { const el = $(id), err = el.parentElement.querySelector('.err'); if (!test(el.value)) { ok = false; err.textContent = tr(msg); err.hidden = false; } else err.hidden = true; });
  if (!ok) return;
  const t = totals();
  const payV = document.querySelector('input[name=pay]:checked')?.value || 'cod';
  const payLabel = { cod: tr('pay_cod'), instapay: 'InstaPay', vodafone: tr('pay_vodafone') }[payV];
  const d = new Date();
  const id = `NA-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const cityIdx = $('f-city').value;
  const customer = { name: $('f-name').value.trim(), phone: $('f-phone').value.replace(/\s/g, ''), city: T.gov[cityIdx], address: $('f-addr').value.trim(), notes: $('f-note').value.trim() };
  store.set('nay-customer', { name: customer.name, phone: customer.phone, city: cityIdx, addr: customer.address });
  const items = cart.map((c) => { const l = lineInfo(c); return { slug: c.kind === 'custom' ? 'custom' : c.slug, name: l.name, option: l.option, display: l.display, qty: c.q, price: l.price, line: l.price * c.q, custom: c.kind === 'custom', note: c.note || '', key: c.key, thumb: c.kind === 'custom' ? c.thumb || '' : '' }; });
  const order = { type: 'order', id, created: d.toISOString(), lang, customer, payment: payV, payment_label: payLabel, items, subtotal: t.sub, delivery: t.ship, total: t.total, source: source(), page: location.href };
  const photoList = (await Promise.all(cart.filter((c) => c.kind === 'custom').map(async (c) => ({ key: c.key, name: c.file || 'photo.jpg', data: photos[c.key] || (await photoDB.get(c.key)) || store.get('nay-photo-' + c.key, '') })))).filter((p) => p.data);

  btn.disabled = true; btn.textContent = tr('placing');
  let sent = false;
  if (S.orders_endpoint) {
    try {
      const res = await fetch(S.orders_endpoint, { method: 'POST', body: JSON.stringify({ ...order, photos: photoList }) });
      const j = await res.json().catch(() => ({}));
      sent = res.ok && j.ok !== false;
    } catch { sent = false; }
  }
  showDone(order, sent);
  track('purchase', { transaction_id: id, currency: 'EGP', value: t.total, shipping: t.ship, items: gaItems() });
  cart.forEach((c) => c.kind === 'custom' && dropPhoto(c.key));
  cart = []; save(); counts();
}

function showDone(o, sent) {
  view = 'done';
  const hasCustom = o.items.some((i) => i.custom);
  const first = o.customer.name.split(' ')[0];
  $('drawerTitle').textContent = tr('order_placed');
  const payNote = o.payment === 'instapay' && S.instapay ? tr('pay_after_insta', { id: S.instapay }) : o.payment === 'vodafone' && S.vodafone_cash ? tr('pay_after_voda', { id: S.vodafone_cash }) : o.payment !== 'cod' ? tr('pay_after_wa') : '';
  const rows = o.items.map((i) => `<div class="row"><span>${i.name} (${i.display}) × ${i.qty}</span><span class="price">${money(i.line)}</span></div>`).join('');
  $('drawerBody').innerHTML = `<div class="done-box"><img src="/media/brand/mark.png" alt=""><h2 style="font-size:2rem">${tr('thanks', { name: first })}</h2>
    <p style="color:var(--ink-soft)">${sent ? (hasCustom ? tr('thanks_custom') : tr('thanks_kit')) : S.orders_endpoint ? tr('order_fail') : tr('order_wa_step')}</p><span class="ord">${o.id}</span></div>
    ${payNote ? `<p class="order-note">${payNote}</p>` : ''}
    <div class="summary-mini">${rows}<div class="row"><span>${tr('delivery')}</span><span class="price">${money(o.delivery)}</span></div><div class="row total"><span>${tr('total')}</span><span class="price">${money(o.total)}</span></div><div class="row"><span>${tr('payment')}</span><span>${o.payment_label}</span></div></div>`;
  const wa = `<a class="btn wa-btn${sent ? '' : ' btn-primary'}" href="${waLink(orderText(o))}" target="_blank" rel="noopener">${tr('send_wa')}</a>`;
  $('drawerFoot').innerHTML = (!sent || payNote ? wa : '') + `<a class="btn" href="${DATA.base}#shop" data-close>${tr('back_shop')}</a>`;
}

/* ---------- compare sliders ---------- */
document.addEventListener('input', (e) => { if (e.target.matches('.compare input')) e.target.parentElement.style.setProperty('--x', e.target.value + '%'); });
function hint(box) {
  if (RM || !box) return; const inp = box.querySelector('input'); let t0 = null;
  const step = (t) => { if (!t0) t0 = t; const k = (t - t0) / 1600; if (k > 1) { box.style.setProperty('--x', '50%'); inp.value = 50; return; } const v = 50 + Math.sin(k * Math.PI * 2) * 22; box.style.setProperty('--x', v + '%'); inp.value = v; requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const hintIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && !e.target.dataset.h) { e.target.dataset.h = '1'; hint(e.target); } }), { threshold: 0.5 });
document.querySelectorAll('[data-compare]').forEach((el) => hintIO.observe(el));

/* ---------- timelapse engine ---------- */
const cache = {};
const loadImg = (src) => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = src; });
async function decode(fin, num, tm) {
  const key = fin; if (cache[key]) return cache[key];
  const [fi, ni] = await Promise.all([loadImg(fin), loadImg(num)]);
  const land = fi.width >= fi.height; const W = land ? 800 : 640, H = land ? 640 : 800;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
  const get = (im) => { x.clearRect(0, 0, W, H); x.drawImage(im, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
  const f = get(fi), n = get(ni); let T;
  if (tm) { try { const ti = await loadImg(tm); const td = get(ti); T = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) T[i] = td[i * 4]; } catch { T = null; } }
  if (!T) T = buildMap(f, W, H);
  return (cache[key] = { W, H, T, f, n });
}
// when no timelapse map exists (e.g. a new product), make one from the finished image
function buildMap(f, W, H) {
  const K = 24, step = 4, pts = [];
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const i = (y * W + x) * 4; pts.push([f[i], f[i + 1], f[i + 2]]); }
  let cen = []; for (let k = 0; k < K; k++) cen.push(pts[Math.floor((k + 0.5) / K * pts.length)].slice());
  for (let it = 0; it < 6; it++) { const sum = cen.map(() => [0, 0, 0, 0]); for (const p of pts) { let b = 0, bd = 1e9; for (let k = 0; k < K; k++) { const c = cen[k], d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; b = k; } } const s = sum[b]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; } cen = cen.map((c, k) => (sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : c)); }
  const order = cen.map((c, k) => [c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114, k]).sort((a, b) => a[0] - b[0]); const rank = []; order.forEach(([, k], r) => (rank[k] = r));
  const T = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; let b = 0, bd = 1e9; for (let k = 0; k < K; k++) { const c = cen[k], d = (f[i] - c[0]) ** 2 + (f[i + 1] - c[1]) ** 2 + (f[i + 2] - c[2]) ** 2; if (d < bd) { bd = d; b = k; } } const key = (Math.sin(x * 0.013) + Math.cos(y * 0.011) + 2) / 4 * 0.6 + (y / H) * 0.4; T[y * W + x] = 5 + rank[b] * 10 + Math.min(9, Math.floor(key * 10)); }
  return T;
}
const DUR = 11000, HOLD = 2200;
class Reveal {
  constructor(cv, onP) { this.cv = cv; this.onP = onP; this.on = false; this.tok = 0; }
  async start(src, onDone) {
    this.stop(); const tok = ++this.tok;
    let d; try { d = await decode(src.fin, src.num, src.tm); } catch { return; }
    if (tok !== this.tok) return;
    this.d = d; this.cv.width = d.W; this.cv.height = d.H; this.img = this.cv.getContext('2d').createImageData(d.W, d.H);
    this.on = true; this.t0 = performance.now(); this.last = 0;
    if (RM) { this.draw(1); return; }
    const loop = (now) => { if (!this.on || tok !== this.tok) return; this.raf = requestAnimationFrame(loop); if (now - this.last < 40) return; this.last = now;
      if (now - this.t0 > DUR + HOLD) { if (onDone) { this.on = false; cancelAnimationFrame(this.raf); onDone(); return; } this.t0 = now; }
      this.draw(Math.min(1, (now - this.t0) / DUR)); };
    this.raf = requestAnimationFrame(loop);
  }
  draw(p) { const thr = 5 + p * 246, o = this.img.data, { T, f, n } = this.d; for (let i = 0, j = 0; i < T.length; i++, j += 4) { const s = T[i] < thr ? f : n; o[j] = s[j]; o[j + 1] = s[j + 1]; o[j + 2] = s[j + 2]; o[j + 3] = 255; } this.cv.getContext('2d').putImageData(this.img, 0, 0); if (this.onP) this.onP(p, Math.min(24, Math.max(1, Math.ceil((thr - 5) / 10)))); }
  stop() { this.on = false; cancelAnimationFrame(this.raf); this.tok++; }
  restart() { this.t0 = performance.now(); }
}

/* ---------- product page ---------- */
const pdp = $('pdp');
let gRev = null, gIdx = 0, pQty = 1;
if (pdp) {
  const slug = pdp.dataset.slug, price = Number(pdp.dataset.price);
  const box = $('gBox'), thumbs = [...document.querySelectorAll('#gThumbs button')];
  const src = { fin: box.dataset.fin, num: box.dataset.num, tm: box.dataset.tm };
  gRev = new Reveal($('gReveal'), (p, col) => { $('gLiveTxt').textContent = p >= 1 ? tr('live_done') : tr('live_painting', { n: col }); $('gBar').firstElementChild.style.width = p * 100 + '%'; });
  const setG = (i) => {
    gIdx = (i + thumbs.length) % thumbs.length; const b = thumbs[gIdx], isR = b.dataset.src === 'reveal';
    $('gMain').hidden = isR; $('gReveal').hidden = !isR; $('gLive').hidden = !isR; $('gBar').hidden = !isR || RM; $('gCap').hidden = isR;
    if (isR) gRev.start(src); else { gRev.stop(); $('gMain').src = b.dataset.src; $('gMain').alt = `${pdp.dataset.name}, ${b.dataset.cap}`; $('gCap').textContent = b.dataset.cap; }
    thumbs.forEach((t, j) => t.setAttribute('aria-current', j === gIdx ? 'true' : 'false'));
  };
  thumbs.forEach((b, i) => b.addEventListener('click', () => setG(i)));
  $('gPrev').addEventListener('click', () => setG(gIdx - 1));
  $('gNext').addEventListener('click', () => setG(gIdx + 1));
  $('gReveal').addEventListener('click', () => (gRev.on ? gRev.restart() : gRev.start(src)));
  new IntersectionObserver((es) => es.forEach((e) => { if (gIdx !== 0) return; if (e.isIntersecting) { if (!gRev.on) gRev.start(src); } else gRev.stop(); }), { threshold: 0.2 }).observe(box);
  document.addEventListener('visibilitychange', () => { if (document.hidden) gRev.stop(); else if (gIdx === 0) gRev.start(src); });
  setG(0);
  const upd = () => { $('pQty').textContent = pQty; $('pAdd').textContent = `${tr('add_to_cart')} · ${money(price * pQty)}`; };
  $('pDec').addEventListener('click', () => { pQty = Math.max(1, pQty - 1); upd(); });
  $('pInc').addEventListener('click', () => { pQty = Math.min(10, pQty + 1); upd(); });
  $('pAdd').addEventListener('click', () => addKit(slug, pQty));
  $('sbAdd').addEventListener('click', () => addKit(slug, 1));
  $('pBuyNow').addEventListener('click', () => { addKit(slug, pQty); openDrawer('checkout'); });
  // delivery estimate (Friday is the weekend)
  const now = new Date(); const add = (n) => { const x = new Date(now); let k = 0; while (k < n) { x.setDate(x.getDate() + 1); if (x.getDay() !== 5) k++; } return x; };
  const fmtD = (x) => x.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  $('pEta').textContent = `${tr('eta_order')} ${fmtD(add(2))} – ${fmtD(add(4))}`;
  // sticky bar
  new IntersectionObserver((es) => es.forEach((e) => { const on = !e.isIntersecting && e.boundingClientRect.top < 0; $('stickyBuy').classList.toggle('on', on); $('stickyBuy').setAttribute('aria-hidden', on ? 'false' : 'true'); document.body.classList.toggle('sb-on', on); }), { threshold: 0 }).observe($('pAdd'));
  track('view_item', { currency: 'EGP', value: price, items: [{ item_id: slug, item_name: pdp.dataset.name, price }] });
}

/* ---------- home: video hero + compare picker ---------- */
const hv = $('hvVid');
if (hv) {
  const CLIPS = JSON.parse($('hero-clips').textContent);
  const FALL = JSON.parse($('hero-fallback').textContent);
  let cIdx = 0, mode = 'video', visible = true, okFmt = null;
  const dots = () => document.querySelectorAll('#hvDots button');
  const mark = () => dots().forEach((b, i) => { b.firstElementChild.style.width = i < cIdx ? '100%' : '0'; });
  const tryPlay = () => { const p = hv.play(); if (p && p.catch) p.catch(() => {}); };
  function playClip(i) {
    cIdx = (i + CLIPS.length) % CLIPS.length; const c = CLIPS[cIdx];
    $('hvTxt').textContent = c.txt; $('hvLink').href = c.href; $('hvBg').style.backgroundImage = `url('${c.poster}')`; mark();
    if (mode !== 'video') return;
    hv.poster = c.poster; hv.dataset.try = okFmt || 'mp4'; hv.src = `${c.src}.${hv.dataset.try}`;
    if (!RM && visible) tryPlay();
  }
  hv.addEventListener('error', () => { if (hv.dataset.try === 'mp4' && !okFmt) { hv.dataset.try = 'webm'; hv.src = `${CLIPS[cIdx].src}.webm`; tryPlay(); } else fallback(); });
  hv.addEventListener('playing', () => { okFmt = hv.dataset.try; });
  hv.addEventListener('ended', () => playClip(cIdx + 1));
  hv.addEventListener('timeupdate', () => { const b = dots()[cIdx]; if (b && hv.duration) b.firstElementChild.style.width = (hv.currentTime / hv.duration) * 100 + '%'; });
  let fIdx = 0; const hRev = new Reveal($('hvCanvas'), (p, col) => { const f = FALL[fIdx]; $('hvTxt').textContent = p >= 1 ? f.name : `${f.name} · ${tr('live_painting', { n: col })}`; });
  function fallback() { mode = 'canvas'; hv.hidden = true; $('hvCanvas').hidden = false; $('hvDots').hidden = true; heroCanvas(0); }
  function heroCanvas(i) { fIdx = (i + FALL.length) % FALL.length; const f = FALL[fIdx]; $('hvLink').href = f.href; $('hvBg').style.backgroundImage = `url('${f.fin}')`; if (visible && !document.hidden) hRev.start(f, () => heroCanvas(fIdx + 1)); }
  const pause = () => (mode === 'video' ? hv.pause() : hRev.stop());
  const resume = () => { if (RM) return; if (mode === 'video') tryPlay(); else if (!hRev.on) heroCanvas(fIdx); };
  new IntersectionObserver((es) => es.forEach((e) => { visible = e.isIntersecting; visible ? resume() : pause(); }), { threshold: 0.15 }).observe($('heroVid'));
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  dots().forEach((b, i) => b.addEventListener('click', () => playClip(i)));
  playClip(0);
}
const pick = $('cmpPick');
if (pick) pick.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  pick.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  const box = $('cmpHome').querySelector('.compare'); const imgs = box.querySelectorAll('img');
  imgs[0].src = b.dataset.pickFin; imgs[1].src = b.dataset.pickNum;
  box.classList.toggle('land', b.dataset.pickLand === '1'); box.classList.toggle('port', b.dataset.pickLand !== '1');
  hint(box);
});

/* ---------- custom page ---------- */
// The customer only uploads a photo. No generated preview: the designer prepares the canvas by hand.
const customPage = $('customPage');
if (customPage) {
  let has = false, cSize = 0, cOr = 'Portrait', cOrLabel = tr('portrait'), cQty = 1, cThumb = null, cPhoto = null, cFile = '';
  const MAX_ORIGINAL = 6 * 1024 * 1024; // send the original up to 6 MB, otherwise a high-quality copy
  function loadPhoto(file) {
    if (!file || !file.type.startsWith('image/')) { toast(tr('bad_file')); return; }
    cFile = file.name; const r = new FileReader();
    r.onload = () => { const im = new Image(); im.onload = () => {
      cPhoto = file.size <= MAX_ORIGINAL && /jpe?g|png|webp/i.test(file.type) ? r.result : shrink(im, 3200, 0.9);
      cThumb = shrink(im, 160, 0.75);
      const img = $('pvImg'); img.src = shrink(im, 1200, 0.85); img.hidden = false;
      $('upEmpty').hidden = true; $('drop').classList.add('has-photo'); $('upDone').hidden = false; $('pvNote').hidden = false;
      has = true; upd(); track('generate_lead', { method: 'custom_photo' });
    }; im.src = r.result; };
    r.readAsDataURL(file);
  }
  function shrink(im, m, q) { const s = Math.min(1, m / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); }
  function upd() {
    const s = S.custom_sizes[cSize];
    $('cPrice').textContent = money(s.price); $('cSizeLbl').textContent = cmL(s.label); $('cOrLbl').textContent = cOrLabel; $('cQty').textContent = cQty;
    $('cAdd').textContent = `${tr('add_to_cart')} · ${money(s.price * cQty)}`; $('cAdd').disabled = !has; $('cNeed').hidden = has;
    document.querySelectorAll('#cSizes .opt').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.size === cSize ? 'true' : 'false'));
    document.querySelectorAll('#cOrient .opt').forEach((b) => b.setAttribute('aria-pressed', b.dataset.or === cOr ? 'true' : 'false'));
  }
  $('photo').addEventListener('change', (e) => loadPhoto(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => loadPhoto(e.dataTransfer.files[0]));
  drop.addEventListener('click', (e) => { if (has) e.preventDefault(); });
  $('changePhoto').addEventListener('click', () => $('photo').click());
  document.querySelectorAll('#cSizes .opt').forEach((b) => b.addEventListener('click', () => { cSize = +b.dataset.size; upd(); }));
  document.querySelectorAll('#cOrient .opt').forEach((b) => b.addEventListener('click', () => { cOr = b.dataset.or; cOrLabel = b.dataset.orLabel; upd(); }));
  $('cDec').addEventListener('click', () => { cQty = Math.max(1, cQty - 1); upd(); });
  $('cInc').addEventListener('click', () => { cQty = Math.min(5, cQty + 1); upd(); });
  $('cAdd').addEventListener('click', async () => {
    if (!has) return; const key = 'custom-' + Date.now();
    photos[key] = cPhoto; await photoDB.put(key, cPhoto);
    cart.push({ key, kind: 'custom', size: cSize, or: cOr, orLabel: cOrLabel, file: cFile, note: $('cNote').value.trim(), thumb: cThumb, q: cQty });
    save(); counts(); bump(); toast(tr('custom_added'));
    const s = S.custom_sizes[cSize]; track('add_to_cart', { currency: 'EGP', value: s.price * cQty, items: [{ item_id: 'custom-' + s.label, item_name: 'Custom Canvas', price: s.price, quantity: cQty }] });
    openDrawer();
  });
  upd();
}

/* ---------- global clicks ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('button,a'); if (!t) return; const d = t.dataset;
  if (d.close !== undefined) { closeDrawer(); return; }
  if (d.copy) {
    const done = () => { const o = t.textContent; t.textContent = tr('copied'); setTimeout(() => (t.textContent = o), 1500); };
    const sel = () => { const r = document.createRange(); r.selectNodeContents(t.parentElement.querySelector('.num')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast(tr('copy_fallback')); };
    try { navigator.clipboard.writeText(d.copy).then(done, sel); } catch { sel(); }
    return;
  }
  if (t.id === 'supFab') { const p = $('supPanel'); p.hidden = !p.hidden; t.setAttribute('aria-expanded', p.hidden ? 'false' : 'true'); if (!p.hidden) track('contact', { method: 'support_panel' }); return; }
  if (t.id === 'supClose') { $('supPanel').hidden = true; $('supFab').setAttribute('aria-expanded', 'false'); return; }
  if (t.matches('a[href^="tel:"]')) track('contact', { method: 'call' });
  if (t.matches('a[href*="wa.me"]')) track('contact', { method: 'whatsapp' });
  if (t.id === 'cartBtn') openDrawer();
  else if (t.id === 'closeDrawer') closeDrawer();
  else if (t.id === 'toCheckout') { view = 'checkout'; renderDrawer(); track('begin_checkout', { currency: 'EGP', value: totals().total, items: gaItems() }); }
  else if (t.id === 'backCart') { view = 'cart'; renderDrawer(); }
  else if (t.id === 'placeOrder') placeOrder(t);
  else if (d.inc || d.dec) { const c = cart.find((x) => x.key === (d.inc || d.dec)); if (!c) return; c.q += d.inc ? 1 : -1; if (c.q <= 0) { cart = cart.filter((x) => x !== c); dropPhoto(c.key); } save(); counts(); renderDrawer(); }
  else if (d.rm) { cart = cart.filter((x) => x.key !== d.rm); dropPhoto(d.rm); save(); counts(); renderDrawer(); }
});
$('scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); $('supPanel').hidden = true; $('supFab').setAttribute('aria-expanded', 'false'); } });

/* ---------- newsletter ---------- */
$('newsForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const v = $('newsEmail').value.trim(), m = $('newsMsg'); m.hidden = false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { m.style.color = 'var(--burgundy)'; m.textContent = tr('news_bad'); return; }
  m.style.color = ''; m.textContent = tr('news_ok'); $('newsEmail').value = '';
  track('generate_lead', { method: 'newsletter' });
  if (S.orders_endpoint) { try { await fetch(S.orders_endpoint, { method: 'POST', body: JSON.stringify({ type: 'subscribe', email: v, lang, created: new Date().toISOString(), source: source() }) }); } catch {} }
});

counts();
