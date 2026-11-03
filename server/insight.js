// SPDX-License-Identifier: Apache-2.0
// Daily Insight, trust level 0 (0.15): every night The AI Squad reads its own week (Squad Log, dispatcher, crashes)
// and writes suggestions to the Improvement Inbox (Admin → Improvements). It never changes anything by itself:
// the Owner accepts or dismisses each one, and an accepted change goes through the same files and change history
// as any other edit. No model is called: every pattern below is a plain count over the log.
//   failing tool     the same command failed 5+ times for an agent           → a rule for that agent
//   costly model     an opus agent that is not a lead, 40+ turns, little out  → sonnet for it
//   slow answers     the owner's answers take 30+ minutes (median, 3+)       → advice: notifications, Autopilot
//   idle with work   10+ idle-with-open-work events on a Space, Autopilot off → Autopilot balanced there
//   out of memory    2+ out-of-memory crashes                                → one agent less at once
//   queue waits      p95 wait 2+ hours (5+ starts)                           → capacity advice: another worker when RAM or
//                    CPU is the limit (0.21: machines can be added), one agent more when the Building limit is
//   repeated asks    the same chat question 3+ times                         → a skill candidate
// Targets (1.13, analyzeTargets): read from the targets' own values, closed periods only
//   behind again     behind in the last 2 closed periods (3 days for a daily target), nothing raised → plans to approve
//                    (the lead drafts a plan when it is behind); already raising plans → advice to look at the goal
//   met easily       met by 50 %+ in the last 2 closed periods                 → a goal near what is reached now
//   measure failing  the server could not measure it 3+ times this week       → advice: fix the source
//   not entered      a hand-entered target without a value for 2 closed periods → advice: enter it, or measure it
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { readJson, writeJson, bad, notFound } from './util.js';

export const DEFAULTS = { enabled: true, at: '02:30' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const cleanInsight = (i = {}) => ({ enabled: i?.enabled !== false, at: TIME.test(String(i?.at)) ? i.at : DEFAULTS.at });
const dir = () => path.join(config.home, 'insights');
const inboxFile = () => path.join(dir(), 'inbox.json');
const WEEK = 7 * 864e5, DISMISS_QUIET_MS = 14 * 864e5;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : 0; };
const ids = (evs) => evs.slice(-5).map((e) => e.id);
export const words = (t, n) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, n).join(' ');

// spaces: [{ id, name, autopilot, agents: [{ id, name, model, lead }] }], events: { floorId: [log events of the week] },
// prefs: { maxAgents }, limiting: what limits the dispatcher now -> suggestions (not yet in the inbox)
export function analyze({ spaces = [], events = {}, prefs = {}, limiting = '', workers = { count: 0, free: 0 } } = {}) {
  const out = [];
  const allEv = (type) => spaces.flatMap((s) => (events[s.id] || []).filter((e) => e.type === type).map((e) => ({ ...e, floorId: s.id })));
  for (const s of spaces) {
    const evs = events[s.id] || [];
    // failing tool
    const fails = new Map();
    for (const e of evs.filter((x) => x.type === 'tool.call' && x.data?.ok === false && x.agent)) {
      const key = `${e.agent}|${e.data.tool}|${words(e.data.target, 3)}`;
      fails.set(key, [...(fails.get(key) || []), e]);
    }
    for (const [key, list] of fails) {
      if (list.length < 5) continue;
      const [agentId, tool, target] = key.split('|');
      const rule = `${tool} \`${target}\` failed ${list.length} times this week: read the error and fix its cause before running it again; ask the lead if it keeps failing.`;
      out.push({ key: `tool:${s.id}:${key}`, category: 'agent-rule', title: `${tool} "${target}" failed ${list.length} times for ${agentId} (${s.name})`,
        evidence: [{ floorId: s.id, ids: ids(list), summary: list.at(-1).data.error ? `last error: ${String(list.at(-1).data.error).slice(0, 160)}` : '' }],
        impact: 'Fewer repeated failing runs (time and tokens).', risk: 'Low: one more rule in the agent file.',
        change: { kind: 'agent-rule', floorId: s.id, agentId, rule }, verify: `Failures of ${tool} "${target}" for ${agentId} over the next 7 days`, metric: { name: 'failures/week', before: list.length } });
    }
    // costly model
    for (const a of s.agents.filter((x) => /opus/.test(x.model || '') && !x.lead)) {
      const turns = evs.filter((e) => e.type === 'usage.turn' && e.agent === a.id);
      if (turns.length < 40) continue;
      const out_ = median(turns.map((e) => e.data?.output || 0)), cost = turns.reduce((n, e) => n + (+e.data?.cost || 0), 0);
      if (out_ > 1500) continue;
      out.push({ key: `model:${s.id}:${a.id}`, category: 'model', title: `${a.name} runs on opus for short turns (${s.name})`,
        evidence: [{ floorId: s.id, ids: ids(turns), summary: `${turns.length} turns, median ${out_} output tokens, $${cost.toFixed(2)} this week` }],
        impact: 'Roughly a third of the cost for this agent.', risk: 'Medium: harder tasks may need opus again (rollback in Changes).',
        change: { kind: 'agent-model', floorId: s.id, agentId: a.id, model: 'sonnet' }, verify: `Cost per turn and failed tool calls of ${a.name} for 7 days`, metric: { name: 'cost/week', before: +cost.toFixed(2) } });
    }
    // idle with open work
    const idle = evs.filter((e) => e.type === 'agent.idle' && e.data?.openWork);
    if (idle.length >= 10 && (s.autopilot || 'off') === 'off') {
      out.push({ key: `idle:${s.id}`, category: 'autopilot', title: `Agents sat idle with open work ${idle.length} times (${s.name})`,
        evidence: [{ floorId: s.id, ids: ids(idle), summary: `${idle.length} idle-with-open-work events this week` }],
        impact: 'Work continues while you are away; critical questions still wait for you.', risk: 'Medium: non-critical questions get the recommended answer after the timeout.',
        change: { kind: 'floor', floorId: s.id, patch: { autopilot: 'balanced' } }, verify: 'Idle-with-open-work events for 7 days', metric: { name: 'idle events/week', before: idle.length } });
    }
  }
  // slow answers
  const answered = allEv('question.answered').filter((e) => e.data?.waitMs);
  if (answered.length >= 3 && median(answered.map((e) => e.data.waitMs)) >= 30 * 60e3) {
    const m = Math.round(median(answered.map((e) => e.data.waitMs)) / 60e3);
    out.push({ key: 'answers:slow', category: 'notifications', title: `Your answers take ${m} minutes (median of ${answered.length})`,
      evidence: [...new Set(answered.map((e) => e.floorId))].map((f) => ({ floorId: f, ids: ids(answered.filter((e) => e.floorId === f)), summary: '' })),
      impact: 'Agents wait less.', risk: 'None by itself: advice only.', change: null,
      verify: 'Median answer time for 7 days', metric: { name: 'median answer min', before: m },
      advice: 'Pair Telegram in Admin → Notifications so questions reach you with buttons, or set Autopilot to balanced on Spaces where most questions are routine.' });
  }
  // out of memory
  const oom = allEv('agent.crashed').filter((e) => e.data?.cause === 'oom');
  if (oom.length >= 2 && (prefs.maxAgents || 6) > 1) {
    const max = prefs.maxAgents || 6;
    out.push({ key: 'oom', category: 'capacity', title: `${oom.length} agents were killed for lack of memory this week`,
      evidence: [...new Set(oom.map((e) => e.floorId))].map((f) => ({ floorId: f, ids: ids(oom.filter((e) => e.floorId === f)), summary: '' })),
      impact: 'No more out-of-memory kills.', risk: 'Low: work waits a little longer in the queue.',
      advice: `If the queue then waits too long, add a machine instead of upgrading this one: Admin → Machines → Add a machine (a worker runs background jobs with its own memory)${workers.count ? `; ${workers.count} worker${workers.count > 1 ? 's are' : ' is'} connected now` : ''}.`,
      change: { kind: 'prefs', patch: { maxAgents: max - 1 } }, verify: 'Out-of-memory crashes for 7 days', metric: { name: 'oom/week', before: oom.length } });
  }
  // queue waits
  const waits = allEv('dispatch.started').map((e) => e.data?.waitedMs || 0);
  if (waits.length >= 5 && p95(waits) >= 2 * 3600e3) {
    const h = (p95(waits) / 3600e3).toFixed(1);
    out.push({ key: 'queue:wait', category: 'capacity', title: `Queued work waits ${h} hours (p95 of ${waits.length})`,
      evidence: [{ floorId: '', ids: [], summary: `limited by ${limiting || 'the slots'} now` }],
      impact: 'Faster starts.', risk: limiting === 'building' ? 'Medium: one more agent at once uses more RAM.' : 'None by itself: advice only.',
      change: limiting === 'building' ? { kind: 'prefs', patch: { maxAgents: (prefs.maxAgents || 6) + 1 } } : null,
      advice: ['ram', 'cpu'].includes(limiting)
        ? `${limiting === 'ram' ? 'Memory' : 'The CPU'} is the limit: add a machine rather than upgrading this one (Admin → Machines → Add a machine; background jobs then run there).${workers.count ? ` The ${workers.count} connected worker${workers.count > 1 ? 's have' : ' has'} ${workers.free} free slot${workers.free === 1 ? '' : 's'} now${workers.free ? '' : ': add another one'}.` : ''}`
        : '',
      verify: 'p95 queue wait for 7 days', metric: { name: 'p95 wait h', before: +h } });
  }
  // repeated asks
  const asks = new Map();
  for (const e of allEv('chat.message')) { const k = words(e.data?.text, 6); if (k.split(' ').length >= 3) asks.set(k, [...(asks.get(k) || []), e]); }
  for (const [k, list] of asks) {
    if (list.length < 3) continue;
    out.push({ key: `ask:${crypto.createHash('sha1').update(k).digest('hex').slice(0, 10)}`, category: 'skill', title: `The same question was asked ${list.length} times: "${k}…"`,
      evidence: [...new Set(list.map((e) => e.floorId))].map((f) => ({ floorId: f, ids: ids(list.filter((e) => e.floorId === f)), summary: '' })),
      impact: 'An answer written once instead of each time.', risk: 'None by itself: advice only.', change: null,
      advice: 'Write the answer as a skill or a Company Brain page (sop/ or products/), so every agent reads it.', verify: 'Repeats of this question for 7 days', metric: { name: 'asks/week', before: list.length } });
  }
  return out;
}

// ---------- the inbox ----------
export const loadInbox = () => { const j = readJson(inboxFile(), null); return { items: [], lastRun: 0, ...(j || {}) }; };
const saveInbox = (x) => writeJson(inboxFile(), x);
// adds what is new
export function addSuggestions(list, now = Date.now()) {
  const inbox = loadInbox();
  const added = [];
  for (const s of list) {
    const same = inbox.items.filter((x) => x.key === s.key);
    // open, dismissed in the last 14 days, or accepted in the last 7 (its verification week): not again
    if (same.some((x) => x.status === 'open' || (x.status === 'dismissed' && now - x.decidedAt < DISMISS_QUIET_MS) || (x.status === 'accepted' && now - x.decidedAt < WEEK))) continue;
    const it = { id: `i-${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`, status: 'open', createdAt: now, ...s };
    inbox.items.push(it); added.push(it);
  }
  inbox.items = inbox.items.slice(-300);
  inbox.lastRun = now;
  saveInbox(inbox);
  return added;
}
export function decide(id, status, { by = 'Owner', reason = '', result = null } = {}, now = Date.now()) {
  const inbox = loadInbox();
  const it = inbox.items.find((x) => x.id === id);
  if (!it) throw notFound('Suggestion not found');
  if (it.status !== 'open') throw bad('This suggestion was already decided');
  Object.assign(it, { status, decidedAt: now, by, ...(reason ? { reason: String(reason).slice(0, 300) } : {}), ...(result ? { result } : {}) });
  saveInbox(inbox);
  fs.mkdirSync(dir(), { recursive: true });
  fs.appendFileSync(path.join(dir(), 'decisions.jsonl'), `${JSON.stringify({ ts: now, id, key: it.key, category: it.category, status, by, metric: it.metric })}\n`);
  return it;
}
// a change of an item outside the open -> decided step (0.21: canaries and their follow-up), and its decision line
export function updateItem(id, patch, { log = '', by = '' } = {}, now = Date.now()) {
  const inbox = loadInbox();
  const it = inbox.items.find((x) => x.id === id);
  if (!it) throw notFound('Suggestion not found');
  Object.assign(it, typeof patch === 'function' ? patch(it) || {} : patch);
  saveInbox(inbox);
  if (log) { fs.mkdirSync(dir(), { recursive: true }); fs.appendFileSync(path.join(dir(), 'decisions.jsonl'), `${JSON.stringify({ ts: now, id, key: it.key, category: it.category, status: log, by, metric: it.metric, followUp: it.followUp })}\n`); }
  return it;
}
export const newSince = (since) => loadInbox().items.filter((x) => x.createdAt >= since && x.status === 'open').length;
export const writeReport = (day, report) => writeJson(path.join(dir(), `${day}.json`), report);
export const WINDOW_MS = WEEK;

// ---------- targets (1.13) ----------
// the last n closed periods of a target: [{ start, end, value }] newest first (value: the last one in the period, or null)
export function closedPeriods(points, period, n, now, periodStart) {
  const out = [];
  let end = periodStart(period, now);
  for (let i = 0; i < n; i++) {
    const start = periodStart(period, end - 1);
    const inIt = points.filter((p) => p.ts >= start && p.ts < end);
    out.push({ start, end, value: inIt.length ? inIt.at(-1).value : null });
    end = start;
  }
  return out;
}
// 2 significant digits, rounded the cautious way (down for a goal that goes up, up for one that goes down)
export const roundGoal = (v, dir) => { if (!(v > 0)) return v; const m = 10 ** (Math.floor(Math.log10(v)) - 1); return (dir === 'down' ? Math.ceil(v / m) : Math.floor(v / m)) * m; };
const behindOf = (k, v) => v != null && (k.direction === 'down' ? v > k.target : v < k.target);
// spaces: [{ id, name, targets: [{ id, name, unit, target, direction, period, onBehind: { mode }, source: { kind }, closed: [{ value }] }] }],
// events: { floorId: [kpi.failed events of the week] }
export function analyzeTargets({ spaces = [], events = {} } = {}) {
  const out = [];
  for (const s of spaces) {
    for (const k of s.targets || []) {
      const label = `${k.name} (${s.name})`, unit = k.unit ? ` ${k.unit}` : '';
      const per = { day: 'days', week: 'weeks', month: 'months' }[k.period];
      if (!per) continue;
      const need = k.period === 'day' ? 3 : 2, last = (k.closed || []).slice(0, need), vals = last.map((p) => p.value);
      // measure failing
      const fails = (events[s.id] || []).filter((e) => e.type === 'kpi.failed' && e.data?.kpi === k.id);
      if (fails.length >= 3) {
        out.push({ key: `kpi-failing:${s.id}:${k.id}`, category: 'target', title: `${label} could not be measured ${fails.length} times this week`,
          evidence: [{ floorId: s.id, ids: ids(fails), summary: `last error: ${String(fails.at(-1).data?.error || '').slice(0, 160)}` }],
          impact: 'The target shows a real number again, and what reacts to it works.', risk: 'None by itself: advice only.', change: null,
          advice: `Open Admin → Targets, try the source of "${k.name}" and fix it (a key, an integration that changed, a CSV path), or switch it to another source; its history stays.`,
          verify: `Measurement failures of ${k.name} for 7 days`, metric: { name: 'failures/week', before: fails.length } });
      }
      if (k.target == null) continue;
      // not entered
      if (['manual', 'webhook'].includes(k.source?.kind) && k.period !== 'day' && last.length === need && vals.every((v) => v == null)) {
        out.push({ key: `kpi-empty:${s.id}:${k.id}`, category: 'target', title: `${label} has no value for ${need} ${per}`,
          evidence: [{ floorId: s.id, ids: [], summary: `no value in the last ${need} closed ${per}` }],
          impact: 'The squad and you see whether the goal is reached.', risk: 'None by itself: advice only.', change: null,
          advice: `Enter it at the end of each ${k.period} (Admin → Targets, or tell the lead), or measure it from an integration or ERPNext so nobody has to.`,
          verify: `Values of ${k.name} for 2 ${per}`, metric: { name: 'values', before: 0 } });
        continue;
      }
      if (last.length < need || vals.some((v) => v == null)) continue;
      // behind again
      if (vals.every((v) => behindOf(k, v))) {
        const mode = k.onBehind?.mode || 'notify';
        const quiet = mode === 'off' || mode === 'notify';
        out.push({ key: `kpi-behind:${s.id}:${k.id}`, category: 'target', title: `${label} was behind its goal ${need} ${per} in a row (${vals.join(', ')}${unit} for ${k.target}${unit})`,
          evidence: [{ floorId: s.id, ids: [], summary: `last ${need} closed ${per}: ${vals.join(', ')}${unit}; goal ${k.target}${unit}` }],
          impact: quiet ? 'When it is behind, the lead drafts a plan for you to approve instead of only a notice.' : 'A goal and an approach that fit what the squad can reach.',
          risk: quiet ? 'Low: a plan is a draft; nothing is done before you approve it (costs a short run of the lead).' : 'None by itself: advice only.',
          change: quiet ? { kind: 'kpi', floorId: s.id, kpiId: k.id, patch: { onBehind: { ...(k.onBehind || {}), mode: 'suggest' } } } : null,
          ...(quiet ? {} : { advice: `It stays behind although plans are raised: look at the goal (is ${k.target}${unit} right for now?), the squad's approach, or what it is missing (materials, an integration, a person).` }),
          verify: `${k.name} at the end of the next ${k.period}`, metric: { name: k.name, before: vals[0] } });
        continue;
      }
      // met easily
      const easy = k.direction === 'down' ? vals.every((v) => v <= k.target * 0.67) : k.target > 0 && vals.every((v) => v >= k.target * 1.5);
      if (easy) {
        const goal = roundGoal(k.direction === 'down' ? Math.max(...vals) : Math.min(...vals), k.direction);
        if (goal === k.target || !(goal > 0)) continue;
        out.push({ key: `kpi-easy:${s.id}:${k.id}:${goal}`, category: 'target', title: `${label} beat its goal by far ${need} ${per} in a row (${vals.join(', ')}${unit} for ${k.target}${unit})`,
          evidence: [{ floorId: s.id, ids: [], summary: `last ${need} closed ${per}: ${vals.join(', ')}${unit}; goal ${k.target}${unit}` }],
          impact: `A goal near what is reached now (${goal}${unit}) keeps the squad pushing and the cockpit honest.`, risk: 'Low: only the goal changes; Admin → Changes undoes it.',
          change: { kind: 'kpi', floorId: s.id, kpiId: k.id, patch: { target: goal } },
          verify: `${k.name} against ${goal}${unit} at the end of the next ${k.period}`, metric: { name: k.name, before: vals[0] } });
      }
    }
  }
  return out;
}
