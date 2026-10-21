// gol.gg : présence pick/ban et winrate des champions en compétition pro (saison en cours).
// Pas d'API officielle : on lit le tableau HTML de la page "champion list".
const { get, norm, championIndex } = require('./http');

const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const num = (s) => {
  const n = parseFloat(String(s).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function parseTable(html, champions) {
  const idx = championIndex(champions);
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  let headers = null;
  const out = {};
  for (const row of rows) {
    const ths = row.match(/<th[\s\S]*?<\/th>/gi);
    if (ths && ths.length > 3) {
      headers = ths.map((h) => strip(h).toLowerCase());
      continue;
    }
    if (!headers) continue;
    const tds = (row.match(/<td[\s\S]*?<\/td>/gi) ?? []).map(strip);
    if (tds.length < 4) continue;
    const titleName = row.match(/title=['"]([^'"]+?)(?: stats)?['"]/i)?.[1];
    const id = idx.byName.get(norm(tds[0])) || idx.byName.get(norm(titleName));
    if (!id) continue;
    const col = (re) => {
      const i = headers.findIndex((h) => re.test(h));
      return i >= 0 ? num(tds[i]) : null;
    };
    out[id] = {
      picks: col(/^picks?$/) ?? 0,
      bans: col(/^bans?$/) ?? 0,
      presence: col(/presence/),
      wr: col(/^(winrate|wr|win ?rate)/)
    };
  }
  // gol.gg n'affiche pas toujours la présence : on la calcule (picks+bans) / nombre de games.
  const games = Object.values(out).reduce((a, c) => a + c.picks, 0) / 10;
  for (const c of Object.values(out)) {
    if (c.presence == null) c.presence = games ? +(((c.picks + c.bans) / games) * 100).toFixed(1) : 0;
  }
  return out;
}

// Stats par rôle : gol.gg filtre le rôle via un formulaire POST qui stocke le choix
// en session (cookie PHPSESSID), puis redirige vers la page. On rejoue ce parcours.
const ROLE_KEYS = { TOP: 'T', JUNGLE: 'J', MID: 'M', ADC: 'A', SUPPORT: 'S' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function fetchRole(url, role, champions) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const post = await fetch(url, {
      method: 'POST', redirect: 'manual', signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
      body: `role=${role}&leaguePost=true`
    });
    const cookies = (post.headers.getSetCookie?.() ?? [post.headers.get('set-cookie')]).filter(Boolean)
      .map((c) => c.split(';')[0]).join('; ');
    if (!cookies) throw new Error('pas de session gol.gg');
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Cookie: cookies, Referer: url } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseTable(await res.text(), champions);
  } finally {
    clearTimeout(t);
  }
}

// Les 5 pages par rôle en parallèle (une session gol.gg chacune). Les totaux par champion
// sont recalculés à partir des rôles, ce qui évite de télécharger la page générale.
async function fetchGolgg(champions) {
  const season = `S${new Date().getFullYear() - 2010}`;
  const urls = [
    `https://gol.gg/champion/list/season-${season}/split-ALL/tournament-ALL/`,
    `https://gol.gg/champion/list/season-ALL/split-ALL/tournament-ALL/`
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const roles = await Promise.allSettled(Object.keys(ROLE_KEYS).map(async (r) => {
        try { return await fetchRole(url, r, champions); } catch { return await fetchRole(url, r, champions); }
      }));
      const data = {};
      let okRoles = 0;
      roles.forEach((r, i) => {
        if (r.status !== 'fulfilled' || Object.keys(r.value).length < 10) return;
        okRoles++;
        const rk = Object.values(ROLE_KEYS)[i];
        for (const [id, st] of Object.entries(r.value)) {
          const d = (data[id] ??= { picks: 0, bans: 0, wins: 0, roles: {} });
          d.bans = Math.max(d.bans, st.bans || 0);
          if (!st.picks) continue;
          d.picks += st.picks;
          d.wins += ((st.wr ?? 50) / 100) * st.picks;
          d.roles[rk] = { picks: st.picks, wr: st.wr };
        }
      });
      if (okRoles < 3) {
        // secours : page générale seule (sans détail par rôle)
        const html = await get(url, { type: 'text' });
        const all = parseTable(html, champions);
        if (Object.keys(all).length >= 20) return { pro: all, season, okRoles: 0 };
        lastErr = new Error('tableau introuvable');
        continue;
      }
      const games = Object.values(data).reduce((a, c) => a + c.picks, 0) / 10;
      for (const d of Object.values(data)) {
        d.wr = d.picks ? Math.round((d.wins / d.picks) * 100) : null;
        d.presence = games ? +(((d.picks + d.bans) / games) * 100).toFixed(1) : 0;
        delete d.wins;
      }
      return { pro: data, season, okRoles };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

module.exports = { fetchGolgg, parseTable };
