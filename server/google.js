// SPDX-License-Identifier: Apache-2.0
// The Google connector (1.8): free official data for search targets and agents, read-only, no dependencies.
//   Sign-in   a service account: a JWT signed with RS256 (node:crypto), exchanged at oauth2.googleapis.com/token for
//             a token with read-only scopes (webmasters.readonly, analytics.readonly), cached until shortly before
//             it expires.
//   The key   the Owner's secret: ~/.aisquad/secrets.json (0600), entry google.serviceAccount (the whole JSON key
//             file); google.psiKey (optional, raises the PageSpeed quota) and bing.apiKey (optional) beside it.
//             Write-only for the browser, which sees only the client e-mail. Never in a repository, the Log, KPI.md
//             or an agent's environment: agents reach Google through the server (bin/google-mcp.js).
//   Properties  per Space in <repo>/.claude/aisquad/google.json (committed, ids only): the Search Console site, the
//             GA4 property id, the public site (Bing, IndexNow, PageSpeed's home page) and the IndexNow key (public by
//             design: it is a file on the site). An Owner-only Space may fall back to the Owner's properties
//             (building.json prefs.google); a team Space uses only its own (the ERPNext key rule).
// Calls are fixed and bounded (CALLS): no free-form queries. indexnow.submit is the only write. Every call: 10 s to
// connect, 30 s in all, replies over 2 MB refused, a 429 retried twice with backoff; errors in plain words.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import path from 'node:path';
import * as auth from './auth.js';
import * as building from './building.js';
import { readJson, writeJson, bad, oneLine } from './util.js';

export const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly'];
export const TOKEN_AUD = 'https://oauth2.googleapis.com/token';
// the AI assistants whose referrals count as GEO traffic (a source matches the name or a subdomain of it)
export const AI_SOURCES = ['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai', 'you.com', 'phind.com'];
export const CALLS = ['gsc.performance', 'gsc.inspect', 'ga4.report', 'ga4.aiReferrals', 'psi.run', 'bing.stats', 'indexnow.submit'];
export const WRITES = ['indexnow.submit'];
export const GSC_DIMENSIONS = ['query', 'page', 'date', 'country', 'device'];
export const GSC_TYPES = ['web', 'news', 'image', 'video', 'discover'];
export const GA4_METRICS = ['sessions', 'engagedSessions', 'keyEvents', 'conversions', 'totalUsers'];
export const GA4_DIMENSIONS = ['date', 'sessionDefaultChannelGroup', 'sessionSource', 'landingPagePlusQueryString', 'country', 'deviceCategory'];
export const BING_REPORTS = { queries: 'GetQueryStats', pages: 'GetPageStats', 'crawl-issues': 'GetCrawlIssues' };
export const LIMITS = { gscRows: 5000, inspect: 20, ga4Rows: 1000, bingRows: 1000, indexnow: 100 };
export const GSC_LAG_DAYS = 2;
const REAL = { token: TOKEN_AUD, gsc: 'https://searchconsole.googleapis.com', ga4: 'https://analyticsdata.googleapis.com', psi: 'https://www.googleapis.com', bing: 'https://ssl.bing.com', indexnow: 'https://api.indexnow.org' };
export const endpoints = { ...REAL };
// tests and the dogfood point every endpoint at one fake server (base/token, base/gsc, …); null: the real ones
export function setBase(base) { for (const k of Object.keys(REAL)) endpoints[k] = base ? `${String(base).replace(/\/$/, '')}/${k}` : REAL[k]; }
if (process.env.AISQUAD_GOOGLE_BASE) setBase(process.env.AISQUAD_GOOGLE_BASE);
export const deps = { now: () => Date.now(), sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)), log: () => {}, connectMs: 10e3, callMs: 30e3, maxBytes: 2 * 2 ** 20, backoffMs: 1000 };

// ---------- the key (write-only) ----------
const secret = () => auth.readSecret('google') || {};
export function serviceAccount() { const k = secret().serviceAccount; return k?.client_email && k?.private_key ? k : null; }
export function status() {
  const s = secret(), k = serviceAccount(), bing = auth.readSecret('bing') || {};
  return { set: !!k, clientEmail: k?.client_email || '', projectId: k?.project_id || '', setAt: s.setAt || null, psiKey: !!s.psiKey, bingKey: !!bing.apiKey, owner: ownerProps(), scopes: SCOPES };
}
// the uploaded JSON key file: a service account with a private key that node:crypto can read
export function setServiceAccount(input) {
  let k = input;
  if (typeof input === 'string') { try { k = JSON.parse(input); } catch { throw bad('Upload the JSON key file of the service account (Google Cloud → IAM → Service accounts → Keys)'); } }
  if (!k || k.type !== 'service_account' || !/^[^@\s]+@[^@\s]+$/.test(String(k.client_email || '')) || !k.private_key) throw bad('This is not a service account key: it needs "type": "service_account", a client_email and a private_key');
  try { crypto.createPrivateKey(String(k.private_key)); } catch { throw bad('The private key in this file cannot be read'); }
  const keep = Object.fromEntries(['type', 'project_id', 'private_key_id', 'private_key', 'client_email', 'client_id', 'token_uri'].filter((x) => k[x] !== undefined).map((x) => [x, String(k[x])]));
  auth.writeSecret('google', { ...secret(), serviceAccount: keep, setAt: deps.now() });
  tokens.clear();
  return status();
}
export function clearServiceAccount() { const s = { ...secret() }; delete s.serviceAccount; delete s.setAt; auth.writeSecret('google', Object.keys(s).length ? s : null); tokens.clear(); return status(); }
// the optional API keys: PageSpeed (google.psiKey) and Bing Webmaster (bing.apiKey); '' removes one
export function setKey(which, value) {
  const v = String(value ?? '').trim();
  if (v && !/^[\w-]{10,200}$/.test(v)) throw bad('Paste the API key as it is shown');
  if (which === 'psi') { const s = { ...secret() }; if (v) s.psiKey = v; else delete s.psiKey; auth.writeSecret('google', Object.keys(s).length ? s : null); }
  else if (which === 'bing') auth.writeSecret('bing', v ? { apiKey: v } : null);
  else throw bad('Key: psi or bing');
  return status();
}

// ---------- sign-in: JWT (RS256) -> token, cached ----------
const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
export function signJwt(key, now = deps.now(), scopes = SCOPES) {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: scopes.join(' '), aud: TOKEN_AUD, iat, exp: iat + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), String(key.private_key));
  return `${head}.${claims}.${b64url(sig)}`;
}
const tokens = new Map();                            // client e-mail -> { token, exp }
const EARLY_MS = 5 * 60e3;                           // a cached token is replaced 5 minutes before it expires
export async function accessToken() {
  const key = serviceAccount();
  if (!key) throw bad('No Google service account yet: the Owner uploads its key in Admin → Integrations → Google');
  const now = deps.now(), c = tokens.get(key.client_email);
  if (c && c.exp - EARLY_MS > now) return c.token;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(key, now) }).toString();
  const r = await send(endpoints.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (r.status !== 200 || !r.json?.access_token) throw bad(`Google refused the service account's sign-in: ${oneLine(r.json?.error_description || r.json?.error || `HTTP ${r.status}`, 160)} (upload a fresh key in Admin → Integrations → Google)`);
  tokens.set(key.client_email, { token: r.json.access_token, exp: now + (Number(r.json.expires_in) || 3600) * 1000 });
  return r.json.access_token;
}
export const forgetTokens = () => tokens.clear();

// ---------- one bounded HTTP call ----------
// -> { status, json, text, headers }; 10 s to connect, 30 s in all, over 2 MB refused
export function send(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(bad(`Not an address: ${url}`)); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers: { accept: 'application/json', ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } });
    const fail = (msg) => { req.destroy(); reject(bad(msg)); };
    const all = setTimeout(() => fail(`${u.host} did not answer within ${Math.round(deps.callMs / 1000)} s`), deps.callMs);
    const conn = setTimeout(() => fail(`Could not connect to ${u.host} within ${Math.round(deps.connectMs / 1000)} s`), deps.connectMs);
    req.on('socket', (s) => { if (!s.connecting) clearTimeout(conn); s.once(u.protocol === 'https:' ? 'secureConnect' : 'connect', () => clearTimeout(conn)); });
    req.on('error', (e) => { clearTimeout(all); clearTimeout(conn); reject(bad(`Could not reach ${u.host}: ${e.message}`)); });
    req.on('response', (res) => {
      clearTimeout(conn);
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > deps.maxBytes) { clearTimeout(all); fail(`The reply from ${u.host} is larger than ${Math.round(deps.maxBytes / 2 ** 20)} MB: ask for fewer rows or a shorter range`); } else chunks.push(c); });
      res.on('end', () => {
        clearTimeout(all);
        if (n > deps.maxBytes) return;
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
      res.on('error', (e) => { clearTimeout(all); reject(bad(`${u.host}: ${e.message}`)); });
    });
    if (body) req.write(body);
    req.end();
  });
}
// a 429 (rate limited) is tried again at most twice, after 1 s and 2 s (or what Retry-After asks, up to 10 s)
async function withRetry(fn) {
  for (let i = 0; ; i++) {
    const r = await fn();
    if (r.status !== 429 || i >= 2) return r;
    const after = Number(r.headers?.['retry-after']);
    await deps.sleep(Number.isFinite(after) && after > 0 ? Math.min(10e3, after * 1000) : deps.backoffMs * 2 ** i);
  }
}
async function google(url, { method = 'GET', body } = {}) {
  const token = await accessToken();
  return withRetry(() => send(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
}

// ---------- properties ----------
const file = (root) => path.join(root, '.claude', 'aisquad', 'google.json');
const SITE = /^(sc-domain:[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/[^\s/]+\/(\S*\/)?)$/i;
export function cleanProps(p = {}) {
  const s = (v) => String(v ?? '').trim();
  const gscSite = s(p.gscSite), ga4Property = s(p.ga4Property).replace(/^properties\//, ''), siteUrl = s(p.siteUrl).replace(/\/*$/, ''), indexNowKey = s(p.indexNowKey);
  if (gscSite && !SITE.test(gscSite)) throw bad('Search Console site: sc-domain:example.com, or a URL-prefix property such as https://www.example.com/ (with the slash at the end)');
  if (ga4Property && !/^\d{4,15}$/.test(ga4Property)) throw bad('GA4 property: the number in GA4 → Admin → Property details, e.g. 312345678 (not the G- measurement id)');
  if (siteUrl && !/^https?:\/\/[^\s/]+$/i.test(siteUrl)) throw bad('Site: the address of the home page, e.g. https://www.example.com');
  if (indexNowKey && !/^[a-zA-Z0-9-]{8,128}$/.test(indexNowKey)) throw bad('IndexNow key: 8 to 128 letters, digits or dashes (docs/seo/INDEXNOW.md)');
  return { gscSite, ga4Property, siteUrl, indexNowKey };
}
export const readProps = (root) => { try { return cleanProps(readJson(file(root), {}) || {}); } catch { return cleanProps({}); } };
export function saveProps(root, p) { const c = cleanProps(p); writeJson(file(root), c); return c; }
export const ownerProps = () => { try { return cleanProps(building.loadBuilding().prefs.google || {}); } catch { return cleanProps({}); } };
export function saveOwnerProps(p) { const c = cleanProps(p); building.setPrefs({ google: c }); return c; }
// what a Space reads: its own google.json; an Owner-only Space falls back to the Owner's properties field by field
export function propsFor(space) {
  if (!space?.path) return cleanProps({});
  const own = readProps(space.path);
  if (space.access !== 'owner') return own;
  const o = ownerProps();
  return Object.fromEntries(Object.entries(own).map(([k, v]) => [k, v || o[k]]));
}
const need = (props, key, what) => { if (!props[key]) throw bad(`This Space has no ${what} yet (Floor settings → Google)`); return props[key]; };

// ---------- arguments ----------
const DAY = 864e5;
export const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(s));
// a date range; GSC's ends at today − 2 (its data lags about 2 days)
function range(a, { lag = 0, now = deps.now() } = {}) {
  const last = ymd(now - lag * DAY);
  const to = a.to === undefined ? last : String(a.to), from = a.from === undefined ? ymd(Date.parse(`${to}T00:00:00`) - 27 * DAY) : String(a.from);
  if (!isDate(from) || !isDate(to)) throw bad('Dates: YYYY-MM-DD');
  const end = to > last ? last : to;
  if (from > end) throw bad(lag ? `No Search Console data yet for ${from}..${to}: it lags about ${lag} days` : `The range ends before it starts (${from}..${to})`);
  if (Date.parse(end) - Date.parse(from) > 16 * 31 * DAY) throw bad('At most 16 months at a time');
  return { from, to: end };
}
// a period's window for a target: GSC ends at today − 2, so early in a period it can be empty (nothing to measure yet)
export function windowFor(call, { from, to }, now = deps.now()) {
  if (!call.startsWith('gsc.')) return { from, to, lag: false, empty: false };
  const last = ymd(now - GSC_LAG_DAYS * DAY), end = to > last ? last : to;
  return { from, to: end, lag: end !== to, empty: from > end };
}
const list = (v, allowed, what, max = allowed.length) => {
  const xs = v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)];
  const badOnes = xs.filter((x) => !allowed.includes(x));
  if (badOnes.length) throw bad(`${what}: ${allowed.join(', ')} (not ${badOnes.slice(0, 3).join(', ')})`);
  if (xs.length > max) throw bad(`${what}: at most ${max}`);
  return [...new Set(xs)];
};
const cap = (v, max, dflt, what) => { if (v === undefined || v === '') return dflt; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > max) throw bad(`${what}: 1 to ${max.toLocaleString('en-US')}`); return n; };
const host = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };
const urls = (v, max, what) => {
  const xs = (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
  if (!xs.length) throw bad(`${what}: at least one URL`);
  if (xs.length > max) throw bad(`${what}: at most ${max} URLs per call`);
  for (const x of xs) if (!/^https?:\/\/\S+$/i.test(x)) throw bad(`Not a URL: ${oneLine(x, 80)}`);
  return [...new Set(xs)];
};
// the arguments of a call, checked and bounded (also what a target stores, so {{from}}/{{to}} pass through)
export function cleanArgs(call, a = {}) {
  if (!CALLS.includes(call)) throw bad(`Google call: ${CALLS.join(', ')}`);
  a = a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  const dates = Object.fromEntries(['from', 'to'].filter((k) => a[k] !== undefined && a[k] !== '').map((k) => [k, String(a[k]).trim().slice(0, 20)]));
  const num = (v, what) => { if (v === undefined || v === '') return undefined; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw bad(`${what}: a number`); return n; };
  if (call === 'gsc.performance') {
    const searchType = a.searchType === undefined ? 'web' : String(a.searchType);
    if (!GSC_TYPES.includes(searchType)) throw bad(`Search type: ${GSC_TYPES.join(', ')}`);
    const out = { dimensions: list(a.dimensions, GSC_DIMENSIONS, 'Dimensions'), searchType, rowLimit: cap(a.rowLimit, LIMITS.gscRows, 1000, 'Rows'), ...dates };
    const mi = num(a.minImpressions, 'Minimum impressions'), mp = num(a.maxPosition, 'Highest position');
    return { ...out, ...(mi !== undefined ? { minImpressions: mi } : {}), ...(mp !== undefined ? { maxPosition: mp } : {}) };
  }
  if (call === 'gsc.inspect') return { urls: urls(a.urls, LIMITS.inspect, 'URL Inspection') };
  if (call === 'ga4.report') {
    const metrics = list(a.metrics ?? ['sessions'], GA4_METRICS, 'Metrics');
    if (!metrics.length) throw bad('Metrics: at least one');
    const where = a.where && typeof a.where === 'object' ? Object.entries(a.where) : [];
    if (where.length > 1) throw bad('Filter: one dimension and its value, e.g. { "sessionDefaultChannelGroup": "Organic Search" }');
    if (where.length && !GA4_DIMENSIONS.includes(where[0][0])) throw bad(`Filter: one of ${GA4_DIMENSIONS.join(', ')}`);
    return { metrics, dimensions: list(a.dimensions, GA4_DIMENSIONS, 'Dimensions'), limit: cap(a.limit, LIMITS.ga4Rows, 100, 'Rows'), ...dates, ...(where.length ? { where: { [where[0][0]]: oneLine(where[0][1], 200) } } : {}) };
  }
  if (call === 'ga4.aiReferrals') return { ...dates };
  if (call === 'psi.run') {
    const strategy = a.strategy === undefined ? 'mobile' : String(a.strategy);
    if (!['mobile', 'desktop'].includes(strategy)) throw bad('Strategy: mobile or desktop');
    return { strategy, ...(a.url ? { url: urls(a.url, 1, 'PageSpeed')[0] } : {}) };
  }
  if (call === 'bing.stats') { const report = a.report === undefined ? 'queries' : String(a.report); if (!BING_REPORTS[report]) throw bad(`Bing report: ${Object.keys(BING_REPORTS).join(', ')}`); return { report }; }
  return { urls: urls(a.urls, LIMITS.indexnow, 'IndexNow') };
}

// ---------- plain words for Google's errors ----------
const API = { gsc: ['Search Console API', 'searchconsole.googleapis.com'], ga4: ['Google Analytics Data API', 'analyticsdata.googleapis.com'], psi: ['PageSpeed Insights API', 'pagespeedonline.googleapis.com'] };
export function grantText(kind, email, id) {
  return kind === 'gsc'
    ? `In Search Console open ${id || 'the property'} → Settings → Users and permissions → Add user: ${email || 'the service account\'s e-mail'}, permission Restricted (read is enough).`
    : `In GA4 open Admin → Property access management for property ${id || '…'} → + → Add users: ${email || 'the service account\'s e-mail'}, role Viewer.`;
}
function plain(kind, r, id) {
  const msg = oneLine(r.json?.error?.message || r.json?.error_description || r.text || `HTTP ${r.status}`, 200);
  const disabled = /SERVICE_DISABLED|accessNotConfigured|has not been used in project|is disabled/i.test(JSON.stringify(r.json || r.text || ''));
  if (disabled && API[kind]) return bad(`The ${API[kind][0]} is not enabled for the service account's Google Cloud project: enable it at https://console.cloud.google.com/apis/library/${API[kind][1]}`);
  if (r.status === 403 || r.status === 401) {
    if (kind === 'gsc') return bad(`The service account has no access to ${id}. ${grantText('gsc', serviceAccount()?.client_email, id)}`);
    if (kind === 'ga4') return bad(`The service account has no access to GA4 property ${id}. ${grantText('ga4', serviceAccount()?.client_email, id)}`);
    if (kind === 'bing') return bad('Bing Webmaster refused the API key (Admin → Integrations → Google → Bing key)');
    return bad(`${kind}: access refused (${msg})`);
  }
  if (r.status === 404 && kind === 'gsc') return bad(`Search Console has no property ${id} for this service account: check the exact name (sc-domain:… or the URL with its slash)`);
  if (r.status === 404 && kind === 'ga4') return bad(`GA4 has no property ${id}: use the property's number, not the G- id`);
  if (r.status === 429) return bad(`${kind === 'psi' ? 'PageSpeed Insights' : kind === 'bing' ? 'Bing Webmaster' : 'Google'} is rate limiting these calls: try again later${kind === 'psi' ? ' (a PageSpeed API key raises the quota)' : ''}`);
  return bad(`${kind === 'gsc' ? 'Search Console' : kind === 'ga4' ? 'GA4' : kind === 'psi' ? 'PageSpeed Insights' : kind === 'bing' ? 'Bing Webmaster' : 'IndexNow'}: ${msg}`);
}

// ---------- the calls ----------
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (x) => Math.round(x * 100) / 100;
const gscUrl = (site, p) => `${endpoints.gsc}/webmasters/v3/sites/${encodeURIComponent(site)}${p}`;
async function gscPerformance(props, a) {
  const site = need(props, 'gscSite', 'Search Console site'), { from, to } = range(a, { lag: GSC_LAG_DAYS });
  const r = await google(gscUrl(site, '/searchAnalytics/query'), { method: 'POST', body: { startDate: from, endDate: to, dimensions: a.dimensions, type: a.searchType, rowLimit: a.rowLimit, dataState: 'final' } });
  if (r.status !== 200) throw plain('gsc', r, site);
  let rows = (r.json?.rows || []).slice(0, a.rowLimit).map((x) => ({ ...Object.fromEntries(a.dimensions.map((d, i) => [d, x.keys?.[i] ?? ''])), clicks: n(x.clicks), impressions: n(x.impressions), ctr: r2(n(x.ctr) * 100), position: r2(n(x.position)) }));
  if (a.minImpressions !== undefined) rows = rows.filter((x) => x.impressions >= a.minImpressions);
  if (a.maxPosition !== undefined) rows = rows.filter((x) => x.position <= a.maxPosition);
  return { site, from, to, searchType: a.searchType, dimensions: a.dimensions, count: rows.length, totals: { clicks: rows.reduce((s, x) => s + x.clicks, 0), impressions: rows.reduce((s, x) => s + x.impressions, 0) }, rows };
}
async function gscInspect(props, a) {
  const site = need(props, 'gscSite', 'Search Console site');
  const out = [];
  for (const u of a.urls) {
    const r = await google(`${endpoints.gsc}/v1/urlInspection/index:inspect`, { method: 'POST', body: { inspectionUrl: u, siteUrl: site } });
    if (r.status !== 200) throw plain('gsc', r, site);
    const x = r.json?.inspectionResult?.indexStatusResult || {};
    out.push({ url: u, verdict: x.verdict || '', coverageState: x.coverageState || '', indexingState: x.indexingState || '', robotsTxtState: x.robotsTxtState || '', pageFetchState: x.pageFetchState || '', lastCrawlTime: x.lastCrawlTime || '', googleCanonical: x.googleCanonical || '', userCanonical: x.userCanonical || '' });
  }
  return { site, count: out.length, results: out };
}
async function ga4Run(props, body) {
  const id = need(props, 'ga4Property', 'GA4 property');
  const r = await google(`${endpoints.ga4}/v1beta/properties/${id}:runReport`, { method: 'POST', body });
  if (r.status !== 200) throw plain('ga4', r, id);
  const dims = (r.json?.dimensionHeaders || []).map((h) => h.name), mets = (r.json?.metricHeaders || []).map((h) => h.name);
  return { id, rows: (r.json?.rows || []).map((x) => ({ ...Object.fromEntries(dims.map((d, i) => [d, x.dimensionValues?.[i]?.value ?? ''])), ...Object.fromEntries(mets.map((m, i) => [m, n(x.metricValues?.[i]?.value)])) })), metrics: mets };
}
async function ga4Report(props, a) {
  const { from, to } = range(a);
  const [[dim, val] = []] = Object.entries(a.where || {});
  const res = await ga4Run(props, { dateRanges: [{ startDate: from, endDate: to }], metrics: a.metrics.map((name) => ({ name })), dimensions: a.dimensions.map((name) => ({ name })), limit: a.limit,
    ...(dim ? { dimensionFilter: { filter: { fieldName: dim, stringFilter: { matchType: 'EXACT', value: val } } } } : {}) });
  const rows = res.rows.slice(0, a.limit);
  return { property: res.id, from, to, ...(dim ? { where: a.where } : {}), count: rows.length, totals: Object.fromEntries(a.metrics.map((m) => [m, rows.reduce((s, x) => s + n(x[m]), 0)])), rows };
}
// which assistant a session source belongs to ('' when none): the name itself or a subdomain of it
export const assistantOf = (source) => { const s = String(source || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, ''); return AI_SOURCES.find((a) => s === a || s.endsWith(`.${a}`)) || ''; };
export function aiTotals(rows) {
  const by = new Map(AI_SOURCES.map((a) => [a, { assistant: a, sessions: 0, keyEvents: 0 }]));
  for (const x of rows) { const a = assistantOf(x.sessionSource); if (a) { by.get(a).sessions += n(x.sessions); by.get(a).keyEvents += n(x.keyEvents); } }
  const assistants = [...by.values()];
  return { assistants, total: { sessions: assistants.reduce((s, x) => s + x.sessions, 0), keyEvents: assistants.reduce((s, x) => s + x.keyEvents, 0) } };
}
async function ga4AiReferrals(props, a) {
  const { from, to } = range(a);
  const res = await ga4Run(props, { dateRanges: [{ startDate: from, endDate: to }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], dimensions: [{ name: 'sessionSource' }], limit: LIMITS.ga4Rows,
    dimensionFilter: { orGroup: { expressions: AI_SOURCES.map((s) => ({ filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'ENDS_WITH', value: s, caseSensitive: false } } })) } } });
  return { property: res.id, from, to, ...aiTotals(res.rows) };
}
async function psiRun(props, a) {
  const url = a.url || need(props, 'siteUrl', 'site address') + '/';
  const key = secret().psiKey;
  const q = new URLSearchParams({ url, strategy: a.strategy, category: 'performance', ...(key ? { key } : {}) });
  const r = await withRetry(() => send(`${endpoints.psi}/pagespeedonline/v5/runPagespeed?${q}`));
  if (r.status !== 200) throw plain('psi', r, url);
  const lh = r.json?.lighthouseResult || {}, au = lh.audits || {}, field = r.json?.loadingExperience?.metrics || {};
  const score = lh.categories?.performance?.score;
  return { url, strategy: a.strategy, score: score == null ? null : Math.round(score * 100), lcpMs: au['largest-contentful-paint']?.numericValue != null ? Math.round(au['largest-contentful-paint'].numericValue) : null,
    cls: au['cumulative-layout-shift']?.numericValue != null ? Math.round(au['cumulative-layout-shift'].numericValue * 1000) / 1000 : null, inpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null };
}
async function bingStats(props, a) {
  const key = (auth.readSecret('bing') || {}).apiKey;
  if (!key) throw bad('No Bing Webmaster API key (Admin → Integrations → Google → Bing key; Bing Webmaster Tools → Settings → API access)');
  const site = need(props, 'siteUrl', 'site address');
  const r = await withRetry(() => send(`${endpoints.bing}/webmaster/api.svc/json/${BING_REPORTS[a.report]}?${new URLSearchParams({ siteUrl: `${site}/`, apikey: key })}`));
  if (r.status !== 200) throw plain('bing', r, site);
  const rows = (Array.isArray(r.json?.d) ? r.json.d : []).slice(0, LIMITS.bingRows).map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== '__type')));
  return { site, report: a.report, count: rows.length, rows };
}
// the only write: URLs of the Space's own site, with the key file already on the site (docs/seo/INDEXNOW.md)
async function indexnowSubmit(props, a) {
  const site = need(props, 'siteUrl', 'site address'), key = need(props, 'indexNowKey', 'IndexNow key'), h = host(site);
  const off = a.urls.filter((u) => host(u) !== h);
  if (off.length) throw bad(`IndexNow takes only this Space's site (${h}): ${oneLine(off[0], 80)} is not on it`);
  const kf = await send(`${site}/${key}.txt`);
  if (kf.status !== 200 || String(kf.text || '').trim() !== key) throw bad(`The IndexNow key file is not on the site yet: put a file ${key}.txt with the key in it at ${site}/ (docs/seo/INDEXNOW.md)`);
  const r = await withRetry(() => send(`${endpoints.indexnow}/indexnow`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: h, key, keyLocation: `${site}/${key}.txt`, urlList: a.urls }) }));
  if (![200, 202].includes(r.status)) throw plain('indexnow', r, site);
  return { site, submitted: a.urls.length, status: r.status };
}
const RUN = { 'gsc.performance': gscPerformance, 'gsc.inspect': gscInspect, 'ga4.report': ga4Report, 'ga4.aiReferrals': ga4AiReferrals, 'psi.run': psiRun, 'bing.stats': bingStats, 'indexnow.submit': indexnowSubmit };
// what a Space still needs before a call can work ('' when nothing): the key, its property (a seeded target waits quietly)
export function missing(space, name) {
  if (!space) return 'the Space is not registered';
  const p = propsFor(space);
  if (name.startsWith('psi.')) return p.siteUrl ? '' : 'the site address (Floor settings → Google)';
  if (name.startsWith('bing.')) return !(auth.readSecret('bing') || {}).apiKey ? 'a Bing Webmaster key (Admin → Integrations → Google)' : p.siteUrl ? '' : 'the site address (Floor settings → Google)';
  if (!serviceAccount()) return 'the Google service account (Admin → Integrations → Google)';
  if (name.startsWith('gsc.') && !p.gscSite) return 'the Search Console site (Floor settings → Google)';
  if (name.startsWith('ga4.') && !p.ga4Property) return 'the GA4 property (Floor settings → Google)';
  return '';
}
// the property a call reads, for the Log (never the key)
export const propertyOf = (call, props) => (call.startsWith('gsc.') ? props.gscSite : call.startsWith('ga4.') ? props.ga4Property : props.siteUrl) || '';
// one call for a Space ({ id, path, access }): its properties only; a write only when the caller says so
export async function call(space, name, args = {}, { write = false } = {}) {
  if (!space) throw bad('The Space is not registered on this machine');
  const a = cleanArgs(name, args);
  if (WRITES.includes(name) && !write) throw bad(`${name} changes something outside: it needs the owner's approval`);
  return RUN[name](propsFor(space), a);
}

// ---------- Test (Floor settings → Google) ----------
// can the service account read the Space's properties, and how to grant access when it cannot
export async function test(space, { now = deps.now() } = {}) {
  const props = propsFor(space), email = serviceAccount()?.client_email || '';
  const one = async (kind, id, fn) => {
    if (!id) return { ok: false, property: '', error: kind === 'gsc' ? 'No Search Console site set' : 'No GA4 property set' };
    try { return { ok: true, property: id, ...(await fn()) }; } catch (e) { return { ok: false, property: id, error: e.message, grant: grantText(kind, email, id) }; }
  };
  const gsc = await one('gsc', props.gscSite, async () => {
    const r = await google(gscUrl(props.gscSite, ''));
    if (r.status !== 200) throw plain('gsc', r, props.gscSite);
    return { permission: r.json?.permissionLevel || '' };
  });
  const ga4 = await one('ga4', props.ga4Property, async () => { await ga4Run(props, { dateRanges: [{ startDate: ymd(now - 7 * DAY), endDate: ymd(now) }], metrics: [{ name: 'sessions' }], limit: 1 }); return {}; });
  deps.log(space.id, { type: 'google.tested', data: { gscSite: props.gscSite, ga4Property: props.ga4Property, gsc: gsc.ok, ga4: ga4.ok, ...(gsc.ok ? {} : { gscError: oneLine(gsc.error, 200) }), ...(ga4.ok ? {} : { ga4Error: oneLine(ga4.error, 200) }) } });
  return { at: now, clientEmail: email, gsc, ga4 };
}

// ---------- agents: the aisquad-google MCP server (bin/google-mcp.js) ----------
// Its tools ask this server (POST /api/google/agent with the Space's agent token); the key never leaves the server.
// A Blueprint that asks for it (`mcp: [aisquad-google]`) gets it in the Space's .mcp.json at Set up Squad, with its
// read tools allowed and indexnow_submit set to ask (the owner approves it on the Desk) and denied to automated runs.
export const MCP_NAME = 'aisquad-google';
export const TOOLS = { gsc_performance: 'gsc.performance', gsc_inspect: 'gsc.inspect', ga4_report: 'ga4.report', ga4_ai_referrals: 'ga4.aiReferrals', psi_run: 'psi.run', bing_stats: 'bing.stats', indexnow_submit: 'indexnow.submit' };
export const rule = (tool) => `mcp__${MCP_NAME}__${tool}`;
export const READ_RULES = Object.entries(TOOLS).filter(([, c]) => !WRITES.includes(c)).map(([t]) => rule(t));
export const WRITE_RULES = Object.entries(TOOLS).filter(([, c]) => WRITES.includes(c)).map(([t]) => rule(t));
// the entry in a Space's .mcp.json: no secrets and no absolute paths (Claude Code fills the variables at start)
export const mcpEntry = () => ({ type: 'stdio', command: 'node', args: ['${AISQUAD_PLUGIN_ROOT}/bin/google-mcp.js'], env: { AISQUAD_URL: '${AISQUAD_URL}', AISQUAD_SPACE_TOKEN: '${AISQUAD_SPACE_TOKEN}', AISQUAD_RUN: '${AISQUAD_RUN:-desk}' } });
export function addToSpace(root) {
  const f = path.join(root, '.mcp.json');
  const cur = readJson(f, null) || {};
  if (cur.mcpServers?.[MCP_NAME]) return false;
  writeJson(f, { ...cur, mcpServers: { ...(cur.mcpServers || {}), [MCP_NAME]: mcpEntry() } });
  const sf = path.join(root, '.claude', 'settings.json'), st = readJson(sf, null) || {};
  const perm = { ...(st.permissions || {}) };
  perm.allow = [...new Set([...(perm.allow || []), ...READ_RULES])];
  perm.ask = [...new Set([...(perm.ask || []), ...WRITE_RULES])];
  writeJson(sf, { ...st, permissions: perm });
  return true;
}
export const inSpace = (root) => !!readJson(path.join(root, '.mcp.json'), null)?.mcpServers?.[MCP_NAME];
// a call from an agent's tool: the Space from its token; a write never from an automated run
export async function agentCall(space, body = {}) {
  const name = String(body.call || '');
  if (!CALLS.includes(name)) throw bad(`Google call: ${CALLS.join(', ')}`);
  const write = WRITES.includes(name);
  if (write && body.run !== 'desk') throw bad(`${name} is not allowed in automated runs: the owner approves it in a Desk session`);
  const out = await call(space, name, body.args || {}, { write });
  if (write) deps.log(space.id, { type: 'google.submitted', data: { call: name, site: out.site, urls: out.submitted } });
  return out;
}
