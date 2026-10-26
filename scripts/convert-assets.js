#!/usr/bin/env node
// Runs a converter function in headless Chrome (three.js loaders and exporters work there unchanged) with the
// repository served on a random local port; the result (a GLB the page posts back, or JSON) is written to a file.
//   node scripts/convert-assets.js <function> <out-file> ['<json args>']   (functions: scripts/convert/rocketbox.js)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openChrome, sleep } from './chrome.js';

const [fn, out, args = '{}'] = process.argv.slice(2);
if (!fn || !out) { console.error('usage: convert-assets.js <function> <out-file> [json-args]'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
let posted = null;                                  // a GLB the page sends back (too big for the DevTools protocol)
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__out') { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => { posted = Buffer.concat(parts); res.end('ok'); }); return; }
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const c = await openChrome();
try {
  await c.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/scripts/convert/index.html` });
  for (let i = 0; i < 100 && !(await c.evaluate('window.ready === true')); i++) await sleep(100);
  // started, then polled: long conversions print their steps (window.steps) as they go
  await c.evaluate(`window.steps = []; window.conv[${JSON.stringify(fn)}](${args}).then(async (v) => { if (v?.glb) { await fetch('/__out', { method: 'POST', body: v.glb }); v = { ...v, glb: true }; } window.done = { v }; }, (e) => { window.done = { e: String(e.stack || e) }; }); 0`);
  let seen = 0, done = null;
  while (!done) {
    await sleep(500);
    const p = await c.evaluate('({ steps: window.steps || [], done: window.done || null })');
    for (const x of p.steps.slice(seen)) console.log(`  ${x}`);
    seen = p.steps.length; done = p.done;
  }
  if (done.e) throw new Error(done.e);
  const r = done.v;
  if (r?.glb) { fs.writeFileSync(out, posted); console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`, r.info ? JSON.stringify(r.info) : ''); }
  else { fs.writeFileSync(out, JSON.stringify(r, null, 2)); console.log(`${out} written`); }
} finally {
  if (c.logs.length) console.log('Page errors:\n' + [...new Set(c.logs)].join('\n'));
  await c.close(); server.close();
}
process.exit(0);
