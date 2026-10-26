// One squad, several repositories: repos.json validation, local paths, access per agent, --add-dir, deny rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import * as repos from '../server/repos.js';

const root = scratch({ seed: false });
const primary = path.join(root, 'dtamu-app');
fs.mkdirSync(primary, { recursive: true });

test('repos.json: relative paths only, read or write, valid remotes, known agents, no duplicates', () => {
  const ok = repos.cleanRepos([
    { id: 'bukutamu', path: '../dtamu-bukutamu', remote: 'git@github.com:xhijack/dtamu-bukutamu.git', access: 'read' },
    { id: 'landing', path: '../dtamu-landing-page', access: 'write', branch: { strategy: 'feature-branches', main: 'main' }, gate: 'npm run build', agents: ['seo'] },
  ], { agentIds: ['seo', 'pm'] });
  assert.deepEqual(ok[0], { id: 'bukutamu', path: '../dtamu-bukutamu', remote: 'git@github.com:xhijack/dtamu-bukutamu.git', access: 'read', branch: { strategy: 'agent-branches', main: 'main' }, agents: [] });
  assert.equal(ok[1].gate, 'npm run build');
  const refuse = (r, re) => assert.throws(() => repos.cleanRepos([r]), re);
  refuse({ id: 'x', path: '/home/me/x', access: 'read' }, /must be relative/);
  refuse({ id: 'x', path: 'C:/x', access: 'read' }, /must be relative/);
  refuse({ id: 'x', path: '~/x', access: 'read' }, /must be relative/);
  refuse({ id: 'x', path: '../x', access: 'admin' }, /access must be "read" or "write"/);
  refuse({ id: 'x', path: '../x' }, /access must be/);
  refuse({ id: 'X Y', path: '../x', access: 'read' }, /lowercase/);
  refuse({ id: 'x', path: '../x', access: 'read', remote: 'ftp://x' }, /remote must be/);
  assert.throws(() => repos.cleanRepos([{ id: 'x', path: '../x', access: 'write', agents: ['ghost'] }], { agentIds: ['pm'] }), /unknown agents ghost/);
  assert.throws(() => repos.cleanRepos([{ id: 'x', path: '../a', access: 'read' }, { id: 'x', path: '../b', access: 'read' }]), /listed twice/);
  repos.writeRepos(primary, ok);
  assert.deepEqual(repos.readRepos(primary), ok, 'written and read back');
  assert.ok(!fs.readFileSync(path.join(primary, '.claude/aisquad/repos.json'), 'utf8').includes(root), 'no absolute path in the repository');
});

test('each agent: its repositories, write only where assigned and the repository is "write"; --add-dir; deny rules', () => {
  const list = repos.readRepos(primary);
  fs.mkdirSync(path.join(root, 'dtamu-bukutamu'), { recursive: true });
  fs.mkdirSync(path.join(root, 'elsewhere', 'landing'), { recursive: true });
  const local = { landing: path.join(root, 'elsewhere', 'landing') };               // building.json override on this machine
  const seo = repos.agentRepos(primary, list, 'seo', local), pm = repos.agentRepos(primary, list, 'pm', local);
  assert.deepEqual(seo.map((r) => [r.id, r.access, r.abs]), [['bukutamu', 'read', path.join(root, 'dtamu-bukutamu')], ['landing', 'write', local.landing]]);
  assert.deepEqual(pm.map((r) => [r.id, r.access]), [['bukutamu', 'read']], 'a "read" repository with nobody listed is context for everyone; "write" only for its agents');
  assert.deepEqual(repos.addDirArgs(seo), ['--add-dir', path.join(root, 'dtamu-bukutamu'), '--add-dir', local.landing]);
  assert.deepEqual(repos.addDirArgs([{ id: 'gone', abs: path.join(root, 'nope'), access: 'read' }]), [], 'a missing directory is not passed');
  const deny = repos.denyRules(seo), abs = path.join(root, 'dtamu-bukutamu');
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) assert.ok(deny.includes(`${tool}(/${abs}/**)`), `${tool} denied on the read-only repository`);
  for (const v of ['commit', 'push', 'add', 'reset', 'checkout']) {
    assert.ok(deny.includes(`Bash(git -C ${abs} ${v}:*)`)); assert.ok(deny.includes(`Bash(cd ../dtamu-bukutamu && git ${v}:*)`));
  }
  assert.ok(!deny.some((d) => d.includes(local.landing)), 'nothing denied where the agent may write');
  assert.equal(repos.repoOf(path.join(abs, 'src', 'a.ts'), seo), 'bukutamu');
  assert.equal(repos.repoOf(path.join(root, 'other.txt'), seo), '');
});

test('status and clone on this machine (a local bare remote)', async () => {
  const bare = path.join(root, 'remote.git'), work = path.join(root, 'seed');
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  fs.writeFileSync(path.join(work, 'README.md'), 'x\n');
  execFileSync('git', ['-C', work, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qam', 'x', '--allow-empty']);
  execFileSync('git', ['-C', work, 'add', '.']); execFileSync('git', ['-C', work, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'y']);
  execFileSync('git', ['clone', '-q', '--bare', work, bare]);
  assert.deepEqual(await repos.status(path.join(root, 'missing')), { exists: false });
  await assert.rejects(repos.clone({ id: 'x' }, path.join(root, 'c1')), /no remote/);
  const st = await repos.clone({ id: 'x', remote: bare }, path.join(root, 'c1'));      // a path remote is fine for clone itself
  assert.deepEqual([st.git, st.branch, st.dirty], [true, 'main', 0]);
  fs.writeFileSync(path.join(root, 'c1', 'new.txt'), 'x');
  assert.equal((await repos.status(path.join(root, 'c1'))).dirty, 1);
  await assert.rejects(repos.clone({ id: 'x', remote: bare }, path.join(root, 'c1')), /already exists/);
});
