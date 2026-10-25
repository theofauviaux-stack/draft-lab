// Panneau affiché par-dessus le jeu (overlay) : uniquement des infos connues avant la partie ou visibles
// par tout le monde (plan de match, côtés fort / faible, priorités d'objectifs, premières apparitions
// des objectifs, phase de jeu). Aucun timer ennemi ni information cachée : règles des applis tierces de Riot.
// Utilisé par la fenêtre overlay de l'application et par l'aperçu.
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// premières apparitions (saison 2026) : drake 5:00, Larves 8:00 (jusqu'à 14:45), Héraut 15:00 (jusqu'à 19:45), Baron 20:00
const SPAWNS = [
  { k: 'drake', at: 300, name: 'Drake' },
  { k: 'grubs', at: 480, name: 'Larves', until: 885, up: 'apparues' },
  { k: 'herald', at: 900, name: 'Héraut', until: 1185, up: 'apparu' },
  { k: 'baron', at: 1200, name: 'Baron' }
];
const LANE = { T: 'Top', M: 'Mid', B: 'Bot' };
const ST = { fort: ['up', 'Fort'], faible: ['down', 'Faible'], 'égal': ['eq', 'Égal'], inconnu: ['na', '—'] };

export function gameSeconds(d, now = Date.now()) {
  if (d?.time == null) return null;
  return d.time + (d.at ? (now - d.at) / 1000 : 0);
}

export function overlayHtml(d, now = Date.now()) {
  if (!d) return `<div class="ov"><div class="ov-h"><b>◆ Draft Lab</b></div><p class="ov-empty">En attente de la partie…</p></div>`;
  const t = gameSeconds(d, now);
  const phase = t == null ? d.phases?.[0] : d.phases?.[t < 840 ? 0 : t < 1500 ? 1 : 2];
  const lanes = ['T', 'M', 'B'].map((k) => { const l = d.lanes?.[k] ?? { state: 'inconnu' }; const [c, lab] = ST[l.state] ?? ST.inconnu; return `<div class="ov-ln ${c}"><span>${LANE[k]}</span><b>${lab}</b></div>`; }).join('');
  const objs = SPAWNS.map((o) => {
    const p = d.obj?.[o.k];
    if (!p) return '';
    let when = '';
    if (t != null) {
      if (t < o.at) when = `<em>${fmt(o.at)} · dans ${fmt(o.at - t)}</em>`;
      else if (o.until && t > o.until) return '';
      else if (o.k !== 'drake' && o.k !== 'baron' && t >= o.at) when = `<em>${o.up}</em>`;
    } else when = `<em>${fmt(o.at)}</em>`;
    return `<div class="ov-o ${p[0]}"><span>${o.name}</span>${when}<b>${esc(p[1])}</b></div>`;
  }).join('');
  const who = phase ? (phase.diff > 0.06 ? ['up', 'Avantage toi'] : phase.diff < -0.06 ? ['down', 'Avantage eux'] : ['eq', 'Équilibré']) : null;
  return `<div class="ov">
    <div class="ov-h"><b>◆ Draft Lab</b>${t != null ? `<span class="ov-t">${fmt(t)}</span>` : ''}${d.wr != null ? `<span class="ov-wr ${d.wr >= 50 ? 'up' : 'down'}">${d.wr.toFixed(0)} %</span>` : ''}</div>
    ${phase ? `<div class="ov-ph"><div><b>${esc(phase.name)}</b><small>${esc(phase.range)}</small><em class="${who[0]}">${who[1]}</em></div>${phase.tip ? `<p>${esc(phase.tip)}</p>` : ''}</div>` : ''}
    <div class="ov-sec">Lanes${d.strong ? ` · côté fort : <b>${esc(d.strong)}</b>` : ''}</div>
    <div class="ov-lanes">${lanes}</div>
    <div class="ov-sec">Objectifs</div>
    <div class="ov-objs">${objs}</div>
    ${d.me ? `<div class="ov-sec">Ta lane · ${esc(d.me.name)}${d.me.vs ? ` contre ${esc(d.me.vs)}` : ''}</div><p class="ov-tip">${esc(d.me.tip ?? '')}</p>` : ''}
    <div class="ov-f">Ctrl+Maj+D masquer · Ctrl+Maj+F déplacer</div>
  </div>`;
}

export const OVERLAY_CSS = `
.ov { font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e9e4d6; width: 300px; padding: 10px 12px 8px;
  background: rgba(10, 14, 22, .86); border: 1px solid rgba(200, 164, 92, .55); border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.45); display: flex; flex-direction: column; gap: 6px; }
.ov-h { display: flex; align-items: center; gap: 8px; }
.ov-h b { color: #c8a45c; letter-spacing: .02em; flex: 1; }
.ov-t { font-variant-numeric: tabular-nums; color: #cfd6e4; }
.ov-wr { font-weight: 800; padding: 1px 6px; border-radius: 6px; background: rgba(255,255,255,.06); }
.ov .up { color: #4fd18b; } .ov .down { color: #ff6b77; } .ov .eq { color: #cfd6e4; } .ov .na { color: #7c8698; }
.ov-ph { background: rgba(255,255,255,.05); border-radius: 8px; padding: 6px 8px; }
.ov-ph > div { display: flex; align-items: baseline; gap: 6px; }
.ov-ph small { color: #8f99ab; flex: 1; } .ov-ph em { font-style: normal; font-weight: 700; }
.ov-ph p { margin: 4px 0 0; color: #cfd6e4; }
.ov-sec { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #8f99ab; margin-top: 2px; }
.ov-sec b { color: #c8a45c; text-transform: none; letter-spacing: 0; font-size: 12px; }
.ov-lanes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.ov-ln { display: flex; flex-direction: column; align-items: center; padding: 4px; border-radius: 7px; background: rgba(255,255,255,.05); }
.ov-ln span { font-size: 10px; color: #8f99ab; text-transform: uppercase; }
.ov-ln.up { box-shadow: inset 0 -2px 0 #4fd18b; } .ov-ln.down { box-shadow: inset 0 -2px 0 #ff6b77; }
.ov-objs { display: flex; flex-direction: column; gap: 3px; }
.ov-o { display: grid; grid-template-columns: 56px 1fr auto; align-items: baseline; gap: 6px; padding: 3px 6px; border-radius: 6px; background: rgba(255,255,255,.04); }
.ov-o span { font-weight: 700; } .ov-o b { text-align: right; } .ov-o em { font-style: normal; color: #8f99ab; font-variant-numeric: tabular-nums; }
.ov-o.high b { color: #4fd18b; } .ov-o.low b { color: #ff9aa3; } .ov-o.mid b { color: #e8c877; }
.ov-tip { margin: 0; color: #cfd6e4; }
.ov-f { font-size: 10px; color: #6f7a8e; text-align: right; }
.ov-empty { margin: 4px 0; color: #8f99ab; }
`;

// Calque posé sur la mini-carte du jeu : lanes fortes / faibles, trajet conseillé du jungler, priorités du
// drake et des Larves. Orienté comme le jeu (bleu en bas à gauche, rouge en haut à droite). Transparent
// pour laisser voir la vraie mini-carte dessous ; aucune position de joueur (infos de plan seulement).
export function minimapLayerHtml(d) {
  if (!d) return '';
  const col = (st) => (st === 'fort' ? '#3ddc84' : st === 'faible' ? '#ff5d6c' : st === 'égal' ? '#e8c877' : 'transparent');
  const L = d.lanes ?? {}, red = d.side === 'red';
  const P = (x, y) => (red ? `${y},${x}` : `${x},${y}`);
  const lane = (path, st) => `<path d="${path}" stroke="${col(st)}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>`;
  let s = lane('M20,200 L20,20 L200,20', L.T?.state) + lane('M26,194 L194,26', L.M?.state) + lane('M20,200 L200,200 L200,20', L.B?.state);
  const tag = (x, y, t, st) => st && st !== 'inconnu' ? `<g><rect x="${x - 24}" y="${y - 9}" width="48" height="15" rx="4" fill="rgba(8,12,18,.72)"/><text x="${x}" y="${y + 2}" text-anchor="middle" font-size="9.5" font-weight="800" fill="${col(st)}">${t}</text></g>` : '';
  const word = (st) => (st === 'fort' ? 'FORT' : st === 'faible' ? 'FAIBLE' : 'ÉGAL');
  s += tag(38, 112, word(L.T?.state), L.T?.state) + tag(110, 96, word(L.M?.state), L.M?.state) + tag(150, 190, word(L.B?.state), L.B?.state);
  if (d.jg && d.strong && d.strong !== 'mid') {
    const toBot = d.strong === 'bot';
    const path = toBot ? `M${P(70, 95)} C${P(95, 120)} ${P(110, 140)} ${P(140, 158)}` : `M${P(140, 125)} C${P(115, 100)} ${P(100, 80)} ${P(78, 62)}`;
    s += `<path d="${path}" stroke="#ffffff" stroke-width="3" fill="none" stroke-dasharray="6 5" marker-end="url(#ar)" opacity=".85"/>`;
  }
  const pr = (p) => (p?.[0] === 'high' ? '#3ddc84' : p?.[0] === 'low' ? '#ff5d6c' : '#e8c877');
  const pit = (x, y, p, t) => p ? `<g><circle cx="${x}" cy="${y}" r="13" fill="none" stroke="${pr(p)}" stroke-width="3" opacity=".9"/><text x="${x}" y="${y + 25}" text-anchor="middle" font-size="9" font-weight="800" fill="${pr(p)}" stroke="rgba(0,0,0,.7)" stroke-width="2.5" paint-order="stroke">${t}</text></g>` : '';
  s += pit(150, 150, d.obj?.drake, 'DRAKE') + pit(70, 70, d.obj?.grubs, 'LARVES');
  return `<svg viewBox="0 0 220 220" width="100%" height="100%" preserveAspectRatio="none" style="display:block"><defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#fff"/></marker></defs>${s}</svg>`;
}
