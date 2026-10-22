// lolalytics : winrate / pickrate par champion et par rôle pour le patch courant.
// lolalytics n'a PAS d'API publique documentée : on essaie leurs points d'accès JSON
// connus puis on extrait les données de façon tolérante. Si le format change,
// l'app continue de marcher (winrate neutre de 50 %) et le signale dans l'en-tête.
const { get, norm, championIndex } = require('./http');

const LANES = { top: 'T', jungle: 'J', middle: 'M', bottom: 'A', support: 'S' };

// lolalytics a souvent 1 à 2 jours de retard sur un nouveau patch : on essaie le patch
// courant, puis le précédent, puis les 30 derniers jours.
function patchCandidates(patch) {
  const [maj, min] = patch.split('.').map(Number);
  const prev = min > 1 ? `${maj}.${min - 1}` : null;
  return [patch, prev, '30'].filter(Boolean);
}
function endpoints(patch, lane, tier) {
  const base = 'https://a1.lolalytics.com/mega/';
  return patchCandidates(patch).map(
    (p) => `${base}?ep=list&v=1&patch=${p}&lane=${lane}&tier=${tier}&queue=ranked&region=all`
  );
}

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

async function fetchLane(patch, lane, tier, idx) {
  let lastErr;
  for (const url of endpoints(patch, lane, tier)) {
    try {
      const json = await get(url);
      const data = extract(json, idx);
      if (Object.keys(data).length >= 15) return { data, patch: url.match(/patch=([^&]+)/)[1] };
      lastErr = new Error('format inattendu');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('aucune donnée');
}

async function fetchLolalytics(patch, tier, champions) {
  const idx = championIndex(champions);
  const results = await Promise.allSettled(
    Object.keys(LANES).map((lane) => fetchLane(patch, lane, tier, idx))
  );
  const stats = {};
  let okLanes = 0;
  let usedPatch = patch;
  // Sans OTP : on ne dispose pas de filtre « one-trick » ; on ramène vers la moyenne de la lane
  // les champions peu joués (là où les one-tricks font l'essentiel des games et gonflent le winrate).
  const damp = (pr) => pr / (pr + 1.2);
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    okLanes++;
    const role = Object.values(LANES)[i];
    usedPatch = r.value.patch;
    const rows = Object.entries(r.value.data);
    const tot = rows.reduce((a, [, x]) => a + (x.games || x.pr || 1), 0) || 1;
    const mean = rows.reduce((a, [, x]) => a + x.wr * (x.games || x.pr || 1), 0) / tot;
    for (const [id, s] of rows) {
      const cur = (stats[id] ??= { wrSum: 0, w: 0, pr: 0, roles: {}, roleWr: {} });
      const weight = s.games || s.pr || 1;
      cur.wrSum += (50 + (s.wr - mean) * damp(s.pr || 0)) * weight;
      cur.w += weight;
      cur.pr += s.pr;
      // part des parties du champion jouées dans ce rôle (en %)
      cur.roles[role] = s.pctLane ?? s.pr;
      cur.roleWr[role] = +(50 + (s.wr - mean)).toFixed(2);
    }
  });
  if (!okLanes) {
    const err = results.find((r) => r.status === 'rejected')?.reason;
    throw new Error(err?.message ?? 'lolalytics indisponible');
  }
  const final = {};
  for (const [id, s] of Object.entries(stats)) {
    final[id] = { wr: +(s.wrSum / s.w).toFixed(2), pr: +s.pr.toFixed(2), roles: s.roles, roleWr: s.roleWr };
  }
  return { stats: final, lanes: okLanes, patch: usedPatch };
}

// Détail d'un champion à sa lane, en Master+ sur les 30 derniers jours :
// face-à-face contre chaque lane adverse utile (counter) et duos avec ses alliés (build-team).
const LANE_NAME = { T: 'top', J: 'jungle', M: 'middle', A: 'bottom', S: 'support' };
const OPP = { T: ['T'], J: ['J'], M: ['M'], A: ['A', 'S'], S: ['S', 'A'] };
const SLUG = { monkeyking: 'wukong' };
const slug = (id) => { const s = String(id).toLowerCase().replace(/[^a-z0-9]/g, ''); return SLUG[s] ?? s; };
async function fetchDetail(champId, lane, tier = 'master_plus') {
  const base = `https://a1.lolalytics.com/mega/?v=1&patch=30&c=${slug(champId)}&lane=${LANE_NAME[lane]}&tier=${tier}&queue=ranked&region=all`;
  const vs = {}, team = {};
  let gm = null;
  await Promise.all([
    ...OPP[lane].map(async (o) => {
      const j = await get(`${base}&ep=counter&vslane=${LANE_NAME[o]}`);
      if (o === lane && j.stats) gm = { wr: +j.stats.wr, avg: +j.stats.avgWr, rel: +(+j.stats.wr - +j.stats.avgWr).toFixed(2) };
      vs[o] = Object.fromEntries((j.counters ?? []).filter((x) => x.n >= 20).map((x) => [x.cid, [x.vsWr, x.n]]));
    }),
    (async () => {
      const j = await get(`${base}&ep=build-team`);
      for (const [ln, rows] of Object.entries(j.team ?? {})) {
        const L = Object.entries(LANE_NAME).find(([, v]) => v === ln)?.[0];
        if (L) team[L] = Object.fromEntries(rows.filter((r) => r[5] >= 30).map((r) => [r[0], [r[1], r[3], r[5]]]));
      }
    })()
  ]);
  return { vs, team, gm };
}

module.exports = { fetchLolalytics, extract, fetchDetail };
