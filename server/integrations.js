// SPDX-License-Identifier: Apache-2.0
// Integrations (1.6): the MCP servers the Building knows, read-only from where they already are:
//   user     Claude Code's user scope (~/.claude.json mcpServers): the Owner's own servers
//   space    a Space's .mcp.json (committed in its repository): that Space's servers
//   erpnext  the ERPNext MCP that AI Squad writes (~/.aisquad/erpnext/mcp.json), with the Space's ERPNext key
// What the Owner decides lives on this machine (~/.aisquad/integrations.json, 0600): a kind per server (what it
// measures, for the Blueprints' `requires: mcp:<kind>`), the tools marked read-only (only those may feed a target;
// none by default), and the last Test connection (tools and input schemas).
// Secrets never leave their place: header, env and argument values that are secrets are shown masked; ${VAR}
// references are resolved from the server's environment (and the Space's ERPNext key) at call time only, and
// a stdio server gets only those variables and a minimal environment, never the server's own.
// Scope: an Owner-only Space uses the Owner's servers, its own .mcp.json and ERPNext with the owner key; a team Space
// its own .mcp.json and ERPNext with its role's key, never the Owner's personal servers (the ERPNext key rule).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as building from './building.js';
import * as erp from './erpnext.js';
import * as mcp from './mcp.js';
import { redact, sensitiveName } from './redact.js';
import { readJson, writeJson, bad, notFound, oneLine } from './util.js';

export const KINDS = ['social-scheduler', 'analytics', 'ads', 'helpdesk', 'database', 'crm', 'erp', 'other'];
export const SOURCES = ['user', 'space', 'erpnext'];
export const LOG_FALLBACK = 'independents';         // integration.tested when no Space can use the server
const NAME = /^[\w.-]{1,64}$/;
export const ID = /^(user:[\w.-]{1,64}|space:[\w-]{1,60}:[\w.-]{1,64}|erpnext)$/;
const stateFile = () => path.join(config.home, 'integrations.json');
export const claudeJson = () => path.join(path.dirname(config.claudeHome), '.claude.json');
export const deps = { log: () => {} };

// ---------- the three sources ----------
const transportOf = (raw) => (raw.type === 'sse' ? 'sse' : raw.type === 'stdio' || (!raw.type && raw.command) ? 'stdio' : raw.url ? 'http' : 'unknown');
function entry(name, raw, source, floorId = '') {
  if (!NAME.test(name) || !raw || typeof raw !== 'object') return null;
  const strs = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)]));
  return {
    id: source === 'erpnext' ? 'erpnext' : source === 'user' ? `user:${name}` : `space:${floorId}:${name}`, name, source, ...(floorId ? { floorId } : {}),
    transport: transportOf(raw), url: typeof raw.url === 'string' ? raw.url : '', command: typeof raw.command === 'string' ? raw.command : '',
    args: Array.isArray(raw.args) ? raw.args.map(String) : [], headers: strs(raw.headers), env: strs(raw.env), oauth: !!raw.oauth,
  };
}
const serversIn = (file, source, floorId) => { const j = readJson(file, null); const s = j?.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {}; return Object.entries(s).map(([n, raw]) => entry(n, raw, source, floorId)).filter(Boolean); };
const floorJson = (root) => readJson(path.join(root, '.claude', 'aisquad', 'floor.json'), {}) || {};
// the Spaces with what the scope rule needs
export function spaces() {
  return building.loadBuilding().floors.map((f) => { const fl = floorJson(f.path); return { id: f.id, number: f.number, path: f.path, name: fl.name || f.id, access: fl.access === 'owner' ? 'owner' : 'team', erpnext: fl.erpnext || '' }; });
}
export const spaceOfRoot = (root) => spaces().find((s) => path.resolve(s.path) === path.resolve(root)) || null;
const erpFile = () => path.join(config.home, 'erpnext', 'mcp.json');
export function registry() {
  const out = [...serversIn(claudeJson(), 'user')];
  for (const s of spaces()) out.push(...serversIn(path.join(s.path, '.mcp.json'), 'space', s.id));
  if (fs.existsSync(erpFile())) { const e = serversIn(erpFile(), 'erpnext')[0]; if (e) out.push(e); }
  return out;
}
export const find = (id) => registry().find((e) => e.id === id) || null;

// ---------- the Owner's marks and the last test ----------
const loadState = () => { const j = readJson(stateFile(), null); return { servers: j?.servers && typeof j.servers === 'object' ? j.servers : {} }; };
const saveState = (s) => writeJson(stateFile(), s, 0o600);
const marksOf = (id) => loadState().servers[id] || {};
// a kind from the name when the Owner has not chosen one
export function guessKind(name = '') {
  const n = String(name).toLowerCase();
  if (/postiz|buffer|hootsuite|publer|later|social|meta|instagram|linkedin|twitter|tiktok/.test(n)) return 'social-scheduler';
  if (/analytic|\bga4?\b|plausible|matomo|posthog|umami|search-?console/.test(n)) return 'analytics';
  if (/\bads?\b|adwords|google-ads|meta-ads/.test(n)) return 'ads';
  if (/zendesk|freshdesk|helpdesk|help-desk|intercom|support|crisp/.test(n)) return 'helpdesk';
  if (/postgres|mysql|sqlite|supabase|database|\bdb\b|mongo|bigquery/.test(n)) return 'database';
  if (/hubspot|pipedrive|salesforce|crm/.test(n)) return 'crm';
  if (/erpnext|frappe|odoo/.test(n)) return 'erp';
  return 'other';
}
export function setMarks(id, { kind, readOnly } = {}) {
  if (!ID.test(String(id || '')) || !find(id)) throw notFound('Integration not found');
  const st = loadState(), cur = st.servers[id] || {};
  if (kind !== undefined && !KINDS.includes(kind)) throw bad(`Kind: ${KINDS.join(', ')}`);
  let ro = cur.readOnly || [];
  if (readOnly !== undefined) {
    if (!Array.isArray(readOnly)) throw bad('Read-only tools: a list of tool names');
    const known = new Set((cur.tested?.tools || []).map((t) => t.name));
    const unknown = readOnly.filter((t) => !known.has(t));
    if (unknown.length) throw bad(`Test the connection first: ${unknown.slice(0, 3).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not among its tools`);
    ro = [...new Set(readOnly)].slice(0, 100);
  }
  st.servers[id] = { ...cur, ...(kind !== undefined ? { kind } : {}), readOnly: ro };
  saveState(st);
  return view(find(id));
}

// ---------- masking (what the browser sees) ----------
const REF = /\$\{[^}]*\}/g;
export function maskValue(v, name = '') {
  const s = String(v ?? '');
  const lit = s.replace(REF, '').replace(/^(Bearer|Basic|token)\s+/i, '').replace(/[\s:]/g, '');
  if (!lit) return s;                                                     // only ${VAR} references: nothing secret here
  const secret = sensitiveName(name) || /^(authorization|x-api-key|api-?key)$/i.test(name) || redact(s, { pii: false }) !== s || (lit.length >= 24 && /^[\w.~+/=-]+$/.test(lit) && /\d/.test(lit) && /[a-z]/i.test(lit));
  return secret ? `••••${lit.length >= 12 ? lit.slice(-4) : ''}` : s;
}
export function maskUrl(u) {
  try {
    const url = new URL(String(u).replace(REF, (m) => `__REF${Buffer.from(m).toString('hex')}__`));
    if (url.password) url.password = '••••';
    for (const [k, v] of [...url.searchParams]) url.searchParams.set(k, maskValue(v, k));
    return decodeURI(url.toString()).replace(/__REF([0-9a-f]+)__/g, (m, h) => Buffer.from(h, 'hex').toString());
  } catch { return maskValue(u, 'url'); }
}
export function maskArgs(args = []) {
  return args.map((a, i) => {
    const kv = String(a).match(/^(--?[\w.-]+|[A-Za-z_][\w.-]*)=(.*)$/);
    if (kv) return `${kv[1]}=${maskValue(kv[2], kv[1].replace(/^-+/, ''))}`;
    const prev = i ? String(args[i - 1]) : '';
    return maskValue(a, /^--?[\w.-]+$/.test(prev) ? prev.replace(/^-+/, '') : '');
  });
}
const SOURCE_TEXT = { user: 'Claude Code, your user scope (~/.claude.json)', space: 'the Space\'s .mcp.json', erpnext: 'AI Squad (ERPNext)' };
// why a server cannot feed a target, or '' when it can (with read-only tools)
export function blocker(e, marks = marksOf(e.id)) {
  if (e.transport === 'sse') return 'Uses the old SSE transport: the server reads only streamable HTTP and stdio servers';
  if (e.transport === 'unknown') return 'Neither a URL nor a command: not an MCP server definition the server can use';
  if (e.oauth || marks.tested?.needsSignIn) return 'Needs sign-in in Claude Code (OAuth in a browser): it cannot be used as a target source';
  return '';
}
export function view(e) {
  const m = marksOf(e.id);
  return {
    id: e.id, name: e.name, source: e.source, sourceText: SOURCE_TEXT[e.source], ...(e.floorId ? { floorId: e.floorId } : {}), transport: e.transport,
    ...(e.url ? { url: maskUrl(e.url) } : {}), ...(e.command ? { command: maskValue(e.command, 'command'), args: maskArgs(e.args) } : {}),
    headers: Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k, maskValue(v, k)])), env: Object.fromEntries(Object.entries(e.env).map(([k, v]) => [k, maskValue(v, k)])),
    kind: KINDS.includes(m.kind) ? m.kind : guessKind(e.name), kindSet: KINDS.includes(m.kind), readOnly: m.readOnly || [], tested: m.tested || null,
    blocked: blocker(e, m), usableBy: spaces().filter((s) => usableBy(e, s)).map((s) => s.id),
  };
}
export const list = () => ({ servers: registry().map(view), kinds: KINDS, files: { user: claudeJson(), erpnext: erpFile() } });

// ---------- who may use what ----------
const erpRoleOf = (space) => { try { return erp.measureRole(space); } catch { return null; } };
export function usableBy(e, space) {
  if (!space) return false;
  if (e.source === 'user') return space.access === 'owner';
  if (e.source === 'space') return e.floorId === space.id;
  return !!erp.settings().url && !!erpRoleOf(space);
}
// plain words for why a Space may not use a server
function scopeError(e, space) {
  if (e.source === 'user') return `A team Space never uses the Owner's personal integrations (${e.name} is in Claude Code's user scope); add it to the Space's .mcp.json instead`;
  if (e.source === 'space') return `${e.name} belongs to another Space's .mcp.json; a Space uses only its own`;
  return erp.settings().url ? 'This Space has no ERPNext key to use the ERPNext integration with (Admin → ERPNext)' : 'ERPNext is not set up (Admin → ERPNext)';
}

// ---------- ${VAR} at call time ----------
const BASE_ENV = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ', 'SystemRoot'];
export function expand(s, env, name) {
  return String(s).replace(/\$\{([A-Za-z_][\w]*)(?::-([^}]*))?\}/g, (m, k, dflt) => {
    if (env[k] !== undefined && env[k] !== '') return env[k];
    if (dflt !== undefined) return dflt;
    throw bad(`${name} needs \${${k}}, which is not set in the server's environment`);
  });
}
// the definition with every reference resolved: for the client only, never stored, logged or shown
export function resolve(e, extra = {}, procEnv = process.env) {
  const env = { ...procEnv, ...extra };
  const x = (s) => expand(s, env, e.name);
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, x(v)]));
  if (e.transport === 'http') return { transport: 'http', url: x(e.url), headers: map(e.headers) };
  if (e.transport === 'stdio') {
    const base = Object.fromEntries(BASE_ENV.filter((k) => procEnv[k] !== undefined).map((k) => [k, procEnv[k]]));
    return { transport: 'stdio', command: x(e.command), args: e.args.map(x), env: { ...base, ...map(e.env) } };
  }
  return { transport: e.transport };
}
// the ERPNext MCP's variables: the Space's key (the Owner's key for an Owner-only Space), or the Owner's own for a test
function erpEnv(space) {
  const role = space ? erpRoleOf(space) : ['owner', ...erp.AGENT_ROLES].find((r) => erp.credential(r));
  const c = role && erp.credential(role);
  if (!c) throw bad(erp.settings().url ? 'No ERPNext key (Admin → ERPNext)' : 'ERPNext is not set up (Admin → ERPNext)');
  return { AISQUAD_ERP_URL: erp.settings().url, AISQUAD_ERP_KEY: c.key, AISQUAD_ERP_SECRET: c.secret };
}
const defFor = (e, space) => resolve(e, e.source === 'erpnext' ? erpEnv(space) : {});
const clean = (msg) => oneLine(redact(String(msg || ''), { pii: false }), 300);

// ---------- Test connection ----------
const schemaOf = (s) => { const j = JSON.stringify(s || {}); return j.length <= 8000 ? s : { type: 'object', note: 'schema too large to keep' }; };
export async function test(id, { now = Date.now(), opts } = {}) {
  const e = find(id);
  if (!e) throw notFound('Integration not found');
  const why = e.transport === 'sse' || e.transport === 'unknown' || e.oauth ? blocker(e, {}) : '';
  let tested;
  if (why) tested = { at: now, ok: false, error: why, tools: [] };
  else {
    try {
      const r = await mcp.listTools(id, defFor(e, null), opts);
      tested = { at: now, ok: true, version: r.info.version, serverName: oneLine(r.info.server?.name || '', 60), tools: r.tools.slice(0, 200).map((t) => ({ ...t, inputSchema: schemaOf(t.inputSchema) })) };
    } catch (err) { tested = { at: now, ok: false, error: clean(err.message), code: err.code || '', needsSignIn: err.code === 'auth' && /sign-in/.test(err.message), tools: [] }; }
  }
  const st = loadState();
  const cur = st.servers[id] || {};
  // a tool that is gone is not read-only any more; the marks of the tools still there stay
  const names = new Set(tested.tools.map((t) => t.name));
  st.servers[id] = { ...cur, tested, readOnly: tested.ok ? (cur.readOnly || []).filter((n) => names.has(n)) : cur.readOnly || [] };
  saveState(st);
  const ev = { type: 'integration.tested', data: { server: id, name: e.name, source: e.source, transport: e.transport, ok: tested.ok, tools: tested.tools.length, ...(tested.ok ? {} : { error: tested.error }) } };
  const who = spaces().filter((s) => usableBy(e, s));
  for (const s of who.length ? who : [{ id: LOG_FALLBACK }]) deps.log(s.id, ev);
  return view(find(id));
}

// ---------- a target's call ----------
// the server, the tool and the Space checked in plain words; -> { entry, space }
export function checkUse(space, source) {
  const e = find(source.server);
  if (!e) throw bad(`The integration "${source.server}" is not known on this machine (Admin → Integrations)`);
  const b = blocker(e);
  if (b) throw bad(`${e.name}: ${b}`);
  if (!space) throw bad('The Space is not registered on this machine');
  if (!usableBy(e, space)) throw bad(scopeError(e, space));
  if (!(marksOf(e.id).readOnly || []).includes(source.tool)) throw bad(`The tool "${source.tool}" of ${e.name} is not marked read-only (Admin → Integrations): only read-only tools feed a target`);
  return e;
}
// one tools/call for a target (or its Try): the result as the server gave it
export async function call(space, source, args, opts) {
  const e = checkUse(space, source);
  try { return await mcp.callTool(e.id, defFor(e, space), source.tool, args, opts); }
  catch (err) { throw bad(`${e.name}: ${clean(err.message)}`); }
}
