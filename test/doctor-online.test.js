// SPDX-License-Identifier: Apache-2.0
// The doctor on online access (1.9): a non-loopback address without public mode, public mode without HTTPS in front,
// the session store's mode, the PIN lock, the Owner's second factor; and the server's view at GET /api/online.
// Scratch home; /proc and the disk are what readResources sees, which these checks do not use.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { scratch } from './helpers.js';
import { runDoctor } from '../server/doctor.js';
import * as sessions from '../server/sessions.js';
import * as limits from '../server/limits.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';

scratch();
const T0 = Date.parse('2026-11-01T08:00:00Z');
const check = (r, id) => r.checks.find((c) => c.id === id);
const base = { host: '127.0.0.1', public: false, reason: '', proxied: 0, https: 0, plain: 0, ownerPaired: false, cfAccess: '' };

test('bound off loopback without public mode: a warning; loopback or public: fine', () => {
  assert.equal(check(runDoctor({ online: { ...base, host: '0.0.0.0' }, now: T0 }), 'online-bind').status, 'warn');
  assert.equal(check(runDoctor({ online: base, now: T0 }), 'online-bind').status, 'ok');
  assert.equal(check(runDoctor({ online: { ...base, host: '0.0.0.0', public: true, reason: 'proxy-headers' }, now: T0 }), 'online-bind').status, 'ok');
  assert.equal(check(runDoctor({ now: T0 }), 'online-bind'), undefined, 'server not running: nothing to say');
});

test('public mode: HTTPS in front, the second factor, Cloudflare Access', () => {
  const pub = { ...base, public: true, reason: 'flag' };
  assert.equal(check(runDoctor({ online: { ...pub, proxied: 10, https: 7, plain: 3 }, now: T0 }), 'online-https').status, 'warn');
  assert.equal(check(runDoctor({ online: { ...pub, proxied: 10, https: 10 }, now: T0 }), 'online-https').status, 'ok');
  assert.equal(check(runDoctor({ online: pub, now: T0 }), 'second-factor').status, 'warn');
  assert.equal(check(runDoctor({ online: { ...pub, ownerPaired: true, cfAccess: 'sopwer.cloudflareaccess.com' }, now: T0 }), 'cf-access').status, 'ok');
  assert.equal(check(runDoctor({ online: base, now: T0 }), 'online-https'), undefined);
});

test('the session store must be mode 600; the PIN lock shows with its fix', () => {
  sessions.create({ id: 'owner' }, {}, T0);
  assert.equal(check(runDoctor({ now: T0 }), 'sessions').status, 'ok');
  fs.chmodSync(sessions.file(), 0o644);
  const s = check(runDoctor({ now: T0 }), 'sessions');
  assert.equal(s.status, 'fail'); assert.match(s.fix, /chmod 600/);
  fs.chmodSync(sessions.file(), 0o600);
  assert.equal(check(runDoctor({ now: T0 }), 'lockout').status, 'ok');
  for (let i = 0; i < limits.PER_DAY; i++) limits.fail(`198.51.100.${i}`, T0 + i);
  const l = check(runDoctor({ now: T0 + 1000 }), 'lockout');
  assert.equal(l.status, 'fail'); assert.match(l.fix, /aisquad unlock/);
  limits.unlock();
});

test('GET /api/online: the bound address, public mode and what came through the proxy (Owner only)', async () => {
  const pin = loadPin();
  const s = http.createServer(createHandler({ pin, host: '127.0.0.1' }));
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  after(() => s.close());
  const url = `http://127.0.0.1:${s.address().port}`;
  const get = (headers) => fetch(`${url}/api/online`, { headers }).then(async (r) => ({ status: r.status, j: await r.json() }));
  let r = await get({ 'x-aisquad-pin': pin });
  assert.deepEqual([r.status, r.j.host, r.j.public, r.j.proxied], [200, '127.0.0.1', false, 0]);
  await fetch(`${url}/api/session`, { headers: { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'http' } });
  r = await get({ 'x-aisquad-pin': pin });
  assert.deepEqual([r.j.public, r.j.reason, r.j.proxied, r.j.plain], [true, 'proxy-headers', 1, 1]);
  assert.equal(check(runDoctor({ online: r.j }), 'online-https').status, 'warn');
});
