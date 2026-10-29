// SPDX-License-Identifier: Apache-2.0
// A minimal MCP client (1.6): the server reads a number from an integration's MCP server, deterministically, with no
// model in the loop. JSON-RPC 2.0 over streamable HTTP (POST; a JSON or an SSE reply; the session id header) and over
// stdio (the command with its args and env; one JSON message per line). initialize -> notifications/initialized ->
// tools/list or tools/call, nothing else: never prompts, resources or sampling; requests from the server are refused
// (ping is answered). Timeouts (connect 10 s, call 30 s), a size cap on replies, one call at a time per server, and a
// stdio server never outlives its call: its process group is killed when the call ends.
// def: { transport: 'http' | 'stdio', url, headers } or { transport: 'stdio', command, args, env, cwd }, with every
// ${VAR} already resolved (server/integrations.js does that, at call time only).
import { spawn } from 'node:child_process';
import { HttpError } from './util.js';

export const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];     // newest first: what we ask for
export const LIMITS = { connectMs: 10e3, callMs: 30e3, maxBytes: 1 << 20, killMs: 1500 };
const CLIENT = { name: 'aisquad', version: '1' };

export class McpError extends HttpError {
  constructor(message, { code = '', status = 502 } = {}) { super(status, message); this.code = code; }
}
const fail = (message, code = 'error') => new McpError(message, { code });

// ---------- one call at a time per server ----------
const queues = new Map();
export function serial(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

// ---------- the two transports: send(message) -> reply, notify(message), close() ----------
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, no) => { timer = setTimeout(() => no(fail(`${what} took longer than ${Math.round(ms / 1000)} s`, 'timeout')), ms); })]).finally(() => clearTimeout(timer));
}

// read a fetch body up to maxBytes; more than that is an error, not a cut-off reply
async function readCapped(res, maxBytes) {
  const chunks = []; let n = 0;
  for await (const c of res.body) {
    n += c.length;
    if (n > maxBytes) { try { await res.body.cancel(); } catch { /* closed */ } throw fail(`The reply is larger than ${Math.round(maxBytes / 1024)} KB`, 'too-large'); }
    chunks.push(c);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}
// the JSON-RPC message with the id we wait for, from an SSE stream (events: data lines joined)
export function fromSse(text, id) {
  for (const block of String(text).split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    let m; try { m = JSON.parse(data); } catch { continue; }
    for (const x of Array.isArray(m) ? m : [m]) if (x && x.id === id && ('result' in x || 'error' in x)) return x;
  }
  return null;
}

function httpTransport(def, lim) {
  let session = '', version = '';
  const headers = () => ({ ...(def.headers || {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    ...(session ? { 'mcp-session-id': session } : {}), ...(version ? { 'mcp-protocol-version': version } : {}) });
  async function post(msg, ms) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try {
      let res;
      try { res = await fetch(def.url, { method: 'POST', headers: headers(), body: JSON.stringify(msg), signal: ac.signal, redirect: 'error' }); }
      catch (e) { throw ac.signal.aborted ? fail(`No answer within ${Math.round(ms / 1000)} s`, 'timeout') : fail(`The server did not answer: ${e.cause?.code || e.message}`, 'unreachable'); }
      if (res.headers.get('mcp-session-id')) session = res.headers.get('mcp-session-id');
      if (res.status === 401 || res.status === 403) { try { await res.body?.cancel(); } catch { /* closed */ } throw fail(res.headers.get('www-authenticate') && !def.headers?.authorization && !def.headers?.Authorization ? 'The server needs a sign-in (OAuth in Claude Code); it cannot be used by the server' : `The server refused the credentials (HTTP ${res.status})`, 'auth'); }
      if (!('id' in msg)) { try { await res.body?.cancel(); } catch { /* closed */ } if (!res.ok && res.status !== 202) throw fail(`HTTP ${res.status}`, 'http'); return null; }
      if (!res.ok) { const t = await readCapped(res, 8192).catch(() => ''); let m = ''; try { m = JSON.parse(t).error?.message || ''; } catch { /* not JSON */ } throw fail(`HTTP ${res.status}${m ? `: ${m}` : ''}`, 'http'); }
      const text = await readCapped(res, lim.maxBytes);
      if (/text\/event-stream/i.test(res.headers.get('content-type') || '')) {
        const r = fromSse(text, msg.id);
        if (!r) throw fail('The event stream ended without the answer', 'protocol');
        return r;
      }
      let r; try { r = JSON.parse(text); } catch { throw fail('The reply is not JSON', 'protocol'); }
      if (Array.isArray(r)) r = r.find((x) => x?.id === msg.id);
      if (!r || r.id !== msg.id) throw fail('The reply does not answer the request', 'protocol');
      return r;
    } catch (e) {
      if (e?.name === 'AbortError' || ac.signal.aborted) throw e instanceof McpError ? e : fail(`No answer within ${Math.round(ms / 1000)} s`, 'timeout');
      throw e;
    } finally { clearTimeout(timer); }
  }
  return {
    send: (msg, ms) => post(msg, ms),
    notify: (msg) => post(msg, lim.connectMs).catch(() => null),
    setVersion: (v) => { version = v; },
    // the session ends with a DELETE (servers may refuse it: 405 is fine)
    close: async () => { if (!session) return; try { await fetch(def.url, { method: 'DELETE', headers: headers(), signal: AbortSignal.timeout(2000) }); } catch { /* gone */ } },
  };
}

function stdioTransport(def, lim) {
  let child;
  try {
    child = spawn(def.command, def.args || [], { cwd: def.cwd || undefined, env: def.env || {}, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  } catch (e) { throw fail(`The command could not start: ${e.message}`, 'spawn'); }
  const waiting = new Map();
  let buf = '', bytes = 0, err = '', dead = null;
  const die = (e) => { if (dead) return; dead = e; for (const w of waiting.values()) w.no(e); waiting.clear(); };
  child.on('error', (e) => die(fail(e.code === 'ENOENT' ? `The command "${def.command}" was not found` : `The command could not start: ${e.message}`, 'spawn')));
  child.on('exit', (code, sig) => die(fail(`The server process ended (${sig || `exit ${code}`})${err.trim() ? `: ${err.trim().split('\n').at(-1).slice(0, 200)}` : ''}`, 'exited')));
  child.stderr.on('data', (c) => { if (err.length < 4096) err += c.toString('utf8'); });
  child.stdin.on('error', () => {});
  const write = (m) => { if (!dead) child.stdin.write(JSON.stringify(m) + '\n'); };
  child.stdout.on('data', (c) => {
    bytes += c.length;
    if (bytes > lim.maxBytes) { die(fail(`The reply is larger than ${Math.round(lim.maxBytes / 1024)} KB`, 'too-large')); kill(); return; }
    buf += c.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }                 // a log line on stdout: skipped
      if (m && m.method && 'id' in m) { write(m.method === 'ping' ? { jsonrpc: '2.0', id: m.id, result: {} } : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Not supported by this client' } }); continue; }
      const w = m && waiting.get(m.id);
      if (w) { waiting.delete(m.id); w.ok(m); }
    }
  });
  // the whole process group: an npx or a shell wrapper leaves no server behind
  let killed = null;
  function kill() {
    if (killed) return killed;
    killed = new Promise((ok) => {
      if (child.exitCode !== null || child.signalCode !== null) return ok();
      const sig = (s) => { try { process.kill(-child.pid, s); } catch { try { child.kill(s); } catch { /* gone */ } } };
      const t = setTimeout(() => sig('SIGKILL'), lim.killMs);
      child.once('exit', () => { clearTimeout(t); ok(); });
      try { child.stdin.end(); } catch { /* closed */ }
      sig('SIGTERM');
    });
    return killed;
  }
  return {
    child,
    send: (msg, ms) => {
      if (dead) return Promise.reject(dead);
      const p = new Promise((ok, no) => waiting.set(msg.id, { ok, no }));
      write(msg);
      return withTimeout(p, ms, 'The server');
    },
    notify: async (msg) => { write(msg); return null; },
    setVersion: () => {},
    close: kill,
  };
}

// ---------- a session: connect, use, always close ----------
// fn(session) with session.listTools() and session.callTool(name, args); returns fn's result
export async function withSession(def, fn, opts = {}) {
  const lim = { ...LIMITS, ...opts };
  if (!['http', 'stdio'].includes(def?.transport)) throw fail(def?.transport === 'sse' ? 'The old SSE transport is not supported: the server reads only streamable HTTP and stdio servers' : 'Unknown transport', 'transport');
  const tr = def.transport === 'http' ? httpTransport(def, lim) : stdioTransport(def, lim);
  let id = 0;
  const request = async (method, params, ms) => {
    const r = await tr.send({ jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) }, ms);
    if (r.error) throw fail(`The server answered with an error: ${String(r.error.message || r.error.code || 'unknown').slice(0, 300)}`, 'rpc');
    return r.result;
  };
  try {
    const init = await request('initialize', { protocolVersion: VERSIONS[0], capabilities: {}, clientInfo: CLIENT }, lim.connectMs);
    if (!VERSIONS.includes(init?.protocolVersion)) throw fail(`The server speaks MCP ${init?.protocolVersion || '(unknown)'}; this client speaks ${VERSIONS.join(', ')}`, 'version');
    tr.setVersion(init.protocolVersion);
    await tr.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const session = {
      info: { version: init.protocolVersion, server: init.serverInfo || {}, tools: !!init.capabilities?.tools },
      listTools: async () => {
        const tools = []; let cursor;
        for (let page = 0; page < 20; page++) {
          const r = await request('tools/list', cursor ? { cursor } : {}, lim.callMs);
          tools.push(...(Array.isArray(r?.tools) ? r.tools : []));
          if (!r?.nextCursor) break;
          cursor = r.nextCursor;
        }
        return tools.filter((t) => t && typeof t.name === 'string').map((t) => ({ name: t.name, title: t.title || t.annotations?.title || '', description: String(t.description || '').slice(0, 1000),
          inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' }, readOnlyHint: t.annotations?.readOnlyHint === true }));
      },
      callTool: (name, args = {}) => request('tools/call', { name, arguments: args }, lim.callMs),
    };
    return await fn(session);
  } finally { await tr.close(); }
}

// the two things the server ever does, one at a time per server (key: the registry id)
export const listTools = (key, def, opts) => serial(key, () => withSession(def, async (s) => ({ info: s.info, tools: await s.listTools() }), opts));
export const callTool = (key, def, name, args, opts) => serial(key, () => withSession(def, (s) => s.callTool(name, args), opts));
