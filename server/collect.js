// Squad Log collectors: turn the sources The AI Squad already reads into log events (server/log.js).
//   transcripts   usage per turn, tool calls (duration, error), SendMessage, delegations, AskUserQuestion + answer, owner tasks
//   hook events   tool calls as they happen, permission prompts and how long they waited
//   docs + git    board rows, handoffs, QA reports, bugs, sprint plan / close, source documents, commits, gate decisions
// The same tool call or message seen by a hook and in a transcript has the same id (tool_use id), so it is logged once.
// Offsets and the last seen board are kept in ~/.aisquad/logs/<floor>/.state.json.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readJson, writeJson, statOf, safeReaddir, readText, clip, oneLine } from './util.js';
import { costOf } from './transcripts.js';
import { readConfig, parseTasks, hasPack } from './sprint.js';
import { sourceDocsStatus } from './blueprints.js';
import { isSecretPath, redact } from './redact.js';
import * as log from './log.js';

export const BACKFILL_MS = 7 * 864e5;                      // a new transcript is read back this far
const CHUNK = 8 * 2 ** 20;                                  // at most this much of one transcript per tick
const USAGE_SETTLE_MS = 20000;                              // the last streamed record of a reply has the final usage

// ---------- per-floor state ----------
const stateFile = (floorId) => path.join(log.logDir(floorId), '.state.json');
const states = new Map();
export function stateOf(floorId) {
  let s = states.get(floorId);
  if (!s) {
    s = readJson(stateFile(floorId), null) || {};
    s.files ||= {}; s.board ||= null; s.handoffs ||= null; s.qa ||= null; s.bugs ||= null; s.docs ||= null; s.commits ||= null; s.planned ||= {}; s.gates ||= 0; s.questions ||= null; s.debug ||= null; s.scope ||= null; s.reviewed ||= {}; s.second ||= {};
    states.set(floorId, s);
  }
  return s;
}
export function saveState(floorId) { const s = states.get(floorId); if (s) writeJson(stateFile(floorId), s); }
export const resetStates = () => { states.clear(); live.clear(); };

const rel = (root, p) => { p = String(p || ''); return root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p; };
// what a tool call touched: a path, a trimmed command, a pattern. Never file contents.
export function toolTarget(name, input = {}, root = '') {
  const i = input || {};
  const file = i.file_path || i.notebook_path || i.path;
  if (file && typeof file === 'string') return rel(root, file);
  if (i.command) return clip(redact(oneLine(i.command, 200)), 160);
  if (i.pattern) return clip(`${i.pattern}${i.glob ? ` in ${i.glob}` : ''}`, 120);
  if (i.url) return clip(String(i.url).split('?')[0], 160);
  if (name === 'Agent' || name === 'Task') return i.subagent_type || i.name || '';
  if (name === 'Skill') return i.skill || '';
  if (name === 'SendMessage') return String(i.to || '');
  return '';
}
const resultText = (c) => (Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : String(c ?? ''));
const tsOf = (r) => Date.parse(r.timestamp || '') || 0;
const textOf = (m) => (typeof m === 'string' ? m : m == null ? '' : JSON.stringify(m));

// ---------- writing: common fields filled from the Floor ----------
// the module an agent works on: its IN_PROGRESS row on the board
export function currentModule(floorId, agent) {
  const board = stateOf(floorId).board || {};
  const row = Object.entries(board).find(([task, r]) => agent && r.owner === agent && r.status === 'IN_PROGRESS' && modId(task));
  return row ? modId(row[0]) : null;
}
// an agent named in a file ("Tester: Sari") or a message to "main" (the lead's session) -> the team's agent id
export function resolveAgent(team = [], name) {
  if (!name) return name;
  if (team.some((a) => a.id === name)) return name;
  if (name === 'main' || name === 'team-lead') return team.find((a) => a.lead)?.id || name;
  const n = String(name).toLowerCase();
  const hit = team.filter((a) => String(a.displayName || '').toLowerCase().split(/\s+-\s+|\s+/)[0] === n || String(a.displayName || '').toLowerCase() === n);
  return hit.length === 1 ? hit[0].id : name;
}
// ctx: { team: [{ id, displayName, lead, role: { template } }], sprint, options: { messages, pii } } -> emit(ev)
// the linked repository an event touched (Phase 3.4): a tool call's file inside it, or a command that names its path
export function repoFor(e, repos = []) {
  if (e.repo || !repos.length || e.type !== 'tool.call') return e.repo || '';
  const t = String(e.data?.target || '');
  const hit = repos.find((r) => t === r.abs || t.startsWith(`${r.abs}/`) || (e.data?.tool === 'Bash' && (t.includes(r.abs) || t.includes(r.path))));
  return hit ? hit.id : '';
}
export function emitter(floorId, ctx = {}) {
  const team = ctx.team || [];
  return (ev) => {
    const e = normalize(ev, team);
    const repo = repoFor(e, ctx.repos);
    return log.append(floorId, {
      ...e,
      ...(repo ? { repo } : {}),
      role: e.role ?? team.find((a) => a.id === e.agent)?.role?.template ?? null,
      module: e.module ?? currentModule(floorId, e.agent),
      sprint: e.sprint ?? ctx.sprint ?? null,
    }, ctx.options || {});
  };
}
function normalize(ev, team) {
  const e = { ...ev, agent: resolveAgent(team, ev.agent) };
  if (e.data?.to && (e.type === 'message.sent' || e.type === 'task.delegated')) e.data = { ...e.data, to: resolveAgent(team, e.data.to) };
  return e;
}

// ---------- transcripts ----------
// ctx: { agent, role, root, subagent, backfillMs, emit(ev) }. Reads new lines of one transcript and emits events.
export function readTranscript(floorId, file, ctx, now = Date.now()) {
  const st = statOf(file); if (!st) return 0;
  const S = stateOf(floorId);
  let f = S.files[file];
  const backfill = ctx.backfillMs ?? BACKFILL_MS;
  if (!f) f = S.files[file] = { offset: st.mtimeMs < now - backfill ? st.size : 0 };
  f.tools ||= {}; f.asks ||= {};
  if (st.size < f.offset) f.offset = 0;                    // rewritten
  const emit = (ev) => { if (ev.ts >= now - backfill) ctx.emit({ agent: ctx.agent, role: ctx.role, session: path.basename(file, '.jsonl'), model: f.model || null, ...ev }); };
  const flushUsage = () => {
    const u = f.usage; if (!u) return;
    f.usage = null;
    const x = u.usage;
    emit({ type: 'usage.turn', id: `use:${u.id}`, ts: u.ts, model: u.model, data: { input: x.input_tokens || 0, output: x.output_tokens || 0,
      cacheRead: x.cache_read_input_tokens || 0, cacheWrite: x.cache_creation_input_tokens || 0, cost: +costOf(u.model, x).toFixed(6), ...(x.speed === 'fast' ? { fast: true } : {}) } });
  };
  let n = 0;
  if (st.size > f.offset) {
    const len = Math.min(st.size - f.offset, CHUNK);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, len, f.offset); } finally { fs.closeSync(fd); }
    const text = buf.toString('utf8');
    const end = text.lastIndexOf('\n');
    if (end >= 0) {
      f.offset += Buffer.byteLength(text.slice(0, end + 1));
      for (const line of text.slice(0, end).split('\n')) {
        if (!line) continue;
        let r; try { r = JSON.parse(line); } catch { continue; }
        n++;
        record(r, f, ctx, emit, flushUsage);
      }
      f.seenAt = now;
    }
  }
  if (f.usage && now - (f.seenAt || 0) > USAGE_SETTLE_MS) flushUsage();
  return n;
}

function record(r, f, ctx, emit, flushUsage) {
  const ts = tsOf(r); if (!ts) return;
  const msg = r.message || {};
  const content = Array.isArray(msg.content) ? msg.content : [];
  if (r.type === 'assistant') {
    if (msg.model && msg.model !== '<synthetic>') f.model = msg.model;
    if (msg.id && msg.usage) {
      if (f.usage && f.usage.id !== msg.id) flushUsage();
      f.usage = { id: msg.id, model: msg.model, usage: msg.usage, ts: f.usage?.id === msg.id ? f.usage.ts : ts };
    }
    for (const c of content) {
      if (c.type !== 'tool_use') continue;
      const i = c.input || {};
      f.tools[c.id] = { name: c.name, target: toolTarget(c.name, i, ctx.root), ts };
      if (c.name === 'SendMessage') emit({ type: 'message.sent', id: `msg:${c.id}`, ts, data: { to: String(i.to || ''), text: clip(textOf(i.message ?? i.summary), 2000), ...(i.summary && i.message ? { topic: clip(textOf(i.summary), 120) } : {}) } });
      if (c.name === 'Agent' || c.name === 'Task') emit({ type: 'task.delegated', id: `deleg:${c.id}`, ts, data: { to: String(i.subagent_type || i.name || 'subagent'), text: clip(String(i.prompt || i.description || ''), 2000) } });
      if (c.name === 'AskUserQuestion') {
        f.asks[c.id] = ts;
        const qs = Array.isArray(i.questions) ? i.questions : [];
        emit({ type: 'question.asked', id: `ask:${c.id}`, ts, data: { channel: 'AskUserQuestion', text: clip(qs.map((q) => q.question).join('\n'), 2000), options: qs.flatMap((q) => (q.options || []).map((o) => o.label)).slice(0, 12) } });
      }
    }
  } else if (r.type === 'user') {
    flushUsage();                                           // the reply before this record is complete
    // teammate messages arrive as user text too; the sender's SendMessage is already the event
    const owner = (t) => !ctx.subagent && !r.isMeta && t && !t.startsWith('<') && !t.startsWith('Caveat:') && !t.includes('<teammate-message') && !/^Another Claude session sent a message/.test(t);
    if (typeof msg.content === 'string' && owner(msg.content.trim()) && r.uuid) emit({ type: 'task.given', id: `task:${r.uuid}`, ts, data: { by: 'owner', text: clip(msg.content.trim(), 2000) } });
    for (const c of content) {
      if (c.type === 'text' && owner(String(c.text || '').trim()) && r.uuid) emit({ type: 'task.given', id: `task:${r.uuid}`, ts, data: { by: 'owner', text: clip(c.text.trim(), 2000) } });
      if (c.type !== 'tool_result') continue;
      const t = f.tools[c.tool_use_id];
      delete f.tools[c.tool_use_id];
      if (!t) continue;
      const err = !!c.is_error;
      emit({ type: 'tool.call', id: `tool:${c.tool_use_id}`, ts: t.ts, data: { tool: t.name, target: t.target, ms: Math.max(0, ts - t.ts), ok: !err, ...(err ? { error: clip(oneLine(resultText(c.content), 300), 200) } : {}) } });
      if (t.name === 'AskUserQuestion') {
        const asked = f.asks[c.tool_use_id] || t.ts;
        delete f.asks[c.tool_use_id];
        emit({ type: 'question.answered', id: `ans:${c.tool_use_id}`, ts, data: { channel: 'AskUserQuestion', answer: clip(resultText(c.content), 1000), waitMs: Math.max(0, ts - asked) } });
      }
    }
  }
  // tool calls without a result for an hour are dropped (session ended)
  for (const [id, t] of Object.entries(f.tools)) if (ts - t.ts > 3600e3) delete f.tools[id];
}

// ---------- hook events (live) ----------
const live = new Map();                                     // "floor/agent" -> { pre: { id: {ts, name, target} }, permission }
// key: "floor/agent"; body: the posted hook event. Returns the events to log (the caller adds sprint/module/role).
export function fromHook(key, body, root = '', now = Date.now()) {
  const p = body.payload || {};
  const name = String(body.event || p.hook_event_name || '');
  const agent = key.split('/')[1];
  const L = live.get(key) || { pre: {}, permission: null };
  live.set(key, L);
  const out = [];
  const base = { agent, session: p.session_id || null, ts: now };
  if (L.permission && name !== 'Notification' && name !== 'PreToolUse') {
    out.push({ ...base, type: 'permission.answered', id: `${L.permission.id}:a`, data: { tool: L.permission.tool, waitMs: now - L.permission.ts } });
    L.permission = null;
  }
  if (name === 'PreToolUse' && p.tool_use_id) L.pre[p.tool_use_id] = { ts: now, name: p.tool_name, target: toolTarget(p.tool_name, p.tool_input, root) };
  if (name === 'PostToolUse' && p.tool_use_id) {
    const pre = L.pre[p.tool_use_id];
    delete L.pre[p.tool_use_id];
    out.push({ ...base, ts: pre?.ts || now, type: 'tool.call', id: `tool:${p.tool_use_id}`, data: { tool: p.tool_name || pre?.name || '', target: pre?.target ?? toolTarget(p.tool_name, p.tool_input, root),
      ms: pre ? now - pre.ts : null, ok: !p.tool_error } });
  }
  if (name === 'Notification' && (p.notification_type === 'permission_prompt' || (/permission/i.test(String(p.message || '')) && p.notification_type !== 'idle_prompt')) && !L.permission) {
    const last = Object.values(L.pre).sort((a, b) => b.ts - a.ts)[0];
    L.permission = { id: `perm:${key}:${now}`, ts: now, tool: last?.name || '' };
    out.push({ ...base, type: 'permission.asked', id: L.permission.id, data: { tool: last?.name || '', target: last?.target || '', text: clip(String(p.message || ''), 300) } });
  }
  for (const [id, t] of Object.entries(L.pre)) if (now - t.ts > 3600e3) delete L.pre[id];
  return out;
}

// ---------- docs/squad, Blueprint documents, gate records ----------
const modId = (s) => (String(s).match(/\bM\d+\b/) || [])[0] || null;
const field = (text, k) => ((String(text || '').match(new RegExp(`^${k}:[ \\t]*(.+)$`, 'mi')) || [])[1] || '').trim();
const word = (s) => String(s || '').split(/[\s(]/)[0];
const mdIn = (dir) => safeReaddir(dir).filter((f) => f.endsWith('.md') && !/^(TEMPLATE|README)\.md$/i.test(f));

// rows of the QA report's tables marked FAILED: "1 Login with a wrong password"
function failedCriteria(text) {
  return String(text || '').split('\n').filter((l) => /^\s*\|/.test(l) && /\bFAIL(ED)?\b/.test(l) && !/OK \/ FAILED/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter((c) => c && !/^FAIL(ED)?$/i.test(c)).slice(0, 2).join(' ')).slice(0, 12);
}

// "1. Which payment provider? ... Answer: Midtrans" -> [{ n, text, answered, answer }]
export function questionItems(md) {
  const out = [];
  let cur = null;
  for (const line of String(md || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (m) { cur = { n: Number(m[1]), text: m[2], answered: false, answer: '' }; out.push(cur); continue; }
    if (!cur) continue;
    const a = line.match(/^\s*[-*>]?\s*\**(?:answer|owner answer|decision|jawaban)\**\s*[:：]\**\s*(.+)$/i);
    if (a) { cur.answered = true; cur.answer = a[1]; } else if (!cur.answered && line.trim()) cur.text += ` ${line.trim()}`;
  }
  return out;
}

// compares the files with the last state and returns events. floor: { workflow, blueprint (parsed) }
export function scanDocs(floorId, root, { blueprint = null } = {}, now = Date.now()) {
  const S = stateOf(floorId);
  const out = [];
  const pack = hasPack(root);
  const cfg = pack ? readConfig(root) : {};
  const sprint = cfg.SPRINT ? Number(cfg.SPRINT) || cfg.SPRINT : null;
  const squad = path.join(root, cfg.SQUAD_DOCS || 'docs/squad');
  // the first scan of a Floor only sets the baseline: what already existed is history, not something that just happened
  const baseline = S.board === null && S.handoffs === null;
  // board rows
  const boardFile = pack ? path.join(squad, 'TASKS.md') : path.join(root, 'docs', 'BOARD.md');
  const rows = parseTasks(readText(boardFile, ''));
  const board = Object.fromEntries(rows.map((r) => [r.task, { status: r.column, owner: r.owner }]));
  const prevBoard = S.board || {};
  for (const r of rows) {
    const before = prevBoard[r.task]?.status || null;
    if (before === r.column) continue;
    out.push({ type: 'board.changed', id: `board:${r.task}:${before}:${r.column}:${now}`, module: modId(r.task), agent: r.owner || null,
      data: { task: r.task, owner: r.owner || '', from: before, to: r.column, ...(before && ['DONE', 'REVIEW'].includes(before) && ['TODO', 'IN_PROGRESS'].includes(r.column) ? { reopened: true } : {}) } });
  }
  S.board = board;
  // handoffs
  const hdir = pack ? path.join(squad, 'handoff') : path.join(root, 'docs', 'handoffs');
  const handoffs = mdIn(hdir);
  const prevH = new Set(S.handoffs || []);
  for (const f of handoffs) if (!prevH.has(f)) out.push({ type: 'handoff.written', id: `handoff:${f}`, module: modId(f) || f.slice(0, -3), data: { module: modId(f) || f.slice(0, -3), file: path.relative(root, path.join(hdir, f)) } });
  S.handoffs = handoffs;
  if (pack) {
    // QA reports: a new report or a new round / status
    const qa = {};
    for (const f of mdIn(path.join(squad, 'qa'))) {
      const t = readText(path.join(squad, 'qa', f), '');
      const q = { status: word(field(t, 'STATUS')).toUpperCase(), round: parseInt(field(t, 'Round'), 10) || 1, tester: word(field(t, 'Tester')) };
      qa[f] = `${q.status}:${q.round}`;
      if ((S.qa || {})[f] === qa[f] || !q.status) continue;
      const module = modId(f) || f.slice(0, -3);
      out.push({ type: 'qa.report', id: `qa:${f}:${qa[f]}`, module, agent: q.tester || null, data: { module, round: q.round, status: q.status, failed: q.status === 'PASS' ? [] : failedCriteria(t), file: path.relative(root, path.join(squad, 'qa', f)) } });
    }
    S.qa = qa;
    // bugs: opened, then closed (VERIFIED, DEFERRED or CLOSED)
    const bugs = {};
    for (const f of mdIn(path.join(squad, 'bugs'))) {
      const t = readText(path.join(squad, 'bugs', f), '');
      const b = { status: word(field(t, 'STATUS')).toUpperCase(), severity: word(field(t, 'SEVERITY')) || 'Minor', owner: word(field(t, 'OWNER')), kind: word(field(t, 'KIND')) };
      bugs[f] = b.status;
      const id = f.slice(0, -3), prev = (S.bugs || {})[f];
      if (prev === undefined) out.push({ type: 'bug.opened', id: `bug:${id}:open`, module: modId(f), agent: b.owner || null, data: { bug: id, severity: b.severity, owner: b.owner, kind: b.kind } });
      if (prev !== b.status && ['VERIFIED', 'DEFERRED', 'CLOSED'].includes(b.status)) out.push({ type: 'bug.closed', id: `bug:${id}:${b.status}`, module: modId(f), agent: b.owner || null, data: { bug: id, status: b.status, severity: b.severity, owner: b.owner } });
    }
    S.bugs = bugs;
    // the sprint plan, once per sprint: modules and story points
    const plan = readText(path.join(squad, 'PLAN.md'), '');
    const mods = plan.split('\n').filter((l) => /^\s*\|/.test(l) && modId(l.split('|')[1] || ''));
    if (sprint != null && mods.length && !S.planned[sprint]) {
      const sp = mods.reduce((n, l) => n + (parseFloat((l.split('|')[3] || '').trim()) || 0), 0);
      S.planned[sprint] = now;
      out.push({ type: 'sprint.planned', id: `plan:${sprint}`, sprint, data: { modules: mods.length, sp, list: mods.map((l) => { const c = l.split('|').map((x) => x.trim()); return { module: modId(c[1]), sp: parseFloat(c[3]) || 0, owner: c[4] || '' }; }) } });
    }
    // the sprint's scope mode (first line of PLAN.md); a different mode later in the same sprint is a change the owner decides
    const sm = scopeMode(plan);
    if (sprint != null && sm) {
      if (!S.scope || S.scope.sprint !== sprint) { S.scope = { sprint, mode: sm.mode, changed: null }; out.push({ type: 'sprint.scope', id: `scope:${sprint}`, sprint, data: sm }); }
      else if (S.scope.mode !== sm.mode) {
        out.push({ type: 'scope.changed', id: `scope:${sprint}:${S.scope.mode}:${sm.mode}:${now}`, sprint, data: { from: S.scope.mode, to: sm.mode, reason: sm.reason } });
        S.scope = { ...S.scope, mode: sm.mode, changed: { from: S.scope.mode, to: sm.mode, reason: sm.reason, ts: now, acked: false } };
      }
    }
    // the plan review of the sprint (docs/squad/sprint-<N>/PLAN-REVIEW.md), once
    const review = sprint != null && !S.reviewed[sprint] ? readText(path.join(squad, `sprint-${sprint}`, 'PLAN-REVIEW.md'), '') : '';
    if (review) { S.reviewed[sprint] = now; out.push({ type: 'plan.reviewed', id: `review:${sprint}`, sprint, data: planReview(review) }); }
  }
  // second opinions on risky modules (docs/squad/review/Mxx-second-opinion.md): logged once per verdict
  if (pack) for (const f of mdIn(path.join(squad, 'review')).filter((x) => /second-opinion/i.test(x))) {
    const t = readText(path.join(squad, 'review', f), '');
    const verdict = word(field(t, 'VERDICT')).toUpperCase();
    if (!/^(AGREE|DISAGREE)$/.test(verdict) || S.second[f] === verdict) continue;
    S.second[f] = verdict;
    const rev = field(t, 'Reviewer'), module = modId(f) || modId(t.split('\n')[0]);
    out.push({ type: 'review.second', id: `second:${f}:${verdict}`, module, agent: word(rev) || null,
      data: { module, verdict, model: (rev.match(/\(([^)]+)\)/) || [])[1] || '', authorModel: field(t, 'Author model'), file: path.relative(root, path.join(squad, 'review', f)) } });
  }
  // investigate records (docs/squad/debug/*.md): each new "## Attempt N" is a fix attempt, STATUS: ESCALATED an escalation
  const ddir = pack ? path.join(squad, 'debug') : path.join(root, 'docs', 'debug');
  const debug = {};
  for (const f of mdIn(ddir)) {
    const t = readText(path.join(ddir, f), '');
    const d = { attempts: (t.match(/^##\s+Attempt\s+\d+/gmi) || []).length, status: word(field(t, 'STATUS')).toUpperCase() };
    debug[f] = d;
    const prev = (S.debug || {})[f] || { attempts: 0, status: '' };
    const issue = f.slice(0, -3), owner = word(field(t, 'Owner')) || null, module = modId(field(t, 'Module')) || modId(f);
    for (let n = prev.attempts + 1; n <= d.attempts; n++) out.push({ type: 'debug.attempt', id: `debug:${f}:${n}`, module, agent: owner, data: { issue, attempt: n, file: path.relative(root, path.join(ddir, f)) } });
    if (d.status === 'ESCALATED' && prev.status !== 'ESCALATED') out.push({ type: 'debug.escalated', id: `debug:${f}:escalated`, module, agent: owner, data: { issue, attempts: d.attempts, file: path.relative(root, path.join(ddir, f)) } });
  }
  S.debug = debug;
  // questions to the owner in the questions file: numbered items, answered once an "Answer:" line is in the item
  const qfile = pack ? path.join(squad, 'QUESTIONS.md') : path.join(root, 'docs', 'QUESTIONS.md');
  const questions = {};
  for (const q of questionItems(readText(qfile, ''))) {
    const prev = (S.questions || {})[q.n];
    questions[q.n] = { askedAt: prev?.askedAt || now, answered: q.answered };
    if (!prev && !baseline) out.push({ type: 'question.asked', id: `qfile:${q.n}:${now}`, data: { channel: 'QUESTIONS.md', n: q.n, text: clip(q.text, 1000) } });
    if (q.answered && prev && !prev.answered) out.push({ type: 'question.answered', id: `qfile:${q.n}:answered:${now}`, data: { channel: 'QUESTIONS.md', n: q.n, answer: clip(q.answer, 1000), waitMs: now - prev.askedAt } });
  }
  S.questions = questions;
  // source documents of the Blueprint: draft -> approved
  if (blueprint) {
    const docs = {};
    for (const d of sourceDocsStatus(root, blueprint)) {
      docs[d.path] = d.status;
      if ((S.docs || {})[d.path] !== d.status) out.push({ type: 'doc.status', id: `doc:${d.path}:${d.status}:${now}`, data: { doc: d.path, status: d.status, owner: d.owner } });
    }
    S.docs = docs;
  }
  // gate decisions recorded by the Squad Sprint hooks in .git/aisquad-gates.jsonl
  const gf = path.join(root, '.git', 'aisquad-gates.jsonl');
  const gst = statOf(gf);
  if (gst && gst.size > S.gates) {
    const text = (() => { try { const fd = fs.openSync(gf, 'r'); const b = Buffer.alloc(gst.size - S.gates); fs.readSync(fd, b, 0, b.length, S.gates); fs.closeSync(fd); return b.toString('utf8'); } catch { return ''; } })();
    const end = text.lastIndexOf('\n');
    for (const l of text.slice(0, end + 1).split('\n')) {
      let g; try { g = JSON.parse(l); } catch { continue; }
      out.push({ type: g.ok ? 'gate.passed' : 'gate.failed', id: `gate:${g.gate}:${g.ts}:${g.subject}`, ts: Date.parse(g.ts) || now, module: modId(g.subject), data: { gate: g.gate, subject: g.subject, ...(g.ok ? {} : { reason: g.reason }) } });
    }
    S.gates += Buffer.byteLength(text.slice(0, end + 1));
  }
  for (const e of out) { e.sprint ??= sprint; e.ts ??= now; }
  return baseline ? out.filter((e) => ['sprint.planned', 'doc.status', 'gate.passed', 'gate.failed'].includes(e.type)) : out;
}

export const SCOPE_MODES = ['Expand', 'Selective expand', 'Hold', 'Reduce'];
// "Scope mode: Hold — reason" -> { mode, reason } (placeholders in angle brackets are not a reason)
export function scopeMode(plan) {
  const m = String(plan || '').match(/^\**Scope mode:?\**\s*(Expand|Selective expand|Hold|Reduce)\b[ \t]*(?:[—–:-][ \t]*(.*))?$/mi);
  if (!m) return null;
  const mode = SCOPE_MODES.find((x) => x.toLowerCase() === m[1].toLowerCase());
  const reason = (m[2] || '').trim();
  return { mode, reason: /^</.test(reason) ? '' : reason.slice(0, 300) };
}
// PLAN-REVIEW.md -> { engineering, security: OK | CHANGES | '', designScore: number | null }
export function planReview(text) {
  const part = (title) => (String(text).split(/^## /m).find((x) => x.toLowerCase().startsWith(title)) || '');
  const verdict = (t) => ((t.match(/^VERDICT:\s*(OK|CHANGES)/mi) || [])[1] || '').toUpperCase();
  const score = (text.match(/DESIGN SCORE:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i) || [])[1];
  return { engineering: verdict(part('engineering')), security: verdict(part('security')), designScore: score != null ? +score : null };
}

// ---------- git commits ----------
const gitLog = (root, since) => new Promise((resolve) => execFile('git', ['-C', root, 'log', '--all', `--since=${Math.floor(since / 1000)}`, '--format=%H%x09%ct%x09%ae%x09%s', '-n', '300'],
  { timeout: 10000, maxBuffer: 4e6 }, (err, out) => resolve(err ? '' : String(out))));
// agentIds: team ids, so per-agent commit identities ({id}@agents...) are credited to the agent
export async function scanCommits(floorId, root, agentIds = [], now = Date.now()) {
  const S = stateOf(floorId);
  const known = new Set(S.commits || []);
  const out = [];
  for (const line of (await gitLog(root, now - BACKFILL_MS)).split('\n').reverse()) {
    const [sha, ct, email, ...subj] = line.split('\t');
    if (!sha || known.has(sha)) continue;
    known.add(sha);
    const subject = subj.join('\t');
    const agent = agentIds.find((id) => String(email).toLowerCase().startsWith(`${id}@`)) || null;
    out.push({ type: 'commit', id: `commit:${sha}`, ts: +ct * 1000, agent, module: modId(subject), data: { sha: sha.slice(0, 12), subject: clip(subject, 200) } });
    const closed = subject.trim().toLowerCase().match(/^docs\(squad\): close sprint (\d+)$/);
    if (closed) out.push({ type: 'sprint.closed', id: `close:${closed[1]}`, ts: +ct * 1000, sprint: Number(closed[1]), data: { sha: sha.slice(0, 12) } });
  }
  S.commits = [...known].slice(-1000);
  return out;
}

// ---------- merge executor ----------
export function fromMerge(entry) {
  const out = [];
  if (entry.gate) out.push({ type: entry.gate.ok ? 'gate.passed' : 'gate.failed', id: `mgate:${entry.id}`, ts: entry.finishedAt || entry.ts,
    data: { gate: 'merge', subject: entry.branch, command: entry.gate.command, ...(entry.gate.ok ? {} : { reason: `exit ${entry.gate.code}` }) } });
  if (entry.result === 'merged') out.push({ type: 'merge.done', id: `merge:${entry.id}`, ts: entry.finishedAt || entry.ts, data: { branch: entry.branch, into: entry.into, trigger: entry.trigger, commits: entry.commits || 0, ...(entry.push ? { pushed: entry.push.ok } : {}) } });
  else if (['refused', 'failed'].includes(entry.result)) out.push({ type: 'merge.refused', id: `merge:${entry.id}`, ts: entry.finishedAt || entry.ts, data: { branch: entry.branch, into: entry.into, trigger: entry.trigger, result: entry.result, reason: entry.reason || '' } });
  return out;
}

// ---------- agent states: idle with open work, crashes ----------
// agents: [{ id, state, running, inLead }], openWork: { [agentId]: open items of that agent }, teamOpen: open items of the team
// stoppedByUs: Set of agent ids stopped through The AI Squad since the last tick
export function stateChanges(floorId, agents, { teamOpen = 0, own = {}, stoppedByUs = new Set(), independent = false } = {}, now = Date.now()) {
  const S = stateOf(floorId);
  S.agents ||= {};
  const out = [];
  for (const a of agents) {
    const prev = S.agents[a.id];
    const cur = { state: a.state, running: !!a.running, inLead: !!a.inLead, since: prev && prev.state === a.state ? prev.since : now };
    S.agents[a.id] = cur;
    if (!prev) continue;
    // a teammate inside the lead's session ends with its task: that is a normal stop, not a crash
    // a.crash / a.ended: how the session ended, found by squad.js (out of memory, killed mid-turn, or the lead's crash)
    if (prev.running && !a.running && !stoppedByUs.has(a.id)) {
      out.push(a.crash ? { type: 'agent.crashed', agent: a.id, data: { lastState: prev.state, cause: a.crash.cause, at: a.crash.at, ...(a.crash.withLead ? { withLead: a.crash.withLead } : {}) } }
        : independent || prev.inLead || a.exited ? { type: 'agent.stopped', agent: a.id, data: { via: prev.inLead ? 'teammate finished' : a.exited ? 'exited' : 'process ended' } } : { type: 'agent.crashed', agent: a.id, data: { lastState: prev.state } });
    }
    if (!prev.running && a.running && independent) out.push({ type: 'agent.started', agent: a.id, data: { via: a.via || 'detected' } });
    const busy = (s) => s === 'working' || s === 'waiting';
    if (busy(prev.state) && a.state === 'idle') out.push({ type: 'agent.idle', agent: a.id, data: { openWork: teamOpen > 0, ownOpen: own[a.id] || 0, teamOpen } });
    if (prev.state === 'idle' && busy(a.state)) out.push({ type: 'agent.busy', agent: a.id, data: { idleMs: now - prev.since } });
  }
  return out.map((e) => ({ ...e, ts: now }));
}
