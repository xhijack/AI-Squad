#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Renders the Iso Pixel sprite atlas from the 3D models (ui/dev/sprites.html) in headless Chrome and writes
// ui/assets/iso/atlas.png + atlas.json. Run it again when a model, the chibi or a device changes.
//   node scripts/make-iso-sprites.js          (CHROME_BIN=/path/to/chrome to use another Chrome)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openChrome, sleep } from './chrome.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = path.join(ROOT, 'ui');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.resolve(UI, decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1)));
  if (!file.startsWith(UI + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { send, evaluate, logs, close } = await openChrome();
await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/dev/sprites.html` });
let atlas = null;
for (let i = 0; i < 600 && !atlas; i++) { await sleep(500); atlas = await evaluate('window.__atlas && JSON.stringify(window.__atlas)'); }
await close(); server.close();
if (!atlas) { console.error('No atlas after 5 minutes', logs.join('\n')); process.exit(1); }
const a = JSON.parse(atlas);
if (a.error) { console.error(a.error, logs.join('\n')); process.exit(1); }
const dir = path.join(UI, 'assets', 'iso');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'atlas.png'), Buffer.from(a.png.split(',')[1], 'base64'));
fs.writeFileSync(path.join(dir, 'atlas.json'), `${JSON.stringify(a.json)}\n`);
console.log(`ui/assets/iso/atlas.png (${Object.keys(a.json.sprites).length} sprites)`);
process.exit(0);
