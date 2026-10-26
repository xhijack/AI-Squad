// One squad, several repositories, end to end: repos.json through the Floor, agent files and AISQUAD.md, and the
// arguments an agent really starts with (--add-dir, write rules denied in the read-only repository).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import { configure, config } from '../server/config.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as squad from '../server/squad.js';
import * as mergeLib from '../server/merge.js';
import * as squadLog from '../server/log.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.cjs');
const root = scratch();
const LOG = path.join(root, 'fake.log');
process.env.FAKE_CLAUDE_LOG = LOG;
configure({ claudeBin: FAKE, useSystemd: false, useHooks: false });
after(() => { try { execFileSync('tmux', ['-L', config.tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ } });
const app = path.join(root, 'dtamu-app'), bukutamu = path.join(root, 'dtamu-bukutamu'), landing = path.join(root, 'dtamu-landing-page');
fs.mkdirSync(bukutamu, { recursive: true }); fs.mkdirSync(landing, { recursive: true });
await floors.createFloor({ name: 'DTamu App Squad', directory: { mode: 'new', path: app }, workflow: 'squad-sprint', team: [
  { displayName: 'Rina - PM', template: 'sprint-lead', lead: true }, { displayName: 'Budi - Dev', template: 'sprint-developer' }, { displayName: 'Sari - SEO', template: 'fullstack-developer' }] });
const FLOOR = 'dtamu-app-squad';
const ids = floors.readFloor(app).team.agents.map((a) => a.id), [lead, dev, seo] = ids;

test('the owner sets the linked repositories: checked, written without absolute paths, in every agent file', () => {
  assert.throws(() => floors.updateRepos(app, [{ id: 'x', path: bukutamu, access: 'read' }]), /must be relative/);
  assert.throws(() => floors.updateRepos(app, [{ id: 'x', path: '../x', access: 'write', agents: ['nobody'] }]), /unknown agents nobody/);
  floors.updateRepos(app, [
    { id: 'bukutamu', path: '../dtamu-bukutamu', remote: 'git@github.com:xhijack/dtamu-bukutamu.git', access: 'read' },
    { id: 'landing', path: '../dtamu-landing-page', remote: 'git@github.com:xhijack/dtamu-landing-page.git', access: 'write', agents: [seo], gate: 'npm run build' },
  ]);
  assert.ok(!fs.readFileSync(path.join(app, '.claude/aisquad/repos.json'), 'utf8').includes(root));
  const file = (id) => fs.readFileSync(path.join(app, '.claude/agents', `${id}.md`), 'utf8');
  assert.match(file(seo), /## Repositories[\s\S]*`\.\.\/dtamu-landing-page` \(landing, .*\): you may edit and commit there on your sprint branch[\s\S]*npm run build/);
  assert.match(file(seo), /`\.\.\/dtamu-bukutamu` \(bukutamu, .*\): read only, for context\. Never change files there/);
  assert.doesNotMatch(file(dev), /dtamu-landing-page/, 'landing is for the SEO agent only');
  assert.match(file(lead), /dtamu-landing-page[\s\S]*name the repository of every module/, 'the lead plans for every repository');
  assert.match(fs.readFileSync(path.join(app, 'AISQUAD.md'), 'utf8'), /\*\*Repositories:\*\* this one is the primary[\s\S]*`\.\.\/dtamu-bukutamu` \(bukutamu, read\)/);
});

test('an agent starts with --add-dir for its repositories and every write denied in the read-only one', async () => {
  await squad.startAgent(FLOOR, seo);
  const start = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '').split('\n').filter((l) => l.startsWith('START') && l.includes(`--agent ${seo}`)).at(-1) || '';
  for (let i = 0; i < 40 && !start(); i++) await new Promise((r) => setTimeout(r, 150));
  const s = start();
  assert.match(s, new RegExp(`--add-dir ${bukutamu}`));
  assert.match(s, new RegExp(`--add-dir ${landing}`));
  assert.ok(s.includes(`Edit(/${bukutamu}/**)`) && s.includes(`Write(/${bukutamu}/**)`), 'file writes denied in the read-only repository');
  assert.ok(s.includes(`Bash(git -C ${bukutamu} commit:*)`), 'git writes denied there');
  assert.ok(!s.includes(`Edit(/${landing}/**)`), 'the write repository stays writable for its agent');
  squad.stopAgent(FLOOR, seo);
});

test('a repository elsewhere on this machine: the local path (building.json) wins, the repository file is unchanged', () => {
  const moved = path.join(root, 'elsewhere', 'landing'); fs.mkdirSync(moved, { recursive: true });
  const before = fs.readFileSync(path.join(app, '.claude/aisquad/repos.json'), 'utf8');
  building.setRepoPath(FLOOR, 'landing', moved);
  assert.deepEqual(floors.agentReposOf(app, seo).map((r) => [r.id, r.abs]), [['bukutamu', bukutamu], ['landing', moved]]);
  assert.equal(fs.readFileSync(path.join(app, '.claude/aisquad/repos.json'), 'utf8'), before);
  assert.throws(() => building.setRepoPath(FLOOR, 'landing', 'relative/dir'), /absolute/);
  building.setRepoPath(FLOOR, 'landing', '');
  assert.equal(floors.agentReposOf(app, seo).find((r) => r.id === 'landing').abs, landing);
});

test('merges and gates per repository: its own approval, gate and log; red gates refused; read-only never merged', async () => {
  const g = (...a) => execFileSync('git', ['-C', landing, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', landing]);
  fs.writeFileSync(path.join(landing, 'README.md'), 'landing\n'); g('add', '.'); g('commit', '-qm', 'start');
  g('checkout', '-qb', `${seo}/m01-seo`); fs.writeFileSync(path.join(landing, 'index.html'), '<h1>DTamu</h1>\n'); g('add', '.'); g('commit', '-qm', 'M01 SEO landing'); g('checkout', '-q', 'main');
  g('checkout', '-qb', `${seo}/m02-broken`); fs.writeFileSync(path.join(landing, 'oops.txt'), 'x\n'); g('add', '.'); g('commit', '-qm', 'M02 no index'); g('checkout', '-q', 'main');
  floors.updateRepos(app, [
    { id: 'bukutamu', path: '../dtamu-bukutamu', access: 'read' },
    { id: 'landing', path: '../dtamu-landing-page', access: 'write', agents: [seo], gate: 'test -f index.html' },
  ]);
  const m = (await squad.floorMerges(FLOOR)).repos;
  assert.deepEqual(m.map((r) => [r.id, r.gate, r.candidates.map((c) => c.branch).sort()]), [['landing', 'test -f index.html', [`${seo}/m01-seo`, `${seo}/m02-broken`]]]);
  assert.throws(() => squad.setRepoApproval(FLOOR, 'bukutamu', true), /Only a "write" repository/);
  assert.throws(() => squad.startMerge(FLOOR, 'x', 'bukutamu'), /Only a "write" repository/);
  squad.setRepoApproval(FLOOR, 'landing', true);
  assert.ok((await squad.floorRepos(FLOOR)).repos.find((r) => r.id === 'landing').approval, 'approved for this repository only');
  const log = () => mergeLib.mergeLog(squad.repoKey(FLOOR, 'landing'));
  squad.startMerge(FLOOR, `${seo}/m01-seo`, 'landing');
  for (let i = 0; i < 100 && !log().length; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(log()[0].result, 'merged');
  // the log is written before the temporary worktree is removed: wait until the merge has really ended
  for (let i = 0; i < 100 && mergeLib.isMerging(squad.repoKey(FLOOR, 'landing')); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(fs.existsSync(path.join(landing, 'index.html')) || g('show', 'main:index.html').includes('DTamu'), 'in the landing repository\'s main');
  assert.equal(mergeLib.mergeLog(FLOOR).length, 0, 'the primary repository\'s merge log is separate');
  // a gate that fails on this branch's merged result
  floors.updateRepos(app, [{ id: 'bukutamu', path: '../dtamu-bukutamu', access: 'read' }, { id: 'landing', path: '../dtamu-landing-page', access: 'write', agents: [seo], gate: 'test ! -f oops.txt' }]);
  squad.startMerge(FLOOR, `${seo}/m02-broken`, 'landing');
  for (let i = 0; i < 100 && log().length < 2; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(log()[0].result, 'refused', 'a red gate in that repository refuses it');
  assert.ok(!g('ls-tree', '--name-only', 'main').split('\n').includes('oops.txt'), 'main untouched');
  const ev = squadLog.read(FLOOR, { type: 'merge.done,merge.refused' });
  assert.ok(ev.length >= 2 && ev.every((e) => e.repo === 'landing'), 'merges are logged with their repository');
});

test('the Log records the repository of tool calls in linked repositories', () => {
  squad.logEvent(FLOOR, { type: 'tool.call', agent: seo, data: { tool: 'Read', target: path.join(bukutamu, 'src/checkin.ts'), ok: true } });
  squad.logEvent(FLOOR, { type: 'tool.call', agent: seo, data: { tool: 'Bash', target: 'cd ../dtamu-landing-page && npm run build', ok: true } });
  squad.logEvent(FLOOR, { type: 'tool.call', agent: seo, data: { tool: 'Read', target: 'docs/squad/PLAN.md', ok: true } });
  const tools = squadLog.read(FLOOR, { type: 'tool.call' }).filter((e) => e.agent === seo);
  assert.deepEqual(tools.slice(-3).map((e) => e.repo || ''), ['bukutamu', 'landing', '']);
  assert.equal(squadLog.read(FLOOR, { type: 'tool.call', repo: 'primary' }).filter((e) => e.agent === seo).length, 1);
});
