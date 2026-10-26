#!/usr/bin/env node
// Headless Chrome screenshots over the DevTools protocol (no dependencies).
//   node scripts/shot.js shots.json      shots: [{ url, out, w, h, pin?, wait?, eval? }]
//   SHOT_OFFLINE=1 blocks every host but 127.0.0.1 (checks the UI works without a CDN)
import fs from 'node:fs';
import { openChrome, sleep } from './chrome.js';

const shots = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { send, evaluate, logs, close } = await openChrome();

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
  if (s.measure) console.log(`${s.out}: ${JSON.stringify(await evaluate(s.measure))}`);   // a value measured in the page (frame times)
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(s.out, Buffer.from(data, 'base64'));
  console.log(`${s.out} ${s.w}x${s.h}`);
}
if (logs.length) console.log('Page errors:\n' + [...new Set(logs)].join('\n'));
await close();
process.exit(0);
