#!/usr/bin/env node
// The AI Squad command line, used by the /aisquad Claude Code command.
//   aisquad [start]      start the server in the background (if needed) and open the browser
//   aisquad new-floor    same, straight into the New Floor wizard
//   aisquad status       Floors, agents, Attention and machine resources as text
//   aisquad stop         stop the server (agents keep running in tmux)
//   aisquad uninstall    remove the systemd user service / launchd agent
// The server runs as a systemd user service (aisquad.service) where systemd exists, as a launchd agent on
// macOS, otherwise as a detached process, so it survives closing the terminal or editor.
// Options: --port 8097  --host 127.0.0.1  --no-open
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, paths } from '../server/config.js';
import * as service from '../server/service.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const cmd = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a) && a !== opt('--host')) || 'start';
const PORT = Number(opt('--port', process.env.AISQUAD_PORT || 8097));
const HOST = opt('--host', '127.0.0.1');
const BASE = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
const LOG = path.join(config.home, 'server.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p) {
  // the PIN goes along so this also works when the server is bound off loopback (reads locked)
  let pin = '';
  try { pin = fs.readFileSync(paths.pin(), 'utf8').trim(); } catch { /* not created yet */ }
  try {
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(1500), headers: pin ? { 'x-aisquad-pin': pin } : {} });
    if (r.status === 401) return { locked: true };
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// returns 'started' | 'restarted' (the service unit changed, e.g. after a plugin update) | 'running'
async function ensureServer() {
  const b = await get('/api/building');
  const up = !!(b && (b.floors || b.locked));
  const mode = service.detectMode();
  if (up && !(mode !== 'detached' && service.installed({ mode }))) return 'running';   // a server we did not install: leave it
  const r = service.start({ port: PORT, host: HOST, root: ROOT }, { mode });
  if (up && !r.changed) return 'running';
  if (up) await sleep(1500);                         // the old process is being replaced
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await get('/api/building')) return up ? 'restarted' : 'started';   // any answer, also 401, means it is up
  }
  throw new Error(`The server did not start; see ${LOG}${mode === 'systemd' ? ' and systemctl --user status aisquad' : ''}`);
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
  if (s?.locked) s = null;
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
  const sv = service.status();
  lines.push(sv.mode === 'systemd' ? (sv.installed ? `Service: aisquad.service ${sv.active}, ${sv.enabled}${sv.linger === 'no' ? ' (stops at logout; run "loginctl enable-linger" to keep it running)' : ''}` : 'Service: not installed (run /aisquad to install it)')
    : sv.mode === 'launchd' ? `Service: launchd agent ${sv.installed ? sv.active : 'not installed'}` : 'Service: detached process (no systemd or launchd)');
  lines.push(`Machine: RAM ${gb(r.mem.available)} free of ${gb(r.mem.total)}, swap ${r.swap.total ? Math.round(r.swap.used / r.swap.total * 100) : 0} %, disk ${r.disk ? gb(r.disk.free) : '?'} free.`);
  console.log(lines.join('\n'));
}

async function main() {
  if (cmd === 'status') return status();
  if (cmd === 'stop') {
    if (!(await get('/api/building'))) return console.log('The AI Squad server is not running.');
    const r = service.stop();
    return console.log(r.stopped ? `The AI Squad server stopped (${r.mode === 'systemd' ? 'aisquad.service' : r.mode}). Agents keep running in tmux. /aisquad starts it again.` : 'Could not stop the server; see /aisquad status.');
  }
  if (cmd === 'uninstall') {
    const r = service.uninstall();
    return console.log(r.removed ? `Removed the ${r.mode === 'systemd' ? 'aisquad.service user service' : 'launchd agent'}; the server is stopped. ~/.aisquad and your Floors are untouched.` : 'No service was installed.' + (r.stopped ? ' The detached server was stopped.' : ''));
  }
  if (cmd !== 'start' && cmd !== 'new-floor' && cmd !== 'open') {
    console.log('Usage: aisquad [start | new-floor | status | stop | uninstall] [--port 8097] [--host 127.0.0.1] [--no-open]');
    process.exitCode = 1;
    return;
  }
  const started = await ensureServer();
  const url = `${BASE}/${cmd === 'new-floor' ? '#/new-floor' : ''}`;
  const opened = openBrowser(url);
  console.log(`${{ started: 'Started', restarted: 'Updated and restarted', running: 'Running' }[started]}: The AI Squad at ${url}`);
  console.log(opened ? 'Opened in your browser.' : 'Open that address in your browser.');
  console.log(`Changes need the local PIN: cat ${paths.pin()}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
