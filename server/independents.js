// Independent agents (Floor 1): Claude Code agents that already run on this machine on their own. The scan
// finds live claude processes, tmux panes running claude and projects with recent transcripts; each one not
// started by The AI Squad gets a desk on Floor 1. Nothing is written into their repos: the registry
// (stable ids, adoption) lives in ~/.aisquad/independents.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, paths } from './config.js';
import { readJson, writeJson, safeReaddir, uniqueId, kebab } from './util.js';
import * as tx from './transcripts.js';
import * as tm from './tmux.js';

export const FLOOR_ID = 'independents';
export const RECENT_MS = 24 * 3600e3;               // transcript activity that still counts as an agent
const PRUNE_MS = 30 * 864e5;

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// the session a claude process works on, from its arguments (--resume=<id>, --resume <id>, -r <id>,
// --session-id <id>); '' when it starts a new one
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function sessionArg(argv = []) {
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(?:resume|session-id)=(.+)$/);
    if (m && UUID.test(m[1])) return m[1];
    if (['--resume', '-r', '--session-id'].includes(argv[i]) && UUID.test(argv[i + 1] || '')) return argv[i + 1];
  }
  return '';
}

// live interactive claude processes: { pid, ppid, cwd, via, session }. Sessions started by The AI Squad
// (AISQUAD_AGENT in their environment) and print-mode runs (claude -p) are skipped.
export function claudeProcesses(proc = config.procDir) {
  const out = [];
  for (const pid of safeReaddir(proc)) {
    if (!/^\d+$/.test(pid)) continue;
    const stat = read(`${proc}/${pid}/stat`);
    if (!stat) continue;
    const r = stat.lastIndexOf(')');
    if (stat.slice(stat.indexOf('(') + 1, r) !== 'claude') continue;
    const argv = (read(`${proc}/${pid}/cmdline`) || '').split('\0').filter(Boolean);
    if (argv.some((a) => a === '-p' || a === '--print')) continue;
    if ((read(`${proc}/${pid}/environ`) || '').split('\0').some((v) => v.startsWith('AISQUAD_AGENT='))) continue;   // only this key is looked at
    let cwd = ''; try { cwd = fs.readlinkSync(`${proc}/${pid}/cwd`); } catch { continue; }
    out.push({ pid: +pid, ppid: +stat.slice(r + 2).split(' ')[1], cwd, via: argv.some((a) => a.includes('.vscode')) ? 'VS Code' : '', session: sessionArg(argv) });
  }
  return out.sort((a, b) => a.pid - b.pid);
}

const shortRoot = (root) => (root === os.homedir() ? 'home' : path.basename(root) || root);

// one candidate per live process (tmux panes keep their pane as identity; a resumed session its session id, so
// two processes on one session are one agent) plus one per project with recent transcripts and no live process.
// floorRoots: squad Floors (their transcripts belong to them).
export function detect({ procs = claudeProcesses(), panes = tm.listPanes(config.scanTmuxSocket), projects = tx.discoverProjects(0), floorRoots = [], now = Date.now() } = {}) {
  const out = [], perRoot = new Map(), sessions = new Set();
  for (const p of procs) {
    const pane = panes.find((x) => !x.aisquad && (x.pid === p.pid || x.pid === p.ppid));
    if (panes.some((x) => x.aisquad && (x.pid === p.pid || x.pid === p.ppid))) continue;   // our own session
    const root = path.resolve(p.cwd);
    if (p.session && sessions.has(p.session)) continue;                          // the same session again
    if (p.session) sessions.add(p.session);
    if (pane) { out.push({ key: `tmux:${pane.session}:${pane.pane}`, root, pid: p.pid, live: true, tmux: { target: pane.target, session: pane.session, pane: pane.pane }, via: 'tmux', session: p.session || '' }); continue; }
    if (p.session) { out.push({ key: `session:${p.session}`, root, pid: p.pid, live: true, tmux: null, via: p.via || 'terminal', session: p.session }); continue; }
    const k = (perRoot.get(root) || 0) + 1;
    perRoot.set(root, k);
    out.push({ key: `root:${root}#${k}`, root, pid: p.pid, live: true, tmux: null, via: p.via || 'terminal', session: '' });
  }
  const liveRoots = new Set(out.map((c) => c.root));
  for (const pr of projects) {
    if (liveRoots.has(pr.root) || floorRoots.includes(pr.root) || now - pr.lastActive > RECENT_MS) continue;
    out.push({ key: `root:${pr.root}#1`, root: pr.root, pid: null, live: false, tmux: null, via: 'transcripts', lastActive: pr.lastActive });
  }
  return out;
}

export const loadRegistry = () => { const r = readJson(paths.independents(), null); return r && typeof r === 'object' ? { scannedAt: r.scannedAt || 0, agents: r.agents || {} } : { scannedAt: 0, agents: {} }; };
const saveRegistry = (r) => writeJson(paths.independents(), r);

// which transcript each candidate shows: its own session's when it has one, else the newest one in its project that
// no other candidate shows (two terminals in one folder never show the same session twice). sessionsOf: tx.sessionsOf
export function assignTranscripts(list, sessionsOf = tx.sessionsOf) {
  const taken = new Set(), out = new Map();
  for (const a of list) {
    const own = a.session && sessionsOf(a.root).find((s) => s.id === a.session);
    if (own) { out.set(a, own.file); taken.add(own.file); }
  }
  for (const a of list) {
    if (out.has(a)) continue;
    const s = sessionsOf(a.root).find((x) => !taken.has(x.file));
    if (s) { out.set(a, s.file); taken.add(s.file); }
  }
  return out;
}

// merge a scan into the registry: stable ids per key, lastSeen, pruning; returns the visible agents
export function scan(opts = {}) {
  const now = opts.now || Date.now();
  const reg = loadRegistry();
  const found = detect({ ...opts, now });
  const taken = Object.values(reg.agents).map((a) => a.id);
  for (const c of found) {
    let a = reg.agents[c.key];
    if (!a) {
      const base = `${kebab(shortRoot(c.root))}${c.tmux ? `-${kebab(c.tmux.session)}` : ''}`;
      a = reg.agents[c.key] = { key: c.key, id: uniqueId(base, taken, 'agent'), root: c.root, firstSeen: now };
      taken.push(a.id);
    }
    a.lastSeen = now;
  }
  for (const [k, a] of Object.entries(reg.agents)) if (!a.adopted && now - (a.lastSeen || 0) > PRUNE_MS) delete reg.agents[k];
  reg.scannedAt = now;
  saveRegistry(reg);
  const byKey = new Map(found.map((c) => [c.key, c]));
  return Object.values(reg.agents).filter((a) => !a.adopted && byKey.has(a.key)).map((a) => ({ ...a, ...byKey.get(a.key) }));
}

let cache = { at: 0, list: [] };
export function current({ maxAgeMs = 10000, ...opts } = {}) {
  if (Date.now() - cache.at < maxAgeMs) return cache.list;
  cache = { at: Date.now(), list: scan(opts) };
  return cache.list;
}
export const resetCache = () => { cache.at = 0; };

export function adopt(id, { floorId, agentId }) {
  const reg = loadRegistry();
  const a = Object.values(reg.agents).find((x) => x.id === id);
  if (!a) return null;
  a.adopted = { floorId, agentId, at: Date.now() };
  saveRegistry(reg);
  resetCache();
  return a;
}

// stable, friendly looks from the id (no appearance file for agents we do not own)
const STYLES = ['bob', 'spiky', 'pony', 'buns', 'farmer'], SHIRTS = ['#5d6687', '#2bb3a3', '#d94f8c', '#f08a24', '#4fa36b', '#3d82d6'], HAIR = ['#2b2440', '#5a3418', '#8a5a2b', '#1f2937', '#c9a227'];
export function appearanceFor(id) {
  const h = [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 11);
  return { style: STYLES[h % 5], shirt: SHIRTS[h % 6], hair: HAIR[h % 5], skin: ['#f6d2b0', '#e9bf96', '#d9a77f'][h % 3], glasses: h % 4 === 1 };
}
export const displayNameOf = (a) => `${shortRoot(a.root)}${a.tmux ? ` · tmux ${a.tmux.session}` : a.via === 'VS Code' ? ' · VS Code' : ''}`;
