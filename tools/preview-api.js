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
    sources: {
      ddragon: { ok: true, at: T },
      lolalytics: { ok: true, at: T, patch: SEED.lolalytics.patch },
      golgg: { ok: true, at: T }
    }
  });
  const R = (tier, division, lp, wins, losses, hot) => ({ tier, division, lp, wins, losses, hot, queue: 'SOLORANKED' });
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
  window.draftlab = {
    quit() { const t = document.getElementById('toast'); t.textContent = 'Dans l’application, ce bouton ferme complètement Draft Lab'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); },
    load: async () => snapshot(),
    refresh: async () => snapshot(),
    onUpdated: () => {},
    open: () => {},
    loadTeam: async ({ input }) => {
      const side = /adv|red|rouge|2/i.test(input) ? 'red' : (window.__previewNextSide || 'blue');
      window.__previewNextSide = side === 'blue' ? 'red' : 'blue';
      return { region: 'euw', players: JSON.parse(JSON.stringify(DEMO[side])) };
    }
  };
})();
