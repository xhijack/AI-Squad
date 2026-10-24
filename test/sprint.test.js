import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, config, paths } from '../server/config.js';
import * as sprint from '../server/sprint.js';
import * as floors from '../server/floors.js';
import * as merge from '../server/merge.js';
import * as squad from '../server/squad.js';
import * as tm from '../server/tmux.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.cjs');
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const TEAM = [
  { displayName: 'Lina - Sprint Lead', template: 'sprint-lead', lead: true },
  { displayName: 'Dev One', template: 'sprint-developer' },
  { displayName: 'Dev Two', template: 'sprint-developer' },
  { displayName: 'Quinn - QA', template: 'sprint-qa' },
];
const proj = path.join(root, 'shop');
after(() => { try { execFileSync('tmux', ['-L', config.tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ } });

test('choosing Squad Sprint scaffolds the pack, team ids and hooks', async () => {
  await floors.createFloor({ name: 'Shop', directory: { mode: 'new', path: proj }, workflow: 'squad-sprint', git: { qualityGate: 'npm test -- --run' }, team: TEAM });
  for (const f of ['.claude/squad/config.sh', '.claude/hooks/task-completed.cjs', '.claude/hooks/teammate-idle.cjs', '.claude/hooks/board-gate.cjs', '.claude/hooks/squad-lib.cjs', '.claude/commands/sprint.md',
    'docs/squad/PLAN.md', 'docs/squad/TASKS.md', 'docs/squad/QUESTIONS.md', 'docs/squad/templates/RELEASE.md', 'docs/squad/templates/bug.md', 'docs/squad/qa/.gitkeep']) assert.ok(fs.existsSync(path.join(proj, f)), f);
  assert.ok(fs.statSync(path.join(proj, '.claude/hooks/task-completed.cjs')).mode & 0o100, 'hook is executable');
  const cfg = sprint.readConfig(proj);
  assert.equal(cfg.SPRINT, '1');
  assert.equal(cfg.TEST_CMD, 'npm test -- --run');
  assert.equal(cfg.LEAD_AGENT, 'lina-sprint-lead');
  assert.equal(cfg.DEV_AGENTS, 'dev-one dev-two');
  assert.equal(cfg.QA_AGENTS, 'quinn-qa');
  const settings = JSON.parse(read(proj, '.claude/settings.json'));
  assert.equal(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
  assert.deepEqual(settings.attribution, { commit: '', pr: '' }, 'existing settings kept');
  for (const r of ['Edit', 'Write', 'Bash(node *)', 'Bash(git commit *)', 'Bash(npm test -- --run*)']) assert.ok(settings.permissions.allow.includes(r), r);
  for (const r of ['Bash(git push*)', 'Read(./.env)']) assert.ok(settings.permissions.deny.includes(r), r);
  assert.equal(settings.hooks.TaskCompleted.length, 1);
  assert.equal(settings.hooks.TeammateIdle.length, 1);
  assert.deepEqual([settings.hooks.TaskCompleted[0].hooks[0].command, settings.hooks.TaskCompleted[0].hooks[0].args], ['node', ['${CLAUDE_PROJECT_DIR}/.claude/hooks/task-completed.cjs']]);
  assert.equal(settings.hooks.PostToolUse.find((g) => JSON.stringify(g).includes('board-gate.cjs')).matcher, 'Edit|Write|MultiEdit|Bash');
  assert.equal(settings.hooks.PreToolUse, undefined);
});

test('older bash gate entries are replaced by the Node hooks', () => {
  const dir = path.join(root, 'old');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const old = (s) => ({ hooks: [{ type: 'command', command: 'bash', args: [`\${CLAUDE_PROJECT_DIR}/.claude/hooks/${s}`] }] });
  fs.writeFileSync(path.join(dir, '.claude/settings.json'), JSON.stringify({ hooks: { TaskCompleted: [old('task-completed.sh'), { hooks: [{ type: 'command', command: 'echo mine' }] }], TeammateIdle: [old('teammate-idle.sh')] } }));
  sprint.mergeSettings(dir);
  const h = JSON.parse(read(dir, '.claude/settings.json')).hooks;
  assert.deepEqual(h.TaskCompleted.map((g) => g.hooks[0].command), ['echo mine', 'node'], 'own hooks kept');
  assert.deepEqual(h.TeammateIdle.map((g) => g.hooks[0].args[0]), ['${CLAUDE_PROJECT_DIR}/.claude/hooks/teammate-idle.cjs']);
});

test('scaffold never overwrites and hooks are added once; team changes update config.sh', () => {
  write(proj, 'docs/squad/PLAN.md', '# my plan\n');
  const created = sprint.scaffold(proj, { git: {}, agents: [] });
  assert.deepEqual(created, []);
  assert.equal(read(proj, 'docs/squad/PLAN.md'), '# my plan\n');
  assert.equal(JSON.parse(read(proj, '.claude/settings.json')).hooks.TaskCompleted.length, 1);
  floors.addAgent(proj, { displayName: 'Dev Three', template: 'sprint-developer' });
  assert.equal(sprint.readConfig(proj).DEV_AGENTS, 'dev-one dev-two dev-three');
});

test('TASKS.md is parsed into board columns', () => {
  write(proj, 'docs/squad/TASKS.md', `# Tasks\n\n| Task | Owner | Blocked by | Status |\n|---|---|---|---|\n| BUILD M01 Login | dev-one | — | DONE |\n| QA M01 Login | quinn-qa | BUILD M01 | DONE (PASS) |\n| BUILD M02 Cart | dev-two | BUILD M01 | IN_PROGRESS |\n| QA M02 Cart | quinn-qa | BUILD M02 | TODO |\n| BUG M02-B01 Total wrong | dev-two | — | OPEN |\n\nNotes after.\n`);
  write(proj, 'docs/squad/bugs/M02-B01.md', '# M02-B01\n\nSTATUS: OPEN\nOWNER: dev-two\n');
  write(proj, 'docs/squad/handoff/M02.md', '# Handoff\n');
  write(proj, 'docs/squad/qa/M01.md', '# QA\n\nSTATUS: PASS\n');
  const b = sprint.boardData(proj);
  assert.equal(b.sprint, '1');
  assert.deepEqual(b.tasks.map((t) => [t.task, t.column]), [['BUILD M01 Login', 'DONE'], ['QA M01 Login', 'DONE'], ['BUILD M02 Cart', 'IN_PROGRESS'], ['QA M02 Cart', 'TODO'], ['BUG M02-B01 Total wrong', 'BLOCKED']]);
  assert.equal(b.tasks[2].blockedBy, 'BUILD M01');
  assert.equal(b.tasks[0].blockedBy, '');
  assert.deepEqual(b.bugs.open, ['M02-B01']);
  assert.deepEqual(b.qa.pass, ['M01']);
  assert.deepEqual(b.handoffs, ['M02']);
  assert.equal(squad.floorDetail('shop').board.tasks.length, 5);
});

const hook = (name, input) => spawnSync(process.execPath, [path.join(proj, '.claude/hooks', name)], { input: JSON.stringify(input), env: { ...process.env, CLAUDE_PROJECT_DIR: proj }, encoding: 'utf8' });

test('TaskCompleted gate: handoff, bug status, QA report and open bugs', () => {
  fs.writeFileSync(path.join(proj, '.claude/squad/config.sh'), read(proj, '.claude/squad/config.sh').replace(/^TEST_CMD=.*$/m, 'TEST_CMD="true"'));
  let r = hook('task-completed.cjs', { task_subject: 'BUILD M03 Search' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no handoff note/);
  assert.equal(hook('task-completed.cjs', { task_subject: 'BUILD M02 Cart' }).status, 0);
  r = hook('task-completed.cjs', { task_subject: 'BUG M02-B01 Total wrong' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /STATUS: FIXED/);
  r = hook('task-completed.cjs', { task: { subject: '[QA] M02: Cart' } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no QA report/);
  write(proj, 'docs/squad/qa/M02.md', 'STATUS: PASS\n');
  r = hook('task-completed.cjs', { task_subject: 'QA M02 Cart' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /M02-B01/);
  fs.writeFileSync(path.join(proj, '.claude/squad/config.sh'), read(proj, '.claude/squad/config.sh').replace(/^TEST_CMD=.*$/m, 'TEST_CMD="echo 1 failing; exit 1"'));
  write(proj, 'docs/squad/bugs/M02-B01.md', 'STATUS: FIXED\nOWNER: dev-two\n');
  r = hook('task-completed.cjs', { task_subject: 'BUG M02-B01 Total wrong' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /tests FAILED[\s\S]*1 failing/);
  assert.equal(hook('task-completed.cjs', { task_subject: 'Something else' }).status, 0);
});

test('board gate: rows newly marked DONE on TASKS.md (by any tool) must pass the gate, or are put back', () => {
  const board = path.join(proj, 'docs/squad/TASKS.md');
  const gate = (tool_name) => spawnSync(process.execPath, [path.join(proj, '.claude/hooks/board-gate.cjs')], { input: JSON.stringify({ tool_name, tool_input: {} }), env: { ...process.env, CLAUDE_PROJECT_DIR: proj }, encoding: 'utf8' });
  const snap = path.join(proj, '.git/aisquad-board-snapshot.md');
  fs.writeFileSync(path.join(proj, '.claude/squad/config.sh'), read(proj, '.claude/squad/config.sh').replace(/^TEST_CMD=.*$/m, 'TEST_CMD="true"'));
  write(proj, 'docs/squad/bugs/M02-B01.md', 'STATUS: OPEN\nOWNER: dev-two\n');
  fs.rmSync(path.join(proj, 'docs/squad/qa/M02.md'), { force: true });
  const start = read(proj, 'docs/squad/TASKS.md');
  fs.writeFileSync(snap, start);                                     // last accepted board
  assert.equal(gate('Bash').status, 0, 'unchanged board');
  // like the haiku lead: sed in Bash marks BUILD M02 (handoff + green tests) and QA M02 (no report) DONE
  fs.writeFileSync(board, start.replace('| BUILD M02 Cart | dev-two | BUILD M01 | IN_PROGRESS |', '| BUILD M02 Cart | dev-two | BUILD M01 | DONE |').replace('| QA M02 Cart | quinn-qa | BUILD M02 | TODO |', '| QA M02 Cart | quinn-qa | BUILD M02 | DONE |'));
  let r = gate('Bash');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /put back[\s\S]*QA M02 Cart: Quality gate: no QA report/);
  assert.doesNotMatch(r.stderr, /BUILD M02/);
  let now = read(proj, 'docs/squad/TASKS.md');
  assert.match(now, /\| BUILD M02 Cart \| dev-two \| BUILD M01 \| DONE \|/, 'the passing row stays DONE');
  assert.match(now, /\| QA M02 Cart \| quinn-qa \| BUILD M02 \| TODO \|/, 'the failing row is put back');
  assert.equal(read(proj, '.git/aisquad-board-snapshot.md'), now, 'accepted board remembered');
  // a new DONE row for an open bug is set to TODO; rows already DONE are not checked again
  fs.writeFileSync(board, now.replace('| BUG M02-B01 Total wrong | dev-two | — | OPEN |', '| BUG M02-B01 Total wrong | dev-two | — | OPEN |\n| BUG M02-B02 Rounding | dev-two | — | DONE |'));
  write(proj, 'docs/squad/bugs/M02-B02.md', 'STATUS: OPEN\nOWNER: dev-two\n');
  r = gate('Edit');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /BUG M02-B02 Rounding: Quality gate: set 'STATUS: FIXED'/);
  assert.doesNotMatch(r.stderr, /BUILD M02|QA M01/);
  assert.match(read(proj, 'docs/squad/TASKS.md'), /\| BUG M02-B02 Rounding \| dev-two \| — \| TODO \|/);
  // without a snapshot the committed board is the baseline; not a gated task: accepted
  fs.rmSync(snap);
  const committed = execFileSync('git', ['-C', proj, 'show', 'HEAD:docs/squad/TASKS.md'], { encoding: 'utf8' });
  fs.writeFileSync(board, `${committed}| Write the docs | dev-one | — | DONE |\n`);
  assert.equal(gate('Write').status, 0, 'only BUILD / BUG / QA rows are gated');
  fs.rmSync(path.join(proj, 'docs/squad/bugs/M02-B02.md'));
  fs.writeFileSync(board, start);
  fs.rmSync(snap, { force: true });
  write(proj, 'docs/squad/bugs/M02-B01.md', 'STATUS: FIXED\nOWNER: dev-two\n');   // state the next tests expect
  write(proj, 'docs/squad/qa/M02.md', 'STATUS: PASS\n');
});

test('TeammateIdle: QA held for untested handoffs, developers for their open bugs, released after 3 nudges', () => {
  let r = hook('teammate-idle.cjs', { teammate_name: 'quinn-qa' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /FIXED bugs waiting for retest: M02-B01/);
  write(proj, 'docs/squad/bugs/M02-B01.md', 'STATUS: OPEN\nOWNER: dev-two\n');
  r = hook('teammate-idle.cjs', { teammate_name: 'dev-two' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /OPEN bugs: M02-B01/);
  assert.equal(hook('teammate-idle.cjs', { teammate_name: 'dev-one' }).status, 0);
  assert.equal(hook('teammate-idle.cjs', { teammate_name: 'lina-sprint-lead' }).status, 0);
  hook('teammate-idle.cjs', { teammate_name: 'dev-two' }); hook('teammate-idle.cjs', { teammate_name: 'dev-two' });
  assert.equal(hook('teammate-idle.cjs', { teammate_name: 'dev-two' }).status, 0, 'released after IDLE_MAX_NUDGE');
});

test('a closed sprint is merged by the server and the next sprint starts in a fresh lead session', async () => {
  configure({ claudeBin: FAKE, useSystemd: false });
  g(proj, 'config', 'user.name', 'Owner'); g(proj, 'config', 'user.email', 'owner@example.com');
  fs.rmSync(path.join(proj, 'docs/squad/.idle-dev-two'), { force: true });
  g(proj, 'add', '-A'); g(proj, 'commit', '-q', '-m', 'chore: squad sprint setup');
  g(proj, 'switch', '-q', '-c', 'sprint-1');
  write(proj, 'src/cart.js', 'export const total = 1;\n');
  g(proj, 'add', '-A'); g(proj, 'commit', '-q', '-m', 'feat(cart): cart');
  let st = await sprint.sprintStatus(proj);
  assert.equal(st.closed, false);
  assert.deepEqual(st.checks, { branch: true, release: false, closingCommit: false, cleanTree: true, qaPass: false });

  write(proj, 'docs/squad/sprint-1/RELEASE.md', '# Release: Sprint 1\n');
  write(proj, 'docs/squad/sprint-1/qa/FINAL-S1.md', '# Final\n\nSTATUS: PASS\n');
  g(proj, 'add', '-A'); g(proj, 'commit', '-q', '-m', 'docs(squad): close sprint 1');
  write(proj, 'scratch.txt', 'dirty');
  st = await sprint.sprintStatus(proj);
  assert.equal(st.checks.cleanTree, false);
  assert.equal(st.closed, false);
  fs.rmSync(path.join(proj, 'scratch.txt'));
  assert.equal((await sprint.sprintStatus(proj)).closed, true);

  squad.invalidate();
  assert.deepEqual(await squad.mergeTick({ checkMemory: false }), [], 'not approved: nothing happens');
  const m = await squad.floorMerges('shop');
  assert.equal(m.sprint.closed, true);
  assert.ok(m.candidates.some((c) => c.branch === 'sprint-1'), 'sprint branch offered for a manual merge');

  floors.updateFloorConfig(proj, { sprint: { autoNext: true }, git: { qualityGate: 'test -f docs/squad/sprint-1/RELEASE.md' } });
  g(proj, 'add', '-A'); g(proj, 'commit', '-q', '-m', 'chore: settings');
  merge.setApproval('shop', true);
  squad.invalidate();
  const [r] = await squad.mergeTick({ checkMemory: false });
  assert.equal(r.branch, 'sprint-1');
  assert.equal(r.result, 'merged', r.reason);
  assert.equal(r.trigger, 'sprint');
  assert.deepEqual(r.nextSprint, { sprint: 2, lead: 'lina-sprint-lead' });
  assert.ok(fs.existsSync(path.join(proj, '.git')) && g(proj, 'show', 'main:src/cart.js'), 'sprint merged into main');
  assert.ok(tm.isRunning(tm.sessionName('shop', 'lina-sprint-lead')), 'fresh lead session');
  tm.stopSession(tm.sessionName('shop', 'lina-sprint-lead'));
  squad.invalidate();
  assert.deepEqual(await squad.mergeTick({ checkMemory: false }), [], 'handled once');
});

test('the next sprint waits until the lead has finished its turn', async () => {
  const hooks = await import('../server/events.js');
  const floorsNow = [{ id: 'shop', path: proj, agentIds: ['lina-sprint-lead'] }];
  fs.writeFileSync(paths.runtime(), JSON.stringify({ nextSprint: { shop: { sprint: 3, lead: 'lina-sprint-lead', since: Date.now() } } }));
  hooks.ingest({ event: 'PreToolUse', agent: 'shop/lina-sprint-lead', payload: { tool_name: 'SendMessage', tool_input: { to: 'dev-one' } } }, floorsNow);
  squad.invalidate();
  assert.equal(await squad.startNextSprint('shop'), null, 'lead still working: wait');
  assert.equal(tm.isRunning(tm.sessionName('shop', 'lina-sprint-lead')), false);
  hooks.ingest({ event: 'Stop', agent: 'shop/lina-sprint-lead', payload: {} }, floorsNow);
  squad.invalidate();
  assert.deepEqual(await squad.startNextSprint('shop'), { sprint: 3, lead: 'lina-sprint-lead' });
  assert.ok(tm.isRunning(tm.sessionName('shop', 'lina-sprint-lead')));
  assert.equal(await squad.startNextSprint('shop'), null, 'only once');
  tm.stopSession(tm.sessionName('shop', 'lina-sprint-lead'));
});
