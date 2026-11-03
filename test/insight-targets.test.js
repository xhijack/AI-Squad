// SPDX-License-Identifier: Apache-2.0
// Daily Insight reads the targets (1.13): a target behind two closed periods in a row raises "plans to approve" (or
// advice when plans are already raised), one beaten by far gets a goal near what is reached, a failing measurement or
// a hand-entered target nobody enters gets advice; accepting changes the target through the change history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as insight from '../server/insight.js';
import * as inbox from '../server/inbox.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as history from '../server/history.js';
import * as kpi from '../server/kpi.js';

const root = scratch();
const NOW = new Date(2026, 10, 4, 10, 0).getTime();              // a Wednesday
const wk = (n) => kpi.periodStart('week', NOW) - n * 7 * 864e5 + 2 * 864e5;   // inside the n-th closed week (1: last week)
const k = (o) => ({ id: 'leads', name: 'Leads', unit: 'leads', target: 50, direction: 'up', period: 'week', onBehind: { mode: 'notify' }, source: { kind: 'manual' }, ...o });
const closed = (vals) => vals.map((value) => ({ value }));
const one = (target, events = {}) => insight.analyzeTargets({ spaces: [{ id: 'mkt', name: 'Marketing', targets: [target] }], events });

test('closed periods: the last value of each, newest first; the running period is not one of them', () => {
  const pts = [{ ts: wk(3), value: 10 }, { ts: wk(2), value: 20 }, { ts: wk(2) + 3600e3, value: 22 }, { ts: wk(1), value: 30 }, { ts: NOW - 3600e3, value: 99 }];
  assert.deepEqual(insight.closedPeriods(pts, 'week', 3, NOW, kpi.periodStart).map((p) => p.value), [30, 22, 10]);
  assert.deepEqual(insight.closedPeriods([], 'month', 2, NOW, kpi.periodStart).map((p) => p.value), [null, null]);
  assert.deepEqual([insight.roundGoal(4321, 'up'), insight.roundGoal(4321, 'down'), insight.roundGoal(87, 'up')], [4300, 4400, 87]);
});

test('behind twice: plans to approve when nothing is raised, advice when plans already are; once: nothing', () => {
  let [s] = one(k({ closed: closed([30, 41, 60]) }));
  assert.equal(s.category, 'target');
  assert.match(s.title, /Leads \(Marketing\) was behind its goal 2 weeks in a row \(30, 41 leads for 50 leads\)/);
  assert.deepEqual(s.change, { kind: 'kpi', floorId: 'mkt', kpiId: 'leads', patch: { onBehind: { mode: 'suggest' } } });
  [s] = one(k({ onBehind: { mode: 'act' }, closed: closed([30, 41]) }));
  assert.equal(s.change, null); assert.match(s.advice, /look at the goal/);
  assert.deepEqual(one(k({ closed: closed([30, 60]) })), [], 'behind once');
  assert.deepEqual(one(k({ direction: 'down', target: 2, unit: 'hours', closed: closed([3, 5]) })).map((x) => x.key), ['kpi-behind:mkt:leads'], 'a goal that goes down');
  assert.deepEqual(one(k({ period: 'day', closed: closed([30, 41]) })), [], 'a daily target needs 3 days');
  assert.deepEqual(one(k({ period: 'total', closed: closed([30, 41]) })), [], 'a total has no periods');
});

test('beaten by far: a goal near what is reached; measurement failing; nobody enters it', () => {
  let [s] = one(k({ closed: closed([160, 92]) }));
  assert.deepEqual(s.change, { kind: 'kpi', floorId: 'mkt', kpiId: 'leads', patch: { target: 92 } });
  [s] = one(k({ direction: 'down', target: 48, unit: 'hours', closed: closed([12, 20]) }));
  assert.deepEqual(s.change.patch, { target: 20 });
  assert.deepEqual(one(k({ closed: closed([70, 72]) })), [], 'met, not by far');
  const fails = { mkt: [1, 2, 3].map((i) => ({ id: `f${i}`, type: 'kpi.failed', data: { kpi: 'leads', error: 'ERPNext 401' } })) };
  [s] = one(k({ source: { kind: 'erpnext' }, closed: closed([60, 70]) }), fails);
  assert.match(s.title, /could not be measured 3 times/); assert.match(s.evidence[0].summary, /ERPNext 401/); assert.equal(s.change, null);
  [s] = one(k({ closed: closed([null, null]) }));
  assert.match(s.title, /has no value for 2 weeks/);
  assert.deepEqual(one(k({ source: { kind: 'erpnext' }, closed: closed([null, null]) })), [], 'a measured target is not "entered"');
  assert.deepEqual(one(k({ target: null, closed: closed([1, 2]) })), [], 'no goal, nothing to say');
});

test('the nightly run reads the Space\'s targets; accepting changes the goal through the change history', async () => {
  const proj = path.join(root, 'projects', 'mkt');
  await floors.createFloor({ name: 'Marketing', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Sinta - Marketing', template: 'marketing-strategist' }] });
  const fid = building.loadBuilding().floors[0].id;
  kpi.addKpi(proj, { id: 'leads', name: 'Leads', unit: 'leads', target: 50, direction: 'up', period: 'week', source: { kind: 'manual' } });
  kpi.record(fid, proj, 'leads', 120, { now: wk(2) });
  kpi.record(fid, proj, 'leads', 95, { now: wk(1) });
  const r = inbox.run(NOW);
  const sug = r.added.find((x) => x.key === `kpi-easy:${fid}:leads:95`);
  assert.ok(sug, JSON.stringify(r.added.map((x) => x.key)));
  assert.equal(kpi.readDefs(proj)[0].target, 50, 'not applied by itself');
  const done = await inbox.accept(sug.id, { name: 'Owner' });
  assert.deepEqual(done.result, { applied: true });
  assert.equal(kpi.readDefs(proj)[0].target, 95);
  assert.equal(history.list()[0].label, 'Improvement: target Leads');
  assert.deepEqual(await inbox.applyChange({ kind: 'kpi', floorId: fid, kpiId: 'leads', patch: { onBehind: { mode: 'suggest' } } }, 'Owner'), { applied: true });
  assert.equal(kpi.readDefs(proj)[0].onBehind.mode, 'suggest');
  await assert.rejects(inbox.applyChange({ kind: 'kpi', floorId: fid, kpiId: 'gone', patch: { target: 1 } }, 'Owner'), /no longer in this Space/);
});
