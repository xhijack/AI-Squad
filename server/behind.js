// SPDX-License-Identifier: Apache-2.0
// Targets that act (1.5): a target behind its goal raises work, by the rule the Owner sets on it (kpi.json, onBehind):
//   notify   one notice ("Leads this week: 4 of 12, behind"), muted under Notices like a stall card
//   suggest  the rule's agent drafts a short recovery plan (read-only run); the owner approves it (it starts as a
//            task) or dismisses it (the target is quiet for the rest of the period)
//   act      the task starts at once as automated work, when the Space allows automatic actions and its budget is
//            not reached; otherwise it falls back to suggest
// It fires after a measurement that leaves the target behind, at most once per period and once per cooldown; never
// for a target without a goal or with a stale value. The state lives on this machine: ~/.aisquad/kpi/<floor>.triggers.json
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, writeJson } from './util.js';
import { periodStart } from './kpi.js';

export const MODES = ['off', 'notify', 'suggest', 'act'];
export const OPEN = new Set(['notice', 'drafting', 'suggested', 'acting']);
const KEEP = 100;
const file = (floorId) => path.join(config.home, 'kpi', `${floorId}.triggers.json`);

// ---------- state ----------
export function load(floorId) { const j = readJson(file(floorId), null); return { targets: j?.targets && typeof j.targets === 'object' ? j.targets : {}, history: Array.isArray(j?.history) ? j.history : [] }; }
const save = (floorId, s) => writeJson(file(floorId), { targets: s.targets, history: s.history.slice(-KEEP) }, 0o600);
export const stateOf = (floorId, kpiId) => load(floorId).targets[kpiId] || null;
// change one target's trigger; a history line when given
export function set(floorId, kpiId, fn, line = null, now = Date.now()) {
  const s = load(floorId);
  s.targets[kpiId] = fn(s.targets[kpiId] || null);
  if (line) s.history.push({ ts: now, kpi: kpiId, ...line });
  save(floorId, s);
  return s.targets[kpiId];
}
export const history = (floorId, n = 30) => load(floorId).history.slice(-n).reverse();
// what is open across the Space: for the cockpit ("2 behind · 1 acting")
export const counts = (floorId) => { const t = Object.values(load(floorId).targets); return { acting: t.filter((x) => x?.status === 'acting').length, waiting: t.filter((x) => x?.status === 'suggested').length }; };

// ---------- when it fires (pure) ----------
// k: the target (kpi.cleanKpi), item: its entry from kpi.list (status, stale), trig: its trigger state
// -> { fire: true, period } or { fire: false, why }
export function shouldFire(k, item, trig, now = Date.now()) {
  const rule = k.onBehind || { mode: 'off' };
  if (rule.mode === 'off') return { fire: false, why: 'off' };
  if (k.target === null || k.target === undefined) return { fire: false, why: 'no goal' };
  if (item.stale || item.status?.state === 'unknown') return { fire: false, why: 'stale' };
  if (item.status?.state !== 'behind') return { fire: false, why: 'not behind' };
  const period = periodStart(k.period, now);
  if (trig && OPEN.has(trig.status)) return { fire: false, why: 'already open' };
  if (trig && trig.period === period) return { fire: false, why: trig.status === 'dismissed' ? 'dismissed for this period' : 'once per period' };
  if (trig && now - trig.firedAt < (rule.cooldown || 24) * 3600e3) return { fire: false, why: 'cooldown' };
  return { fire: true, period };
}
// act needs a Space that may act by itself and money left; else the owner decides (suggest)
export function modeFor(rule, { canAct = false, budgetOver = false } = {}) {
  if (rule.mode !== 'act') return { mode: rule.mode };
  if (!canAct) return { mode: 'suggest', fallback: 'the Space does not act by itself (Autopilot is not full)' };
  if (budgetOver) return { mode: 'suggest', fallback: 'the Space reached its budget' };
  return { mode: 'act' };
}
// a stable id per target and period: the same notice is never sent twice (1.0.3)
// (hashed like every Attention id, so it travels in /api/attention/<id>/answer)
const hash = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
export const noticeId = (floorId, kpiId, period) => hash('target', floorId, kpiId, period);
export const planId = (floorId, kpiId, period) => hash('target-plan', floorId, kpiId, period);

// ---------- the words ----------
const PERIOD_TEXT = { day: 'today', week: 'this week', month: 'this month', total: 'in total' };
const fmt = (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const unit = (k) => (k.unit ? ` ${k.unit}` : '');
export function noticeText(k, item) {
  const v = item.latest?.value;
  return k.direction === 'down'
    ? `${k.name} ${PERIOD_TEXT[k.period]}: ${fmt(v)}${unit(k)}, at most ${fmt(k.target)}, behind`
    : `${k.name} ${PERIOD_TEXT[k.period]}: ${fmt(v)} of ${fmt(k.target)}${unit(k)}, behind`;
}
// the last measurements, oldest first ("2 → 3 → 4")
export function trend(item, n = 5) {
  const s = (item.series || []).filter((p) => p.ts >= (item.switchedAt || 0)).slice(-n);   // since the source last changed (1.7)
  if (s.length < 2) return 'not enough measurements yet for a trend';
  return `${s.map((p) => fmt(p.value)).join(' → ')} (last ${s.length} measurements, ${new Date(s[0].ts).toISOString().slice(0, 10)} to ${new Date(s.at(-1).ts).toISOString().slice(0, 10)})`;
}
const facts = (k, item, spaceName) => [
  `Target behind in ${spaceName}: ${k.name}.`,
  `- Now: ${fmt(item.latest?.value)}${unit(k)} ${PERIOD_TEXT[k.period]} (measured ${item.latest ? new Date(item.latest.ts).toISOString().slice(0, 16).replace('T', ' ') : 'never'} UTC, source ${k.source.kind}).`,
  `- Goal: ${k.direction === 'down' ? 'at most' : 'at least'} ${fmt(k.target)}${unit(k)} ${PERIOD_TEXT[k.period]}. Status: behind${item.status?.pct != null ? ` (${item.status.pct} %)` : ''}.`,
  `- Trend: ${trend(item)}.`,
  '- Every target and its value is in docs/squad/KPI.md. Plan against these numbers; never invent a value.',
];
const DEFAULT_TASK = 'Do the work that brings this target back on track within this period, in the Space\'s usual way.';
// suggest: a short plan from a read-only run
export function planPrompt(k, item, rule, spaceName) {
  return [...facts(k, item, spaceName), '',
    `What the owner wants when it is behind: ${rule.task || DEFAULT_TASK}`, '',
    'Draft a short recovery plan for the owner: at most 8 lines, concrete steps with who does what by when, and the number each step should move. Read what you need; change no file and send nothing. The owner approves or dismisses the plan.'].join('\n');
}
// suggest (approved) and act: the task itself
export function taskText(k, item, rule, spaceName, plan = '') {
  return [...facts(k, item, spaceName), '',
    `Task: ${rule.task || DEFAULT_TASK}`,
    ...(plan ? ['', 'The owner approved this plan:', String(plan).trim().slice(0, 3000)] : []), '',
    'Publish, send or spend nothing without the owner\'s approval. End with what you did and the number you expect it to move.'].join('\n');
}
