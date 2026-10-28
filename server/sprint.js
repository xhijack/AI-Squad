// SPDX-License-Identifier: Apache-2.0
// Squad Sprint pack (decision D4, optional): scaffolds the lead / developer / QA setup into a Floor
// (config, gate hooks, /sprint command, docs/squad board), reads the board, and decides when a sprint
// is closed so the server can merge it and optionally start the next sprint.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT } from './config.js';
import { readText, readJson, writeJson, writeText } from './util.js';

export const PACK = path.join(ROOT, 'templates', 'squad-sprint');
const CONFIG = (root) => path.join(root, '.claude', 'squad', 'config.sh');
const SQUAD = (root) => path.join(root, 'docs', 'squad');

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base)); else out.push(path.relative(base, p));
  }
  return out;
}

export function roleKind(agent) {
  const t = agent.role?.template || '';
  if (agent.lead || t === 'sprint-lead' || t === 'project-manager') return 'lead';
  if (t === 'sprint-qa' || t === 'qa-engineer') return 'qa';
  return 'dev';
}

const shQuote = (s) => String(s || '').replace(/(["\\$`])/g, '\\$1');

// copy the pack; existing files are never overwritten. Returns the files created.
export function scaffold(root, { git = {}, agents = [] } = {}) {
  const created = [];
  for (const rel of walk(PACK)) {
    const dest = path.join(root, rel);
    if (fs.existsSync(dest)) continue;
    let text = fs.readFileSync(path.join(PACK, rel), 'utf8');
    if (rel.endsWith('config.sh')) text = text.replace('{{TEST_CMD}}', shQuote(git.qualityGate));
    writeText(dest, text);
    if (rel.endsWith('.cjs') && rel.includes('hooks')) fs.chmodSync(dest, 0o755);
    created.push(rel);
  }
  mergeSettings(root, { qualityGate: git.qualityGate });
  updateTeamBlock(root, agents);
  return created;
}

// Teammates run as background agents: without allow rules every Write or command needs a prompt they
// cannot show (and auto mode refuses background writes it cannot classify). Same idea as dtamu-app's settings.
export const SQUAD_ALLOW = ['Edit', 'Write', 'Bash(node *)', 'Bash(npm test*)', 'Bash(npm run test*)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)',
  'Bash(git show*)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git switch *)', 'Bash(git branch*)', 'Bash(git rev-parse*)', 'Bash(git mv *)',
  'Bash(ls*)', 'Bash(mkdir *)', 'Bash(mv docs/squad/*)', 'Bash(cp *)', 'Bash(cat *)'];
// real env files by name, so .env.example (variable names only, owned by DevOps) stays readable
export const SECRET_DENY = ['Read(./.env)', 'Read(./.env.local)', 'Read(./.env.*.local)', 'Read(./.env.prod*)', 'Read(./.env.stag*)', 'Read(./.env.dev*)', 'Read(./.env.test*)', 'Read(./.env.secret*)'];
export const SQUAD_DENY = [...SECRET_DENY, 'Bash(git push*)', 'Bash(git reset --hard*)', 'Bash(rm -rf *)', 'Bash(* --force*)'];

// .claude/settings.json: agent teams on, permission rules, TaskCompleted / TeammateIdle gate hooks (merged, idempotent)
export function mergeSettings(root, { qualityGate = '' } = {}) {
  // hook scripts added in later versions (edit-lock.cjs since 0.5.4) reach older packs before settings point at them
  for (const f of fs.readdirSync(path.join(PACK, '.claude', 'hooks'))) {
    const dest = path.join(root, '.claude', 'hooks', f);
    if (!fs.existsSync(dest) && fs.existsSync(path.join(root, '.claude', 'squad'))) { writeText(dest, fs.readFileSync(path.join(PACK, '.claude', 'hooks', f), 'utf8')); if (f.endsWith('.cjs')) fs.chmodSync(dest, 0o755); }
  }
  const p = path.join(root, '.claude', 'settings.json');
  const cur = fs.existsSync(p) ? readJson(p, null) : {};
  if (!cur) return false;                                   // unreadable settings: leave them alone
  cur.env = { ...(cur.env || {}), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' };
  const gate = String(qualityGate || readConfig(root).TEST_CMD || '').trim();
  const allow = [...SQUAD_ALLOW, ...(gate && !/[;&|`$<>]/.test(gate) ? [`Bash(${gate}*)`] : [])];
  cur.permissions = { ...(cur.permissions || {}) };
  cur.permissions.allow = [...new Set([...(cur.permissions.allow || []), ...allow])];
  cur.permissions.deny = [...new Set([...(cur.permissions.deny || []).filter((d) => d !== 'Read(./.env.*)'), ...SQUAD_DENY])];   // the broad rule of older packs blocked .env.example
  cur.hooks = cur.hooks || {};
  // Node gate hooks (no jq). Entries for the older bash versions are replaced.
  const add = (event, base, timeout, statusMessage, matcher) => {
    const list = (cur.hooks[event] || []).filter((g) => !JSON.stringify(g).includes(`.claude/hooks/${base}.sh`));
    if (!JSON.stringify(list).includes(`${base}.cjs`)) list.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/.claude/hooks/${base}.cjs`], timeout, ...(statusMessage ? { statusMessage } : {}) }] });
    cur.hooks[event] = list;
  };
  add('TaskCompleted', 'task-completed', 900, 'Squad Sprint: checking the quality gate...');
  add('TeammateIdle', 'teammate-idle', 30);
  // the board in TASKS.md is the task list when Claude Code has no team task tools, and agents edit it with
  // any tool (sed in Bash included): check it after every change
  if (cur.hooks.PreToolUse) cur.hooks.PreToolUse = cur.hooks.PreToolUse.filter((g) => !JSON.stringify(g).includes('board-gate.cjs'));
  if (cur.hooks.PreToolUse && !cur.hooks.PreToolUse.length) delete cur.hooks.PreToolUse;
  add('PostToolUse', 'board-gate', 900, 'Squad Sprint: checking the board...', 'Edit|Write|MultiEdit|Bash');
  // edit locks: developers stay in their module folders; destructive commands need a confirmation
  add('PreToolUse', 'edit-lock', 30, '', 'Edit|Write|MultiEdit|NotebookEdit|Bash');
  writeJson(p, cur);
  return true;
}

const TEAM_START = '# aisquad:team:start', TEAM_END = '# aisquad:team:end';
export function updateTeamBlock(root, agents) {
  const text = readText(CONFIG(root));
  if (!text || !text.includes(TEAM_START) || !text.includes(TEAM_END)) return false;
  const ids = (k) => agents.filter((a) => roleKind(a) === k).map((a) => a.id);
  const block = `${TEAM_START} (maintained by The AI Squad from team.json)\nLEAD_AGENT="${ids('lead')[0] || ''}"\nDEV_AGENTS="${ids('dev').join(' ')}"\nQA_AGENTS="${ids('qa').join(' ')}"\n${TEAM_END}`;
  const lineStart = text.lastIndexOf('\n', text.indexOf(TEAM_START)) + 1;
  const next = text.slice(0, lineStart) + block + text.slice(text.indexOf(TEAM_END) + TEAM_END.length);
  if (next !== text) writeText(CONFIG(root), next);
  return true;
}

export function readConfig(root, text = readText(CONFIG(root))) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(?:"((?:[^"\\]|\\.)*)"|(\S*))/);
    if (m) out[m[1]] = (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1');
  }
  return out;
}
export const hasPack = (root) => fs.existsSync(CONFIG(root));
// a sprint has started once a sprint folder exists, the configured sprint is past 1, or a board has tasks
export function sprintStarted(root) {
  let dirs = []; try { dirs = fs.readdirSync(SQUAD(root)); } catch { /* no pack */ }
  if (dirs.some((d) => /^sprint-\d+$/.test(d)) || Number(readConfig(root).SPRINT) > 1) return true;
  return ['docs/squad/TASKS.md', 'docs/BOARD.md'].some((f) => parseTasks(readText(path.join(root, f))).length > 0);
}

// TASKS.md: the first table with "Task" and "Status" columns
export function parseTasks(md) {
  const lines = String(md || '').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const head = splitRow(lines[i]);
    if (!head || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const col = (name) => head.findIndex((h) => h.toLowerCase().replace(/\s+/g, ' ') === name);
    const iTask = col('task'), iStatus = col('status');
    if (iTask < 0 || iStatus < 0) continue;
    const iOwner = col('owner'), iBlocked = col('blocked by');
    const rows = [];
    for (let j = i + 2; j < lines.length; j++) {
      const r = splitRow(lines[j]);
      if (!r) break;
      if (!r[iTask]) continue;
      const status = (r[iStatus] || '').trim();
      rows.push({ task: r[iTask], owner: iOwner >= 0 ? r[iOwner] : '', blockedBy: iBlocked >= 0 && r[iBlocked] !== '—' && r[iBlocked] !== '-' ? r[iBlocked] : '', status, column: statusColumn(status) });
    }
    return rows;
  }
  return [];
}
function splitRow(line) {
  const t = String(line).trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/^`|`$/g, ''));
}
export const COLUMNS = ['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE'];
function statusColumn(s) {
  const u = s.toUpperCase().replace(/[\s-]+/g, '_');
  if (u.startsWith('DONE') || u.startsWith('VERIFIED') || u.startsWith('PASS') || u.startsWith('PUBLISHED') || u.startsWith('APPROVED')) return 'DONE';
  if (u.startsWith('IN_PROGRESS') || u.startsWith('BUILD') || u.startsWith('FIXED') || u.startsWith('DRAFT')) return 'IN_PROGRESS';
  if (u.startsWith('REVIEW') || u.startsWith('QA')) return 'REVIEW';
  if (u.startsWith('BLOCKED') || u.startsWith('OPEN')) return 'BLOCKED';
  return 'TODO';
}

const statusOf = (text) => ((String(text || '').match(/^STATUS:\s*([A-Z]+)/mi) || [])[1] || '').toUpperCase();
function filesIn(dir) { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; } }

// the sprint the squad works on (1.2.0): the highest sprint named in the first heading of docs/squad/PLAN.md or
// TASKS.md, or in config.sh, that is not archived as released (docs/squad/sprint-<N>/RELEASE.md). config.sh alone
// lags behind when the lead plans the next sprint in the docs first.
export const headingSprint = (md) => {
  for (const line of String(md || '').split('\n').slice(0, 30)) {
    if (!/^#{1,3}\s/.test(line)) continue;
    const m = line.match(/\bsprint\s+(\d+)\b/i);
    if (m) return Number(m[1]);
  }
  return null;
};
export function currentSprint(root) {
  const dir = SQUAD(root), cfg = Number(readConfig(root).SPRINT);
  const named = [headingSprint(readText(path.join(dir, 'PLAN.md'))), headingSprint(readText(path.join(dir, 'TASKS.md'))), Number.isFinite(cfg) && String(readConfig(root).SPRINT || '').trim() ? cfg : null]
    .filter((n) => n != null);
  if (!named.length) return '';
  const open = named.filter((n) => !fs.existsSync(path.join(dir, `sprint-${n}`, 'RELEASE.md')));
  return String(Math.max(...(open.length ? open : named)));
}

export function boardData(root) {
  if (!hasPack(root)) return { pack: false };
  const dir = SQUAD(root);
  const bugs = filesIn(path.join(dir, 'bugs')).map((f) => ({ id: f.slice(0, -3), status: statusOf(readText(path.join(dir, 'bugs', f))) }));
  const qa = filesIn(path.join(dir, 'qa')).map((f) => ({ id: f.slice(0, -3), status: statusOf(readText(path.join(dir, 'qa', f))) }));
  return {
    pack: true, sprint: currentSprint(root), tasks: parseTasks(readText(path.join(dir, 'TASKS.md'))),
    handoffs: filesIn(path.join(dir, 'handoff')).map((f) => f.slice(0, -3)),
    bugs: { open: bugs.filter((b) => b.status === 'OPEN').map((b) => b.id), fixed: bugs.filter((b) => b.status === 'FIXED').map((b) => b.id) },
    qa: { pass: qa.filter((q) => q.status === 'PASS').map((q) => q.id), fail: qa.filter((q) => q.status === 'FAIL').map((q) => q.id) },
    questions: (readText(path.join(dir, 'QUESTIONS.md')) || '').split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).length,
  };
}

const git = (cwd, args) => new Promise((resolve) => execFile('git', ['-C', cwd, ...args], { timeout: 30000, maxBuffer: 8e6 },
  (err, stdout) => resolve({ ok: !err, out: String(stdout).trim() })));

// Closed = RELEASE.md + closing commit "docs(squad): close sprint <N>" on sprint-<N> + clean tree + final QA PASS.
export async function sprintStatus(root, sprint = readConfig(root).SPRINT) {
  const n = String(sprint || '').trim();
  const branch = `sprint-${n}`;
  const checks = { branch: false, release: false, closingCommit: false, cleanTree: false, qaPass: false };
  if (!n) return { sprint: n, branch, closed: false, checks };
  const tip = await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
  checks.branch = tip.ok;
  if (tip.ok) {
    checks.release = (await git(root, ['cat-file', '-e', `${branch}:docs/squad/sprint-${n}/RELEASE.md`])).ok;
    const subjects = (await git(root, ['log', '--format=%s', '-n', '200', branch])).out.split('\n');
    checks.closingCommit = subjects.some((s) => s.trim().toLowerCase() === `docs(squad): close sprint ${n}`);
    for (const f of [`docs/squad/sprint-${n}/qa/FINAL-S${n}.md`, `docs/squad/qa/FINAL-S${n}.md`]) {
      const r = await git(root, ['show', `${branch}:${f}`]);
      if (r.ok && statusOf(r.out) === 'PASS') { checks.qaPass = true; break; }
    }
  }
  checks.cleanTree = (await git(root, ['status', '--porcelain'])).out === '';
  return { sprint: n, branch, tip: tip.ok ? tip.out : null, closed: Object.values(checks).every(Boolean), checks };
}
