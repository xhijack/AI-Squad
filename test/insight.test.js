// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as insight from '../server/insight.js';
import * as inbox from '../server/inbox.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as history from '../server/history.js';
import * as squadLog from '../server/log.js';

const root = scratch();
const T = Date.parse('2026-10-27T03:00:00Z');
let n = 0;
const ev = (type, agent, data, ago = 3600e3) => ({ id: `e${++n}`, ts: new Date(T - ago).toISOString(), type, agent, data });
const space = (id, agents, autopilot = 'off') => ({ id, name: id.toUpperCase(), autopilot, agents });

test('analyze: each pattern needs enough evidence and says what it would change', () => {
  const pos = space('pos', [{ id: 'budi', name: 'Budi - Dev', model: 'claude-opus-5-5', lead: false }, { id: 'rina', name: 'Rina - PM', model: 'claude-opus-5-5', lead: true }]);
  const events = { pos: [
    ...Array.from({ length: 6 }, () => ev('tool.call', 'budi', { tool: 'Bash', target: 'npm run build -- --prod', ok: false, error: 'Cannot find module vite' })),
    ...Array.from({ length: 4 }, () => ev('tool.call', 'rina', { tool: 'Bash', target: 'npm test', ok: false })),
    ...Array.from({ length: 45 }, () => ev('usage.turn', 'budi', { output: 300, cost: 0.2 })),
    ...Array.from({ length: 45 }, () => ev('usage.turn', 'rina', { output: 300, cost: 0.2 })),
    ...Array.from({ length: 11 }, () => ev('agent.idle', 'budi', { openWork: true })),
    ...[40, 50, 70].map((m) => ev('question.answered', 'rina', { waitMs: m * 60e3 })),
    ev('agent.crashed', 'budi', { cause: 'oom' }), ev('agent.crashed', 'rina', { cause: 'oom' }),
    ...[1, 2, 3, 3, 4].map((h) => ev('dispatch.started', 'budi', { waitedMs: h * 3600e3 })),
    ...['Berapa harga paket ERPNext Cloud untuk 10 user?', 'berapa harga paket ERPNext cloud untuk 20 user', 'Berapa harga paket ERPNext Cloud untuk klien baru'].map((t) => ev('chat.message', 'rina', { text: t })),
  ] };
  const out = insight.analyze({ spaces: [pos], events, prefs: { maxAgents: 6 }, limiting: 'building' });
  const by = (c) => out.filter((s) => s.category === c);
  assert.equal(by('agent-rule').length, 1, 'npm test failed only 4 times');
  assert.deepEqual(by('agent-rule')[0].change, { kind: 'agent-rule', floorId: 'pos', agentId: 'budi', rule: 'Bash `npm run build` failed 6 times this week: read the error and fix its cause before running it again; ask the lead if it keeps failing.' });
  assert.match(by('agent-rule')[0].evidence[0].summary, /Cannot find module vite/);
  assert.deepEqual(by('model').map((s) => s.change.agentId), ['budi'], 'never the lead');
  assert.deepEqual(by('autopilot')[0].change, { kind: 'floor', floorId: 'pos', patch: { autopilot: 'balanced' } });
  assert.match(by('notifications')[0].title, /50 minutes \(median of 3\)/); assert.equal(by('notifications')[0].change, null);
  assert.deepEqual(by('capacity').map((s) => s.change), [{ kind: 'prefs', patch: { maxAgents: 5 } }, { kind: 'prefs', patch: { maxAgents: 7 } }]);
  assert.match(by('skill')[0].title, /asked 3 times: "berapa harga paket erpnext cloud untuk/);
  assert.equal(insight.analyze({ spaces: [space('x', [])], events: { x: [] } }).length, 0, 'a quiet week: nothing');
  assert.equal(insight.analyze({ spaces: [pos], events, limiting: 'ram' }).find((s) => s.key === 'queue:wait').change, null, 'RAM-bound: advice, no change');
});

test('the inbox: open suggestions are not repeated; a dismissed one stays quiet for 14 days', () => {
  const s = { key: 'k1', category: 'skill', title: 'x', evidence: [], change: null };
  assert.equal(insight.addSuggestions([s], T).length, 1);
  assert.equal(insight.addSuggestions([s], T + 1).length, 0, 'still open');
  const id = insight.loadInbox().items[0].id;
  insight.decide(id, 'dismissed', { reason: 'not now' }, T + 2);
  assert.equal(insight.addSuggestions([s], T + 10 * 864e5).length, 0);
  assert.equal(insight.addSuggestions([s], T + 15 * 864e5).length, 1);
  assert.throws(() => insight.decide(id, 'accepted'), /already decided/);
});

test('accepting applies the change through the change history; nothing is applied without the Owner', async () => {
  const proj = path.join(root, 'projects', 'pos');
  await floors.createFloor({ name: 'POS', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Budi - Dev', template: 'fullstack-developer' }] });
  const fid = building.loadBuilding().floors[0].id, aid = floors.readFloor(proj).team.agents[0].id;
  for (let i = 0; i < 5; i++) squadLog.append(fid, { type: 'tool.call', agent: aid, data: { tool: 'Bash', target: 'npm run lint', ok: false, error: 'eslint not found' } });
  const r = inbox.run();
  const sug = r.added.find((x) => x.category === 'agent-rule');
  assert.ok(sug, JSON.stringify(r));
  assert.equal(floors.readFloor(proj).team.agents[0].overrides?.rules, undefined, 'level 0: not applied by itself');
  const done = await inbox.accept(sug.id, { name: 'Owner' });
  assert.equal(done.status, 'accepted'); assert.deepEqual(done.result, { applied: true });
  assert.match(floors.readFloor(proj).team.agents[0].overrides.rules[0], /^Bash `npm run lint` failed 5 times/);
  assert.equal(history.list()[0].label, 'Improvement: rule for Budi - Dev');
  assert.equal(inbox.run().added.length, 0, 'decided: not suggested again the same day');
  const adv = insight.addSuggestions([{ key: 'adv', category: 'skill', title: 'advice', change: null }])[0];
  assert.deepEqual((await inbox.accept(adv.id)).result, { applied: false }, 'advice is only marked accepted');
  assert.equal(inbox.tick(new Date(2026, 9, 28, 1, 0).getTime()), null, 'before 02:30 nothing runs');
  assert.ok(inbox.tick(new Date(2026, 9, 28, 2, 45).getTime()), 'the night run');
  assert.equal(inbox.tick(new Date(2026, 9, 28, 3, 0).getTime()), null, 'once a day');
});
