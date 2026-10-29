// SPDX-License-Identifier: Apache-2.0
// A fake MCP server over streamable HTTP for the tests (no network beyond 127.0.0.1): a session id from initialize
// that every later request must carry, JSON or SSE replies (reply: 'json' | 'sse'), a bearer token when `token` is
// set (401 with WWW-Authenticate otherwise, like an OAuth server), and the same tools as the stdio fake.
// mode: ok | hang | big | error | version | 500. calls: every JSON-RPC message it received, with its headers.
import http from 'node:http';

export function fakeMcpHttp({ reply = 'json', token = '', mode = 'ok', posts = 4 } = {}) {
  const calls = [];
  const sessions = new Set();
  const state = { reply, mode, posts, deleted: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (token && req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401, { 'www-authenticate': 'Bearer resource_metadata="x"' }); return res.end(); }
      if (req.method === 'DELETE') { sessions.delete(req.headers['mcp-session-id']); state.deleted++; res.writeHead(200); return res.end(); }
      if (state.mode === '500') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'boom' } })); }
      const m = JSON.parse(body || '{}');
      calls.push({ method: m.method, params: m.params, session: req.headers['mcp-session-id'] || '', version: req.headers['mcp-protocol-version'] || '', accept: req.headers.accept || '' });
      if (!('id' in m)) { res.writeHead(202); return res.end(); }
      if (m.method !== 'initialize' && !sessions.has(req.headers['mcp-session-id'])) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32001, message: 'Session not found' } })); }
      let result, error, sid = '';
      if (m.method === 'initialize') { sid = `s-${calls.length}`; sessions.add(sid); result = { protocolVersion: state.mode === 'version' ? '1999-01-01' : '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fake-http', version: '1' } }; }
      else if (m.method === 'tools/list') {
        result = m.params?.cursor
          ? { tools: [{ name: 'delete_post', inputSchema: { type: 'object' } }] }
          : { tools: [{ name: 'posts_this_week', description: 'Posts in a date range', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }, annotations: { readOnlyHint: true } }], nextCursor: 'p2' };
      } else if (m.method === 'tools/call') {
        if (state.mode === 'hang') return;                                            // never answers
        if (state.mode === 'error') error = { code: -32000, message: 'quota exceeded' };
        else if (state.mode === 'big') result = { content: [{ type: 'text', text: 'y'.repeat(3 << 20) }] };
        else { const a = m.params.arguments || {}; result = { content: [{ type: 'text', text: `Published ${state.posts} posts between ${a.from} and ${a.to}` }], structuredContent: { total: state.posts, posts: Array.from({ length: state.posts }, (_, i) => ({ id: i + 1, reach: (i + 1) * 100 })) } }; }
      } else error = { code: -32601, message: 'Method not found' };
      const msg = { jsonrpc: '2.0', id: m.id, ...(error ? { error } : { result }) };
      const headers = sid ? { 'mcp-session-id': sid } : {};
      if (state.reply === 'sse') {
        res.writeHead(200, { ...headers, 'content-type': 'text/event-stream' });
        res.write(': keep-alive\n\n');
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
        res.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
      } else { res.writeHead(200, { ...headers, 'content-type': 'application/json' }); res.end(JSON.stringify(msg)); }
    });
  });
  return {
    server, calls, state, sessions,
    listen: () => new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${server.address().port}/mcp`))),
    close: () => { server.closeAllConnections?.(); server.close(); },
  };
}
