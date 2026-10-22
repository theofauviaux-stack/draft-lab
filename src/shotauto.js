// Analyse automatique d'une capture (fin de game, sélection des champions, drafter) :
//  1. on repère les « cases » de champions par leurs formes et couleurs (zones texturées sur fond uni),
//  2. on garde l'ensemble de 10 cases alignées (2 lignes de 5, ou une ligne de 10) le plus grand,
//  3. on reconnaît chaque case : portrait carré/rond → icônes officielles, bandeau large → illustrations (splash).
// Aucun texte (pseudo) n'est lu.

// ---------- 1-2. Repérage des cases ----------
export function detectSlots(img) {
  const s = Math.min(1, 760 / img.width), w = Math.round(img.width * s), h = Math.round(img.height * s);
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, N = w * h;
  const lum = new Float32Array(N), sat = new Float32Array(N), fg = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    lum[i] = (r + g + b) / 3; sat[i] = mx ? (mx - mn) / mx : 0;
    fg[i] = mx > 70 || mx - mn > 45 ? 1 : 0;
  }
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x;
    if (Math.abs(lum[i + 1] - lum[i]) + Math.abs(lum[i + w] - lum[i]) > 25) fg[i] = 1;
  }
  // on remplit les trous : une illustration sombre entourée d'un bord reste une seule case
  const out = new Uint8Array(N), st = [];
  for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
  while (st.length) {
    const i = st.pop(); if (out[i] || fg[i]) continue; out[i] = 1;
    const x = i % w;
    if (x > 0) st.push(i - 1); if (x < w - 1) st.push(i + 1); if (i >= w) st.push(i - w); if (i < N - w) st.push(i + w);
  }
  for (let i = 0; i < N; i++) if (!out[i]) fg[i] = 1;
  // composantes connexes
  const lab = new Int32Array(N), C = [];
  let n = 0;
  for (let i0 = 0; i0 < N; i0++) {
    if (!fg[i0] || lab[i0]) continue;
    n++; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, cnt = 0; st.push(i0); lab[i0] = n;
    while (st.length) {
      const i = st.pop(), x = i % w, y = (i - x) / w; cnt++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && fg[j] && !lab[j]) { lab[j] = n; st.push(j); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < 12 || bh < 12 || cnt / (bw * bh) < 0.45) continue;
    let parts = [[x0, y0, bw, bh]];
    for (const k of [2, 3]) {
      if (Math.abs(bh / bw - k) < 0.25 * k) parts = Array.from({ length: k }, (_, j) => [x0, y0 + (j * bh) / k, bw, bh / k]);
      if (Math.abs(bw / bh - k) < 0.25 * k && bh < 40) parts = Array.from({ length: k }, (_, j) => [x0 + (j * bw) / k, y0, bw / k, bh]);
    }
    for (const [px, py, pw, ph] of parts) {
      const a = pw / ph, kind = a >= 0.75 && a <= 1.33 ? 'sq' : a >= 1.8 && a <= 5 ? 'wide' : null;
      if (kind) C.push({ kind, cx: px + pw / 2, cy: py + ph / 2, w: pw, h: ph });
    }
  }
  const cover = (b) => { // part de « contenu » dans une case (pour choisir où compléter une ligne)
    let c = 0, t = 0;
    for (let y = Math.max(0, Math.round(b.cy - b.h / 2)); y < Math.min(h, b.cy + b.h / 2); y += 2) for (let x = Math.max(0, Math.round(b.cx - b.w / 2)); x < Math.min(w, b.cx + b.w / 2); x += 2) { t++; c += fg[y * w + x] && !out[y * w + x] ? 1 : 0; }
    return t ? c / t : 0;
  };
  const grayness = (b) => {
    let c = 0, t = 0;
    for (let y = Math.max(0, Math.round(b.cy - b.h / 3)); y < Math.min(h, b.cy + b.h / 3); y++) for (let x = Math.max(0, Math.round(b.cx - b.w / 3)); x < Math.min(w, b.cx + b.w / 3); x++) { t++; c += sat[y * w + x]; }
    return t ? c / t : 1;
  };
  const inside = (b) => b.cx - b.w / 2 >= -2 && b.cy - b.h / 2 >= -2 && b.cx + b.w / 2 <= w + 2 && b.cy + b.h / 2 <= h + 2;

  // ensembles de 10 cases : 2 lignes parallèles de 5 (complétées si une case n'a pas été vue) ou une ligne de 10
  const structures = (cands) => {
    const res = [], seen = new Set();
    for (const c of cands) {
      const g = cands.filter((e) => e.kind === c.kind && Math.abs(e.w - c.w) < 0.15 * c.w && Math.abs(e.h - c.h) < 0.15 * c.h);
      const sig = g.map((e) => cands.indexOf(e)).join(',');
      if (seen.has(sig)) continue; seen.add(sig);
      const sw = median(g.map((e) => e.w)), sh = median(g.map((e) => e.h));
      for (const [key, other, tol, size] of [['cx', 'cy', 0.3 * sw, sh], ['cy', 'cx', 0.3 * sh, sw]]) {
        const L = [];
        for (const e of [...g].sort((p, q) => p[key] - q[key])) {
          const last = L[L.length - 1];
          if (last && Math.abs(e[key] - last[0][key]) < tol) last.push(e); else L.push([e]);
        }
        for (const l of L) l.sort((p, q) => p[other] - q[other]);
        const mk = (pos, line) => ({ kind: c.kind, [key]: median(line.map((e) => e[key])), [other]: pos, w: sw, h: sh });
        // une ligne de 10 (tableau de fin de game) : les 5 premiers puis les 5 suivants
        // (ou 8-9 cases vues : on coupe au plus grand écart et on complète vers l'extérieur)
        for (const l of L) {
          if (l.length < 8 || l.length > 10) continue;
          let g = 0;
          for (let k = 1; k < l.length; k++) if (l[k][other] - l[k - 1][other] > l[g + 1][other] - l[g][other]) g = k - 1;
          const halves = l.length === 10 ? [l.slice(0, 5), l.slice(5)] : [l.slice(0, g + 1), l.slice(g + 1)];
          if (halves.some((x) => x.length > 5 || x.length < 3)) continue;
          const dd = [];
          for (const x of halves) for (let k = 1; k < x.length; k++) dd.push(x[k][other] - x[k - 1][other]);
          const step = Math.min(...dd);
          const teams = halves.map((x, t) => {
            const pos = x.map((e) => e[other]);
            while (pos.length < 5) t ? pos.push(pos[pos.length - 1] + step) : pos.unshift(pos[0] - step);
            return pos.map((p) => mk(p, l));
          });
          if (teams.flat().every(inside)) res.push({ teams, score: sw * sh * l.length, seen: l.length });
        }
        // deux lignes de 5 : on aligne les cases sur un pas régulier et on complète les manquantes
        const ok = L.filter((l) => l.length >= 3 && l.length <= 5);
        for (let a = 0; a < ok.length; a++) for (let b = a + 1; b < ok.length; b++) {
          const A = ok[a], B = ok[b];
          if (A.length + B.length < 7) continue;
          const all = [...A, ...B].map((e) => e[other]);
          const diffs = [];
          for (const l of [A, B]) for (let k = 1; k < l.length; k++) diffs.push(l[k][other] - l[k - 1][other]);
          const step = Math.min(...diffs.filter((x) => x > 0.6 * size));
          if (!isFinite(step) || step > 2.2 * size) continue;
          const p0 = Math.min(...all), idx = (p) => (p - p0) / step;
          if (all.some((p) => Math.abs(idx(p) - Math.round(idx(p))) > 0.25)) continue;
          const U = new Set(all.map((p) => Math.round(idx(p)))), mx = Math.max(...U);
          if (mx > 4) continue;
          let best = null;
          for (let s0 = mx - 4; s0 <= 0; s0++) {
            const teams = [A, B].map((l) => [0, 1, 2, 3, 4].map((j) => mk(p0 + (s0 + j) * step, l)));
            if (!teams.flat().every(inside)) continue;
            const sc = teams.flat().reduce((t, x) => t + cover(x), 0);
            if (!best || sc > best.sc) best = { teams, sc };
          }
          if (best) res.push({ teams: best.teams, score: sw * sh * (A.length + B.length), seen: A.length + B.length });
        }
      }
    }
    return res.sort((p, q) => q.score - p.score);
  };
  const S = structures(C);
  const picks = S[0] ?? null;
  // bans (drafters) : 10 petites cases grisées, hors des picks
  let bans = null;
  if (picks) {
    const used = picks.teams.flat();
    const small = C.filter((e) => e.kind === 'sq' && e.w < 0.9 * Math.min(picks.teams[0][0].w, picks.teams[0][0].h) && !used.some((u) => Math.abs(u.cx - e.cx) < u.w / 2 && Math.abs(u.cy - e.cy) < u.h / 2));
    bans = structures(small).find((t) => t.seen >= 8 && t.teams.flat().every((b) => grayness(b) < 0.2)) ?? null;
  }
  const back = (b) => ({ kind: b.kind, cx: b.cx / s, cy: b.cy / s, w: b.w / s, h: b.h / s });
  // côté bleu = colonne de gauche (ou du haut)
  const order = (t) => (t[0][0].cx + t[0][0].cy <= t[1][0].cx + t[1][0].cy ? t : [t[1], t[0]]);
  let banTeams = null;
  if (bans) {
    // une ligne de 10 bans : les 5 de gauche pour le bleu, les 5 de droite pour le rouge
    const all = bans.teams.flat().sort((p, q) => p.cx - q.cx || p.cy - q.cy);
    banTeams = Math.abs(all[0].cy - all[9].cy) < all[0].h ? [all.slice(0, 5), all.slice(5)] : order(bans.teams);
  }
  return picks ? { picks: order(picks.teams).map((t) => t.map(back)), bans: banTeams ? banTeams.map((t) => t.map(back)) : null } : null;
}
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

// ---------- 3. Bandeaux : comparaison avec les illustrations ----------
// Recherche en 2 temps : en très petit sur toutes les illustrations (toutes tailles et positions),
// puis plus finement autour des meilleures positions des 24 champions les plus proches.
const CW = 20, SCALES = Array.from({ length: 22 }, (_, k) => 0.22 * (0.95 / 0.22) ** (k / 21));
let SPL = null;
async function loadSplashes() {
  if (SPL) return SPL;
  const data = (await import('./splashes.js')).default;
  const list = await Promise.all(Object.entries(data).map(([id, b64]) => new Promise((res) => {
    const im = new Image(); im.onload = () => res({ id, im }); im.onerror = () => res(null); im.src = 'data:image/jpeg;base64,' + b64;
  })));
  SPL = list.filter(Boolean);
  for (const sp of SPL) sp.coarse = SCALES.map((f) => pix(sp.im, 0, 0, sp.im.width, sp.im.height, Math.round(CW / f), Math.round((CW / f) * (sp.im.height / sp.im.width))));
  return SPL;
}
function pix(src, sx, sy, sw, sh, W, H) {
  const cv = pix.cv ??= document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data, a = new Float32Array(W * H * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { a[j] = d[i]; a[j + 1] = d[i + 1]; a[j + 2] = d[i + 2]; }
  return { a, W, H };
}
// gabarit centré et normalisé (moyenne par couleur), comme une corrélation normalisée
function tmpl(p) {
  const n = p.W * p.H, t = new Float32Array(n * 3), m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) m[c] += p.a[i * 3 + c];
  for (let c = 0; c < 3; c++) m[c] /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const v = p.a[i * 3 + c] - m[c]; t[i * 3 + c] = v; ss += v * v; }
  const k = Math.sqrt(ss) || 1;
  for (let j = 0; j < t.length; j++) t[j] /= k;
  return { t, W: p.W, H: p.H };
}
// sommes cumulées (par couleur + carrés) : la moyenne et la variance d'une fenêtre se lisent en 4 accès
function integ(P) {
  if (P.I) return P.I;
  const W1 = P.W + 1, I = [0, 1, 2, 3].map(() => new Float64Array(W1 * (P.H + 1)));
  for (let y = 0; y < P.H; y++) {
    const rs = [0, 0, 0, 0];
    for (let x = 0; x < P.W; x++) {
      const i = (y * P.W + x) * 3, r = P.a[i], g = P.a[i + 1], b = P.a[i + 2];
      rs[0] += r; rs[1] += g; rs[2] += b; rs[3] += r * r + g * g + b * b;
      for (let c = 0; c < 4; c++) I[c][(y + 1) * W1 + x + 1] = I[c][y * W1 + x + 1] + rs[c];
    }
  }
  return (P.I = I);
}
// meilleure corrélation du gabarit dans l'image, sur une zone de positions
function ncc(img, T, x0 = 0, x1 = img.W - T.W, y0 = 0, y1 = img.H - T.H, step = 1) {
  let best = -2, bx = 0, by = 0;
  const n = T.W * T.H, I = integ(img), W1 = img.W + 1, a = img.a, t = T.t, TW3 = T.W * 3, IW3 = img.W * 3;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(img.W - T.W, x1); y1 = Math.min(img.H - T.H, y1);
  const box = (c, x, y) => I[c][(y + T.H) * W1 + x + T.W] - I[c][y * W1 + x + T.W] - I[c][(y + T.H) * W1 + x] + I[c][y * W1 + x];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    const s0 = box(0, x, y), s1 = box(1, x, y), s2 = box(2, x, y), v = box(3, x, y) - (s0 * s0 + s1 * s1 + s2 * s2) / n;
    if (v <= 1) continue;
    let dot = 0;
    for (let ty = 0, ii = (y * img.W + x) * 3, tt = 0; ty < T.H; ty++, ii += IW3, tt += TW3) {
      for (let k = 0; k < TW3; k++) dot += a[ii + k] * t[tt + k];
    }
    const c = dot / Math.sqrt(v);
    if (c > best) { best = c; bx = x; by = y; }
  }
  return { c: best, x: bx, y: by };
}
export async function matchBanner(img, box, exclude = new Set()) {
  const spl = (await loadSplashes()).filter((sp) => !exclude.has(sp.id));
  const sx = box.cx - box.w / 2, sy = box.cy - box.h / 2, ratio = box.h / box.w;
  const T1 = tmpl(pix(img, sx, sy, box.w, box.h, CW, Math.max(4, Math.round(CW * ratio))));
  const coarse = [];
  for (let i = 0; i < spl.length; i++) {
    const sp = spl[i];
    if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0)); // l'interface reste fluide
    const peaks = SCALES.map((f, k) => ({ f, ...ncc(sp.coarse[k], T1, 0, undefined, 0, undefined, 2) })).sort((p, q) => q.c - p.c);
    coarse.push({ sp, c: peaks[0].c, peaks: peaks.slice(0, 3) });
  }
  coarse.sort((p, q) => q.c - p.c);
  const TW = 36, T2 = tmpl(pix(img, sx, sy, box.w, box.h, TW, Math.max(6, Math.round(TW * ratio))));
  const res = [];
  for (const { sp, peaks } of coarse.slice(0, 24)) {
    let best = -2;
    for (const pk of peaks) for (const kf of [0.92, 0.96, 1, 1.04, 1.08]) {
      const f = pk.f * kf, W = Math.round(TW / f), H = Math.round(W * (sp.im.height / sp.im.width));
      if (W < TW || H < T2.H) continue;
      const P = (sp.fine ??= {})[W] ??= pix(sp.im, 0, 0, sp.im.width, sp.im.height, W, H);
      const u = (pk.x * pk.f) / CW, v = (pk.y * pk.f) / CW, X = Math.round((u * TW) / f), Y = Math.round((v * TW) / f);
      const r = ncc(P, T2, X - 5, X + 5, Y - 5, Y + 5);
      if (r.c > best) best = r.c;
    }
    res.push({ id: sp.id, c: best });
  }
  return res.sort((p, q) => q.c - p.c).slice(0, 4).map((r) => r.id);
}
