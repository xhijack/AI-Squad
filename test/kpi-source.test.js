// SPDX-License-Identifier: Apache-2.0
// Changing a target's source in place (1.7): the history stays, the new source is validated like a new target's,
// the switch is recorded with the values and in the Squad Log (kinds, never arguments), the status and the trend count
// from the new source's first value, the tick measures it at once, and the sparkline starts a new line.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { scratch } from './helpers.js';
import { config, configure } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as kpi from '../server/kpi.js';
import * as integ from '../server/integrations.js';
import * as behind from '../server/behind.js';
import * as squadLog from '../server/log.js';
import '../server/squad.js';
import { spark } from '../ui/admin-kpi.js';
import { fakeMcpHttp } from './fixtures/fake-mcp-http.js';

const root = scratch();
configure({ useHooks: false, useSystemd: false });
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const H = fakeMcpHttp({ reply: 'json', posts: 4 });
const url = await H.listen();
after(() => { server.close(); H.close(); });
const call = async (method, u, body, p = pin) => { const r = await fetch(base + u, { method, headers: { 'content-type': 'application/json', ...(p ? { 'x-aisquad-pin': p } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const H1 = 3600e3;
let M, SRC;
const item = () => kpi.list(M.id, M.path).find((k) => k.id === 'posts');

test('setup: a Space with a scheduler integration and a manual target with two values', async () => {
  const dir = path.join(root, 'marketing');
  await floors.createFloor({ name: 'Marketing', directory: { mode: 'new', path: dir }, team: [{ displayName: 'Mira - Lead', template: 'fullstack-developer', lead: true }] });
  M = building.loadBuilding().floors.find((f) => f.path === dir);
  fs.writeFileSync(path.join(M.path, '.mcp.json'), JSON.stringify({ mcpServers: { scheduler: { type: 'http', url } } }));
  assert.equal((await integ.test(`space:${M.id}:scheduler`)).tested.ok, true);
  SRC = { kind: 'mcp', server: `space:${M.id}:scheduler`, tool: 'posts_this_week', args: { from: '{{from}}', to: '{{to}}' }, pick: { type: 'path', path: 'total' } };
  assert.equal((await call('POST', `/api/floors/${M.id}/kpis`, { id: 'posts', name: 'Posts published', unit: 'posts', target: 5, period: 'week', every: 'day', source: { kind: 'manual' } })).status, 200);
  const now = Date.now();
  kpi.record(M.id, M.path, 'posts', 1, { now: now - 3 * H1 });
  kpi.record(M.id, M.path, 'posts', 3, { now: now - 2 * H1 });
  assert.deepEqual([item().latest.value, item().status.state], [3, 'behind']);
});

test('the new source is validated like a new target\'s, and nothing changes when it is refused', async () => {
  let r = await call('PATCH', `/api/floors/${M.id}/kpis/posts`, { source: SRC });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not marked read-only/);
  r = await call('PATCH', `/api/floors/${M.id}/kpis/posts`, { source: { kind: 'erpnext', doctype: 'lead; drop' } });
  assert.match(r.body.error, /a DocType, e\.g\. Lead/);
  r = await call('PATCH', `/api/floors/${M.id}/kpis/posts`, { source: { ...SRC, args: { api_key: 'abcdef1234567890' } } });
  assert.match(r.body.error, /looks like a secret/);
  assert.equal(kpi.readDefs(M.path)[0].source.kind, 'manual');
  assert.equal(squadLog.read(M.id, { type: 'kpi.source.changed' }).length, 0);
  const member = (await call('POST', '/api/users', { name: 'Dewi', role: 'member' })).body;
  assert.equal((await call('PATCH', `/api/floors/${M.id}/kpis/posts`, { source: { kind: 'csv', path: 'docs/a.csv' } }, member.pin)).status, 403, 'the Owner\'s');
});

test('switching to the integration keeps the history, logs the kinds and starts counting from the new source', async () => {
  integ.setMarks(`space:${M.id}:scheduler`, { readOnly: ['posts_this_week'] });
  const r = await call('PATCH', `/api/floors/${M.id}/kpis/posts`, { source: SRC, every: 'hour' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const k = item();
  assert.deepEqual([k.source.kind, k.every, k.target, k.series.length], ['mcp', 'hour', 5, 2], 'the goal and the history stay');
  assert.deepEqual([k.latest, k.status.state], [null, 'unknown'], 'the old source\'s value no longer counts');
  assert.ok(k.switchedAt > k.series[1].ts);
  const vals = JSON.parse(fs.readFileSync(path.join(config.home, 'kpi', `${M.id}.json`), 'utf8'));
  assert.deepEqual(vals.switches.posts.map((x) => [x.from, x.to]), [['manual', 'mcp']]);
  const ev = squadLog.read(M.id, { type: 'kpi.source.changed' });
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].data, { kpi: 'posts', name: 'Posts published', from: 'manual', to: 'mcp', toServer: `space:${M.id}:scheduler`, toTool: 'posts_this_week', by: 'Owner' });
  assert.ok(!JSON.stringify(ev[0]).includes('{{from}}'), 'never the arguments');
  assert.match(fs.readFileSync(path.join(M.path, kpi.FILE), 'utf8'), /\| Posts published \| – \| 5 posts .* \| unknown \| mcp scheduler \|/);
  // a manual value is refused now; the tick measures the new source at once
  assert.throws(() => kpi.record(M.id, M.path, 'posts', 9), /measured from mcp/);
  const t = await kpi.tick();
  assert.deepEqual(t.filter((x) => x.kpi === 'posts').map((x) => x.value), [4]);
  const after1 = item();
  assert.deepEqual([after1.latest.value, after1.status.state, after1.series.length], [4, 'behind', 3]);
  assert.match(behind.trend(after1), /not enough measurements yet/, 'the trend starts with the new source');
});

test('changing the goal alone is no switch; switching back to manual records a second one', async () => {
  assert.equal((await call('PATCH', `/api/floors/${M.id}/kpis/posts`, { target: 6 })).status, 200);
  assert.equal(squadLog.read(M.id, { type: 'kpi.source.changed' }).length, 1);
  assert.equal((await call('PATCH', `/api/floors/${M.id}/kpis/posts`, { source: { kind: 'manual' } })).status, 200);
  const ev = squadLog.read(M.id, { type: 'kpi.source.changed' }).at(-1).data;
  assert.deepEqual([ev.from, ev.to, ev.fromServer, ev.fromTool], ['mcp', 'manual', `space:${M.id}:scheduler`, 'posts_this_week']);
  assert.equal(item().latest, null);
  kpi.record(M.id, M.path, 'posts', 7, { now: Date.now() + 1000 });
  assert.deepEqual([item().latest.value, item().status.state, item().series.length], [7, 'met', 4]);
});

test('the sparkline: the values before the switch faint, a marker, then the new line', () => {
  const s = [{ ts: 1, value: 1 }, { ts: 2, value: 3 }, { ts: 3, value: 2 }, { ts: 4, value: 5 }];
  assert.equal((spark(s).match(/<polyline/g) || []).length, 1, 'no switch: one line');
  const split = spark(s, 3);
  assert.equal((split.match(/<polyline/g) || []).length, 2);
  assert.match(split, /class="old"[^>]*opacity="0.35" points="0,20 30,11"/);
  assert.match(split, /stroke-dasharray/);
  assert.match(spark(s, 9), /class="old"/, 'no value from the new source yet: all faint');
  assert.match(spark(s, 4), /<circle/, 'one value from the new source: a dot');
});
