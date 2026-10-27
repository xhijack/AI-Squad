// SPDX-License-Identifier: Apache-2.0
// Squad Log: an append-only, structured record of how a squad worked, written for an AI to read later.
// ~/.aisquad/logs/<floor-id>/<YYYY-MM-DD>.jsonl, one event per line (schema: docs/LOG-SCHEMA.md). Machine-local,
// never in the repo. Day files older than 7 days are gzipped, files older than logRetentionDays are deleted.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { config } from './config.js';
import { safeReaddir, oneLine, clip } from './util.js';
import { redact, redactDeep } from './redact.js';

export const SCHEMA_VERSION = 1;
export const GZIP_AFTER_DAYS = 7;
export const DEFAULT_RETENTION_DAYS = 90;
export const INDEPENDENTS = 'independents';           // Floor 1 (independent agents) logs under this id

// type -> category (the timeline filters by either)
export const TYPES = {
  'agent.started': 'lifecycle', 'agent.stopped': 'lifecycle', 'agent.crashed': 'lifecycle', 'agent.resumed': 'lifecycle', 'agent.model': 'lifecycle',
  'task.given': 'work', 'board.changed': 'work', 'handoff.written': 'work', 'qa.report': 'work', 'bug.opened': 'work', 'bug.closed': 'work',
  'gate.passed': 'work', 'gate.failed': 'work', 'merge.done': 'work', 'merge.refused': 'work', 'sprint.planned': 'work', 'sprint.closed': 'work',
  'task.started': 'work', 'task.ended': 'work', 'job.started': 'work', 'job.ended': 'work',
  'dispatch.queued': 'work', 'dispatch.started': 'work', 'dispatch.failed': 'work', 'dispatch.removed': 'work', 'dispatch.idle-stopped': 'lifecycle', 'node.lost': 'lifecycle',
  'doc.status': 'work', 'doc.approved': 'work', 'debug.attempt': 'work', 'debug.escalated': 'work', 'sprint.scope': 'work', 'scope.changed': 'work', 'plan.reviewed': 'work', 'standup.held': 'work', 'ship.blocked': 'work', 'design.picked': 'work', 'review.second': 'work', 'commit': 'work',
  'message.sent': 'communication', 'task.delegated': 'communication', 'question.asked': 'communication', 'question.answered': 'communication',
  'permission.asked': 'communication', 'chat.message': 'communication', 'chat.reply': 'communication', 'permission.answered': 'communication', 'report.delivered': 'communication',
  'tool.call': 'tools',
  'usage.turn': 'usage', 'voice.spoken': 'usage',
  'agent.idle': 'idle', 'agent.busy': 'idle', 'watchdog.alert': 'idle',
  'audit.done': 'audit', 'improvement.decided': 'audit', 'retro.done': 'audit',
  'autopilot.decided': 'autopilot', 'autopilot.nudged': 'autopilot', 'autopilot.blocked': 'autopilot', 'autopilot.changed': 'autopilot',
};
export const CATEGORIES = [...new Set(Object.values(TYPES))];
// free text that the Floor setting "log message text" (log.messages = false) leaves out
const TEXT_FIELDS = ['text', 'prompt', 'answer', 'question', 'reason'];

export const logDir = (floorId) => path.join(config.home, 'logs', String(floorId).replace(/[^\w-]/g, '_'));
export const dayOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayFile = (floorId, day) => path.join(logDir(floorId), `${day}.jsonl`);
const n = (v) => (v == null || v === '' ? null : v);

// one line a human or an AI can scan, from metadata (and the text only when it may be logged)
function summarize(e) {
  const d = e.data, who = e.agent || 'someone', t = (s, k = 80) => (s ? `: ${oneLine(s, k)}` : '');
  switch (e.type) {
    case 'agent.started': return `${who} started (${[d.model || e.model, d.effort].filter(Boolean).join(', ') || 'default model'})`;
    case 'agent.stopped': return `${who} stopped`;
    case 'agent.crashed': return `${who} ${d.cause === 'oom' ? 'was killed: out of memory' : d.cause === 'killed' ? 'stopped unexpectedly mid-turn' : 'ended without a stop from The AI Squad'}${d.withLead ? ` (with the lead ${d.withLead})` : ''}`;
    case 'agent.resumed': return `${who} resumed its last session${d.via === 'auto-resume' ? ' automatically' : ''}`;
    case 'autopilot.decided': return d.by === 'lead' ? `the lead decided on its own (autopilot)${t(d.question)}` : `${who}'s question answered automatically with "${d.option}"${t(d.question, 60)}`;
    case 'autopilot.nudged': return d.kind === 'idle' ? `autopilot nudged ${who}: squad idle with ${d.open} open tasks` : `autopilot nudged ${who} to decide an unanswered ask`;
    case 'autopilot.blocked': return `critical item waits for the owner (${(d.reasons || []).join(', ')})${t(d.question, 60)}`;
    case 'autopilot.changed': return `the owner changed an autopilot decision from "${d.from}" to "${d.to}"`;
    case 'report.delivered': return `${who} finished and reported to the owner${d.asks ? ' (asks for a reply)' : ''}${t(d.text)}`;
    case 'debug.attempt': return `${who}: fix attempt ${d.attempt} on ${d.issue}`;
    case 'debug.escalated': return `${who} escalated ${d.issue} to the lead after ${d.attempts} attempts`;
    case 'retro.done': return `retro for sprint ${e.sprint}: ${d.wentWell} went well, ${d.wentBadly} did not, ${d.changes} changes`;
    case 'sprint.scope': return `sprint ${e.sprint} scope mode: ${d.mode}${d.reason ? ` (${oneLine(d.reason, 60)})` : ''}`;
    case 'scope.changed': return `scope mode changed mid-sprint: ${d.from} -> ${d.to}`;
    case 'plan.reviewed': return `plan of sprint ${e.sprint} reviewed: engineering ${d.engineering || '?'}, design ${d.designScore ?? '?'}/10, security ${d.security || '?'}`;
    case 'standup.held': return `standup: ${d.done} done, ${d.doing} in progress, ${d.blocked} blocked${d.meeting ? ' (at the table)' : ''}`;
    case 'ship.blocked': return `${d.branch} not merged: missing ${(d.missing || []).join(', ')}`;
    case 'design.picked': return `the owner picked "${d.title}" for ${d.screen} over ${d.others} other variant${d.others === 1 ? '' : 's'}`;
    case 'review.second': return `second opinion on ${e.module || d.module}: ${d.verdict}${d.model ? ` (${d.model})` : ''}`;
    case 'voice.spoken': return `${who} spoke (${d.chars} characters${d.cached ? ', from the cache' : ''})`;
    case 'agent.model': return `${who} runs ${d.observed}, configured ${d.configured}`;
    case 'task.given': return `${d.by || 'owner'} gave ${who} a task${t(d.text)}`;
    case 'task.delegated': return `${who} delegated to ${d.to}${t(d.text)}`;
    case 'board.changed': return `${d.task}: ${d.from || 'new'} -> ${d.to}${d.owner ? ` (${d.owner})` : ''}`;
    case 'handoff.written': return `handoff ${d.module} written`;
    case 'qa.report': return `QA ${d.module} round ${d.round}: ${d.status}${d.failed?.length ? ` (${d.failed.length} failed)` : ''}`;
    case 'bug.opened': return `bug ${d.bug} opened (${d.severity}${d.owner ? `, ${d.owner}` : ''})`;
    case 'bug.closed': return `bug ${d.bug} ${String(d.status).toLowerCase()}`;
    case 'gate.passed': return `${d.gate} gate passed${d.subject ? ` for ${d.subject}` : ''}`;
    case 'gate.failed': return `${d.gate} gate failed${d.subject ? ` for ${d.subject}` : ''}${t(d.reason)}`;
    case 'merge.done': return `merged ${d.branch} into ${d.into}`;
    case 'merge.refused': return `merge of ${d.branch} ${d.result}${t(d.reason)}`;
    case 'sprint.planned': return `sprint ${e.sprint} planned: ${d.modules} modules, ${d.sp} SP`;
    case 'sprint.closed': return `sprint ${e.sprint} closed`;
    case 'doc.status': return `${d.doc} is ${d.status}`;
    case 'doc.approved': return `${d.doc} approved by the ${d.by || 'owner'}`;
    case 'commit': return `commit ${d.sha}${t(d.subject)}`;
    case 'message.sent': return `${who} -> ${d.to}${t(d.text)}`;
    case 'question.asked': return `${who} asked the owner${t(d.text)}`;
    case 'question.answered': return `owner answered ${who} after ${secs(d.waitMs)}${t(d.answer, 60)}`;
    case 'permission.asked': return `${who} waits for permission${d.tool ? ` (${d.tool})` : ''}`;
    case 'permission.answered': return `${who} got permission after ${secs(d.waitMs)}`;
    case 'tool.call': return `${who} ${d.tool}${d.target ? ` ${oneLine(d.target, 60)}` : ''}${d.ok ? '' : ' FAILED'}${d.ms != null ? ` (${secs(d.ms)})` : ''}`;
    case 'usage.turn': return `${who} turn: ${d.input + d.cacheRead + d.cacheWrite} in, ${d.output} out, $${(+d.cost || 0).toFixed(4)}`;
    case 'task.started': return `${who} started ${d.label || d.kind}`;
    case 'job.started': return `${who} started a background job${t(d.title)}`;
    case 'node.lost': return `${who}'s job was lost with the machine ${d.node} and queued again`;
    case 'dispatch.queued': return `${who} queued (${d.action}, ${d.priority}): ${d.reason}`;
    case 'dispatch.started': return `${who} started from the queue (${d.action}) after ${Math.round((d.waitedMs || 0) / 60e3)} min`;
    case 'dispatch.failed': return `${who} could not start from the queue: ${oneLine(d.error || '', 80)}${d.dropped ? ' (removed)' : ''}`;
    case 'dispatch.removed': return `${who} removed from the queue`;
    case 'dispatch.idle-stopped': return `${who} stopped after ${d.idleMin} min idle to free its slot`;
    case 'chat.message': return `${d.from || 'Owner'} → ${who} (chat${d.context === 'general' ? ', general' : ''}): ${oneLine(d.text || '', 80)}`;
    case 'chat.reply': return `${who} answered in the chat${d.status && d.status !== 'done' ? ` (${d.status})` : ''}`;
    case 'job.ended': return `${who}'s background job ${d.status}${d.node ? ` on ${d.node}` : ''}${d.cost != null ? ` ($${(+d.cost).toFixed(2)})` : ''}${d.error ? `: ${oneLine(d.error, 80)}` : ''}`;
    case 'task.ended': return `${who} ${d.label || d.kind} ${d.status === 'completed' ? 'finished' : d.status} after ${secs(d.ms)}${d.summary ? `: ${d.summary}` : ''}`;
    case 'agent.idle': return `${who} idle${d.openWork ? ' with open work' : ''}`;
    case 'agent.busy': return `${who} working again after ${secs(d.idleMs)}`;
    case 'watchdog.alert': return `watchdog ${d.kind}${t(d.text)}`;
    case 'audit.done': return `audit: ${d.findings} findings, cost $${(+d.cost || 0).toFixed(3)}`;
    case 'improvement.decided': return `improvement ${d.decision}: ${d.target}`;
    default: return e.type;
  }
}
const secs = (ms) => (ms == null ? '?' : ms < 60e3 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60e3)} min`);

// ---------- dedupe: the same id (message id, tool_use id) is logged once ----------
const seen = new Map();                                   // floorId -> Set(ids)
const MAX_SEEN = 50000;
function seenSet(floorId, now) {
  let s = seen.get(floorId);
  if (s) return s;
  s = new Set();
  // ids from the last two days: a restart must not log again what hooks already logged
  for (const day of [dayOf(now - 864e5), dayOf(now)]) for (const e of readFile(dayFile(floorId, day))) if (e.id) s.add(e.id);
  seen.set(floorId, s);
  return s;
}
export const resetSeen = () => seen.clear();

// ev: { type, id?, ts?, sprint?, module?, agent?, role?, session?, model?, data? }
// opts: { messages: log free text (default true), pii: mask personal data (default true) }
// returns the written event, or null for a duplicate
export function append(floorId, ev, { messages = true, pii = true } = {}, now = Date.now()) {
  if (!TYPES[ev.type]) throw new Error(`Unknown log event type: ${ev.type}`);
  const ts = Number.isFinite(ev.ts) ? ev.ts : Date.parse(ev.ts || '') || now;
  const ids = seenSet(floorId, now);
  if (ev.id && ids.has(ev.id)) return null;
  let data = redactDeep(ev.data || {}, { pii });
  if (!messages) {
    data = { ...data };
    for (const k of TEXT_FIELDS) if (typeof data[k] === 'string') { data[`${k}Chars`] = data[k].length; delete data[k]; }
  }
  const e = { v: SCHEMA_VERSION, id: ev.id || crypto.randomBytes(6).toString('hex'), ts: new Date(ts).toISOString(), floor: floorId,
    sprint: n(ev.sprint), module: n(ev.module), agent: n(ev.agent), role: n(ev.role), session: n(ev.session), model: n(ev.model), ...(ev.repo ? { repo: String(ev.repo) } : {}), type: ev.type, summary: '', data };
  e.summary = clip(redact(summarize(e), { pii }), 200);
  const file = dayFile(floorId, dayOf(ts));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(e) + '\n');
  ids.add(e.id);
  if (ids.size > MAX_SEEN) ids.delete(ids.values().next().value);
  return e;
}

// ---------- read ----------
function readFile(file) {
  let text = '';
  try { text = file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)).toString('utf8') : fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* torn line */ } }
  return out;
}
const toMs = (v, d) => (v == null || v === '' ? d : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(v) || d);
const matches = (list, value) => !list.length || list.includes(value);

// q: { from, to (ISO or ms), type (comma list of types or categories), agent (comma list), sprint, module, repo, limit }
export function read(floorId, q = {}) {
  const from = toMs(q.from, 0), to = toMs(q.to, Infinity);
  const types = String(q.type || '').split(',').map((s) => s.trim()).filter(Boolean);
  const agents = String(q.agent || '').split(',').map((s) => s.trim()).filter(Boolean);
  const files = safeReaddir(logDir(floorId)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl(\.gz)?$/.test(f)).filter((f) => {
    const start = Date.parse(`${f.slice(0, 10)}T00:00:00`);
    return start + 2 * 864e5 > from && start - 864e5 <= to;          // local days, a day of slack either side
  }).sort();
  const out = [];
  for (const f of files) for (const e of readFile(path.join(logDir(floorId), f))) {
    const ts = Date.parse(e.ts);
    if (ts < from || ts > to) continue;
    if (types.length && !types.some((t) => t === e.type || t === TYPES[e.type] || e.type.startsWith(`${t}.`))) continue;
    if (!matches(agents, e.agent)) continue;
    if (q.repo && (e.repo || '') !== (q.repo === 'primary' ? '' : q.repo)) continue;   // a linked repository, or 'primary'
    if (q.sprint != null && q.sprint !== '' && String(e.sprint) !== String(q.sprint)) continue;
    if (q.module && e.module !== q.module) continue;
    out.push(e);
  }
  out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const limit = Math.max(1, Math.min(Number(q.limit) || 5000, 50000));
  return out.slice(-limit);
}
export const floorsWithLogs = () => safeReaddir(path.join(config.home, 'logs')).filter((d) => !d.startsWith('.'));

// ---------- rotation and retention ----------
export function maintain({ retentionDays = DEFAULT_RETENTION_DAYS, now = Date.now() } = {}) {
  const today = Date.parse(`${dayOf(now)}T00:00:00`);
  const out = { gzipped: 0, deleted: 0 };
  for (const floorId of floorsWithLogs()) {
    const dir = logDir(floorId);
    for (const f of safeReaddir(dir)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/);
      if (!m) continue;
      const age = Math.round((today - Date.parse(`${m[1]}T00:00:00`)) / 864e5);
      const file = path.join(dir, f);
      if (age > retentionDays) { fs.rmSync(file, { force: true }); out.deleted++; continue; }
      if (!m[2] && age > GZIP_AFTER_DAYS) {
        // late events for an already gzipped day are added to its archive
        const prev = fs.existsSync(`${file}.gz`) ? zlib.gunzipSync(fs.readFileSync(`${file}.gz`)) : Buffer.alloc(0);
        fs.writeFileSync(`${file}.gz`, zlib.gzipSync(Buffer.concat([prev, fs.readFileSync(file)])));
        fs.rmSync(file);
        out.gzipped++;
      }
    }
  }
  return out;
}
