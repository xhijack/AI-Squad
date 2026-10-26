// SPDX-License-Identifier: Apache-2.0
// RAM and CPU of each agent session: the process its tmux pane runs (Claude Code) and everything under it (MCP
// servers, shells, test runs), from the meter's last /proc sample. The averages and peaks per session are kept in
// ~/.aisquad/usage.json; the dispatcher (0.13) uses them to know how many agents fit in memory.
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson } from './util.js';

export const DEFAULT_SESSION_RSS = 2 ** 30;         // 1 GB until real sessions have been measured
const ALPHA = 0.1;                                  // weight of a new sample in the running average
const SAVE_EVERY_MS = 60e3;

// tree: Map(pid -> { ppid, rss, cpu }); roots: the pane pids -> the pids of the roots and all their descendants
export function descendants(tree, roots) {
  const kids = new Map();
  for (const [pid, p] of tree) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(pid); }
  const out = new Set(), stack = roots.filter((r) => tree.has(r));
  while (stack.length) { const p = stack.pop(); if (out.has(p)) continue; out.add(p); for (const k of kids.get(p) || []) stack.push(k); }
  return out;
}
// -> { rss bytes, cpu % of the machine, procs } or null when none of the roots is in the sample
export function usageOf(tree, roots) {
  const pids = descendants(tree, roots);
  if (!pids.size) return null;
  let rss = 0, cpu = 0;
  for (const p of pids) { const x = tree.get(p); rss += x.rss || 0; cpu += x.cpu || 0; }
  return { rss, cpu: +cpu.toFixed(1), procs: pids.size };
}
// names: running session names; panePids(name) -> [pid] -> Map(name -> usage)
export function sessionsUsage(names, tree, panePids) {
  const out = new Map();
  if (!tree || !tree.size) return out;
  for (const n of names) { const u = usageOf(tree, panePids(n)); if (u) out.set(n, u); }
  return out;
}

// ---------- statistics ----------
const file = () => path.join(config.home, 'usage.json');
let stats = null, savedAt = 0;
export function loadStats() {
  if (!stats) { const s = readJson(file(), {}) || {}; stats = { sessions: s.sessions || {}, global: s.global || { avgRss: 0, peakRss: 0, samples: 0 } }; }
  return stats;
}
export const resetStats = () => { stats = null; savedAt = 0; };
const ema = (avg, x, n) => (n ? avg + ALPHA * (x - avg) : x);
// usage: Map(session name -> { rss, cpu }) of one moment; keyOf(name) -> "floor/agent"
export function record(usage, { now = Date.now(), keyOf = (n) => n } = {}) {
  const s = loadStats();
  for (const [name, u] of usage) {
    const k = keyOf(name), e = s.sessions[k] || { avgRss: 0, peakRss: 0, avgCpu: 0, samples: 0 };
    e.avgRss = Math.round(ema(e.avgRss, u.rss, e.samples)); e.avgCpu = +ema(e.avgCpu, u.cpu, e.samples).toFixed(1);
    e.peakRss = Math.max(e.peakRss, u.rss); e.samples++; e.lastTs = now;
    s.sessions[k] = e;
    const g = s.global;
    g.avgRss = Math.round(ema(g.avgRss, u.rss, g.samples)); g.peakRss = Math.max(g.peakRss, u.rss); g.samples++;
  }
  if (usage.size && now - savedAt >= SAVE_EVERY_MS) { savedAt = now; try { writeJson(file(), s); } catch { /* read-only home */ } }
  return s;
}
// what one more agent session probably needs: the measured average (between its peak and the average when
// sessions grow over time), else 1 GB
export function estimateSessionRss() {
  const g = loadStats().global;
  if (!g.samples) return DEFAULT_SESSION_RSS;
  return Math.round(Math.max(g.avgRss, (g.avgRss + g.peakRss) / 2 * 0.75));
}
export function summary() {
  const g = loadStats().global;
  return { measured: g.samples > 0, avgRss: g.avgRss, peakRss: g.peakRss, samples: g.samples, estimate: estimateSessionRss() };
}
