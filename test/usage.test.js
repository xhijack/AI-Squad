// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scratch } from './helpers.js';
import * as usage from '../server/usage.js';
import * as rc from '../server/recovery.js';
import { parseProcStat } from '../server/meter.js';

scratch();
const MB = 2 ** 20;
// 100: tmux pane (claude) -> 101 MCP server -> 102 test run; 200: another agent; 300: unrelated
const tree = new Map([
  [100, { ppid: 1, rss: 400 * MB, cpu: 2 }], [101, { ppid: 100, rss: 120 * MB, cpu: 0.5 }], [102, { ppid: 101, rss: 300 * MB, cpu: 30 }],
  [200, { ppid: 1, rss: 350 * MB, cpu: 1 }], [300, { ppid: 1, rss: 999 * MB, cpu: 50 }],
]);

test('/proc/<pid>/stat gives the parent pid too', () => {
  const p = parseProcStat('4242 (claude) S 4100 4242 4242 0 -1 4194560 1 0 0 0 150 25 0 0 20 0 11 0 100 500000000 25600 18446744073709551615');
  assert.equal(p.comm, 'claude'); assert.equal(p.ppid, 4100); assert.equal(p.ticks, 175); assert.equal(p.rss, 25600 * 4096);
});

test('an agent session counts its own process and everything under it', () => {
  assert.deepEqual([...usage.descendants(tree, [100])].sort(), [100, 101, 102]);
  assert.deepEqual(usage.usageOf(tree, [100]), { rss: 820 * MB, cpu: 32.5, procs: 3 });
  assert.equal(usage.usageOf(tree, [999]), null, 'a pane that is not in the sample');
  const m = usage.sessionsUsage(['aisquad-a-dev', 'aisquad-a-qa', 'gone'], tree, (n) => ({ 'aisquad-a-dev': [100], 'aisquad-a-qa': [200] }[n] || []));
  assert.equal(m.get('aisquad-a-dev').rss, 820 * MB);
  assert.equal(m.get('aisquad-a-qa').rss, 350 * MB);
  assert.equal(m.has('gone'), false);
  assert.equal(usage.sessionsUsage(['x'], new Map(), () => [1]).size, 0, 'no /proc (macOS): nothing');
});

test('running averages and peaks per session give the RAM estimate for one more agent', () => {
  usage.resetStats();
  assert.equal(usage.estimateSessionRss(), usage.DEFAULT_SESSION_RSS, '1 GB until measured');
  usage.record(new Map([['s1', { rss: 600 * MB, cpu: 3 }]]), { now: 1 });
  usage.record(new Map([['s1', { rss: 800 * MB, cpu: 5 }], ['s2', { rss: 500 * MB, cpu: 1 }]]), { now: 2 });
  const st = usage.loadStats();
  assert.equal(st.sessions.s1.peakRss, 800 * MB);
  assert.equal(st.sessions.s1.samples, 2);
  assert.equal(st.global.samples, 3);
  const est = usage.estimateSessionRss();
  assert.ok(est >= st.global.avgRss && est <= 800 * MB, 'between the average and the peak');
  assert.equal(usage.summary().measured, true);
});

test('the start warning counts the whole Building against its own maximum', () => {
  assert.equal(rc.buildingMax({}), rc.BUILDING_MAX_DEFAULT);
  assert.equal(rc.buildingMax({ maxAgents: '3' }), 3);
  assert.equal(rc.buildingMax({ maxAgents: 0 }), 1);
  assert.deepEqual(rc.startWarnings({ running: 1, maxAgents: 4, buildingRunning: 3, buildingMax: 6 }), []);
  assert.match(rc.startWarnings({ running: 1, maxAgents: 4, buildingRunning: 6, buildingMax: 6 })[0], /6 agents already run on this machine \(Building maximum 6\)/);
});
