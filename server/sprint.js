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
    if (rel.endsWith('.sh') && rel.includes('hooks')) fs.chmodSync(dest, 0o755);
    created.push(rel);
  }
  mergeSettings(root);
  updateTeamBlock(root, agents);
  return created;
}

// .claude/settings.json: agent teams on, TaskCompleted / TeammateIdle gate hooks (added once, merged)
export function mergeSettings(root) {
  const p = path.join(root, '.claude', 'settings.json');
  const cur = fs.existsSync(p) ? readJson(p, null) : {};
  if (!cur) return false;                                   // unreadable settings: leave them alone
  cur.env = { ...(cur.env || {}), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' };
  cur.hooks = cur.hooks || {};
  const add = (event, script, timeout, statusMessage) => {
    const list = cur.hooks[event] = cur.hooks[event] || [];
    if (JSON.stringify(list).includes(script)) return;
    list.push({ hooks: [{ type: 'command', command: 'bash', args: [`\${CLAUDE_PROJECT_DIR}/.claude/hooks/${script}`], timeout, ...(statusMessage ? { statusMessage } : {}) }] });
  };
  add('TaskCompleted', 'task-completed.sh', 900, 'Squad Sprint: checking the quality gate...');
  add('TeammateIdle', 'teammate-idle.sh', 30);
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
  if (u.startsWith('DONE') || u.startsWith('VERIFIED') || u.startsWith('PASS')) return 'DONE';
  if (u.startsWith('IN_PROGRESS') || u.startsWith('BUILD') || u.startsWith('FIXED')) return 'IN_PROGRESS';
  if (u.startsWith('REVIEW') || u.startsWith('QA')) return 'REVIEW';
  if (u.startsWith('BLOCKED') || u.startsWith('OPEN')) return 'BLOCKED';
  return 'TODO';
}

const statusOf = (text) => ((String(text || '').match(/^STATUS:\s*([A-Z]+)/mi) || [])[1] || '').toUpperCase();
function filesIn(dir) { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; } }

export function boardData(root) {
  if (!hasPack(root)) return { pack: false };
  const cfg = readConfig(root);
  const dir = SQUAD(root);
  const bugs = filesIn(path.join(dir, 'bugs')).map((f) => ({ id: f.slice(0, -3), status: statusOf(readText(path.join(dir, 'bugs', f))) }));
  const qa = filesIn(path.join(dir, 'qa')).map((f) => ({ id: f.slice(0, -3), status: statusOf(readText(path.join(dir, 'qa', f))) }));
  return {
    pack: true, sprint: cfg.SPRINT || '', tasks: parseTasks(readText(path.join(dir, 'TASKS.md'))),
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
