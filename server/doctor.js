// SPDX-License-Identifier: Apache-2.0
// `aisquad doctor`: checks that this machine can run The AI Squad and that the Building is whole (after an install,
// a restore or a move to another machine). Each check -> { id, title, status: ok | warn | fail, detail, fix }.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, paths, claudeBin, VERSION } from './config.js';
import { readJson } from './util.js';
import { readSchema, SCHEMA_VERSION } from './schema.js';
import { readResources } from './watchdog.js';
import * as backup from './backup.js';

const run = (file, args) => { try { return execFileSync(file, args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; } };
const gb = (b) => `${(b / 2 ** 30).toFixed(1)} GB`;
const modeOf = (f) => { try { return fs.statSync(f).mode & 0o777; } catch { return null; } };

export function runDoctor({ service = null, now = Date.now() } = {}) {
  const out = [];
  const add = (id, title, status, detail, fix = '') => out.push({ id, title, status, detail, fix });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', 'Node.js', major >= 22 ? 'ok' : 'fail', `Node.js ${process.versions.node}`, major >= 22 ? '' : 'Install Node.js 22 or newer');
  const tmux = run('tmux', ['-V']);
  add('tmux', 'tmux', tmux ? 'ok' : 'fail', tmux || 'not found', tmux ? '' : 'Install tmux (agents run in tmux sessions)');
  const claude = run(claudeBin(), ['--version']);
  add('claude', 'Claude Code', claude ? 'ok' : 'fail', claude ? `${claude} (${claudeBin()})` : `not found (${claudeBin()})`, claude ? '' : 'Install Claude Code and sign in, or set CLAUDE_BIN');
  const gitV = run('git', ['--version']);
  add('git', 'git', gitV ? 'ok' : 'fail', gitV || 'not found', gitV ? '' : 'Install git');

  if (service) {
    if (service.mode === 'systemd') add('service', 'Server service', service.installed ? (service.linger === 'no' ? 'warn' : 'ok') : 'warn',
      service.installed ? `aisquad.service ${service.active || ''}${service.linger === 'no' ? ', stops at logout' : ''}` : 'not installed',
      !service.installed ? 'Run /aisquad to install it' : service.linger === 'no' ? 'loginctl enable-linger $USER keeps it running without a login' : '');
    else add('service', 'Server service', 'ok', service.mode === 'launchd' ? 'launchd agent' : 'detached process (no systemd or launchd)');
  }

  const homeOk = fs.existsSync(config.home);
  add('home', 'Data folder', homeOk ? 'ok' : 'warn', config.home, homeOk ? '' : 'Run /aisquad once: it creates the folder');
  const sch = readSchema();
  add('schema', 'Data version', sch.version > SCHEMA_VERSION ? 'fail' : sch.version < SCHEMA_VERSION ? 'warn' : 'ok', `version ${sch.version} (this release: ${SCHEMA_VERSION})`,
    sch.version > SCHEMA_VERSION ? 'The data comes from a newer AI Squad: update the plugin' : sch.version < SCHEMA_VERSION ? 'Start the server once: it migrates the data' : '');
  const pinMode = modeOf(paths.pin());
  add('pin', 'PIN file', pinMode == null ? 'warn' : pinMode & 0o077 ? 'fail' : 'ok', pinMode == null ? 'not created yet' : `mode ${pinMode.toString(8)}`,
    pinMode == null ? 'Start the server once' : pinMode & 0o077 ? `chmod 600 ${paths.pin()}` : '');
  const secrets = path.join(config.home, 'secrets.json'), sMode = modeOf(secrets);
  if (sMode != null) add('secrets', 'Secrets file', sMode & 0o077 ? 'fail' : 'ok', `mode ${sMode.toString(8)}`, sMode & 0o077 ? `chmod 600 ${secrets}` : '');

  const b = readJson(path.join(config.home, 'building.json'), {}) || {};
  for (const f of Array.isArray(b.floors) ? b.floors : []) {
    const has = fs.existsSync(path.join(f.path, '.claude', 'aisquad', 'floor.json'));
    if (!fs.existsSync(f.path)) { add(`floor:${f.id}`, `Floor ${f.number} · ${f.id}`, 'fail', `${f.path} is missing`, 'Clone or copy the project there, or restore with --relink'); continue; }
    if (!has) { add(`floor:${f.id}`, `Floor ${f.number} · ${f.id}`, 'fail', `${f.path} has no .claude/aisquad/floor.json`, 'Restore the Floor configuration from a backup, or remove the Floor'); continue; }
    const repos = readJson(path.join(f.path, '.claude', 'aisquad', 'repos.json'), {})?.repos || [];
    const missing = repos.filter((r) => !fs.existsSync(f.repos?.[r.id] || path.resolve(f.path, r.path)));
    add(`floor:${f.id}`, `Floor ${f.number} · ${f.id}`, missing.length ? 'warn' : 'ok', missing.length ? `linked repositories missing: ${missing.map((r) => r.id).join(', ')}` : f.path,
      missing.length ? 'Floor settings → Repositories: Clone or Relink' : '');
  }

  const res = readResources();
  add('ram', 'Memory', res.mem.total < 8 * 2 ** 30 ? 'warn' : 'ok', `${gb(res.mem.available)} free of ${gb(res.mem.total)}`, res.mem.total < 8 * 2 ** 30 ? 'Under 8 GB: keep the number of agents running at once low (Menu → Backups and health)' : '');
  if (res.disk) add('disk', 'Disk', res.disk.free < 5 * 2 ** 30 ? 'warn' : 'ok', `${gb(res.disk.free)} free`, res.disk.free < 5 * 2 ** 30 ? 'Free some disk space' : '');

  const bs = backup.cleanSettings(b.prefs?.backup), st = backup.readStatus();
  if (!bs.enabled) add('backup', 'Backups', 'warn', 'nightly backups are off', 'Menu → Backups and health, or /aisquad backup');
  else add('backup', 'Backups', st.lastBackup && st.lastBackup.ok && now - st.lastBackup.at < 2 * 864e5 ? 'ok' : 'warn',
    st.lastBackup ? `last ${st.lastBackup.ok ? 'backup' : 'attempt failed'} ${new Date(st.lastBackup.at).toISOString().slice(0, 16).replace('T', ' ')}` : `first backup at ${bs.time}`,
    st.lastBackup && !st.lastBackup.ok ? st.lastBackup.error : '');
  return { version: VERSION, host: os.hostname(), checks: out, ok: !out.some((c) => c.status === 'fail') };
}

export function doctorText(r) {
  const mark = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  return [`The AI Squad ${r.version} on ${r.host}`, ...r.checks.map((c) => `  [${mark[c.status]}] ${c.title}: ${c.detail}${c.fix ? `\n         -> ${c.fix}` : ''}`),
    r.ok ? 'Everything needed is there.' : 'Fix the FAIL lines above.'].join('\n');
}
