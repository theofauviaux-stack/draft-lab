// Fenêtre overlay : dessine le panneau à chaque mise à jour, et chaque seconde pour l'horloge de la partie
import { overlayHtml, minimapLayerHtml, OVERLAY_CSS } from './overlayview.js';
// la même page sert au panneau et au calque de la mini-carte (?mini)
const MINI = location.search.includes('mini');
document.getElementById('ovcss').textContent = OVERLAY_CSS;
let data = null;
const draw = () => { document.getElementById('root').innerHTML = MINI ? minimapLayerHtml(data) : overlayHtml(data); };
if (MINI) { document.body.classList.add('mini'); document.querySelector('.mv').textContent = 'Ajuste le calque sur la mini-carte (glisser, coin pour la taille) puis Ctrl+Maj+F'; }
window.overlay?.onUpdate((d) => { data = d; draw(); });
window.overlay?.onMove((on) => document.body.classList.toggle('move', on));
draw(); setInterval(draw, 1000);
