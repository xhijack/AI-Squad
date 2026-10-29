// SPDX-License-Identifier: Apache-2.0
// Runtime paths and settings. Everything is overridable so tests can use scratch directories.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// version of this checkout; /aisquad compares it with the running server to restart it after an update
export const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } })();

// Paths are made absolute once, against the folder the server was started from (1.5.1): jobs and agents run in their
// Space's folder, where a relative AISQUAD_HOME pointed somewhere else and every job ended "without a result".
// A bare claude binary name stays as it is: it is looked up on PATH.
const PATHS = { home: path.resolve, claudeHome: path.resolve, procDir: path.resolve, claudeBin: (p) => (p.includes('/') ? path.resolve(p) : p) };
const absolute = (over) => { for (const [k, fn] of Object.entries(PATHS)) if (over[k]) over[k] = fn(String(over[k])); return over; };

export const config = absolute({
  home: process.env.AISQUAD_HOME || path.join(os.homedir(), '.aisquad'),
  claudeHome: process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude'),
  tmuxSocket: process.env.AISQUAD_TMUX_SOCKET || '',     // empty = default tmux server
  scanTmuxSocket: process.env.AISQUAD_SCAN_TMUX_SOCKET || '',   // where the first-run scan looks for claude panes
  procDir: process.env.AISQUAD_PROC || '/proc',
  claudeBin: process.env.CLAUDE_BIN || '',
  useSystemd: process.env.AISQUAD_NO_SYSTEMD !== '1',
  useHooks: process.env.AISQUAD_NO_HOOKS !== '1',             // start agents with our plugin hooks (--plugin-dir)
  serverUrl: process.env.AISQUAD_URL || `http://127.0.0.1:${process.env.AISQUAD_PORT || 8097}`,       // systemd-run --user --scope when available
  defaultRoles: path.join(ROOT, 'templates', 'roles'),
});

export function configure(over) { Object.assign(config, absolute({ ...over })); }

export const paths = {
  building: () => path.join(config.home, 'building.json'),
  roles: () => path.join(config.home, 'roles'),
  roleHistory: () => path.join(config.home, 'roles', '.history'),
  libraries: () => path.join(config.home, 'libraries.json'),
  pin: () => path.join(config.home, 'pin'),
  runtime: () => path.join(config.home, 'runtime.json'),
  independents: () => path.join(config.home, 'independents.json'),
  attachments: () => path.join(config.home, 'attachments'),
  claudeProjects: () => path.join(config.claudeHome, 'projects'),
  claudeTeams: () => path.join(config.claudeHome, 'teams'),
};

// claude binary: explicit setting, next to the running node (nvm installs), else PATH
export function claudeBin() {
  for (const p of [config.claudeBin, path.join(path.dirname(process.execPath), 'claude')]) if (p && fs.existsSync(p)) return p;
  return 'claude';
}
