#!/usr/bin/env node
// The AI Squad server.  node server/index.js [--port 8097] [--host 127.0.0.1]
import http from 'node:http';
import { createHandler } from './api.js';
import { loadPin } from './pin.js';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.js';
import { seedDefaults } from './roles.js';
import { flushPending, watchdogTick } from './squad.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(opt('--port', process.env.AISQUAD_PORT || 8097));
const HOST = opt('--host', '127.0.0.1');

seedDefaults();
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
server.listen(PORT, HOST, () => {
  console.log(`The AI Squad: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`PIN for changes: ${paths.pin()}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log(`Warning: listening on ${HOST}; anyone who can reach this port can see your Floors.`);
  fs.writeFileSync(PID_FILE, String(process.pid));
});
const PID_FILE = path.join(config.home, 'server.pid');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.rmSync(PID_FILE); } catch { /* gone */ } process.exit(0); });
setInterval(() => { flushPending().catch(() => {}); }, 3000).unref();
setTimeout(() => { try { watchdogTick(); } catch { /* next tick */ } }, 5000).unref();
setInterval(() => { try { watchdogTick(); } catch (e) { console.error('[watchdog]', e.message); } }, 60000).unref();
