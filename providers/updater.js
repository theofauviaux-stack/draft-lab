// Mises à jour automatiques de l'application (code + interface) depuis les releases GitHub.
// Chaque release contient un fichier "draftlab-update.json.gz" : tous les fichiers de l'app,
// et dans la description de la release la ligne  sha256: <empreinte>  pour vérifier le téléchargement.
// Le nouveau code est installé dans le dossier utilisateur et lancé au prochain démarrage (voir boot.js).
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const UA = 'DraftLab-Updater';
const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
};
const doFetch = (u, o = {}) => {
  try { const { net } = require('electron'); if (net?.fetch) return net.fetch(u, o); } catch {}
  return fetch(u, o);
};

function repo() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.updateRepo && !/OWNER/.test(pkg.updateRepo) ? pkg.updateRepo : null;
  } catch { return null; }
}

async function checkForUpdate(current) {
  const r = repo();
  if (!r) return { status: 'off', message: 'Mises à jour automatiques pas encore configurées (dépôt GitHub manquant).' };
  const res = await doFetch(`https://api.github.com/repos/${r}/releases/latest`, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } });
  if (!res.ok) return { status: 'error', message: `GitHub : ${res.status}` };
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!version || !newer(version, current)) return { status: 'uptodate', version: current };
  const asset = (rel.assets || []).find((a) => a.name === 'draftlab-update.json.gz');
  const sha = (String(rel.body || '').match(/sha256:\s*([a-f0-9]{64})/i) || [])[1];
  if (!asset || !sha) return { status: 'error', message: 'release incomplète (fichier ou empreinte manquant)' };
  return { status: 'available', version, url: asset.browser_download_url, sha, notes: String(rel.body || '').replace(/sha256:.*$/im, '').trim() };
}

async function install(info) {
  const res = await doFetch(info.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`téléchargement impossible (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== info.sha.toLowerCase()) throw new Error('empreinte invalide, mise à jour ignorée');
  const bundle = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  if (!bundle.files?.['main.js'] || !bundle.files?.['boot.js']) throw new Error('paquet de mise à jour invalide');
  const root = path.join(app.getPath('userData'), 'app-update');
  const dir = path.join(root, info.version);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, b64] of Object.entries(bundle.files)) {
    const dest = path.join(dir, rel);
    if (!dest.startsWith(dir + path.sep)) continue; // pas de chemin hors du dossier
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
  }
  // les modules npm éventuels restent ceux de l'application installée
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ version: info.version, at: Date.now() }));
  // nettoyage des anciennes versions
  for (const d of fs.readdirSync(root)) {
    if (d !== info.version && d !== 'current.json') fs.rmSync(path.join(root, d), { recursive: true, force: true });
  }
  return info.version;
}

// Vérifie, télécharge et installe ; prévient l'interface quand une version est prête au redémarrage.
async function autoUpdate(send) {
  const current = global.DRAFTLAB_VERSION || app.getVersion();
  try {
    const info = await checkForUpdate(current);
    if (info.status !== 'available') { send({ ...info, current }); return; }
    send({ status: 'downloading', version: info.version, current });
    await install(info);
    send({ status: 'ready', version: info.version, current, notes: info.notes });
  } catch (e) {
    send({ status: 'error', message: e.message, current });
  }
}

module.exports = { autoUpdate, checkForUpdate };
