#!/usr/bin/env node
// The AI Squad server.  node server/index.js [--port 8097] [--host 127.0.0.1]
import http from 'node:http';
import { createHandler, isLoopback } from './api.js';
import { loadPin } from './pin.js';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths, configure } from './config.js';
import { seedDefaults } from './roles.js';
import { seedBlueprints } from './blueprints.js';
import { ensureCloned } from './libraries.js';
import { flushPending, watchdogTick, mergeTick } from './squad.js';
import { meter } from './meter.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(opt('--port', process.env.AISQUAD_PORT || 8097));
const HOST = opt('--host', '127.0.0.1');

seedDefaults();
seedBlueprints();
configure({ serverUrl: `http://${isLoopback(HOST) ? HOST.replace(/^::1$/, '[::1]') : '127.0.0.1'}:${PORT}` });   // where agent hooks post events
const pin = loadPin();
const server = http.createServer(createHandler({ pin, host: HOST }));
server.listen(PORT, HOST, () => {
  console.log(`The AI Squad: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`PIN for changes: ${paths.pin()}`);
  if (!isLoopback(HOST)) console.log(`Listening on ${HOST}: every API call, reads included, needs the PIN.`);
  fs.writeFileSync(PID_FILE, String(process.pid));
});
const PID_FILE = path.join(config.home, 'server.pid');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.rmSync(PID_FILE); } catch { /* gone */ } process.exit(0); });
ensureCloned().catch(() => {});
meter.start();                                           // /proc every 3 s for the dock meter
setInterval(() => { flushPending().catch(() => {}); }, 3000).unref();
setTimeout(() => { try { watchdogTick(); } catch { /* next tick */ } }, 5000).unref();
setInterval(() => { try { watchdogTick(); } catch (e) { console.error('[watchdog]', e.message); } }, 60000).unref();
setInterval(() => {
  mergeTick().then((done) => { for (const m of done) console.log(`[merge] ${m.branch || 'sprint'}: ${m.result}${m.reason ? ` (${m.reason})` : ''}`); }, (e) => console.error('[merge]', e.message));
}, 60000).unref();
