#!/usr/bin/env node
// A fake MCP server over stdio for the tests (no network). Behaviour from the environment:
//   FAKE_MCP_MODE   ok (default) | hang (never answers tools/call) | big (a huge reply) | error (tools/call fails)
//                   | version (answers an unknown protocol version) | die (exits right after initialize)
//                   | stubborn (ignores SIGTERM: the client must SIGKILL it)
//   FAKE_MCP_PIDFILE  where to write its pid (the tests check that it was killed)
//   FAKE_MCP_TOKEN    must equal "s3cret" or tools/call answers "unauthorized" (the ${VAR} resolution)
// It prints a log line on stdout first (servers do that), asks the client for sampling once (it must be refused),
// and has two tools: posts_this_week (read-only hint) and delete_post.
const fs = require('node:fs');
const mode = process.env.FAKE_MCP_MODE || 'ok';
if (process.env.FAKE_MCP_PIDFILE) fs.writeFileSync(process.env.FAKE_MCP_PIDFILE, String(process.pid));
process.stdout.write('fake mcp starting\n');
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
let buf = '';
const seen = [];
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    seen.push(m.method || `reply:${m.id}`);
    if (m.method === 'initialize') {
      out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: mode === 'version' ? '2099-01-01' : m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-stdio', version: '1' } } });
    } else if (m.method === 'notifications/initialized') {
      if (mode === 'die') process.exit(3);
      out({ jsonrpc: '2.0', id: 'srv-1', method: 'sampling/createMessage', params: {} });
    } else if (m.method === 'tools/list') {
      out({ jsonrpc: '2.0', id: m.id, result: { tools: [
        { name: 'posts_this_week', description: 'Posts published in a date range', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, status: { type: 'string', enum: ['published', 'draft'] } } }, annotations: { readOnlyHint: true } },
        { name: 'delete_post', description: 'Deletes a post', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
      ] } });
    } else if (m.method === 'tools/call') {
      if (mode === 'hang') continue;
      if (mode === 'error') { out({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'database is down' } }); continue; }
      if (mode === 'big') { out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'x'.repeat(3 << 20) }] } }); continue; }
      if (process.env.FAKE_MCP_TOKEN !== undefined && process.env.FAKE_MCP_TOKEN !== 's3cret') { out({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'unauthorized' }] } }); continue; }
      const a = m.params.arguments || {};
      setTimeout(() => out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `${a.from || '?'}..${a.to || '?'}: 4 posts` }], structuredContent: { posts: [{ id: 1, likes: 3 }, { id: 2, likes: 5 }, { id: 3, likes: 0 }, { id: 4, likes: 2 }], args: a, seen } } }), 50);   // later: the refused sampling request is answered by then
    } else if ('id' in m && m.method) {
      out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no' } });
    }
  }
});
process.on('SIGTERM', () => { if (mode !== 'stubborn') process.exit(0); });
if (mode === 'stubborn') setInterval(() => {}, 1000);          // stays up after stdin closes and after SIGTERM
