// SPDX-License-Identifier: Apache-2.0
// aisquad-google (1.8): the stdio MCP server agents use, without network (the fake Google endpoints on 127.0.0.1).
// tools/list with readOnlyHint on the read tools and indexnow_submit as the one write; the process holds no key (it
// asks the server with the Space's agent token); a Space reads only its own properties, an unknown token nothing; and
// indexnow_submit is denied to automated runs (by the session's rules, by the tool and by the server).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, ROOT } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as g from '../server/google.js';
import * as agentToken from '../server/agenttoken.js';
import * as integ from '../server/integrations.js';
import * as squadLog from '../server/log.js';
import * as squad from '../server/squad.js';
import { TOOLS } from '../bin/google-mcp.js';
import { fakeGoogle } from './fixtures/fake-google.js';

const root = scratch();
configure({ useHooks: false, useSystemd: false });
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'google-mcp.js');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = { type: 'service_account', client_email: 'seo@acme.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const F = fakeGoogle({ publicKey });
const gbase = await F.listen();
g.setBase(gbase);
const srv = http.createServer(createHandler({ pin: loadPin() }));
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const URL_ = `http://127.0.0.1:${srv.address().port}`;
after(() => { F.close(); srv.close(); g.setBase(null); });
let A, B;

// the server as Claude Code starts it from the Space's .mcp.json: the entry's env with the session's variables filled in
function start(env) {
  const child = spawn(process.execPath, [BIN], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const waiting = new Map(); let id = 0;
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise((ok) => { const n = ++id; waiting.set(n, ok); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`); });
  return { child, rpc, stop: () => child.kill() };
}
const fill = (entry, vars) => Object.fromEntries(Object.entries(entry.env).map(([k, v]) => [k, v.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (m, n, d) => vars[n] ?? d ?? '')]));

test('setup: two Spaces with their own properties, the Google MCP added to one through its Blueprint field', async () => {
  for (const name of ['Alpha', 'Beta']) await floors.createFloor({ name, directory: { mode: 'new', path: path.join(root, name.toLowerCase()) }, team: [{ displayName: 'Lead', template: 'fullstack-developer', lead: true }] });
  [A, B] = ['alpha', 'beta'].map((id) => building.loadBuilding().floors.find((f) => f.id === id));
  g.setServiceAccount(KEY);
  g.saveProps(A.path, { gscSite: 'sc-domain:example.com', ga4Property: '312345678', siteUrl: gbase, indexNowKey: F.state.indexnowKey });
  g.saveProps(B.path, { gscSite: 'sc-domain:beta.example', ga4Property: '87654321' });
  g.saveOwnerProps({ gscSite: 'sc-domain:owner.example' });
  assert.equal(g.addToSpace(A.path), true);
  assert.equal(g.addToSpace(A.path), false, 'once');
  const mcp = JSON.parse(fs.readFileSync(path.join(A.path, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers['aisquad-google'], { type: 'stdio', command: 'node', args: ['${AISQUAD_PLUGIN_ROOT}/bin/google-mcp.js'], env: { AISQUAD_URL: '${AISQUAD_URL}', AISQUAD_SPACE_TOKEN: '${AISQUAD_SPACE_TOKEN}', AISQUAD_RUN: '${AISQUAD_RUN:-desk}' } });
  assert.doesNotMatch(JSON.stringify(mcp), /PRIVATE|seo@acme|[0-9a-f]{48}|\/home\//, 'no key, no token, no absolute path in the committed file');
  const st = JSON.parse(fs.readFileSync(path.join(A.path, '.claude', 'settings.json'), 'utf8'));
  assert.ok(g.READ_RULES.every((r) => st.permissions.allow.includes(r)), 'the read tools work in background runs');
  assert.deepEqual(st.permissions.ask, ['mcp__aisquad-google__indexnow_submit'], 'the write asks the owner on the Desk');
  assert.equal(integ.registry().some((e) => e.name === 'aisquad-google'), false, 'built in: not listed among the integrations');
});

test('tools/list: readOnlyHint on every read tool, indexnow_submit the one write', async () => {
  const s = start({});
  const init = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'aisquad-google');
  const { tools } = (await s.rpc('tools/list', {})).result;
  s.stop();
  assert.deepEqual(tools.map((t) => t.name), Object.keys(g.TOOLS));
  for (const t of tools) assert.equal(t.annotations.readOnlyHint, t.name !== 'indexnow_submit', t.name);
  assert.equal(TOOLS.find((t) => t.name === 'gsc_inspect').inputSchema.properties.urls.maxItems, 20);
  assert.deepEqual(Object.fromEntries(TOOLS.map((t) => [t.name, t.call])), g.TOOLS, 'the same calls as the server');
});

test('no key in its process environment: the session gets the plugin folder, the run and the Space token, never the Google key', async () => {
  const sess = squad.googleSession(A.id, A.path, 'desk');
  assert.deepEqual(Object.keys(sess.env).sort(), ['AISQUAD_PLUGIN_ROOT', 'AISQUAD_RUN']);
  assert.deepEqual(Object.keys(sess.secret), ['AISQUAD_SPACE_TOKEN']);
  assert.equal(squad.googleSession(B.id, B.path, 'desk'), null, 'a Space without the Google MCP gets nothing');
  const entry = JSON.parse(fs.readFileSync(path.join(A.path, '.mcp.json'), 'utf8')).mcpServers['aisquad-google'];
  assert.equal(entry.args[0].replace('${AISQUAD_PLUGIN_ROOT}', sess.env.AISQUAD_PLUGIN_ROOT), path.join(ROOT, 'bin', 'google-mcp.js'));
  const s = start(fill(entry, { ...sess.env, ...sess.secret, AISQUAD_URL: URL_ }));
  await s.rpc('initialize', { protocolVersion: '2025-06-18' });
  const environ = fs.readFileSync(`/proc/${s.child.pid}/environ`, 'utf8');
  const r = await s.rpc('tools/call', { name: 'gsc_performance', arguments: {} });
  s.stop();
  assert.doesNotMatch(environ, /PRIVATE KEY|seo@acme|private_key|client_email/);
  assert.deepEqual(environ.split('\0').filter(Boolean).map((x) => x.split('=')[0]).sort(), ['AISQUAD_RUN', 'AISQUAD_SPACE_TOKEN', 'AISQUAD_URL', 'PATH']);
  assert.equal(r.result.isError, undefined, JSON.stringify(r.result));
  assert.equal(r.result.structuredContent.totals.clicks, 120);
});

test('a Space reads only its own properties; an unknown token reads nothing; a team Space never the Owner\'s', async () => {
  const ask = (tok, body) => fetch(`${URL_}/api/google/agent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisquad-space': tok }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  F.calls.length = 0;
  assert.equal((await ask(agentToken.tokenFor(A.id), { call: 'gsc.performance', args: {} })).status, 200);
  assert.match(F.calls.at(-1).path, /sites\/sc-domain:example.com\//);
  const b = await ask(agentToken.tokenFor(B.id), { call: 'gsc.performance', args: { site: 'sc-domain:example.com' } });
  assert.match(b.body.error, /The service account has no access to sc-domain:beta.example/, 'B asks with its own property; an argument cannot pick another');
  assert.equal((await ask('0'.repeat(48), { call: 'gsc.performance' })).status, 401);
  assert.equal((await ask('', { call: 'gsc.performance' })).status, 401);
  g.saveProps(B.path, { ga4Property: '87654321' });
  assert.match((await ask(agentToken.tokenFor(B.id), { call: 'gsc.performance' })).body.error, /This Space has no Search Console site yet/, 'the Owner\'s site is not a team Space\'s');
  assert.equal((await fetch(`${URL_}/api/google/agent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisquad-pin': loadPin() }, body: '{"call":"gsc.performance"}' })).status, 401, 'the PIN is not a Space token');
});

test('indexnow_submit: denied to automated runs (rules, tool and server); on the Desk it submits and is logged', async () => {
  assert.deepEqual(squad.googleSession(A.id, A.path, 'automated').deny, ['mcp__aisquad-google__indexnow_submit']);
  assert.deepEqual(squad.googleSession(A.id, A.path, 'job').deny, ['mcp__aisquad-google__indexnow_submit'], 'a background job cannot ask either');
  assert.deepEqual(squad.googleSession(A.id, A.path, 'desk').deny, []);
  assert.deepEqual(squad.AUTOMATED_VIA, ['cadence', 'kpi', 'autopilot']);
  const entry = JSON.parse(fs.readFileSync(path.join(A.path, '.mcp.json'), 'utf8')).mcpServers['aisquad-google'];
  const urls = [`${gbase}/blog/a`];
  const sess = squad.googleSession(A.id, A.path, 'automated');
  const auto = start(fill(entry, { ...sess.env, ...sess.secret, AISQUAD_URL: URL_ }));
  const r1 = await auto.rpc('tools/call', { name: 'indexnow_submit', arguments: { urls } });
  auto.stop();
  assert.equal(r1.result.isError, true);
  assert.match(r1.result.content[0].text, /not allowed in automated runs/);
  const direct = await fetch(`${URL_}/api/google/agent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisquad-space': agentToken.tokenFor(A.id) }, body: JSON.stringify({ call: 'indexnow.submit', args: { urls }, run: 'automated' }) });
  assert.match((await direct.json()).error, /not allowed in automated runs/, 'the server refuses it too');
  const d = squad.googleSession(A.id, A.path, 'desk');
  const desk = start(fill(entry, { ...d.env, ...d.secret, AISQUAD_URL: URL_ }));
  const r2 = await desk.rpc('tools/call', { name: 'indexnow_submit', arguments: { urls } });
  desk.stop();
  assert.equal(r2.result.structuredContent.submitted, 1, JSON.stringify(r2.result));
  const ev = squadLog.read(A.id, { type: 'google.submitted' }).at(-1);
  assert.deepEqual([ev.data.call, ev.data.urls], ['indexnow.submit', 1]);
});
