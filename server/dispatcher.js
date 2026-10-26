// SPDX-License-Identifier: Apache-2.0
// The dispatcher (0.13): one queue for every agent start on this machine, so the squad never runs more sessions than
// the machine (and the Claude plan) can carry. Every start path goes through it: the Desk, Autopilot, auto-resume,
// the lead's next sprint, background jobs. What it decides:
//   slots    min(Building maximum, what free RAM allows (keeping 2 GB free, measured RAM per session),
//            no new session while the CPU load is above 90 %, nothing automated while the quota guard pauses)
//   order    P0 the owner's own work, P1 a waiting squad (resume, next sprint), P2 normal work, P3 background;
//            every 30 minutes waiting moves an item up one level (never to P0)
//   reserve  in the daytime one slot stays free for the owner (P0)
//   shift    automated work for a Space waits outside its shift; the owner's own work does not
// The queue is kept in ~/.aisquad/queue.json, so it survives a restart. Idle agents are stopped to free their slot.
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson, bad, notFound } from './util.js';
import * as space from './space.js';
import * as quota from './quota.js';

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const ACTIONS = ['start', 'resume', 'job', 'sprint'];
export const AGING_MS = 30 * 60e3;
export const RAM_RESERVE = 2 * 2 ** 30;
export const MAX_ATTEMPTS = 3;
export const DEFAULTS = { reserveP0: 1, day: { from: '08:00', to: '18:00' }, idleStopMin: 30, idleStopBusyMin: 10, quota: quota.DEFAULTS };
const file = () => path.join(config.home, 'queue.json');
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanDispatcher(d = {}) {
  const int = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  return {
    reserveP0: int(d?.reserveP0, 0, 4, DEFAULTS.reserveP0),
    day: { from: TIME.test(String(d?.day?.from)) ? d.day.from : DEFAULTS.day.from, to: TIME.test(String(d?.day?.to)) ? d.day.to : DEFAULTS.day.to },
    idleStopMin: int(d?.idleStopMin, 0, 24 * 60, DEFAULTS.idleStopMin),
    idleStopBusyMin: int(d?.idleStopBusyMin, 0, 24 * 60, DEFAULTS.idleStopBusyMin),
    quota: quota.cleanQuota(d?.quota),
  };
}
export const isDaytime = (d, now = Date.now()) => space.inShift({ enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: d.day.from, to: d.day.to }, now);

// how many sessions may run now. -> { cap, free, running, limiting, limits: [{ key, cap, text }] }
export function capacity({ maxAgents = 6, running = 0, res = null, sessionRss = 1.5 * 2 ** 30, quotaPaused = false } = {}) {
  const limits = [{ key: 'building', cap: maxAgents, text: `Building maximum of ${maxAgents} agents at once` }];
  if (res?.mem?.available != null && sessionRss > 0) {
    const more = Math.max(0, Math.floor((res.mem.available - RAM_RESERVE) / sessionRss));
    limits.push({ key: 'ram', cap: running + more, text: `${(res.mem.available / 2 ** 30).toFixed(1)} GB RAM free, about ${(sessionRss / 2 ** 30).toFixed(1)} GB per session, 2 GB kept free` });
  }
  if (res?.cpus && res?.load?.[0] != null && res.load[0] >= res.cpus * 0.9) limits.push({ key: 'cpu', cap: running, text: `CPU load ${res.load[0]} on ${res.cpus} cores` });
  const cap = Math.min(...limits.map((l) => l.cap));
  const limiting = limits.find((l) => l.cap === cap);
  return { cap, free: Math.max(0, cap - running), running, limiting: limiting.key, limits, quotaPaused };
}

// priority after waiting: one level up per 30 minutes, never above P1 for automated work
export function effectivePriority(item, now = Date.now()) {
  const base = PRIORITIES.indexOf(item.priority);
  if (base <= 0) return 0;
  return Math.max(1, base - Math.floor((now - item.createdAt) / AGING_MS));
}

export function load() { const q = readJson(file(), null); return Array.isArray(q?.items) ? q.items : []; }
export const save = (items) => writeJson(file(), { items });

// an item: { floorId, agentId, action, task, opts, priority, via, title }. The same agent and action with the same
// task is queued once (the higher priority wins).
export function enqueue(item, now = Date.now()) {
  if (!ACTIONS.includes(item.action)) throw bad(`Unknown action: ${item.action}`);
  if (!PRIORITIES.includes(item.priority)) throw bad(`Unknown priority: ${item.priority}`);
  const items = load();
  const same = items.find((x) => x.floorId === item.floorId && x.agentId === item.agentId && x.action === item.action && (x.task || '') === (item.task || ''));
  if (same) {
    if (PRIORITIES.indexOf(item.priority) < PRIORITIES.indexOf(same.priority)) { same.priority = item.priority; save(items); }
    return { ...same, position: position(items, same.id, now) };
  }
  const it = { id: `q-${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`, floorId: item.floorId, agentId: item.agentId, action: item.action,
    task: String(item.task || '').slice(0, 20000), opts: item.opts || {}, priority: item.priority, via: item.via || 'aisquad', title: String(item.title || item.task || '').slice(0, 160),
    createdAt: now, attempts: 0, lastError: '' };
  items.push(it);
  save(items);
  return { ...it, position: position(items, it.id, now) };
}
export const order = (items, now = Date.now()) => [...items].sort((a, b) => effectivePriority(a, now) - effectivePriority(b, now) || a.createdAt - b.createdAt);
const position = (items, id, now) => order(items, now).findIndex((x) => x.id === id) + 1;
export function remove(id) {
  const items = load();
  const it = items.find((x) => x.id === id);
  if (!it) throw notFound('Queue item not found');
  save(items.filter((x) => x.id !== id));
  return it;
}
export function setPriority(id, priority) {
  if (!PRIORITIES.includes(priority)) throw bad(`Unknown priority: ${priority}`);
  const items = load();
  const it = items.find((x) => x.id === id);
  if (!it) throw notFound('Queue item not found');
  it.priority = priority; it.createdAt = Date.now();        // a new priority starts its aging again
  save(items);
  return it;
}

// which items start now and why the others wait. ctx: { free, reserve, quotaPaused, inShift(floorId),
// floorFree(floorId) (slots left under the Space's own maximum), busy(item) }. Automated work is everything the
// owner did not start (via != 'owner'): it waits outside the Space's shift.
export function plan(items, { free = 0, reserve = 0, quotaPaused = false, inShift = () => true, floorFree = () => Infinity, busy = () => false } = {}, now = Date.now()) {
  const start = [], held = [];
  const chosen = new Set(), perFloor = new Map();
  for (const it of order(items, now)) {
    const p = effectivePriority(it, now);
    const key = `${it.floorId}/${it.agentId}`;
    let reason = '';
    if (it.via !== 'owner' && !inShift(it.floorId)) reason = 'outside the Space\'s shift';
    else if (p > 0 && quotaPaused) reason = 'the quota guard pauses automated work';
    else if (chosen.has(key) || busy(it)) reason = 'the agent is busy';
    else if ((perFloor.get(it.floorId) || 0) >= floorFree(it.floorId)) reason = 'the Space runs its maximum of agents at once';
    else if (start.length >= free - (p > 0 ? reserve : 0)) reason = p > 0 && start.length < free ? 'the last free slot is kept for the owner' : 'waiting for a free slot';
    if (reason) { held.push({ id: it.id, reason, priority: PRIORITIES[p] }); continue; }
    chosen.add(key);
    perFloor.set(it.floorId, (perFloor.get(it.floorId) || 0) + 1);
    start.push(it);
  }
  return { start, held };
}

// one round: plan, then run each chosen item with exec(item) (async). A failed item is tried again on the next
// rounds, at most MAX_ATTEMPTS times. -> { started: [item], failed: [{ item, error, dropped }], held }
export async function tick(ctx, exec, now = Date.now()) {
  const items = load();
  const { start, held } = plan(items, ctx, now);
  const started = [], failed = [];
  for (const it of start) {
    try { await exec(it); started.push(it); }
    catch (e) { it.attempts = (it.attempts || 0) + 1; it.lastError = e.message; failed.push({ item: it, error: e.message, dropped: it.attempts >= MAX_ATTEMPTS }); }
  }
  const gone = new Set([...started.map((x) => x.id), ...failed.filter((f) => f.dropped).map((f) => f.item.id)]);
  const cur = load();           // exec may have queued more
  save(cur.filter((x) => !gone.has(x.id)).map((x) => start.find((s) => s.id === x.id) || x));
  return { started, failed, held };
}

// agents to stop because they sit idle: running their own session, idle (not working, not waiting for anyone:
// no open question, report, command or dialog), past the idle time, and not a lead with teammates in its session.
// agents: [{ floorId, id, own, running, state, waitingReply, task, lastTs, lead, teammatesInLead, attention }]
export function idleToStop(agents, { idleMs, now = Date.now() } = {}) {
  if (!idleMs) return [];
  return agents.filter((a) => a.own && a.running && a.state === 'idle' && !a.waitingReply && !a.task && !a.attention && !a.pending
    && !(a.lead && a.teammatesInLead) && a.lastTs && now - a.lastTs >= idleMs);
}
