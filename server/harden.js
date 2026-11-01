// SPDX-License-Identifier: Apache-2.0
// Browser hardening (1.9): an origin check on every change and on a WebSocket upgrade, security headers on every
// answer, and body limits.
//   - A POST, PUT, PATCH or DELETE (and an upgrade) is allowed when its Origin, or without one its Referer, is the host
//     the server is reached at or prefs.publicUrl. A request with neither is not from a browser page (agent hooks, the
//     command line, curl) and is left to the PIN and the session: cross-site requests from a browser always carry Origin.
//   - Content-Security-Policy is self only (three.js is vendored, no CDN); the page's few inline scripts are allowed by
//     their hashes. Inline style attributes stay allowed: the UI builds markup with them.
import crypto from 'node:crypto';

export const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const BODY_LIMIT = 256 * 1024;          // JSON bodies, unless a route says otherwise
export const MAX_BODY = 25 * 1024 * 1024;      // nothing is ever read beyond this

const hostOf = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.host.toLowerCase() : null; } catch { return null; } };

// -> true when the request's page is ours (or it is not from a browser page at all)
export function originAllowed(req, { host = '', publicUrl = '' } = {}) {
  const from = req.headers.origin ?? req.headers.referer;
  if (from == null || from === '') return true;
  const h = hostOf(from);
  if (!h) return false;                       // "null" (a sandboxed frame, a file) and odd schemes
  return (!!host && h === String(host).toLowerCase()) || (!!publicUrl && h === hostOf(publicUrl));
}

// the hashes of a page's inline <script> blocks, for its CSP
export function scriptHashes(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) out.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  return out;
}
export function csp({ scripts = [] } = {}) {
  return [
    "default-src 'self'", `script-src 'self'${scripts.length ? ' ' + scripts.join(' ') : ''}`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "media-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "worker-src 'self' blob:",
    "frame-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
}
export const PERMISSIONS = 'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()';

// the headers every answer carries; https adds HSTS in public mode (a browser ignores it over plain HTTP anyway)
export function securityHeaders({ isPublic = false, https = false, scripts = [] } = {}) {
  return {
    'content-security-policy': csp({ scripts }), 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
    'permissions-policy': PERMISSIONS, 'x-content-type-options': 'nosniff', 'cross-origin-opener-policy': 'same-origin',
    ...(isPublic && https ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  };
}

// a declared body larger than the limit is refused before anything is read
export function tooLarge(req, limit = BODY_LIMIT) {
  const n = Number(req.headers['content-length']);
  return Number.isFinite(n) && n > limit;
}
