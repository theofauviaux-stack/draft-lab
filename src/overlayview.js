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
