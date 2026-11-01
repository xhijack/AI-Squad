// SPDX-License-Identifier: Apache-2.0
// Sign-in sessions (1.9): after the PIN the browser gets a random session id in a cookie (HttpOnly, SameSite=Strict,
// Secure in public mode or over HTTPS); the PIN never stays in the browser. The server keeps only the SHA-256 of each
// id in ~/.aisquad/sessions.json (mode 600). A session ends after 12 h without use and after 7 days at most, on sign
// out, when the Owner signs everyone out, or when its person is removed or gets a new PIN.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, writeJson } from './util.js';

export const COOKIE = 'aisquad_sid';
export const IDLE_MS = 12 * 3600e3, MAX_MS = 7 * 864e5;
const TOUCH_MS = 60e3;                         // lastSeen reaches the disk at most once a minute per session
export const file = () => path.join(config.home, 'sessions.json');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

let cache = { file: '', map: null };
function load() {
  if (cache.file !== file() || !cache.map) {
    const s = readJson(file(), null);
    cache = { file: file(), map: new Map(Object.entries(s?.sessions && typeof s.sessions === 'object' ? s.sessions : {})) };
  }
  return cache.map;
}
function save() {
  writeJson(file(), { sessions: Object.fromEntries(load()) }, 0o600);
  fs.chmodSync(file(), 0o600);
}
export const forget = () => { cache = { file: '', map: null }; };       // tests: read the file again

const alive = (s, now) => now - s.lastSeen < IDLE_MS && now - s.createdAt < MAX_MS;
function prune(now) { let n = 0; for (const [k, s] of load()) if (!alive(s, now)) { load().delete(k); n++; } return n; }

// -> the session id (shown once, to the browser's cookie)
export function create(user, { ip = '', email = '' } = {}, now = Date.now()) {
  prune(now);
  const id = crypto.randomBytes(32).toString('base64url');
  load().set(sha(id), { userId: user.id, createdAt: now, lastSeen: now, ip: String(ip).slice(0, 64), email: String(email).slice(0, 120), secondAt: 0 });
  save();
  return id;
}
// -> { key, userId, createdAt, lastSeen, ip, email, secondAt } | null; a use moves the idle clock
export function lookup(id, now = Date.now()) {
  if (!id || typeof id !== 'string' || id.length > 100) return null;
  const key = sha(id), s = load().get(key);
  if (!s) return null;
  if (!alive(s, now)) { load().delete(key); save(); return null; }
  const stale = now - s.lastSeen >= TOUCH_MS;
  s.lastSeen = now;
  if (stale) save();
  return { key, ...s };
}
export function revoke(id) { const had = load().delete(sha(id)); if (had) save(); return had; }
// everyone (no userId), or every session of one person
export function revokeAll({ userId = null } = {}) {
  let n = 0;
  for (const [k, s] of load()) if (!userId || s.userId === userId) { load().delete(k); n++; }
  save();
  return n;
}
// the Owner's second factor was checked in this session
export function markSecond(key, now = Date.now()) { const s = load().get(key); if (s) { s.secondAt = now; save(); } return !!s; }
export function count(now = Date.now()) { return [...load().values()].filter((s) => alive(s, now)).length; }
// the store's file mode, for the doctor: '600' when right, null when there is no store yet
export function fileMode() { try { return (fs.statSync(file()).mode & 0o777).toString(8); } catch { return null; } }

// ---------- the cookie ----------
export function idFrom(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
export const cookie = (id, { secure = false } = {}) => `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_MS / 1000}${secure ? '; Secure' : ''}`;
export const clearCookie = ({ secure = false } = {}) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
