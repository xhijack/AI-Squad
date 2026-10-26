// SPDX-License-Identifier: Apache-2.0
// Server meter (from squad-3d): samples /proc every 3 s for CPU, RAM, swap and disk, keeps 6 minutes of
// history, and groups the busiest processes. Only process names leave this module, never command lines
// (they can contain secrets); command lines are read just to pick a group.
import fs from 'node:fs';
import os from 'node:os';
import { safeReaddir } from './util.js';
import { LIMITS } from './watchdog.js';

export const INTERVAL_MS = 3000;
export const HISTORY = 120;                          // 120 samples x 3 s = 6 minutes

// /proc/stat first line -> { idle, total } jiffies
export function parseCpu(text) {
  const v = String(text).split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  return { idle: v[3] + (v[4] || 0), total: v.reduce((a, b) => a + b, 0) };
}
export function parseMeminfo(text) {
  const m = {};
  for (const line of String(text).split('\n')) { const x = line.match(/^(\w+):\s+(\d+)/); if (x) m[x[1]] = +x[2] * 1024; }
  return { total: m.MemTotal || 0, available: m.MemAvailable ?? m.MemFree ?? 0, swapTotal: m.SwapTotal || 0, swapFree: m.SwapFree || 0 };
}
// /proc/<pid>/stat -> { comm, ticks (user + system), rss bytes }
export function parseProcStat(text, pageSize = 4096) {
  const t = String(text), r = t.lastIndexOf(')');
  if (r < 0) return null;
  const f = t.slice(r + 2).split(' ');
  return { comm: t.slice(t.indexOf('(') + 1, r), ticks: +f[11] + +f[12], rss: +f[21] * pageSize };
}

export function groupOf(comm, cmd = '') {
  const both = `${comm} ${cmd}`;
  if (/aisquad/.test(cmd) && /server\/index\.js|bin\/aisquad/.test(cmd)) return 'The AI Squad';
  if (/^claude$/.test(comm) || /\/claude(\s|$)|@anthropic-ai\/claude-code/.test(cmd)) return 'Claude Code';
  if (/chrom|headless_shell|firefox/i.test(comm)) return 'Browsers';
  if (/postgres|mysqld|mariadb|redis|valkey|mongo/.test(both)) return 'Databases & caches';
  if (/dockerd|containerd|docker/.test(comm)) return 'Docker';
  if (comm === 'code' || /vscode|\/code(\s|$)/.test(cmd)) return 'Editors';
  if (/^(node|npm|pnpm|bun|deno)$/.test(comm)) return 'Node.js';
  if (/python|gunicorn|uvicorn/.test(comm)) return 'Python';
  if (/^(tmux|bash|zsh|sh|fish|sshd)/.test(comm)) return 'Shells & tmux';
  return 'Other';
}

// level per metric: 'ok' | 'warn' | 'bad' (red when dangerous)
export function levels(s, limits = LIMITS) {
  const pct = (u, t) => (t ? u / t * 100 : 0);
  const lv = (v, warn, bad) => (v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok');
  const out = {
    cpu: lv(s.cpu, 75, 92),
    ram: s.mem.total - s.mem.used < limits.freeRamBytes ? 'bad' : lv(pct(s.mem.used, s.mem.total), 80, 101),
    swap: s.swap.total ? lv(pct(s.swap.used, s.swap.total), 60, limits.swapPct) : 'ok',
    disk: !s.disk ? 'ok' : s.disk.free < limits.freeDiskBytes ? 'bad' : s.disk.free < limits.freeDiskBytes * 2 ? 'warn' : 'ok',
  };
  out.overall = Object.values(out).includes('bad') ? 'bad' : Object.values(out).includes('warn') ? 'warn' : 'ok';
  return out;
}

export function createMeter({ proc = '/proc', diskPath = os.homedir(), ncpu = os.cpus().length } = {}) {
  const read = (f) => fs.readFileSync(`${proc}/${f}`, 'utf8');
  const state = { hist: [], last: null };
  let prevCpu = null, prevTicks = new Map();

  function sampleProcs(dTotal) {
    const now = new Map(), rows = [];
    for (const pid of safeReaddir(proc)) {
      if (!/^\d+$/.test(pid)) continue;
      let p; try { p = parseProcStat(read(`${pid}/stat`)); } catch { continue; }
      if (!p) continue;
      now.set(pid, p.ticks);
      const prev = prevTicks.get(pid);
      const cpu = prev != null && dTotal > 0 ? (p.ticks - prev) / dTotal * 100 : 0;     // share of the whole machine
      if (cpu < .2 && p.rss < 100e6) continue;
      let cmd = ''; try { cmd = read(`${pid}/cmdline`).replace(/\0/g, ' ').slice(0, 300); } catch { /* gone */ }
      rows.push({ pid: +pid, comm: p.comm, cpu, rss: p.rss, group: groupOf(p.comm, cmd) });
    }
    prevTicks = now;
    return rows;
  }

  function sample() {
    try {
      const c = parseCpu(read('stat')), m = parseMeminfo(read('meminfo'));
      const dTotal = prevCpu ? c.total - prevCpu.total : 0;
      const cpu = dTotal > 0 ? (1 - (c.idle - prevCpu.idle) / dTotal) * 100 : 0;
      prevCpu = c;
      const procs = sampleProcs(dTotal);
      let disk = null;
      try { const st = fs.statfsSync(diskPath); disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch { /* no statfs */ }
      const groups = {};
      for (const p of procs) { const g = groups[p.group] ||= { name: p.group, cpu: 0, rss: 0, n: 0 }; g.cpu += p.cpu; g.rss += p.rss; g.n++; }
      const s = {
        ts: Date.now(), ncpu, cpu: +cpu.toFixed(1), load: os.loadavg().map((x) => +x.toFixed(2)),
        mem: { total: m.total, used: m.total - m.available }, swap: { total: m.swapTotal, used: m.swapTotal - m.swapFree }, disk,
        groups: Object.values(groups).map((g) => ({ ...g, cpu: +g.cpu.toFixed(1) })).sort((a, b) => b.rss - a.rss),
        top: [...procs].sort((a, b) => b.cpu - a.cpu || b.rss - a.rss).slice(0, 10).map((p) => ({ ...p, cpu: +p.cpu.toFixed(1) })),
      };
      s.levels = levels(s);
      state.last = s;
      state.hist.push({ ts: s.ts, cpu: s.cpu, mem: s.mem.total ? +(s.mem.used / s.mem.total * 100).toFixed(1) : 0, swap: s.swap.total ? +(s.swap.used / s.swap.total * 100).toFixed(1) : 0 });
      if (state.hist.length > HISTORY) state.hist.shift();
    } catch { /* no /proc (macOS): the meter stays empty */ }
    return state.last;
  }

  let timer = null;
  return {
    sample, state,
    start(ms = INTERVAL_MS) { if (!timer) { sample(); timer = setInterval(sample, ms); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
    // dock chip (without process lists) and the full dialog data
    summary: () => (state.last ? (({ groups, top, ...rest }) => rest)(state.last) : null),
    detail: () => ({ last: state.last, hist: state.hist, intervalMs: INTERVAL_MS }),
  };
}

export const meter = createMeter();
