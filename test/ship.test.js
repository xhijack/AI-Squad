import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { readiness } from '../server/ship.js';

const root = scratch({ seed: false });
const proj = path.join(root, 'shop');
const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(proj, f)), { recursive: true }); fs.writeFileSync(path.join(proj, f), t); };
const TEAM = [{ template: 'sprint-lead' }, { template: 'sprint-developer' }];
const keyed = (r) => Object.fromEntries(r.items.map((i) => [i.key, [i.ok, i.for]]));

test('nothing done yet: everything a merge needs is missing', () => {
  w('docs/squad/TASKS.md', '| Task | Owner | Status |\n|---|---|---|\n| BUILD M01 Login | dev | DONE |\n| QA M01 Login | qa | TODO |\n| BUILD M02 Cart | dev | DONE |\n');
  const r = readiness(proj, { sprint: '2', team: TEAM });
  assert.deepEqual(keyed(r), { qa: [false, 'merge'], smoke: [false, 'merge'], docs: [false, 'merge'], planReview: [false, 'info'], design: [true, 'info'], security: [true, 'info'], rollback: [false, 'deploy'] });
  assert.equal(r.merge.ready, false);
  assert.deepEqual(r.merge.missing, ['QA pass for every module', 'Final smoke test', 'Release notes and docs updated']);
  assert.match(r.items[0].detail, /no QA PASS yet: M01, M02/);
});

test('ready to merge, then to deploy once the rollback was tried', () => {
  w('docs/squad/qa/M01.md', 'STATUS: PASS\n'); w('docs/squad/sprint-2/qa/M02.md', 'STATUS: PASS\n');
  w('docs/squad/sprint-2/qa/FINAL-S2.md', 'STATUS: PASS\n'); w('docs/squad/sprint-2/RELEASE.md', '# Release 2\n');
  w('docs/squad/sprint-2/PLAN-REVIEW.md', '## Engineering review\nVERDICT: OK\n## Design review\nDESIGN SCORE: 7/10\n## Security review\nVERDICT: OK\n');
  let r = readiness(proj, { sprint: '2', team: TEAM });
  assert.equal(r.merge.ready, true); assert.equal(r.deploy.ready, false); assert.deepEqual(r.deploy.missing, ['Rollback tried on staging']);
  w('docs/ENVIRONMENTS.md', '# Environments\n\n## Staging\nRollback tried: 2026-10-26 (v1.2 -> v1.1)\n');
  r = readiness(proj, { sprint: '2', team: TEAM });
  assert.equal(r.deploy.ready, true);
  assert.equal(r.items.find((i) => i.key === 'rollback').detail, 'tried 2026-10-26');
});

test('a designer or a Security Engineer on the team makes their review a merge requirement', () => {
  const team = [...TEAM, { template: 'ui-ux-designer' }, { template: 'security-engineer' }];
  assert.equal(readiness(proj, { sprint: '2', team }).merge.ready, true, 'the plan review has both');
  w('docs/squad/security/sprint-2.md', '# Security\n\n## S1 · High · Broken access control in M02\nEvidence: x\n\n## S2 · Low · Verbose errors\nEvidence: y\n');
  let r = readiness(proj, { sprint: '2', team });
  assert.equal(r.merge.ready, false); assert.match(r.items.find((i) => i.key === 'security').detail, /1 open Critical \/ High finding$/);
  w('docs/squad/security/sprint-2.md', '# Security\n\n## S1 · High · Broken access control in M02\nSTATUS: FIXED\nEvidence: x\n');
  r = readiness(proj, { sprint: '2', team });
  assert.equal(r.merge.ready, true);
  fs.rmSync(path.join(proj, 'docs/squad/sprint-2/PLAN-REVIEW.md'));
  assert.deepEqual(readiness(proj, { sprint: '2', team }).merge.missing, ['Design review', 'Security review']);
});
