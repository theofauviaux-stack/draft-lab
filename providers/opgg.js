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

// Accepte un lien multi op.gg (www.op.gg/multisearch/euw?summoners=A%23TAG,B%23TAG)
// ou une liste collée "Nom#TAG, Nom#TAG" (une ligne ou plusieurs).
function parseInput(input, fallbackRegion = 'euw') {
  let region = fallbackRegion;
  let list = String(input || '').trim();
  try {
    if (/^https?:\/\//i.test(list) || /op\.gg/i.test(list)) {
      const u = new URL(/^https?:/i.test(list) ? list : `https://${list}`);
      const m = u.pathname.match(/multisearch\/([a-z]+)/i) || u.pathname.match(/summoners\/([a-z]+)\//i);
      if (m && REGIONS.includes(m[1].toLowerCase())) region = m[1].toLowerCase();
      if (u.searchParams.get('region')) region = u.searchParams.get('region').toLowerCase();
      const s = u.searchParams.get('summoners');
      if (s) list = s;
      else {
        const one = u.pathname.match(/summoners\/[a-z]+\/([^/]+)/i);
        if (one) list = decodeURIComponent(one[1]).replace(/-([^-]+)$/, '#$1');
      }
    }
  } catch {}
  const names = list.split(/[,\n;]+/).map((x) => x.replace(/\s+joined the lobby.*/i, '').trim()).filter(Boolean).slice(0, 5);
  return { region, names };
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
    getJson(`${BASE}/${region}/summoners/${s.summoner_id}/summary?hl=fr_FR`),
    // tous les champions joués en ranked (solo + flex) sur la saison en cours
    getJson(`${BASE}/${region}/summoners/${s.summoner_id}/most-champions/rank?game_type=RANKED&hl=fr_FR`).catch(() => null)
  ]);
  const d = sum?.data?.summoner ?? {};
  const season = most?.data?.champion_stats ? most.data : d.most_champions;
  const solo = (d.league_stats ?? []).find((l) => l.game_type === 'SOLORANKED' && l.tier_info?.tier)
    ?? (d.league_stats ?? []).find((l) => l.game_type === 'FLEXRANKED' && l.tier_info?.tier);
  const prev = (d.previous_seasons ?? []).find((x) => x.tier_info?.tier);
  // Données de rang structurées pour le pronostic hors draft
  const rank = {
    tier: solo?.tier_info?.tier ?? null, division: solo?.tier_info?.division ?? null, lp: solo?.tier_info?.lp ?? null,
    queue: solo?.game_type ?? null, wins: solo?.win ?? 0, losses: solo?.lose ?? 0,
    hot: !!solo?.is_hot_streak, veteran: !!solo?.is_veteran, fresh: !!solo?.is_fresh_blood, inactive: !!solo?.is_inactive,
    prevTier: prev?.tier_info?.tier ?? null, prevDivision: prev?.tier_info?.division ?? null
  };
  const tier = solo?.tier_info?.tier ? `${solo.tier_info.tier[0]}${solo.tier_info.tier.slice(1).toLowerCase()}${solo.tier_info.division ? ' ' + solo.tier_info.division : ''}${solo.tier_info.lp != null ? ` ${solo.tier_info.lp} LP` : ''}` : 'Non classé';
  // On garde les champions qui représentent au moins 1 % des games ranked de la saison
  const total = season?.play || (season?.champion_stats ?? []).reduce((a, c) => a + c.play, 0);
  const pool = (season?.champion_stats ?? [])
    .map((c) => ({ id: byKey.get(String(c.id)), games: c.play, wins: c.win, share: total ? +((c.play / total) * 100).toFixed(1) : 0 }))
    .filter((c) => c.id && c.games > 0 && c.share >= 1)
    .sort((a, b) => b.games - a.games);
  return { riotId: `${d.game_name ?? s.game_name}#${String(d.tagline ?? s.tagline).replace(/\s+/g, '')}`, tier, rank, pool, total, level: d.level };
}

async function fetchTeam(input, champions, fallbackRegion) {
  const { region, names } = parseInput(input, fallbackRegion);
  if (!names.length) throw new Error('Aucun joueur trouvé dans le lien ou la liste');
  const byKey = new Map(champions.map((c) => [String(c.key), c.id]));
  const players = await Promise.all(names.map((n) => fetchPlayer(region, n, byKey).catch((e) => ({ riotId: n, error: e.message }))));
  return { region, players };
}

module.exports = { fetchTeam, parseInput };
