// Point d'entrée : lance la version la plus récente de Draft Lab.
// Les mises à jour automatiques sont installées dans le dossier utilisateur (app-update/<version>).
// Si une version installée est plus récente que celle livrée avec l'application, on la démarre ;
// sinon (ou si elle est abîmée) on démarre la version livrée.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const newer = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
};

function pickApp() {
  const bundled = app.getVersion();
  try {
    const root = path.join(app.getPath('userData'), 'app-update');
    const cur = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
    const dir = path.join(root, cur.version);
    if (newer(cur.version, bundled) && fs.existsSync(path.join(dir, 'main.js')) && !fs.existsSync(path.join(dir, '.failed'))) {
      return { dir, version: cur.version };
    }
  } catch {}
  return { dir: __dirname, version: bundled };
}

const chosen = pickApp();
global.DRAFTLAB_VERSION = chosen.version;
global.DRAFTLAB_BUNDLED = __dirname;
try {
  require(path.join(chosen.dir, 'main.js'));
} catch (e) {
  // Version téléchargée défectueuse : on la marque et on retombe sur la version livrée.
  if (chosen.dir !== __dirname) {
    try { fs.writeFileSync(path.join(chosen.dir, '.failed'), String(e?.stack || e)); } catch {}
    global.DRAFTLAB_VERSION = app.getVersion();
    require(path.join(__dirname, 'main.js'));
  } else throw e;
}
