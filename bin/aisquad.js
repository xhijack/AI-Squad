#!/usr/bin/env node
// The AI Squad command line, used by the /aisquad Claude Code command.
//   aisquad [start]      start the server in the background (if needed) and open the browser
//   aisquad new-floor    same, straight into the New Floor wizard
//   aisquad status       Floors, agents, Attention and machine resources as text
//   aisquad stop         stop the server (agents keep running in tmux)
//   aisquad uninstall    remove the systemd user service / launchd agent
//   aisquad audit [floor] [--sprint N] [--model sonnet]   audit a Floor from its Squad Log (claude -p)
//   aisquad audit export anonymised bundle of audits and decisions in ~/.aisquad/exports (never uploaded)
// The server runs as a systemd user service (aisquad.service) where systemd exists, as a launchd agent on
// macOS, otherwise as a detached process, so it survives closing the terminal or editor.
// Options: --port 8097  --host 127.0.0.1  --no-open
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, paths, VERSION } from '../server/config.js';
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
  // a running server from another version or checkout (e.g. before a plugin update or git pull) is replaced
  const v = up ? await get('/api/version') : null;
  const outdated = up && !(v && v.version === VERSION && v.root === ROOT);
  if (up && outdated && !(mode !== 'detached' && service.installed({ mode }))) {
    if (!service.stop({ mode: 'detached' }).stopped) throw new Error(`An older AI Squad server (${v?.version || 'before 0.2.2'}) is running on port ${PORT} and could not be stopped. Stop it and run /aisquad again.`);
    for (let i = 0; i < 20 && await get('/api/building'); i++) await sleep(250);
    service.start({ port: PORT, host: HOST, root: ROOT }, { mode: 'detached' });
    for (let i = 0; i < 60; i++) { await sleep(250); if (await get('/api/building')) return 'restarted'; }
    throw new Error(`The server did not start; see ${LOG}`);
  }
  if (up && !outdated && !(mode !== 'detached' && service.installed({ mode }))) return 'running';   // a server we did not install: leave it
  const r = service.start({ port: PORT, host: HOST, root: ROOT, force: outdated }, { mode });
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
  const rv = await get('/api/version');
  lines.push(`Version: plugin ${VERSION}, server ${rv?.version || 'older than 0.2.2'}${rv && rv.version === VERSION && rv.root === ROOT ? '' : ' (outdated: run /aisquad to restart it)'}`);
  lines.push(sv.mode === 'systemd' ? (sv.installed ? `Service: aisquad.service ${sv.active}, ${sv.enabled}${sv.linger === 'no' ? ' (stops at logout; run "loginctl enable-linger" to keep it running)' : ''}` : 'Service: not installed (run /aisquad to install it)')
    : sv.mode === 'launchd' ? `Service: launchd agent ${sv.installed ? sv.active : 'not installed'}` : 'Service: detached process (no systemd or launchd)');
  lines.push(`Machine: RAM ${gb(r.mem.available)} free of ${gb(r.mem.total)}, swap ${r.swap.total ? Math.round(r.swap.used / r.swap.total * 100) : 0} %, disk ${r.disk ? gb(r.disk.free) : '?'} free.`);
  console.log(lines.join('\n'));
}

// the Floor by id or number; with a single squad Floor it may be left out
function pickFloor(list, arg) {
  if (arg) return list.find((f) => f.id === arg || String(f.number) === String(arg)) || null;
  return list.length === 1 ? list[0] : null;
}

async function audit() {
  const rest = args.slice(args.indexOf('audit') + 1);
  if (rest[0] === 'export') {
    const { exportBundle } = await import('../server/improve.js');
    const r = exportBundle();
    console.log(`Exported ${r.audits} audit${r.audits === 1 ? '' : 's'} of ${r.floors} Floor${r.floors === 1 ? '' : 's'} and ${r.decisions} decision${r.decisions === 1 ? '' : 's'} to ${r.file}.`);
    console.log('Anonymised: metrics, findings and decisions only; no message text or file contents; paths and ids are salted hashes. Nothing was uploaded: send the file to Sopwer yourself if you want to.');
    return;
  }
  const value = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const floorArg = rest.find((a, i) => !a.startsWith('--') && !['--sprint', '--model'].includes(rest[i - 1]));
  const { loadBuilding } = await import('../server/building.js');
  const floors = loadBuilding().floors.sort((a, b) => a.number - b.number);
  const f = pickFloor(floors, floorArg);
  if (!f) {
    console.log(`${floorArg ? `No Floor "${floorArg}".` : 'Which Floor?'} Usage: /aisquad audit <floor> [--sprint N] [--model sonnet|haiku|opus]`);
    for (const x of floors) console.log(`  ${x.number}. ${x.id}`);
    process.exitCode = 1;
    return;
  }
  const squad = await import('../server/squad.js');
  console.log(`Auditing ${f.id}${value('--sprint') ? ` sprint ${value('--sprint')}` : ''}...`);
  const a = await squad.startAudit(f.id, { sprint: value('--sprint'), model: value('--model') });
  const dir = path.join(config.home, 'audits', f.id);
  if (a.error) console.log(`Audit stored with an error: ${a.error}`);
  console.log(`Audit ${a.id} (${a.range.label}, ${a.range.events} events), reviewed by ${a.model} for $${(+a.cost || 0).toFixed(4)}.`);
  console.log(`Scores: process ${a.scores.process}, efficiency ${a.scores.efficiency}, quality ${a.scores.quality} (overall ${a.scores.overall}).`);
  const E = a.metrics.efficiency, P = a.metrics.process;
  console.log(`Cost ${money(E.totals.cost)}, cost per SP ${E.costPerSP == null ? '-' : money(E.costPerSP)}, QA first-round pass ${P.qaFirstRoundPassRate == null ? '-' : `${Math.round(P.qaFirstRoundPassRate * 100)} %`}, cache hit rate ${E.cacheHitRate == null ? '-' : `${Math.round(E.cacheHitRate * 100)} %`}.`);
  if (a.summary) console.log(`Summary: ${a.summary}`);
  for (const x of a.findings) console.log(`  ${x.id} [${x.severity}, ${x.area}] ${x.title}: ${x.recommendation}${x.target ? ` (proposed change to ${x.target.kind} ${x.target.id})` : ''}`);
  console.log(`Report: ${path.join(dir, `${a.id}.md`)}. Open the Floor's Audit dialog to apply or dismiss proposed changes.`);
}

async function main() {
  if (cmd === 'audit') return audit();
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
    console.log('Usage: aisquad [start | new-floor | status | stop | uninstall | audit [floor] [--sprint N] | audit export] [--port 8097] [--host 127.0.0.1] [--no-open]');
    process.exitCode = 1;
    return;
  }
  const started = await ensureServer();
  const url = `${BASE}/${cmd === 'new-floor' ? '#/new-floor' : ''}`;
  const opened = openBrowser(url);
  console.log(`${{ started: 'Started', restarted: 'Updated and restarted', running: 'Running' }[started]}: The AI Squad ${VERSION} at ${url}`);
  console.log(opened ? 'Opened in your browser.' : 'Open that address in your browser.');
  console.log(`Changes need the local PIN: cat ${paths.pin()}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
