// SPDX-License-Identifier: Apache-2.0
// A worker machine (0.18): `aisquad node --head URL --name NAME --token TOKEN`. It only connects out to the Head:
// a heartbeat with its free memory and running jobs, and a long poll for work. A job comes with everything it
// needs (prompt, arguments, the agent file, the repository's URL); the worker clones or pulls the repository, works
// on a fresh branch <agent>/job-<id> from the main branch, runs the headless runner (server/jobs.js) with its own
// Claude sign-in, streams the events back, and pushes the branch when the job made commits. Nothing else is kept
// here, so a worker can be replaced at any time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, VERSION } from './config.js';
import * as jobs from './jobs.js';
import * as wd from './watchdog.js';
import { writeText } from './util.js';

const run = promisify(execFile);
const git = (cwd, args, timeout = 120000) => run('git', ['-C', cwd, ...args], { timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
export const reposDir = () => path.join(config.home, 'worker', 'repos');

// arguments built on the Head: its paths become this clone's; directories that do not exist here are dropped
export function localArgs(args = [], headRoot = '', root = '') {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    let a = String(args[i]);
    if (headRoot && root) a = a.split(headRoot).join(root);
    if ((a === '--add-dir' || a === '--plugin-dir') && i + 1 < args.length) {
      const dir = String(args[i + 1]).split(headRoot || '\0').join(root);
      if (fs.existsSync(dir)) out.push(a, dir);
      i++; continue;
    }
    out.push(a);
  }
  return out;
}

// clone or pull, then a fresh branch from the main branch
export async function prepare(job) {
  const root = path.join(reposDir(), job.floorId);
  if (!fs.existsSync(path.join(root, '.git'))) { fs.mkdirSync(path.dirname(root), { recursive: true }); await run('git', ['clone', '-q', job.repo.url, root], { timeout: 600000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); }
  else await git(root, ['fetch', '-q', 'origin']);
  await git(root, ['checkout', '-q', '-f', '-B', job.repo.branch, `origin/${job.repo.main}`]);
  await git(root, ['clean', '-q', '-fd']);
  if (job.agentFile) writeText(path.join(root, '.claude', 'agents', `${job.agentId}.md`), job.agentFile);
  return root;
}

export function startWorker({ head, name, token, maxAgents = 6, fetchFn = fetch, log = console } = {}) {
  const base = String(head).replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', 'x-aisquad-node': `${name}:${token}` };
  const call = async (method, p, body, timeoutMs = 15000) => {
    const r = await fetchFn(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${method} ${p}: ${r.status}`);
    return j;
  };
  const local = new Map();          // job id -> { root, branch, main, offset }
  let stopped = false;
  const beat = async () => {
    try {
      await call('POST', '/api/nodes/heartbeat', { version: VERSION, host: os.hostname(), maxAgents, resources: wd.readResources(), running: [...local.keys()], repos: fs.existsSync(reposDir()) ? fs.readdirSync(reposDir()) : [] });
    } catch (e) { log.error(`[node] heartbeat: ${e.message}`); }
  };
  const report = async (id, body) => { try { return await call('POST', `/api/nodes/jobs/${id}`, body); } catch (e) { log.error(`[node] report ${id}: ${e.message}`); return null; } };
  const fail = (id, error) => report(id, { status: 'failed', error, offset: 0, chunk: '' });

  async function startJob(j) {
    try {
      const root = await prepare(j);
      jobs.startJob({ id: j.id, floorId: j.floorId, agentId: j.agentId, kind: j.kind, title: j.title, prompt: j.prompt, cwd: root, args: localArgs(j.args, j.headRoot, root), env: j.env || {}, model: j.model, budgetUsd: j.budgetUsd, permissionMode: j.permissionMode, via: 'head' });
      local.set(j.id, { root, branch: j.repo.branch, main: j.repo.main, offset: 0 });
      log.log(`[node] job ${j.id} for ${j.floorId}/${j.agentId}`);
      beat();
    } catch (e) { await fail(j.id, `could not prepare the job on ${name}: ${String(e.stderr || e.message).trim().slice(0, 200)}`); }
  }
  // every 2 s: the new part of each job's event stream; at its end the result, after pushing its branch
  async function flush() {
    for (const [id, l] of local) {
      const j = jobs.readJob(id);
      if (!j) { local.delete(id); continue; }
      const { ended } = jobs.refreshJob(j);
      let text = ''; try { text = fs.readFileSync(path.join(jobs.jobsDir(), `${id}.jsonl`)).subarray(l.offset).toString('utf8'); } catch { /* not yet */ }
      const end = ended || j.status !== 'running';
      if (end && j.status !== 'stopped') {
        try {
          const ahead = Number((await git(l.root, ['rev-list', '--count', `origin/${l.main}..HEAD`])).stdout.trim());
          if (ahead > 0) { await git(l.root, ['push', '-q', 'origin', `HEAD:refs/heads/${l.branch}`]); j.branch = l.branch; }
        } catch (e) { j.error = `${j.error ? `${j.error}; ` : ''}push failed: ${String(e.stderr || e.message).trim().slice(0, 120)}`; }
      }
      const r = await report(id, { offset: l.offset, chunk: text, ...(end ? { status: j.status, cost: j.cost, turns: j.turns, result: j.result, error: j.error, branch: j.branch || '' } : {}) });
      if (r) {
        l.offset = typeof r.streamed === 'number' ? r.streamed : l.offset + Buffer.byteLength(text);
        if (r.status === 'stopped' && !end) jobs.stopJob(id);                // stopped on the Head
      }
      if (end && r) local.delete(id);
    }
  }
  (async () => {
    await beat();
    const hb = setInterval(beat, 10e3), fl = setInterval(() => { flush().catch((e) => log.error(`[node] ${e.message}`)); }, 2000);
    while (!stopped) {
      try {
        const w = await call('GET', '/api/nodes/work?wait=25', null, 40000);
        for (const a of w.assignments || []) {
          if (a.type === 'job') await startJob(a.job);
          else if (a.type === 'stop' && local.has(a.id)) jobs.stopJob(a.id);
        }
      } catch (e) { if (!stopped) { log.error(`[node] ${e.message}`); await new Promise((r) => setTimeout(r, 3000)); } }
    }
    clearInterval(hb); clearInterval(fl);
  })();
  return { stop: () => { stopped = true; }, local };
}
