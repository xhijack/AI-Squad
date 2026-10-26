// The live Building: Floor summaries, agent states, Attention, running agents and sending tasks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJson, writeText, statOf, bad, notFound, HttpError } from './util.js';
import * as building from './building.js';
import * as floors from './floors.js';
import * as tx from './transcripts.js';
import * as tm from './tmux.js';
import * as wd from './watchdog.js';
import * as merge from './merge.js';
import * as sprint from './sprint.js';
import * as hooks from './events.js';
import { floorPerformance } from './performance.js';
import { meter } from './meter.js';
import * as ind from './independents.js';
import * as blueprintsLib from './blueprints.js';
import * as skillsLib from './skills.js';
import * as collect from './collect.js';
import * as squadLog from './log.js';
import * as auditLib from './audit.js';
import * as improve from './improve.js';
import * as replyLib from './reply.js';
import * as recovery from './recovery.js';
import * as autopilot from './autopilot.js';
import * as retroLib from './retro.js';
import * as learnings from './learnings.js';
import * as rituals from './rituals.js';
import * as ship from './ship.js';
import * as design from './design.js';
import * as voice from './voice.js';
import { config, ROOT, paths } from './config.js';

// ---------- runtime state (work items per agent; machine-local, never in the repo) ----------
// ended: how the last session of each agent ended (crashes, exits); autoResumes: times of automatic resumes;
// autopilot: decisions taken automatically (shown until the owner says OK), lead decisions seen, nudges sent, blocks logged
const loadRuntime = () => { const r = readJson(paths.runtime(), {}) || {}; return { work: r.work || {}, dismissedMerges: r.dismissedMerges || [], dismissedReplies: r.dismissedReplies || [], sessions: r.sessions || {}, nextSprint: r.nextSprint || {}, ended: r.ended || {}, autoResumes: r.autoResumes || {},
  autopilot: { decided: [], leadSeen: {}, nudged: [], blocked: [], ...(r.autopilot || {}) } }; };
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
const sessionInfo = (floorId, agentId) => loadRuntime().sessions[workKey(floorId, agentId)] || null;
function setSessionInfo(floorId, agentId, info) {
  const r = loadRuntime();
  if (info) r.sessions[workKey(floorId, agentId)] = info; else delete r.sessions[workKey(floorId, agentId)];
  saveRuntime(r);
}
export const endedOf = (floorId, agentId) => loadRuntime().ended[workKey(floorId, agentId)] || null;
function setEnded(floorId, agentId, end) {
  const r = loadRuntime();
  if (end) r.ended[workKey(floorId, agentId)] = end; else delete r.ended[workKey(floorId, agentId)];
  saveRuntime(r);
}

// a session we started is gone without a stop from The AI Squad: find out how it ended, once (the journal
// is read only here). The session id is kept, so the agent can be resumed.
function noteEnded(entry, agent, info, status, sessionId) {
  const name = tm.sessionName(entry.id, agent.id), now = Date.now();
  const from = Math.max(info.startedAt || 0, (status?.lastTs || now) - 120e3);
  const end = recovery.classifyEnd({ info, status, name, detectedAt: now, kills: recovery.oomKills(from, now) });
  const r = loadRuntime();
  delete r.sessions[workKey(entry.id, agent.id)];
  r.ended[workKey(entry.id, agent.id)] = { ...end, sessionId: sessionId || null, startedAt: info.startedAt || 0, detectedAt: now, ...(info.unit ? { unit: info.unit } : {}) };
  saveRuntime(r);
  return r.ended[workKey(entry.id, agent.id)];
}

// configured model (team.json) vs the model the session was started with vs the model seen in the transcript
export function modelReport(eff, running, started, status) {
  const configured = eff?.model || '';
  const observed = status?.model || '';
  const fam = tx.modelFamily(observed);
  const checkable = configured && configured !== 'inherit';
  return {
    configured, observed, observedAt: status?.modelTs || 0, startedWith: running && started ? started.model : null,
    mismatch: !!(checkable && fam && fam !== configured),
    restartNeeded: !!(running && started && started.model && (started.model !== configured || started.effort !== eff?.effort)),
  };
}

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
const ASK_OPEN_MS = 6 * 3600e3;
// squad: { gate } on Squad Sprint / Blueprint Floors, where the lead starts the teammates
function liveAgents(entry, team, sessions, { events = false, squad = null } = {}) {
  const now = Date.now();
  const transcripts = tx.agentTranscripts(entry.path);
  const work = workOf(entry.id);
  const dismissed = new Set(loadRuntime().dismissedReplies);
  // teammates the lead spawned live inside the lead's session: they count as running while it runs
  const lead = team.agents.find((x) => x.lead) || team.agents.find((x) => sprint.roleKind(x) === 'lead');
  const leadRunning = !!lead && sessions.has(tm.sessionName(entry.id, lead.id));
  const lastSession = new Map();                       // agent id -> its newest own Claude Code session (what Resume continues)
  const ownFile = new Map();                           // agent id -> that session's transcript
  for (const s of tx.sessionsOf(entry.path)) { const id = tx.sessionAgent(s.file); if (id && !lastSession.has(id)) { lastSession.set(id, s.id); ownFile.set(id, s.file); } }
  const leadSession = lead ? lastSession.get(lead.id) : null;
  const ended = new Map(team.agents.map((a) => [a.id, endedOf(entry.id, a.id)]));
  const lives = team.agents.map((a) => {
    const name = tm.sessionName(entry.id, a.id);
    const own = sessions.has(name);
    // an agent running on its own Desk reads its own session, never a lead-spawned teammate run with the same id
    const t = own && ownFile.has(a.id) ? { file: ownFile.get(a.id) } : transcripts.get(a.id);
    const st = t ? statusOf(t.file, entry.path, events) : null;
    // a teammate's runs live under the lead's session: those from the lead's last session are its real last state
    const withLead = a !== lead && !own && !!t && !!leadSession && tx.parentSession(t.file) === leadSession;
    const inLead = !own && leadRunning && a !== lead && (!!hooks.agentState(entry.id, a.id, now) || (withLead && now - st.lastTs < TEAMMATE_LIVE_MS));
    const running = own || inLead;
    const info = !own && sessionInfo(entry.id, a.id);
    if (info) ended.set(a.id, noteEnded(entry, a, info, st, lastSession.get(a.id)));
    const screen = own ? tm.capture(name) : '';
    const dialog = own ? tm.parsePrompt(screen) : null;
    // known to be gone (its session ended, or it ran inside a lead that is not running): never "working"
    const gone = !running && (!!ended.get(a.id) || withLead);
    const recent = !gone && st && st.turnOpen && now - st.lastTs < tx.ACTIVE_MS;   // finished turns are not "working"
    const busy = own && tm.isBusy(screen);
    const asking = st?.ask && (running || (!gone && now - st.ask.ts < ASK_OPEN_MS));   // Claude waits for an answer indefinitely
    // plugin hook events are live; they win over the transcript heuristic when they are newer
    const h = hooks.agentState(entry.id, a.id, now);
    const hookFresh = h && h.ts >= (st?.lastTs || 0) - 5000 && (running || now - h.ts < 10 * 60e3);
    const hookWaiting = hookFresh && h.state === 'waiting';
    const working = busy || (hookFresh ? h.state === 'working' : recent);
    let state = dialog || asking || hookWaiting ? 'waiting' : working ? 'working' : running ? 'idle' : 'stopped';
    const w = work[a.id];
    // the turn of an agent the owner talks to directly (its own session: the lead, or started from its Desk) ended:
    // a message that asks the owner is "Waiting for your reply", any other report is "Finished" (one card, not two).
    // Lead-spawned teammates (inLead) report to the lead and get neither.
    const live = { running: own, inLead, status: st, work: w, pending: pending.has(workKey(entry.id, a.id)), dialog, busy };
    let reply = state === 'idle' && own ? replyLib.replyWait(live, { gate: !!squad?.gate?.blocking && !squad.gate.passed, isLead: a === lead }) : null;
    let finished = state === 'idle' && own && !reply ? replyLib.finishedReport(live) : null;
    if (reply && dismissed.has(replyKey(entry.id, a.id, reply.ts))) reply = null;
    if (finished && dismissed.has(replyKey(entry.id, a.id, finished.ts))) finished = null;
    if (reply) state = 'waiting';
    // teammates the lead has not spawned yet are not "stopped": they wait for the sprint (or the source documents)
    const standby = squad && lead && a !== lead && !running && !withLead ? (squad.gate?.blocking && !squad.gate.passed ? 'docs' : 'sprint') : null;
    const turnEnded = Math.max(st?.lastEndTurn || 0, h && h.event === 'Stop' ? h.ts : 0);
    if (w && !w.doneAt && turnEnded > w.assignedAt && !busy && !dialog && !working) { w.doneAt = turnEnded; setWork(entry.id, a.id, w); }
    if (dialog && st?.ask?.questions?.length) {
      // the screen often cuts long questions; the transcript has the full text
      dialog.question = st.ask.questions.map((q) => (q.header ? `[${q.header}] ` : '') + q.question).join('\n\n');
    }
    const activity = hookFresh && h.activity ? h.activity : st?.activity || '';
    return { agent: a, session: name, running, state, dialog, status: st, lastTs: Math.max(st?.lastTs || 0, hookFresh ? h.ts : 0), work: w || null, screen, started: sessionInfo(entry.id, a.id),
      hook: hookFresh ? h : null, activity, inLead, reply, finished, standby, turnKey: t?.file ? `${path.basename(t.file, '.jsonl')}@${(reply || finished)?.ts || 0}` : '', withLead, own, resumeId: own ? null : lastSession.get(a.id) || null };
  });
  // how a stopped agent ended: its own record, or (teammates) the lead's crash took it down
  const leadEnd = lead && !leadRunning ? ended.get(lead.id) : null;
  for (const l of lives) {
    if (l.running) continue;
    const own = ended.get(l.agent.id);
    if (own && !(l.resumeId && own.sessionId && own.sessionId !== l.resumeId)) l.ended = own;      // a newer session started elsewhere replaces it
    else if (l.withLead && leadEnd?.kind === 'crashed') l.ended = { ...leadEnd, withLead: lead.id };
    if (l.withLead) l.stopNote = `${l.ended?.withLead ? `stopped with the lead (${recovery.causeText(l.ended)})` : 'not running'}${l.status?.activity ? ` · last: ${l.status.activity}` : ''}`;
  }
  return lives;
}
const TEAMMATE_LIVE_MS = 10 * 60e3;          // a teammate run of the running lead counts as alive this long after its last line
const replyKey = (floorId, agentId, ts) => `${floorId}/${agentId}@${ts}`;
// Squad Sprint and Blueprint Floors: the lead runs the squad; null on Free Team Floors without a Blueprint
function squadOf(root, floor) {
  const bp = blueprintsLib.floorBlueprint(root, floor.blueprint);
  if (floor.workflow !== 'squad-sprint' && !bp) return null;
  const gate = bp ? blueprintsLib.docsGate(root, bp) : { blocking: false, pending: [] };
  // once a sprint has started the gate no longer holds the squad (passed), even if a later document is still a draft;
  // the pending documents stay on the Floor pill until the owner approves them
  return { gate: gate.blocking && sprint.sprintStarted(root) ? { ...gate, passed: true } : gate };
}
export const STANDBY_TEXT = { sprint: 'not started: the lead starts them when the sprint begins', docs: 'waiting for source documents' };

function agentView(root, l, cost) {
  let eff = null, error = null;
  try { eff = floors.effectiveOf(root, l.agent); } catch (e) { error = e.message; }
  return {
    id: l.agent.id, displayName: l.agent.displayName, lead: !!l.agent.lead,
    role: l.agent.role, title: eff?.title || l.agent.role.template, model: eff?.model || '', appearance: eff?.appearance || l.agent.appearance || {},
    state: l.state, running: l.running, inLead: l.inLead, activity: l.reply ? 'waiting for your reply' : l.standby ? STANDBY_TEXT[l.standby] : l.activity, lastTs: l.lastTs, session: l.session, live: !!l.hook,
    standby: l.standby || null, waitingReply: !!l.reply, finished: l.finished ? l.finished.ts : null,
    // stopped agents: how they ended (crash: Resume is the main action), the session Resume continues, the last state
    crash: l.ended?.kind === 'crashed' ? { cause: l.ended.cause, at: l.ended.at, text: recovery.crashText(l.ended), withLead: l.ended.withLead || null } : null,
    resume: !l.running && l.resumeId ? { sessionId: l.resumeId } : null, stopNote: l.stopNote || null, exited: l.ended?.kind === 'exited',
    work: l.work, costToday: +(cost.byAgentToday[l.agent.id] || 0).toFixed(2), templateStatus: floors.templateStatus(root, l.agent), error,
    models: modelReport(eff, l.running, l.started, l.status),
    peek: l.status?.peek ? codeWindow(root, (({ id, ...rest }) => rest)(l.status.peek)) : null, kindOf: sprint.roleKind(l.agent),
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
    } else if (l.hook?.state === 'waiting' && l.hook.permission && (l.hook.permission.tool || !(l.status?.ask && l.state === 'waiting'))) {
      const pm = l.hook.permission;
      out.push({ id: attId(entry.id, l.agent.id, 'hook', pm.ts), kind: 'permission', floorId: entry.id, floorNumber: entry.number, floorName: floor.name, agentId: l.agent.id, agentName: l.agent.displayName,
        text: pm.message + (pm.detail ? `\n${pm.detail}` : ''), options: [], answerable: false, live: true, ts: pm.ts });
    } else if (l.status?.ask && l.state === 'waiting') {
      const q = l.status.ask.questions;
      out.push({ id: attId(entry.id, l.agent.id, l.status.ask.id), kind: 'question', floorId: entry.id, floorNumber: entry.number, floorName: floor.name,
        agentId: l.agent.id, agentName: l.agent.displayName, text: q.map((x) => x.question).join('\n\n'),
        options: (q[0]?.options || []).map((label, i) => ({ n: i + 1, label, free: false })), answerable: false, ts: l.status.ask.ts });
    } else if (l.reply) {
      // the id is the agent's turn (session + end of turn), the same whether the card reads as a reply or as Finished
      out.push({ id: attId(entry.id, l.agent.id, 'turn', l.turnKey), kind: 'reply', replyKey: replyKey(entry.id, l.agent.id, l.reply.ts), floorId: entry.id, floorNumber: entry.number, floorName: floor.name,
        agentId: l.agent.id, agentName: l.agent.displayName, text: l.reply.text, options: [], answerable: true, ts: l.reply.ts });
    } else if (l.finished) {
      out.push({ id: attId(entry.id, l.agent.id, 'turn', l.turnKey), kind: 'finished', replyKey: replyKey(entry.id, l.agent.id, l.finished.ts), floorId: entry.id, floorNumber: entry.number, floorName: floor.name,
        agentId: l.agent.id, agentName: l.agent.displayName, text: l.finished.text, options: [], answerable: true, calm: true, ts: l.finished.ts });
    } else if (!l.running && l.ended?.kind === 'crashed' && !l.ended.withLead && !l.ended.dismissed) {
      // teammates that went down with their lead are covered by the lead's item
      out.push({ id: attId(entry.id, l.agent.id, 'crash', l.ended.detectedAt), kind: 'crash', floorId: entry.id, floorNumber: entry.number, floorName: floor.name,
        agentId: l.agent.id, agentName: l.agent.displayName, text: recovery.crashText(l.ended), resumable: !!l.resumeId,
        options: [...(l.resumeId ? [{ n: 1, label: 'Resume' }] : []), { n: 2, label: 'Start fresh' }], answerable: true, ts: l.ended.at });
    }
  }
  const work = workOf(entry.id);
  for (const s of wd.stallAlerts(lives.map((l) => ({ id: l.agent.id, displayName: l.agent.displayName, lead: !!l.agent.lead, state: l.state, lastTs: l.lastTs })), work)) {
    out.push({ id: attId('stall', entry.id, s.agent || ''), kind: 'stall', floorId: entry.id, floorNumber: entry.number, floorName: floor.name, agentId: s.agent || null, text: s.text, ts: Date.now() });
  }
  for (const m of merge.mergeProblems(entry.id, loadRuntime().dismissedMerges)) {
    const what = m.result === 'merged' ? `Merged ${m.branch} but the push failed: ${m.push.error}` : `Merge of ${m.branch} ${m.result}: ${m.reason}`;
    out.push({ id: attId('merge', m.id), mergeId: m.id, kind: 'merge', floorId: entry.id, floorNumber: entry.number, floorName: floor.name, text: what + (m.gate && !m.gate.ok ? `\n\n${m.gate.output.split('\n').slice(-8).join('\n')}` : ''), ts: m.ts });
  }
  const b = wd.budgetStatus(floor.budget, cost);
  if (b.level === 'over') out.push({ id: attId('budget', entry.id, floor.budget.period), kind: 'budget', floorId: entry.id, floorNumber: entry.number, floorName: floor.name, text: `Budget reached: $${b.used.toFixed(2)} of $${floor.budget.usd} this ${floor.budget.period}`, ts: Date.now() });
  // design variants waiting for the owner's pick (taste: not critical, but only the owner picks)
  for (const g of design.groups(entry.path).filter((x) => !x.chosen)) {
    out.push({ id: attId('design', entry.id, g.screen, g.variants.map((v) => v.file).join('|')), kind: 'design', screen: g.screen, floorId: entry.id, floorNumber: entry.number, floorName: floor.name,
      text: `Pick a design for ${g.screen}: ${g.variants.length} variants${g.question ? `. ${g.question}` : ''}`, options: [], answerable: false, ts: Date.now() });
  }
  // the scope mode changed mid-sprint: the owner decides (critical, also under Autopilot)
  const sc = collect.stateOf(entry.id).scope;
  if (sc?.changed && !sc.changed.acked) out.push({ id: attId('scope', entry.id, sc.sprint, sc.changed.ts), kind: 'scope', floorId: entry.id, floorNumber: entry.number, floorName: floor.name,
    text: `Sprint ${sc.sprint}: the lead changed the scope mode from ${sc.changed.from} to ${sc.changed.to}${sc.changed.reason ? ` (${sc.changed.reason})` : ''}.`,
    options: [{ n: 1, label: `Accept ${sc.changed.to}` }, { n: 2, label: `Back to ${sc.changed.from}` }], answerable: true, ts: sc.changed.ts,
    autopilot: { level: floor.autopilot, critical: true, reasons: ['scope'], recommended: null, auto: false, autoAt: null } });
  if (floor.autopilot !== 'off') autopilotItems(entry, floor, out);
  return out;
}

// ---------- Autopilot (server/autopilot.js) ----------
// questions, permission prompts and plain-text asks get their classification; a non-critical question with a
// "(Recommended)" option (or a non-critical ask) is handled automatically once the timeout has passed
const ASKING = new Set(['question', 'permission', 'reply']);
const apSeen = new Map();                 // item id -> first seen: the clock for items whose own time moves (no transcript)
function autopilotItems(entry, floor, out) {
  const now = Date.now();
  if (apSeen.size > 500) for (const [k, t] of apSeen) if (now - t > 864e5) apSeen.delete(k);
  const ownerOnly = blueprintsLib.floorBlueprint(entry.path, floor.blueprint)?.ownerOnly || [];
  for (const a of out) {
    if (!ASKING.has(a.kind)) continue;
    const c = autopilot.classify([a.text, ...(a.options || []).filter((o) => !o.free).map((o) => o.label)].join('\n'), { level: floor.autopilot, ownerOnly });
    const rec = a.kind === 'question' && a.answerable ? autopilot.recommendedOption(a.options) : null;
    const auto = !c.critical && (a.kind === 'reply' || !!rec);                 // permission prompts are never answered
    if (!apSeen.has(a.id)) apSeen.set(a.id, now);
    const since = Math.min(a.ts || now, apSeen.get(a.id));
    a.autopilot = { level: floor.autopilot, critical: c.critical, reasons: c.reasons, recommended: rec?.n || null, auto, autoAt: auto ? since + floor.autopilotTimeoutSec * 1000 : null };
  }
  const day = Date.now() - 864e5;
  for (const d of loadRuntime().autopilot.decided) {
    if (d.floorId !== entry.id || d.acked || d.ts < day) continue;
    out.push({ id: attId('decided', d.id), decidedId: d.id, kind: 'decided', muted: true, floorId: entry.id, floorNumber: entry.number, floorName: floor.name, agentId: d.agentId, agentName: d.agentName,
      text: d.question, chosen: d.option, changed: d.changed || null, options: d.options.filter((o) => o.label !== d.optionLabel).map((o) => ({ ...o, label: autopilot.cleanLabel(o.label) })), answerable: true, ts: d.ts });
  }
}

function floorState(entry, opts = {}) {
  if (!fs.existsSync(entry.path)) return { entry, missing: true };
  let cfg;
  try { cfg = floors.readFloor(entry.path); } catch (e) { return { entry, missing: true, error: e.message }; }
  const sessions = new Set(opts.sessions || tm.listSessions());
  const squad = squadOf(entry.path, cfg.floor);
  const lives = liveAgents(entry, cfg.team, sessions, { ...opts, squad });
  const cost = costFor(entry.id, entry.path);
  return { entry, cfg, lives, cost, squad, attention: floorAttention(entry, cfg.floor, lives, cost), budget: wd.budgetStatus(cfg.floor.budget, cost) };
}

const round2 = (n) => +(+n || 0).toFixed(2);

function summary(fs_) {
  const { entry } = fs_;
  if (fs_.missing) return { id: entry.id, number: entry.number, path: entry.path, missing: true, name: path.basename(entry.path), error: fs_.error || 'Directory not found', agents: [], attention: 0 };
  const { cfg, lives, cost } = fs_;
  const agents = lives.map((l) => agentView(entry.path, l, cost));
  const count = (s) => agents.filter((a) => a.state === s).length;
  const asks = fs_.attention.filter((a) => !a.muted);
  const lamp = asks.length ? 'attention' : count('working') ? 'working' : agents.some((a) => a.running) ? 'idle' : 'stopped';
  return {
    waitingFor: waitingFor(fs_),
    // the Floor pill's Autopilot chip: the level and how many critical items wait for the owner
    autopilot: { level: cfg.floor.autopilot, timeoutSec: cfg.floor.autopilotTimeoutSec, critical: asks.filter((a) => a.autopilot?.critical).length },
    meeting: rituals.active(meetings.get(entry.id)),
    id: entry.id, number: entry.number, path: entry.path, name: cfg.floor.name, goal: cfg.floor.goal, tagline: cfg.floor.tagline, accent: cfg.floor.accent, layout: cfg.floor.layout,
    workflow: cfg.floor.workflow, desks: cfg.floor.desks, devices: cfg.floor.devices, agents, lamp,
    counts: { working: count('working'), waiting: count('waiting'), idle: count('idle'), stopped: count('stopped'), standby: agents.filter((a) => a.standby).length },
    cost: { today: round2(cost.today), month: round2(cost.month) }, budget: { ...cfg.floor.budget, ...fs_.budget, used: round2(fs_.budget.used) },
    attention: asks.length, updates: agents.filter((a) => a.templateStatus.updateAvailable).length,
  };
}

// what the squad waits for, for the Floor's status pill: the source documents gate, else the owner's reply
export function waitingFor(fs_) {
  const pending = fs_.squad?.gate?.blocking ? fs_.squad.gate.pending.length : 0;
  if (pending) return { kind: 'docs', text: `Waiting for you: ${pending} source document${pending === 1 ? '' : 's'}`, docs: fs_.squad.gate.pending.map((d) => d.path) };
  const asks = fs_.attention.filter((a) => a.kind === 'reply' || a.kind === 'question' || a.kind === 'permission');
  if (asks.length) return { kind: 'reply', text: asks.some((a) => a.kind === 'reply') ? 'Waiting for your reply' : 'Waiting for your answer' };
  return null;
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
  stampAlerts(attention);
  const floorPaths = new Set(b.floors.map((f) => f.path));
  const detected = tx.discoverProjects().filter((p) => !floorPaths.has(p.root)).slice(0, 30);
  const independent = independentState(b);
  attention.push(...independent.attention);
  const floorsOut = [independent.summary, ...states.map(summary)].sort((x, y) => x.number - y.number);
  const value = {
    name: b.name, now: Date.now(), floors: floorsOut, attention, detected,
    resources: { mem: res.mem, swap: res.swap, disk: res.disk, load: res.load, cpus: res.cpus, warnings: wd.resourceWarnings(res).map((w) => w.text) },
    costToday: round2(floorsOut.reduce((n, f) => n + (f.cost?.today || 0), 0)),
    meter: meter.summary(), autopilotToday: autopilotToday(b.floors),
    options: { layouts: floors.LAYOUTS, workflows: floors.WORKFLOWS, deviceTypes: floors.DEVICE_TYPES, deskDevices: floors.DESK_DEVICES,
      branchStrategies: floors.BRANCH_STRATEGIES, pushPolicies: floors.PUSH_POLICIES, nextFloorNumber: building.nextFloorNumber(b),
      projectsDir: suggestProjectsDir(b), autopilot: { levels: autopilot.LEVELS, text: autopilot.LEVEL_TEXT, hardStop: autopilot.hardStopList(), defaultLevel: autopilot.DEFAULT_LEVEL } },
  };
  snapCache = { at: Date.now(), value };
  return value;
}
// the Lobby digest "Decided by autopilot today: N" (read from the Squad Log at most once a minute)
let apToday = { at: 0, day: '', n: 0 };
function autopilotToday(list) {
  const day = squadLog.dayOf(Date.now());
  if (apToday.day === day && Date.now() - apToday.at < 60e3) return apToday.n;
  const from = new Date(); from.setHours(0, 0, 0, 0);
  let n = 0;
  for (const f of list) { try { n += squadLog.read(f.id, { type: 'autopilot.decided', from: from.getTime(), limit: 5000 }).length; } catch { /* no log yet */ } }
  apToday = { at: Date.now(), day, n };
  return n;
}
// where new project directories probably go: next to existing Floors, else ~/projects
function suggestProjectsDir(b) {
  const parents = b.floors.map((f) => path.dirname(f.path));
  const best = parents.sort((x, y) => parents.filter((p) => p === y).length - parents.filter((p) => p === x).length)[0];
  return best || path.join(os.homedir(), 'projects');
}
// Watchdog alerts (stall, budget, resources) are recomputed on every snapshot; remember when each
// one first appeared so "since" stays stable, and report new ones once.
const firstSeen = new Map();
export const WATCH_KINDS = new Set(['stall', 'budget', 'resource', 'merge']);
function stampAlerts(items, onNew = null) {
  const now = Date.now(), live = new Set();
  for (const a of items) {
    if (!WATCH_KINDS.has(a.kind)) continue;
    live.add(a.id);
    if (!firstSeen.has(a.id)) { firstSeen.set(a.id, now); onNew?.(a); }
    a.ts = firstSeen.get(a.id);
  }
  for (const id of firstSeen.keys()) if (!live.has(id)) firstSeen.delete(id);
}

// background tick: keeps alerts current without a browser open and logs new ones
const reported = new Set();
export function watchdogTick(log = console.log) {
  snapCache.at = 0;
  const snap = buildingSnapshot();
  const live = new Set();
  for (const a of snap.attention) {
    live.add(a.id);
    if (!reported.has(a.id)) { reported.add(a.id); if (a.floorId && WATCH_KINDS.has(a.kind)) logEvent(a.floorId, { type: 'watchdog.alert', agent: a.agentId || null, data: { kind: a.kind, text: a.text.split('\n')[0] } }); log(`[watchdog] ${a.kind}${a.floorName ? ` · ${a.floorName}` : ''}${a.agentName ? ` · ${a.agentName}` : ''}: ${a.text.split('\n')[0]}`); }
  }
  for (const id of reported) if (!live.has(id)) reported.delete(id);
  return snap;
}

export function watchdogStatus() {
  const snap = buildingSnapshot();
  return {
    resources: snap.resources,
    alerts: snap.attention.filter((a) => WATCH_KINDS.has(a.kind)),
    waiting: snap.attention.filter((a) => !WATCH_KINDS.has(a.kind)).length,
    floors: snap.floors.map((f) => ({ id: f.id, number: f.number, name: f.name, lamp: f.lamp, counts: f.counts, cost: f.cost, budget: f.budget, attention: f.attention })),
  };
}

export const invalidate = () => { snapCache.at = 0; apToday.at = 0; tx.resetDiscoveryCache(); for (const c of costs.values()) c.at = 0; };

export function floorDetail(id) {
  if (id === ind.FLOOR_ID) return independentDetail();
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
    attentionItems: s.attention, teamName: tx.teamFor(entry.path)?.name || null,
    board: s.cfg.floor.workflow === 'squad-sprint' ? sprint.boardData(entry.path) : blueprintBoard(entry.path),
    blueprint: blueprintInfo(entry.path, s.cfg.floor.blueprint),
    shots: listShots(entry.path), standup: collect.stateOf(id).standup || null,
    merge: { approved: !!merge.approval(entry.id), approvedAt: merge.approval(entry.id)?.approvedAt || null, running: merge.isMerging(entry.id), last: merge.mergeLog(entry.id, 5) } };
}

// Blueprint squads without Squad Sprint keep their board in docs/BOARD.md (same table as TASKS.md)
function blueprintBoard(root) {
  const text = readTextSafe(path.join(root, 'docs', 'BOARD.md'));
  if (!text) return null;
  return { pack: true, sprint: '', tasks: sprint.parseTasks(text), handoffs: [], bugs: { open: [], fixed: [] }, qa: { pass: [], fail: [] },
    questions: (readTextSafe(path.join(root, 'docs', 'QUESTIONS.md')) || '').split('\n').filter((l) => /^\s*\d+\.\s+\S/.test(l)).length, source: 'docs/BOARD.md' };
}
function blueprintInfo(root, ref) {
  const bp = blueprintsLib.floorBlueprint(root, ref);
  if (!bp) return null;
  let latest = null; try { latest = blueprintsLib.getBlueprint(bp.id).version; } catch { /* not in the library */ }
  return { id: bp.id, title: bp.title, version: bp.version, latest, gates: bp.gates, sourceDocs: blueprintsLib.sourceDocsStatus(root, bp) };
}
const readTextSafe = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

function readBriefSafe(root) { try { return fs.readFileSync(path.join(root, 'AISQUAD.md'), 'utf8').slice(0, 20000); } catch { return ''; } }

export function deskDetail(floorId, agentId) {
  if (floorId === ind.FLOOR_ID) return independentDesk(agentId);
  const entry = building.floorEntry(floorId);
  const cfg = floors.readFloor(entry.path);
  const agent = cfg.team.agents.find((a) => a.id === agentId);
  if (!agent) throw notFound(`Agent not found: ${agentId}`);
  const lead = cfg.team.agents.find((x) => x.lead) || cfg.team.agents.find((x) => sprint.roleKind(x) === 'lead');
  const l = liveAgents(entry, { agents: [...new Set([agent, lead].filter(Boolean))] }, new Set(tm.listSessions()), { events: true, squad: squadOf(entry.path, cfg.floor) })[0];
  const cost = costFor(entry.id, entry.path);
  let effective = null, error = null;
  try { effective = floors.effectiveOf(entry.path, agent); } catch (e) { error = e.message; }
  return {
    floorId, ...agentView(entry.path, l, cost), agent, effective, error,
    skills: (effective?.skills || []).map((n) => skillsLib.skillStatus(entry.path, n)),
    screen: l.running ? tm.capture(l.session, 300).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() : '', dialog: l.dialog,
    events: (l.status?.events || []).slice(-80).reverse(),
    pending: pending.has(workKey(floorId, agentId)) ? pending.get(workKey(floorId, agentId)).text : null,
    attach: tm.attachCommand(l.session),
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

// resume: a Claude Code session id to continue (--resume) instead of a fresh session.
// guard: the owner starts it; warn first (409) when swap is above 80 % or the Floor runs its maximum of agents
export async function startAgent(floorId, agentId, task = '', { resume = '', guard = false, via = 'aisquad' } = {}) {
  const { entry, cfg, agent, name } = locate(floorId, agentId);
  if (guard && !tm.isRunning(name)) {
    snapCache.at = 0;
    const running = buildingSnapshot().floors.find((f) => f.id === floorId)?.agents.filter((a) => a.running).length || 0;
    const warnings = recovery.startWarnings({ res: wd.readResources(), running, maxAgents: cfg.floor.recovery.maxAgents });
    if (warnings.length) throw Object.assign(new HttpError(409, `${warnings.join(' ')} Start anyway?`), { data: { warnings } });
  }
  floors.generate(entry.path);                          // agent file is current before Claude reads it
  const eff = floors.effectiveOf(entry.path, agent);
  // model comes from the agent file; effort is not read from agent files for the main session, so pass it
  // pass model and effort explicitly so the configured values win over defaults and earlier sessions
  const extraArgs = [...(eff.model && eff.model !== 'inherit' ? ['--model', eff.model] : []), '--effort', eff.effort,
    ...(config.useHooks ? ['--plugin-dir', ROOT] : []),                // our plugin hooks stream events back
    ...(resume ? ['--resume', resume] : [])];
  const env = { AISQUAD_AGENT: `${floorId}/${agentId}`, AISQUAD_URL: config.serverUrl, AISQUAD_HOME: config.home,
    ...floors.commitIdentity(agent, floors.readFloor(entry.path).git) };   // per-agent commit identity (git.json)
  const r = await tm.startSession({ name, cwd: entry.path, agentId, disallowedTools: eff.permissions.deny, extraArgs, env });
  if (!r.ok) throw bad('Could not start the agent (is tmux installed?)');
  if (task) pending.set(workKey(floorId, agentId), { text: task, since: Date.now(), startedAt: r.already ? 0 : Date.now() });
  if (!r.already) {
    setSessionInfo(floorId, agentId, { startedAt: Date.now(), model: eff.model, effort: eff.effort, ...(r.unit ? { unit: r.unit } : {}), ...(resume ? { resumed: resume } : {}) });
    setEnded(floorId, agentId, null);
    logEvent(floorId, resume
      ? { type: 'agent.resumed', agent: agentId, session: name, model: eff.model, data: { session: resume, via, model: eff.model, effort: eff.effort } }
      : { type: 'agent.started', agent: agentId, session: name, model: eff.model, data: { model: eff.model, effort: eff.effort, via, ...(task ? { withTask: true } : {}) } });
  }
  invalidate();
  return { ok: true, session: name, already: !!r.already, queued: !!task, ...(resume ? { resumed: resume } : {}) };
}

// continue the agent's last Claude Code session; a resumed lead of a squad gets a short recovery note
export async function resumeAgent(floorId, agentId, { guard = false, via = 'aisquad' } = {}) {
  const { entry, cfg, agent } = locate(floorId, agentId);
  const end = endedOf(floorId, agentId);
  const sessionId = tx.agentSessions(entry.path, agentId)[0]?.id || end?.sessionId;
  if (!sessionId) throw bad('This agent has no previous session to resume; start it fresh');
  const lead = cfg.team.agents.find((x) => x.lead) || cfg.team.agents.find((x) => sprint.roleKind(x) === 'lead');
  const note = squadOf(entry.path, cfg.floor) && lead === agent ? recovery.recoveryMessage({ end, maxAgents: cfg.floor.recovery.maxAgents }) : '';
  return startAgent(floorId, agentId, note, { resume: sessionId, guard, via });
}

const criticalWaiting = (floorId) => (snapCache.value?.attention || []).filter((a) => a.floorId === floorId && a.autopilot?.critical).length;

// Autopilot, every 30 s: answers non-critical questions with their recommended option after the timeout, nudges
// agents whose plain-text ask went unanswered, nudges an idle squad with open work, records lead decisions
const apMem = { idle: new Map(), blocked: new Set() };     // floorId -> idle nudge state; logged critical items
export async function autopilotTick(now = Date.now(), { res = wd.readResources() } = {}) {
  const done = [];
  snapCache.at = 0;
  const snap = buildingSnapshot();
  for (const f of snap.floors.filter((x) => !x.independent && !x.missing && x.autopilot && x.autopilot.level !== 'off')) {
    const entry = building.floorEntry(f.id);
    let cfg; try { cfg = floors.readFloor(entry.path); } catch { continue; }
    const timeout = cfg.floor.autopilotTimeoutSec;
    const items = snap.attention.filter((a) => a.floorId === f.id && a.autopilot);
    for (const a of items) {
      if (a.autopilot.critical) {
        if (!apMem.blocked.has(a.id)) { apMem.blocked.add(a.id); logEvent(f.id, { type: 'autopilot.blocked', agent: a.agentId, data: { kind: a.kind, question: a.text.slice(0, 300), reasons: a.autopilot.reasons } }); }
        continue;
      }
      if (!a.autopilot.auto || now < a.autopilot.autoAt) continue;
      try {
        if (a.kind === 'question') done.push(await autoAnswer(f, a));
        else if (a.kind === 'reply') done.push(await nudgeReply(f, a, timeout));
      } catch (e) { console.error('[autopilot]', f.id, a.agentId, e.message); }
    }
    done.push(...leadDecisions(f.id, entry.path));
    const lead = f.agents.find((a) => a.lead) || f.agents.find((a) => a.kindOf === 'lead');
    const open = openTasks(entry.path, cfg.floor);
    const stop = autopilot.chainStop({ level: f.autopilot.level, budgetOver: f.budget?.level === 'over', pressure: recovery.memoryPressure(res), criticalWaiting: f.autopilot.critical, openWork: open });
    const st = apMem.idle.get(f.id) || {}; apMem.idle.set(f.id, st);
    const allIdle = !!lead?.running && f.agents.every((a) => a.state !== 'working' && a.state !== 'waiting');
    if (!stop && autopilot.idleNudgeDue({ allIdle, openWork: open }, st, now)) {
      await sendTask(f.id, lead.id, autopilot.idleNudge(open));
      logEvent(f.id, { type: 'autopilot.nudged', agent: lead.id, data: { kind: 'idle', open } });
      done.push({ floorId: f.id, agentId: lead.id, kind: 'idle' });
    }
  }
  for (const id of apMem.blocked) if (!snap.attention.some((a) => a.id === id)) apMem.blocked.delete(id);
  if (done.length) invalidate();
  return done;
}
// open rows on the board (Squad Sprint TASKS.md, or a Blueprint squad's docs/BOARD.md); null without a board
function openTasks(root, floor) {
  const b = floor.workflow === 'squad-sprint' && sprint.hasPack(root) ? sprint.boardData(root) : blueprintBoard(root);
  return b ? b.tasks.filter((t) => t.column !== 'DONE').length : null;
}
// the dialog is still the same one: choose the recommended option, keep a muted item so the owner can change it
async function autoAnswer(f, a) {
  const name = tm.sessionName(f.id, a.agentId);
  const dialog = tm.parsePrompt(tm.capture(name));
  const rec = dialog && autopilot.recommendedOption(dialog.options);
  if (!rec || rec.label !== a.options.find((o) => o.n === a.autopilot.recommended)?.label) return { floorId: f.id, agentId: a.agentId, kind: 'gone' };
  const r = tm.answerDialog(name, dialog, rec.n);
  if (!r.ok) throw new Error(r.error);
  const rt = loadRuntime();
  const rec2 = { id: crypto.randomBytes(5).toString('hex'), floorId: f.id, agentId: a.agentId, agentName: a.agentName, question: a.text.slice(0, 1000), option: autopilot.cleanLabel(rec.label), optionLabel: rec.label,
    options: a.options.filter((o) => !o.free).map(({ n, label }) => ({ n, label })), ts: Date.now(), by: 'server', waitedMs: Date.now() - (a.ts || Date.now()) };
  rt.autopilot.decided = [...rt.autopilot.decided, rec2].slice(-300);
  saveRuntime(rt);
  logEvent(f.id, { type: 'autopilot.decided', agent: a.agentId, data: { by: 'server timeout', question: rec2.question.slice(0, 300), option: rec2.option, critical: false, waitedMs: rec2.waitedMs } });
  return { floorId: f.id, agentId: a.agentId, kind: 'answered', option: rec2.option };
}
async function nudgeReply(f, a, timeout) {
  const rt = loadRuntime();
  if (rt.autopilot.nudged.includes(a.replyKey)) return { floorId: f.id, agentId: a.agentId, kind: 'already' };
  rt.autopilot.nudged = [...rt.autopilot.nudged, a.replyKey].slice(-300);
  saveRuntime(rt);
  await sendTask(f.id, a.agentId, autopilot.replyNudge(timeout));
  logEvent(f.id, { type: 'autopilot.nudged', agent: a.agentId, data: { kind: 'reply', question: a.text.slice(-300) } });
  return { floorId: f.id, agentId: a.agentId, kind: 'nudged' };
}
// "DECIDED BY LEAD (autopilot)" lines in the questions file: each new one is logged once
function leadDecisions(floorId, root) {
  const file = [path.join(root, 'docs', 'squad', 'QUESTIONS.md'), path.join(root, 'docs', 'QUESTIONS.md')].find((x) => fs.existsSync(x));
  if (!file) return [];
  const list = autopilot.leadDecisions(readTextSafe(file));
  const rt = loadRuntime(), seen = rt.autopilot.leadSeen[floorId] ?? null;
  if (seen === list.length) return [];
  rt.autopilot.leadSeen[floorId] = list.length;
  saveRuntime(rt);
  if (seen === null) return [];                               // first look: what is already there is history
  return list.slice(seen).map((q) => {
    const c = autopilot.classify(q);
    logEvent(floorId, { type: 'autopilot.decided', data: { by: 'lead', question: q, critical: c.critical, reasons: c.reasons } });
    return { floorId, kind: 'lead', critical: c.critical };
  });
}

// Floor setting "Auto-resume after a crash": at most 2 per agent per hour, never while memory is under pressure
export async function autoResumeTick(now = Date.now(), { res = wd.readResources() } = {}) {
  const done = [];
  snapCache.at = 0;
  for (const f of buildingSnapshot().floors.filter((x) => !x.independent && !x.missing)) {
    let cfg; try { cfg = floors.readFloor(building.floorEntry(f.id).path); } catch { continue; }
    // Autopilot turns auto-resume on; the chain stops for the budget or a critical item waiting for the owner
    const ap = cfg.floor.autopilot !== 'off';
    if (!cfg.floor.recovery.autoResume && !ap) continue;
    if (ap && (f.budget?.level === 'over' || criticalWaiting(f.id))) continue;
    for (const a of f.agents.filter((x) => x.crash && !x.crash.withLead && x.resume && !x.running)) {
      const key = workKey(f.id, a.id);
      const r = loadRuntime();
      const ok = recovery.autoResumeAllowed(r.autoResumes[key] || [], res, now);
      if (!ok.ok) continue;
      r.autoResumes[key] = [...(r.autoResumes[key] || []).filter((t) => now - t < recovery.AUTO_RESUME.windowMs), now];
      saveRuntime(r);
      try { await resumeAgent(f.id, a.id, { via: 'auto-resume' }); done.push({ floorId: f.id, agentId: a.id }); } catch (e) { console.error('[recovery]', f.id, a.id, e.message); }
    }
  }
  return done;
}

export function stopAgent(floorId, agentId) {
  const { name } = locate(floorId, agentId);
  pending.delete(workKey(floorId, agentId));
  const wasRunning = tm.isRunning(name);
  const r = tm.stopSession(name);
  if (wasRunning) {
    if (!stoppedByUs.has(floorId)) stoppedByUs.set(floorId, new Set());
    stoppedByUs.get(floorId).add(agentId);
    logEvent(floorId, { type: 'agent.stopped', agent: agentId, session: name, data: { via: 'aisquad' } });
  }
  setSessionInfo(floorId, agentId, null);
  hooks.forget(floorId, agentId);
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
  const at = Date.now();                                 // before typing: fast replies may end within the verify wait
  const r = await tm.typeTask(name, body);
  if (!r.ok) throw bad(r.error);
  setWork(floorId, agentId, { text: body.slice(0, 300), assignedAt: at, doneAt: null });
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
      if (!tm.isReady(tm.capture(name, 0, { styled: true }))) continue;
      pending.delete(key);
      const at = Date.now();
      const r = await tm.typeTask(name, t.text);
      if (r.ok) setWork(floorId, agentId, { text: t.text.slice(0, 300), assignedAt: at, doneAt: null });
      else if (r.dialog) pending.set(key, t);
    }
  } finally { flushing = false; }
}

// an answer to an item that is no longer there (the agent went on working, the snapshot moved on): typed text is
// never lost, it goes to the agent as a message; a clicked option is "already answered" (409), a dismiss is fine
export const GONE_PREFIX = { question: "Owner's answer to your earlier question: ", permission: "Owner's answer to your earlier question: " };
async function answerGone({ floorId, agentId, kind }, option, text) {
  const t = String(text || '').trim();
  if (t && floorId && agentId && floorId !== ind.FLOOR_ID) {
    locate(floorId, agentId);                                   // the agent must exist (404 otherwise)
    const r = await sendTask(floorId, agentId, `${GONE_PREFIX[kind] || ''}${t}`);
    return { ...r, ok: true, delivered: 'as-message' };
  }
  if (!Number(option) && !t) return { ok: true, gone: true };    // a dismiss of something already gone
  throw new HttpError(409, 'Already answered');
}

export async function answerAttention(id, option, text = '', { force = false, floorId = '', agentId = '', kind = '' } = {}) {
  snapCache.at = 0;
  const item = attentionItems().find((x) => x.id === id);
  if (!item) return answerGone({ floorId, agentId, kind }, option, text);
  if (item.kind === 'merge') { const r = loadRuntime(); r.dismissedMerges = [...r.dismissedMerges, item.mergeId].slice(-200); saveRuntime(r); invalidate(); return { ok: true }; }
  if (item.kind === 'reply' || item.kind === 'finished') {
    if (!Number(option) && !String(text).trim()) { const r = loadRuntime(); r.dismissedReplies = [...r.dismissedReplies, item.replyKey].slice(-200); saveRuntime(r); invalidate(); return { ok: true }; }
    if (item.canReply === false) throw bad('This agent runs on its own: reply in its own terminal');
    return sendTask(item.floorId, item.agentId, text);   // the reply goes to the agent as its next task
  }
  if (item.kind === 'decided') {
    const rt = loadRuntime(), d = rt.autopilot.decided.find((x) => x.id === item.decidedId);
    if (!d) throw new HttpError(409, 'Already answered');
    const opt = item.options.find((o) => o.n === Number(option));
    const label = opt ? opt.label : String(text || '').trim();
    if (!label) { d.acked = Date.now(); saveRuntime(rt); invalidate(); return { ok: true }; }   // OK: the owner keeps it
    const r = await sendTask(item.floorId, item.agentId, autopilot.changeAnswer(d.question, d.option, label));
    Object.assign(d, { changed: label, acked: Date.now() });
    saveRuntime(rt);
    logEvent(item.floorId, { type: 'autopilot.changed', agent: item.agentId, data: { question: d.question.slice(0, 300), from: d.option, to: label } });
    invalidate();
    return r;
  }
  if (item.kind === 'scope') {
    const S = collect.stateOf(item.floorId), ch = S.scope?.changed;
    if (!ch) throw new HttpError(409, 'Already answered');
    ch.acked = Date.now(); collect.saveState(item.floorId);
    logEvent(item.floorId, { type: 'question.answered', data: { channel: 'scope mode', answer: Number(option) === 2 ? `back to ${ch.from}` : `accept ${ch.to}`, waitMs: Date.now() - ch.ts } });
    invalidate();
    if (Number(option) !== 2) return { ok: true };
    const team = floors.readFloor(building.floorEntry(item.floorId).path).team.agents;
    const lead = team.find((a) => a.lead) || team.find((a) => sprint.roleKind(a) === 'lead');
    if (!lead) throw bad('This Floor has no lead');
    return sendTask(item.floorId, lead.id, `The owner does not accept the scope change of sprint ${S.scope.sprint}: go back to scope mode ${ch.from} in docs/squad/PLAN.md and re-plan what changed.`);
  }
  if (item.kind === 'crash') {
    if (Number(option) === 1) return resumeAgent(item.floorId, item.agentId, { guard: !force });
    if (Number(option) === 2) return startAgent(item.floorId, item.agentId, '', { guard: !force });
    const end = endedOf(item.floorId, item.agentId);                         // no option: dismiss
    if (end) setEnded(item.floorId, item.agentId, { ...end, dismissed: true });
    invalidate();
    return { ok: true };
  }
  if (item.kind === 'stall') { clearWork(item.floorId, item.agentId || ''); if (!item.agentId) for (const k of Object.keys(workOf(item.floorId))) clearWork(item.floorId, k); invalidate(); return { ok: true }; }
  if (!item.answerable) throw bad('This question can only be answered in the agent\'s own terminal');
  if (item.independent) {
    const dialog = tm.parsePrompt(tm.capturePane(item.target, config.scanTmuxSocket));
    if (!dialog) throw new HttpError(409, 'Already answered');
    const r = tm.answerDialog('', dialog, Number(option), text, { target: item.target, socket: config.scanTmuxSocket });
    if (!r.ok) throw bad(r.error);
    ind.resetCache(); invalidate();
    return r;
  }
  const name = tm.sessionName(item.floorId, item.agentId);
  const dialog = tm.parsePrompt(tm.capture(name));
  if (!dialog) return answerGone({ floorId: item.floorId, agentId: item.agentId, kind: item.kind }, option, text);
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

// ---------- auto-merge (D3) ----------
export async function floorMerges(floorId) {
  const entry = building.floorEntry(floorId);
  const { git, team, floor } = floors.readFloor(entry.path);
  const sprintMode = floor.workflow === 'squad-sprint';
  return { policy: git, approval: merge.approval(floorId), running: merge.isMerging(floorId), log: merge.mergeLog(floorId, 20),
    candidates: await merge.candidates(floorId, entry.path, git, team.agents.map((a) => a.id), { extraPrefixes: sprintMode ? ['sprint-'] : [] }),
    sprint: sprintMode && sprint.hasPack(entry.path) ? { ...(await sprint.sprintStatus(entry.path)), autoNext: floor.sprint.autoNext } : null };
}

export function startMerge(floorId, branch) {
  const entry = building.floorEntry(floorId);
  const { git } = floors.readFloor(entry.path);
  if (merge.isMerging(floorId)) throw bad('A merge is already running on this Floor');
  runMerge(floorId, entry.path, git, String(branch || ''), { trigger: 'manual' }).then(invalidate);
  return { ok: true, started: true };
}

// every merge attempt (and its quality gate) goes to the Squad Log
async function runMerge(floorId, root, git, branch, opts) {
  const r = await merge.mergeBranch(floorId, root, git, branch, opts);
  for (const ev of collect.fromMerge(r)) logEvent(floorId, ev);
  return r;
}

// finished work = the agent's current work item is done and the agent is not working (agent branches),
// or nobody on the Floor has open work (feature branches). Each branch tip is tried once automatically.
let merging = false;
export async function mergeTick({ checkMemory = true } = {}) {
  if (merging) return [];
  merging = true;
  const done = [];
  try {
    const res = wd.readResources();
    if (checkMemory && res.mem && res.mem.available < wd.LIMITS.freeRamBytes) return done;     // quality gates are heavy; wait for memory
    const snap = buildingSnapshot();
    for (const f of snap.floors.filter((x) => !x.independent)) {
      if (!f.missing) { const n = await startNextSprint(f.id); if (n) done.push({ branch: '', result: 'next-sprint', nextSprint: n }); }
      if (f.missing || !merge.approval(f.id)) continue;
      const entry = building.floorEntry(f.id);
      const { git, team, floor } = floors.readFloor(entry.path);
      if (git.mergePolicy !== 'auto') continue;
      if (floor.workflow === 'squad-sprint') { const r = await sprintTick(f, entry, git, team, floor); if (r) done.push(r); continue; }
      if (git.branchStrategy === 'trunk') continue;
      const work = workOf(f.id);
      const openWork = Object.values(work).some((w) => !w.doneAt);
      for (const c of await merge.candidates(f.id, entry.path, git, team.agents.map((a) => a.id))) {
        if (c.lastResult) continue;
        if (c.agent) {
          const a = f.agents.find((x) => x.id === c.agent);
          if (!work[c.agent]?.doneAt || !a || a.state === 'working' || a.state === 'waiting') continue;
        } else if (openWork) continue;
        done.push(await runMerge(f.id, entry.path, git, c.branch, { trigger: 'auto' }));
      }
    }
  } finally { merging = false; if (done.length) invalidate(); }
  return done;
}

// Squad Sprint: a closed sprint is merged by the server; with "start the next sprint" on, the lead gets a
// fresh session that runs /sprint <N+1>. Each sprint branch tip is handled once.
async function sprintTick(f, entry, git, team, floor) {
  if (!sprint.hasPack(entry.path)) return null;
  const st = await sprint.sprintStatus(entry.path);
  if (!st.closed) return null;
  const tried = merge.mergeLog(f.id, 500).find((e) => e.branch === st.branch && e.tip === st.tip);
  if (tried) return null;
  // ship readiness: QA per module, the final smoke test, release notes, and the design / security reviews the team has
  const ready = ship.readiness(entry.path, { sprint: st.sprint, team: team.agents });
  if (!ready.merge.ready) {
    const key = `${st.branch}@${st.tip}`, S = collect.stateOf(f.id);
    if (S.shipBlocked !== key) { S.shipBlocked = key; collect.saveState(f.id); logEvent(f.id, { type: 'ship.blocked', sprint: Number(st.sprint) || null, data: { branch: st.branch, missing: ready.merge.missing } }); }
    return null;
  }
  const result = await runMerge(f.id, entry.path, git, st.branch, { trigger: 'sprint' });
  if (result.result === 'merged' && floor.sprint.autoNext) {
    const lead = team.agents.find((a) => a.lead) || team.agents.find((a) => sprint.roleKind(a) === 'lead');
    if (lead) {
      const r = loadRuntime();
      r.nextSprint = { ...(r.nextSprint || {}), [f.id]: { sprint: Number(st.sprint) + 1, lead: lead.id, since: Date.now() } };
      saveRuntime(r);
      result.nextSprint = await startNextSprint(f.id) || { sprint: Number(st.sprint) + 1, lead: lead.id, waiting: true };
    }
  }
  return result;
}

// the lead usually still wraps up (messages to teammates, report) after the closing commit: restart it
// for the next sprint only once its turn has ended, so it is never cut off mid-turn
export async function startNextSprint(floorId) {
  const r = loadRuntime();
  const p = r.nextSprint?.[floorId];
  if (!p) return null;
  snapCache.at = 0;
  const fl = buildingSnapshot().floors.find((x) => x.id === floorId);
  const lead = fl?.agents.find((a) => a.id === p.lead);
  if (!lead || lead.state === 'working' || lead.state === 'waiting') return null;
  if (fl.autopilot?.level !== 'off' && (fl.budget?.level === 'over' || fl.autopilot?.critical)) return null;   // the Autopilot chain stops here
  delete r.nextSprint[floorId];
  saveRuntime(r);
  stopAgent(floorId, p.lead);
  await startAgent(floorId, p.lead, `/sprint ${p.sprint}`);
  return { sprint: p.sprint, lead: p.lead };
}

// ---------- Floor 1: independent agents ----------
const INDEPENDENT_NAME = 'Independent agents';
function independentLives({ events = false } = {}) {
  const now = Date.now();
  const list = ind.current({ floorRoots: building.loadBuilding().floors.map((f) => f.path) });
  const files = ind.assignTranscripts(list);                                 // each its own session, never one twice
  return list.map((a) => {
    const screen = a.tmux ? tm.capturePane(a.tmux.target, config.scanTmuxSocket) : '';
    const dialog = a.tmux && a.live ? tm.parsePrompt(screen) : null;
    const file = files.get(a);
    const st = file ? statusOf(file, a.root, events) : null;
    const asking = a.live && st?.ask;
    const working = a.live && ((a.tmux && tm.isBusy(screen)) || (!a.tmux && st?.turnOpen && now - st.lastTs < tx.ACTIVE_MS));
    const state = !a.live ? 'stopped' : dialog || asking ? 'waiting' : working ? 'working' : 'idle';
    if (dialog && st?.ask?.questions?.length) dialog.question = st.ask.questions.map((q) => q.question).join('\n\n');
    return { a, st, screen, dialog, state };
  });
}
function independentView(l, costToday) {
  const { a, st } = l;
  return {
    id: a.id, displayName: ind.displayNameOf(a), independent: true, root: a.root, via: a.via, live: false, tmux: a.tmux?.target || null, pid: a.pid,
    lead: false, running: !!a.live, state: l.state, activity: st?.activity || (a.live ? '' : 'no Claude Code process running'), lastTs: st?.lastTs || 0,
    title: `Claude Code · ${a.via}`, model: tx.modelFamily(st?.model) || '', appearance: ind.appearanceFor(a.id), kindOf: 'dev',
    models: { configured: '', observed: st?.model || '', observedAt: st?.modelTs || 0, mismatch: false, restartNeeded: false },
    peek: st?.peek ? codeWindow(a.root, (({ id, ...rest }) => rest)(st.peek)) : null, costToday: +(costToday || 0).toFixed(2), templateStatus: {}, work: null,
  };
}
function independentState(b) {
  const lives = independentLives();
  let today = 0;
  const agents = lives.map((l) => { const c = costFor(`ind:${l.a.root}`, l.a.root).today; today += c; return independentView(l, c); });
  const attention = [];
  const dismissedNow = new Set(loadRuntime().dismissedReplies);
  for (const l of lives) {
    const base = { floorId: ind.FLOOR_ID, floorNumber: building.INDEPENDENT_FLOOR, floorName: INDEPENDENT_NAME, agentId: l.a.id, agentName: ind.displayNameOf(l.a), independent: true };
    if (l.dialog) attention.push({ ...base, id: attId('ind', l.a.key, l.dialog.question, l.dialog.options.map((o) => o.label).join('|')), kind: PERMISSION.test(l.dialog.question) ? 'permission' : 'question',
      text: l.dialog.question, options: l.dialog.options, answerable: true, target: l.a.tmux.target, ts: l.st?.lastTs || Date.now() });
    else if (l.state === 'waiting' && l.st?.ask) attention.push({ ...base, id: attId('ind', l.a.key, l.st.ask.id), kind: 'question', text: l.st.ask.questions.map((q) => q.question).join('\n\n'),
      options: (l.st.ask.questions[0]?.options || []).map((label, i) => ({ n: i + 1, label, free: false })), answerable: false, ts: l.st.ask.ts });
    else if (l.state === 'idle' && l.st) {
      // a finished turn of an agent running on its own: shown, but answered in its own terminal (we never type into it)
      const r = replyLib.turnReport({ running: true, inLead: false, status: l.st, work: null, pending: false, dialog: l.dialog, busy: false });
      const key = replyKey(ind.FLOOR_ID, l.a.id, r?.ts);
      if (r && Date.now() - r.ts < replyLib.FINISHED_MAX_AGE_MS && !dismissedNow.has(key)) attention.push({ ...base, id: attId('ind', l.a.key, 'finished', r.ts), kind: 'finished', replyKey: key, text: r.text,
        asks: replyLib.asksOwner(l.st.reply.text), canReply: false, options: [], answerable: true, calm: true, ts: r.ts });
    }
  }
  const count = (st) => agents.filter((a) => a.state === st).length;
  const reg = ind.loadRegistry();
  return { attention, lives, summary: {
    id: ind.FLOOR_ID, number: building.INDEPENDENT_FLOOR, independent: true, name: INDEPENDENT_NAME, tagline: 'agents on their own', path: '',
    goal: 'Claude Code agents already running on this machine on their own. Adopt one into a squad to make it part of a team.',
    accent: '#5d6687', layout: 'open-space', workflow: 'independent', desks: [], devices: floors.defaultDevices(), agents,
    lamp: attention.length ? 'attention' : count('working') ? 'working' : agents.some((a) => a.running) ? 'idle' : 'stopped',
    counts: { working: count('working'), waiting: count('waiting'), idle: count('idle'), stopped: count('stopped') },
    cost: { today: round2(today), month: 0 }, budget: { usd: 0, level: 'none', used: 0, pct: 0 }, attention: attention.length, updates: 0, scannedAt: reg.scannedAt,
  } };
}
export function independentDetail() {
  const lives = independentLives({ events: true });
  const st = independentState(building.loadBuilding());
  const feed = [];
  for (const l of lives) for (const e of l.st?.events || []) if (e.kind !== 'read') feed.push({ ...e, agentId: l.a.id, agentName: ind.displayNameOf(l.a), detail: e.detail.slice(0, 200) });
  feed.sort((a, b) => b.ts - a.ts);
  return { ...st.summary, feed: feed.slice(0, 60), messages: [], attentionItems: st.attention, team: [], board: null, shots: [] };
}
function independentDesk(agentId) {
  const l = independentLives({ events: true }).find((x) => x.a.id === agentId);
  if (!l) throw notFound(`Agent not found: ${agentId}`);
  return {
    floorId: ind.FLOOR_ID, ...independentView(l, costFor(`ind:${l.a.root}`, l.a.root).today),
    screen: l.a.tmux ? tm.capturePane(l.a.tmux.target, config.scanTmuxSocket, 300).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() : '', dialog: l.dialog,
    events: (l.st?.events || []).slice(-80).reverse(), attach: l.a.tmux ? `tmux attach -t ${l.a.tmux.target.slice(1)}` : '',
  };
}
export function rescanIndependents() { ind.resetCache(); invalidate(); const list = ind.current({ maxAgeMs: 0, floorRoots: building.loadBuilding().floors.map((f) => f.path) }); return { ok: true, found: list.length }; }
// adopt: the agent joins a squad Floor's team (a new team member from a Role Template); it leaves Floor 1
export function adoptIndependent(id, { floorId, template, displayName }) {
  const a = ind.current().find((x) => x.id === id);
  if (!a) throw notFound('That independent agent is gone; rescan first');
  const entry = building.floorEntry(floorId);
  const member = floors.addAgent(entry.path, { displayName: String(displayName || '').trim() || ind.displayNameOf(a).replace(/\W+/g, ' ').trim(), template });
  ind.adopt(id, { floorId, agentId: member.id });
  invalidate();
  return { ok: true, floorId, agent: member };
}

// ---------- built-in skills ----------
// install bundled skills into the Floor's repo (.claude/skills) and regenerate the agent files
export function installSkills(floorId, names) {
  const root = building.floorEntry(floorId).path;
  const out = (Array.isArray(names) ? names : [names]).map((n) => skillsLib.install(root, String(n)));
  floors.generate(root);
  invalidate();
  return { ok: true, results: out };
}

// ---------- performance (Squad Sprint Floors only) ----------
const perfCache = new Map();
export function performance(floorId) {
  const entry = building.floorEntry(floorId);
  const { floor, team } = floors.readFloor(entry.path);
  if (floor.workflow !== 'squad-sprint') throw bad('Performance is available on Squad Sprint Floors only');
  const hit = perfCache.get(floorId);
  if (hit && Date.now() - hit.at < 20000) return hit.value;
  costFor(floorId, entry.path);                                   // scans new transcript lines
  const tracker = costs.get(floorId).tracker;
  const value = floorPerformance(entry.path, team.agents.map((a) => ({ id: a.id, displayName: a.displayName, kind: sprint.roleKind(a) })), (from, to) => tracker.costBetween(from, to));
  perfCache.set(floorId, { at: Date.now(), value });
  return value;
}

// ---------- plugin hook events ----------
export function ingestEvent(body) {
  const floorsNow = building.loadBuilding().floors.map((e) => {
    let agentIds = [];
    try { agentIds = floors.readFloor(e.path).team.agents.map((a) => a.id); } catch { /* missing Floor */ }
    return { id: e.id, path: e.path, agentIds };
  });
  const key = hooks.ingest(body, floorsNow);
  if (key) {
    snapCache.at = 0;
    const [fid] = key.split('/');
    for (const ev of collect.fromHook(key, body, floorsNow.find((f) => f.id === fid)?.path || '')) logEvent(fid, ev);
  }
  return { ok: true, matched: key };
}

// ---------- QA screenshots (shown on QA monitors) ----------
export const SHOT_DIRS = ['docs/squad/qa/screenshots', 'docs/qa/screenshots', '.playwright-mcp', 'test-results', 'screenshots'];
const SHOT_EXT = /\.(png|jpe?g|webp)$/i;
export function listShots(root, n = 8) {
  const out = [];
  const walk = (dir, depth) => {
    for (const f of (() => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } })()) {
      const full = path.join(dir, f.name);
      if (f.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (f.isFile() && SHOT_EXT.test(f.name)) { const st = statOf(full); if (st) out.push({ file: path.relative(root, full), mtime: st.mtimeMs, size: st.size }); }
    }
  };
  for (const d of SHOT_DIRS) walk(path.join(root, d), 0);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, n);
}
export function shotFile(floorId, rel) {
  const root = building.floorEntry(floorId).path;
  const full = path.resolve(root, String(rel || ''));
  const ok = SHOT_EXT.test(full) && SHOT_DIRS.some((d) => full.startsWith(path.join(root, d) + path.sep));
  const st = ok && statOf(full);
  if (!st || !st.isFile() || st.size > 8e6) throw notFound('Screenshot not found');
  return full;
}

// the editor on the monitor: a window of the real file around the latest edit (repo files only, never .env)
const windowCache = new Map();
export function codeWindow(root, peek) {
  if (peek.type !== 'code' || !peek.path) return peek;
  const file = path.resolve(root, peek.path);
  if (!file.startsWith(root + path.sep) || /(^|\/)\.env/.test(file)) return peek;
  const st = statOf(file);
  if (!st || !st.isFile() || st.size > 400000) return peek;
  const key = `${file}:${st.mtimeMs}:${peek.ts}`;
  const keep = peek.old != null ? { added: peek.text } : {};          // a diff on the monitor needs the edit's own lines
  if (windowCache.has(key)) return { ...peek, ...windowCache.get(key), ...keep };
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return peek; }
  const lines = text.split('\n');
  const needle = String(peek.text || '').split('\n').find((l) => l.trim().length > 3) || '';
  const at = Math.max(0, needle ? lines.findIndex((l) => l.includes(needle.trim())) : 0);
  const start = Math.max(0, at - 5);
  const win = { text: lines.slice(start, start + 18).map((l) => l.slice(0, 160)).join('\n'), firstLine: start + 1, hlFrom: at + 1, hlTo: at + Math.min(12, String(peek.text || '').split('\n').length) };
  windowCache.set(key, win);
  if (windowCache.size > 200) windowCache.delete(windowCache.keys().next().value);
  return { ...peek, ...win, ...keep };
}

// ---------- Squad Log (server/log.js, server/collect.js) ----------
const stoppedByUs = new Map();                 // floorId -> agent ids stopped through The AI Squad since the last log tick
function logCtx(floorId, root, cfg) {
  if (floorId === ind.FLOOR_ID || !root) return { team: [], sprint: null, options: {} };
  const c = cfg || floors.readFloor(root);
  return { team: c.team.agents, sprint: sprint.hasPack(root) ? Number(sprint.readConfig(root).SPRINT) || null : null,
    options: { messages: c.floor.log.messages, pii: c.floor.log.maskPersonalData } };
}
// logging never breaks the action that is logged
export function logEvent(floorId, ev) {
  try { collect.emitter(floorId, logCtx(floorId, floorId === ind.FLOOR_ID ? '' : building.floorEntry(floorId).path))(ev); } catch (e) { console.error('[log]', e.message); }
}

// Floor 1 reads back only the last day (the scan's own window): these are other projects' sessions
function collectTranscripts(floorId, root, emit, now, agentId = '') {
  const S = collect.stateOf(floorId);
  const backfillMs = floorId === ind.FLOOR_ID ? ind.RECENT_MS : collect.BACKFILL_MS;
  const fresh = (file, st) => (S.files[file] ? S.files[file].offset !== st.size || S.files[file].usage : st.mtimeMs >= now - backfillMs);
  for (const s of tx.sessionsOf(root)) {
    if (fresh(s.file, s.st)) collect.readTranscript(floorId, s.file, { agent: agentId || tx.sessionAgent(s.file) || 'owner', root, emit, backfillMs }, now);
    if (s.st.mtimeMs < now - backfillMs) continue;
    const sd = path.join(tx.projectDir(root), s.id, 'subagents');
    for (const f of fs.existsSync(sd) ? fs.readdirSync(sd) : []) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(sd, f), st = statOf(file);
      if (!st || !fresh(file, st)) continue;
      const meta = readJson(file.replace(/\.jsonl$/, '.meta.json'), {}) || {};
      collect.readTranscript(floorId, file, { agent: meta.customAgentType || meta.agentType || meta.name || 'subagent', root, subagent: true, emit, backfillMs }, now);
    }
  }
}

// every 15 s: new transcript lines, docs/squad and source documents, commits (every minute), agent state changes
let logging = false, lastCommits = 0;
export async function logTick(now = Date.now(), { onEvent = null } = {}) {
  if (logging) return 0;
  logging = true;
  let n = 0;
  try {
    const snap = buildingSnapshot();
    const commits = now - lastCommits >= 60000;
    if (commits) lastCommits = now;
    for (const entry of building.loadBuilding().floors) {
      if (!fs.existsSync(entry.path)) continue;
      let cfg; try { cfg = floors.readFloor(entry.path); } catch { continue; }
      const base = collect.emitter(entry.id, logCtx(entry.id, entry.path, cfg));
      const team = ritualTeam(cfg);
      // rituals: a logged planning, review, Retro, briefing or standup gathers the characters at the meeting table
      const emit = (ev) => { const e = base(ev); if (e) { n++; onEvent?.(entry.id, e); const m = rituals.meetingFrom(e, team, now); if (m && now - m.since < 5 * 60e3) meetings.set(entry.id, m); } return e; };
      try {
        collectTranscripts(entry.id, entry.path, emit, now);
        for (const ev of collect.scanDocs(entry.id, entry.path, { blueprint: blueprintsLib.floorBlueprint(entry.path, cfg.floor.blueprint) }, now)) emit(ev);
        if (commits) for (const ev of await collect.scanCommits(entry.id, entry.path, cfg.team.agents.map((a) => a.id), now)) emit(ev);
        const f = snap.floors.find((x) => x.id === entry.id);
        if (f?.agents) {
          const own = {};
          let teamOpen = 0;
          for (const r of Object.values(collect.stateOf(entry.id).board || {})) if (r.status !== 'DONE') { teamOpen++; if (r.owner) own[r.owner] = (own[r.owner] || 0) + 1; }
          for (const [id, w] of Object.entries(workOf(entry.id))) if (!w.doneAt) { teamOpen++; own[id] = (own[id] || 0) + 1; }
          for (const ev of collect.stateChanges(entry.id, f.agents, { teamOpen, own, stoppedByUs: stoppedByUs.get(entry.id) }, now)) emit(ev);
          stoppedByUs.delete(entry.id);
          for (const ev of reportEvents(entry.id, snap.attention)) emit(ev);
          const S = collect.stateOf(entry.id);
          S.models ||= {};
          for (const a of f.agents) {
            if (!a.models?.mismatch || S.models[a.id] === a.models.observed) continue;
            S.models[a.id] = a.models.observed;
            emit({ type: 'agent.model', agent: a.id, model: a.models.observed, data: { configured: a.models.configured, observed: a.models.observed } });
          }
        }
      } catch (e) { console.error('[log]', entry.id, e.message); }
      try { holdStandup(entry, cfg, snap, emit, now); } catch (e) { console.error('[standup]', entry.id, e.message); }
      collect.saveState(entry.id);
      if (commits && cfg.floor.audit.auto) queueSprintAudit(entry.id, now);
    }
    // Floor 1: independent agents (one agent per folder for transcripts)
    const ctx1 = collect.emitter(ind.FLOOR_ID, {});
    const emit1 = (ev) => { const e = ctx1(ev); if (e) n++; return e; };
    const roots = new Set();
    for (const a of ind.current({ floorRoots: building.loadBuilding().floors.map((f) => f.path) })) {
      if (roots.has(a.root)) continue;
      roots.add(a.root);
      try { collectTranscripts(ind.FLOOR_ID, a.root, emit1, now, a.id); } catch { /* unreadable */ }
    }
    const f1 = snap.floors.find((x) => x.id === ind.FLOOR_ID);
    if (f1) for (const ev of collect.stateChanges(ind.FLOOR_ID, f1.agents, { independent: true }, now)) emit1(ev);
    for (const ev of reportEvents(ind.FLOOR_ID, snap.attention)) emit1(ev);
    collect.saveState(ind.FLOOR_ID);
    runPendingAudits();
  } finally { logging = false; }
  return n;
}

// ---------- voices (server/voice.js) ----------
const voiceSettings = () => voice.cleanSettings(building.loadBuilding().prefs.voice || {});
// for Settings → Voice: the key (set, last 4), settings, this month's usage, the plan and what is left (needs the
// user_read permission), ElevenLabs' last error with a hint, the models (and which take a language), languages
export async function voiceInfo() {
  const key = voice.keyStatus();
  return { key, settings: voiceSettings(), usage: voice.usage(), account: key.set ? await voice.account().catch(() => null) : null, lastError: voice.lastApiError(),
    models: voice.MODELS, langModels: voice.LANG_MODELS, languages: voice.LANGUAGES, voiceDefaults: voice.VOICE_DEFAULTS };
}
export function setVoiceSettings(input) { const s = voice.cleanSettings({ ...voiceSettings(), ...input }); building.setPrefs({ voice: s }); return voiceInfo(); }
export const voiceList = () => voice.voices();
// who speaks and how: the agent's voice (team.json), its role's default, or the Building default; its language and
// voice settings, else the Floor's defaults, else auto and the defaults -> { voice, lang, vs }
export function agentVoice(floorId, agentId) {
  const base = { voice: voice.DEFAULT_VOICE, lang: 'auto', vs: voice.VOICE_DEFAULTS };
  if (!floorId || floorId === ind.FLOOR_ID) return base;
  try {
    const cfg = floors.readFloor(building.floorEntry(floorId).path), a = cfg.team.agents.find((x) => x.id === agentId), fv = cfg.floor.voice || {};
    return { voice: voice.voiceFor(a), lang: a?.voiceLang || fv.lang || 'auto', vs: a?.voiceSettings || fv.settings || voice.VOICE_DEFAULTS };
  } catch { return base; }
}
// kind: finished | question | reply | shout | meeting | test; full: the whole message (the play button)
// -> { audio } or { fallback, reason, text } (the browser then speaks the text itself, or stays silent)
export async function speakLine({ floorId = '', agentId = '', kind = 'finished', text = '', full = false, visible = true } = {}) {
  const s = voiceSettings();
  if (!full && floorId && s.mutedFloors.includes(floorId)) return { fallback: 'silent', reason: 'this Floor is muted', text: '' };
  if (!full && voice.quietNow(s)) return { fallback: 'silent', reason: 'quiet hours', text: '' };
  if (!full && s.onlyVisible && !visible) return { fallback: 'silent', reason: 'the tab is not visible', text: '' };
  const who = agentVoice(floorId, agentId);
  const r = await voice.speak({ text, voice: who.voice, lang: who.lang, vs: who.vs, settings: s, full });
  if (r.audio && floorId) logEvent(floorId, { type: 'voice.spoken', agent: agentId || null, data: { kind, chars: r.chars, voice: r.voice, cached: r.cached } });
  return r;
}
export const voiceTest = () => voice.speak({ text: 'Hello, this is The AI Squad. The voice works.', voice: voice.DEFAULT_VOICE, lang: 'en', settings: voiceSettings() });
// Preview in the voice picker: a sample line in the chosen language with settings not saved yet
const SAMPLE = { id: 'Halo, aku siap bekerja. Tugas berikutnya apa?', en: 'Hello, I am ready to work. What is the next task?' };
export function voicePreview({ voice: v, lang = 'auto', settings: vs = null, text = '' } = {}) {
  const l = voice.cleanLang(lang);
  return voice.speak({ text: String(text || '').slice(0, 200) || SAMPLE[l] || SAMPLE.en, voice: voice.validVoice(v) ? v : voice.DEFAULT_VOICE, lang: l, vs: voice.cleanVoice(vs || {}), settings: voiceSettings(), full: true });
}

// ---------- design variants (server/design.js) ----------
export function floorDesigns(floorId) { return { groups: design.groups(building.floorEntry(floorId).path) }; }
export function designVariantFile(floorId, screen, file) { return design.variantFile(building.floorEntry(floorId).path, screen, file); }
// the owner's pick: a taste note in DESIGN.md, the designer is told (as its next task when it runs, else queued)
export async function pickDesign(floorId, screen, file, note = '') {
  const entry = building.floorEntry(floorId);
  const r = design.pick(entry.path, screen, file, { note });
  logEvent(floorId, { type: 'design.picked', data: { screen, chosen: file, title: r.title, others: r.others.length } });
  const cfg = floors.readFloor(entry.path);
  const designer = cfg.team.agents.find((a) => /designer/.test(a.role?.template || ''));
  if (designer && tm.isRunning(tm.sessionName(floorId, designer.id))) await sendTask(floorId, designer.id, `The owner picked "${r.title}" for ${screen} (docs/design/variants/${screen}/${file}). The taste note is in docs/DESIGN.md: follow it in this screen and in later rounds.`);
  invalidate();
  return { ok: true, ...r };
}

// GET /api/floors/:id/ship: what ran and what is missing before the sprint merges or deploys
export function floorShip(floorId) {
  const entry = building.floorEntry(floorId);
  const cfg = floors.readFloor(entry.path);
  const n = sprint.hasPack(entry.path) ? sprint.readConfig(entry.path).SPRINT : null;
  return { ...ship.readiness(entry.path, { sprint: n, team: cfg.team.agents }), mergePolicy: cfg.git.mergePolicy, approved: !!merge.approval(floorId) };
}

// ---------- rituals (server/rituals.js) ----------
const meetings = new Map();                    // floorId -> the meeting at the table now { kind, label, agents, since, until }
const ritualTeam = (cfg) => { const lead = cfg.team.agents.find((a) => a.lead) || cfg.team.agents.find((a) => sprint.roleKind(a) === 'lead');
  return cfg.team.agents.map((a) => ({ id: a.id, lead: a === lead, template: a.role?.template || '', displayName: a.displayName })); };
// the standup since the last one: from the Log and what the agents do right now
function currentStandup(floorId, cfg, snap, now = Date.now()) {
  const S = collect.stateOf(floorId);
  const since = S.standup?.at || now - 864e5;
  const f = snap?.floors.find((x) => x.id === floorId);
  const live = Object.fromEntries((f?.agents || []).map((a) => [a.id, { state: a.state, activity: a.activity }]));
  return rituals.standup(squadLog.read(floorId, { from: since, limit: 50000 }), ritualTeam(cfg), { since, now, live });
}
function holdStandup(entry, cfg, snap, emit, now) {
  const S = collect.stateOf(entry.id);
  if (!rituals.standupDue(cfg.floor.standup, S.standup?.at || 0, now)) return;
  const s = currentStandup(entry.id, cfg, snap, now);
  S.standup = { at: now, ...s };
  const count = (k) => s.agents.reduce((n, a) => n + a[k].length, 0);
  // a quiet day is recorded but nobody walks to the table
  if (!s.quiet) emit({ type: 'standup.held', data: { agents: s.agents.length, done: count('done'), doing: count('doing'), blocked: count('blocked'), meeting: cfg.floor.standup.meeting } });
  if (s.quiet || !cfg.floor.standup.meeting) meetings.delete(entry.id);
}
// GET /api/floors/:id/standup: the one held last and what a standup would say now
export function floorStandup(floorId) {
  const entry = building.floorEntry(floorId);
  const cfg = floors.readFloor(entry.path);
  const S = collect.stateOf(floorId);
  return { setting: cfg.floor.standup, last: S.standup || null, now: currentStandup(floorId, cfg, buildingSnapshot()), meeting: rituals.active(meetings.get(floorId)) };
}

// report.delivered: once per ended turn that reached the owner as a "Finished" or "Waiting for your reply" card
function reportEvents(floorId, attention) {
  const S = collect.stateOf(floorId);
  S.reports ||= {};
  const out = [];
  for (const a of attention) {
    if (a.floorId !== floorId || (a.kind !== 'finished' && a.kind !== 'reply') || S.reports[a.agentId] === a.ts) continue;
    S.reports[a.agentId] = a.ts;
    out.push({ type: 'report.delivered', agent: a.agentId, data: { card: a.kind, asks: a.kind === 'reply' || !!a.asks, chars: a.text.length, text: a.text } });
  }
  return out;
}

// GET /api/floors/:id/log
export function floorLog(floorId, q = {}) {
  if (floorId !== ind.FLOOR_ID) building.floorEntry(floorId);
  const events = squadLog.read(floorId, q);
  return { floor: floorId, events, types: squadLog.TYPES, categories: squadLog.CATEGORIES,
    agents: [...new Set(events.map((e) => e.agent).filter(Boolean))].sort(), sprints: [...new Set(events.map((e) => e.sprint).filter((x) => x != null))].sort((a, b) => a - b) };
}

// ---------- Audit (server/audit.js) ----------
const auditing = new Map();                    // floorId -> { since, sprint }
const pendingAudits = new Map();               // floorId -> sprint closed, waiting for an automatic audit
// read from the log, so a server restart does not lose it: the last sprint closed in the past day without an audit
function queueSprintAudit(floorId, now) {
  const closed = squadLog.read(floorId, { type: 'sprint.closed', from: now - 864e5 }).at(-1);
  if (closed && !auditLib.listAudits(floorId).some((a) => a.range?.sprint === closed.sprint)) pendingAudits.set(floorId, closed.sprint);
}
function auditInfo(entry, cfg) {
  const bp = blueprintsLib.floorBlueprint(entry.path, cfg.floor.blueprint);
  return {
    floorName: cfg.floor.name, workflow: cfg.floor.workflow, blueprint: bp?.id || '', blueprintVersion: bp?.version || null,
    sourceDocs: (bp?.sourceDocs || []).map((d) => String(d.path)).filter(Boolean),
    team: cfg.team.agents.map((a) => { let eff = null; try { eff = floors.effectiveOf(entry.path, a); } catch { /* broken template */ } return { id: a.id, role: a.role?.template || '', model: eff?.model || '', effort: eff?.effort || '' }; }),
  };
}

export function floorAudits(floorId) {
  const entry = building.floorEntry(floorId);
  const cfg = floors.readFloor(entry.path);
  const sprints = [...new Set(squadLog.read(floorId, { type: 'sprint', limit: 50000 }).map((e) => e.sprint).filter((x) => x != null))].sort((a, b) => a - b);
  const r = auditing.get(floorId);
  return { audits: auditLib.historyOf(floorId).reverse(), running: r ? { since: r.since, sprint: r.sprint } : null, settings: cfg.floor.audit, sprints, models: floors.AUDIT_MODELS,
    ledger: improve.ledger({ floor: floorId }).reverse() };
}
// the Retro dialog: the latest sprint Retro; "Send to lead" asks the lead to turn it into LEARNINGS.md entries
export function floorRetro(floorId, sprintNo = null) {
  building.floorEntry(floorId);
  const r = auditLib.latestRetro(floorId, sprintNo);
  return { retro: r };
}
export async function sendRetroToLead(floorId, sprintNo = null) {
  const { entry, cfg } = floorBp2(floorId);
  const { retro } = floorRetro(floorId, sprintNo);
  if (!retro) throw notFound('No Retro yet: it is made when a sprint closes (or from an audit of one sprint)');
  const lead = cfg.team.agents.find((x) => x.lead) || cfg.team.agents.find((x) => sprint.roleKind(x) === 'lead');
  if (!lead) throw bad('This Floor has no lead');
  learnings.ensure(entry.path);
  // the Retro goes into the repo, where the lead can read it (the audit folder is outside the project)
  const rel = `docs/squad/retro/sprint-${retro.sprint}.md`;
  writeText(path.join(entry.path, rel), retroLib.retroMd(retro, cfg.floor.name));
  const r = await sendTask(floorId, lead.id, retroLib.learningsTask(retro, rel));
  return { ...r, lead: lead.id, file: rel };
}
const floorBp2 = (floorId) => { const entry = building.floorEntry(floorId); return { entry, cfg: floors.readFloor(entry.path) }; };
export function floorAudit(floorId, auditId) {
  building.floorEntry(floorId);
  const a = auditLib.getAudit(floorId, auditId);
  if (!a) throw notFound('Audit not found');
  return { ...a, decisions: improve.decisionsFor(floorId, a.id) };
}

// runs in the background; returns the promise of the audit (the CLI waits for it, the API does not)
export function startAudit(floorId, { sprint: sprintNo = null, model = '' } = {}) {
  const entry = building.floorEntry(floorId);
  if (auditing.has(floorId)) throw bad('An audit is already running on this Floor');
  const cfg = floors.readFloor(entry.path);
  const m = floors.AUDIT_MODELS.includes(model) ? model : cfg.floor.audit.model;
  const n = sprintNo === '' || sprintNo == null ? null : Number(sprintNo);
  if (n != null && !Number.isInteger(n)) throw bad('Sprint must be a number');
  auditing.set(floorId, { since: Date.now(), sprint: n });
  const closeChecks = cfg.floor.workflow === 'squad-sprint' && sprint.hasPack(entry.path)
    ? sprint.sprintStatus(entry.path, n ?? sprint.readConfig(entry.path).SPRINT).then((st) => ({ sprint: st.sprint, checks: st.checks }), () => null) : Promise.resolve(null);
  return closeChecks.then((sprintClose) => auditLib.runAudit(floorId, { ...auditInfo(entry, cfg), sprintClose }, { sprint: n, model: m })).then((a) => {
    logEvent(floorId, { type: 'audit.done', sprint: n, data: { audit: a.id, findings: a.findings.length, cost: a.cost, model: a.model, ...(a.error ? { error: a.error } : {}) } });
    improve.recordOutcomes(floorId, a);                // earlier applied changes get their "after" metrics
    if (n != null && !a.error) {                         // a sprint's audit is also its Retro
      let perf = null; try { perf = cfg.floor.workflow === 'squad-sprint' ? performance(floorId) : null; } catch { /* no board data */ }
      const r = retroLib.buildRetro(a, perf, auditLib.listAudits(floorId).filter((x) => x.id !== a.id));
      auditLib.saveRetro(floorId, a.id, r, retroLib.retroMd(r, cfg.floor.name));
      logEvent(floorId, { type: 'retro.done', sprint: n, data: { audit: a.id, wentWell: r.wentWell.length, wentBadly: r.wentBadly.length, changes: r.changes.length } });
      return { ...a, retro: r };
    }
    return a;
  }).finally(() => auditing.delete(floorId));
}

function runPendingAudits() {
  for (const [floorId, n] of pendingAudits) {
    if (auditing.has(floorId)) continue;
    const res = wd.readResources();
    if (res.mem && res.mem.available < wd.LIMITS.freeRamBytes) return;      // claude -p waits for memory, like merges
    pendingAudits.delete(floorId);
    if (auditLib.listAudits(floorId).some((a) => a.range?.sprint === n)) continue;
    try { startAudit(floorId, { sprint: n }).then((a) => console.log(`[audit] ${floorId} sprint ${n}: ${a.error || `${a.findings.length} findings`}`), (e) => console.error('[audit]', e.message)); } catch (e) { console.error('[audit]', e.message); }
  }
}

// ---------- improvement loop (server/improve.js) ----------
function floorRef(floorId) {
  const entry = building.floorEntry(floorId);
  return { id: floorId, root: entry.path, config: floors.readFloor(entry.path).floor };
}
export const findingProposal = (floorId, auditId, findingId) => improve.proposal(floorRef(floorId), auditId, findingId);
export function applyFinding(floorId, auditId, findingId) {
  const f = floorRef(floorId);
  const d = improve.apply(f, auditId, findingId, { updateFloor: (patch) => floors.updateFloorConfig(f.root, patch) });
  logEvent(floorId, { type: 'improvement.decided', data: { decision: 'applied', target: `${d.target.kind} ${d.target.id}`, version: d.versionCreated, finding: findingId, audit: auditId } });
  invalidate();
  return { ok: true, decision: d };
}
export function dismissFinding(floorId, auditId, findingId, reason) {
  const d = improve.dismiss(floorRef(floorId), auditId, findingId, reason);
  logEvent(floorId, { type: 'improvement.decided', data: { decision: 'dismissed', target: d.target ? `${d.target.kind} ${d.target.id}` : `${findingId} (advice)`, finding: findingId, audit: auditId, reason: d.reason } });
  return { ok: true, decision: d };
}
// ---------- source documents (Blueprint gate) ----------
function floorBp(floorId) {
  const entry = building.floorEntry(floorId);
  const cfg = floors.readFloor(entry.path);
  const bp = blueprintsLib.floorBlueprint(entry.path, cfg.floor.blueprint);
  if (!bp) throw bad('This Floor has no Blueprint');
  return { entry, cfg, bp };
}
export function sourceDocs(floorId) {
  const { entry, bp } = floorBp(floorId);
  const docs = blueprintsLib.sourceDocsStatus(entry.path, bp);
  return { docs: [...docs.filter((d) => d.status !== 'approved'), ...docs.filter((d) => d.status === 'approved')], gate: squadOf(entry.path, floors.readFloor(entry.path).floor).gate };
}
export function sourceDocText(floorId, rel) { const { entry, bp } = floorBp(floorId); return blueprintsLib.readSourceDoc(entry.path, bp, rel); }
const DATE = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export function approveSourceDoc(floorId, rel, now = Date.now()) {
  const { entry, bp } = floorBp(floorId);
  const r = blueprintsLib.approveSourceDoc(entry.path, bp, rel, DATE(now));
  if (r.changed) logEvent(floorId, { type: 'doc.approved', data: { doc: r.path, by: 'owner' } });
  invalidate();
  return { ok: true, ...r, ...sourceDocs(floorId) };
}
// "Request changes": the owner's notes go to the Blueprint lead as its next task
export async function requestDocChanges(floorId, rel, text) {
  const { entry, cfg, bp } = floorBp(floorId);
  blueprintsLib.sourceDocPath(entry.path, bp, rel);
  if (!String(text || '').trim()) throw bad('Write what should change');
  const lead = cfg.team.agents.find((x) => x.lead) || cfg.team.agents.find((x) => sprint.roleKind(x) === 'lead');
  if (!lead) throw bad('This Floor has no lead to send the changes to');
  const r = await sendTask(floorId, lead.id, `The owner requests changes to the source document ${rel} (keep it STATUS: DRAFT until the owner approves it): ${String(text).trim()}`);
  return { ...r, lead: lead.id };
}

// a newer Blueprint version (e.g. lessons applied from an audit) replaces the Floor's snapshot; pack files stay as they are
export function updateFloorBlueprint(floorId) {
  const entry = building.floorEntry(floorId);
  const ref = floors.readFloor(entry.path).floor.blueprint;
  if (!ref) throw bad('This Floor has no Blueprint');
  const bp = blueprintsLib.getBlueprint(ref.id);
  writeText(blueprintsLib.snapshotPath(entry.path), blueprintsLib.blueprintText(ref.id));
  floors.updateFloorConfig(entry.path, { blueprint: { id: ref.id, version: bp.version } });
  invalidate();
  return { ok: true, version: bp.version };
}
