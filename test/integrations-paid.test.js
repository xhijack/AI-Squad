// SPDX-License-Identifier: Apache-2.0
// Paid integrations, future-proofing (1.8), without network (a fake MCP server on 127.0.0.1). The `seo` kind is
// guessed from names such as dataforseo, seo or serp; a tool the Owner marks "costs money" is denied to every
// background run (cadence, autopilot's jobs, a target's work), asked for on the Desk through a rule given at start,
// can never feed a target (saving, measuring, the guide's match), and loses its mark when the tool disappears.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as integ from '../server/integrations.js';
import * as kpi from '../server/kpi.js';
import * as squad from '../server/squad.js';
import { fakeMcpHttp } from './fixtures/fake-mcp-http.js';

const root = scratch();
configure({ useHooks: false, useSystemd: false });
const H = fakeMcpHttp({ reply: 'json' });
const url = await H.listen();
after(() => H.close());
let S, O;

test('the seo kind is guessed from the name; Blueprints may require it', () => {
  for (const n of ['dataforseo', 'DataForSEO-mcp', 'openseo', 'serpapi', 'my-serp', 'seo-tools', 'semrush']) assert.equal(integ.guessKind(n), 'seo', n);
  assert.equal(integ.guessKind('google-search-console'), 'analytics');
  assert.equal(integ.guessKind('postiz'), 'social-scheduler');
  assert.ok(integ.KINDS.includes('seo'));
  assert.ok(kpi.REQUIRES.test('mcp:seo'));
});

test('setup: a team Space with a paid SEO server in its .mcp.json, an Owner-only Space', async () => {
  for (const [name, access] of [['Search', 'team'], ['Board', 'owner']]) {
    const dir = path.join(root, name.toLowerCase());
    await floors.createFloor({ name, directory: { mode: 'new', path: dir }, team: [{ displayName: 'Lead', template: 'fullstack-developer', lead: true }] });
    if (access === 'owner') { const fj = path.join(dir, '.claude', 'aisquad', 'floor.json'); fs.writeFileSync(fj, JSON.stringify({ ...JSON.parse(fs.readFileSync(fj, 'utf8')), access: 'owner' })); }
  }
  [S, O] = ['search', 'board'].map((id) => building.loadBuilding().floors.find((f) => f.id === id));
  fs.writeFileSync(path.join(S.path, '.mcp.json'), JSON.stringify({ mcpServers: { dataforseo: { type: 'http', url } } }));
  const v = await integ.test(`space:${S.id}:dataforseo`);
  assert.deepEqual([v.tested.ok, v.kind, v.kindSet], [true, 'seo', false]);
});

test('costs money: marked by the Owner after a test; denied to background runs and asked on the Desk', async () => {
  const id = `space:${S.id}:dataforseo`;
  assert.throws(() => integ.setMarks(id, { paid: ['serp_live'] }), /Test the connection first: serp_live is not among its tools/);
  const v = integ.setMarks(id, { readOnly: ['posts_this_week'], paid: ['posts_this_week'] });
  assert.deepEqual([v.readOnly, v.paid], [['posts_this_week'], ['posts_this_week']]);
  assert.deepEqual(squad.paidRules(S.id), ['mcp__dataforseo__posts_this_week'], 'the Space\'s permission rule');
  assert.deepEqual(squad.paidRules(O.id), [], 'another Space cannot reach it, so it has no rule for it');
  fs.writeFileSync(path.join(path.dirname((await import('../server/config.js')).config.claudeHome), '.claude.json'), JSON.stringify({ mcpServers: { serp: { type: 'http', url } } }));
});

test('the Owner\'s own paid server: an Owner-only Space gets its rule, a team Space does not', async () => {
  await integ.test('user:serp');
  integ.setMarks('user:serp', { paid: ['posts_this_week'] });
  assert.deepEqual(squad.paidRules(O.id), ['mcp__serp__posts_this_week']);
  assert.deepEqual(squad.paidRules(S.id), ['mcp__dataforseo__posts_this_week']);
});

test('it never feeds a target: saving, measuring and the guide\'s match refuse it', async () => {
  const src = { kind: 'mcp', server: `space:${S.id}:dataforseo`, tool: 'posts_this_week', args: {}, pick: { type: 'path', path: 'count' } };
  assert.throws(() => kpi.addKpi(S.path, { name: 'SERP count', source: src }), /costs money \(Admin → Integrations\): it never feeds a target/);
  await assert.rejects(integ.call(integ.spaces().find((s) => s.id === S.id), src, {}), /costs money/);
  assert.deepEqual(integ.match('seo', { id: S.id, access: 'team' }, { tool: 'posts', pick: { type: 'count' } }), { available: 'dataforseo' }, 'not offered as a measure');
});

test('a background job is started without it; the Desk session gets the ask rule', async () => {
  const jobs = await import('../server/jobs.js');
  const seen = [];
  const orig = jobs.buildArgs;
  // the arguments a job would be started with (no Claude is started: the headless runner is not reached)
  const args = orig({ agentId: 'lead', disallowedTools: ['X', ...squad.paidRules(S.id)] });
  seen.push(args.join(' '));
  assert.match(seen[0], /--disallowedTools X mcp__dataforseo__posts_this_week/);
  const src = fs.readFileSync(new URL('../server/squad.js', import.meta.url), 'utf8');
  assert.match(src, /\.\.\.\(general \? \[\] : paidRules\(floorId\)\)\], pluginDir:/, 'every job of a Space denies its paid tools');
  assert.match(src, /const deskSettings = withAsk\(sc\.settings, paidRules\(floorId\)\);/, 'the Desk asks first');
});

test('a tool that disappears loses its mark', async () => {
  H.state.mode = 'ok';
  const st = path.join((await import('../server/config.js')).config.home, 'integrations.json');
  const j = JSON.parse(fs.readFileSync(st, 'utf8'));
  j.servers[`space:${S.id}:dataforseo`].paid = ['posts_this_week', 'gone_tool'];
  fs.writeFileSync(st, JSON.stringify(j));
  const v = await integ.test(`space:${S.id}:dataforseo`);
  assert.deepEqual(v.paid, ['posts_this_week']);
});
