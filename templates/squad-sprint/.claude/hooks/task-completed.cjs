#!/usr/bin/env node
// Squad Sprint quality gate when a task is about to be completed (TaskCompleted hook).
// Exit 2 = refuse (the task stays open, stderr goes to the agent). Exit 0 = pass.
// Task names (words 1 and 2 are read):  BUILD M01 Login  |  QA M01 Login  |  BUG M01-B01 Save does nothing
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ROOT, config, readInput, squadDir, read, status, mdFiles, strings, reject } = require('./squad-lib.cjs');

const input = readInput();
const cfg = config();
const docs = cfg.SQUAD_DOCS || 'docs/squad';
const dir = squadDir(cfg);
if (cfg.HOOK_DEBUG === '1') fs.writeFileSync(path.join(dir, '.hook-log', 'task-completed-last.json'), JSON.stringify(input, null, 2));

// field names are not fully documented: try a few, then the first string that starts with BUILD/QA/BUG
const TASK = /^\s*\[?(BUILD|QA|BUG)\]?\s+M\d/i;
const subject = [input.task_subject, input.task && input.task.subject, input.subject, input.task_title, input.task && input.task.title].find((s) => typeof s === 'string' && s)
  || strings(input).find((s) => TASK.test(s)) || '';
const words = subject.replace(/[[\]:]/g, '').trim().split(/\s+/);
const kind = (words[0] || '').toUpperCase(), id = (words[1] || '').toUpperCase();
if (!['BUILD', 'QA', 'BUG'].includes(kind) || !id) process.exit(0);

function runTests() {
  if (!cfg.TEST_CMD) return;
  try { execSync(cfg.TEST_CMD, { cwd: ROOT, stdio: 'pipe', shell: '/bin/bash', timeout: 14 * 60e3 }); }
  catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.split('\n').slice(-40).join('\n');
    reject(`Quality gate: tests FAILED for ${id}. Fix them before completing the task.\nCommand: ${cfg.TEST_CMD}\n--- last 40 lines ---\n${out}`);
  }
}

if (kind === 'BUILD') {
  if (!fs.existsSync(path.join(dir, 'handoff', `${id}.md`))) reject(`Quality gate: no handoff note yet.\nWrite ${docs}/handoff/${id}.md (template: ${docs}/templates/handoff.md),\nthen complete the task again and message QA.`);
  runTests();
} else if (kind === 'BUG') {
  const bug = read(path.join(dir, 'bugs', `${id}.md`));
  if (bug === null) reject(`Quality gate: bug file ${docs}/bugs/${id}.md not found.`);
  if (status(bug) !== 'FIXED') reject(`Quality gate: set 'STATUS: FIXED' in ${docs}/bugs/${id}.md\nand fill in the 'Fix' section, then ask QA to retest.`);
  runTests();
} else {
  const report = read(path.join(dir, 'qa', `${id}.md`));
  if (report === null) reject(`Quality gate: no QA report at ${docs}/qa/${id}.md yet.`);
  if (status(report) !== 'PASS') reject(`Quality gate: QA report ${id} is not 'STATUS: PASS'.\nWhile Blocker or Major bugs are open, keep the QA task open: file BUG tasks and wait for the fixes.`);
  const open = mdFiles(path.join(dir, 'bugs')).filter((f) => f.toUpperCase().startsWith(`${id}-`) && ['OPEN', 'FIXED'].includes(status(read(path.join(dir, 'bugs', f))))).map((f) => f.slice(0, -3));
  if (open.length) reject(`Quality gate: bugs for ${id} are not VERIFIED or DEFERRED yet: ${open.join(' ')}\nRetest until they are VERIFIED (or DEFERRED with the lead's approval).`);
}
process.exit(0);
