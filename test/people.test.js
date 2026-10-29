// SPDX-License-Identifier: Apache-2.0
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, config } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as users from '../server/users.js';
import * as access from '../server/access.js';
import * as chat from '../server/chat.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as jobs from '../server/jobs.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';
import * as history from '../server/history.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-stream.cjs');
const LOG = path.join(root, 'fake.log');
process.env.FAKE_CLAUDE_LOG = LOG;
configure({ claudeBin: FAKE, useHooks: false, useSystemd: false });
const ownerPin = loadPin();
const server = http.createServer(createHandler({ pin: ownerPin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const call = async (method, url, body, pin = ownerPin) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(pin ? { 'x-aisquad-pin': pin } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return fn(); };
const calls = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sales = path.join(root, 'projects', 'sales'), legal = path.join(root, 'projects', 'legal');
let salesId = '', legalId = '', sari = '', rudi = '', member = null, viewer = null;

test('people: the Owner adds a member and a viewer; PINs are shown once and stored only as hashes', async () => {
  const m = await call('POST', '/api/users', { name: 'Dewi', role: 'member' });
  assert.equal(m.status, 200); assert.match(m.body.pin, /^\d{8}$/); member = m.body;
  viewer = (await call('POST', '/api/users', { name: 'Vino', role: 'viewer' })).body;
  const stored = fs.readFileSync(path.join(config.home, 'users.json'), 'utf8');
  assert.ok(!stored.includes(member.pin) && !stored.includes(viewer.pin), 'no PIN in the file');
  assert.equal((fs.statSync(path.join(config.home, 'users.json')).mode & 0o777), 0o600);
  assert.deepEqual((await call('GET', '/api/users')).body.users.map((u) => [u.name, u.role]), [['Owner', 'owner'], ['Dewi', 'member'], ['Vino', 'viewer']]);
  assert.equal((await call('POST', '/api/users', { name: 'dewi' })).status, 400, 'names are unique');
  assert.equal((await call('POST', '/api/users', { name: 'Boss', role: 'owner' })).status, 400, 'there is one Owner');
  assert.deepEqual((await call('GET', '/api/me', null, member.pin)).body.user, { id: 'dewi', name: 'Dewi', role: 'member', createdAt: member.user.createdAt });
  assert.equal((await call('GET', '/api/me', null, '00000000')).status, 401);
});

test('roles: viewers read, members work, only the Owner changes settings, people and secrets', async () => {
  await floors.createFloor({ name: 'Sales', directory: { mode: 'new', path: sales }, team: [{ displayName: 'Sari - Sales Manager', template: 'sales-manager', lead: true }, { displayName: 'Rudi - Researcher', template: 'lead-researcher' }] });
  salesId = building.loadBuilding().floors[0].id;
  [sari, rudi] = floors.readFloor(sales).team.agents.map((a) => a.id);
  assert.equal((await call('GET', '/api/building', null, viewer.pin)).status, 200);
  assert.equal((await call('POST', `/api/floors/${salesId}/agents/${rudi}/stop`, {}, viewer.pin)).status, 403, 'a viewer cannot stop agents');
  assert.equal((await call('POST', `/api/floors/${salesId}/agents/${rudi}/stop`, {}, member.pin)).status, 200, 'a member can');
  for (const [m, u, b] of [['PATCH', '/api/building', { maxAgents: 9 }], ['GET', '/api/users'], ['PUT', '/api/auth/key', { key: 'sk-ant-x' }], ['PATCH', `/api/floors/${salesId}`, { kind: 'department' }], ['POST', `/api/floors/${salesId}/agents`, { displayName: 'X - Y', template: 'lead-researcher' }], ['GET', '/api/backups'], ['PATCH', '/api/dispatcher', { reserveP0: 2 }]]) {
    const r = await call(m, u, b, member.pin);
    assert.equal(r.status, 403, `${m} ${u}`); assert.equal(r.body.error, 'Only the Owner can do this');
  }
  assert.equal(access.requiredRole('POST', `/api/floors/x/agents/y/start`), 'member');
  assert.equal(access.requiredRole('POST', `/api/floors/x/agents/y/chat`), 'member');
  assert.equal(access.requiredRole('GET', `/api/floors/x`), 'viewer');
});

test('an Owner-only Space does not exist for anyone else; changes and the Log say who did them', async () => {
  await floors.createFloor({ name: 'Legal', directory: { mode: 'new', path: legal }, team: [{ displayName: 'Lina - Legal Counsel', template: 'lead-researcher' }] });
  legalId = building.loadBuilding().floors.find((f) => f.path === legal).id;
  assert.equal((await call('PATCH', `/api/floors/${legalId}`, { access: 'owner' })).status, 200);
  const asMember = (await call('GET', '/api/building', null, member.pin)).body;
  assert.ok(!asMember.floors.some((f) => f.id === legalId), 'not in the Building');
  assert.ok((await call('GET', '/api/building')).body.floors.some((f) => f.id === legalId), 'the Owner sees it');
  assert.ok(!(await call('GET', '/api/building', null, null)).body.floors.some((f) => f.id === legalId), 'nor without a PIN');
  assert.equal((await call('GET', `/api/floors/${legalId}`, null, member.pin)).status, 404);
  assert.equal((await call('GET', `/api/floors/${legalId}/agents/lina-legal-counsel/chat`, null, member.pin)).status, 404);
  assert.ok(!(await call('GET', '/api/admin', null, member.pin)).body.spaces.some((s) => s.id === legalId));
  assert.ok(!(await call('GET', '/api/history', null, member.pin)).body.changes.some((c) => c.floorId === legalId));
  // a member's work is recorded with their name
  await call('POST', `/api/floors/${salesId}/agents/${rudi}/stop`, {}, member.pin);
  assert.equal(history.list()[0].actor, 'Owner');
  await call('PATCH', '/api/users/dewi', { role: 'member' });
  assert.equal((await call('POST', '/api/users/dewi/pin', {})).status, 200);
  assert.equal((await call('GET', '/api/me', null, member.pin)).status, 401, 'the old PIN stops working');
});

test('chat in a Space: a stopped agent answers through a background job, the thread lives in the Space, the lead learns of it', async () => {
  const fresh = (await call('POST', '/api/users/dewi/pin', {})).body.pin;
  const r = await call('POST', `/api/floors/${salesId}/agents/${rudi}/chat`, { text: 'Who are the three biggest coffee chains in Bandung?' }, fresh);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.delivery, 'job');
  const thread = await until(async () => { const t = (await call('GET', `/api/floors/${salesId}/agents/${rudi}/chat`, null, fresh)).body; return t.messages.length === 2 && !t.awaiting ? t : (jobs.jobsTick().forEach((j) => squad.logJobEnded(j)), null); });
  assert.deepEqual(thread.messages.map((m) => [m.from, m.name]), [['person', 'Dewi'], ['agent', 'Rudi - Researcher']]);
  assert.match(thread.messages[1].text, /^Done: Direct message from Dewi in your chat/, "the fake Claude echoes the start of the prompt");
  const c = calls().at(-1);
  assert.equal(c.cwd, sales); assert.equal(c.args[c.args.indexOf('--agent') + 1], rudi);
  assert.match(c.prompt, /Message:\nWho are the three biggest coffee chains in Bandung\?$/);
  assert.ok(fs.existsSync(path.join(sales, 'docs', 'squad', 'chats', `${rudi}.jsonl`)), 'the thread is in the Space');
  assert.match(fs.readFileSync(path.join(sales, 'docs', 'squad', 'DIRECT.md'), 'utf8'), /Dewi → Rudi - Researcher: Who are the three biggest/);
  const ev = squadLog.read(salesId, { type: 'chat.message' }).at(-1);
  assert.equal(ev.data.from, 'Dewi'); assert.equal(ev.data.by, 'Dewi');
  // the next message continues the chat's own session, with the earlier turns in the prompt
  await call('POST', `/api/floors/${salesId}/agents/${rudi}/chat`, { text: 'And their prices?' });
  await until(() => calls().length >= 2 && calls().at(-1).prompt.includes('And their prices?'));
  const c2 = calls().at(-1);
  assert.ok(c2.args.includes('--resume'), 'the chat\'s session goes on');
  assert.match(c2.prompt, /Earlier in this chat:\n- Dewi: Who are the three/);
});

test('chat in General: a neutral folder with only the agent\'s identity and the Company Brain, the thread outside the Space', async () => {
  const r = await call('POST', `/api/floors/${salesId}/agents/${sari}/chat`, { text: 'Draft a polite follow-up template', context: 'general' });
  assert.equal(r.body.delivery, 'job');
  await until(() => calls().at(-1)?.prompt.includes('polite follow-up'));
  const c = calls().at(-1);
  assert.equal(c.cwd, path.join(config.home, 'general', `${salesId}--${sari}`));
  assert.ok(fs.existsSync(path.join(c.cwd, '.claude', 'agents', `${sari}.md`)), 'its identity');
  assert.ok(!c.args.includes(sales), 'no repository of the Space');
  assert.match(c.prompt, /\(general: no project here/);
  assert.ok(fs.existsSync(path.join(config.home, 'chats', `${salesId}--${sari}.jsonl`)));
  assert.ok(!fs.readFileSync(path.join(sales, 'docs', 'squad', 'DIRECT.md'), 'utf8').includes('polite follow-up'), 'General is not the Space\'s business');
  assert.equal((await call('POST', `/api/floors/${salesId}/agents/${sari}/chat`, { text: ' ' })).status, 400);
  assert.equal((await call('POST', `/api/floors/${salesId}/agents/${sari}/chat`, { text: 'x', context: 'elsewhere' })).status, 400);
});

test('a chat reply denied tools in the background shows them; the Owner allows a narrow rule and it runs again, or it goes to the Desk', async () => {
  process.env.FAKE_CLAUDE_MODE = 'denied';
  const tick = () => jobs.jobsTick().forEach((j) => squad.logJobEnded(j));
  const url = `/api/floors/${salesId}/agents/${sari}/chat`;
  try {
    await call('POST', url, { text: 'How full is the disk on the ERPNext server?' });
    const reply = await until(async () => { const t = (await call('GET', url)).body; return !t.awaiting && t.messages.at(-1)?.from === 'agent' ? t.messages.at(-1) : (tick(), null); });
    assert.deepEqual(reply.denials, [{ id: 'tu-1', tool: 'Bash', command: 'ssh erpnext@192.168.0.150 df -h', rule: 'Bash(ssh erpnext@192.168.0.150 *)' }]);
    const ev = squadLog.read(salesId, { type: 'permission.denied' }).at(-1);
    assert.deepEqual([ev.agent, ev.data.tool, ev.data.command], [sari, 'Bash', 'ssh erpnext@192.168.0.150 df']);
    // only the Owner widens permissions; narrow rules only
    const fresh = (await call('POST', '/api/users/dewi/pin', {})).body.pin;
    assert.equal((await call('POST', `${url}/allow`, { msgId: reply.id }, fresh)).status, 403);
    assert.match((await call('POST', `${url}/allow`, { msgId: reply.id, rules: ['Bash(git push *)'] })).body.error, /never allowed/);
    const n = calls().length;
    const r = await call('POST', `${url}/allow`, { msgId: reply.id });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body.added, ['Bash(ssh erpnext@192.168.0.150 *)']);
    assert.ok(JSON.parse(fs.readFileSync(path.join(sales, '.claude', 'settings.json'), 'utf8')).permissions.allow.includes('Bash(ssh erpnext@192.168.0.150 *)'));
    await until(() => calls().length > n);
    assert.match(calls().at(-1).prompt, /Message:\nHow full is the disk on the ERPNext server\?$/, 'the same message again');
    assert.equal(squadLog.read(salesId, { type: 'permission.answered' }).at(-1).data.allowed[0], 'Bash(ssh erpnext@192.168.0.150 *)');
    assert.equal((await call('POST', `${url}/allow`, { msgId: reply.id })).status, 400, 'not while it answers');
    await until(async () => { const t = (await call('GET', url)).body; return !t.awaiting || (tick(), null); });
    assert.equal((await call('POST', `${url}/desk`, { msgId: 'm-none' })).status, 400);
    assert.equal((await call('POST', `${url}/allow`, { msgId: reply.id, context: 'general' })).status, 400, 'rules belong to a Space');
  } finally { delete process.env.FAKE_CLAUDE_MODE; }
});

test('chat helpers: the job prompt keeps the last turns, the lead note is short', () => {
  const msgs = Array.from({ length: 14 }, (_, i) => ({ from: i % 2 ? 'agent' : 'person', name: 'Owner', text: `m${i}` }));
  const p = chat.jobPrompt({ name: 'Owner', text: 'now', context: 'space', messages: [...msgs, { from: 'person', text: 'now' }], spaceName: 'POS' });
  assert.ok(!p.includes('- Owner: m2\n') && p.includes('- You: m13'));
  assert.equal(chat.typedText('Dewi', 'hi'), 'Direct message from Dewi (answer it in your next reply; the answer goes back to the chat): hi');
});

test('a typed chat message whose Desk session stops before answering gets a note in the thread', () => {
  const key = chat.keyOf(salesId, sari, 'space');
  chat.setState(key, { awaiting: { msgId: 'm-x', since: Date.now(), mode: 'typed' } });
  squad.chatTick();
  const t = squad.chatThread(salesId, sari, 'space');
  assert.equal(t.awaiting, null);
  assert.match(t.messages.at(-1).text, /The Desk session stopped before it answered/);
});
