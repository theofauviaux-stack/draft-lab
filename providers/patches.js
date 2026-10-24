// Notes de patch officielles (Riot) : quels champions ont été modifiés directement, et à quel patch.
// Sert à la fenêtre de données : on prend les 30 derniers jours, sauf pour un champion modifié
// par un patch sorti pendant ces 30 jours, dont on ne garde que les données depuis ce patch.
// Seuls les changements directs comptent (section « Champions » + mises à jour en cours de patch),
// pas les objets, les runes ni les modes ARAM / Arena.
const { get, championIndex, norm } = require('./http');

const WINDOW_DAYS = 30;
const DAY = 864e5;
// Data Dragon 16.21 <=> patch 26.21 dans les notes Riot
const label = (p) => { const [M, m] = p.split('.').map(Number); return `${M + 10}.${m}`; };
const vnum = (p) => p.split('.').map(Number).reduce((a, x) => a * 100 + x, 0);

function noteUrls(p) {
  const [M, m] = label(p).split('.');
  const base = 'https://www.leagueoflegends.com/en-us/news/game-updates/';
  return [`${base}league-of-legends-patch-${M}-${m}-notes/`, `${base}patch-${M}-${m}-notes/`, `${base}patch-${M}-${m.padStart(2, '0')}-notes/`];
}

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim();

// Renvoie { date, champs: [ids] } pour une page de notes de patch
function parseNotes(html, idx) {
  const date = (html.match(/"datePublished":"([^"]+)"/) || html.match(/"publishDate":"([^"]+)"/) || [])[1];
  const heads = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => ({ i: m.index, t: strip(m[1]).toLowerCase() }));
  const sectionAt = (i) => heads.filter((h) => h.i < i).pop()?.t ?? '';
  const toId = (name, href) => idx.byName.get(norm(href)) || idx.byName.get(norm(name)) || null;
  const champs = new Set();
  // champions modifiés : titres h3 de la section « Champions »
  for (const m of html.matchAll(/<h3 class="change-title"[^>]*>([\s\S]*?)<\/h3>/g)) {
    if (sectionAt(m.index) !== 'champions') continue;
    const href = (m[1].match(/\/champions\/([^/"]+)/) || [])[1]?.replace(/&amp;/g, '');
    const id = toId(strip(m[1]), href);
    if (id) champs.add(id);
  }
  // mises à jour en cours de patch : noms en h4 sous la section « Mid-Patch Updates »
  for (const m of html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)) {
    if (!/mid-patch/.test(sectionAt(m.index))) continue;
    const id = toId(strip(m[1]));
    if (id) champs.add(id);
  }
  return { date: date ? Date.parse(date) : null, champs: [...champs] };
}

// versions : liste Data Dragon (16.21.1, 16.20.1…). Renvoie
// { from, patches: [{ patch, label, start, champs }], changed: { champId: '16.21' } }
async function fetchPatchChanges(versions, champions, now = Date.now()) {
  const idx = championIndex(champions);
  const list = [...new Set(versions.map((v) => v.split('.').slice(0, 2).join('.')))].slice(0, 4);
  const from = now - WINDOW_DAYS * DAY;
  const patches = [];
  for (const p of list) {
    let notes = null;
    for (const u of noteUrls(p)) {
      try { notes = parseNotes(await get(u, { type: 'text', timeout: 30000 }), idx); break; } catch {}
    }
    if (!notes) { if (!patches.length) continue; break; }
    // le patch arrive en jeu environ un jour après la publication des notes
    const start = (notes.date ?? now) + DAY;
    patches.push({ patch: p, label: label(p), start, champs: notes.champs });
    if (start <= from) break; // ce patch a commencé avant la fenêtre : les plus anciens ne comptent plus
  }
  if (!patches.length) throw new Error('notes de patch indisponibles');
  const changed = {};
  // du plus récent au plus ancien : on garde le changement le plus récent de chaque champion
  for (const x of patches) {
    if (x.start <= from) continue;
    for (const c of x.champs) if (!changed[c]) changed[c] = x.patch;
  }
  return { from, patches, changed };
}

// Patchs Data Dragon à additionner pour « depuis le patch p » (p inclus, jusqu'au patch actuel)
function patchesSince(p, current) {
  const out = [];
  const [M, m0] = current.split('.').map(Number);
  for (let m = m0; m >= 1; m--) { const q = `${M}.${m}`; out.push(q); if (q === p) return out; }
  if (+p.split('.')[0] < M) { out.push(p); return out; } // patch de l'année précédente (janvier)
  return vnum(p) <= vnum(current) ? out : [current];
}

module.exports = { fetchPatchChanges, parseNotes, patchesSince, label, WINDOW_DAYS };
