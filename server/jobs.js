// SPDX-License-Identifier: Apache-2.0
// The headless runner: background work as `claude -p --output-format stream-json`. Nothing is read from a terminal
// screen: Claude Code writes one JSON event per line (init with the session id, assistant messages and tool calls,
// the result with cost, usage and turns), and the exit code says how it ended. A job runs detached in its own
// process group with its output in ~/.aisquad/jobs/<id>.jsonl, so it survives a server restart; the server reads
// the file to know where it is. No permission prompt can be answered in the background: jobs run in "dontAsk"
// mode by default (only what the project's settings allow), or "acceptEdits" when the owner allows edits.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config, claudeBin, ROOT } from './config.js';
import { readJson, writeJson, writeText, safeReaddir, bad, notFound, oneLine, clip } from './util.js';

export const PERMISSION_MODES = ['dontAsk', 'acceptEdits', 'plan'];
export const DEFAULT_BUDGET_USD = 2;
export const MAX_BUDGET_USD = 50;
export const jobsDir = () => path.join(config.home, 'jobs');
const file = (id, ext) => path.join(jobsDir(), `${id}.${ext}`);
const validId = (id) => /^j-[\w-]{6,40}$/.test(String(id));

// the command line of one run (the prompt goes on stdin, so it may be long or start with "-")
export function buildArgs({ agentId = '', model = '', effort = '', budgetUsd = DEFAULT_BUDGET_USD, resume = '', permissionMode = 'dontAsk',
  disallowedTools = [], addDirs = [], settings = null, appendSystemPrompt = '', pluginDir = '', extraArgs = [] } = {}) {
  const budget = Math.max(0.05, Math.min(MAX_BUDGET_USD, Number(budgetUsd) || DEFAULT_BUDGET_USD));
  return ['-p', '--output-format', 'stream-json', '--verbose',
    ...(agentId ? ['--agent', agentId] : []),
    ...(model && model !== 'inherit' ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    '--max-budget-usd', String(budget),
    '--permission-mode', PERMISSION_MODES.includes(permissionMode) ? permissionMode : 'dontAsk',
    ...(resume ? ['--resume', resume] : []),
    ...(disallowedTools.length ? ['--disallowedTools', ...disallowedTools] : []),
    ...addDirs.flatMap((d) => ['--add-dir', d]),
    ...(settings ? ['--settings', JSON.stringify(settings)] : []),
    ...(appendSystemPrompt ? ['--append-system-prompt', appendSystemPrompt] : []),
    ...(pluginDir ? ['--plugin-dir', pluginDir] : []),
    ...extraArgs,
  ];
}

// ---------- reading the stream ----------
const toolLine = (b) => {
  const i = b.input || {};
  const what = i.file_path || i.path || i.pattern || i.command || i.url || i.description || '';
  return `${b.name}${what ? ` ${oneLine(String(what), 80)}` : ''}`;
};
// a denied tool call (1.0.1): in "dontAsk" mode Claude Code refuses what the settings do not allow without asking.
// -> { id, tool, command } (command: the Bash command, the file or the URL it wanted)
const DENIED = /Permission to use \S+ has been denied|has been denied because Claude Code is running in don't ask mode/i;
const denialOf = (id, name, input = {}) => ({ id: id || '', tool: name || 'tool', command: oneLine(String(input.command || input.file_path || input.path || input.url || input.pattern || ''), 300) });
const resultText = (c) => (Array.isArray(c) ? c.map((x) => x.text || '').join(' ') : String(c || ''));
// the events of one run, in order -> { sessionId, model, events: [{ kind: text | tool, detail }], text, result, rateLimits,
// denials: [{ id, tool, command }] }
export function parseStream(text) {
  const out = { sessionId: '', model: '', events: [], text: '', result: null, rateLimits: null, denials: [] };
  const calls = new Map(), denied = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.session_id && !out.sessionId) out.sessionId = e.session_id;
    if (e.type === 'system' && e.subtype === 'init') out.model = e.model || out.model;
    // a rate-limit report, wherever Claude Code puts it (used by the quota guard)
    const rl = e.rate_limits || e.rate_limit_info || (e.type === 'rate_limit_event' ? e : null);
    if (rl) out.rateLimits = rl;
    if (e.type === 'assistant') {
      for (const b of e.message?.content || []) {
        if (b.type === 'text' && b.text?.trim()) { out.events.push({ kind: 'text', detail: oneLine(b.text, 200) }); out.text = b.text; }
        else if (b.type === 'tool_use') { out.events.push({ kind: 'tool', detail: toolLine(b) }); calls.set(b.id, b); }
      }
    }
    if (e.type === 'user') {
      for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (b.type !== 'tool_result' || !b.is_error || !DENIED.test(resultText(b.content))) continue;
        const call = calls.get(b.tool_use_id);
        denied.set(b.tool_use_id, denialOf(b.tool_use_id, call?.name || resultText(b.content).match(/use (\S+) has/)?.[1], call?.input));
      }
    }
    if (e.type === 'result') {
      out.result = { subtype: e.subtype || '', isError: !!e.is_error, text: String(e.result ?? ''), cost: +(e.total_cost_usd || 0), usage: e.usage || null,
        turns: e.num_turns || 0, durationMs: e.duration_ms || 0 };
      if (e.session_id) out.sessionId = e.session_id;
      for (const d of e.permission_denials || []) denied.set(d.tool_use_id || `d${denied.size}`, denialOf(d.tool_use_id, d.tool_name, d.tool_input));
    }
  }
  out.denials = [...denied.values()].slice(0, 20);
  if (out.events.length > 200) out.events = out.events.slice(-200);
  return out;
}

// ---------- jobs ----------
export const newId = (now = Date.now()) => `j-${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
// a job that runs on another machine (0.18): the Head keeps its record and its event stream; the worker reports
export function recordRemote(spec, { now = Date.now() } = {}) {
  fs.mkdirSync(jobsDir(), { recursive: true });
  const id = spec.id || newId(now);
  writeText(file(id, 'prompt'), String(spec.prompt || ''), 0o600);
  const job = { id, floorId: spec.floorId || '', agentId: spec.agentId || '', kind: spec.kind || 'task', title: clip(oneLine(spec.title || spec.prompt, 120), 120), prompt: clip(String(spec.prompt || ''), 2000),
    cwd: '', model: spec.model || '', budgetUsd: spec.budgetUsd || null, permissionMode: spec.permissionMode || 'dontAsk', via: spec.via || 'aisquad', node: spec.node, opts: spec.opts || {},
    meta: spec.meta || null, ...(spec.tier ? { tier: spec.tier } : {}), status: 'running', createdAt: now, startedAt: now, endedAt: null, pid: null, sessionId: '', cost: 0, turns: 0, activity: `queued on ${spec.node}`, result: '', error: '' };
  saveJob(job);
  return job;
}
export const promptOf = (id) => readTail(file(id, 'prompt'));
// a worker's report: more of the event stream, and the end when it came -> { job, ended }
export function applyReport(id, r = {}, now = Date.now()) {
  const job = readJob(id);
  if (!job || !job.node) return { job, ended: false };
  if (typeof r.chunk === 'string' && r.chunk && Number(r.offset) === (job.streamed || 0)) {
    fs.appendFileSync(file(id, 'jsonl'), r.chunk);
    job.streamed = (job.streamed || 0) + Buffer.byteLength(r.chunk);
  }
  const s = parseStream(readTail(file(id, 'jsonl')));
  if (s.sessionId) job.sessionId = s.sessionId;
  if (s.model) job.model = s.model;
  const last = s.events.at(-1);
  if (last) job.activity = last.kind === 'tool' ? last.detail : `writing: ${last.detail}`;
  if (s.rateLimits) job.rateLimits = s.rateLimits;
  let ended = false;
  if (job.status === 'running' && ['done', 'failed', 'stopped'].includes(r.status)) {
    ended = true;
    Object.assign(job, { status: r.status, endedAt: now, activity: '', cost: +r.cost || 0, turns: +r.turns || 0, result: clip(String(r.result || ''), 20000), error: oneLine(String(r.error || ''), 300), branch: r.branch || '' });
    if (s.denials.length) job.denials = s.denials;
  }
  saveJob(job);
  return { job, ended };
}
export function readJob(id) { return validId(id) ? readJson(file(id, 'json'), null) : null; }
export const saveJob = (j) => writeJson(file(j.id, 'json'), j);
export function listJobs({ floorId = '', agentId = '', status = '', limit = 50 } = {}) {
  return safeReaddir(jobsDir()).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(jobsDir(), f), null)).filter(Boolean)
    .filter((j) => (!floorId || j.floorId === floorId) && (!agentId || j.agentId === agentId) && (!status || j.status === status))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
export const runningJobs = () => listJobs({ status: 'running', limit: 500 });
export const localRunningJobs = () => runningJobs().filter((j) => !j.node);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// spec: { floorId, agentId, kind, title, prompt, cwd, args (from buildArgs), env } -> the job record
export function startJob(spec, { spawnFn = spawn, now = Date.now() } = {}) {
  const prompt = String(spec.prompt || '').trim();
  if (!prompt) throw bad('The job needs a prompt');
  if (!spec.cwd || !fs.existsSync(spec.cwd)) throw bad('The job folder does not exist');
  fs.mkdirSync(jobsDir(), { recursive: true });
  const id = validId(spec.id) ? spec.id : newId(now);                    // a worker runs a job under the Head's id (0.18)
  writeText(file(id, 'prompt'), prompt, 0o600);
  const cmd = [claudeBin(), ...(spec.args || [])].map(shq).join(' ');
  // the exit code lands in <id>.exit; output and errors in their own files
  const script = `${cmd} < ${shq(file(id, 'prompt'))} > ${shq(file(id, 'jsonl'))} 2> ${shq(file(id, 'err'))}; echo $? > ${shq(file(id, 'exit'))}`;
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`, ...(spec.env || {}) };
  delete env.TMUX;
  const child = spawnFn('sh', ['-c', script], { cwd: spec.cwd, env, detached: true, stdio: 'ignore' });
  child.unref?.();
  const job = { id, floorId: spec.floorId || '', agentId: spec.agentId || '', kind: spec.kind || 'task', title: clip(oneLine(spec.title || prompt, 120), 120), prompt: clip(prompt, 2000),
    cwd: spec.cwd, model: spec.model || '', budgetUsd: spec.budgetUsd || null, permissionMode: spec.permissionMode || 'dontAsk', via: spec.via || 'aisquad',
    meta: spec.meta || null, ...(spec.tier ? { tier: spec.tier } : {}), status: 'running', createdAt: now, startedAt: now, endedAt: null, pid: child.pid || null, sessionId: '', cost: 0, turns: 0, activity: 'starting', result: '', error: '' };
  saveJob(job);
  return job;
}

const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readTail = (f, max = 2 * 2 ** 20) => { try { const st = fs.statSync(f); if (st.size <= max) return fs.readFileSync(f, 'utf8'); const fd = fs.openSync(f, 'r'), buf = Buffer.alloc(max); fs.readSync(fd, buf, 0, max, st.size - max); fs.closeSync(fd); return buf.toString('utf8'); } catch { return ''; } };

// where a running job is now; finishes it when its exit code is there (or its process is gone). -> { job, changed, ended }
export function refreshJob(job, now = Date.now()) {
  if (job.status !== 'running' || job.node) return { job, changed: false, ended: false };     // a remote job: its worker reports
  const s = parseStream(readTail(file(job.id, 'jsonl')));
  const before = JSON.stringify([job.sessionId, job.activity, job.cost]);
  if (s.sessionId) job.sessionId = s.sessionId;
  if (s.model) job.model = s.model;
  const last = s.events.at(-1);
  if (last) job.activity = last.kind === 'tool' ? last.detail : `writing: ${last.detail}`;
  if (s.rateLimits) job.rateLimits = s.rateLimits;
  const exit = readTail(file(job.id, 'exit')).trim();
  let ended = false;
  if (exit !== '' || !alive(job.pid)) {
    ended = true;
    job.endedAt = now;
    const r = s.result;
    if (r) { job.cost = r.cost; job.turns = r.turns; job.usage = r.usage; job.result = clip(r.text, 20000); job.subtype = r.subtype; }
    if (s.denials.length) job.denials = s.denials;
    const code = exit === '' ? null : Number(exit);
    if (r && !r.isError && (code === 0 || code === null)) job.status = 'done';
    else {
      job.status = 'failed';
      const err = oneLine(readTail(file(job.id, 'err')).split('\n').filter(Boolean).slice(-3).join(' '), 300);
      job.error = r?.isError ? (r.subtype === 'error_max_budget_usd' ? `stopped at its budget of $${job.budgetUsd}` : oneLine(r.text || r.subtype, 300)) : err || (code === null ? 'ended without a result' : `exit code ${code}`);
    }
    job.activity = '';
  }
  const changed = ended || JSON.stringify([job.sessionId, job.activity, job.cost]) !== before;
  if (changed) saveJob(job);
  return { job, changed, ended };
}
// every few seconds from the server -> the jobs that ended since the last tick
export function jobsTick(now = Date.now()) {
  const ended = [];
  for (const j of runningJobs()) { const r = refreshJob(j, now); if (r.ended) ended.push(r.job); }
  return ended;
}
// the job and what it did, for the Desk
export function jobDetail(id) {
  const j = readJob(id);
  if (!j) throw notFound('Job not found');
  if (j.status === 'running') refreshJob(j);
  const s = parseStream(readTail(file(id, 'jsonl')));
  return { ...j, events: s.events.slice(-60), text: j.result || s.text };
}
export function stopJob(id, now = Date.now()) {
  const j = readJob(id);
  if (!j) throw notFound('Job not found');
  if (j.status !== 'running') return j;
  if (j.node) { j.status = 'stopped'; j.endedAt = now; j.activity = ''; j.error = 'stopped by the owner'; saveJob(j); return j; }   // the worker is told (server/nodes.js)
  try { process.kill(-j.pid, 'SIGTERM'); } catch { try { process.kill(j.pid, 'SIGTERM'); } catch { /* gone */ } }
  j.status = 'stopped'; j.endedAt = now; j.activity = ''; j.error = 'stopped by the owner';
  saveJob(j);
  return j;
}
// old jobs go after 30 days (the record and its files)
export function pruneJobs(now = Date.now(), keepMs = 30 * 864e5) {
  let n = 0;
  for (const j of listJobs({ limit: 100000 })) {
    if (j.status === 'running' || now - (j.endedAt || j.createdAt) < keepMs) continue;
    for (const ext of ['json', 'jsonl', 'err', 'exit', 'prompt']) fs.rmSync(file(j.id, ext), { force: true });
    n++;
  }
  return n;
}
export const pluginDir = () => ROOT;
