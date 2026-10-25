// Performance dialog data from docs/squad files: weighted bugs per story point, first-round pass rate,
// modules owned, cost per story point, and the cost projection for the remaining backlog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import * as perf from '../server/performance.js';

const root = path.join(scratch({ seed: false }), 'shop');
const write = (f, text) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };
const git = (...a) => execFileSync('git', ['-C', root, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.y', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.y' } });
const AGENTS = [{ id: 'lead', displayName: 'Lina', kind: 'lead' }, { id: 'dev-a', displayName: 'Dev A', kind: 'dev' }, { id: 'dev-b', displayName: 'Dev B', kind: 'dev' }, { id: 'qa', displayName: 'Quinn', kind: 'qa' }];

fs.mkdirSync(root, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', root]);
write('.claude/squad/config.sh', 'SPRINT="2"\n');
// sprint 1 (archived): M01 dev-a 3 SP passes first round, M02 dev-b 5 SP needs two rounds after a Major bug
write('docs/squad/sprint-1/PLAN.md', '| Module | Stories | SP | Owner | Owned folders | Depends on | Status |\n|---|---|---|---|---|---|---|\n| M01 Catalogue | S1 | 3 | dev-a | src/a | — | DONE |\n| M02 Cart | S2 | 5 | dev-b | src/b | M01 | DONE |\n');
write('docs/squad/sprint-1/qa/M01.md', '# QA M01\n\nSTATUS: PASS\nRound: 1\nTester: qa\n');
write('docs/squad/sprint-1/qa/M02.md', '# QA M02\n\nSTATUS: PASS\nRound: 2\nTester: qa\n');
write('docs/squad/sprint-1/bugs/M02-B01.md', '# M02-B01\n\nSTATUS: VERIFIED\nOWNER: dev-b\nSEVERITY: Major\n');
write('docs/squad/sprint-1/bugs/M02-B02.md', '# M02-B02\n\nSTATUS: VERIFIED\nOWNER: dev-b\nSEVERITY: Cosmetic\n');
git('add', '-A'); git('commit', '-qm', 'docs(squad): close sprint 1');
const closed = Date.now() + 1000;
// sprint 2 (running): M03 dev-a 2 SP in QA with a Minor bug; backlog has 10 SP left
write('docs/squad/PLAN.md', '| Module | Stories | SP | Owner | Owned folders | Depends on | Status |\n|---|---|---|---|---|---|---|\n| M03 Checkout | S3 | 2 | dev-a | src/c | — | QA |\n');
write('docs/squad/TASKS.md', '| Task | Owner | Blocked by | Status |\n|---|---|---|---|\n| BUILD M03 Checkout | dev-a | — | DONE |\n| QA M03 Checkout | qa | BUILD M03 | IN_PROGRESS |\n');
write('docs/squad/bugs/M03-B01.md', 'STATUS: OPEN\nOWNER: dev-a\nSEVERITY: Minor\n');
write('docs/BACKLOG.md', '| Story | SP | Status |\n|---|---|---|\n| S1 | 3 | DONE |\n| S4 | 8 | TODO |\n| S5 | 2 | TODO |\n');

// sprint 1 cost: $8 (dev-a 2, dev-b 4, qa 1, lead 1); sprint 2: $3 for dev-a
const costs = (from, to) => (to <= closed ? { 'dev-a': 2, 'dev-b': 4, qa: 1, lead: 1 } : { 'dev-a': 3 });

test('per sprint: planned and done story points, weighted bugs, cost per story point', () => {
  const p = perf.floorPerformance(root, AGENTS, costs, closed + 60e3);
  assert.equal(p.sprint, 2);
  const [s1, s2] = p.sprints;
  assert.deepEqual([s1.sprint, s1.closed, s1.plannedSP, s1.doneSP, s1.bugs, s1.bugWeight, s1.cost, s1.costPerSP], [1, true, 8, 8, 2, 3.5, 8, 1]);
  assert.deepEqual([s2.sprint, s2.closed, s2.plannedSP, s2.doneSP, s2.openBugs], [2, false, 2, 0, 1]);
});

test('per agent: modules owned, bugs per story point, first-round pass rate, cost per story point', () => {
  const p = perf.floorPerformance(root, AGENTS, costs, closed + 60e3);
  const a = (id) => p.agents.find((x) => x.id === id);
  assert.deepEqual([a('dev-a').total.modules, a('dev-a').total.sp, a('dev-a').total.bugsPerSP, a('dev-a').total.firstPassRate], [2, 5, 0.2, 1]);
  assert.deepEqual([a('dev-b').bySprint[1].bugWeight, a('dev-b').bySprint[1].bugsPerSP, a('dev-b').bySprint[1].firstPassRate, a('dev-b').bySprint[1].costPerSP], [3.5, 0.7, 0, 0.8]);
  assert.deepEqual([a('qa').bySprint[1].found, a('qa').bySprint[1].foundWeight, a('qa').bySprint[1].foundPerSP], [2, 3.5, 0.44]);
  assert.equal(a('lead').total.cost, 1);
});

test('projection: cost per done story point times the remaining backlog and running sprint', () => {
  const { projection } = perf.floorPerformance(root, AGENTS, costs, closed + 60e3);
  // spent $11 for 8 done SP -> $1.375 per SP; remaining 8 + 2 backlog + 2 of the running sprint = 12 SP
  assert.deepEqual(projection, { spent: 11, doneSP: 8, costPerSP: 1.38, remainingSP: 12, remainingCost: 16.5, totalCost: 27.5 });
});

test('tables are found by their columns', () => {
  assert.deepEqual(perf.tableRows('text\n| A | SP |\n|---|---|\n| x | 3 |\n\nmore', ['sp']), [{ a: 'x', sp: '3' }]);
  assert.deepEqual(perf.tableRows('| A |\n|---|\n| x |', ['sp']), []);
});
