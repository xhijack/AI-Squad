#!/usr/bin/env node
// The AI Squad server.  node server/index.js [--port 8097] [--host 127.0.0.1]
import http from 'node:http';
import { createHandler } from './api.js';
import { loadPin } from './pin.js';
import { paths } from './config.js';
import { seedDefaults } from './roles.js';
import { flushPending } from './squad.js';

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
});
setInterval(() => { flushPending().catch(() => {}); }, 3000).unref();
