// SPDX-License-Identifier: Apache-2.0
// Cloudflare Access check (1.9, optional): with building.json prefs.cfAccess { teamDomain, aud } every request that
// comes through the tunnel must carry a valid Cf-Access-Jwt-Assertion: an RS256 token signed by one of the team's
// public keys (https://<teamDomain>/cdn-cgi/access/certs, cached for an hour), for this application's audience, not
// expired. Checked with node:crypto only. The PIN and the session are still required behind it; the token's e-mail
// goes into auth.signed_in. Off on a VPS without Access.
import crypto from 'node:crypto';

export const HEADER = 'cf-access-jwt-assertion';
const KEYS_MS = 3600e3, REFETCH_MS = 5 * 60e3, SKEW_S = 60;

export function cleanCfAccess(c) {
  const team = String(c?.teamDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const aud = String(c?.aud || '').trim();
  return team && aud && /^[a-z0-9.-]+$/.test(team) ? { teamDomain: team, aud } : null;
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
class AccessError extends Error {}

// -> { verify(token): Promise<{ email, sub }> } (throws on anything wrong)
export function verifier(settings, { fetchFn = fetch, now = () => Date.now() } = {}) {
  const cfg = cleanCfAccess(settings);
  if (!cfg) throw new Error('cfAccess needs teamDomain and aud');
  const issuer = `https://${cfg.teamDomain}`;
  let keys = new Map(), fetchedAt = 0, inflight = null;
  async function refresh() {
    inflight ||= (async () => {
      const r = await fetchFn(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new AccessError(`Access keys: HTTP ${r.status}`);
      const j = await r.json();
      const next = new Map();
      for (const k of j.keys || []) { if (k.kty === 'RSA' && k.kid) { try { next.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })); } catch { /* a key we cannot read */ } } }
      keys = next; fetchedAt = now();
    })().finally(() => { inflight = null; });
    return inflight;
  }
  async function keyFor(kid) {
    if (!fetchedAt || now() - fetchedAt > KEYS_MS) await refresh();
    else if (!keys.has(kid) && now() - fetchedAt > REFETCH_MS) await refresh();    // keys rotated: look again, not on every request
    return keys.get(kid);
  }
  return {
    settings: cfg,
    async verify(token) {
      const parts = String(token || '').split('.');
      if (parts.length !== 3) throw new AccessError('No Cloudflare Access token');
      let head, claims;
      try { head = b64json(parts[0]); claims = b64json(parts[1]); } catch { throw new AccessError('Unreadable Cloudflare Access token'); }
      if (head.alg !== 'RS256') throw new AccessError('Unexpected token algorithm');
      const key = await keyFor(head.kid);
      if (!key) throw new AccessError('Unknown signing key');
      const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
      if (!ok) throw new AccessError('Bad signature');
      const t = now() / 1000;
      if (claims.iss !== issuer) throw new AccessError('Wrong issuer');
      if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(cfg.aud)) throw new AccessError('Wrong audience');
      if (!Number.isFinite(claims.exp) || claims.exp + SKEW_S < t) throw new AccessError('Expired token');
      if (Number.isFinite(claims.nbf) && claims.nbf - SKEW_S > t) throw new AccessError('Token not valid yet');
      return { email: String(claims.email || ''), sub: String(claims.sub || '') };
    },
  };
}
