// SPDX-License-Identifier: Apache-2.0
// How background runs sign in to Claude (docs/BILLING.md). Interactive agents (tmux, the Desk) always use the
// `claude` login of this machine. Background runs (`claude -p`: headless jobs, audits, recommendations) use it too
// in "subscription" mode; in "api-key" mode they get ANTHROPIC_API_KEY from ~/.aisquad/secrets.json (mode 600), so
// unattended work is billed to a Console organization (with its spend limits and the plan's API credits).
// The key is write-only: the UI only ever sees "set ····abcd"; it never goes into a repository, a log or a browser.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { readJson, bad } from './util.js';

export const MODES = ['subscription', 'api-key'];
export const cleanAuth = (a = {}) => ({ mode: MODES.includes(a?.mode) ? a.mode : 'subscription' });

const secretsFile = () => path.join(config.home, 'secrets.json');
function writeSecrets(s) {
  fs.mkdirSync(config.home, { recursive: true });
  fs.writeFileSync(secretsFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.chmodSync(secretsFile(), 0o600);
}
export function apiKey() {
  const s = readJson(secretsFile(), null);
  return s?.anthropic?.key ? { key: s.anthropic.key, source: 'settings', setAt: s.anthropic.setAt || null } : null;
}
export function keyStatus() {
  const k = apiKey();
  return k ? { set: true, last4: k.key.slice(-4), setAt: k.setAt } : { set: false, last4: '', setAt: null };
}
export function setApiKey(key) {
  const k = String(key || '').trim();
  if (!/^sk-ant-[\w-]{20,300}$/.test(k)) throw bad('That does not look like an Anthropic API key (sk-ant-…)');
  const s = readJson(secretsFile(), {}) || {};
  s.anthropic = { key: k, setAt: new Date().toISOString() };
  writeSecrets(s);
  return keyStatus();
}
export function clearApiKey() {
  const s = readJson(secretsFile(), {}) || {};
  delete s.anthropic;
  writeSecrets(s);
  return keyStatus();
}
// the environment a background run adds: the key in api-key mode. Without a key in that mode the run is refused,
// so unattended work never falls back to a personal subscription by surprise.
export function backgroundEnv(auth = {}) {
  const a = cleanAuth(auth);
  if (a.mode !== 'api-key') return {};
  const k = apiKey();
  if (!k) throw bad('Background runs are set to use an API key, but no key is saved (Menu → Claude sign-in)');
  return { ANTHROPIC_API_KEY: k.key };
}
