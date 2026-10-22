// Processus principal Electron : fenêtre, cache disque, synchronisation des données.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchDDragon } = require('./providers/ddragon');
const { fetchLolalytics, fetchDetail } = require('./providers/lolalytics');
const { fetchGolgg } = require('./providers/golgg');
const { fetchTeam } = require('./providers/opgg');
const { fetchDpm, mergePool } = require('./providers/dpm');
const { autoUpdate } = require('./providers/updater');

const HOUR = 3600 * 1000;
const STALE = { lolalytics: 6 * HOUR, golgg: 12 * HOUR };
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
  if (!cache.ddragon || !cache.golgg || !cache.lolalytics) {
    try {
      const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'seed.json'), 'utf8'));
      for (const k of ['ddragon', 'lolalytics', 'golgg']) {
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

    // 2) lolalytics (winrates soloQ par rôle) et 3) gol.gg (méta pro), en parallèle
    const lk = `${patch}|${tier}`;
    const lolaFresh = cache.lolalytics?.key === lk && now - cache.lolalytics.at < STALE.lolalytics;
    const golFresh = cache.golgg?.v === 2 && now - cache.golgg.at < STALE.golgg;
    await Promise.all([
      (async () => {
        if (!force && !patchChanged && lolaFresh) {
          sources.lolalytics = { ok: true, at: cache.lolalytics.at, patch: cache.lolalytics.patch };
          return;
        }
        try {
          const r = await fetchLolalytics(patch, tier, champions);
          cache.lolalytics = { key: lk, at: now, stats: r.stats, patch: r.patch };
          sources.lolalytics = { ok: true, at: now, patch: r.patch };
          partial(tier, sources);
        } catch (e) {
          sources.lolalytics = { ok: false, error: e.message, at: cache.lolalytics?.at, cached: cache.lolalytics?.key === lk };
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
function snapshot(tier, sources) {
  const { version, patch, champions } = cache.ddragon;
  const lk = `${patch}|${tier}`;
  return {
    version, patch, champions, tier,
    stats: cache.lolalytics?.key === lk ? cache.lolalytics.stats : {},
    pro: cache.golgg?.pro ?? {},
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
  const lk = `${cache.ddragon.patch}|${tier}`;
  const loading = { loading: true };
  const snap = snapshot(tier, {
    ddragon: { ok: true, at: cache.ddragon.at },
    lolalytics: cache.lolalytics?.key === lk ? { ok: true, at: cache.lolalytics.at, patch: cache.lolalytics.patch, ...loading } : loading,
    golgg: cache.golgg ? { ok: true, at: cache.golgg.at, ...loading } : loading
  });
  pushWhenDone();
  return snap;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
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
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
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
        try { return mergePool(p, await fetchDpm(p.riotId), byKey); }
        catch (e) { return { ...p, dpm: `dpm.lol indisponible (${e.message})` }; }
      }));
      res.players = res.players.map((p) => (p.error && p.pool?.length ? { ...p, error: null, tier: p.tier ?? 'rang inconnu (données dpm.lol)' } : p));
      return res;
    } catch (e) { return { error: e.message }; }
  });
  // Matchups et duos GM+ d'un champion à sa lane (mis en cache 24 h)
  const details = new Map();
  ipcMain.handle('lola:detail', async (_e, { cid, lane }) => {
    const k = `${cid}|${lane}`, c = details.get(k);
    if (c && Date.now() - c.at < 24 * HOUR) return c.data;
    try { const data = await fetchDetail(cid, lane); details.set(k, { at: Date.now(), data }); return data; }
    catch (e) { return c?.data ?? { error: e.message }; }
  });
  // Mises à jour automatiques de l'application
  let lastUpdate = null;
  const sendUpdate = (st) => { lastUpdate = st; if (win && !win.isDestroyed()) win.webContents.send('update:status', st); };
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
