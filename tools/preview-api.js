// API de remplacement pour l'aperçu web : mêmes fonctions que preload.js,
// mais avec les données fournies dans la page (op.gg n'est pas joignable depuis un navigateur).
(function () {
  const SEED = window.__SEED;
  const T = Date.now();
  const snapshot = () => ({
    version: SEED.ddragon.version,
    patch: SEED.ddragon.patch,
    champions: SEED.ddragon.champions,
    stats: SEED.lolalytics.stats,
    pro: SEED.golgg.pro,
    progames: SEED.progames?.games ?? {},
    changes: SEED.patches?.changed ?? {},
    window: { days: 30, from: SEED.patches?.from ?? null, patches: (SEED.patches?.patches ?? []).map(({ patch, label, start }) => ({ patch, label, start })) },
    sources: {
      ddragon: { ok: true, at: T },
      lolalytics: { ok: true, at: T, patch: SEED.lolalytics.patch },
      golgg: { ok: true, at: T }
    }
  });
  const FLEX = ['PLATINUM', 'EMERALD', 'DIAMOND', 'EMERALD', 'MASTER'];
  let fk = 0;
  const R = (tier, division, lp, wins, losses, hot) => ({ tier, division, lp, wins, losses, hot, queue: 'SOLORANKED', flex: fk++ % 3 === 2 ? null : { tier: FLEX[fk % 5], division: FLEX[fk % 5] === 'MASTER' ? null : (fk % 4) + 1, lp: (fk * 17) % 100, wins: 20 + fk, losses: 18 + (fk % 5) } });
  const P = (riotId, rank, pool) => {
    const total = pool.reduce((a, x) => a + x[1], 0) + 40;
    return {
      riotId, rank, total,
      tier: `${rank.tier} ${rank.division} ${rank.lp} LP`,
      pool: pool.map(([id, games, wins]) => ({ id, games, wins, share: +((games / total) * 100).toFixed(1) }))
    };
  };
  const DEMO = {
    blue: [
      P('Exemple Top#EUW', R('DIAMOND', 3, 42, 142, 118, true), [['Renekton', 48, 28], ['KSante', 31, 17], ['Gnar', 14, 7]]),
      P('Exemple Jungle#EUW', R('DIAMOND', 2, 18, 160, 141, false), [['Vi', 52, 30], ['JarvanIV', 33, 17], ['Nocturne', 12, 7]]),
      P('Exemple Mid#EUW', R('EMERALD', 1, 77, 210, 188, false), [['Orianna', 61, 34], ['Ahri', 37, 19], ['Syndra', 15, 8]]),
      P('Exemple ADC#EUW', R('DIAMOND', 4, 35, 118, 104, true), [['Jinx', 55, 31], ['Kaisa', 29, 15], ['Ezreal', 22, 11]]),
      P('Exemple Support#EUW', R('DIAMOND', 3, 61, 190, 160, false), [['Rakan', 44, 25], ['Nautilus', 30, 16], ['Lulu', 18, 10]])
    ],
    red: [
      P('Adversaire Top#EUW', R('EMERALD', 2, 55, 130, 128, false), [['Camille', 58, 31], ['Jax', 24, 12], ['Aatrox', 11, 5]]),
      P('Adversaire Jungle#EUW', R('EMERALD', 1, 20, 240, 236, true), [['LeeSin', 70, 38], ['XinZhao', 19, 10]]),
      P('Adversaire Mid#EUW', R('DIAMOND', 4, 8, 170, 168, false), [['Azir', 41, 22], ['Viktor', 35, 18], ['Taliyah', 12, 6]]),
      P('Adversaire ADC#EUW', R('EMERALD', 2, 33, 150, 146, false), [['Ezreal', 66, 34], ['Caitlyn', 27, 14], ['Varus', 14, 7]]),
      P('Adversaire Support#EUW', R('EMERALD', 1, 90, 120, 109, false), [['Thresh', 49, 27], ['Braum', 21, 11], ['Leona', 13, 6]])
    ]
  };
  // ---- Démo de « Partie en direct » : une sélection des champions puis une partie, simulées pas à pas ----
  const KEY = Object.fromEntries(SEED.ddragon.champions.map((c) => [c.id, +c.key]));
  const LIVE_POOLS = {
    'Rocket#EUW': ['DIAMOND', 2, 61, [['Gnar', 88, 50], ['Rumble', 40, 22], ['KSante', 25, 13]]],
    'Fauve#EUW': ['DIAMOND', 1, 12, [['LeeSin', 120, 66], ['Vi', 45, 25], ['Nocturne', 30, 15]]],
    'Moi#EUW': ['DIAMOND', 3, 40, [['Ahri', 140, 76], ['Syndra', 60, 31], ['Orianna', 33, 17]]],
    'Kiwi#EUW': ['EMERALD', 1, 80, [['Jinx', 102, 55], ['Kaisa', 61, 31], ['Ezreal', 22, 11]]],
    'Rempart#EUW': ['DIAMOND', 4, 22, [['Thresh', 99, 53], ['Nautilus', 54, 30], ['Rell', 18, 10]]],
    'Bastion#EUW': ['DIAMOND', 2, 70, [['Renekton', 77, 41], ['Aatrox', 49, 24], ['Jax', 20, 10]]],
    'Brume#EUW': ['MASTER', 0, 120, [['Vi', 130, 72], ['Sejuani', 41, 21], ['XinZhao', 18, 10]]],
    'Comète#EUW': ['DIAMOND', 1, 5, [['Kaisa', 95, 50], ['Varus', 44, 23], ['Ezreal', 30, 14]]],
    'Ancre#EUW': ['EMERALD', 1, 55, [['Nautilus', 110, 60], ['Leona', 42, 21], ['Alistar', 19, 9]]]
  };
  let liveCb = null, liveTimer = null;
  const mk = (id, role, rid, locked = true) => ({ champ: id ? KEY[id] : null, locked, role, riotId: rid, me: rid === 'Moi#EUW' });
  const STEPS = [
    { phase: 'NoClient' }, { phase: 'Lobby', summoner: 'Moi#EUW', queue: { id: 420, label: 'Solo/Duo' } }, { phase: 'Matchmaking', summoner: 'Moi#EUW', queue: { id: 420, label: 'Solo/Duo' } }, { phase: 'ReadyCheck', summoner: 'Moi#EUW', queue: { id: 420, label: 'Solo/Duo' } },
    // sélection des champions : bans puis picks dans l'ordre (B1 R1 R2 B2 B3 R3 / R4 B4 B5 R5)
    ...(() => {
      const out = [], picks = { blue: [null, null, null, null, null], red: [null, null, null, null, null] }, bans = { blue: [], red: [] };
      const blueRoles = ['T', 'J', 'M', 'A', 'S'], blueNames = [null, 'Fauve#EUW', 'Moi#EUW', null, 'Rempart#EUW'];
      const snap = () => ({ phase: 'ChampSelect', source: 'client', queue: { id: 420, label: 'Solo/Duo' }, summoner: 'Moi#EUW', mySide: 'blue', region: 'EUW',
        teams: { blue: blueRoles.map((r, i) => mk(picks.blue[i], r, blueNames[i])), red: picks.red.map((c) => mk(c, null, null)) },
        bans: { blue: bans.blue.map((c) => KEY[c]), red: bans.red.map((c) => KEY[c]) } });
      const seq = [['ban', 'blue', 'Yasuo'], ['ban', 'red', 'Zed'], ['ban', 'blue', 'Yone'], ['ban', 'red', 'Draven'], ['ban', 'blue', 'Ambessa'], ['ban', 'red', 'Smolder'],
        ['pick', 'blue', 1, 'LeeSin'], ['pick', 'red', 0, 'Vi'], ['pick', 'red', 1, 'Kaisa'], ['pick', 'blue', 3, 'Jinx'], ['pick', 'blue', 4, 'Thresh'], ['pick', 'red', 2, 'Taliyah'],
        ['ban', 'red', 'Orianna'], ['ban', 'blue', 'Viktor'], ['ban', 'red', 'Syndra'], ['ban', 'blue', 'Rumble'],
        ['pick', 'red', 3, 'Renekton'], ['pick', 'blue', 0, 'Gnar'], ['wait'], ['wait'], ['wait'], ['pick', 'blue', 2, 'Ahri'], ['pick', 'red', 4, 'Nautilus']];
      out.push(snap());
      for (const a of seq) { if (a[0] === 'wait') {} else if (a[0] === 'ban') bans[a[1]].push(a[2]); else picks[a[1]][a[2]] = a[3]; out.push(snap()); }
      return out;
    })(),
    { phase: 'InProgress' }
  ];
  const gameSnap = (t) => ({ phase: 'InProgress', source: 'jeu', queue: { id: 420, label: 'Solo/Duo' }, summoner: 'Moi#EUW', mySide: 'blue', time: t, bans: { blue: [], red: [] }, teams: {
    blue: [['Gnar', 'T', 'Rocket#EUW'], ['LeeSin', 'J', 'Fauve#EUW'], ['Ahri', 'M', 'Moi#EUW'], ['Jinx', 'A', 'Kiwi#EUW'], ['Thresh', 'S', 'Rempart#EUW']].map(([c, r, n]) => ({ champKey: c, champName: c, role: r, riotId: n, locked: true })),
    red: [['Renekton', null, 'Bastion#EUW'], ['Vi', 'J', 'Brume#EUW'], ['Taliyah', null, null], ['Kaisa', null, 'Comète#EUW'], ['Nautilus', null, 'Ancre#EUW']].map(([c, r, n]) => ({ champKey: c, champName: c, role: r, riotId: n, locked: true })) } });
  function liveStart() {
    liveStop(); let k = 0;
    const tick = () => {
      if (!liveCb || window.__livePause) return;
      const st = STEPS[Math.min(k, STEPS.length - 1)], after = k - STEPS.length + 1;
      // démo : la partie dure 14 relevés, puis écran de fin (victoire) et retour au salon
      if (st.phase === 'InProgress' && after > 14) liveCb(after < 17 ? { phase: 'EndOfGame', summoner: 'Moi#EUW', queue: { id: 420, label: 'Solo/Duo' }, result: 'win' } : { phase: 'Lobby', summoner: 'Moi#EUW', queue: { id: 420, label: 'Solo/Duo' } });
      else liveCb(st.phase === 'InProgress' ? gameSnap(after * 30) : st);
      k++;
    };
    tick(); liveTimer = setInterval(tick, window.__liveMs || 1700);
  }
  function liveStop() { if (liveTimer) clearInterval(liveTimer); liveTimer = null; }

  window.draftlab = {
    liveStart: async () => { liveStart(); return true; },
    liveStop: async () => { liveStop(); return true; },
    onLive: (cb) => { liveCb = cb; },
    quit() { const t = document.getElementById('toast'); t.textContent = 'Dans l’application, ce bouton ferme complètement Draft Lab'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); },
    load: async () => snapshot(),
    refresh: async () => snapshot(),
    onUpdated: () => {},
    open: () => {},
    // démo de l'équilibrage : les 10 joueurs d'exemple, avec les pseudos entrés s'il y en a
    loadPlayers: async ({ input }) => {
      const txt = String(input || ''), RE = /(?:https?:\/\/)?(?:[a-z]+\.)?op\.gg\/\S+/gi, names = [];
      for (const u of txt.match(RE) ?? []) { try { names.push(...(new URL(/^https?:/.test(u) ? u : 'https://' + u).searchParams.get('summoners') ?? '').split(',')); } catch {} }
      names.push(...txt.replace(RE, '\n').split(/[,\n;]+/));
      names.splice(0, names.length, ...names.map((x) => x.trim()).filter(Boolean).slice(0, 10));
      const all = JSON.parse(JSON.stringify([...DEMO.blue, ...DEMO.red]));
      return { region: 'euw', players: (names.length ? names : all.map((p) => p.riotId)).map((n, i) => ({ ...all[i % 10], riotId: n.includes('#') ? n : `${n}#EUW` })) };
    },
    loadTeam: async ({ input }) => {
      // démo du direct : on renvoie les joueurs demandés avec leur pool
      const asked = String(input).split(',').map((x) => x.trim()).filter((x) => LIVE_POOLS[x]);
      if (asked.length) return { region: 'euw', players: asked.map((n) => { const [tier, div, lp, pool] = LIVE_POOLS[n]; return P(n, R(tier, div, lp, 120, 100, false), pool); }) };
      const side = /adv|red|rouge|2/i.test(input) ? 'red' : (window.__previewNextSide || 'blue');
      window.__previewNextSide = side === 'blue' ? 'red' : 'blue';
      return { region: 'euw', players: JSON.parse(JSON.stringify(DEMO[side])) };
    }
  };
})();
