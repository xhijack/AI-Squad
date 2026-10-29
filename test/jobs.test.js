// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, config } from '../server/config.js';
import * as jobs from '../server/jobs.js';
import * as auth from '../server/auth.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-stream.cjs');
const LOG = path.join(root, 'fake.log');
configure({ claudeBin: FAKE, useHooks: false });
process.env.FAKE_CLAUDE_LOG = LOG;
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return fn(); };
const work = path.join(root, 'work'); fs.mkdirSync(work);

test('buildArgs: print mode with structured events, the agent, a budget cap and no prompts in the background', () => {
  const a = jobs.buildArgs({ agentId: 'dev', model: 'sonnet', effort: 'high', budgetUsd: 3, disallowedTools: ['Read(./.env)'], extraArgs: ['--add-dir', '/x'] });
  assert.deepEqual(a.slice(0, 4), ['-p', '--output-format', 'stream-json', '--verbose']);
  for (const [k, v] of [['--agent', 'dev'], ['--model', 'sonnet'], ['--effort', 'high'], ['--max-budget-usd', '3'], ['--permission-mode', 'dontAsk'], ['--disallowedTools', 'Read(./.env)'], ['--add-dir', '/x']]) assert.equal(a[a.indexOf(k) + 1], v, k);
  assert.equal(jobs.buildArgs({ budgetUsd: 999 })[jobs.buildArgs({ budgetUsd: 999 }).indexOf('--max-budget-usd') + 1], String(jobs.MAX_BUDGET_USD), 'budget capped');
  assert.equal(jobs.buildArgs({ permissionMode: 'bypassPermissions' }).includes('bypassPermissions'), false, 'never bypass in the background');
  assert.ok(!jobs.buildArgs({ model: 'inherit' }).includes('--model'));
});

test('parseStream: session, tool calls, text, result and rate limits from the event lines', () => {
  const s = jobs.parseStream([
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-haiku-5-5' }),
    'not json',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }, { type: 'text', text: 'All green.' }] } }),
    JSON.stringify({ type: 'rate_limit_event', rate_limits: { five_hour: { used_percentage: 80 } } }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'All green.', total_cost_usd: 0.12, num_turns: 4, session_id: 's1' }),
  ].join('\n'));
  assert.equal(s.sessionId, 's1'); assert.equal(s.model, 'claude-haiku-5-5');
  assert.deepEqual(s.events, [{ kind: 'tool', detail: 'Bash npm test' }, { kind: 'text', detail: 'All green.' }]);
  assert.equal(s.result.cost, 0.12); assert.equal(s.result.turns, 4);
  assert.equal(s.rateLimits.five_hour.used_percentage, 80);
});

test('parseStream: denied tool calls in "dontAsk" mode, from the tool results and the result event, once each', () => {
  const msg = "Permission to use Bash has been denied because Claude Code is running in don't ask mode. ...";
  const s = jobs.parseStream([
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ssh erpnext@192.168.0.150 uptime', description: 'check' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: msg }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/etc/hosts' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: 'File does not exist.' }] }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', result: 'Izin Bash ditolak', permission_denials: [{ tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'ssh erpnext@192.168.0.150 uptime' } }, { tool_name: 'WebFetch', tool_use_id: 't3', tool_input: { url: 'https://x.test' } }] }),
  ].join('\n'));
  assert.deepEqual(s.denials, [{ id: 't1', tool: 'Bash', command: 'ssh erpnext@192.168.0.150 uptime' }, { id: 't3', tool: 'WebFetch', command: 'https://x.test' }], 'an ordinary error is not a denial');
  assert.deepEqual(jobs.parseStream('{"type":"result","result":"ok"}').denials, []);
});

test('a job runs detached, reads its prompt from stdin and ends with its cost and session', async () => {
  const j = jobs.startJob({ floorId: 'f', agentId: 'a', prompt: '-starts with a dash and is long '.repeat(50), cwd: work, args: jobs.buildArgs({ agentId: 'a' }) });
  assert.equal(j.status, 'running'); assert.ok(j.pid);
  const done = await until(() => { const r = jobs.refreshJob(jobs.readJob(j.id)); return r.ended && r.job; });
  assert.equal(done.status, 'done');
  assert.equal(done.cost, 0.0421); assert.equal(done.turns, 2);
  assert.match(done.sessionId, /^sess-/);
  assert.match(done.result, /^Done: -starts with a dash/);
  const c = calls().at(-1);
  assert.equal(c.cwd, work); assert.ok(c.prompt.startsWith('-starts'));
  const d = jobs.jobDetail(j.id);
  assert.deepEqual(d.events.map((e) => e.kind), ['tool', 'text']);
  assert.equal(jobs.listJobs({ floorId: 'f' })[0].id, j.id);
});

test('a failed run, a budget stop and a stop by the owner end as such', async () => {
  process.env.FAKE_CLAUDE_MODE = 'fail';
  const f = jobs.startJob({ prompt: 'x', cwd: work, args: jobs.buildArgs({}) });
  const fd = await until(() => { const r = jobs.refreshJob(jobs.readJob(f.id)); return r.ended && r.job; });
  assert.equal(fd.status, 'failed'); assert.equal(fd.error, 'Something broke');
  process.env.FAKE_CLAUDE_MODE = 'budget';
  const b = jobs.startJob({ prompt: 'x', cwd: work, args: jobs.buildArgs({ budgetUsd: 0.5 }), budgetUsd: 0.5 });
  const bd = await until(() => { const r = jobs.refreshJob(jobs.readJob(b.id)); return r.ended && r.job; });
  assert.equal(bd.status, 'failed'); assert.match(bd.error, /stopped at its budget of \$0\.5/);
  process.env.FAKE_CLAUDE_MODE = 'slow';
  const s = jobs.startJob({ prompt: 'x', cwd: work, args: jobs.buildArgs({}) });
  await until(() => calls().length >= 4);
  const st = jobs.stopJob(s.id);
  assert.equal(st.status, 'stopped');
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => process.kill(s.pid, 0), 'the process group is gone');
  delete process.env.FAKE_CLAUDE_MODE;
  assert.throws(() => jobs.startJob({ prompt: '', cwd: work }), /prompt/);
  assert.throws(() => jobs.startJob({ prompt: 'x', cwd: path.join(root, 'nope') }), /folder/);
});

test('sign-in for background runs: subscription by default, api-key passes a write-only key, no key refuses', () => {
  assert.deepEqual(auth.cleanAuth({}), { mode: 'subscription' });
  assert.deepEqual(auth.backgroundEnv({ mode: 'subscription' }), {});
  assert.throws(() => auth.backgroundEnv({ mode: 'api-key' }), /no key is saved/);
  assert.throws(() => auth.setApiKey('not-a-key'), /Anthropic API key/);
  const st = auth.setApiKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123');
  assert.deepEqual([st.set, st.last4], [true, '0123']);
  assert.equal(fs.statSync(path.join(config.home, 'secrets.json')).mode & 0o777, 0o600);
  assert.equal(auth.backgroundEnv({ mode: 'api-key' }).ANTHROPIC_API_KEY, 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123');
  assert.equal(auth.clearApiKey().set, false);
});

test('an agent\'s background job: its agent file, model, denied tools, the API key in api-key mode, the Log', async () => {
  const proj = path.join(root, 'projects', 'shop');
  await floors.createFloor({ name: 'Shop', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Dewi - Developer', template: 'fullstack-developer' }] });
  const floorId = building.loadBuilding().floors[0].id, agentId = floors.readFloor(proj).team.agents[0].id;
  building.setPrefs({ auth: { mode: 'api-key' } });
  assert.throws(() => squad.startAgentJob(floorId, agentId, 'write the README'), /no key is saved/, 'never falls back to a personal login');
  auth.setApiKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123');
  const j = squad.startAgentJob(floorId, agentId, 'write the README', { budgetUsd: 1 });
  const done = await until(() => { const r = jobs.refreshJob(jobs.readJob(j.id)); return r.ended && r.job; });
  assert.equal(done.status, 'done');
  const c = calls().at(-1);
  assert.equal(c.cwd, proj); assert.equal(c.apiKey, true);
  assert.equal(c.args[c.args.indexOf('--agent') + 1], agentId);
  assert.equal(c.args[c.args.indexOf('--max-budget-usd') + 1], '1');
  assert.ok(c.args.includes('--disallowedTools'));
  squad.logJobEnded(done);
  const ev = squadLog.read(floorId, { limit: 100 }).filter((e) => e.type.startsWith('job.'));
  assert.deepEqual(ev.map((e) => e.type), ['job.started', 'job.ended']);
  assert.equal(ev[1].data.cost, 0.0421);
  building.setPrefs({ auth: { mode: 'subscription' } });
  // while it runs, the stopped agent shows as working in the background
  process.env.FAKE_CLAUDE_MODE = 'slow';
  const s = squad.startAgentJob(floorId, agentId, 'long one');
  squad.invalidate();
  const a = squad.buildingSnapshot().floors.find((f) => f.id === floorId).agents[0];
  assert.equal(a.state, 'working'); assert.equal(a.job.id, s.id); assert.match(a.activity, /^background:/);
  assert.equal(squad.buildingSnapshot().limits.jobs, 1);
  jobs.stopJob(s.id);
  delete process.env.FAKE_CLAUDE_MODE;
});
