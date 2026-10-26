#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
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
import { flushPending, watchdogTick, mergeTick, logTick, autoResumeTick, autopilotTick } from './squad.js';
import { maintain as maintainLogs, DEFAULT_RETENTION_DAYS } from './log.js';
import { loadBuilding } from './building.js';
import { meter } from './meter.js';
import { migrate } from './schema.js';
import * as backup from './backup.js';
import * as jobs from './jobs.js';
import { logJobEnded, dispatchTick } from './squad.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(opt('--port', process.env.AISQUAD_PORT || 8097));
const HOST = opt('--host', '127.0.0.1');

// the data in ~/.aisquad follows this release's version; an older home gets a safety backup first (no secrets)
try { migrate({ before: (v) => backup.createBackup({ label: `pre-migrate-v${v}`, logs: false }), log: console.log }); } catch (e) { console.error('[schema]', e.message); }
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
// Squad Log: collect every 15 s; gzip and retention once an hour
setInterval(() => { logTick().catch((e) => console.error('[log]', e.message)); }, 15000).unref();
setInterval(() => { autopilotTick().then((done) => { for (const r of done.filter((x) => x.kind !== 'gone' && x.kind !== 'already')) console.log(`[autopilot] ${r.floorId}${r.agentId ? `/${r.agentId}` : ''}: ${r.kind}${r.option ? ` ${r.option}` : ''}`); }, (e) => console.error('[autopilot]', e.message)); }, 30000).unref();
setInterval(() => { autoResumeTick().then((done) => { for (const r of done) console.log(`[recovery] resumed ${r.floorId}/${r.agentId}`); }, (e) => console.error('[recovery]', e.message)); }, 60000).unref();
const rotateLogs = () => { try { maintainLogs({ retentionDays: Number(loadBuilding().prefs.logRetentionDays) || DEFAULT_RETENTION_DAYS }); } catch (e) { console.error('[log]', e.message); } };
setTimeout(rotateLogs, 10000).unref();
setInterval(rotateLogs, 3600e3).unref();
// background jobs (headless runner): an ended job goes to the Squad Log; old jobs are cleared once a day
setInterval(() => { try { for (const j of jobs.jobsTick()) { logJobEnded(j); console.log(`[job] ${j.id} ${j.status}${j.error ? `: ${j.error}` : ''}`); } } catch (e) { console.error('[job]', e.message); } }, 3000).unref();
setInterval(() => { try { jobs.pruneJobs(); } catch { /* next day */ } }, 864e5).unref();
// the dispatcher: starts queued work when there is room, stops agents that sit idle
setInterval(() => {
  dispatchTick().then((r) => { for (const x of r.started) console.log(`[dispatch] started ${x.floorId}/${x.agentId} (${x.action})`); for (const x of r.stopped) console.log(`[dispatch] idle stop ${x.floorId}/${x.agentId}`); for (const f of r.failed) console.error(`[dispatch] ${f.item.floorId}/${f.item.agentId}: ${f.error}`); }, (e) => console.error('[dispatch]', e.message));
}, 15000).unref();
// nightly backup (Building settings → Backups) and a monthly read-back check of the newest one
setInterval(() => {
  try { const r = backup.backupTick(loadBuilding().prefs.backup); if (r.backup) console.log(`[backup] ${r.backup.ok ? r.backup.file : `failed: ${r.backup.error}`}`); if (r.verify) console.log(`[backup] check of ${r.verify.file}: ${r.verify.ok ? 'ok' : r.verify.errors.join('; ')}`); }
  catch (e) { console.error('[backup]', e.message); }
}, 60000).unref();
