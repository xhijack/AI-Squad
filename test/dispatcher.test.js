// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import * as dispatcher from '../server/dispatcher.js';
import * as quota from '../server/quota.js';
import * as jobs from '../server/jobs.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-stream.cjs');
configure({ claudeBin: FAKE, useHooks: false, useSystemd: false });
process.env.FAKE_CLAUDE_LOG = path.join(root, 'fake.log');
const GB = 2 ** 30;
const T0 = new Date(2026, 9, 27, 10, 0).getTime();          // a Tuesday morning
const item = (o) => ({ id: o.id, floorId: 'f', agentId: o.id, action: 'start', priority: 'P2', via: 'aisquad', createdAt: T0, ...o });

test('capacity: the Building maximum, free RAM (2 GB kept), CPU load; the smallest wins', () => {
  assert.deepEqual(dispatcher.capacity({ maxAgents: 6, running: 2 }).free, 4);
  const ram = dispatcher.capacity({ maxAgents: 6, running: 2, res: { mem: { available: 5 * GB } }, sessionRss: 1.5 * GB });
  assert.equal(ram.cap, 4); assert.equal(ram.free, 2); assert.equal(ram.limiting, 'ram');
  const tight = dispatcher.capacity({ maxAgents: 6, running: 3, res: { mem: { available: 1.5 * GB } }, sessionRss: GB });
  assert.equal(tight.free, 0, 'below the 2 GB reserve nothing new starts');
  const cpu = dispatcher.capacity({ maxAgents: 6, running: 1, res: { cpus: 2, load: [1.9, 1, 1], mem: { available: 6 * GB } }, sessionRss: GB });
  assert.equal(cpu.free, 4); assert.equal(cpu.cpuBusy, true); assert.equal(cpu.limiting, 'cpu');
  const p = dispatcher.plan([item({ id: 'mine', priority: 'P0', via: 'owner' }), item({ id: 'auto', priority: 'P2' })], { free: 4, cpuBusy: true }, T0);
  assert.deepEqual([p.start.map((x) => x.id), p.held[0].reason], [['mine'], 'the CPU is busy'], 'a busy CPU holds automated work, not the owner');
});

test('priority ages one level per 30 minutes waiting, automated work never reaches P0', () => {
  assert.equal(dispatcher.effectivePriority(item({ priority: 'P3' }), T0 + 29 * 60e3), 3);
  assert.equal(dispatcher.effectivePriority(item({ priority: 'P3' }), T0 + 31 * 60e3), 2);
  assert.equal(dispatcher.effectivePriority(item({ priority: 'P3' }), T0 + 5 * 3600e3), 1);
  assert.equal(dispatcher.effectivePriority(item({ priority: 'P0' }), T0), 0);
});

test('plan: order, owner reserve, shift, quota pause, Space maximum and one start per agent', () => {
  const items = [item({ id: 'bg', priority: 'P3', createdAt: T0 - 1000 }), item({ id: 'squad', priority: 'P1' }), item({ id: 'mine', priority: 'P0', via: 'owner' })];
  assert.deepEqual(dispatcher.plan(items, { free: 3 }, T0).start.map((x) => x.id), ['mine', 'squad', 'bg']);
  const r = dispatcher.plan(items, { free: 2 }, T0);
  assert.deepEqual(r.start.map((x) => x.id), ['mine', 'squad']);
  assert.equal(r.held[0].reason, 'waiting for a free slot');
  const kept = dispatcher.plan(items, { free: 3, reserve: 1 }, T0);
  assert.deepEqual(kept.start.map((x) => x.id), ['mine', 'squad'], 'one slot stays free for the owner');
  assert.equal(kept.held[0].reason, 'the last free slot is kept for the owner');
  const reserve = dispatcher.plan([item({ id: 'squad', priority: 'P1' })], { free: 1, reserve: 1 }, T0);
  assert.deepEqual([reserve.start.length, reserve.held[0].reason], [0, 'the last free slot is kept for the owner']);
  const shift = dispatcher.plan(items, { free: 3, inShift: () => false }, T0);
  assert.deepEqual(shift.start.map((x) => x.id), ['mine'], 'outside the shift only the owner\'s own work starts');
  assert.ok(shift.held.every((h) => h.reason === 'outside the Space\'s shift'));
  const q = dispatcher.plan(items, { free: 3, quotaPaused: true }, T0);
  assert.deepEqual(q.start.map((x) => x.id), ['mine']);
  const space = dispatcher.plan([item({ id: 'a' }), item({ id: 'b' })], { free: 3, floorFree: () => 1 }, T0);
  assert.deepEqual([space.start.length, space.held[0].reason], [1, 'the Space runs its maximum of agents at once']);
  const twice = dispatcher.plan([item({ id: 'x', agentId: 'dev' }), item({ id: 'y', agentId: 'dev', action: 'job' })], { free: 3 }, T0);
  assert.deepEqual([twice.start.length, twice.held[0].reason], [1, 'the agent is busy']);
});

test('the queue: kept on disk, the same start queued once (higher priority wins), priority and removal', () => {
  const a = dispatcher.enqueue({ floorId: 'f', agentId: 'dev', action: 'start', task: 'x', priority: 'P2' }, T0);
  const b = dispatcher.enqueue({ floorId: 'f', agentId: 'dev', action: 'start', task: 'x', priority: 'P1' }, T0 + 1);
  assert.equal(a.id, b.id); assert.equal(dispatcher.load()[0].priority, 'P1');
  dispatcher.enqueue({ floorId: 'f', agentId: 'qa', action: 'job', task: 'y', priority: 'P3' }, T0 + 2);
  assert.equal(dispatcher.load().length, 2);
  dispatcher.setPriority(a.id, 'P3');
  assert.equal(dispatcher.load().find((x) => x.id === a.id).priority, 'P3');
  assert.throws(() => dispatcher.enqueue({ floorId: 'f', agentId: 'x', action: 'explode', priority: 'P1' }), /Unknown action/);
  for (const x of dispatcher.load()) dispatcher.remove(x.id);
  assert.deepEqual(dispatcher.load(), []);
});

test('tick: starts what fits, a failing start is tried again and dropped after three attempts', async () => {
  dispatcher.enqueue({ floorId: 'f', agentId: 'ok', action: 'start', priority: 'P1' }, T0);
  dispatcher.enqueue({ floorId: 'f', agentId: 'bad', action: 'start', priority: 'P2' }, T0);
  const exec = async (it) => { if (it.agentId === 'bad') throw new Error('no tmux'); };
  let r = await dispatcher.tick({ free: 5 }, exec, T0);
  assert.deepEqual(r.started.map((x) => x.agentId), ['ok']);
  assert.equal(dispatcher.load()[0].attempts, 1);
  await dispatcher.tick({ free: 5 }, exec, T0);
  r = await dispatcher.tick({ free: 5 }, exec, T0);
  assert.equal(r.failed[0].dropped, true);
  assert.deepEqual(dispatcher.load(), []);
});

test('idle agents are stopped, but never while someone waits on them or a lead runs teammates', () => {
  const base = { floorId: 'f', own: true, running: true, state: 'idle', lastTs: T0 - 40 * 60e3 };
  const agents = [{ ...base, id: 'idle' }, { ...base, id: 'fresh', lastTs: T0 - 5 * 60e3 }, { ...base, id: 'asks', waitingReply: true }, { ...base, id: 'att', attention: true },
    { ...base, id: 'lead', lead: true, teammatesInLead: true }, { ...base, id: 'work', state: 'working' }, { ...base, id: 'cmd', task: { label: 'npm test' } }, { ...base, id: 'teammate', own: false }];
  assert.deepEqual(dispatcher.idleToStop(agents, { idleMs: 30 * 60e3, now: T0 }).map((a) => a.id), ['idle']);
  assert.deepEqual(dispatcher.idleToStop(agents, { idleMs: 0, now: T0 }), [], '0 turns it off');
});

test('quota: rate-limit shapes, "usage limit reached", the cost proxy against the owner\'s limits', () => {
  assert.deepEqual(quota.parseRateLimits({ five_hour: { used_percentage: 91, resets_at: 1793050000 } }), [{ window: 'five_hour', usedPct: 91, resetsAt: 1793050000000, rejected: false }]);
  assert.deepEqual(quota.parseRateLimits({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1793050000, utilization: 1 } })[0], { window: 'seven_day', usedPct: 1, resetsAt: 1793050000000, rejected: true });
  assert.equal(quota.limitFromText('Claude AI usage limit reached|1793050000').until, 1793050000000);
  assert.equal(quota.limitFromText('all good'), null);
  const cfg = { fiveHourUsd: 10, weekUsd: 100 };
  assert.equal(quota.check({ costs: { fiveHour: 5, week: 20 }, limits: cfg, signals: [], now: T0 }).paused, false);
  const over = quota.check({ costs: { fiveHour: 9.5, week: 20 }, limits: cfg, signals: [], now: T0 });
  assert.equal(over.paused, true); assert.match(over.reason, /\$9\.5 of \$10 used in the last 5 hours \(estimate\)/);
  const sig = quota.check({ costs: {}, limits: {}, signals: [{ window: 'five_hour', usedPct: 93, resetsAt: T0 + 3600e3 }], now: T0 });
  assert.equal(sig.paused, true); assert.equal(sig.until, T0 + 3600e3);
  assert.equal(quota.check({ costs: {}, limits: {}, signals: [{ window: 'five_hour', usedPct: 93, resetsAt: T0 - 1 }], now: T0 }).paused, false, 'after the reset');
  assert.deepEqual(quota.cleanQuota({ fiveHourUsd: '-3', weekUsd: '12.345', pausePct: 10 }), { fiveHourUsd: 0, weekUsd: 12.35, pausePct: 50 });
});

test('end to end: a background job waits for the machine\'s slot, the owner can see why, the tick starts it when there is room', async () => {
  const proj = path.join(root, 'projects', 'mkt');
  await floors.createFloor({ name: 'Marketing', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Mira - Copywriter', template: 'fullstack-developer' }, { displayName: 'Dodi - Designer', template: 'fullstack-developer' }] });
  const fid = building.loadBuilding().floors[0].id;
  const [mira, dodi] = floors.readFloor(proj).team.agents.map((a) => a.id);
  building.setPrefs({ maxAgents: 1, dispatcher: { reserveP0: 0, idleStopMin: 0 } });
  squad.setResourceReader(() => ({ mem: { available: 6 * GB }, cpus: 4, load: [.2, .2, .2] }));   // not this machine's load
  process.env.FAKE_CLAUDE_MODE = 'slow';
  const first = await squad.startAgentJob(fid, mira, 'write the launch post', { guard: true });
  assert.ok(first.job, 'the first job starts at once');
  delete process.env.FAKE_CLAUDE_MODE;
  const second = await squad.startAgentJob(fid, dodi, 'draw the banner', { guard: true });
  assert.equal(second.waiting, true); assert.equal(second.dispatch.reason, 'waiting for a free slot'); assert.equal(second.dispatch.priority, 'P2');
  const st = squad.dispatchStatus();
  assert.equal(st.queue[0].agentName, 'Dodi - Designer'); assert.equal(st.queue[0].reason, 'waiting for a free slot'); assert.equal(st.capacity.limiting, 'building');
  assert.equal(squadLog.read(fid, { type: 'dispatch.queued' }).at(-1).data.reason, 'waiting for a free slot');
  const res = { mem: { available: 6 * GB }, cpus: 4, load: [0.2, 0.2, 0.2] };
  assert.equal((await squad.dispatchTick(Date.now(), { res })).started.length, 0, 'still full');
  jobs.stopJob(first.job.id);
  const r = await squad.dispatchTick(Date.now(), { res });
  assert.deepEqual(r.started.map((x) => x.agentId), [dodi]);
  assert.equal(squad.dispatchStatus().queue.length, 0);
  assert.equal(jobs.listJobs({ agentId: dodi })[0].title, 'draw the banner');
  assert.equal(squadLog.read(fid, { type: 'dispatch.started' }).at(-1).agent, dodi);
  // a Space outside its shift holds automated work, not the owner's
  floors.updateFloorConfig(proj, { shift: { enabled: true, days: [0], from: '00:00', to: '00:01' } });
  const night = await squad.admit({ floorId: fid, agentId: mira, action: 'job', task: 'weekly report', priority: 'P3', via: 'schedule' });
  assert.equal(night.dispatch.reason, 'outside the Space\'s shift');
  const mine = squad.dispatchStatus().queue.find((x) => x.id === night.dispatch.id);
  assert.equal(mine.reason, 'outside the Space\'s shift'); assert.equal(mine.task, undefined, 'the status leaves the task text out');
  squad.dropQueued(night.dispatch.id);
});
