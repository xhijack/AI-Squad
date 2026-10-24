// Auto-merge executor (decision D3). The AI Squad server, never an agent, merges finished branches:
// one-time approval per Floor (stored in ~/.aisquad, not in the repo), merge in a temporary worktree,
// run the quality gate on the merged result, refuse on conflicts or a red gate, squash or merge,
// update the main branch, push only when the push policy allows, and log every attempt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { readJson, writeJson } from './util.js';

export const GATE_TIMEOUT_MS = 30 * 60 * 1000;
const DEP_DIRS = ['node_modules', '.venv', 'venv', 'vendor'];   // linked into the worktree so the gate can run

function git(cwd, args, { timeout = 60000, env } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout, maxBuffer: 16e6, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout).trim(), err: String(stderr).trim() }));
  });
}
function sh(cwd, cmd, timeout) {
  return new Promise((resolve) => {
    execFile('sh', ['-c', cmd], { cwd, timeout, maxBuffer: 32e6, env: { ...process.env, CI: '1' } },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? (err.killed ? 'timeout' : err.code) : 0, output: `${stdout}${stderr}` }));
  });
}
const tail = (s, n = 40) => String(s).split('\n').slice(-n).join('\n').trim();

// ---------- approval (machine-local) ----------
const approvalsFile = () => path.join(config.home, 'approvals.json');
export function approval(floorId) { return (readJson(approvalsFile(), {}) || {})[floorId] || null; }
export function setApproval(floorId, approved) {
  const all = readJson(approvalsFile(), {}) || {};
  if (approved) all[floorId] = { autoMerge: true, approvedAt: new Date().toISOString() };
  else delete all[floorId];
  writeJson(approvalsFile(), all);
}

// ---------- log ----------
const logFile = (floorId) => path.join(config.home, 'merges', `${floorId}.jsonl`);
export function mergeLog(floorId, limit = 50) {
  let text = '';
  try { text = fs.readFileSync(logFile(floorId), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-limit).reverse();
}
function writeLog(floorId, entry) {
  fs.mkdirSync(path.dirname(logFile(floorId)), { recursive: true });
  fs.appendFileSync(logFile(floorId), JSON.stringify(entry) + '\n');
}

// ---------- candidates ----------
export async function branches(root) {
  const r = await git(root, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/']);
  return r.ok ? r.out.split('\n').filter(Boolean).map((l) => { const [name, sha] = l.split(' '); return { name, sha }; }) : [];
}

// branches that hold finished work for this Floor's strategy and are not merged yet
export async function candidates(floorId, root, git_, agentIds = [], { extraPrefixes = [] } = {}) {
  const main = git_.mainBranch;
  const prefixes = [...extraPrefixes];
  if (git_.branchStrategy === 'agent-branches') prefixes.push(...agentIds.map((id) => `${id}/`));
  if (git_.branchStrategy === 'feature-branches') prefixes.push('feature/');
  if (!prefixes.length) return [];
  const all = await branches(root);
  if (!all.some((b) => b.name === main)) return [];
  const log = mergeLog(floorId, 500);
  const out = [];
  for (const b of all) {
    if (b.name === main || !prefixes.some((p) => b.name.startsWith(p))) continue;
    if ((await git(root, ['merge-base', '--is-ancestor', b.sha, main])).ok) continue;      // already in main
    const last = log.find((e) => e.branch === b.name && e.tip === b.sha);
    out.push({ branch: b.name, tip: b.sha, agent: agentIds.find((id) => b.name.startsWith(`${id}/`)) || null, lastResult: last ? last.result : null });
  }
  return out;
}

// ---------- executor ----------
const running = new Set();
export const isMerging = (floorId) => running.has(floorId);

// git_: cleaned git.json. Returns the log entry.
export async function mergeBranch(floorId, root, git_, branch, { trigger = 'manual' } = {}) {
  if (running.has(floorId)) return { result: 'busy', reason: 'Another merge is running on this Floor' };
  running.add(floorId);
  const entry = { id: crypto.randomBytes(5).toString('hex'), ts: Date.now(), branch, trigger, method: git_.mergeMethod, into: git_.mainBranch };
  let tmp = null;
  const finish = (result, extra = {}) => { Object.assign(entry, { result, ...extra, finishedAt: Date.now() }); writeLog(floorId, entry); return entry; };
  try {
    const main = git_.mainBranch;
    if (!/^[\w./-]+$/.test(branch) || branch.startsWith('-')) return finish('refused', { reason: 'Invalid branch name' });
    const tip = await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
    if (!tip.ok) return finish('refused', { reason: `Branch ${branch} not found` });
    entry.tip = tip.out;
    const base = await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${main}`]);
    if (!base.ok) return finish('refused', { reason: `Main branch ${main} not found` });
    if ((await git(root, ['merge-base', '--is-ancestor', tip.out, base.out])).ok) return finish('noop', { reason: 'Already merged' });
    if (trigger !== 'manual' && !git_.qualityGate) return finish('refused', { reason: 'No quality gate configured; automatic merges need one' });

    // the main checkout must be clean when main is checked out there (it is fast-forwarded afterwards)
    const head = await git(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
    const mainCheckedOut = head.ok && head.out === main;
    if (mainCheckedOut) {
      const st = await git(root, ['status', '--porcelain', '--untracked-files=no']);
      if (st.out) return finish('refused', { reason: `Uncommitted changes on ${main} in the project directory` });
    }

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aisquad-merge-'));
    const wt = await git(root, ['worktree', 'add', '--detach', tmp, base.out]);
    if (!wt.ok) return finish('failed', { reason: `git worktree add failed: ${tail(wt.err, 5)}` });
    for (const d of DEP_DIRS) if (fs.existsSync(path.join(root, d)) && !fs.existsSync(path.join(tmp, d))) fs.symlinkSync(path.join(root, d), path.join(tmp, d));

    const subjects = (await git(root, ['log', '--reverse', '--format=%s', `${base.out}..${tip.out}`])).out.split('\n').filter(Boolean);
    let message;
    if (git_.mergeMethod === 'merge') {
      message = `Merge branch '${branch}'`;
      const m = await git(tmp, ['merge', '--no-ff', '--no-edit', '-m', message, tip.out]);
      if (!m.ok) {
        const conflicts = (await git(tmp, ['diff', '--name-only', '--diff-filter=U'])).out.split('\n').filter(Boolean);
        await git(tmp, ['merge', '--abort']);
        return finish('refused', { reason: conflicts.length ? 'Merge conflicts' : `git merge failed: ${tail(m.err || m.out, 5)}`, conflicts });
      }
    } else {
      const m = await git(tmp, ['merge', '--squash', tip.out]);
      if (!m.ok) {
        const conflicts = (await git(tmp, ['diff', '--name-only', '--diff-filter=U'])).out.split('\n').filter(Boolean);
        await git(tmp, ['reset', '--hard', '-q']);
        return finish('refused', { reason: conflicts.length ? 'Merge conflicts' : `git merge --squash failed: ${tail(m.err || m.out, 5)}`, conflicts });
      }
      if ((await git(tmp, ['diff', '--cached', '--quiet'])).ok) return finish('noop', { reason: 'Nothing to merge (no changes)' });
      message = subjects.length === 1 ? subjects[0] : `chore(merge): squash ${branch}\n\n${subjects.map((s) => `- ${s}`).join('\n')}`;
      const c = await git(tmp, ['commit', '-q', '--no-verify', '-m', message]);
      if (!c.ok) return finish('failed', { reason: `git commit failed: ${tail(c.err || c.out, 5)}` });
    }
    entry.commits = subjects.length;

    if (git_.qualityGate) {
      const g = await sh(tmp, git_.qualityGate, GATE_TIMEOUT_MS);
      entry.gate = { command: git_.qualityGate, ok: g.ok, code: g.code, output: tail(g.output) };
      if (!g.ok) return finish('refused', { reason: g.code === 'timeout' ? 'Quality gate timed out' : `Quality gate failed (exit ${g.code})` });
    }
    const merged = (await git(tmp, ['rev-parse', 'HEAD'])).out;

    // move main: fast-forward the checkout if main is checked out there, else compare-and-swap the ref
    const upd = mainCheckedOut ? await git(root, ['merge', '--ff-only', '-q', merged]) : await git(root, ['update-ref', `refs/heads/${main}`, merged, base.out]);
    if (!upd.ok) return finish('failed', { reason: `Could not update ${main} (it moved during the merge?): ${tail(upd.err, 5)}` });
    entry.commit = merged;

    if (git_.pushPolicy === 'after-merge' || git_.pushPolicy === 'agents-may-push') {
      const remotes = (await git(root, ['remote'])).out.split('\n');
      if (!remotes.includes('origin')) entry.push = { ok: false, error: 'No remote "origin"' };
      else {
        const p = await git(root, ['push', 'origin', `${main}:${main}`], { timeout: 120000 });
        entry.push = { ok: p.ok, ...(p.ok ? {} : { error: tail(p.err, 5) }) };
      }
    }
    return finish('merged');
  } catch (e) {
    return finish('failed', { reason: e.message });
  } finally {
    if (tmp) {
      await git(root, ['worktree', 'remove', '--force', tmp]);
      fs.rmSync(tmp, { recursive: true, force: true });
      await git(root, ['worktree', 'prune']);
    }
    running.delete(floorId);
  }
}

// log entries that need the owner: refused or failed merges and failed pushes (last 7 days)
export function mergeProblems(floorId, dismissed = []) {
  const since = Date.now() - 7 * 864e5;
  return mergeLog(floorId, 100).filter((e) => e.ts > since && !dismissed.includes(e.id)
    && (e.result === 'refused' || e.result === 'failed' || (e.result === 'merged' && e.push && !e.push.ok)));
}

