// SPDX-License-Identifier: Apache-2.0
// The Google connector (1.8), without network: a fake of every endpoint on 127.0.0.1, an injected clock and a key
// made here. JWT signing and the token cache, the key's file mode and what the browser sees, properties per Space and
// the Owner fallback, every bounded call with its limits and its errors in plain words, a 429 with backoff, an
// oversized reply, a hanging server, the AI-referrals filter, the GSC lag window and Test with how to grant access.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import * as building from '../server/building.js';
import * as g from '../server/google.js';
import { fakeGoogle } from './fixtures/fake-google.js';

const root = scratch();
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = { type: 'service_account', project_id: 'acme-seo', private_key_id: 'k1', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: 'aisquad@acme-seo.iam.gserviceaccount.com', client_id: '1', token_uri: 'https://oauth2.googleapis.com/token', auth_uri: 'x' };
const F = fakeGoogle({ publicKey });
const base = await F.listen();
g.setBase(base);
after(() => { F.close(); g.setBase(null); });
let clock = new Date(2026, 10, 1, 10, 0).getTime();          // Sunday 1 Nov 2026, 10:00 local
const slept = [];
Object.assign(g.deps, { now: () => clock, sleep: async (ms) => { slept.push(ms); }, connectMs: 500, callMs: 800 });
const space = (access = 'team') => { const p = path.join(root, `space-${access}`); fs.mkdirSync(path.join(p, '.claude', 'aisquad'), { recursive: true }); return { id: `s-${access}`, path: p, access }; };
const S = space();
const logs = [];
g.deps.log = (id, ev) => logs.push({ id, ...ev });

test('the key: validated, kept 0600 in secrets.json, only the client e-mail shown', () => {
  assert.throws(() => g.setServiceAccount('not json'), /Upload the JSON key file/);
  assert.throws(() => g.setServiceAccount({ type: 'authorized_user', client_email: 'a@b' }), /not a service account key/);
  assert.throws(() => g.setServiceAccount({ ...KEY, private_key: '-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----' }), /cannot be read/);
  assert.equal(g.status().set, false);
  const st = g.setServiceAccount(JSON.stringify(KEY));
  assert.deepEqual([st.set, st.clientEmail, st.projectId], [true, KEY.client_email, 'acme-seo']);
  assert.ok(!JSON.stringify(st).includes('PRIVATE KEY'), 'the status never carries the key');
  const f = path.join(config.home, 'secrets.json');
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  const saved = JSON.parse(fs.readFileSync(f, 'utf8')).google.serviceAccount;
  assert.equal(saved.client_email, KEY.client_email);
  assert.equal(saved.auth_uri, undefined, 'only the fields a sign-in needs are kept');
  assert.deepEqual(g.setKey('psi', 'psi-key-0123456789').psiKey, true);
  assert.throws(() => g.setKey('psi', 'has spaces in it'), /API key/);
  assert.equal(g.setKey('psi', '').psiKey, false);
});

test('JWT: RS256 over read-only scopes, verified with the public key; the token is cached until shortly before it expires', async () => {
  const jwt = g.signJwt(KEY, clock);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT', kid: 'k1' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly');
  assert.deepEqual([claims.iss, claims.aud, claims.exp - claims.iat], [KEY.client_email, 'https://oauth2.googleapis.com/token', 3600]);
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url')));
  g.forgetTokens(); F.state.tokens = 0;
  assert.equal(await g.accessToken(), 'tok-1');
  clock += 50 * 60e3;
  assert.equal(await g.accessToken(), 'tok-1', 'still valid: cached');
  clock += 6 * 60e3;                                   // 56 minutes: less than 5 minutes left
  assert.equal(await g.accessToken(), 'tok-2', 'renewed before it expires');
  assert.equal(F.state.tokens, 2);
  assert.ok(F.calls.filter((x) => x.path === '/token').every((x) => x.claims.scope.split(' ').every((sc) => sc.endsWith('.readonly'))));
  clock = new Date(2026, 10, 1, 10, 0).getTime();
  g.forgetTokens();
});

test('a refused sign-in in plain words', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  g.setServiceAccount({ ...KEY, private_key: other });
  await assert.rejects(g.accessToken(), /Google refused the service account's sign-in: Invalid JWT Signature/);
  g.setServiceAccount(KEY);
});

test('properties per Space: checked, committed as ids only; an Owner-only Space falls back to the Owner\'s, a team Space never', () => {
  assert.throws(() => g.saveProps(S.path, { gscSite: 'example.com' }), /sc-domain:example.com/);
  assert.throws(() => g.saveProps(S.path, { ga4Property: 'G-ABC123' }), /not the G- measurement id/);
  assert.throws(() => g.saveProps(S.path, { siteUrl: 'https://x.com/blog' }), /home page/);
  assert.deepEqual(g.saveProps(S.path, { gscSite: 'sc-domain:example.com', ga4Property: 'properties/312345678', siteUrl: base }), { gscSite: 'sc-domain:example.com', ga4Property: '312345678', siteUrl: base, indexNowKey: '' });
  const text = fs.readFileSync(path.join(S.path, '.claude', 'aisquad', 'google.json'), 'utf8');
  assert.doesNotMatch(text, /PRIVATE|client_email|token/);
  g.saveOwnerProps({ gscSite: 'sc-domain:owner.example', ga4Property: '99999999' });
  const O = space('owner'), T = space('team2');
  assert.equal(g.propsFor(O).gscSite, 'sc-domain:owner.example');
  g.saveProps(O.path, { ga4Property: '312345678' });
  assert.deepEqual([g.propsFor(O).gscSite, g.propsFor(O).ga4Property], ['sc-domain:owner.example', '312345678'], 'its own first, the Owner\'s for the rest');
  T.access = 'team';
  assert.equal(g.propsFor(T).gscSite, '', 'a team Space never reads the Owner\'s properties');
  assert.equal(building.loadBuilding().prefs.google.gscSite, 'sc-domain:owner.example');
});

test('gsc.performance: bounded, lagging two days, filtered for the top 10', async () => {
  assert.throws(() => g.cleanArgs('gsc.performance', { rowLimit: 5001 }), /Rows: 1 to 5,000/);
  assert.throws(() => g.cleanArgs('gsc.performance', { dimensions: ['query', 'hour'] }), /not hour/);
  assert.throws(() => g.cleanArgs('gsc.performance', { searchType: 'shopping' }), /web, news, image, video, discover/);
  assert.throws(() => g.cleanArgs('gsc.query', {}), /Google call:/);
  const all = await g.call(S, 'gsc.performance', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([all.from, all.to, all.totals.clicks, all.totals.impressions], ['2026-10-01', '2026-10-30', 120, 5400], 'ends at today − 2');
  const q = F.calls.findLast((x) => x.path.endsWith('/searchAnalytics/query'));
  assert.equal(q.path, '/gsc/webmasters/v3/sites/sc-domain:example.com/searchAnalytics/query');
  assert.deepEqual([q.body.startDate, q.body.endDate, q.body.type, q.body.rowLimit], ['2026-10-01', '2026-10-30', 'web', 1000]);
  const top = await g.call(S, 'gsc.performance', { dimensions: ['query'], rowLimit: 5000, minImpressions: 10, maxPosition: 10 });
  assert.deepEqual(top.rows.map((r) => r.query), ['erp indonesia', 'erpnext hosting']);
  assert.equal(top.count, 2);
  assert.deepEqual([top.from, top.to], ['2026-10-03', '2026-10-30'], 'default: the last 28 days of data');
  await assert.rejects(g.call(S, 'gsc.performance', { from: '2026-11-01', to: '2026-11-30' }), /No Search Console data yet for 2026-11-01..2026-11-30: it lags about 2 days/);
  await assert.rejects(g.call(S, 'gsc.performance', { from: '2025-01-01', to: '2026-10-01' }), /At most 16 months/);
});

test('the GSC lag window for a target\'s period', () => {
  assert.deepEqual(g.windowFor('gsc.performance', { from: '2026-11-01', to: '2026-11-30' }, clock), { from: '2026-11-01', to: '2026-10-30', lag: true, empty: true });
  assert.deepEqual(g.windowFor('gsc.performance', { from: '2026-10-01', to: '2026-10-31' }, clock), { from: '2026-10-01', to: '2026-10-30', lag: true, empty: false });
  assert.deepEqual(g.windowFor('ga4.report', { from: '2026-11-01', to: '2026-11-30' }, clock), { from: '2026-11-01', to: '2026-11-30', lag: false, empty: false });
  assert.equal(g.windowFor('gsc.performance', { from: '2026-10-01', to: '2026-10-20' }, clock).lag, false, 'a past range is not cut');
});

test('gsc.inspect: at most 20 URLs per call', async () => {
  assert.throws(() => g.cleanArgs('gsc.inspect', { urls: Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`) }), /at most 20 URLs per call/);
  assert.throws(() => g.cleanArgs('gsc.inspect', { urls: ['ftp://x'] }), /Not a URL/);
  const r = await g.call(S, 'gsc.inspect', { urls: ['https://example.com/', 'https://example.com/new'] });
  assert.deepEqual(r.results.map((x) => x.verdict), ['PASS', 'NEUTRAL']);
  assert.equal(r.results[1].coverageState, 'Discovered - currently not indexed');
});

test('ga4.report: allow-listed metrics and dimensions, one exact filter, at most 1,000 rows', async () => {
  assert.throws(() => g.cleanArgs('ga4.report', { metrics: ['revenue'] }), /Metrics: sessions, engagedSessions, keyEvents, conversions, totalUsers \(not revenue\)/);
  assert.throws(() => g.cleanArgs('ga4.report', { dimensions: ['city'] }), /not city/);
  assert.throws(() => g.cleanArgs('ga4.report', { limit: 1001 }), /Rows: 1 to 1,000/);
  assert.throws(() => g.cleanArgs('ga4.report', { where: { city: 'Jakarta' } }), /Filter: one of/);
  assert.throws(() => g.cleanArgs('ga4.report', { where: { country: 'ID', deviceCategory: 'mobile' } }), /one dimension/);
  const r = await g.call(S, 'ga4.report', { metrics: ['sessions', 'keyEvents'], from: '2026-10-01', to: '2026-10-31', where: { sessionDefaultChannelGroup: 'Organic Search' } });
  assert.deepEqual(r.totals, { sessions: 640, keyEvents: 25 });
  const q = F.calls.findLast((x) => x.path.endsWith(':runReport'));
  assert.equal(q.path, '/ga4/v1beta/properties/312345678:runReport');
  assert.deepEqual(q.body.dimensionFilter, { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search' } } });
  assert.equal(q.body.limit, 100);
});

test('ga4.aiReferrals: per assistant and in total, only the allow-list (a look-alike domain does not count)', async () => {
  assert.equal(g.assistantOf('www.perplexity.ai'), 'perplexity.ai');
  assert.equal(g.assistantOf('notchatgpt.com'), '');
  assert.equal(g.assistantOf('https://chat.openai.com/'), 'chat.openai.com');
  const r = await g.call(S, 'ga4.aiReferrals', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(r.total, { sessions: 43, keyEvents: 4 });
  assert.deepEqual(r.assistants.filter((a) => a.sessions).map((a) => [a.assistant, a.sessions]), [['chatgpt.com', 30], ['perplexity.ai', 9], ['gemini.google.com', 4]]);
  assert.equal(r.assistants.length, g.AI_SOURCES.length);
  assert.deepEqual(g.AI_SOURCES, ['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai', 'you.com', 'phind.com']);
});

test('psi.run: mobile or desktop, LCP, CLS, INP and the score; works without a key, sends the optional one', async () => {
  assert.throws(() => g.cleanArgs('psi.run', { strategy: 'tablet' }), /mobile or desktop/);
  const r = await g.call(S, 'psi.run', {});
  assert.deepEqual(r, { url: `${base}/`, strategy: 'mobile', score: 72, lcpMs: 3100, cls: 0.081, inpMs: 210 });
  assert.equal(F.calls.at(-1).auth, '', 'PageSpeed is called without the service account');
  assert.equal(F.calls.at(-1).query.key, undefined);
  g.setKey('psi', 'psi-key-0123456789');
  assert.equal((await g.call(S, 'psi.run', { strategy: 'desktop' })).score, 93);
  assert.equal(F.calls.at(-1).query.key, 'psi-key-0123456789');
  g.setKey('psi', '');
});

test('bing.stats: needs its optional key; query stats', async () => {
  await assert.rejects(g.call(S, 'bing.stats', {}), /No Bing Webmaster API key/);
  g.setKey('bing', 'wrong-key-0123456789');
  await assert.rejects(g.call(S, 'bing.stats', {}), /Bing Webmaster refused the API key/);
  g.setKey('bing', 'bing-key-0123456789');
  const r = await g.call(S, 'bing.stats', { report: 'queries' });
  assert.deepEqual(r.rows, [{ Query: 'erp indonesia', Clicks: 5, Impressions: 120, AvgClickPosition: 3.1, Date: '/Date(1761868800000)/' }]);
  assert.throws(() => g.cleanArgs('bing.stats', { report: 'backlinks' }), /queries, pages, crawl-issues/);
});

test('indexnow.submit: the only write, at most 100 URLs of the Space\'s own site, the key file must be there', async () => {
  const urls = [`${base}/blog/a`, `${base}/blog/b`];
  await assert.rejects(g.call(S, 'indexnow.submit', { urls }), /needs the owner's approval/);
  assert.throws(() => g.cleanArgs('indexnow.submit', { urls: Array.from({ length: 101 }, (_, i) => `${base}/${i}`) }), /at most 100 URLs/);
  await assert.rejects(g.call(S, 'indexnow.submit', { urls }, { write: true }), /no IndexNow key yet/);
  g.saveProps(S.path, { ...g.readProps(S.path), indexNowKey: 'ffffffffffffffff' });
  await assert.rejects(g.call(S, 'indexnow.submit', { urls }, { write: true }), /key file is not on the site yet: put a file ffffffffffffffff.txt/);
  g.saveProps(S.path, { ...g.readProps(S.path), indexNowKey: F.state.indexnowKey });
  await assert.rejects(g.call(S, 'indexnow.submit', { urls: ['https://elsewhere.example/x'] }, { write: true }), /only this Space's site/);
  const r = await g.call(S, 'indexnow.submit', { urls }, { write: true });
  assert.deepEqual([r.submitted, r.status], [2, 200]);
  assert.deepEqual(F.calls.at(-1).body.urlList, urls);
});

test('errors in plain words: no access (with how to grant it), an unknown property, an API not enabled', async () => {
  const T = space('t3');
  g.saveProps(T.path, { gscSite: 'sc-domain:other.example', ga4Property: '11111111' });
  await assert.rejects(g.call(T, 'gsc.performance', {}), (e) => /The service account has no access to sc-domain:other.example/.test(e.message) && /Users and permissions → Add user: aisquad@acme-seo/.test(e.message));
  await assert.rejects(g.call(T, 'ga4.report', {}), /no access to GA4 property 11111111\. In GA4 open Admin → Property access management .* role Viewer/);
  F.state.disabled = 'ga4';
  await assert.rejects(g.call(S, 'ga4.report', {}), /Google Analytics Data API is not enabled .*apis\/library\/analyticsdata.googleapis.com/);
  F.state.disabled = '';
  await assert.rejects(g.call({ id: 'x', path: path.join(root, 'nowhere'), access: 'team' }, 'gsc.performance', {}), /no Search Console site yet \(Floor settings → Google\)/);
  await assert.rejects(g.call(null, 'gsc.performance', {}), /not registered/);
});

test('a 429 is retried at most twice with backoff', async () => {
  slept.length = 0;
  F.state.rateLimit = 2;
  assert.equal((await g.call(S, 'ga4.report', {})).count, 1, 'the third try answers');
  assert.equal(slept.length, 2);
  F.state.rateLimit = 3;
  await assert.rejects(g.call(S, 'ga4.report', {}), /rate limiting these calls/);
  F.state.rateLimit = 0;
});

test('a reply over 2 MB is refused; a server that never answers times out', async () => {
  F.state.big = true;
  await assert.rejects(g.call(S, 'gsc.performance', {}), /larger than 2 MB/);
  F.state.big = false;
  F.state.hang = true;
  await assert.rejects(g.call(S, 'gsc.performance', {}), /did not answer within 1 s/);
  F.state.hang = false;
});

test('Test: what the service account can read, and how to grant access when it cannot; logged without the key', async () => {
  const ok = await g.test(S);
  assert.deepEqual([ok.gsc.ok, ok.gsc.permission, ok.ga4.ok, ok.clientEmail], [true, 'siteRestrictedUser', true, KEY.client_email]);
  const T = space('t4');
  g.saveProps(T.path, { gscSite: 'https://www.other.example/', ga4Property: '22222222' });
  const no = await g.test(T);
  assert.equal(no.gsc.ok, false);
  assert.match(no.gsc.grant, /In Search Console open https:\/\/www.other.example\/ → Settings → Users and permissions → Add user: aisquad@acme-seo.iam.gserviceaccount.com/);
  assert.match(no.ga4.grant, /Property access management for property 22222222 .* role Viewer/);
  const ev = logs.filter((x) => x.type === 'google.tested');
  assert.deepEqual(ev.map((x) => [x.id, x.data.gsc, x.data.ga4]), [['s-team', true, true], ['s-t4', false, false]]);
  assert.doesNotMatch(JSON.stringify(ev), /PRIVATE KEY|tok-\d/);
});

test('the API: Owner only, the key write-only (the browser sees the client e-mail), a Space\'s properties and Test', async () => {
  const http = await import('node:http');
  const { createHandler } = await import('../server/api.js');
  const { loadPin } = await import('../server/pin.js');
  const floors = await import('../server/floors.js');
  const users = await import('../server/users.js');
  const pin = loadPin();
  const srv = http.createServer(createHandler({ pin }));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  after(() => srv.close());
  const call = async (method, u, body, p = pin) => { const r = await fetch(`http://127.0.0.1:${srv.address().port}${u}`, { method, headers: { 'content-type': 'application/json', 'x-aisquad-pin': p }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const dir = path.join(root, 'api-space');
  const { entry } = await floors.createFloor({ name: 'Search', directory: { mode: 'new', path: dir }, team: [] });
  const list = await call('GET', '/api/integrations');
  assert.equal(list.body.google.clientEmail, KEY.client_email);
  assert.doesNotMatch(JSON.stringify(list.body), /PRIVATE KEY/);
  assert.equal((await call('PUT', '/api/integrations/google/key', { key: JSON.stringify(KEY) })).body.clientEmail, KEY.client_email);
  assert.equal((await call('PUT', `/api/floors/${entry.id}/google`, { gscSite: 'sc-domain:example.com', ga4Property: '312345678' })).status, 200);
  const got = await call('GET', `/api/floors/${entry.id}/google`);
  assert.deepEqual([got.body.props.gscSite, got.body.clientEmail], ['sc-domain:example.com', KEY.client_email]);
  const t = await call('POST', `/api/floors/${entry.id}/google/test`, {});
  assert.deepEqual([t.body.gsc.ok, t.body.ga4.ok], [true, true]);
  const member = users.addUser({ name: 'Mia', role: 'member' }, pin);
  for (const [m, u] of [['GET', '/api/integrations'], ['PUT', '/api/integrations/google/key'], ['GET', `/api/floors/${entry.id}/google`], ['PUT', `/api/floors/${entry.id}/google`], ['POST', `/api/floors/${entry.id}/google/test`]]) {
    assert.equal((await call(m, u, m === 'GET' ? undefined : {}, member.pin)).status, 403, `${m} ${u} is the Owner's`);
  }
});

test('doctor: the key\'s file mode', async () => {
  const { runDoctor } = await import('../server/doctor.js');
  const f = path.join(config.home, 'secrets.json');
  const check = () => runDoctor().checks.find((c) => c.id === 'google');
  assert.equal(check().status, 'ok');
  assert.match(check().detail, /aisquad@acme-seo.iam.gserviceaccount.com/);
  fs.chmodSync(f, 0o644);
  assert.deepEqual([check().status, check().fix], ['fail', `chmod 600 ${f}: the key file of the service account is in it`]);
  fs.chmodSync(f, 0o600);
});
