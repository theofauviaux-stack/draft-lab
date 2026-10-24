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

// Fenêtre des données : les patchs des 30 derniers jours, les plus récents pesant plus
// (wins = [{ patch: '16.21', w: 1 }, { patch: '16.20', w: 0.6 }, { patch: '16.19', w: 0.35 }]).
// Un champion modifié pendant ces 30 jours (changed = { champId: '16.20' }) ne garde que les patchs
// depuis ce changement.
const vnum = (p) => p.split('.').map(Number).reduce((a, x) => a * 100 + x, 0);
async function fetchLane(patch, lane, tier, idx, changed, wins) {
  const per = await Promise.all(wins.map((x) => fetchList(x.patch, lane, tier, idx).catch(() => null)));
  if (!per.some(Boolean)) {
    // aucun patch lisible (lolalytics en retard ou format changé) : 30 derniers jours d'un bloc
    const base = await fetchList('30', lane, tier, idx);
    return Object.fromEntries(Object.entries(base).map(([id, x]) => [id, { ...x }]));
  }
  const out = {};
  const ids = new Set(per.flatMap((d) => Object.keys(d ?? {})));
  for (const id of ids) {
    const since = changed[id] ?? null;
    let g = 0, gw = 0, r = 0, best = null;
    wins.forEach((x, k) => {
      const y = per[k]?.[id];
      if (!y?.games) return;
      if (!best || y.games > best.games) best = y; // rôles et popularité : le patch le plus fourni
      if (since && vnum(x.patch) < vnum(since)) return; // avant le changement du champion : ignoré
      g += y.games; gw += y.games * x.w; r += y.rel * y.games * x.w;
    });
    if (!best) continue;
    // peu de games (champion modifié très récemment) : écart ramené vers la moyenne
    const rel = gw ? (r / gw) * (since ? g / (g + 600) : 1) : 0;
    out[id] = { ...best, games: g || best.games, rel, ...(since ? { since } : {}) };
  }
  return out;
}

async function fetchLolalytics(patch, tier, champions, changed = {}, wins = [{ patch, w: 1 }]) {
  const idx = championIndex(champions);
  const results = await Promise.allSettled(
    Object.keys(LANES).map((lane) => fetchLane(patch, lane, tier, idx, changed, wins))
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
  return { stats: final, lanes: okLanes, patch: '30 jours', tier };
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
      // lolalytics gonfle tous les winrates (moyenne de la lane ≈ 51,7 % au lieu de 50) : on recale
      // chaque face-à-face sur la moyenne de la requête, pour que « 50 % » veuille dire « égal »
      const mean = Number.isFinite(+j.stats?.avgWr) ? +j.stats.avgWr : 50;
      vs[o] = Object.fromEntries(rows.map((x) => [x.cid, [x.vsWr - mean + 50, x.n]]));
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
// Niveau élargi qui complète un matchup trop peu joué au niveau de la partie
const BROAD = { iron: 'all', bronze: 'all', silver: 'gold_plus', gold: 'gold_plus', platinum: 'platinum_plus', emerald: 'emerald_plus', diamond: 'diamond_plus', master_plus: 'diamond_plus', emerald_plus: 'platinum_plus', diamond_plus: 'emerald_plus', platinum_plus: 'gold_plus', gold_plus: 'all' };
const FILL = 200; // en dessous de 200 games au niveau de la partie, on complète
function addWin(acc, part, w) {
  for (const [o, m] of Object.entries(part.vs)) for (const [cid, [wr, n]] of Object.entries(m)) {
    const x = ((acc.vs[o] ??= {})[cid] ??= [0, 0, 0]); x[0] += wr * n * w; x[1] += n * w; x[2] += n;
  }
  for (const [L, m] of Object.entries(part.team)) for (const [cid, [wr, d2, n]] of Object.entries(m)) {
    const x = ((acc.team[L] ??= {})[cid] ??= [0, 0, 0, 0]); x[0] += wr * n * w; x[1] += d2 * n * w; x[2] += n * w; x[3] += n;
  }
  if (part.gm?.n) acc.gm.push({ ...part.gm, w });
}
// Matchups et duos d'un champion à sa lane, au niveau de la partie (tier), patch par patch :
// les patchs récents pèsent plus (wins), rien d'avant le dernier changement du champion (since),
// et un matchup trop peu joué est complété par le niveau élargi sur 30 jours.
async function fetchDetail(champId, lane, tier = 'master_plus', { since = null, patch = null, wins = null } = {}) {
  let W = wins?.length ? wins : [{ patch: '30', w: 1 }];
  if (since) W = W.filter((x) => x.patch === '30' || vnum(x.patch) >= vnum(since));
  if (!W.length) W = [{ patch: patch ?? '30', w: 1 }];
  const broad = BROAD[tier] ?? null;
  const [parts, wide] = await Promise.all([
    Promise.all(W.map((x) => fetchDetailWin(champId, lane, tier, x.patch).then((d) => ({ d, w: x.w })).catch(() => null))),
    broad ? fetchDetailWin(champId, lane, broad, since ? W[W.length - 1].patch : '30').catch(() => null) : null
  ]);
  const ok = parts.filter(Boolean);
  if (!ok.length && !wide) throw new Error('lolalytics indisponible');
  const acc = { vs: {}, team: {}, gm: [] };
  for (const { d, w } of ok) addWin(acc, d, w);
  const vs = {}, team = {};
  for (const [o, m] of Object.entries(acc.vs)) for (const [cid, [s, wn, n]] of Object.entries(m)) (vs[o] ??= {})[cid] = [s / wn, n];
  for (const [L, m] of Object.entries(acc.team)) for (const [cid, [s, s2, wn, n]] of Object.entries(m)) (team[L] ??= {})[cid] = [s / wn, s2 / wn, n];
  // complément du niveau élargi pour les matchups et duos peu joués au niveau de la partie
  if (wide) {
    for (const [o, m] of Object.entries(wide.vs)) for (const [cid, [wr, n]] of Object.entries(m)) {
      const cur = (vs[o] ??= {})[cid], have = cur?.[1] ?? 0;
      if (have >= FILL || !n) continue;
      const add = Math.min(n, FILL - have);
      vs[o][cid] = cur ? [(cur[0] * have + wr * add) / (have + add), have + add] : [wr, add];
    }
    for (const [L, m] of Object.entries(wide.team)) for (const [cid, [wr, d2, n]] of Object.entries(m)) {
      const cur = (team[L] ??= {})[cid], have = cur?.[2] ?? 0;
      if (have >= FILL || !n) continue;
      const add = Math.min(n, FILL - have);
      team[L][cid] = cur ? [(cur[0] * have + wr * add) / (have + add), (cur[1] * have + d2 * add) / (have + add), have + add] : [wr, d2, add];
    }
  }
  const round = (o, minN, k) => { for (const m of Object.values(o)) for (const [cid, x] of Object.entries(m)) { if (x[k] < minN) delete m[cid]; else m[cid] = x.map((v, i) => (i === k ? Math.round(v) : +v.toFixed(2))); } };
  round(vs, 20, 1); round(team, 30, 2);
  const g = acc.gm, gw = g.reduce((a, x) => a + x.n * x.w, 0);
  const gm = gw ? (() => { const wr = g.reduce((a, x) => a + x.wr * x.n * x.w, 0) / gw, avg = g.reduce((a, x) => a + x.avg * x.n * x.w, 0) / gw; return { wr: +wr.toFixed(2), avg: +avg.toFixed(2), rel: +(wr - avg).toFixed(2), n: g.reduce((a, x) => a + x.n, 0) }; })() : null;
  return { vs, team, gm, since: since ?? null, tier };
}

module.exports = { fetchLolalytics, extract, fetchDetail };
