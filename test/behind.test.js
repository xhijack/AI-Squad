// SPDX-License-Identifier: Apache-2.0
// Targets that act (1.5): the rule per target (notify, suggest, act), when it fires (once per period and cooldown,
// never stale or goal-less), the trust fallback, stable notice ids, the numbers in the task, the cards, the Squad
// Log, Owner-only hiding.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as users from '../server/users.js';
import * as jobs from '../server/jobs.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as kpi from '../server/kpi.js';
import * as behind from '../server/behind.js';
import * as trust from '../server/trust.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';
import * as access from '../server/access.js';

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
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function settle(cond) {
  for (let i = 0; i < 200; i++) { for (const j of jobs.jobsTick()) squad.logJobEnded(j); if (cond()) return true; await sleep(50); }
  return false;
}
const H = 3600e3;
const T = new Date(2026, 9, 28, 10, 0).getTime();                 // Wednesday 28 Oct 2026, 10:00
const K = (o = {}) => kpi.cleanKpi({ name: 'Leads', unit: 'leads', target: 12, period: 'week', onBehind: { mode: 'notify' }, ...o });
const behindItem = (o = {}) => ({ status: { state: 'behind', pct: 33 }, stale: false, latest: { ts: T, value: 4 }, series: [{ ts: T - 2 * 864e5, value: 2 }, { ts: T - 864e5, value: 3 }, { ts: T, value: 4 }], ...o });

test('the rule is cleaned: modes, agent, task, cooldown 1-720 h; seeded targets notify, others are off', () => {
  assert.deepEqual(kpi.cleanKpi({ name: 'x' }).onBehind, { mode: 'off', agent: '', task: '', cooldown: 24 });
  assert.deepEqual(kpi.cleanKpi({ name: 'x', onBehind: { mode: 'act', agent: 'Content Writer', task: 'Write two posts.', cooldown: '48' } }).onBehind, { mode: 'act', agent: 'content-writer', task: 'Write two posts.', cooldown: 48 });
  assert.equal(kpi.cleanKpi({ name: 'x', onBehind: { mode: 'shout' } }).onBehind.mode, 'off');
  assert.throws(() => kpi.cleanKpi({ name: 'x', onBehind: { cooldown: 0 } }), /Cooldown/);
  const prev = kpi.cleanKpi({ name: 'x', onBehind: { mode: 'suggest', task: 'keep me' } });
  assert.deepEqual(kpi.cleanKpi({ target: 5 }, prev).onBehind, prev.onBehind, 'a change of the goal keeps the rule');
});

test('when it fires: behind with a goal and a fresh value; once per period and per cooldown; open work first', () => {
  const k = K(), it = behindItem(), week = kpi.periodStart('week', T);
  assert.deepEqual(behind.shouldFire(k, it, null, T), { fire: true, period: week });
  assert.equal(behind.shouldFire(K({ onBehind: { mode: 'off' } }), it, null, T).why, 'off');
  assert.equal(behind.shouldFire(K({ target: null }), it, null, T).why, 'no goal');
  assert.equal(behind.shouldFire(k, behindItem({ stale: true }), null, T).why, 'stale');
  assert.equal(behind.shouldFire(k, behindItem({ status: { state: 'unknown' } }), null, T).why, 'stale');
  assert.equal(behind.shouldFire(k, behindItem({ status: { state: 'met' } }), null, T).why, 'not behind');
  const fired = { period: week, firedAt: T, status: 'seen' };
  assert.equal(behind.shouldFire(k, it, fired, T + 30 * H).why, 'once per period');
  assert.equal(behind.shouldFire(k, it, { ...fired, status: 'dismissed' }, T + 30 * H).why, 'dismissed for this period');
  assert.equal(behind.shouldFire(k, it, { ...fired, status: 'notice' }, T + 9 * 864e5).why, 'already open', 'an open notice is not raised again');
  // a new period, but within the cooldown: not yet
  const mon = new Date(2026, 10, 2, 1, 0).getTime();
  const late = { period: week, firedAt: new Date(2026, 10, 1, 20, 0).getTime(), status: 'closed' };
  assert.equal(behind.shouldFire(k, it, late, mon).why, 'cooldown');
  assert.equal(behind.shouldFire(k, it, late, mon + 24 * H).fire, true, 'the next week, after the cooldown');
  // stable id per target and period
  assert.equal(behind.noticeId('mkt', 'leads', week), `target:mkt:leads:${week}`);
});

test('act needs a Space that may act by itself and money left, else it asks (suggest)', () => {
  assert.deepEqual(behind.modeFor({ mode: 'act' }, { canAct: true }), { mode: 'act' });
  assert.match(behind.modeFor({ mode: 'act' }, { canAct: false }).fallback, /does not act by itself/);
  assert.deepEqual([behind.modeFor({ mode: 'act' }, { canAct: true, budgetOver: true }).mode, behind.modeFor({ mode: 'act' }, { canAct: true, budgetOver: true }).fallback], ['suggest', 'the Space reached its budget']);
  assert.deepEqual(behind.modeFor({ mode: 'notify' }), { mode: 'notify' });
  assert.equal(trust.allowsActions({ autopilot: 'full' }), true);
  assert.equal(trust.allowsActions({ autopilot: 'balanced' }), false);
  assert.equal(trust.allowsActions({ autopilot: 'full', blueprint: { id: 'legal' } }), false);
  assert.equal(trust.allowsActions({ autopilot: 'full', access: 'owner' }), false);
});

test('the texts carry the numbers, the trend and KPI.md; never an invented value', () => {
  const k = K({ onBehind: { mode: 'suggest', task: 'Write two extra posts with a lead form.' } }), it = behindItem();
  assert.equal(behind.noticeText(k, it), 'Leads this week: 4 of 12 leads, behind');
  assert.equal(behind.noticeText(K({ name: 'Open bugs', unit: '', target: 5, direction: 'down', period: 'total' }), behindItem({ latest: { value: 9 } })), 'Open bugs in total: 9, at most 5, behind');
  const task = behind.taskText(k, it, k.onBehind, 'DTamu Marketing', '1. Post twice.\n2. Add the form.');
  assert.match(task, /Target behind in DTamu Marketing: Leads\./);
  assert.match(task, /Now: 4 leads this week/);
  assert.match(task, /Goal: at least 12 leads this week\. Status: behind \(33 %\)/);
  assert.match(task, /Trend: 2 → 3 → 4 \(last 3 measurements/);
  assert.match(task, /docs\/squad\/KPI\.md\. Plan against these numbers; never invent a value/);
  assert.match(task, /Task: Write two extra posts with a lead form\./);
  assert.match(task, /approved this plan:\n1\. Post twice\.\n2\. Add the form\./);
  assert.match(behind.planPrompt(k, it, k.onBehind, 'X'), /change no file and send nothing/);
});

let fid = '', proj = '', lead = '', writer = '';
test('setup: a Marketing Space with a weekly leads target', async () => {
  proj = path.join(root, 'projects', 'mkt');
  await floors.createFloor({ name: 'DTamu Marketing', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Mira - Strategist', template: 'fullstack-developer', lead: true }, { displayName: 'Dodi - Writer', template: 'qa-engineer' }] });
  fid = building.loadBuilding().floors[0].id;
  [lead, writer] = floors.readFloor(proj).team.agents.map((a) => a.id);
  building.setPrefs({ maxAgents: 4, dispatcher: { reserveP0: 0, idleStopMin: 0 } });
  squad.setResourceReader(() => ({ mem: { available: 8 * GB }, cpus: 4, load: [0.2, 0.2, 0.2] }));
  kpi.seed(proj, [{ id: 'leads', name: 'Leads', unit: 'leads', period: 'week' }]);
  assert.equal(kpi.readDefs(proj)[0].onBehind.mode, 'notify', 'a seeded target notifies');
  kpi.updateKpi(proj, 'leads', { target: 12 });
});

const card = (kind) => squad.attentionItems().find((a) => a.floorId === fid && a.kind === kind);
test('notify: a measurement behind the goal raises one muted notice with a stable id; OK closes it; no second one this period', async () => {
  kpi.record(fid, proj, 'leads', 4);
  await sleep(50);
  squad.invalidate();
  const n = card('target');
  assert.ok(n, 'the notice is there');
  assert.equal(n.text, 'Leads this week: 4 of 12 leads, behind');
  assert.deepEqual([n.notice, n.muted, n.id], [true, true, behind.noticeId(fid, 'leads', kpi.periodStart('week'))]);
  const ev = squadLog.read(fid, { type: 'kpi.behind' }).at(-1);
  assert.deepEqual([ev.data.kpi, ev.data.value, ev.data.target, ev.data.mode], ['leads', 4, 12, 'notify']);
  assert.match(ev.summary, /target Leads: 4 leads of 12, behind \(notify\)/);
  kpi.record(fid, proj, 'leads', 5);                                         // measured again: still one notice
  await sleep(50); squad.invalidate();
  assert.equal(squad.attentionItems().filter((a) => a.kind === 'target').length, 1);
  await squad.answerAttention(n.id, 0);
  assert.equal(card('target'), undefined);
  kpi.record(fid, proj, 'leads', 6);
  await sleep(50); squad.invalidate();
  assert.equal(card('target'), undefined, 'once per period');
  assert.deepEqual(behind.history(fid).map((h) => h.action), ['notice']);
});

test('suggest: the rule\'s agent drafts a plan (read-only run); Approve starts it as a task with the numbers and the plan', async () => {
  const now = Date.now() + 9 * 864e5;                                       // next period, after the cooldown
  kpi.updateKpi(proj, 'leads', { onBehind: { mode: 'suggest', agent: 'qa-engineer', task: 'Write two extra posts with a lead form.' } });
  kpi.record(fid, proj, 'leads', 3, { now });
  await sleep(50);
  assert.equal(behind.stateOf(fid, 'leads').status, 'drafting');
  const draft = jobs.listJobs({ floorId: fid })[0];
  assert.deepEqual([draft.agentId, draft.permissionMode, draft.kind, draft.via], [writer, 'plan', 'plan', 'kpi']);
  assert.ok(await settle(() => behind.stateOf(fid, 'leads').status === 'suggested'));
  squad.invalidate();
  const c = card('target-plan');
  assert.deepEqual(c.options.map((o) => o.label), ['Approve', 'Dismiss']);
  assert.match(c.text, /^Leads this week: 3 of 12 leads, behind\n\nRecovery plan:\nDone: Target behind in DTamu Marketing/);
  const r = await squad.answerAttention(c.id, 1);
  assert.ok(r.job, JSON.stringify(r));
  const task = jobs.readJob(r.job);
  assert.deepEqual([task.agentId, task.permissionMode, task.via], [writer, 'acceptEdits', 'kpi']);
  assert.match(jobs.promptOf(r.job), /Now: 3 leads this week[\s\S]*Task: Write two extra posts[\s\S]*The owner approved this plan:\nDone:/);
  assert.equal(behind.stateOf(fid, 'leads').status, 'acting');
  assert.equal(squad.buildingSnapshot().targets.acting, 1, 'the cockpit: 1 acting');
  assert.deepEqual(squadLog.read(fid, { type: 'kpi.action' }).map((e) => e.data.action), ['approved', 'started']);
  assert.ok(await settle(() => behind.stateOf(fid, 'leads').status === 'closed'));
  await assert.rejects(squad.answerAttention(c.id, 1), /Already answered|no longer/i);
});

test('suggest, Dismiss: the target is quiet for the rest of the period', async () => {
  const now = Date.now() + 18 * 864e5;
  kpi.record(fid, proj, 'leads', 2, { now });
  await sleep(50);
  assert.ok(await settle(() => behind.stateOf(fid, 'leads').status === 'suggested'));
  squad.invalidate();
  await squad.answerAttention(card('target-plan').id, 2);
  assert.equal(behind.stateOf(fid, 'leads').status, 'dismissed');
  assert.equal(squadLog.read(fid, { type: 'kpi.action' }).at(-1).data.action, 'dismissed');
  kpi.record(fid, proj, 'leads', 1, { now: now + 2 * 864e5 });
  await sleep(50);
  assert.equal(behind.stateOf(fid, 'leads').status, 'dismissed', 'no new trigger this period');
});

test('act: without Autopilot full it asks instead; with it the task starts at once as automated work', async () => {
  const now = Date.now() + 27 * 864e5;
  kpi.updateKpi(proj, 'leads', { onBehind: { mode: 'act', agent: '', task: 'Book two webinars.' } });
  kpi.record(fid, proj, 'leads', 2, { now });
  await sleep(50);
  const t = behind.stateOf(fid, 'leads');
  assert.deepEqual([t.mode, t.status], ['suggest', 'drafting']);
  assert.match(t.fallback, /Autopilot is not full/);
  assert.ok(await settle(() => behind.stateOf(fid, 'leads').status === 'suggested'));
  squad.invalidate();
  assert.match(card('target-plan').text, /asked instead of acting/);
  await squad.answerAttention(card('target-plan').id, 2);
  // now the Space acts by itself
  floors.updateFloorConfig(proj, { autopilot: 'full' });
  kpi.record(fid, proj, 'leads', 2, { now: now + 9 * 864e5 });
  await sleep(50);
  assert.equal(behind.stateOf(fid, 'leads').status, 'acting');
  const job = jobs.listJobs({ floorId: fid })[0];
  assert.deepEqual([job.agentId, job.via, job.kind], [lead, 'kpi', 'task'], 'no agent in the rule: the lead');
  assert.match(jobs.promptOf(job.id), /Task: Book two webinars\./);
  assert.deepEqual(squadLog.read(fid, { type: 'kpi.action' }).at(-1).data, { kpi: 'leads', name: 'Leads', action: 'started', auto: true });
  assert.ok(await settle(() => behind.stateOf(fid, 'leads').status === 'closed'));
  floors.updateFloorConfig(proj, { autopilot: 'balanced' });
});

test('Owner-only Spaces: the cards are the Owner\'s alone; the Owner sets the rule, a Member cannot', async () => {
  const mem = users.addUser({ name: 'Sari', role: 'member' });
  assert.equal((await call('PATCH', `/api/floors/${fid}/kpis/leads`, { onBehind: { mode: 'notify' } }, mem.pin)).status, 403);
  assert.equal((await call('PATCH', `/api/floors/${fid}/kpis/leads`, { onBehind: { mode: 'notify' } })).status, 200);
  floors.updateFloorConfig(proj, { access: 'owner' });
  access.forgetOwnerFloors();
  kpi.record(fid, proj, 'leads', 1, { now: Date.now() + 45 * 864e5 });
  await sleep(50); squad.invalidate();
  const own = (await call('GET', '/api/building')).body.attention.find((a) => a.kind === 'target');
  assert.ok(own, 'the Owner sees it'); assert.equal(own.ownerOnly, true);
  assert.equal((await call('GET', '/api/building', null, mem.pin)).body.attention.some((a) => a.kind === 'target'), false);
  const list = (await call('GET', `/api/floors/${fid}/kpis`)).body;
  assert.equal(list.kpis[0].onBehind.mode, 'notify');
  assert.ok(list.triggers.length >= 4, 'the history of triggers');
  floors.updateFloorConfig(proj, { access: 'team' });
  access.forgetOwnerFloors();
});
