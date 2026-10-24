// Partie en direct (soloQ), comme Porofessor / dpm :
//  - sélection des champions : API locale du client League (LCU) → picks, bans, lanes, joueurs alliés
//  - en jeu : API « Live Client Data » du jeu (port 2999) → les 10 joueurs et leurs champions
// Tout reste sur l'ordinateur (127.0.0.1). Les joueurs en mode streamer (nom masqué) sont ignorés.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const POS = { top: 'T', jungle: 'J', middle: 'M', mid: 'M', bottom: 'A', bot: 'A', adc: 'A', utility: 'S', support: 'S' };
const POS_GAME = { TOP: 'T', JUNGLE: 'J', MIDDLE: 'M', BOTTOM: 'A', UTILITY: 'S' };

// Requête HTTPS locale (certificat auto-signé de Riot : accepté uniquement pour 127.0.0.1)
function localGet(port, p, auth) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port, path: p, rejectUnauthorized: false, timeout: 2500,
      headers: { Accept: 'application/json', ...(auth ? { Authorization: 'Basic ' + Buffer.from('riot:' + auth).toString('base64') } : {}) } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}

// Port et mot de passe du client : ligne de commande du processus LeagueClientUx, sinon fichier lockfile
function run(cmd, args) {
  return new Promise((r) => execFile(cmd, args, { timeout: 4000, windowsHide: true }, (e, out) => r(e ? '' : String(out))));
}
async function findLcu() {
  // 1. le processus du client doit tourner (sinon un vieux lockfile ferait croire qu'il est connecté)
  let txt = '', running = false;
  if (process.platform === 'win32') {
    txt = await run('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine"]);
    running = /LeagueClientUx/i.test(txt) || /LeagueClientUx\.exe/i.test(await run('tasklist', ['/FI', 'IMAGENAME eq LeagueClientUx.exe', '/NH']));
  } else {
    txt = (await run('ps', ['-A', '-ww', '-o', 'args'])).split('\n').filter((l) => /LeagueClientUx/.test(l)).join('\n');
    running = !!txt;
  }
  if (process.env.DRAFTLAB_LCU) { const [p, t] = process.env.DRAFTLAB_LCU.split(':'); return { port: +p, token: t }; } // tests
  if (!running) return null;
  // 2. port et mot de passe : ligne de commande du processus, sinon fichier lockfile
  const port = txt.match(/--app-port=(\d+)/)?.[1], token = txt.match(/--remoting-auth-token=([\w-]+)/)?.[1];
  if (port && token) return { port: +port, token };
  const candidates = process.platform === 'win32'
    ? ['C:\\Riot Games\\League of Legends\\lockfile', 'D:\\Riot Games\\League of Legends\\lockfile', 'E:\\Riot Games\\League of Legends\\lockfile']
    : ['/Applications/League of Legends.app/Contents/LoL/lockfile'];
  for (const f of candidates) {
    try { const [, , p, pw] = fs.readFileSync(f, 'utf8').split(':'); if (p && pw) return { port: +p, token: pw.trim() }; } catch {}
  }
  return null;
}

const hidden = (gameName) => !gameName || /^summoner \d+$/i.test(gameName) || /^invocateur \d+$/i.test(gameName);

// Mode de la partie (file) d'après l'identifiant de queue du client
const QUEUES = { 420: 'Solo/Duo', 440: 'Flex 5c5', 400: 'Normale (draft)', 430: 'Normale (aveugle)', 490: 'Normale (partie rapide)', 480: 'Partie rapide',
  700: 'Clash', 720: 'Clash ARAM', 450: 'ARAM', 0: 'Personnalisée 5c5', 3100: 'Personnalisée 5c5', 1700: 'Arena', 1900: 'URF', 900: 'URF' };
let lastQueue = null;
async function readQueue(get) {
  const g = await get('/lol-gameflow/v1/session').catch(() => null);
  const q = g?.gameData?.queue;
  if (!q) return lastQueue;
  const custom = g?.gameData?.isCustomGame;
  lastQueue = { id: q.id ?? null, label: custom ? 'Personnalisée 5c5' : QUEUES[q.id] ?? (q.description || q.gameMode || 'Autre mode'), ranked: q.id === 420 || q.id === 440 };
  return lastQueue;
}
async function champSelect(lcu) {
  const get = (p) => localGet(lcu.port, p, lcu.token);
  // une erreur de connexion = client fermé : on ne prétend pas être connecté
  const phase = await get('/lol-gameflow/v1/gameflow-phase');
  const queue = ['Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'InProgress'].includes(phase) ? await readQueue(get) : null;
  // compte connecté au client (affiché : « Connecté · Pseudo#TAG »)
  if (!lcu.summoner) {
    const me = await get('/lol-summoner/v1/current-summoner').catch(() => null);
    if (me?.gameName) lcu.summoner = `${me.gameName}${me.tagLine ? '#' + me.tagLine : ''}`;
    else if (me?.displayName) lcu.summoner = me.displayName;
  }
  const summoner = lcu.summoner ?? null;
  // fin de partie : victoire ou défaite (écran de fin de game du client)
  if (['PreEndOfGame', 'EndOfGame', 'WaitingForStats'].includes(phase)) {
    const eog = await get('/lol-end-of-game/v1/eog-stats-block').catch(() => null);
    const mine = eog?.teams?.find((t) => t.isPlayerTeam);
    const result = mine ? (mine.isWinningTeam ? 'win' : 'loss') : eog?.localPlayer?.stats ? (eog.localPlayer.stats.WIN ? 'win' : eog.localPlayer.stats.LOSE ? 'loss' : null) : null;
    return { phase, queue, summoner, result, gameId: eog?.gameId ?? null };
  }
  const s = phase === 'ChampSelect' ? await get('/lol-champ-select/v1/session').catch(() => null) : null;
  if (!s) return { phase: phase || 'None', queue, summoner };
  const mySide = (s.myTeam?.[0]?.team ?? 1) === 1 ? 'blue' : 'red';
  const region = await get('/riotclient/region-locale').then((r) => r?.region ?? r?.webRegion).catch(() => null);
  const member = async (m) => {
    let riotId = null;
    // noms masqués en soloQ (anonymat de la sélection) ou mode streamer : on ne les cherche pas
    if (m.puuid && m.nameVisibilityType !== 'HIDDEN') {
      const sm = await get('/lol-summoner/v2/summoners/puuid/' + m.puuid).catch(() => null);
      if (sm && !hidden(sm.gameName) && sm.tagLine) riotId = `${sm.gameName}#${sm.tagLine}`;
    }
    return { champ: m.championId || m.championPickIntent || null, locked: !!m.championId, role: POS[String(m.assignedPosition || '').toLowerCase()] ?? null, riotId, me: m.cellId === s.localPlayerCellId };
  };
  const mine = await Promise.all((s.myTeam ?? []).map(member));
  const theirs = (s.theirTeam ?? []).map((m) => ({ champ: m.championId || null, locked: !!m.championId, role: POS[String(m.assignedPosition || '').toLowerCase()] ?? null, riotId: null }));
  const bans = { mine: s.bans?.myTeamBans ?? [], theirs: s.bans?.theirTeamBans ?? [] };
  for (const turn of s.actions ?? []) for (const a of turn) {
    if (a.type !== 'ban' || !a.completed || !a.championId) continue;
    const isMine = (s.myTeam ?? []).some((m) => m.cellId === a.actorCellId);
    const list = isMine ? bans.mine : bans.theirs;
    if (!list.includes(a.championId)) list.push(a.championId);
  }
  return { phase: 'ChampSelect', source: 'client', queue, summoner, mySide, region, teams: { [mySide]: mine, [mySide === 'blue' ? 'red' : 'blue']: theirs }, bans: { [mySide]: bans.mine, [mySide === 'blue' ? 'red' : 'blue']: bans.theirs } };
}

async function inGame() {
  const d = await localGet(2999, '/liveclientdata/allgamedata').catch(() => null);
  if (!d || !d.allPlayers) return null;
  const me = d.activePlayer?.riotId || d.activePlayer?.summonerName;
  const meP = d.allPlayers.find((p) => (p.riotId || p.summonerName) === me);
  const mySide = meP?.team === 'CHAOS' ? 'red' : 'blue';
  const player = (p) => {
    const champKey = String(p.rawChampionName || '').replace('game_character_displayname_', '') || p.championName;
    const smite = /Smite/i.test(JSON.stringify(p.summonerSpells ?? {}));
    const name = p.riotIdGameName ?? (p.riotId || p.summonerName || '').split('#')[0];
    const tag = p.riotIdTagLine ?? (p.riotId || '').split('#')[1];
    // mode streamer : le nom affiché est remplacé (souvent par le nom du champion) → on n'en tient pas compte
    const masked = hidden(name) || !tag || name === p.championName || name === champKey;
    return { champKey, champName: p.championName, role: POS_GAME[p.position] ?? (smite ? 'J' : null), riotId: masked ? null : `${name}#${tag}`, me: (p.riotId || p.summonerName) === me, locked: true };
  };
  const teams = { blue: d.allPlayers.filter((p) => p.team === 'ORDER').map(player), red: d.allPlayers.filter((p) => p.team === 'CHAOS').map(player) };
  return { phase: 'InProgress', source: 'jeu', summoner: me || null, queue: lastQueue ?? (d.gameData?.gameMode === 'CLASSIC' ? null : { label: d.gameData?.gameMode }), mySide, teams, bans: { blue: [], red: [] }, time: d.gameData?.gameTime ?? 0 };
}

// Boucle : le jeu d'abord (si une partie tourne), sinon la sélection des champions
let timer = null, lcu = null, lastLcuTry = 0;
async function poll(send) {
  try {
    const g = await inGame();
    if (!lcu || Date.now() - lastLcuTry > 15000) { lastLcuTry = Date.now(); lcu = (await findLcu()) ?? (g ? lcu : null); }
    if (g) {
      // en jeu : le mode de la partie vient du client (utile si Draft Lab a été ouvert pendant la partie)
      if (lcu) { const get = (p) => localGet(lcu.port, p, lcu.token); const q = await readQueue(get).catch(() => null); if (q) g.queue = q; g.summoner = g.summoner ?? lcu.summoner ?? null; }
      return send(g);
    }
    if (!lcu) return send({ phase: 'NoClient' });
    const cs = await champSelect(lcu).catch((e) => { lcu = null; return { phase: 'NoClient', error: e.message }; });
    send(cs);
  } catch (e) { send({ phase: 'Error', error: e.message }); }
}
function startLive(send) { stopLive(); lcu = null; poll(send); timer = setInterval(() => poll(send), 2000); }
function stopLive() { if (timer) clearInterval(timer); timer = null; }

module.exports = { startLive, stopLive, champSelect, inGame, findLcu };
