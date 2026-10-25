// Mac : lecture de l'état du clavier (touches enfoncées), même quand un jeu en plein écran bloque les
// raccourcis globaux du système. Un petit script JavaScript for Automation (osascript, fourni avec macOS)
// interroge CGEventSourceKeyState toutes les 50 ms et écrit la liste des touches enfoncées quand elle change.
// Ne lit que quelques touches précises (raccourcis de Draft Lab), jamais le texte tapé.
const { spawn } = require('child_process');

const KEYS = { D: [2], F: [3], LEFT: [123], RIGHT: [124], DOWN: [125], UP: [126], ENTER: [36, 76], ESC: [53],
  PLUS: [24, 69], MINUS: [27, 78], CTRL: [59, 62], CMD: [55, 54], SHIFT: [56, 60], ALT: [58, 61] };
const SCRIPT = `ObjC.import('CoreGraphics'); ObjC.import('Foundation');
const K = ${JSON.stringify(KEYS)};
const out = $.NSFileHandle.fileHandleWithStandardOutput;
const say = (s) => out.writeData($(s + '\\n').dataUsingEncoding($.NSUTF8StringEncoding));
say('ready');
let prev = null;
while (true) {
  const s = Object.keys(K).filter((k) => K[k].some((c) => $.CGEventSourceKeyState(1, c))).join(',');
  if (s !== prev) { say('k:' + s); prev = s; }
  delay(0.05);
}`;

let proc = null;
function startMacKeys(onKeys) {
  if (process.platform !== 'darwin' || proc) return;
  try {
    proc = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { proc = null; return; }
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.startsWith('k:')) onKeys(new Set(line.slice(2).split(',').filter(Boolean)));
    }
  });
  proc.on('exit', () => { proc = null; });
}
function stopMacKeys() { try { proc?.kill(); } catch {} proc = null; }
module.exports = { startMacKeys, stopMacKeys };
