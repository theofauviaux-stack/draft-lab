// op.gg : pool de champions des joueurs d'une équipe, à partir d'un lien multi-search.
// op.gg n'a pas d'API publique documentée : on utilise les mêmes points d'accès que leur site.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const BASE = 'https://lol-api-summoner.op.gg/api';
const REGIONS = ['euw', 'eune', 'na', 'kr', 'br', 'jp', 'lan', 'las', 'oce', 'tr', 'ru', 'me', 'sg', 'tw', 'vn', 'ph', 'th'];

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Accepte un ou plusieurs liens (op.gg multi-search ou page d'un joueur, et aussi u.gg, porofessor,
// leagueofgraphs, deeplol, mobalytics, dpm.lol…), une liste collée "Nom#TAG, Nom#TAG" (une ligne ou
// plusieurs), le chat du salon, ou un mélange : on ne garde que les pseudos.
const URL_RE = /(?:https?:\/\/|www\.)\S+|(?:[a-z]+\.)?op\.gg\/\S+/gi;
// régions écrites à la façon Riot (euw1, na1…) ou des sites
const REGION_ALIAS = { euw1: 'euw', eun1: 'eune', na1: 'na', kr: 'kr', br1: 'br', jp1: 'jp', la1: 'lan', la2: 'las', oc1: 'oce', tr1: 'tr', ru: 'ru', me1: 'me', sg2: 'sg', tw2: 'tw', vn2: 'vn', ph2: 'ph', th2: 'th' };
const toRegion = (x) => { const r = String(x || '').toLowerCase(); return REGIONS.includes(r) ? r : REGION_ALIAS[r] ?? null; };
// "Nom-TAG" (tiret en trop possible à la fin) ou "Nom#TAG" -> "Nom#TAG"
const segName = (seg) => { const d = decodeURIComponent(seg).replace(/\+/g, ' ').replace(/-+$/, ''); return d.includes('#') ? d : d.replace(/-([^-]+)$/, '#$1'); };
function namesFromUrl(raw) {
  try {
    const u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
    const parts = u.pathname.split('/').filter(Boolean);
    // la région suit le mot-clé de la page (/summoners/euw/…) ; sinon le premier segment qui en est une
    // (attention : /tr/ ou /kr/ en tête de lien peut n'être que la langue du site)
    const kw = parts.findIndex((p) => /^(summoners?|profile|live|multisearch|multi)$/i.test(p));
    let ri = kw >= 0 && toRegion(parts[kw + 1]) ? kw + 1 : parts.findIndex((p) => toRegion(p));
    let region = ri >= 0 ? toRegion(parts[ri]) : null;
    if (u.searchParams.get('region')) region = toRegion(u.searchParams.get('region')) ?? region;
    const s = u.searchParams.get('summoners');
    if (s) return { region, names: s.split(/[,\n]+/) };
    // page d'un joueur : le segment qui suit la région (/summoners/euw/Nom-TAG, /profile/euw1/nom-tag/overview…)
    let seg = ri >= 0 ? parts[ri + 1] : null;
    if (!seg) seg = parts.find((p) => /-|%23|#/.test(p) && !/^(fr|en|lol|summoners?|profile|live|multisearch)$/i.test(p)); // dpm.lol/Nom-TAG
    if (seg && /[-#]|%23/.test(decodeURIComponent(seg) + seg)) return { region, names: [segName(seg)] };
  } catch {}
  return { region: null, names: [] };
}
function parseInput(input, fallbackRegion = 'euw', max = 5) {
  let region = null;
  const text = String(input || '');
  const names = [];
  for (const m of text.match(URL_RE) ?? []) {
    const r = namesFromUrl(m.replace(/[,;]+$/, ''));
    region ??= r.region;
    names.push(...r.names);
  }
  // Sans lien : pseudos séparés par des virgules, des lignes ou des points-virgules.
  // Avec des liens, seuls les liens comptent (le texte autour, comme « UCW Koda : », est un surnom).
  if (!names.length) for (const x of text.split(/[,\n;]+/)) names.push(x);
  const seen = new Set();
  const out = names
    .map((x) => x.replace(/\s+(joined the lobby|a rejoint le salon).*/i, '').replace(/\s+/g, ' ').replace(/\s*#\s*/, '#').trim())
    .filter((x) => x && !/^https?:/i.test(x) && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .slice(0, max);
  return { region: region ?? fallbackRegion, names: out };
}

const normTag = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();
const normName = (n) => String(n || '').replace(/\s+/g, '').toLowerCase();

async function findSummoner(region, riotId) {
  const [nm, tag] = riotId.split('#'), name = nm;
  const pick = (list, name = nm) => {
    if (!list?.length) return null;
    const exact = list.find((x) => normName(x.game_name) === normName(name) && (!tag || normTag(x.tagline) === normTag(tag)));
    if (exact) return exact;
    const same = list.filter((x) => normName(x.game_name) === normName(name));
    // tag changé (ex. « UC akirielle#YOLO » devenu « UC akirielle#PANDA ») : un seul compte à ce nom, c'est lui
    if (tag) return same.length === 1 ? same[0] : null;
    // pseudo sans tag (lu sur une capture) : plusieurs comptes peuvent porter ce nom, on prend le plus joué
    if (same.length) return same.reduce((a, x) => ((x.level ?? 0) > (a.level ?? 0) ? x : a));
    return null;
  };
  const search = async (q, n) => pick((await getJson(`${BASE}/v3/${region}/summoners?riot_id=${encodeURIComponent(q)}&hl=fr_FR`).catch(() => null))?.data?.filter((x) => x.summoner_id), n);
  let s = await search(riotId);
  if (!s && tag) s = await search(name);
  // pseudo lu sur une image : un accent a pu être perdu ou mal lu (Blast pour Blàst) ; op.gg ne cherche
  // que le nom exact, on essaie donc les variantes accentuées (une lettre à la fois)
  if (!s && !tag) {
    for (const group of chunks(accentVariants(name), 6)) {
      const found = (await Promise.all(group.map((v) => search(v, v)))).find(Boolean);
      if (found) { s = found; break; }
    }
  }
  return s;
}
const ACC = { a: 'àáâäãå', e: 'éèêë', i: 'íìîï', o: 'óòôöõø', u: 'úùûü', y: 'ýÿ', n: 'ñ', c: 'ç' };
const bare = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function accentVariants(name, max = 36) {
  const base = bare(name), out = [];
  if (base !== name) out.push(base);
  for (let i = 0; i < base.length; i++) {
    const ch = base[i], low = ch.toLowerCase(), alts = ACC[low];
    if (!alts) continue;
    for (const a of alts) out.push(base.slice(0, i) + (ch === low ? a : a.toUpperCase()) + base.slice(i + 1));
  }
  return [...new Set(out)].filter((v) => v !== name).slice(0, max);
}
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, k) => a.slice(k * n, k * n + n));

async function fetchPlayer(region, riotId, byKey) {
  const s = await findSummoner(region, riotId);
  if (!s) return { riotId, error: 'joueur introuvable sur op.gg' };
  const [sum, most] = await Promise.all([
    // le résumé op.gg tombe parfois en erreur pour un compte : on lit alors le rang sur sa page op.gg
    getJson(`${BASE}/${region}/summoners/${s.summoner_id}/summary?hl=fr_FR`).catch(() => pageSummary(region, s)),
    // tous les champions joués en ranked (solo + flex) sur la saison en cours
    getJson(`${BASE}/${region}/summoners/${s.summoner_id}/most-champions/rank?game_type=RANKED&hl=fr_FR`).catch(() => null)
  ]);
  const d = sum?.data?.summoner ?? {};
  const season = most?.data?.champion_stats ? most.data : d.most_champions;
  // le calcul n'utilise que la Solo/Duo ; la Flex est seulement affichée
  const solo = (d.league_stats ?? []).find((l) => l.game_type === 'SOLORANKED' && l.tier_info?.tier);
  const flexL = (d.league_stats ?? []).find((l) => l.game_type === 'FLEXRANKED' && l.tier_info?.tier);
  const prev = (d.previous_seasons ?? []).find((x) => x.tier_info?.tier);
  // Données de rang structurées pour le pronostic hors draft
  const rank = {
    tier: solo?.tier_info?.tier ?? null, division: solo?.tier_info?.division ?? null, lp: solo?.tier_info?.lp ?? null,
    queue: solo?.game_type ?? null, wins: solo?.win ?? 0, losses: solo?.lose ?? 0,
    hot: !!solo?.is_hot_streak, veteran: !!solo?.is_veteran, fresh: !!solo?.is_fresh_blood, inactive: !!solo?.is_inactive,
    prevTier: prev?.tier_info?.tier ?? null, prevDivision: prev?.tier_info?.division ?? null,
    flex: flexL ? { tier: flexL.tier_info.tier, division: flexL.tier_info.division ?? null, lp: flexL.tier_info.lp ?? null, wins: flexL.win ?? 0, losses: flexL.lose ?? 0 } : null
  };
  const tier = solo?.tier_info?.tier ? `${solo.tier_info.tier[0]}${solo.tier_info.tier.slice(1).toLowerCase()}${solo.tier_info.division ? ' ' + solo.tier_info.division : ''}${solo.tier_info.lp != null ? ` ${solo.tier_info.lp} LP` : ''}` : 'Non classé';
  // On garde les champions qui représentent au moins 1 % des games ranked de la saison
  const total = season?.play || (season?.champion_stats ?? []).reduce((a, c) => a + c.play, 0);
  // tous les champions joués (pour pouvoir remettre un champion retiré avec ses vraies stats)
  const all = (season?.champion_stats ?? [])
    .map((c) => ({ id: byKey.get(String(c.id)), games: c.play, wins: c.win, share: total ? +((c.play / total) * 100).toFixed(1) : 0 }))
    .filter((c) => c.id && c.games > 0);
  const pool = all.filter((c) => c.share >= 1)
    .sort((a, b) => b.games - a.games);
  return { riotId: `${d.game_name ?? s.game_name}#${String(d.tagline ?? s.tagline).replace(/\s+/g, '')}`, tier, rank, pool, all, total, level: d.level };
}

// Secours : rang Solo/Duo lu dans la description de la page op.gg du joueur
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
async function pageSummary(region, s) {
  const url = `https://op.gg/lol/summoners/${region}/${encodeURIComponent(s.game_name)}-${encodeURIComponent(s.tagline)}`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  let html;
  try { const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/html' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); html = await r.text(); }
  finally { clearTimeout(t); }
  const m = html.match(/current SOLORANKED rank is ([a-z]+)(?: Division (\d))? ([\d,]+) LP with (\d+) wins, (\d+) losses/i);
  const tier = m && TIERS.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
  const league_stats = tier ? [{ game_type: 'SOLORANKED', tier_info: { tier, division: ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? null : +m[2] || null, lp: +m[3].replace(/,/g, '') }, win: +m[4], lose: +m[5] }] : [];
  return { data: { summoner: { game_name: s.game_name, tagline: s.tagline, league_stats, previous_seasons: [] } } };
}

// Jusqu'à 10 joueurs (équilibrage in house) : rang et champions joués, sans le complément dpm.lol
async function fetchPlayers(input, champions, fallbackRegion) {
  const { region, names } = parseInput(input, fallbackRegion, 20);
  if (!names.length) throw new Error('Aucun joueur trouvé dans la liste');
  const byKey = new Map(champions.map((c) => [String(c.key), c.id]));
  const players = await Promise.all(names.map((n) => fetchPlayer(region, n, byKey).catch((e) => ({ riotId: n, error: e.message }))));
  return { region, players };
}

async function fetchTeam(input, champions, fallbackRegion) {
  const { region, names } = parseInput(input, fallbackRegion);
  if (!names.length) throw new Error('Aucun joueur trouvé dans le lien ou la liste');
  const byKey = new Map(champions.map((c) => [String(c.key), c.id]));
  const players = await Promise.all(names.map((n) => fetchPlayer(region, n, byKey).catch((e) => ({ riotId: n, error: e.message }))));
  return { region, players };
}

module.exports = { fetchTeam, fetchPlayers, fetchPlayer, parseInput };
