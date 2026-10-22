// Moteur d'analyse : pentagone des compos, winrate estimé, scaling, objectifs, plan de jeu.
import { profileFor } from './champdb.js';
import { teamSynergy, synergyWith, pair } from './synergy.js';
import { COACH, ADC_RANGE, rangeValue } from './coachdata.js';
import { SUPPORT_FR, fr } from './coach_fr.js';

const NAMES = {};
const nm = (id) => NAMES[id] ?? id;

// Mode de jeu : 'soloq' (données lolalytics) ou 'pro' (données gol.gg)
let MODE = 'soloq';
export const setMode = (m) => { MODE = m === 'pro' ? 'pro' : 'soloq'; };

export const ROLES = ['T', 'J', 'M', 'A', 'S'];
export const ROLE_LABEL = { T: 'Top', J: 'Jungle', M: 'Mid', A: 'ADC', S: 'Support' };

// Ordre du pentagone : chaque style bat le suivant (gros avantage) et celui d'après (léger avantage).
// Engage › Split › Poke › Peeling › Catch › Engage
export const ORDER = ['e', 's', 'p', 'd', 'c'];
export const ARCH = {
  e: { label: 'Engage', color: '#e2502f', short: 'ENG', desc: 'forcer les teamfights' },
  s: { label: 'Split', color: '#8e4fd6', short: 'SPL', desc: 'pression en side lane' },
  p: { label: 'Poke', color: '#d98a0b', short: 'POK', desc: 'user avant le fight' },
  d: { label: 'Peeling', color: '#1f9d5b', short: 'PEE', desc: 'protéger le carry (peel)' },
  c: { label: 'Catch', color: '#3a6fd8', short: 'CAT', desc: 'attraper un joueur isolé' }
};

// +1 gros avantage, +0.5 léger, -0.5 léger désavantage, -1 gros désavantage, 0 miroir
export function rel(a, b) {
  const k = (ORDER.indexOf(b) - ORDER.indexOf(a) + 5) % 5;
  return [0, 1, 0.5, -0.5, -1][k];
}
export const beaters = (x) => ORDER.filter((a) => rel(a, x) > 0).sort((a, b) => rel(b, x) - rel(a, x));
export const victims = (x) => ORDER.filter((b) => rel(x, b) > 0).sort((a, b) => rel(x, b) - rel(x, a));
export function relText(a, b) {
  const r = rel(a, b);
  return r === 1 ? 'gros avantage' : r === 0.5 ? 'léger avantage' : r === -0.5 ? 'léger désavantage' : r === -1 ? 'gros désavantage' : 'miroir';
}

const W = { comfort: 0.8, synergy: 1.2, pentagon: 8, clarity: 2.5, strength: 0.6, damage: 2.5, frontline: 2, engageTool: 1.2 };

// Rôles et winrates : on mélange lolalytics (soloQ) et gol.gg (compétition).
//  - part d'un rôle = moyenne pondérée des deux sources (le pro pèse plus quand il y a assez de games)
//  - un rôle n'est retenu que s'il pèse au moins 20 % du champion : pas de picks extrêmes (Vi ADC, Vel'Koz ADC…)
//  - winrate mélangé puis adouci (±4 points max autour de 50 %)
export function buildProfiles(champions, stats = {}, pro = {}, mode = MODE) {
  setMode(mode);
  const map = {};
  const hasPro = Object.keys(pro).length > 0;
  for (const c of champions) {
    const prof = profileFor(c);
    const s = stats[c.id], p = pro[c.id];
    const dbRoles = prof.roles;
    const solo = s?.roles ?? null; // % des games soloQ par rôle
    const proPicks = p?.picks ?? 0;
    // le pro ne compte pour les rôles qu'avec un échantillon suffisant (30 games)
    const proPct = p?.roles && proPicks >= 30
      ? Object.fromEntries(Object.entries(p.roles).map(([r, v]) => [r, (v.picks / proPicks) * 100])) : null;
    const wPro = proPct ? Math.min(1, proPicks / (mode === 'pro' ? 40 : 80)) * (mode === 'pro' ? 0.7 : 0.4) : 0;
    const share = {};
    for (const r of ROLES) {
      const a = solo ? (solo[r] ?? 0) : null, b = proPct ? (proPct[r] ?? 0) : null;
      if (a == null && b == null) share[r] = dbRoles.includes(r) ? 100 / dbRoles.length : 0;
      else if (a == null) share[r] = b;
      else if (b == null) share[r] = a;
      else share[r] = (1 - wPro) * a + wPro * b;
    }
    const minShare = 20;
    let roles = ROLES.filter((r) => share[r] >= minShare).sort((x, y) => share[y] - share[x]);
    if (!roles.length) roles = [ROLES.reduce((x, y) => (share[x] >= share[y] ? x : y))];
    prof.roles = roles;
    prof.roleShare = share;
    prof.rolePct = solo;
    prof.soloRoles = solo ? ROLES.filter((r) => (solo[r] ?? 0) >= 10) : dbRoles;
    prof.proRoles = proPct ? ROLES.filter((r) => (p.roles[r]?.picks ?? 0) >= Math.max(10, 0.1 * proPicks)) : [];
    // Winrate pro "lissé" : peu de games = on reste proche de 50 %
    const proWr = p?.wr != null && proPicks ? (p.wr * proPicks + 50 * 40) / (proPicks + 40) : null;
    // soloQ Master+ (ramené à la moyenne de la lane, champions peu joués atténués pour limiter l'effet one-trick)
    const soloWr = s?.wr ?? null;
    let wr = null;
    // Pro + Master+ : le pro (sans one-tricks) pèse jusqu'à 50 % selon son nombre de games
    let wP = 0;
    if (soloWr != null && proWr != null) { wP = 0.5 * proPicks / (proPicks + 200); wr = (1 - wP) * soloWr + wP * proWr; }
    else wr = soloWr ?? proWr;
    if (wr != null) wr = 50 + Math.max(-4, Math.min(4, wr - 50));
    // En mode pro : un champion quasiment jamais joué en compétition est signalé (et pas proposé)
    const offmeta = mode === 'pro' && hasPro && proPicks < 5;
    NAMES[c.id] = c.name;
    map[c.id] = {
      ...prof, id: c.id, key: +c.key, name: c.name, offmeta,
      wr, soloWr, proWr, wPro: wP, pr: s?.pr ?? 0,
      presence: p?.presence ?? 0, proPicks, proRoleStats: p?.roles ?? null
    };
  }
  return map;
}

export function teamStats(team) {
  const s = { e: 0, s: 0, c: 0, p: 0, d: 0, f: 0, ap: 0, ad: 0, n: team.length, wr: 0, hasWr: false };
  for (const c of team) {
    for (const k of ORDER) s[k] += c[k];
    s.f += c.f;
    if (c.dmg === 'M') s.ap += 1; else if (c.dmg === 'P') s.ad += 1; else { s.ap += 0.5; s.ad += 0.5; }
    if (c.wr != null) { s.wr += c.wr - 50; s.hasWr = true; }
  }
  return s;
}
export function shares(s) {
  const t = ORDER.reduce((a, k) => a + s[k], 0);
  return t ? Object.fromEntries(ORDER.map((k) => [k, s[k] / t])) : null;
}
export const teamShares = (team) => shares(teamStats(team));
export const dominant = (sh) => (sh ? ORDER.reduce((a, b) => (sh[a] >= sh[b] ? a : b)) : null);
const ranked = (sh) => [...ORDER].sort((a, b) => sh[b] - sh[a]);
const clarity = (sh) => (sh ? Math.max(0, (Math.max(...ORDER.map((k) => sh[k])) - 0.2) * 1.25) : 0);

function damagePenalty(s) {
  if (s.n < 3) return 0;
  const ap = s.ap / (s.ap + s.ad);
  return ap < 0.15 || ap > 0.85 ? -W.damage * (s.n / 5) : 0;
}
const frontPenalty = (s) => (s.n >= 4 && s.f < 3 ? -W.frontline : 0);
const engagePenalty = (s) => (s.n >= 4 && s.e + s.c < 3 ? -W.engageTool : 0);

// ---------- Données Master+ (lolalytics) : face-à-face par lane et duos ----------
// DETAIL(key, lane) renvoie { vs: { lane: { cid: [vsWr, n] } }, team: { lane: { cid: [wr, d2, n] } } } ou null.
let DETAIL = () => null;
export const setDetailSource = (fn) => { DETAIL = fn; };
const LANE_OPP = { T: ['T'], J: ['J'], M: ['M'], A: ['A', 'S'], S: ['S', 'A'] };
const shrink = (n, k) => n / (n + k);
// Avantage (en points de winrate) de a (à sa lane) contre b (à la sienne), vu des deux côtés quand c'est possible.
export function laneEdge(a, la, b, lb) {
  const vals = [];
  const da = DETAIL(a.key, la)?.vs?.[lb]?.[b.key];
  if (da) vals.push([da[0] - 50, da[1]]);
  const db = DETAIL(b.key, lb)?.vs?.[la]?.[a.key];
  if (db) vals.push([50 - db[0], db[1]]);
  if (!vals.length) return null;
  const n = vals.reduce((x, v) => x + v[1], 0);
  const edge = vals.reduce((x, v) => x + v[0] * v[1], 0) / n;
  return { edge: edge * shrink(n, 250), raw: +edge.toFixed(1), n };
}
// Synergie mesurée d'un duo (écart au winrate attendu des deux champions)
export function duoEdge(a, la, b, lb) {
  const vals = [];
  const da = DETAIL(a.key, la)?.team?.[lb]?.[b.key];
  if (da) vals.push([da[1], da[2], da[0]]);
  const db = DETAIL(b.key, lb)?.team?.[la]?.[a.key];
  if (db) vals.push([db[1], db[2], db[0]]);
  if (!vals.length) return null;
  const n = Math.max(...vals.map((v) => v[1]));
  const d = vals.reduce((x, v) => x + v[0], 0) / vals.length;
  return { edge: d * shrink(n, 300), raw: +d.toFixed(1), n, wr: vals[0][2] };
}
const LN_FR = { T: 'Top', J: 'Jungle', M: 'Mid', A: 'ADC', S: 'Support' };
// ---------- Games pro du patch (gol.gg) ----------
// Ordre officiel : B1 R1 R2 B2 B3 R3 R4 B4 B5 R5
const ORDER_POS = { b: [0, 3, 4, 7, 8], r: [1, 2, 5, 6, 9] };
const ROLE_AT = ['T', 'J', 'M', 'A', 'S'];
let PRO = { patches: [], games: 0, champ: {}, h2h: {}, resp: {} };
const vnum = (p) => p.split('.').map(Number).reduce((a, x) => a * 100 + x, 0);
// Choisit le patch joué en compétition (le plus récent), plus le précédent s'il y a trop peu de games,
// puis calcule winrate pro par champion, face-à-face par lane et réponses (pick pris après, en face).
export function applyProGames(P, games) {
  const list = Object.values(games ?? {});
  const byPatch = {};
  for (const g of list) (byPatch[g.patch] ??= []).push(g);
  const patches = Object.keys(byPatch).sort((a, b) => vnum(b) - vnum(a));
  const use = [];
  let n = 0;
  for (const p of patches) { use.push(p); n += byPatch[p].length; if (n >= 150) break; }
  const champ = {}, h2h = {}, resp = {};
  const add = (o, a, b, win) => { const x = ((o[a] ??= {})[b] ??= { n: 0, w: 0 }); x.n++; if (win) x.w++; };
  for (const p of use) for (const g of byPatch[p]) {
    const pos = {}, role = {}, side = {};
    g.bp.forEach((c, i) => { pos[c] = ORDER_POS.b[i]; side[c] = 'blue'; });
    g.rp.forEach((c, i) => { pos[c] = ORDER_POS.r[i]; side[c] = 'red'; });
    g.br.forEach((c, i) => { role[c] = ROLE_AT[i]; }); g.rr.forEach((c, i) => { role[c] = ROLE_AT[i]; });
    for (const c of [...g.bp, ...g.rp]) { const x = (champ[c] ??= { n: 0, w: 0 }); x.n++; if (g.win === side[c]) x.w++; }
    for (const a of g.bp) for (const b of g.rp) {
      if (!role[a] || !role[b] || !LANE_OPP[role[a]].includes(role[b])) continue;
      const aWin = g.win === 'blue';
      add(h2h, a, b, aWin); add(h2h, b, a, !aWin);
      const [first, second] = pos[a] < pos[b] ? [a, b] : [b, a];
      add(resp, first, second, g.win === side[second]); // victoire du champion pris en réponse
    }
  }
  PRO = { patches: use, games: n, champ, h2h, resp };
  // Winrate pro du patch : remplace celui de la saison quand il y a assez de games
  for (const c of Object.values(P)) {
    const x = champ[c.id];
    c.proPatch = x ? { n: x.n, wr: +((x.w / x.n) * 100).toFixed(1) } : null;
    if (c.soloWr == null) continue;
    const season = c.proWr, pw = x ? ((x.w + 0.5 * 8) / (x.n + 8)) * 100 : null;
    const wPatch = x ? 0.5 * x.n / (x.n + 15) : 0;
    const wSeason = season != null ? 0.15 * (c.proPicks / (c.proPicks + 200)) : 0;
    let wr = c.soloWr * (1 - wPatch - wSeason) + (pw ?? 50) * wPatch + (season ?? 50) * wSeason;
    c.wr = 50 + Math.max(-4, Math.min(4, wr - 50));
    c.wPro = wPatch + wSeason;
  }
  return PRO;
}
export const proInfo = () => PRO;
function proEdge(a, b) {
  // Si l'ordre de pick est connu, on regarde d'abord les réponses dans le même ordre (a pris avant b, ou l'inverse)
  if (a.po != null && b.po != null) {
    const [first, second] = a.po < b.po ? [a, b] : [b, a];
    const r = PRO.resp[first.id]?.[second.id];
    if (r && r.n >= 2) {
      const respWr = r.w / r.n, aWr = second === a ? respWr : 1 - respWr;
      return { edge: (aWr - 0.5) * 100 * (r.n / (r.n + 6)), n: r.n, w: second === a ? r.w : r.n - r.w, resp: true, first, second, rw: r.w };
    }
  }
  const h = PRO.h2h[a.id]?.[b.id];
  if (!h || h.n < 2) return null;
  return { edge: (h.w / h.n - 0.5) * 100 * (h.n / (h.n + 6)), n: h.n, w: h.w, resp: false };
}

function gmFactors(blue, red) {
  let lane = 0, duo = 0; const lt = [], dt = [];
  for (const a of blue) for (const b of red) {
    if (!a.lane || !b.lane || !LANE_OPP[a.lane].includes(b.lane)) continue;
    const e = laneEdge(a, a.lane, b, b.lane);
    if (!e) continue;
    lane += e.edge;
    if (Math.abs(e.raw) >= 2) lt.push(`${a.name} ${e.raw > 0 ? '>' : '<'} ${b.name} (${(50 + e.raw).toFixed(0)} %, ${e.n} games)`);
  }
  for (const [side, t, sg] of [['bleu', blue, 1], ['rouge', red, -1]]) {
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
      const a = t[i], b = t[j];
      if (!a.lane || !b.lane) continue;
      const e = duoEdge(a, a.lane, b, b.lane);
      if (!e || e.n < 40) continue;
      duo += sg * e.edge;
      if (Math.abs(e.raw) >= 1.5) dt.push(`${a.name} + ${b.name} (${side}) ${e.raw > 0 ? '+' : ''}${e.raw}`);
    }
  }
  let pro = 0; const pt = [];
  for (const a of blue) for (const b of red) {
    if (!a.lane || !b.lane || !LANE_OPP[a.lane].includes(b.lane)) continue;
    const e = proEdge(a, b);
    if (!e) continue;
    pro += e.edge;
    pt.push(e.resp ? `${e.second.name} pris en réponse à ${e.first.name} : ${e.rw} victoire${e.rw > 1 ? 's' : ''} sur ${e.n}` : `${a.name} contre ${b.name} : ${e.w}/${e.n} pour ${a.name}`);
  }
  return { lane: Math.max(-7, Math.min(7, lane * 0.55)), duo: Math.max(-4, Math.min(4, duo * 0.5)), pro: Math.max(-6, Math.min(6, pro * 0.35)), lt, dt, pt };
}

export function evaluate(blue, red) {
  const B = teamStats(blue), R = teamStats(red);
  const sb = shares(B), sr = shares(R);
  const factors = [];
  const add = (key, label, value, detail) => { if (Math.abs(value) >= 0.05) factors.push({ key, label, value, detail }); };

  if (sb && sr) {
    let adv = 0;
    for (const i of ORDER) for (const j of ORDER) adv += sb[i] * sr[j] * rel(i, j);
    const c = Math.min(B.n, R.n) / 5;
    const db = dominant(sb), dr = dominant(sr);
    add('pentagon', 'Pentagone des compos', adv * W.pentagon * c,
      `Compo bleue de type ${ARCH[db].label} face à une compo rouge de type ${ARCH[dr].label} : ${relText(db, dr)} pour bleu. Le score compte toute la répartition des deux compos.`);
  }
  add('clarity', 'Clarté du plan de jeu', (clarity(sb) * (B.n / 5) - clarity(sr) * (R.n / 5)) * W.clarity,
    'Une compo avec une identité nette joue mieux ses fights');
  if (B.hasWr || R.hasWr) add('strength', 'Force des champions (pro + Master+)', (B.wr - R.wr) * W.strength,
    'Winrate Master+ (one-tricks atténués) mélangé au winrate pro de la saison : détail par champion ci-dessous');
  const synB = teamSynergy(blue), synR = teamSynergy(red);
  const gm = gmFactors(blue, red);
  // quand les duos sont mesurés en Master+, la table de synergies théoriques pèse moins
  const synW = gm.dt.length || Math.abs(gm.duo) > 0.2 ? W.synergy * 0.55 : W.synergy;
  const synV = Math.max(-6, Math.min(6, (synB.total - synR.total) * synW));
  add('lanes', 'Face-à-face des lanes (Master+)', gm.lane, gm.lt.length ? gm.lt.slice(0, 4).join(' · ') : 'Winrates des matchups en Master+ (lolalytics), lissés selon le nombre de games');
  if (PRO.games) add('pro', `Réponses en pro (patch ${PRO.patches.join(' / ')})`, gm.pro, gm.pt.length ? gm.pt.slice(0, 4).join(' · ') : `Face-à-face des lanes dans les ${PRO.games} games pro du patch, selon l’ordre de pick`);
  add('duos', 'Duos mesurés (Master+)', gm.duo, gm.dt.length ? gm.dt.slice(0, 4).join(' · ') : 'Synergie réelle des duos en Master+');
  const pairTxt = (pp) => pp.slice(0, 2).map((x) => `${x.a.name} + ${x.b.name} (${x.title})`).join(', ');
  add('synergy', 'Synergies entre champions', synV,
    [synB.pairs.length ? `Bleu : ${pairTxt(synB.pairs)}` : '', synR.pairs.length ? `Rouge : ${pairTxt(synR.pairs)}` : ''].filter(Boolean).join(' · ') || 'Aucune synergie notable');
  const cB = blue.reduce((a, c) => a + (c.comfort || 0), 0), cR = red.reduce((a, c) => a + (c.comfort || 0), 0);
  const comfTxt = (t) => t.filter((c) => c.comfort > 0).map((c) => c.name).join(', ');
  add('comfort', 'Maîtrise des joueurs', Math.max(-5, Math.min(5, (cB - cR) * W.comfort)),
    [comfTxt(blue) ? `Bleu : ${comfTxt(blue)}` : '', comfTxt(red) ? `Rouge : ${comfTxt(red)}` : ''].filter(Boolean).join(' · ') + ' (champions du pool op.gg du joueur)');
  add('damage', 'Répartition des dégâts', damagePenalty(B) - damagePenalty(R), 'Trop de dégâts d’un seul type = facile à itemiser contre');
  add('front', 'Ligne de front', frontPenalty(B) - frontPenalty(R), 'Il faut au moins un champion capable d’encaisser');
  add('engage', 'Outils d’initiation', engagePenalty(B) - engagePenalty(R), 'Sans engage ni catch, difficile de forcer un fight');

  const total = factors.reduce((a, f) => a + f.value, 0);
  return { wr: +Math.max(25, Math.min(75, 50 + total)).toFixed(1), factors, sharesBlue: sb, sharesRed: sr };
}

const wrFor = (side, ev) => (side === 'blue' ? ev.wr : +(100 - ev.wr).toFixed(1));

export function projectPicks(blue, red, side, role, pool) {
  const mine = side === 'blue' ? blue : red, theirs = side === 'blue' ? red : blue;
  const base = wrFor(side, evaluate(blue, red));
  return pool
    .filter((c) => (!role || c.roles.includes(role)) && !(MODE === 'pro' && c.offmeta))
    .map((c) => {
      const next = [...mine, c];
      const wr = wrFor(side, side === 'blue' ? evaluate(next, theirs) : evaluate(theirs, next));
      return { c, wr, delta: +(wr - base).toFixed(1), primary: c.roles[0] === role };
    })
    .sort((a, b) => b.wr - a.wr || b.primary - a.primary);
}

const ARCH_ICON = { ulti: '⚡', cc: '⛓', dive: '🗡', peel: '🛡', lane: '👥', jgl: '🌲', macro: '🗺' };
export function recommend(blue, red, side, role, pool, extra = {}) {
  const mine = side === 'blue' ? blue : red, theirs = side === 'blue' ? red : blue;
  let all = projectPicks(blue, red, side, role, pool);
  // Quand on connaît le pool du joueur à ce rôle, ses champions passent en priorité :
  // un champion retiré de son pool (ou jamais joué) descend nettement dans les suggestions.
  if (extra.playerName) {
    all = all.map((x) => ({
      ...x,
      prio: x.wr + (x.c.comfort > 0 ? 1.5 * x.c.comfort : -5),
      why: x.c.comfort > 0 ? x.c.comfortTxt : `pas dans le pool de ${extra.playerName}`
    })).sort((a, b) => b.prio - a.prio);
  }
  const myDom = dominant(teamShares(mine)), enemyDom = dominant(teamShares(theirs));
  // Raison courte de chaque proposition : synergie avec un champion déjà pris, sinon réponse aux picks adverses
  const champArch = (c) => ORDER.reduce((a, b) => (c[b] > c[a] ? b : a));
  all = all.map((x) => {
    const sy = synergyWith(x.c, mine).list[0];
    const ca = champArch(x.c);
    const vs = enemyDom && rel(ca, enemyDom) > 0 ? `profil ${ARCH[ca].label}, efficace face à une compo ${ARCH[enemyDom].label} (${relText(ca, enemyDom)})` : null;
    const parts = [sy ? `${ARCH_ICON[sy.kind] ?? '🔗'} ${sy.title} avec ${sy.with.name}` : null, vs].filter(Boolean);
    return { ...x, syn: sy?.v ?? 0, synTxt: sy ? `${sy.with.name} — ${sy.title} : ${sy.why}` : null, why: x.why && extra.playerName ? [x.why, ...parts].join(' · ') : parts.join(' · ') || x.why };
  });
  const top = Math.max(...all.map((x) => x.wr), 50);
  const viable = all.filter((x) => x.wr >= top - 3);
  const byArch = (src, arch) => [...src].sort((a, b) => b.c[arch] - a.c[arch] || b.wr - a.wr).filter((x) => x.c[arch] >= 2).slice(0, 5);
  const groups = [{ key: 'best', title: extra.playerName ? `Picks prioritaires pour ${extra.playerName}` : 'Meilleur score global',
    hint: extra.playerName ? 'Ses champions d’abord (games et winrate), puis le reste' : 'Ce que le modèle juge le plus fort ici', list: all.slice(0, 6) }];
  const used = new Set();

  if (enemyDom) {
    const [big, slight] = beaters(enemyDom);
    for (const [arch, kind] of [[big, 'gros avantage'], [slight, 'léger avantage']]) {
      const coherent = arch === myDom;
      groups.push({
        key: 'counter-' + arch, arch,
        title: `${coherent ? 'Réponse + cohérent' : 'Répondre avec'} : compo ${ARCH[arch].label}`,
        hint: `Leur compo est de type ${ARCH[enemyDom].label} : une compo ${ARCH[arch].label} a un ${kind} face à elle${coherent ? ', et c’est déjà ton plan' : ''}`,
        list: byArch(arch === big ? viable : all.filter((x) => x.wr >= top - 5), arch)
      });
      used.add(arch);
    }
  }
  if (myDom && !used.has(myDom)) {
    groups.push({ key: 'reinforce', arch: myDom, title: `Renforcer : ${ARCH[myDom].label}`, hint: 'Rester cohérent avec ce que ton équipe a déjà', list: byArch(viable, myDom) });
    used.add(myDom);
    if (enemyDom && rel(enemyDom, myDom) > 0) groups[groups.length - 1].hint = `Attention : leur ${ARCH[enemyDom].label} a un ${relText(enemyDom, myDom)} sur ton ${ARCH[myDom].label}`;
  }
  // Synergie avec les champions déjà pris
  if (mine.length) {
    const syn = all.filter((x) => x.wr >= top - 5)
      .map((x) => { const sy = synergyWith(x.c, mine).list[0]; return sy ? { ...x, syn: sy.v, why: `${sy.title} avec ${sy.with.name} : ${sy.why}` } : { ...x, syn: 0 }; })
      .filter((x) => x.syn > 0).sort((a, b) => b.syn - a.syn || b.wr - a.wr).slice(0, 5);
    if (syn.length) groups.splice(1, 0, { key: 'synergy', title: 'Synergie avec ta compo', hint: 'Combos avec tes champions déjà pris (ta feuille de compos, duos conseillés, combos connus)', list: syn });
  }
  // Pool du joueur à ce poste (op.gg)
  if (extra.playerName) {
    const pl = all.filter((x) => x.c.comfort > 0).sort((a, b) => b.c.comfort - a.c.comfort || b.wr - a.wr).slice(0, 6)
      .map((x) => ({ ...x, why: x.c.comfortTxt }));
    if (pl.length) groups.splice(1, 0, { key: 'pool', title: `Pool de ${extra.playerName}`, hint: 'Ses champions classés par maîtrise (games, winrate)', list: pl });
  }
  // Contre-pick du support adverse (guide Coach K)
  if (role === 'S' && extra.enemySupport && COACH.support[extra.enemySupport]) {
    const counters = COACH.support[extra.enemySupport].counters;
    const list = all.filter((x) => counters.includes(x.c.id)).sort((a, b) => counters.indexOf(a.c.id) - counters.indexOf(b.c.id)).slice(0, 5)
      .map((x) => ({ ...x, why: `Contre ${extra.enemySupportName}` }));
    if (list.length) groups.splice(1, 0, { key: 'supcounter', title: `Contre leur ${extra.enemySupportName}`, hint: 'Supports qui le contrent', list });
  }
  groups.push({ key: 'meta', title: MODE === 'pro' ? 'Méta pro (gol.gg)' : 'Méta (soloQ & pro)', hint: 'Les plus joués en ce moment parmi les choix viables',
    list: [...viable].sort((a, b) => (MODE === 'pro' ? b.c.proPicks - a.c.proPicks : b.c.presence - a.c.presence || b.c.pr - a.c.pr)).slice(0, 5) });
  return { groups: groups.filter((g) => g.list.length), all, myDom, enemyDom };
}

export function recommendBans(blue, red, side, pool, enemyPlayers = []) {
  const theirSide = side === 'blue' ? 'red' : 'blue';
  const threats = projectPicks(blue, red, theirSide, null, pool).slice(0, 6);
  const meta = [...pool].sort((a, b) => b.presence - a.presence || (b.wr ?? 50) - (a.wr ?? 50)).slice(0, 6);
  const targeted = targetBans(pool, enemyPlayers).slice(0, 6);
  return {
    groups: [
      ...(targeted.length ? [{ key: 'target', title: 'Bans ciblés (joueurs adverses)', hint: 'Leurs champions de confort qui sont aussi forts ce patch', list: targeted }] : []),
      { key: 'threat', title: 'Plus grosse menace pour ta compo', hint: 'Ce qu’ils gagneraient le plus à prendre', list: threats },
      { key: 'meta', title: 'Bans méta', hint: 'Présence pro (gol.gg) et winrate soloQ', list: meta.map((c) => ({ c, wr: c.wr ?? 50, delta: 0 })) }
    ]
  };
}

// ---------- Joueurs (op.gg) ----------
// Points de maîtrise d'un joueur sur un champion, à partir de ses games et de son winrate.
export const playerLabel = (p) => (p?.riotId || '').split('#')[0] || `Joueur ${ROLE_LABEL[p?.role] ?? ''}`.trim();
export function comfortPts(entry) {
  if (entry?.manual && !entry.games) return 1; // ajouté à la main sans stats : champion maîtrisé, sans plus
  if (!entry?.games) return 0;
  const g = entry.games, wr = (entry.wins / g) * 100;
  const base = g >= 30 ? 2 : g >= 15 ? 1.5 : g >= 6 ? 1 : g >= 2 ? 0.4 : 0.2;
  const adj = Math.max(-1, Math.min(1, (wr - 50) / 10)) * 0.7 * Math.min(g, 30) / 30;
  return Math.max(0, +(base + adj).toFixed(2));
}
export function targetBans(pool, enemyPlayers) {
  const byId = new Map(pool.map((c) => [c.id, c]));
  const out = new Map();
  for (const pl of enemyPlayers) {
    for (const e of pl.pool ?? []) {
      const c = byId.get(e.id);
      if (!c) continue;
      const score = comfortPts(e) * 1.5 + ((c.wr ?? 50) - 50) * 0.4 + (c.presence ?? 0) * 0.02;
      const wr = e.games ? Math.round((e.wins / e.games) * 100) : null;
      const cur = out.get(c.id);
      if (!cur || cur.score < score) out.set(c.id, { c, score, wr: c.wr ?? 50, delta: 0, why: e.games ? `${playerLabel(pl)} : ${e.games} games, ${wr} % de victoires` : `${playerLabel(pl)} : ajouté à la main` });
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}

// ---------- Prédiction des picks adverses ----------
// Pour chaque rôle encore libre chez l'adversaire, probabilité de chaque champion :
//  - pool du joueur à ce rôle (part de ses games ranked) si on l'a chargé,
//  - popularité du champion à ce rôle (soloQ : lolalytics, pro : gol.gg),
//  - force du champion ce patch.
export function predictPicks(openRoles, candidatesByRole, players = []) {
  const out = {};
  for (const r of openRoles) {
    const pl = players.find((p) => p.role === r && p.pool?.length);
    const cands = candidatesByRole[r] ?? [];
    const meta = (c) => MODE === 'pro'
      ? (c.proRoleStats?.[r]?.picks ?? 0) + 0.02 * (c.presence ?? 0)
      : (c.pr || 0.3) * ((c.roleShare?.[r] ?? (c.roles.includes(r) ? 40 : 0)) / 100);
    const metaSum = cands.reduce((a, c) => a + meta(c), 0) || 1;
    const gOf = (e) => e.games || (e.manual ? 10 : 0);
    const poolSum = pl ? (pl.pool ?? []).reduce((a, e) => a + gOf(e), 0) || 1 : 1;
    const scored = cands.map((c) => {
      const e = pl?.pool?.find((x) => x.id === c.id);
      const m = meta(c) / metaSum;
      const own = e ? gOf(e) / poolSum : 0;
      const base = pl && pl.pool?.length ? 0.75 * own + 0.25 * m : m;
      const strength = Math.exp(((c.wr ?? 50) - 50) / 8);
      return { c, raw: base * strength, why: e ? (e.games ? `${playerLabel(pl)} : ${e.games} games` : `${playerLabel(pl)} : ajouté à la main`) : 'méta' };
    }).filter((x) => x.raw > 0).sort((a, b) => b.raw - a.raw).slice(0, 8);
    const tot = scored.reduce((a, x) => a + x.raw, 0) || 1;
    out[r] = scored.map((x) => ({ c: x.c, p: x.raw / tot, why: x.why }));
  }
  return out;
}

// Scénarios d'équipe adverse : la plus probable + une variante par rôle (2e choix), pondérées.
export function enemyScenarios(fixedTheirs, pred) {
  const roles = Object.keys(pred).filter((r) => pred[r].length);
  const build = (alt) => {
    const used = new Set(fixedTheirs.map((c) => c.id));
    const team = [...fixedTheirs];
    let w = 1;
    for (const r of roles) {
      const list = pred[r].filter((x) => !used.has(x.c.id));
      const pick = list[r === alt ? 1 : 0] ?? list[0];
      if (!pick) continue;
      used.add(pick.c.id); team.push(pick.c); w *= pick.p;
    }
    return { team, w };
  };
  const sc = [build(null), ...roles.map((r) => build(r))];
  const tot = sc.reduce((a, x) => a + x.w, 0) || 1;
  return sc.map((x) => ({ ...x, w: x.w / tot }));
}

// Bans : probabilité qu'ils le prennent × gain qu'il leur apporte
export function predictedBans(mine, theirsFixed, side, pred) {
  const enemy = side === 'blue' ? 'red' : 'blue';
  const out = [];
  for (const [r, list] of Object.entries(pred)) {
    for (const x of list) {
      const base = wrFor(enemy, enemy === 'blue' ? evaluate(theirsFixed, mine) : evaluate(mine, theirsFixed));
      const withIt = [...theirsFixed, x.c];
      const wr = wrFor(enemy, enemy === 'blue' ? evaluate(withIt, mine) : evaluate(mine, withIt));
      const score = x.p * (Math.max(0, wr - base) + 1 + (x.c.comfort || 0));
      out.push({ c: x.c, score, wr, delta: 0, why: `${ROLE_LABEL[r]} · ${Math.round(x.p * 100)} % de chance de pick (${x.why})` });
    }
  }
  const seen = new Set();
  return out.sort((a, b) => b.score - a.score).filter((x) => !seen.has(x.c.id) && seen.add(x.c.id));
}

// ---------- Pronostic hors draft (joueurs) ----------
const TIER_BASE = { IRON: 0, BRONZE: 400, SILVER: 800, GOLD: 1200, PLATINUM: 1600, EMERALD: 2000, DIAMOND: 2400, MASTER: 2800, GRANDMASTER: 2800, CHALLENGER: 2800 };
const TIER_FR = { IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine', EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Master', GRANDMASTER: 'Grand Master', CHALLENGER: 'Challenger' };
const DIV = ['', 'I', 'II', 'III', 'IV'];
// Liste des rangs pour le choix manuel (valeur = points)
export const RANK_OPTIONS = (() => {
  const out = [];
  for (const t of ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND']) {
    for (const d of [4, 3, 2, 1]) out.push({ v: TIER_BASE[t] + (4 - d) * 100 + 50, label: `${TIER_FR[t]} ${DIV[d]}` });
  }
  out.push({ v: 2900, label: 'Master' }, { v: 3300, label: 'Grand Master' }, { v: 3700, label: 'Challenger' });
  return out;
})();
export function rankPoints(r) {
  if (!r) return null;
  if (r.tier && TIER_BASE[r.tier] != null) {
    const base = TIER_BASE[r.tier];
    return base >= 2800 ? base + (r.lp ?? 0) : base + (4 - (r.division ?? 4)) * 100 + (r.lp ?? 0);
  }
  if (r.prevTier && TIER_BASE[r.prevTier] != null) {
    const base = TIER_BASE[r.prevTier];
    return (base >= 2800 ? base : base + (4 - (r.prevDivision ?? 4)) * 100) - 50; // saison passée : légère décote
  }
  return null;
}
export function pointsLabel(pts) {
  if (pts == null) return 'inconnu';
  if (pts >= 2800) return pts >= 3600 ? 'Challenger' : pts >= 3200 ? 'Grand Master' : 'Master';
  const tiers = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
  const t = tiers[Math.min(6, Math.floor(pts / 400))];
  const d = 4 - Math.min(3, Math.floor((pts % 400) / 100));
  return `${TIER_FR[t]} ${DIV[d]}`;
}
// Note d'un joueur : rang (LP) + winrate de saison + forme + profondeur de pool à son rôle
export function playerRating(p) {
  const rp = rankPoints(p.rank);
  if (rp == null) return null;
  const parts = { rank: rp, wr: 0, form: 0, pool: 0 };
  const g = (p.rank?.wins ?? 0) + (p.rank?.losses ?? 0);
  if (g) parts.wr = (((p.rank.wins + 15) / (g + 30)) - 0.5) * 100 * 6;
  if (p.rank?.hot) parts.form += 25;
  if (p.rank?.veteran) parts.form += 10;
  if (p.rank?.inactive) parts.form -= 40;
  const deep = (p.pool ?? []).filter((e) => e.games >= 10 || e.manual).length;
  parts.pool = Math.min(25, deep * 5);
  return { total: parts.rank + parts.wr + parts.form + parts.pool, parts, games: g, wr: g ? Math.round((p.rank.wins / g) * 100) : null };
}
export function playersForecast(bluePlayers, redPlayers) {
  const team = (list) => {
    const rated = list.map((p) => ({ p, r: playerRating(p) })).filter((x) => x.r);
    if (!rated.length) return null;
    const avg = (f) => rated.reduce((a, x) => a + f(x), 0) / rated.length;
    const wrs = rated.filter((x) => x.r.wr != null);
    return {
      n: rated.length, rating: avg((x) => x.r.total), rank: avg((x) => x.r.parts.rank),
      wr: wrs.length ? Math.round(wrs.reduce((a, x) => a + x.r.wr, 0) / wrs.length) : null,
      hot: rated.filter((x) => x.p.rank?.hot).length, pool: avg((x) => x.r.parts.pool),
      players: rated
    };
  };
  const B = team(bluePlayers), R = team(redPlayers);
  if (!B || !R) return { blue: B, red: R, wr: null };
  const wr = 100 / (1 + Math.pow(10, -(B.rating - R.rating) / 800));
  return { blue: B, red: R, wr: +wr.toFixed(1) };
}
// Combine deux probabilités indépendantes (draft et joueurs) en additionnant leurs log-cotes
export function combineWr(a, b) {
  if (b == null) return a;
  const lg = (x) => Math.log(x / (100 - x));
  return +(100 / (1 + Math.exp(-(lg(a) + lg(b))))).toFixed(1);
}

// ---------- Drafts complètes proposées ----------
// Recherche en faisceau : on complète les rôles libres un par un en gardant les meilleures compos,
// puis on retient des compos variées (meilleur score, autre identité, confort des joueurs).
export function proposeDrafts(fixed, theirs, side, openRoles, candidatesByRole, beam = 24, scenarios = null) {
  if (!openRoles.length) return [];
  const vs = (team, them) => wrFor(side, side === 'blue' ? evaluate(team, them) : evaluate(them, team));
  // Score = winrate attendu, moyenné sur les compos adverses probables (si on les connaît)
  const score = (team) => {
    if (!scenarios?.length) return vs(team, theirs);
    const ids = new Set(team.map((c) => c.id));
    let sum = 0, w = 0;
    for (const sc of scenarios) {
      const them = sc.team.filter((c) => !ids.has(c.id)); // un champion pris par nous ne peut plus être pris par eux
      sum += vs(team, them) * sc.w; w += sc.w;
    }
    return w ? +(sum / w).toFixed(1) : vs(team, theirs);
  };
  let states = [{ team: [...fixed], picks: [] }];
  for (const role of openRoles) {
    const next = [];
    for (const st of states) {
      const used = new Set(st.team.map((c) => c.id));
      for (const c of candidatesByRole[role] ?? []) {
        if (used.has(c.id)) continue;
        const team = [...st.team, c];
        next.push({ team, picks: [...st.picks, { role, c }], s: score(team) });
      }
    }
    next.sort((a, b) => b.s - a.s);
    // garde les meilleures compos, plus quelques-unes de chaque identité pour proposer des alternatives
    const keep = new Set(next.slice(0, beam));
    const perArch = {};
    for (const st of next) {
      const a = dominant(teamShares(st.team));
      if ((perArch[a] = (perArch[a] ?? 0) + 1) <= 5) keep.add(st);
    }
    states = next.filter((st) => keep.has(st));
    if (!states.length) return [];
  }
  const label = (st) => dominant(teamShares(st.team));
  const comfort = (st) => st.picks.reduce((a, p) => a + (p.c.comfort || 0), 0);
  const out = [];
  const add = (st, title) => { if (st && !out.some((o) => o.st === st)) out.push({ st, title }); };
  add(states[0], 'Meilleur score');
  const alt = states.find((st) => label(st) !== label(states[0]) && st.s >= states[0].s - 8);
  if (alt) add(alt, `Alternative ${ARCH[label(alt)].label}`);
  const comfy = [...states].filter((st) => st.s >= states[0].s - 4).sort((a, b) => comfort(b) - comfort(a) || b.s - a.s)[0];
  if (comfy && comfort(comfy) > 0) add(comfy, 'Confort des joueurs');
  for (const st of states) { if (out.length >= 3) break; add(st, 'Autre option'); }
  return out.map(({ st, title }) => {
    const syn = teamSynergy(st.team).pairs[0];
    const types = draftTypes(st.team);
    return {
      title, wr: st.s, picks: st.picks, arch: label(st),
      vsLikely: scenarios?.length ? vs(st.team, scenarios[0].team.filter((c) => !st.team.some((m) => m.id === c.id))) : null,
      synergy: syn ? `${syn.a.name} + ${syn.b.name}` : null,
      type: types[0]?.name ?? null
    };
  });
}

// ---------- Scaling ----------
// Puissance relative d'un champion selon la minute (points d'ancrage 8, 20 et 32 min).
const CURVE = { 1: [1.3, 1.05, 0.75], 2: [0.95, 1.15, 1.0], 3: [0.72, 0.97, 1.35] };
const ANCHOR = [8, 20, 32];
function champPower(c, min) {
  const v = CURVE[c.scale ?? 2];
  if (min <= ANCHOR[0]) return v[0];
  if (min >= ANCHOR[2]) return v[2];
  const i = min < ANCHOR[1] ? 0 : 1;
  const t = (min - ANCHOR[i]) / (ANCHOR[i + 1] - ANCHOR[i]);
  return v[i] + (v[i + 1] - v[i]) * t;
}
export const teamPower = (team, min) => (team.length ? team.reduce((a, c) => a + champPower(c, min), 0) / team.length : null);
export function powerCurve(team) {
  const pts = [];
  for (let m = 3; m <= 40; m++) pts.push([m, teamPower(team, m)]);
  return pts;
}

// ---------- Objectifs ----------
// roster = [{ c, role }]
function sideScore(roster, weights, phase) {
  let sum = 0, w = 0;
  for (const { c, role } of roster) {
    const k = weights[role];
    if (!k) continue;
    let v = CURVE[c.scale ?? 2][phase];
    if (role === 'J' && (c.e >= 2 || c.c >= 2)) v += 0.15; // jungler qui peut forcer / gank
    sum += v * k; w += k;
  }
  return w ? { v: sum / w, w } : null;
}
function verdict(a, b, mineName) {
  if (!a || !b) return { who: 'unknown', diff: 0 };
  const diff = a.v - b.v;
  return { who: diff > 0.1 ? 'mine' : diff < -0.1 ? 'theirs' : 'even', diff };
}
export function objectives(mine, theirs) {
  const TOP = { T: 1, J: 1.3, M: 0.6 };
  const BOT = { A: 1, S: 1, J: 1.3, M: 0.6 };
  const ALL = { T: 1, J: 1, M: 1, A: 1, S: 1 };
  return {
    top: verdict(sideScore(mine, TOP, 0), sideScore(theirs, TOP, 0)),
    bot: verdict(sideScore(mine, BOT, 0), sideScore(theirs, BOT, 0)),
    mid: verdict(sideScore(mine, ALL, 1), sideScore(theirs, ALL, 1)),
    late: verdict(sideScore(mine, ALL, 2), sideScore(theirs, ALL, 2))
  };
}

// ---------- Plan de jeu ----------
const PLAN = {
  e: 'Forcer les 5v5 : grouper avant chaque objectif, flanquer, et engager sur leur carry dès que les sorts clés sont prêts.',
  s: 'Jouer le 1-3-1 / 1-4 : ton splitpusher tire la pression du côté opposé à l’objectif, les 4 autres tiennent sans engager, puis on prend ce qu’ils lâchent (TP).',
  c: 'Jouer la vision offensive : wards profondes dans leur jungle, punir chaque joueur isolé, puis prendre l’objectif en 5v4.',
  p: 'Siéger : user avant l’objectif, contrôler la vision, prendre tours et objectifs sans jamais accepter un fight frontal à pleine vie.',
  d: 'Front-to-back : tout le monde autour du carry, se placer en premier sur la zone, laisser venir et punir l’engage raté.'
};
const VS = {
  e: 'face à une compo Engage : rester groupé, ne jamais face-check, garder les sorts de peel / flash pour leur initiation.',
  s: 'face à une compo Split : un champion qui tient le splitpusher en 1v1, et forcer les objectifs à 5 quand il est loin.',
  c: 'face à une compo Catch : bouger en groupe, warder ensemble, ne pas sortir seul en side lane sans vision.',
  p: 'face à une compo Poke : ne pas rester sous le siège, chercher l’engage rapide ou aller prendre l’objectif opposé.',
  d: 'face à une compo Peeling : ne pas foncer dans la frontline, chercher les picks ou la pression en side lane.'
};
// Carry = le dealer qui scale le mieux (on écarte les tanks), ADC > Mid > Top à scaling égal.
const ROLE_PRIO = { A: 3, M: 2, T: 1, J: 0.5, S: 0 };
const carry = (roster) =>
  [...roster].filter(({ c, role }) => c.f < 3 && role !== 'S')
    .sort((a, b) => b.c.scale - a.c.scale || ROLE_PRIO[b.role] - ROLE_PRIO[a.role])[0]?.c;

// Types de draft de la feuille "Type de compositions"
const DRAFT_TYPES = {
  dive: ['Teamfight : Dive', 'Engager directement sur les carrys ennemis avec mobilité et ultis de gap close : tuer la backline vite.'],
  ftb: ['Teamfight : Front to Back', 'Avancer en bloc : la frontline absorbe, la backline DPS reste en sécurité.'],
  first: ['Teamfight : First Target', 'Focus la première cible attrapée, peu importe son rôle, pour se battre en surnombre.'],
  poke: ['Teamfight : Poke', 'Infliger des dégâts à distance avant d’engager, forcer l’adversaire à reculer.'],
  split: ['Split Push', 'Un champion pousse seul pendant que le reste met la pression ailleurs : créer un surnombre.'],
  catch: ['Catch / Pick Up', 'Trouver une cible isolée grâce au contrôle ou à la vision, avant un objectif.'],
  siege: ['Siege', 'Maintenir la pression sous les tours avec poke et zoning, sans s’exposer à l’engage.'],
  peel: ['Peel / Disengage', 'Protéger les carrys et empêcher l’engage adverse, kiter puis ré-engager.']
};
export function draftTypes(team) {
  if (team.length < 2) return [];
  const st = teamStats(team), sh = shares(st);
  if (!sh) return [];
  const sc = {
    dive: sh.e + sh.c * 0.5 - (st.f >= 6 ? 0.15 : 0),
    ftb: st.f >= 5 && team.some((c) => c.scale === 3 && c.f < 2) ? 0.3 + sh.d * 0.7 : 0,
    first: Math.min(sh.e, sh.c) * 2,
    poke: sh.p,
    split: sh.s * 1.4,
    catch: sh.c,
    siege: Math.min(sh.p, sh.d) * 2,
    peel: sh.d
  };
  return Object.entries(sc).filter(([, v]) => v >= 0.25).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k]) => ({ key: k, name: DRAFT_TYPES[k][0], desc: DRAFT_TYPES[k][1], teamfight: DRAFT_TYPES[k][0].startsWith('Teamfight'),
      sub: DRAFT_TYPES[k][0].replace('Teamfight : ', '') }));
}

// Répartition des styles d'une équipe, avec les champions qui portent chaque style
export function styleBreakdown(team) {
  const sh = teamShares(team);
  if (!sh) return null;
  return ORDER.map((k) => ({ k, share: sh[k], champs: team.filter((c) => c[k] >= 2).sort((a, b) => b[k] - a[k]) }))
    .sort((a, b) => b.share - a.share);
}

// Libellé précis du type de compo : style dominant + type de teamfight quand c'est du teamfight
export function compLabel(team) {
  const sh = teamShares(team);
  if (!sh) return null;
  const d = dominant(sh), types = draftTypes(team);
  const tf = types.filter((t) => t.teamfight);
  const isTf = d === 'e' || d === 'd' || (d === 'p' && tf.length) || (d === 'c' && tf.some((t) => t.key === 'first'));
  return {
    arch: d, share: sh[d], types, teamfight: isTf && tf.length ? tf : [],
    label: `${ARCH[d].label}${isTf && tf.length ? ` · Teamfight ${tf.map((t) => t.sub).join(' / ')}` : d === 's' ? ' · Split push' : d === 'c' ? ' · Catch / pick' : ''}`
  };
}

// Analyse du pentagone (pour la vue visuelle)
export function pentagonView(mine, theirs) {
  const me = mine.map((x) => ({ ...x.c, lane: x.role })), them = theirs.map((x) => ({ ...x.c, lane: x.role }));
  const sm = teamShares(me), st = teamShares(them);
  if (!sm || !st) return null;
  const d1 = dominant(sm), t1 = dominant(st), r = rel(d1, t1);
  const [, d2] = ranked(sm);
  const alt = r < 0 ? (victims(t1).find((x) => sm[x] >= 0.15) ?? beaters(t1)[0]) : (sm[d2] >= 0.18 ? d2 : null);
  return {
    mine: compLabel(me), theirs: compLabel(them), rel: r, verdict: relText(d1, t1),
    meaning: r > 0 ? 'Avantage de style : c’est toi qui choisis où et quand le fight a lieu. Force le rythme autour des objectifs.'
      : r < 0 ? 'Désavantage de style : si tu joues le fight qu’ils veulent, tu perds. Change de terrain : joue ton second plan ou l’objectif opposé.'
        : 'Même style : la vision, le timing des ultimes et le scaling décident.',
    alt: alt ? { arch: alt, rel: relText(alt, t1), how: PLAN[alt], share: sm[alt] } : null,
    vs: { arch: t1, how: VS[t1] },
    breakdown: { mine: styleBreakdown(me), theirs: styleBreakdown(them) }
  };
}

function botLane(mine, theirs) {
  const get = (r, role) => r.find((x) => x.role === role)?.c;
  const myA = get(mine, 'A'), myS = get(mine, 'S'), thA = get(theirs, 'A'), thS = get(theirs, 'S');
  const out = [];
  if (myA && COACH.adc[myA.id]) {
    const d = COACH.adc[myA.id];
    out.push(`${myA.name} : lane <b>${fr(d.strength)}</b>, profil ${fr(d.type)}. Supports conseillés : ${d.sup.slice(0, 4).map(nm).join(', ')}.`);
  }
  if (myA && thA && rangeValue(myA.id) && rangeValue(thA.id)) {
    const a = rangeValue(myA.id), b = rangeValue(thA.id);
    out.push(`Portée : ${myA.name} ${ADC_RANGE[myA.id]} vs ${thA.name} ${ADC_RANGE[thA.id]}${a > b ? ' → tu peux harceler en auto-attaques.' : a < b ? ' → évite les échanges longs à distance, joue sur les all-in.' : '.'}`);
  }
  if (myA && myS) {
    const p = pair(myA, myS);
    out.push(p ? `Duo ${myA.name} + ${myS.name} : <b class="up">bonne synergie</b> — ${p.title}. ${p.why}` : `Duo ${myA.name} + ${myS.name} : pas une synergie listée, jouez surtout sur vos forces individuelles.`);
  }
  if (thS && COACH.support[thS.id]) {
    const d = COACH.support[thS.id];
    const t = SUPPORT_FR[thS.id] ?? { w: d.weaknesses, h: d.howto };
    if (t.w) out.push(`Leur ${thS.name} (early ${fr(d.early)}) — faiblesses : ${t.w}`);
    if (t.h) out.push(`Comment jouer contre : ${t.h}`);
  }
  const myJ = get(mine, 'J');
  if (myJ && myS) {
    const d = COACH.jungle[myJ.id];
    if (d?.sup.includes(myS.id)) out.push(`Jungle ${myJ.name} + support ${myS.name} : duo conseillé par le guide (early ${fr(d.early)}, pathing ${fr(d.pathing)}).`);
  }
  return out;
}

export function gamePlan(mine, theirs) {
  const me = mine.map((x) => ({ ...x.c, lane: x.role })), them = theirs.map((x) => ({ ...x.c, lane: x.role }));
  const sm = teamShares(me), st = teamShares(them);
  if (!sm) return [{ title: 'Plan de jeu', items: ['Choisis un premier champion pour voir le plan de jeu.'] }];
  const out = [];

  // Identité
  const [d1, d2] = ranked(sm);
  const ident = [`<b>${ARCH[d1].label}</b> (${Math.round(sm[d1] * 100)} %) — ${ARCH[d1].desc}. ${PLAN[d1]}`];
  if (sm[d2] >= 0.22) ident.push(`Plan B : <b>${ARCH[d2].label}</b> (${Math.round(sm[d2] * 100)} %). ${PLAN[d2]}`);
  const types = draftTypes(me);
  if (types.length) {
    const tf = types.filter((t) => t.teamfight), other = types.filter((t) => !t.teamfight);
    if (tf.length) ident.push(`Type de draft : <b>Teamfight</b> — ${tf.map((t) => `<b>${t.sub}</b> (${t.desc.charAt(0).toLowerCase() + t.desc.slice(1)})`).join(' ; ')}`);
    if (other.length) ident.push(`${tf.length ? 'Aussi : ' : 'Type de draft : '}${other.map((t) => `<b>${t.name}</b> (${t.desc.charAt(0).toLowerCase() + t.desc.slice(1)})`).join(' ; ')}`);
  }
  out.push({ title: 'Identité', items: ident });

  // Synergies
  const synM = teamSynergy(me), synT = teamSynergy(them);
  const synItems = synM.pairs.slice(0, 4).map((x) => `<b>${x.a.name} + ${x.b.name} — ${x.title}</b> : ${x.why} <span class="muted">(${x.src})</span>`);
  if (!synItems.length && me.length >= 2) synItems.push('Pas de vraie synergie pour l’instant : regarde la colonne « Synergie avec ta compo » des suggestions.');
  synT.pairs.slice(0, 2).forEach((x) => synItems.push(`À surveiller chez eux : <b>${x.a.name} + ${x.b.name} — ${x.title}</b>. Sépare-les ou garde tes sorts (contrôles, flash) pour ce combo.`));
  if (synItems.length) out.push({ title: 'Synergies', items: synItems });

  // Bot lane (guide Coach K + portées)
  const bot = botLane(mine, theirs);
  if (bot.length) out.push({ title: 'Bot lane', items: bot });

  // Pentagone
  if (st) {
    const t1 = dominant(st), r = rel(d1, t1);
    const items = [`Ta compo de type <b>${ARCH[d1].label}</b> face à leur compo de type <b>${ARCH[t1].label}</b> : <b>${relText(d1, t1)}</b> pour toi.`];
    if (r > 0) items.push('Impose ton rythme : c’est à toi de choisir où et quand le fight a lieu.');
    else if (r < 0) {
      const alt = victims(t1).find((x) => sm[x] >= 0.15) ?? beaters(t1)[0];
      items.push(`Évite de jouer leur jeu. Joue plutôt ton second plan ${ARCH[alt].label}, qui a un ${relText(alt, t1)} face à leur compo.`);
    } else items.push('Même style : l’exécution, la vision et le scaling décident.');
    items.push(VS[t1].charAt(0).toUpperCase() + VS[t1].slice(1));
    out.push({ title: 'Pentagone', items });
  }

  // Scaling et objectifs
  const o = objectives(mine, theirs);
  const pct = (d) => `${d > 0 ? '+' : ''}${Math.round(d * 100)} %`;
  const sc = [];
  const phaseTxt = (v, phase) => v.who === 'unknown' ? `${phase} : à déterminer` : v.who === 'even' ? `${phase} : équilibré` :
    `${phase} : <b class="${v.who === 'mine' ? 'up' : 'down'}">${v.who === 'mine' ? 'avantage toi' : 'avantage eux'}</b> (${pct(v.diff)})`;
  sc.push(phaseTxt(verdict({ v: teamPower(me, 8) }, them.length ? { v: teamPower(them, 8) } : null), 'Early (0-14 min)'));
  sc.push(phaseTxt(o.mid, 'Mid game (14-25 min)'));
  sc.push(phaseTxt(o.late, 'Late game (25 min+)'));
  const myCarry = carry(mine), theirCarry = carry(theirs);
  if (myCarry) sc.push(`Ton carry long terme : <b>${myCarry.name}</b>${myCarry.scale === 3 ? ' (gros scaling, à protéger)' : ''}.`);
  if (theirCarry) sc.push(`Leur menace long terme : <b>${theirCarry.name}</b>${theirCarry.scale === 3 ? ' (à punir tôt avant qu’il ne s’envole)' : ''}.`);
  out.push({ title: 'Scaling', items: sc });

  const mp = matchPlan(mine, theirs);
  if (mp) {
    out.push({ title: 'Objectifs', items: [
      `<b>Drakes — ${mp.drake.title}</b> : ${mp.drake.items.join(' ')}`,
      `<b>Larves — ${mp.grubs.title}</b> : ${mp.grubs.items.join(' ')}`,
      `<b>${mp.herald.title}</b> : ${mp.herald.items.join(' ')}`,
      `<b>${mp.baron.title}</b> : ${mp.baron.items.join(' ')}`
    ] });
    out.push({ title: 'Plan par phase', items: mp.phases.map((p) => `<b>${p.name}</b> — ${p.items.join(' ')}${p.alts.length ? ` <i>Alternatives : ${p.alts.join(' ')}</i>` : ''}`) });
  }

  // Dégâts / front
  const s = teamStats(me), warn = [];
  if (s.n >= 3) {
    const ap = s.ap / (s.ap + s.ad);
    if (ap < 0.2) warn.push('Dégâts très physiques : l’adversaire va stacker l’armure.');
    if (ap > 0.8) warn.push('Dégâts très magiques : attention à la résistance magique adverse.');
  }
  if (s.n >= 4 && s.f < 3) warn.push('Pas de vraie ligne de front : évite les fights longs en 5v5 frontal.');
  if (warn.length) out.push({ title: 'Points faibles', items: warn });
  const ORDER_SEC = ['Identité', 'Pentagone', 'Synergies', 'Bot lane', 'Scaling', 'Objectifs', 'Plan par phase', 'Points faibles'];
  return out.sort((a, b) => ORDER_SEC.indexOf(a.title) - ORDER_SEC.indexOf(b.title));
}

// ---------- Analyse résumée d'une draft face à la compo adverse probable ----------
// mine / theirs = [{ c, role }]. Renvoie des points clés courts + le plan complet.
export function analyzeDraft(mine, theirs) {
  const me = mine.map((x) => ({ ...x.c, lane: x.role })), them = theirs.map((x) => ({ ...x.c, lane: x.role }));
  const sm = teamShares(me), st = teamShares(them);
  const out = [];
  if (!sm) return { points: [], plan: [] };
  const d1 = dominant(sm);
  const types = draftTypes(me);
  const cl = compLabel(me);
  out.push({ k: 'Identité', v: `${cl.label} (${Math.round(sm[d1] * 100)} %)` });
  if (st) {
    const t1 = dominant(st);
    const r = rel(d1, t1);
    out.push({ k: 'Pentagone', v: `compo ${ARCH[d1].label} face à compo ${ARCH[t1].label} : ${relText(d1, t1)}`, tone: r > 0 ? 'up' : r < 0 ? 'down' : '' });
  }
  const ph = [['early', 8], ['mid', 20], ['late', 32]].map(([n, m]) => [n, (teamPower(me, m) ?? 1) - (them.length ? teamPower(them, m) : 1)]);
  const best = ph.reduce((a, b) => (b[1] > a[1] ? b : a));
  const worst = ph.reduce((a, b) => (b[1] < a[1] ? b : a));
  const PH = { early: 'early (0-14 min)', mid: 'mid game (14-25 min)', late: 'late (25 min+)' };
  out.push({ k: 'Fenêtre de force', v: best[1] > 0.03 ? `${PH[best[0]]}, ${best[1] > 0.12 ? 'nettement' : 'légèrement'} au-dessus` : 'aucune phase nettement au-dessus', tone: best[1] > 0.03 ? 'up' : '' });
  if (worst[1] < -0.05) out.push({ k: 'Phase à risque', v: `${PH[worst[0]]} : à jouer prudemment`, tone: 'down' });
  const syn = teamSynergy(me).pairs[0];
  if (syn) out.push({ k: 'Synergie clé', v: `${syn.a.name} + ${syn.b.name} : ${syn.title}` });
  const o = objectives(mine, theirs);
  const obj = [];
  if (o.top.who === 'mine') obj.push('Larves / Héraut'); if (o.bot.who === 'mine') obj.push('drakes');
  if (o.late.who === 'mine') obj.push('Baron en late');
  out.push({ k: 'Objectifs', v: obj.length ? `priorité sur ${obj.join(', ')}` : o.top.who === 'theirs' && o.bot.who === 'theirs' ? 'ils ont la priorité des deux côtés : jouer le cross-map' : 'objectifs disputés', tone: obj.length ? 'up' : '' });
  const s = teamStats(me);
  if (s.n >= 3) {
    const ap = Math.round((s.ap / (s.ap + s.ad)) * 100);
    out.push({ k: 'Dégâts', v: `${ap} % magiques / ${100 - ap} % physiques${ap < 20 || ap > 80 ? ' (déséquilibré)' : ''}`, tone: ap < 20 || ap > 80 ? 'down' : '' });
  }
  // Condition de victoire
  const wc = {
    e: 'gagner les 5v5 autour des objectifs en engageant en premier',
    s: 'tirer la carte avec le split push puis prendre l’objectif opposé',
    c: 'attraper un joueur isolé avant chaque objectif',
    p: 'user avant chaque fight et siéger les tours',
    d: 'protéger le carry et punir leurs engages'
  };
  out.push({ k: 'Pour gagner', v: wc[d1] + (best[1] > 0.03 ? `, surtout en ${PH[best[0]].split(' ')[0]}` : '') });
  return { points: out, plan: gamePlan(mine, theirs) };
}

// ---------- Plan de match détaillé (côtés forts/faibles, objectifs, phases) ----------
// Règles saison 16 : 1er drake 5:00 (vague canon 4:30), Larves x3 uniques à 8:00 (vague canon 7:30, despawn 14:45),
// patch 26.1 : 5 plaques sur chaque tour T1, T2 et T3 (tombent à 10/25/45/70/100 % de PV perdus), plaques T1 permanentes (120 or, -10 or/min dès 11 min, max -40), T2/T3 : 600 or répartis sur 5 plaques, Héraut 15:00, Baron 20:00, âme au 4e drake puis Elder toutes les 6 min (exécution < 20 % PV).
// Patch 26.1 : moins d'or sur les larves, drakes plus résistants, Vengeance draconique renforcée.
const COACH_EARLY = { Strong: 0.14, Average: 0, Depends: 0, Weak: -0.12 };
function laneEarly(c, role) {
  if (!c) return null;
  let v = champPower(c, 6);
  if (role === 'A' && COACH.adc[c.id]) v += COACH_EARLY[COACH.adc[c.id].strength] ?? 0;
  if (role === 'S' && COACH.support[c.id]) v += COACH_EARLY[COACH.support[c.id].early] ?? 0;
  if (role === 'J' && COACH.jungle[c.id]) v += COACH_EARLY[COACH.jungle[c.id].early] ?? 0;
  if (role === 'T' || role === 'M') v += 0.02 * (c.e + c.c);
  return v;
}
const at = (roster, role) => roster.find((x) => x.role === role)?.c;
// Vol de vie / régénération forte, et enchanteurs qui soignent : utiles pour le faux Nashor
const LIFESTEAL = new Set(['Aatrox', 'Vladimir', 'Swain', 'Olaf', 'Warwick', 'DrMundo', 'Sylas', 'Briar', 'Samira', 'Draven', 'Fiora',
  'Irelia', 'Yone', 'Yasuo', 'Nasus', 'Illaoi', 'Trundle', 'Kindred', 'Belveth', 'MasterYi', 'Udyr', 'Volibear', 'Sett', 'Mordekaiser', 'Gwen', 'Viego', 'Ambessa', 'Nilah', 'Aphelios']);
const HEALERS = new Set(['Soraka', 'Yuumi', 'Sona', 'Nami', 'Milio', 'Seraphine', 'Taric', 'Renata', 'Janna', 'Lulu', 'Karma', 'Ivern']);
const LANE_FR = { T: 'top', M: 'mid', B: 'bot' };

export function matchPlan(mine, theirs) {
  const me = mine.map((x) => ({ ...x.c, lane: x.role })), them = theirs.map((x) => ({ ...x.c, lane: x.role }));
  if (!me.length) return null;
  // 1) Lanes : avantage en début de partie
  const laneVal = (roster, lane) => {
    if (lane === 'B') {
      const a = laneEarly(at(roster, 'A'), 'A'), s = laneEarly(at(roster, 'S'), 'S');
      return a == null && s == null ? null : ((a ?? 1) + (s ?? 1)) / 2;
    }
    return laneEarly(at(roster, lane), lane);
  };
  const lanes = {};
  // Face-à-face mesurés en Master+ (lolalytics) : ils corrigent l'estimation théorique de la lane
  const measured = (L) => {
    const roles = L === 'B' ? ['A', 'S'] : [L];
    let sum = 0, any = false, best = null;
    for (const ra of roles) for (const rb of roles) {
      const a = at(mine, ra), b = at(theirs, rb);
      if (!a || !b) continue;
      const e = laneEdge(a, ra, b, rb);
      if (!e) continue;
      any = true; sum += e.edge;
      if (!best || Math.abs(e.raw) > Math.abs(best.raw)) best = { ...e, a, b };
    }
    return any ? { sum, best } : null;
  };
  for (const L of ['T', 'M', 'B']) {
    const a = laneVal(mine, L), b = laneVal(theirs, L);
    const th = a != null && b != null ? a - b : null;
    const m = th != null ? measured(L) : null;
    const edge = th == null ? null : m ? +(th * 0.4 + m.sum / 30).toFixed(3) : th;
    lanes[L] = { edge, state: edge == null ? 'inconnu' : edge > 0.07 ? 'fort' : edge < -0.07 ? 'faible' : 'égal',
      mine: L === 'B' ? [at(mine, 'A'), at(mine, 'S')].filter(Boolean) : [at(mine, L)].filter(Boolean),
      theirs: L === 'B' ? [at(theirs, 'A'), at(theirs, 'S')].filter(Boolean) : [at(theirs, L)].filter(Boolean),
      gm: m?.best ? `Master+ : ${m.best.a.name} ${(50 + m.best.raw).toFixed(0)} % contre ${m.best.b.name} (${m.best.n} games)` : null };
  }
  const known = Object.entries(lanes).filter(([, v]) => v.edge != null);
  const strong = known.length ? known.reduce((a, b) => (b[1].edge > a[1].edge ? b : a)) : null;
  const weak = known.length ? known.reduce((a, b) => (b[1].edge < a[1].edge ? b : a)) : null;
  const strongSide = strong && strong[1].edge > 0.03 ? strong[0] : null;
  const weakSide = weak && weak[1].edge < -0.03 && weak[0] !== strongSide ? weak[0] : null;

  // 2) Jungle
  const myJ = at(mine, 'J'), thJ = at(theirs, 'J');
  const jEdge = myJ && thJ ? laneEarly(myJ, 'J') - laneEarly(thJ, 'J') : null;
  const jungle = { edge: jEdge, items: [] };
  if (myJ) {
    const endSide = strongSide && strongSide !== 'M' ? strongSide : strongSide === 'M' ? (lanes.B.edge >= (lanes.T.edge ?? -1) ? 'B' : 'T') : null;
    const startSide = endSide === 'B' ? 'top' : endSide === 'T' ? 'bot' : null;
    if (endSide) jungle.items.push(`${myJ.name} commence côté <b>${startSide}</b> et finit son premier clear côté <b>${LANE_FR[endSide]}</b> (ton côté fort) : gank ou couverture de ${LANE_FR[endSide]} vers 3:00-3:30, puis drake ${endSide === 'B' ? 'à 5:00' : 'ou Larves à 8:00'}.`);
    else jungle.items.push(`Aucune lane nettement gagnante : ${myJ.name} fait un full clear et joue autour de la lane qui prend la prio en premier.`);
    if (jEdge != null) {
      if (jEdge > 0.08) jungle.items.push(`${myJ.name} est plus fort que ${thJ.name} en early : invade possible du côté où tes lanes ont la prio, ou contre-jungle sur son trajet.`);
      else if (jEdge < -0.08) jungle.items.push(`${thJ.name} est plus fort en early : évite l’invade, garde une ward dans ta jungle côté faible vers 2:45 et contre-gank plutôt que de forcer.`);
    }
    if (weakSide) {
      const enemyEnd = weakSide;
      jungle.items.push(`Leur jungler va probablement jouer sur <b>${LANE_FR[enemyEnd]}</b> (ton côté faible) : ward la rivière ${LANE_FR[enemyEnd]} vers 2:45-3:15.`);
    }
  }

  // 3) Puissance par phase
  const pw = (m) => (teamPower(me, m) ?? 1) - (them.length ? teamPower(them, m) ?? 1 : 1);
  const early = pw(8), mid = pw(20), late = pw(32);
  const tag = (d) => (d > 0.06 ? 'mine' : d < -0.06 ? 'theirs' : 'even');
  const o = objectives(mine, theirs);
  const theyOutscale = them.length >= 3 && late < -0.06, iOutscale = them.length >= 3 && late > 0.06;
  const sideLaners = [at(mine, 'T'), at(mine, 'M')].filter(Boolean);
  const splitter = sideLaners.filter((c) => c.s >= 2).sort((a, b) => b.s - a.s)[0];

  // 4) Drakes
  const drake = { prio: o.bot.who, items: [] };
  let drakeTitle;
  if (theyOutscale && o.bot.who !== 'theirs') {
    drakeTitle = 'Stacker les drakes tôt';
    drake.items.push('Ils outscale : chaque minute joue pour eux. La course à l’âme est ta condition de victoire : l’âme est un bonus permanent pour toute la partie, et elle débloque l’Elder, que l’équipe en avance à ce moment-là peut enchaîner pour finir avant leur pic.');
    drake.items.push('Joue chaque drake avec la prio bot + mid (vague canon de 4:30 poussée, reset avant 5:00), et enchaîne : 2e drake ~5 min plus tard, puis 3e et 4e avant leur pic de puissance.');
    drake.items.push('Depuis le patch 26.1 la Vengeance draconique est plus forte : plus tu les laisses à 0, plus leur contestation devient facile. Ne leur laisse pas un drake gratuit pour éviter qu’ils reviennent dans la course.');
  } else if (theyOutscale) {
    drakeTitle = 'Contester sans tout risquer';
    drake.items.push('Ils outscale ET ont la prio bot : tu ne peux pas leur laisser l’âme, mais forcer à 2v3 en bot te fait perdre le jeu.');
    drake.items.push('Au 1er drake : contester avec jungle + mid + support seulement si la vague bot est poussée ; sinon prends les Larves à 8:00 et des plaques en échange.');
    drake.items.push('Règle d’or : à 2 drakes chez eux, tout le monde au 3e ; à 3, le 4e (âme) se joue à 5 coûte que coûte.');
  } else if (iOutscale) {
    drakeTitle = 'Pas besoin de forcer les drakes';
    drake.items.push('Tu outscale : les premiers drakes ne valent pas un fight désavantageux. Prends-les quand ils sont gratuits, sinon échange contre plaques, camps ou Larves.');
    drake.items.push('Seule limite : ne leur laisse jamais l’âme. Dès 2 drakes chez eux, prépare la vision 1 minute avant le suivant et conteste à 5.');
    drake.items.push('Ton âme viendra plus tard, quand tu gagnes les fights autour du puits.');
  } else if (o.bot.who === 'mine') {
    drakeTitle = 'Priorité drakes';
    drake.items.push('Ta bot lane et ton jungler sont plus forts : stacke les drakes vers l’âme, c’est l’objectif le plus rentable de la méta actuelle.');
    drake.items.push('Timing : vague canon de 4:30 poussée, reset avant 5:00, vision dans la rivière bot avant de lancer le drake.');
  } else if (o.bot.who === 'theirs') {
    drakeTitle = 'Céder le 1er drake intelligemment';
    drake.items.push('Ils ont la prio bot : ne meurs pas pour le 1er drake. Prends autre chose au même moment (plaques top/mid, camps adverses côté top, Larves à 8:00).');
    drake.items.push('La Vengeance draconique te rend plus fort contre leurs drakes suivants : conteste le 2e ou le 3e avec le reset de toute l’équipe.');
  } else {
    drakeTitle = 'Drakes disputés';
    drake.items.push('Lanes équilibrées : le premier côté qui gagne sa lane prend le drake. Joue autour de la vague canon de 4:30 et de la prio mid.');
  }
  drake.title = drakeTitle;
  drake.simple = theyOutscale && o.bot.who !== 'theirs' ? ['high', 'À prioriser', 'Ils sont plus forts en fin de partie : enchaîne les drakes pour prendre l’âme avant leur pic.']
    : theyOutscale ? ['mid', 'À contester', 'Conteste quand la vague bot est poussée. Ne leur laisse jamais l’âme.']
    : iOutscale ? ['mid', 'Si gratuit', 'Tu es plus fort en fin de partie : ne force pas, empêche seulement l’âme.']
    : o.bot.who === 'mine' ? ['high', 'À prioriser', 'Ta bot lane et ton jungler ont la prio : stacke vers l’âme.']
    : o.bot.who === 'theirs' ? ['low', 'À laisser (le 1er)', 'Ils ont la prio bot : prends plaques ou Larves en échange, conteste les suivants.']
    : ['mid', 'Disputé', 'Le premier qui gagne sa lane bot le prend.'];

  // 5) Larves (méta actuelle : split moins rentable, moins d'or depuis 26.1)
  let grubValue = 0.45 + (splitter ? 0.25 : 0) + (o.top.who === 'mine' ? 0.25 : o.top.who === 'theirs' ? -0.15 : 0);
  const grubs = { prio: o.top.who, value: grubValue, items: [] };
  if (grubValue >= 0.85) {
    grubs.title = 'Prendre les Larves';
    grubs.items.push(`Top + jungle ont la prio et ${splitter ? `${splitter.name} peut convertir les Larves en tours en side lane` : 'tu peux pousser en side lane'} : prends les 3 Larves à 8:00 (vague canon de 7:30 poussée avant).`);
  } else if (grubValue >= 0.55) {
    grubs.title = 'Larves optionnelles';
    grubs.items.push('Dans la méta actuelle le split rapporte moins et les Larves donnent moins d’or : prends-les seulement si elles sont gratuites (top poussé, jungle adverse côté bot).');
  } else {
    grubs.title = 'Échanger les Larves';
    grubs.items.push(`Peu de valeur pour ta compo${splitter ? '' : ' (aucun splitpusher pour exploiter Hunger of the Void)'}${o.top.who === 'theirs' ? ' et ils ont la prio top' : ''} : laisse-les et prends le 2e drake ou des camps en échange.`);
  }
  grubs.items.push('Elles disparaissent à 14:45 si personne ne les prend.');
  grubs.simple = grubValue >= 0.85 ? ['high', 'À prioriser', `Top et jungle ont la prio${splitter ? ` et ${splitter.name} transforme les Larves en tours` : ''}.`]
    : grubValue >= 0.55 ? ['mid', 'Si gratuites', 'Peu d’or dans la méta actuelle : seulement si elles ne coûtent rien.']
    : ['low', 'À laisser', 'Peu de valeur pour ta compo : échange-les contre un drake ou des camps.'];

  // 6) Héraut / Baron / Elder
  const herald = { prio: tag(mid), items: [] };
  herald.title = tag(mid) === 'mine' ? 'Héraut pour ouvrir la carte' : tag(mid) === 'theirs' ? 'Héraut : ne pas forcer' : 'Héraut disputé';
  herald.items.push(tag(mid) === 'mine'
    ? 'Tu es plus fort en mid game : prends le Héraut à 15:00 et lâche-le en mid (ou sur la lane la plus avancée) pour ouvrir la carte et la rotation vers le drake suivant.'
    : tag(mid) === 'theirs' ? 'Ils sont plus forts en mid game : ne te bats pas pour le Héraut, prends le drake ou des tours ailleurs pendant qu’ils le font.'
      : 'À jouer selon la vague mid : le Héraut sert surtout à faire tomber une tour et ses plaques (depuis le patch 26.1, chaque tour T1, T2 et T3 a 5 plaques ; celles des T1 restent toute la partie mais rapportent un peu moins après 11 min).');
  herald.simple = tag(mid) === 'mine' ? ['high', 'À prioriser', 'Tu es plus fort en mid game : utilise-le pour une tour et ses plaques.']
    : tag(mid) === 'theirs' ? ['low', 'À laisser', 'Ils sont plus forts en mid game : prends un drake ou des tours ailleurs.']
    : ['mid', 'Si la vague mid est poussée', 'À prendre seulement avec la prio mid.'];
  const baron = { items: [] };
  baron.title = iOutscale ? 'Baron en late' : theyOutscale ? 'Baron dès 20:00' : 'Baron sur ouverture';
  baron.items.push(iOutscale ? 'Le temps joue pour toi : lance le Baron uniquement avec la vision installée et après un pick ou un fight gagné.'
    : theyOutscale ? 'Ta fenêtre est avant leur pic : enchaîne tours → Baron dès 20:00 après chaque fight gagné, et termine avant 30 min.'
      : 'Baron après chaque ouverture (pick, fight gagné, leur jungler mort).');
  baron.items.push('Elder : il apparaît après la prise de l’âme puis toutes les 6 min. Il profite à l’équipe en avance au moment où il apparaît (or, niveaux, vision), que ce soit une compo early ou une compo late : prépare la vision 1 min avant et arrive à 5.');

  // 6b) Faux Nashor : lancer le Baron pour forcer un fight, rentable avec du vol de vie / des soins
  const sustainScore = (team) => team.reduce((a, c) => a + (LIFESTEAL.has(c.id) ? 1 : 0) + (HEALERS.has(c.id) ? 1.2 : 0), 0);
  const mySus = sustainScore(me), thSus = sustainScore(them);
  const sm = teamShares(me), myDom = sm ? dominant(sm) : null;
  const fightComp = myDom === 'e' || myDom === 'd' || myDom === 'c';
  const thEngage = them.reduce((a, c) => a + c.e, 0);
  const fake = { on: false, items: [], score: mySus };
  const susNames = me.filter((c) => LIFESTEAL.has(c.id) || HEALERS.has(c.id)).map((c) => c.name);
  if (mySus >= 2) {
    fake.on = true;
    fake.title = 'Faux Nashor possible';
    fake.items.push(`Ta compo a du sustain (${susNames.join(', ')}) : tu peux lancer le Baron pour les forcer à venir, puis te retourner sur eux quand ils arrivent. Le vol de vie et les soins compensent les dégâts du Baron, tu prends le fight à PV presque pleins.`);
    fake.items.push(`Conditions : vision autour du puits (les deux entrées), ${fightComp ? 'ta compo est faite pour le teamfight' : 'tout le monde groupé'}, sorts d’invocateur disponibles, et leur jungler visible ou loin. Lâche le Baron dès qu’ils entrent dans la rivière.`);
    if (thEngage >= 9) fake.items.push('Attention : ils ont beaucoup d’engage. Ne descends pas le Baron trop bas, sinon ils engagent au moment du smite.');
  } else {
    fake.title = 'Pas de faux Nashor';
    fake.items.push('Ta compo n’a pas assez de vol de vie ou de soins : si tu lances le Baron pour les attirer, tu prendras le fight sans tes PV. Ne le commence qu’avec un vrai avantage (pick, leur jungler mort).');
  }
  if (thSus >= 2) fake.items.push(`Eux peuvent faire le faux Nashor (${them.filter((c) => LIFESTEAL.has(c.id) || HEALERS.has(c.id)).map((c) => c.name).join(', ')}) : quand ils lancent le Baron, ne face-check pas en file indienne. Arrive groupé ou prends un objectif ailleurs.`);
  baron.items.push(`<b>${fake.title}</b> : ${fake.items.join(' ')}`);
  baron.simple = theyOutscale ? ['high', 'Dès 20:00', 'Après chaque fight gagné : finis avant leur pic.']
    : iOutscale ? ['mid', 'Sans risque', 'Le temps joue pour toi : seulement avec la vision et après un pick.']
    : ['mid', 'Sur ouverture', 'Après un pick, un fight gagné ou leur jungler mort.'];
  baron.fake = fake.on ? 'Faux Nashor possible (vol de vie / soins) : lance-le pour les attirer et retourne-toi sur eux.' : null;

  // 7) Timeline des objectifs
  const timeline = [
    { t: '4:30', name: 'Vague canon', who: o.bot.who, note: 'pousser bot + mid avant le drake' },
    { t: '5:00', name: '1er drake', who: drake.prio, note: drakeTitle },
    { t: '7:30', name: 'Vague canon', who: o.top.who, note: 'pousser top + mid avant les Larves' },
    { t: '8:00', name: 'Larves x3', who: grubValue >= 0.55 ? o.top.who : 'skip', note: grubs.title },
    { t: '~10:00', name: '2e drake', who: drake.prio, note: theyOutscale ? 'continuer la course à l’âme' : '' },
    { t: '14:45', name: 'Fin des Larves', who: grubValue >= 0.55 ? o.top.who : 'skip', note: 'les Larves non prises disparaissent' },
    { t: '15:00', name: 'Héraut', who: herald.prio, note: herald.title },
    { t: '20:00', name: 'Baron', who: tag(late) === 'mine' ? 'mine' : tag(mid), note: baron.title },
    { t: 'âme', name: 'Elder', who: 'even', note: 'à l’équipe en avance quand il apparaît' }
  ];

  // 8) Plan par phase
  const laneTip = (L) => {
    const s = lanes[L];
    if (s.state === 'fort') return `${LANE_FR[L]} (côté fort) : pousse, trade, prends les plaques (5 par tour, et celles des T1 restent toute la partie depuis le patch 26.1 : une lane gagnante peut continuer à les farmer en mid game, même si elles valent un peu moins après 11 min) et la prio pour ton jungler.`;
    if (s.state === 'faible') return `${LANE_FR[L]} (côté faible) : freeze près de ta tour, ne meurs pas, garde le TP/flash ; ton but est de perdre le moins possible.`;
    if (s.state === 'égal') return `${LANE_FR[L]} : lane équilibrée, joue les timings de vague et suis le jungler.`;
    return null;
  };
  const earlyItems = [];
  if (strongSide) earlyItems.push(`<b>Côté fort : ${LANE_FR[strongSide]}</b>${weakSide ? ` · <b>Côté faible : ${LANE_FR[weakSide]}</b>` : ''}.`);
  for (const L of ['T', 'M', 'B']) { const t = laneTip(L); if (t) earlyItems.push(t.charAt(0).toUpperCase() + t.slice(1)); }
  const alts = [];
  if (strongSide) alts.push(`Si leur jungler vient sur ${LANE_FR[strongSide]} : ne force pas, ton jungler fait du cross-map (camps ou objectif de l’autre côté).`);
  const myA = at(mine, 'A'), myT = at(mine, 'T');
  if (lanes.B.state === 'faible' && myA?.scale === 3 && myT && myT.f >= 2)
    alts.push(`Lane swap : ${myA.name} est un hyper-carry en lane faible et ton top est un tank : envisage un swap vers le top / les Larves à 8:00 pour éviter de perdre la lane.`);
  if (jEdge != null && jEdge < -0.08) alts.push('Si ton jungler perd son early : full clear, couvre le côté faible et vise un drake ou des Larves gratuits plutôt que les fights.');
  if (early > 0.06) alts.push('Ta compo est plus forte en early : dive ou invade tôt pour transformer l’avance en drakes et en plaques avant que leur scaling n’arrive.');
  const midItems = [herald.items[0], `Regroupe-toi sur le côté de l’objectif suivant 1 min avant son apparition, avec la vision. ${splitter ? `${splitter.name} peut tenir une side lane, mais dans la méta actuelle le 5v5 autour des objectifs rapporte plus que le split.` : 'Pas de vrai splitpusher : jouez groupés autour des objectifs.'}`];
  const lateItems = [baron.items[0], baron.items[1]];
  const lateAlts = fake.on ? [`Faux Nashor : lance le Baron avec la vision pour forcer le fight (sustain : ${susNames.join(', ')}).`] : [];
  const phases = [
    { name: 'Early', range: '0-14 min', diff: early, items: earlyItems, alts },
    { name: 'Mid game', range: '14-25 min', diff: mid, items: midItems, alts: [] },
    { name: 'Late', range: '25 min +', diff: late, items: lateItems, alts: lateAlts }
  ];
  return { lanes, strongSide, weakSide, jungle, drake, grubs, herald, baron, fake, timeline, phases, theyOutscale, iOutscale };
}
