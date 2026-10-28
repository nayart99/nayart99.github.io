// NAY ART – quick paint-by-numbers preview, made in the browser (free, nothing is uploaded).
// It is only an approximation for the customer; the real print file is made after payment.
//
// buildPBN(image, ratio, colors) → { W, H, photo, color, lines, numbers, palette }
//   photo / color / lines are canvases (W×H); numbers = [{ x, y, n, size }]; palette = ['#rrggbb', …]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)) >>> 0) / 4294967296; }

export async function buildPBN(im, ratio, K = 24, long = 640) {
  // 1. centre-crop to the canvas shape and scale down
  let sw = im.naturalWidth || im.width, sh = im.naturalHeight || im.height, sx = 0, sy = 0;
  if (sw / sh > ratio) { const nw = sh * ratio; sx = (sw - nw) / 2; sw = nw; } else { const nh = sw / ratio; sy = (sh - nh) / 2; sh = nh; }
  const W = ratio >= 1 ? long : Math.round(long * ratio), H = ratio >= 1 ? Math.round(long / ratio) : long, N = W * H;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const photo = mk(); photo.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, W, H);
  const soft = mk(), sg = soft.getContext('2d', { willReadFrequently: true });
  sg.filter = 'blur(1.4px) saturate(1.15)'; sg.drawImage(photo, 0, 0);
  const px = sg.getImageData(0, 0, W, H).data;
  await frame();

  // 2. k-means colors (k-means++ start, on a sample)
  const rand = rng(N + K);
  const S = Math.min(N, 9000), sample = new Float32Array(S * 3);
  for (let i = 0; i < S; i++) { const p = (Math.floor(rand() * N)) * 4; sample[i * 3] = px[p]; sample[i * 3 + 1] = px[p + 1]; sample[i * 3 + 2] = px[p + 2]; }
  const cen = new Float32Array(K * 3);
  const d2 = new Float32Array(S).fill(1e12);
  let pick = Math.floor(rand() * S);
  for (let k = 0; k < K; k++) {
    cen[k * 3] = sample[pick * 3]; cen[k * 3 + 1] = sample[pick * 3 + 1]; cen[k * 3 + 2] = sample[pick * 3 + 2];
    let sum = 0;
    for (let i = 0; i < S; i++) { const dr = sample[i * 3] - cen[k * 3], dg = sample[i * 3 + 1] - cen[k * 3 + 1], db = sample[i * 3 + 2] - cen[k * 3 + 2]; const d = dr * dr * .3 + dg * dg * .59 + db * db * .11; if (d < d2[i]) d2[i] = d; sum += d2[i]; }
    let t = rand() * sum; pick = 0; for (let i = 0; i < S; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
  }
  const near = (r, g, b) => { let best = 0, bd = 1e12; for (let k = 0; k < K; k++) { const dr = r - cen[k * 3], dg = g - cen[k * 3 + 1], db = b - cen[k * 3 + 2]; const d = dr * dr * .3 + dg * dg * .59 + db * db * .11; if (d < bd) { bd = d; best = k; } } return best; };
  for (let it = 0; it < 10; it++) {
    const acc = new Float64Array(K * 4);
    for (let i = 0; i < S; i++) { const k = near(sample[i * 3], sample[i * 3 + 1], sample[i * 3 + 2]); acc[k * 4] += sample[i * 3]; acc[k * 4 + 1] += sample[i * 3 + 1]; acc[k * 4 + 2] += sample[i * 3 + 2]; acc[k * 4 + 3]++; }
    for (let k = 0; k < K; k++) if (acc[k * 4 + 3]) { cen[k * 3] = acc[k * 4] / acc[k * 4 + 3]; cen[k * 3 + 1] = acc[k * 4 + 1] / acc[k * 4 + 3]; cen[k * 3 + 2] = acc[k * 4 + 2] / acc[k * 4 + 3]; }
  }
  let lab = new Uint8Array(N);
  for (let i = 0; i < N; i++) lab[i] = near(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  await frame();

  // 3. smooth: majority filter (removes speckles)
  const cnt = new Uint16Array(K);
  for (let pass = 0; pass < 2; pass++) {
    const out = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      cnt.fill(0); let best = lab[y * W + x], bc = 0;
      for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const l = lab[yy * W + xx]; if (++cnt[l] > bc) { bc = cnt[l]; best = l; } } }
      out[y * W + x] = best;
    }
    lab = out;
  }
  await frame();

  // 4. merge tiny regions into their biggest neighbour (paintable areas only)
  const comp = new Int32Array(N), stack = new Int32Array(N);
  const regions = () => {
    comp.fill(-1); const sizes = [];
    for (let i = 0; i < N; i++) {
      if (comp[i] >= 0) continue;
      const id = sizes.length, l = lab[i]; let sp = 0, n = 0; stack[sp++] = i; comp[i] = id;
      while (sp) { const p = stack[--sp]; n++; const x = p % W;
        if (x > 0 && comp[p - 1] < 0 && lab[p - 1] === l) { comp[p - 1] = id; stack[sp++] = p - 1; }
        if (x < W - 1 && comp[p + 1] < 0 && lab[p + 1] === l) { comp[p + 1] = id; stack[sp++] = p + 1; }
        if (p >= W && comp[p - W] < 0 && lab[p - W] === l) { comp[p - W] = id; stack[sp++] = p - W; }
        if (p < N - W && comp[p + W] < 0 && lab[p + W] === l) { comp[p + W] = id; stack[sp++] = p + W; } }
      sizes.push(n);
    }
    return sizes;
  };
  const minArea = Math.max(24, Math.round(N / 3200));
  for (let round = 0; round < 3; round++) {
    const sizes = regions();
    const target = new Int16Array(sizes.length).fill(-1), votes = new Map();
    for (let p = 0; p < N; p++) {
      const c = comp[p]; if (sizes[c] >= minArea) continue; const x = p % W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
        if (q < 0 || q >= N || comp[q] === c) continue;
        const key = c * 64 + lab[q]; votes.set(key, (votes.get(key) || 0) + sizes[comp[q]]);
      }
    }
    const bestV = new Float64Array(sizes.length);
    for (const [key, v] of votes) { const c = Math.floor(key / 64); if (v > bestV[c]) { bestV[c] = v; target[c] = key % 64; } }
    let changed = 0;
    for (let p = 0; p < N; p++) { const t = target[comp[p]]; if (t >= 0) { lab[p] = t; changed++; } }
    if (!changed) break;
    await frame();
  }
  const sizes = regions();

  // 5. palette numbered from light to dark
  const used = [...new Set(lab)];
  const lum = (k) => cen[k * 3] * .3 + cen[k * 3 + 1] * .59 + cen[k * 3 + 2] * .11;
  used.sort((a, b) => lum(b) - lum(a));
  const num = new Uint8Array(K); used.forEach((k, i) => (num[k] = i + 1));
  const hex = (k) => '#' + [0, 1, 2].map((j) => Math.round(cen[k * 3 + j]).toString(16).padStart(2, '0')).join('');
  const palette = used.map(hex);

  // 6. images: painted colours, and white canvas with outlines
  const color = mk(), lines = mk();
  const cg = color.getContext('2d'), lg = lines.getContext('2d');
  const ci = cg.createImageData(W, H), li = lg.createImageData(W, H);
  const edge = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const k = lab[p], x = p % W;
    ci.data[p * 4] = cen[k * 3]; ci.data[p * 4 + 1] = cen[k * 3 + 1]; ci.data[p * 4 + 2] = cen[k * 3 + 2]; ci.data[p * 4 + 3] = 255;
    const e = (x < W - 1 && lab[p + 1] !== k) || (p < N - W && lab[p + W] !== k);
    edge[p] = e ? 1 : 0;
    const v = e ? 150 : 255;
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
    if (bestP[c] < 0 || bestD[c] < 3.2) continue;
    const p = bestP[c];
    numbers.push({ x: p % W, y: Math.floor(p / W), n: num[lab[p]], size: Math.min(15, Math.max(6.5, bestD[c] * 1.15)) });
  }
  return { W, H, photo, color, lines, numbers, palette };
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
