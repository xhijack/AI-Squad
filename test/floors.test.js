import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import * as floors from '../server/floors.js';
import * as roles from '../server/roles.js';
import * as building from '../server/building.js';
import { parseFrontmatter } from '../server/frontmatter.js';

const root = scratch();
const proj = path.join(root, 'projects', 'acme-shop');
const read = (...p) => fs.readFileSync(path.join(proj, ...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));

test('New Floor wizard: new directory, git init, all files generated, registered', async () => {
  const r = await floors.createFloor({
    name: 'Acme Shop', goal: 'Sell coffee beans online.', directory: { mode: 'new', path: proj },
    git: { qualityGate: 'npm test', branchStrategy: 'agent-branches' }, workflow: 'free-team', layout: 'pods',
    team: [
      { displayName: 'Rina - Project Manager', template: 'project-manager', lead: true },
      { displayName: 'Ramdani - Frappe Developer', template: 'frappe-developer', overrides: { model: 'opus', skills: { add: ['playwright'] }, rules: ['Only touch apps/acme.'] } },
      { displayName: 'Ramdani - Frappe Developer', template: 'frappe-developer' },
    ],
  });
  assert.equal(r.entry.number, 2);
  assert.ok(fs.existsSync(path.join(proj, '.git')));
  assert.equal(execFileSync('git', ['-C', proj, 'log', '--format=%s', 'main'], { encoding: 'utf8' }).trim(), 'chore: set up The AI Squad Floor', 'main exists with the scaffold');
  assert.equal(execFileSync('git', ['-C', proj, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  const team = json('.claude/aisquad/team.json');
  assert.deepEqual(team.agents.map((a) => a.id), ['rina-project-manager', 'ramdani-frappe-developer', 'ramdani-frappe-developer-2']);
  assert.deepEqual(team.agents[1].role, { template: 'frappe-developer', version: 1 });
  assert.equal(team.agents[0].lead, true);
  assert.equal(json('.claude/aisquad/floor.json').layout, 'pods');
  assert.equal(json('.claude/aisquad/git.json').mergePolicy, 'auto');
  assert.ok(fs.existsSync(path.join(proj, '.claude/aisquad/roles.lock/frappe-developer@1.md')));
  assert.ok(fs.existsSync(path.join(proj, '.claude/aisquad/roles.lock/project-manager@1.md')));
  const agentFile = parseFrontmatter(read('.claude/agents/ramdani-frappe-developer.md'));
  assert.equal(agentFile.data.model, 'opus');
  assert.match(agentFile.data.skills, /playwright/);
  assert.match(agentFile.body, /Only touch apps\/acme/);
  assert.match(read('AISQUAD.md'), /Sell coffee beans online/);
  assert.match(read('AISQUAD.md'), /Rina - Project Manager \(lead\)/);
  assert.deepEqual(json('.claude/settings.json').attribution, { commit: '', pr: '' });
  assert.equal(building.loadBuilding().floors[0].path, proj);
});

test('repo files contain no absolute paths', () => {
  for (const f of ['floor.json', 'team.json', 'git.json']) assert.ok(!read('.claude/aisquad', f).includes(root), f);
  for (const f of fs.readdirSync(path.join(proj, '.claude/agents'))) assert.ok(!read('.claude/agents', f).includes(root), f);
});

test('rejects invalid wizard input before touching the disk', async () => {
  await assert.rejects(floors.createFloor({ name: '', directory: { mode: 'new', path: path.join(root, 'x') } }), /name/);
  await assert.rejects(floors.createFloor({ name: 'X', directory: { mode: 'new', path: 'relative/dir' } }), /absolute/);
  await assert.rejects(floors.createFloor({ name: 'X', directory: { mode: 'new', path: path.join(root, 'y') }, team: [{ displayName: 'A', template: 'nope' }] }), /Unknown Role Template/);
  await assert.rejects(floors.createFloor({ name: 'X', directory: { mode: 'existing', path: proj } }), /already a Floor/);
  await assert.rejects(floors.createFloor({ name: 'X', directory: { mode: 'clone', path: path.join(root, 'z'), url: '--upload-pack=evil' } }), /Clone URL/);
  assert.ok(!fs.existsSync(path.join(root, 'y')));
});

test('clone mode clones a repository and remembers the remote', async () => {
  const dest = path.join(root, 'projects', 'acme-clone');
  await floors.createFloor({ name: 'Acme Clone', directory: { mode: 'clone', path: dest, url: proj }, team: [] });
  assert.ok(fs.existsSync(path.join(dest, '.git')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, '.claude/aisquad/git.json'), 'utf8')).remote, proj);
  assert.equal(building.loadBuilding().floors.find((f) => f.path === dest).number, 3);
});

test('template update: Update available, diff, then update / keep / detach per agent', () => {
  roles.saveTemplate({ role: 'frappe-developer', rules: [...roles.getTemplate('frappe-developer').rules, 'Prefer Server Scripts for small hooks.'] });
  const { team } = floors.readFloor(proj);
  const [, a1, a2] = team.agents;
  assert.deepEqual(floors.templateStatus(proj, a1), { latestVersion: 2, updateAvailable: true, keptVersion: null });
  const d = floors.templateDiff(proj, a1);
  assert.equal(d.from, 1); assert.equal(d.to, 2);
  assert.ok(d.diff.some((l) => l.op === '+' && l.text.includes('Prefer Server Scripts')));
  assert.ok(d.diff.some((l) => l.op === '-' && l.text === 'version: 1'));

  floors.templateAction(proj, a1.id, 'update');
  let t = floors.readFloor(proj).team.agents;
  assert.equal(t[1].role.version, 2);
  assert.equal(t[1].overrides.model, 'opus', 'overrides survive the update');
  assert.match(read('.claude/agents/ramdani-frappe-developer.md'), /Prefer Server Scripts/);
  assert.match(read('.claude/agents/ramdani-frappe-developer.md'), /Only touch apps\/acme/);

  floors.templateAction(proj, a2.id, 'keep');
  t = floors.readFloor(proj).team.agents;
  assert.equal(t[2].role.version, 1);
  assert.equal(floors.templateStatus(proj, t[2]).updateAvailable, false);
  assert.doesNotMatch(read('.claude/agents/ramdani-frappe-developer-2.md'), /Prefer Server Scripts/);
  // both versions are locked while in use
  assert.ok(fs.existsSync(path.join(proj, '.claude/aisquad/roles.lock/frappe-developer@1.md')));
  assert.ok(fs.existsSync(path.join(proj, '.claude/aisquad/roles.lock/frappe-developer@2.md')));

  floors.templateAction(proj, a2.id, 'detach');
  t = floors.readFloor(proj).team.agents;
  assert.equal(t[2].role.detached, true);
  assert.equal(t[2].definition.role, 'frappe-developer');
  assert.ok(!fs.existsSync(path.join(proj, '.claude/aisquad/roles.lock/frappe-developer@1.md')), 'unused lock pruned');
  assert.match(read('.claude/agents/ramdani-frappe-developer-2.md'), /detached copy/);
  assert.equal(floors.templateStatus(proj, t[2]).detached, true);
});

test('locked template is used even when the library loses the version', () => {
  fs.rmSync(path.join(root, 'home', 'roles', '.history'), { recursive: true, force: true });
  const a = floors.readFloor(proj).team.agents[0];
  assert.equal(floors.effectiveOf(proj, a).title, 'Project Manager');
});

test('add, update and remove agents; generated files follow', () => {
  const a = floors.addAgent(proj, { displayName: 'Sari - QA', template: 'qa-engineer', overrides: { permissions: { deny: ['Bash(npm publish*)'] } } });
  assert.equal(a.id, 'sari-qa');
  assert.match(read('.claude/agents/sari-qa.md'), /npm publish/);
  assert.throws(() => floors.addAgent(proj, { displayName: 'Bad', template: 'qa-engineer', overrides: { permissions: { allow: ['Bash(*)'] } } }), /stricter/);
  floors.updateAgent(proj, 'sari-qa', { displayName: 'Sari - QA Lead', appearance: { shirt: '#123456' }, lead: true });
  const t = floors.readFloor(proj).team.agents;
  assert.equal(t.find((x) => x.id === 'sari-qa').displayName, 'Sari - QA Lead');
  assert.equal(t.filter((x) => x.lead).length, 1);
  fs.writeFileSync(path.join(proj, '.claude/agents/hand-written.md'), '---\nname: hand-written\n---\nMine.\n');
  floors.removeAgent(proj, 'sari-qa');
  assert.ok(!fs.existsSync(path.join(proj, '.claude/agents/sari-qa.md')));
  assert.ok(fs.existsSync(path.join(proj, '.claude/agents/hand-written.md')), 'hand-written agent files are kept');
  assert.ok(!read('AISQUAD.md').includes('Sari'));
});

test('floor config update keeps desks for known agents only', () => {
  floors.updateFloorConfig(proj, { layout: 'circle', desks: [{ agent: 'rina-project-manager', x: 1, z: 2, ry: 0.5 }, { agent: 'ghost', x: 0, z: 0 }], budget: { usd: 50, period: 'month' }, git: { mergePolicy: 'manual' } });
  const { floor, git } = floors.readFloor(proj);
  assert.equal(floor.layout, 'circle');
  assert.deepEqual(floor.desks, [{ agent: 'rina-project-manager', x: 1, z: 2, ry: 0.5, device: 'laptop' }]);
  assert.deepEqual(floor.budget, { usd: 50, period: 'month' });
  assert.equal(git.mergePolicy, 'manual');
  assert.equal(git.qualityGate, 'npm test', 'unchanged git fields are kept');
});

test('adopt a directory that already has a Floor config (cloned from a teammate)', () => {
  const copy = path.join(root, 'projects', 'teammate');
  execFileSync('cp', ['-r', proj, copy]);
  fs.rmSync(path.join(copy, '.claude/agents'), { recursive: true });
  const e = floors.adoptFloor(copy);
  assert.equal(e.id, 'acme-shop-2');
  assert.ok(fs.existsSync(path.join(copy, '.claude/agents/rina-project-manager.md')));
});

test('per-agent commit identity from team.json / git.json', () => {
  const agent = { id: 'budi-dev', displayName: 'Budi - Dev' };
  assert.equal(floors.commitIdentity(agent, floors.cleanGit({})), null, 'repository default');
  const git = floors.cleanGit({ commitIdentity: 'per-agent' });
  assert.equal(git.agentEmail, '{id}@agents.aisquad.local');
  assert.deepEqual(floors.commitIdentity(agent, git), { GIT_AUTHOR_NAME: 'Budi - Dev', GIT_AUTHOR_EMAIL: 'budi-dev@agents.aisquad.local', GIT_COMMITTER_NAME: 'Budi - Dev', GIT_COMMITTER_EMAIL: 'budi-dev@agents.aisquad.local' });
  assert.equal(floors.commitIdentity(agent, floors.cleanGit({ commitIdentity: 'per-agent', agentEmail: 'bot+{id}@sopwer.net' })).GIT_AUTHOR_EMAIL, 'bot+budi-dev@sopwer.net');
  assert.equal(floors.cleanGit({ agentEmail: 'no-placeholder@x.y' }).agentEmail, '{id}@agents.aisquad.local', 'template needs {id}');
  assert.deepEqual(floors.commitIdentity({ ...agent, git: { name: 'Budi', email: 'budi@sopwer.net' } }, git).GIT_COMMITTER_EMAIL, 'budi@sopwer.net');
  assert.throws(() => floors.cleanAgentGit({ email: 'not an email' }), /Invalid commit email/);
  const a = floors.updateAgent(proj, 'rina-project-manager', { git: { name: 'Rina PM', email: 'rina@sopwer.net' } });
  assert.deepEqual(a.git, { name: 'Rina PM', email: 'rina@sopwer.net' });
  assert.equal(floors.updateAgent(proj, 'rina-project-manager', { git: {} }).git, undefined, 'cleared');
});
