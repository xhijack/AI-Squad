import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, config } from '../server/config.js';
import * as tm from '../server/tmux.js';

const root = scratch({ seed: false });
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.cjs');

const NUMBERED = `
 Bash command

   git reset --hard HEAD~1
   Reset the branch

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for git reset commands in /home/x/proj
   3. No, and tell Claude what to do differently (esc)

 Esc to cancel · Tab to amend
`;
const TRUST = `
╭──────────────────────────────────────────────╮
│ Do you trust the files in this folder?       │
│                                              │
│ /home/erpnext/aisquad/playground/acme        │
╰──────────────────────────────────────────────╯

 ❯ Yes, I trust this folder
   No, exit

 Enter to confirm · Esc to exit
`;
const ASK = `
 ☐ Database

 Which database should we use?

 ❯ 1. PostgreSQL
     Battle-tested relational database
   2. SQLite
     Single file, zero setup
   3. Type something.

 Enter to select · ↑/↓ to navigate · Esc to cancel
`;
const CHAT_LIST = `
⏺ Here is the plan:
  1. Create the DocType
  2. Add the report

╭──────────────────────────────────────╮
│ ❯                                    │
╰──────────────────────────────────────╯
  ? for shortcuts
`;

test('numbered permission dialog', () => {
  const p = tm.parsePrompt(NUMBERED);
  assert.equal(p.selected, 1);
  assert.deepEqual(p.options.map((o) => o.n), [1, 2, 3]);
  assert.equal(p.options[0].label, 'Yes');
  assert.match(p.question, /Do you want to proceed\?/);
});

test('unnumbered trust dialog', () => {
  const p = tm.parsePrompt(TRUST);
  assert.deepEqual(p.options.map((o) => o.label), ['Yes, I trust this folder', 'No, exit']);
  assert.equal(p.selected, 1);
  assert.match(p.question, /trust the files/);
});

test('AskUserQuestion dialog with descriptions and a free-text option', () => {
  const p = tm.parsePrompt(ASK);
  assert.deepEqual(p.options.map((o) => o.label), ['PostgreSQL', 'SQLite', 'Type something.']);
  assert.equal(p.options[2].free, true);
  assert.match(p.question, /Which database/);
});

test('a numbered list in the conversation is not a dialog', () => {
  assert.equal(tm.parsePrompt(CHAT_LIST), null);
  assert.equal(tm.inputLine(CHAT_LIST), '');
  assert.equal(tm.isReady(CHAT_LIST), true);
  assert.equal(tm.isReady(TRUST), false);
});

// as captured with -e from Claude Code 2.1: the prompt suggestion is dim after "❯ " (NBSP), the hint line too
const GHOST = '\x1b[37m' + '─'.repeat(40) + '\x1b[39m\n\x1b[39m❯\u00a0\x1b[2mtemplate undangan baru di katalog\x1b[0m\x1b[39m\x1b[49m\n\x1b[37m' + '─'.repeat(40) + '\x1b[39m\n  \x1b[93m⏵⏵ auto mode on\x1b[2m\x1b[37m (shift+tab to cycle)\x1b[0m';
test('a dim prompt suggestion in the input box is not typed input', () => {
  assert.equal(tm.inputLine(GHOST), '');
  assert.equal(tm.isReady(GHOST), true);
  // the cursor in reverse video on the suggestion's first letter
  assert.equal(tm.inputLine(GHOST.replace('\x1b[2mtemplate', '\x1b[7mt\x1b[27m\x1b[2memplate')), '');
  // typed text stays, also next to colours whose parameters contain a 2 (38;5;2, 38;2;r;g;b)
  assert.equal(tm.inputLine('\x1b[2m❯\u00a0\x1b[0m\x1b[38;5;2mfix the login\x1b[38;2;20;20;20m page\x1b[0m'), 'fix the login page');
  assert.equal(tm.inputLine('❯ \x1b[1mbold\x1b[22m text \x1b[2mand a hint\x1b[22m'), 'bold text');
  // a busy session draws the marker dim
  assert.equal(tm.inputLine('\x1b[2m❯\u00a0\x1b[0m'), '');
  assert.equal(tm.stripDim('a\x1b[2mb\nc\x1b[0md'), 'a\x1b[2m\n\x1b[0md');
});

test('busy detection', () => {
  assert.equal(tm.isBusy('✻ Cogitating… (12s · esc to interrupt)'), true);
  assert.equal(tm.isBusy(CHAT_LIST), false);
});

const hasTmux = (() => { try { execFileSync('tmux', ['-V']); return true; } catch { return false; } })();

test('end to end with a fake Claude Code in tmux: dialog, answer, typed task', { skip: !hasTmux }, async () => {
  const cwd = path.join(root, 'proj'); fs.mkdirSync(cwd);
  const log = path.join(root, 'fake.log');
  process.env.FAKE_CLAUDE_LOG = log;
  configure({ claudeBin: FAKE, useSystemd: false });
  after(() => { try { execFileSync('tmux', ['-L', config.tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch { /* already gone */ } });
  const name = tm.sessionName('acme', 'rina-pm');
  assert.equal(name, 'aisquad-acme-rina-pm');
  const r = await tm.startSession({ name, cwd, agentId: 'rina-pm', disallowedTools: ['Bash(git push*)'] });
  assert.equal(r.ok, true);
  assert.deepEqual(tm.listSessions(), [name]);
  // its own tmux server: nothing on the shared one
  const own = tm.socketOf(name);
  assert.equal(own, `${config.tmuxSocket}--${name}`);
  assert.ok(fs.existsSync(path.join(tm.tmuxDir(), own)));
  assert.equal(tm.tmux(['has-session', '-t', `=${name}`]), null, 'not on the shared server');
  assert.equal(tm.attachCommand(name), `tmux -L ${own} attach -t ${name}`);
  const wait = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((ok) => setTimeout(ok, 100)); } return null; };

  // a small client cannot shrink the agent window (dialogs would be cut off)
  tm.tmux(['resize-window', '-t', `=${name}:`, '-x', '80', '-y', '7'], own);
  tm.keepSize(name);
  assert.equal(tm.tmux(['display', '-p', '-t', `=${name}:`, '#{window_width}x#{window_height} #{window-size}'], own).trim(), '200x50 manual');
  const dialog = await wait(() => tm.parsePrompt(tm.capture(name)));
  assert.ok(dialog, 'trust dialog visible');
  assert.equal(dialog.options.length, 2);
  // never type a task into a dialog
  const refused = await tm.typeTask(name, 'hello');
  assert.equal(refused.ok, false);
  assert.equal(refused.dialog, true);

  assert.equal(tm.answerDialog(name, dialog, 1).ok, true);
  assert.ok(await wait(() => tm.isReady(tm.capture(name))), 'input box after answering');

  const long = 'Build the coffee catalogue page with filters for origin, roast and price. '.repeat(4).trim();
  const sent = await tm.typeTask(name, long, { settleMs: 100, verifyMs: 400 });
  assert.equal(sent.ok, true, sent.error);
  assert.ok(await wait(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes(`TASK ${long}`)), 'task submitted once, intact');
  assert.equal(fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('TASK')).length, 1);

  // numbered dialog: choose option 3 with arrow keys
  await tm.typeTask(name, 'ask', { settleMs: 50, verifyMs: 300 });
  const perm = await wait(() => tm.parsePrompt(tm.capture(name)));
  assert.ok(perm, 'permission dialog visible');
  assert.equal(perm.options.length, 3);
  tm.answerDialog(name, perm, 3);
  assert.ok(await wait(() => fs.readFileSync(log, 'utf8').includes('ANSWER ask 3')));

  const stopped = tm.stopSession(name);
  assert.equal(stopped.ok, true);
  assert.equal(tm.isRunning(name), false);
  for (const pid of stopped.pids) assert.throws(() => process.kill(pid, 0), 'pane process ended even though it ignores SIGHUP');
  assert.equal(fs.existsSync(path.join(tm.tmuxDir(), own)), false, 'its server and socket are gone');
});

test('agents on separate servers: killing one server leaves the others running', { skip: !hasTmux }, async () => {
  configure({ claudeBin: FAKE, useSystemd: false });
  const cwd = path.join(root, 'proj2'); fs.mkdirSync(cwd);
  const [a, b] = [tm.sessionName('shop', 'lead'), tm.sessionName('shop', 'dev')];
  for (const [n, id] of [[a, 'lead'], [b, 'dev']]) assert.equal((await tm.startSession({ name: n, cwd, agentId: id })).ok, true);
  assert.deepEqual(tm.listSessions().sort(), [b, a]);
  tm.tmux(['kill-server'], tm.socketOf(a));                      // what an out of memory kill of one scope does
  assert.equal(tm.isRunning(a), false);
  assert.equal(tm.isRunning(b), true);
  assert.deepEqual(tm.listSessions(), [b]);
  tm.stopSession(b);
});

test('sessions started by older versions on the shared server are still found, typed into and stopped', { skip: !hasTmux }, async () => {
  const cwd = path.join(root, 'proj3'); fs.mkdirSync(cwd);
  const name = tm.sessionName('old', 'rina-pm');
  execFileSync('tmux', ['-L', config.tmuxSocket, 'new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', cwd, process.execPath, FAKE]);
  // another Building's per-agent server with the same session name is not ours
  execFileSync('tmux', ['-L', `other-building--${name}`, 'new-session', '-d', '-s', name, 'sleep 30']);
  after(() => { try { execFileSync('tmux', ['-L', `other-building--${name}`, 'kill-server'], { stdio: 'ignore' }); } catch { /* gone */ } fs.rmSync(path.join(tm.tmuxDir(), `other-building--${name}`), { force: true }); });
  assert.deepEqual(tm.listSessions(), [name]);
  assert.equal(tm.isRunning(name), true);
  assert.equal(tm.attachCommand(name), `tmux -L ${config.tmuxSocket} attach -t ${name}`);
  const wait = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((ok) => setTimeout(ok, 100)); } return null; };
  const dialog = await wait(() => tm.parsePrompt(tm.capture(name)));
  assert.ok(dialog, 'screen read from the shared server');
  assert.equal(tm.answerDialog(name, dialog, 1).ok, true);
  assert.ok(await wait(() => tm.isReady(tm.capture(name))));
  assert.equal((await tm.startSession({ name, cwd, agentId: 'rina-pm' })).already, true, 'not started a second time on its own server');
  assert.equal(tm.stopSession(name).ok, true);
  assert.equal(tm.isRunning(name), false);
  assert.ok(fs.existsSync(path.join(tm.tmuxDir(), `other-building--${name}`)), 'other servers untouched');
});

test('socket names stay short enough for a unix socket path', () => {
  const long = tm.sessionName('a-very-long-floor-name-for-a-squad-'.repeat(2), 'and-an-even-longer-agent-display-name-id');
  const s = tm.socketOf(long);
  assert.ok(path.join(tm.tmuxDir(), s).length <= 100);
  assert.equal(tm.socketOf(long), s, 'stable');
  assert.notEqual(tm.socketOf(long + 'x'), s);
});
