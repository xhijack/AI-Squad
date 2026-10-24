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
  const wait = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((ok) => setTimeout(ok, 100)); } return null; };

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
});
