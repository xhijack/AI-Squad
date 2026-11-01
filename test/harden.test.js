// SPDX-License-Identifier: Apache-2.0
// Browser hardening (1.9): the origin check (Origin, Referer, publicUrl, none at all), the CSP with inline script
// hashes, the security headers with HSTS only in public mode over HTTPS, and declared body sizes. No sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as harden from '../server/harden.js';

const req = (headers) => ({ headers });

test('origin check: allowed from the host the server is reached at or publicUrl', () => {
  const at = { host: 'squad.sopwer.net', publicUrl: 'https://squad.sopwer.net' };
  assert.equal(harden.originAllowed(req({ origin: 'https://squad.sopwer.net' }), at), true);
  assert.equal(harden.originAllowed(req({ origin: 'http://127.0.0.1:8097' }), { host: '127.0.0.1:8097' }), true);
  assert.equal(harden.originAllowed(req({ origin: 'https://squad.sopwer.net' }), { host: '127.0.0.1:8097', publicUrl: 'https://squad.sopwer.net/' }), true, 'publicUrl');
  assert.equal(harden.originAllowed(req({ referer: 'https://squad.sopwer.net/#/floor/web' }), at), true, 'Referer when there is no Origin');
  assert.equal(harden.originAllowed(req({}), at), true, 'not from a browser page: left to the PIN and the session');
});

test('origin check: refused from another site, a lookalike, a port, null and odd schemes', () => {
  const at = { host: 'squad.sopwer.net', publicUrl: '' };
  for (const origin of ['https://evil.example', 'https://squad.sopwer.net.evil.example', 'https://squad.sopwer.net:8443', 'null', 'file://', 'chrome-extension://abc'])
    assert.equal(harden.originAllowed(req({ origin }), at), false, origin);
  assert.equal(harden.originAllowed(req({ referer: 'https://evil.example/x' }), at), false);
  assert.equal(harden.originAllowed(req({ origin: 'https://evil.example', referer: 'https://squad.sopwer.net/' }), at), false, 'Origin wins over Referer');
  assert.equal(harden.originAllowed(req({ origin: 'https://evil.example' }), { host: '' }), false);
});

test('CSP: self only, the page\'s inline scripts by hash, no CDN; the real index.html has its hashes', () => {
  const html = '<script>a()</script><script type="importmap">{"imports":{}}</script><script type="module" src="app.js"></script>';
  const h = harden.scriptHashes(html);
  assert.equal(h.length, 2, 'a script with src needs no hash');
  assert.equal(h[0], `'sha256-${crypto.createHash('sha256').update('a()').digest('base64')}'`);
  const c = harden.csp({ scripts: h });
  for (const part of ["default-src 'self'", `script-src 'self' ${h.join(' ')}`, "frame-ancestors 'none'", "object-src 'none'", "connect-src 'self' blob: data:"]) assert.ok(c.includes(part), part);
  assert.ok(!/https?:/.test(c), 'no outside origin anywhere');
  assert.ok(!c.includes("'unsafe-eval'"));
  const page = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.equal(harden.scriptHashes(page).length, 3, 'theme, import map, boot');
});

test('security headers; HSTS only in public mode over HTTPS; the microphone stays for Voice', () => {
  const h = harden.securityHeaders();
  assert.equal(h['x-frame-options'], 'DENY');
  assert.equal(h['referrer-policy'], 'same-origin');
  assert.match(h['permissions-policy'], /microphone=\(self\)/);
  assert.match(h['permissions-policy'], /camera=\(\)/);
  assert.equal(h['strict-transport-security'], undefined);
  assert.equal(harden.securityHeaders({ isPublic: true })['strict-transport-security'], undefined, 'plain HTTP');
  assert.equal(harden.securityHeaders({ isPublic: true, https: true })['strict-transport-security'], 'max-age=31536000');
});

test('body limits: a declared size over the limit is too large', () => {
  assert.equal(harden.tooLarge(req({ 'content-length': String(harden.BODY_LIMIT + 1) })), true);
  assert.equal(harden.tooLarge(req({ 'content-length': '10' })), false);
  assert.equal(harden.tooLarge(req({})), false, 'chunked: counted while reading');
  assert.equal(harden.tooLarge(req({ 'content-length': '5000000' }), 10e6), false, 'a route\'s own limit');
});
