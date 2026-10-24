// ---------- Équilibrage d'équipes (in house) ----------
// 10 joueurs, chacun avec une valeur d'elo (Solo/Duo), un rôle principal et un rôle secondaire.
// On teste toutes les répartitions (126 façons de faire deux équipes de 5, puis tous les placements
// de rôles dans chaque équipe) et on garde les plus équilibrées.
export const BAL_ROLES = ['T', 'J', 'M', 'A', 'S'];
export const BAL_COST = { main: 0, second: 50, third: 150, fill: 50, off: 300 };

// Valeur d'un joueur : 100 pts par division, 400 par tier ; au-dessus de Master, les LP comptent à moitié
// (un Master à 1200 LP ne vaut pas trois tiers de plus qu'un Master à 0 LP).
export const balValue = (pts) => (pts == null ? null : pts > 2800 ? 2800 + (pts - 2800) / 2 : pts);

// Rôle joué par rapport aux préférences (3 rôles) : 'main', 'second', 'third', 'fill' ou 'off'
export function roleFit(p, r) {
  if (p.main === 'FILL') return 'fill';
  if (r === p.main) return 'main';
  if (r === p.second || p.second === 'FILL') return 'second';
  if (r === p.third || p.third === 'FILL') return 'third';
  return 'off';
}

// Forme (départage seulement) : winrate de la saison (20 games mini) et série de victoires
export function balForm(p) {
  let f = 0;
  const g = (p.wins ?? 0) + (p.losses ?? 0);
  if (g >= 20) f += Math.max(-30, Math.min(30, ((p.wins / g) * 100 - 50) * 3));
  if (p.hot) f += 15;
  return f;
}

// Probabilité de victoire de l'équipe 1 selon l'écart de valeur moyenne (même échelle que le pronostic joueurs)
export const balWr = (avgA, avgB) => 100 / (1 + Math.pow(10, -(avgA - avgB) / 800));

const PERMS = (() => {
  const out = [], a = [0, 1, 2, 3, 4];
  const rec = (k) => { if (k === 5) { out.push(a.slice()); return; } for (let i = k; i < 5; i++) { [a[k], a[i]] = [a[i], a[k]]; rec(k + 1); [a[k], a[i]] = [a[i], a[k]]; } };
  rec(0); return out;
})();

// players : [{ value, main, second, third, form }] (10). Renvoie les meilleures répartitions, une par composition
// d'équipes : { blue: [idx par rôle T J M A S], red: [...], score, gap, laneGap, cost, formGap, wr }
export function balanceTeams(players, { keep = 6 } = {}) {
  if (players.length !== 10) return [];
  const P = players.map((p) => ({ ...p, form: p.form ?? balForm(p) }));
  // valeur et coût de chaque joueur à chaque rôle
  const cost = P.map((p) => BAL_ROLES.map((r) => BAL_COST[roleFit(p, r)]));
  const val = P.map((p, i) => BAL_ROLES.map((_, r) => p.value - cost[i][r]));
  // pour une équipe (5 indices), tous les placements : [ordre des joueurs par rôle, valeurs par rôle, coût total]
  const options = (team) => PERMS.map((perm) => {
    const who = perm.map((k) => team[k]); // who[r] = joueur au rôle r
    const v = who.map((pi, r) => val[pi][r]);
    return { who, v, sum: v.reduce((a, x) => a + x, 0), cost: who.reduce((a, pi, r) => a + cost[pi][r], 0) };
  });
  const best = [];
  const idx = [...Array(10).keys()];
  // le joueur 0 est toujours dans l'équipe A : chaque composition n'est vue qu'une fois
  const combos = [];
  const rec = (start, cur) => { if (cur.length === 5) { combos.push(cur.slice()); return; } for (let i = start; i < 10; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); } };
  rec(1, [0]);
  for (const A of combos.filter((c) => c.length === 5)) {
    const B = idx.filter((i) => !A.includes(i));
    const oa = options(A), ob = options(B);
    const fa = A.reduce((s, i) => s + P[i].form, 0) / 5, fb = B.reduce((s, i) => s + P[i].form, 0) / 5;
    const formGap = Math.abs(fa - fb);
    let top = null;
    for (const x of oa) for (const y of ob) {
      const gap = Math.abs(x.sum - y.sum) / 5;
      let lane = 0; for (let r = 0; r < 5; r++) lane += Math.abs(x.v[r] - y.v[r]);
      lane /= 5;
      const c = (x.cost + y.cost) / 2;
      // 1) équipes de même niveau, 2) lanes proches, 3) chacun à son rôle ; la forme ne fait que départager
      const score = gap + 0.15 * lane + c + 0.15 * formGap;
      if (!top || score < top.score) top = { score, x, y, gap, lane, c };
    }
    best.push({
      blue: top.x.who, red: top.y.who, score: top.score, gap: top.gap, laneGap: top.lane, cost: top.c, formGap,
      vBlue: top.x.v, vRed: top.y.v, wr: balWr(top.x.sum / 5, top.y.sum / 5)
    });
  }
  best.sort((a, b) => a.score - b.score);
  return best.slice(0, keep);
}

// Rôles d'un joueur estimés depuis ses champions joués en ranked (op.gg) : chaque champion compte
// pour ses games, réparties selon les rôles où ce champion est joué (lolalytics).
export function rolesFromPool(pool, stats) {
  const share = { T: 0, J: 0, M: 0, A: 0, S: 0 };
  let tot = 0;
  for (const c of pool ?? []) {
    const roles = stats?.[c.id]?.roles;
    if (!roles || !c.games) continue;
    const sum = Object.values(roles).reduce((a, x) => a + (x || 0), 0) || 1;
    for (const r of BAL_ROLES) share[r] += c.games * (roles[r] || 0) / sum;
    tot += c.games;
  }
  if (!tot) return null;
  const pct = Object.fromEntries(BAL_ROLES.map((r) => [r, Math.round((share[r] / tot) * 100)]));
  const order = [...BAL_ROLES].sort((a, b) => pct[b] - pct[a]);
  return { main: order[0], second: order[1], third: order[2], pct, games: tot };
}
