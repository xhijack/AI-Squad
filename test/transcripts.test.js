import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, jsonl } from './helpers.js';
import * as tx from '../server/transcripts.js';
import { config } from '../server/config.js';

const root = scratch({ seed: false });
const proj = path.join(root, 'work', 'acme');
fs.mkdirSync(proj, { recursive: true });
const pdir = tx.projectDir(proj);
fs.mkdirSync(pdir, { recursive: true });
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 };

fs.writeFileSync(path.join(pdir, 'sess-pm.jsonl'), jsonl([
  { type: 'agent-setting', agentSetting: 'rina-pm', sessionId: 'sess-pm' },
  { type: 'user', cwd: proj, timestamp: iso(60000), message: { role: 'user', content: 'Plan the shop' } },
  { type: 'assistant', timestamp: iso(50000), message: { id: 'm1', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: { ...usage, output_tokens: 10 }, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }] } },
  { type: 'assistant', timestamp: iso(49000), message: { id: 'm1', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage, content: [] } },
  { type: 'assistant', timestamp: iso(40000), message: { id: 'm2', model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id: 'ask1', name: 'AskUserQuestion', input: { questions: [{ header: 'DB', question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }] } }] } },
]));
fs.writeFileSync(path.join(pdir, 'sess-owner.jsonl'), jsonl([
  { type: 'user', cwd: proj, timestamp: iso(3600e3), message: { role: 'user', content: 'hi' } },
  { type: 'assistant', timestamp: iso(3599e3), message: { id: 'o1', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'Hello!' }] } },
]));
const sub = path.join(pdir, 'sess-pm', 'subagents');
fs.mkdirSync(sub, { recursive: true });
fs.writeFileSync(path.join(sub, 'agent-abc.jsonl'), jsonl([
  { type: 'assistant', timestamp: iso(5000), message: { id: 's1', model: 'claude-sonnet-5-5', usage, content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: path.join(proj, 'src/app.js'), old_string: 'a', new_string: 'b' } }] } },
  { type: 'assistant', timestamp: iso(4000), message: { id: 's2', model: 'claude-sonnet-5-5', usage, content: [{ type: 'tool_use', id: 'e2', name: 'SendMessage', input: { to: 'rina-pm', message: 'Catalogue page done' } }] } },
]));
fs.writeFileSync(path.join(sub, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'budi-dev', description: 'Build catalogue' }));

test('encodes project paths like Claude Code', () => {
  assert.equal(tx.encodeProjectPath('/home/erpnext/my.app'), '-home-erpnext-my-app');
});

test('maps sessions and subagents to agent ids', () => {
  const t = tx.agentTranscripts(proj);
  assert.ok(t.get('rina-pm').file.endsWith('sess-pm.jsonl'));
  assert.ok(t.get('budi-dev').file.endsWith('agent-abc.jsonl'));
  assert.ok(t.get('').file.endsWith('sess-owner.jsonl'));
});

test('status: activity, open AskUserQuestion, end of turn, events', () => {
  const s = tx.transcriptStatus(path.join(pdir, 'sess-pm.jsonl'), proj, { events: true });
  assert.equal(s.activity, 'asking the owner');
  assert.equal(s.ask.questions[0].question, 'Which database?');
  assert.deepEqual(s.ask.questions[0].options, ['Postgres', 'SQLite']);
  assert.equal(s.lastEndTurn, 0);
  assert.equal(s.events[0].kind, 'task');
  assert.equal(s.events[1].kind, 'test');
  const d = tx.transcriptStatus(path.join(sub, 'agent-abc.jsonl'), proj, { events: true });
  assert.equal(d.events[0].title, 'editing src/app.js');
  assert.deepEqual(d.messages.map((m) => [m.to, m.text]), [['rina-pm', 'Catalogue page done']]);
  const o = tx.transcriptStatus(path.join(pdir, 'sess-owner.jsonl'));
  assert.ok(o.lastEndTurn > 0);
});

test('answered questions are closed', () => {
  const f = path.join(root, 'answered.jsonl');
  fs.writeFileSync(f, jsonl([
    { type: 'assistant', timestamp: iso(2000), message: { content: [{ type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: { questions: [] } }] } },
    { type: 'user', timestamp: iso(1000), message: { content: [{ type: 'tool_result', tool_use_id: 'q', content: 'Postgres' }] } },
  ]));
  assert.equal(tx.transcriptStatus(f).ask, null);
});

test('cost: deduplicates streamed records, splits today and by agent', () => {
  const c = new tx.CostTracker();
  c.scan(proj);
  const s = c.summary();
  // opus m1 + m2: 1000*4 + 2000*20 + 10000*0.2 = 46000 per million -> 0.046 each
  assert.ok(Math.abs(s.byAgentToday['rina-pm'] - 0.092) < 1e-9, String(s.byAgentToday['rina-pm']));
  // sonnet: 1000*2 + 2000*10 + 10000*0.2 = 24000 -> 0.024
  assert.ok(Math.abs(s.byAgentToday['budi-dev'] - 0.048) < 1e-9);
  assert.ok(s.month >= s.today);
  const before = s.today;
  c.scan(proj);                                  // incremental: nothing new, nothing doubled
  assert.equal(c.summary().today, before);
  assert.equal(tx.costOf('claude-opus-5-5', { output_tokens: 1e6, speed: 'fast' }), 40);
});

test('discovers projects with Claude Code activity', () => {
  const other = path.join(config.claudeHome, 'projects', '-tmp-x');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 's.jsonl'), jsonl([{ type: 'user', cwd: '/tmp' }]));
  const list = tx.discoverProjects(0);
  assert.deepEqual(list.map((p) => p.root), [proj]);
  assert.equal(list[0].name, 'acme');
  assert.equal(list[0].sessions, 2);
});

test('a finished turn is closed; a new task opens it again', () => {
  const f = path.join(root, 'turns.jsonl');
  const done = [
    { type: 'user', timestamp: iso(3000), message: { content: 'Say OK' } },
    { type: 'assistant', timestamp: iso(2000), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] } },
    { type: 'system', timestamp: iso(1000), subtype: 'turn_duration' },
  ];
  fs.writeFileSync(f, jsonl(done));
  assert.equal(tx.transcriptStatus(f).turnOpen, false);
  fs.writeFileSync(f, jsonl([...done, { type: 'user', timestamp: iso(500), message: { content: 'Next task' } }]));
  assert.equal(tx.transcriptStatus(f).turnOpen, true);
});

test('reply: the text the agent ended its turn with, cleared when the turn opens again', () => {
  const f = path.join(root, 'reply.jsonl');
  const turn = [
    { type: 'user', timestamp: iso(5000), message: { content: 'Collect the documents' } },
    { type: 'assistant', timestamp: iso(4900), message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Checking the docs.' }, { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'docs/PRD.md' } }] } },
    { type: 'user', timestamp: iso(4800), message: { content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'STATUS: DRAFT' }] } },
    { type: 'assistant', timestamp: iso(4000), message: { stop_reason: null, content: [{ type: 'text', text: 'The PRD is a draft.' }] } },
    { type: 'assistant', timestamp: iso(3900), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Please send the newer PRD?' }] } },
    { type: 'user', isMeta: true, timestamp: iso(3800), message: { content: '<local-command-caveat>' } },
  ];
  fs.writeFileSync(f, jsonl(turn));
  const st = tx.transcriptStatus(f);
  assert.deepEqual(st.reply, { ts: Date.parse(turn[4].timestamp), text: 'The PRD is a draft.\n\nPlease send the newer PRD?' }, 'text after the last tool result only');
  fs.writeFileSync(f, jsonl([...turn, { type: 'user', timestamp: iso(100), message: { content: 'Here it is' } }]));
  assert.equal(tx.transcriptStatus(f).reply, null);
});

test('peek: the code being written, or the last command with its output', () => {
  const f = path.join(root, 'peek.jsonl');
  fs.writeFileSync(f, jsonl([
    { type: 'assistant', timestamp: iso(4000), message: { content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: path.join(proj, 'src/add.js'), content: 'export const add = (a, b) => a + b;\n' } }] } },
  ]));
  assert.deepEqual((({ type, path: p, text }) => ({ type, p, text }))(tx.transcriptStatus(f, proj).peek), { type: 'code', p: 'src/add.js', text: 'export const add = (a, b) => a + b;\n' });
  fs.appendFileSync(f, jsonl([
    { type: 'assistant', timestamp: iso(3000), message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'node --test' } }] } },
    { type: 'user', timestamp: iso(2000), message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: [{ type: 'text', text: '# pass 3\n# fail 0' }] }] } },
    { type: 'assistant', timestamp: iso(1000), message: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'x' } }] } },
  ]));
  const p = tx.transcriptStatus(f, proj).peek;
  assert.deepEqual([p.type, p.command, p.output, p.error], ['terminal', 'node --test', '# pass 3\n# fail 0', false], 'reads do not replace the monitor');
});
