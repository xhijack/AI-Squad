// SPDX-License-Identifier: Apache-2.0
// Online access through the API (1.9), with real sockets on 127.0.0.1 standing in for a proxy: public mode by flag and
// by proxy headers (reads refused without a session, the sign-in page allowed), sessions in a cookie, the PIN header
// only from this machine, attempt limits and the daily lock, the origin check (WebSocket included), security headers,
// body limits, the Owner's second factor with a fake Telegram, Cloudflare Access with a fake key server, Log events.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import { createHandler, forgetOnline } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as building from '../server/building.js';
import * as limits from '../server/limits.js';
import * as squadLog from '../server/log.js';
import * as auth from '../server/auth.js';
import * as users from '../server/users.js';
import { writeJson } from '../server/util.js';

scratch();
const pin = loadPin();
const toOwner = [];
const listen = async (opts) => {
  const h = createHandler({ pin, toOwner: async (text) => { toOwner.push(text); return 1; }, ...opts });
  const s = http.createServer(h); s.on('upgrade', h.upgrade);
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  after(() => s.close());
  return `127.0.0.1:${s.address().port}`;
};
const PUB = await listen({ isPublic: true });
const AUTO = await listen({});
beforeEach(() => { limits.reset(); limits.unlock(); forgetOnline(); });

// one request -> { status, headers, json, text }
function call(host, p, { method = 'GET', headers = {}, body, upgrade = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const r = http.request({ host: host.split(':')[0], port: host.split(':')[1], path: p, method, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, headers: res.headers, json, text: t }); });
    });
    r.on('error', reject);
    if (upgrade) r.on('upgrade', (res, sock) => { sock.destroy(); resolve({ status: 101 }); });
    if (data) r.write(data);
    r.end();
  });
}
// through "the proxy": the client's address and the scheme in headers, as cloudflared or Caddy send them
const via = (ip = '203.0.113.9', more = {}) => ({ 'x-forwarded-for': ip, 'x-forwarded-proto': 'https', host: 'squad.example.com', ...more });
const cookieOf = (r) => String(r.headers['set-cookie']?.[0] || '').split(';')[0];
async function signIn(host, p = pin, headers = via()) { const r = await call(host, '/api/session', { method: 'POST', headers, body: { pin: p } }); return { r, cookie: cookieOf(r) }; }
const events = () => squadLog.read(squadLog.BUILDING, {});

test('public mode by flag: reads refused without a session; the sign-in page and its assets allowed', async () => {
  assert.equal((await call(PUB, '/api/building', { headers: via() })).status, 401);
  assert.equal((await call(PUB, '/api/floors/x', { headers: via() })).status, 401);
  const page = await call(PUB, '/', { headers: via() });
  assert.equal(page.status, 200);
  assert.match(page.text, /id="loginForm"/, 'the sign-in page, not the app');
  for (const f of ['/login.js', '/i18n.js', '/i18n/id.json', '/style.css', '/tokens.css']) assert.equal((await call(PUB, f, { headers: via() })).status, 200, f);
  for (const f of ['/app.js', '/vendor/three/three.module.js', '/office3d.js']) assert.equal((await call(PUB, f, { headers: via() })).status, 401, f);
  const s = await call(PUB, '/api/session', { headers: via() });
  assert.deepEqual([s.status, s.json.signedIn, s.json.public], [200, false, true]);
});

test('public mode by proxy headers: on with the first one and stays on', async () => {
  assert.equal((await call(AUTO, '/api/building')).status, 200, 'a plain local server: reads open');
  assert.equal((await call(AUTO, '/api/building', { headers: { 'cf-connecting-ip': '198.51.100.4' } })).status, 401);
  assert.equal((await call(AUTO, '/api/building')).status, 401, 'stays on until a restart');
  assert.equal((await call(AUTO, '/api/building', { headers: { 'x-aisquad-pin': pin } })).status, 200, 'a tool on this machine still uses the PIN header');
});

test('sign in: a session cookie (HttpOnly, Secure, SameSite=Strict) opens reads; the PIN header from outside does not', async () => {
  assert.equal((await call(PUB, '/api/building', { headers: via('203.0.113.9', { 'x-aisquad-pin': pin }) })).status, 401, 'no PIN header through the proxy');
  const { r, cookie } = await signIn(PUB);
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, 'owner');
  const set = r.headers['set-cookie'][0];
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(set.includes(part), part);
  assert.ok(!set.includes(pin), 'the cookie is not the PIN');
  const b = await call(PUB, '/api/building', { headers: via('203.0.113.9', { cookie }) });
  assert.equal(b.status, 200);
  assert.equal(b.headers['cache-control'], 'no-store', 'no shared caching of what needs a session');
  assert.equal((await call(PUB, '/app.js', { headers: via('203.0.113.9', { cookie }) })).status, 200, 'the app once signed in');
  const lan = await signIn(PUB, pin, { host: '192.168.1.10:8097' });
  assert.ok(!lan.r.headers['set-cookie'][0].includes('Secure'), 'directly over plain HTTP (the LAN): no Secure, or the browser drops it');
  const ev = events().filter((e) => e.type === 'auth.signed_in').at(-1);
  assert.equal(ev.data.role, 'owner');
  assert.ok(!JSON.stringify(events()).includes(pin), 'the Log never has the PIN');
});

test('sign out on one device; sign out everywhere (Owner only); a removed person\'s sessions end', async () => {
  const a = (await signIn(PUB)).cookie, b = (await signIn(PUB)).cookie;
  assert.equal((await call(PUB, '/api/session', { method: 'DELETE', headers: via('203.0.113.9', { cookie: a, origin: 'https://squad.example.com' }) })).status, 200);
  assert.equal((await call(PUB, '/api/building', { headers: via('203.0.113.9', { cookie: a }) })).status, 401);
  assert.equal((await call(PUB, '/api/building', { headers: via('203.0.113.9', { cookie: b }) })).status, 200);
  const m = users.addUser({ name: 'Rina', role: 'member' }, pin);
  const rc = (await signIn(PUB, m.pin)).cookie;
  assert.equal((await call(PUB, '/api/sessions/revoke-all', { method: 'POST', headers: via('203.0.113.9', { cookie: rc }) })).status, 403);
  assert.equal((await call(PUB, `/api/users/${m.user.id}`, { method: 'DELETE', headers: { 'x-aisquad-pin': pin } })).status, 200);
  assert.equal((await call(PUB, '/api/building', { headers: via('203.0.113.9', { cookie: rc }) })).status, 401, 'removed: signed out');
  const all = await call(PUB, '/api/sessions/revoke-all', { method: 'POST', headers: via('203.0.113.9', { cookie: b }) });
  assert.equal(all.status, 200);
  assert.equal((await call(PUB, '/api/building', { headers: via('203.0.113.9', { cookie: b }) })).status, 401);
  assert.ok(events().some((e) => e.type === 'auth.signed_out' && e.data.everywhere));
});

test('attempt limits: 5 wrong PINs, then a wait (429 with Retry-After); the Owner is told; the right PIN waits too', async () => {
  toOwner.length = 0;
  for (let i = 0; i < 4; i++) assert.equal((await signIn(PUB, '000000', via('198.51.100.7'))).r.status, 401);
  const r = (await signIn(PUB, '000000', via('198.51.100.7'))).r;             // the fifth says how long to wait
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers['retry-after']) > 200);
  assert.equal((await signIn(PUB, pin, via('198.51.100.7'))).r.status, 429, 'no guessing during the wait');
  assert.equal((await signIn(PUB, pin, via('198.51.100.8'))).r.status, 200, 'another address is not affected');
  await new Promise((ok) => setImmediate(ok));
  assert.match(toOwner.join('\n'), /5 wrong PINs from 198\.51\.100\.7/);
  const ev = events();
  assert.ok(ev.some((e) => e.type === 'auth.failed' && e.data.ip === '198.51.100.7'));
  assert.ok(ev.some((e) => e.type === 'auth.locked' && e.data.scope === 'address'));
});

test('20 wrong PINs a day lock PIN sign-in for everyone until unlocked; tools on this machine keep working', async () => {
  toOwner.length = 0;
  for (let i = 0; i < 20; i++) await signIn(PUB, '000000', via(`192.0.2.${i}`));
  const r = (await signIn(PUB, pin, via('192.0.2.200'))).r;
  assert.equal(r.status, 429);
  assert.equal(r.json.locked, true);
  assert.match(r.json.error, /aisquad unlock/);
  assert.equal((await call(PUB, '/api/building', { headers: { 'x-aisquad-pin': pin } })).status, 200, 'agent hooks and the command line are on the machine');
  await new Promise((ok) => setImmediate(ok));
  assert.match(toOwner.join('\n'), /locked for everyone/);
  limits.unlock();
  assert.equal((await signIn(PUB, pin, via('192.0.2.200'))).r.status, 200);
});

test('origin check on changes and on a WebSocket upgrade', async () => {
  const { cookie } = await signIn(PUB);
  const h = (origin) => via('203.0.113.9', { cookie, ...(origin ? { origin } : {}) });
  assert.equal((await call(PUB, '/api/building', { method: 'PATCH', headers: h('https://evil.example'), body: { name: 'x' } })).status, 403);
  assert.equal((await call(PUB, '/api/building', { method: 'PATCH', headers: h('https://squad.example.com'), body: { name: 'Sopwer HQ' } })).status, 200);
  assert.equal(building.loadBuilding().name, 'Sopwer HQ');
  building.setPrefs({ publicUrl: 'https://squad.sopwer.net' }); forgetOnline();
  assert.equal((await call(PUB, '/api/building', { method: 'PATCH', headers: h('https://squad.sopwer.net'), body: { name: 'Sopwer' } })).status, 200, 'publicUrl');
  const ws = (headers) => call(PUB, '/ws', { headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': crypto.randomBytes(16).toString('base64'), ...headers }, upgrade: true });
  assert.equal((await ws(h('https://evil.example'))).status, 403);
  assert.equal((await ws(via('203.0.113.9', { origin: 'https://squad.example.com' }))).status, 401, 'no session');
  assert.equal((await ws(h('https://squad.example.com'))).status, 404, 'signed in: there is no stream to upgrade to');
});

test('security headers on every answer; HSTS in public mode over HTTPS; the page\'s CSP allows its own scripts only', async () => {
  const r = await call(PUB, '/api/session', { headers: via() });
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['referrer-policy'], 'same-origin');
  assert.match(r.headers['permissions-policy'], /microphone=\(self\)/);
  assert.equal(r.headers['strict-transport-security'], 'max-age=31536000');
  assert.equal((await call(AUTO, '/api/version', { headers: { 'x-aisquad-pin': pin } })).headers['strict-transport-security'], undefined, 'no HTTPS in front');
  const { cookie } = await signIn(PUB);
  const page = await call(PUB, '/', { headers: via('203.0.113.9', { cookie }) });
  assert.match(page.headers['content-security-policy'], /script-src 'self' 'sha256-[^']+' 'sha256-[^']+' 'sha256-[^']+'/);
  assert.ok(!/https?:\/\//.test(page.headers['content-security-policy']));
});

test('body limits: 413 beyond them', async () => {
  const big = JSON.stringify({ name: 'x'.repeat(1100 * 1024) });
  assert.equal((await call(PUB, '/api/building', { method: 'PATCH', headers: { 'x-aisquad-pin': pin }, body: big })).status, 413);
  assert.equal((await call(PUB, '/api/session', { method: 'POST', headers: via(), body: big })).status, 413, 'also before signing in');
});

test('the Owner\'s second factor in public mode (a fake Telegram): owner-level routes wait for the code', async () => {
  auth.writeSecret('telegram', { token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1', bot: 'b' });
  writeJson(path.join(config.home, 'notify.json'), { chats: [{ chatId: 111, userId: 'owner', name: 'Owner' }] }, 0o600);
  toOwner.length = 0;
  const { r, cookie } = await signIn(PUB);
  assert.equal(r.json.secondFactor, 'sent');
  const code = toOwner.join('\n').match(/\b(\d{6})\b/)[1];
  const h = via('203.0.113.9', { cookie });
  const u = await call(PUB, '/api/users', { headers: h });
  assert.deepEqual([u.status, u.json.secondFactor], [401, true]);
  assert.equal((await call(PUB, '/api/building', { headers: h })).status, 200, 'the work is not owner-level');
  assert.equal((await call(PUB, '/api/session/verify', { method: 'POST', headers: h, body: { code: code === '000000' ? '111111' : '000000' } })).status, 401);
  assert.equal((await call(PUB, '/api/session/verify', { method: 'POST', headers: h, body: { code } })).status, 200);
  assert.equal((await call(PUB, '/api/users', { headers: h })).status, 200);
  assert.equal((await call(PUB, '/api/session', { headers: h })).json.secondFactor, 'done');
  assert.ok(events().some((e) => e.type === 'auth.signed_in' && e.data.secondFactor));
  assert.equal((await call(PUB, '/api/users', { headers: { 'x-aisquad-pin': pin } })).status, 200, 'the command line on this machine: no code');
  fs.rmSync(path.join(config.home, 'notify.json'));
});

test('Cloudflare Access: a valid team token on every request through the tunnel; its e-mail in the Log', async () => {
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...kp.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
  const fetchFn = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  const CF = await listen({ isPublic: true, fetchFn });
  building.setPrefs({ cfAccess: { teamDomain: 'sopwer.cloudflareaccess.com', aud: 'aud-1' } }); forgetOnline();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', kid: 'k1' }), body = b64({ iss: 'https://sopwer.cloudflareaccess.com', aud: ['aud-1'], email: 'sinta@sopwer.net', exp: Math.floor(Date.now() / 1000) + 600 });
  const jwt = `${head}.${body}.${crypto.sign('sha256', Buffer.from(`${head}.${body}`), kp.privateKey).toString('base64url')}`;
  assert.equal((await call(CF, '/', { headers: via() })).status, 403, 'not even the sign-in page without Access');
  assert.equal((await call(CF, '/', { headers: via('203.0.113.9', { 'cf-access-jwt-assertion': 'x.y.z' }) })).status, 403);
  const { r } = await signIn(CF, pin, via('203.0.113.9', { 'cf-access-jwt-assertion': jwt }));
  assert.equal(r.status, 200, 'the PIN is still needed behind Access');
  assert.equal(events().filter((e) => e.type === 'auth.signed_in').at(-1).data.email, 'sinta@sopwer.net');
  assert.equal((await call(CF, '/api/building', { headers: { 'x-aisquad-pin': pin } })).status, 200, 'a tool on this machine does not come through the tunnel');
  building.setPrefs({ cfAccess: null }); forgetOnline();
});
