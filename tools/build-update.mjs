// Construit le paquet de mise à jour : release/draftlab-<version>.json.gz + release/latest.json.
// Usage : node tools/build-update.mjs "Notes de version"   puis commit + push sur main.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const files = {};
const add = (rel) => { files[rel.split(path.sep).join('/')] = fs.readFileSync(path.join(ROOT, rel)).toString('base64'); };
const walk = (dir) => { for (const f of fs.readdirSync(path.join(ROOT, dir))) { const rel = path.join(dir, f); fs.statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : add(rel); } };
['boot.js', 'main.js', 'preload.js', 'package.json'].forEach(add);
['providers', 'src', 'seed'].forEach(walk);
const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ version: pkg.version, files })), { level: 9 });
const REL = path.join(ROOT, 'release');
fs.mkdirSync(REL, { recursive: true });
for (const f of fs.readdirSync(REL)) if (f.endsWith('.json.gz')) fs.rmSync(path.join(REL, f));
const file = `draftlab-${pkg.version}.json.gz`;
fs.writeFileSync(path.join(REL, file), gz);
const sha = crypto.createHash('sha256').update(gz).digest('hex');
const notes = process.argv.slice(2).join(' ');
fs.writeFileSync(path.join(REL, 'latest.json'), JSON.stringify({ version: pkg.version, sha256: sha, file, notes, date: new Date().toISOString() }, null, 2));
console.log(`version ${pkg.version} · ${Object.keys(files).length} fichiers · ${Math.round(gz.length / 1024)} Ko`);
console.log(`sha256: ${sha}`);
