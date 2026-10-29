// SPDX-License-Identifier: Apache-2.0
// Targets from an integration (1.6): pick (path, count, sum, regex, bad results), the arguments ({{from}}/{{to}}, no
// literal secrets), the read-only gate and the scope rule in plain words, Try, measuring through the hourly tick
// with the server and tool (never the arguments) in the Squad Log, KPI.md, and the when-behind notice.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { config, configure } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as floors from '../server/floors.js';
import * as kpi from '../server/kpi.js';
import * as pick from '../server/pick.js';
import * as integ from '../server/integrations.js';
import * as behind from '../server/behind.js';
import * as squadLog from '../server/log.js';
import * as users from '../server/users.js';
import '../server/squad.js';
import { fakeMcpHttp } from './fixtures/fake-mcp-http.js';

const root = scratch();
configure({ useHooks: false, useSystemd: false });
const STDIO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp-stdio.cjs');
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const H = fakeMcpHttp({ reply: 'sse', posts: 2 });
const url = await H.listen();
after(() => { server.close(); H.close(); });
const call = async (method, u, body, p = pin) => { const r = await fetch(base + u, { method, headers: { 'content-type': 'application/json', ...(p ? { 'x-aisquad-pin': p } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const T = new Date(2026, 9, 28, 10, 0).getTime();                 // Wednesday 28 Oct 2026, 10:00 local

const R = (sc, text) => ({ content: text === undefined ? [] : [{ type: 'text', text }], ...(sc ? { structuredContent: sc } : {}) });

test('pick: a path, a count, a sum, a regular expression; bad results in plain words', () => {
  const r = R({ data: { total: '1,234', items: [{ n: 2, m: { v: 1 } }, { n: 3.5, m: { v: 2 } }] } });
  assert.equal(pick.pickValue(r, pick.cleanPick({ type: 'path', path: 'data.total' })), 1234, 'thousands separators');
  assert.equal(pick.pickValue(r, pick.cleanPick({ type: 'path', path: 'data.items[1].n' })), 3.5);
  assert.equal(pick.pickValue(r, pick.cleanPick({ type: 'path', path: 'data.items.0.m.v' })), 1);
  assert.equal(pick.pickValue(r, pick.cleanPick({ type: 'count', path: 'data.items' })), 2);
  assert.equal(pick.pickValue(r, pick.cleanPick({ type: 'sum', path: 'data.items', field: 'm.v' })), 3);
  assert.equal(pick.pickValue(R(null, '[1,2,3]'), pick.cleanPick({ type: 'count' })), 3, 'the text parsed as JSON; the root as the list');
  assert.equal(pick.pickValue(R(null, 'Published 17 posts this week'), pick.cleanPick({ type: 'regex', pattern: '(\\d+) posts' })), 17);
  assert.throws(() => pick.pickValue({ isError: true, content: [{ type: 'text', text: 'rate limited' }] }, { type: 'count', path: '' }), /answered with an error: rate limited/);
  assert.throws(() => pick.pickValue(r, pick.cleanPick({ type: 'path', path: 'data.nope' })), /value at data.nope is not there, not a number/);
  assert.throws(() => pick.pickValue(R({ a: 'soon' }), pick.cleanPick({ type: 'path', path: 'a' })), /"soon", not a number/);
  assert.throws(() => pick.pickValue(r, pick.cleanPick({ type: 'count', path: 'data.total' })), /is not a list/);
  assert.throws(() => pick.pickValue(R({ x: [{ n: 'a' }] }), pick.cleanPick({ type: 'sum', path: 'x', field: 'n' })), /n of item 1 is "a"/);
  assert.throws(() => pick.pickValue(R(null, 'hello'), pick.cleanPick({ type: 'path', path: 'a' })), /not JSON: read it with a regular expression/);
  assert.throws(() => pick.pickValue(R(null, 'nothing here'), pick.cleanPick({ type: 'regex', pattern: '(\\d+) posts' })), /does not match/);
  assert.throws(() => pick.pickValue(R(null), pick.cleanPick({ type: 'count' })), /neither structured content nor text/);
  assert.throws(() => pick.cleanPick({ type: 'median' }), /path, count, sum, regex/);
  assert.throws(() => pick.cleanPick({ type: 'path' }), /where the number is/);
  assert.throws(() => pick.cleanPick({ type: 'path', path: 'a..b' }), /names joined by dots/);
  assert.throws(() => pick.cleanPick({ type: 'sum', path: 'x' }), /field to add up/);
  assert.throws(() => pick.cleanPick({ type: 'regex', pattern: '\\d+' }), /exactly one capture group/);
  assert.throws(() => pick.cleanPick({ type: 'regex', pattern: '(\\d+) (x)' }), /exactly one capture group/);
  assert.throws(() => pick.cleanPick({ type: 'regex', pattern: '(' }), /Regular expression:/);
});

test('arguments: a JSON object with {{from}}/{{to}} filled at call time; a literal secret is refused (kpi.json is committed)', () => {
  assert.deepEqual(pick.cleanArgs(undefined), {});
  assert.throws(() => pick.cleanArgs([1]), /a JSON object/);
  assert.throws(() => pick.cleanArgs({ api_key: 'abc123456' }), /looks like a secret/);
  assert.throws(() => pick.cleanArgs({ q: 'Bearer abcdefghijklmnop123' }), /looks like a secret/);
  assert.deepEqual(pick.cleanArgs({ token: '{{from}}' }), { token: '{{from}}' }, 'a placeholder is not a secret');
  assert.deepEqual(pick.fillArgs({ range: { from: '{{from}}', to: '{{to}}' }, tags: ['a {{to}}'], n: 3 }, { from: 'F', to: 'T' }), { range: { from: 'F', to: 'T' }, tags: ['a T'], n: 3 });
  assert.deepEqual(kpi.periodRange('week', T), { from: '2026-10-26', to: '2026-11-01' }, 'Monday to Sunday');
  assert.deepEqual(kpi.periodRange('day', T), { from: '2026-10-28', to: '2026-10-28' });
  assert.deepEqual(kpi.periodRange('month', T), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(kpi.periodRange('month', new Date(2026, 1, 10).getTime()), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(kpi.periodRange('total', T), { from: '1970-01-01', to: '2026-10-28' });
  assert.throws(() => kpi.cleanSource({ kind: 'mcp', server: 'postiz', tool: 'x', pick: { type: 'count' } }), /the integration, e.g. user:postiz/);
  assert.throws(() => kpi.cleanSource({ kind: 'mcp', server: 'user:postiz', tool: 'rm -rf', pick: { type: 'count' } }), /the tool to call/);
  assert.deepEqual(kpi.cleanSource({ kind: 'mcp', server: 'user:postiz', tool: 'posts', args: { from: '{{from}}' }, pick: { type: 'count', path: 'posts' } }),
    { kind: 'mcp', server: 'user:postiz', tool: 'posts', args: { from: '{{from}}' }, pick: { type: 'count', path: 'posts' } });
});

let M, B;
const SRC = (o = {}) => ({ kind: 'mcp', server: `space:${M.id}:scheduler`, tool: 'posts_this_week', args: { from: '{{from}}', to: '{{to}}' }, pick: { type: 'path', path: 'total' }, ...o });
test('setup: a Marketing team Space with a scheduler in its .mcp.json, an Owner-only Space, the Owner\'s own stdio server', async () => {
  for (const [name, access] of [['Marketing', 'team'], ['Board', 'owner']]) {
    const dir = path.join(root, name.toLowerCase());
    await floors.createFloor({ name, directory: { mode: 'new', path: dir }, team: [{ displayName: 'Mira - Lead', template: 'fullstack-developer', lead: true }] });
  }
  const fl = (await import('../server/building.js')).loadBuilding().floors;
  M = fl.find((f) => f.id === 'marketing'); B = fl.find((f) => f.id === 'board');
  const fj = path.join(B.path, '.claude', 'aisquad', 'floor.json');
  fs.writeFileSync(fj, JSON.stringify({ ...JSON.parse(fs.readFileSync(fj, 'utf8')), access: 'owner' }));
  fs.writeFileSync(path.join(M.path, '.mcp.json'), JSON.stringify({ mcpServers: { scheduler: { type: 'http', url } } }));
  fs.writeFileSync(path.join(path.dirname(config.claudeHome), '.claude.json'), JSON.stringify({ mcpServers: { stats: { command: process.execPath, args: [STDIO] } } }));
  assert.equal((await integ.test(`space:${M.id}:scheduler`)).tested.ok, true);
  assert.equal((await integ.test('user:stats')).tested.ok, true);
});

test('the read-only gate and the scope rule, in plain words, when a target is saved and when it is measured', async () => {
  const add = (sp, body) => call('POST', `/api/floors/${sp}/kpis`, body);
  let r = await add(M.id, { name: 'Posts this week', unit: 'posts', target: 5, period: 'week', every: 'hour', source: SRC() });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not marked read-only \(Admin → Integrations\)/);
  integ.setMarks(`space:${M.id}:scheduler`, { readOnly: ['posts_this_week'] });
  integ.setMarks('user:stats', { readOnly: ['posts_this_week'] });
  r = await add(M.id, { name: 'Reach', source: { kind: 'mcp', server: 'user:stats', tool: 'posts_this_week', pick: { type: 'count', path: 'posts' } } });
  assert.match(r.body.error, /A team Space never uses the Owner's personal integrations/);
  r = await add(B.id, { name: 'Reach', source: SRC() });
  assert.match(r.body.error, /belongs to another Space's \.mcp\.json/);
  r = await add(B.id, { name: 'Owner posts', target: 3, period: 'week', every: 'hour', source: { kind: 'mcp', server: 'user:stats', tool: 'posts_this_week', args: { from: '{{from}}', to: '{{to}}' }, pick: { type: 'sum', path: 'posts', field: 'likes' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await add(M.id, { name: 'Posts this week', id: 'posts-week', unit: 'posts', target: 5, period: 'week', every: 'hour', source: SRC(), onBehind: { mode: 'notify' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await add(M.id, { name: 'Bad', source: SRC({ args: { password: 'hunter2hunter2' } }) });
  assert.match(r.body.error, /looks like a secret/);
  // the mark taken back after saving: measuring says why
  integ.setMarks('user:stats', { readOnly: [] });
  await assert.rejects(kpi.measure(B.id, B.path, 'owner-posts', { now: Date.now() }), /not marked read-only/);
  const f = squadLog.read(B.id, { type: 'kpi.failed' }).at(-1);
  assert.deepEqual([f.data.source, f.data.server, f.data.tool], ['mcp', 'user:stats', 'posts_this_week']);
  integ.setMarks('user:stats', { readOnly: ['posts_this_week'] });
  assert.equal((await kpi.measure(B.id, B.path, 'owner-posts')).value, 10, 'sum of likes from the stdio server');
});

test('Try: one call, the arguments as sent, the raw result and the picked number; the Owner\'s alone', async () => {
  const r = await call('POST', `/api/floors/${M.id}/kpis/try`, { source: SRC(), period: 'week' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.value, 2);
  assert.match(r.body.args.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.body.raw, /"structuredContent"/);
  const bad = await call('POST', `/api/floors/${M.id}/kpis/try`, { source: SRC({ pick: { type: 'path', path: 'nope' } }) });
  assert.equal(bad.status, 200);
  assert.match(bad.body.error, /not there/);
  const mem = users.addUser({ name: 'Rina', role: 'member' }, pin);
  assert.equal((await call('POST', `/api/floors/${M.id}/kpis/try`, { source: SRC() }, mem.pin)).status, 403);
  assert.equal((await call('POST', `/api/floors/${M.id}/kpis/try`, { source: { kind: 'manual' } })).status, 400);
});

test('the hourly tick measures it with {{from}}/{{to}} of the period; the Squad Log names server and tool, never the arguments; KPI.md; behind raises the notice', async () => {
  H.calls.length = 0;
  const now = Date.now();
  const out = await kpi.tick(now);
  const mine = out.find((x) => x.floorId === M.id && x.kpi === 'posts-week');
  assert.deepEqual([mine.value, mine.state], [2, 'behind']);
  const sent = H.calls.find((c) => c.method === 'tools/call');
  assert.deepEqual(sent.params.arguments, kpi.periodRange('week', now));
  const ev = squadLog.read(M.id, { type: 'kpi.measured' }).at(-1);
  assert.deepEqual([ev.data.source, ev.data.server, ev.data.tool, ev.data.value], ['mcp', `space:${M.id}:scheduler`, 'posts_this_week', 2]);
  assert.equal(ev.data.args, undefined);
  assert.match(ev.summary, /target Posts this week: 2 posts \(behind, goal 5, mcp space:marketing:scheduler posts_this_week\)/);
  assert.match(fs.readFileSync(path.join(M.path, kpi.FILE), 'utf8'), /\| Posts this week \| 2 posts \| 5 posts \(at least, this week\) \| behind \(40 %\) \| mcp scheduler \|/);
  for (let i = 0; i < 100 && behind.stateOf(M.id, 'posts-week')?.status !== 'notice'; i++) await sleep(20);
  const st = behind.stateOf(M.id, 'posts-week');
  assert.equal(st?.status, 'notice', 'the when-behind rule fired');
  assert.match(st.text, /Posts this week this week: 2 of 5 posts, behind/);
  assert.equal(squadLog.read(M.id, { type: 'kpi.behind' }).at(-1).data.kpi, 'posts-week');
  assert.deepEqual(await kpi.tick(now + 60e3), [], 'not again within the hour');
  H.state.posts = 6;
  const again = await kpi.tick(now + 3600e3);
  assert.equal(again.find((x) => x.kpi === 'posts-week').state, 'met');
  H.state.mode = 'error';
  const failed = await kpi.tick(now + 7200e3);
  assert.match(failed.find((x) => x.kpi === 'posts-week').error, /scheduler: The server answered with an error: quota exceeded/);
  assert.match(squadLog.read(M.id, { type: 'kpi.failed' }).at(-1).summary, /not measured from mcp space:marketing:scheduler posts_this_week/);
  assert.match(kpi.list(M.id, M.path).find((k) => k.id === 'posts-week').error.error, /quota exceeded/, 'shown on the target');
});
