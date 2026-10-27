// SPDX-License-Identifier: Apache-2.0
// More machines (0.18): one Head and its workers. The Head keeps everything that matters (Spaces, the queue, the
// Squad Log, identities, configuration, chats); a worker keeps only clones of repositories and the sessions it
// runs, so a machine can go away without taking any context with it.
//   - A worker connects out to the Head (`aisquad node --head URL --name NAME --token TOKEN`), over a private
//     network such as Tailscale or WireGuard: a heartbeat every 10 s and a long poll for work. No port opens on it.
//   - The Head places background jobs (the headless runner) on the machine with room: this one first, then the
//     worker with the most free memory, preferring one that already has the repository; a Space can be pinned to a
//     machine (Space node). Desk sessions (tmux) stay on the Head.
//   - Context travels by git: the worker pulls, works on a branch <agent>/job-<id>, pushes it; the Head fetches it
//     and merges as usual, after its quality gate.
//   - A worker silent for 45 s is offline: its running jobs are marked lost and queued again (P1), to continue
//     from the branch it pushed last.
//   - Credentials never travel: each worker signs in to Claude itself (its own login or API key).
// Tokens are shown once and stored as SHA-256 hashes in ~/.aisquad/nodes.json.
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson, bad, notFound } from './util.js';

export const OFFLINE_MS = 45e3;
export const HEARTBEAT_MS = 10e3;
const file = () => path.join(config.home, 'nodes.json');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const load = () => { const j = readJson(file(), null); return Array.isArray(j?.nodes) ? j.nodes : []; };
const save = (nodes) => writeJson(file(), { nodes }, 0o600);
const pub = ({ tokenHash, ...n }) => n;
export const HEAD = 'head';

// a new machine: its name and a token (shown once)
export function addNode(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(n) || n === HEAD || n === 'auto') throw bad('A machine name: letters, digits and "-", not "head" or "auto"');
  const nodes = load();
  if (nodes.some((x) => x.name === n)) throw bad(`There is already a machine called ${n}`);
  const token = crypto.randomBytes(24).toString('hex');
  nodes.push({ name: n, tokenHash: sha(token), addedAt: Date.now(), lastSeen: 0, drain: false });
  save(nodes);
  return { node: pub(nodes.at(-1)), token };
}
export function removeNode(name) {
  const nodes = load();
  if (!nodes.some((x) => x.name === name)) throw notFound('Machine not found');
  save(nodes.filter((x) => x.name !== name));
  queues.delete(name);
  return { ok: true };
}
export function setDrain(name, drain) {
  const nodes = load();
  const n = nodes.find((x) => x.name === name);
  if (!n) throw notFound('Machine not found');
  n.drain = !!drain; save(nodes);
  return pub(n);
}
// "name:token" from the x-aisquad-node header -> the node or null
export function authNode(header) {
  const [name, token] = String(header || '').split(':');
  if (!name || !token) return null;
  const n = load().find((x) => x.name === name);
  if (!n) return null;
  const a = Buffer.from(n.tokenHash, 'hex'), b = Buffer.from(sha(token), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? pub(n) : null;
}
export function heartbeat(name, body = {}, now = Date.now()) {
  const nodes = load();
  const n = nodes.find((x) => x.name === name);
  if (!n) throw notFound('Machine not found');
  const res = body.resources || {};
  Object.assign(n, {
    lastSeen: now, version: String(body.version || '').slice(0, 20), host: String(body.host || '').slice(0, 80),
    maxAgents: Math.max(1, Math.min(40, parseInt(body.maxAgents, 10) || 6)), running: (Array.isArray(body.running) ? body.running : []).map(String).slice(0, 100),
    repos: (Array.isArray(body.repos) ? body.repos : []).map(String).slice(0, 200), sessionRss: +body.sessionRss || 0,
    resources: { mem: res.mem ? { total: +res.mem.total || 0, available: +res.mem.available || 0 } : null, cpus: +res.cpus || 0, load: Array.isArray(res.load) ? res.load.map(Number).slice(0, 3) : [] },
  });
  save(nodes);
  return { ok: true, heartbeatMs: HEARTBEAT_MS };
}
export const online = (n, now = Date.now()) => !!n.lastSeen && now - n.lastSeen < OFFLINE_MS;
export function listNodes(now = Date.now()) {
  return load().map((n) => ({ ...pub(n), online: online(n, now), pending: (queues.get(n.name) || []).length }));
}

// ---------- work for a worker: a queue per machine and its waiting long poll ----------
const queues = new Map();                     // name -> [assignment]
const waiters = new Map();                    // name -> resolve()
export function assign(name, a) {
  queues.set(name, [...(queues.get(name) || []), a]);
  const w = waiters.get(name); if (w) { waiters.delete(name); w(); }
}
export async function nextWork(name, waitMs = 25e3) {
  if (!(queues.get(name) || []).length) await new Promise((ok) => { const t = setTimeout(() => { waiters.delete(name); ok(); }, waitMs); waiters.set(name, () => { clearTimeout(t); ok(); }); });
  const out = queues.get(name) || [];
  queues.set(name, []);
  return { assignments: out };
}

// ---------- placement ----------
// free slots of one worker by what it reported: its own maximum and its free memory (2 GB kept free)
export function workerFree(n, assigned = 0) {
  const cap = Math.min(n.maxAgents || 6, n.resources?.mem?.available ? (n.running?.length || 0) + Math.max(0, Math.floor((n.resources.mem.available - 2 * 2 ** 30) / (n.sessionRss || 1.5 * 2 ** 30))) : (n.maxAgents || 6));
  return Math.max(0, cap - (n.running?.length || 0) - assigned);
}
// where a job of a Space runs: 'head', a worker's name, or null (no room). pin: the Space's node ('auto' or a name);
// headFree: slots on this machine; hasRemote: the Space's repository has a remote a worker can clone;
// placedNow: jobs given to workers since their last heartbeat
export function place({ pin = 'auto', headFree = 0, hasRemote = false, floorId = '', placedNow = {} } = {}, now = Date.now()) {
  if (pin === HEAD) return headFree > 0 ? HEAD : null;
  const usable = listNodes(now).filter((n) => n.online && !n.drain && hasRemote).map((n) => ({ n, free: workerFree(n, placedNow[n.name] || 0) })).filter((x) => x.free > 0);
  if (pin && pin !== 'auto') return usable.find((x) => x.n.name === pin)?.n.name || null;
  if (headFree > 0) return HEAD;
  usable.sort((a, b) => (b.n.repos?.includes(floorId) ? 1 : 0) - (a.n.repos?.includes(floorId) ? 1 : 0) || (b.n.resources?.mem?.available || 0) - (a.n.resources?.mem?.available || 0));
  return usable[0]?.n.name || null;
}
// the room on all workers together (for the dispatcher's slots)
export const clusterFree = (now = Date.now(), placedNow = {}) => listNodes(now).filter((n) => n.online && !n.drain).reduce((s, n) => s + workerFree(n, placedNow[n.name] || 0), 0);
// workers that went silent -> their names (the caller requeues their jobs)
export const offline = (now = Date.now()) => listNodes(now).filter((n) => n.lastSeen && !n.online).map((n) => n.name);
