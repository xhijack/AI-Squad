// SPDX-License-Identifier: Apache-2.0
// Cadence (1.5): routine definitions, the schedule maths in local time, and what a tick decides (run, skip, wait).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as cadence from '../server/cadence.js';

const root = scratch();
const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const R = (o) => cadence.cleanRoutine({ title: 'Daily draft', agent: 'content-writer', every: 'daily', at: '09:00', task: 'Draft one post.', enabled: true, ...o });
const withTz = (tz, fn) => { const old = process.env.TZ; process.env.TZ = tz; try { return fn(); } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; } };

test('a routine is cleaned: every, at, budget, title and agent; disabled unless said', () => {
  const r = cadence.cleanRoutine({ title: 'Weekly report vs targets', agent: 'marketing-strategist', every: 'weekly:mon', at: '08:30', task: 'Report.', budget: '2' });
  assert.deepEqual(r, { id: 'weekly-report-vs-targets', title: 'Weekly report vs targets', agent: 'marketing-strategist', every: 'weekly:mon', at: '08:30', task: 'Report.', budget: 2, enabled: false });
  for (const every of ['daily', 'weekdays', 'weekly:sun', 'monthly:1', 'monthly:31']) assert.ok(cadence.parseEvery(every), every);
  for (const every of ['hourly', 'weekly:xyz', 'monthly:0', 'monthly:32', '']) assert.throws(() => R({ every }), /Every:/, every);
  assert.throws(() => R({ at: '9:00' }), /At:/);
  assert.throws(() => R({ budget: 0 }), /Budget/);
  assert.throws(() => R({ budget: 99 }), /Budget/);
  assert.throws(() => R({ task: ' ' }), /needs a task/);
  assert.throws(() => R({ agent: '' }), /needs an agent/);
  assert.equal(R({ budget: '' }).budget, null);
  assert.equal(cadence.everyText('weekly:fri'), 'every Friday');
});

test('schedule maths: daily, weekdays, weekly, monthly (the 31st is the last day of a short month)', () => {
  const wed = at(2026, 10, 28, 10, 0);                          // Wednesday 28 Oct 2026, 10:00
  assert.equal(cadence.lastSlot(R(), wed), at(2026, 10, 28, 9, 0));
  assert.equal(cadence.nextSlot(R(), wed), at(2026, 10, 29, 9, 0));
  assert.equal(cadence.lastSlot(R(), at(2026, 10, 28, 8, 59)), at(2026, 10, 27, 9, 0), 'before 09:00: yesterday\'s');
  const sat = at(2026, 10, 31, 12, 0);
  assert.equal(cadence.lastSlot(R({ every: 'weekdays' }), sat), at(2026, 10, 30, 9, 0), 'Friday');
  assert.equal(cadence.nextSlot(R({ every: 'weekdays' }), sat), at(2026, 11, 2, 9, 0), 'Monday');
  assert.equal(cadence.nextSlot(R({ every: 'weekly:mon' }), wed), at(2026, 11, 2, 9, 0));
  assert.equal(cadence.lastSlot(R({ every: 'weekly:mon' }), wed), at(2026, 10, 26, 9, 0));
  assert.equal(cadence.nextSlot(R({ every: 'monthly:31' }), at(2026, 11, 2)), at(2026, 11, 30, 9, 0), 'November has 30 days');
  assert.equal(cadence.nextSlot(R({ every: 'monthly:31' }), at(2027, 2, 2)), at(2027, 2, 28, 9, 0));
  assert.equal(cadence.nextSlot(R({ every: 'monthly:15' }), at(2026, 10, 20)), at(2026, 11, 15, 9, 0));
  assert.equal(cadence.windowOf(R(), at(2026, 10, 28, 9, 0)), cadence.WINDOW_MS);
});

test('local time: 09:00 is 09:00 on the wall in Jakarta, Los Angeles (across the DST change) and UTC+14', () => {
  for (const tz of ['Asia/Jakarta', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
    withTz(tz, () => {
      const s = new Date(cadence.nextSlot(R(), new Date(2026, 10, 1, 0, 30).getTime()));   // 1 Nov 2026: LA leaves DST at 02:00
      assert.deepEqual([s.getDate(), s.getHours(), s.getMinutes()], [1, 9, 0], tz);
      const n = new Date(cadence.nextSlot(R(), s.getTime()));
      assert.deepEqual([n.getDate(), n.getHours()], [2, 9], `${tz}: the next day, same wall time`);
    });
  }
});

test('decide: run once per slot, skip a missed window, never stack, nothing before it was turned on', () => {
  const r = R();
  const slot = at(2026, 10, 28, 9, 0);
  assert.deepEqual(cadence.decide({ ...r, enabled: false }, {}, slot + 60e3), { action: 'off' });
  assert.deepEqual(cadence.decide(r, {}, slot + 60e3), { action: 'run', slot });
  assert.deepEqual(cadence.decide(r, { lastSlot: slot }, slot + 60e3), { action: 'wait' }, 'once per slot');
  assert.equal(cadence.decide(r, {}, slot + 3 * 3600e3).action, 'skip', 'past the window');
  assert.match(cadence.decide(r, {}, slot + 3 * 3600e3).reason, /missed its window/);
  // after three days of downtime: one skip for the latest slot only, no catch-up storm
  const back = at(2026, 10, 31, 15, 0);
  assert.deepEqual([cadence.decide(r, { lastSlot: slot }, back).action, cadence.decide(r, { lastSlot: slot }, back).slot], ['skip', at(2026, 10, 31, 9, 0)]);
  assert.match(cadence.decide(r, { pending: { queue: 'q-1', until: slot } }, slot + 60e3).reason, /still waiting/);
  assert.match(cadence.decide(r, { running: { job: 'j-1' } }, slot + 60e3).reason, /still running/);
  assert.deepEqual(cadence.decide(r, { since: slot + 30 * 60e3 }, slot + 60 * 60e3), { action: 'wait' }, 'turned on after the slot');
  assert.equal(cadence.expired({ pending: { until: slot + cadence.WINDOW_MS } }, slot + cadence.WINDOW_MS + 1), true);
  assert.equal(cadence.expired({ pending: { until: slot + cadence.WINDOW_MS } }, slot + 60e3), false);
});

test('the file: add, update, remove, at most 20, hand edits kept, Blueprint seeds disabled; run state', () => {
  const dir = path.join(root, 'space');
  fs.mkdirSync(path.join(dir, '.claude', 'aisquad'), { recursive: true });
  const a = cadence.add(dir, { title: 'Daily draft', agent: 'content-writer', every: 'daily', at: '22:30', task: 'Draft one post.' });
  assert.equal(a.enabled, false);
  assert.throws(() => cadence.add(dir, { title: 'Daily draft', agent: 'x', task: 'y' }), /already/);
  assert.equal(cadence.update(dir, a.id, { enabled: true }).enabled, true);
  assert.equal(cadence.update(dir, a.id, { at: '23:00' }).enabled, true, 'a change keeps it on');
  const file = path.join(dir, '.claude', 'aisquad', 'cadence.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8')); j.routines.push({ title: 'broken' }); fs.writeFileSync(file, JSON.stringify(j));
  const seeded = cadence.seed(dir, [{ id: 'daily-draft', title: 'Daily draft', agent: 'a', task: 't', enabled: true }, { title: 'Weekly report', agent: 'marketing-strategist', every: 'weekly:mon', at: '06:00', task: 'Report.', enabled: true }]);
  assert.deepEqual(seeded.map((r) => [r.id, r.enabled]), [['weekly-report', false]], 'existing ids kept, seeds disabled');
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).routines.some((r) => r.title === 'broken'), 'the hand edit stays');
  for (let i = 0; i < 18; i++) cadence.add(dir, { title: `R ${i}`, agent: 'a', task: 't' });
  assert.throws(() => cadence.add(dir, { title: 'one too many', agent: 'a', task: 't' }), /At most 20/);
  assert.deepEqual(cadence.enableAll(dir).filter((r) => !r.enabled), []);
  cadence.remove(dir, 'r-0');
  assert.throws(() => cadence.remove(dir, 'r-0'), /not found/);
  // run state on this machine, 0600
  const slot = at(2026, 10, 28, 23, 0);
  cadence.setRun('space', a.id, (cur) => ({ ...cur, lastSlot: slot, running: { job: 'j-1', slot } }));
  cadence.finish('space', a.id, { status: 'done', cost: 0.12, ms: 9000 }, slot + 9000);
  cadence.skipped('space', a.id, slot + 864e5, 'outside the Space\'s shift', slot + 864e5 + 3 * 3600e3);
  const run = cadence.runOf('space', a.id);
  assert.deepEqual(run.history.map((h) => h.status), ['done', 'skipped']);
  assert.deepEqual([run.history[0].job, run.history[0].cost], ['j-1', 0.12]);
  assert.equal(run.lastSlot, slot + 864e5);
  const items = cadence.list('space', dir, slot);
  const first = items.find((r) => r.id === a.id);
  assert.equal(first.last.status, 'skipped');
  assert.equal(first.next, at(2026, 10, 29, 23, 0));
  assert.equal(cadence.nextFor(items, { id: 'mira', role: 'content-writer' }).id, a.id);
  assert.equal(cadence.nextFor(items, { id: 'mira', role: 'seo-specialist' }), null);
});
