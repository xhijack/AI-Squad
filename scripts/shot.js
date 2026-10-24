#!/usr/bin/env node
// Headless Chrome screenshots over the DevTools protocol (no dependencies).
//   node scripts/shot.js shots.json      shots: [{ url, out, w, h, pin?, wait?, eval? }]
//   SHOT_OFFLINE=1 blocks every host but 127.0.0.1 (checks the UI works without a CDN)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const shots = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aisquad-chrome-'));
const chrome = spawn('google-chrome', ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--mute-audio', ...(process.env.SHOT_OFFLINE ? ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] : []), `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let port;
for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* starting */ } }
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

await send('Page.enable'); await send('Runtime.enable');
const logs = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); });

for (const s of shots) {
  await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.w < 600 });
  if (s.pin !== undefined) {
    await send('Page.navigate', { url: new URL('/', s.url).href }); await sleep(800);
    await evaluate(`localStorage.setItem('aisquad.pin', ${JSON.stringify(s.pin)})`);
  }
  await send('Page.navigate', { url: 'about:blank' }); await sleep(200);   // full load every time, not just a hash change
  await send('Page.navigate', { url: s.url });
  await sleep(s.wait ?? 6000);
  if (s.eval) { await evaluate(s.eval); await sleep(s.after ?? 2500); }
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(s.out, Buffer.from(data, 'base64'));
  console.log(`${s.out} ${s.w}x${s.h}`);
}
if (logs.length) console.log('Page errors:\n' + [...new Set(logs)].join('\n'));
ws.close(); chrome.kill();
await sleep(300);
fs.rmSync(profile, { recursive: true, force: true });
process.exit(0);
