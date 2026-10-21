// Petit utilitaire HTTP commun (fetch natif de Node/Electron, avec délai max).
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Dans l'app, on passe par la pile réseau de Chromium (proxy système, certificats de l'OS).
// Hors Electron (tests), on retombe sur le fetch de Node.
function pickFetch() {
  try {
    const { net } = require('electron');
    if (net?.fetch) return (u, o) => net.fetch(u, o);
  } catch {}
  return (u, o) => fetch(u, o);
}
const doFetch = pickFetch();

async function get(url, { type = 'json', timeout = type === 'json' ? 20000 : 90000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await doFetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json,*/*' : 'text/html,*/*' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
    return type === 'json' ? await res.json() : await res.text();
  } finally {
    clearTimeout(t);
  }
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

// Index nom/id/clé -> id Data Dragon
function championIndex(champions) {
  const byKey = new Map();
  const byName = new Map();
  for (const c of champions) {
    byKey.set(String(c.key), c.id);
    byName.set(norm(c.id), c.id);
    byName.set(norm(c.name), c.id);
    if (c.nameEn) byName.set(norm(c.nameEn), c.id);
  }
  // Alias fréquents sur les sites tiers
  const alias = { wukong: 'MonkeyKing', nunuwillump: 'Nunu', renataglasc: 'Renata', nunu: 'Nunu' };
  for (const [a, id] of Object.entries(alias)) if (!byName.has(a)) byName.set(a, id);
  return { byKey, byName };
}

module.exports = { get, norm, championIndex };
