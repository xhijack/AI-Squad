import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import * as merge from '../server/merge.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import { paths } from '../server/config.js';

const root = scratch();
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const write = (cwd, f, text) => { fs.mkdirSync(path.dirname(path.join(cwd, f)), { recursive: true }); fs.writeFileSync(path.join(cwd, f), text); };
const commit = (cwd, f, text, msg) => { write(cwd, f, text); g(cwd, 'add', '-A'); g(cwd, 'commit', '-q', '-m', msg); };
const GIT = { mainBranch: 'main', branchStrategy: 'agent-branches', mergePolicy: 'auto', mergeMethod: 'squash', pushPolicy: 'never', qualityGate: 'test -f README.md' };

function repo(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  g(dir, 'init', '-q', '-b', 'main');
  g(dir, 'config', 'user.name', 'Owner'); g(dir, 'config', 'user.email', 'owner@example.com');
  commit(dir, 'README.md', '# app\n', 'chore: init');
  commit(dir, 'src/app.js', 'line1\nline2\n', 'feat: app');
  return dir;
}
function branchWork(dir, branch, files) {
  g(dir, 'switch', '-q', '-c', branch);
  for (const [f, text, msg] of files) commit(dir, f, text, msg);
  g(dir, 'switch', '-q', 'main');
}

test('approval is stored in ~/.aisquad, not in the repo', () => {
  merge.setApproval('acme', true);
  assert.equal(merge.approval('acme').autoMerge, true);
  assert.ok(fs.existsSync(path.join(path.dirname(paths.pin()), 'approvals.json')));
  merge.setApproval('acme', false);
  assert.equal(merge.approval('acme'), null);
});

test('squash merge after a green gate; candidates and log follow', async () => {
  const dir = repo('squash');
  branchWork(dir, 'budi/catalogue', [['src/cat.js', 'cat\n', 'feat(catalogue): page'], ['src/cat.css', 'x\n', 'style(catalogue): grid']]);
  let c = await merge.candidates('f1', dir, GIT, ['budi']);
  assert.deepEqual(c.map((x) => x.branch), ['budi/catalogue']);
  const e = await merge.mergeBranch('f1', dir, GIT, 'budi/catalogue', { trigger: 'auto' });
  assert.equal(e.result, 'merged', e.reason);
  assert.equal(e.gate.ok, true);
  assert.equal(g(dir, 'log', '-1', '--format=%s', 'main'), 'chore(merge): squash budi/catalogue');
  assert.match(g(dir, 'log', '-1', '--format=%b', 'main'), /- feat\(catalogue\): page/);
  assert.equal(g(dir, 'rev-list', '--count', '--merges', 'main'), '0');
  assert.ok(fs.existsSync(path.join(dir, 'src/cat.js')), 'checked-out main was fast-forwarded');
  assert.equal(g(dir, 'status', '--porcelain'), '');
  assert.equal(g(dir, 'worktree', 'list').split('\n').length, 1, 'temporary worktree removed');
  assert.equal(merge.mergeLog('f1')[0].result, 'merged');
  c = await merge.candidates('f1', dir, GIT, ['budi']);
  assert.equal(c[0].lastResult, 'merged', 'squashed tip is remembered');
});

test('refuses on conflicts and leaves main untouched', async () => {
  const dir = repo('conflict');
  branchWork(dir, 'sari/fix', [['src/app.js', 'line1\nSARI\n', 'fix: sari']]);
  commit(dir, 'src/app.js', 'line1\nMAIN\n', 'fix: main');
  const before = g(dir, 'rev-parse', 'main');
  const e = await merge.mergeBranch('f2', dir, GIT, 'sari/fix', { trigger: 'auto' });
  assert.equal(e.result, 'refused');
  assert.equal(e.reason, 'Merge conflicts');
  assert.deepEqual(e.conflicts, ['src/app.js']);
  assert.equal(g(dir, 'rev-parse', 'main'), before);
  assert.equal(merge.mergeProblems('f2').length, 1);
  assert.equal(merge.mergeProblems('f2', [e.id]).length, 0, 'dismissed');
});

test('refuses on a red gate, without a gate (auto) and with a dirty main checkout', async () => {
  const dir = repo('gate');
  branchWork(dir, 'budi/x', [['x.txt', 'x\n', 'feat: x']]);
  const before = g(dir, 'rev-parse', 'main');
  const red = await merge.mergeBranch('f3', dir, { ...GIT, qualityGate: 'echo "2 tests failed"; exit 3' }, 'budi/x', { trigger: 'auto' });
  assert.equal(red.result, 'refused');
  assert.match(red.reason, /Quality gate failed \(exit 3\)/);
  assert.match(red.gate.output, /2 tests failed/);
  assert.equal(g(dir, 'rev-parse', 'main'), before);
  const none = await merge.mergeBranch('f3', dir, { ...GIT, qualityGate: '' }, 'budi/x', { trigger: 'auto' });
  assert.match(none.reason, /No quality gate/);
  write(dir, 'README.md', 'edited\n');
  const dirty = await merge.mergeBranch('f3', dir, GIT, 'budi/x', { trigger: 'manual' });
  assert.match(dirty.reason, /Uncommitted changes/);
  g(dir, 'checkout', '-q', 'README.md');
});

test('merge method "merge" makes a merge commit; main not checked out is updated by ref', async () => {
  const dir = repo('mergemethod');
  branchWork(dir, 'feature/login', [['login.js', 'l\n', 'feat: login']]);
  g(dir, 'switch', '-q', 'feature/login');                      // project dir is on another branch
  const e = await merge.mergeBranch('f4', dir, { ...GIT, branchStrategy: 'feature-branches', mergeMethod: 'merge' }, 'feature/login');
  assert.equal(e.result, 'merged', e.reason);
  assert.equal(g(dir, 'log', '-1', '--format=%s', 'main'), "Merge branch 'feature/login'");
  assert.equal(g(dir, 'rev-list', '--count', '--merges', 'main'), '1');
  assert.equal(g(dir, 'symbolic-ref', '--short', 'HEAD'), 'feature/login', 'checkout left alone');
  assert.equal((await merge.mergeBranch('f4', dir, GIT, 'feature/login')).result, 'noop');
});

test('pushes only when the policy allows; a failed push is reported', async () => {
  const dir = repo('push');
  const bare = path.join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  g(dir, 'remote', 'add', 'origin', bare);
  branchWork(dir, 'budi/a', [['a.txt', 'a\n', 'feat: a']]);
  const never = await merge.mergeBranch('f5', dir, GIT, 'budi/a');
  assert.equal(never.push, undefined);
  branchWork(dir, 'budi/b', [['b.txt', 'b\n', 'feat: b']]);
  const pushed = await merge.mergeBranch('f5', dir, { ...GIT, pushPolicy: 'after-merge' }, 'budi/b');
  assert.deepEqual(pushed.push, { ok: true });
  assert.equal(g(bare, 'rev-parse', 'main'), g(dir, 'rev-parse', 'main'));
  g(dir, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
  branchWork(dir, 'budi/c', [['c.txt', 'c\n', 'feat: c']]);
  const failed = await merge.mergeBranch('f5', dir, { ...GIT, pushPolicy: 'after-merge' }, 'budi/c');
  assert.equal(failed.result, 'merged');
  assert.equal(failed.push.ok, false);
  assert.equal(merge.mergeProblems('f5').length, 1);
});

test('auto-merge tick: only approved Floors, only finished work of idle agents', async () => {
  const dir = path.join(root, 'floor');
  await floors.createFloor({ name: 'Shop', directory: { mode: 'new', path: dir }, git: { qualityGate: 'true' },
    team: [{ displayName: 'Budi - Dev', template: 'fullstack-developer' }] });
  g(dir, 'config', 'user.name', 'Owner'); g(dir, 'config', 'user.email', 'owner@example.com');
  g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', 'chore: floor');
  branchWork(dir, 'budi-dev/catalogue', [['cat.js', 'c\n', 'feat: catalogue']]);
  const work = (doneAt) => fs.writeFileSync(paths.runtime(), JSON.stringify({ work: { 'shop/budi-dev': { text: 't', assignedAt: 1, doneAt } } }));

  work(Date.now());
  squad.invalidate();
  assert.deepEqual(await squad.mergeTick({ checkMemory: false }), [], 'not approved yet');
  merge.setApproval('shop', true);
  work(null);
  squad.invalidate();
  assert.deepEqual(await squad.mergeTick({ checkMemory: false }), [], 'work not finished');
  work(Date.now());
  squad.invalidate();
  const done = await squad.mergeTick({ checkMemory: false });
  assert.deepEqual(done.map((m) => [m.branch, m.result]), [['budi-dev/catalogue', 'merged']]);
  squad.invalidate();
  assert.deepEqual(await squad.mergeTick({ checkMemory: false }), [], 'each tip once');
  const m = await squad.floorMerges('shop');
  assert.equal(m.approval.autoMerge, true);
  assert.equal(m.log[0].result, 'merged');
  assert.ok(!fs.readFileSync(path.join(dir, '.claude/aisquad/git.json'), 'utf8').includes('Approved'), 'approval not in the repo');
});
