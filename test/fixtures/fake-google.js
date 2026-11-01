// SPDX-License-Identifier: Apache-2.0
// A fake of every Google and Bing endpoint the connector calls, on 127.0.0.1 only (tests and the dogfood never reach
// the real ones): /token (checks the JWT's RS256 signature against the public key), /gsc (sites.get, searchAnalytics,
// URL Inspection), /ga4 (runReport with an EXACT or ENDS_WITH filter), /psi, /bing, /indexnow and /<key>.txt (the
// IndexNow key file, so the fake is also the site). state: what it answers; calls: every request with its parsed body.
//   state.access      { gsc: [sites], ga4: [ids] }: what the service account may read (403 otherwise)
//   state.rateLimit   429s to answer before the next real reply; state.big: a reply over 2 MB; state.hang: never answer
//   state.disabled    an API name ('gsc' | 'ga4') answered as "not enabled"
import http from 'node:http';
import crypto from 'node:crypto';

const DAY = 864e5;
export function fakeGoogle({ publicKey = null, rows = {} } = {}) {
  const calls = [];
  const state = {
    access: { gsc: ['sc-domain:example.com'], ga4: ['312345678'] }, rateLimit: 0, big: false, hang: false, disabled: '', tokens: 0, expiresIn: 3600, indexnowKey: 'a1b2c3d4e5f6a7b8',
    gscRows: rows.gsc || ((body) => (body.dimensions?.[0] === 'query'
      ? [{ keys: ['erp indonesia'], clicks: 40, impressions: 900, ctr: 0.044, position: 4.2 }, { keys: ['erpnext hosting'], clicks: 12, impressions: 300, ctr: 0.04, position: 8.9 }, { keys: ['frappe'], clicks: 1, impressions: 8, ctr: 0.125, position: 3 }, { keys: ['accounting software'], clicks: 2, impressions: 400, ctr: 0.005, position: 24 }]
      : [{ keys: [], clicks: 120, impressions: 5400, ctr: 0.022, position: 11.3 }])),
    ga4Rows: rows.ga4 || ((body) => {
      const dims = (body.dimensions || []).map((d) => d.name);
      if (dims[0] === 'sessionSource') return [['chatgpt.com', 30, 3], ['www.perplexity.ai', 9, 1], ['gemini.google.com', 4, 0], ['notchatgpt.com', 50, 5], ['google', 900, 40]].map(([s, a, b]) => ({ dimensionValues: [{ value: s }], metricValues: [{ value: String(a) }, { value: String(b) }] }));
      const f = body.dimensionFilter?.filter;
      const v = f?.stringFilter?.value === 'Organic Search' ? 640 : 1500;
      return [{ dimensionValues: dims.map(() => ({ value: f?.stringFilter?.value || 'All' })), metricValues: (body.metrics || []).map((m, i) => ({ value: String(m.name === 'keyEvents' ? 25 : v - i) })) }];
    }),
    psi: { score: 0.72, lcp: 3100.4, cls: 0.081, inp: 210 },
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      let json = null; try { json = body ? JSON.parse(body) : null; } catch { /* a form */ }
      const call = { method: req.method, path: decodeURIComponent(u.pathname), query: Object.fromEntries(u.searchParams), auth: req.headers.authorization || '', body: json ?? body };
      calls.push(call);
      const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      if (state.hang) return;
      if (u.pathname === '/token') {
        const assertion = new URLSearchParams(body).get('assertion') || '';
        const [h, c, s] = assertion.split('.');
        const ok = publicKey && s && crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url'));
        if (!ok) return send(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
        call.claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
        state.tokens++;
        return send(200, { access_token: `tok-${state.tokens}`, expires_in: state.expiresIn, token_type: 'Bearer' });
      }
      if (/^\/[\w-]+\.txt$/.test(u.pathname)) return u.pathname === `/${state.indexnowKey}.txt` ? (res.writeHead(200, { 'content-type': 'text/plain' }), res.end(state.indexnowKey)) : send(404, { error: 'not found' });
      if (state.rateLimit > 0) { state.rateLimit--; return send(429, { error: { code: 429, message: 'Quota exceeded' } }, { 'retry-after': '0' }); }
      if (state.big) return send(200, JSON.stringify({ rows: [], pad: 'x'.repeat(2 * 2 ** 20 + 10) }));
      const bearer = /^Bearer tok-\d+$/.test(call.auth);
      if (u.pathname.startsWith('/gsc/') || u.pathname.startsWith('/ga4/')) {
        if (!bearer) return send(401, { error: { code: 401, message: 'Request is missing required authentication credential.' } });
        if (state.disabled && u.pathname.startsWith(`/${state.disabled}/`)) return send(403, { error: { code: 403, message: 'API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } });
      }
      let m;
      if ((m = u.pathname.match(/^\/gsc\/webmasters\/v3\/sites\/([^/]+)(\/searchAnalytics\/query)?$/))) {
        const site = decodeURIComponent(m[1]);
        if (!state.access.gsc.includes(site)) return send(403, { error: { code: 403, message: `User does not have sufficient permission for site '${site}'.` } });
        if (!m[2]) return send(200, { siteUrl: site, permissionLevel: 'siteRestrictedUser' });
        return send(200, { rows: state.gscRows(json).slice(0, json.rowLimit), responseAggregationType: 'byProperty' });
      }
      if (u.pathname === '/gsc/v1/urlInspection/index:inspect') {
        if (!state.access.gsc.includes(json.siteUrl)) return send(403, { error: { code: 403, message: 'You do not own this site' } });
        return send(200, { inspectionResult: { indexStatusResult: { verdict: json.inspectionUrl.endsWith('/new') ? 'NEUTRAL' : 'PASS', coverageState: json.inspectionUrl.endsWith('/new') ? 'Discovered - currently not indexed' : 'Submitted and indexed', robotsTxtState: 'ALLOWED', pageFetchState: 'SUCCESSFUL', lastCrawlTime: '2026-10-28T03:00:00Z', googleCanonical: json.inspectionUrl } } });
      }
      if ((m = u.pathname.match(/^\/ga4\/v1beta\/properties\/(\d+):runReport$/))) {
        if (!state.access.ga4.includes(m[1])) return send(403, { error: { code: 403, message: 'User does not have sufficient permissions for this property.', status: 'PERMISSION_DENIED' } });
        const rowsOut = state.ga4Rows(json).slice(0, json.limit || 10000);
        return send(200, { dimensionHeaders: (json.dimensions || []).map((d) => ({ name: d.name })), metricHeaders: (json.metrics || []).map((x) => ({ name: x.name, type: 'TYPE_INTEGER' })), rows: rowsOut, rowCount: rowsOut.length });
      }
      if (u.pathname === '/psi/pagespeedonline/v5/runPagespeed') {
        const p = state.psi;
        return send(200, { id: u.searchParams.get('url'), loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: p.inp, category: 'AVERAGE' } } }, lighthouseResult: { categories: { performance: { score: u.searchParams.get('strategy') === 'desktop' ? 0.93 : p.score } }, audits: { 'largest-contentful-paint': { numericValue: p.lcp }, 'cumulative-layout-shift': { numericValue: p.cls } } } });
      }
      if ((m = u.pathname.match(/^\/bing\/webmaster\/api\.svc\/json\/(\w+)$/))) {
        if (u.searchParams.get('apikey') !== 'bing-key-0123456789') return send(401, { ErrorCode: 3, Message: 'InvalidApiKey' });
        return send(200, { d: m[1] === 'GetQueryStats' ? [{ __type: 'QueryStats', Query: 'erp indonesia', Clicks: 5, Impressions: 120, AvgClickPosition: 3.1, Date: '/Date(1761868800000)/' }] : [] });
      }
      if (u.pathname === '/indexnow/indexnow') return send(json?.key === state.indexnowKey ? 200 : 403, {});
      send(404, { error: { code: 404, message: 'Not found' } });
    });
  });
  return {
    state, calls, server,
    listen: (port = 0) => new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(`http://127.0.0.1:${server.address().port}`))),
    close: () => { server.closeAllConnections?.(); server.close(); },
  };
}
export const DAYS = (n) => n * DAY;
