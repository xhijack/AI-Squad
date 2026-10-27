// SPDX-License-Identifier: Apache-2.0
// People (0.14): the Owner and the people the Owner adds, each with a role and an own PIN.
//   owner   everything: settings, money, secrets, legal, Owner-only Spaces, people
//   member  the work: start and stop agents, tasks, chat, answers, jobs (not settings, not Owner-only Spaces)
//   viewer  reads only (not Owner-only Spaces)
// The PIN in ~/.aisquad/pin stays the Owner's. Other PINs are stored only as scrypt hashes in ~/.aisquad/users.json
// (mode 600); a new PIN is shown once. A PIN that matches is remembered (as a SHA-256 key) for 10 minutes so a
// request does not pay for scrypt each time.
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson, bad, notFound } from './util.js';
import { checkPin } from './pin.js';

export const ROLES = ['viewer', 'member', 'owner'];
export const OWNER = { id: 'owner', name: 'Owner', role: 'owner' };
const file = () => path.join(config.home, 'users.json');
const CACHE_MS = 10 * 60e3;
const cache = new Map();                      // sha256(pin) -> { id, at }
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const hash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');

const load = () => { const u = readJson(file(), null); return Array.isArray(u?.users) ? u.users : []; };
const save = (users) => { writeJson(file(), { users }, 0o600); cache.clear(); };
const pub = ({ salt, hash: h, ...u }) => u;
export const listUsers = () => [OWNER, ...load().map(pub)];
export const roleAtLeast = (role, need) => ROLES.indexOf(role) >= ROLES.indexOf(need);

// who sends this PIN? -> { id, name, role } | null
export function identify(pin, ownerPin) {
  if (!pin) return null;
  if (checkPin(ownerPin, pin)) return OWNER;
  const key = sha(pin), hit = cache.get(key);
  const users = load();
  if (hit && Date.now() - hit.at < CACHE_MS) { const u = users.find((x) => x.id === hit.id); if (u) return pub(u); }
  for (const u of users) {
    const a = Buffer.from(hash(pin, u.salt), 'hex'), b = Buffer.from(u.hash, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) { cache.set(key, { id: u.id, at: Date.now() }); return pub(u); }
  }
  return null;
}

const cleanName = (n) => { const s = String(n || '').replace(/\s+/g, ' ').trim().slice(0, 60); if (!s) throw bad('A name is required'); return s; };
const cleanRole = (r) => { if (!['member', 'viewer'].includes(r)) throw bad('The role must be member or viewer (there is one Owner)'); return r; };
function newPin(ownerPin, users) {
  for (let i = 0; i < 20; i++) {
    const p = String(crypto.randomInt(10000000, 99999999));        // 8 digits: longer than the Owner's 6
    if (!checkPin(ownerPin, p) && !users.some((u) => hash(p, u.salt) === u.hash)) return p;
  }
  throw new Error('Could not make a unique PIN');
}
// -> { user, pin } (the PIN is shown once)
export function addUser({ name, role = 'member' } = {}, ownerPin) {
  const users = load();
  const n = cleanName(name);
  if (users.some((u) => u.name.toLowerCase() === n.toLowerCase()) || n.toLowerCase() === 'owner') throw bad(`There is already someone called ${n}`);
  const base = n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'user';
  let id = base; for (let i = 2; users.some((u) => u.id === id) || id === 'owner'; i++) id = `${base}-${i}`;
  const pin = newPin(ownerPin, users), salt = crypto.randomBytes(16).toString('hex');
  const u = { id, name: n, role: cleanRole(role), salt, hash: hash(pin, salt), createdAt: Date.now() };
  save([...users, u]);
  return { user: pub(u), pin };
}
export function updateUser(id, { name, role } = {}) {
  const users = load();
  const u = users.find((x) => x.id === id);
  if (!u) throw notFound('Person not found');
  if (name !== undefined) u.name = cleanName(name);
  if (role !== undefined) u.role = cleanRole(role);
  save(users);
  return pub(u);
}
export function resetPin(id, ownerPin) {
  const users = load();
  const u = users.find((x) => x.id === id);
  if (!u) throw notFound('Person not found');
  const pin = newPin(ownerPin, users.filter((x) => x !== u));
  u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(pin, u.salt);
  save(users);
  return { user: pub(u), pin };
}
export function removeUser(id) {
  const users = load();
  if (!users.some((u) => u.id === id)) throw notFound('Person not found');
  save(users.filter((u) => u.id !== id));
  return { ok: true };
}
