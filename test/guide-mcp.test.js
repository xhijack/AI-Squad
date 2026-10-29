// SPDX-License-Identifier: Apache-2.0
// Blueprints and the Company Guide with integrations (1.6): a target's `requires: mcp:<kind>` hint; the plan names
// the integration that measures it, or what to connect (a team Space never uses the Owner's personal server); Build
// wires the target to the integration, and it is measured; without one the target stays manual and says so.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as building from '../server/building.js';
import * as blueprints from '../server/blueprints.js';
import * as guide from '../server/guide.js';
import * as kpi from '../server/kpi.js';
import * as integ from '../server/integrations.js';
import '../server/squad.js';
import { fakeMcpHttp } from './fixtures/fake-mcp-http.js';

const root = scratch();
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const H = fakeMcpHttp({ posts: 3 });
const url = await H.listen();
after(() => { server.close(); H.close(); });
const call = async (method, u, body) => { const r = await fetch(base + u, { method, headers: { 'content-type': 'application/json', 'x-aisquad-pin': pin }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
building.setPrefs({ squadsDir: path.join(root, 'squads') });
guide.deps.ask = async () => { throw new Error('offline'); };
const answers = {
  language: 'en', business: { type: 'saas', name: 'DTamu', description: 'Digital invitations' }, goals: { picks: ['leads'], leads: 40 }, have: ['website'],
  divisions: ['marketing'], modes: { marketing: 'supervised' }, capacity: { machines: 'this', hours: 'day', budget: 0 },
};
const HINT = { tool: 'post', args: { from: '{{from}}', to: '{{to}}', status: 'published' }, pick: { type: 'count', path: 'posts' } };

test('the Marketing Blueprint hints at the integrations that would measure its targets', () => {
  const bp = blueprints.getBlueprint('digital-marketing');
  const posts = bp.kpis.find((k) => k.id === 'posts');
  assert.equal(posts.requires, 'mcp:social-scheduler');
  assert.deepEqual(posts.mcp, HINT);
  assert.equal(bp.kpis.find((k) => k.id === 'organic-traffic').requires, 'mcp:analytics');
  assert.equal(kpi.cleanKpi(posts).requires, 'mcp:social-scheduler', 'kept on the target');
  assert.equal(kpi.cleanKpi({ name: 'x', requires: 'zapier' }).requires, undefined, 'only mcp:<kind>');
});

test('match: a server of the kind the Space may use, with a read-only tool; else what to connect', async () => {
  const team = { id: '', access: 'team' }, owner = { id: '', access: 'owner' };
  assert.deepEqual(integ.match('social-scheduler', owner, HINT), {}, 'nothing here yet');
  fs.writeFileSync(path.join(path.dirname(config.claudeHome), '.claude.json'), JSON.stringify({ mcpServers: { postiz: { type: 'http', url } } }));
  assert.deepEqual(integ.match('social-scheduler', team, HINT), { personal: 'postiz' }, 'a team Space never uses the Owner\'s personal server');
  assert.deepEqual(integ.match('social-scheduler', owner, HINT), { available: 'postiz' }, 'not tested and nothing read-only yet: the Owner marks its tool');
  await integ.test('user:postiz');
  integ.setMarks('user:postiz', { readOnly: ['posts_this_week'] });
  assert.deepEqual(integ.match('social-scheduler', owner, HINT), { measure: { server: 'user:postiz', name: 'postiz', tool: 'posts_this_week', args: { from: '{{from}}', to: '{{to}}' }, pick: HINT.pick } }, 'arguments the tool does not take are left out');
  assert.deepEqual(integ.match('social-scheduler', owner, { tool: 'campaign', pick: HINT.pick }), { available: 'postiz' }, 'no read-only tool matches the hint');
  assert.deepEqual(integ.match('social-scheduler', owner, null), { available: 'postiz' }, 'no hint how to read it: the Owner picks the tool');
  integ.setMarks('user:postiz', { kind: 'analytics' });
  assert.deepEqual(integ.match('social-scheduler', owner, HINT), {}, 'the Owner\'s kind beats the guess');
  integ.setMarks('user:postiz', { kind: 'social-scheduler' });
});

test('the plan says per target where its number comes from', async () => {
  await call('PUT', '/api/guide', { answers, step: 7 });
  const p = (await call('POST', '/api/guide/plan', {})).body;
  const ks = Object.fromEntries(p.spaces.find((s) => s.division === 'marketing').kpis.map((k) => [k.id, k]));
  assert.deepEqual([ks.posts.requires, ks.posts.personal, ks.posts.measure], ['social-scheduler', 'postiz', undefined], 'Marketing is a team Space');
  assert.deepEqual([ks['organic-traffic'].requires, ks['organic-traffic'].measure], ['analytics', undefined]);
  assert.equal(ks.leads.requires, undefined);
});

test('Build wires the target to the integration in a Space that may use it, and it is measured; the others stay manual', async () => {
  // the Owner's copy of the Blueprint makes Marketing an Owner-only Space
  const f = path.join(blueprints.libraryDir(), 'digital-marketing', 'blueprint.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('space: { kind: department,', 'space: { kind: department, access: owner,'));
  const p = (await call('POST', '/api/guide/plan', {})).body;
  const posts = p.spaces[0].kpis.find((k) => k.id === 'posts');
  assert.equal(posts.measure.server, 'user:postiz');
  const r = (await call('POST', '/api/guide/build', {})).body;
  const mkt = r.built.find((x) => x.division === 'marketing');
  assert.ok(mkt.id, JSON.stringify(r.built));
  const defs = Object.fromEntries(kpi.readDefs(mkt.path).map((k) => [k.id, k]));
  assert.deepEqual(defs.posts.source, { kind: 'mcp', server: 'user:postiz', tool: 'posts_this_week', args: { from: '{{from}}', to: '{{to}}' }, pick: { type: 'count', path: 'posts' } });
  assert.equal(defs.posts.every, 'hour');
  assert.deepEqual([defs['organic-traffic'].source.kind, defs['organic-traffic'].requires], ['manual', 'mcp:analytics'], 'manual, with the hint for Admin → Targets');
  const m = await kpi.measure(mkt.id, mkt.path, 'posts');
  assert.equal(m.value, 3);
  assert.match(fs.readFileSync(path.join(mkt.path, kpi.FILE), 'utf8'), /\| Posts published \| 3 posts \| .* \| mcp postiz \|/);
});
