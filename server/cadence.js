// SPDX-License-Identifier: Apache-2.0
// Cadence (1.5): routine work per Space, so a division works without someone giving it a task each time.
//   <repo>/.claude/aisquad/cadence.json      the routines (committed; a change is recorded in Admin → Changes)
//   ~/.aisquad/cadence/<floor>.json           when each routine last ran, what waits, what runs (this machine)
// A routine: id, title, agent (a role id such as marketing-strategist, or an agent id), every (daily, weekdays,
// weekly:<mon..sun>, monthly:<1..31>, the 31st meaning the last day of a short month), at (HH:MM, local time),
// task (the prompt), budget (max $ per run, optional), enabled. At most 20 per Space.
// A run is automated work: it goes through the dispatcher (via 'cadence'), so the Space's shift, the quota guard,
// the free memory and the Space's budget decide when it starts. A run that cannot start within its window is
// skipped with a reason, never stacked: one pending run per routine, and no catch-up after downtime.
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson, kebab, bad, notFound, oneLine } from './util.js';

export const MAX = 20;
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const WINDOW_MS = 2 * 3600e3;          // a slot may start up to 2 hours late (less when the next slot is sooner)
export const MAX_BUDGET = 50;
const KEEP = 30;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const defFile = (root) => path.join(root, '.claude', 'aisquad', 'cadence.json');
const runFile = (floorId) => path.join(config.home, 'cadence', `${floorId}.json`);

// ---------- definitions ----------
// 'daily' | 'weekdays' | 'weekly:mon' | 'monthly:15' -> { kind, day } (null when it is not one of these)
export function parseEvery(every) {
  const s = String(every || '').trim().toLowerCase();
  if (s === 'daily' || s === 'weekdays') return { kind: s };
  const w = s.match(/^weekly:(\w{3})$/);
  if (w && DAYS.includes(w[1])) return { kind: 'weekly', day: DAYS.indexOf(w[1]) };
  const m = s.match(/^monthly:(\d{1,2})$/);
  if (m && +m[1] >= 1 && +m[1] <= 31) return { kind: 'monthly', day: +m[1] };
  return null;
}
export function cleanRoutine(r = {}, existing = null) {
  const title = oneLine(r.title ?? existing?.title ?? '', 80);
  if (!title) throw bad('The routine needs a title');
  const id = existing?.id || kebab(r.id || title, 40);
  if (!id) throw bad('The routine needs an id');
  const agent = kebab(r.agent ?? existing?.agent ?? '', 60);
  if (!agent) throw bad('The routine needs an agent (a role such as marketing-strategist, or an agent id)');
  const every = String(r.every ?? existing?.every ?? 'daily').trim().toLowerCase();
  if (!parseEvery(every)) throw bad('Every: daily, weekdays, weekly:<mon..sun> or monthly:<1..31>');
  const at = String(r.at ?? existing?.at ?? '09:00');
  if (!TIME.test(at)) throw bad('At: a time such as 09:00');
  const task = String(r.task ?? existing?.task ?? '').trim().slice(0, 4000);
  if (!task) throw bad('The routine needs a task');
  const b = r.budget === undefined ? existing?.budget ?? null : r.budget === null || r.budget === '' ? null : Number(r.budget);
  if (b !== null && !(Number.isFinite(b) && b > 0 && b <= MAX_BUDGET)) throw bad(`Budget: dollars per run, more than 0 and at most ${MAX_BUDGET}`);
  return { id, title, agent, every, at, task, budget: b, enabled: r.enabled === undefined ? existing?.enabled === true : r.enabled === true };
}
const rawDefs = (root) => { const j = readJson(defFile(root), null); return Array.isArray(j?.routines) ? j.routines.filter((r) => r && typeof r === 'object') : []; };
const valid = (r) => { try { return cleanRoutine(r); } catch { return null; } };
export const readDefs = (root) => rawDefs(root).map(valid).filter(Boolean);
// entries that are not valid routines (hand edits) are kept, never silently dropped
const writeDefs = (root, list) => writeJson(defFile(root), { routines: [...list, ...rawDefs(root).filter((r) => !valid(r))] });
export function add(root, input) {
  const list = readDefs(root);
  const r = cleanRoutine(input);
  if (list.some((x) => x.id === r.id)) throw bad(`There is already a routine "${r.id}"`);
  if (list.length >= MAX) throw bad(`At most ${MAX} routines per Space`);
  writeDefs(root, [...list, r]);
  return r;
}
export function update(root, id, patch) {
  const list = readDefs(root);
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw notFound('Routine not found');
  list[i] = cleanRoutine(patch, list[i]);
  writeDefs(root, list);
  return list[i];
}
export function remove(root, id) {
  const list = readDefs(root);
  if (!list.some((x) => x.id === id)) throw notFound('Routine not found');
  writeDefs(root, list.filter((x) => x.id !== id));
  return { ok: true };
}
// a Blueprint's routines (disabled until the Owner turns them on); existing ids are kept
export function seed(root, list = [], { enabled = false } = {}) {
  if (!list.length) return [];
  const have = readDefs(root), ids = new Set(have.map((r) => r.id)), out = [];
  for (const r of list) {
    if (have.length + out.length >= MAX) break;
    try { const c = cleanRoutine({ ...r, enabled }); if (!ids.has(c.id)) { out.push(c); ids.add(c.id); } } catch { /* a bad seed is skipped */ }
  }
  if (out.length) writeDefs(root, [...have, ...out]);
  return out;
}
// "Turn on routines" after a build: every routine of the Space on
export function enableAll(root, on = true) {
  const list = readDefs(root).map((r) => ({ ...r, enabled: !!on }));
  writeDefs(root, list);
  return list;
}

// ---------- schedule (local time: the clock on the wall, whatever the UTC offset) ----------
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
export function occursOn(every, d) {
  const e = typeof every === 'string' ? parseEvery(every) : every;
  if (!e) return false;
  if (e.kind === 'daily') return true;
  if (e.kind === 'weekdays') return d.getDay() >= 1 && d.getDay() <= 5;
  if (e.kind === 'weekly') return d.getDay() === e.day;
  return d.getDate() === Math.min(e.day, lastDay(d.getFullYear(), d.getMonth()));
}
const slotOn = (y, m, day, at) => { const [h, mi] = at.split(':').map(Number); return new Date(y, m, day, h, mi, 0, 0); };
// the latest time the routine was due at or before now (null when none in the last two months)
export function lastSlot(r, now = Date.now()) {
  const e = parseEvery(r.every), d = new Date(now);
  for (let i = 0; i <= 62; i++) {
    const s = slotOn(d.getFullYear(), d.getMonth(), d.getDate() - i, r.at);
    if (s.getTime() <= now && occursOn(e, s)) return s.getTime();
  }
  return null;
}
// the next time it is due, after now
export function nextSlot(r, now = Date.now()) {
  const e = parseEvery(r.every), d = new Date(now);
  for (let i = 0; i <= 62; i++) {
    const s = slotOn(d.getFullYear(), d.getMonth(), d.getDate() + i, r.at);
    if (s.getTime() > now && occursOn(e, s)) return s.getTime();
  }
  return null;
}
// how late a slot may still start: 2 hours, or less when the next slot comes sooner
export const windowOf = (r, slot) => Math.min(WINDOW_MS, (nextSlot(r, slot) ?? Infinity) - slot);

// ---------- what happens now (pure) ----------
// run: this routine's state on this machine ({ lastSlot, since, pending, running }).
// -> { action: 'off' | 'wait' | 'run' | 'skip', slot?, reason? }
export function decide(r, run = {}, now = Date.now()) {
  if (!r.enabled) return { action: 'off' };
  const slot = lastSlot(r, now);
  if (slot == null || slot <= (run.lastSlot || 0) || slot < (run.since || 0)) return { action: 'wait' };
  if (now - slot > windowOf(r, slot)) return { action: 'skip', slot, reason: 'missed its window: the server was not running' };
  if (run.running) return { action: 'skip', slot, reason: 'the previous run is still running' };
  if (run.pending) return { action: 'skip', slot, reason: 'the previous run is still waiting to start' };
  return { action: 'run', slot };
}
// a queued run whose window passed: it goes, with the reason it waited
export const expired = (run = {}, now = Date.now()) => !!run.pending && now > run.pending.until;

// ---------- run state (this machine) ----------
export function loadRuns(floorId) { const j = readJson(runFile(floorId), null); return j && typeof j.routines === 'object' && j.routines ? j : { routines: {} }; }
export const saveRuns = (floorId, s) => writeJson(runFile(floorId), s, 0o600);
export function runOf(floorId, id) { return loadRuns(floorId).routines[id] || {}; }
export function setRun(floorId, id, fn) {
  const s = loadRuns(floorId);
  const cur = s.routines[id] || {};
  const next = fn(cur) || cur;
  s.routines[id] = { ...next, history: (next.history || []).slice(-KEEP) };
  saveRuns(floorId, s);
  return s.routines[id];
}
// a routine is switched on: slots before this moment never count (no catch-up storm)
export const markEnabled = (floorId, id, now = Date.now()) => setRun(floorId, id, (cur) => ({ ...cur, since: now }));
// a run's end (from the job): { status, cost, ms, job }
export function finish(floorId, id, end, now = Date.now()) {
  return setRun(floorId, id, (cur) => {
    const last = { slot: cur.running?.slot || null, ts: now, status: end.status, job: end.job || cur.running?.job || '', cost: end.cost || 0, ms: end.ms || 0, ...(end.manual ?? cur.running?.manual ? { manual: true } : {}) };
    return { ...cur, running: null, last, history: [...(cur.history || []), last] };
  });
}
export function skipped(floorId, id, slot, reason, now = Date.now()) {
  return setRun(floorId, id, (cur) => {
    const last = { slot, ts: now, status: 'skipped', reason };
    return { ...cur, lastSlot: Math.max(cur.lastSlot || 0, slot || 0), pending: null, last, history: [...(cur.history || []), last] };
  });
}

// ---------- what people see ----------
// every routine with its last run, next run, and what it waits for
export function list(floorId, root, now = Date.now()) {
  const runs = loadRuns(floorId).routines;
  return readDefs(root).map((r) => {
    const run = runs[r.id] || {};
    return { ...r, next: r.enabled ? nextSlot(r, now) : null, last: run.last || null, pending: run.pending || null, running: run.running || null, history: (run.history || []).slice(-10) };
  });
}
// the next routine of one agent (the Desk), from a list() and the agent's id and role
export function nextFor(items, agent) {
  const mine = items.filter((r) => r.enabled && r.next && (r.agent === agent.id || r.agent === agent.role));
  return mine.sort((a, b) => a.next - b.next)[0] || null;
}
const EVERY_TEXT = { daily: 'every day', weekdays: 'every weekday' };
export function everyText(every) {
  const e = parseEvery(every);
  if (!e) return every;
  if (EVERY_TEXT[e.kind]) return EVERY_TEXT[e.kind];
  if (e.kind === 'weekly') return `every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][e.day]}`;
  return e.day >= 29 ? `monthly on day ${e.day} (or the month's last day)` : `monthly on day ${e.day}`;
}
