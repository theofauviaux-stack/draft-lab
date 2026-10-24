// lolalytics : winrate / pickrate par champion et par rôle, en Master+ sur les 30 derniers jours
// (depuis son dernier changement pour un champion modifié pendant ces 30 jours).
// lolalytics n'a PAS d'API publique documentée : on essaie leurs points d'accès JSON
// connus puis on extrait les données de façon tolérante. Si le format change,
// l'app continue de marcher (winrate neutre de 50 %) et le signale dans l'en-tête.
const { get, norm, championIndex } = require('./http');

const LANES = { top: 'T', jungle: 'J', middle: 'M', bottom: 'A', support: 'S' };

const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

// Parcours récursif : trouve tout objet qui ressemble à "un champion avec un winrate".
function extract(json, idx) {
  const out = {};
  const visit = (node, keyHint, depth) => {
    if (!node || typeof node !== 'object' || depth > 9) return;
    if (Array.isArray(node)) {
      node.forEach((v) => visit(v, undefined, depth + 1));
      return;
    }
    const wr = num(node.wr ?? node.winrate ?? node.winRate ?? node.win_rate);
    const raw = node.cid ?? node.championId ?? node.key ?? node.id ?? keyHint;
    const id =
      idx.byKey.get(String(raw)) ||
      idx.byName.get(norm(node.name ?? node.champion)) ||
      idx.byName.get(norm(raw));
    if (id && wr != null && wr > 25 && wr < 75) {
      out[id] = {
        wr,
        pr: num(node.pr ?? node.pickrate ?? node.pickRate ?? node.pick_rate) ?? 0,
        pctLane: num(node.pctLane),
        games: num(node.games ?? node.n ?? node.matches) ?? 0
      };
    }
    for (const [k, v] of Object.entries(node)) visit(v, k, depth + 1);
  };
  visit(json, undefined, 0);
  return out;
}

const { patchesSince } = require('./patches');
const listUrl = (p, lane, tier) =>
  `https://a1.lolalytics.com/mega/?ep=list&v=1&patch=${p}&lane=${lane}&tier=${tier}&queue=ranked&region=all`;

// Liste d'une lane pour une fenêtre donnée ('30' = 30 derniers jours, ou un patch '16.21').
// Chaque champion : winrate relatif à la moyenne de la lane sur CETTE fenêtre (rel), games, pickrate.
async function fetchList(p, lane, tier, idx) {
  const data = extract(await get(listUrl(p, lane, tier)), idx);
  const rows = Object.values(data);
  if (rows.length < 15) throw new Error('format inattendu');
  const tot = rows.reduce((a, x) => a + (x.games || x.pr || 1), 0) || 1;
  const mean = rows.reduce((a, x) => a + x.wr * (x.games || x.pr || 1), 0) / tot;
  for (const x of Object.values(data)) x.rel = x.wr - mean;
  return data;
}

// Fenêtre des données : les 30 derniers jours pour tout le monde, sauf les champions modifiés
// par un patch sorti pendant ces 30 jours (changed = { champId: '16.20' }) : pour eux, seulement
// les patchs depuis ce changement (games additionnées patch par patch).
async function fetchLane(patch, lane, tier, idx, changed) {
  const base = await fetchList('30', lane, tier, idx).catch(() => null);
  const need = new Set(Object.values(changed).flatMap((p) => patchesSince(p, patch)));
  if (!base) need.add(patch);
  const per = {};
  await Promise.all([...need].map(async (p) => { per[p] = await fetchList(p, lane, tier, idx).catch(() => null); }));
  const out = {};
  const src = base ?? per[patch];
  if (!src) throw new Error('aucune donnée');
  for (const [id, x] of Object.entries(src)) {
    const since = changed[id];
    if (!since || !base) { out[id] = { ...x }; continue; }
    let g = 0, r = 0;
    for (const p of patchesSince(since, patch)) {
      const y = per[p]?.[id];
      if (y?.games) { g += y.games; r += y.rel * y.games; }
    }
    // rôles et popularité : sur 30 jours (ils changent peu) ; winrate : seulement depuis le patch
    // (peu de games depuis le changement = écart ramené vers la moyenne)
    out[id] = { ...x, games: g, rel: g ? (r / g) * (g / (g + 600)) : 0, since };
  }
  // champion sorti ou revenu pendant la fenêtre, absent des 30 jours
  for (const p of need) for (const [id, y] of Object.entries(per[p] ?? {})) if (!out[id] && changed[id]) out[id] = { ...y, since: changed[id] };
  return out;
}

async function fetchLolalytics(patch, tier, champions, changed = {}) {
  const idx = championIndex(champions);
  const results = await Promise.allSettled(
    Object.keys(LANES).map((lane) => fetchLane(patch, lane, tier, idx, changed))
  );
  const stats = {};
  let okLanes = 0;
  // Sans OTP : on ne dispose pas de filtre « one-trick » ; on ramène vers la moyenne de la lane
  // les champions peu joués (là où les one-tricks font l'essentiel des games et gonflent le winrate).
  const damp = (pr) => pr / (pr + 1.2);
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    okLanes++;
    const role = Object.values(LANES)[i];
    for (const [id, s] of Object.entries(r.value)) {
      const cur = (stats[id] ??= { wrSum: 0, w: 0, pr: 0, roles: {}, roleWr: {}, since: s.since ?? null });
      const weight = s.games || s.pr || 1;
      cur.wrSum += (50 + s.rel * damp(s.pr || 0)) * weight;
      cur.w += weight;
      cur.pr += s.pr;
      // part des parties du champion jouées dans ce rôle (en %)
      cur.roles[role] = s.pctLane ?? s.pr;
      cur.roleWr[role] = +(50 + s.rel).toFixed(2);
    }
  });
  if (!okLanes) {
    const err = results.find((r) => r.status === 'rejected')?.reason;
    throw new Error(err?.message ?? 'lolalytics indisponible');
  }
  const final = {};
  for (const [id, s] of Object.entries(stats)) {
    final[id] = { wr: +(s.wrSum / s.w).toFixed(2), pr: +s.pr.toFixed(2), roles: s.roles, roleWr: s.roleWr, ...(s.since ? { since: s.since } : {}) };
  }
  return { stats: final, lanes: okLanes, patch: '30 jours' };
}

// Détail d'un champion à sa lane, en Master+ sur les 30 derniers jours :
// face-à-face contre chaque lane adverse utile (counter) et duos avec ses alliés (build-team).
const LANE_NAME = { T: 'top', J: 'jungle', M: 'middle', A: 'bottom', S: 'support' };
const OPP = { T: ['T'], J: ['J'], M: ['M'], A: ['A', 'S'], S: ['S', 'A'] };
const SLUG = { monkeyking: 'wukong' };
const slug = (id) => { const s = String(id).toLowerCase().replace(/[^a-z0-9]/g, ''); return SLUG[s] ?? s; };
// since : patch du dernier changement du champion (null = 30 derniers jours). Avec since, on lit chaque
// patch depuis ce changement et on additionne les games.
async function fetchDetailWin(champId, lane, tier, p) {
  const base = `https://a1.lolalytics.com/mega/?v=1&patch=${p}&c=${slug(champId)}&lane=${LANE_NAME[lane]}&tier=${tier}&queue=ranked&region=all`;
  const vs = {}, team = {};
  let gm = null;
  await Promise.all([
    ...OPP[lane].map(async (o) => {
      const j = await get(`${base}&ep=counter&vslane=${LANE_NAME[o]}`);
      const rows = j.counters ?? [];
      if (o === lane && j.stats) gm = { wr: +j.stats.wr, avg: +j.stats.avgWr, n: rows.reduce((a, x) => a + (x.n || 0), 0) };
      vs[o] = Object.fromEntries(rows.map((x) => [x.cid, [x.vsWr, x.n]]));
    }),
    (async () => {
      const j = await get(`${base}&ep=build-team`);
      for (const [ln, rows] of Object.entries(j.team ?? {})) {
        const L = Object.entries(LANE_NAME).find(([, v]) => v === ln)?.[0];
        if (L) team[L] = Object.fromEntries(rows.map((r) => [r[0], [r[1], r[3], r[5]]]));
      }
    })()
  ]);
  return { vs, team, gm };
}
async function fetchDetail(champId, lane, tier = 'master_plus', { since = null, patch = null } = {}) {
  const wins = since && patch ? patchesSince(since, patch) : ['30'];
  const parts = (await Promise.all(wins.map((p) => fetchDetailWin(champId, lane, tier, p).catch(() => null)))).filter(Boolean);
  if (!parts.length) throw new Error('lolalytics indisponible');
  // addition des fenêtres : moyenne des winrates pondérée par les games
  const vs = {}, team = {};
  for (const part of parts) {
    for (const [o, m] of Object.entries(part.vs)) for (const [cid, [wr, n]] of Object.entries(m)) {
      const x = ((vs[o] ??= {})[cid] ??= [0, 0]); x[0] += wr * n; x[1] += n;
    }
    for (const [L, m] of Object.entries(part.team)) for (const [cid, [wr, d2, n]] of Object.entries(m)) {
      const x = ((team[L] ??= {})[cid] ??= [0, 0, 0]); x[0] += wr * n; x[1] += d2 * n; x[2] += n;
    }
  }
  for (const m of Object.values(vs)) for (const [cid, x] of Object.entries(m)) { if (x[1] < 20) delete m[cid]; else m[cid] = [+(x[0] / x[1]).toFixed(2), x[1]]; }
  for (const m of Object.values(team)) for (const [cid, x] of Object.entries(m)) { if (x[2] < 30) delete m[cid]; else m[cid] = [+(x[0] / x[2]).toFixed(2), +(x[1] / x[2]).toFixed(2), x[2]]; }
  const g = parts.map((p) => p.gm).filter((x) => x && x.n);
  const gn = g.reduce((a, x) => a + x.n, 0);
  const gm = gn ? (() => { const wr = g.reduce((a, x) => a + x.wr * x.n, 0) / gn, avg = g.reduce((a, x) => a + x.avg * x.n, 0) / gn; return { wr: +wr.toFixed(2), avg: +avg.toFixed(2), rel: +(wr - avg).toFixed(2), n: gn }; })() : null;
  return { vs, team, gm, since: since && patch ? since : null };
}

module.exports = { fetchLolalytics, extract, fetchDetail };
