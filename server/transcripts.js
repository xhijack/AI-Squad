// Reads Claude Code transcripts (~/.claude/projects/<encoded-path>/*.jsonl, subagents/*.meta.json,
// ~/.claude/teams/*/config.json): which agent a session belongs to, what it is doing, open questions,
// recent events, and token cost. Parsing approach taken from the sopwer-squad / squad-3d prototypes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paths } from './config.js';
import { safeReaddir, statOf, readJson, oneLine, clip } from './util.js';

export const ACTIVE_MS = 90 * 1000;
const TAIL = 256 * 1024;

export const encodeProjectPath = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-');
export const projectDir = (root) => path.join(paths.claudeProjects(), encodeProjectPath(root));

export function readHead(file, n = 64 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(n);
    const len = fs.readSync(fd, buf, 0, n, 0);
    return buf.toString('utf8', 0, len);
  } catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function tailRecords(file, bytes = TAIL) {
  const st = statOf(file);
  if (!st || !st.size) return [];
  const start = Math.max(0, st.size - bytes);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(st.size - start);
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  const lines = buf.toString('utf8').split('\n');
  if (start > 0) lines.shift();                          // first line may be cut
  const out = [];
  for (const l of lines) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* skip */ } }
  return out;
}

const tsOf = (r) => Date.parse(r.timestamp || '') || 0;
const rel = (root, p) => { p = String(p || ''); return root && p.startsWith(root + '/') ? p.slice(root.length + 1) : path.basename(p); };

export function describeTool(name, input = {}, root = '') {
  switch (name) {
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return ['write', `editing ${rel(root, input.file_path)}`];
    case 'Read': return ['read', `reading ${rel(root, input.file_path)}`];
    case 'Grep': case 'Glob': return ['read', 'searching code'];
    case 'Bash': {
      const c = String(input.command || '');
      if (/\b(test|vitest|jest|pytest|playwright|tsc|lint)\b/.test(c)) return ['test', `running tests: ${oneLine(input.description || c, 60)}`];
      if (/\bgit (commit|add|merge|switch|checkout)\b/.test(c)) return ['git', `git: ${oneLine(c, 60)}`];
      return ['run', `terminal: ${oneLine(input.description || c, 60)}`];
    }
    case 'AskUserQuestion': return ['ask', 'asking the owner'];
    case 'SendMessage': return ['talk', `messaging ${input.to || 'the team'}`];
    case 'Agent': case 'Task': return ['plan', `delegating to ${input.subagent_type || input.name || 'an agent'}`];
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return ['plan', 'planning tasks'];
    case 'WebFetch': case 'WebSearch': return ['read', 'researching the web'];
    case 'Skill': return ['run', `using skill ${input.skill || ''}`.trim()];
    default: return ['run', name.startsWith('mcp__') ? `tool ${name.split('__')[1]}` : name];
  }
}

function toolDetail(name, input = {}, root = '') {
  if (name === 'Bash') return clip(input.command, 600);
  if (name === 'Edit' || name === 'MultiEdit') return rel(root, input.file_path) + (input.old_string != null ? `\n- ${clip(input.old_string, 200)}\n+ ${clip(input.new_string, 200)}` : '');
  if (name === 'Write') return `${rel(root, input.file_path)}\n${clip(input.content, 300)}`;
  if (name === 'Read') return rel(root, input.file_path);
  if (name === 'SendMessage') { const m = input.message ?? input.summary; return `to ${input.to}: ${clip(typeof m === 'string' ? m : JSON.stringify(m), 600)}`; }
  if (name === 'AskUserQuestion') return (input.questions || []).map((q) => q.question).join('\n');
  return clip(JSON.stringify(input), 300);
}

const resultText = (c) => (Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : String(c ?? ''));

// monitor content for a tool call: code being written or a terminal command (output added from its result)
function peekOf(c, root, ts, kind) {
  const i = c.input || {};
  if (/^(Edit|MultiEdit|Write)$/.test(c.name) && i.file_path) {
    const text = c.name === 'Write' ? i.content : c.name === 'Edit' ? i.new_string : (i.edits || []).map((e) => e.new_string).join('\n');
    // an edit also keeps the lines it replaced, so the developer's monitor can show the diff
    const old = c.name === 'Edit' ? i.old_string : c.name === 'MultiEdit' ? (i.edits || []).map((e) => e.old_string).join('\n') : null;
    return { id: c.id, type: 'code', path: rel(root, i.file_path), text: clip(String(text ?? ''), 1500), ...(old != null ? { old: clip(String(old), 1500) } : {}), ts, kind };
  }
  if (c.name === 'Bash') return { id: c.id, type: 'terminal', command: clip(String(i.command || ''), 400), text: '', output: '', ts, kind };
  return null;
}

// status of one transcript: last activity, unanswered AskUserQuestion, last end of turn, the text the
// agent ended its turn with (reply), events
export function transcriptStatus(file, root = '', { events = false } = {}) {
  const recs = tailRecords(file);
  let lastTs = 0, activity = '', kind = 'idle', ask = null, lastEndTurn = 0, model = '', modelTs = 0, turnOpen = false;
  let said = [], reply = null;                       // text since the last user record; reply = text of the last ended turn
  const evs = [];
  const messages = [];
  let peek = null;                                   // what the agent's monitor shows: latest code or command (+ output)
  for (const r of recs) {
    const ts = tsOf(r); if (!ts) continue;
    if (ts > lastTs) lastTs = ts;
    const msg = r.message || {};
    const content = Array.isArray(msg.content) ? msg.content : [];
    if (r.type === 'assistant') {
      if (msg.model && msg.model !== '<synthetic>') { model = msg.model; modelTs = ts; }
      turnOpen = msg.stop_reason !== 'end_turn';
      for (const c of content) if (c.type === 'text' && c.text?.trim() && said.at(-1) !== c.text.trim()) said.push(c.text.trim());
      if (!turnOpen) { lastEndTurn = ts; reply = said.length ? { ts, text: said.join('\n\n') } : null; }
      for (const c of content) {
        if (c.type === 'tool_use') {
          [kind, activity] = describeTool(c.name, c.input, root);
          if (c.name === 'AskUserQuestion') ask = { id: c.id, ts, questions: (c.input?.questions || []).map((q) => ({ header: q.header || '', question: q.question || '', options: (q.options || []).map((o) => o.label) })) };
          if (c.name === 'SendMessage') { const m = c.input?.summary ?? c.input?.message; messages.push({ ts, to: String(c.input?.to || ''), text: oneLine(typeof m === 'string' ? m : JSON.stringify(m), 160) }); }
          if (events) evs.push({ ts, kind, title: activity, tool: c.name, detail: toolDetail(c.name, c.input, root) });
          const pk = peekOf(c, root, ts, kind);
          if (pk) peek = pk;
        } else if (c.type === 'text' && c.text?.trim()) {
          kind = 'think'; activity = `thinking: ${oneLine(c.text, 70)}`;
          if (events) evs.push({ ts, kind: 'think', title: 'says', detail: clip(c.text.trim(), 900) });
        }
      }
    } else if (r.type === 'user') {
      if (!r.isMeta) { turnOpen = true; said = []; reply = null; }   // a task or a tool result: the agent continues
      if (typeof msg.content === 'string' && events && !r.isMeta && !msg.content.startsWith('<')) evs.push({ ts, kind: 'task', title: 'task from owner', detail: clip(msg.content, 900) });
      for (const c of content) {
        if (c.type === 'tool_result' && ask && c.tool_use_id === ask.id) ask = null;
        if (c.type === 'tool_result' && peek && c.tool_use_id === peek.id && peek.type === 'terminal') { peek.output = clip(resultText(c.content), 1500); peek.error = !!c.is_error; }
        if (events && c.type === 'tool_result' && c.is_error) evs.push({ ts, kind: 'error', title: 'tool error', detail: clip(Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : c.content, 400) });
        if (events && c.type === 'text' && c.text && !c.text.startsWith('<')) evs.push({ ts, kind: 'task', title: 'task from owner', detail: clip(c.text, 900) });
      }
    }
  }
  return { lastTs, activity, kind, ask, lastEndTurn, turnOpen, reply, model, modelTs, messages, peek, ...(events ? { events: evs.slice(-120) } : {}) };
}

// ---------- session ownership ----------
const ownerCache = new Map();          // file -> agent id ('' = owner's own session)
export function sessionAgent(file) {
  if (ownerCache.has(file)) return ownerCache.get(file);
  const head = readHead(file, 16 * 1024);
  const m = head.match(/"agentSetting":"([^"]+)"/);
  const owner = m ? m[1] : '';
  if (head.includes('\n')) ownerCache.set(file, owner);   // only cache once the header is written
  return owner;
}

export function sessionsOf(root) {
  const dir = projectDir(root);
  return safeReaddir(dir).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ file: path.join(dir, f), id: f.slice(0, -6), st: statOf(path.join(dir, f)) }))
    .filter((s) => s.st).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
}

// the agent's own Claude Code sessions (started with --agent <id>), newest first: [{ id, file, mtime }]
export const agentSessions = (root, agentId) => sessionsOf(root).filter((s) => sessionAgent(s.file) === agentId).map((s) => ({ id: s.id, file: s.file, mtime: s.st.mtimeMs }));
// the session a transcript file belongs to (subagent runs live under <session id>/subagents/)
export function parentSession(file) {
  const dir = path.basename(path.dirname(file));
  return dir === 'subagents' ? path.basename(path.dirname(path.dirname(file))) : path.basename(file).replace(/\.jsonl$/, '');
}

// latest transcript file per agent id (main sessions started with --agent and subagent/teammate runs)
export function agentTranscripts(root, recentSessions = 8) {
  const out = new Map();
  const put = (id, file, mtime) => { const cur = out.get(id); if (!cur || cur.mtime < mtime) out.set(id, { file, mtime }); };
  const sessions = sessionsOf(root);
  for (const s of sessions) put(sessionAgent(s.file) || '', s.file, s.st.mtimeMs);
  for (const s of sessions.slice(0, recentSessions)) {
    const sd = path.join(projectDir(root), s.id, 'subagents');
    for (const f of safeReaddir(sd)) {
      if (!f.endsWith('.jsonl')) continue;
      const st = statOf(path.join(sd, f)); if (!st) continue;
      const meta = readJson(path.join(sd, f.replace(/\.jsonl$/, '.meta.json')), {});
      for (const id of new Set([meta.customAgentType, meta.agentType, meta.name].filter(Boolean))) put(id, path.join(sd, f), st.mtimeMs);
    }
  }
  return out;
}

// most recent Agent Team whose lead works in this directory
export function teamFor(root) {
  let best = null;
  for (const d of safeReaddir(paths.claudeTeams())) {
    const cfg = path.join(paths.claudeTeams(), d, 'config.json');
    const st = statOf(cfg); if (!st) continue;
    const j = readJson(cfg, null); if (!j) continue;
    const lead = (j.members || []).find((m) => m.agentType === 'team-lead') || {};
    if (!lead.cwd || path.resolve(lead.cwd) !== path.resolve(root)) continue;
    if (!best || st.mtimeMs > best.mtime) best = { mtime: st.mtimeMs, name: j.name, members: (j.members || []).filter((m) => m.agentType !== 'team-lead').map((m) => ({ name: m.name, agentType: m.agentType, model: m.model || '' })) };
  }
  return best;
}

// hand-written agent definitions in <repo>/.claude/agents
export function agentDefs(root) {
  const dir = path.join(root, '.claude', 'agents');
  return safeReaddir(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const txt = readHead(path.join(dir, f), 8 * 1024);
    const fm = (txt.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    const get = (k) => ((fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '').trim();
    return { name: get('name') || f.slice(0, -3), description: get('description').slice(0, 160), model: get('model') };
  });
}

// ---------- discovery: directories with Claude Code activity ----------
let discoverCache = { at: 0, list: [] };
export function discoverProjects(maxAgeMs = 4000) {
  if (Date.now() - discoverCache.at < maxAgeMs) return discoverCache.list;
  const byRoot = new Map();
  const home = path.resolve(process.env.HOME || '/');
  for (const d of safeReaddir(paths.claudeProjects())) {
    const dir = path.join(paths.claudeProjects(), d);
    const sessions = safeReaddir(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ file: path.join(dir, f), st: statOf(path.join(dir, f)) }))
      .filter((s) => s.st).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    if (!sessions.length) continue;
    const cwd = (readHead(sessions[0].file).match(/"cwd":"([^"]+)"/) || [])[1];
    if (!cwd) continue;
    const root = path.resolve(cwd);
    if (root === home || root === '/' || root === '/tmp' || root === os.tmpdir() || !statOf(root)?.isDirectory()) continue;
    const p = byRoot.get(root) || { root, lastActive: 0, sessions: 0 };
    p.lastActive = Math.max(p.lastActive, sessions[0].st.mtimeMs); p.sessions += sessions.length;
    byRoot.set(root, p);
  }
  const list = [...byRoot.values()].map((p) => {
    const team = teamFor(p.root);
    const defs = agentDefs(p.root);
    return { ...p, name: path.basename(p.root), team: team ? team.name : null, agentDefs: defs.map((d) => d.name).slice(0, 12),
      hasFloorConfig: fs.existsSync(path.join(p.root, '.claude', 'aisquad', 'floor.json')) };
  }).sort((a, b) => b.lastActive - a.lastActive);
  discoverCache = { at: Date.now(), list };
  return list;
}
export const resetDiscoveryCache = () => { discoverCache.at = 0; };

// ---------- cost estimate from transcript usage ----------
// USD per 1M tokens. Cache writes: 5 min = 1.25x input, 1 h = 2x input. Fast mode = 2x.
export const PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, cr: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cr: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cr: 0.01 },
  'claude-fable-5-1': { in: 6, out: 30, cr: 0.3 },
};
// opus / sonnet / haiku / fable from an alias or a full model id ('' when unknown)
export const modelFamily = (m) => (String(m || '').toLowerCase().match(/opus|sonnet|haiku|fable/) || [''])[0];

export function priceFor(model) {
  if (PRICES[model]) return PRICES[model];
  for (const fam of ['opus', 'sonnet', 'haiku', 'fable']) if (String(model).includes(fam)) return Object.entries(PRICES).find(([k]) => k.includes(fam))[1];
  return null;
}
export function costOf(model, u = {}) {
  const p = priceFor(model);
  if (!p) return 0;
  const cwAll = u.cache_creation_input_tokens || 0;
  const cw1 = u.cache_creation?.ephemeral_1h_input_tokens || 0;
  const mult = u.speed === 'fast' ? 2 : 1;
  return mult * ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + Math.max(0, cwAll - cw1) * p.in * 1.25 + cw1 * p.in * 2 + (u.cache_read_input_tokens || 0) * p.cr) / 1e6;
}
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// incremental per-floor usage reader; streamed records repeat a message id with growing usage
export class CostTracker {
  constructor() { this.files = new Map(); this.byId = new Map(); }

  readFile(file, agent) {
    const st = statOf(file); if (!st) return;
    let f = this.files.get(file);
    if (!f) { f = { offset: 0, rest: '' }; this.files.set(file, f); }
    if (st.size < f.offset) { f.offset = 0; f.rest = ''; }
    if (st.size === f.offset) return;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - f.offset);
    try { fs.readSync(fd, buf, 0, buf.length, f.offset); } finally { fs.closeSync(fd); }
    f.offset = st.size;
    const lines = (f.rest + buf.toString('utf8')).split('\n');
    f.rest = lines.pop();
    for (const line of lines) {
      if (!line.includes('"usage"')) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      const m = r.message;
      if (r.type !== 'assistant' || !m?.usage || !m.id) continue;
      const cost = costOf(m.model, m.usage);
      const prev = this.byId.get(m.id);
      if (prev && prev.cost >= cost) continue;
      this.byId.set(m.id, { cost, day: dayKey(tsOf(r) || st.mtimeMs), ts: tsOf(r) || st.mtimeMs, agent });
    }
  }

  // scan the floor's project dir; only files touched in the last 32 days matter for day/month totals
  scan(root) {
    const since = Date.now() - 32 * 864e5;
    for (const s of sessionsOf(root)) {
      if (s.st.mtimeMs < since) continue;
      this.readFile(s.file, sessionAgent(s.file) || 'owner');
      const sd = path.join(projectDir(root), s.id, 'subagents');
      for (const f of safeReaddir(sd)) {
        if (!f.endsWith('.jsonl')) continue;
        const meta = readJson(path.join(sd, f.replace(/\.jsonl$/, '.meta.json')), {});
        this.readFile(path.join(sd, f), meta.customAgentType || meta.agentType || meta.name || 'subagent');
      }
    }
  }

  // cost per agent between two times (sprint windows for the performance dialog)
  costBetween(from, to) {
    const out = {};
    for (const e of this.byId.values()) if (e.ts >= from && e.ts < to) out[e.agent] = (out[e.agent] || 0) + e.cost;
    return out;
  }

  summary(now = Date.now()) {
    const today = dayKey(now), month = today.slice(0, 7);
    const out = { today: 0, month: 0, byAgentToday: {}, byAgentMonth: {} };
    for (const e of this.byId.values()) {
      if (e.day.startsWith(month)) { out.month += e.cost; out.byAgentMonth[e.agent] = (out.byAgentMonth[e.agent] || 0) + e.cost; }
      if (e.day === today) { out.today += e.cost; out.byAgentToday[e.agent] = (out.byAgentToday[e.agent] || 0) + e.cost; }
    }
    return out;
  }
}
