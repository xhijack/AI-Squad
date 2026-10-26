import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import { writeJson } from '../server/util.js';
import * as roles from '../server/roles.js';
import * as blueprints from '../server/blueprints.js';
import * as audit from '../server/audit.js';
import * as improve from '../server/improve.js';
import * as log from '../server/log.js';

scratch();
const change = (o) => ({ summary: 'change', addRules: [], removeRules: [], appendPrompt: '', model: '', effort: '', setting: '', value: '', ...o });
const finding = (id, target, extra = {}) => ({ id, area: 'efficiency', severity: 'medium', title: `finding ${id}`, evidence: ['E1'], recommendation: 'Do better.', target, ...extra });
const metricsOf = (costPerSP, passRate) => ({ process: { qaFirstRoundPassRate: passRate }, efficiency: { costPerSP, cacheHitRate: 0.5, totals: { cost: 1 }, doneSP: 8 }, quality: {} });
function saveAudit(id, findings, m = metricsOf(0.1, 0.5)) {
  const a = { v: 1, id, floor: 'pos', createdAt: `${id.slice(0, 10)}T${id.slice(11, 13)}:${id.slice(14, 16)}:00.000Z`, range: { label: 'sprint 1', events: 10, sprint: 1 }, model: 'haiku', cost: 0.01, metrics: m, refs: {}, findings, scores: audit.scores(findings) };
  writeJson(path.join(audit.auditDir('pos'), `${id}.json`), a);
  return a;
}
const FLOOR = { id: 'pos', root: '/x', config: { budget: { usd: 0, period: 'month' }, sprint: { autoNext: false }, audit: { auto: true, model: 'sonnet' }, log: { messages: true, maskPersonalData: true } } };

test('apply a Role Template change: diff first, then a new template version with the old one in .history', () => {
  const before = roles.getTemplate('fullstack-developer');
  const old = before.rules[0];
  saveAudit('2026-10-26T10-00-00Z', [finding('F1', { kind: 'role-template', id: 'fullstack-developer', proposedChange: change({ addRules: ['Read a file once per task; keep notes.'], removeRules: [old], effort: 'low' }) })]);
  const p = improve.proposal(FLOOR, '2026-10-26T10-00-00Z', 'F1');
  assert.equal(p.applicable, true);
  assert.deepEqual([p.fromVersion, p.toVersion], [before.version, before.version + 1]);
  assert.ok(p.diff.some((l) => l.op === '+' && l.text === '- Read a file once per task; keep notes.'));
  assert.ok(p.diff.some((l) => l.op === '-' && l.text === `- ${old}`));
  assert.ok(p.diff.some((l) => l.op === '+' && l.text === 'effort: low'));
  const d = improve.apply(FLOOR, '2026-10-26T10-00-00Z', 'F1');
  const after = roles.getTemplate('fullstack-developer');
  assert.equal(after.version, before.version + 1);
  assert.equal(d.versionCreated, after.version);
  assert.ok(after.rules.includes('Read a file once per task; keep notes.') && !after.rules.includes(old));
  assert.equal(after.effort, 'low');
  assert.ok(roles.templateVersions('fullstack-developer').includes(before.version), 'old version kept in .history');
  assert.throws(() => improve.apply(FLOOR, '2026-10-26T10-00-00Z', 'F1'), /already applied/);
  assert.deepEqual(improve.decisionsFor('pos', '2026-10-26T10-00-00Z').F1, { decision: 'applied', reason: '', version: after.version, ts: d.ts });
  assert.deepEqual(d.metricBefore.costPerSP, 0.1);
});

test('apply a Blueprint change: a "Lessons from audits" section and a new version', () => {
  const v = blueprints.getBlueprint('software-house').version;
  saveAudit('2026-10-26T11-00-00Z', [finding('F1', { kind: 'blueprint', id: 'software-house', proposedChange: change({ addRules: ['QA reports list every acceptance criterion.'] }) })]);
  assert.equal(improve.proposal(FLOOR, '2026-10-26T11-00-00Z', 'F1').toVersion, v + 1);
  improve.apply(FLOOR, '2026-10-26T11-00-00Z', 'F1');
  const bp = blueprints.getBlueprint('software-house');
  assert.equal(bp.version, v + 1);
  assert.match(blueprints.standardText(bp, null), /### Lessons from audits\n[\s\S]*- QA reports list every acceptance criterion\./);
  assert.ok(blueprints.blueprintVersionText('software-house', v), 'old version in .history');
  // the same rule again changes nothing
  assert.equal(improve.blueprintWithLessons(blueprints.blueprintText('software-house'), change({ addRules: ['QA reports list every acceptance criterion.'] })), blueprints.blueprintText('software-house'));
});

test('floor settings, advice-only findings and dismissals', () => {
  saveAudit('2026-10-26T12-00-00Z', [
    finding('F1', { kind: 'floor-setting', id: 'pos', proposedChange: change({ setting: 'audit.model', value: 'haiku' }) }),
    finding('F2', null),
    finding('F3', { kind: 'role-template', id: 'no-such-role', proposedChange: change({ addRules: ['x'] }) }),
  ]);
  let patched = null;
  const p = improve.proposal(FLOOR, '2026-10-26T12-00-00Z', 'F1');
  assert.deepEqual(p.diff, [{ op: '-', text: 'audit.model: "sonnet"' }, { op: '+', text: 'audit.model: "haiku"' }]);
  improve.apply(FLOOR, '2026-10-26T12-00-00Z', 'F1', { updateFloor: (x) => { patched = x; } });
  assert.deepEqual(patched, { audit: { model: 'haiku' } });
  assert.match(improve.proposal(FLOOR, '2026-10-26T12-00-00Z', 'F2').reason, /advice/);
  assert.match(improve.proposal(FLOOR, '2026-10-26T12-00-00Z', 'F3').reason, /not found/);
  assert.throws(() => improve.dismiss(FLOOR, '2026-10-26T12-00-00Z', 'F2', ' '), /Say why/);
  improve.dismiss(FLOOR, '2026-10-26T12-00-00Z', 'F2', 'We accept the wait, the owner is in meetings.');
  assert.equal(improve.decisionsFor('pos', '2026-10-26T12-00-00Z').F2.decision, 'dismissed');
});

test('an audit can propose the Autopilot level as a Floor setting', () => {
  saveAudit('2026-10-26T13-00-00Z', [
    finding('F1', { kind: 'floor-setting', id: 'pos', proposedChange: change({ setting: 'autopilot', value: 'off' }) }),
    finding('F2', { kind: 'floor-setting', id: 'pos', proposedChange: change({ setting: 'autopilot', value: 'turbo' }) }),
  ]);
  const F = { ...FLOOR, config: { ...FLOOR.config, autopilot: 'balanced' } };
  assert.deepEqual(improve.proposal(F, '2026-10-26T13-00-00Z', 'F1').diff, [{ op: '-', text: 'autopilot: "balanced"' }, { op: '+', text: 'autopilot: "off"' }]);
  assert.equal(improve.proposal(F, '2026-10-26T13-00-00Z', 'F2').applicable, false);
});

test('the next audit records the metrics after each applied change', () => {
  const next = saveAudit('2026-10-27T09-00-00Z', [], metricsOf(0.06, 0.75));
  const out = improve.recordOutcomes('pos', next);
  assert.equal(out.length, 3, 'three applied changes');
  assert.equal(improve.recordOutcomes('pos', next).length, 0, 'once only');
  const l = improve.ledger({ floor: 'pos' });
  const role = l.find((d) => d.target?.kind === 'role-template');
  assert.deepEqual([role.metricBefore.costPerSP, role.outcome.metricAfter.costPerSP, role.outcome.metricAfter.passRate], [0.1, 0.06, 0.75]);
  assert.equal(l.find((d) => d.decision === 'dismissed').outcome, null);
});

test('export: anonymised bundle with salted hashes, no message text, nothing uploaded', () => {
  log.append('pos', { type: 'message.sent', agent: 'budi-dev', data: { to: 'rina-pm', text: 'the secret recipe' } });
  const a = saveAudit('2026-10-27T10-00-00Z', [finding('F1', null, { recommendation: 'budi-dev re-read src/pos/cart.js; mail budi@gmail.com.' })],
    { ...metricsOf(0.1, 0.5), efficiency: { ...metricsOf(0.1, 0.5).efficiency, byAgent: [{ agent: 'budi-dev', role: 'fullstack-developer', cost: 1 }], repeatedReads: [{ agent: 'budi-dev', target: 'src/pos/cart.js', count: 4 }] } });
  const r = improve.exportBundle();
  assert.equal(fs.statSync(r.file).mode & 0o777, 0o600);
  const text = fs.readFileSync(r.file, 'utf8');
  const b = JSON.parse(text);
  for (const leak of ['secret recipe', 'budi-dev', 'src/pos/cart.js', 'budi@gmail.com', '"pos"']) assert.ok(!text.includes(leak), `${leak}: ${text.split('\n').filter((l) => l.includes(leak)).join(' / ')}`);
  assert.ok(r.audits >= 1 && r.decisions >= 4);
  const exported = b.floors[0].audits.find((x) => x.createdAt === a.createdAt);
  assert.match(exported.findings[0].recommendation, /^h:[0-9a-f]{10} re-read path#[0-9a-f]{10}; mail \[email\]\.$/);
  assert.equal(exported.metrics.efficiency.byAgent[0].role, 'fullstack-developer');
  assert.match(exported.metrics.efficiency.byAgent[0].agent, /^h:[0-9a-f]{10}$/);
  assert.equal(b.decisions.find((d) => d.kind === 'role-template').role, 'fullstack-developer');
  assert.ok(fs.existsSync(path.join(config.home, 'export-salt')));
});
