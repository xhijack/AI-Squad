import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import * as libraries from '../server/libraries.js';
import * as roles from '../server/roles.js';

const root = scratch();
const remote = path.join(root, 'team-roles');
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const tpl = (role, title, version, extra = '') => `---\nrole: ${role}\ntitle: ${title}\nversion: ${version}\nmodel: sonnet\n---\n## Rules\n- Team rule.${extra}\n\n## Prompt\nYou are the ${title}.\n`;
function commitFile(f, text, msg) {
  fs.mkdirSync(path.dirname(path.join(remote, f)), { recursive: true });
  fs.writeFileSync(path.join(remote, f), text);
  g(remote, 'add', '-A'); g(remote, 'commit', '-q', '-m', msg);
}
fs.mkdirSync(remote);
g(remote, 'init', '-q', '-b', 'main');
g(remote, 'config', 'user.name', 'Team'); g(remote, 'config', 'user.email', 'team@example.com');
commitFile('roles/release-manager.md', tpl('release-manager', 'Release Manager', 2), 'feat: release');
commitFile('roles/qa-engineer.md', tpl('qa-engineer', 'Team QA', 5), 'feat: team qa');
commitFile('README.md', '# Team roles\n', 'docs: readme');

test('a git library is cloned, read-only, and shows its version', async () => {
  libraries.addLibrary({ name: 'Team', url: remote });
  assert.throws(() => libraries.addLibrary({ name: 'team', url: remote }), /already exists/);
  const st = await libraries.pull('team');
  assert.equal(st.kind, 'git');
  assert.equal(st.templates, 2, 'README is not a template');
  assert.equal(st.version.commit, g(remote, 'log', '-1', '--format=%h'));
  assert.equal(st.version.subject, 'docs: readme');
  assert.ok(fs.existsSync(path.join(libraries.cacheDir('team'), 'roles', 'release-manager.md')));
  const d = roles.getTemplate('release-manager');
  assert.equal(d.source, 'team');
  assert.equal(d.version, 2);
  assert.equal(roles.getTemplate('qa-engineer').source, 'local', 'local library wins');
  assert.throws(() => roles.saveTemplate({ role: 'release-manager', title: 'X' }), /read-only/);
});

test('pull on demand brings new versions and discards local edits in the cache', async () => {
  commitFile('roles/release-manager.md', tpl('release-manager', 'Release Manager', 3, '\n- Use Terraform.'), 'feat: release v3');
  fs.writeFileSync(path.join(libraries.cacheDir('team'), 'roles', 'qa-engineer.md'), 'tampered');
  assert.equal(roles.getTemplate('release-manager').version, 2, 'not pulled yet');
  const st = await libraries.pull('team');
  assert.equal(st.version.subject, 'feat: release v3');
  assert.equal(roles.getTemplate('release-manager').version, 3);
  assert.equal(roles.libraryTemplates('team').find((t) => t.role === 'qa-engineer').title, 'Team QA');
});

test('copy a library template into the local library', () => {
  const r = roles.copyToLocal('team', 'release-manager');
  assert.equal(r.template.source, 'local');
  assert.equal(r.template.version, 1);
  assert.deepEqual(r.template.rules, ['Team rule.', 'Use Terraform.']);
  assert.equal(roles.getTemplate('release-manager').writable, true, 'the local copy now shadows the library');
  assert.throws(() => roles.copyToLocal('team', 'qa-engineer'), /already exists/);
  assert.equal(roles.copyToLocal('team', 'qa-engineer', 'team-qa').template.title, 'Team QA');
  assert.throws(() => roles.copyToLocal('team', 'nope'), /not in library/);
});

test('bad entries are refused; removing a library deletes its cache', async () => {
  assert.throws(() => libraries.addLibrary({ name: 'x', url: '--upload-pack=evil' }), /URL/);
  assert.throws(() => libraries.addLibrary({ name: 'local', url: remote }), /not "local"/);
  assert.throws(() => libraries.addLibrary({ name: 'y', url: remote, subdir: '../..' }), /inside/);
  libraries.addLibrary({ name: 'broken', url: path.join(root, 'missing.git') });
  await assert.rejects(libraries.pull('broken'), /git clone failed/);
  libraries.removeLibrary('broken');
  libraries.removeLibrary('team');
  assert.ok(!fs.existsSync(libraries.cacheDir('team')));
  assert.deepEqual((await libraries.listStatus()).map((l) => l.name), []);
  assert.equal(roles.getTemplate('release-manager').source, 'local', 'local copy stays');
});
