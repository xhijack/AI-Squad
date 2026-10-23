#!/usr/bin/env node
// The AI Squad command line, used by the /aisquad Claude Code command.
//   aisquad [start]      start the server in the background (if needed) and open the browser
//   aisquad new-floor    same, straight into the New Floor wizard
//   aisquad status       Floors, agents, Attention and machine resources as text
//   aisquad stop         stop the background server
// Options: --port 8097  --host 127.0.0.1  --no-open
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, paths } from '../server/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const cmd = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a) && a !== opt('--host')) || 'start';
const PORT = Number(opt('--port', process.env.AISQUAD_PORT || 8097));
const HOST = opt('--host', '127.0.0.1');
const BASE = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
const PID = path.join(config.home, 'server.pid');
const LOG = path.join(config.home, 'server.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p) {
  try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch { return null; }
}

async function ensureServer() {
  const b = await get('/api/building');
  if (b && b.floors) return false;
  fs.mkdirSync(config.home, { recursive: true });
  const out = fs.openSync(LOG, 'a');
  const server = [process.execPath, path.join(ROOT, 'server', 'index.js'), '--port', String(PORT), '--host', HOST];
  // own systemd scope when available, so closing the terminal or editor does not stop the server
  let useScope = false;
  try { execFileSync('systemd-run', ['--user', '--scope', '--quiet', 'true'], { stdio: 'ignore', timeout: 5000 }); useScope = true; } catch { /* plain detached process */ }
  const [file, ...rest] = useScope ? ['systemd-run', '--user', '--scope', '--quiet', `--unit=aisquad-server-${Date.now()}`, ...server] : server;
  const child = spawn(file, rest, { detached: true, stdio: ['ignore', out, out], env: process.env });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await get('/api/building')) return true;
  }
  throw new Error(`The server did not start; see ${LOG}`);
}

function openBrowser(url) {
  if (args.includes('--no-open')) return false;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  try { spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref(); return true; } catch { return false; }
}

const money = (n) => `$${(+n || 0).toFixed(2)}`;
const gb = (b) => `${(b / 2 ** 30).toFixed(1)} GB`;

async function status() {
  let s = await get('/api/watchdog');
  let note = '';
  if (!s) {
    const squad = await import('../server/squad.js');       // server not running: read the same data directly
    s = squad.watchdogStatus();
    note = ' (server not running; run /aisquad to open the Building)';
  }
  const lines = [`The AI Squad${note}`];
  if (!s.floors.length) lines.push('No Floors yet. Run /aisquad new-floor to create one.');
  for (const f of [...s.floors].sort((a, b) => b.number - a.number)) {
    const c = f.counts || {};
    const budget = f.budget?.usd > 0 ? `, budget ${Math.round(f.budget.pct)} % of ${money(f.budget.usd)}/${f.budget.period}` : '';
    lines.push(`  ${f.number}. ${f.name}: ${c.working || 0} working, ${c.waiting || 0} waiting, ${c.idle || 0} idle, ${c.stopped || 0} stopped · today ${money(f.cost?.today)}${budget}${f.attention ? ` · ${f.attention} need you` : ''}`);
  }
  if (s.waiting) lines.push(`${s.waiting} agent question${s.waiting === 1 ? '' : 's'} or permission prompt${s.waiting === 1 ? '' : 's'} waiting in Attention.`);
  for (const a of s.alerts) lines.push(`  ! ${a.kind}${a.floorName ? ` (${a.floorName})` : ''}: ${a.text}`);
  const r = s.resources;
  lines.push(`Machine: RAM ${gb(r.mem.available)} free of ${gb(r.mem.total)}, swap ${r.swap.total ? Math.round(r.swap.used / r.swap.total * 100) : 0} %, disk ${r.disk ? gb(r.disk.free) : '?'} free.`);
  console.log(lines.join('\n'));
}

async function main() {
  if (cmd === 'status') return status();
  if (cmd === 'stop') {
    const pid = Number(fs.existsSync(PID) ? fs.readFileSync(PID, 'utf8') : 0);
    if (!pid || !(await get('/api/building'))) return console.log('The AI Squad server is not running.');
    process.kill(pid, 'SIGTERM');                            // the server removes its own pid file
    return console.log('The AI Squad server stopped. Agents keep running in tmux.');
  }
  if (cmd !== 'start' && cmd !== 'new-floor' && cmd !== 'open') {
    console.log('Usage: aisquad [start | new-floor | status | stop] [--port 8097] [--host 127.0.0.1] [--no-open]');
    process.exitCode = 1;
    return;
  }
  const started = await ensureServer();
  const url = `${BASE}/${cmd === 'new-floor' ? '#/new-floor' : ''}`;
  const opened = openBrowser(url);
  console.log(`${started ? 'Started' : 'Running'}: The AI Squad at ${url}`);
  console.log(opened ? 'Opened in your browser.' : 'Open that address in your browser.');
  console.log(`Changes need the local PIN: cat ${paths.pin()}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
