// Games pro récentes (gol.gg) : pour chaque game, le patch, l'ordre des picks des deux équipes,
// les rôles, la date et le vainqueur. Sert à calculer, sur les 30 derniers jours (depuis son dernier
// changement pour un champion modifié pendant ces 30 jours) :
//  - le winrate pro de chaque champion,
//  - les « réponses » : quel champion a été pris APRÈS un autre, en face à la même lane, et qui a gagné.
// Les games déjà lues sont gardées en cache : seules les nouvelles sont téléchargées.
const { get, norm } = require('./http');

const BASE = 'https://gol.gg';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function parseGame(html) {
  const patch = (html.match(/text-right">\s*v(\d+\.\d+)/) || [])[1] || null;
  const date = (html.match(/\b(20\d\d-\d\d-\d\d)\b/) || [])[1] || null;
  const hd = [...html.matchAll(/(blue|red)-line-header">[\s\S]*?- (WIN|LOSS)\s*</g)].slice(0, 2);
  const win = hd.find((h) => h[2] === 'WIN')?.[1] ?? null;
  const secs = [...html.matchAll(/<div class="col-2">\s*(Bans|Picks)/g)].map((m) => ({ k: m[1], i: m.index }));
  const med = (a, b) => [...html.slice(a, b).matchAll(/class='champion_icon_medium rounded-circle' alt='[^']*' src='\.\.\/_img\/champions_icon\/([A-Za-z0-9]+)\.png'/g)].map((m) => m[1]);
  const picks = secs.map((s, j) => ({ k: s.k, c: med(s.i, secs[j + 1]?.i ?? s.i + 6000) })).filter((s) => s.k === 'Picks').map((s) => s.c);
  const roles = [...html.matchAll(/class='champion_icon rounded-circle' alt='[^']*' src='\.\.\/_img\/champions_icon\/([A-Za-z0-9]+)\.png'/g)].map((m) => m[1]).slice(0, 10);
  if (!patch || !win || picks.length !== 2 || picks[0].length !== 5 || picks[1].length !== 5 || roles.length !== 10) return null;
  return { patch, date, win, bp: picks[0], rp: picks[1], br: roles.slice(0, 5), rr: roles.slice(5) };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch {} }
  }));
}

async function listTournaments(season) {
  const res = await fetch(`${BASE}/tournament/ajax.trlist.php`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/tournament/list/` },
    body: `season=${season}`
  });
  if (!res.ok) throw new Error(`gol.gg ${res.status}`);
  return res.json();
}

// known = { games: {id: game}, matches: [ids déjà lus] }
async function fetchProGames(champions, known = {}, { days = 31 } = {}) {
  // v2 : chaque game porte sa date (fenêtre des 30 derniers jours) ; l'ancien cache sans date est relu
  if (known.v !== 2) known = {};
  const idx = new Map();
  for (const c of champions) { idx.set(norm(c.id), c.id); idx.set(norm(c.name), c.id); }
  idx.set('wukong', 'MonkeyKing');
  const toId = (n) => idx.get(norm(n)) ?? null;
  const season = `S${new Date().getFullYear() - 2010}`;
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const tl = (await listTournaments(season)).filter((t) => t.lastgame >= since);
  const games = { ...(known.games ?? {}) };
  const doneMatches = new Set(known.matches ?? []);
  const matchIds = new Map(); // id -> tournoi encore en cours (on relira ses matchs)
  const live = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  await pool(tl, 4, async (t) => {
    const h = await get(`${BASE}/tournament/tournament-matchlist/${encodeURIComponent(t.trname)}/`, { type: 'text' });
    // une ligne par match : lien, …, patch, date — les matchs plus anciens que la fenêtre sont ignorés
    for (const row of h.split('<tr>')) {
      const id = (row.match(/game\/stats\/(\d+)\/page-summary/) || [])[1];
      const d = (row.match(/>(20\d\d-\d\d-\d\d)</) || [])[1];
      if (id && (!d || d >= since)) matchIds.set(+id, t.lastgame >= live);
    }
  });
  // un match terminé depuis plus de 2 jours ne change plus : on ne le relit pas
  const gameIds = new Set();
  const todo = [...matchIds.keys()].filter((id) => !doneMatches.has(id));
  await pool(todo, 6, async (id) => {
    const h = await get(`${BASE}/game/stats/${id}/page-summary/`, { type: 'text' });
    for (const m of h.matchAll(/game\/stats\/(\d+)\/page-game/g)) gameIds.add(+m[1]);
    if (!matchIds.get(id)) doneMatches.add(id);
  });
  await pool([...gameIds].filter((id) => !games[id]), 6, async (id) => {
    const g = parseGame(await get(`${BASE}/game/stats/${id}/page-game/`, { type: 'text' }));
    if (!g) return;
    const map = (arr) => arr.map(toId);
    const out = { patch: g.patch, d: g.date, win: g.win, bp: map(g.bp), rp: map(g.rp), br: map(g.br), rr: map(g.rr) };
    if ([...out.bp, ...out.rp, ...out.br, ...out.rr].every(Boolean)) games[id] = out;
  });
  // on ne garde que les games de la fenêtre (environ 1500 max, les plus récentes)
  const keep = Object.keys(games).map(Number).filter((id) => !games[id].d || games[id].d >= since).sort((a, b) => b - a).slice(0, 1500);
  return { v: 2, games: Object.fromEntries(keep.map((id) => [id, games[id]])), matches: [...doneMatches].slice(-2000) };
}

module.exports = { fetchProGames, parseGame };
