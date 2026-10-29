// SPDX-License-Identifier: Apache-2.0
// The trust ladder (level 1 canaries, measured, kept or rolled back), capacity advice with workers, and promoting a
// lesson from a Space to a Role Template with the client taken out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as insight from '../server/insight.js';
import * as inbox from '../server/inbox.js';
import * as trust from '../server/trust.js';
import * as history from '../server/history.js';
import * as promote from '../server/promote.js';
import * as roles from '../server/roles.js';
import * as learnings from '../server/learnings.js';
import * as squad from '../server/squad.js';

const root = scratch();
await floors.createFloor({ name: 'Klinik Sehat Portal', directory: { mode: 'new', path: path.join(root, 'klinik') }, team: [{ displayName: 'Budi - Developer', template: 'fullstack-developer' }, { displayName: 'Lia - Legal', template: 'legal-counsel' }] });
const e = building.loadBuilding().floors[0];
const [budi, lia] = floors.readFloor(e.path).team.agents;
const ruleSug = (key, agentId = budi.id) => ({ key, category: 'agent-rule', title: `npm test failed (${key})`, evidence: [], impact: '', risk: 'Low',
  change: { kind: 'agent-rule', floorId: e.id, agentId, rule: 'Read the error before running npm test again.' }, verify: '', metric: { name: 'failures/week', before: 6 } });

test('a category earns level 1: enough accepted, a high share, improved follow-ups', () => {
  assert.equal(trust.levelOf('agent-rule'), 0);
  assert.throws(() => trust.setLevel('agent-rule', 1), /Not yet/);
  assert.throws(() => trust.setLevel('capacity', 1), /only for agent-rule and model/);
  const now = Date.now();
  insight.addSuggestions(Array.from({ length: 11 }, (_, i) => ({ ...ruleSug(`old-${i}`), change: null })), now - 30 * 864e5);
  for (const [i, it] of insight.loadInbox().items.entries()) {
    if (i < 10) insight.updateItem(it.id, { status: 'accepted', decidedAt: now - 20 * 864e5, followUp: i < 4 ? { after: 1, improved: i < 3, at: now } : undefined });
    else insight.updateItem(it.id, { status: 'dismissed', decidedAt: now - 20 * 864e5 });
  }
  const st = trust.stats('agent-rule');
  assert.deepEqual([st.accepted, st.declined, st.rate, st.measured, st.improved, st.eligible], [10, 1, 91, 4, 3, true]);
  trust.setLevel('agent-rule', 1);
  assert.equal(trust.levelOf('agent-rule'), 1);
});

test('level 1: a new suggestion runs as a canary, is measured after its week, and the Owner rolls it back', async () => {
  const now = Date.now();
  const [it] = insight.addSuggestions([ruleSug(`tool:${e.id}:${budi.id}|Bash|npm test`)], now);
  const [legalOne] = insight.addSuggestions([ruleSug('tool:canary:legal', lia.id)], now);
  const started = await trust.startCanaries([it, legalOne], inbox.applyChange, now - 1000);
  assert.deepEqual(started, [it.id], 'never on a Legal role');
  const c = insight.loadInbox().items.find((x) => x.id === it.id);
  assert.equal(c.status, 'canary'); assert.ok(c.historyId);
  assert.ok(floors.readFloor(e.path).team.agents.find((a) => a.id === budi.id).overrides.rules.includes('Read the error before running npm test again.'));
  // two failures in the week after (the "before" was 6)
  for (let i = 0; i < 2; i++) squad.logEvent(e.id, { type: 'tool.call', agent: budi.id, data: { tool: 'Bash', target: 'npm test', ok: false } });
  assert.deepEqual(trust.review(now).canaries, [], 'not before its week is over');
  const r = trust.review(now + trust.WEEK);
  assert.deepEqual(r.canaries, [it.id]);
  const done = insight.loadInbox().items.find((x) => x.id === it.id);
  assert.equal(done.status, 'canary-done');
  assert.deepEqual([done.followUp.after, done.followUp.improved], [2, true], '6 failures before, 2 after');
  assert.match(trust.canaryText(done), /Canary finished/);
  const card = squad.buildingSnapshot().attention.find((a) => a.kind === 'canary');
  assert.ok(card && card.ownerOnly);
  trust.decideCanary(it.id, false, { rollback: history.rollback });
  assert.equal(insight.loadInbox().items.find((x) => x.id === it.id).status, 'rolled-back');
  assert.ok(!(floors.readFloor(e.path).team.agents.find((a) => a.id === budi.id).overrides.rules || []).includes('Read the error before running npm test again.'), 'the change history undid it');
  assert.throws(() => trust.decideCanary(it.id, true), /not a running or finished canary/);
});

test('capacity advice: add a machine when memory or CPU is the limit', () => {
  const waits = Array.from({ length: 6 }, () => ({ type: 'dispatch.started', data: { waitedMs: 3 * 3600e3 } }));
  const [s] = insight.analyze({ spaces: [{ id: 'a', name: 'A', agents: [] }], events: { a: waits }, limiting: 'ram', workers: { count: 1, free: 0 } });
  assert.equal(s.category, 'capacity');
  assert.match(s.advice, /add a machine rather than upgrading this one/); assert.match(s.advice, /add another one/);
});

test('a lesson becomes a rule of a Role Template without the client in it', () => {
  learnings.add(e.path, [{ source: 'retro sprint 2', text: 'Budi broke Klinik Sehat Portal staging by running migrations without a backup; mail budi@klinik.id first' }]);
  const c = promote.candidates();
  const lesson = c.lessons.find((l) => l.floorId === e.id);
  assert.ok(lesson && c.roles.some((r) => r.role === 'fullstack-developer'));
  const p = promote.preview({ floorId: e.id, text: lesson.text, role: 'fullstack-developer' });
  assert.doesNotMatch(p.rule, /Budi|Klinik Sehat Portal|budi@klinik\.id/);
  assert.match(p.rule, /the agent broke the project staging/);
  assert.ok(p.diff.some((l) => l.op === '+' && l.text.includes('the agent broke the project staging')));
  assert.throws(() => promote.apply({ floorId: e.id, text: lesson.text, role: 'fullstack-developer', rule: 'On Klinik Sehat Portal, back up first' }), /still names the client: Klinik Sehat Portal/);
  const before = roles.getTemplate('fullstack-developer').version;
  const r = promote.apply({ floorId: e.id, text: lesson.text, role: 'fullstack-developer', rule: 'Back up the database before running migrations on a shared staging server.' });
  assert.equal(r.version, before + 1);
  assert.ok(roles.getTemplate('fullstack-developer').rules.includes('Back up the database before running migrations on a shared staging server.'));
});
