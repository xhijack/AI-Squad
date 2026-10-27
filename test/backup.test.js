// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import { config, configure } from '../server/config.js';
import * as floors from '../server/floors.js';
import * as backup from '../server/backup.js';
import { encodeProjectPath } from '../server/transcripts.js';

const root = scratch();
const proj = path.join(root, 'projects', 'acme');
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
const home = config.home;

test('tar: files round-trip, long names through a pax header, modes kept', () => {
  const long = `deep/${'a'.repeat(60)}/${'b'.repeat(60)}/file.json`;
  const tar = backup.tarPack([{ name: 'a.txt', data: Buffer.from('hello'), mode: 0o600 }, { name: long, data: Buffer.from('{"x":1}') }, { name: 'empty', data: Buffer.alloc(0) }]);
  assert.equal(tar.length % 512, 0);
  const out = backup.tarUnpack(tar);
  assert.deepEqual(out.map((e) => e.name), ['a.txt', long, 'empty']);
  assert.equal(out[0].data.toString(), 'hello'); assert.equal(out[0].mode, 0o600);
  assert.equal(out[1].data.toString(), '{"x":1}');
  // the system tar reads it too
  const f = path.join(root, 't.tar'); fs.writeFileSync(f, tar);
  assert.match(execFileSync('tar', ['-tf', f], { encoding: 'utf8' }), /a\.txt[\s\S]*file\.json/);
});

test('encryption: AES-256-GCM round trip; a wrong passphrase or a flipped byte is refused', () => {
  const blob = backup.encrypt(Buffer.from('secret data'), 'correct horse');
  assert.ok(backup.isEncrypted(blob));
  assert.equal(backup.decrypt(blob, 'correct horse').toString(), 'secret data');
  assert.throws(() => backup.decrypt(blob, 'wrong'), /Wrong passphrase/);
  const bad = Buffer.from(blob); bad[bad.length - 20] ^= 1;
  assert.throws(() => backup.decrypt(bad, 'correct horse'), /damaged/);
  assert.throws(() => backup.decrypt(blob, ''), /encrypted/);
});

test('a backup holds ~/.aisquad without secrets or machine state, each Floor\'s configuration, memory and git origin', async () => {
  await floors.createFloor({ name: 'Acme', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Rina - Project Manager', template: 'project-manager', lead: true }] });
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  g(proj, 'remote', 'add', 'origin', remote); g(proj, 'push', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(home, 'secrets.json'), '{"elevenlabs":"sk-x"}');
  fs.writeFileSync(path.join(home, 'approvals.json'), '{}');
  fs.writeFileSync(path.join(home, 'runtime.json'), '{}');
  fs.mkdirSync(path.join(home, 'voice-cache'), { recursive: true }); fs.writeFileSync(path.join(home, 'voice-cache', 'x.mp3'), 'x');
  fs.mkdirSync(path.join(home, 'logs', 'acme'), { recursive: true }); fs.writeFileSync(path.join(home, 'logs', 'acme', '2026-10-26.jsonl'), '{"type":"x"}\n');
  const mem = path.join(config.claudeHome, 'projects', encodeProjectPath(proj), 'memory');
  fs.mkdirSync(mem, { recursive: true }); fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- uses pnpm\n');
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'not committed');

  const r = backup.createBackup({ out: path.join(root, 'out'), now: Date.parse('2026-10-26T23:00:00') });
  assert.match(path.basename(r.file), /^aisquad-backup-.*-20261026-230000\.tar\.gz$/);
  assert.equal(r.encrypted, false);
  assert.ok(r.warnings.some((w) => /uncommitted/.test(w)), 'uncommitted work is called out');
  const { manifest, entries, errors } = backup.readBackup(r.file);
  assert.deepEqual(errors, []);
  const names = [...entries.keys()];
  assert.ok(names.includes('home/building.json'));
  assert.ok(names.some((n) => n.startsWith('home/roles/')), 'the Role Template library');
  assert.ok(names.includes('home/logs/acme/2026-10-26.jsonl'));
  for (const n of ['home/secrets.json', 'home/pin', 'home/approvals.json', 'home/runtime.json', 'home/voice-cache/x.mp3']) assert.ok(!names.includes(n), `${n} stays out`);
  const id = manifest.floors[0].id;
  assert.ok(names.includes(`floors/${id}/.claude/aisquad/floor.json`));
  assert.ok(names.includes(`floors/${id}/AISQUAD.md`));
  assert.equal(entries.get(`claude-memory/${id}/MEMORY.md`).data.toString(), '- uses pnpm\n');
  assert.equal(manifest.floors[0].remote, remote);
  assert.equal(manifest.floors[0].branch, 'main');
  assert.equal(manifest.floors[0].dirty, 1);
  assert.equal(backup.createBackup({ out: path.join(root, 'out2'), logs: false }).files < r.files, true, '--no-logs leaves the Squad Log out');
  assert.throws(() => backup.createBackup({ secrets: true }), /encrypted/);
});

test('an encrypted backup carries the secrets; verify catches damage', () => {
  const r = backup.createBackup({ out: path.join(root, 'enc'), passphrase: 'pass-1234', secrets: true });
  assert.match(r.file, /\.tar\.gz\.enc$/);
  assert.equal(backup.verifyBackup(r.file).ok, false, 'no passphrase');
  const v = backup.verifyBackup(r.file, { passphrase: 'pass-1234' });
  assert.equal(v.ok, true); assert.equal(v.includes.secrets, true);
  assert.ok(backup.readBackup(r.file, { passphrase: 'pass-1234' }).entries.has('home/secrets.json'));
  // a backup whose content no longer matches its manifest
  const plain = backup.createBackup({ out: path.join(root, 'plain') });
  const tar = zlib.gunzipSync(fs.readFileSync(plain.file));
  const i = tar.indexOf(Buffer.from('home/building.json\0')) + 512 + 2;   // a byte of the file, after its tar header
  tar[i] = tar[i] === 0x66 ? 0x67 : 0x66;
  fs.writeFileSync(plain.file, zlib.gzipSync(tar));
  const bad = backup.verifyBackup(plain.file);
  assert.equal(bad.ok, false); assert.match(bad.errors[0], /checksum: home\/building\.json/);
});

test('restore plans where Floors go: relink, projects folder, clone or missing', () => {
  const r = backup.createBackup({ out: path.join(root, 'plan') });
  assert.equal(backup.mapPath('/a/b/c', { relink: { '/a/b': '/x' } }), '/x/c');
  assert.equal(backup.mapPath('/a/b/c', { projectsDir: '/srv/p' }), '/srv/p/c');
  assert.equal(backup.mapPath('/a/b/c'), '/a/b/c');
  const same = backup.planRestore(r.file);
  assert.equal(same.floors[0].action, 'present'); assert.equal(same.homeExists, true);
  const moved = backup.planRestore(r.file, { projectsDir: path.join(root, 'newbox') });
  assert.equal(moved.floors[0].action, 'clone'); assert.equal(moved.floors[0].to, path.join(root, 'newbox', 'acme'));
});

test('restore on a new machine: home written, Floors cloned and relinked, memory moved, the old home kept', () => {
  const r = backup.createBackup({ out: path.join(root, 'move') });
  const oldHome = config.home, oldClaude = config.claudeHome;
  configure({ home: path.join(root, 'home2'), claudeHome: path.join(root, 'claude2') });
  try {
    fs.mkdirSync(config.home, { recursive: true });
    const newbox = path.join(root, 'newbox');
    const out = backup.restore(r.file, { projectsDir: newbox });
    assert.equal(out.previous, null, 'an empty home is filled directly');
    assert.ok(out.written > 3);
    const b = JSON.parse(fs.readFileSync(path.join(config.home, 'building.json'), 'utf8'));
    assert.equal(b.floors[0].path, path.join(newbox, 'acme'), 'the registry points at the new folder');
    assert.match(out.floors[0].result, /cloned/);
    assert.ok(fs.existsSync(path.join(newbox, 'acme', '.claude', 'aisquad', 'floor.json')), 'the repository came back from its remote');
    assert.equal(fs.readFileSync(path.join(config.claudeHome, 'projects', encodeProjectPath(path.join(newbox, 'acme')), 'memory', 'MEMORY.md'), 'utf8'), '- uses pnpm\n');
    assert.ok(!fs.existsSync(path.join(config.home, 'approvals.json')), 'auto-merge is approved again on the new machine');
    // a second restore over a home in use needs --force and keeps the current one
    assert.throws(() => backup.restore(r.file, { projectsDir: newbox }), /not empty/);
    const again = backup.restore(r.file, { projectsDir: newbox, force: true, now: Date.parse('2026-10-27T01:02:03Z') });
    assert.match(again.previous, /home2\.before-restore-20261027-010203$/);
    assert.ok(fs.existsSync(path.join(again.previous, 'building.json')));
  } finally { configure({ home: oldHome, claudeHome: oldClaude }); }
});

test('a Floor whose configuration was never committed gets it back from the backup', () => {
  const r = backup.createBackup({ out: path.join(root, 'cfg') });
  const oldHome = config.home;
  configure({ home: path.join(root, 'home3') });
  try {
    const target = path.join(root, 'bare-copy', 'acme');
    fs.mkdirSync(path.join(target, '.git'), { recursive: true });       // a repository without .claude/aisquad
    const out = backup.restore(r.file, { relink: { [path.dirname(proj)]: path.dirname(target) } });
    assert.match(out.floors[0].result, /present, configuration restored/);
    assert.ok(fs.existsSync(path.join(target, '.claude', 'aisquad', 'team.json')));
  } finally { configure({ home: oldHome }); }
});

test('nightly backups: due once a day after the set time, pruned, checked monthly, alerts when they fail', () => {
  const s = backup.cleanSettings({ enabled: true, time: '02:30', keep: 2, dir: path.join(root, 'nightly') });
  assert.deepEqual(backup.cleanSettings({ time: '25:00', keep: 0, dir: 'relative' }), { enabled: false, time: '02:30', dir: '', keep: 1, logs: true });
  const day = (h, m, d = 26) => new Date(2026, 9, d, h, m).getTime();
  assert.equal(backup.backupDue(s, {}, day(2, 0)), false);
  assert.equal(backup.backupDue(s, {}, day(2, 31)), true);
  assert.equal(backup.backupDue(s, { lastBackup: { at: day(2, 31) } }, day(23, 0)), false);
  assert.equal(backup.backupDue(s, { lastBackup: { at: day(2, 31) } }, day(2, 31, 27)), true);
  for (const d of [24, 25, 26]) {
    const r = backup.backupTick(s, { now: day(3, 0, d), passphrase: '' });
    assert.equal(r.backup.ok, true);
  }
  assert.equal(backup.listBackups(s.dir).length, 2, 'only the newest two are kept');
  const st = backup.readStatus();
  assert.equal(st.lastVerify.ok, true, 'the newest backup was read back');
  assert.deepEqual(backup.backupAlerts(s, st, day(4, 0, 26)), []);
  assert.match(backup.backupAlerts(s, st, day(4, 0, 30))[0].text, /No backup for 4 days/);
  assert.match(backup.backupAlerts(s, { lastBackup: { at: 1, ok: false, error: 'disk full' } }, day(4, 0, 30))[0].text, /disk full/);
  assert.deepEqual(backup.backupAlerts({ enabled: false }, { lastBackup: { ok: false } }), []);
});

test('the stored passphrase is used for unattended backups and never backed up itself', () => {
  assert.throws(() => backup.setPassphrase('short'), /8 characters/);
  backup.setPassphrase('night-pass-99');
  assert.equal(backup.storedPassphrase(), 'night-pass-99');
  assert.equal(fs.statSync(backup.passphraseFile()).mode & 0o777, 0o600);
  const r = backup.createBackup({ out: path.join(root, 'pp'), passphrase: backup.storedPassphrase() });
  assert.ok(!backup.readBackup(r.file, { passphrase: 'night-pass-99' }).entries.has('home/backup-passphrase'));
  backup.setPassphrase('');
  assert.equal(backup.storedPassphrase(), '');
});
