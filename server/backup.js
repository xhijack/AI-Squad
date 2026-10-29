// SPDX-License-Identifier: Apache-2.0
// Backup, verify and restore a Building, so it can move to another machine or come back after a disk dies.
// A backup is one .tar.gz (AES-256-GCM encrypted as .tar.gz.enc when a passphrase is given) holding:
//   manifest.json                 what is inside, a sha256 per file, and where every Floor's repository comes from
//                                 (remote, branch, commit, uncommitted changes)
//   home/...                      ~/.aisquad without caches and machine-local state (secrets only when encrypted)
//   floors/<id>/...               each Floor's configuration (.claude/aisquad/, AISQUAD.md), in case it is not committed
//   claude-memory/<id>/...        Claude Code's auto memory of each Floor (~/.claude/projects/<path>/memory)
// The repositories themselves live in git; a restore clones the ones missing on the new machine.
// Zero dependencies: tar (ustar + pax for long names), zlib and node:crypto are written out here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { config, VERSION } from './config.js';
import { readJson, writeJson, writeText, safeReaddir, bad } from './util.js';
import { SCHEMA_VERSION, readSchema } from './schema.js';
import { encodeProjectPath } from './transcripts.js';

export const FORMAT = 'aisquad-backup';
const MAGIC = Buffer.from('AISQB1\n');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------- tar ----------
function header(name, size, { mode = 0o644, mtime = Date.now(), type = '0' } = {}) {
  const b = Buffer.alloc(512);
  const put = (s, off, len) => b.write(s, off, Math.min(len, Buffer.byteLength(s)), 'utf8');
  const oct = (n, off, len) => put(`${Math.max(0, Math.floor(n)).toString(8).padStart(len - 1, '0')}\0`, off, len);
  put(name, 0, 100); oct(mode & 0o7777, 100, 8); oct(0, 108, 8); oct(0, 116, 8); oct(size, 124, 12); oct(mtime / 1000, 136, 12);
  b.fill(' ', 148, 156); put(type, 156, 1); put('ustar\0', 257, 6); put('00', 263, 2);
  let sum = 0; for (const x of b) sum += x;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return b;
}
const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);
// a pax record "<len> path=<name>\n" where <len> counts the whole record, its own digits included
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let n = Buffer.byteLength(body) + 1;
  while (String(n).length + Buffer.byteLength(body) !== n) n = String(n).length + Buffer.byteLength(body);
  return Buffer.from(`${n}${body}`);
}
// entries: [{ name, data: Buffer, mode, mtime }] -> Buffer
export function tarPack(entries) {
  const out = [];
  for (const e of entries) {
    const name = String(e.name);
    if (Buffer.byteLength(name) > 99) {
      const rec = paxRecord('path', name);
      out.push(header(`PaxHeader/${name.slice(-80)}`, rec.length, { type: 'x' }), rec, pad(rec.length));
    }
    out.push(header(name, e.data.length, { mode: e.mode, mtime: e.mtime }), e.data, pad(e.data.length));
  }
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}
const cstr = (b, off, len) => { const s = b.subarray(off, off + len); const z = s.indexOf(0); return (z < 0 ? s : s.subarray(0, z)).toString('utf8'); };
// Buffer -> [{ name, data, mode }] (regular files only)
export function tarUnpack(buf) {
  const out = [];
  let pos = 0, paxPath = null;
  while (pos + 512 <= buf.length) {
    const h = buf.subarray(pos, pos + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(cstr(h, 124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    const prefix = cstr(h, 345, 155);
    const name = prefix ? `${prefix}/${cstr(h, 0, 100)}` : cstr(h, 0, 100);
    const data = buf.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      for (const line of data.toString('utf8').split('\n')) { const m = line.match(/^\d+ path=(.*)$/); if (m) paxPath = m[1]; }
      continue;
    }
    if (type === '0' || type === '\0') out.push({ name: paxPath || name, data: Buffer.from(data), mode: parseInt(cstr(h, 100, 8).trim() || '644', 8) });
    paxPath = null;
  }
  return out;
}

// ---------- encryption (AES-256-GCM, key from the passphrase with scrypt) ----------
const keyOf = (pass, salt) => crypto.scryptSync(String(pass), salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 2 ** 20 });
export const isEncrypted = (buf) => buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
export function encrypt(buf, pass) {
  if (!String(pass || '')) throw bad('A passphrase is required to encrypt');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(pass, salt), iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, ct, c.getAuthTag()]);
}
export function decrypt(buf, pass) {
  if (!isEncrypted(buf)) throw bad('Not an encrypted AI Squad backup');
  if (!String(pass || '')) throw bad('This backup is encrypted: give the passphrase');
  const o = MAGIC.length, salt = buf.subarray(o, o + 16), iv = buf.subarray(o + 16, o + 28), tag = buf.subarray(buf.length - 16), ct = buf.subarray(o + 28, buf.length - 16);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(pass, salt), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch { throw bad('Wrong passphrase, or the backup is damaged'); }
}

// ---------- what goes in ----------
// relative to ~/.aisquad. Caches and clones are rebuilt; runtime state belongs to the old machine's tmux
// sessions; auto-merge approvals are given again on the new machine (a deliberate re-approval)
const EXCLUDE = [/^voice-cache\//, /^libraries\//, /^backups\//, /^exports\//, /^server\.(pid|log)/, /^runtime\.json$/, /^independents\.json$/,
  /^approvals\.json$/, /^backup-status\.json$/, /^backup-passphrase$/, /^usage\.json$/, /\.tmp$/, /(^|\/)\.DS_Store$/];
export const SECRET_FILES = [/^secrets\.json$/, /^pin$/, /^users\.json$/];
const isSecret = (rel) => SECRET_FILES.some((re) => re.test(rel));

function walk(dir, rel = '', out = []) {
  for (const f of safeReaddir(dir)) {
    const abs = path.join(dir, f), r = rel ? `${rel}/${f}` : f;
    let st; try { st = fs.lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(abs, r, out);
    else if (st.isFile()) out.push({ rel: r, abs, mode: st.mode, mtime: st.mtimeMs, size: st.size });
  }
  return out;
}
export function homeFiles({ secrets = false, logs = true } = {}) {
  return walk(config.home).filter((f) => !EXCLUDE.some((re) => re.test(f.rel)) && (secrets || !isSecret(f.rel)) && (logs || !/^logs\//.test(f.rel)));
}

const git = (cwd, args) => { try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
export function repoInfo(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { git: false };
  return { git: true, remote: git(dir, ['remote', 'get-url', 'origin']), branch: git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), head: git(dir, ['rev-parse', 'HEAD']),
    dirty: git(dir, ['status', '--porcelain']).split('\n').filter(Boolean).length };
}
const floorConfigFiles = (root) => [
  ...walk(path.join(root, '.claude', 'aisquad')).map((f) => ({ ...f, rel: `.claude/aisquad/${f.rel}` })),
  ...(fs.existsSync(path.join(root, 'AISQUAD.md')) ? [{ rel: 'AISQUAD.md', abs: path.join(root, 'AISQUAD.md'), mode: 0o644, mtime: Date.now() }] : []),
];
const memoryDir = (root, claudeHome = config.claudeHome) => path.join(claudeHome, 'projects', encodeProjectPath(root), 'memory');

export const backupName = (now = Date.now(), { label = '', encrypted = false } = {}) => {
  const d = new Date(now), p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const host = os.hostname().replace(/[^\w.-]+/g, '-').slice(0, 30) || 'host';
  return `aisquad-backup-${host}-${stamp}${label ? `-${label.replace(/[^\w-]+/g, '-')}` : ''}.tar.gz${encrypted ? '.enc' : ''}`;
};
export const defaultDir = () => path.join(config.home, 'backups');

// opts: { out (a folder or a file), passphrase, secrets, logs, memory, label } -> { file, size, files, floors, encrypted, warnings }
export function createBackup({ out = '', passphrase = '', secrets = false, logs = true, memory = true, label = '', now = Date.now() } = {}) {
  if (secrets && !passphrase) throw bad('Secrets (PIN, API keys) go only into an encrypted backup: give a passphrase');
  const b = readJson(path.join(config.home, 'building.json'), {}) || {};
  const entries = [], files = [], warnings = [];
  const add = (name, data, mode = 0o644, mtime = now) => { entries.push({ name, data, mode, mtime }); files.push({ path: name, size: data.length, sha256: sha(data) }); };
  for (const f of homeFiles({ secrets, logs })) { try { add(`home/${f.rel}`, fs.readFileSync(f.abs), f.mode, f.mtime); } catch { warnings.push(`Could not read ${f.rel}`); } }
  const floors = [];
  for (const f of Array.isArray(b.floors) ? b.floors : []) {
    const exists = fs.existsSync(f.path);
    const info = exists ? repoInfo(f.path) : { git: false };
    const linked = (readJson(path.join(f.path, '.claude', 'aisquad', 'repos.json'), {})?.repos || []).map((r) => ({ id: r.id, path: r.path, access: r.access, remote: r.remote || '' }));
    floors.push({ id: f.id, number: f.number, path: f.path, exists, ...info, linked });
    if (!exists) { warnings.push(`Floor ${f.id}: ${f.path} is missing on this machine; only its registry entry is in the backup`); continue; }
    if (info.dirty) warnings.push(`Floor ${f.id} has ${info.dirty} uncommitted change${info.dirty === 1 ? '' : 's'} that are not in the backup (commit or push them)`);
    if (info.git && !info.remote) warnings.push(`Floor ${f.id} has no git remote: on another machine its repository cannot be cloned`);
    for (const c of floorConfigFiles(f.path)) { try { add(`floors/${f.id}/${c.rel}`, fs.readFileSync(c.abs), c.mode, c.mtime); } catch { /* unreadable */ } }
    if (memory) for (const m of walk(memoryDir(f.path))) { try { add(`claude-memory/${f.id}/${m.rel}`, fs.readFileSync(m.abs), m.mode, m.mtime); } catch { /* unreadable */ } }
  }
  const encrypted = !!passphrase;
  const manifest = { format: FORMAT, version: 1, createdAt: new Date(now).toISOString(), host: os.hostname(), aisquadVersion: VERSION, schemaVersion: readSchema().version || SCHEMA_VERSION,
    home: config.home, encrypted, includes: { secrets: !!secrets, logs: !!logs, memory: !!memory }, floors, files };
  const tar = tarPack([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)), mode: 0o644, mtime: now }, ...entries]);
  let blob = zlib.gzipSync(tar, { level: 6 });
  if (encrypted) blob = encrypt(blob, passphrase);
  const target = /\.tar\.gz(\.enc)?$/.test(out) ? path.resolve(out) : path.join(out ? path.resolve(out) : defaultDir(), backupName(now, { label, encrypted }));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeText(target, blob, 0o600);
  return { file: target, size: blob.length, files: files.length, floors: floors.length, encrypted, warnings };
}

// -> { manifest, entries: Map(name -> Buffer), errors: [] }; throws when it cannot be opened at all
export function readBackup(file, { passphrase = '' } = {}) {
  let buf = fs.readFileSync(file);
  if (isEncrypted(buf)) buf = decrypt(buf, passphrase);
  let tar;
  try { tar = zlib.gunzipSync(buf); } catch { throw bad('Not an AI Squad backup (not a gzip archive), or it is damaged'); }
  const entries = new Map(tarUnpack(tar).map((e) => [e.name, e]));
  const m = entries.get('manifest.json');
  if (!m) throw bad('Not an AI Squad backup: manifest.json is missing');
  let manifest; try { manifest = JSON.parse(m.data.toString('utf8')); } catch { throw bad('The backup manifest is damaged'); }
  if (manifest.format !== FORMAT) throw bad('Not an AI Squad backup');
  const errors = [];
  for (const f of manifest.files || []) {
    const e = entries.get(f.path);
    if (!e) errors.push(`missing: ${f.path}`);
    else if (sha(e.data) !== f.sha256) errors.push(`checksum: ${f.path}`);
  }
  return { manifest, entries, errors };
}
export function verifyBackup(file, opts = {}) {
  try {
    const { manifest, errors } = readBackup(file, opts);
    return { ok: !errors.length, file, createdAt: manifest.createdAt, files: (manifest.files || []).length, floors: (manifest.floors || []).length, encrypted: !!manifest.encrypted, includes: manifest.includes || {}, errors };
  } catch (e) { return { ok: false, file, errors: [e.message] }; }
}

// ---------- restore ----------
// where a Floor goes on this machine: an explicit relink (old prefix -> new prefix), else next to the other
// projects (projectsDir/<folder name>), else the same path
export function mapPath(from, { relink = {}, projectsDir = '' } = {}) {
  for (const [a, b] of Object.entries(relink)) {
    const old = path.resolve(a);
    if (from === old || from.startsWith(old + path.sep)) return path.join(path.resolve(b), path.relative(old, from));
  }
  return projectsDir ? path.join(path.resolve(projectsDir), path.basename(from)) : from;
}
const homeNotEmpty = (home) => safeReaddir(home).some((f) => !/^backups$|^\.?lock$/.test(f));
// a dry run: what restore would do -> { manifest, homeExists, homeFiles, floors: [{ id, from, to, action, remote }], memory, warnings, errors }
export function planRestore(file, { passphrase = '', relink = {}, projectsDir = '', home = config.home, read = null } = {}) {
  const { manifest, entries, errors } = read || readBackup(file, { passphrase });
  const floors = (manifest.floors || []).map((f) => {
    const to = mapPath(f.path, { relink, projectsDir });
    const present = fs.existsSync(path.join(to, '.git')) || fs.existsSync(path.join(to, '.claude', 'aisquad', 'floor.json'));
    return { id: f.id, number: f.number, from: f.path, to, remote: f.remote || '', branch: f.branch || '', head: f.head || '', dirty: f.dirty || 0,
      action: present ? 'present' : f.remote ? 'clone' : 'missing', hasConfig: [...entries.keys()].some((k) => k.startsWith(`floors/${f.id}/.claude/aisquad/`)) };
  });
  const warnings = floors.filter((f) => f.action === 'missing').map((f) => `Floor ${f.id}: ${f.to} does not exist and the backup knows no remote to clone it from; copy the project there or relink it`);
  if (manifest.schemaVersion > SCHEMA_VERSION) warnings.push(`The backup comes from a newer AI Squad (data version ${manifest.schemaVersion}, this one knows ${SCHEMA_VERSION}); update the plugin first`);
  return { manifest: { createdAt: manifest.createdAt, host: manifest.host, aisquadVersion: manifest.aisquadVersion, schemaVersion: manifest.schemaVersion, encrypted: manifest.encrypted, includes: manifest.includes },
    homeExists: homeNotEmpty(home), homeFiles: [...entries.keys()].filter((k) => k.startsWith('home/')).length,
    memory: [...entries.keys()].filter((k) => k.startsWith('claude-memory/')).length, floors, warnings, errors };
}

const stamp = (now) => new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
// opts: { passphrase, force, relink, projectsDir, clone, now } -> { previous, written, floors: [{ id, to, result }], memory, warnings }
export function restore(file, { passphrase = '', force = false, relink = {}, projectsDir = '', clone = true, now = Date.now(), runGit = execFileSync } = {}) {
  const read = readBackup(file, { passphrase });                  // read before anything moves (the file may be inside ~/.aisquad)
  const plan = planRestore(file, { relink, projectsDir, read });
  if (plan.errors.length) throw bad(`The backup is damaged (${plan.errors.length} file${plan.errors.length === 1 ? '' : 's'} fail the check); nothing was restored`);
  if (plan.manifest.schemaVersion > SCHEMA_VERSION) throw bad(plan.warnings.at(-1));
  const home = config.home;
  let previous = null;
  if (plan.homeExists) {
    if (!force) throw bad(`${home} is not empty. Stop the server, then restore with --force: the current folder is kept as ${home}.before-restore-<time>`);
    previous = `${home}.before-restore-${stamp(now)}`;
    fs.renameSync(home, previous);
  }
  const { entries } = read;
  let written = 0;
  for (const [name, e] of entries) {
    if (!name.startsWith('home/')) continue;
    const rel = name.slice(5), target = path.resolve(home, rel);
    if (!target.startsWith(path.resolve(home) + path.sep)) continue;            // never outside the home folder
    writeText(target, e.data, isSecret(rel) ? 0o600 : (e.mode & 0o777) || 0o644);
    written++;
  }
  // the registry points at this machine's folders
  const bPath = path.join(home, 'building.json'), b = readJson(bPath, {}) || {};
  for (const f of b.floors || []) { const p = plan.floors.find((x) => x.id === f.id); if (p) f.path = p.to; }
  writeJson(bPath, b);
  const out = [], warnings = [...plan.warnings];
  for (const f of plan.floors) {
    let result = f.action;
    if (f.action === 'clone') {
      if (!clone) result = 'not cloned (--no-clone)';
      else {
        try {
          fs.mkdirSync(path.dirname(f.to), { recursive: true });
          runGit('git', ['clone', '-q', '--', f.remote, f.to], { stdio: 'ignore', timeout: 600000 });
          if (f.branch && f.branch !== 'HEAD') try { runGit('git', ['-C', f.to, 'checkout', '-q', f.branch], { stdio: 'ignore', timeout: 60000 }); } catch { warnings.push(`Floor ${f.id}: branch ${f.branch} not found on the remote; staying on the default branch`); }
          result = 'cloned';
        } catch (e) { result = 'clone failed'; warnings.push(`Floor ${f.id}: git clone ${f.remote} failed (${String(e.message).split('\n')[0]})`); }
      }
    }
    // the Floor's configuration from the backup when the repository has none (never committed)
    if (fs.existsSync(f.to) && !fs.existsSync(path.join(f.to, '.claude', 'aisquad', 'floor.json'))) {
      for (const [name, e] of entries) {
        if (!name.startsWith(`floors/${f.id}/`)) continue;
        const target = path.resolve(f.to, name.slice(`floors/${f.id}/`.length));
        if (target.startsWith(path.resolve(f.to) + path.sep)) writeText(target, e.data);
      }
      if (result === 'present' || result === 'cloned') result += ', configuration restored from the backup';
    }
    out.push({ id: f.id, to: f.to, result });
  }
  // Claude Code's auto memory under the Floor's new path (files already there win)
  let memory = 0;
  for (const [name, e] of entries) {
    const m = name.match(/^claude-memory\/([\w-]+)\/(.+)$/);
    if (!m) continue;
    const f = plan.floors.find((x) => x.id === m[1]);
    if (!f) continue;
    const target = path.resolve(memoryDir(f.to), m[2]);
    if (!target.startsWith(memoryDir(f.to) + path.sep) || fs.existsSync(target)) continue;
    writeText(target, e.data); memory++;
  }
  return { previous, written, floors: out, memory, warnings };
}

// ---------- scheduled backups (Building settings → Backups) ----------
export const DEFAULT_SETTINGS = { enabled: false, time: '02:30', dir: '', keep: 7, logs: true };
export function cleanSettings(s = {}) {
  const keep = parseInt(s.keep, 10);
  return { enabled: s.enabled === true, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time)) ? String(s.time) : DEFAULT_SETTINGS.time,
    dir: s.dir && path.isAbsolute(String(s.dir)) ? path.resolve(String(s.dir)) : '', keep: Number.isFinite(keep) ? Math.max(1, Math.min(90, keep)) : DEFAULT_SETTINGS.keep, logs: s.logs !== false };
}
const statusPath = () => path.join(config.home, 'backup-status.json');
export const readStatus = () => readJson(statusPath(), {}) || {};
const saveStatus = (s) => writeJson(statusPath(), s);
const dayOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
export function backupDue(settings, status, now = Date.now()) {
  if (!settings.enabled) return false;
  const [h, m] = settings.time.split(':').map(Number);
  const at = new Date(now); at.setHours(h, m, 0, 0);
  return now >= at.getTime() && dayOf(status.lastBackup?.at || 0) !== dayOf(now);
}
// backups made by The AI Squad in a folder, newest first
export function listBackups(dir = defaultDir()) {
  return safeReaddir(dir).filter((f) => /^aisquad-backup-.*\.tar\.gz(\.enc)?$/.test(f)).map((f) => { const st = fs.statSync(path.join(dir, f)); return { file: path.join(dir, f), name: f, size: st.size, mtime: st.mtimeMs, encrypted: f.endsWith('.enc') }; })
    .sort((a, b) => b.mtime - a.mtime);
}
export function prune(dir, keep) {
  const list = listBackups(dir).filter((b) => !/-pre-migrate-/.test(b.name));
  for (const b of list.slice(keep)) fs.rmSync(b.file, { force: true });
  return list.slice(keep).length;
}
const VERIFY_EVERY_MS = 30 * 864e5;
// the passphrase of unattended backups: AISQUAD_BACKUP_PASSPHRASE, else ~/.aisquad/backup-passphrase (mode 600,
// never itself backed up); none: unencrypted backups without secrets
export const passphraseFile = () => path.join(config.home, 'backup-passphrase');
export function storedPassphrase() {
  if (process.env.AISQUAD_BACKUP_PASSPHRASE) return process.env.AISQUAD_BACKUP_PASSPHRASE;
  try { return fs.readFileSync(passphraseFile(), 'utf8').trim(); } catch { return ''; }
}
export function setPassphrase(pass) {
  if (!pass) { fs.rmSync(passphraseFile(), { force: true }); return; }
  if (String(pass).length < 8) throw bad('The passphrase needs at least 8 characters');
  writeText(passphraseFile(), `${pass}\n`, 0o600);
}
// once a minute from the server: the nightly backup, pruning, and a monthly check that the newest backup opens
// (a backup that was never read back is not a backup)
export function backupTick(settings, { now = Date.now(), passphrase = storedPassphrase() } = {}) {
  const s = cleanSettings(settings), status = readStatus(), done = {};
  if (backupDue(s, status, now)) {
    try {
      const r = createBackup({ out: s.dir || defaultDir(), passphrase, logs: s.logs, now });
      status.lastBackup = { at: now, ok: true, file: r.file, size: r.size, encrypted: r.encrypted, warnings: r.warnings.slice(0, 10) };
      prune(s.dir || defaultDir(), s.keep);
    } catch (e) { status.lastBackup = { at: now, ok: false, error: e.message }; }
    done.backup = status.lastBackup;
    saveStatus(status);
  }
  if (s.enabled && (!status.lastVerify || now - status.lastVerify.at >= VERIFY_EVERY_MS)) {
    const newest = listBackups(s.dir || defaultDir())[0];
    if (newest) {
      const v = verifyBackup(newest.file, { passphrase });
      status.lastVerify = { at: now, ok: v.ok, file: newest.file, errors: v.errors.slice(0, 5) };
      done.verify = status.lastVerify;
      saveStatus(status);
    }
  }
  return done;
}
// for Attention: a failed or late nightly backup, or a backup that did not read back
export function backupAlerts(settings, status = readStatus(), now = Date.now()) {
  const s = cleanSettings(settings), out = [];
  if (!s.enabled) return out;
  if (status.lastBackup && !status.lastBackup.ok) out.push({ key: 'failed', text: `The nightly backup failed: ${status.lastBackup.error}` });
  else if (status.lastBackup && now - status.lastBackup.at > 2 * 864e5) out.push({ key: 'late', text: `No backup for ${Math.floor((now - status.lastBackup.at) / 864e5)} days` });
  if (status.lastVerify && !status.lastVerify.ok) out.push({ key: 'verify', text: `The newest backup does not read back: ${status.lastVerify.errors?.[0] || 'damaged'}` });
  return out;
}
