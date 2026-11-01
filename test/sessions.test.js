// SPDX-License-Identifier: Apache-2.0
// Sign-in sessions (1.9): create, idle and absolute expiry with an injected clock, sign out, sign out everywhere,
// the store keeps only hashes (mode 600), and the cookie's attributes. Scratch home only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scratch } from './helpers.js';
import * as sessions from '../server/sessions.js';

scratch({ seed: false });
const T0 = Date.parse('2026-11-01T08:00:00Z');
const owner = { id: 'owner', role: 'owner' }, rina = { id: 'rina', role: 'member' };

test('create and look up; the store holds only the hash of the id, mode 600', () => {
  const id = sessions.create(owner, { ip: '203.0.113.9', email: 'sinta@example.com' }, T0);
  assert.ok(id.length >= 40);
  const s = sessions.lookup(id, T0 + 1000);
  assert.equal(s.userId, 'owner');
  assert.equal(s.ip, '203.0.113.9');
  const text = fs.readFileSync(sessions.file(), 'utf8');
  assert.ok(!text.includes(id), 'the id itself is never stored');
  assert.equal(sessions.fileMode(), '600');
  assert.equal(sessions.lookup('nope', T0), null);
  assert.equal(sessions.lookup('', T0), null);
  sessions.forget();
  assert.equal(sessions.lookup(id, T0 + 2000).userId, 'owner', 'survives a restart');
});

test('idle expiry after 12 h without use; use moves the clock; absolute expiry after 7 days', () => {
  const id = sessions.create(owner, {}, T0);
  assert.ok(sessions.lookup(id, T0 + sessions.IDLE_MS - 1000));
  assert.ok(sessions.lookup(id, T0 + 2 * sessions.IDLE_MS - 2000), 'the last use counts, not the start');
  const idle = sessions.create(owner, {}, T0);
  assert.equal(sessions.lookup(idle, T0 + sessions.IDLE_MS), null);
  const busy = sessions.create(owner, {}, T0);
  let t = T0;
  for (; t < T0 + sessions.MAX_MS - 3600e3; t += 6 * 3600e3) assert.ok(sessions.lookup(busy, t), new Date(t).toISOString());
  assert.equal(sessions.lookup(busy, T0 + sessions.MAX_MS), null, 'in use all week, still ends at 7 days');
});

test('sign out one device; sign out everywhere; one person only', () => {
  const a = sessions.create(owner, {}, T0), b = sessions.create(owner, {}, T0), c = sessions.create(rina, {}, T0);
  assert.equal(sessions.revoke(a), true);
  assert.equal(sessions.lookup(a, T0), null);
  assert.ok(sessions.lookup(b, T0));
  assert.equal(sessions.revokeAll({ userId: 'rina' }) >= 1, true);
  assert.equal(sessions.lookup(c, T0), null);
  assert.ok(sessions.lookup(b, T0));
  sessions.create(rina, {}, T0);
  sessions.revokeAll();
  assert.equal(sessions.lookup(b, T0), null);
  assert.equal(sessions.count(T0), 0);
});

test('second factor mark; the cookie: HttpOnly, SameSite=Strict, Path=/, Secure when asked', () => {
  const id = sessions.create(owner, {}, T0);
  const s = sessions.lookup(id, T0);
  assert.equal(s.secondAt, 0);
  sessions.markSecond(s.key, T0 + 5);
  assert.equal(sessions.lookup(id, T0 + 10).secondAt, T0 + 5);
  const c = sessions.cookie(id, { secure: true });
  for (const part of [`aisquad_sid=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Max-Age=604800']) assert.ok(c.includes(part), part);
  assert.ok(!sessions.cookie(id).includes('Secure'));
  assert.ok(sessions.clearCookie().includes('Max-Age=0'));
  assert.equal(sessions.idFrom({ headers: { cookie: `theme=dark; aisquad_sid=${id}; x=1` } }), id);
  assert.equal(sessions.idFrom({ headers: {} }), '');
});
