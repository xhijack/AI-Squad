// SPDX-License-Identifier: Apache-2.0
// Masking an integration's secrets (1.6.1) wherever it is shown, logged or written. A key can sit in a header, an env
// value, an argument, or the URL itself (https://host/api/mcp/<key>, ?api_key=…, user:pass@). The real values are used
// only inside server/mcp.js at call time; everything that leaves it (errors, results) is scrubbed with scrub().
import { redact, sensitiveName } from './redact.js';

export const REF = /\$\{[^}]*\}/g;
const DOTS = '••••';
const tail = (s) => `${DOTS}${s.length >= 12 ? s.slice(-4) : ''}`;

// a value that looks like a key: a long token (20+ of [A-Za-z0-9_-] with letters and digits, or 32+ of any of them),
// a UUID, a JWT
export function looksLikeKey(v) {
  const s = String(v ?? '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}$/.test(s)
    || (/^[A-Za-z0-9_-]{20,}$/.test(s) && (s.length >= 32 || (/\d/.test(s) && /[A-Za-z]/.test(s))));
}
// a query parameter named like a credential
const KEY_NAME = /key|token|secret|auth|sig|pass|cred|session|code/i;

export function maskValue(v, name = '') {
  const s = String(v ?? '');
  const lit = s.replace(REF, '').replace(/^(Bearer|Basic|token)\s+/i, '').replace(/[\s:]/g, '');
  if (!lit) return s;                                                     // only ${VAR} references: nothing secret here
  const secret = sensitiveName(name) || /^(authorization|x-api-key|api-?key)$/i.test(name) || redact(s, { pii: false }) !== s || looksLikeKey(lit) || (lit.length >= 24 && /^[\w.~+/=-]+$/.test(lit) && /\d/.test(lit) && /[a-z]/i.test(lit));
  return secret ? tail(lit) : s;
}
// a path segment or a query value: kept when it is a ${VAR} reference or plain words
const part = (raw, name = '') => {
  if (!raw || /^\$\{[^}]*\}$/.test(raw)) return raw;
  let dec = raw; try { dec = decodeURIComponent(raw); } catch { /* as it is */ }
  return (name && KEY_NAME.test(name)) || looksLikeKey(dec) || redact(dec, { pii: false }) !== dec ? tail(dec) : raw;
};
// https://user:pass@host/api/mcp/<key>?api_key=x&team=a -> https://••••@host/api/mcp/••••a1b2?api_key=••••&team=a
export function maskUrl(u) {
  const s = String(u ?? '');
  const m = s.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i);
  if (!m) return maskValue(s, 'url');
  const [, scheme, authority, pth, query = '', hash = ''] = m;
  const at = authority.lastIndexOf('@');
  const host = at >= 0 ? `${DOTS}@${authority.slice(at + 1)}` : authority;
  const segs = pth.split('/').map((x) => part(x)).join('/');
  const q = query ? `?${query.slice(1).split('&').map((kv) => { const i = kv.indexOf('='); return i < 0 ? part(kv) : `${kv.slice(0, i)}=${part(kv.slice(i + 1), kv.slice(0, i))}`; }).join('&')}` : '';
  return `${scheme}${host}${segs}${q}${hash ? '#…' : ''}`;
}
export function maskArgs(args = []) {
  return args.map((a, i) => {
    const kv = String(a).match(/^(--?[\w.-]+|[A-Za-z_][\w.-]*)=(.*)$/);
    if (kv) return `${kv[1]}=${/^[a-z][a-z0-9+.-]*:\/\//i.test(kv[2]) ? maskUrl(kv[2]) : maskValue(kv[2], kv[1].replace(/^-+/, ''))}`;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(String(a))) return maskUrl(a);
    const prev = i ? String(args[i - 1]) : '';
    return maskValue(a, /^--?[\w.-]+$/.test(prev) ? prev.replace(/^-+/, '') : '');
  });
}

// the literal secrets of a (resolved) definition: what scrub() removes from any text that leaves the client
export function secretsOf(def = {}) {
  const out = new Set();
  const add = (v) => { const s = String(v ?? '').trim(); if (s.length >= 6) out.add(s); };
  const fromUrl = (u) => {
    const m = String(u || '').match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/i);
    if (!m) return;
    const at = m[1].lastIndexOf('@');
    if (at >= 0) for (const x of m[1].slice(0, at).split(':')) { add(x); try { add(decodeURIComponent(x)); } catch { /* raw */ } }
    for (const seg of m[2].split('/')) if (part(seg) !== seg) { add(seg); try { add(decodeURIComponent(seg)); } catch { /* raw */ } }
    for (const kv of (m[3] || '').slice(1).split('&')) { const i = kv.indexOf('='); const [k, v] = i < 0 ? ['', kv] : [kv.slice(0, i), kv.slice(i + 1)]; if (v && part(v, k) !== v) { add(v); try { add(decodeURIComponent(v)); } catch { /* raw */ } } }
  };
  fromUrl(def.url);
  for (const [k, v] of Object.entries(def.headers || {})) if (maskValue(v, k) !== v) { add(v); add(String(v).replace(/^(Bearer|Basic|token)\s+/i, '')); }
  for (const [k, v] of Object.entries(def.env || {})) if (maskValue(v, k) !== v) add(v);
  for (const a of def.args || []) { fromUrl(a); const kv = String(a).match(/=(.*)$/); if (kv && maskValue(kv[1]) !== kv[1]) add(kv[1]); }
  maskArgs(def.args || []).forEach((m, i) => { if (m !== def.args[i] && !/=/.test(def.args[i])) add(def.args[i]); });
  return [...out].sort((a, b) => b.length - a.length);
}
// a text that may echo a definition's URL or keys (an HTTP error, a stderr line, a tool's result): every URL masked,
// every literal secret replaced, then the log's own secret rules
export function scrub(text, def = {}) {
  let s = String(text ?? '');
  for (const x of secretsOf(def)) s = s.split(x).join(tail(x));
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (u) => maskUrl(u));
  return redact(s, { pii: false });
}
// every string in a tool's result
export function scrubDeep(v, def, secrets = secretsOf(def)) {
  if (typeof v === 'string') { let s = v; for (const x of secrets) s = s.split(x).join(tail(x)); return s; }
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, def, secrets));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x, def, secrets)]));
  return v;
}
