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

// Accepte un ou plusieurs liens op.gg (multi-search ou page d'un joueur), une liste collée
// "Nom#TAG, Nom#TAG" (une ligne ou plusieurs), le chat du salon, ou un mélange de tout ça :
// on ne garde que les pseudos.
const URL_RE = /(?:https?:\/\/)?(?:[a-z]+\.)?op\.gg\/\S+/gi;
function namesFromUrl(raw) {
  try {
    const u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
    const m = u.pathname.match(/multisearch\/([a-z]+)/i) || u.pathname.match(/summoners\/([a-z]+)\//i);
    let region = m && REGIONS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
    if (u.searchParams.get('region')) region = u.searchParams.get('region').toLowerCase();
    const s = u.searchParams.get('summoners');
    if (s) return { region, names: s.split(/[,\n]+/) };
    const one = u.pathname.match(/summoners\/[a-z]+\/([^/]+)/i);
    if (one) return { region, names: [decodeURIComponent(one[1]).replace(/-([^-]+)$/, '#$1')] };
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
  // le reste du texte (hors liens) : pseudos séparés par des virgules, des lignes ou des points-virgules
  for (const x of text.replace(URL_RE, '\n').split(/[,\n;]+/)) names.push(x);
  const seen = new Set();
  const out = names
    .map((x) => x.replace(/\s+(joined the lobby|a rejoint le salon).*/i, '').replace(/\s+/g, ' ').trim())
    .filter((x) => x && !/^https?:/i.test(x) && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .slice(0, max);
  return { region: region ?? fallbackRegion, names: out };
}

const normTag = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();
const normName = (n) => String(n || '').replace(/\s+/g, '').toLowerCase();

async function findSummoner(region, riotId) {
  const [name, tag] = riotId.split('#');
  const pick = (list) => {
    if (!list?.length) return null;
    const exact = list.find((x) => normName(x.game_name) === normName(name) && (!tag || normTag(x.tagline) === normTag(tag)));
    return exact || (tag ? null : list.find((x) => normName(x.game_name) === normName(name)) || list[0]);
  };
  const q1 = await getJson(`${BASE}/v3/${region}/summoners?riot_id=${encodeURIComponent(riotId)}&hl=fr_FR`).catch(() => null);
  let s = pick(q1?.data?.filter((x) => x.summoner_id));
  if (!s && tag) {
    const q2 = await getJson(`${BASE}/v3/${region}/summoners?riot_id=${encodeURIComponent(name)}&hl=fr_FR`).catch(() => null);
    s = pick(q2?.data?.filter((x) => x.summoner_id));
  }
  return s;
}

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
  const { region, names } = parseInput(input, fallbackRegion, 10);
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

module.exports = { fetchTeam, fetchPlayers, parseInput };
