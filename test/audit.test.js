import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import * as log from '../server/log.js';
import * as audit from '../server/audit.js';

const root = scratch({ seed: false });
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-print.cjs');
const T0 = Date.parse('2026-10-26T09:00:00Z');
let t = 0;
const at = (min) => T0 + min * 60e3;
const put = (min, type, ev = {}) => log.append('pos', { type, ts: at(min), sprint: 1, id: `f${++t}`, ...ev }, {}, at(min));
const use = (min, agent, module, model, d) => put(min, 'usage.turn', { agent, module, model, data: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...d } });
const tool = (min, agent, tool_, target, ok = true) => put(min, 'tool.call', { agent, data: { tool: tool_, target, ms: 100, ok } });

// a small sprint: two modules, one fails QA once, one ships without a handoff
put(0, 'doc.status', { sprint: null, data: { doc: 'docs/PRD.md', status: 'approved' } });
put(0, 'doc.status', { sprint: null, data: { doc: 'docs/TECH.md', status: 'draft' } });
put(1, 'sprint.planned', { data: { modules: 2, sp: 8, list: [{ module: 'M01', sp: 3, owner: 'budi-dev' }, { module: 'M02', sp: 5, owner: 'sari-dev' }] } });
put(2, 'board.changed', { module: 'M01', data: { task: 'BUILD M01 Cart', owner: 'budi-dev', from: 'TODO', to: 'IN_PROGRESS' } });
put(3, 'board.changed', { module: 'M02', data: { task: 'BUILD M02 Pay', owner: 'sari-dev', from: 'TODO', to: 'IN_PROGRESS' } });
use(4, 'budi-dev', 'M01', 'claude-opus-5-5', { input: 100, output: 5000, cacheRead: 900, cost: 0.3 });
use(5, 'sari-dev', 'M02', 'claude-haiku-5-5', { input: 100, output: 100, cost: 0.1 });
for (const m of [6, 7, 8]) tool(m, 'budi-dev', 'Read', 'src/cart.js');
tool(9, 'budi-dev', 'Bash', 'npm test', false);
tool(10, 'budi-dev', 'Bash', 'npm test', false);
tool(11, 'budi-dev', 'Edit', 'docs/notes.md');
put(12, 'handoff.written', { module: 'M01', data: { module: 'M01', file: 'docs/squad/handoff/M01.md' } });
put(13, 'qa.report', { module: 'M01', agent: 'quinn-qa', data: { module: 'M01', round: 1, status: 'FAIL', failed: ['1 Empty cart'] } });
put(14, 'bug.opened', { module: 'M01', data: { bug: 'M01-B01', severity: 'Major', owner: 'budi-dev' } });
put(15, 'board.changed', { module: 'M01', data: { task: 'BUILD M01 Cart', owner: 'budi-dev', from: 'REVIEW', to: 'IN_PROGRESS', reopened: true } });
put(16, 'gate.failed', { module: 'M01', data: { gate: 'board', subject: 'QA M01 Cart', reason: 'M01-B01 is OPEN' } });
put(17, 'question.asked', { agent: 'rina-pm', data: { channel: 'AskUserQuestion', text: 'Which provider?' } });
put(27, 'question.answered', { agent: 'rina-pm', data: { channel: 'AskUserQuestion', answer: 'Midtrans', waitMs: 600000 } });
put(28, 'permission.answered', { agent: 'sari-dev', data: { tool: 'Bash', waitMs: 120000 } });
put(30, 'agent.idle', { agent: 'sari-dev', data: { openWork: true, ownOpen: 0, teamOpen: 1 } });
put(35, 'agent.busy', { agent: 'sari-dev', data: { idleMs: 300000 } });
put(36, 'qa.report', { module: 'M01', agent: 'quinn-qa', data: { module: 'M01', round: 2, status: 'PASS', failed: [] } });
put(37, 'bug.closed', { module: 'M01', data: { bug: 'M01-B01', status: 'VERIFIED' } });
put(38, 'qa.report', { module: 'M02', agent: 'quinn-qa', data: { module: 'M02', round: 1, status: 'PASS', failed: [] } });
put(40, 'merge.done', { data: { branch: 'sprint-1', into: 'main', trigger: 'sprint' } });
put(41, 'sprint.closed', { data: {} });
const INFO = { floorName: 'POS', workflow: 'squad-sprint', blueprint: 'software-house', blueprintVersion: 1, sprintClose: { sprint: '1', checks: { branch: true, release: false, closingCommit: true, cleanTree: true, qaPass: false } }, team: [{ id: 'budi-dev', role: 'fullstack-developer', model: 'opus', effort: 'medium' }], sourceDocs: ['docs/PRD.md', 'docs/TECH.md', 'docs/DESIGN.md'] };

test('metrics on a fixture log', () => {
  const { events } = audit.rangeEvents('pos', { sprint: 1 });
  const m = audit.metrics(events, INFO);
  const P = m.process, E = m.efficiency;
  assert.deepEqual([P.sourceDocs.total, P.sourceDocs.approved, P.sourceDocs.approvedBeforeFirstSprint], [3, 1, 1]);
  assert.deepEqual([P.modules.total, P.modules.withHandoff, P.modules.missingHandoff, P.modules.done], [2, 1, ['M02'], 2]);
  assert.equal(P.qaFirstRoundPassRate, 0.5);
  assert.deepEqual([P.qaBeforeMerge.merges, P.qaBeforeMerge.mergesWithAllQa], [1, 1]);
  assert.deepEqual([P.bugs.total, P.bugs.weighted, P.bugs.perSP, P.bugs.open], [1, 3, 0.38, 0]);
  assert.equal(P.parallel.maxModulesInProgress, 2);
  assert.deepEqual([P.questions.asked, P.questions.avgWaitMin], [1, 10]);
  assert.deepEqual([P.gatesRefused.total, P.rework.reopened], [1, 1]);
  assert.deepEqual([E.totals.cost, E.doneSP, E.costPerSP, E.cacheHitRate], [0.4, 8, 0.05, 0.82]);
  assert.deepEqual(E.costByModel, { opus: { cost: 0.3, share: 0.75 }, haiku: { cost: 0.1, share: 0.25 } });
  assert.deepEqual(E.repeatedReads, [{ agent: 'budi-dev', target: 'src/cart.js', count: 3 }]);
  assert.deepEqual([E.failedTools.total, E.failedTools.retries], [2, 1]);
  assert.equal(E.longOutputs, 1);
  assert.deepEqual([E.idleWithOpenWorkMin, E.blockedOnOwnerMin], [5, 12]);
  assert.deepEqual(E.expensiveModelOnSimpleWork.map((x) => x.agent), ['budi-dev']);
  assert.deepEqual(E.byModule.map((x) => [x.module, x.cost, x.costPerSP]), [['M01', 0.3, 0.1], ['M02', 0.1, 0.02]]);
});

test('the digest is compact and gives every listed event a ref', () => {
  const { events } = audit.rangeEvents('pos', { sprint: 1 });
  const d = audit.digest(events, audit.metrics(events, INFO), { ...INFO, floorId: 'pos', label: 'sprint 1' });
  assert.ok(d.text.length < 8000, `${d.text.length} chars`);
  assert.match(d.text, /process\.sprintClose \| sprint 1: branch yes, release NO, closingCommit yes, cleanTree yes, qaPass NO/);
  for (const k of ['process.qaFirstRoundPassRate', 'efficiency.cacheHitRate', 'efficiency.repeatedReads', '| budi-dev | fullstack-developer | opus | medium |', 'Blueprint id `software-house` (version 1)']) assert.ok(d.text.includes(k), k);
  const refs = Object.keys(d.refs);
  assert.ok(refs.length >= 8);
  for (const r of refs) assert.match(d.text, new RegExp(`^${r} `, 'm'));
  const failedRef = Object.entries(d.refs).find(([, id]) => events.find((e) => e.id === id)?.type === 'gate.failed');
  assert.ok(failedRef, 'the refused gate is in the digest');
  assert.ok(!d.text.includes('tool.call [budi-dev]: budi-dev Read'), 'ordinary tool calls are left out');
});

test('parseReview keeps findings with evidence and clean targets', () => {
  const ch = (o) => ({ summary: 's', addRules: [], removeRules: [], appendPrompt: '', model: '', effort: '', setting: '', value: '', ...o });
  const raw = `Here you go: ${JSON.stringify({ summary: 'ok', findings: [
    { area: 'efficiency', severity: 'LOW', title: 'a', evidence: ['E1'], recommendation: 'Do x.', target: { kind: 'role-template', id: 'Fullstack Developer', proposedChange: ch({ addRules: ['Rule one'], model: 'gpt' }) } },
    { area: 'process', severity: 'critical', title: 'b', evidence: ['metric:process.sourceDocs'], recommendation: 'Approve docs first.', target: { kind: 'blueprint', id: 'software-house', proposedChange: ch({}) } },
    { area: 'process', severity: 'low', title: 'e', evidence: ['E5'], recommendation: 'Lessons.', target: { kind: 'blueprint', id: 'software-house v1', proposedChange: ch({ addRules: ['Keep the tree clean.'] }) } },
    { area: 'quality', severity: 'high', title: 'no evidence', evidence: [], recommendation: 'x', target: { kind: 'none', id: '', proposedChange: ch({}) } },
    { area: 'vibes', severity: 'high', title: 'bad area', evidence: ['E2'], recommendation: 'x' },
    { area: 'efficiency', severity: 'medium', title: 'c', evidence: ['E3'], recommendation: 'Cheaper audits.', target: { kind: 'floor-setting', id: 'pos', proposedChange: ch({ setting: 'audit.model', value: 'haiku' }) } },
    { area: 'efficiency', severity: 'medium', title: 'd', evidence: ['E4'], recommendation: 'Bad setting.', target: { kind: 'floor-setting', id: 'pos', proposedChange: ch({ setting: 'git.pushPolicy', value: 'always' }) } },
  ] })} thanks`;
  const r = audit.parseReview(raw);
  assert.deepEqual(r.findings.map((f) => [f.id, f.severity, f.title, f.target?.kind || null]), [['F1', 'critical', 'b', null], ['F2', 'medium', 'c', 'floor-setting'], ['F3', 'medium', 'd', null], ['F4', 'low', 'a', 'role-template'], ['F5', 'low', 'e', 'blueprint']]);
  assert.equal(r.findings[4].target.id, 'software-house', 'a version in the id is dropped');
  assert.deepEqual([r.findings[3].target.id, r.findings[3].target.proposedChange.model, r.findings[3].target.proposedChange.addRules], ['fullstack-developer', '', ['Rule one']]);
  assert.throws(() => audit.parseReview('no json here'), /not JSON/);
  assert.throws(() => audit.parseReview({ summary: 'x' }), /no findings/);
  assert.deepEqual(audit.scores(r.findings), { process: 67, efficiency: 81, quality: 100, overall: 83 });
});

test('runAudit with claude -p: schema, skill, cost; files and history; errors are kept', async () => {
  const LOG = path.join(root, 'claude-args.log');
  process.env.FAKE_CLAUDE_LOG = LOG;
  process.env.FAKE_CLAUDE_MODE = 'audit';
  configure({ claudeBin: FAKE });
  const a = await audit.runAudit('pos', INFO, { sprint: 1, model: 'haiku', now: at(60) });
  const args = JSON.parse(fs.readFileSync(LOG, 'utf8').trim().split('\n').at(-1));
  assert.deepEqual(args.slice(0, 3), ['-p', '--model', 'haiku']);
  assert.ok(args.includes('--json-schema') && args.includes('--no-session-persistence') && args[args.indexOf('--tools') + 1] === '');
  assert.match(args[args.indexOf('--append-system-prompt') + 1], /# Squad audit/);
  assert.match(args.at(-1), /# Squad audit digest/);
  assert.deepEqual([a.cost, a.model, a.findings.length, a.error], [0.0123, 'claude-haiku-5-5', 2, null]);
  assert.equal(a.findings[0].severity, 'high');
  assert.ok(fs.existsSync(path.join(audit.auditDir('pos'), `${a.id}.md`)));
  assert.match(fs.readFileSync(path.join(audit.auditDir('pos'), `${a.id}.md`), 'utf8'), /## Findings[\s\S]*F2 · medium · efficiency: Repeated reads[\s\S]*add rule: Read a file once/);
  assert.deepEqual(audit.getAudit('pos', a.id).refs, a.refs);
  process.env.FAKE_CLAUDE_MODE = 'garbage';
  const b = await audit.runAudit('pos', INFO, { now: at(90) });
  assert.equal(b.range.label, 'since the last audit');
  assert.equal(b.range.from, a.range.to);
  assert.match(b.error, /no readable answer|failed/);
  assert.deepEqual(audit.historyOf('pos').map((h) => [h.findings, h.trend.passRate, !!h.error]), [[2, 0.5, false], [0, null, true]]);
  delete process.env.FAKE_CLAUDE_MODE;
});

test('Autopilot section: decisions, the owner\'s changes, critical decisions and the waiting saved', () => {
  put(50, 'autopilot.decided', { sprint: 2, agent: 'rina-pm', data: { by: 'server timeout', question: 'Which runner?', option: 'Vitest', critical: false, waitedMs: 180000 } });
  put(51, 'autopilot.decided', { sprint: 2, data: { by: 'lead', question: 'Sort by date?', critical: false } });
  put(52, 'autopilot.decided', { sprint: 2, data: { by: 'lead', question: 'Raise the price to Rp 99.000?', critical: true, reasons: ['money'] } });
  put(53, 'autopilot.changed', { sprint: 2, agent: 'rina-pm', data: { question: 'Which runner?', from: 'Vitest', to: 'Jest' } });
  put(54, 'autopilot.blocked', { sprint: 2, data: { kind: 'question', question: 'Deploy to production?', reasons: ['production'] } });
  put(55, 'question.answered', { sprint: 2, agent: 'rina-pm', data: { channel: 'AskUserQuestion', answer: 'x', waitMs: 600000 } });
  const { events } = audit.rangeEvents('pos', { sprint: 2 });
  const m = audit.metrics(events, INFO);
  assert.deepEqual(m.autopilot, { decided: 3, byServer: 1, byLead: 2, changed: 1, changeRate: 0.33, criticalDecided: 1, blocked: 1, nudges: 0, timeSavedMin: 27 });
  const d = audit.digest(events, m, { ...INFO, floorId: 'pos', label: 'sprint 2' });
  assert.match(d.text, /## Autopilot/); assert.match(d.text, /autopilot\.criticalDecided \| 1 critical items decided without the owner \(must be 0\)/);
  assert.ok(Object.values(d.refs).some((id) => events.find((e) => e.id === id)?.data.critical), 'the critical decision is cited');
  assert.ok(audit.FLOOR_SETTINGS.includes('autopilot'));
});

test('debug loops: three or more failed attempts without an escalation are flagged', () => {
  put(60, 'debug.attempt', { sprint: 3, agent: 'budi-dev', data: { issue: 'login-500', attempt: 1 } });
  put(61, 'debug.attempt', { sprint: 3, agent: 'budi-dev', data: { issue: 'login-500', attempt: 2 } });
  put(62, 'debug.attempt', { sprint: 3, agent: 'budi-dev', data: { issue: 'login-500', attempt: 3 } });
  put(63, 'debug.attempt', { sprint: 3, agent: 'sari-dev', data: { issue: 'cart-total', attempt: 1 } });
  put(64, 'debug.attempt', { sprint: 3, agent: 'sari-dev', data: { issue: 'pay-timeout', attempt: 3 } });
  put(65, 'debug.escalated', { sprint: 3, agent: 'sari-dev', data: { issue: 'pay-timeout', attempts: 3 } });
  const { events } = audit.rangeEvents('pos', { sprint: 3 });
  const m = audit.metrics(events, INFO);
  assert.deepEqual([m.debug.issues, m.debug.attempts, m.debug.escalated], [3, 7, 1]);
  assert.deepEqual(m.debug.loops, [{ issue: 'login-500', agent: 'budi-dev', attempts: 3, escalated: false }]);
  assert.match(audit.digest(events, m, { ...INFO, floorId: 'pos' }).text, /process\.debug \| 3 problems investigated, 7 fix attempts, 1 escalated; LOOPS .*login-500 by budi-dev \(3\)/);
});
