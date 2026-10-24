import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, config, paths } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import { flushPending } from '../server/squad.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.cjs');
const LOG = path.join(root, 'fake.log');
process.env.FAKE_CLAUDE_LOG = LOG;
configure({ claudeBin: FAKE, useSystemd: false });
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => { server.close(); try { execFileSync('tmux', ['-L', config.tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ } });

async function call(method, url, body, withPin = true) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(withPin ? { 'x-aisquad-pin': pin } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const wait = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((ok) => setTimeout(ok, 150)); } return null; };
const proj = path.join(root, 'playground', 'acme');

test('PIN file is private and required for changes', async () => {
  assert.equal(fs.statSync(paths.pin()).mode & 0o777, 0o600);
  assert.equal((await call('POST', '/api/auth', {}, false)).status, 401);
  assert.equal((await call('POST', '/api/auth', {})).status, 200);
  assert.equal((await call('POST', '/api/floors', { name: 'x' }, false)).status, 401);
});

test('serves the UI and refuses path traversal', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.equal((await fetch(base + '/..%2fpackage.json')).status, 404);
});

test('create a Floor through the wizard API and read it back', async () => {
  const r = await call('POST', '/api/floors', { name: 'Acme', goal: 'Coffee shop', directory: { mode: 'new', path: proj },
    team: [{ displayName: 'Rina - PM', template: 'project-manager', lead: true }, { displayName: 'Budi - Dev', template: 'fullstack-developer' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = (await call('GET', '/api/building')).body;
  assert.equal(b.floors.length, 1);
  assert.equal(b.floors[0].name, 'Acme');
  assert.deepEqual(b.floors[0].agents.map((a) => a.state), ['stopped', 'stopped']);
  assert.equal(b.floors[0].lamp, 'stopped');
  const d = (await call('GET', '/api/floors/acme')).body;
  assert.equal(d.team.length, 2);
  assert.match(d.brief, /Coffee shop/);
  assert.equal((await call('GET', '/api/roles')).body.templates.length, 9);
  assert.equal((await call('GET', '/api/floors/nope')).status, 404);
});

test('bad input is a 400 with a message', async () => {
  const r = await call('POST', '/api/floors/acme/agents', { displayName: 'X', template: 'qa-engineer', overrides: { permissions: { allow: ['Bash(*)'] } } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /stricter/);
});

test('start agent with a task: dialog shows in Attention, answering it lets the queued task through', async () => {
  const s = await call('POST', '/api/floors/acme/agents/budi-dev/start', { task: 'Build the catalogue page' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const item = await wait(async () => (await call('GET', '/api/building')).body.attention.find((a) => a.agentId === 'budi-dev'));
  assert.ok(item, 'trust dialog reaches Attention');
  assert.equal(item.kind, 'permission');
  assert.equal(item.answerable, true);
  const b = (await call('GET', '/api/building')).body;
  assert.equal(b.floors[0].agents.find((a) => a.id === 'budi-dev').state, 'waiting');
  assert.equal(b.floors[0].lamp, 'attention');
  await flushPending();
  assert.ok(!fs.existsSync(LOG) || !fs.readFileSync(LOG, 'utf8').includes('TASK'), 'task is never typed into a dialog');

  assert.equal((await call('POST', `/api/attention/${item.id}/answer`, { option: 1 })).status, 200);
  const typed = await wait(async () => { await flushPending(); return fs.existsSync(LOG) && fs.readFileSync(LOG, 'utf8').includes('TASK Build the catalogue page'); });
  assert.ok(typed, 'queued task typed after the dialog closed');

  const desk = (await call('GET', '/api/floors/acme/agents/budi-dev')).body;
  assert.equal(desk.running, true);
  assert.match(desk.screen, /Build the catalogue page/);
  assert.equal(desk.attach, 'tmux attach -t aisquad-acme-budi-dev');
  assert.match(desk.work.text, /catalogue/);
});

test('send a task to a running agent, then stop it', async () => {
  const r = await call('POST', '/api/floors/acme/agents/budi-dev/task', { text: 'Add a price filter' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.queued, false);
  assert.ok(await wait(() => fs.readFileSync(LOG, 'utf8').includes('TASK Add a price filter')));
  assert.equal((await call('POST', '/api/floors/acme/agents/budi-dev/stop', {})).status, 200);
  const b = (await call('GET', '/api/building')).body;
  assert.equal(b.floors[0].agents.find((a) => a.id === 'budi-dev').state, 'stopped');
});

test('attachments are stored outside the repo and referenced in the task', async () => {
  const r = await fetch(`${base}/api/floors/acme/attachments`, { method: 'POST', headers: { 'x-aisquad-pin': pin, 'x-filename': 'brief.md' }, body: '# Brief' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(j.path.startsWith(paths.attachments()));
  const bad = await fetch(`${base}/api/floors/acme/attachments`, { method: 'POST', headers: { 'x-aisquad-pin': pin, 'x-filename': '.env' }, body: 'SECRET=1' });
  assert.equal(bad.status, 400);
});

test('edit floor layout and number, template update flow over HTTP', async () => {
  assert.equal((await call('PATCH', '/api/floors/acme', { layout: 'circle', number: 3, desks: [{ agent: 'rina-pm', x: 1, z: 1, ry: 0 }] })).status, 200);
  const d = (await call('GET', '/api/floors/acme')).body;
  assert.equal(d.number, 3);
  assert.equal(d.floor.layout, 'circle');
  const t = (await call('GET', '/api/roles/project-manager')).body.template;
  assert.equal((await call('PUT', '/api/roles/project-manager', { ...t, prompt: t.prompt + '\nAlways write a weekly report.' })).body.template.version, 2);
  const b = (await call('GET', '/api/building')).body;
  assert.equal(b.floors[0].updates, 1);
  const diff = (await call('GET', '/api/floors/acme/agents/rina-pm/diff')).body;
  assert.ok(diff.diff.some((l) => l.op === '+' && l.text.includes('weekly report')));
  assert.equal((await call('POST', '/api/floors/acme/agents/rina-pm/template', { action: 'update' })).body.agent.role.version, 2);
});

test('diff between two template versions', async () => {
  const r = await call('GET', '/api/roles/project-manager/diff?from=1&to=2');
  assert.equal(r.status, 200);
  assert.ok(r.body.diff.some((l) => l.op === '+' && l.text.includes('weekly report')));
  assert.equal((await call('GET', '/api/roles/project-manager/diff?from=1&to=9')).status, 404);
  assert.ok((await call('GET', '/api/building')).body.options.projectsDir.endsWith('playground'));
});

test('off loopback every API read needs the PIN; on loopback reads stay open', async () => {
  const { isLoopback } = await import('../server/api.js');
  for (const h of ['127.0.0.1', 'localhost', '::1', '127.0.1.1']) assert.equal(isLoopback(h), true, h);
  for (const h of ['0.0.0.0', '::', '192.168.1.5', '']) assert.equal(isLoopback(h), false, h);
  const open = http.createServer(createHandler({ pin, host: '0.0.0.0' }));
  await new Promise((ok) => open.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${open.address().port}`;
  try {
    for (const p of ['/api/building', '/api/floors/acme', '/api/roles', '/api/watchdog', '/api/libraries', '/api/floors/acme/merges']) {
      assert.equal((await fetch(url + p)).status, 401, p);
      assert.equal((await fetch(url + p, { headers: { 'x-aisquad-pin': pin } })).status, 200, p);
    }
    assert.equal((await fetch(url + '/api/building', { headers: { 'x-aisquad-pin': '000000' } })).status, 401, 'wrong PIN');
    assert.equal((await fetch(url + '/')).status, 200, 'the UI shell itself carries no data');
  } finally { open.close(); }
  assert.equal((await fetch(base + '/api/building')).status, 200, 'loopback server unchanged');
});
