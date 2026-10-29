// SPDX-License-Identifier: Apache-2.0
// The MCP client (1.6) against fake servers, no network: the handshake, tools/list (paged), tools/call, JSON and SSE
// replies with a session id, timeouts, oversized replies, server errors, refused sampling, and stdio servers that
// are always killed (also one that ignores SIGTERM), one call at a time per server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mcp from '../server/mcp.js';
import { fakeMcpHttp } from './fixtures/fake-mcp-http.js';

const STDIO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp-stdio.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aisquad-mcp-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const fakes = [];
after(() => fakes.forEach((f) => f.close()));
async function http(opts) { const f = fakeMcpHttp(opts); fakes.push(f); return { f, def: { transport: 'http', url: await f.listen(), headers: {} } }; }
const stdio = (env = {}) => { const pidfile = path.join(tmp, `pid-${Math.random().toString(36).slice(2)}`); return { pidfile, def: { transport: 'stdio', command: process.execPath, args: [STDIO], env: { PATH: process.env.PATH, FAKE_MCP_PIDFILE: pidfile, ...env } } }; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const gone = async (pidfile) => { const pid = +fs.readFileSync(pidfile, 'utf8'); for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50)); return !alive(pid); };

test('HTTP with JSON replies: initialize, the session id and version on every later request, paged tools/list, tools/call, DELETE at the end', async () => {
  const { f, def } = await http({ reply: 'json' });
  const r = await mcp.listTools('h1', def);
  assert.equal(r.info.version, '2025-03-26', 'the server\'s version is taken when this client speaks it');
  assert.deepEqual(r.tools.map((t) => [t.name, t.readOnlyHint]), [['posts_this_week', true], ['delete_post', false]], 'both pages');
  assert.deepEqual(f.calls.map((c) => c.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);
  assert.equal(f.calls[0].params.protocolVersion, mcp.VERSIONS[0]);
  assert.deepEqual(f.calls[0].params.capabilities, {}, 'no sampling, no roots offered');
  for (const c of f.calls.slice(1)) assert.deepEqual([c.session, c.version], ['s-1', '2025-03-26']);
  assert.match(f.calls[0].accept, /application\/json/); assert.match(f.calls[0].accept, /text\/event-stream/);
  const res = await mcp.callTool('h1', def, 'posts_this_week', { from: '2026-10-26', to: '2026-11-01' });
  assert.equal(res.structuredContent.total, 4);
  assert.equal(f.calls.at(-1).method, 'tools/call');
  assert.deepEqual(f.calls.at(-1).params, { name: 'posts_this_week', arguments: { from: '2026-10-26', to: '2026-11-01' } });
  assert.equal(f.state.deleted, 2, 'each session ended with a DELETE');
  assert.equal(f.sessions.size, 0);
});

test('HTTP with SSE replies: the answer is found among other events', async () => {
  const { def } = await http({ reply: 'sse' });
  const res = await mcp.callTool('h2', def, 'posts_this_week', {});
  assert.equal(res.structuredContent.posts.length, 4);
  assert.deepEqual(mcp.fromSse('event: message\ndata: {"jsonrpc":"2.0","id":7,\ndata: "result":{"ok":1}}\n\n', 7).result, { ok: 1 }, 'multi-line data');
  assert.equal(mcp.fromSse(': ping\n\n', 1), null);
});

test('HTTP failures read in plain words: server errors, HTTP errors, a sign-in, an unknown version, a timeout, an oversized reply, no server', async () => {
  const { f, def } = await http({ mode: 'error' });
  await assert.rejects(mcp.callTool('h3', def, 'posts_this_week', {}), /answered with an error: quota exceeded/);
  f.state.mode = '500';
  await assert.rejects(mcp.listTools('h3', def), (e) => e.code === 'http' && /HTTP 500: boom/.test(e.message));
  f.state.mode = 'version';
  await assert.rejects(mcp.listTools('h3', def), (e) => e.code === 'version' && /1999-01-01/.test(e.message));
  const oauth = await http({ token: 'abc' });
  await assert.rejects(mcp.listTools('h4', oauth.def), (e) => e.code === 'auth' && /sign-in/.test(e.message));
  await assert.rejects(mcp.listTools('h4', { ...oauth.def, headers: { Authorization: 'Bearer wrong' } }), (e) => e.code === 'auth' && /refused the credentials/.test(e.message));
  assert.equal((await mcp.listTools('h4', { ...oauth.def, headers: { Authorization: 'Bearer abc' } })).tools.length, 2, 'the right token works');
  f.state.mode = 'hang';
  const t0 = Date.now();
  await assert.rejects(mcp.callTool('h3', def, 'posts_this_week', {}, { callMs: 300 }), (e) => e.code === 'timeout');
  assert.ok(Date.now() - t0 < 3000);
  f.state.mode = 'big';
  await assert.rejects(mcp.callTool('h3', def, 'posts_this_week', {}, { maxBytes: 64 * 1024 }), (e) => e.code === 'too-large' && /64 KB/.test(e.message));
  await assert.rejects(mcp.listTools('h5', { transport: 'http', url: 'http://127.0.0.1:9/mcp' }), (e) => e.code === 'unreachable');
  await assert.rejects(mcp.listTools('h5', { transport: 'sse', url: 'http://x' }), /old SSE transport is not supported/);
});

test('stdio: the handshake past a log line, sampling refused, the env passed, and the process killed after every call', async () => {
  const { def, pidfile } = stdio({ FAKE_MCP_TOKEN: 's3cret' });
  const r = await mcp.listTools('s1', def);
  assert.deepEqual(r.tools.map((t) => t.name), ['posts_this_week', 'delete_post']);
  assert.ok(await gone(pidfile), 'killed after tools/list');
  const res = await mcp.callTool('s1', def, 'posts_this_week', { from: 'a', to: 'b' });
  assert.equal(res.structuredContent.posts.length, 4);
  assert.deepEqual([...res.structuredContent.seen].sort(), ['initialize', 'notifications/initialized', 'reply:srv-1', 'tools/call'].sort(), 'the sampling request was answered (refused)');
  assert.ok(await gone(pidfile), 'killed after tools/call');
  const denied = await mcp.callTool('s1', stdio({ FAKE_MCP_TOKEN: 'wrong' }).def, 'posts_this_week', {});
  assert.equal(denied.isError, true, 'a tool error is a result; the caller reads isError');
});

test('stdio failures: a hang (timeout, then killed), an oversized reply, a server error, a process that dies, a missing command, a stubborn process', async () => {
  const hang = stdio({ FAKE_MCP_MODE: 'hang' });
  await assert.rejects(mcp.callTool('s2', hang.def, 'posts_this_week', {}, { callMs: 300 }), (e) => e.code === 'timeout');
  assert.ok(await gone(hang.pidfile), 'a hanging server is killed');
  const big = stdio({ FAKE_MCP_MODE: 'big' });
  await assert.rejects(mcp.callTool('s2', big.def, 'posts_this_week', {}, { maxBytes: 128 * 1024 }), (e) => e.code === 'too-large');
  assert.ok(await gone(big.pidfile));
  await assert.rejects(mcp.callTool('s2', stdio({ FAKE_MCP_MODE: 'error' }).def, 'x', {}), /database is down/);
  await assert.rejects(mcp.listTools('s2', stdio({ FAKE_MCP_MODE: 'version' }).def), (e) => e.code === 'version');
  await assert.rejects(mcp.callTool('s2', stdio({ FAKE_MCP_MODE: 'die' }).def, 'x', {}), (e) => e.code === 'exited');
  await assert.rejects(mcp.listTools('s2', { transport: 'stdio', command: path.join(tmp, 'nope'), args: [], env: {} }), (e) => e.code === 'spawn' && /not found/.test(e.message));
  const stubborn = stdio({ FAKE_MCP_MODE: 'stubborn' });
  await mcp.listTools('s2', stubborn.def, { killMs: 200 });
  assert.ok(await gone(stubborn.pidfile), 'SIGKILL after SIGTERM was ignored');
});

test('one call at a time per server; different servers run side by side', async () => {
  const order = [];
  const slow = (k, n, ms) => mcp.serial(k, async () => { order.push(`${n}+`); await new Promise((r) => setTimeout(r, ms)); order.push(`${n}-`); return n; });
  const r = await Promise.all([slow('a', 1, 60), slow('a', 2, 10), slow('b', 3, 10)]);
  assert.deepEqual(r, [1, 2, 3]);
  assert.ok(order.indexOf('1-') < order.indexOf('2+'), 'a waits for a');
  assert.ok(order.indexOf('3-') < order.indexOf('1-'), 'b does not wait for a');
  await assert.rejects(mcp.serial('a', async () => { throw new Error('x'); }));
  assert.equal(await mcp.serial('a', async () => 'after an error'), 'after an error');
});
