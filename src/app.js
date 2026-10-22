import { teamSynergy, KINDS } from './synergy.js';
import {
  ROLES, ROLE_LABEL, ARCH, ORDER, rel,
  buildProfiles, evaluate, recommend, recommendBans, projectPicks, gamePlan, powerCurve,
  comfortPts, proposeDrafts, playerLabel, analyzeDraft, matchPlan, pentagonView, styleBreakdown, compLabel, playersForecast, combineWr, pointsLabel, rankPoints, RANK_OPTIONS, playerRating, dominant, teamShares, predictPicks, enemyScenarios, predictedBans
} from './engine.js';

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
const PICKS = [['blue', 0], ['red', 0], ['red', 1], ['blue', 1], ['blue', 2], ['red', 2], ['red', 3], ['blue', 3], ['blue', 4], ['red', 4]];
const stepLabel = ([t, i]) => (t.endsWith('Bans') ? `Ban ${t.startsWith('blue') ? 'bleu' : 'rouge'} ${i + 1}` : `Pick ${t === 'blue' ? 'bleu' : 'rouge'} ${i + 1}`);
const shortLabel = ([t, i]) => (t.endsWith('Bans') ? null : `${t === 'blue' ? 'B' : 'R'}${i + 1}`);

// ---------- État ----------
const state = {
  data: null, P: {}, list: [],
  mode: 'soloq', tier: 'emerald_plus', mySide: 'blue',
  slots: emptySlots(),
  roles: { blue: [...ROLES], red: [...ROLES] },
  selected: null, history: [],
  search: '', roleFilter: null, archFilter: null, onlyRole: true,
  players: { blue: [], red: [] }, teamInput: { blue: '', red: '' }, region: 'euw',
  wantArch: null, scalShow: 'both',
  flow: 'zero' // 'zero' = draft de zéro (sans op.gg), 'players' = draft depuis des joueurs
};
function emptySlots() {
  return { blueBans: Array(5).fill(null), redBans: Array(5).fill(null), blue: Array(5).fill(null), red: Array(5).fill(null) };
}
try {
  const saved = JSON.parse(localStorage.getItem('draftlab-prefs') ?? '{}');
  Object.assign(state, { mySide: saved.mySide ?? state.mySide, wantArch: saved.wantArch ?? null });
} catch {}
// Une seule base de données : soloQ Émeraude+ (lolalytics), complétée par la compétition (gol.gg) pour écarter les picks hors rôle.
const savePrefs = () => { try { localStorage.setItem('draftlab-prefs', JSON.stringify({ mySide: state.mySide, wantArch: state.wantArch })); } catch {} };

const $ = (id) => document.getElementById(id);
const img = (id) => (state.data ? `https://ddragon.leagueoflegends.com/cdn/${state.data.version}/img/champion/${id}.png` : '');
const seq = () => PICKS;
const used = () => new Set(Object.values(state.slots).flat().filter(Boolean));
// ---------- Joueurs (multi op.gg) ----------
// Un champion du pool ne compte que s'il est joué à la lane du joueur
// (ex. joueur placé Support => seulement ses supports). Les ajouts manuels sont toujours gardés.
function fitsRole(id, role) {
  const c = state.P[id];
  if (!c) return false;
  return c.roles.includes(role);
}
const rolePool = (p) => (p.pool ?? []).filter((e) => e.manual || fitsRole(e.id, p.role));
const rolePlayers = (side) => state.players[side].map((p) => ({ ...p, pool: rolePool(p) })).filter((p) => p.pool.length);
const playerFor = (side, role) => rolePlayers(side).find((p) => p.role === role);
function withComfort(c, side, role) {
  const pl = role ? playerFor(side, role) : null;
  const e = pl?.pool?.find((x) => x.id === c.id);
  if (!e) return c;
  return { ...c, comfort: comfortPts(e), comfortTxt: `${playerLabel(pl)} : ${e.games} games${e.manual ? ' (ajouté)' : `, ${Math.round((e.wins / e.games) * 100)} %`}` };
}
const team = (side) => state.slots[side].map((id, i) => (id ? withComfort(state.P[id], side, state.roles[side][i]) : null)).filter(Boolean);
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
  if (t === 'blue' || t === 'red') autoRole(t, i, id);
  state.selected = null;
  render();
}
function autoRole(side, i, id) {
  const roles = state.roles[side];
  for (const r of state.P[id].roles) {
    if (roles[i] === r) return;
    const j = roles.indexOf(r);
    if (j >= 0 && !state.slots[side][j]) { [roles[i], roles[j]] = [roles[j], roles[i]]; return; }
  }
}
function clearSlot(t, i) { state.slots[t][i] = null; state.history = state.history.filter(([a, b]) => !(a === t && b === i)); render(); }
function undo() {
  const last = state.history.pop();
  if (last) { state.slots[last[0]][last[1]] = null; state.selected = null; render(); }
}
function reset() {
  state.slots = emptySlots(); state.roles = { blue: [...ROLES], red: [...ROLES] };
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
  renderBans(); renderTeams(); renderStep();
  const ev = evaluate(team('blue'), team('red'));
  renderWr(ev);
  renderGrid(gridInfo());
  $('playersBox').hidden = state.flow !== 'players';
  document.body.classList.toggle('flow-zero', state.flow !== 'players');
  renderPlayers(); renderSaves(); renderBanPlan();
  renderPentagon(ev); renderScaling(); renderAdvice();
}

function renderBans() {
  const tg = target();
  for (const side of ['blue', 'red']) {
    const el = $(`${side}Bans`); el.innerHTML = '';
    state.slots[`${side}Bans`].forEach((id, i) => {
      const b = document.createElement('div');
      b.className = 'ban' + (id ? ' filled' : '') + (tg && tg[0] === `${side}Bans` && tg[1] === i ? ' target' : '');
      b.title = id ? `${state.P[id].name} (clic droit pour retirer)` : `Ban ${i + 1}`;
      if (id) b.innerHTML = `<img src="${img(id)}" alt="">`;
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
    const sPairs = teamSynergy(team(side)).pairs;
    state.slots[side].forEach((id, i) => {
      const c = id ? state.P[id] : null;
      const s = document.createElement('div');
      s.className = 'slot' + (tg && tg[0] === side && tg[1] === i ? ' target' : '');
      const roleSel = `<select data-i="${i}">${ROLES.map((r) => `<option value="${r}" ${state.roles[side][i] === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>`;
      s.innerHTML = `
        <div class="portrait">${c ? `<img src="${img(id)}" alt="">` : (side === 'blue' ? 'B' : 'R') + (i + 1)}</div>
        <div>
          <div class="name">${c ? c.name : '<span class="muted">À choisir</span>'}</div>
          <div class="meta">${roleSel}${c?.wr != null ? `<span class="wrtag" title="Winrate du patch, soloQ Émeraude+">${c.wr.toFixed(1)} % WR</span>` : ''}</div>
          ${c ? archBar(c) : ''}
          ${c ? sPairs.filter((x) => x.a.id === id || x.b.id === id).slice(0, 2).map((x) => { const o = x.a.id === id ? x.b : x.a; return `<span class="slink" style="--k:${KINDS[x.kind]?.color ?? '#6b7280'}" title="${x.title} : ${x.why.replace(/"/g, '&quot;')}">🔗 ${o.name} · ${KINDS[x.kind]?.label ?? ''}</span>`; }).join('') : ''}
        </div>
        ${c ? '<button class="clear" title="Retirer">×</button>' : ''}`;
      s.onclick = (e) => {
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
        if (e.target.classList.contains('clear')) { clearSlot(side, i); return; }
        select(side, i);
      };
      s.querySelector('select').onchange = (e) => {
        const r = e.target.value, roles = state.roles[side], j = roles.indexOf(r);
        if (j >= 0) roles[j] = roles[i];
        roles[i] = r; render();
      };
      el.appendChild(s);
    });
  }
}

function renderStep() {
  const tg = target(), el = $('stepInfo');
  if (!tg) { el.textContent = 'Draft terminée'; el.className = 'step'; return; }
  const role = tg[0] === 'blue' || tg[0] === 'red' ? ` · ${ROLE_LABEL[state.roles[tg[0]][tg[1]]]}` : '';
  el.textContent = (state.selected ? 'Modifier : ' : '') + stepLabel(tg) + role;
  el.className = 'step ' + (tg[0].startsWith('blue') ? 'blue' : 'red');
}

const TIER_COLOR = [[2800, '#b65cff'], [2400, '#5b8cff'], [2000, '#2ec27e'], [1600, '#3fb8a6'], [1200, '#d4a837'], [800, '#9aa5b1'], [400, '#a0673c'], [0, '#7a7a7a']];
const tierColor = (pts) => (pts == null ? '#c3cad5' : pts >= 3600 ? '#f5d36b' : pts >= 3200 ? '#d64552' : TIER_COLOR.find(([v]) => pts >= v)[1]);

function renderWr(ev) {
  const fc = playersForecast(state.players.blue, state.players.red);
  const glob = combineWr(ev.wr, fc.wr);
  const main = fc.wr != null ? glob : ev.wr;
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
      <div class="sb-picks">${state.slots[side].map((id, i) => `<div class="sb-pick ${id ? '' : 'empty'}" title="${id ? state.P[id].name : ''}">${id ? `<img src="${img(id)}" alt="">` : ''}<span>${ROLE_LABEL[state.roles[side][i]]}</span></div>`).join('')}</div>
      <div class="sb-players">${ROLES.map((r) => {
        const p = list.find((x) => x.role === r);
        const pts = p ? rankPoints(p.rank) : null;
        return `<div class="sb-p" title="${p ? playerLabel(p) + (pts != null ? ' — ' + pointsLabel(pts) : '') : ROLE_LABEL[r]}"><i style="background:${tierColor(pts)}"></i><span>${ROLE_LABEL[r]}</span><b>${p && p.riotId ? playerLabel(p) : '—'}</b></div>`;
      }).join('')}</div>`;
  }
}

function renderGauge(v, label) {
  const cx = 160, cy = 160, r = 130, w = 26;
  const pt = (frac) => { const a = Math.PI * (1 - frac); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arc = (f0, f1, col) => {
    const [x0, y0] = pt(f0), [x1, y1] = pt(f1);
    return `<path d="M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}" stroke="${col}" stroke-width="${w}" fill="none" stroke-linecap="butt"/>`;
  };
  const f = Math.max(0.001, Math.min(0.999, v / 100));
  let s = arc(0, f, '#2f6fe0') + arc(f, 1, '#d64552');
  for (const t of [0.25, 0.5, 0.75]) { const [a, b] = pt(t); const [c, d] = [cx + (r - w / 2 - 6) * Math.cos(Math.PI * (1 - t)), cy - (r - w / 2 - 6) * Math.sin(Math.PI * (1 - t))]; s += `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#ffffff" stroke-width="2"/>`; }
  // repère blanc à la frontière bleu / rouge
  const [ix, iy] = [cx + (r - w / 2 - 4) * Math.cos(Math.PI * (1 - f)), cy - (r - w / 2 - 4) * Math.sin(Math.PI * (1 - f))];
  const [ox, oy] = [cx + (r + w / 2 + 4) * Math.cos(Math.PI * (1 - f)), cy - (r + w / 2 + 4) * Math.sin(Math.PI * (1 - f))];
  s += `<line x1="${ix}" y1="${iy}" x2="${ox}" y2="${oy}" stroke="#1f2937" stroke-width="4" stroke-linecap="round"/>`;
  s += `<text x="${cx}" y="${cy - 30}" text-anchor="middle" font-size="46" font-weight="900" fill="${v >= 50 ? '#2f6fe0' : '#d64552'}">${(v >= 50 ? v : 100 - v).toFixed(1)}%</text>`;
  s += `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="12.5" fill="#6b7280">${v === 50 ? 'égalité' : `pour l’équipe ${v >= 50 ? '1 (bleu)' : '2 (rouge)'}`}</text>`;
  s += `<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="11" fill="#9a7a3c" font-weight="700" letter-spacing="1">${label.toUpperCase()}</text>`;
  s += `<text x="${cx - r}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="#2f6fe0" font-weight="700">ÉQ. 1</text><text x="${cx + r}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="#d64552" font-weight="700">ÉQ. 2</text>`;
  $('gauge').innerHTML = s;
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
function gridInfo() {
  const ctx = currentContext();
  if (!ctx) return null;
  const proj = new Map();
  for (const c of state.list) {
    const cc = withComfort(c, ctx.side, ctx.role);
    proj.set(c.id, { prio: (cc.comfort > 0 ? 100 + cc.comfort * 10 : 0) + (c.wr ?? 50) / 10, inPool: cc.comfort > 0 });
  }
  return { ctx, proj };
}

function renderGrid(info) {
  const el = $('grid'), u = used();
  const q = state.search.trim().toLowerCase();
  const ctx = info?.ctx;
  const roleNeeded = state.roleFilter ?? (state.onlyRole && ctx?.isPick ? ctx.role : null);
  let list = state.list.filter((c) =>
    (!q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)) &&
    (!roleNeeded || c.roles.includes(roleNeeded)) &&
    (!state.archFilter || c[state.archFilter] >= 2));
  if (info?.proj) list = [...list].sort((a, b) => (info.proj.get(b.id)?.prio ?? 0) - (info.proj.get(a.id)?.prio ?? 0));
  el.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const c of list) {
    const t = document.createElement('div');
    t.className = 'tile' + (u.has(c.id) ? ' used' : '') + (c.offmeta ? ' offmeta' : '');
    const pj = info?.proj?.get(c.id);
    t.innerHTML = `<img loading="lazy" src="${img(c.id)}" alt="">
      ${pj?.inPool ? '<span class="star" title="Dans le pool du joueur">★</span>' : ''}
      <div class="dots">${ORDER.filter((k) => c[k] >= 2).map((k) => `<i style="background:${ARCH[k].color}"></i>`).join('')}</div>
      <div class="nm">${c.name}</div>`;
    t.title = `${c.name} — ${(c.roles.length ? c.roles : c.soloRoles).map((r) => ROLE_LABEL[r]).join('/')}` +
      (c.soloWr != null ? ` · soloQ ${c.soloWr.toFixed(1)} %` : '') +
      (c.proPicks ? ` · pro ${c.proPicks} games, ${c.presence} % présence` : ' · jamais joué en pro cette saison') +
      (c.proRoleStats ? `\nRôles en pro : ${Object.entries(c.proRoleStats).sort((a, b) => b[1].picks - a[1].picks).map(([r, v]) => `${ROLE_LABEL[r]} ${v.picks}`).join(', ')}` : '') +
      (c.offmeta ? '\n⚠ Pas un pick pro à ce rôle' : '') +
      `\n${ORDER.map((k) => `${ARCH[k].label} ${c[k]}/3`).join(' · ')} · Scaling ${['', 'early', 'mid', 'late'][c.scale]}${c.guessed ? ' (profil estimé)' : ''}`;
    t.onclick = () => place(c.id);
    frag.appendChild(t);
  }
  el.appendChild(frag);
}

function renderPentagon(ev) {
  const svg = $('pentagon');
  const C = [180, 160], R = 104;
  // Disposition de l'image : Engage en haut, Catch à droite, Protect en bas à droite, Poke en bas à gauche, Split à gauche
  const ANG = { e: -90, c: -18, d: 54, p: 126, s: 198 };
  const at = (k, r = R) => [C[0] + r * Math.cos((ANG[k] * Math.PI) / 180), C[1] + r * Math.sin((ANG[k] * Math.PI) / 180)];
  let s = '<defs>' + ORDER.map((k) => `<marker id="ar-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="${ARCH[k].color}"/></marker>`).join('') + '</defs>';
  s += `<polygon points="${ORDER.map((k) => at(k).join(',')).join(' ')}" fill="#f4f6f9" stroke="#d9dee6" stroke-width="1.5"/>`;
  for (const f of [0.5]) s += `<polygon points="${ORDER.map((k) => at(k, R * f).join(',')).join(' ')}" fill="none" stroke="#d9dee6" stroke-dasharray="3 4"/>`;
  // Flèches : contour = gros avantage, étoile = léger avantage
  ORDER.forEach((a, i) => {
    for (const [step, big] of [[1, true], [2, false]]) {
      const b = ORDER[(i + step) % 5];
      const [x1, y1] = at(a, R - 4), [x2, y2] = at(b, R - 4);
      const t0 = 0.17, t1 = 0.83;
      s += `<line x1="${x1 + (x2 - x1) * t0}" y1="${y1 + (y2 - y1) * t0}" x2="${x1 + (x2 - x1) * t1}" y2="${y1 + (y2 - y1) * t1}" stroke="${ARCH[a].color}" stroke-width="${big ? 2.6 : 1.3}" ${big ? '' : 'stroke-dasharray="5 4"'} opacity="${big ? 0.9 : 0.55}" marker-end="url(#ar-${a})"><title>${ARCH[a].label} a un ${big ? 'gros' : 'léger'} avantage sur ${ARCH[b].label}</title></line>`;
    }
  });
  // Radar des deux équipes
  for (const [sh, col] of [[ev.sharesRed, '214,69,82'], [ev.sharesBlue, '47,111,224']]) {
    if (!sh) continue;
    const pts = ORDER.map((k) => at(k, R * Math.min(1, sh[k] * 2)).join(',')).join(' ');
    s += `<polygon points="${pts}" fill="rgba(${col},.22)" stroke="rgb(${col})" stroke-width="2"/>`;
  }
  for (const k of ORDER) {
    const [vx, vy] = at(k), [lx, ly] = at(k, R + 26);
    s += `<circle cx="${vx}" cy="${vy}" r="6" fill="${ARCH[k].color}"/>`;
    s += `<text x="${lx}" y="${ly + 4}" fill="${ARCH[k].color}" font-size="13" font-weight="800" text-anchor="middle">${ARCH[k].label}</text>`;
  }
  svg.innerHTML = s;
  const fmt = (sh) => (sh ? ORDER.map((k) => `<span style="color:${ARCH[k].color}">${ARCH[k].short} ${Math.round(sh[k] * 100)}%</span>`).join(' · ') : '—');
  const tB = team('blue'), tR = team('red');
  const lb = tB.length ? compLabel(tB) : null, lr = tR.length ? compLabel(tR) : null;
  $('identity').innerHTML = `<div class="idt"><span class="b">${lb ? lb.label : 'Bleu'}</span><span class="r">${lr ? lr.label : 'Rouge'}</span></div>` +
    ORDER.map((k) => {
      const b = ev.sharesBlue?.[k] ?? 0, r = ev.sharesRed?.[k] ?? 0;
      return `<div class="idr"><span class="idv b">${Math.round(b * 100)}%</span><div class="idb l"><i style="width:${b * 100}%"></i></div>
        <span class="idk" style="color:${ARCH[k].color}">${ARCH[k].label}</span><div class="idb"><i style="width:${r * 100}%"></i></div><span class="idv r">${Math.round(r * 100)}%</span></div>`;
    }).join('');
}

function renderScaling() {
  const svg = $('scaling');
  const W = 420, H = 190, L = 34, Rr = 10, T = 14, B = 24;
  const x = (m) => L + ((m - 3) * (W - L - Rr)) / 37;
  const me = state.mySide, them = me === 'blue' ? 'red' : 'blue';
  const sides = state.scalShow === 'mine' ? [me] : state.scalShow === 'theirs' ? [them] : ['red', 'blue'];
  const curves = sides.map((sd) => team(sd)).filter((t) => t.length).map(powerCurve);
  const vals = curves.flat().map(([, v]) => v);
  const lo = Math.min(0.9, ...vals) - 0.04, hi = Math.max(1.1, ...vals) + 0.04;
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  let s = '';
  for (const [m, lab] of [[14, 'Mid'], [20, 'Baron'], [25, 'Late']]) {
    s += `<line x1="${x(m)}" x2="${x(m)}" y1="${T}" y2="${H - B}" stroke="#d9dee6" stroke-dasharray="3 3"/>`;
    s += `<text x="${x(m) + 3}" y="${T + 9}" fill="#6b7280" font-size="9.5">${lab}</text>`;
  }
  s += `<line x1="${L}" x2="${W - Rr}" y1="${y(1)}" y2="${y(1)}" stroke="#6b7280" stroke-width=".6"/>`;
  for (const m of [5, 10, 15, 20, 25, 30, 35, 40]) s += `<text x="${x(m)}" y="${H - 8}" fill="#6b7280" font-size="9.5" text-anchor="middle">${m}'</text>`;
  s += `<text x="${L - 6}" y="${T + 10}" fill="#6b7280" font-size="9.5" text-anchor="end">fort</text>`;
  s += `<text x="${L - 6}" y="${H - B}" fill="#6b7280" font-size="9.5" text-anchor="end">faible</text>`;
  let any = false;
  for (const [side, col] of [['red', '#d64552'], ['blue', '#2f6fe0']]) {
    if (!sides.includes(side)) continue;
    const tm = team(side);
    if (!tm.length) continue;
    any = true;
    const pts = powerCurve(tm);
    s += `<polyline fill="none" stroke="${col}" stroke-width="2.6" stroke-linejoin="round" points="${pts.map(([m, v]) => `${x(m)},${y(v)}`).join(' ')}"/>`;
  }
  if (any && sides.includes('blue')) s += `<circle cx="${W - 92}" cy="${T + 6}" r="4" fill="#2f6fe0"/><text x="${W - 84}" y="${T + 10}" fill="#1f2937" font-size="10">Bleu</text>`;
  if (any && sides.includes('red')) s += `<circle cx="${W - 46}" cy="${T + 6}" r="4" fill="#d64552"/><text x="${W - 38}" y="${T + 10}" fill="#1f2937" font-size="10">Rouge</text>`;
  $('scalPick').innerHTML = [['both', 'Les deux'], ['mine', 'Ta compo'], ['theirs', 'Leur compo']]
    .map(([k, l]) => `<button class="chip ${state.scalShow === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
  $('scalPick').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { state.scalShow = b.dataset.k; renderScaling(); }));
  if (!any) s += `<text x="${W / 2}" y="${H / 2}" fill="#6b7280" font-size="12" text-anchor="middle">Les courbes apparaissent avec les picks</text>`;
  svg.innerHTML = s;
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
function addToPool(side, i, name) {
  const c = state.list.find((x) => x.name.toLowerCase() === name.trim().toLowerCase() || x.id.toLowerCase() === name.trim().toLowerCase());
  if (!c) { toast(`Champion introuvable : ${name}`); return; }
  const p = state.players[side][i];
  p.pool ??= [];
  if (p.pool.some((e) => e.id === c.id)) { toast(`${c.name} est déjà dans le pool`); return; }
  p.pool.push({ id: c.id, games: 15, wins: 8, manual: true });
  render();
}
function renderPlayers() {
  for (const side of ['blue', 'red']) {
    const el = $(side === 'blue' ? 'playersBlue' : 'playersRed');
    const list = ensureRoster(side);
    el.innerHTML = list.map((p, i) => {
      const pts = rankPoints(p.rank);
      const g = (p.rank?.wins ?? 0) + (p.rank?.losses ?? 0);
      const shown = (p.pool ?? []).map((e, k) => ({ e, k })).filter(({ e }) => e.manual || fitsRole(e.id, p.role));
      const hidden = (p.pool?.length ?? 0) - shown.length;
      return `
      <div class="prow">
        <select data-i="${i}" class="prole">${ROLES.map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>
        <div class="pid">
          <input class="pinput" data-i="${i}" value="${(p.riotId || '').replace(/"/g, '&quot;')}" placeholder="Nom#TAG" />
          <div class="pinfo">
            ${p.error ? `<span class="perr">⚠ ${p.error}</span>`
              : pts != null ? `<span class="tier" style="--c:${tierColor(pts)}">${pointsLabel(pts)}${p.rank?.tier && p.rank.lp != null ? ` · ${p.rank.lp} LP` : ''}${!p.rank?.tier ? ' (saison passée)' : ''}</span>${g ? `<span class="pwr ${p.rank.wins / g >= 0.5 ? 'up' : 'down'}">${Math.round((p.rank.wins / g) * 100)} %</span><span class="muted">${g} games</span>` : ''}${p.rank?.hot ? '<span title="série de victoires">🔥</span>' : ''}`
              : p.riotId ? '<span class="muted">non classé</span>' : '<span class="muted">joueur non renseigné</span>'}
            ${p.dpm ? `<span class="pdpm" title="${p.dpm}">${/lues/.test(p.dpm) ? 'dpm ✓' : 'dpm —'}</span>` : ''}
          </div>
        </div>
        <div class="ppool">
          ${shown.map(({ e, k }) => `<span class="pchamp ${e.manual ? 'manual' : ''}" title="${state.P[e.id]?.name ?? e.id} : ${e.games} games${e.manual ? ' (ajouté à la main)' : `, ${Math.round((e.wins / e.games) * 100)} %${e.share ? `, ${e.share} % de ses games` : ''}${e.src ? ` (${e.src})` : ''}`} — clic pour retirer" data-i="${i}" data-k="${k}"><img src="${img(e.id)}" alt=""><i>${e.manual ? '+' : e.games}</i></span>`).join('') || '<span class="muted pnone">aucun champion à ce rôle</span>'}
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
    el.querySelectorAll('.pchamp').forEach((ch) => (ch.onclick = () => { state.players[side][+ch.dataset.i].pool.splice(+ch.dataset.k, 1); render(); }));
    el.querySelectorAll('.padd').forEach((inp) => {
      const go = () => { if (inp.value.trim()) { const v = inp.value; inp.value = ''; addToPool(side, +inp.dataset.i, v); } };
      inp.addEventListener('change', go);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
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
  const myBans = state.slots[`${me}Bans`];
  const done = (from, to) => myBans.slice(from, to).filter(Boolean);
  const slots = (from, to) => `<div class="bp-slots">${myBans.slice(from, to).map((id) => (id ? `<img src="${img(id)}" title="${state.P[id].name}">` : '<span></span>')).join('')}</div>`;
  const col = (title, sub, state_, body, from, to) => `<div class="bp-col ${state_}"><div class="bp-h"><b>${title}</b><em>${sub}</em>${slots(from, to)}</div>${body}</div>`;
  const rows = (n) => (list.length ? list.slice(0, n).map((x) => banRow(x, w.k)).join('') : '<p class="muted">Plus rien à bannir : leur équipe est complète.</p>');
  // Les bans de base restent proposés tant que tes slots ne sont pas remplis, même si tu as pické avant de bannir.
  const left1 = 3 - done(0, 3).length, left2 = 2 - done(3, 5).length;
  const p1 = left1 > 0
    ? col('Phase 1', picks === 0 ? 'maintenant · 3 bans' : `bans de base · ${left1} à faire`, 'now', rows(left1 + 2), 0, 3)
    : col('Phase 1', 'faite', 'past', '<p class="muted">Tes 3 bans de phase 1 sont posés.</p>', 0, 3);
  const p2state = left2 <= 0 || picks >= 10 ? 'past' : picks >= 6 ? 'now' : 'next';
  const p2 = col('Phase 2', p2state === 'now' ? `maintenant · ${left2} ban${left2 > 1 ? 's' : ''}` : p2state === 'past' ? 'faite' : 'aperçu : se précise après les 3 premiers picks de chaque équipe', p2state,
    p2state === 'past' ? '<p class="muted">Phase 2 terminée.</p>' : rows(left2 + 1), 3, 5);
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
function openMenu() {
  $('startMenu').hidden = false;
  $('startForm').hidden = true; $('startChoices').hidden = false;
  $('menuBlue').value = state.teamInput.blue ?? ''; $('menuRed').value = state.teamInput.red ?? '';
  $('menuSide').value = state.mySide; $('menuRegion').value = state.region;
  const saves = readSaves().slice(0, 4);
  $('menuSaves').innerHTML = saves.length ? `<div class="muted">Reprendre une draft sauvegardée :</div>` +
    saves.map((d) => `<button class="msave" data-id="${d.id}">${d.name.replace(/</g, '&lt;')}</button>`).join('') : '';
  $('menuSaves').querySelectorAll('.msave').forEach((b) => (b.onclick = () => { loadDraft(+b.dataset.id); closeMenu(); }));
}
const closeMenu = () => { $('startMenu').hidden = true; };
function startFromZero() {
  state.players = { blue: [], red: [] }; state.teamInput = { blue: '', red: '' }; state.flow = 'zero';
  $('opggBlue').value = ''; $('opggRed').value = '';
  reset(); closeMenu();
  toast('Draft de zéro : bans et plan de jeu selon la méta du patch');
}
async function startFromPlayers() {
  const blue = $('menuBlue').value.trim(), red = $('menuRed').value.trim();
  if (!blue && !red) { toast('Colle au moins un lien multi op.gg'); return; }
  state.region = $('menuRegion').value; $('region').value = state.region;
  state.mySide = $('menuSide').value; $('mySide').value = state.mySide;
  savePrefs();
  $('opggBlue').value = blue; $('opggRed').value = red;
  state.flow = 'players';
  reset();
  const go = $('menuGo'); go.disabled = true; go.textContent = 'Chargement des joueurs…';
  await Promise.all([loadTeam('blue'), loadTeam('red')]);
  go.disabled = false; go.textContent = 'Lancer la draft';
  $('playersBox').open = true;
  closeMenu();
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
    slots: structuredClone(state.slots), roles: structuredClone(state.roles), history: structuredClone(state.history),
    players: structuredClone(state.players), teamInput: { ...state.teamInput }
  };
  const same = list.findIndex((x) => x.name === name);
  if (same >= 0) list[same] = { ...entry, id: list[same].id }; else list.unshift(entry);
  if (writeSaves(list)) { $('saveName').value = ''; toast(same >= 0 ? `« ${name} » mise à jour` : `« ${name} » sauvegardée`); renderSaves(); }
}
function loadDraft(id) {
  const d = readSaves().find((x) => x.id === id);
  if (!d) return;
  Object.assign(state, {
    mySide: d.mySide, slots: d.slots, roles: d.roles, history: d.history ?? [],
    players: d.players ?? { blue: [], red: [] }, teamInput: d.teamInput ?? { blue: '', red: '' }, selected: null,
    flow: d.flow ?? ([...(d.players?.blue ?? []), ...(d.players?.red ?? [])].some((p) => p.riotId || p.pool?.length) ? 'players' : 'zero')
  });
  $('mySide').value = state.mySide;
  $('opggBlue').value = state.teamInput.blue ?? ''; $('opggRed').value = state.teamInput.red ?? '';
  savePrefs();
  ingest(state.data);
  toast(`« ${d.name} » chargée`);
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

const WHO = { mine: ['toi', 'up'], theirs: ['eux', 'down'], even: ['disputé', ''], skip: ['à échanger', 'muted'], unknown: ['?', 'muted'] };

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
  return `<svg viewBox="0 0 220 220" class="minimap"><defs><marker id="jarr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#1f2937"/></marker></defs>${s}</svg>`;
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
    return `<div class="ln ${l.state}"><span class="ln-n">${LN[k]}</span><span class="ln-p">${pics(l.mine)}</span><b>${l.state === 'inconnu' ? '—' : l.state === 'fort' ? 'Côté fort' : l.state === 'faible' ? 'Côté faible' : 'Égal'}</b><span class="ln-p">${pics(l.theirs)}</span></div>`;
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
  const synM = teamSynergy(mine.map((x) => x.c)).pairs.slice(0, 4), synT = teamSynergy(theirs.map((x) => x.c)).pairs.slice(0, 2);
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

function renderSources() {
  const s = state.data.sources, el = $('sources');
  const items = [
    ['ddragon', 'Riot', 'https://developer.riotgames.com/docs/lol#data-dragon'],
    ['lolalytics', 'lolalytics', 'https://lolalytics.com'],
    ['golgg', 'gol.gg', 'https://gol.gg/esports/home/']
  ];
  el.innerHTML = '';
  for (const [k, label, url] of items) {
    const st = s[k] ?? {};
    const b = document.createElement('span');
    // Clignote seulement s'il n'y a encore AUCUNE donnée ; sinon la mise à jour se fait en silence.
    b.className = 'src ' + (st.loading && !st.ok ? 'loading' : st.ok ? 'ok' : st.cached ? 'cached' : 'ko');
    const when = st.at ? new Date(st.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'fournies avec l’app';
    b.title = st.loading ? (st.ok ? `Données utilisables (${when}), vérification d’une mise à jour en fond…` : 'Premier chargement en cours…') : st.ok ? `À jour (${when})${st.patch && st.patch !== state.data.patch ? ` — stats du patch ${st.patch}, le patch ${state.data.patch} n’a pas encore assez de parties` : ''}` : st.cached ? `Hors ligne, cache du ${when} : ${st.error}` : `Indisponible : ${st.error ?? 'inconnu'}`;
    b.textContent = label;
    b.onclick = () => api.open(url);
    el.appendChild(b);
  }
  $('patchPill').textContent = `Patch ${state.data.patch}`;
}

// ---------- Chargement ----------
function ingest(data) {
  if (data?.error) { toast(data.error); return; }
  const prevPatch = state.data?.patch;
  state.data = data;
  state.P = buildProfiles(data.champions, data.stats, data.pro, state.mode);
  state.list = Object.values(state.P).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  renderSources();
  $('champList').innerHTML = state.list.map((c) => `<option value="${c.name}"></option>`).join('');
  if (prevPatch && prevPatch !== data.patch) toast(`Nouveau patch ${data.patch} détecté — données mises à jour`);
  render();
}

async function load(force = false) {
  if (!state.data) $('patchPill').textContent = 'Chargement…';
  if (force) { $('refresh').disabled = true; $('refresh').textContent = '⟳ …'; }
  try { ingest(await (force ? api.refresh({ tier: state.tier }) : api.load({ tier: state.tier }))); if (force) toast('Données actualisées'); }
  catch (e) { toast('Erreur de chargement : ' + e.message); }
  finally { $('refresh').disabled = false; $('refresh').textContent = '⟳ Données'; }
}

function initControls() {
  $('mySide').onchange = (e) => { state.mySide = e.target.value; savePrefs(); render(); };
  $('undo').onclick = undo; $('reset').onclick = openMenu; $('menuBtn').onclick = openMenu;
  $('startZero').onclick = startFromZero;
  $('startPlayers').onclick = () => { $('startChoices').hidden = true; $('startForm').hidden = false; $('menuBlue').focus(); };
  $('menuBack').onclick = () => { $('startForm').hidden = true; $('startChoices').hidden = false; };
  $('menuGo').onclick = startFromPlayers;
  $('menuClose').onclick = closeMenu; $('refresh').onclick = () => load(true);
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
    if (e.key === 'Escape') { if (!$('startMenu').hidden && state.data) closeMenu(); state.selected = null; render(); }
    if (e.key === 'Enter' && document.activeElement === $('search')) {
      const first = $('grid').querySelector('.tile:not(.used)'); first?.click(); $('search').value = ''; state.search = '';
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
function initUpdates() {
  if (!api.version) { $('verPill').hidden = true; return; }
  api.version().then((v) => { $('verPill').textContent = 'v' + v; });
  const show = (st) => {
    if (!st) return;
    const pill = $('verPill');
    pill.classList.toggle('busy', st.status === 'downloading');
    pill.classList.toggle('new', st.status === 'ready');
    pill.title = st.status === 'uptodate' ? `Version ${st.current} : à jour` : st.status === 'downloading' ? `Téléchargement de la version ${st.version}…`
      : st.status === 'ready' ? `Version ${st.version} installée : redémarre pour l’utiliser` : st.status === 'off' ? st.message : `Mise à jour : ${st.message ?? ''}`;
    if (st.status === 'ready') {
      const b = $('updRestart');
      b.textContent = `⟳ Redémarrer (v${st.version})`;
      b.title = `Version ${st.version} installée${st.notes ? ' : ' + st.notes : ''}. Redémarre pour l’utiliser.`;
      b.hidden = false;
      toast(`Nouvelle version ${st.version} prête : clique sur « Redémarrer » en haut`);
    }
  };
  api.lastUpdate?.().then(show);
  api.onUpdate?.(show);
  $('verPill').onclick = () => { toast('Recherche de mise à jour…'); api.checkUpdate().then(() => api.lastUpdate().then((st) => {
    if (st?.status === 'uptodate') toast(`Draft Lab est à jour (v${st.current})`);
    else if (st?.status === 'off') toast(st.message);
    else if (st?.status === 'error') toast('Mise à jour impossible : ' + st.message);
  })); };
  $('updRestart').onclick = () => api.restart();
}

initControls();
initUpdates();
openMenu();
load();
