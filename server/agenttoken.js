// SPDX-License-Identifier: Apache-2.0
// A Space's agent token (1.8): how a tool running inside an agent's session (bin/google-mcp.js) asks the server for
// something on the Space's behalf, without the PIN and without any outside key. One random token per Space, kept on
// this machine (~/.aisquad/agent-tokens.json, 0600), given to that Space's sessions only as a hidden variable
// (AISQUAD_SPACE_TOKEN, never on a command line, in a repository or in the browser). The server answers a token only
// for its own Space's routes (POST /api/google/agent), so one Space's agents never read another Space's data.
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson } from './util.js';

const file = () => path.join(config.home, 'agent-tokens.json');
const load = () => { const j = readJson(file(), null); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; };
export const ENV = 'AISQUAD_SPACE_TOKEN';
export const HEADER = 'x-aisquad-space';
// the Space's token, made on first use; a new one when asked (the old one stops working at once)
export function tokenFor(floorId, { rotate = false } = {}) {
  const all = load();
  if (!all[floorId] || rotate) { all[floorId] = crypto.randomBytes(24).toString('hex'); writeJson(file(), all, 0o600); }
  return all[floorId];
}
// the Space a token belongs to, or null (compared in constant time)
export function floorOfToken(tok) {
  const t = String(tok || '');
  if (!/^[0-9a-f]{48}$/.test(t)) return null;
  for (const [id, v] of Object.entries(load())) if (typeof v === 'string' && v.length === t.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(t))) return id;
  return null;
}
