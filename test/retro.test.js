import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as retro from '../server/retro.js';
import * as learnings from '../server/learnings.js';

const root = scratch({ seed: false });
const metrics = (o = {}) => ({
  process: { qaFirstRoundPassRate: 0.5, qaReported: 4, qaBeforeMerge: { merges: 1, mergesWithAllQa: 1 }, bugs: { open: 1 }, rework: { reopened: 2 } },
  efficiency: { plannedSP: 13, doneSP: 8, cacheHitRate: 0.82, idleWithOpenWorkMin: 45, blockedOnOwnerMin: 5, byAgent: [{ agent: 'budi-dev', role: 'fullstack-developer', cost: 1.2, turns: 40, toolCalls: 90, failedTools: 3, idleWithOpenWorkMin: 20 }] },
  quality: { crashes: 0 }, debug: { loops: [{ issue: 'login-500', attempts: 4 }] }, autopilot: { criticalDecided: 0 }, ...o });
const AUDIT = { id: '2026-10-26T12-00-00Z', createdAt: '2026-10-26T12:00:00Z', range: { sprint: 2 }, metrics: metrics(),
  findings: [{ id: 'F2', severity: 'medium', title: 'Idle teammates', recommendation: 'Re-assign work when a teammate is idle.', target: null },
    { id: 'F1', severity: 'high', title: 'Login fix loop', recommendation: 'Escalate after three attempts.', target: { kind: 'role-template', id: 'fullstack-developer' } }] };
const PERF = { sprints: [{ sprint: 1, costPerSP: 0.3, doneSP: 5, plannedSP: 5 }, { sprint: 2, costPerSP: 0.45, doneSP: 8, plannedSP: 13 }],
  agents: [{ id: 'budi-dev', bySprint: { 2: { sp: 8, firstPassRate: 0.5, bugsPerSP: 0.25 } } }] };

test('the Retro: went well, did not, three changes, per agent, cost per story point trend', () => {
  const r = retro.buildRetro(AUDIT, PERF);
  assert.equal(r.sprint, 2);
  assert.deepEqual(r.wentWell, ['1 of 1 merges had QA for every module', 'cache hit rate 82 %']);
  assert.deepEqual(r.wentBadly, ['Login fix loop', 'QA passed 50 % of 4 modules in the first round', '8 of 13 story points done', 'cost per story point $0.45 (sprint 1: $0.3)', '1 bug still open', '2 board rows reopened'], 'the worst finding first, at most six');
  assert.deepEqual(r.changes.map((c) => c.finding), ['F1', 'F2', null], 'the most severe findings first, then a change the numbers suggest');
  assert.equal(r.changes[2].text, 'Developers stop after three failed fix attempts and escalate with the investigate record.');
  assert.deepEqual(r.perAgent[0], { agent: 'budi-dev', role: 'fullstack-developer', cost: 1.2, turns: 40, toolCalls: 90, failedTools: 3, idleWithOpenWorkMin: 20, sp: 8, firstPassRate: 0.5, bugsPerSP: 0.25 });
  assert.deepEqual(r.costPerSPTrend.map((t) => t.costPerSP), [0.3, 0.45]);
  const md = retro.retroMd(r, 'POS');
  for (const h of ['# Retro: POS, sprint 2', '## What went well', '## What did not', '## Three changes', '## Per agent', '## Cost per story point', '- sprint 2: $0.45 (8 of 13 SP)']) assert.ok(md.includes(h), h);
  assert.match(retro.learningsTask(r, 'docs/squad/retro/sprint-2.md'), /docs\/squad\/LEARNINGS\.md/);
});

test('a calm sprint: no Performance data and no findings still gives a Retro', () => {
  const r = retro.buildRetro({ ...AUDIT, findings: [], metrics: metrics({ debug: { loops: [] }, process: { qaFirstRoundPassRate: 1, qaReported: 2, bugs: { open: 0 }, rework: { reopened: 0 } }, efficiency: { plannedSP: 5, doneSP: 5, byAgent: [] } }) });
  assert.deepEqual(r.wentWell, ['QA passed 100 % of 2 modules in the first round', '5 of 5 story points done', 'no crashes and no debug loops']);
  assert.deepEqual(r.wentBadly, []); assert.deepEqual(r.changes, []); assert.deepEqual(r.costPerSPTrend, []);
});

test('without Performance data the trend comes from the audits of earlier sprints', () => {
  const old = { id: 'a1', range: { sprint: 1 }, metrics: { efficiency: { costPerSP: 0.2, doneSP: 5, plannedSP: 5 } } };
  const r = retro.buildRetro({ ...AUDIT, metrics: metrics({ efficiency: { ...metrics().efficiency, costPerSP: 0.15 } }) }, null, [old, { id: 'x', range: {}, metrics: {} }]);
  assert.deepEqual(r.costPerSPTrend.map((t) => [t.sprint, t.costPerSP]), [[1, 0.2], [2, 0.15]]);
  assert.ok(r.wentWell.includes('cost per story point $0.15 (sprint 1: $0.2)'));
});

test('LEARNINGS.md: created with a header, entries dated with their source, no duplicates', () => {
  const proj = path.join(root, 'shop');
  learnings.ensure(proj);
  assert.match(fs.readFileSync(learnings.fileOf(proj), 'utf8'), /^# Learnings\n[\s\S]*## Entries\n$/);
  const now = Date.parse('2026-10-26T10:00:00Z');
  assert.equal(learnings.add(proj, [{ source: 'retro sprint 2', text: 'Run the cart tests with TZ=UTC; local time zones break totals.' }, { source: 'bug', text: '  ' }], now).added, 1);
  learnings.add(proj, [{ source: 'retro sprint 2', text: 'Run the cart tests with TZ=UTC; local time zones break totals.' }], now + 864e5);
  assert.deepEqual(learnings.entries(proj), [{ date: '2026-10-26', source: 'retro sprint 2', text: 'Run the cart tests with TZ=UTC; local time zones break totals.' }]);
  assert.equal(learnings.FILE, 'docs/squad/LEARNINGS.md');
});
