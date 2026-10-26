// One squad, several repositories (Phase 3.4): the primary repository holds the Floor; linked repositories are
// listed in .claude/aisquad/repos.json (shared through git, relative paths only) with their access ("read": context
// for the agents, every write denied; "write": the assigned agents edit and commit there on their sprint branch),
// branch strategy, quality gate and agents. The absolute path on this machine is resolved locally (building.json
// keeps an override per Floor). Never push (unchanged).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readJson, writeJson, bad } from './util.js';

export const ACCESS = ['read', 'write'];
export const STRATEGIES = ['agent-branches', 'feature-branches', 'trunk'];   // as in git.json
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REMOTE = /^(https:\/\/|ssh:\/\/|git@)[\w.@:/~+-]+$/;
const file = (root) => path.join(root, '.claude', 'aisquad', 'repos.json');

// one entry -> cleaned, or throws with what is wrong (the owner sees it)
export function cleanRepo(r = {}, { agentIds = null } = {}) {
  const id = String(r.id || '').trim();
  if (!ID.test(id)) throw bad(`Repository id "${id}" must be lowercase letters, digits and dashes`);
  const p = String(r.path || '').trim().replace(/\\/g, '/');
  if (!p) throw bad(`Repository ${id} needs a path`);
  if (path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.startsWith('~')) throw bad(`Repository ${id}: the path must be relative to the primary repository (e.g. ../${id}); absolute paths stay on each machine`);
  const access = String(r.access || '');
  if (!ACCESS.includes(access)) throw bad(`Repository ${id}: access must be "read" or "write", not "${access}"`);
  const remote = String(r.remote || '').trim();
  if (remote && !REMOTE.test(remote)) throw bad(`Repository ${id}: the remote must be an https://, ssh:// or git@ URL`);
  const branch = r.branch || {};
  const strategy = STRATEGIES.includes(branch.strategy) ? branch.strategy : 'agent-branches';
  const main = /^[\w./-]{1,100}$/.test(String(branch.main || '')) ? String(branch.main) : 'main';
  const gate = String(r.gate || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  const agents = (Array.isArray(r.agents) ? r.agents : []).map(String).filter((a) => /^[\w-]{1,64}$/.test(a));
  if (agentIds) { const unknown = agents.filter((a) => !agentIds.includes(a)); if (unknown.length) throw bad(`Repository ${id}: unknown agents ${unknown.join(', ')}`); }
  return { id, path: p, ...(remote ? { remote } : {}), access, branch: { strategy, main }, ...(gate ? { gate } : {}), agents: [...new Set(agents)] };
}
export function cleanRepos(list = [], opts = {}) {
  if (!Array.isArray(list)) throw bad('repos must be a list');
  const out = list.map((r) => cleanRepo(r, opts)), seen = new Set();
  for (const r of out) { if (seen.has(r.id)) throw bad(`Repository ${r.id} is listed twice`); seen.add(r.id); }
  return out;
}
export function readRepos(root) {
  const j = readJson(file(root), null);
  try { return j ? cleanRepos(j.repos || []) : []; } catch { return []; }   // a broken file: no linked repositories (the Floor still works)
}
export function writeRepos(root, list, opts = {}) {
  const repos = cleanRepos(list, opts);
  writeJson(file(root), { version: 1, repos });
  return repos;
}

// the absolute path on this machine: the local override (building.json), else relative to the primary repository
export const resolve = (root, repo, local = {}) => path.resolve(local[repo.id] || path.resolve(root, repo.path));

// what one agent gets: its repositories with the absolute path and its access there
// (write only where the repository is "write" and the agent is assigned; a "read" repository with no agents listed
// is context for everyone; a "write" one with no agents listed is for nobody)
export function agentRepos(root, repos, agentId, local = {}) {
  return repos.filter((r) => r.agents.includes(agentId) || (r.access === 'read' && !r.agents.length))
    .map((r) => ({ id: r.id, path: r.path, abs: resolve(root, r, local), access: r.access === 'write' && r.agents.includes(agentId) ? 'write' : 'read', branch: r.branch, gate: r.gate || '' }));
}
// the lead plans for every repository: all of them, read access unless it is assigned to a "write" one
export const leadRepos = (root, repos, leadId, local = {}) => repos.map((r) => ({ id: r.id, path: r.path, abs: resolve(root, r, local),
  access: r.access === 'write' && r.agents.includes(leadId) ? 'write' : 'read', branch: r.branch, gate: r.gate || '' }));
// Claude Code arguments: one --add-dir per repository the agent may read
export const addDirArgs = (list) => list.filter((r) => fs.existsSync(r.abs)).flatMap((r) => ['--add-dir', r.abs]);
// deny rules for read-only repositories: every file write tool on that path (Claude Code writes absolute paths as
// //abs/**), and git writes there through git -C or cd (absolute and relative path)
const GIT_WRITES = ['commit', 'push', 'add', 'rm', 'mv', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'restore', 'cherry-pick', 'revert', 'stash', 'tag', 'apply', 'am', 'pull', 'clean'];
export function denyRules(list) {
  const out = [];
  for (const r of list.filter((x) => x.access === 'read')) {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) out.push(`${tool}(/${r.abs}/**)`);
    for (const p of [...new Set([r.abs, r.path])]) for (const v of GIT_WRITES) out.push(`Bash(git -C ${p} ${v}:*)`, `Bash(cd ${p} && git ${v}:*)`);
  }
  return out;
}

// ---------- on this machine: status, clone ----------
const git = (cwd, args, timeout = 20000) => new Promise((ok) => execFile('git', ['-C', cwd, ...args], { timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
  (err, out, errOut) => ok({ ok: !err, out: String(out).trim(), err: String(errOut).trim() })));
// -> { exists, git, branch, ahead, behind, dirty }
export async function status(abs) {
  if (!fs.existsSync(abs)) return { exists: false };
  const b = await git(abs, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!b.ok) return { exists: true, git: false };
  const s = await git(abs, ['status', '--porcelain=v1', '--branch']);
  const head = s.out.split('\n')[0] || '', m = head.match(/\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]/);
  return { exists: true, git: true, branch: b.out, ahead: +(m?.[1] || 0), behind: +(m?.[2] || 0), dirty: s.out.split('\n').slice(1).filter(Boolean).length };
}
// a missing repository on a new machine: clone it from its remote (never push)
export async function clone(repo, abs) {
  if (!repo.remote) throw bad(`Repository ${repo.id} has no remote to clone from`);
  if (fs.existsSync(abs) && fs.readdirSync(abs).length) throw bad(`${abs} already exists`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const r = await new Promise((ok) => execFile('git', ['clone', '--', repo.remote, abs], { timeout: 10 * 60e3, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, out, e) => ok({ ok: !err, err: String(e).trim() })));
  if (!r.ok) throw bad(`Clone failed: ${r.err.split('\n').slice(-2).join(' ')}`);
  return status(abs);
}
// the repository a file path belongs to (for the Log): its id or ''
export function repoOf(filePath, repos = []) {
  const p = path.resolve(String(filePath || ''));
  const hit = repos.filter((r) => p === r.abs || p.startsWith(r.abs + path.sep)).sort((a, b) => b.abs.length - a.abs.length)[0];
  return hit ? hit.id : '';
}
