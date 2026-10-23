// The live Building: Floor summaries, agent states, Attention, running agents and sending tasks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from './config.js';
import { readJson, writeJson, statOf, bad, notFound } from './util.js';
import * as building from './building.js';
import * as floors from './floors.js';
import * as tx from './transcripts.js';
import * as tm from './tmux.js';
import * as wd from './watchdog.js';

// ---------- runtime state (work items per agent; machine-local, never in the repo) ----------
const loadRuntime = () => { const r = readJson(paths.runtime(), {}) || {}; return { work: r.work || {} }; };
const saveRuntime = (r) => writeJson(paths.runtime(), r);
const workKey = (floorId, agentId) => `${floorId}/${agentId}`;

export function workOf(floorId) {
  const out = {};
  for (const [k, v] of Object.entries(loadRuntime().work)) if (k.startsWith(floorId + '/')) out[k.slice(floorId.length + 1)] = v;
  return out;
}
function setWork(floorId, agentId, item) {
  const r = loadRuntime();
  if (item) r.work[workKey(floorId, agentId)] = item; else delete r.work[workKey(floorId, agentId)];
  saveRuntime(r);
}
export function clearWork(floorId, agentId) { setWork(floorId, agentId, null); }

// ---------- caches ----------
const statusCache = new Map();           // file -> { key, value }
function statusOf(file, root, events = false) {
  const st = statOf(file); if (!st) return null;
  const key = `${st.mtimeMs}:${st.size}:${events}`;
  const c = statusCache.get(file);
  if (c && c.key === key) return c.value;
  const value = tx.transcriptStatus(file, root, { events });
  statusCache.set(file, { key, value });
  if (statusCache.size > 400) statusCache.delete(statusCache.keys().next().value);
  return value;
}
const costs = new Map();                  // floorId -> { tracker, at }
function costFor(floorId, root) {
  let c = costs.get(floorId);
  if (!c) { c = { tracker: new tx.CostTracker(), at: 0 }; costs.set(floorId, c); }
  if (Date.now() - c.at > 15000) { try { c.tracker.scan(root); } catch { /* unreadable transcripts */ } c.at = Date.now(); }
  return c.tracker.summary();
}

// ---------- live view of one Floor ----------
function liveAgents(entry, team, sessions, { events = false } = {}) {
  const now = Date.now();
  const transcripts = tx.agentTranscripts(entry.path);
  const work = workOf(entry.id);
  return team.agents.map((a) => {
    const name = tm.sessionName(entry.id, a.id);
    const running = sessions.has(name);
    const screen = running ? tm.capture(name) : '';
    const dialog = running ? tm.parsePrompt(screen) : null;
    const t = transcripts.get(a.id);
    const st = t ? statusOf(t.file, entry.path, events) : null;
    const recent = st && now - st.lastTs < tx.ACTIVE_MS;
    const busy = running && tm.isBusy(screen);
    const state = dialog || (st?.ask && (running || recent)) ? 'waiting' : busy || recent ? 'working' : running ? 'idle' : 'stopped';
    const w = work[a.id];
    if (w && !w.doneAt && st && st.lastEndTurn > w.assignedAt && !busy && !dialog) { w.doneAt = st.lastEndTurn; setWork(entry.id, a.id, w); }
    if (dialog && st?.ask?.questions?.length) {
      // the screen often cuts long questions; the transcript has the full text
      dialog.question = st.ask.questions.map((q) => (q.header ? `[${q.header}] ` : '') + q.question).join('\n\n');
    }
    return { agent: a, session: name, running, state, dialog, status: st, lastTs: st?.lastTs || 0, work: w || null, screen };
  });
}

function agentView(root, l, cost) {
  let eff = null, error = null;
  try { eff = floors.effectiveOf(root, l.agent); } catch (e) { error = e.message; }
  return {
    id: l.agent.id, displayName: l.agent.displayName, lead: !!l.agent.lead,
    role: l.agent.role, title: eff?.title || l.agent.role.template, model: eff?.model || '', appearance: eff?.appearance || l.agent.appearance || {},
    state: l.state, running: l.running, activity: l.status?.activity || '', lastTs: l.lastTs, session: l.session,
    work: l.work, costToday: +(cost.byAgentToday[l.agent.id] || 0).toFixed(2), templateStatus: floors.templateStatus(root, l.agent), error,
  };
}

const attId = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
const PERMISSION = /(do you want to|allow|permission|proceed|trust|make this edit|run this command)/i;

function floorAttention(entry, floor, lives, cost) {
  const out = [];
  for (const l of lives) {
    if (l.dialog) {
      out.push({ id: attId(l.session, l.dialog.question, l.dialog.options.map((o) => o.label).join('|')), kind: PERMISSION.test(l.dialog.question) ? 'permission' : 'question',
        floorId: entry.id, floorNumber: entry.number, floorName: floor.name, agentId: l.agent.id, agentName: l.agent.displayName,
        text: l.dialog.question, options: l.dialog.options, answerable: true, ts: l.lastTs || Date.now() });
    } else if (l.status?.ask && l.state === 'waiting') {
      const q = l.status.ask.questions;
      out.push({ id: attId(entry.id, l.agent.id, l.status.ask.id), kind: 'question', floorId: entry.id, floorNumber: entry.number, floorName: floor.name,
        agentId: l.agent.id, agentName: l.agent.displayName, text: q.map((x) => x.question).join('\n\n'),
        options: (q[0]?.options || []).map((label, i) => ({ n: i + 1, label, free: false })), answerable: false, ts: l.status.ask.ts });
    }
  }
  const work = workOf(entry.id);
  for (const s of wd.stallAlerts(lives.map((l) => ({ id: l.agent.id, displayName: l.agent.displayName, lead: !!l.agent.lead, state: l.state, lastTs: l.lastTs })), work)) {
    out.push({ id: attId('stall', entry.id, s.agent || ''), kind: 'stall', floorId: entry.id, floorNumber: entry.number, floorName: floor.name, agentId: s.agent || null, text: s.text, ts: Date.now() });
  }
  const b = wd.budgetStatus(floor.budget, cost);
  if (b.level === 'over') out.push({ id: attId('budget', entry.id, floor.budget.period), kind: 'budget', floorId: entry.id, floorNumber: entry.number, floorName: floor.name, text: `Budget reached: $${b.used.toFixed(2)} of $${floor.budget.usd} this ${floor.budget.period}`, ts: Date.now() });
  return out;
}

function floorState(entry, opts = {}) {
  if (!fs.existsSync(entry.path)) return { entry, missing: true };
  let cfg;
  try { cfg = floors.readFloor(entry.path); } catch (e) { return { entry, missing: true, error: e.message }; }
  const sessions = new Set(opts.sessions || tm.listSessions());
  const lives = liveAgents(entry, cfg.team, sessions, opts);
  const cost = costFor(entry.id, entry.path);
  return { entry, cfg, lives, cost, attention: floorAttention(entry, cfg.floor, lives, cost), budget: wd.budgetStatus(cfg.floor.budget, cost) };
}

const round2 = (n) => +(+n || 0).toFixed(2);

function summary(fs_) {
  const { entry } = fs_;
  if (fs_.missing) return { id: entry.id, number: entry.number, path: entry.path, missing: true, name: path.basename(entry.path), error: fs_.error || 'Directory not found', agents: [], attention: 0 };
  const { cfg, lives, cost } = fs_;
  const agents = lives.map((l) => agentView(entry.path, l, cost));
  const count = (s) => agents.filter((a) => a.state === s).length;
  const lamp = fs_.attention.length ? 'attention' : count('working') ? 'working' : agents.some((a) => a.running) ? 'idle' : 'stopped';
  return {
    id: entry.id, number: entry.number, path: entry.path, name: cfg.floor.name, goal: cfg.floor.goal, accent: cfg.floor.accent, layout: cfg.floor.layout,
    workflow: cfg.floor.workflow, desks: cfg.floor.desks, devices: cfg.floor.devices, agents, lamp,
    counts: { working: count('working'), waiting: count('waiting'), idle: count('idle'), stopped: count('stopped') },
    cost: { today: round2(cost.today), month: round2(cost.month) }, budget: { ...cfg.floor.budget, ...fs_.budget, used: round2(fs_.budget.used) },
    attention: fs_.attention.length, updates: agents.filter((a) => a.templateStatus.updateAvailable).length,
  };
}

// ---------- public API ----------
let snapCache = { at: 0, value: null };
export function buildingSnapshot() {
  if (Date.now() - snapCache.at < 1500 && snapCache.value) return snapCache.value;
  const b = building.loadBuilding();
  const sessions = tm.listSessions();
  const states = b.floors.map((e) => floorState(e, { sessions }));
  const res = wd.readResources();
  const attention = [
    ...wd.resourceWarnings(res).map((w) => ({ id: attId('resource', w.key), kind: 'resource', floorId: null, text: w.text, ts: res.ts })),
    ...states.flatMap((s) => s.attention || []),
  ];
  for (const s of states) if (s.budget?.level === 'warn') attention.push({ id: attId('budget-warn', s.entry.id), kind: 'budget', level: 'warn', floorId: s.entry.id, floorNumber: s.entry.number, floorName: s.cfg.floor.name, text: `Budget at ${s.budget.pct} %: $${s.budget.used.toFixed(2)} of $${s.cfg.floor.budget.usd} this ${s.cfg.floor.budget.period}`, ts: Date.now() });
  const floorPaths = new Set(b.floors.map((f) => f.path));
  const detected = tx.discoverProjects().filter((p) => !floorPaths.has(p.root)).slice(0, 30);
  const floorsOut = states.map(summary).sort((x, y) => x.number - y.number);
  const value = {
    name: b.name, now: Date.now(), floors: floorsOut, attention, detected,
    resources: { mem: res.mem, swap: res.swap, disk: res.disk, load: res.load, cpus: res.cpus, warnings: wd.resourceWarnings(res).map((w) => w.text) },
    costToday: round2(floorsOut.reduce((n, f) => n + (f.cost?.today || 0), 0)),
    options: { layouts: floors.LAYOUTS, workflows: floors.WORKFLOWS, deviceTypes: floors.DEVICE_TYPES, deskDevices: floors.DESK_DEVICES,
      branchStrategies: floors.BRANCH_STRATEGIES, pushPolicies: floors.PUSH_POLICIES, nextFloorNumber: building.nextFloorNumber(b) },
  };
  snapCache = { at: Date.now(), value };
  return value;
}
export const invalidate = () => { snapCache.at = 0; tx.resetDiscoveryCache(); };

export function floorDetail(id) {
  const entry = building.floorEntry(id);
  const s = floorState(entry, { events: true });
  if (s.missing) return { ...summary(s) };
  const sum = summary(s);
  const feed = [], messages = [];
  for (const l of s.lives) {
    for (const e of l.status?.events || []) if (e.kind !== 'read') feed.push({ ...e, agentId: l.agent.id, agentName: l.agent.displayName, detail: e.detail.slice(0, 200) });
    for (const m of l.status?.messages || []) messages.push({ ...m, from: l.agent.id, fromName: l.agent.displayName });
  }
  feed.sort((a, b) => b.ts - a.ts); messages.sort((a, b) => b.ts - a.ts);
  const team = s.cfg.team.agents.map((a) => {
    let effective = null; try { effective = floors.effectiveOf(entry.path, a); } catch { /* shown as error in summary */ }
    return { ...a, effective, templateStatus: floors.templateStatus(entry.path, a) };
  });
  return { ...sum, floor: s.cfg.floor, git: s.cfg.git, team, brief: readBriefSafe(entry.path), feed: feed.slice(0, 60), messages: messages.slice(0, 40),
    attentionItems: s.attention, teamName: tx.teamFor(entry.path)?.name || null };
}

function readBriefSafe(root) { try { return fs.readFileSync(path.join(root, 'AISQUAD.md'), 'utf8').slice(0, 20000); } catch { return ''; } }

export function deskDetail(floorId, agentId) {
  const entry = building.floorEntry(floorId);
  const cfg = floors.readFloor(entry.path);
  const agent = cfg.team.agents.find((a) => a.id === agentId);
  if (!agent) throw notFound(`Agent not found: ${agentId}`);
  const [l] = liveAgents(entry, { agents: [agent] }, new Set(tm.listSessions()), { events: true });
  const cost = costFor(entry.id, entry.path);
  let effective = null, error = null;
  try { effective = floors.effectiveOf(entry.path, agent); } catch (e) { error = e.message; }
  return {
    floorId, ...agentView(entry.path, l, cost), agent, effective, error,
    screen: l.running ? tm.capture(l.session, 300).replace(/\s+$/, '') : '', dialog: l.dialog,
    events: (l.status?.events || []).slice(-80).reverse(), model: effective?.model, modelId: l.status?.model || '',
    pending: pending.has(workKey(floorId, agentId)) ? pending.get(workKey(floorId, agentId)).text : null,
    attach: `tmux attach -t ${l.session}`,
  };
}

export function attentionItems() { return buildingSnapshot().attention; }

// ---------- agents: start / stop / task / answer ----------
const pending = new Map();                // floor/agent -> { text, since } (typed once Claude is ready)

function locate(floorId, agentId) {
  const entry = building.floorEntry(floorId);
  const cfg = floors.readFloor(entry.path);
  const agent = cfg.team.agents.find((a) => a.id === agentId);
  if (!agent) throw notFound(`Agent not found: ${agentId}`);
  return { entry, cfg, agent, name: tm.sessionName(floorId, agentId) };
}

export async function startAgent(floorId, agentId, task = '') {
  const { entry, agent, name } = locate(floorId, agentId);
  floors.generate(entry.path);                          // agent file is current before Claude reads it
  const eff = floors.effectiveOf(entry.path, agent);
  const r = await tm.startSession({ name, cwd: entry.path, agentId, disallowedTools: eff.permissions.deny });
  if (!r.ok) throw bad('Could not start the agent (is tmux installed?)');
  if (task) pending.set(workKey(floorId, agentId), { text: task, since: Date.now(), startedAt: r.already ? 0 : Date.now() });
  invalidate();
  return { ok: true, session: name, already: !!r.already, queued: !!task };
}

export function stopAgent(floorId, agentId) {
  const { name } = locate(floorId, agentId);
  pending.delete(workKey(floorId, agentId));
  const r = tm.stopSession(name);
  invalidate();
  return r;
}

export function withAttachments(text, list) {
  const base = paths.attachments();
  const files = (Array.isArray(list) ? list : []).map(String).map((f) => path.resolve(f))
    .filter((f) => f.startsWith(base + path.sep) && fs.existsSync(f)).slice(0, 10);
  return files.length ? `${text} [Attachments from the owner, open them with the Read tool: ${files.join(' ; ')}]` : text;
}

export async function sendTask(floorId, agentId, text, attachments = []) {
  const body = withAttachments(String(text || '').trim(), attachments);
  if (!String(text || '').trim()) throw bad('Task text is required');
  const { name } = locate(floorId, agentId);
  if (!tm.isRunning(name)) {
    await startAgent(floorId, agentId, body);
    return { ok: true, queued: true, note: 'Agent is starting; the task is typed as soon as Claude Code is ready.' };
  }
  const screen = tm.capture(name);
  if (tm.parsePrompt(screen)) {
    pending.set(workKey(floorId, agentId), { text: body, since: Date.now() });
    return { ok: true, queued: true, note: 'Agent shows a dialog; answer it in Attention and the task is typed afterwards.' };
  }
  const r = await tm.typeTask(name, body);
  if (!r.ok) throw bad(r.error);
  setWork(floorId, agentId, { text: body.slice(0, 300), assignedAt: Date.now(), doneAt: null });
  invalidate();
  return { ok: true, queued: false };
}

// type queued tasks once Claude Code is up and no dialog is open
let flushing = false;
export async function flushPending() {
  if (flushing) return;
  flushing = true;
  try {
    for (const [key, t] of [...pending]) {
      const [floorId, agentId] = key.split('/');
      const name = tm.sessionName(floorId, agentId);
      if (Date.now() - t.since > 10 * 60e3 || !tm.isRunning(name)) { pending.delete(key); continue; }
      if (t.startedAt && Date.now() - t.startedAt < 4000) continue;
      if (!tm.isReady(tm.capture(name))) continue;
      pending.delete(key);
      const r = await tm.typeTask(name, t.text);
      if (r.ok) setWork(floorId, agentId, { text: t.text.slice(0, 300), assignedAt: Date.now(), doneAt: null });
      else if (r.dialog) pending.set(key, t);
    }
  } finally { flushing = false; }
}

export function answerAttention(id, option, text = '') {
  snapCache.at = 0;
  const item = attentionItems().find((x) => x.id === id);
  if (!item) throw notFound('This item is gone (maybe already answered)');
  if (item.kind === 'stall') { clearWork(item.floorId, item.agentId || ''); if (!item.agentId) for (const k of Object.keys(workOf(item.floorId))) clearWork(item.floorId, k); invalidate(); return { ok: true }; }
  if (!item.answerable) throw bad('This question can only be answered in the agent\'s own terminal');
  const name = tm.sessionName(item.floorId, item.agentId);
  const dialog = tm.parsePrompt(tm.capture(name));
  if (!dialog) throw notFound('The dialog is gone (maybe already answered)');
  const r = tm.answerDialog(name, dialog, Number(option), text);
  if (!r.ok) throw bad(r.error);
  invalidate();
  return r;
}

// ---------- attachments ----------
const ATTACH_OK = /\.(png|jpe?g|gif|webp|pdf|txt|md|csv|json|ya?ml|log|html|css|js|ts|tsx|py|docx?|xlsx?|pptx?|zip|svg)$/i;
export function saveAttachment(floorId, filename, buf) {
  building.floorEntry(floorId);
  const orig = String(filename || 'attachment').split(/[\\/]/).pop();
  if (!ATTACH_OK.test(orig)) throw bad('File type not supported');
  if (/^\.env/i.test(orig)) throw bad('Secrets are not accepted');
  if (!buf.length) throw bad('Empty file');
  const dir = path.join(paths.attachments(), floorId);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const file = path.join(dir, `${stamp}-${crypto.randomBytes(3).toString('hex')}-${orig.replace(/[^\w.-]+/g, '_').slice(-80)}`);
  fs.writeFileSync(file, buf, { mode: 0o640 });
  return { path: file, name: orig, size: buf.length };
}
