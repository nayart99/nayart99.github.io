// NAY ART – quick paint-by-numbers preview, made in the browser (free, nothing is uploaded).
// It is only an approximation for the customer; the real print file is made after payment.
//
// Colours are clustered in Lab on a sample weighted towards detail (faces), so features survive.
// buildPBN(image, ratio, colors) → { W, H, photo, color, lines, numbers, palette }
//   photo / color / lines are canvases (W×H); numbers = [{ x, y, n, size }]; palette = ['#rrggbb', …]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)) >>> 0) / 4294967296; }

/** The part of the photo that becomes the canvas: shape = ratio (w/h), zoom z ≥ 1, centre (cx, cy) in 0–1.
 *  Returns normalized { x1, y1, x2, y2 } (clamped inside the photo). */
export function cropRect(iw, ih, ratio, view = {}) {
  const z = Math.max(1, Math.min(4, view.z || 1));
  let w = iw / ih > ratio ? (ih * ratio) / iw : 1, h = iw / ih > ratio ? 1 : (iw / ratio) / ih;
  w /= z; h /= z;
  const cx = Math.min(1 - w / 2, Math.max(w / 2, view.cx ?? 0.5)), cy = Math.min(1 - h / 2, Math.max(h / 2, view.cy ?? 0.5));
  const r = (v) => Math.round(v * 10000) / 10000;
  return { x1: r(cx - w / 2), y1: r(cy - h / 2), x2: r(cx + w / 2), y2: r(cy + h / 2) };
}

/** Draws just the framed photo (used while the customer drags / zooms). */
export function drawCrop(canvas, im, crop) {
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  canvas.getContext('2d').drawImage(im, crop.x1 * iw, crop.y1 * ih, (crop.x2 - crop.x1) * iw, (crop.y2 - crop.y1) * ih, 0, 0, canvas.width, canvas.height);
}

export async function buildPBN(im, ratio, K = 24, long = 900, view = {}) {
  // 1. crop to the canvas shape (and the customer's zoom / position) and scale down
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  const cr = cropRect(iw, ih, ratio, view);
  const sx = cr.x1 * iw, sy = cr.y1 * ih, sw = (cr.x2 - cr.x1) * iw, sh = (cr.y2 - cr.y1) * ih;
  const W = ratio >= 1 ? long : Math.round(long * ratio), H = ratio >= 1 ? Math.round(long / ratio) : long, N = W * H;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const photo = mk(); photo.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, W, H);
  const soft = mk(), sg = soft.getContext('2d', { willReadFrequently: true });
  sg.filter = 'blur(0.6px)'; sg.drawImage(photo, 0, 0);
  const px = sg.getImageData(0, 0, W, H).data;
  await frame();

  // 2. colours are compared in Lab (closer to how the eye sees them, keeps skin tones apart)
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const lab = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = lin[px[i * 4]], g = lin[px[i * 4 + 1]], b = lin[px[i * 4 + 2]];
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    lab[i * 3] = 116 * y - 16; lab[i * 3 + 1] = 500 * (x - y); lab[i * 3 + 2] = 200 * (y - z);
  }
  await frame();

  // 3. k-means on a sample that favours detailed areas (faces, eyes, edges) over flat backgrounds
  const rand = rng(N + K);
  const cum = new Float32Array(N); let tot = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, q = Math.min(N - 1, p + 1), d = Math.min(N - 1, p + W);
    const gr = Math.abs(lab[p * 3] - lab[q * 3]) + Math.abs(lab[p * 3] - lab[d * 3]) + 0.5 * (Math.abs(lab[p * 3 + 1] - lab[q * 3 + 1]) + Math.abs(lab[p * 3 + 2] - lab[d * 3 + 2]));
    const cx = (x / W - 0.5) * 2, cy = (y / H - 0.45) * 2;
    tot += 0.25 + Math.min(gr, 30) / 10 + 0.6 * Math.max(0, 1 - Math.sqrt(cx * cx + cy * cy)); cum[p] = tot;
  }
  const S = Math.min(N, 14000), sample = new Float32Array(S * 3);
  for (let i = 0; i < S; i++) {
    const t = rand() * tot; let lo = 0, hi = N - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < t) lo = m + 1; else hi = m; }
    sample[i * 3] = lab[lo * 3]; sample[i * 3 + 1] = lab[lo * 3 + 1]; sample[i * 3 + 2] = lab[lo * 3 + 2];
  }
  const cen = new Float32Array(K * 3);
  const d2 = new Float32Array(S).fill(1e12);
  let pick = Math.floor(rand() * S);
  const dist3 = (a, i, b, k) => { const d0 = a[i * 3] - b[k * 3], d1 = a[i * 3 + 1] - b[k * 3 + 1], d2_ = a[i * 3 + 2] - b[k * 3 + 2]; return d0 * d0 + d1 * d1 + d2_ * d2_; };
  for (let k = 0; k < K; k++) {
    cen[k * 3] = sample[pick * 3]; cen[k * 3 + 1] = sample[pick * 3 + 1]; cen[k * 3 + 2] = sample[pick * 3 + 2];
    let sum = 0;
    for (let i = 0; i < S; i++) { const d = dist3(sample, i, cen, k); if (d < d2[i]) d2[i] = d; sum += d2[i]; }
    let t = rand() * sum; pick = 0; for (let i = 0; i < S; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
  }
  const nearIn = (arr, i) => { let best = 0, bd = 1e12; for (let k = 0; k < K; k++) { const d = dist3(arr, i, cen, k); if (d < bd) { bd = d; best = k; } } return best; };
  for (let it = 0; it < 12; it++) {
    const acc = new Float64Array(K * 4);
    for (let i = 0; i < S; i++) { const k = nearIn(sample, i); acc[k * 4] += sample[i * 3]; acc[k * 4 + 1] += sample[i * 3 + 1]; acc[k * 4 + 2] += sample[i * 3 + 2]; acc[k * 4 + 3]++; }
    for (let k = 0; k < K; k++) if (acc[k * 4 + 3]) { cen[k * 3] = acc[k * 4] / acc[k * 4 + 3]; cen[k * 3 + 1] = acc[k * 4 + 1] / acc[k * 4 + 3]; cen[k * 3 + 2] = acc[k * 4 + 2] / acc[k * 4 + 3]; }
  }
  let lab_ = new Uint8Array(N);
  for (let i = 0; i < N; i++) lab_[i] = nearIn(lab, i);
  // palette colours in RGB = average of the pixels in each cluster
  const rgbAcc = new Float64Array(K * 4);
  for (let i = 0; i < N; i++) { const k = lab_[i]; rgbAcc[k * 4] += px[i * 4]; rgbAcc[k * 4 + 1] += px[i * 4 + 1]; rgbAcc[k * 4 + 2] += px[i * 4 + 2]; rgbAcc[k * 4 + 3]++; }
  const rgb = new Float32Array(K * 3);
  for (let k = 0; k < K; k++) { const n = rgbAcc[k * 4 + 3] || 1; rgb[k * 3] = rgbAcc[k * 4] / n; rgb[k * 3 + 1] = rgbAcc[k * 4 + 1] / n; rgb[k * 3 + 2] = rgbAcc[k * 4 + 2] / n; }
  await frame();

  // 3b. light clean-up: 3×3 majority filter (removes single-pixel noise, keeps eyes and lips)
  const cnt = new Uint16Array(K);
  {
    const out = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      cnt.fill(0); let best = lab_[y * W + x], bc = 1; cnt[best] = 1;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if ((!dx && !dy) || xx < 0 || xx >= W) continue; const l = lab_[yy * W + xx]; if (++cnt[l] > bc) { bc = cnt[l]; best = l; } } }
      out[y * W + x] = bc >= 5 ? best : lab_[y * W + x];
    }
    lab_ = out;
  }
  let labs = lab_;
  await frame();

  // 4. merge tiny regions into their biggest neighbour (paintable areas only)
  const comp = new Int32Array(N), stack = new Int32Array(N);
  const regions = () => {
    comp.fill(-1); const sizes = [];
    for (let i = 0; i < N; i++) {
      if (comp[i] >= 0) continue;
      const id = sizes.length, l = labs[i]; let sp = 0, n = 0; stack[sp++] = i; comp[i] = id;
      while (sp) { const p = stack[--sp]; n++; const x = p % W;
        if (x > 0 && comp[p - 1] < 0 && labs[p - 1] === l) { comp[p - 1] = id; stack[sp++] = p - 1; }
        if (x < W - 1 && comp[p + 1] < 0 && labs[p + 1] === l) { comp[p + 1] = id; stack[sp++] = p + 1; }
        if (p >= W && comp[p - W] < 0 && labs[p - W] === l) { comp[p - W] = id; stack[sp++] = p - W; }
        if (p < N - W && comp[p + W] < 0 && labs[p + W] === l) { comp[p + W] = id; stack[sp++] = p + W; } }
      sizes.push(n);
    }
    return sizes;
  };
  const minArea = Math.max(12, Math.round(N / 16000));
  for (let round = 0; round < 3; round++) {
    const sizes = regions();
    const target = new Int16Array(sizes.length).fill(-1), votes = new Map();
    for (let p = 0; p < N; p++) {
      const c = comp[p]; if (sizes[c] >= minArea) continue; const x = p % W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
        if (q < 0 || q >= N || comp[q] === c) continue;
        const key = c * 64 + labs[q]; votes.set(key, (votes.get(key) || 0) + sizes[comp[q]]);
      }
    }
    const bestV = new Float64Array(sizes.length);
    for (const [key, v] of votes) { const c = Math.floor(key / 64); if (v > bestV[c]) { bestV[c] = v; target[c] = key % 64; } }
    let changed = 0;
    for (let p = 0; p < N; p++) { const t = target[comp[p]]; if (t >= 0) { labs[p] = t; changed++; } }
    if (!changed) break;
    await frame();
  }
  const sizes = regions();

  // 5. palette numbered from light to dark
  const used = [...new Set(labs)];
  const lum = (k) => rgb[k * 3] * .3 + rgb[k * 3 + 1] * .59 + rgb[k * 3 + 2] * .11;
  used.sort((a, b) => lum(b) - lum(a));
  const num = new Uint8Array(K); used.forEach((k, i) => (num[k] = i + 1));
  const hex = (k) => '#' + [0, 1, 2].map((j) => Math.round(rgb[k * 3 + j]).toString(16).padStart(2, '0')).join('');
  const palette = used.map(hex);

  // 6. images: painted colours, and white canvas with outlines
  const color = mk(), lines = mk();
  const cg = color.getContext('2d'), lg = lines.getContext('2d');
  const ci = cg.createImageData(W, H), li = lg.createImageData(W, H);
  const edge = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const k = labs[p], x = p % W;
    ci.data[p * 4] = rgb[k * 3]; ci.data[p * 4 + 1] = rgb[k * 3 + 1]; ci.data[p * 4 + 2] = rgb[k * 3 + 2]; ci.data[p * 4 + 3] = 255;
    const e = (x < W - 1 && labs[p + 1] !== k) || (p < N - W && labs[p + W] !== k);
    edge[p] = e ? 1 : 0;
    const v = e ? 128 : 255;
    li.data[p * 4] = v; li.data[p * 4 + 1] = v; li.data[p * 4 + 2] = v; li.data[p * 4 + 3] = 255;
  }
  cg.putImageData(ci, 0, 0); lg.putImageData(li, 0, 0);

  // 7. where to write each number: the point deepest inside its region (chamfer distance to an edge)
  const dist = new Float32Array(N);
  for (let p = 0; p < N; p++) dist[p] = edge[p] || p % W === 0 || p % W === W - 1 || p < W || p >= N - W ? 0 : 1e9;
  for (let p = W + 1; p < N - W - 1; p++) if (dist[p]) dist[p] = Math.min(dist[p], dist[p - 1] + 1, dist[p - W] + 1, dist[p - W - 1] + 1.414, dist[p - W + 1] + 1.414);
  for (let p = N - W - 2; p > W; p--) if (dist[p]) dist[p] = Math.min(dist[p], dist[p + 1] + 1, dist[p + W] + 1, dist[p + W + 1] + 1.414, dist[p + W - 1] + 1.414);
  const bestP = new Int32Array(sizes.length).fill(-1), bestD = new Float32Array(sizes.length);
  for (let p = 0; p < N; p++) { const c = comp[p]; if (dist[p] > bestD[c]) { bestD[c] = dist[p]; bestP[c] = p; } }
  const numbers = [];
  for (let c = 0; c < sizes.length; c++) {
    if (bestP[c] < 0 || bestD[c] < 3.5) continue;
    const p = bestP[c];
    numbers.push({ x: p % W, y: Math.floor(p / W), n: num[labs[p]], size: Math.min(22, Math.max(9, bestD[c] * 1.3)) });
  }
  return { W, H, photo, color, lines, numbers, palette, crop: cr };
}

export function drawNumbers(g, numbers, upto = numbers.length) {
  g.fillStyle = '#7d7d7d'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < upto; i++) { const t = numbers[i]; g.font = `600 ${t.size}px system-ui, -apple-system, Segoe UI, Arial, sans-serif`; g.fillText(t.n, t.x, t.y + 0.5); }
}

/** Plays the reveal on `canvas`: photo → colours → outlines → numbers. `on(stage)` is called at each step. */
export async function playReveal(canvas, r, on, isCurrent, fast = false) {
  canvas.width = r.W; canvas.height = r.H;
  const g = canvas.getContext('2d');
  const T = (ms) => (fast ? ms * 0.45 : ms);
  const anim = async (ms, draw) => { const t0 = performance.now(); for (;;) { if (!isCurrent()) return false; const t = Math.min(1, (performance.now() - t0) / T(ms)); draw(t * t * (3 - 2 * t)); if (t >= 1) return true; await frame(); } };
  g.drawImage(r.photo, 0, 0);
  on('colors'); await sleep(T(350));
  if (!(await anim(1100, (t) => { g.globalAlpha = 1; g.drawImage(r.photo, 0, 0); g.globalAlpha = t; g.drawImage(r.color, 0, 0); g.globalAlpha = 1; }))) return false;
  await sleep(T(450));
  on('lines');
  if (!(await anim(1500, (t) => { g.drawImage(r.color, 0, 0); const w = Math.round(r.W * t); if (w > 0) g.drawImage(r.lines, 0, 0, w, r.H, 0, 0, w, r.H); g.fillStyle = 'rgba(122,31,43,.55)'; if (t < 1) g.fillRect(w - 1, 0, 2, r.H); }))) return false;
  on('numbers');
  const order = r.numbers.map((_, i) => i).sort((a, b) => r.numbers[a].y - r.numbers[b].y || r.numbers[a].x - r.numbers[b].x);
  const sorted = order.map((i) => r.numbers[i]);
  if (!(await anim(1300, (t) => { g.drawImage(r.lines, 0, 0); drawNumbers(g, sorted, Math.round(sorted.length * t)); }))) return false;
  on('done');
  return true;
}

export function showView(canvas, r, view) {
  const g = canvas.getContext('2d');
  if (view === 'photo') g.drawImage(r.photo, 0, 0);
  else if (view === 'color') g.drawImage(r.color, 0, 0);
  else { g.drawImage(r.lines, 0, 0); drawNumbers(g, r.numbers); }
}
