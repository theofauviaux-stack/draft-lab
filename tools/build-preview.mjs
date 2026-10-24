// Construit un aperçu web autonome (un seul fichier HTML) de Draft Lab.
// Usage : node tools/build-preview.mjs <sortie.html>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(ROOT, 'preview.html');

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/seed.json'), 'utf8'));
const imgs = JSON.parse(fs.readFileSync(path.join(ROOT, 'preview-cache/imgs.json'), 'utf8'));
const css = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
const api = fs.readFileSync(path.join(ROOT, 'tools/preview-api.js'), 'utf8');

// Le code de l'app, regroupé en un seul script ; les portraits viennent de la page.
const res = await build({
  entryPoints: [path.join(ROOT, 'src/app.js')],
  bundle: true, write: false, format: 'iife', target: 'es2020', minify: true,
  plugins: [{
    name: 'img', setup(b) {
      b.onLoad({ filter: /app\.js$/ }, (args) => ({
        contents: fs.readFileSync(args.path, 'utf8').replace(
          /const img = \(id\) => \([^\n]+\n/,
          "const img = (id) => (window.__IMG[id] || '');\n"
        ),
        loader: 'js'
      }));
    }
  }]
});
const js = res.outputFiles[0].text;
if (!js.includes('__IMG')) throw new Error('remplacement des images non appliqué');

const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
const note = `Aperçu web · données des 30 derniers jours (patch ${(([M, m]) => `${+M + 10}.${m}`)(seed.ddragon.patch.split('.'))}) figées au ${new Date().toLocaleDateString('fr-FR')} · « Charger » (multi op.gg) remplit des joueurs d’exemple`;

const page = `<title>Draft Lab</title>
<meta name="description" content="Aperçu web de Draft Lab">
<style>
:root { color-scheme: dark; }
html, body { background: #05070c; color: #e6e9f2; height: 100%; }
body { overflow: hidden; }
/* Bureau autour de la fenêtre */
#desk { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  padding: 10px max(10px, env(safe-area-inset-right, 0px)) 10px max(10px, env(safe-area-inset-left, 0px));
  background: radial-gradient(1200px 700px at 30% 10%, #16213a 0%, #070a12 60%, #05070c 100%); }
#note { font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #8a93a8; margin-bottom: 8px; text-align: center; }
#note b { color: #c8aa6e; font-weight: 600; }
/* Fenêtre de l'application, dessinée à sa vraie taille (1480 px) puis mise à l'échelle */
#appwin { width: 1480px; border-radius: 12px; overflow: hidden; box-shadow: 0 30px 80px #000c, 0 0 0 1px #2a3550;
  display: flex; flex-direction: column; transform: translateZ(0); background: #0b0f17; }
#titlebar { height: 34px; flex: none; display: grid; grid-template-columns: 90px 1fr 90px; align-items: center;
  background: linear-gradient(#1b2232, #151b28); border-bottom: 1px solid #000; user-select: none; }
#titlebar .dots { display: flex; gap: 8px; padding-left: 14px; }
#titlebar .dots i { width: 12px; height: 12px; border-radius: 50%; display: block; }
#titlebar .dots i:nth-child(1) { background: #ff5f57; } #titlebar .dots i:nth-child(2) { background: #febc2e; } #titlebar .dots i:nth-child(3) { background: #28c840; }
#titlebar .t { text-align: center; font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #c9cfdd; }
#appview { flex: 1; overflow-y: auto; overflow-x: hidden; background: var(--bg); position: relative; }
#appview::-webkit-scrollbar { width: 10px; } #appview::-webkit-scrollbar-thumb { background: #2a3550; border-radius: 5px; }
${css}
/* dans la fenêtre : la barre du haut reste collée au haut de la fenêtre */
#appview .topbar { top: 0; }
</style>
<div id="desk">
  <div id="note"><b>Aperçu de l’application</b> — ${note}</div>
  <div id="appwin">
    <div id="titlebar"><div class="dots"><i></i><i></i><i></i></div><div class="t">Draft Lab</div><div></div></div>
    <div id="appview">
${body}
    </div>
  </div>
</div>
<script>
(function () {
  const W = 1480, win = document.getElementById('appwin'), note = document.getElementById('note');
  function fit() {
    const availW = window.innerWidth - 20, availH = window.innerHeight - 20 - note.offsetHeight - 8;
    const s = Math.min(1, availW / W);
    win.style.zoom = s;
    win.style.height = Math.max(400, availH / s) + 'px';
  }
  window.addEventListener('resize', fit); fit();
})();
</script>
<script>window.__SEED=${JSON.stringify(seed)};window.__IMG=${JSON.stringify(imgs)};</script>
<script>${api}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`;
fs.writeFileSync(out, page);
console.log('aperçu écrit :', out, Math.round(page.length / 1024), 'Ko');
