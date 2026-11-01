// SPDX-License-Identifier: Apache-2.0
// PIN attempt limits (1.9). Per client address: 5 wrong PINs within 15 minutes, then a wait of 5 minutes that doubles
// with each lockout of that address (at most 1 hour); a right PIN clears the address. Across all addresses: 20 wrong
// PINs within a day lock PIN sign-in for the whole Building until the Owner unlocks it on this machine
// (`aisquad unlock`) or from Telegram (/unlock). The daily count and the lock live in ~/.aisquad/lockout.json (0600),
// so a restart neither forgets nor lifts them; the per-address counts are kept in memory.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson } from './util.js';

export const PER_ADDRESS = 5, WINDOW_MS = 15 * 60e3, BASE_WAIT_MS = 5 * 60e3, MAX_WAIT_MS = 3600e3;
export const PER_DAY = 20, DAY_MS = 864e5;
export const file = () => path.join(config.home, 'lockout.json');

const addresses = new Map();                  // ip -> { fails: [ts], level, until, last }
export const reset = () => addresses.clear();  // tests
const loadDaily = () => { const s = readJson(file(), null) || {}; return { fails: Array.isArray(s.fails) ? s.fails : [], locked: s.locked || null }; };
function saveDaily(s) { writeJson(file(), s, 0o600); fs.chmodSync(file(), 0o600); }
export const waitFor = (level) => Math.min(MAX_WAIT_MS, BASE_WAIT_MS * 2 ** level);

// may this address try a PIN now? -> { ok: true } | { ok: false, reason: 'wait' | 'locked', retryAfter (s) }
export function check(ip, now = Date.now()) {
  if (loadDaily().locked) return { ok: false, reason: 'locked', retryAfter: 0 };
  const a = addresses.get(ip);
  if (a && a.until > now) return { ok: false, reason: 'wait', retryAfter: Math.ceil((a.until - now) / 1000) };
  return { ok: true };
}

// a wrong PIN -> { locked: null | 'address' | 'account', until?, wait? } (a new lockout is reported once)
export function fail(ip, now = Date.now()) {
  let a = addresses.get(ip);
  if (!a || now - a.last > DAY_MS) a = { fails: [], level: 0, until: 0, last: now };
  a.fails = a.fails.filter((t) => now - t < WINDOW_MS);
  a.fails.push(now); a.last = now;
  addresses.set(ip, a);
  if (addresses.size > 5000) addresses.delete(addresses.keys().next().value);
  const d = loadDaily();
  d.fails = d.fails.filter((t) => now - t < DAY_MS);
  d.fails.push(now);
  let out = { locked: null };
  if (!d.locked && d.fails.length >= PER_DAY) { d.locked = { at: now, fails: d.fails.length }; out = { locked: 'account' }; }
  else if (a.fails.length >= PER_ADDRESS) { const wait = waitFor(a.level); a.until = now + wait; a.level++; a.fails = []; out = { locked: 'address', until: a.until, wait }; }
  saveDaily(d);
  return out;
}
// a right PIN: this address starts afresh
export const succeed = (ip) => { addresses.delete(ip); };

export function unlock() {
  const d = loadDaily();
  const was = !!d.locked;
  saveDaily({ fails: [], locked: null });
  addresses.clear();
  return { ok: true, wasLocked: was };
}
// for the doctor and the Owner
export function status(now = Date.now()) {
  const d = loadDaily();
  return { locked: !!d.locked, lockedAt: d.locked?.at || null, failsToday: d.fails.filter((t) => now - t < DAY_MS).length, perDay: PER_DAY,
    waiting: [...addresses.values()].filter((a) => a.until > now).length };
}
