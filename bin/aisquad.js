#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The AI Squad command line, used by the /aisquad Claude Code command.
//   aisquad [start]      start the server in the background (if needed) and open the browser
//   aisquad new-floor    same, straight into the New Floor wizard
//   aisquad status       Floors, agents, Attention and machine resources as text
//   aisquad stop         stop the server (agents keep running in tmux)
//   aisquad uninstall    remove the systemd user service / launchd agent
//   aisquad audit [floor] [--sprint N] [--model sonnet]   audit a Floor from its Squad Log (claude -p)
//   aisquad audit export anonymised bundle of audits and decisions in ~/.aisquad/exports (never uploaded)
//   aisquad backup [--out DIR|FILE] [--with-secrets] [--no-logs] [--passphrase-env VAR]   back up the Building
//   aisquad verify FILE [--passphrase-env VAR]            check that a backup reads back
//   aisquad restore FILE [--dry-run] [--force] [--relink OLD=NEW]... [--projects-dir DIR] [--no-clone] [--passphrase-env VAR]
//   aisquad doctor                                        check this machine and the Building
//   aisquad quickstart [--blueprint ID --name NAME] [--dir PATH]   start, print the PIN, and set up a first squad (1.0)
//   aisquad node --head URL --name NAME [--token TOKEN] [--max-agents 6]   run this machine as a worker of a Head
//                                                         (the token from Admin → Machines, or AISQUAD_NODE_TOKEN)
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

// ---------- backup, verify, restore, doctor ----------
const flag = (k) => args.includes(k);
const many = (k) => args.flatMap((a, i) => (a === k && args[i + 1] ? [args[i + 1]] : []));
const fileArg = (name) => { const i = args.indexOf(name); return args.slice(i + 1).find((a, j, rest) => !a.startsWith('--') && !(j > 0 && /^--(out|relink|projects-dir|passphrase-env)$/.test(rest[j - 1]))); };
const size = (n) => (n > 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
async function passphrase() {
  const env = opt('--passphrase-env', '');
  if (env) { if (!process.env[env]) throw new Error(`The environment variable ${env} is empty`); return process.env[env]; }
  const backup = await import('../server/backup.js');
  return backup.storedPassphrase();
}
// a worker machine: stays in the foreground (run it as a service the same way as the Head)
async function nodeCmd() {
  const head = opt('--head', process.env.AISQUAD_HEAD || ''), name = opt('--name', process.env.AISQUAD_NODE_NAME || ''), token = opt('--token', process.env.AISQUAD_NODE_TOKEN || '');
  if (!head || !name || !token) { console.log('Usage: aisquad node --head http://head-machine:8097 --name box-2 --token TOKEN   (Admin → Machines → Add a machine)'); process.exitCode = 1; return; }
  const { startWorker } = await import('../server/worker.js');
  startWorker({ head: /^https?:\/\//.test(head) ? head : `http://${head}`, name, token, maxAgents: Number(opt('--max-agents', 6)) || 6 });
  console.log(`Worker ${name} connected to ${head}. Background jobs of the Head run here with this machine's Claude sign-in.`);
  await new Promise(() => {});
}
async function backupCmd() {
  const backup = await import('../server/backup.js');
  const r = backup.createBackup({ out: opt('--out', ''), passphrase: await passphrase(), secrets: flag('--with-secrets'), logs: !flag('--no-logs') });
  console.log(`Backup written: ${r.file} (${size(r.size)}, ${r.files} files, ${r.floors} Floor${r.floors === 1 ? '' : 's'}, ${r.encrypted ? 'encrypted' : 'not encrypted, no secrets'}).`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
  console.log('Repositories are not inside: they come back from their git remotes. Keep the backup off this machine (a USB disk, a synced folder).');
}
async function verifyCmd() {
  const backup = await import('../server/backup.js');
  const file = fileArg('verify');
  if (!file) { console.log('Usage: aisquad verify <backup file>'); process.exitCode = 1; return; }
  const r = backup.verifyBackup(path.resolve(file), { passphrase: await passphrase() });
  console.log(r.ok ? `The backup reads back: ${r.files} files, ${r.floors} Floor${r.floors === 1 ? '' : 's'}, made ${r.createdAt}.` : `The backup does not read back:\n  ${r.errors.slice(0, 10).join('\n  ')}`);
  if (!r.ok) process.exitCode = 1;
}
async function restoreCmd() {
  const backup = await import('../server/backup.js');
  const file = fileArg('restore');
  if (!file) { console.log('Usage: aisquad restore <backup file> [--dry-run] [--force] [--relink OLD=NEW] [--projects-dir DIR] [--no-clone]'); process.exitCode = 1; return; }
  const relink = Object.fromEntries(many('--relink').map((x) => x.split('=')).filter((x) => x.length === 2 && x[0] && x[1]));
  const opts = { passphrase: await passphrase(), relink, projectsDir: opt('--projects-dir', ''), force: flag('--force'), clone: !flag('--no-clone') };
  const plan = backup.planRestore(path.resolve(file), opts);
  console.log(`Backup of ${plan.manifest.host}, made ${plan.manifest.createdAt} by The AI Squad ${plan.manifest.aisquadVersion}: ${plan.homeFiles} files, ${plan.floors.length} Floor${plan.floors.length === 1 ? '' : 's'}, ${plan.memory} memory file${plan.memory === 1 ? '' : 's'}.`);
  for (const f of plan.floors) console.log(`  ${f.number}. ${f.id}: ${f.to} -> ${{ present: 'already there', clone: `clone ${f.remote}${f.branch ? ` (${f.branch})` : ''}`, missing: 'MISSING (no remote)' }[f.action]}`);
  for (const w of plan.warnings) console.log(`  ! ${w}`);
  if (plan.errors.length) { console.log(`The backup is damaged: ${plan.errors.slice(0, 5).join(', ')}`); process.exitCode = 1; return; }
  if (flag('--dry-run')) { console.log(`Dry run: nothing changed.${plan.homeExists ? ` ${config.home} is not empty: the restore needs --force (the current folder is kept).` : ''}`); return; }
  if (await get('/api/building')) { console.log('The server is running: run /aisquad stop first, then restore again.'); process.exitCode = 1; return; }
  const r = backup.restore(path.resolve(file), opts);
  const { migrate } = await import('../server/schema.js');
  migrate();
  console.log(`Restored ${r.written} files into ${config.home}${r.previous ? ` (the previous folder is kept as ${r.previous})` : ''}, ${r.memory} memory file${r.memory === 1 ? '' : 's'}.`);
  for (const f of r.floors) console.log(`  ${f.id}: ${f.result} (${f.to})`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
  console.log('Auto-merge approvals are not restored: approve them again per Floor. Then check the machine:');
  await doctorCmd();
}
async function doctorCmd() {
  const { runDoctor, doctorText } = await import('../server/doctor.js');
  const r = runDoctor({ service: service.status() });
  const v = await get('/api/version');
  console.log(doctorText(r));
  console.log(v ? `Server: running ${v.version}${v.version === VERSION && v.root === ROOT ? '' : ' (outdated: run /aisquad to restart it)'}` : 'Server: not running (run /aisquad to start it)');
  if (!r.ok) process.exitCode = 1;
}

// the first run on a new machine (install.sh ends here): the server, the PIN, and optionally a first squad
const FIRST = ['Rina', 'Budi', 'Sari', 'Dewi', 'Agus', 'Lia', 'Dimas', 'Mira', 'Rio', 'Tono', 'Maya', 'Yudi'];
async function quickstartCmd() {
  const t0 = Date.now();
  const started = await ensureServer();
  const pin = fs.readFileSync(paths.pin(), 'utf8').trim();
  const bpId = opt('--blueprint', '');
  let squadLine = '';
  if (bpId) {
    const { getBlueprint } = await import('../server/blueprints.js');
    const roles = await import('../server/roles.js');
    const bp = getBlueprint(bpId);
    let k = 0;
    const team = bp.roles.flatMap((r) => Array.from({ length: Math.max(r.min, r.default) }, () => ({ template: r.template, displayName: `${FIRST[k++ % FIRST.length]} - ${roles.getTemplate(r.template)?.title || r.template}` })));
    (team.find((m) => m.template === bp.lead) || team[0]).lead = true;
    const name = opt('--name', bp.title);
    const body = { blueprint: bp.id, name, team, ...(opt('--dir') ? { directory: { mode: 'new', path: path.resolve(opt('--dir')) } } : {}) };
    const r = await fetch(`${BASE}/api/squads`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisquad-pin': pin }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    squadLine = r.ok ? `First squad: ${name} (${bp.title}, ${team.length} agents) in ${j.path}. Open it and start its lead: it asks you for the source documents first.` : `The first squad was not created: ${j.error || r.status}`;
  }
  const url = `${BASE}/`;
  const opened = args.includes('--no-open') ? false : openBrowser(url);
  console.log(`\nThe AI Squad ${VERSION} is ${started === 'running' ? 'running' : 'started'} at ${url}${opened ? ' (opened in your browser)' : ''}`);
  console.log(`Your PIN (for changes): ${pin}   (kept in ${paths.pin()})`);
  if (squadLine) console.log(squadLine);
  console.log(`Ready in ${Math.round((Date.now() - t0) / 1000)} s. Next: Set up Squad in the app, or /plugin marketplace add xhijack/AI-Squad in Claude Code for /aisquad.`);
}

async function main() {
  if (cmd === 'backup') return backupCmd();
  if (cmd === 'verify') return verifyCmd();
  if (cmd === 'restore') return restoreCmd();
  if (cmd === 'doctor') return doctorCmd();
  if (cmd === 'quickstart') return quickstartCmd();
  if (cmd === 'node') return nodeCmd();
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
    console.log('Usage: aisquad [start | quickstart [--blueprint ID --name NAME] | new-floor | status | stop | uninstall | audit [floor] [--sprint N] | audit export | backup | verify FILE | restore FILE | doctor] [--port 8097] [--host 127.0.0.1] [--no-open]');
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
