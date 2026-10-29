// SPDX-License-Identifier: Apache-2.0
// Watchdog: stalls (assigned work but idle >= 10 min), machine resources (RAM, swap, disk) and budgets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';

export const STALL_MS = 10 * 60 * 1000;
// stall cards are notices: a Notification or Telegram message only once the condition has lasted this long
export const NOTICE_NOTIFY_MS = 15 * 60 * 1000;
export const LIMITS = { freeRamBytes: 1.5 * 2 ** 30, swapPct: 85, freeDiskBytes: 5 * 2 ** 30 };

export function readResources(diskPath = os.homedir()) {
  const out = { ts: Date.now(), cpus: os.cpus().length, load: os.loadavg().map((x) => +x.toFixed(2)) };
  try {
    const m = {};
    for (const line of fs.readFileSync(path.join(config.procDir, 'meminfo'), 'utf8').split('\n')) { const x = line.match(/^(\w+):\s+(\d+)/); if (x) m[x[1]] = +x[2] * 1024; }
    out.mem = { total: m.MemTotal, available: m.MemAvailable };
    out.swap = { total: m.SwapTotal, used: m.SwapTotal - m.SwapFree };
  } catch {
    out.mem = { total: os.totalmem(), available: os.freemem() };
    out.swap = { total: 0, used: 0 };
  }
  try { const st = fs.statfsSync(diskPath); out.disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch { out.disk = null; }
  return out;
}

const gb = (b) => `${(b / 2 ** 30).toFixed(1)} GB`;

export function resourceWarnings(r, limits = LIMITS) {
  const w = [];
  if (r.mem && r.mem.available < limits.freeRamBytes) w.push({ key: 'ram', level: 'warn', text: `Free RAM is low: ${gb(r.mem.available)} available (warning below ${gb(limits.freeRamBytes)})` });
  if (r.swap && r.swap.total > 0) {
    const pct = r.swap.used / r.swap.total * 100;
    if (pct > limits.swapPct) w.push({ key: 'swap', level: 'warn', text: `Swap is ${pct.toFixed(0)} % full (warning above ${limits.swapPct} %)` });
  }
  if (r.disk && r.disk.free < limits.freeDiskBytes) w.push({ key: 'disk', level: 'warn', text: `Disk space is low: ${gb(r.disk.free)} free (warning below ${gb(limits.freeDiskBytes)})` });
  return w;
}

// agents: [{ id, displayName, lead, state, lastTs }], work: { [agentId]: { assignedAt, doneAt } }
// Each alert has a key (1.0.2) that changes only when its condition does: a task stall is its task, an agent stall
// its last activity or assignment, a Floor stall the latest of those. A dismissed key stays dismissed. since: when
// the condition began (notifications wait until it has lasted NOTICE_NOTIFY_MS).
// agents: [{ id, displayName, lead, state, lastTs, task }]; an agent with a running command (task) is working, never
// idle; its command can stall by itself (task.stall: its output stopped moving, or it runs far longer than usual)
export function stallAlerts(agents, work, now = Date.now(), stallMs = STALL_MS) {
  const taskStalls = agents.filter((a) => a.task?.stall).map((a) => ({ kind: 'stall', scope: 'task', agent: a.id, key: `task:${a.task.id}`,
    since: a.task.stall === 'quiet' ? a.task.lastOutputAt : a.task.startedAt + Math.max(3 * a.task.typicalMs, a.task.typicalMs + 10 * 60e3),
    text: a.task.stall === 'quiet' ? `${a.displayName}: "${a.task.label}" has written no output for ${Math.round((now - a.task.lastOutputAt) / 60000)} min`
      : `${a.displayName}: "${a.task.label}" has run ${Math.round(a.task.elapsedMs / 60000)} min, far longer than usual (${Math.round(a.task.typicalMs / 60000)} min)` }));
  const open = agents.filter((a) => work[a.id] && !work[a.id].doneAt);
  if (!open.length) return taskStalls;
  const quietFor = (a) => now - Math.max(a.lastTs || 0, work[a.id]?.assignedAt || 0);
  const idle = (a) => a.state !== 'working' && a.state !== 'waiting';
  const out = [];
  // whole floor: pending work while the lead and every agent are idle
  const everyoneIdle = agents.length && agents.every((a) => idle(a) && now - Math.max(a.lastTs || 0, work[a.id]?.assignedAt || 0) >= stallMs);
  if (everyoneIdle) {
    const since = Math.min(...open.map(quietFor));
    out.push({ kind: 'stall', scope: 'floor', key: `floor@${Math.max(...agents.map((a) => Math.max(a.lastTs || 0, work[a.id]?.assignedAt || 0)))}`, since: now - since, text: `Team is stalled: pending work but ${agents.find((a) => a.lead) ? 'the lead and ' : ''}all agents idle for ${Math.round(since / 60000)} min` });
    return [...out, ...taskStalls];
  }
  for (const a of open) {
    if (idle(a) && !a.task && quietFor(a) >= stallMs) out.push({ kind: 'stall', scope: 'agent', agent: a.id, key: `agent:${a.id}@${now - quietFor(a)}`, since: now - quietFor(a), text: `${a.displayName} has assigned work but has been idle for ${Math.round(quietFor(a) / 60000)} min` });
  }
  return [...out, ...taskStalls];
}

// budget: { usd, period: day|month }, spent: { today, month }
export function budgetStatus(budget, spent) {
  if (!budget || !(budget.usd > 0)) return { level: 'none', used: budget?.period === 'day' ? spent.today : spent.month, pct: 0 };
  const used = budget.period === 'day' ? spent.today : spent.month;
  const pct = used / budget.usd * 100;
  return { level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok', used, pct: +pct.toFixed(1) };
}
