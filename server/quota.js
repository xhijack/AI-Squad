// SPDX-License-Identifier: Apache-2.0
// The quota guard (0.13): a Claude subscription has a 5-hour window and a weekly window. The AI Squad cannot read
// the plan's real counters, so it watches two things:
//   1. a cost proxy: the API-equivalent cost of every session on this machine in the last 5 hours and 7 days,
//      against limits the owner sets (0 = off). It is an estimate, not what Anthropic counts.
//   2. rate-limit signals: the rate_limits / rate_limit_event of background jobs (used %, resets at) and
//      "usage limit reached" errors.
// When either is near its limit, automated work (P1-P3) waits in the queue; the owner's own work (P0) still starts.
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson } from './util.js';

export const DEFAULTS = { fiveHourUsd: 0, weekUsd: 0, pausePct: 90 };
export const WINDOWS = { fiveHour: 5 * 3600e3, week: 7 * 864e5 };
const FALLBACK_PAUSE_MS = 30 * 60e3;
const file = () => path.join(config.home, 'quota.json');

export function cleanQuota(q = {}) {
  const usd = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(100000, Math.round(n * 100) / 100) : 0; };
  const p = parseInt(q?.pausePct, 10);
  return { fiveHourUsd: usd(q?.fiveHourUsd), weekUsd: usd(q?.weekUsd), pausePct: Number.isFinite(p) ? Math.max(50, Math.min(100, p)) : DEFAULTS.pausePct };
}

const ms = (t) => { const n = Number(t); if (!Number.isFinite(n) || n <= 0) return 0; return n < 1e12 ? n * 1000 : n; };     // seconds or ms
const pct = (v) => { const n = Number(v); return Number.isFinite(n) ? (n <= 1 && n > 0 && !Number.isInteger(n) ? n * 100 : n) : null; };

// the shapes Claude Code uses for its limits -> [{ window, usedPct, resetsAt, rejected }]
export function parseRateLimits(rl) {
  if (!rl || typeof rl !== 'object') return [];
  const info = rl.rate_limit_info || rl;
  if (info.rateLimitType || info.status) {
    return [{ window: String(info.rateLimitType || 'limit'), usedPct: pct(info.utilization ?? info.used_percentage), resetsAt: ms(info.resetsAt ?? info.resets_at), rejected: info.status === 'rejected' }];
  }
  return Object.entries(info).filter(([, v]) => v && typeof v === 'object')
    .map(([k, v]) => ({ window: k, usedPct: pct(v.used_percentage ?? v.utilization), resetsAt: ms(v.resets_at ?? v.resetsAt), rejected: v.status === 'rejected' }));
}

// "Claude AI usage limit reached|1793050000", "5-hour limit reached ∙ resets 3pm", "rate limit" -> { until } | null
export function limitFromText(text, now = Date.now()) {
  const s = String(text || '');
  if (!/usage limit reached|limit reached|rate.?limit(ed)?\b|weekly limit/i.test(s)) return null;
  const epoch = s.match(/\|(\d{10,13})\b/);
  return { until: epoch ? ms(epoch[1]) : now + FALLBACK_PAUSE_MS, text: s.slice(0, 160) };
}

export const loadState = () => ({ signals: [], ...(readJson(file(), {}) || {}) });
// keeps the signals that still matter (not reset yet), one per window
export function observe(signals = [], now = Date.now()) {
  const st = loadState();
  const byKey = new Map(st.signals.filter((x) => x.resetsAt > now).map((x) => [x.window, x]));
  for (const s of signals) if (s && s.resetsAt > now) byKey.set(s.window, { ...s, seenAt: now });
  st.signals = [...byKey.values()];
  writeJson(file(), st);
  return st;
}

// -> { paused, reason, until, windows: [{ key, usd, limit, pct }], signals }
export function check({ costs = {}, limits = DEFAULTS, signals = loadState().signals, now = Date.now() } = {}) {
  const q = cleanQuota(limits);
  const windows = [['fiveHour', '5 hours', q.fiveHourUsd], ['week', '7 days', q.weekUsd]].map(([key, label, limit]) => {
    const usd = +(costs[key] || 0).toFixed(2);
    return { key, label, usd, limit, pct: limit ? Math.round(usd / limit * 100) : null };
  });
  const live = signals.filter((s) => s.resetsAt > now);
  const hit = live.find((s) => s.rejected || (s.usedPct != null && s.usedPct >= q.pausePct));
  if (hit) return { paused: true, reason: hit.rejected ? `the ${hit.window} limit was reached` : `the ${hit.window} limit is ${Math.round(hit.usedPct)} % used`, until: hit.resetsAt, windows, signals: live };
  const over = windows.find((w) => w.pct != null && w.pct >= q.pausePct);
  if (over) return { paused: true, reason: `$${over.usd} of $${over.limit} used in the last ${over.label} (estimate)`, until: 0, windows, signals: live };
  return { paused: false, reason: '', until: 0, windows, signals: live };
}
