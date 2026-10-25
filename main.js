// Processus principal Electron : fenêtre, cache disque, synchronisation des données.
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchDDragon } = require('./providers/ddragon');
const { fetchLolalytics, fetchDetail } = require('./providers/lolalytics');
const { fetchGolgg } = require('./providers/golgg');
const { fetchTeam, fetchPlayers, fetchPlayer } = require('./providers/opgg');
const { fetchDpm, mergePool } = require('./providers/dpm');
const { autoUpdate } = require('./providers/updater');
const { fetchProGames } = require('./providers/progames');
const { fetchPatchChanges } = require('./providers/patches');
const { startLive, stopLive, matchResults, lobbyPlayers } = require('./providers/live');

const HOUR = 3600 * 1000;
const STALE = { patches: 6 * HOUR, lolalytics: 6 * HOUR, golgg: 12 * HOUR, progames: 4 * HOUR };
const CHECK_EVERY = 2 * HOUR; // vérification automatique d'un nouveau patch

let win;
let cache = {};
let lastTier = 'emerald_plus';
let busy = null;

const cacheFile = () => path.join(app.getPath('userData'), 'draftlab-cache.json');
function loadCache() {
  try { cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { cache = {}; }
  // Premier lancement : données livrées avec l'app, pour que tout marche tout de suite.
  // Elles sont remplacées dès que la synchronisation en fond a réussi.
  if (!cache.ddragon || !cache.golgg || !cache.lolalytics || !cache.progames || !cache.patches) {
    try {
      const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'seed.json'), 'utf8'));
      for (const k of ['ddragon', 'lolalytics', 'golgg', 'progames', 'patches']) {
        if (!cache[k]) cache[k] = { ...seed[k], at: 0 }; // at: 0 => considéré comme à rafraîchir
      }
    } catch {}
  }
}
function saveCache() {
  try { fs.writeFileSync(cacheFile(), JSON.stringify(cache)); } catch (e) { console.error(e); }
}

async function sync({ force = false, tier = lastTier } = {}) {
  if (busy) return busy;
  busy = (async () => {
    lastTier = tier;
    const sources = {};
    const now = Date.now();

    // 1) Patch + champions (officiel Riot)
    let patchChanged = false;
    try {
      const dd = await fetchDDragon();
      patchChanged = !!cache.ddragon && cache.ddragon.version !== dd.version;
      cache.ddragon = { ...dd, at: now };
      sources.ddragon = { ok: true, at: now };
    } catch (e) {
      sources.ddragon = { ok: !!cache.ddragon, at: cache.ddragon?.at, error: e.message, cached: !!cache.ddragon };
    }
    if (!cache.ddragon) {
      return { error: 'Impossible de récupérer la liste des champions (Data Dragon). Vérifie ta connexion.', sources };
    }
    const { patch, champions } = cache.ddragon;

    // 1 bis) notes de patch : champions modifiés pendant les 30 derniers jours (et à quel patch)
    const patchFresh = cache.patches?.v === 1 && cache.patches.patch === patch && now - cache.patches.at < STALE.patches;
    if (force || patchChanged || !patchFresh) {
      try {
        const r = await fetchPatchChanges(cache.ddragon.versions ?? [cache.ddragon.version], champions, now);
        cache.patches = { v: 1, at: now, patch, ...r };
        sources.patches = { ok: true, at: now };
      } catch (e) {
        sources.patches = { ok: !!cache.patches?.changed, error: e.message, at: cache.patches?.at, cached: !!cache.patches };
      }
    }
    const changed = cache.patches?.changed ?? {};

    // 2) lolalytics (winrates soloQ par rôle) et 3) gol.gg (méta pro), en parallèle
    const lk = lolaKey(patch, tier);
    const lolaFresh = cache.lolalytics?.key === lk && now - cache.lolalytics.at < STALE.lolalytics;
    const golFresh = cache.golgg?.v === 2 && now - cache.golgg.at < STALE.golgg;
    await Promise.all([
      (async () => {
        if (!force && !patchChanged && lolaFresh) {
          sources.lolalytics = { ok: true, at: cache.lolalytics.at, patch: cache.lolalytics.patch };
          return;
        }
        try {
          const r = await fetchLolalytics(patch, tier, champions, changed, dataWindows());
          cache.lolalytics = { key: lk, tier, at: now, stats: r.stats, patch: r.patch };
          sources.lolalytics = { ok: true, at: now, patch: r.patch };
          partial(tier, sources);
        } catch (e) {
          sources.lolalytics = { ok: false, error: e.message, at: cache.lolalytics?.at, cached: cache.lolalytics?.key === lk };
        }
      })(),
      (async () => {
        // 4) games pro récentes : ordre des picks, patch et vainqueur (seules les nouvelles sont lues)
        const fresh = cache.progames?.v === 2 && cache.progames?.at && now - cache.progames.at < STALE.progames;
        if (!force && fresh) { sources.progames = { ok: true, at: cache.progames.at }; return; }
        try {
          const r = await fetchProGames(champions, cache.progames ?? {});
          cache.progames = { v: r.v, at: now, games: r.games, matches: r.matches };
          sources.progames = { ok: true, at: now };
          partial(tier, sources);
        } catch (e) {
          sources.progames = { ok: !!cache.progames?.games, error: e.message, at: cache.progames?.at, cached: !!cache.progames };
        }
      })(),
      (async () => {
        if (!force && !patchChanged && golFresh) { sources.golgg = { ok: true, at: cache.golgg.at }; return; }
        try {
          const r = await fetchGolgg(champions);
          cache.golgg = { v: 2, at: now, pro: r.pro, season: r.season };
          sources.golgg = { ok: true, at: now };
          partial(tier, sources);
        } catch (e) {
          sources.golgg = { ok: false, error: e.message, at: cache.golgg?.at, cached: !!cache.golgg };
        }
      })()
    ]);

    saveCache();
    return { ...snapshot(tier, sources), patchChanged };
  })();
  try { return await busy; } finally { busy = null; }
}

// Envoie à l'écran chaque source dès qu'elle est prête, sans attendre les autres.
function partial(tier, sources) {
  if (!win || win.isDestroyed() || !cache.ddragon) return;
  const pending = { ...sources };
  for (const k of ['ddragon', 'lolalytics', 'golgg']) if (!pending[k]) pending[k] = { ok: true, loading: true, at: cache[k]?.at };
  win.webContents.send('data:updated', snapshot(tier, pending));
}

// Données disponibles tout de suite (cache), pendant que la synchro tourne en fond.
// Patchs des 30 derniers jours, du plus récent au plus ancien, avec leur poids : le patch en cours compte
// plein, le précédent ×0,6, celui d'avant ×0,35 (seulement s'il était encore en jeu il y a 30 jours).
const WIN_W = [1, 0.6, 0.35];
function dataWindows() {
  const cur = cache.ddragon?.patch;
  const list = (cache.patches?.patches ?? []).filter((x) => x.patch);
  const from = cache.patches?.from ?? Date.now() - 30 * 864e5;
  const out = [];
  for (const x of list) { out.push(x.patch); if (x.start <= from || out.length >= 3) break; }
  if (!out.length && cur) { const [M, m] = cur.split('.').map(Number); out.push(cur); if (m > 1) out.push(`${M}.${m - 1}`); }
  return out.slice(0, 3).map((patch, i) => ({ patch, w: WIN_W[i] }));
}
// Clé du cache lolalytics : patch, niveau et liste des champions modifiés (la fenêtre de chacun en dépend)
function lolaKey(patch, tier) {
  const ch = cache.patches?.changed ?? {};
  return `${patch}|${tier}|w${dataWindows().map((x) => x.patch).join('-')}|` + Object.keys(ch).sort().map((k) => `${k}:${ch[k]}`).join(',');
}
function snapshot(tier, sources) {
  const { version, patch, champions } = cache.ddragon;
  const L = cache.lolalytics;
  return {
    version, patch, champions, tier,
    // données en cache du même niveau, même un peu anciennes, en attendant la synchro
    stats: L && (L.tier ?? L.key?.split('|')[1]) === tier ? L.stats : {},
    changes: cache.patches?.changed ?? {},
    window: { days: 30, from: cache.patches?.from ?? null, patches: (cache.patches?.patches ?? []).map(({ patch: p, label, start }) => ({ patch: p, label, start })) },
    pro: cache.golgg?.pro ?? {},
    progames: cache.progames?.games ?? {},
    sources
  };
}

async function quickLoad(tier) {
  const pushWhenDone = () =>
    sync({ tier }).then((d) => { if (win && !win.isDestroyed()) win.webContents.send('data:updated', d); });
  if (!cache.ddragon) {
    // premier lancement : on attend seulement Riot (rapide), le reste arrive en fond
    try { cache.ddragon = { ...(await fetchDDragon()), at: Date.now() }; }
    catch (e) { return { error: 'Impossible de récupérer la liste des champions (Data Dragon). Vérifie ta connexion.' }; }
  }
  const lk = lolaKey(cache.ddragon.patch, tier);
  const loading = { loading: true };
  const snap = snapshot(tier, {
    ddragon: { ok: true, at: cache.ddragon.at },
    lolalytics: cache.lolalytics?.key === lk ? { ok: true, at: cache.lolalytics.at, patch: cache.lolalytics.patch, ...loading } : loading,
    golgg: cache.golgg ? { ok: true, at: cache.golgg.at, ...loading } : loading
  });
  pushWhenDone();
  return snap;
}

// ---- Taille de la fenêtre : plein écran, fenêtré (libre, en 16:9) ou tailles fixes ----
// L'interface est toujours dessinée pour 1600 px de large puis mise à l'échelle :
// elle reste identique (rien ne se décale), quelle que soit la taille choisie.
const BASE_W = 1600;
const WIN_FILE = () => path.join(app.getPath('userData'), 'window.json');
function winSizes() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const presets = [[1600, 900], [1920, 1080], [2240, 1260], [2560, 1440], [3200, 1800], [3840, 2160]];
  const list = presets.filter(([w, h]) => w <= wa.width && h <= wa.height - 30).map(([w, h]) => ({ id: `${w}x${h}`, w, h, label: `${w} × ${h}` }));
  if (!list.length) { // petit écran : la plus grande fenêtre 16:9 qui tient
    const w = Math.floor(Math.min(wa.width, ((wa.height - 30) * 16) / 9) / 16) * 16, h = (w * 9) / 16;
    list.push({ id: `${w}x${h}`, w, h, label: `${w} × ${h}` });
  }
  return [{ id: 'full', label: 'Plein écran' }, { id: 'free', label: 'Fenêtré (ajustable)' }, ...list];
}
function readWinPref() { try { return JSON.parse(fs.readFileSync(WIN_FILE(), 'utf8')); } catch { return {}; } }
function saveWinPref(o) { try { fs.writeFileSync(WIN_FILE(), JSON.stringify({ ...readWinPref(), ...o })); } catch {} }
function applyZoom() {
  if (!win || win.isDestroyed()) return;
  const [cw] = win.getContentSize();
  win.webContents.setZoomFactor(Math.max(0.3, cw / BASE_W));
}
let lastWindowed = null;
// mode fenêtré : redimensionnable à la souris, toujours en 16:9 pour que l'interface reste identique
function freeMode(on) {
  win.setResizable(on);
  win.setMaximizable(on);
  win.setAspectRatio(on ? 16 / 9 : 0);
  win.setMinimumSize(on ? 960 : 0, on ? 540 : 0);
}
function freeSize() {
  const wa = screen.getPrimaryDisplay().workAreaSize, p = readWinPref();
  let w = p.freeW || 1600; w = Math.min(w, wa.width, Math.floor(((wa.height - 30) * 16) / 9));
  return { w: Math.max(960, Math.round(w)), h: Math.max(540, Math.round((w * 9) / 16)) };
}
function setWinSize(id, save = true) {
  const sizes = winSizes();
  const opt = sizes.find((o) => o.id === id) ?? sizes[2] ?? sizes[0];
  if (save) saveWinPref({ size: opt.id });
  if (opt.id === 'full') { win.setResizable(true); win.setFullScreen(true); } // macOS : le plein écran demande une fenêtre redimensionnable
  else {
    lastWindowed = opt.id;
    const apply = () => {
      if (opt.id === 'free') { const f = freeSize(); freeMode(false); win.setResizable(true); win.setContentSize(f.w, f.h); freeMode(true); }
      else { freeMode(false); win.setResizable(true); win.setContentSize(opt.w, opt.h); win.setResizable(false); }
      win.center(); applyZoom();
    };
    if (win.isFullScreen()) { win.once('leave-full-screen', () => setTimeout(apply, 50)); win.setFullScreen(false); } else apply();
  }
  setTimeout(applyZoom, 300);
  return opt.id;
}
const currentWinSize = () => (win.isFullScreen() ? 'full' : lastWindowed);

function createWindow() {
  const sizes = winSizes();
  const pref = readWinPref().size;
  const first = sizes.find((o) => o.id === pref) ?? sizes[2] ?? sizes[0];
  const start = first.id === 'full' ? (sizes[2] ?? { w: 1600, h: 900 }) : first.id === 'free' ? { id: 'free', ...freeSize() } : first;
  win = new BrowserWindow({
    width: start.w,
    height: start.h,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: true,
    backgroundColor: '#f4f5f7',
    title: 'Draft Lab',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  lastWindowed = start.id ?? null;
  if (lastWindowed === 'free') freeMode(true);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (first.id === 'full') { win.setResizable(true); win.setFullScreen(true); }
  // mise à l'échelle : au chargement, à chaque changement de taille, et si l'utilisateur tente de zoomer
  win.webContents.on('did-finish-load', applyZoom);
  win.webContents.on('zoom-changed', () => setTimeout(applyZoom, 0));
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  win.on('resize', () => {
    applyZoom();
    if (lastWindowed === 'free' && !win.isFullScreen()) saveWinPref({ freeW: win.getContentSize()[0] });
  });
  for (const ev of ['enter-full-screen', 'leave-full-screen']) win.on(ev, () => { setTimeout(applyZoom, 60); win.webContents.send('window:changed', currentWinSize()); });
  // en quittant le plein écran (Échap, bouton vert…), on revient à la dernière taille choisie
  win.on('leave-full-screen', () => {
    saveWinPref({ size: lastWindowed ?? 'full' });
    setTimeout(() => setWinSize(lastWindowed ?? 'free', false), 80);
  });
  // fermer aussi la fenêtre cachée de dpm.lol quand on ferme l'app
  win.on('closed', () => { for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch {} } });
}

app.whenReady().then(() => {
  loadCache();
  ipcMain.handle('data:load', (_e, opts) => quickLoad(opts?.tier ?? lastTier));
  ipcMain.handle('data:refresh', (_e, opts) => sync({ force: true, tier: opts?.tier }));
  ipcMain.handle('opgg:team', async (_e, opts) => {
    try {
      if (!cache.ddragon) return { error: 'liste des champions pas encore chargée' };
      const res = await fetchTeam(opts?.input, cache.ddragon.champions, opts?.region || 'euw');
      // Complément dpm.lol : toutes les games Ranked Solo + Flex de la saison
      const byKey = new Map(cache.ddragon.champions.map((c) => [String(c.key), c.id]));
      res.players = await Promise.all(res.players.map(async (p) => {
        try {
          const dpm = await fetchDpm(p.riotId);
          // introuvable sur op.gg mais connu de dpm.lol sous son pseudo actuel (pseudo ou tag changé) : on relit op.gg
          if (p.error && dpm?.riotId && dpm.riotId.toLowerCase() !== String(p.riotId).toLowerCase()) {
            const again = await fetchPlayer(res.region, dpm.riotId, byKey).catch(() => null);
            if (again && !again.error) return mergePool(again, dpm, byKey);
          }
          return mergePool(p, dpm, byKey);
        }
        catch (e) { return { ...p, dpm: `dpm.lol indisponible (${e.message})` }; }
      }));
      res.players = res.players.map((p) => (p.error && p.pool?.length ? { ...p, error: null, tier: p.tier ?? 'rang inconnu (données dpm.lol)' } : p));
      return res;
    } catch (e) { return { error: e.message }; }
  });
  // Équilibrage in house : jusqu'à 10 joueurs (rang Solo/Duo + champions joués)
  ipcMain.handle('opgg:players', async (_e, opts) => {
    try {
      if (!cache.ddragon) return { error: 'liste des champions pas encore chargée' };
      return await fetchPlayers(opts?.input, cache.ddragon.champions, opts?.region || 'euw');
    } catch (e) { return { error: e.message }; }
  });
  // Matchups et duos Master+ d'un champion à sa lane (mis en cache 24 h)
  const details = new Map();
  // Matchups et duos d'un champion, au niveau (elo) de la partie, patchs récents pondérés
  ipcMain.handle('lola:detail', async (_e, { cid, lane, tier }) => {
    const t = tier || 'emerald_plus', wins = dataWindows();
    const k = `${cid}|${lane}|${t}|${cache.patches?.changed?.[cid] ?? '-'}|${wins.map((x) => x.patch).join('-')}`, c = details.get(k);
    if (c && Date.now() - c.at < 12 * HOUR) return c.data;
    const since = cache.patches?.changed?.[cid] ?? null, patch = cache.ddragon?.patch;
    try { const data = await fetchDetail(cid, lane, t, { since, patch, wins }); details.set(k, { at: Date.now(), data }); return data; }
    catch (e) { return c?.data ?? { error: e.message }; }
  });
  // Partie en direct (client League / jeu sur cet ordinateur)
  ipcMain.handle('live:start', () => { startLive((d) => { if (win && !win.isDestroyed()) win.webContents.send('live:update', d); }); return true; });
  ipcMain.handle('live:stop', () => { stopLive(); return true; });
  ipcMain.handle('live:results', (_e, ids) => matchResults(ids).catch(() => ({})));
  // Équilibrage : joueurs du salon du client (partie personnalisée)
  ipcMain.handle('live:lobby', () => lobbyPlayers().catch((e) => ({ error: 'client', detail: e.message })));
  // Mises à jour automatiques de l'application
  let lastUpdate = null;
  const sendUpdate = (st) => { lastUpdate = st; if (win && !win.isDestroyed()) win.webContents.send('update:status', st); };
  ipcMain.handle('window:sizes', () => ({ current: currentWinSize(), options: winSizes().map(({ id, label }) => ({ id, label })) }));
  ipcMain.handle('window:set', (_e, id) => setWinSize(id));
  ipcMain.handle('app:version', () => global.DRAFTLAB_VERSION || app.getVersion());
  ipcMain.handle('update:last', () => lastUpdate);
  ipcMain.handle('update:check', () => autoUpdate(sendUpdate));
  ipcMain.handle('update:restart', () => { app.relaunch(); app.exit(0); });
  // Quitter complètement : fenêtre principale, fenêtre cachée dpm.lol et tâches de fond (mises à jour, données)
  ipcMain.handle('app:quit', () => { for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch {} } app.exit(0); });
  setTimeout(() => autoUpdate(sendUpdate), 8000);
  setInterval(() => autoUpdate(sendUpdate), 6 * HOUR);
  ipcMain.handle('open:external', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
  createWindow();

  // Actualisation automatique : nouveau patch détecté => tout est rechargé et l'UI prévenue.
  setInterval(async () => {
    const data = await sync({});
    if (win && !win.isDestroyed()) win.webContents.send('data:updated', data);
  }, CHECK_EVERY);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Fermer la fenêtre quitte aussi l'application en arrière-plan (y compris sur Mac).
app.on('window-all-closed', () => app.quit());
