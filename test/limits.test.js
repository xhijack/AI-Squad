// SPDX-License-Identifier: Apache-2.0
// PIN attempt limits (1.9) with an injected clock: 5 wrong per address per 15 minutes, a wait that doubles up to an
// hour, a right PIN clears the address, 20 wrong a day lock PIN sign-in until unlocked, and the lock survives a
// restart. Scratch home only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scratch } from './helpers.js';
import * as limits from '../server/limits.js';

scratch({ seed: false });
const T0 = Date.parse('2026-11-01T08:00:00Z'), MIN = 60e3;
beforeEach(() => { limits.reset(); limits.unlock(); });

test('5 wrong PINs from one address: a 5-minute wait; others are not affected', () => {
  for (let i = 0; i < 4; i++) assert.equal(limits.fail('203.0.113.9', T0 + i).locked, null);
  const r = limits.fail('203.0.113.9', T0 + 4);
  assert.equal(r.locked, 'address');
  assert.equal(r.wait, 5 * MIN);
  const c = limits.check('203.0.113.9', T0 + 4 + MIN);
  assert.equal(c.ok, false); assert.equal(c.reason, 'wait'); assert.equal(c.retryAfter, 4 * 60);
  assert.equal(limits.check('198.51.100.4', T0 + MIN).ok, true);
  assert.equal(limits.check('203.0.113.9', T0 + 5 * MIN + 10).ok, true, 'after the wait');
});

test('wrong PINs spread over more than 15 minutes do not add up', () => {
  for (let i = 0; i < 12; i++) assert.equal(limits.fail('203.0.113.9', T0 + i * 4 * MIN).locked, null, `attempt ${i}`);
});

test('the wait doubles with each lockout, at most an hour; a right PIN clears it', () => {
  let t = T0;
  const waits = [];
  for (let round = 0; round < 6; round++) {
    let r; for (let i = 0; i < 5; i++) r = limits.fail('203.0.113.9', t + i);
    waits.push(r.wait / MIN);
    t = r.until + 1;
    fs.rmSync(limits.file());               // keep the daily count out of this test
  }
  assert.deepEqual(waits, [5, 10, 20, 40, 60, 60]);
  limits.succeed('203.0.113.9');
  let r; for (let i = 0; i < 5; i++) r = limits.fail('203.0.113.9', t + i);
  assert.equal(r.wait, 5 * MIN, 'back to the first wait');
});

test('20 wrong PINs a day across addresses lock PIN sign-in until unlocked; the lock survives a restart', () => {
  let r;
  for (let i = 0; i < 20; i++) r = limits.fail(`198.51.100.${i}`, T0 + i * MIN);
  assert.equal(r.locked, 'account');
  assert.equal(limits.check('192.0.2.1', T0 + 30 * MIN).reason, 'locked');
  assert.equal(limits.check('192.0.2.1', T0 + 3 * 864e5).reason, 'locked', 'no time limit');
  limits.reset();                             // a restart forgets the addresses, not the lock
  assert.equal(limits.check('192.0.2.1', T0).reason, 'locked');
  assert.equal(limits.status(T0 + 21 * MIN).locked, true);
  assert.equal(limits.fail('192.0.2.1', T0 + 22 * MIN).locked, null, 'reported once');
  assert.equal(limits.unlock().wasLocked, true);
  assert.equal(limits.check('192.0.2.1', T0 + 23 * MIN).ok, true);
  assert.equal(limits.status(T0 + 23 * MIN).failsToday, 0);
  assert.equal((fs.statSync(limits.file()).mode & 0o777).toString(8), '600');
});

test('the daily count is a rolling day', () => {
  for (let i = 0; i < 19; i++) limits.fail(`198.51.100.${i}`, T0 + i);
  assert.equal(limits.fail('192.0.2.9', T0 + 864e5 + 10).locked, null, 'yesterday\'s wrong PINs have dropped out');
});
