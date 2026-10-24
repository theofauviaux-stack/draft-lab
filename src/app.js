import { teamSynergy, KINDS } from './synergy.js';
import { detectSlots, matchBanner } from './shotauto.js';
import {
  ROLES, ROLE_LABEL, ARCH, ORDER, rel, relText, laneEdge, proEdge, LANE_OPP,
  buildProfiles, evaluate, setDetailSource, applyProGames, proInfo, recommend, recommendBans, projectPicks, gamePlan, powerCurve,
  comfortPts, proposeDrafts, playerLabel, rankName, analyzeDraft, matchPlan, pentagonView, styleBreakdown, compLabel, playersForecast, combineWr, pointsLabel, rankPoints, RANK_OPTIONS, playerRating, dominant, teamShares, predictPicks, enemyScenarios, predictedBans
} from './engine.js';
import { balanceTeams, rolesFromPool, balValue, roleFit, BAL_ROLES, BAL_COST } from './balance.js';

// ---------- Accès aux données (app Electron, ou navigateur en secours) ----------
const api = window.draftlab ?? {
  async load() {
    const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    const v = versions[0];
    const d = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/champion.json`)).json();
    const msg = 'disponible uniquement dans l’application';
    return {
      version: v, patch: v.split('.').slice(0, 2).join('.'),
      champions: Object.values(d.data).map((c) => ({ id: c.id, key: c.key, name: c.name, tags: c.tags, info: c.info })),
      stats: {}, pro: {},
      sources: { ddragon: { ok: true, at: Date.now() }, lolalytics: { ok: false, error: msg }, golgg: { ok: false, error: msg } }
    };
  },
  refresh() { return this.load(); },
  onUpdated() {},
  open: (u) => window.open(u, '_blank')
};

// ---------- Ordres de draft ----------
// La draft commence directement par les picks (ordre officiel) ; les bans se remplissent à côté, avec les conseils.
// Ordre officiel : bans B R B R B R · picks B1 / R1 R2 / B2 B3 / R3 · bans R B R B · picks R4 / B4 B5 / R5
const BAN_NO = { blue: [1, 3, 5, 8, 10], red: [2, 4, 6, 7, 9] };
const DRAFT_ORDER = [
  { ph: 'Bans phase 1', ban: true, steps: [['blueBans', 0], ['redBans', 0], ['blueBans', 1], ['redBans', 1], ['blueBans', 2], ['redBans', 2]] },
  { ph: 'Picks phase 1', steps: [['blue', 0], ['red', 0], ['red', 1], ['blue', 1], ['blue', 2], ['red', 2]] },
  { ph: 'Bans phase 2', ban: true, steps: [['redBans', 3], ['blueBans', 3], ['redBans', 4], ['blueBans', 4]] },
  { ph: 'Picks phase 2', steps: [['red', 3], ['blue', 3], ['blue', 4], ['red', 4]] }
];
// Picks regroupés par tour : bleu B1 / B2 B3 / B4 B5, rouge R1 R2 / R3 / R4 / R5
const pickTag = (side, idxs) => idxs.map((i) => `${side === 'blue' ? 'B' : 'R'}${i + 1}`).join(' ');
const PICKS = [['blue', 0], ['red', 0], ['red', 1], ['blue', 1], ['blue', 2], ['red', 2], ['red', 3], ['blue', 3], ['blue', 4], ['red', 4]];
const stepLabel = ([t, i]) => (t.endsWith('Bans') ? `Ban ${t.startsWith('blue') ? 'bleu' : 'rouge'} ${i + 1}` : `Pick ${t === 'blue' ? 'bleu' : 'rouge'} ${i + 1}`);
const shortLabel = ([t, i]) => (t.endsWith('Bans') ? null : `${t === 'blue' ? 'B' : 'R'}${i + 1}`);

// ---------- État ----------
const state = {
  data: null, P: {}, list: [],
  mode: 'soloq', tier: 'master_plus', mySide: 'blue',
  slots: emptySlots(),
  roles: { blue: [...ROLES], red: [...ROLES] },
  selected: null, history: [],
  search: '', roleFilter: null, archFilter: null, onlyRole: true,
  players: { blue: [], red: [] }, teamInput: { blue: '', red: '' }, region: 'euw',
  wantArch: null, scalShow: 'both', lock: { blue: Array(5).fill(null), red: Array(5).fill(null) },
  flow: 'zero' // 'zero' = draft de zéro (sans op.gg), 'players' = draft depuis des joueurs
};
function emptySlots() {
  return { blueBans: Array(5).fill(null), redBans: Array(5).fill(null), blue: Array(5).fill(null), red: Array(5).fill(null) };
}
try {
  const saved = JSON.parse(localStorage.getItem('draftlab-prefs') ?? '{}');
  Object.assign(state, { mySide: saved.mySide ?? state.mySide, wantArch: saved.wantArch ?? null, theme: saved.theme ?? 'light' });
} catch {}
// Une seule base : soloQ Master+ (lolalytics, effet one-trick atténué) + compétition (gol.gg).
const savePrefs = () => { try { localStorage.setItem('draftlab-prefs', JSON.stringify({ mySide: state.mySide, wantArch: state.wantArch, theme: state.theme })); } catch {} };

const $ = (id) => document.getElementById(id);
// ---------- Thème clair / sombre ----------
// Les dessins SVG sont écrits avec les couleurs du thème clair ; en sombre on les remplace.
const DARK_MAP = { '#6b7280': '#8a93a8', '#1f2937': '#e6e9f2', '#d9dee6': '#263049', '#c3cad5': '#3a4560', '#ffffff': '#151c2c',
  '#f4f6f9': '#151c2c', '#eef1f5': '#0e1422', '#d3e2f4': '#1d2a44', '#c9d9ec': '#13304a', '#e3e7ed': '#222b40', '#f6f8fb': '#121a29', '#cfd5de': '#2e3852', '#9aa3b2': '#5d6780' };
const themed = (svg) => (state.theme === 'dark' ? svg.replace(/#[0-9a-f]{6}\b/gi, (h) => DARK_MAP[h.toLowerCase()] ?? h) : svg);
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const b = $('themeBtn'); if (b) { b.textContent = state.theme === 'dark' ? '☀️' : '🌙'; b.title = state.theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'; }
}
const img = (id) => (state.data ? `https://ddragon.leagueoflegends.com/cdn/${state.data.version}/img/champion/${id}.png` : '');
// Ordre d'une draft de tournoi : bans B R B R B R · picks B1 R1 R2 B2 B3 R3 · bans R B R B · picks R4 B4 B5 R5
const TOURNEY = [
  ['blueBans', 0], ['redBans', 0], ['blueBans', 1], ['redBans', 1], ['blueBans', 2], ['redBans', 2],
  ['blue', 0], ['red', 0], ['red', 1], ['blue', 1], ['blue', 2], ['red', 2],
  ['redBans', 3], ['blueBans', 3], ['redBans', 4], ['blueBans', 4],
  ['red', 3], ['blue', 3], ['blue', 4], ['red', 4]
];
const seq = () => TOURNEY;
const NO_BAN = '-'; // ban passé (comme un ban manqué en pro)
function skipBan() {
  const tg = target();
  if (!tg || !tg[0].endsWith('Bans')) return;
  state.slots[tg[0]][tg[1]] = NO_BAN; state.history.push(tg); state.selected = null; render();
}
// Fearless : les champions joués dans les games précédentes de la série sont verrouillés pour les deux équipes
const FL_KEY = 'draftlab-fearless';
// Série Fearless : chaque game garde sa draft complète (picks, bans, lanes) — on peut revenir sur n'importe quelle game.
// fearless = { on, bo: 3|5, cur: index de la game affichée, games: [{ slots, roles, lock, history } | null] }
const FL_OFF = () => ({ on: false, bo: 5, cur: 0, games: [] });
function flMigrate(f) {
  if (!f || !f.on) return FL_OFF();
  if (f.games?.length && f.games[0] && f.games[0].blue && !f.games[0].slots) { // ancien format : seulement les picks des games finies
    const games = f.games.map((g) => ({ slots: { ...emptySlots(), blue: [...g.blue], red: [...g.red] }, roles: { blue: [...ROLES], red: [...ROLES] }, lock: { blue: Array(5).fill(null), red: Array(5).fill(null) }, history: [] }));
    return { on: true, bo: 5, cur: games.length, games: [...games, null] };
  }
  return { bo: 5, cur: 0, games: [], ...f };
}
state.fearless = (() => { try { return flMigrate(JSON.parse(localStorage.getItem(FL_KEY))); } catch { return FL_OFF(); } })();
const saveFearless = () => { try { localStorage.setItem(FL_KEY, JSON.stringify(state.fearless)); } catch {} };
const flSnap = () => ({ slots: structuredClone(state.slots), roles: structuredClone(state.roles), lock: structuredClone(state.lock), history: structuredClone(state.history) });
const flPicks = (g) => (g ? [...g.slots.blue, ...g.slots.red].filter(Boolean) : []);
// champions joués dans les AUTRES games de la série : verrouillés pour les deux équipes
const flLocked = () => { const m = new Map(), f = state.fearless; if (f?.on && flAllowed()) f.games.forEach((g, k) => { if (k !== f.cur) flPicks(g).forEach((id) => !m.has(id) && m.set(id, k + 1)); }); return m; };
const used = () => new Set([...Object.values(state.slots).flat().filter(Boolean), ...flLocked().keys()]);
// ---------- Joueurs (multi op.gg) ----------
// Un champion du pool ne compte que s'il est joué à la lane du joueur
// (ex. joueur placé Support => seulement ses supports). Les ajouts manuels sont toujours gardés.
function fitsRole(id, role) {
  const c = state.P[id];
  if (!c) return false;
  return c.roles.includes(role);
}
const rolePool = (p) => (p.pool ?? []).filter((e) => e.manual || e.restored || fitsRole(e.id, p.role));
const rolePlayers = (side) => state.players[side].map((p) => ({ ...p, pool: rolePool(p) })).filter((p) => p.pool.length);
const playerFor = (side, role) => rolePlayers(side).find((p) => p.role === role);
function withComfort(c, side, role) {
  const pl = role ? playerFor(side, role) : null;
  const e = pl?.pool?.find((x) => x.id === c.id);
  if (!e) return c;
  return { ...c, comfort: comfortPts(e), comfortTxt: e.games ? `${playerLabel(pl)} : ${e.games} games, ${Math.round((e.wins / e.games) * 100)} %` : `${playerLabel(pl)} : ajouté à la main` };
}
const pickPos = (side, i) => PICKS.findIndex(([t, j]) => t === side && j === i);
const team = (side) => state.slots[side].map((id, i) => (id ? { ...withComfort(state.P[id], side, state.roles[side][i]), lane: state.roles[side][i], po: pickPos(side, i) } : null)).filter(Boolean);
// Matchups et duos Master+ : chargés à la demande pour chaque champion pické, à sa lane
const DET = new Map();
setDetailSource((key, lane) => DET.get(`${key}|${lane}`)?.data ?? null);
function ensureDetails() {
  if (!api.detail) return;
  for (const side of ['blue', 'red']) state.slots[side].forEach((id, i) => {
    if (!id) return;
    const c = state.P[id], lane = state.roles[side][i], k = `${c.key}|${lane}`;
    if (DET.has(k)) return;
    DET.set(k, { loading: true });
    api.detail(c.id, lane).then((d) => { DET.set(k, { data: d && !d.error ? d : null }); render(); }).catch(() => DET.set(k, { data: null }));
  });
}
// Data Dragon 16.21 = patch 26.21 dans le jeu et les notes de patch
const patchLabel = (p) => { if (!p) return ''; const [M, m] = String(p).split('.').map(Number); return M < 20 ? `${M + 10}.${m}` : `${M}.${m}`; };
// fenêtre de données d'un champion : 30 derniers jours, ou depuis son dernier changement
const dataWin = (c) => (c?.changed ? `depuis le patch ${patchLabel(c.changed)}` : '30 derniers jours');
const nextStep = () => seq().find(([t, i]) => !state.slots[t][i]) ?? null;
const target = () => state.selected ?? nextStep();
const pool = () => { const u = used(); return state.list.filter((c) => !u.has(c.id)); };

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- Actions ----------
function place(id) {
  const tg = target();
  if (!tg || used().has(id)) return;
  const [t, i] = tg;
  state.slots[t][i] = id;
  state.history.push(tg);
  let chosen = false;
  if (t === 'blue' || t === 'red') {
    const w = state.wantRole;
    // lane choisie en cliquant sur sa ligne : on la garde si le champion la joue
    if (w && w.side === t && w.i === i && (flexRoles(state.P[id]).includes(w.r) || state.P[id].roles.includes(w.r))) { state.lock[t][i] = w.r; chosen = true; }
    else state.lock[t][i] = null;
    if (chosen) assignRoles(t); else placeRole(t, i);
  }
  state.wantRole = null;
  state.selected = null;
  render();
  if ((t === 'blue' || t === 'red') && !chosen) askLane(t, i, false);
}
// Champion joué sur plusieurs lanes : on demande la lane (toutes les lanes sont proposées)
const laneShare = (c, r) => Math.round(c.rolePct?.[r] ?? c.roleShare?.[r] ?? 0);
const proShare = (c, r) => (c.proPicks ? Math.round(((c.proRoleStats?.[r]?.picks ?? 0) / c.proPicks) * 100) : 0);
// lane « réelle » : au moins 8 % de ses games en soloQ, ou 8 % de ses picks en pro
const flexRoles = (c) => ROLES.filter((r) => laneShare(c, r) >= 8 || (c.proPicks >= 10 && proShare(c, r) >= 8));
function askLane(side, i, force) {
  const id = state.slots[side][i]; if (!id) return;
  const c = state.P[id];
  const open = openRoles(side, i);
  if (!force && flexRoles(c).filter((r) => open.includes(r)).length < 2) return;
  const main = ROLES.reduce((a, r) => (laneShare(c, r) > laneShare(c, a) ? r : a), ROLES[0]);
  const holder = (r) => { const j = state.roles[side].findIndex((x, k) => x === r && k !== i && state.slots[side][k]); return j >= 0 ? j : null; };
  const sorted = [...ROLES].sort((a, b) => laneShare(c, b) - laneShare(c, a));
  const box = $('laneAsk');
  box.innerHTML = `<div class="la-card"><img src="${img(id)}" alt=""><div class="la-body">
      <b>Sur quelle lane joue ${c.name} ?</b><span class="muted">${side === 'blue' ? 'Équipe 1' : 'Équipe 2'} · part de ses games en soloQ${c.proPicks >= 10 ? ' et de ses picks en pro' : ''}</span>
      <div class="la-opts">${sorted.map((r) => { const h = holder(r); const ps = proShare(c, r);
        return `<button data-r="${r}" class="${r === main ? 'main' : ''} ${h != null ? 'taken' : ''}">${r === main ? '<em>Lane principale</em>' : ''}${ROLE_LABEL[r]}<small>${laneShare(c, r)} % des games</small>${c.proPicks >= 10 ? `<small class="pro">pro ${ps} %</small>` : ''}${h != null ? `<small class="tk">échange avec ${state.P[state.slots[side][h]].name}</small>` : ''}</button>`; }).join('')}</div></div></div>`;
  box.hidden = false;
  box.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    const r = b.dataset.r, h = holder(r);
    if (h != null) state.lock[side][h] = null; // le coéquipier qui avait cette lane est replacé automatiquement
    state.lock[side][i] = r; assignRoles(side); box.hidden = true; render();
  }));
  box.onclick = (e) => { if (e.target === box) box.hidden = true; };
}
// Rôles attribués automatiquement à toute l'équipe : on cherche la répartition des 5 rôles
// qui colle le mieux aux champions déjà pickés (part de games à chaque rôle). Plus besoin de choisir le rôle.
const fit = (c, r) => (c.roleShare?.[r] ?? (c.roles.includes(r) ? 50 : 0)) + (c.roles.includes(r) ? 10 : 0);
const PERMS = (() => { const out = []; const go = (a, rest) => { if (!rest.length) return out.push(a); rest.forEach((r, k) => go([...a, r], rest.filter((_, j) => j !== k))); }; go([], ROLES); return out; })();
function assignRoles(side) {
  const ids = state.slots[side], cur = state.roles[side];
  let best = cur, bestScore = -1;
  const lk = state.lock?.[side] ?? [];
  for (const perm of PERMS) {
    if (lk.some((r, i) => r && ids[i] && perm[i] !== r)) continue;
    let sc = 0;
    ids.forEach((id, i) => { if (id) sc += fit(state.P[id], perm[i]) + (perm[i] === cur[i] ? 0.01 : 0); });
    if (sc > bestScore) { bestScore = sc; best = perm; }
  }
  state.roles[side] = [...best];
}
const openRoles = (side, skip = -1) => { const taken = state.slots[side].map((id, i) => (id && i !== skip ? state.roles[side][i] : null)).filter(Boolean); return ROLES.filter((r) => !taken.includes(r)); };
// Un nouveau pick prend la meilleure lane libre SANS déplacer les champions déjà placés.
// On ne réorganise toute l'équipe que s'il ne peut jouer aucune des lanes libres.
function placeRole(side, i) {
  const keep = state.lock[side].slice();
  state.slots[side].forEach((id, k) => { if (id && k !== i && !state.lock[side][k]) state.lock[side][k] = state.roles[side][k]; });
  assignRoles(side);
  state.lock[side] = keep;
  const c = state.P[state.slots[side][i]];
  if (fit(c, state.roles[side][i]) < 15) assignRoles(side);
}
function clearSlot(t, i) { state.slots[t][i] = null; if (state.lock[t]) state.lock[t][i] = null; state.history = state.history.filter(([a, b]) => !(a === t && b === i)); render(); }
function undo() {
  const last = state.history.pop();
  if (last) { state.slots[last[0]][last[1]] = null; if (state.lock[last[0]]) state.lock[last[0]][last[1]] = null; if (last[0] === 'blue' || last[0] === 'red') assignRoles(last[0]); state.selected = null; render(); }
}
function reset() {
  state.slots = emptySlots(); state.roles = { blue: [...ROLES], red: [...ROLES] }; state.lock = { blue: Array(5).fill(null), red: Array(5).fill(null) };
  state.history = []; state.selected = null; render();
}
function select(t, i) {
  const same = state.selected && state.selected[0] === t && state.selected[1] === i;
  state.selected = same ? null : [t, i];
  render();
}

// ---------- Rendu ----------
function render() {
  if (!state.data) return;
  ensureDetails();
  renderBans(); renderTeams(); renderStep(); renderFearless();
  const ev = evaluate(team('blue'), team('red'));
  renderWr(ev);
  renderGrid(gridInfo());
  $('playersBox').hidden = state.flow !== 'players';
  document.body.classList.toggle('flow-zero', state.flow !== 'players');
  $('flowChip').textContent = state.flow === 'players' ? '⚔ Draft depuis des joueurs' : '✦ Draft de zéro';
  document.querySelectorAll('.seg-b').forEach((b) => b.classList.toggle('on', b.dataset.side === state.mySide));
  renderPlayers(); renderSaves(); renderHistory(); renderBanPlan();
  renderPentagon(ev); renderPentaAdvice(ev); renderScaling(); renderAdvice();
}

function renderBans() {
  const tg = target();
  for (const side of ['blue', 'red']) {
    const el = $(`${side}Bans`); el.innerHTML = '';
    state.slots[`${side}Bans`].forEach((id, i) => {
      const b = document.createElement('div');
      b.className = 'ban' + (id ? ' filled' : '') + (tg && tg[0] === `${side}Bans` && tg[1] === i ? ' target' : '');
      const skipped = id === NO_BAN;
      if (skipped) b.classList.add('skipped');
      b.title = skipped ? 'Ban passé (clic droit pour annuler)' : id ? `${state.P[id].name} (clic droit pour retirer)` : `${BAN_NO[side][i]}e ban de la draft (phase ${i < 3 ? 1 : 2})`;
      b.innerHTML = skipped ? '<span class="ban-n">∅</span>' : id ? `<img src="${img(id)}" alt="">` : `<span class="ban-n">${BAN_NO[side][i]}</span>`;
      if (i === 3) b.classList.add('ph2');
      b.onclick = () => select(`${side}Bans`, i);
      b.oncontextmenu = (e) => { e.preventDefault(); if (id) clearSlot(`${side}Bans`, i); };
      el.appendChild(b);
    });
  }
}

function archBar(c) {
  const t = ORDER.reduce((a, k) => a + c[k], 0) || 1;
  return `<div class="archbar">${ORDER.map((k) => `<span style="width:${(c[k] / t) * 100}%;background:${ARCH[k].color}" title="${ARCH[k].label} ${c[k]}/3"></span>`).join('')}</div>`;
}

function renderTeams() {
  const tg = target();
  for (const side of ['blue', 'red']) {
    const el = $(`${side}Team`); el.innerHTML = '';
    el.classList.toggle('turn', !!tg && tg[0] === side);
    const sPairs = teamSynergy(team(side)).pairs;
    // Une ligne fixe par lane (Top, Jungle, Mid, ADC, Support) : les champions ne « sautent » plus d'une ligne à l'autre
    // cases vides : le prochain ordre de pick (B1, B2… / R1, R2…) de haut en bas, la lane n'apparaît qu'une fois le champion choisi
    let nextPick = state.slots[side].filter(Boolean).length;
    ROLES.map((r) => state.roles[side].indexOf(r)).forEach((i) => {
      const id = state.slots[side][i];
      const po = id ? null : `${side === 'blue' ? 'B' : 'R'}${++nextPick}`;
      const r = state.roles[side][i];
      const c = id ? state.P[id] : null;
      const s = document.createElement('div');
      // un pick n'appartient à aucune lane tant qu'il n'est pas fait : on ne surligne une ligne que si tu l'as choisie
      s.className = 'slot' + (state.selected && state.selected[0] === side && state.selected[1] === i ? ' target' : '') + (c ? '' : ' empty');
      const roleSel = c ? `<span class="rolebadge ${state.lock[side][i] ? 'locked' : ''}" title="${state.lock[side][i] ? 'Lane choisie' : 'Lane attribuée automatiquement'} — clic pour changer">${ROLE_LABEL[r]}</span>` : '';
      s.innerHTML = `
        <div class="portrait">${c ? `<img src="${img(id)}" alt="">` : `<span class="lane-ph ${LIVE.on ? '' : 'po'}">${LIVE.on ? ROLE_LABEL[r] : po}</span>`}</div>
        <div>
          <div class="name">${c ? c.name : `<span class="muted">${LIVE.on ? ROLE_LABEL[r] : 'Pick ' + po} · à choisir</span>`}</div>
          <div class="meta">${roleSel}${(() => { const pl = c ? playerFor(side, state.roles[side][i]) : null; const e = pl?.pool?.find((x) => x.id === id); return e && e.games ? `<span class="pgw ${e.wins / e.games >= 0.5 ? 'up' : 'down'}" title="${playerLabel(pl)} : ${e.games} games, ${Math.round((e.wins / e.games) * 100)} % de victoires">${e.games} g · ${Math.round((e.wins / e.games) * 100)} %</span>` : ''; })()}${c?.wr != null ? `<span class="wrtag" title="Winrate estimé : games pro + Master+ (one-tricks atténués)">${c.wr.toFixed(1)} % WR</span>` : ''}</div>
          ${c ? archBar(c) : ''}
          ${c ? sPairs.filter((x) => x.a.id === id || x.b.id === id).slice(0, 2).map((x) => { const o = x.a.id === id ? x.b : x.a; return `<span class="slink" style="--k:${KINDS[x.kind]?.color ?? '#6b7280'}" title="${x.title} : ${x.why.replace(/"/g, '&quot;')}">🔗 ${o.name} · ${KINDS[x.kind]?.label ?? ''}</span>`; }).join('') : ''}
        </div>
        ${c ? '<button class="clear" title="Retirer">×</button>' : ''}`;
      s.onclick = (e) => {
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
        if (e.target.classList.contains('clear')) { clearSlot(side, i); return; }
        if (e.target.classList.contains('rolebadge')) { askLane(side, i, true); return; }
        state.wantRole = c ? null : { side, i, r }; // clic sur une lane vide : le prochain champion ira à cette lane
        if (c) { showMatchups(side, i, s); return; } // champion choisi : forces et faiblesses face aux matchups
        select(side, i);
      };
      el.appendChild(s);
    });
  }
}

// ---------- Fiche matchup d'un champion choisi : forces, faiblesses, comment le jouer ----------
function showMatchups(side, i, anchor) {
  const box = $('mupBox');
  const id = state.slots[side][i]; if (!id) return;
  const other = side === 'blue' ? 'red' : 'blue';
  const me = team(side).find((x) => x.id === id), them = team(other), mates = team(side).filter((x) => x.id !== id);
  const lane = me.lane, c = me;
  const pct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  const opps = them.filter((o) => LANE_OPP[lane]?.includes(o.lane));
  // face-à-face : Master+ (lolalytics) et games pro (gol.gg), sur 30 jours ou depuis le dernier changement
  const rows = opps.map((o) => ({ o, le: laneEdge(c, lane, o, o.lane), pe: proEdge(c, o) }));
  const champArch = ORDER.reduce((a, b) => (c[b] > c[a] ? b : a));
  const enemyDom = them.length ? dominant(teamShares(them)) : null;
  const sPairs = teamSynergy(team(side)).pairs.filter((x) => x.a.id === id || x.b.id === id);
  const PH = ['', 'early', 'milieu de partie', 'late'];
  const plus = [], minus = [], tips = [];
  for (const { o, le, pe } of rows) {
    const v = le?.raw ?? (pe ? pe.edge : null);
    if (v == null) continue;
    const src = le ? `${le.n} games Master+` : `${pe.n} games pro`;
    if (v >= 1) plus.push(`Gagne son face-à-face contre <b>${o.name}</b> (${pct(v)} pts de winrate, ${src}).`);
    else if (v <= -1) minus.push(`Perd son face-à-face contre <b>${o.name}</b> (${pct(v)} pts, ${src}).`);
    else tips.push(`Face-à-face équilibré contre ${o.name} (${pct(v)} pts, ${src}) : c'est la jungle et les timings qui feront la différence.`);
    if (pe?.resp && pe.second?.id === id && pe.edge > 0) plus.push(`En pro, c'est une réponse qui marche après <b>${o.name}</b> (${pe.w}/${pe.n} victoires).`);
  }
  const opp = opps.find((o) => o.lane === lane) ?? opps[0];
  if (opp && c.scale != null && opp.scale != null && c.scale !== opp.scale) {
    if (c.scale < opp.scale) { plus.push(`Prend l’avantage sur <b>${opp.name}</b> en ${PH[c.scale]}.`); minus.push(`<b>${opp.name}</b> scale mieux : il te dépasse en ${PH[opp.scale]}.`); tips.push(`Joue la pression tôt contre ${opp.name} : trades, prio et objectifs avant 14 min.`); }
    else { plus.push(`Scale mieux que <b>${opp.name}</b> : à son avantage en ${PH[c.scale]}.`); minus.push(`<b>${opp.name}</b> a l’avantage en ${PH[opp.scale]}.`); tips.push(`Joue safe contre ${opp.name} en early (farm, ward, appel au jungle), ta fenêtre arrive en ${PH[c.scale]}.`); }
  } else if (c.scale === 1) minus.push('Perd en puissance en late : il faut convertir l’avance tôt.');
  else if (c.scale === 3) minus.push('Faible en early : évite les trades longs avant ses objets clés.');
  for (const k of ORDER) if (c[k] >= 2) plus.push(`Profil <b style="color:${ARCH[k].color}">${ARCH[k].label}</b> (${c[k]}/3) : ${ARCH[k].desc}.`);
  if (enemyDom) {
    const r = rel(champArch, enemyDom);
    if (r > 0) plus.push(`Son style ${ARCH[champArch].label} a un ${relText(champArch, enemyDom)} sur leur compo ${ARCH[enemyDom].label}.`);
    if (r < 0) minus.push(`Leur compo ${ARCH[enemyDom].label} a l'avantage sur son style ${ARCH[champArch].label} (${relText(champArch, enemyDom)}).`);
  }
  const engagers = them.filter((o) => o.e >= 2 || o.c >= 2);
  if (c.f >= 2) plus.push('Solide en première ligne : encaisse l’engage pour son équipe.');
  else if (c.f === 0 && engagers.length) minus.push(`Fragile face à leurs menaces d'engage / catch : ${engagers.slice(0, 3).map((o) => `<b>${o.name}</b>`).join(', ')}.`);
  for (const x of sPairs.slice(0, 3)) { const o = x.a.id === id ? x.b : x.a; plus.push(`Synergie avec <b>${o.name}</b> : ${x.title}.`); }
  if (!mates.length && !them.length) tips.push('Ajoute d’autres champions pour voir ses matchups.');
  if (rows.some((x) => (x.le?.raw ?? 0) <= -2)) tips.push(`Matchup difficile : demande un ganker tôt et cherche à jouer autour d'une autre lane.`);
  const bad = them.filter((o) => !LANE_OPP[lane]?.includes(o.lane) && rel(ORDER.reduce((a, b) => (o[b] > o[a] ? b : a)), champArch) > 0);
  if (bad.length) minus.push(`Hors lane, ${bad.slice(0, 2).map((o) => `<b>${o.name}</b>`).join(' et ')} ${bad.length > 1 ? 'ont' : 'a'} un profil qui contre le sien.`);
  const rowHtml = rows.length ? rows.map(({ o, le, pe }) => `<div class="mu-row"><img src="${img(o.id)}" alt=""><b>${o.name}</b><small>${ROLE_LABEL[o.lane]}</small>
      <span class="mu-v ${le ? (le.raw >= 0 ? 'up' : 'down') : 'na'}" title="Master+ (lolalytics)">${le ? `${pct(le.raw)} <i>${le.n} g</i>` : 'Master+ —'}</span>
      <span class="mu-v ${pe ? (pe.edge >= 0 ? 'up' : 'down') : 'na'}" title="Games pro des 30 derniers jours (gol.gg)">${pe ? `pro ${pe.w}/${pe.n}` : 'pro —'}</span></div>`).join('')
    : `<div class="muted mu-empty">Son adversaire de lane n'est pas encore choisi.</div>`;
  box.innerHTML = `<div class="mu-card ${side}">
    <div class="mu-h"><img src="${img(id)}" alt=""><div><b>${c.name}</b><span>${ROLE_LABEL[lane]} · ${side === 'blue' ? 'Équipe 1' : 'Équipe 2'}${c.wr != null ? ` · ${c.wr.toFixed(1)} % WR` : ''}</span></div><button class="mu-x" title="Fermer">×</button></div>
    <h6>Face-à-face</h6>${rowHtml}
    <div class="mu-cols"><div><h6 class="g">Forces</h6>${plus.length ? `<ul>${plus.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p class="muted">Rien de marquant pour l’instant.</p>'}</div>
      <div><h6 class="r">Faiblesses</h6>${minus.length ? `<ul>${minus.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p class="muted">Pas de faiblesse nette dans cette draft.</p>'}</div></div>
    ${tips.length ? `<h6>Comment le jouer</h6><ul class="mu-tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}
    <div class="mu-foot"><button class="mu-rep">Remplacer ce pick</button><button class="mu-lane">Changer de lane</button></div></div>`;
  box.hidden = false;
  const r = anchor.getBoundingClientRect(), card = box.firstElementChild, W = card.offsetWidth, H = card.offsetHeight;
  const left = side === 'blue' ? Math.min(innerWidth - W - 12, r.right + 10) : Math.max(12, r.left - W - 10);
  card.style.left = left + 'px'; card.style.top = Math.max(12, Math.min(innerHeight - H - 12, r.top - 20)) + 'px';
  const close = () => { box.hidden = true; document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  box.onclick = (e) => { if (e.target === box) close(); };
  card.querySelector('.mu-x').onclick = close;
  card.querySelector('.mu-rep').onclick = () => { close(); select(side, i); };
  card.querySelector('.mu-lane').onclick = () => { close(); askLane(side, i, true); };
  ensureDetails();
}

function renderStep() {
  const tg = target(), el = $('stepInfo');
  if (!tg) { el.textContent = 'Draft terminée'; el.className = 'step'; return; }
  el.textContent = (state.selected ? 'Modifier : ' : '') + stepLabel(tg);
  if (tg[0].endsWith('Bans') && !state.slots[tg[0]][tg[1]]) {
    const b = document.createElement('button'); b.className = 'skipban'; b.textContent = 'Passer ce ban';
    b.title = 'Aucun ban à cette étape (comme un ban manqué en pro)'; b.onclick = skipBan; el.appendChild(b);
  }
  el.className = 'step ' + (tg[0].startsWith('blue') ? 'blue' : 'red');
}

const APEX_COLOR = { MASTER: '#b65cff', GRANDMASTER: '#d64552', CHALLENGER: '#e2b13c' };
const rankColor = (r) => { const n = rankName(r); return n ? APEX_COLOR[n.tier] ?? tierColor(rankPoints(r)) : tierColor(null); };
const TIER_COLOR = [[2800, '#b65cff'], [2400, '#5b8cff'], [2000, '#2ec27e'], [1600, '#3fb8a6'], [1200, '#d4a837'], [800, '#9aa5b1'], [400, '#a0673c'], [0, '#7a7a7a']];
const tierColor = (pts) => (pts == null ? '#c3cad5' : pts >= 3600 ? '#f5d36b' : pts >= 3200 ? '#d64552' : TIER_COLOR.find(([v]) => pts >= v)[1]);

function renderWr(ev) {
  const fc = playersForecast(state.players.blue, state.players.red);
  const glob = combineWr(ev.wr, fc.wr);
  const main = fc.wr != null ? glob : ev.wr;
  state.lastMain = main;
  renderGauge(main, fc.wr != null ? 'Pronostic global' : 'Winrate de la draft');

  const bars = [['Draft', ev.wr, 'composition, synergies, méta']];
  if (fc.wr != null) bars.push(['Joueurs', fc.wr, 'rang, forme, pools'], ['Global', glob, 'draft + joueurs']);
  $('sbBars').innerHTML = bars.map(([l, v, sub]) => `
    <div class="sb-bar ${l === 'Global' ? 'glob' : ''}">
      <div class="sb-bar-h"><b class="b">${v.toFixed(1)}%</b><span>${l}<small>${sub}</small></span><b class="r">${(100 - v).toFixed(1)}%</b></div>
      <div class="sb-track"><div style="width:${v}%"></div></div>
    </div>`).join('') + (fc.wr == null && state.flow === 'players' ? '<div class="sb-hint">Charge les joueurs (multi op.gg) pour ajouter le pronostic joueurs.</div>' : '');
  for (const side of ['blue', 'red']) {
    const t = fc[side];
    const list = state.players[side] ?? [];
    const pct = side === 'blue' ? main : 100 - main;
    $(side === 'blue' ? 'sbBlue' : 'sbRed').innerHTML = `
      <div class="sb-title">${side === 'blue' ? 'Équipe 1' : 'Équipe 2'} <span>${side === 'blue' ? 'côté bleu' : 'côté rouge'}${state.mySide === side ? ' · toi' : ''}</span></div>
      <div class="sb-pct">${pct.toFixed(1)}<small>%</small></div>
      <div class="sb-meta">${t ? `<span class="tier" style="--c:${tierColor(t.rank)}">${pointsLabel(t.rank)}</span>${t.wr != null ? `<span>${t.wr} % saison</span>` : ''}${t.hot ? `<span>🔥 ${t.hot} en forme</span>` : ''}` : '<span class="muted">joueurs inconnus</span>'}</div>
      <div class="sb-picks">${ROLES.map((r) => { const i = state.roles[side].indexOf(r), id = state.slots[side][i]; return `<div class="sb-pick ${id ? '' : 'empty'}" title="${id ? state.P[id].name : ''}">${id ? `<img src="${img(id)}" alt="">` : ''}<span>${ROLE_LABEL[r]}</span></div>`; }).join('')}</div>
      <div class="sb-players">${ROLES.map((r) => {
        const p = list.find((x) => x.role === r);
        const pts = p ? rankPoints(p.rank) : null;
        const fx = p?.rank?.flex ? rankPoints(p.rank.flex) : null;
        return `<div class="sb-p" title="${p ? playerLabel(p) + (pts != null ? ' — Solo/Duo ' + (rankName(p.rank)?.label ?? '') : ' — Solo/Duo non classé') + (fx != null ? ' · Flex ' + (rankName(p.rank.flex)?.label ?? '') : '') : ROLE_LABEL[r]}"><i style="background:${p ? rankColor(p.rank) : tierColor(null)}"></i><span>${ROLE_LABEL[r]}</span><b>${p && p.riotId ? playerLabel(p) : '—'}</b>${p && p.riotId ? sbRank(p.rank, p.rank?.flex) : ''}</div>`;
      }).join('')}</div>`;
  }
}

// ---------- Comment le pourcentage est calculé ----------
function renderCalc(ev) {
  const el = $('calc'); if (!el) return;
  const tB = team('blue'), tR = team('red');
  if (!tB.length && !tR.length) { el.innerHTML = '<p class="muted">50 % tant qu’aucun champion n’est pické. Chaque pick ajoute ou retire des points selon les facteurs ci-dessous.</p>'; return; }
  const sum = ev.factors.reduce((a, f) => a + f.value, 0);
  const champ = (c) => `<div class="cc-r"><img src="${img(c.id)}"><b>${c.name}${c.changed ? ` <i class="cc-chg" title="Modifié au patch ${patchLabel(c.changed)} : données depuis ce patch">${patchLabel(c.changed)}</i>` : ''}</b>
    <span>${c.soloWr != null ? c.soloWr.toFixed(1) + ' %' : '—'}</span>
    <span>${c.proPatch ? `${c.proPatch.wr} % (${c.proPatch.n} g, ${c.changed ? 'depuis ' + patchLabel(c.changed) : '30 j'})` : c.proWr != null && !c.changed ? `${c.proWr.toFixed(1)} % (${c.proPicks} g, saison)` : '—'}</span>
    <span class="cc-w">${Math.round((c.wPro ?? 0) * 100)} % pro</span>
    <em>${c.wr != null ? c.wr.toFixed(1) + ' %' : '—'}</em></div>`;
  el.innerHTML = `
    <div class="calc-eq">50 % <span>de base</span> ${ev.factors.map((f) => `<b class="${f.value >= 0 ? 'up' : 'down'}">${f.value >= 0 ? '+' : '−'} ${Math.abs(f.value).toFixed(1)}</b>`).join(' ')} = <strong>${(50 + sum).toFixed(1)} %</strong> <span>pour l’équipe 1 (bleu)</span></div>
    <div class="calc-f">${ev.factors.map((f) => `<div class="cf"><div class="cf-h"><span>${f.label}</span><b class="${f.value >= 0 ? 'up' : 'down'}">${f.value >= 0 ? '+' : ''}${f.value.toFixed(1)} bleu</b></div><p>${f.detail}</p></div>`).join('') || '<p class="muted">Aucun facteur notable.</p>'}</div>
    <h5>Force de chaque champion</h5>
    <div class="cc"><div class="cc-r cc-h"><span></span><b>Champion</b><span>Master+</span><span>Pro</span><span>Mélange</span><em>Retenu</em></div>
      ${tB.map(champ).join('')}${tR.length ? '<div class="cc-sep">Équipe 2</div>' + tR.map(champ).join('') : ''}</div>
    <h5>Comment je calcule</h5>
    <ol class="calc-m">
      <li><b>Force des champions.</b> Winrate Master+ (lolalytics) ramené à la moyenne de sa lane. Pour limiter l’effet des one-tricks (aucun site ne permet de les exclure), l’écart d’un champion peu joué est atténué : pickrate ÷ (pickrate + 1,2). Ce chiffre est mélangé au winrate pro des 30 derniers jours (lissé vers 50 % quand il y a peu de games, poids jusqu’à 50 % selon le nombre de games) et, un peu, à celui de la saison. Facteur = écart moyen entre les deux équipes × 0,6.</li>
      <li><b>Fenêtre des données.</b> Tout est calculé sur les 30 derniers jours (soloQ Master+ et games pro). Exception : un champion modifié directement par un patch sorti pendant ces 30 jours (notes de patch Riot, mises à jour en cours de patch comprises) ne garde que ses games depuis ce patch, et sa saison pro n’est plus utilisée. Peu de games depuis le changement = écart ramené vers la moyenne. Pour un matchup ou un duo, la fenêtre suit le champion modifié le plus récemment.</li>
      <li><b>Réponses en pro</b> (gol.gg, games des 30 derniers jours) : pour deux champions face à face en lane, je regarde d’abord les games où ils ont été pickés <i>dans le même ordre</i> que dans ta draft (qui a répondu à qui), sinon toutes leurs games l’un contre l’autre. Écart à 50 % pondéré n ÷ (n + 6), × 0,35, plafonné à ±6.</li>
      <li><b>Face-à-face des lanes</b> (Master+, 30 derniers jours) : winrate du matchup − 50, pondéré par le nombre de games (n ÷ (n + 250)), × 0,55, plafonné à ±7. Au bot, ADC et support comptent contre l’ADC et le support adverses.</li>
      <li><b>Duos mesurés</b> (Master+) : écart du duo à son winrate attendu, pondéré n ÷ (n + 300), × 0,5, plafonné à ±4. Quand un duo est mesuré, la table de synergies théoriques pèse moitié moins.</li>
      <li><b>Pentagone des compos</b> (Engage › Split › Poke › Peeling › Catch) : avantage du style de chaque équipe sur l’autre, × 8, proportionnel au nombre de picks.</li>
      <li><b>Le reste</b> : clarté du plan de jeu, synergies théoriques, maîtrise des joueurs (op.gg), mélange des dégâts, ligne de front, outils d’engage.</li>
    </ol>
    <p class="muted">Le total est borné entre 25 et 75 %. C’est une estimation, pas une certitude.</p>`;
}

function renderGauge(v, label) {
  const lead = v >= 50 ? 'blue' : 'red', gap = Math.abs(v - 50);
  const verdict = gap < 1.5 ? 'Draft équilibrée' : gap < 4 ? 'Léger avantage' : gap < 8 ? 'Avantage net' : 'Gros avantage';
  const who = gap < 1.5 ? '' : lead === 'blue' ? 'Équipe 1' : 'Équipe 2';
  const icons = (side) => state.slots[side].filter(Boolean).slice(0, 5).map((id) => `<img src="${img(id)}" alt="">`).join('');
  $('gauge').innerHTML = `
    <div class="wb-label">${label}</div>
    <div class="wb-nums"><b class="b ${lead === 'blue' ? 'lead' : ''}">${v.toFixed(1)}<small>%</small></b><span class="wb-vs">VS</span><b class="r ${lead === 'red' ? 'lead' : ''}">${(100 - v).toFixed(1)}<small>%</small></b></div>
    <div class="wb-track">
      <div class="wb-fill b" style="width:${v}%"><span class="wb-ic">${icons('blue')}</span></div>
      <div class="wb-fill r" style="width:${100 - v}%"><span class="wb-ic">${icons('red')}</span></div>
      <div class="wb-mid"></div>
      <div class="wb-mark" style="left:${v}%"></div>
    </div>
    <div class="wb-scale"><span>Éq. 1</span><span>50 / 50</span><span>Éq. 2</span></div>
    <div class="wb-verdict ${gap < 1.5 ? '' : lead}">${verdict}${who ? ` pour l’${who.toLowerCase()}` : ''}</div>`;
}

function currentContext() {
  const tg = target();
  if (!tg) return null;
  const isPick = tg[0] === 'blue' || tg[0] === 'red';
  const side = isPick ? tg[0] : tg[0].replace('Bans', '');
  const role = isPick ? state.roles[side][tg[1]] : null;
  return { tg, isPick, side, role };
}

// Grille : les champions du joueur à ce rôle passent en premier (★), sans projection de pick.
// Grille : % = winrate projeté de ce côté si on prend ce champion à ce slot ; les champions du joueur (★) passent en premier.
function gridInfo() {
  const ctx = currentContext();
  if (!ctx || !ctx.isPick) return ctx ? { ctx, proj: new Map() } : null;
  const replaced = state.slots[ctx.side][ctx.tg[1]] ? ctx.tg[1] : -1;
  const open = openRoles(ctx.side, replaced);
  const strip = (arr, side) => (ctx.side === side && replaced >= 0 ? arr.filter((c) => c.id !== state.slots[side][replaced]) : arr);
  const b = strip(team('blue'), 'blue'), r = strip(team('red'), 'red');
  // chaque candidat est testé à son meilleur rôle encore libre
  const roleFor = (c) => [...open].sort((x, y) => fit(c, y) - fit(c, x))[0];
  const po = pickPos(ctx.side, ctx.tg[1]);
  const cand = pool().map((c) => { const ln = roleFor(c); return { ...withComfort(c, ctx.side, ln), lane: ln, po }; });
  const proj = new Map(projectPicks(b, r, ctx.side, null, cand).map((x) => {
    const known = playerFor(ctx.side, x.c.lane);
    return [x.c.id, { ...x, inPool: x.c.comfort > 0, prio: x.wr + (known ? (x.c.comfort > 0 ? 1.5 * x.c.comfort : -5) : 0) }];
  }));
  return { ctx, proj, open };
}

function renderGrid(info) {
  const el = $('grid'), u = used();
  const q = state.search.trim().toLowerCase();
  const ctx = info?.ctx;
  const roleNeeded = state.roleFilter;
  const openR = state.onlyRole && ctx?.isPick ? info?.open : null;
  let list = state.list.filter((c) =>
    (!q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)) &&
    (!roleNeeded || c.roles.includes(roleNeeded)) &&
    (!openR || q || c.roles.some((r) => openR.includes(r)) || flexRoles(c).some((r) => openR.includes(r))) &&
    (!state.archFilter || c[state.archFilter] >= 2));
  if (info?.proj) list = [...list].sort((a, b) => (info.proj.get(b.id)?.prio ?? 0) - (info.proj.get(a.id)?.prio ?? 0));
  el.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const c of list) {
    const t = document.createElement('div');
    const flg = flLocked().get(c.id);
    t.className = 'tile' + (u.has(c.id) ? ' used' : '') + (flg && !Object.values(state.slots).flat().includes(c.id) ? ' fl' : '') + (c.offmeta ? ' offmeta' : '');
    const pj = info?.proj?.get(c.id);
    t.innerHTML = `<img loading="lazy" src="${img(c.id)}" alt="">
      ${pj?.wr != null ? `<span class="proj ${pj.delta >= 0 ? 'up' : 'down'}" title="Winrate projeté de ton côté avec ce pick">${pj.wr.toFixed(1)}%</span>` : ''}
      ${pj?.inPool ? '<span class="star" title="Dans le pool du joueur">★</span>' : ''}
      <div class="dots">${ORDER.filter((k) => c[k] >= 2).map((k) => `<i style="background:${ARCH[k].color}"></i>`).join('')}</div>
      <div class="nm">${c.name}</div>`;
    t.title = `${c.name} — ${(c.roles.length ? c.roles : c.soloRoles).map((r) => ROLE_LABEL[r]).join('/')}` +
      (c.soloWr != null ? ` · soloQ ${c.soloWr.toFixed(1)} %` : '') +
      (c.proPicks ? ` · pro ${c.proPicks} games, ${c.presence} % présence` : ' · jamais joué en pro cette saison') +
      (c.proRoleStats ? `\nRôles en pro : ${Object.entries(c.proRoleStats).sort((a, b) => b[1].picks - a[1].picks).map(([r, v]) => `${ROLE_LABEL[r]} ${v.picks}`).join(', ')}` : '') +
      (c.offmeta ? '\n⚠ Pas un pick pro à ce rôle' : '') +
      `\n${ORDER.map((k) => `${ARCH[k].label} ${c[k]}/3`).join(' · ')} · Scaling ${['', 'early', 'mid', 'late'][c.scale]}${c.guessed ? ' (profil estimé)' : ''}`;
    if (flg && t.className.includes(' fl')) t.title = `🔒 Fearless : ${c.name} a été joué en game ${flg}, il ne peut plus être repris dans la série`;
    t.onclick = () => place(c.id);
    frag.appendChild(t);
  }
  el.appendChild(frag);
}

function renderPentagon(ev) {
  const svg = $('pentagon');
  svg.setAttribute('viewBox', '0 0 400 330');
  const C = [200, 172], R = 112;
  // Engage en haut, Catch à droite, Peeling en bas à droite, Poke en bas à gauche, Split à gauche
  const ANG = { e: -90, c: -18, d: 54, p: 126, s: 198 };
  const at = (k, r = R) => [C[0] + r * Math.cos((ANG[k] * Math.PI) / 180), C[1] + r * Math.sin((ANG[k] * Math.PI) / 180)];
  const poly = (f) => ORDER.map((k) => at(k, R * f).map((v) => v.toFixed(1)).join(',')).join(' ');
  let s = '<defs>' + ORDER.map((k) => `<marker id="ar-${k}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="${ARCH[k].color}"/></marker>`).join('') + '</defs>';
  // fond : pentagone + 3 anneaux discrets + rayons
  s += `<polygon points="${poly(1)}" fill="#f4f6f9" stroke="#d9dee6" stroke-width="1.5"/>`;
  for (const f of [0.25, 0.5, 0.75]) s += `<polygon points="${poly(f)}" fill="none" stroke="#e3e7ed" stroke-width="1"/>`;
  for (const k of ORDER) { const [x, y] = at(k); s += `<line x1="${C[0]}" y1="${C[1]}" x2="${x}" y2="${y}" stroke="#e3e7ed"/>`; }
  // légers avantages : fines diagonales en pointillés, sous les radars (discrètes mais présentes)
  ORDER.forEach((a, i) => {
    const b = ORDER[(i + 2) % 5];
    const [x1, y1] = at(a, R - 6), [x2, y2] = at(b, R - 6), t0 = 0.12, t1 = 0.86;
    s += `<line x1="${(x1 + (x2 - x1) * t0).toFixed(1)}" y1="${(y1 + (y2 - y1) * t0).toFixed(1)}" x2="${(x1 + (x2 - x1) * t1).toFixed(1)}" y2="${(y1 + (y2 - y1) * t1).toFixed(1)}" stroke="${ARCH[a].color}" stroke-width="1.3" stroke-dasharray="5 4" opacity=".45" marker-end="url(#ar-${a})"><title>${ARCH[a].label} a un léger avantage sur ${ARCH[b].label}</title></line>`;
  });
  // gros avantages : arcs pleins à l'extérieur
  ORDER.forEach((a, i) => {
    const b = ORDER[(i + 1) % 5];
    const [x1, y1] = at(a, R + 9), [x2, y2] = at(b, R + 9);
    const t0 = 0.2, t1 = 0.8, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const ox = (mx - C[0]) * 0.12, oy = (my - C[1]) * 0.12; // légère courbure vers l'extérieur
    const p0 = [x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0], p1 = [x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1];
    s += `<path d="M${p0[0].toFixed(1)},${p0[1].toFixed(1)} Q${(mx + ox).toFixed(1)},${(my + oy).toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}" fill="none" stroke="${ARCH[a].color}" stroke-width="2.4" opacity=".85" marker-end="url(#ar-${a})"><title>${ARCH[a].label} a un gros avantage sur ${ARCH[b].label}</title></path>`;
  });
  // radar des deux équipes (échelle adoucie : les petites parts restent visibles)
  const rr = (v) => R * (0.08 + 0.92 * Math.sqrt(Math.min(1, v / 0.5)));
  for (const [sh, col] of [[ev.sharesRed, '214,69,82'], [ev.sharesBlue, '47,111,224']]) {
    if (!sh) continue;
    const pts = ORDER.map((k) => at(k, rr(sh[k])).map((v) => v.toFixed(1)).join(',')).join(' ');
    s += `<polygon points="${pts}" fill="rgba(${col},.16)" stroke="rgb(${col})" stroke-width="2.2" stroke-linejoin="round"/>`;
    for (const k of ORDER) { const [x, y] = at(k, rr(sh[k])); s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="rgb(${col})"/>`; }
  }
  for (const k of ORDER) {
    const [vx, vy] = at(k), [lx, ly] = at(k, R + 32);
    s += `<circle cx="${vx}" cy="${vy}" r="5" fill="${ARCH[k].color}"/>`;
    s += `<text x="${lx}" y="${ly + 5}" fill="${ARCH[k].color}" font-size="15" font-weight="800" text-anchor="middle">${ARCH[k].label}</text>`;
  }
  svg.innerHTML = themed(s);
  const tB = team('blue'), tR = team('red');
  const lb = tB.length ? compLabel(tB) : null, lr = tR.length ? compLabel(tR) : null;
  $('identity').innerHTML = `<div class="idt"><span class="b">${lb ? lb.label : 'Bleu'}</span><span class="r">${lr ? lr.label : 'Rouge'}</span></div>` +
    ORDER.map((k) => {
      const b = ev.sharesBlue?.[k] ?? 0, r = ev.sharesRed?.[k] ?? 0;
      return `<div class="idr"><span class="idv b">${Math.round(b * 100)}%</span><div class="idb l"><i style="width:${b * 100}%"></i></div>
        <span class="idk" style="color:${ARCH[k].color}">${ARCH[k].label}</span><div class="idb"><i style="width:${r * 100}%"></i></div><span class="idv r">${Math.round(r * 100)}%</span></div>`;
    }).join('');
}

// Compo indécise (plusieurs styles à égalité) : quel style jouer face à la compo adverse ?
function renderPentaAdvice(ev) {
  const el = $('pentaAdvice');
  const me = state.mySide, mine = me === 'blue' ? ev.sharesBlue : ev.sharesRed, theirs = me === 'blue' ? ev.sharesRed : ev.sharesBlue;
  if (!mine || !theirs || team(me).length < 2) { el.innerHTML = ''; return; }
  const top = Math.max(...ORDER.map((k) => mine[k]));
  const tied = ORDER.filter((k) => mine[k] >= top - 0.04 && mine[k] > 0.12).sort((a, b) => mine[b] - mine[a]);
  // valeur d'un style = ses avantages face à CHAQUE style adverse, pondérés par leur part dans la compo d'en face
  const val = (a) => ORDER.reduce((t, e) => t + rel(a, e) * theirs[e], 0);
  const best = [...tied].sort((a, b) => val(b) - val(a) || mine[b] - mine[a])[0];
  const eTop = [...ORDER].sort((a, b) => theirs[b] - theirs[a]).filter((k, i) => i === 0 || theirs[k] >= theirs[ORDER.reduce((x, y) => (theirs[y] > theirs[x] ? y : x))] - 0.04);
  const pct = (v) => Math.round(v * 100) + ' %';
  const lbl = (k) => `<b style="color:${ARCH[k].color}">${ARCH[k].label}</b>`;
  const vsTxt = eTop.map((e) => `${relText(best, e)} sur ${lbl(e)}`).join(', ');
  const others = tied.filter((k) => k !== best).map((k) => `${lbl(k)} ${val(k) >= 0 ? '+' : ''}${val(k).toFixed(2)}`).join(' · ');
  const verdict = val(best) > 0.05 ? `joue ${lbl(best)} : ${vsTxt}` : `aucun de ces styles n'a l'avantage ; ${lbl(best)} est le moins risqué (${vsTxt})`;
  el.innerHTML = tied.length > 1
    ? `<div class="pa"><span class="pa-k">Ta compo hésite</span> entre ${tied.map((k) => `${lbl(k)} (${pct(mine[k])})`).join(', ')}. Face à leur ${eTop.map(lbl).join(' / ')}, ${verdict}.<span class="pa-s">Score face à leur compo : ${lbl(best)} ${val(best) >= 0 ? '+' : ''}${val(best).toFixed(2)}${others ? ' · ' + others : ''}</span></div>`
    : (() => {
      // alternative : seulement un style déjà présent dans la compo (au moins 18 %), sinon conseil de terrain
      const alt = ORDER.filter((k) => k !== best && mine[k] >= 0.18 && val(k) > val(best)).sort((a, b) => val(b) - val(a))[0];
      const tail = val(best) >= 0 ? '' : alt ? ` <span class="pa-w">Ton 2e style, ${lbl(alt)} (${pct(mine[alt])}), s’en sort mieux face à eux.</span>` : ' <span class="pa-w">Aucun autre style de ta compo ne fait mieux : évite leur terrain et cherche les fights hors de leur zone de confort.</span>';
      return `<div class="pa"><span class="pa-k">Ton style</span> ${lbl(best)} (${pct(mine[best])}) face à leur ${eTop.map(lbl).join(' / ')} : ${vsTxt}.${tail}</div>`;
    })();
}
function renderScaling() {
  const svg = $('scaling');
  // le graphique prend toute la place de sa carte (pas de vide en dessous)
  const box = svg.parentElement.getBoundingClientRect();
  const W = Math.max(360, Math.round(box.width) || 640), H = Math.max(220, Math.round(box.height) || 300);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const L = 46, Rr = 26, T = 30, B = 28;
  const x = (m) => L + ((m - 3) * (W - L - Rr)) / 37;
  const me = state.mySide, them = me === 'blue' ? 'red' : 'blue';
  const sides = state.scalShow === 'mine' ? [me] : state.scalShow === 'theirs' ? [them] : ['red', 'blue'];
  const cur = Object.fromEntries(['blue', 'red'].map((sd) => [sd, team(sd).length ? powerCurve(team(sd)) : null]));
  const vals = sides.flatMap((sd) => cur[sd] ?? []).map(([, v]) => v);
  const lo = Math.min(0.88, ...vals) - 0.03, hi = Math.max(1.12, ...vals) + 0.03;
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  let s = '';
  // phases de jeu en fond
  for (const [a, b, lab, fill] of [[3, 14, 'Early', '#f6f8fb'], [14, 25, 'Mid', '#ffffff'], [25, 40, 'Late', '#f6f8fb']]) {
    s += `<rect x="${x(a)}" y="${T}" width="${x(b) - x(a)}" height="${H - T - B}" fill="${fill}"/>`;
    s += `<text x="${(x(a) + x(b)) / 2}" y="${T - 10}" fill="#6b7280" font-size="12" font-weight="700" text-anchor="middle">${lab}</text>`;
  }
  for (const [m, lab] of [[14, 'Herald / grubs'], [20, 'Baron']]) {
    s += `<line x1="${x(m)}" x2="${x(m)}" y1="${T}" y2="${H - B}" stroke="#cfd5de" stroke-dasharray="4 4"/>`;
    s += `<text x="${x(m) + 4}" y="${T + 14}" fill="#8a93a8" font-size="11">${lab}</text>`;
  }
  for (let m = 5; m <= 40; m += 5) {
    s += `<line x1="${x(m)}" x2="${x(m)}" y1="${H - B}" y2="${H - B + 4}" stroke="#9aa3b2"/>`;
    s += `<text x="${x(m)}" y="${H - 8}" fill="#6b7280" font-size="11.5" text-anchor="middle">${m} min</text>`;
  }
  s += `<line x1="${L}" x2="${W - Rr}" y1="${y(1)}" y2="${y(1)}" stroke="#9aa3b2" stroke-width="1"/>`;
  s += `<text x="${L - 8}" y="${y(1) + 4}" fill="#6b7280" font-size="11" text-anchor="end">moy.</text>`;
  s += `<text x="${L - 8}" y="${T + 12}" fill="#6b7280" font-size="11" text-anchor="end">fort</text>`;
  s += `<text x="${L - 8}" y="${H - B - 2}" fill="#6b7280" font-size="11" text-anchor="end">faible</text>`;
  const path = (pts) => pts.map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join('');
  // zone entre les deux courbes, colorée selon l'équipe devant
  if (sides.length === 2 && cur.blue && cur.red) {
    for (let i = 0; i < cur.blue.length - 1; i++) {
      const [m0, b0] = cur.blue[i], [m1, b1] = cur.blue[i + 1], r0 = cur.red[i][1], r1 = cur.red[i + 1][1];
      const col = b0 + b1 >= r0 + r1 ? '47,111,224' : '214,69,82';
      s += `<path d="M${x(m0)},${y(b0)}L${x(m1)},${y(b1)}L${x(m1)},${y(r1)}L${x(m0)},${y(r0)}Z" fill="rgba(${col},.12)"/>`;
    }
  }
  let any = false;
  for (const [side, col] of [['red', '#d64552'], ['blue', '#2f6fe0']]) {
    if (!sides.includes(side) || !cur[side]) continue;
    any = true;
    s += `<path d="${path(cur[side])}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    // pic de puissance
    const pk = cur[side].reduce((a, p) => (p[1] > a[1] ? p : a));
    s += `<circle cx="${x(pk[0])}" cy="${y(pk[1])}" r="4.5" fill="${col}" stroke="#ffffff" stroke-width="2"><title>Pic ${side === 'blue' ? 'bleu' : 'rouge'} vers ${Math.round(pk[0])} min</title></circle>`;
  }
  let lx = W - Rr - 130;
  for (const [side, col, lab] of [['blue', '#2f6fe0', 'Bleu'], ['red', '#d64552', 'Rouge']]) {
    if (!any || !sides.includes(side) || !cur[side]) continue;
    s += `<line x1="${lx}" x2="${lx + 16}" y1="${T + 30}" y2="${T + 30}" stroke="${col}" stroke-width="3" stroke-linecap="round"/><text x="${lx + 22}" y="${T + 34}" fill="#1f2937" font-size="12" font-weight="600">${lab}</text>`;
    lx += 66;
  }
  $('scalPick').innerHTML = [['both', 'Les deux'], ['mine', 'Ta compo'], ['theirs', 'Leur compo']]
    .map(([k, l]) => `<button class="chip ${state.scalShow === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
  $('scalPick').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { state.scalShow = b.dataset.k; renderScaling(); }));
  if (!any) s += `<text x="${W / 2}" y="${H / 2}" fill="#6b7280" font-size="13" text-anchor="middle">Les courbes apparaissent avec les picks</text>`;
  svg.innerHTML = themed(s);
  // résumé par phase : qui est devant, et de combien
  const at = (sd, a, b) => { const p = cur[sd]?.filter(([m]) => m >= a && m <= b); return p?.length ? p.reduce((t, [, v]) => t + v, 0) / p.length : null; };
  $('scalSum').innerHTML = cur.blue && cur.red ? [['Early', 3, 14], ['Mid', 14, 25], ['Late', 25, 40]].map(([lab, a, b]) => {
    const d = at('blue', a, b) - at('red', a, b), who = Math.abs(d) < 0.03 ? 'eq' : d > 0 ? 'b' : 'r';
    return `<div class="ss ${who}"><b>${lab}</b><span>${who === 'eq' ? 'Équilibré' : who === 'b' ? 'Avantage bleu' : 'Avantage rouge'}</span><i>${who === 'eq' ? '' : `${d > 0 ? '+' : ''}${Math.round(d * 100)} %`}</i></div>`;
  }).join('') : '';
}

const roster = (side) => state.slots[side].map((id, i) => (id ? { c: state.P[id], role: state.roles[side][i] } : null)).filter(Boolean);

// ---------- Panneau joueurs ----------
async function loadTeam(side) {
  const input = $(side === 'blue' ? 'opggBlue' : 'opggRed').value.trim();
  state.teamInput[side] = input;
  if (!input) { state.players[side] = []; render(); return; }
  if (!api.loadTeam) { toast('Disponible uniquement dans l’application'); return; }
  const btn = document.querySelector(`.loadTeam[data-side="${side}"]`);
  btn.disabled = true; btn.textContent = 'Chargement…';
  try {
    const res = await api.loadTeam({ input, region: state.region });
    if (res.error) throw new Error(res.error);
    const prev = state.players[side];
    state.players[side] = res.players.map((p, i) => {
      const role = ROLES[i] ?? 'S';
      const old = prev.find((x) => x.role === role);
      const manual = (old?.pool ?? []).filter((e) => e.manual && !(p.pool ?? []).some((x) => x.id === e.id));
      return { ...p, role, pool: [...(p.pool ?? []), ...manual] };
    });
    const ok = res.players.filter((p) => !p.error).length;
    toast(`${ok}/${res.players.length} joueurs chargés (${res.region.toUpperCase()})`);
  } catch (e) {
    toast('op.gg : ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Charger';
    render();
  }
}

// Toujours 5 lignes par équipe : on peut remplir les pools à la main, avec ou sans op.gg.
function ensureRoster(side) {
  const list = state.players[side];
  for (const r of ROLES) if (!list.some((p) => p.role === r)) list.push({ riotId: '', role: r, pool: [], manual: true });
  list.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  return list;
}
const nrm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
function findChamp(name) {
  const q = nrm(name);
  if (!q) return null;
  return state.list.find((x) => nrm(x.name) === q || nrm(x.id) === q)
    ?? (() => { const m = state.list.filter((x) => nrm(x.name).startsWith(q) || nrm(x.id).startsWith(q)); return m.length === 1 ? m[0] : null; })()
    ?? (() => { const m = state.list.filter((x) => nrm(x.name).includes(q)); return m.length === 1 ? m[0] : null; })();
}
function addToPool(side, i, name) {
  const c = findChamp(name);
  if (!c) { toast(`Champion introuvable ou ambigu : ${name}`); return; }
  const p = state.players[side][i];
  p.pool ??= [];
  if (p.pool.some((e) => e.id === c.id)) { toast(`${c.name} est déjà dans le pool`); return; }
  // On remet les vraies données du joueur si on les a (champion retiré, ou joué sous 1 % de ses games), sinon juste le champion
  const known = (p.removed ?? []).find((e) => e.id === c.id) ?? (p.all ?? []).find((e) => e.id === c.id);
  if (known && known.games) {
    p.pool.push({ ...known, manual: false, restored: true });
    p.removed = (p.removed ?? []).filter((e) => e.id !== c.id);
    toast(`${c.name} remis dans le pool de ${playerLabel(p)} : ${known.games} games, ${Math.round((known.wins / known.games) * 100)} %`);
  } else {
    p.pool.push({ id: c.id, manual: true });
    toast(`${c.name} ajouté au pool de ${playerLabel(p)} (aucune game trouvée)`);
  }
  render();
}
function renderPlayers() {
  // le panneau est redessiné souvent (données en fond) : on garde ce qui est en cours de saisie
  const act = document.activeElement;
  const keep = act && (act.classList.contains('padd') || act.classList.contains('pinput')) && act.closest('.plist')
    ? { list: act.closest('.plist').id, cls: act.classList.contains('padd') ? 'padd' : 'pinput', i: act.dataset.i, v: act.value, a: act.selectionStart, b: act.selectionEnd } : null;
  const drafts = {};
  document.querySelectorAll('.padd').forEach((x) => { if (x.value) drafts[`${x.closest('.plist')?.id}|${x.dataset.i}`] = x.value; });
  for (const side of ['blue', 'red']) {
    const el = $(side === 'blue' ? 'playersBlue' : 'playersRed');
    const list = ensureRoster(side);
    el.innerHTML = list.map((p, i) => {
      const pts = rankPoints(p.rank);
      const g = (p.rank?.wins ?? 0) + (p.rank?.losses ?? 0);
      const shown = (p.pool ?? []).map((e, k) => ({ e, k })).filter(({ e }) => e.manual || e.restored || fitsRole(e.id, p.role));
      const hidden = (p.pool?.length ?? 0) - shown.length;
      return `
      <div class="prow">
        <select data-i="${i}" class="prole">${ROLES.map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>
        <div class="pid">
          <input class="pinput" data-i="${i}" value="${(p.riotId || '').replace(/"/g, '&quot;')}" placeholder="Nom#TAG" />
          <div class="pinfo">
            ${p.error ? `<span class="perr">⚠ ${p.error}</span>`
              : pts != null ? `<div class="prk"><span class="qtag" title="Solo/Duo : seul classement utilisé pour le pronostic">Solo</span><span class="tier" style="--c:${rankColor(p.rank)}">${rankName(p.rank)?.label ?? '?'}${p.rank?.tier && p.rank.lp != null ? ` · ${p.rank.lp} LP` : ''}${!p.rank?.tier ? ' (saison passée)' : ''}</span>${g ? `<span class="pwr ${p.rank.wins / g >= 0.5 ? 'up' : 'down'}">${Math.round((p.rank.wins / g) * 100)} %</span><span class="muted">${g} g</span>` : ''}${p.rank?.hot ? '<span title="série de victoires">🔥</span>' : ''}</div>${flexTag(p)}`
              : p.riotId ? `<div class="prk"><span class="qtag">Solo</span><span class="muted">non classé</span></div>${flexTag(p)}` : '<span class="muted">joueur non renseigné</span>'}
            ${p.dpm ? `<span class="pdpm" title="${p.dpm}">${/lues/.test(p.dpm) ? 'dpm ✓' : 'dpm —'}</span>` : ''}
          </div>
        </div>
        <div class="ppool">
          ${shown.map(({ e, k }) => `<span class="pchamp ${e.manual ? 'manual' : ''} ${flLocked().has(e.id) ? 'fl' : ''}" title="${flLocked().has(e.id) ? `🔒 Fearless : joué en game ${flLocked().get(e.id)}, indisponible pour la série — ` : ''}${state.P[e.id]?.name ?? e.id} : ${e.games ? `${e.games} games, ${Math.round((e.wins / e.games) * 100)} %${e.share ? `, ${e.share} % de ses games` : ''}${e.src ? ` (${e.src})` : ''}` : 'ajouté à la main, aucune game trouvée'} — clic pour retirer" data-i="${i}" data-k="${k}"><img src="${img(e.id)}" alt="">${e.games ? `<i>${e.games}</i>` : ''}${e.games ? `<b class="${e.wins / e.games >= 0.5 ? 'up' : 'down'}">${Math.round((e.wins / e.games) * 100)}%</b>` : ''}</span>`).join('') || '<span class="muted pnone">aucun champion à ce rôle</span>'}
          ${hidden > 0 ? `<span class="phidden" title="Champions joués à d’autres lanes, ignorés pour le rôle ${ROLE_LABEL[p.role]}">+${hidden} autres lanes</span>` : ''}
          <input class="padd" data-i="${i}" list="champList" placeholder="+ champion" />
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('.prole').forEach((sel) => (sel.onchange = () => {
      const arr = state.players[side], i = +sel.dataset.i, r = sel.value;
      const j = arr.findIndex((x) => x.role === r);
      if (j >= 0) arr[j].role = arr[i].role;
      arr[i].role = r; render();
    }));
    el.querySelectorAll('.pinput').forEach((inp) => (inp.onchange = () => { state.players[side][+inp.dataset.i].riotId = inp.value.trim(); }));
    el.querySelectorAll('.pchamp').forEach((ch) => (ch.onclick = () => {
      const p = state.players[side][+ch.dataset.i];
      const [e] = p.pool.splice(+ch.dataset.k, 1);
      if (e && e.games) (p.removed ??= []).push(e); // gardé pour pouvoir le remettre avec ses stats
      render();
    }));
    el.querySelectorAll('.padd').forEach((inp) => {
      const d = drafts[`${el.id}|${inp.dataset.i}`]; if (d) inp.value = d;
      const go = () => { const v = inp.value.trim(); if (!v) return; inp.value = ''; delete drafts[`${el.id}|${inp.dataset.i}`]; addToPool(side, +inp.dataset.i, v); };
      // ajout dès qu'un champion de la liste est choisi, ou avec Entrée
      inp.addEventListener('input', () => { if (state.list.some((x) => x.name === inp.value)) go(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      inp.addEventListener('blur', () => { if (findChamp(inp.value)) go(); });
    });
  }
  if (keep) {
    const el = document.querySelector(`#${keep.list} .${keep.cls}[data-i="${keep.i}"]`);
    if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.a, keep.b); } catch {} }
  }
}

// ---------- Drafts proposées ----------
// ---------- Bans conseillés, par phase ----------
// Phase 1 : avant les picks (3 bans). Phase 2 : après les 3 premiers picks de chaque équipe (2 bans).
// On bannit ce que LEURS joueurs ont le plus de chances de prendre (pools op.gg, sinon méta du rôle),
// pondéré par le danger pour la compo que tu veux jouer (styles qui la battent dans le pentagone).
const champArch = (c) => ORDER.reduce((a, k) => (c[k] > c[a] ? k : a), ORDER[0]);
function wantedArch() {
  if (state.wantArch) return { k: state.wantArch, auto: false };
  const t = team(state.mySide);
  if (t.length) return { k: dominant(teamShares(t)), auto: true, from: 'tes picks' };
  const sum = Object.fromEntries(ORDER.map((k) => [k, 0]));
  for (const p of rolePlayers(state.mySide)) for (const e of p.pool) { const c = state.P[e.id]; if (c) for (const k of ORDER) sum[k] += c[k] * e.games; }
  if (ORDER.some((k) => sum[k] > 0)) return { k: ORDER.reduce((a, k) => (sum[k] > sum[a] ? k : a)), auto: true, from: 'les champions de tes joueurs' };
  return { k: null, auto: true };
}
function banList(want) {
  const me = state.mySide, other = me === 'blue' ? 'red' : 'blue';
  const avail = pool();
  const open = state.roles[other].filter((r, i) => !state.slots[other][i]);
  if (!open.length) return [];
  const cand = {};
  for (const r of open) cand[r] = avail.map((c) => withComfort(c, other, r)).filter((c) => c.roles.includes(r) && !c.offmeta);
  const pred = predictPicks(open, cand, rolePlayers(other));
  return predictedBans(team(me), team(other), me, pred).map((x) => {
    const a = champArch(x.c), r = want ? rel(a, want) : 0;
    return { ...x, arch: a, counter: r > 0 ? r : 0, score: x.score * (1 + 0.8 * Math.max(0, r)) };
  }).sort((a, b) => b.score - a.score);
}
function banRow(x, want) {
  const why = x.why.replace(/ \(méta\)$/, ' (méta du rôle)');
  const ctr = x.counter ? `<span class="bp-ctr" style="--a:${ARCH[x.arch].color}">${ARCH[x.arch].label} : ${x.counter === 1 ? 'gros' : 'léger'} avantage sur ta compo ${ARCH[want].label}</span>` : '';
  return `<button class="bp-r" data-id="${x.c.id}" title="Cliquer pour le bannir"><img src="${img(x.c.id)}" alt=""><div><b>${x.c.name}</b><span>${why}</span>${ctr}</div><em>Bannir</em></button>`;
}
// Bans pour protéger TA compo : quand tu as déjà pické (ex. tu fais ta draft en premier),
// on cherche dans leurs pools les champions qui feraient le plus baisser ton winrate face à ta compo.
function compBans(want) {
  const me = state.mySide, other = me === 'blue' ? 'red' : 'blue';
  const mine = team(me), theirs = team(other);
  const open = state.roles[other].filter((r, i) => !state.slots[other][i]);
  if (!mine.length || !open.length) return [];
  const myWr = (th) => (me === 'blue' ? evaluate(mine, th).wr : 100 - evaluate(th, mine).wr);
  const base = myWr(theirs);
  const avail = pool(), cand = {};
  for (const r of open) cand[r] = avail.map((c) => withComfort(c, other, r)).filter((c) => c.roles.includes(r) && !c.offmeta);
  const pred = predictPicks(open, cand, rolePlayers(other));
  const out = new Map();
  for (const [r, list] of Object.entries(pred)) for (const x of list) {
    const loss = base - myWr([...theirs, x.c]);
    const a = champArch(x.c), rr = want ? Math.max(0, rel(a, want)) : 0;
    const score = (Math.max(0, loss) + 1.5 * rr) * (0.45 + Math.sqrt(x.p));
    if (score <= 0) continue;
    const cur = out.get(x.c.id);
    if (!cur || cur.score < score) out.set(x.c.id, { c: x.c, score, loss: +loss.toFixed(1), arch: a, counter: rr,
      why: `${ROLE_LABEL[r]} · ${Math.round(x.p * 100)} % de chance de pick (${x.why === 'méta' ? 'méta du rôle' : x.why})` });
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}

function renderBanPlan() {
  const me = state.mySide, other = me === 'blue' ? 'red' : 'blue';
  // Bans conseillés uniquement en « draft depuis des joueurs », quand on connaît les pools adverses.
  const on = state.flow === 'players' && rolePlayers(other).length > 0;
  $('bansCard').hidden = !on;
  if (!on) return;
  const w = wantedArch();
  $('wantArch').innerHTML = `<span class="want-l">Compo que tu veux jouer :</span>` +
    [null, ...ORDER].map((k) => `<button class="chip ${state.wantArch === k ? 'on' : ''}" data-k="${k ?? ''}" ${k ? `style="border-color:${ARCH[k].color}"` : ''}>${k ? ARCH[k].label : `Auto${w.auto && w.k ? ` (${ARCH[w.k].label})` : ''}`}</button>`).join('') +
    (w.auto && w.k ? `<span class="muted">détectée d’après ${w.from}</span>` : '');
  $('wantArch').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { state.wantArch = b.dataset.k || null; savePrefs(); render(); }));
  $('banFor').textContent = 'ciblés sur les champions joués par leurs joueurs (op.gg), selon la compo que tu veux jouer';
  const picks = state.slots.blue.filter(Boolean).length + state.slots.red.filter(Boolean).length;
  const list = banList(w.k);
  // Frise de l'ordre de draft : tes étapes sont marquées, la prochaine est en surbrillance
  const nextBan = target();
  $('banOrder').innerHTML = DRAFT_ORDER.map((g) => {
    const groups = [];
    for (const st of g.steps) { const side = st[0].replace('Bans', ''); const last = groups[groups.length - 1]; if (!g.ban && last && last.side === side) last.steps.push(st); else groups.push({ side, steps: [st] }); }
    return `<div class="do-g ${g.ban ? 'isban' : 'ispick'}"><span class="do-ph">${g.ph}</span><div class="do-row">${groups.map((gr) => `<span class="do-grp ${gr.side} ${gr.side === me ? 'me' : ''}">${gr.steps.map(([t, i]) => {
      const id = state.slots[t][i], cur = nextBan && nextBan[0] === t && nextBan[1] === i;
      const lab = g.ban ? `${gr.side === 'blue' ? 'B' : 'R'}·${BAN_NO[gr.side][i]}` : `${gr.side === 'blue' ? 'B' : 'R'}${i + 1}`;
      return `<i class="do-s ${id ? 'done' : ''} ${cur ? 'cur' : ''}" title="${g.ban ? `${BAN_NO[gr.side][i]}e ban` : `Pick ${lab}`} — ${gr.side === 'blue' ? 'bleu' : 'rouge'}${gr.side === me ? ' (toi)' : ''}">${id === NO_BAN ? '∅' : id ? `<img src="${img(id)}">` : lab}</i>`;
    }).join('')}</span>`).join('<b class="do-sep">/</b>')}</div></div>`;
  }).join('<span class="do-arrow">→</span>');
  const enemyFirst = other === 'blue' ? 'B1 / B2 B3' : 'R1 R2 / R3', enemyLast = other === 'blue' ? 'B4 B5' : 'R4 / R5';
  const myP1 = BAN_NO[me].slice(0, 3).map((n) => n + 'e').join(', '), myP2 = BAN_NO[me].slice(3).map((n) => n + 'e').join(', ');
  const myBans = state.slots[`${me}Bans`];
  const done = (from, to) => myBans.slice(from, to).filter(Boolean);
  const slots = (from, to) => `<div class="bp-slots">${myBans.slice(from, to).map((id) => (id && id !== NO_BAN ? `<img src="${img(id)}" title="${state.P[id].name}">` : '<span></span>')).join('')}</div>`;
  const col = (title, sub, state_, body, from, to) => `<div class="bp-col ${state_}"><div class="bp-h"><b>${title}</b><em>${sub}</em>${slots(from, to)}</div>${body}</div>`;
  const rows = (n, skip = 0) => (list.length ? list.slice(skip, skip + n).map((x) => banRow(x, w.k)).join('') : '<p class="muted">Plus rien à bannir : leur équipe est complète.</p>');
  // Les bans de base restent proposés tant que tes slots ne sont pas remplis, même si tu as pické avant de bannir.
  const left1 = 3 - done(0, 3).length, left2 = 2 - done(3, 5).length;
  const p1 = left1 > 0
    ? col('Phase 1', `${picks === 0 ? 'maintenant' : `${left1} à faire`} · tes bans : ${myP1} · visent leurs picks ${enemyFirst}`, 'now', rows(left1 + 2), 0, 3)
    : col('Phase 1', 'faite', 'past', '<p class="muted">Tes 3 bans de phase 1 sont posés.</p>', 0, 3);
  const p2state = left2 <= 0 || picks >= 10 ? 'past' : picks >= 6 ? 'now' : 'next';
  const p2 = col('Phase 2', p2state === 'past' ? 'faite' : `${p2state === 'now' ? 'maintenant' : 'aperçu, se précise après R3'} · tes bans : ${myP2} · visent leurs picks ${enemyLast}`, p2state,
    // aperçu : on suppose que tes bans de phase 1 partent sur les premiers conseils, pour ne pas les proposer deux fois
    p2state === 'past' ? '<p class="muted">Phase 2 terminée.</p>' : rows(left2 + 1, p2state === 'next' && left1 > 0 ? left1 + 2 : 0), 3, 5);
  // Ta compo est déjà (en partie) pickée : bans qui la protègent le mieux
  const cb = compBans(w.k);
  const mineIds = state.slots[me].filter(Boolean);
  const p3 = mineIds.length && cb.length ? `<div class="bp-col bp-comp now"><div class="bp-h"><b>Contre ta compo</b>
      <span class="bp-team">${mineIds.map((id) => `<img src="${img(id)}" title="${state.P[id].name}">`).join('')}</span>
      <em>les champions de leurs pools qui la gênent le plus</em></div>
      <div class="bp-list">${cb.slice(0, 6).map((x) => banRow({ ...x, why: x.why + (x.loss > 0 ? ` <span class="bp-loss">−${x.loss} % pour toi s’ils le prennent</span>` : '') }, w.k)).join('')}</div></div>` : '';
  $('banPlan').innerHTML = p3 + p1 + p2;
  $('banPlan').querySelectorAll('.bp-r').forEach((b) => (b.onclick = () => {
    const ph2 = picks >= 6 || myBans.slice(0, 3).every(Boolean);
    let j = myBans.findIndex((id, i) => !id && (ph2 ? i >= 3 : i < 3));
    if (j < 0) j = myBans.findIndex((id) => !id);
    if (j < 0) { toast('Tes 5 bans sont déjà remplis (clic droit sur un ban pour le retirer)'); return; }
    myBans[j] = b.dataset.id; render(); toast(`${state.P[b.dataset.id].name} banni`);
  }));
}

// ---------- Menu de départ ----------
// Fond du menu : parallaxe à la souris, portraits flottants et particules
let stAnim = null;
function fillPortraits() {
  const pf = $('stPortraits');
  if (state.list.length && !pf.childElementCount) {
    const pick = [...state.list].sort(() => Math.random() - 0.5).slice(0, 16);
    pf.innerHTML = pick.map((c, i) => {
      const x = (i % 8) * 12.5 + 3 + Math.random() * 5, y = i < 8 ? 6 + Math.random() * 14 : 72 + Math.random() * 14;
      return `<img src="${img(c.id)}" style="left:${x}%;top:${y}%;--d:${(Math.random() * 6).toFixed(1)}s;--s:${(0.8 + Math.random() * 0.6).toFixed(2)}" alt="">`;
    }).join('');
  }
}
let stFit = false;
function startBackground() {
  const root = $('startMenu');
  fillPortraits();
  root.onmousemove = (e) => {
    root.style.setProperty('--mx', ((e.clientX / innerWidth) - 0.5).toFixed(3));
    root.style.setProperty('--my', ((e.clientY / innerHeight) - 0.5).toFixed(3));
  };
  const cv = $('stParticles'), ctx = cv.getContext('2d');
  const fit = () => { cv.width = innerWidth; cv.height = innerHeight; };
  fit(); if (!stFit) { addEventListener('resize', fit); stFit = true; }
  const parts = Array.from({ length: 70 }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: 0.6 + Math.random() * 2, v: 0.15 + Math.random() * 0.5, a: Math.random() }));
  cancelAnimationFrame(stAnim);
  const tick = () => {
    if (root.hidden) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const gold = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#9a7a3c';
    for (const p of parts) {
      p.y -= p.v; p.x += Math.sin((p.y + p.a * 100) / 60) * 0.3;
      if (p.y < -5) { p.y = cv.height + 5; p.x = Math.random() * cv.width; }
      ctx.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(p.y / 80 + p.a * 6));
      ctx.fillStyle = gold; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
    stAnim = requestAnimationFrame(tick);
  };
  tick();
  // survol d'une carte : la carte du fond s'éclaire du côté correspondant
  // survol d'un choix : la carte du fond se remplit de la couleur de ce choix
  const HOV = { startZero: 'zero', startPlayers: 'players', startLive: 'live', startShot: 'shot', startBalance: 'players' };
  for (const [id, k] of Object.entries(HOV)) { $(id).onmouseenter = () => { root.dataset.hover = k; }; $(id).onmouseleave = () => delete root.dataset.hover; }
}
function openMenu() {
  if (LIVE.on) stopLiveMode();
  $('startMenu').hidden = false;
  $('startMenu').classList.remove('leaving', 'form');
  if ($('startModeBox')) $('startModeBox').hidden = true;
  try { window.scrollTo(0, 0); document.getElementById('appview')?.scrollTo(0, 0); } catch {}
  startBackground();
  $('startForm').hidden = true; $('startChoices').hidden = false; $('balanceBox').hidden = true;
  $('menuBlue').value = state.teamInput.blue ?? ''; $('menuRed').value = state.teamInput.red ?? '';
  $('menuSide').value = state.mySide; $('menuRegion').value = state.region;
  renderMenuSaves();
}
// liste des drafts sauvegardées du menu (re-dessinée quand les données arrivent : sinon les portraits restent vides)
function renderMenuSaves() {
  const saves = readSaves();
  const f = state.fearless;
  const resume = f?.on && f.games.some((g) => g && flPicks(g).length) ? `<button class="ms-fl" id="menuFlResume">⚔ Reprendre la série Fearless Bo${f.bo} · game ${f.cur + 1}</button>` : '';
  const mini = (ids) => (ids ?? []).map((id) => (id && id !== NO_BAN && img(id) ? `<img src="${img(id)}" alt="" title="${state.P[id]?.name ?? id}">` : '<span></span>')).join('');
  $('menuSaves').innerHTML = saves.length ? `<details class="ms-list"><summary>📂 Reprendre une draft sauvegardée <span>(${saves.length})</span></summary>
    <div class="ms-rows">${saves.map((d) => `<button class="msave" data-id="${d.id}">
      <span class="ms-n"><b>${d.name.replace(/</g, '&lt;')}</b><small>${new Date(d.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</small></span>
      <span class="ms-p b">${mini(d.slots?.blue)}</span><em>vs</em><span class="ms-p r">${mini(d.slots?.red)}</span></button>`).join('')}</div></details>` : '';
  $('menuSaves').insertAdjacentHTML('afterbegin', resume);
  if ($('menuFlResume')) $('menuFlResume').onclick = () => { state.fromShot = false; if (f.flow) state.flow = f.flow; render(); closeMenu(); };
  $('menuSaves').querySelectorAll('.msave').forEach((b) => (b.onclick = () => { loadDraft(+b.dataset.id); closeMenu(); }));
}
const closeMenu = () => {
  const m = $('startMenu');
  if (m.hidden) return;
  m.classList.add('leaving');
  setTimeout(() => { m.hidden = true; m.classList.remove('leaving'); }, 420);
};
function renderFearless() {
  const f = state.fearless, el = $('flBar');
  const on = !!f?.on && flAllowed();
  $('flToggle').hidden = !on;
  if (on) $('flToggle').textContent = `⚔ Fearless Bo${f.bo} · Game ${f.cur + 1}`;
  el.hidden = !on;
  document.body.classList.toggle('fearless', on);
  if (!on) return;
  if (flRestored) { f.games[f.cur] = flSnap(); saveFearless(); } // mémoire : la game affichée est enregistrée à chaque changement
  const tab = (k) => {
    const g = f.games[k], picks = k === f.cur ? flPicks(f.games[k]) : flPicks(g);
    const reach = k <= f.games.length && (k === 0 || flPicks(f.games[k - 1]).length > 0 || f.games[k]); // on avance game par game
    return `<button class="fl-tab ${k === f.cur ? 'cur' : ''} ${picks.length ? 'played' : ''}" data-k="${k}" ${reach ? '' : 'disabled'} title="${reach ? `Game ${k + 1}${picks.length ? ` : ${picks.length} champions joués` : ''}` : 'Joue d’abord la game précédente'}">
      <em>G${k + 1}</em>${picks.length ? `<span class="fl-ic">${picks.slice(0, 10).map((id) => `<img src="${img(id)}" alt="" title="${state.P[id]?.name ?? id}">`).join('')}</span>` : `<span class="fl-empty">${k === f.cur ? 'en cours' : reach ? 'à jouer' : '—'}</span>`}</button>`;
  };
  el.innerHTML = `<b class="fl-t">⚔ Fearless · Bo${f.bo}</b>
    <div class="fl-tabs">${Array.from({ length: f.bo }, (_, k) => tab(k)).join('')}</div>
    <div class="fl-acts">${f.cur < f.bo - 1 ? '<button id="flNext" class="tb-btn primary" title="Passe à la game suivante (la draft actuelle reste enregistrée)">Game suivante →</button>' : ''}<button id="flEnd" class="tb-btn" title="Termine la série et revient en draft classique">Terminer la série</button></div>`;
  el.querySelectorAll('.fl-tab:not([disabled])').forEach((b) => (b.onclick = () => flGo(+b.dataset.k)));
  if ($('flNext')) $('flNext').onclick = () => {
    if (!flPicks(f.games[f.cur]).length) { toast('Joue au moins un pick dans cette game avant de passer à la suivante'); return; }
    flGo(f.cur + 1);
  };
  $('flEnd').onclick = () => { state.fearless = FL_OFF(); saveFearless(); render(); toast('Série terminée : retour en draft classique'); };
}
// affiche une autre game de la série : la game courante est gardée telle quelle
function flGo(k) {
  const f = state.fearless;
  if (k === f.cur || k < 0 || k >= f.bo) return;
  f.games[f.cur] = flSnap();
  const g = f.games[k];
  f.cur = k;
  if (g) { state.slots = structuredClone(g.slots); state.roles = structuredClone(g.roles); state.lock = structuredClone(g.lock); state.history = structuredClone(g.history ?? []); state.selected = null; render(); }
  else reset();
  saveFearless();
  const n = flLocked().size;
  toast(`Game ${k + 1}${n ? ` : ${n} champions verrouillés (joués dans les autres games)` : ''}`);
}
// Fearless : proposé seulement en « Draft de zéro » et « Draft depuis des joueurs »
const flAllowed = () => !LIVE.on && !state.fromShot && (state.flow === 'zero' || state.flow === 'players');
// mode choisi dans le menu : 'classic', 'fl3' ou 'fl5'
function startSeries(mode) {
  state.fromShot = false;
  state.fearless = mode === 'fl3' || mode === 'fl5' ? { on: true, bo: mode === 'fl3' ? 3 : 5, cur: 0, games: [], flow: state.flow } : FL_OFF();
  saveFearless();
}
function startFromZero(mode = 'classic') {
  startSeries(mode);
  state.players = { blue: [], red: [] }; state.teamInput = { blue: '', red: '' }; state.flow = 'zero';
  $('opggBlue').value = ''; $('opggRed').value = '';
  reset(); closeMenu();
  toast(mode === 'classic' ? 'Draft de zéro : winrate et plan de jeu selon la méta des 30 derniers jours' : `Draft de zéro · Fearless Bo${state.fearless.bo} : game 1`);
}
// ---------- Équilibrer des équipes (in house) ----------
const BAL_KEY = 'draftlab-balance';
const BAL = (() => { try { return { players: [], swap: false, ...JSON.parse(localStorage.getItem(BAL_KEY)), sols: [], k: 0 }; } catch { return { players: [], sols: [], k: 0, swap: false }; } })();
const balSave = () => { try { localStorage.setItem(BAL_KEY, JSON.stringify({ input: $('balInput').value, region: $('balRegion').value, players: BAL.players })); } catch {} };
const RL = { T: 'Top', J: 'Jungle', M: 'Mid', A: 'ADC', S: 'Support', FILL: 'Fill' };
// Elo de chaque joueur, toujours déterminé automatiquement : Solo/Duo actuel, sinon saison passée,
// sinon Flex (un peu décoté, la Flex est plus facile), sinon la moyenne des autres joueurs du groupe.
function balElo(p) {
  const r = p.rank;
  if (r?.tier) return { pts: rankPoints(r), src: 'Solo/Duo' };
  if (r?.prevTier) return { pts: rankPoints(r), src: 'Solo/Duo saison passée' };
  if (r?.flex?.tier) return { pts: Math.max(0, rankPoints(r.flex) - 100), src: 'estimé depuis la Flex' };
  const others = BAL.players.filter((x) => x !== p && (x.rank?.tier || x.rank?.prevTier || x.rank?.flex?.tier)).map((x) => balElo(x).pts);
  return { pts: others.length ? others.reduce((a, x) => a + x, 0) / others.length : 1600, src: 'pas classé : moyenne du groupe', guess: true };
}
const balPts = (p) => balElo(p).pts;
const balLabel = (p) => { const e = balElo(p), n = p.rank?.tier || p.rank?.prevTier ? rankName(p.rank) : null; return { ...e, label: n ? n.label : pointsLabel(e.pts), color: n ? rankColor(p.rank) : tierColor(e.pts) }; };
function openBalance() {
  $('startMenu').classList.add('form'); $('startChoices').hidden = true; $('balanceBox').hidden = false;
  if (BAL.input != null && !$('balInput').value) $('balInput').value = BAL.input;
  if (BAL.region) $('balRegion').value = BAL.region; else $('balRegion').value = state.region;
  $('balStep1').hidden = false; $('balStep2').hidden = true;
  renderBalList();
}
function closeBalance() { $('balanceBox').hidden = true; $('startChoices').hidden = false; $('startMenu').classList.remove('form'); }
async function balSearch() {
  const raw = $('balInput').value.trim();
  if (!raw) { toast('Entre les pseudos des 10 joueurs'); return; }
  if (!api.loadPlayers) { toast('Disponible uniquement dans l’application'); return; }
  const btn = $('balSearch'); btn.disabled = true; btn.textContent = 'Recherche sur op.gg…';
  try {
    const res = await api.loadPlayers({ input: raw, region: $('balRegion').value });
    if (res.error) throw new Error(res.error);
    // on garde les réglages déjà faits à la main pour un joueur déjà présent
    const prev = new Map(BAL.players.map((p) => [p.key, p]));
    BAL.players = res.players.map((p) => {
      const key = (p.riotId ?? '').toLowerCase().replace(/\s+/g, '');
      const auto = rolesFromPool(p.all ?? p.pool, state.data?.stats);
      const old = prev.get(key);
      return {
        key, riotId: p.riotId, error: p.error ?? null, rank: p.rank ?? null, top: (p.pool ?? []).slice(0, 3).map((c) => c.id),
        auto, main: old?.edited ? old.main : auto?.main ?? 'FILL', second: old?.edited ? old.second : auto?.second ?? 'FILL', third: old?.edited ? old.third ?? auto?.third ?? 'FILL' : auto?.third ?? 'FILL',
        edited: old?.edited ?? false
      };
    });
    balSave(); renderBalList();
  } catch (e) { toast(`op.gg : ${e.message}`); }
  btn.disabled = false; btn.textContent = 'Rechercher sur op.gg';
}
function renderBalList() {
  const L = $('balList'), n = BAL.players.length;
  $('balCount').textContent = n ? `${n}/10 joueurs` : '';
  const ok = n === 10;
  $('balGo').disabled = !ok;
  $('balGo').title = ok ? '' : 'Il faut exactement 10 joueurs';
  const roleSel = (p, f) => `<select data-f="${f}">${[...BAL_ROLES, 'FILL'].map((r) => `<option value="${r}" ${(p[f] ?? p.auto?.[f] ?? 'FILL') === r ? 'selected' : ''}>${RL[r]}</option>`).join('')}</select>`;
  L.innerHTML = BAL.players.map((p, i) => {
    const e = balLabel(p);
    const rk = `<span class="bal-rk ${e.src === 'Solo/Duo' ? '' : 'est'}" style="--c:${e.color}" title="${e.src}">${e.src === 'Solo/Duo' ? '' : '≈ '}${e.label}${p.rank?.tier && p.rank.lp != null ? ` <small>${p.rank.lp} LP</small>` : ` <small>${e.src === 'Solo/Duo' ? '' : e.src.replace('Solo/Duo ', '')}</small>`}</span>`;
    const pc = p.auto?.pct ? Object.entries(p.auto.pct).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 5).slice(0, 3).map(([r, v]) => `${RL[r]} ${v} %`).join(' · ') : '';
    return `<div class="bal-row ${p.error ? 'err' : ''}" data-i="${i}">
      <span class="bal-n">${i + 1}</span>
      <span class="bal-id"><b>${p.riotId ?? '?'}</b><small>${p.error ? `⚠ ${p.error}` : pc ? `op.gg : ${pc}` : 'rôles inconnus'}</small></span>
      <span class="bal-ch">${p.top.map((id) => `<img src="${img(id)}" alt="">`).join('')}</span>
      ${rk}
      <label class="bal-r">Rôle 1 ${roleSel(p, 'main')}</label>
      <label class="bal-r">Rôle 2 ${roleSel(p, 'second')}</label>
      <label class="bal-r">Rôle 3 ${roleSel(p, 'third')}</label>
      <button class="bal-x" title="Retirer ce joueur">✕</button></div>`;
  }).join('') || '<p class="muted bal-empty">Entre les 10 pseudos puis lance la recherche : l’elo et les rôles de chacun sont récupérés automatiquement.</p>';
  L.querySelectorAll('.bal-row').forEach((row) => {
    const p = BAL.players[+row.dataset.i];
    row.querySelectorAll('select').forEach((sel) => (sel.onchange = () => {
      const f = sel.dataset.f;
      p[f] = sel.value; p.edited = true;
      balSave(); renderBalList();
    }));
    row.querySelector('.bal-x').onclick = () => { BAL.players.splice(+row.dataset.i, 1); balSave(); renderBalList(); };
  });
}
function balRun() {
  const ps = BAL.players;
  const input = ps.map((p) => ({ value: balValue(balPts(p)), main: p.main, second: p.second, third: p.third ?? p.auto?.third ?? 'FILL', wins: p.rank?.wins, losses: p.rank?.losses, hot: p.rank?.hot }));
  BAL.sols = balanceTeams(input); BAL.k = 0; BAL.swap = false;
  if (!BAL.sols.length) { toast('Il faut exactement 10 joueurs'); return; }
  $('balStep1').hidden = true; $('balStep2').hidden = false;
  renderBalResult();
}
function renderBalResult() {
  const sol = BAL.sols[BAL.k]; if (!sol) return;
  const [b, r, vb, vr] = BAL.swap ? [sol.red, sol.blue, sol.vRed, sol.vBlue] : [sol.blue, sol.red, sol.vBlue, sol.vRed];
  const wr = BAL.swap ? 100 - sol.wr : sol.wr;
  const avg = (v) => v.reduce((a, x) => a + x, 0) / 5;
  const unval = (v) => (v > 2800 ? 2800 + (v - 2800) * 2 : v); // LP au-dessus de Master : comptés à moitié dans le calcul
  const FIT = { main: ['①', 'rôle 1'], second: ['②', 'rôle 2'], third: ['③', 'rôle 3'], fill: ['②', 'fill'], off: ['⚠', 'hors de ses 3 rôles'] };
  const cell = (pi, ri, v, side) => {
    const p = BAL.players[pi], fit = roleFit({ ...p, third: p.third ?? p.auto?.third ?? 'FILL' }, BAL_ROLES[ri]), e = balLabel(p);
    return `<div class="bal-p ${side} ${fit}"><span class="bal-fit" title="${FIT[fit][1]}">${FIT[fit][0]}</span><b>${p.riotId}</b><span class="bal-rk" style="--c:${e.color}" title="${e.src}">${e.src === 'Solo/Duo' ? '' : '≈ '}${e.label}</span></div>`;
  };
  const rows = BAL_ROLES.map((role, ri) => {
    const d = vb[ri] - vr[ri];
    return `<div class="bal-lane">${cell(b[ri], ri, vb[ri], 'blue')}<div class="bal-mid"><span>${RL[role]}</span><i class="${Math.abs(d) < 150 ? 'eq' : d > 0 ? 'b' : 'r'}" title="Écart de niveau à cette lane (rôle compris)">${Math.abs(d) < 150 ? '≈' : `${d > 0 ? '◀' : ''} ${(Math.round(Math.abs(d) / 10) / 10).toLocaleString('fr-FR')} div. ${d < 0 ? '▶' : ''}`}</i></div>${cell(r[ri], ri, vr[ri], 'red')}</div>`;
  }).join('');
  const fits = [...b, ...r].map((pi, k) => { const p = BAL.players[pi]; return roleFit({ ...p, third: p.third ?? p.auto?.third ?? 'FILL' }, BAL_ROLES[k % 5]); });
  const nMain = fits.filter((f) => f === 'main').length, nOff = fits.filter((f) => f === 'off').length;
  $('balResult').innerHTML = `
    <div class="bal-top">
      <div class="bal-t blue"><span>Équipe 1 · bleu</span><b>${pointsLabel(unval(avg(vb)))}</b></div>
      <div class="bal-wr"><b>${wr.toFixed(0)} %</b><div class="bal-bar"><i style="width:${wr}%"></i></div><small>${Math.abs(wr - 50) < 1.5 ? 'Équipes équilibrées' : wr > 50 ? 'Léger avantage équipe 1' : 'Léger avantage équipe 2'}</small></div>
      <div class="bal-t red"><span>Équipe 2 · rouge</span><b>${pointsLabel(unval(avg(vr)))}</b></div>
    </div>
    <div class="bal-lanes">${rows}</div>
    <p class="muted bal-sum">Répartition ${BAL.k + 1}/${BAL.sols.length} · ${nMain}/10 à leur rôle 1${nOff ? ` · ${nOff} hors de ses 3 rôles` : ''}</p>`;
  $('balNext').textContent = BAL.sols.length > 1 ? `Autre répartition (${(BAL.k + 1) % BAL.sols.length + 1}/${BAL.sols.length})` : 'Autre répartition';
}
function balDraft() {
  const sol = BAL.sols[BAL.k]; if (!sol) return;
  const [b, r] = BAL.swap ? [sol.red, sol.blue] : [sol.blue, sol.red];
  const ids = (t) => t.map((pi) => BAL.players[pi].riotId).join(', ');
  $('menuBlue').value = ids(b); $('menuRed').value = ids(r); $('menuRegion').value = $('balRegion').value;
  $('balanceBox').hidden = true; $('startForm').hidden = false;
  toast('Équipes prêtes : choisis ton côté puis lance la draft');
}
function initBalance() {
  $('startBalance').onclick = openBalance;
  $('balBack').onclick = closeBalance;
  $('balSearch').onclick = balSearch;
  $('balInput').onchange = balSave;
  $('balGo').onclick = balRun;
  $('balEdit').onclick = () => { $('balStep1').hidden = false; $('balStep2').hidden = true; };
  $('balNext').onclick = () => { BAL.k = (BAL.k + 1) % BAL.sols.length; renderBalResult(); };
  $('balSwap').onclick = () => { BAL.swap = !BAL.swap; renderBalResult(); };
  $('balDraft').onclick = balDraft;
}

async function startFromPlayers() {
  const blue = $('menuBlue').value.trim(), red = $('menuRed').value.trim();
  if (!blue && !red) { toast('Colle au moins un lien multi op.gg'); return; }
  state.region = $('menuRegion').value; $('region').value = state.region;
  state.mySide = $('menuSide').value; $('mySide').value = state.mySide;
  savePrefs();
  $('opggBlue').value = blue; $('opggRed').value = red;
  state.flow = 'players';
  startSeries(document.querySelector('#menuMode .on')?.dataset.mode ?? 'classic');
  reset();
  const go = $('menuGo'); go.disabled = true; go.textContent = 'Chargement des joueurs…';
  await Promise.all([loadTeam('blue'), loadTeam('red')]);
  go.disabled = false; go.textContent = 'Lancer la draft';
  $('playersBox').open = true;
  closeMenu();
}

// ---------- Partie en direct (soloQ) ----------
const LIVE = { on: false, sig: '', conn: null, loaded: { blue: '', red: '' }, game: null, lastId: null, wasSelect: false };
// Historique des parties en direct (sur cet ordinateur)
const HIST_KEY = 'draftlab-live-history';
const readHist = () => { try { return JSON.parse(localStorage.getItem(HIST_KEY)) ?? []; } catch { return []; } };
const writeHist = (h) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 40))); } catch {} };
function histUpsert(entry) { const h = readHist(), k = h.findIndex((x) => x.id === entry.id); if (k >= 0) h[k] = { ...h[k], ...entry }; else h.unshift(entry); writeHist(h); renderHistory(); }
// photo de la partie en cours : draft, joueurs, mode, pronostic au moment de la partie
function liveSnapshot(d) {
  const me = d.mySide, myRow = (d.teams?.[me] ?? []).find((m) => m.me) ?? (d.summoner ? (d.teams?.[me] ?? []).find((m) => m.riotId && m.riotId === d.summoner) : null);
  const myId = myRow ? (myRow.champKey ? champByName(myRow.champKey) ?? champByName(myRow.champName) : champByKey(myRow.champ)) : null;
  const wr = state.lastMain != null ? (me === 'blue' ? state.lastMain : 100 - state.lastMain) : null;
  return { id: LIVE.game?.id ?? Date.now(), date: LIVE.game?.date ?? Date.now(), queue: d.queue?.label ?? null, mySide: me, summoner: d.summoner ?? null, myChamp: myId,
    wr: wr != null ? +wr.toFixed(1) : null, slots: structuredClone(state.slots), roles: structuredClone(state.roles), lock: structuredClone(state.lock),
    players: structuredClone(state.players), result: LIVE.game?.result ?? null, gameId: d.gameId ?? d.queue?.gameId ?? LIVE.game?.gameId ?? null };
}
// la partie (ou la sélection) est finie : on archive et on nettoie l'écran
function liveEndGame(d) {
  if (LIVE.game) {
    histUpsert({ ...LIVE.game, result: d.result ?? LIVE.game.result ?? null, gameId: LIVE.game.gameId ?? d.gameId ?? null });
    LIVE.lastId = LIVE.game.id;
    toast(d.result ? `Partie terminée : ${d.result === 'win' ? 'victoire ✓' : 'défaite'} · ajoutée à l’historique` : 'Partie terminée : ajoutée à l’historique');
  }
  LIVE.game = null; LIVE.wasSelect = false; LIVE.sig = ''; LIVE.loaded = { blue: '', red: '' };
  state.players = { blue: [], red: [] };
  $('liveReco').hidden = true;
  reset();
}
// Sessions : parties jouées à moins de 2 h d'écart
const SESSION_GAP = 2 * 3600 * 1000;
function histSessions(h) {
  const games = [...h].sort((a, b) => a.date - b.date), out = [];
  for (const g of games) { const last = out[out.length - 1]; if (last && g.date - last.end < SESSION_GAP) { last.games.push(g); last.end = g.date; } else out.push({ start: g.date, end: g.date, games: [g] }); }
  return out.reverse().map((s) => ({ ...s, games: s.games.reverse() }));
}
function renderHistory() {
  const h = readHist(), box = $('histBox');
  if (!box) return;
  box.hidden = !h.length;
  $('histCount').textContent = h.length ? `(${h.length})` : '';
  if (!h.length) { $('histList').innerHTML = ''; return; }
  const day = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const mini = (ids) => (ids ?? []).map((id) => (id && state.P[id] ? `<img src="${img(id)}" alt="" title="${state.P[id].name}">` : '<i></i>')).join('');
  $('histList').innerHTML = histSessions(h).map((s, si) => {
    const w = s.games.filter((g) => g.result === 'win').length, l = s.games.filter((g) => g.result === 'loss').length, u = s.games.length - w - l;
    const wrs = s.games.filter((g) => g.wr != null), avg = wrs.length ? Math.round(wrs.reduce((a, g) => a + g.wr, 0) / wrs.length) : null;
    // le pronostic avait-il raison ? (favori = pronostic > 50 %)
    const judged = s.games.filter((g) => g.result && g.wr != null && Math.abs(g.wr - 50) >= 1), right = judged.filter((g) => (g.wr > 50) === (g.result === 'win')).length;
    return `<div class="hs"><div class="hs-h"><b>Session du ${day(s.start)}</b><span>${hm(s.start)}${s.games.length > 1 ? ` – ${hm(s.end)}` : ''} · ${s.games.length} partie${s.games.length > 1 ? 's' : ''}</span>
        <span class="hs-rec"><em class="w">${w} V</em> <em class="l">${l} D</em>${u ? ` <em class="u" title="Résultat inconnu : client fermé avant la fin. Il sera retrouvé automatiquement à la prochaine connexion au client si possible.">${u} ?</em>` : ''}</span>${avg != null ? `<span class="muted">pronostic moyen ${avg} %</span>` : ''}${judged.length ? `<span class="muted">pronostic juste ${right}/${judged.length}</span>` : ''}
        ${si === 0 ? '' : ''}</div>
      ${s.games.map((g) => { const mine = g.slots?.[g.mySide] ?? [], theirs = g.slots?.[g.mySide === 'blue' ? 'red' : 'blue'] ?? [];
        return `<div class="hg ${g.result ?? ''}"><span class="hg-t">${hm(g.date)}</span><span class="hg-q">${g.queue ?? 'Partie'}</span>
          ${g.myChamp && state.P[g.myChamp] ? `<img class="hg-me" src="${img(g.myChamp)}" title="Ton champion : ${state.P[g.myChamp].name}" alt="">` : '<span class="hg-me"></span>'}
          <span class="hg-tm b">${mini(mine)}</span><em>vs</em><span class="hg-tm r">${mini(theirs)}</span>
          <span class="hg-wr" title="Pronostic de Draft Lab pour ton équipe au début de la partie">${g.wr != null ? `${g.wr.toFixed(1)} %` : '—'}</span>
          <span class="hg-res" ${g.recovered ? 'title="Résultat retrouvé dans l’historique de matchs du client"' : !g.result ? 'title="Client fermé avant la fin : le résultat sera cherché à la prochaine connexion"' : ''}>${g.result === 'win' ? 'Victoire' : g.result === 'loss' ? 'Défaite' : 'Résultat inconnu'}${g.recovered ? ' ↻' : ''}</span>
          <button class="hg-open" data-id="${g.id}" title="Ouvrir cette partie dans la draft">Revoir</button><button class="hg-del" data-id="${g.id}" title="Retirer de l’historique">×</button></div>`; }).join('')}</div>`;
  }).join('') + '<div class="hs-foot"><button id="histClear" class="tb-btn">Effacer l’historique</button></div>';
  $('histList').querySelectorAll('.hg-open').forEach((b) => (b.onclick = () => openHistGame(+b.dataset.id)));
  $('histList').querySelectorAll('.hg-del').forEach((b) => (b.onclick = () => { writeHist(readHist().filter((x) => x.id !== +b.dataset.id)); renderHistory(); }));
  $('histClear').onclick = (e) => { if (!e.currentTarget.dataset.ok) { e.currentTarget.dataset.ok = '1'; e.currentTarget.textContent = 'Confirmer : tout effacer'; return; } writeHist([]); renderHistory(); toast('Historique effacé'); };
}
// revoir une partie : elle s'ouvre dans la draft (le direct s'arrête)
function openHistGame(id) {
  const g = readHist().find((x) => x.id === id); if (!g) return;
  if (LIVE.on) stopLiveMode();
  state.fromShot = true; // pas de série Fearless sur une partie passée
  Object.assign(state, { mySide: g.mySide, slots: structuredClone(g.slots), roles: structuredClone(g.roles), lock: structuredClone(g.lock ?? { blue: Array(5).fill(null), red: Array(5).fill(null) }), history: [], selected: null,
    players: structuredClone(g.players ?? { blue: [], red: [] }), flow: (g.players?.blue?.length || g.players?.red?.length) ? 'players' : 'zero' });
  $('mySide').value = state.mySide; closeMenu(); render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(`Partie du ${new Date(g.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${g.result ? ` · ${g.result === 'win' ? 'victoire' : 'défaite'}` : ''}`);
}
const champByKey = (k) => (k == null ? null : state.list.find((c) => String(c.key) === String(k))?.id ?? null);
const champByName = (n) => (n ? state.P[n]?.id ?? findChamp(n)?.id ?? null : null);
const LIVE_TXT = { NoClient: ['En attente', 'Lance League of Legends sur cet ordinateur.'], None: ['Prêt', 'En attente de la sélection des champions.'], Lobby: ['Dans le salon', 'Lance la recherche : la draft s’affichera à la sélection des champions.'], Matchmaking: ['Recherche de partie', 'La draft s’affichera dès la sélection des champions.'], ReadyCheck: ['Partie trouvée', 'Accepte la partie.'], ChampSelect: ['Sélection des champions en direct', 'Picks, bans et lanes mis à jour en temps réel.'], InProgress: ['Partie en cours', 'Les 10 joueurs viennent du jeu ; op.gg chargé pour les joueurs visibles.'], Error: ['Direct indisponible', ''], PreEndOfGame: ['Partie terminée', 'Résultat enregistré dans l’historique.'], EndOfGame: ['Partie terminée', 'Résultat enregistré dans l’historique. Relance une file pour la suivante.'], WaitingForStats: ['Partie terminée', 'En attente des statistiques de fin de partie…'] };
function startLiveMode() {
  if (!api.liveStart) { toast('Disponible uniquement dans l’application'); return; }
  state.players = { blue: [], red: [] }; state.teamInput = { blue: '', red: '' }; state.flow = 'players';
  LIVE.on = true; LIVE.sig = ''; LIVE.conn = null; $('liveBar').dataset.conn = ''; $('liveConnTxt').textContent = 'Recherche du client…'; LIVE.loaded = { blue: '', red: '' };
  reset(); closeMenu();
  $('liveBar').hidden = false; $('liveTitle').textContent = 'Connexion au client…'; $('liveText').textContent = '';
  api.liveStart();
}
function stopLiveMode() { LIVE.on = false; api.liveStop?.(); $('liveBar').hidden = true; $('liveReco').hidden = true; $('liveMode').hidden = true; document.body.classList.remove('q-flex'); render(); }
function onLive(d) {
  if (!LIVE.on) return;
  const [t, sub] = LIVE_TXT[d.phase] ?? ['Client connecté', d.phase];
  $('liveTitle').textContent = t; $('liveText').textContent = d.error ? `${sub} (${d.error})` : sub;
  $('liveBar').dataset.phase = d.phase;
  // état de la connexion au client League, bien visible : non détecté / connecté / en sélection / en jeu
  const conn = d.phase === 'NoClient' ? 'off' : d.phase === 'Error' ? 'err' : d.phase === 'ChampSelect' ? 'select' : d.phase === 'InProgress' ? 'game' : 'on';
  $('liveBar').dataset.conn = conn;
  const who = d.summoner || null;
  $('liveConnTxt').textContent = conn === 'off' ? 'Client League non détecté' : conn === 'err' ? 'Erreur de connexion' : who ? `Connecté · ${who}` : 'Client League connecté';
  $('liveConn').title = conn === 'off' ? 'Aucun client League ouvert sur cet ordinateur' : d.summoner ? `Compte connecté au client : ${d.summoner}` : '';
  if (conn === 'off') $('liveText').textContent = 'Ouvre le client League of Legends (pas seulement le Riot Client) sur cet ordinateur : la détection est automatique, toutes les 2 secondes.';
  if (conn !== LIVE.conn) { if (LIVE.conn === 'off' && conn !== 'err') toast(`Client League détecté ✓${who ? ' — ' + who : ''}`); else if (LIVE.conn && LIVE.conn !== 'off' && conn === 'off') toast('Client League fermé ou déconnecté'); LIVE.conn = conn; }
  // mode de la partie (Solo/Duo, Flex, Normale, Personnalisée…) : la Flex est mise en avant en Flex, la Solo ailleurs
  const qm = $('liveMode');
  if (d.queue?.label) { qm.textContent = d.queue.label; qm.hidden = false; } else if (d.phase === 'NoClient' || d.phase === 'None') qm.hidden = true;
  document.body.classList.toggle('q-flex', d.queue?.id === 440);
  // résultats inconnus (client fermé avant la fin) : on les cherche dans l'historique de matchs du client, au plus 1 fois par minute
  if (conn === 'on' && api.liveResults && Date.now() - (LIVE.lastFix ?? 0) > 60000) {
    const pend = readHist().filter((g) => !g.result && g.gameId && Date.now() - g.date < 7 * 864e5);
    if (pend.length) { LIVE.lastFix = Date.now(); api.liveResults(pend.map((g) => g.gameId)).then((res) => { let n = 0; for (const g of pend) if (res?.[g.gameId]) { histUpsert({ id: g.id, result: res[g.gameId], recovered: true }); n++; } if (n) toast(`${n} résultat${n > 1 ? 's' : ''} retrouvé${n > 1 ? 's' : ''} dans l’historique du client`); }).catch(() => {}); }
  }
  // résultat qui arrive après coup (écran de fin de game) : on complète la dernière partie de l'historique
  if (d.result && !LIVE.game && LIVE.lastId) { const h = readHist().find((x) => x.id === LIVE.lastId); if (h && !h.result) histUpsert({ id: LIVE.lastId, result: d.result }); }
  if (!d.teams) {
    $('liveReco').hidden = true;
    // fin de partie ou sélection annulée : l'écran de la partie ne reste pas affiché
    if (LIVE.game || LIVE.wasSelect) liveEndGame(d);
    return;
  }
  if (d.phase === 'ChampSelect') LIVE.wasSelect = true;
  const sig = JSON.stringify([d.teams, d.bans, d.mySide]);
  if (sig === LIVE.sig) return;
  LIVE.sig = sig;
  state.mySide = d.mySide; $('mySide').value = d.mySide;
  for (const side of ['blue', 'red']) {
    const members = d.teams[side] ?? [];
    const slots = Array(5).fill(null), roles = [...ROLES], lock = Array(5).fill(null);
    const free = () => slots.findIndex((x, k) => !x && !lock[k]);
    // une ligne par lane : chaque joueur va sur la ligne de sa lane quand on la connaît
    for (const m of members) {
      const id = m.champKey ? champByName(m.champKey) ?? champByName(m.champName) : champByKey(m.champ);
      let k = m.role ? ROLES.indexOf(m.role) : -1;
      if (k < 0 || slots[k] || lock[k]) k = free();
      if (k < 0) continue;
      if (m.role) lock[k] = m.role;
      if (id && m.locked !== false) slots[k] = id;
    }
    state.slots[side] = slots; state.roles[side] = roles; state.lock[side] = lock.map((r, k) => (slots[k] && r ? r : null));
    if (members.some((m) => !m.role)) assignRoles(side);
    const bans = (d.bans?.[side] ?? []).map(champByKey).filter(Boolean).slice(0, 5);
    // en jeu, l'API ne donne plus les bans : on garde ceux de la sélection des champions
    if (bans.length || d.phase !== 'InProgress') state.slots[`${side}Bans`] = [...bans, ...Array(5 - bans.length).fill(null)];
    // joueurs : op.gg pour ceux dont le nom est visible, les autres (mode streamer) sont ignorés
    const visible = members.filter((m) => m.riotId);
    const key = visible.map((m) => m.riotId).join(',');
    state.players[side] = members.map((m, k) => {
      const old = state.players[side].find((p) => p.riotId && p.riotId === m.riotId);
      return old ? { ...old, role: m.role ?? old.role } : { riotId: m.riotId ?? '', role: m.role ?? ROLES[k], pool: [], hidden: !m.riotId, error: m.riotId ? null : 'nom masqué (mode streamer) : ignoré' };
    });
    if (key && key !== LIVE.loaded[side] && api.loadTeam) {
      LIVE.loaded[side] = key;
      api.loadTeam({ input: visible.map((m) => m.riotId).join(', '), region: (d.region || state.region || 'euw').toLowerCase() }).then((res) => {
        if (!res || res.error || !LIVE.on) return;
        for (const p of res.players ?? []) {
          const m = visible.find((x) => x.riotId.toLowerCase().replace(/\s/g, '') === String(p.riotId).toLowerCase().replace(/\s/g, ''));
          const k = state.players[side].findIndex((x) => x.riotId && m && x.riotId === m.riotId);
          if (k >= 0) state.players[side][k] = { ...p, role: state.players[side][k].role };
        }
        render();
      }).catch(() => {});
    }
  }
  render();
  liveReco(d);
  if (d.phase === 'InProgress') { LIVE.game = liveSnapshot(d); histUpsert(LIVE.game); }
}
// Pendant la sélection des champions : les meilleures réponses pour TON pick (lane, matchup, compo, ton pool)
function liveReco(d) {
  const box = $('liveReco');
  const side = d.mySide, other = side === 'blue' ? 'red' : 'blue';
  const meM = d.teams?.[side]?.find((m) => m.me);
  if (d.phase !== 'ChampSelect' || !meM || (meM.champ && meM.locked !== false)) { box.hidden = true; return; }
  const mine = team(side), theirs = team(other);
  const free = ROLES.filter((r) => !mine.some((c) => c.lane === r));
  const role = meM.role && free.includes(meM.role) ? meM.role : free[0];
  if (!role) { box.hidden = true; return; }
  const opp = theirs.find((c) => c.lane === role);
  const u = used(), idx = Math.max(0, state.roles[side].indexOf(role));
  const cand = state.list.filter((c) => !u.has(c.id) && (c.roles.includes(role) || flexRoles(c).includes(role)))
    .map((c) => ({ ...withComfort(c, side, role), lane: role, po: pickPos(side, idx) }));
  const [b, r] = side === 'blue' ? [mine, theirs] : [theirs, mine];
  const all = projectPicks(b, r, side, null, cand).map((x) => {
    const le = opp ? laneEdge(x.c, role, opp, role) : null;
    // le matchup direct compte en plus (réponse au champion d'en face), puis la maîtrise du joueur
    return { ...x, le, score: x.wr + (le ? 0.6 * le.edge : 0) + (x.c.comfort > 0 ? 1.2 * x.c.comfort : 0) };
  }).sort((p, q) => q.score - p.score);
  if (!all.length) { box.hidden = true; return; }
  // ton pool (op.gg) : tes champions jouables à cette lane, le meilleur en tête
  const pl = playerFor(side, role) ?? state.players[side].find((p) => p.riotId && d.teams[side].find((m) => m.me)?.riotId === p.riotId);
  const pe = (id) => pl?.pool?.find((e) => e.id === id);
  const mineRows = all.filter((x) => pe(x.c.id)?.games).slice(0, 4);
  const others = all.filter((x) => !mineRows.includes(x)).slice(0, mineRows.length ? 5 : 7);
  const card = (x, best) => { const e = pe(x.c.id); return `<button class="lr-c ${best ? 'best' : ''}" data-id="${x.c.id}" title="${x.c.name} · winrate projeté ${x.wr.toFixed(1)} %${x.le ? ` · face à ${opp.name} : ${x.le.raw > 0 ? '+' : ''}${x.le.raw} pts (${x.le.n} games Master+)` : ''}${e ? ` · toi : ${e.games} games, ${Math.round((e.wins / e.games) * 100)} % de victoires` : ''}">
      <img src="${img(x.c.id)}" alt=""><span class="lr-n">${best ? '<em>Meilleur choix</em>' : ''}${x.c.name}${e ? ' <i>★</i>' : ''}</span>
      <span class="lr-w">${x.wr.toFixed(1)} %${e ? ` <small>· ${e.games} g ${Math.round((e.wins / e.games) * 100)} %</small>` : ''}</span>${x.le ? `<span class="lr-m ${x.le.raw >= 0 ? 'up' : 'down'}">vs ${opp.name} ${x.le.raw > 0 ? '+' : ''}${x.le.raw.toFixed(1)}</span>` : ''}</button>`; };
  box.innerHTML = `<div class="lr-h"><b>À toi de choisir · ${ROLE_LABEL[role]}</b><span class="muted">${opp ? `meilleures réponses face à <b>${opp.name}</b>, avec ta compo et ton pool` : 'leur ' + ROLE_LABEL[role] + ' n’est pas encore choisi : meilleurs picks pour ta compo'}</span></div>
    ${mineRows.length ? `<div class="lr-g"><span class="lr-t">Dans ton pool</span><div class="lr-list">${mineRows.map((x, i) => card(x, i === 0)).join('')}</div></div>` : (pl?.riotId ? '' : '<div class="lr-note muted">Ton pool op.gg n’est pas encore chargé : propositions générales.</div>')}
    <div class="lr-g"><span class="lr-t">${mineRows.length ? 'Autres réponses' : 'Meilleures réponses'}</span><div class="lr-list">${others.map((x) => card(x, false)).join('')}</div></div>`;
  box.hidden = false;
  // clic : essai du pick dans la draft (le client reprend la main au prochain changement)
  box.querySelectorAll('.lr-c').forEach((btn) => (btn.onclick = () => {
    const k = state.roles[side].indexOf(role);
    if (k >= 0 && !state.slots[side][k]) { state.slots[side][k] = btn.dataset.id; state.lock[side][k] = role; render(); toast(`Essai : ${state.P[btn.dataset.id].name} en ${ROLE_LABEL[role]}`); }
  }));
}

// ---------- Draft depuis une capture de fin de game ----------
// Les 10 champions sont repérés automatiquement (shotauto.js) ; à défaut l'utilisateur clique sur chaque portrait ;
// chaque clic est comparé aux 170 portraits (centre de l'icône, plusieurs tailles et petits décalages).
const SHOT = { img: null, icons: null, imgs: [], clicks: [], bans: null, det: null, scale: 1, run: 0 };
const ICON_N = 20, ZOOMS = [0.45, 0.52, 0.6, 0.68, 0.76]; // centre de l'icône : évite le badge de niveau et les bordures
function iconVec(source, sx, sy, sw, sh, gray = false) {
  const cv = iconVec.cv ??= Object.assign(document.createElement('canvas'), { width: ICON_N, height: ICON_N });
  const ctx = iconVec.ctx ??= cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, ICON_N, ICON_N);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, ICON_N, ICON_N);
  const d = ctx.getImageData(0, 0, ICON_N, ICON_N).data, v = new Float32Array(ICON_N * ICON_N * 3);
  // une seule moyenne pour les 3 couleurs : on garde la teinte (très discriminante), on retire la luminosité
  let m = 0;
  for (let k = 0, j = 0; k < d.length; k += 4, j += 3) {
    if (gray) { const g = (d[k] + d[k + 1] + d[k + 2]) / 3; v[j] = v[j + 1] = v[j + 2] = g; m += 3 * g; continue; } // bans grisés
    v[j] = d[k]; v[j + 1] = d[k + 1]; v[j + 2] = d[k + 2]; m += d[k] + d[k + 1] + d[k + 2];
  }
  m /= v.length;
  let ss = 0;
  for (let j = 0; j < v.length; j++) { v[j] -= m; ss += v[j] ** 2; }
  const sd = Math.sqrt(ss / v.length) || 1;
  for (let j = 0; j < v.length; j++) v[j] /= sd; // contraste normalisé : on compare le dessin, pas la luminosité
  v.sd = sd;
  return v;
}
async function loadIcons() {
  if (SHOT.icons) return SHOT.icons;
  $('shotState').textContent = 'Préparation des portraits…';
  const out = [];
  await Promise.all(state.list.map((c) => new Promise((res) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => {
      SHOT.imgs.push({ id: c.id, im });
      try { for (const z of ZOOMS) { const w = im.width * z; out.push({ id: c.id, z, v: iconVec(im, (im.width - w) / 2, (im.height - w) / 2, w, w) }); } } catch {}
      res();
    };
    // URL distincte : sinon Chromium réutilise la version déjà affichée (sans autorisation de lecture) et le portrait est ignoré
    im.onerror = res; const u = img(c.id); im.src = u.startsWith('data:') ? u : `${u}?read=1`;
  })));
  SHOT.icons = out; $('shotState').textContent = '';
  return out;
}
// Recherche en 2 passes : on localise d'abord l'icône autour du clic (taille, décalage),
// puis on affine autour de la meilleure position avec tous les cadrages.
function matchAt(x, y, exclude = new Set(), size = 0) {
  const W = SHOT.img.width;
  const icons = SHOT.icons.filter((ic) => !exclude.has(ic.id));
  const corr = (v, u) => { let c = 0; for (let j = 0; j < v.length; j++) c += v[j] * u[j]; return c / v.length; };
  // passe 1 : pour CHAQUE champion, sa meilleure position/taille autour du clic (cadrage 0.6)
  const z1 = icons.filter((ic) => ic.z === 0.6), bestOf = new Map();
  // taille connue (case repérée automatiquement) : on ne cherche qu'autour d'elle
  for (let s = size ? size * 0.78 : W * 0.015; s <= (size ? size * 1.12 : W * 0.075); s *= size ? 1.04 : 1.08) {
    for (let dx = -0.2; dx <= 0.201; dx += 0.08) for (let dy = -0.2; dy <= 0.201; dy += 0.08) {
      const w = s * 0.6, v = iconVec(SHOT.img, x + dx * s - w / 2, y + dy * s - w / 2, w, w);
      if (v.sd < 6) continue;
      for (const ic of z1) { const c = corr(v, ic.v); const b = bestOf.get(ic.id); if (!b || c > b.c) bestOf.set(ic.id, { c, s, dx, dy }); }
    }
  }
  if (!bestOf.size) return [];
  // passe 2 : les 16 meilleurs, chacun affiné autour de SA position, avec tous les cadrages
  const top = [...bestOf.entries()].sort((p, q) => q[1].c - p[1].c).slice(0, 16);
  const res = new Map();
  for (const [id, b0] of top) {
    const mine = icons.filter((ic) => ic.id === id);
    let best = -1;
    for (let ks = 0.92; ks <= 1.081; ks += 0.04) for (let ox = -0.05; ox <= 0.051; ox += 0.025) for (let oy = -0.05; oy <= 0.051; oy += 0.025) {
      const s = b0.s * ks, cx = x + (b0.dx + ox) * b0.s, cy = y + (b0.dy + oy) * b0.s;
      for (const ic of mine) {
        const w = s * ic.z, v = iconVec(SHOT.img, cx - w / 2, cy - w / 2, w, w);
        if (v.sd < 6) continue;
        const c = corr(v, ic.v); if (c > best) best = c;
      }
    }
    res.set(id, best);
  }
  const out = [...res.entries()].sort((p, q) => q[1] - p[1]);
  return out.slice(0, 4).map(([id]) => id);
}
// bans grisés (drafters) : comparaison en niveaux de gris avec le centre des portraits
function matchGray(b, exclude) {
  const corr = (v, u) => { let c = 0; for (let j = 0; j < v.length; j++) c += v[j] * u[j]; return c / v.length; };
  SHOT.gray ??= SHOT.imgs.flatMap(({ id, im }) => [0.5, 0.62, 0.74].map((z) => { const w = im.width * z; return { id, z, v: iconVec(im, (im.width - w) / 2, (im.height - w) / 2, w, w, true) }; }));
  const best = new Map();
  for (const ks of [0.9, 1, 1.1]) for (const ox of [-0.04, 0, 0.04]) for (const oy of [-0.04, 0, 0.04]) for (const z of [0.5, 0.62, 0.74]) {
    const s = b.w * ks, w = s * z, v = iconVec(SHOT.img, b.cx + ox * s - w / 2, b.cy + oy * s - w / 2, w, w, true);
    if (v.sd < 4) continue;
    for (const ic of SHOT.gray) if (ic.z === z && !exclude.has(ic.id)) { const c = corr(v, ic.v); if (c > (best.get(ic.id) ?? -1)) best.set(ic.id, c); }
  }
  return [...best.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4).map(([id]) => id);
}
// Analyse sans clic : repérage des cases puis reconnaissance de chacune
async function autoShot() {
  const run = ++SHOT.run;
  const st = (t) => { if (run === SHOT.run) $('shotState').textContent = t; };
  st('Recherche des champions sur l’image…');
  await new Promise((r) => setTimeout(r, 30));
  let det = null;
  try { det = detectSlots(SHOT.img); } catch (e) { console.warn(e); }
  SHOT.det = det;
  if (!det) { st(''); SHOT.auto = 'fail'; renderShotList(); return; }
  await loadIcons();
  const boxes = det.picks.flat(), taken = new Set();
  SHOT.clicks = [];
  for (let k = 0; k < boxes.length; k++) {
    if (run !== SHOT.run) return;
    const b = boxes[k];
    st(`Reconnaissance ${k + 1}/10${b.kind === 'wide' ? ' (illustrations)' : ''}…`);
    await new Promise((r) => setTimeout(r, 0));
    const alts = b.kind === 'wide' ? await matchBanner(SHOT.img, b, taken) : matchAt(b.cx, b.cy, taken, b.w);
    if (alts[0]) taken.add(alts[0]);
    SHOT.clicks.push({ x: b.cx, y: b.cy, id: alts[0], alts, box: b });
    drawShot(); renderShotList();
  }
  SHOT.bans = null;
  if (det.bans) {
    st('Bans…'); await new Promise((r) => setTimeout(r, 0));
    const seen = new Set(taken);
    SHOT.bans = det.bans.flat().map((b) => { const alts = matchGray(b, seen); if (alts[0]) seen.add(alts[0]); return { x: b.cx, y: b.cy, id: alts[0], alts, box: b }; });
  }
  SHOT.auto = 'ok'; st(''); drawShot(); renderShotList();
}
function drawShot() {
  const cv = $('shotCanvas'), ctx = cv.getContext('2d');
  // les repères (cases, numéros) ne sont pas dessinés : l’image reste telle quelle
  ctx.drawImage(SHOT.img, 0, 0, cv.width, cv.height);
}
function renderShotList() {
  const n = SHOT.clicks.length;
  $('shotHelp').innerHTML = !SHOT.img ? 'Choisis, glisse ou colle (Ctrl/Cmd + V) une capture : les champions sont repérés et reconnus automatiquement.'
    : !SHOT.auto ? 'Analyse de l’image en cours : les champions sont repérés et reconnus automatiquement…'
    : n === 10 ? 'Les 10 champions ont été reconnus automatiquement. Vérifie la liste à droite : si un champion est faux, clique sur un autre choix proposé ou tape son nom, puis lance l’analyse.'
    : SHOT.auto === 'fail' && !n ? 'Les champions n’ont pas pu être repérés automatiquement sur cette image : <b>clique sur chaque portrait</b>, équipe bleue d’abord (l’ordre des lanes n’a pas d’importance).'
    : `Il manque ${10 - n} champion${10 - n > 1 ? 's' : ''} : clique sur le portrait d’un champion de l’<b>${n < 5 ? 'équipe 1 (bleue)' : 'équipe 2 (rouge)'}</b> pour le reconnaître.`;
  $('shotList').innerHTML = [0, 1].map((t) => `<div class="sl-team ${t ? 'r' : 'b'}"><h5>${t ? 'Équipe 2 · rouge' : 'Équipe 1 · bleu'}</h5>${ROLES.map((r, k) => {
    const c = SHOT.clicks[t * 5 + k];
    return `<div class="sl-row ${c ? '' : 'empty'}"><span class="sl-r">${k + 1}</span>${c ? `<img src="${img(c.id)}" alt=""><b>${state.P[c.id]?.name ?? c.id}</b>
      <span class="sl-alt">${c.alts.filter((a) => a !== c.id).slice(0, 3).map((a) => `<img src="${img(a)}" title="${state.P[a]?.name}" data-k="${t * 5 + k}" data-id="${a}">`).join('')}</span>
      <input class="sl-in" data-k="${t * 5 + k}" list="champList" placeholder="autre…">` : '<span class="muted">—</span>'}</div>`;
  }).join('')}</div>`).join('') + (SHOT.bans ? `<div class="sl-bans"><h5>Bans repérés</h5>${[0, 1].map((t) => `<span class="${t ? 'r' : 'b'}">${SHOT.bans.slice(t * 5, t * 5 + 5).map((b) => (b.id ? `<img src="${img(b.id)}" title="${state.P[b.id]?.name}">` : '<i></i>')).join('')}</span>`).join('')}<button class="sl-noban" id="shotNoBans">ignorer</button></div>` : '');
  $('shotNoBans') && ($('shotNoBans').onclick = () => { SHOT.bans = null; drawShot(); renderShotList(); });
  $('shotList').querySelectorAll('.sl-alt img').forEach((im) => (im.onclick = () => { const c = SHOT.clicks[+im.dataset.k]; c.alts = [im.dataset.id, ...c.alts.filter((a) => a !== im.dataset.id)]; c.id = im.dataset.id; renderShotList(); }));
  $('shotList').querySelectorAll('.sl-in').forEach((inp) => (inp.onchange = () => { const ch = findChamp(inp.value); if (ch) { SHOT.clicks[+inp.dataset.k].id = ch.id; renderShotList(); } }));
  $('shotGo').disabled = n < 10;
  $('shotUndo').disabled = !n;
}
async function setShotImage(file) {
  // lecture en data URL (autorisée par la politique de sécurité de l'app), avec message si l'image est illisible
  const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const im = new Image();
  const ok = await new Promise((r) => { im.onload = () => r(true); im.onerror = () => r(false); im.src = url; });
  if (!ok) { toast('Image illisible : essaie en PNG ou JPG'); return; }
  SHOT.img = im; SHOT.clicks = []; SHOT.bans = null; SHOT.det = null; SHOT.auto = null;
  const cv = $('shotCanvas'), maxW = Math.min(900, innerWidth * 0.62);
  SHOT.scale = Math.min(1, maxW / im.width);
  cv.width = Math.round(im.width * SHOT.scale); cv.height = Math.round(im.height * SHOT.scale);
  cv.hidden = false; $('shotEmpty').hidden = true;
  drawShot(); renderShotList();
  await loadIcons();
  await autoShot();
}
function openShot() {
  $('shotBox').hidden = false; SHOT.clicks = []; SHOT.img = null; SHOT.bans = null; SHOT.auto = null; SHOT.run++;
  $('shotCanvas').hidden = true; $('shotEmpty').hidden = false; renderShotList();
  loadIcons();
}
function applyShot() {
  state.slots = emptySlots(); state.roles = { blue: [...ROLES], red: [...ROLES] };
  state.lock = { blue: Array(5).fill(null), red: Array(5).fill(null) }; state.history = []; state.selected = null;
  state.fromShot = true; // une draft importée d'une capture n'entre pas dans une série Fearless
  SHOT.clicks.forEach((c, k) => { const side = k < 5 ? 'blue' : 'red'; state.slots[side][k % 5] = c.id; });
  // Rôles déduits uniquement des champions reconnus sur l'image (jamais des pseudos)
  assignRoles('blue'); assignRoles('red');
  for (const [t, side] of ['blueBans', 'redBans'].entries()) state.slots[side] = SHOT.bans ? SHOT.bans.slice(t * 5, t * 5 + 5).map((b) => b.id ?? NO_BAN) : Array(5).fill(NO_BAN);
  state.flow = state.flow === 'players' ? 'players' : 'zero';
  $('shotBox').hidden = true; closeMenu(); render();
  // seule question possible : qui est top et qui est mid, quand les deux champions jouent les deux lanes
  const ask = ['blue', 'red'].filter(topMidAmbiguous);
  const next = () => { const side = ask.shift(); if (side) askTopMid(side, next); else toast('Draft importée : lanes déduites des champions'); };
  next();
}
const slotOf = (side, r) => state.roles[side].findIndex((x, i) => x === r && state.slots[side][i]);
function topMidAmbiguous(side) {
  const iT = slotOf(side, 'T'), iM = slotOf(side, 'M');
  if (iT < 0 || iM < 0) return false;
  const a = state.P[state.slots[side][iT]], b = state.P[state.slots[side][iM]];
  // ambigu si chacun joue aussi l'autre lane, ou si l'échange ne change presque rien
  const swapLoss = fit(a, 'T') + fit(b, 'M') - fit(a, 'M') - fit(b, 'T');
  return (flexRoles(a).includes('M') && flexRoles(b).includes('T')) || swapLoss < 15;
}
function askTopMid(side, done) {
  const iT = slotOf(side, 'T'), iM = slotOf(side, 'M');
  const a = state.P[state.slots[side][iT]], b = state.P[state.slots[side][iM]];
  const box = $('laneAsk');
  const opt = (t, m, main) => `<button data-t="${t.id}" class="${main ? 'main' : ''}">${main ? '<em>Le plus probable</em>' : ''}<span class="tm"><img src="${img(t.id)}">${t.name} <small>Top</small></span><span class="tm"><img src="${img(m.id)}">${m.name} <small>Mid</small></span></button>`;
  box.innerHTML = `<div class="la-card"><div class="la-body">
      <b>Qui joue top et qui joue mid ?</b><span class="muted">${side === 'blue' ? 'Équipe 1 (bleue)' : 'Équipe 2 (rouge)'} · ${a.name} et ${b.name} peuvent jouer les deux lanes</span>
      <div class="la-opts">${opt(a, b, true)}${opt(b, a, false)}</div></div></div>`;
  box.hidden = false;
  box.querySelectorAll('button').forEach((btn) => (btn.onclick = () => {
    const top = btn.dataset.t;
    state.lock[side][iT] = state.slots[side][iT] === top ? 'T' : 'M';
    state.lock[side][iM] = state.slots[side][iM] === top ? 'T' : 'M';
    assignRoles(side); box.hidden = true; render(); done();
  }));
  box.onclick = null;
}

// Taille de la fenêtre (application) : plein écran ou tailles fixes, interface mise à l'échelle
async function initWinSize() {
  if (!api.windowSizes) return;
  const sel = $('winSize');
  const fill = async () => {
    const { current, options } = await api.windowSizes();
    sel.innerHTML = options.map((o) => `<option value="${o.id}">${o.label}</option>`).join('');
    sel.value = current ?? options[0].id;
  };
  await fill(); $('winSizeBox').hidden = false;
  sel.onchange = () => api.setWindowSize(sel.value);
  api.onWindowChanged?.(() => fill());
}
// la courbe de scaling suit la taille de sa carte
new ResizeObserver(() => { if (state.list?.length) renderScaling(); }).observe(document.querySelector('.scal-plot'));
function initLive() {
  initWinSize();
  $('startLive').onclick = startLiveMode;
  $('liveStop').onclick = () => { stopLiveMode(); toast('Direct arrêté'); };
  $('liveHist').onclick = () => { const b = $('histBox'); if (b.hidden) { toast('Aucune partie dans l’historique pour l’instant'); return; } b.open = true; b.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  api.onLive?.(onLive);
}
function initShot() {
  $('startShot').onclick = openShot;
  $('shotClose').onclick = () => { $('shotBox').hidden = true; };
  $('shotChoose').onclick = () => $('shotFile').click();
  $('shotFile').onchange = (e) => { const f = e.target.files?.[0]; if (f) setShotImage(f); e.target.value = ''; };
  document.addEventListener('paste', (e) => {
    if ($('shotBox').hidden) return;
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) setShotImage(f);
  });
  const drop = $('shotDrop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...(e.dataTransfer.files ?? [])].find((x) => x.type.startsWith('image/')); if (f) setShotImage(f); else toast('Dépose une image (PNG ou JPG)'); };
  $('shotCanvas').onclick = async (e) => {
    if (!SHOT.img || SHOT.clicks.length >= 10) return;
    const r = e.target.getBoundingClientRect();
    const x = (e.clientX - r.left) / SHOT.scale * (e.target.width / r.width), y = (e.clientY - r.top) / SHOT.scale * (e.target.height / r.height);
    await loadIcons();
    const ex = new Set(SHOT.clicks.map((c) => c.id));
    // clic dans un bandeau repéré : on compare avec les illustrations
    const box = SHOT.det?.picks.flat().find((b) => Math.abs(b.cx - x) < b.w / 2 && Math.abs(b.cy - y) < b.h / 2);
    const alts = box?.kind === 'wide' ? await matchBanner(SHOT.img, box, ex) : matchAt(x, y, ex, box?.w ?? 0);
    SHOT.clicks.push({ x: box?.cx ?? x, y: box?.cy ?? y, id: alts[0], alts, box });
    drawShot(); renderShotList();
  };
  $('shotUndo').onclick = () => { SHOT.run++; SHOT.clicks.pop(); $('shotState').textContent = ''; drawShot(); renderShotList(); };
  $('shotGo').onclick = applyShot;
}

// ---------- Drafts sauvegardées ----------
const SAVE_KEY = 'draftlab-saves';
const readSaves = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? '[]'); } catch { return []; } };
const writeSaves = (l) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(l)); return true; } catch { toast('Impossible d’enregistrer'); return false; } };
function saveDraft() {
  const name = $('saveName').value.trim() || `Draft du ${new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`;
  const list = readSaves();
  const entry = {
    id: Date.now(), name, date: Date.now(), flow: state.flow, mySide: state.mySide,
    slots: structuredClone(state.slots), roles: structuredClone(state.roles), lock: structuredClone(state.lock), history: structuredClone(state.history),
    players: structuredClone(state.players), teamInput: { ...state.teamInput },
    fearless: state.fearless?.on && flAllowed() ? structuredClone({ ...state.fearless, games: state.fearless.games.map((g, k) => (k === state.fearless.cur ? flSnap() : g)) }) : null
  };
  const same = list.findIndex((x) => x.name === name);
  if (same >= 0) list[same] = { ...entry, id: list[same].id }; else list.unshift(entry);
  if (writeSaves(list)) { $('saveName').value = ''; toast(same >= 0 ? `« ${name} » mise à jour` : `« ${name} » sauvegardée`); renderSaves(); }
}
function loadDraft(id) {
  const d = readSaves().find((x) => x.id === id);
  if (!d) return;
  // un champion inconnu (renommé ou retiré du jeu) est ignoré au lieu de bloquer l'affichage
  const slots = Object.fromEntries(Object.entries(d.slots).map(([k, arr]) => [k, arr.map((id) => (id === NO_BAN || (id && state.P[id]) ? id : null))]));
  Object.assign(state, {
    mySide: d.mySide, slots, roles: d.roles, lock: d.lock ?? { blue: Array(5).fill(null), red: Array(5).fill(null) }, history: d.history ?? [],
    players: d.players ?? { blue: [], red: [] }, teamInput: d.teamInput ?? { blue: '', red: '' }, selected: null,
    flow: d.flow ?? ([...(d.players?.blue ?? []), ...(d.players?.red ?? [])].some((p) => p.riotId || p.pool?.length) ? 'players' : 'zero')
  });
  // la série Fearless sauvegardée avec la draft revient avec elle (sinon : pas de série)
  state.fromShot = false; state.fearless = d.fearless ? flMigrate(structuredClone(d.fearless)) : FL_OFF(); saveFearless();
  $('mySide').value = state.mySide;
  $('opggBlue').value = state.teamInput.blue ?? ''; $('opggRed').value = state.teamInput.red ?? '';
  savePrefs();
  ingest(state.data);
  toast(`« ${d.name} » chargée${state.fearless.on ? ` · Fearless Bo${state.fearless.bo}, game ${state.fearless.cur + 1}` : ''}`);
}
// Elo bien visible dans les encadrés d'équipe : Solo/Duo en grand (compté), Flex en petit (affiché)
const SHORT_T = { Fer: 'Fer', Bronze: 'Bronze', Argent: 'Argent', Or: 'Or', Platine: 'Plat', 'Émeraude': 'Émer', Diamant: 'Diam', Master: 'Master', 'Grand Master': 'GM', Challenger: 'Chall' };
function sbRank(r, f) {
  const n = rankName(r), fn = f ? rankName(f) : null, lp = r?.tier ? r.lp : null;
  const short = (x) => (x.name + x.div).length > 8 ? SHORT_T[x.name] ?? x.name : x.name;
  return `<div class="sbr-solo ${n ? '' : 'none'}" style="--c:${rankColor(r)}" title="Solo/Duo (compté dans le pronostic) : ${n ? n.label + (n.prev ? ' (saison passée)' : '') : 'non classé'}${lp != null ? ' · ' + lp + ' LP' : ''}"><div class="sr1"><u>Solo</u>${lp != null ? `<small>${lp} LP</small>` : ''}</div><b>${n ? `${short(n)} ${n.div}`.trim() : 'Non classé'}</b></div>
    <div class="sbr-flex" title="Flex 5c5 (affiché, non compté)${fn ? ' : ' + fn.label + (f.lp != null ? ' · ' + f.lp + ' LP' : '') : ''}"><u>Flex</u>${fn ? `<span style="color:${rankColor(f)}">${`${SHORT_T[fn.name] ?? fn.name} ${fn.div}`.trim()}</span>` : '<span class="muted">—</span>'}</div>`;
}
// Classement Flex : affiché à côté (jamais compté dans le pronostic)
function flexTag(p) {
  const f = p?.rank?.flex; if (!f) return '';
  const pts = rankPoints(f), g = (f.wins ?? 0) + (f.losses ?? 0);
  return `<div class="prk"><span class="qtag flex" title="Flex 5c5 : affiché pour info, pas compté dans le pronostic">Flex</span><span class="tier flexr" style="--c:${rankColor(f)}">${rankName(f)?.label ?? '?'}${f.lp != null ? ` · ${f.lp} LP` : ''}</span>${g ? `<span class="muted">${Math.round((f.wins / g) * 100)} % · ${g} g</span>` : ''}</div>`;
}
function renderSaves() {
  const el = $('savesList'), list = readSaves();
  $('savesCount').textContent = list.length ? `(${list.length})` : '';
  if (!list.length) { el.innerHTML = '<div class="muted">Aucune draft sauvegardée.</div>'; return; }
  el.innerHTML = list.map((d) => {
    const ids = [...(d.slots.blue ?? []), ...(d.slots.red ?? [])];
    return `<div class="srow">
      <div class="sname"><b>${d.name.replace(/</g, '&lt;')}</b><span class="muted">${new Date(d.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
      <div class="smini">${d.slots.blue.map((id) => (id ? `<img src="${img(id)}" class="b">` : '<span class="e b"></span>')).join('')}<span class="vs">vs</span>${d.slots.red.map((id) => (id ? `<img src="${img(id)}" class="r">` : '<span class="e r"></span>')).join('')}</div>
      <button class="sload" data-id="${d.id}">Ouvrir</button><button class="sdel" data-id="${d.id}">Supprimer</button>
    </div>`;
  }).join('');
  el.querySelectorAll('.sload').forEach((b) => (b.onclick = () => loadDraft(+b.dataset.id)));
  el.querySelectorAll('.sdel').forEach((b) => (b.onclick = () => {
    if (b.dataset.armed) { writeSaves(readSaves().filter((x) => x.id !== +b.dataset.id)); renderSaves(); return; }
    b.dataset.armed = '1'; b.textContent = 'Confirmer ?'; b.classList.add('danger');
    setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Supprimer'; b.classList.remove('danger'); } }, 3000);
  }));
}

const WHO = { mine: ['toi', 'up'], theirs: ['eux', 'down'], even: ['disputé', ''], skip: ['à laisser', 'muted'], unknown: ['?', 'muted'] };

function miniMap(mp, myJ) {
  const col = (st) => (st === 'fort' ? '#1f9d5b' : st === 'faible' ? '#d64552' : st === 'égal' ? '#9a7a3c' : '#c3cad5');
  const L = mp.lanes;
  let s = `<rect x="0" y="0" width="220" height="220" rx="14" fill="#eef1f5"/>`;
  s += `<path d="M10,210 L210,10" stroke="#d3e2f4" stroke-width="26"/>`; // rivière (diagonale opposée)
  s += `<path d="M10,10 L210,210" stroke="#c9d9ec" stroke-width="16" opacity=".6"/>`;
  const lane = (d, st, w = 9) => `<path d="${d}" stroke="${col(st)}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`;
  s += lane('M22,198 L22,22 L198,22', L.T.state) + lane('M28,192 L192,28', L.M.state) + lane('M22,198 L198,198 L198,22', L.B.state);
  s += `<circle cx="22" cy="198" r="14" fill="#2f6fe0"/><text x="22" y="202" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">TOI</text>`;
  s += `<circle cx="198" cy="22" r="14" fill="#d64552"/><text x="198" y="26" text-anchor="middle" font-size="9" font-weight="800" fill="#fff">EUX</text>`;
  s += `<circle cx="150" cy="150" r="11" fill="#ffffff" stroke="#ff9f43" stroke-width="2"/><text x="150" y="154" text-anchor="middle" font-size="11">🐉</text>`;
  s += `<circle cx="70" cy="70" r="11" fill="#ffffff" stroke="#b65cff" stroke-width="2"/><text x="70" y="74" text-anchor="middle" font-size="10">🪲</text>`;
  const lab = (x, y, t, st) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${col(st)}">${t}</text>`;
  s += lab(40, 112, 'TOP', L.T.state) + lab(112, 98, 'MID', L.M.state) + lab(150, 186, 'BOT', L.B.state);
  if (myJ && mp.strongSide && mp.strongSide !== 'M') {
    const toBot = mp.strongSide === 'B';
    const d = toBot ? 'M70,95 C95,120 110,140 140,158' : 'M140,125 C115,100 100,80 78,62';
    s += `<path d="${d}" stroke="#1f2937" stroke-width="2.5" fill="none" stroke-dasharray="5 4" marker-end="url(#jarr)"/>`;
  }
  return themed(`<svg viewBox="0 0 220 220" class="minimap"><defs><marker id="jarr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#1f2937"/></marker></defs>${s}</svg>`);
}

function renderAdvice() {
  const me = state.mySide, them = me === 'blue' ? 'red' : 'blue';
  const mine = roster(me), theirs = roster(them);
  const mp = matchPlan(mine, theirs);
  const plan = gamePlan(mine, theirs);
  if (!mp) { $('advice').innerHTML = '<p class="muted">Choisis un premier champion pour voir le plan de jeu.</p>'; return; }
  const LN = { T: 'Top', M: 'Mid', B: 'Bot' };
  const laneRow = (k) => {
    const l = mp.lanes[k];
    const pics = (arr) => arr.map((c) => `<img src="${img(c.id)}" title="${c.name}">`).join('');
    return `<div class="ln ${l.state}" title="${l.gm ?? ''}"><span class="ln-n">${LN[k]}</span><span class="ln-p">${pics(l.mine)}</span><b>${l.state === 'inconnu' ? '—' : l.state === 'fort' ? 'Côté fort' : l.state === 'faible' ? 'Côté faible' : 'Égal'}</b><span class="ln-p">${pics(l.theirs)}</span></div>`;
  };
  const myJ = mine.find((x) => x.role === 'J')?.c;
  const phaseCard = (p) => {
    const pct = Math.max(-1, Math.min(1, p.diff / 0.3));
    const who = p.diff > 0.06 ? ['Avantage toi', 'up'] : p.diff < -0.06 ? ['Avantage eux', 'down'] : ['Équilibré', ''];
    return `<div class="ph">
      <div class="ph-h"><b>${p.name}</b><span>${p.range}</span><em class="${who[1]}">${who[0]}</em></div>
      <div class="ph-bar"><i style="left:${pct >= 0 ? 50 : 50 + pct * 50}%;width:${Math.abs(pct) * 50}%" class="${pct >= 0 ? 'b' : 'r'}"></i></div>
      <ul>${p.items.map((t) => `<li>${t}</li>`).join('')}</ul>
      ${p.alts.length ? `<div class="ph-alt"><span>Alternatives</span><ul>${p.alts.map((t) => `<li>${t}</li>`).join('')}</ul></div>` : ''}
    </div>`;
  };
  const objCard = (icon, name, when, o) => `<div class="ob ${o.simple[0]}">
      <div class="ob-h"><span class="ob-i">${icon}</span><b>${name}</b><small>${when}</small><em>${o.simple[1]}</em></div>
      <p>${o.simple[2]}</p>${o.fake ? `<p class="ob-x">${o.fake}</p>` : ''}</div>`;
  const withLane = (r) => r.map((x) => ({ ...x.c, lane: x.role }));
  const synM = teamSynergy(withLane(mine)).pairs.slice(0, 4), synT = teamSynergy(withLane(theirs)).pairs.slice(0, 2);
  const synCard = (x, enemy) => `<div class="sy ${enemy ? 'enemy' : ''}">
      <div class="sy-pics"><img src="${img(x.a.id)}"><span>+</span><img src="${img(x.b.id)}"></div>
      <div class="sy-txt"><div class="sy-h"><b>${x.a.name} + ${x.b.name}</b><em style="--k:${KINDS[x.kind]?.color ?? '#6b7280'}">${KINDS[x.kind]?.label ?? ''}</em></div>
      <div class="sy-t">${x.title}</div><p>${x.why}</p>${enemy ? '<p class="sy-warn">À surveiller : sépare-les ou garde tes contrôles / flash pour ce combo.</p>' : ''}
      <span class="muted">${x.src}</span></div></div>`;
  const textSecs = plan.filter((sec) => ['Identité', 'Points faibles'].includes(sec.title));
  const pv = pentagonView(mine, theirs);
  const chip = (cl, side) => cl ? `<div class="pv-chip ${side}" style="--a:${ARCH[cl.arch].color}"><span>${side === 'b' ? 'Ta compo' : 'Leur compo'}</span><b>${ARCH[cl.arch].label}</b><em>${cl.label.split(' · ').slice(1).join(' · ') || ARCH[cl.arch].desc}</em><small>${Math.round(cl.share * 100)} % du style de l’équipe</small></div>` : '';
  const bars = (bd, side) => bd.slice(0, 3).map((x) => `<div class="pv-st"><span style="color:${ARCH[x.k].color}">${ARCH[x.k].label}</span><div class="pv-sb ${side}"><i style="width:${x.share * 100}%"></i></div><b>${Math.round(x.share * 100)} %</b><span class="pv-ch">${x.champs.slice(0, 3).map((c) => `<img src="${img(c.id)}" title="${c.name}">`).join('')}</span></div>`).join('');
  const pentaBlock = !pv ? '' : `<div class="pv">
      <h4 class="pl-sub">Pentagone : style contre style</h4>
      <div class="pv-top">${chip(pv.mine, 'b')}
        <div class="pv-mid ${pv.rel > 0 ? 'up' : pv.rel < 0 ? 'down' : ''}"><div class="pv-arrow">${pv.rel > 0 ? '➜' : pv.rel < 0 ? '⬅' : '⇄'}</div><b>${pv.verdict}</b><span>pour toi</span></div>
        ${chip(pv.theirs, 'r')}</div>
      <div class="pv-break"><div>${bars(pv.breakdown.mine, 'b')}</div><div>${bars(pv.breakdown.theirs, 'r')}</div></div>
      <div class="pv-cards">
        <div class="pv-c ${pv.rel > 0 ? 'up' : pv.rel < 0 ? 'down' : ''}"><span class="pv-i">🎯</span><h5>Ce que ça veut dire</h5><p>${pv.meaning}</p></div>
        <div class="pv-c" style="--a:${pv.alt ? ARCH[pv.alt.arch].color : 'var(--line)'}"><span class="pv-i">🔀</span><h5>${pv.alt ? `Plan B : ${ARCH[pv.alt.arch].label}` : 'Plan B'}</h5><p>${pv.alt ? `${Math.round(pv.alt.share * 100)} % de ta compo · ${pv.alt.rel} face à leur compo. ${pv.alt.how}` : 'Pas de second style assez présent : reste sur ton plan principal.'}</p></div>
        <div class="pv-c" style="--a:${ARCH[pv.vs.arch].color}"><span class="pv-i">🛡</span><h5>Face à leur compo ${ARCH[pv.vs.arch].label}</h5><p>${pv.vs.how.replace(/^face à une compo [^:]+: /, '').replace(/^./, (x) => x.toUpperCase())}</p></div>
      </div></div>`;
  $('advice').innerHTML = `
    <div class="pl-top">
      <div class="pl-map">${miniMap(mp, myJ)}<div class="pl-lanes">${['T', 'M', 'B'].map(laneRow).join('')}</div></div>
      <div class="pl-jgl"><h4>Jungle et côtés</h4>${mp.jungle.items.map((t) => `<p>${t}</p>`).join('') || '<p class="muted">Choisis ton jungler.</p>'}
        <h4>Timeline des objectifs</h4>
        <div class="tl">${mp.timeline.map((e) => `<div class="tl-e ${WHO[e.who]?.[1] ?? ''}" title="${e.note}"><span class="tl-t">${e.t}</span><b>${e.name}</b><em>${WHO[e.who]?.[0] ?? ''}</em></div>`).join('')}</div>
      </div>
    </div>
    <div class="pl-phases">${mp.phases.map(phaseCard).join('')}</div>
    <h4 class="pl-sub">Objectifs : quoi prioriser</h4>
    <div class="pl-objs">${objCard('🐉', 'Drakes', '5:00', mp.drake)}${objCard('🪲', 'Larves', '8:00', mp.grubs)}${objCard('👁', 'Héraut', '15:00', mp.herald)}${objCard('🟣', 'Baron', '20:00', mp.baron)}</div>
    ${pentaBlock}
    ${synM.length || synT.length ? `<h4 class="pl-sub">Synergies</h4><div class="pl-syn">${synM.map((x) => synCard(x, false)).join('')}${synT.map((x) => synCard(x, true)).join('')}</div>` : ''}
    <div class="pl-text">${textSecs.map((sec) => `<div class="plan-sec"><h4>${sec.title}</h4>${sec.items.map((t) => `<p>${t}</p>`).join('')}</div>`).join('')}</div>`;
}

// Plus de pastilles par source : une seule alerte quand les données ne sont plus à jour.
function renderSources() {
  const s = state.data.sources ?? {}, el = $('dataAlert');
  const DAY = 24 * 3600 * 1000;
  const names = { ddragon: 'Riot', lolalytics: 'lolalytics', golgg: 'gol.gg' };
  const bad = Object.entries(names).map(([k, n]) => [n, s[k] ?? {}]).filter(([, st]) => !st.loading && (!st.ok || (st.at && Date.now() - st.at > 2 * DAY)));
  if (!bad.length) { el.hidden = true; }
  else {
    el.hidden = false;
    el.textContent = '⚠ Données pas à jour';
    el.title = bad.map(([n, st]) => `${n} : ${st.ok ? `dernière mise à jour le ${new Date(st.at).toLocaleDateString('fr-FR')}` : st.cached ? `hors ligne, on utilise les données du ${st.at ? new Date(st.at).toLocaleDateString('fr-FR') : '?'}` : `indisponible (${st.error ?? 'erreur'})`}`).join('\n') + '\nClique pour réessayer.';
    el.onclick = () => load(true);
  }
  $('patchPill').textContent = `Patch ${patchLabel(state.data.patch)}`;
}

// ---------- Chargement ----------
function ingest(data) {
  if (data?.error) { toast(data.error); return; }
  const prevPatch = state.data?.patch;
  state.data = data;
  state.P = buildProfiles(data.champions, data.stats, data.pro, state.mode);
  applyProGames(state.P, data.progames, data.changes ?? {});
  state.list = Object.values(state.P).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  renderSources();
  fillPortraits();
  $('champList').innerHTML = state.list.map((c) => `<option value="${c.name}"></option>`).join('');
  if (prevPatch && prevPatch !== data.patch) toast(`Nouveau patch ${patchLabel(data.patch)} détecté — données mises à jour`);
  render();
  if (!$('startMenu').hidden) renderMenuSaves();
  resumeAfterUpdate();
  flRestore();
}
// au démarrage : la game Fearless en cours revient dans la draft (sinon la mémoire serait écrasée par une draft vide)
let flRestored = false;
function flRestore() {
  if (flRestored) return; flRestored = true;
  const f = state.fearless, g = f?.on ? f.games[f.cur] : null;
  if (!g || Object.values(state.slots).flat().some(Boolean)) return;
  state.slots = structuredClone(g.slots); state.roles = structuredClone(g.roles); state.lock = structuredClone(g.lock); state.history = structuredClone(g.history ?? []);
  if (f.flow) state.flow = f.flow;
  render(); if (!$('startMenu').hidden) renderMenuSaves();
}

async function load(force = false) {
  if (!state.data) $('patchPill').textContent = 'Chargement…';
  if (force) { $('refresh').disabled = true; $('refresh').textContent = '…'; }
  try { ingest(await (force ? api.refresh({ tier: state.tier }) : api.load({ tier: state.tier }))); if (force) toast('Données actualisées'); }
  catch (e) { toast('Erreur de chargement : ' + e.message); }
  finally { $('refresh').disabled = false; $('refresh').textContent = '⟳'; }
}

function initControls() {
  $('themeBtn').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; savePrefs(); applyTheme(); render(); };
  $('mySide').onchange = (e) => { state.mySide = e.target.value; savePrefs(); render(); };
  $('undo').onclick = undo; $('menuBtn').onclick = openMenu;
  $('reset').onclick = () => { reset(); toast('Nouvelle draft : mêmes joueurs, picks et bans vidés'); };
  document.querySelectorAll('.seg-b').forEach((b) => (b.onclick = () => { $('mySide').value = b.dataset.side; $('mySide').onchange({ target: $('mySide') }); }));
  // Draft de zéro : petit menu « classique / Fearless Bo3 / Fearless Bo5 »
  $('startZero').onclick = () => { $('startMenu').classList.add('form'); $('startChoices').hidden = true; $('startModeBox').hidden = false; };
  $('modeBack').onclick = () => { $('startMenu').classList.remove('form'); $('startModeBox').hidden = true; $('startChoices').hidden = false; };
  document.querySelectorAll('#startModeBox .sm-o').forEach((b) => (b.onclick = () => { $('startModeBox').hidden = true; $('startChoices').hidden = false; $('startMenu').classList.remove('form'); startFromZero(b.dataset.mode); }));
  document.querySelectorAll('#menuMode button').forEach((b) => (b.onclick = () => { document.querySelectorAll('#menuMode button').forEach((x) => x.classList.toggle('on', x === b)); }));
  initBalance();
  $('startPlayers').onclick = () => { $('startMenu').classList.add('form'); $('startChoices').hidden = true; $('startForm').hidden = false; $('menuBlue').focus(); };
  $('menuBack').onclick = () => { $('startMenu').classList.remove('form'); $('startForm').hidden = true; $('startChoices').hidden = false; };
  $('menuGo').onclick = startFromPlayers;
  $('refresh').onclick = () => load(true);
  if (api.quit) $('menuQuit').onclick = () => api.quit(); else $('menuQuit').hidden = true;
  $('search').oninput = (e) => { state.search = e.target.value; render(); };
  $('onlyRole').onchange = (e) => { state.onlyRole = e.target.checked; render(); };
  const rf = $('roleFilter');
  for (const r of [null, ...ROLES]) {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = r ? ROLE_LABEL[r] : 'Tous';
    b.onclick = () => { state.roleFilter = r; [...rf.children].forEach((c) => c.classList.toggle('on', c === b)); render(); };
    if (!r) b.classList.add('on');
    rf.appendChild(b);
  }
  const af = $('archFilter');
  for (const k of [null, ...ORDER]) {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = k ? ARCH[k].label : 'Toutes compos';
    if (k) b.style.borderColor = ARCH[k].color;
    b.onclick = () => { state.archFilter = k; [...af.children].forEach((c) => c.classList.toggle('on', c === b)); render(); };
    if (!k) b.classList.add('on');
    af.appendChild(b);
  }
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'Escape' && $('startMenu').hidden) { state.selected = null; render(); }
    if (e.key === 'Enter' && document.activeElement === $('search')) {
      // Entrée : le nom exact d'abord, puis celui qui commence par la saisie, puis le premier de la grille
      const q = state.search.trim().toLowerCase(), u = used(), norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
      const free = state.list.filter((c) => !u.has(c.id));
      const best = free.find((c) => norm(c.name) === norm(q) || norm(c.id) === norm(q)) ?? free.find((c) => norm(c.name).startsWith(norm(q)));
      const taken = !best && state.list.find((c) => u.has(c.id) && (norm(c.name) === norm(q) || norm(c.name).startsWith(norm(q))));
      if (best) place(best.id); else if (taken) toast(flLocked().has(taken.id) && !Object.values(state.slots).flat().includes(taken.id) ? `${taken.name} est verrouillé (Fearless : joué en game ${flLocked().get(taken.id)})` : `${taken.name} est déjà pris ou banni`); else $('grid').querySelector('.tile:not(.used)')?.click();
      $('search').value = ''; state.search = ''; render();
    }
  });
  api.onUpdated((d) => ingest(d));
  document.querySelectorAll('.loadTeam').forEach((b) => (b.onclick = () => loadTeam(b.dataset.side)));
  for (const [id, side] of [['opggBlue', 'blue'], ['opggRed', 'red']]) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') loadTeam(side); });
  }
  $('region').onchange = (e) => { state.region = e.target.value; };
  $('saveBtn').onclick = saveDraft;
  $('saveName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveDraft(); });
}

// ---------- Mises à jour de l'application ----------
// Une nouvelle version téléchargée redémarre l'app toute seule. Si une draft est en cours,
// elle est mise de côté (mémoire tampon) puis reprise telle quelle après le redémarrage.
const RESUME_KEY = 'draftlab-resume', AUTO_KEY = 'draftlab-autorestart';
function workInProgress() {
  const any = (a) => (a ?? []).some((x) => x && x !== NO_BAN);
  return any(state.slots.blue) || any(state.slots.red) || any(state.slots.blueBans) || any(state.slots.redBans) ||
    [...state.players.blue, ...state.players.red].some((p) => p.riotId || p.pool?.length) || LIVE.on;
}
function bufferDraft() {
  try {
    if (!workInProgress()) { localStorage.removeItem(RESUME_KEY); return; }
    localStorage.setItem(RESUME_KEY, JSON.stringify({ at: Date.now(), menuOpen: !$('startMenu').hidden, live: LIVE.on,
      mySide: state.mySide, slots: state.slots, roles: state.roles, lock: state.lock, history: state.history,
      players: state.players, teamInput: state.teamInput, flow: state.flow, region: state.region }));
  } catch {}
}
let resumed = false;
function resumeAfterUpdate() {
  if (resumed) return; resumed = true;
  let d = null;
  try { d = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); localStorage.removeItem(RESUME_KEY); } catch {}
  if (!d || Date.now() - d.at > 30 * 60 * 1000) return;
  Object.assign(state, { mySide: d.mySide, slots: d.slots, roles: d.roles, lock: d.lock, history: d.history ?? [], players: d.players, teamInput: d.teamInput, flow: d.flow, region: d.region ?? state.region, selected: null });
  $('mySide').value = state.mySide;
  $('opggBlue').value = state.teamInput?.blue ?? ''; $('opggRed').value = state.teamInput?.red ?? '';
  if (!d.menuOpen) closeMenu();
  if (d.live && api.liveStart) { LIVE.on = true; LIVE.sig = ''; $('liveBar').hidden = false; $('liveTitle').textContent = 'Reconnexion au client…'; $('liveText').textContent = ''; api.liveStart(); }
  render();
  api.version?.().then((v) => toast(`Draft Lab mis à jour (v${v}) : ta draft a été reprise`));
}
function initUpdates() {
  // le numéro de version n'est plus affiché en haut (il reste dans le menu)
  $('verPill').hidden = true; document.querySelector('.tb-dot').hidden = true;
  if (!api.version) return;
  api.version().then((v) => { $('menuVer').textContent = `Draft Lab v${v} · rechercher une mise à jour`; $('menuVer').hidden = false; });
  let timer = null;
  const show = (st) => {
    if (!st || st.status !== 'ready' || timer) return;
    let tried = null; try { tried = localStorage.getItem(AUTO_KEY); } catch {}
    const b = $('updRestart');
    b.textContent = `⟳ Redémarrer (v${st.version})`; b.title = `Version ${st.version} installée${st.notes ? ' : ' + st.notes : ''}.`;
    // garde-fou : un seul redémarrage automatique par version (sinon bouton manuel)
    if (tried === st.version) { b.hidden = false; return; }
    toast(`Mise à jour v${st.version} : redémarrage dans 5 s${workInProgress() ? ' — ta draft est gardée' : ''}`);
    const go = () => {
      // pas pendant une sélection des champions en direct : on attend qu'elle soit finie
      if (LIVE.on && $('liveBar').dataset.phase === 'ChampSelect') { timer = setTimeout(go, 10000); return; }
      try { localStorage.setItem(AUTO_KEY, st.version); } catch {}
      bufferDraft(); api.restart();
    };
    timer = setTimeout(go, 5000);
  };
  api.lastUpdate?.().then(show);
  api.onUpdate?.(show);
  $('menuVer').onclick = () => { toast('Recherche de mise à jour…'); api.checkUpdate().then(() => api.lastUpdate().then((st) => {
    if (st?.status === 'uptodate') toast(`Draft Lab est à jour (v${st.current})`);
    else if (st?.status === 'off') toast(st.message);
    else if (st?.status === 'error') toast('Mise à jour impossible : ' + st.message);
  })); };
  $('updRestart').onclick = () => { bufferDraft(); api.restart(); };
}

applyTheme();
initControls();
initShot();
initLive();
initUpdates();
openMenu();
load();
