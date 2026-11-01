// SPDX-License-Identifier: Apache-2.0
// Online access (1.9): public mode and the proxy in front. Behind Cloudflare Tunnel, Caddy or Nginx the server sits on
// 127.0.0.1, so every request looks local; public mode makes every route, reads included, need a signed-in person.
//   - On with --public or building.json prefs.public, and by itself on the first request that carries proxy headers
//     (X-Forwarded-For, Forwarded, CF-Connecting-IP). Once on it stays on until the next restart.
//   - prefs.trustProxy (hops, default 1 in public mode, 0 otherwise) says how many proxies to believe when finding the
//     client address, the scheme and the host. Headers are only believed from a loopback peer: a proxy sits on this
//     machine; anything else could be a person typing headers.

export const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'cf-connecting-ip'];
export const hasProxyHeaders = (req) => PROXY_HEADERS.some((h) => req.headers[h] != null);

// -> { on(), observe(req), reason() }; setting() reads prefs.public live
export function publicMode({ flag = false, setting = () => false } = {}) {
  let latched = flag ? 'flag' : '';
  const api = {
    observe(req) { if (!latched && hasProxyHeaders(req)) latched = 'proxy-headers'; return api.on(); },
    on() { if (!latched && setting()) latched = 'setting'; return !!latched; },
    reason: () => (api.on() ? latched : ''),
  };
  return api;
}

const strip = (a) => {
  let s = String(a || '').trim().replace(/^"|"$/g, '');
  if (s.startsWith('[')) return s.slice(1, s.indexOf(']')).toLowerCase();       // [2001:db8::1]:4711
  if (/^[\d.]+:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));                // 1.2.3.4:5678
  return s.replace(/^::ffff:(?=\d+\.)/, '').toLowerCase();
};
export const isLoopbackAddr = (a) => { const s = strip(a); return s === '::1' || /^127\./.test(s); };
const peerOf = (req) => strip(req.socket?.remoteAddress || '');

export const hopsOf = (trustProxy, isPublic) => {
  const n = parseInt(trustProxy, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 10) : isPublic ? 1 : 0;
};
// are the proxy headers of this request believed?
export const trusted = (req, hops) => hops > 0 && isLoopbackAddr(peerOf(req));

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
// Forwarded: for=1.2.3.4;proto=https, for="[::1]" -> [{ for, proto, host }]
function forwarded(v) {
  return list(v).map((part) => Object.fromEntries(part.split(';').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i).trim().toLowerCase(), kv.slice(i + 1).trim().replace(/^"|"$/g, '')]; })));
}

// the client's address: the peer, or with `hops` trusted proxies the address that many hops back in the chain
export function clientAddress(req, hops = 0) {
  const peer = peerOf(req);
  if (!trusted(req, hops)) return peer;
  const fwd = req.headers.forwarded ? forwarded(req.headers.forwarded).map((f) => f.for).filter(Boolean) : list(req.headers['x-forwarded-for']);
  const chain = fwd.length ? fwd : list(req.headers['cf-connecting-ip']);
  if (!chain.length) return peer;
  const addrs = [peer, ...chain.reverse().map(strip)];        // nearest first
  return addrs[Math.min(hops, addrs.length - 1)];
}
// did the browser reach us over HTTPS?
export function isHttps(req, hops = 0) {
  if (req.socket?.encrypted) return true;
  if (!trusted(req, hops)) return false;
  const f = req.headers.forwarded ? forwarded(req.headers.forwarded).map((x) => x.proto).filter(Boolean) : list(req.headers['x-forwarded-proto']);
  return String(f.at(-1) || '').toLowerCase() === 'https';
}
// the host the browser asked for
export function requestHost(req, hops = 0) {
  if (trusted(req, hops)) {
    const f = req.headers.forwarded ? forwarded(req.headers.forwarded).map((x) => x.host).filter(Boolean) : list(req.headers['x-forwarded-host']);
    if (f.length) return f.at(-1).toLowerCase();
  }
  return String(req.headers.host || '').toLowerCase();
}
// a tool on this machine (agent hooks, the command line): a loopback peer with no proxy in between
export const isLocalTool = (req) => isLoopbackAddr(peerOf(req)) && !hasProxyHeaders(req);
