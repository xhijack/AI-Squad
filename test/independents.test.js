// Floor 1: independent agents found by the first-run scan (fake /proc, the private tmux server and the
// fake Claude Code), their desks and Attention, and adoption into a squad.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratch, jsonl } from './helpers.js';
import { config } from '../server/config.js';
import * as ind from '../server/independents.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import * as tm from '../server/tmux.js';
import { projectDir } from '../server/transcripts.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.cjs');
const proc = config.procDir;
const dir = (n) => { const d = path.join(root, n); fs.mkdirSync(d, { recursive: true }); return d; };
const shop = dir('shop'), blog = dir('blog'), notes = dir('notes');
function fakeProc(pid, { comm = 'claude', ppid = 1, cwd, argv = ['claude'], env = ['TERM=xterm'] }) {
  const d = path.join(proc, String(pid));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'stat'), `${pid} (${comm}) S ${ppid} 1 1 0`);
  fs.writeFileSync(path.join(d, 'cmdline'), argv.join('\0'));
  fs.writeFileSync(path.join(d, 'environ'), env.join('\0'));
  fs.symlinkSync(cwd, path.join(d, 'cwd'));
}
fakeProc(101, { cwd: shop });                                              // a terminal session
fakeProc(102, { cwd: shop, argv: ['/x/.vscode/extensions/claude'] });     // a second one in the same repo (VS Code)
fakeProc(103, { cwd: blog, env: ['AISQUAD_AGENT=f/a'] });                  // started by The AI Squad: not independent
fakeProc(104, { cwd: blog, argv: ['claude', '-p', 'hi'] });                // print mode: not an agent
fakeProc(105, { comm: 'node', cwd: blog });                                // not claude
// notes has only recent transcripts
fs.mkdirSync(projectDir(notes), { recursive: true });
fs.writeFileSync(path.join(projectDir(notes), 's1.jsonl'), jsonl([{ type: 'user', cwd: notes, timestamp: new Date().toISOString(), message: { content: 'hello' } }]));

after(() => { try { execFileSync('tmux', ['-L', config.tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ } });

test('finds live claude processes and recent projects, skipping our own sessions and print runs', () => {
  const procs = ind.claudeProcesses();
  assert.deepEqual(procs.map((p) => [p.pid, p.cwd, p.via]), [[101, shop, ''], [102, shop, 'VS Code']]);
  const found = ind.detect({ procs, panes: [], projects: [{ root: notes, lastActive: Date.now() }, { root: blog, lastActive: Date.now() - 2 * 864e5 }] });
  assert.deepEqual(found.map((c) => [c.key, c.live, c.via]), [[`root:${shop}#1`, true, 'terminal'], [`root:${shop}#2`, true, 'VS Code'], [`root:${notes}#1`, false, 'transcripts']]);
  const floorRoots = ind.detect({ procs, panes: [], projects: [{ root: notes, lastActive: Date.now() }], floorRoots: [notes] });
  assert.equal(floorRoots.length, 2, 'transcripts of squad Floors belong to the Floor');
});

test('a claude process in a tmux pane is identified by its pane; panes of our sessions are ours', () => {
  const procs = [{ pid: 201, ppid: 200, cwd: blog, via: '' }, { pid: 301, ppid: 300, cwd: blog, via: '' }];
  const panes = [{ session: 'work', pane: '0.1', target: '=work:0.1', pid: 200, aisquad: false }, { session: 'aisquad-x-y', pane: '0.0', target: '=aisquad-x-y:0.0', pid: 300, aisquad: true }];
  assert.deepEqual(ind.detect({ procs, panes, projects: [] }).map((c) => [c.key, c.tmux?.target]), [['tmux:work:0.1', '=work:0.1']]);
});

test('scan keeps ids stable across rescans and the registry lives in ~/.aisquad, not in the repos', () => {
  const opts = { panes: [], projects: [{ root: notes, lastActive: Date.now() }] };
  const first = ind.scan(opts).map((a) => a.id);
  assert.deepEqual(first, ['shop', 'shop-2', 'notes']);
  assert.deepEqual(ind.scan(opts).map((a) => a.id), first);
  assert.ok(fs.existsSync(path.join(config.home, 'independents.json')));
  for (const d of [shop, notes]) assert.deepEqual(fs.readdirSync(d), [], 'nothing written into their repos');
});

test('Floor 1 in the Building: desks, a dialog in Attention answered in the pane, adoption into a squad', async () => {
  // an independent agent in tmux (fake Claude shows its trust dialog)
  execFileSync('tmux', ['-L', config.tmuxSocket, 'new-session', '-d', '-s', 'solo', '-x', '120', '-y', '40', '-c', blog, process.execPath, FAKE]);
  const pane = tm.listPanes(config.scanTmuxSocket).find((p) => p.session === 'solo');
  fakeProc(pane.pid, { cwd: blog });
  for (let i = 0; i < 40 && !tm.parsePrompt(tm.capturePane(pane.target, config.scanTmuxSocket)); i++) await new Promise((r) => setTimeout(r, 100));
  squad.rescanIndependents();
  let b = squad.buildingSnapshot();
  const f1 = b.floors.find((f) => f.number === 1);
  assert.equal(f1.id, 'independents');
  assert.deepEqual(f1.agents.map((a) => [a.id, a.state]).sort(), [['blog-solo', 'waiting'], ['notes', 'stopped'], ['shop', 'idle'], ['shop-2', 'idle']]);
  const item = b.attention.find((a) => a.agentId === 'blog-solo');
  assert.equal(item.answerable, true);
  assert.match(item.text, /trust/);
  const desk = squad.deskDetail('independents', 'blog-solo');
  assert.match(desk.screen, /Do you trust/);
  assert.equal(desk.attach, 'tmux attach -t solo:0.0');
  squad.answerAttention(item.id, 1);
  for (let i = 0; i < 40 && tm.parsePrompt(tm.capturePane(pane.target, config.scanTmuxSocket)); i++) await new Promise((r) => setTimeout(r, 100));
  squad.rescanIndependents();
  assert.equal(squad.buildingSnapshot().floors.find((f) => f.number === 1).agents.find((a) => a.id === 'blog-solo').state, 'idle');

  // adopt into a squad on Floor 2: it joins that team and leaves Floor 1
  const proj = path.join(root, 'squad');
  const r = await floors.createFloor({ name: 'Squad', directory: { mode: 'new', path: proj }, team: [] });
  assert.equal(r.entry.number, 2);
  const res = squad.adoptIndependent('shop', { floorId: r.entry.id, template: 'fullstack-developer', displayName: 'Shop Dev' });
  assert.equal(res.agent.id, 'shop-dev');
  b = squad.buildingSnapshot();
  assert.equal(b.floors.find((f) => f.number === 1).agents.some((a) => a.id === 'shop'), false);
  assert.deepEqual(b.floors.find((f) => f.number === 2).agents.map((a) => a.id), ['shop-dev']);
});
