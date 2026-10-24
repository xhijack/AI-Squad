#!/usr/bin/env node
// Squad Sprint board gate (PostToolUse on Edit / Write / MultiEdit / Bash). Teammates may not have a team
// task list, so docs/squad/TASKS.md is where work is marked done, and agents change it any way they like
// (editor tools or sed and heredocs in Bash). After every such tool call the board is compared with the last
// accepted version: a BUILD, BUG or QA row newly marked DONE that does not pass the same checks as the
// TaskCompleted gate is put back to its previous status, and the agent is told why (exit 2).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, config, readInput, squadDir, read, reject, checkTask, taskOf } = require('./squad-lib.cjs');

const input = readInput();
const cfg = config();
const dir = squadDir(cfg);
const board = path.join(dir, 'TASKS.md');
const now = read(board);
if (now === null) process.exit(0);

// last accepted board: kept inside .git so it never makes the working tree dirty
let gitDir = '';
try { gitDir = execFileSync('git', ['-C', ROOT, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a git repo */ }
const snapFile = gitDir ? path.join(gitDir, 'aisquad-board-snapshot.md') : '';
let before = snapFile ? read(snapFile) : null;
if (before === null) {
  const rel = path.relative(ROOT, board).split(path.sep).join('/');
  try { before = execFileSync('git', ['-C', ROOT, 'show', `HEAD:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { before = ''; }
}
if (before === now) process.exit(0);

// rows of the first table with Task and Status columns: Map(task -> { line, status, statusCol })
function rows(md) {
  const out = new Map();
  const lines = md.split('\n');
  const cells = (l) => (l.trim().startsWith('|') ? l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) : null);
  for (let i = 0; i < lines.length - 1; i++) {
    const head = cells(lines[i]);
    if (!head || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const it = head.findIndex((h) => /^task$/i.test(h)), is = head.findIndex((h) => /^status$/i.test(h));
    if (it < 0 || is < 0) continue;
    for (let j = i + 2; j < lines.length; j++) {
      const r = cells(lines[j]);
      if (!r) break;
      if (r[it]) out.set(r[it], { index: j, line: lines[j], status: r[is] || '', statusCol: is });
    }
    return out;
  }
  return out;
}
const done = (s) => /^(DONE|VERIFIED|PASS)/i.test(String(s).trim());
const old = rows(before), cur = rows(now);
const problems = [], checked = [];
const lines = now.split('\n');
for (const [name, row] of cur) {
  if (!done(row.status) || done(old.get(name)?.status || '')) continue;
  const task = taskOf(name);
  if (!task) continue;
  checked.push(name);
  const why = checkTask(task.kind, task.id, cfg, dir);
  if (!why) continue;
  problems.push(`${name}: ${why}`);
  // put this row back: its previous line, or the same row with status TODO when it is new
  const prev = old.get(name);
  lines[row.index] = prev ? prev.line : `| ${row.line.trim().replace(/^\||\|$/g, '').split('|').map((c, k) => (k === row.statusCol ? 'TODO' : c.trim())).join(' | ')} |`;
}
const accepted = problems.length ? lines.join('\n') : now;
if (problems.length) fs.writeFileSync(board, accepted);
if (snapFile) fs.writeFileSync(snapFile, accepted);
if (cfg.HOOK_DEBUG === '1') fs.appendFileSync(path.join(dir, '.hook-log', 'board-gate.log'), `${new Date().toISOString()} ${input.tool_name || '?'} ${problems.length ? 'REVERTED' : 'accepted'} ${checked.join(', ') || '(no new DONE rows)'}\n`);
if (problems.length) reject(`Board gate: these tasks were put back on docs/squad/TASKS.md because they do not pass the quality gate yet.\n\n${problems.join('\n\n')}`);
process.exit(0);
