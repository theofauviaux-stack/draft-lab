// Batterie de tests de Draft Lab (lancée chaque jour) : node tools/qa/run.mjs
// 1) cohérence du calcul sur des drafts au hasard avec les vraies données lolalytics
// 2) parcours de l'aperçu (draft, Fearless, joueurs, partie en direct simulée, équilibrage)
// 3) lecture des pseudos / liens op.gg et équilibrage
// 4) notes de patch : champions modifiés et changements de systèmes / objectifs à vérifier
// Affiche un compte rendu ; code de sortie 1 si un problème est trouvé.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const issues = [], notes = [];
const E = await import(path.join(ROOT, 'src/engine.js'));
const { balanceTeams } = await import(path.join(ROOT, 'src/balance.js'));
const L = require(path.join(ROOT, 'providers/lolalytics.js'));
const { parseInput } = require(path.join(ROOT, 'providers/opgg.js'));
const { fetchDDragon } = require(path.join(ROOT, 'providers/ddragon.js'));
const { fetchPatchChanges } = require(path.join(ROOT, 'providers/patches.js'));
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/seed.json'), 'utf8'));

// ---------- 1) calcul ----------
try {
  const dd = await fetchDDragon();
  const pc = await fetchPatchChanges(dd.versions, dd.champions);
  const W = []; for (const x of pc.patches) { W.push(x.patch); if (x.start <= pc.from || W.length >= 3) break; }
  const wins = W.slice(0, 3).map((patch, i) => ({ patch, w: [1, 0.6, 0.35][i] }));
  notes.push(`Patch ${dd.patch} · fenêtre ${wins.map((x) => x.patch).join(', ')} · ${Object.keys(pc.changed).length} champions modifiés en 30 jours`);
  const st = await L.fetchLolalytics(dd.patch, 'emerald_plus', dd.champions, pc.changed, wins);
  if (Object.keys(st.stats).length < 150) issues.push(`lolalytics : seulement ${Object.keys(st.stats).length} champions lus`);
  const P = E.buildProfiles(dd.champions, st.stats, seed.golgg.pro);
  E.applyProGames(P, {}, pc.changed);
  const D = {}; E.setDetailSource((k, l) => D[`${k}|${l}`] ?? null);
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const byRole = (r) => Object.values(P).filter((c) => c.roles[0] === r && c.pr > 0.5);
  for (let it = 0; it < 5; it++) {
    const used = new Set();
    const mk = () => ['T', 'J', 'M', 'A', 'S'].map((r) => { let c; do c = rnd(byRole(r)); while (used.has(c.id)); used.add(c.id); return { ...c, lane: r }; });
    const B = mk(), R = mk();
    await Promise.all([...B, ...R].map(async (c) => { try { D[`${c.key}|${c.lane}`] = await L.fetchDetail(c.id, c.lane, 'emerald_plus', { since: pc.changed[c.id], wins }); } catch (e) { issues.push(`face-à-face ${c.id} : ${e.message}`); } }));
    const a = E.evaluate(B, R), b = E.evaluate(R, B);
    if (Math.abs(a.wr + b.wr - 100) > 0.25) issues.push(`asymétrie du pourcentage ${a.wr} + ${b.wr} (${B.map((c) => c.id)} vs ${R.map((c) => c.id)})`);
    const d1 = E.botDuel(B, R), d2 = E.botDuel(R, B);
    if (d1 && d2 && Math.abs(d1.raw + d2.raw) > 0.6) issues.push(`2v2 bot asymétrique ${d1.raw} / ${d2.raw}`);
    for (const t of ['T', 'J', 'M']) { const x = B.find((c) => c.lane === t), y = R.find((c) => c.lane === t); if (!E.laneEdge(x, t, y, t)) notes.push(`pas de face-à-face mesuré ${x.id} vs ${y.id} (${t})`); }
    if (a.factors.some((f) => f.key === 'strength')) issues.push('force générale comptée alors que tous les vis-à-vis sont choisis');
    for (const f of a.factors) if (!Number.isFinite(f.value)) issues.push(`facteur non numérique : ${f.key}`);
    const plan = E.matchPlan(B.map((c) => ({ c, role: c.lane })), R.map((c) => ({ c, role: c.lane })));
    if (!plan?.phases?.length) issues.push('plan de match vide');
  }
} catch (e) { issues.push(`calcul : ${e.message}`); }

// ---------- plan adapté à la partie ----------
try {
  const P2 = E.buildProfiles(seed.ddragon.champions, seed.lolalytics.stats, seed.golgg.pro);
  const R = (ids) => ids.map((id, i) => ({ c: P2[id], role: 'TJMAS'[i] }));
  const mine = R(['Gnar', 'LeeSin', 'Ahri', 'Jinx', 'Thresh']), theirs = R(['Renekton', 'Vi', 'Zed', 'Kaisa', 'Nautilus']);
  const g = { Gnar: 3100, LeeSin: 3600, Ahri: 2400, Jinx: 6200, Thresh: 2300, Renekton: 4400, Vi: 3500, Zed: 6500, Kaisa: 3000, Nautilus: 2100 };
  const kd = { Jinx: [6, 0], Zed: [7, 1], Ahri: [0, 4] };
  const stats = Object.fromEntries(Object.entries(g).map(([id, gold]) => [id, { k: kd[id]?.[0] ?? 1, d: kd[id]?.[1] ?? 1, a: 2, gold }]));
  const ls = E.liveGameState({ mine, theirs, stats, obj: { blue: { drakes: ['Earth'], towers: 1 }, red: { drakes: ['Fire', 'Water', 'Air'], towers: 1 } }, mySide: 'blue', mp: E.matchPlan(mine, theirs), time: 1320 });
  if (ls.goldDiff !== -1900) issues.push(`plan en partie : écart d'or ${ls.goldDiff} au lieu de -1900`);
  if (!/de retard/.test(ls.advice[0]) || /\+/.test(ls.advice[0])) issues.push(`plan en partie : 1er conseil incohérent « ${ls.advice[0]} »`);
  if (ls.fed[0]?.c.id !== 'Jinx' || ls.threat?.c.id !== 'Zed') issues.push('plan en partie : joueur en avance ou menace mal détectés');
  if (!ls.advice.some((t) => /Point d’âme pour eux/.test(t))) issues.push('plan en partie : point d’âme adverse non signalé');
} catch (e) { issues.push(`plan en partie : ${e.message}`); }

// ---------- 3) pseudos et équilibrage ----------
const cases = [
  ['https://op.gg/fr/lol/multisearch/euw?summoners=INT+soul%23INT%2CMetaFir%2306660', ['INT soul#INT', 'MetaFir#06660']],
  ['UCP akirielle : https://op.gg/fr/lol/summoners/euw/akirielle-YOLO-', ['akirielle#YOLO']],
  ['https://u.gg/lol/profile/euw1/ephemarium-euw/overview', ['ephemarium#euw']],
  ['Faker#KR1, Bob #EUW\nCarl joined the lobby', ['Faker#KR1', 'Bob#EUW', 'Carl']]
];
for (const [inp, want] of cases) { const got = parseInput(inp, 'euw', 20).names; if (JSON.stringify(got) !== JSON.stringify(want)) issues.push(`lecture des pseudos : « ${inp.slice(0, 50)} » → ${JSON.stringify(got)}`); }
const ps = Array.from({ length: 10 }, (_, i) => ({ value: 1200 + ((i * 137) % 900), main: 'TJMAS'[i % 5], second: 'TJMAS'[(i + 2) % 5], third: 'FILL' }));
const sol = balanceTeams(ps)[0];
if ([...sol.blue, ...sol.red].sort((a, b) => a - b).join() !== '0,1,2,3,4,5,6,7,8,9') issues.push('équilibrage : un joueur manque ou est en double');

// ---------- 2) parcours de l'aperçu ----------
try {
  const { execSync } = await import('child_process');
  execSync('node tools/build-preview.mjs', { cwd: ROOT, stdio: 'ignore' });
  const { chromium } = await import('/opt/node-tools/node_modules/playwright-core/index.mjs');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const url = 'file://' + path.join(ROOT, 'preview.html');
  const run = async (name, fn) => {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(() => { window.__liveMs = 150; });
    try { await p.goto(url); await p.waitForTimeout(2000); await fn(p); } catch (e) { issues.push(`${name} : ${e.message.split('\n')[0]}`); }
    if (errs.length) issues.push(`${name} : erreurs JavaScript ${errs.slice(0, 3).join(' | ')}`);
    await p.close();
  };
  const pick = async (p, n) => { await p.fill('#search', n); await p.press('#search', 'Enter'); await p.waitForTimeout(120); while (await p.locator('#laneAsk:not([hidden]) button').count()) await p.locator('#laneAsk:not([hidden]) button').first().click(); };
  await run('draft classique', async (p) => {
    await p.click('#startZero'); await p.click('#startModeBox .sm-o[data-mode="classic"]'); await p.waitForTimeout(300);
    for (let k = 0; k < 6; k++) await p.click('.skipban');
    for (const n of ['Ahri', 'Zed', 'Jinx', 'Thresh', 'Lee Sin', 'Vi']) await pick(p, n);
    for (let k = 0; k < 4; k++) await p.click('.skipban'); // 2e phase de bans
    for (const n of ['Ornn', 'Renekton', 'Lulu', 'Ashe']) await pick(p, n);
    const filled = await p.locator('.board .team .slot:not(.empty)').count(); if (filled < 10) issues.push(`draft classique : ${filled}/10 picks placés`);
  });
  await run('panneau en jeu (aperçu)', async (p) => {
    await p.click('#startZero'); await p.click('#startModeBox .sm-o[data-mode="classic"]'); await p.waitForTimeout(300);
    for (let k = 0; k < 6; k++) await p.click('.skipban');
    for (const n of ['Ahri', 'Zed']) await pick(p, n);
    await p.click('#ovBtn'); await p.waitForTimeout(800);
    const t = await p.locator('#ovDemoPanel').innerText();
    if (!/Objectifs/i.test(t) || !/Drake/.test(t)) issues.push('panneau en jeu : contenu incomplet');
  });
  await run('fearless', async (p) => {
    await p.click('#startZero'); await p.click('#startModeBox .sm-o[data-mode="fl3"]'); await p.waitForTimeout(300);
    for (let k = 0; k < 6; k++) await p.click('.skipban'); for (const n of ['Ahri', 'Zed']) await pick(p, n);
    await p.click('#flNext'); await p.waitForTimeout(300);
    if (!(await p.locator('.tile.fl').count())) issues.push('fearless : aucun champion verrouillé en game 2');
  });
  await run('draft depuis des joueurs', async (p) => {
    await p.click('#startPlayers'); await p.fill('#menuBlue', 'a'); await p.fill('#menuRed', 'adv'); await p.click('#menuGo'); await p.waitForTimeout(2000);
    const t = await p.evaluate(() => document.querySelector('#tierSel option').textContent); if (!/Auto · /.test(t)) issues.push(`niveau auto : ${t}`);
  });
  await run('partie en direct', async (p) => {
    await p.click('#startLive'); await p.waitForTimeout(13000);
    if (!(await p.evaluate(() => localStorage.getItem('draftlab-live-history')))) issues.push('partie en direct : historique non enregistré');
  });
  await run('équilibrage', async (p) => {
    await p.click('#startBalance'); await p.click('#balModeBox .sm-o[data-mode="client"]'); await p.waitForTimeout(2500);
    if (!(await p.locator('.bal-row').count())) issues.push('équilibrage : salon du client (démo) non lu');
    await p.click('#balBack'); await p.click('#startBalance'); await p.click('#balModeBox .sm-o[data-mode="manual"]'); await p.fill('#balInput', 'A#1, B#1, C#1, D#1, E#1, F#1, G#1, H#1, I#1, J#1'); await p.click('#balSearch'); await p.waitForTimeout(600);
    await p.click('#balGo'); await p.waitForTimeout(400);
    if (!(await p.locator('.bal-lane').count())) issues.push('équilibrage : pas de résultat');
  });
  await b.close();
} catch (e) { issues.push(`aperçu : ${e.message.split('\n')[0]}`); }

// ---------- 4) notes de patch : systèmes et objectifs ----------
try {
  const dd = await fetchDDragon();
  const [M, m] = dd.patch.split('.').map(Number);
  const u = `https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-${M + 10}-${m}-notes/`;
  const h = await (await fetch(u)).text();
  // sections « Systems », « Classic », « Summoner's Rift » des notes : titres des changements
  const heads = [...h.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((x) => ({ i: x.index, t: x[1].replace(/<[^>]+>/g, '').trim() }));
  const keep = heads.filter((x) => /^(systems|summoner.?s rift|objectives?|jungle|map)\b/i.test(x.t));
  const found = [];
  for (const k of keep) {
    const end = heads.find((x) => x.i > k.i)?.i ?? h.length;
    for (const x of h.slice(k.i, end).matchAll(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/g)) found.push(`${k.t} : ${x[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()}`);
  }
  notes.push(`Notes du patch ${M + 10}.${m} (${keep.map((x) => x.t).join(', ') || 'pas de section systèmes'}) : ${found.length ? '\n  - ' + found.slice(0, 15).join('\n  - ') : 'aucun changement listé'}`);
} catch (e) { notes.push(`notes de patch illisibles : ${e.message}`); }

console.log('\n===== Draft Lab : tests du ' + new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) + ' =====');
console.log(issues.length ? `PROBLÈMES (${issues.length}) :\n- ` + issues.join('\n- ') : 'PROBLÈMES : aucun');
console.log('\nINFOS :\n- ' + notes.join('\n- '));
process.exit(issues.length ? 1 : 0);
