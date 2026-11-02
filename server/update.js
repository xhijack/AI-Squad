// SPDX-License-Identifier: Apache-2.0
// The app updates itself (1.10). An install from install.sh is a git checkout (~/.aisquad-app): the server fetches its
// branch, says how far behind it is, the new version and its release lines, and on the Owner's word fast-forwards and
// restarts through its service (systemd and launchd bring it back; a detached server starts its successor first).
// Nothing is merged: a checkout with local changes, local commits or a running background job is not updated.
// A Claude Code plugin install is updated with /plugin update; the page says so.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, VERSION } from './config.js';
import * as service from './service.js';
import * as jobs from './jobs.js';
import { bad } from './util.js';

const exec = promisify(execFile);
export const CHECK_EVERY = 6 * 3600e3, RETRY_FAILED = 10 * 60e3;
// git on the app folder only: variables that point git elsewhere are dropped, and a private remote fails at once
const gitEnv = () => { const e = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' }; for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) delete e[k]; return e; };
export const deps = {
  git: async (args, root) => (await exec('git', ['-C', root, ...args], { timeout: 60000, maxBuffer: 4e6, env: gitEnv() })).stdout.trim(),
  running: () => jobs.runningJobs().length,
  restart: () => restartSoon(),
  root: () => ROOT,
  version: () => VERSION,
};

// git (a checkout we can fast-forward), plugin (Claude Code's plugin cache), other (a copy: update by hand)
export function installKind(root = deps.root()) {
  if (fs.existsSync(path.join(root, '.git'))) return 'git';
  return /[/\\]\.claude[/\\]plugins[/\\]/.test(root) ? 'plugin' : 'other';
}
const releaseLine = (s) => { const m = s.match(/^chore: release (\d+\.\d+\.\d+)(?: \((.*)\))?$/); return m ? { version: m[1], text: m[2] || '' } : null; };

let last = null, inflight = null;
// what the Owner sees: current, latest, how many commits behind, release lines, whether Update can run
export async function check({ force = false, now = Date.now() } = {}) {
  if (!force && last && now - last.checkedAt < (last.reason === 'check failed' ? RETRY_FAILED : CHECK_EVERY)) return last;
  if (inflight) return inflight;
  inflight = (async () => {
    const root = deps.root(), kind = installKind(root), current = deps.version();
    const out = { kind, current, latest: current, behind: 0, available: false, canUpdate: false, notes: [], checkedAt: now, reason: '' };
    if (kind === 'plugin') return { ...out, reason: 'plugin', how: '/plugin marketplace update aisquad, then /plugin update aisquad@aisquad and restart Claude Code' };
    if (kind === 'other') return { ...out, reason: 'not a git checkout', how: 'install with install.sh to update from the app' };
    try {
      const branch = await deps.git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
      if (branch === 'HEAD') return { ...out, reason: 'detached HEAD' };
      out.branch = branch;
      await deps.git(['fetch', '-q', 'origin', branch], root);
      const up = `origin/${branch}`;
      out.behind = Number(await deps.git(['rev-list', '--count', `HEAD..${up}`], root)) || 0;
      out.ahead = Number(await deps.git(['rev-list', '--count', `${up}..HEAD`], root)) || 0;
      try { out.latest = JSON.parse(await deps.git(['show', `${up}:package.json`], root)).version || current; } catch { /* keep current */ }
      const subjects = out.behind ? (await deps.git(['log', '--format=%s', `HEAD..${up}`], root)).split('\n').filter(Boolean) : [];
      const releases = subjects.map(releaseLine).filter(Boolean);
      out.notes = (releases.length ? releases : subjects.slice(0, 8).map((s) => ({ version: '', text: s }))).slice(0, 12);
      out.dirty = (await deps.git(['status', '--porcelain', '--untracked-files=no'], root)) !== '';
      out.available = out.behind > 0;
      out.reason = !out.available ? '' : out.ahead ? 'this checkout has its own commits' : out.dirty ? 'this checkout has local changes' : '';
      out.canUpdate = out.available && !out.reason;
    } catch (e) { out.reason = 'check failed'; out.error = String(e.stderr || e.message).trim().split('\n')[0].slice(0, 200); }
    return out;
  })();
  try { last = await inflight; return last; } finally { inflight = null; }
}

// fast-forward and restart; refused while background jobs run (they would lose their runner)
let applying = false;
export async function apply() {
  if (applying) throw bad('An update is already running');
  applying = true;
  try { return await applyNow(); } catch (e) { applying = false; throw e; }   // after a good update the server restarts: the flag stays
}
async function applyNow() {
  const st = await check({ force: true });
  if (!st.available) throw bad('Already up to date');
  if (!st.canUpdate) throw bad(`Cannot update here: ${st.reason || st.error || 'unknown'}${st.how ? ` (${st.how})` : ''}`);
  const n = deps.running();
  if (n) throw bad(`${n} background job${n === 1 ? ' is' : 's are'} running: update when ${n === 1 ? 'it ends' : 'they end'}`);
  await deps.git(['merge', '--ff-only', '-q', `origin/${st.branch}`], deps.root());
  last = null;
  const how = deps.restart();
  return { updated: true, from: st.current, to: st.latest, restart: how };
}

// the service brings the server back after it exits; a detached server starts its successor (after a pause, so the
// port is free) and exits. Agents in tmux keep running.
// supervised: this very process runs under the service (systemd sets INVOCATION_ID, launchd XPC_SERVICE_NAME), not
// merely a unit file on the machine (a server started by hand would not come back)
export function supervised({ mode = service.detectMode(), env = process.env } = {}) {
  if (mode === 'systemd') return !!env.INVOCATION_ID;
  if (mode === 'launchd') return String(env.XPC_SERVICE_NAME || '').includes(service.LAUNCHD_LABEL);
  return false;
}
export function restartSoon({ delayMs = 800, mode = service.detectMode() } = {}) {
  const managed = supervised({ mode });
  setTimeout(() => {
    if (!managed) {
      const out = fs.openSync(service.logPath(), 'a');
      spawn('/bin/sh', ['-c', 'sleep 2; exec "$0" "$@"', process.execPath, ...process.execArgv, ...process.argv.slice(1)], { cwd: process.cwd(), detached: true, stdio: ['ignore', out, out], env: process.env }).unref();
    }
    process.exit(0);
  }, delayMs).unref?.();
  return managed ? mode : 'detached';
}
