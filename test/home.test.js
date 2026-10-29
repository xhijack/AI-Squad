// SPDX-License-Identifier: Apache-2.0
// 1.5.1: a relative AISQUAD_HOME (as scripts/dev.sh sets it) is resolved once, against the folder the server was
// started from. A job runs in its Space's folder; with the relative path its output went nowhere and every job
// ended "without a result". The settings are read when config.js loads, so this file sets them before importing it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-stream.cjs');
const start = fs.mkdtempSync(path.join(os.tmpdir(), 'aisquad-home-'));
const cwd0 = process.cwd();
process.chdir(start);
fs.mkdirSync('bin'); fs.copyFileSync(FAKE, 'bin/claude'); fs.chmodSync('bin/claude', 0o755);
Object.assign(process.env, { AISQUAD_HOME: 'pg/home', CLAUDE_HOME: 'pg/claude', AISQUAD_PROC: 'pg/proc', CLAUDE_BIN: 'bin/claude', FAKE_CLAUDE_LOG: path.join(start, 'fake.log') });
const { config, configure, claudeBin } = await import('../server/config.js');
const jobs = await import('../server/jobs.js');
configure({ useHooks: false });
after(() => { process.chdir(cwd0); fs.rmSync(start, { recursive: true, force: true }); });
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return fn(); };

test('paths from the environment are absolute, resolved against the folder the server started in', () => {
  assert.equal(config.home, path.join(start, 'pg/home'));
  assert.equal(config.claudeHome, path.join(start, 'pg/claude'));
  assert.equal(config.procDir, path.join(start, 'pg/proc'));
  assert.equal(claudeBin(), path.join(start, 'bin/claude'));
  configure({ home: 'other/home' });
  assert.equal(config.home, path.join(start, 'other/home'), 'an override too');
  configure({ home: path.join(start, 'pg/home') });
});

test('a job started in another folder per Space ends with its result under a relative home', async () => {
  const spaces = ['squads/a', 'squads/b'].map((d) => { fs.mkdirSync(d, { recursive: true }); return path.join(start, d); });
  const started = spaces.map((cwd, i) => jobs.startJob({ floorId: `f${i}`, agentId: 'a', prompt: `Report for Space ${i}`, cwd, args: jobs.buildArgs({ agentId: 'a' }) }));
  for (const [i, j] of started.entries()) {
    const done = await until(() => { const r = jobs.refreshJob(jobs.readJob(j.id)); return r.ended && r.job; });
    assert.equal(done.status, 'done', done.error);
    assert.match(done.result, new RegExp(`^Done: Report for Space ${i}`));
    assert.ok(fs.existsSync(path.join(start, 'pg/home/jobs', `${j.id}.jsonl`)), 'the output is in the home');
    assert.ok(!fs.existsSync(path.join(spaces[i], 'pg')), 'nothing lands in the Space folder');
  }
});

test('the deny rules guard the real home: the double slash Claude Code reads as an absolute path', async () => {
  const { identityDenyRules } = await import('../server/context.js');
  const rules = identityDenyRules();
  assert.ok(rules.includes(`Edit(/${path.join(start, 'pg/home')}/**)`));
  assert.ok(rules.includes(`Read(/${path.join(start, 'pg/home', 'secrets.json')})`));
  assert.ok(!rules.some((r) => r.includes('(/pg/')), 'never a path relative to the Space');
});
