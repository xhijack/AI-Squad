import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scratch, jsonl } from './helpers.js';
import * as collect from '../server/collect.js';
import * as log from '../server/log.js';

const root = scratch({ seed: false });
const T0 = Date.parse('2026-10-26T09:00:00Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const TEAM = [{ id: 'rina-pm', role: { template: 'project-manager' } }, { id: 'budi-dev', role: { template: 'fullstack-developer' } }];
const asst = (s, id, content, usage = { input_tokens: 10, output_tokens: 5 }) => ({ type: 'assistant', timestamp: iso(s), message: { id, model: 'claude-haiku-5-5', content, usage, stop_reason: null } });
const result = (s, id, text, err = false) => ({ type: 'user', timestamp: iso(s), uuid: `u${s}`, message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: err }] } });

test('transcripts: task, tools with duration and errors, messages, questions with wait time, usage once per reply', () => {
  const file = path.join(root, 'sess-1.jsonl');
  fs.writeFileSync(file, jsonl([
    { type: 'user', timestamp: iso(0), uuid: 'task-1', message: { content: 'Plan sprint 1 for the POS' } },
    asst(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${root}/docs/PRD.md` } }], { input_tokens: 100, output_tokens: 1 }),
    asst(1, 'm1', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test -- DB_PASSWORD=hunter2' } }], { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900 }),
    result(3, 't1', 'file text that must never be logged'),
    result(4, 't2', 'Error: 2 failing', true),
    asst(5, 'm2', [{ type: 'tool_use', id: 't3', name: 'SendMessage', input: { to: 'budi-dev', message: 'Start BUILD M01' } }, { type: 'tool_use', id: 't4', name: 'AskUserQuestion', input: { questions: [{ question: 'Which payment provider?', options: [{ label: 'Midtrans' }, { label: 'Xendit' }] }] } }]),
    result(6, 't3', 'sent'),
    result(65, 't4', 'User answered: Midtrans'),
    { type: 'user', timestamp: iso(66), uuid: 'tm-1', message: { content: 'Another Claude session sent a message: <teammate-message teammate_id="budi-dev">M01 ready</teammate-message>' } },
  ]));
  const events = [];
  const ctx = { agent: 'rina-pm', root, emit: (e) => events.push(e) };
  collect.readTranscript('tx', file, ctx, T0 + 70e3);
  collect.readTranscript('tx', file, ctx, T0 + 120e3);          // usage of the last reply settles
  const by = (t) => events.filter((e) => e.type === t);
  assert.deepEqual(by('task.given').map((e) => e.data.text), ['Plan sprint 1 for the POS'], 'teammate messages are not owner tasks');
  assert.deepEqual(by('tool.call').map((e) => [e.data.tool, e.data.target, e.data.ms, e.data.ok]), [
    ['Read', 'docs/PRD.md', 2000, true], ['Bash', 'npm test -- DB_PASSWORD=[secret]', 3000, false], ['SendMessage', 'budi-dev', 1000, true], ['AskUserQuestion', '', 60000, true]]);
  assert.match(by('tool.call')[1].data.error, /2 failing/);
  assert.ok(!JSON.stringify(events).includes('must never be logged'), 'no file contents');
  assert.deepEqual(by('message.sent')[0].data, { to: 'budi-dev', text: 'Start BUILD M01' });
  assert.deepEqual(by('question.asked')[0].data.options, ['Midtrans', 'Xendit']);
  assert.equal(by('question.answered')[0].data.waitMs, 60000);
  assert.deepEqual(by('usage.turn').map((e) => [e.id, e.data.output, e.data.cacheRead]), [['use:m1', 40, 900], ['use:m2', 5, 0]]);
  assert.equal(by('usage.turn')[0].model, 'claude-haiku-5-5');
  assert.ok(events.every((e) => e.agent === 'rina-pm' && e.session === 'sess-1'));
  // nothing new: nothing logged again; appended lines are read from the saved offset
  const n = events.length;
  collect.readTranscript('tx', file, ctx, T0 + 130e3);
  assert.equal(events.length, n);
  fs.appendFileSync(file, jsonl([{ type: 'user', timestamp: iso(140), uuid: 'task-2', message: { content: 'Thanks' } }]));
  collect.readTranscript('tx', file, ctx, T0 + 150e3);
  assert.equal(events.at(-1).data.text, 'Thanks');
  // a shorter backfill (Floor 1) skips what is older
  const short = [];
  fs.utimesSync(file, new Date(T0 + 140e3), new Date(T0 + 140e3));
  collect.readTranscript('tx-short', file, { ...ctx, backfillMs: 30e3, emit: (e) => short.push(e) }, T0 + 150e3);
  assert.deepEqual(short.map((e) => e.data.text), ['Thanks']);
});

test('a tool call seen by a hook and in the transcript is logged once; permission wait is measured', () => {
  const emit = collect.emitter('dup', { team: TEAM });
  const key = 'dup/budi-dev';
  const t = Date.now();
  for (const e of collect.fromHook(key, { event: 'PreToolUse', payload: { tool_use_id: 'tx9', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } } }, root, t)) emit(e);
  const asked = collect.fromHook(key, { event: 'Notification', payload: { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } }, root, t + 1000);
  assert.deepEqual(asked.map((e) => [e.type, e.data.tool, e.data.target]), [['permission.asked', 'Bash', 'rm -rf build']]);
  asked.forEach(emit);
  const post = collect.fromHook(key, { event: 'PostToolUse', payload: { tool_use_id: 'tx9', tool_name: 'Bash' } }, root, t + 31000);
  assert.deepEqual(post.map((e) => e.type), ['permission.answered', 'tool.call']);
  assert.equal(post[0].data.waitMs, 30000);
  assert.equal(post[1].data.ms, 31000);
  post.forEach(emit);
  const file = path.join(root, 'sess-dup.jsonl');
  fs.writeFileSync(file, jsonl([asst(1, 'mx', [{ type: 'tool_use', id: 'tx9', name: 'Bash', input: { command: 'rm -rf build' } }]), result(40, 'tx9', 'ok')]));
  collect.readTranscript('dup', file, { agent: 'budi-dev', root, emit }, Date.now());
  const calls = log.read('dup', { type: 'tool.call' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, 'fullstack-developer');
});

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@y.z', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@y.z' } });
const w = (rel, text) => { const f = path.join(proj, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const proj = path.join(root, 'proj');

test('docs/squad: board, handoffs, QA rounds, bugs, plan, questions, source documents and gate records', () => {
  w('.claude/squad/config.sh', 'SPRINT="1"\n');
  w('docs/squad/TASKS.md', '| Task | Owner | Blocked by | Status |\n|---|---|---|---|\n| BUILD M01 Login | budi-dev | — | TODO |\n');
  w('docs/squad/QUESTIONS.md', '# Questions\n\n1. Which payment provider?\n');
  w('docs/PRD.md', 'STATUS: DRAFT\n');
  git(proj, 'init', '-q');
  const bp = { sourceDocs: [{ path: 'docs/PRD.md', title: 'PRD', owner: 'project-manager' }] };
  const scan = (s) => collect.scanDocs('docs', proj, { blueprint: bp }, T0 + s * 1000);
  assert.deepEqual(scan(0).map((e) => e.type), ['doc.status'], 'first scan: baseline only');
  w('docs/squad/PLAN.md', '| Module | Stories | SP | Owner |\n|---|---|---|---|\n| M01 Login | S1 | 3 | budi-dev |\n| M02 Cart | S2 | 5 | budi-dev |\n');
  w('docs/squad/TASKS.md', '| Task | Owner | Blocked by | Status |\n|---|---|---|---|\n| BUILD M01 Login | budi-dev | — | IN_PROGRESS |\n');
  w('docs/PRD.md', 'STATUS: APPROVED\n');
  let ev = scan(10);
  assert.deepEqual(ev.map((e) => e.type).sort(), ['board.changed', 'doc.status', 'sprint.planned']);
  assert.deepEqual(ev.find((e) => e.type === 'sprint.planned').data.sp, 8);
  assert.equal(collect.currentModule('docs', 'budi-dev'), 'M01');
  w('docs/squad/handoff/M01.md', '# Handoff');
  w('docs/squad/qa/M01.md', 'STATUS: FAIL\nRound: 1\nTester: quinn-qa\n\n| # | Scenario | Result | Notes |\n|---|---|---|---|\n| 1 | Wrong password shows an error | FAILED | blank page |\n| 2 | Login works | OK | |\n');
  w('docs/squad/bugs/M01-B01.md', 'STATUS: OPEN\nOWNER: budi-dev\nSEVERITY: Major\n');
  w('docs/squad/TASKS.md', '| Task | Owner | Blocked by | Status |\n|---|---|---|---|\n| BUILD M01 Login | budi-dev | — | REVIEW |\n');
  w('docs/squad/QUESTIONS.md', '# Questions\n\n1. Which payment provider?\n   Answer: Midtrans\n2. Tax included?\n');
  ev = scan(70);
  const t = (type) => ev.find((e) => e.type === type);
  assert.deepEqual(t('qa.report').data.failed, ['1 Wrong password shows an error']);
  assert.equal(t('qa.report').agent, 'quinn-qa');
  assert.deepEqual([t('bug.opened').data.severity, t('bug.opened').agent], ['Major', 'budi-dev']);
  assert.equal(t('handoff.written').module, 'M01');
  assert.deepEqual(ev.filter((e) => e.type.startsWith('question')).map((e) => [e.type, e.data.n]), [['question.answered', 1], ['question.asked', 2]]);
  assert.equal(t('question.answered').data.waitMs, 70000);
  // QA round 2 passes, bug verified, the board goes back from REVIEW (rework), gate records
  w('docs/squad/qa/M01.md', 'STATUS: PASS\nRound: 2\nTester: quinn-qa\n');
  w('docs/squad/bugs/M01-B01.md', 'STATUS: VERIFIED\nOWNER: budi-dev\nSEVERITY: Major\n');
  w('docs/squad/TASKS.md', '| Task | Owner | Blocked by | Status |\n|---|---|---|---|\n| BUILD M01 Login | budi-dev | — | IN_PROGRESS |\n');
  fs.appendFileSync(path.join(proj, '.git', 'aisquad-gates.jsonl'), `${JSON.stringify({ ts: iso(80), gate: 'board', subject: 'QA M01 Login', ok: false, reason: 'M01-B01 is still OPEN' })}\n`);
  ev = scan(90);
  assert.deepEqual(ev.map((e) => e.type).sort(), ['board.changed', 'bug.closed', 'gate.failed', 'qa.report']);
  assert.equal(t('board.changed').data.reopened, true);
  assert.equal(t('qa.report').data.round, 2);
  assert.equal(t('gate.failed').data.reason, 'M01-B01 is still OPEN');
  assert.ok(ev.every((e) => e.sprint === 1));
  assert.deepEqual(scan(100), [], 'nothing changed');
  // investigate records: each new attempt, then the escalation
  const DBG = '# Login 500 after refresh\nOwner: budi-dev\nModule: M01\nSTATUS: INVESTIGATING\n\n## Symptom\n500\n';
  w('docs/squad/debug/login-500.md', `${DBG}\n## Attempt 1\nTried: x\n\n## Attempt 2\nTried: y\n`);
  ev = scan(110);
  assert.deepEqual(ev.map((e) => [e.type, e.data.attempt, e.agent, e.module]), [['debug.attempt', 1, 'budi-dev', 'M01'], ['debug.attempt', 2, 'budi-dev', 'M01']]);
  w('docs/squad/debug/login-500.md', `${DBG.replace('INVESTIGATING', 'ESCALATED')}\n## Attempt 1\n\n## Attempt 2\n\n## Attempt 3\n\n## Escalation\nstuck`);
  ev = scan(120);
  assert.deepEqual(ev.map((e) => e.type), ['debug.attempt', 'debug.escalated']);
  assert.equal(ev[1].data.attempts, 3);
  assert.deepEqual(scan(130), []);
});

test('git commits are credited to agents by their commit identity; the closing commit closes the sprint', async () => {
  fs.writeFileSync(path.join(proj, 'a.txt'), '1');
  git(proj, 'add', '-A');
  execFileSync('git', ['-C', proj, 'commit', '-qm', 'feat(cart): M02 cart'], { env: { ...process.env, GIT_AUTHOR_NAME: 'Budi', GIT_AUTHOR_EMAIL: 'budi-dev@agents.aisquad.local', GIT_COMMITTER_NAME: 'Budi', GIT_COMMITTER_EMAIL: 'budi-dev@agents.aisquad.local' } });
  git(proj, 'commit', '-q', '--allow-empty', '-m', 'docs(squad): close sprint 1');
  const ev = await collect.scanCommits('docs', proj, ['budi-dev']);
  assert.deepEqual(ev.map((e) => [e.type, e.agent ?? null, e.module ?? null]), [['commit', 'budi-dev', 'M02'], ['commit', null, null], ['sprint.closed', null, null]]);
  assert.equal(ev[2].sprint, 1);
  assert.deepEqual(await collect.scanCommits('docs', proj, ['budi-dev']), []);
});

test('agent states: idle with open work, back to work, crash vs stop', () => {
  const s = (state, running = true) => [{ id: 'budi-dev', state, running }];
  assert.deepEqual(collect.stateChanges('st', s('working'), {}, 0), []);
  assert.deepEqual(collect.stateChanges('st', s('idle'), { teamOpen: 2, own: { 'budi-dev': 1 } }, 1000).map((e) => [e.type, e.data.openWork, e.data.ownOpen]), [['agent.idle', true, 1]]);
  assert.deepEqual(collect.stateChanges('st', s('working'), {}, 61000).map((e) => [e.type, e.data.idleMs]), [['agent.busy', 60000]]);
  assert.deepEqual(collect.stateChanges('st', s('stopped', false), { stoppedByUs: new Set(['budi-dev']) }, 62000).map((e) => e.type), []);
  collect.stateChanges('st', s('working'), {}, 63000);
  assert.deepEqual(collect.stateChanges('st', s('stopped', false), {}, 64000).map((e) => e.type), ['agent.crashed']);
  collect.stateChanges('st', [{ id: 'budi-dev', state: 'working', running: true, inLead: true }], {}, 65000);
  assert.deepEqual(collect.stateChanges('st', s('stopped', false), {}, 66000).map((e) => [e.type, e.data.via]), [['agent.stopped', 'teammate finished']], 'a teammate that finished did not crash');
});

test('merge results become merge and gate events', () => {
  const ev = collect.fromMerge({ id: 'm1', ts: 1, finishedAt: 2, branch: 'sprint-1', into: 'main', trigger: 'sprint', result: 'refused', reason: 'Quality gate failed (exit 1)', gate: { command: 'npm test', ok: false, code: 1 } });
  assert.deepEqual(ev.map((e) => [e.type, e.data.gate || e.data.result]), [['gate.failed', 'merge'], ['merge.refused', 'refused']]);
  assert.deepEqual(collect.fromMerge({ id: 'm2', ts: 1, branch: 'b', into: 'main', result: 'merged' }).map((e) => e.type), ['merge.done']);
});

test('names in files and messages to main resolve to team agent ids', () => {
  const team = [{ id: 'rina-pm', displayName: 'Rina - Project Manager', lead: true }, { id: 'sari-qa', displayName: 'Sari - QA' }];
  assert.deepEqual(['Sari', 'sari-qa', 'main', 'Rina - Project Manager', 'Quinn', ''].map((n) => collect.resolveAgent(team, n)), ['sari-qa', 'sari-qa', 'rina-pm', 'rina-pm', 'Quinn', '']);
  const e = collect.emitter('names', { team: [...team, { id: 'budi-dev', displayName: 'Budi', role: { template: 'fullstack-developer' } }] })({ type: 'message.sent', agent: 'Budi', data: { to: 'main', text: 'ready' } });
  assert.deepEqual([e.agent, e.role, e.data.to], ['budi-dev', 'fullstack-developer', 'rina-pm']);
});
