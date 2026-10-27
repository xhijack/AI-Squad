// SPDX-License-Identifier: Apache-2.0
// A tiny ERPNext for tests: token auth (API key:secret per user), /api/resource lists with fields, filters
// (=, >, <) and order, single documents, frappe.client.submit (only users in `submitters`), and get_logged_user.
import http from 'node:http';

export function fakeFrappe({ users = {}, submitters = [] } = {}) {
  const docs = { Lead: [], Opportunity: [], Quotation: [] };
  const calls = [];
  let clock = Date.parse('2026-10-27T01:00:00Z');
  const stamp = () => { clock += 60e3; return new Date(clock).toISOString().replace('T', ' ').slice(0, 19); };
  const userOf = (h) => { const m = String(h || '').match(/^token ([^:]+):(.+)$/); return m && users[m[1]]?.secret === m[2] ? users[m[1]].user : null; };
  const pass = (d, [f, op, v]) => (op === '=' ? d[f] === v : op === '>' ? String(d[f]) > String(v) : op === '<' ? String(d[f]) < String(v) : op === '>=' ? String(d[f]) >= String(v) : op === '<=' ? String(d[f]) <= String(v) : true);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const user = userOf(req.headers.authorization);
      calls.push({ method: req.method, path: u.pathname, user, auth: req.headers.authorization || '' });
      const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (!user) return send(401, { exc_type: 'AuthenticationError', message: 'Invalid token' });
      if (u.pathname === '/api/method/frappe.auth.get_logged_user') return send(200, { message: user });
      if (u.pathname === '/api/method/frappe.client.submit' && req.method === 'POST') {
        const { doc } = JSON.parse(body || '{}');
        const d = docs[doc?.doctype]?.find((x) => x.name === doc.name);
        if (!d) return send(404, { exc_type: 'DoesNotExistError' });
        if (doc.modified !== d.modified) return send(417, { exc_type: 'TimestampMismatchError', _server_messages: JSON.stringify([JSON.stringify({ message: 'Document has been modified after you have opened it' })]) });
        if (!submitters.includes(user)) return send(403, { exc_type: 'PermissionError', _server_messages: JSON.stringify([JSON.stringify({ message: 'Not permitted to submit Quotation' })]) });
        Object.assign(d, { docstatus: 1, status: 'Open', modified: stamp(), modified_by: user });
        return send(200, { message: d });
      }
      const m = u.pathname.match(/^\/api\/resource\/([^/]+)(?:\/(.+))?$/);
      if (m && req.method === 'GET') {
        const dt = decodeURIComponent(m[1]), list = docs[dt] || [];
        if (m[2]) { const d = list.find((x) => x.name === decodeURIComponent(m[2])); return d ? send(200, { data: d }) : send(404, { exc_type: 'DoesNotExistError' }); }
        const fields = JSON.parse(u.searchParams.get('fields') || '["name"]'), filters = JSON.parse(u.searchParams.get('filters') || '[]');
        const [key, dir] = String(u.searchParams.get('order_by') || 'creation asc').split(' ');
        const limit = +u.searchParams.get('limit_page_length') || 20, start = +u.searchParams.get('limit_start') || 0;
        const rows = list.filter((d) => filters.every((f) => pass(d, f))).sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)).slice(start, start + limit);
        return send(200, { data: rows.map((d) => Object.fromEntries(fields.map((f) => [f, d[f]]))) });
      }
      return send(404, { exc_type: 'NotFound' });
    });
  });
  const add = (doctype, d) => { const t = stamp(); const doc = { doctype, docstatus: 0, creation: t, modified: t, modified_by: 'Administrator', ...d }; docs[doctype].push(doc); return doc; };
  const edit = (doctype, name, patch) => Object.assign(docs[doctype].find((x) => x.name === name), patch, { modified: stamp() });
  return { server, docs, calls, add, edit, listen: () => new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${server.address().port}`))) };
}
