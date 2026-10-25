// Lecture des pseudos sur une capture (texte sur une ligne) avec Tesseract.js, chargé à la demande
// depuis jsDelivr la première fois (le modèle de langue est ensuite gardé en cache par le navigateur).
const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerP = null;

function loadLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = CDN; s.onload = () => res(window.Tesseract); s.onerror = () => rej(new Error('lecture du texte indisponible (connexion)'));
    document.head.appendChild(s);
  });
}
function worker() {
  workerP ??= (async () => {
    const T = await loadLib();
    const w = await T.createWorker('fra', 1);
    await w.setParameters({ tessedit_pageseg_mode: '7' }); // une seule ligne
    return w;
  })().catch((e) => { workerP = null; throw e; });
  return workerP;
}

// Ligne de texte clair sur fond sombre (pseudos du jeu) : agrandie, en niveaux de gris inversés (texte foncé
// sur fond clair). Pas de seuil noir / blanc : il effacerait les accents (Blàst, Okabë).
export function lineCanvas(img, x, y, w, h, k = 3) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.round(Math.min(w, img.width - x)); h = Math.round(Math.min(h, img.height - y));
  const cv = Object.assign(document.createElement('canvas'), { width: w * k, height: h * k });
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, w, h, 0, 0, w * k, h * k);
  const id = ctx.getImageData(0, 0, cv.width, cv.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return cv;
}

// Nettoie le texte lu : bords du cadre lus comme « | », espaces en trop
export const cleanName = (t) => String(t ?? '').replace(/[|\[\]{}()<>«»"“”_~=*]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// Mots lus : on retire aux deux bouts ce qui vient du cadre ou du décor (« | », « 7 », « ; »…)
function lineText(data) {
  const ws = (data.words ?? []).map((x) => x.text);
  if (!ws.length) return cleanName(data.text);
  const junk = (t) => !/[\p{L}\p{N}]/u.test(t) || (t.length === 1 && !/\p{L}/u.test(t));
  while (ws.length && junk(ws[0])) ws.shift();
  while (ws.length && junk(ws[ws.length - 1])) ws.pop();
  return cleanName(ws.join(' '));
}
export async function readLines(canvases) {
  const w = await worker();
  const out = [];
  for (const cv of canvases) {
    try { const r = await w.recognize(cv); out.push(lineText(r.data)); } catch { out.push(''); }
  }
  return out;
}
