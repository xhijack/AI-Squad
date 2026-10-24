// Extra Role Template libraries (read-only), listed in ~/.aisquad/libraries.json:
//   { "libraries": [ { "name": "team", "url": "git@github.com:org/roles.git", "ref": "main", "subdir": "roles" },
//                    { "name": "local-copy", "path": "/abs/dir" } ] }
// Git libraries are cloned into ~/.aisquad/libraries/<name> and pulled on demand.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config, paths } from './config.js';
import { readJson, writeJson, kebab, bad, notFound } from './util.js';

export const cacheDir = (name) => path.join(config.home, 'libraries', name);
const gitUrlOk = (u) => /^(https?:\/\/|ssh:\/\/|git@|file:\/\/|\/)/.test(u) && !u.startsWith('-') && !/\s/.test(u);

function git(cwd, args, timeout = 120000) {
  return new Promise((resolve) => execFile('git', cwd ? ['-C', cwd, ...args] : args, { timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout).trim(), err: String(stderr).trim() })));
}

export function loadEntries() {
  const libs = readJson(paths.libraries(), { libraries: [] }) || {};
  return (Array.isArray(libs.libraries) ? libs.libraries : []).filter((l) => l && (l.path || l.url)).map((l) => ({
    name: kebab(l.name || (l.path ? path.basename(l.path) : path.basename(String(l.url), '.git'))) || 'library',
    ...(l.url ? { url: String(l.url), ref: l.ref ? String(l.ref) : '', subdir: l.subdir ? String(l.subdir) : '' } : { path: path.resolve(String(l.path)) }),
  }));
}
const saveEntries = (list) => writeJson(paths.libraries(), { libraries: list });

// directory that holds the .md templates of a library entry
export function templateDir(e) {
  if (e.path) return e.path;
  const base = cacheDir(e.name);
  if (e.subdir) return path.join(base, e.subdir);
  return fs.existsSync(path.join(base, 'roles')) ? path.join(base, 'roles') : base;
}

// clone (first time) or fetch + reset (later) a git library; read-only cache, local edits are discarded
export async function pull(name) {
  const e = loadEntries().find((x) => x.name === name);
  if (!e) throw notFound(`Library not found: ${name}`);
  if (!e.url) return status(e);
  const dir = cacheDir(e.name);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const r = await git(null, ['clone', '-q', '--depth', '1', ...(e.ref ? ['--branch', e.ref] : []), '--', e.url, dir]);
    if (!r.ok) { fs.rmSync(dir, { recursive: true, force: true }); throw bad(`git clone failed: ${r.err.split('\n').slice(-3).join(' ')}`); }
  } else {
    const f = await git(dir, ['fetch', '-q', '--depth', '1', 'origin', e.ref || 'HEAD']);
    if (!f.ok) throw bad(`git fetch failed: ${f.err.split('\n').slice(-3).join(' ')}`);
    const r = await git(dir, ['reset', '-q', '--hard', 'FETCH_HEAD']);
    if (!r.ok) throw bad(`git reset failed: ${r.err}`);
  }
  fs.writeFileSync(path.join(dir, '.git', 'aisquad-pulled-at'), new Date().toISOString());
  return status(e);
}

export async function status(e) {
  const dir = templateDir(e);
  const out = { name: e.name, kind: e.url ? 'git' : 'path', url: e.url || null, path: e.path || null, ref: e.ref || null, ready: fs.existsSync(dir),
    templates: (() => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !/^readme\.md$/i.test(f)).length; } catch { return 0; } })() };
  if (e.url && fs.existsSync(path.join(cacheDir(e.name), '.git'))) {
    const log = await git(cacheDir(e.name), ['log', '-1', '--format=%h%x09%cI%x09%s']);
    const [commit, date, subject] = log.out.split('\t');
    out.version = { commit, date, subject };
    try { out.pulledAt = fs.readFileSync(path.join(cacheDir(e.name), '.git', 'aisquad-pulled-at'), 'utf8'); } catch { /* never pulled by us */ }
  }
  return out;
}
export const listStatus = () => Promise.all(loadEntries().map(status));

export function addLibrary({ name, url, path: p, ref, subdir }) {
  const n = kebab(name);
  if (!n || n === 'local') throw bad('Pick a library name (not "local")');
  const list = loadEntries();
  if (list.some((x) => x.name === n)) throw bad(`Library "${n}" already exists`);
  if (url) { if (!gitUrlOk(String(url))) throw bad('Library URL must be https://, ssh://, git@, file:// or an absolute path'); }
  else if (!p || !path.isAbsolute(String(p))) throw bad('Give a git URL or an absolute directory');
  if (subdir && (path.isAbsolute(subdir) || String(subdir).split(/[\\/]/).includes('..'))) throw bad('subdir must stay inside the repository');
  const entry = url ? { name: n, url: String(url), ...(ref ? { ref: String(ref) } : {}), ...(subdir ? { subdir: String(subdir) } : {}) } : { name: n, path: path.resolve(String(p)) };
  saveEntries([...list, entry]);
  return entry;
}

export function removeLibrary(name) {
  const list = loadEntries();
  if (!list.some((x) => x.name === name)) throw notFound(`Library not found: ${name}`);
  saveEntries(list.filter((x) => x.name !== name));
  fs.rmSync(cacheDir(name), { recursive: true, force: true });
}

// clone git libraries that are listed but not cloned yet (server start); errors are logged, not thrown
export async function ensureCloned(log = console.log) {
  for (const e of loadEntries()) if (e.url && !fs.existsSync(path.join(cacheDir(e.name), '.git'))) {
    try { await pull(e.name); log(`[libraries] cloned ${e.name}`); } catch (err) { log(`[libraries] ${e.name}: ${err.message}`); }
  }
}
