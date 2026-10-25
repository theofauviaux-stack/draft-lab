// Réglages d'interface du jeu (fichier game.cfg du dossier League of Legends) : taille de la mini-carte,
// mini-carte à gauche ou à droite, échelle de l'interface. Servent à poser le calque de Draft Lab
// exactement sur la mini-carte du jeu.
const fs = require('fs');
const path = require('path');

function candidates(installDir) {
  const out = [];
  if (installDir) out.push(path.join(installDir, 'Config', 'game.cfg'), path.join(installDir, 'Game', 'Config', 'game.cfg'));
  if (process.platform === 'darwin') out.push('/Applications/League of Legends.app/Contents/LoL/Config/game.cfg');
  else for (const d of ['C', 'D', 'E', 'F']) out.push(`${d}:\\Riot Games\\League of Legends\\Config\\game.cfg`);
  return out;
}
function readHud(installDir = process.env.DRAFTLAB_LOL_DIR) {
  for (const f of candidates(installDir)) {
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const hud = (txt.split(/^\[HUD\]\s*$/m)[1] ?? txt).split(/^\[/m)[0];
    const num = (k) => { const m = hud.match(new RegExp(`^\\s*${k}\\s*=\\s*([\\d.]+)`, 'mi')); return m ? +m[1] : null; };
    return { file: f, minimapScale: num('MinimapScale'), flip: num('FlipMiniMap') === 1, globalScale: num('GlobalScale') };
  }
  return null;
}
module.exports = { readHud };
