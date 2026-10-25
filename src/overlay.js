// Fenêtre overlay : dessine le panneau à chaque mise à jour, et chaque seconde pour l'horloge de la partie
import { overlayHtml, OVERLAY_CSS } from './overlayview.js';
document.getElementById('ovcss').textContent = OVERLAY_CSS;
let data = null;
const draw = () => { document.getElementById('root').innerHTML = overlayHtml(data); };
window.overlay?.onUpdate((d) => { data = d; draw(); });
window.overlay?.onMove((on) => document.body.classList.toggle('move', on));
draw(); setInterval(draw, 1000);
