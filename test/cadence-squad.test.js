// SPDX-License-Identifier: Apache-2.0
// Cadence (1.5) in the squad: a routine runs through the dispatcher as automated work (via 'cadence'): the shift,
// the quota guard and the Space's budget hold it; a run that cannot start in its window is skipped, never stacked;
// Run now; the Desk's next routine; the Squad Log; who may do what.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { scratch, jsonl } from './helpers.js';
import { configure, config } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as users from '../server/users.js';
import * as dispatcher from '../server/dispatcher.js';
import * as jobs from '../server/jobs.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as cadence from '../server/cadence.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';
import { encodeProjectPath } from '../server/transcripts.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-stream.cjs');
configure({ claudeBin: FAKE, useHooks: false, useSystemd: false });
process.env.FAKE_CLAUDE_LOG = path.join(root, 'fake.log');
const GB = 2 ** 30;
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const call = async (method, url, body, p = pin) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(p ? { 'x-aisquad-pin': p } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function settle(cond) {
  for (let i = 0; i < 200; i++) { for (const j of jobs.jobsTick()) squad.logJobEnded(j); if (cond()) return true; await sleep(50); }
  return false;
}
const proj = path.join(root, 'projects', 'mkt');
let fid = '', mira = '', dodi = '';

test('setup: a Marketing Space with two agents and a machine with room', async () => {
  await floors.createFloor({ name: 'Marketing', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Mira - Strategist', template: 'fullstack-developer', lead: true }, { displayName: 'Dodi - Writer', template: 'qa-engineer' }] });
  fid = building.loadBuilding().floors[0].id;
  [mira, dodi] = floors.readFloor(proj).team.agents.map((a) => a.id);
  building.setPrefs({ maxAgents: 4, dispatcher: { reserveP0: 0, idleStopMin: 0 } });
  squad.setResourceReader(() => ({ mem: { available: 8 * GB }, cpus: 4, load: [0.2, 0.2, 0.2] }));   // never this machine's memory
});

test('dispatcher admission with via "cadence": held outside the shift and while the quota guard pauses, like any automated work', () => {
  const now = Date.now();
  const it = { id: 'r', floorId: fid, agentId: mira, action: 'job', priority: 'P2', via: 'cadence', createdAt: now };
  const own = { ...it, id: 'o', agentId: dodi, priority: 'P0', via: 'owner' };
  assert.deepEqual(dispatcher.plan([it, own], { free: 4, inShift: () => false }, now).held, [{ id: 'r', reason: 'outside the Space\'s shift', priority: 'P2' }]);
  assert.equal(dispatcher.plan([it], { free: 4, quotaPaused: true }, now).held[0].reason, 'the quota guard pauses automated work');
  assert.equal(dispatcher.plan([it], { free: 1, reserve: 1 }, now).held[0].reason, 'the last free slot is kept for the owner');
  assert.deepEqual(dispatcher.plan([it], { free: 4 }, now).start.map((x) => x.id), ['r']);
});

test('a due routine starts as a background job of the role\'s agent; cadence.started and cadence.done in the Squad Log', async () => {
  const now = Date.now();
  // the role id resolves to the Space's agent with that role; the slot was two minutes ago
  const r = (await call('POST', `/api/floors/${fid}/cadence`, { title: 'Daily content draft', agent: 'qa-engineer', every: 'daily', at: hhmm(now - 2 * 60e3), task: 'Draft one post for tomorrow.', budget: 1 })).body;
  assert.equal(r.enabled, false, 'a new routine is off until someone turns it on');
  assert.deepEqual(await squad.cadenceTick(now), [], 'off: nothing happens');
  // turned on after its slot: that slot does not count (no catch-up); the next one does
  assert.equal((await call('POST', `/api/floors/${fid}/cadence/${r.id}/toggle`, { enabled: true })).body.enabled, true);
  assert.deepEqual(await squad.cadenceTick(now), [], 'turned on after today\'s slot');
  cadence.setRun(fid, r.id, (cur) => ({ ...cur, since: 0 }));               // as if it had been on since yesterday
  const out = await squad.cadenceTick(now);
  assert.equal(out.length, 1); assert.ok(out[0].started, JSON.stringify(out));
  const job = jobs.listJobs({ floorId: fid })[0];
  assert.deepEqual([job.agentId, job.via, job.kind, job.budgetUsd, job.permissionMode], [dodi, 'cadence', 'routine', 1, 'acceptEdits']);
  assert.match(jobs.promptOf(job.id), /Draft one post for tomorrow\.[\s\S]*routine "Daily content draft" of Marketing, every day at/);
  assert.deepEqual(await squad.cadenceTick(now + 60e3), [], 'once per slot');
  assert.ok(await settle(() => !cadence.runOf(fid, r.id).running), 'the job ends');
  const last = cadence.runOf(fid, r.id).last;
  assert.deepEqual([last.status, last.job], ['done', job.id]);
  const started = squadLog.read(fid, { type: 'cadence.started' }).at(-1), done = squadLog.read(fid, { type: 'cadence.done' }).at(-1);
  assert.deepEqual([started.agent, started.data.routine, started.data.manual], [dodi, r.id, false]);
  assert.deepEqual([done.data.routine, done.data.status, done.data.job], [r.id, 'done', job.id]);
  assert.match(done.summary, /routine "Daily content draft" done in \d+ s, \$/);
  // the Desk of its agent shows the next run, the other agent's does not
  const next = squad.deskDetail(fid, dodi).nextRoutine;
  assert.deepEqual([next.title, next.at], ['Daily content draft', cadence.nextSlot(r, now)]);
  assert.equal(squad.deskDetail(fid, mira).nextRoutine, null);
});

test('outside the shift it waits in the queue, then is skipped with the reason when its window passes; never stacked', async () => {
  const now = Date.now();
  floors.updateFloorConfig(proj, { shift: { enabled: true, days: [0], from: '00:00', to: '00:01' } });   // a shift that is never now
  const r = cadence.add(proj, { title: 'Weekly report', agent: mira, every: 'daily', at: hhmm(now - 60e3), task: 'Report against the targets.', enabled: true });
  const out = await squad.cadenceTick(now);
  assert.deepEqual(out.find((x) => x.routine === r.id).waiting, 'outside the Space\'s shift');
  const pending = cadence.runOf(fid, r.id).pending;
  assert.equal(dispatcher.load().find((q) => q.id === pending.queue).via, 'cadence');
  // the next minute: still one pending run (never a second one)
  await squad.cadenceTick(now + 60e3);
  assert.equal(dispatcher.load().filter((q) => q.opts?.cadence?.routine === r.id).length, 1);
  // the window passes: the queued run is dropped and skipped, with why it waited
  const late = pending.until + 1000;
  const skip = (await squad.cadenceTick(late)).find((x) => x.routine === r.id);
  assert.match(skip.skipped, /could not start in its window \(outside the Space's shift\)/);
  assert.equal(dispatcher.load().filter((q) => q.opts?.cadence?.routine === r.id).length, 0);
  const ev = squadLog.read(fid, { type: 'cadence.skipped' }).at(-1);
  assert.deepEqual([ev.data.routine, ev.data.title], [r.id, 'Weekly report']);
  assert.match(ev.summary, /routine "Weekly report" skipped: could not start in its window/);
  assert.equal(cadence.runOf(fid, r.id).last.status, 'skipped');
  floors.updateFloorConfig(proj, { shift: { enabled: false } });
  cadence.remove(proj, r.id);
});

test('the Space\'s budget is reached: the routine is skipped, not queued', async () => {
  const now = Date.now();
  floors.updateFloorConfig(proj, { budget: { usd: 1, period: 'day' } });
  const dir = path.join(config.claudeHome, 'projects', encodeProjectPath(proj));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'spent.jsonl'), jsonl([{ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'x1', model: 'claude-sonnet-5-5', usage: { output_tokens: 150000 } } }]));
  squad.invalidate();
  const r = cadence.add(proj, { title: 'Follow-ups', agent: mira, every: 'daily', at: hhmm(now - 60e3), task: 'List follow-ups.', enabled: true });
  const out = (await squad.cadenceTick(now)).find((x) => x.routine === r.id);
  assert.equal(out.skipped, 'the Space reached its budget');
  assert.equal(dispatcher.load().length, 0);
  await assert.rejects(squad.runRoutineNow(fid, r.id), /reached its budget/);
  fs.rmSync(path.join(dir, 'spent.jsonl')); floors.updateFloorConfig(proj, { budget: { usd: 0 } }); squad.invalidate();
  cadence.remove(proj, r.id);
});

test('Run now: the person\'s own work (the shift does not hold it), refused while one runs; an unknown agent is skipped', async () => {
  floors.updateFloorConfig(proj, { shift: { enabled: true, days: [0], from: '00:00', to: '00:01' } });
  const r = cadence.add(proj, { title: 'Standup summary', agent: mira, every: 'weekdays', at: '07:00', task: 'Summarise yesterday.' });
  process.env.FAKE_CLAUDE_MODE = 'slow';
  const res = await squad.runRoutineNow(fid, r.id);
  delete process.env.FAKE_CLAUDE_MODE;
  assert.ok(res.job, JSON.stringify(res));
  assert.equal(jobs.readJob(res.job).via, 'owner');
  await assert.rejects(squad.runRoutineNow(fid, r.id), /is running/);
  squad.logJobEnded(jobs.stopJob(res.job));            // as the Stop button does
  assert.ok(await settle(() => !cadence.runOf(fid, r.id).running));
  assert.equal(cadence.runOf(fid, r.id).last.manual, true);
  assert.equal(squadLog.read(fid, { type: 'cadence.started' }).at(-1).data.manual, true);
  floors.updateFloorConfig(proj, { shift: { enabled: false } });
  const ghost = cadence.add(proj, { title: 'Ghost', agent: 'legal-counsel', every: 'daily', at: hhmm(Date.now() - 60e3), task: 't', enabled: true });
  assert.match((await squad.cadenceTick()).find((x) => x.routine === ghost.id).skipped, /no agent with the role or id "legal-counsel"/);
  cadence.remove(proj, ghost.id); cadence.remove(proj, r.id);
});

test('roles: the Owner defines routines; a Member runs and toggles them; a Viewer reads', async () => {
  const mem = users.addUser({ name: 'Sari', role: 'member' }), view = users.addUser({ name: 'Vino', role: 'viewer' });
  const r = (await call('POST', `/api/floors/${fid}/cadence`, { title: 'Weekly check', agent: mira, every: 'weekly:mon', at: '06:00', task: 'Check.' })).body;
  assert.equal((await call('POST', `/api/floors/${fid}/cadence`, { title: 'Nope', agent: mira, task: 't' }, mem.pin)).status, 403);
  assert.equal((await call('PATCH', `/api/floors/${fid}/cadence/${r.id}`, { task: 'changed' }, mem.pin)).status, 403);
  assert.equal((await call('DELETE', `/api/floors/${fid}/cadence/${r.id}`, null, mem.pin)).status, 403);
  assert.equal((await call('POST', `/api/floors/${fid}/cadence/enable`, null, mem.pin)).status, 403);
  assert.equal((await call('POST', `/api/floors/${fid}/cadence/${r.id}/toggle`, { enabled: true }, mem.pin)).status, 200);
  assert.equal((await call('POST', `/api/floors/${fid}/cadence/${r.id}/toggle`, { enabled: false }, view.pin)).status, 403);
  assert.equal((await call('POST', `/api/floors/${fid}/cadence/${r.id}/run`, null, view.pin)).status, 403);
  const seen = (await call('GET', `/api/floors/${fid}/cadence`, null, view.pin)).body.routines.find((x) => x.id === r.id);
  assert.deepEqual([seen.enabled, typeof seen.next], [true, 'number']);
  assert.ok((await call('GET', '/api/cadence', null, view.pin)).body.spaces.some((s) => s.id === fid));
  const run = await call('POST', `/api/floors/${fid}/cadence/${r.id}/run`, null, mem.pin);
  assert.equal(run.status, 200, JSON.stringify(run.body));
  await settle(() => !cadence.runOf(fid, r.id).running && !cadence.runOf(fid, r.id).pending);
  // an Owner-only Space's routines are not there for others
  floors.updateFloorConfig(proj, { access: 'owner' });
  (await import('../server/access.js')).forgetOwnerFloors();
  assert.equal((await call('GET', `/api/floors/${fid}/cadence`, null, mem.pin)).status, 404);
  assert.ok(!(await call('GET', '/api/cadence', null, mem.pin)).body.spaces.some((s) => s.id === fid));
  floors.updateFloorConfig(proj, { access: 'team' });
  (await import('../server/access.js')).forgetOwnerFloors();
  assert.equal((await call('DELETE', `/api/floors/${fid}/cadence/${r.id}`)).status, 200);
});
