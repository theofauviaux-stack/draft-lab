// Construit le paquet de mise à jour automatique : dist/draftlab-update.json.gz (+ empreinte sha256).
// Publier ensuite une release GitHub "v<version>" avec ce fichier et la ligne "sha256: <empreinte>" dans la description.
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
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'draftlab-update.json.gz');
fs.writeFileSync(out, gz);
const sha = crypto.createHash('sha256').update(gz).digest('hex');
console.log(`version ${pkg.version} · ${Object.keys(files).length} fichiers · ${Math.round(gz.length / 1024)} Ko`);
console.log(`sha256: ${sha}`);
