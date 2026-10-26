// SPDX-License-Identifier: Apache-2.0
// Recovery after an agent dies: how a session ended (clean exit, out of memory kill, killed mid-turn), the texts
// shown on the Desk and in Attention, when an automatic resume is allowed, the message a resumed lead gets,
// and the memory guard before more agents start.
import { execFileSync } from 'node:child_process';

export const DEFAULTS = { autoResume: false, maxAgents: 4 };
// agents running at once on the whole machine (all Floors together); Building settings, prefs.maxAgents
export const BUILDING_MAX_DEFAULT = 6;
export function buildingMax(prefs = {}) {
  const n = parseInt(prefs?.maxAgents, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(40, n)) : BUILDING_MAX_DEFAULT;
}
export const AUTO_RESUME = { max: 2, windowMs: 3600e3 };
export const GUARD_SWAP_PCT = 80;
const SLACK_MS = 60e3;

// floor.json "recovery": { autoResume, maxAgents }
export function cleanRecovery(r = {}) {
  const n = parseInt(r?.maxAgents, 10);
  return { autoResume: r?.autoResume === true, maxAgents: Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : DEFAULTS.maxAgents };
}

// "1792990188.934938 host systemd[1061]: aisquad-x-1792.scope: systemd-oomd killed 354 process(es) in this unit."
export function parseOomKills(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^(\d+(?:\.\d+)?)\s.*?:\s+([\w@.:-]+?)(?:\.scope|\.service)?: systemd-oomd killed (\d+)/);
    if (m) out.push({ ts: Math.round(+m[1] * 1000), unit: m[2], processes: +m[3] });
  }
  return out;
}

// out of memory kills from the user journal between two times; [] when journalctl is not there
const journal = { run: execFileSync };
export const setJournalRunner = (run) => { journal.run = run || execFileSync; };     // tests: a scratch journal
export function oomKills(from, to, { run = journal.run } = {}) {
  const sec = (ms) => `@${Math.floor(ms / 1000)}`;
  try {
    return parseOomKills(run('journalctl', ['--user', '-q', '--no-pager', '-o', 'short-unix', '--since', sec(from), '--until', sec(to + 1000), '-g', 'systemd-oomd killed'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return []; }
}

// how a session that was running and is gone without a stop from The AI Squad ended.
// info: { unit, startedAt } as recorded at start; status: transcript status; name: tmux session name
// -> { kind: 'crashed' | 'exited', cause: 'oom' | 'killed' | 'exit', at }
export function classifyEnd({ info = {}, status = null, name = '', detectedAt = Date.now(), kills = [] }) {
  const lastTs = Math.max(status?.lastTs || 0, info.startedAt || 0);
  const mine = (k) => (info.unit ? k.unit === info.unit : k.unit === name || k.unit.startsWith(`${name}-`) || k.unit.startsWith('aisquad-'));
  const kill = kills.filter((k) => mine(k) && k.ts >= lastTs - SLACK_MS && k.ts <= detectedAt + SLACK_MS).at(-1);
  if (kill) return { kind: 'crashed', cause: 'oom', at: kill.ts };
  if (status?.turnOpen) return { kind: 'crashed', cause: 'killed', at: status.lastTs || detectedAt };
  return { kind: 'exited', cause: 'exit', at: status?.lastTs || detectedAt };
}

const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function causeText(end) {
  if (!end) return '';
  return end.cause === 'oom' ? `out of memory at ${hhmm(end.at)}` : end.cause === 'killed' ? `ended mid-turn, last activity at ${hhmm(end.at)}` : `exited at ${hhmm(end.at)}`;
}
export const crashText = (end) => `Stopped unexpectedly (${causeText(end)})`;

// at most AUTO_RESUME.max automatic resumes per agent per hour, and none while memory is under pressure
export function autoResumeAllowed(history = [], res = null, now = Date.now()) {
  if (history.filter((t) => now - t < AUTO_RESUME.windowMs).length >= AUTO_RESUME.max) return { ok: false, reason: `already resumed ${AUTO_RESUME.max} times in the past hour` };
  const p = memoryPressure(res);
  return p ? { ok: false, reason: p } : { ok: true };
}

export const swapPct = (res) => (res?.swap?.total > 0 ? res.swap.used / res.swap.total * 100 : 0);
export function memoryPressure(res, freeRamBytes = 1.5 * 2 ** 30) {
  if (!res) return '';
  if (swapPct(res) > GUARD_SWAP_PCT) return `swap is ${swapPct(res).toFixed(0)} % full`;
  if (res.mem && res.mem.available < freeRamBytes) return `only ${(res.mem.available / 2 ** 30).toFixed(1)} GB RAM available`;
  return '';
}

// the Watchdog warning before another agent starts: swap above 80 %, the Floor or the whole Building already at
// its maximum of agents running at once
export function startWarnings({ res = null, running = 0, maxAgents = DEFAULTS.maxAgents, buildingRunning = 0, buildingMax: bMax = BUILDING_MAX_DEFAULT } = {}) {
  const out = [];
  if (swapPct(res) > GUARD_SWAP_PCT) out.push(`Swap is ${swapPct(res).toFixed(0)} % full: another agent may get the squad killed by the out of memory killer.`);
  if (running >= maxAgents) out.push(`${running} agent${running === 1 ? '' : 's'} already run on this Floor (maximum ${maxAgents}).`);
  if (buildingRunning >= bMax) out.push(`${buildingRunning} agents already run on this machine (Building maximum ${bMax}).`);
  return out;
}

// the rule the lead's agent file carries (see compose.js)
export const memoryRules = (maxAgents) => [
  `At most ${maxAgents} agents may run on this Floor at the same time, you included: never have more than ${Math.max(0, maxAgents - 1)} teammate${maxAgents - 1 === 1 ? '' : 's'} running at once.`,
  'This machine has little memory. Spawn a teammate only when its task is ready, let finished teammates end, and prefer one teammate after another over many in parallel.',
  'If you are resumed after a crash, your teammates are gone: check the board and re-spawn only the teammates whose work is still open.',
];

// typed into a resumed lead on a Squad Sprint or Blueprint Floor
export function recoveryMessage({ end = null, maxAgents = DEFAULTS.maxAgents } = {}) {
  const why = end && end.kind === 'crashed' ? `stopped unexpectedly (${causeText(end)})` : 'was stopped';
  return `Recovery note from The AI Squad: your session ${why} and has been resumed. Your in-process teammates died with it. `
    + 'Check the board and the handoffs for what was in progress, re-spawn only the teammates whose work is still open, '
    + `and follow the memory rules in your agent file (at most ${maxAgents} agents at once, you included). Then continue.`;
}
