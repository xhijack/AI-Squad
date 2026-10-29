// SPDX-License-Identifier: Apache-2.0
// Integrations (1.6): the registry merged from Claude Code's user scope, each Space's .mcp.json and the ERPNext MCP;
// secrets masked; ${VAR} resolved at call time only; Test connection (tools, the Squad Log, sign-in and SSE servers);
// the Owner's read-only marks; the scope rule (Owner-only Spaces, team Spaces); the API is the Owner's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as building from '../server/building.js';
import * as erp from '../server/erpnext.js';
import * as integ from '../server/integrations.js';
import * as users from '../server/users.js';
import * as squadLog from '../server/log.js';
import '../server/squad.js';
import { fakeMcpHttp } from './fixtures/fake-mcp-http.js';

const root = scratch();
const STDIO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp-stdio.cjs');
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const H = fakeMcpHttp({ token: 'tok-1234567890abcdef' });
const url = await H.listen();
const OAUTH = fakeMcpHttp({ token: 'never' });
const oauthUrl = await OAUTH.listen();
after(() => { server.close(); H.close(); OAUTH.close(); });
const call = async (method, u, body, p = pin) => { const r = await fetch(base + u, { method, headers: { 'content-type': 'application/json', ...(p ? { 'x-aisquad-pin': p } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };

function space(name, { access = 'team', erpnext = '', mcp = null } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, '.claude', 'aisquad'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'aisquad', 'floor.json'), JSON.stringify({ name, access, erpnext }));
  if (mcp) fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: mcp }));
  return building.registerFloor(dir, { name });
}
fs.writeFileSync(path.join(path.dirname(config.claudeHome), '.claude.json'), JSON.stringify({
  numStartups: 9, projects: { '/x': { mcpServers: { local: { command: 'x' } } } },
  mcpServers: {
    postiz: { type: 'http', url, headers: { Authorization: 'Bearer tok-1234567890abcdef', 'X-Team': 'marketing' } },
    stats: { command: process.execPath, args: [STDIO, '--api-key', 'abcd1234efgh5678', 'TOKEN=zzzzzzzzzzzz9999'], env: { FAKE_MCP_TOKEN: '${STATS_TOKEN}', FAKE_MCP_MODE: 'ok', DB_PASSWORD: 'hunter2hunter2' } },
    oldsse: { type: 'sse', url: 'http://127.0.0.1:9/sse' },
    signin: { type: 'http', url: oauthUrl },
    'bad name!': { command: 'x' },
  },
}));
const mkt = space('Marketing', { mcp: { helpdesk: { type: 'http', url: `${url}?api_key=sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaa&team=a`, headers: { Authorization: 'Bearer ${HELPDESK_TOKEN}' } } } });
const boss = space('Board', { access: 'owner' });

test('the registry merges the user scope, each Space\'s .mcp.json and the ERPNext MCP; secrets are masked', () => {
  erp.mcpFile();                                                         // AI Squad writes it when a Space gets ERPNext
  const l = integ.list();
  assert.deepEqual(l.servers.map((s) => [s.id, s.transport, s.source]), [
    ['user:postiz', 'http', 'user'], ['user:stats', 'stdio', 'user'], ['user:oldsse', 'sse', 'user'], ['user:signin', 'http', 'user'],
    [`space:${mkt.id}:helpdesk`, 'http', 'space'], ['erpnext', 'http', 'erpnext']], 'project-local servers and bad names are not listed');
  const by = Object.fromEntries(l.servers.map((s) => [s.name, s]));
  assert.equal(by.postiz.headers.Authorization, '••••cdef');
  assert.equal(by.postiz.headers['X-Team'], 'marketing', 'a plain header stays readable');
  assert.deepEqual(by.stats.args, [STDIO, '--api-key', '••••5678', 'TOKEN=••••9999']);
  assert.equal(by.stats.env.FAKE_MCP_TOKEN, '${STATS_TOKEN}', 'a reference is not a secret');
  assert.equal(by.stats.env.DB_PASSWORD, '••••ter2');
  assert.equal(by.helpdesk.headers.Authorization, 'Bearer ${HELPDESK_TOKEN}');
  assert.match(by.helpdesk.url, /api_key=••••aaaa&team=a$/);
  assert.equal(by.erpnext.headers.Authorization, 'token ${AISQUAD_ERP_KEY}:${AISQUAD_ERP_SECRET}');
  const json = JSON.stringify(l);
  for (const s of ['tok-1234567890abcdef', 'abcd1234efgh5678', 'hunter2hunter2', 'sk-proj-aaaa']) assert.ok(!json.includes(s), `${s} never leaves`);
  assert.equal(by.postiz.kind, 'social-scheduler', 'a kind guessed from the name');
  assert.equal(by.helpdesk.kind, 'helpdesk');
  assert.match(by.oldsse.blocked, /old SSE transport/);
  assert.equal(by.postiz.blocked, '');
});

test('the scope rule: the Owner\'s servers only for Owner-only Spaces, a Space\'s .mcp.json only for that Space, ERPNext with a key', async () => {
  const sp = Object.fromEntries(integ.spaces().map((s) => [s.id, s]));
  const by = Object.fromEntries(integ.registry().map((e) => [e.name, e]));
  assert.equal(integ.usableBy(by.postiz, sp[boss.id]), true);
  assert.equal(integ.usableBy(by.postiz, sp[mkt.id]), false, 'a team Space never uses the Owner\'s personal servers');
  assert.equal(integ.usableBy(by.helpdesk, sp[mkt.id]), true);
  assert.equal(integ.usableBy(by.helpdesk, sp[boss.id]), false, 'not another Space\'s .mcp.json');
  assert.equal(integ.usableBy(by.erpnext, sp[mkt.id]), false, 'no ERPNext site yet');
  erp.saveSettings({ url: 'http://127.0.0.1:9' });
  await erp.setKey('sales', 'ksales1', 'ssales1', { check: false });
  assert.equal(integ.usableBy(by.erpnext, sp[mkt.id]), true, 'a team Space with the sales key');
  assert.equal(integ.usableBy(by.erpnext, sp[boss.id]), true, 'an Owner-only Space (it falls back like the ERPNext targets)');
  assert.deepEqual(integ.view(by.postiz).usableBy, [boss.id]);
  assert.throws(() => integ.checkUse(sp[mkt.id], { server: 'user:postiz', tool: 'posts_this_week' }), /never uses the Owner's personal integrations/);
  assert.throws(() => integ.checkUse(sp[boss.id], { server: `space:${mkt.id}:helpdesk`, tool: 'x' }), /another Space's \.mcp\.json/);
  assert.throws(() => integ.checkUse(sp[boss.id], { server: 'user:nope', tool: 'x' }), /not known on this machine/);
  assert.throws(() => integ.checkUse(sp[boss.id], { server: 'user:oldsse', tool: 'x' }), /old SSE transport/);
  assert.throws(() => integ.checkUse(sp[boss.id], { server: 'user:postiz', tool: 'posts_this_week' }), /not marked read-only/, 'no tool is read-only by default');
});

test('${VAR} is resolved at call time only, from the environment; a stdio server gets a minimal environment', () => {
  const by = Object.fromEntries(integ.registry().map((e) => [e.name, e]));
  assert.throws(() => integ.resolve(by.stats, {}, { PATH: '/bin' }), /stats needs \$\{STATS_TOKEN\}, which is not set/);
  const d = integ.resolve(by.stats, {}, { PATH: '/bin', HOME: '/h', STATS_TOKEN: 's3cret', ANTHROPIC_API_KEY: 'sk-ant-x', OTHER: 'y' });
  assert.deepEqual(d.env, { PATH: '/bin', HOME: '/h', FAKE_MCP_TOKEN: 's3cret', FAKE_MCP_MODE: 'ok', DB_PASSWORD: 'hunter2hunter2' }, 'none of the server\'s own secrets');
  assert.equal(integ.expand('${A:-dflt}/${B}', { B: 'b' }, 'x'), 'dflt/b');
  assert.equal(integ.resolve(by.helpdesk, {}, { HELPDESK_TOKEN: 'h1' }).headers.Authorization, 'Bearer h1');
  assert.equal(by.stats.cwd, undefined, 'a user-scope server starts where the server runs');
});

test('a Space\'s stdio server starts in the Space\'s folder, so a relative command works', async () => {
  const dir = path.join(root, 'Ops');
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(STDIO, path.join(dir, 'tools', 'mcp.cjs'));
  const ops = space('Ops', { mcp: { local: { command: process.execPath, args: ['tools/mcp.cjs'] } } });
  const e = integ.find(`space:${ops.id}:local`);
  assert.equal(e.cwd, dir);
  assert.equal((await integ.test(e.id)).tested.ok, true);
});

test('Test connection: the tools with their schemas, the Squad Log; sign-in and SSE servers say why; failures masked', async () => {
  process.env.STATS_TOKEN = 's3cret';
  const v = await integ.test('user:stats');
  assert.equal(v.tested.ok, true);
  assert.deepEqual(v.tested.tools.map((t) => [t.name, t.readOnlyHint]), [['posts_this_week', true], ['delete_post', false]]);
  assert.deepEqual(Object.keys(v.tested.tools[0].inputSchema.properties), ['from', 'to', 'status']);
  assert.deepEqual([v.readOnly, v.marked], [[], false], 'readOnlyHint pre-ticks in the UI; nothing is marked until the Owner saves');
  const ev = squadLog.read(boss.id, { type: 'integration.tested' }).at(-1);
  assert.deepEqual([ev.data.server, ev.data.ok, ev.data.tools, ev.data.transport], ['user:stats', true, 2, 'stdio']);
  assert.match(ev.summary, /integration stats \(stdio\) tested: 2 tools/);
  assert.equal(squadLog.read(mkt.id, { type: 'integration.tested' }).length, 0, 'logged where it can be used');
  const s = await integ.test('user:signin');
  assert.equal(s.tested.ok, false);
  assert.match(s.blocked, /Needs sign-in in Claude Code/);
  const sse = await integ.test('user:oldsse');
  assert.match(sse.tested.error, /old SSE transport/);
  const hd = await integ.test(`space:${mkt.id}:helpdesk`);
  assert.match(hd.tested.error, /needs \$\{HELPDESK_TOKEN\}/);
  assert.match(squadLog.read(mkt.id, { type: 'integration.tested' }).at(-1).summary, /helpdesk \(http\) tested: failed/);
  process.env.HELPDESK_TOKEN = 'wrong';
  const hd2 = await integ.test(`space:${mkt.id}:helpdesk`);
  assert.match(hd2.tested.error, /refused the credentials/);
  assert.ok(!JSON.stringify(squadLog.read(mkt.id, {})).includes('wrong'), 'the resolved value is never logged');
  const p = await integ.test('user:postiz');
  assert.equal(p.tested.tools.length, 2);
});

test('read-only marks: only tested tools, kept across tests while the tool exists; the kind', () => {
  assert.throws(() => integ.setMarks('user:stats', { readOnly: ['drop_table'] }), /Test the connection first/);
  assert.throws(() => integ.setMarks('user:stats', { kind: 'weather' }), /Kind/);
  const v = integ.setMarks('user:stats', { kind: 'analytics', readOnly: ['posts_this_week'] });
  assert.deepEqual([v.kind, v.kindSet, v.readOnly, v.marked], ['analytics', true, ['posts_this_week'], true]);
  const sp = integ.spaces().find((s) => s.id === boss.id);
  assert.equal(integ.checkUse(sp, { server: 'user:stats', tool: 'posts_this_week' }).id, 'user:stats');
  assert.throws(() => integ.checkUse(sp, { server: 'user:stats', tool: 'delete_post' }), /not marked read-only/);
  assert.equal(fs.statSync(path.join(config.home, 'integrations.json')).mode & 0o777, 0o600);
  assert.throws(() => integ.setMarks('user:gone', {}), /not found/);
});

test('the API is the Owner\'s alone, with the PIN', async () => {
  assert.equal((await call('GET', '/api/integrations', null, '')).status, 401);
  const m = users.addUser({ name: 'Rina', role: 'member' }, pin);
  assert.equal((await call('GET', '/api/integrations', null, m.pin)).status, 403);
  assert.equal((await call('POST', '/api/integrations/test', { id: 'user:stats' }, m.pin)).status, 403);
  const l = await call('GET', '/api/integrations');
  assert.equal(l.status, 200);
  assert.ok(l.body.servers.some((s) => s.id === 'user:stats'));
  const t = await call('POST', '/api/integrations/test', { id: 'user:stats' });
  assert.equal(t.body.tested.ok, true);
  assert.deepEqual(t.body.readOnly, ['posts_this_week'], 'the marks survive a new test');
  const mk = await call('PATCH', '/api/integrations/marks', { id: 'user:stats', readOnly: [] });
  assert.deepEqual(mk.body.readOnly, []);
});
