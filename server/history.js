// SPDX-License-Identifier: Apache-2.0
// Configuration is code (0.12): every change made through The AI Squad to the Building or a Space's configuration
// is recorded with who made it, when, and the files before and after, in ~/.aisquad/history/<id>.json. The Admin
// shows the diff; Rollback writes the "before" back (refusing when the file changed since, unless forced) and is
// itself recorded. Files covered: building.json, and a Space's floor.json, team.json, git.json and repos.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readText, readJson, writeJson, writeText, safeReaddir, lineDiff, notFound, HttpError } from './util.js';

export const SPACE_FILES = ['floor.json', 'team.json', 'git.json', 'repos.json'];
const dir = () => path.join(config.home, 'history');
const validId = (id) => /^h-[\w-]{8,60}$/.test(String(id));

// the files a change may touch: key (shown to people) -> absolute path
export function filesOf({ root = '', floorId = '' } = {}) {
  const out = { 'building.json': path.join(config.home, 'building.json') };
  if (root) for (const f of SPACE_FILES) out[`${floorId || path.basename(root)}/${f}`] = path.join(root, '.claude', 'aisquad', f);
  return out;
}
const snapshot = (files) => Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readText(p)]));

// runs fn and records what it changed; nothing is recorded when nothing changed. scope: { root, floorId }
// onRecord(id): the id of the record, for a caller that may roll it back later (0.21: canaries)
export async function track(label, { root = '', floorId = '', actor = 'owner', now = Date.now, onRecord = null } = {}, fn) {
  const files = filesOf({ root, floorId });
  const before = snapshot(files);
  const result = await fn();
  const after = snapshot(files);
  const changed = Object.keys(files).filter((k) => before[k] !== after[k]);
  if (changed.length) { const id = record({ label, floorId, actor, ts: now(), files: changed.map((k) => ({ key: k, path: files[k], before: before[k], after: after[k] })) }); onRecord?.(id); }
  return result;
}
let seq = 0;
export function record(entry) {
  const id = `h-${new Date(entry.ts).toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
  writeJson(path.join(dir(), `${id}.json`), { id, seq: ++seq, ...entry });
  return id;
}
export function list({ floorId = '', limit = 50 } = {}) {
  return safeReaddir(dir()).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir(), f), null)).filter(Boolean)
    .sort((a, b) => b.ts - a.ts || (b.seq || 0) - (a.seq || 0))
    .filter((e) => !floorId || e.floorId === floorId).slice(0, limit)
    .map(({ files, ...e }) => ({ ...e, files: files.map((x) => x.key) }));
}
export function get(id) {
  const e = validId(id) ? readJson(path.join(dir(), `${id}.json`), null) : null;
  if (!e) throw notFound('Change not found');
  return { ...e, files: e.files.map((f) => ({ key: f.key, created: f.before === null, removed: f.after === null, diff: lineDiff(f.before ?? '', f.after ?? '').filter((l, i, a) => l.op !== ' ' || a[i - 1]?.op !== ' ' || a[i + 1]?.op !== ' ') })) };
}
// writes every file of the change back to how it was before. A file changed since the change (not equal to its
// "after") is a conflict: 409 with the files, unless force. -> { ok, id (the rollback's own record), files }
export function rollback(id, { force = false, actor = 'owner', now = Date.now() } = {}) {
  const e = validId(id) ? readJson(path.join(dir(), `${id}.json`), null) : null;
  if (!e) throw notFound('Change not found');
  const conflicts = e.files.filter((f) => readText(f.path) !== f.after).map((f) => f.key);
  if (conflicts.length && !force) throw Object.assign(new HttpError(409, `Changed again since: ${conflicts.join(', ')}. Roll back anyway?`), { data: { conflicts } });
  const done = [];
  for (const f of e.files) {
    const cur = readText(f.path);
    if (f.before === null) fs.rmSync(f.path, { force: true }); else writeText(f.path, f.before);
    done.push({ key: f.key, path: f.path, before: cur, after: f.before });
  }
  const rid = record({ label: `Rollback of: ${e.label}`, floorId: e.floorId, actor, ts: now, rollbackOf: id, files: done });
  return { ok: true, id: rid, files: done.map((f) => f.key), conflicts };
}
