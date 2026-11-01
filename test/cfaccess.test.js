// SPDX-License-Identifier: Apache-2.0
// Cloudflare Access check (1.9): tokens signed by a key pair made here, served by a fake certs endpoint (no network);
// audience, issuer, expiry, signature and algorithm are checked; keys are cached and fetched again only when they
// rotate. The clock is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as cf from '../server/cfaccess.js';

const TEAM = 'sopwer.cloudflareaccess.com', AUD = 'a1b2c3d4e5';
const T0 = Date.parse('2026-11-01T08:00:00Z');
const pair = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const k1 = pair(), k2 = pair();
const jwk = (k, kid) => ({ ...k.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims, { key = k1, kid = 'k1', alg = 'RS256' } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' }), body = b64(claims);
  return `${head}.${body}.${crypto.sign('sha256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url')}`;
}
const good = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: 'sinta@sopwer.net', sub: 'u1', iat: T0 / 1000, exp: T0 / 1000 + 3600, ...over });
function fakeCerts(sets) {
  const calls = [];
  const fetchFn = async (url) => { calls.push(url); return { ok: true, json: async () => ({ keys: sets[Math.min(calls.length - 1, sets.length - 1)] }) }; };
  return { fetchFn, calls };
}

test('settings: team domain and audience are both needed', () => {
  assert.equal(cf.cleanCfAccess({}), null);
  assert.equal(cf.cleanCfAccess({ teamDomain: TEAM }), null);
  assert.deepEqual(cf.cleanCfAccess({ teamDomain: `https://${TEAM}/`, aud: AUD }), { teamDomain: TEAM, aud: AUD });
});

test('a valid token: the e-mail comes back; the keys are fetched once and cached', async () => {
  const f = fakeCerts([[jwk(k1, 'k1')]]);
  let now = T0;
  const v = cf.verifier({ teamDomain: TEAM, aud: AUD }, { fetchFn: f.fetchFn, now: () => now });
  assert.deepEqual(await v.verify(sign(good())), { email: 'sinta@sopwer.net', sub: 'u1' });
  now += 10 * 60e3;
  await v.verify(sign(good()));
  assert.deepEqual(f.calls, [`https://${TEAM}/cdn-cgi/access/certs`]);
});

test('refused: wrong audience, wrong issuer, expired, not yet valid, bad signature, other algorithm, garbage', async () => {
  const f = fakeCerts([[jwk(k1, 'k1')]]);
  const v = cf.verifier({ teamDomain: TEAM, aud: AUD }, { fetchFn: f.fetchFn, now: () => T0 });
  const no = async (tok, re) => assert.rejects(v.verify(tok), re);
  await no(sign(good({ aud: ['other-app'] })), /audience/);
  await no(sign(good({ iss: 'https://evil.cloudflareaccess.com' })), /issuer/);
  await no(sign(good({ exp: T0 / 1000 - 3600 })), /Expired/);
  await no(sign(good({ nbf: T0 / 1000 + 3600 })), /not valid yet/);
  await no(sign(good(), { key: k2 }), /signature/);
  await no(sign(good(), { alg: 'none' }), /algorithm/);
  await no('', /No Cloudflare Access token/);
  await no('a.b.c', /Unreadable/);
});

test('rotated keys: an unknown key id looks again, but not on every request', async () => {
  const f = fakeCerts([[jwk(k1, 'k1')], [jwk(k1, 'k1'), jwk(k2, 'k2')]]);
  let now = T0;
  const v = cf.verifier({ teamDomain: TEAM, aud: AUD }, { fetchFn: f.fetchFn, now: () => now });
  await v.verify(sign(good()));
  await assert.rejects(v.verify(sign(good(), { key: k2, kid: 'k2' })), /Unknown signing key/);
  assert.equal(f.calls.length, 1, 'within 5 minutes: no new fetch');
  now += 6 * 60e3;
  assert.equal((await v.verify(sign(good({ exp: now / 1000 + 600 }), { key: k2, kid: 'k2' }))).email, 'sinta@sopwer.net');
  assert.equal(f.calls.length, 2);
});
