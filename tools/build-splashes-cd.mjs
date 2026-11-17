// Génère src/splashes-cd.js : splash actuel de chaque champion (CommunityDragon, version « centered »), en petit (176×99).
// Data Dragon garde parfois l'ancien splash d'un champion (ex. Nasus) alors que les drafters (drafter.lol…)
// affichent le nouveau : ce 2e jeu d'illustrations sert de référence en plus de src/splashes.js (shotauto.js).
// Usage : node tools/build-splashes-cd.mjs   (nécessite Python 3 + Pillow)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r; };
const versions = await (await get('https://ddragon.leagueoflegends.com/api/versions.json')).json();
const champs = (await (await get(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`)).json()).data;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-'));
const out = {};
for (const c of Object.values(champs)) {
  try {
    const info = await (await get(`${CD}/v1/champions/${c.key}.json`)).json();
    const p = info.skins?.[0]?.splashPath;
    if (!p) continue;
    const buf = Buffer.from(await (await get(CD + p.replace('/lol-game-data/assets', '').toLowerCase())).arrayBuffer());
    const src = path.join(tmp, c.id + '.jpg'), dst = path.join(tmp, c.id + '.s.jpg');
    fs.writeFileSync(src, buf);
    execFileSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGB").resize((176,99),Image.LANCZOS).save(sys.argv[2],quality=80)', src, dst]);
    out[c.id] = fs.readFileSync(dst).toString('base64');
  } catch (e) { console.warn(c.id, e.message); }
}
fs.writeFileSync(new URL('../src/splashes-cd.js', import.meta.url),
  '// Splash actuel des champions (CommunityDragon), en petit (176×99) : 2e référence pour les bandeaux des drafters.\nexport default ' + JSON.stringify(out) + ';\n');
console.log(Object.keys(out).length, 'champions');
