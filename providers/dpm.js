// dpm.lol : champions joués en Ranked Solo et en Flex (saison en cours).
// dpm.lol est derrière Cloudflare : on charge le site dans une fenêtre Chromium cachée
// (qui passe la vérification comme un vrai navigateur), puis on appelle son API interne
// depuis cette page :  /v1/players/search?gameName=&tagLine=  →  puuid
//                      /v1/players/{puuid}/champions?queue=solo|flex&currentSplit=true
// Un joueur jamais consulté sur dpm.lol peut ne pas avoir de données : on renvoie alors null.
let win = null, ready = null;

function getWindow() {
  const { BrowserWindow } = require('electron');
  if (win && !win.isDestroyed()) return ready;
  win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { sandbox: true, contextIsolation: true } });
  ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dpm.lol ne répond pas')), 30000);
    win.webContents.once('did-finish-load', () => setTimeout(() => { clearTimeout(t); resolve(); }, 2500));
    win.webContents.once('did-fail-load', (_e, code, desc) => { clearTimeout(t); reject(new Error(desc || `erreur ${code}`)); });
  });
  win.loadURL('https://dpm.lol/');
  ready.catch(() => { try { win.destroy(); } catch {} win = null; });
  return ready;
}

async function fetchDpm(riotId) {
  const [gameName, tagLine] = String(riotId).split('#');
  if (!gameName || !tagLine) return null;
  await getWindow();
  const code = `(async () => {
    const s = await fetch('/v1/players/search?gameName=' + encodeURIComponent(${JSON.stringify(gameName)}) + '&tagLine=' + encodeURIComponent(${JSON.stringify(tagLine)}));
    if (!s.ok) return { error: 'joueur introuvable sur dpm.lol (' + s.status + ')' };
    const p = await s.json();
    if (!p.puuid) return { error: 'joueur introuvable sur dpm.lol' };
    const get = async (q) => { const r = await fetch('/v1/players/' + p.puuid + '/champions?queue=' + q + '&currentSplit=true'); return r.ok ? r.json() : []; };
    const [solo, flex] = await Promise.all([get('solo'), get('flex')]);
    const slim = (arr) => (Array.isArray(arr) ? arr : []).map((c) => ({ id: c.championId, games: c.gamesPlayed, wins: c.win }));
    const gn = p.gameName ?? p.riotIdGameName ?? p.game_name ?? null, tl = p.tagLine ?? p.riotIdTagline ?? p.tag_line ?? null;
    return { solo: slim(solo), flex: slim(flex), riotId: gn && tl ? gn + '#' + tl : null };
  })()`;
  const res = await Promise.race([
    win.webContents.executeJavaScript(code),
    new Promise((_, rej) => setTimeout(() => rej(new Error('dpm.lol trop lent')), 20000))
  ]);
  return res;
}

// Ajoute les données dpm.lol (solo + flex) au pool op.gg d'un joueur.
// Les deux sites comptent les mêmes games : pour chaque champion on garde le plus grand nombre de games connu.
function mergePool(player, dpm, byKey) {
  if (!dpm || dpm.error) return { ...player, dpm: dpm?.error ?? 'pas de données dpm.lol' };
  const sum = {};
  for (const c of [...dpm.solo, ...dpm.flex]) {
    const id = byKey.get(String(c.id));
    if (!id || !c.games) continue;
    const s = (sum[id] ??= { games: 0, wins: 0 });
    s.games += c.games; s.wins += c.wins ?? 0;
  }
  const dpmTotal = Object.values(sum).reduce((a, x) => a + x.games, 0);
  if (!dpmTotal) return { ...player, dpm: 'aucune game solo / flex enregistrée sur dpm.lol' };
  const map = new Map((player.pool ?? []).map((e) => [e.id, { ...e }]));
  for (const [id, s] of Object.entries(sum)) {
    const cur = map.get(id);
    if (!cur || s.games > cur.games) map.set(id, { id, games: s.games, wins: s.wins, src: cur ? 'op.gg + dpm' : 'dpm.lol' });
  }
  const total = Math.max(player.total || 0, dpmTotal);
  const allMap = new Map((player.all ?? []).map((e) => [e.id, e]));
  for (const e of map.values()) { const a = allMap.get(e.id); if (!a || e.games > a.games) allMap.set(e.id, e); }
  const all = [...allMap.values()];
  const pool = [...map.values()]
    .map((e) => ({ ...e, share: +((e.games / total) * 100).toFixed(1) }))
    .filter((e) => e.manual || e.share >= 1)
    .sort((a, b) => b.games - a.games);
  return { ...player, pool, all, total, dpm: `${dpmTotal} games solo + flex lues sur dpm.lol` };
}

module.exports = { fetchDpm, mergePool };
