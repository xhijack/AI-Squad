import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { scratch } from './helpers.js';
import * as log from '../server/log.js';

scratch({ seed: false });
const day = (s) => Date.parse(`${s}T12:00:00`);
const lines = (floor, d) => fs.readFileSync(path.join(log.logDir(floor), `${d}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('events get the common fields, a summary and land in the file of their day', () => {
  const e = log.append('shop', { type: 'message.sent', id: 'msg:1', ts: day('2026-10-26'), agent: 'rina-pm', role: 'project-manager', session: 's1', model: 'claude-haiku-5-5', sprint: 1, data: { to: 'budi-dev', text: 'Start M01 please' } });
  assert.deepEqual(Object.keys(e), ['v', 'id', 'ts', 'floor', 'sprint', 'module', 'agent', 'role', 'session', 'model', 'type', 'summary', 'data']);
  assert.equal(e.v, 1);
  assert.equal(e.summary, 'rina-pm -> budi-dev: Start M01 please');
  assert.equal(e.module, null);
  log.append('shop', { type: 'tool.call', ts: day('2026-10-27'), agent: 'budi-dev', data: { tool: 'Read', target: 'src/a.js', ms: 12, ok: true } });
  assert.equal(lines('shop', '2026-10-26').length, 1);
  assert.equal(lines('shop', '2026-10-27')[0].summary, 'budi-dev Read src/a.js (0 s)');
  assert.throws(() => log.append('shop', { type: 'nope' }), /Unknown log event type/);
});

test('the same id is logged once, also after a restart', () => {
  const now = day('2026-10-28');
  assert.ok(log.append('dedupe', { type: 'tool.call', id: 'tool:x', ts: now, data: { tool: 'Bash', target: 'ls', ok: true } }, {}, now));
  assert.equal(log.append('dedupe', { type: 'tool.call', id: 'tool:x', ts: now, data: { tool: 'Bash', target: 'ls', ok: true } }, {}, now), null);
  log.resetSeen();                                  // a new server process reads the ids of the last two days
  assert.equal(log.append('dedupe', { type: 'tool.call', id: 'tool:x', ts: now, data: {} }, {}, now), null);
  assert.equal(lines('dedupe', '2026-10-28').length, 1);
});

test('secrets are redacted; message text and personal data follow the Floor setting', () => {
  const e = log.append('priv', { type: 'message.sent', data: { to: 'qa', text: 'DB_PASSWORD=hunter2, mail budi@gmail.com' } });
  assert.equal(e.data.text, 'DB_PASSWORD=[secret], mail [email]');
  const raw = log.append('priv', { type: 'message.sent', data: { to: 'qa', text: 'mail budi@gmail.com TOKEN=abcd1234' } }, { pii: false });
  assert.equal(raw.data.text, 'mail budi@gmail.com TOKEN=[secret]');
  const meta = log.append('priv', { type: 'message.sent', agent: 'a', data: { to: 'qa', text: 'secret plan' } }, { messages: false });
  assert.equal(meta.data.text, undefined);
  assert.equal(meta.data.textChars, 11);
  assert.equal(meta.summary, 'a -> qa');
  assert.ok(!JSON.stringify(meta).includes('secret plan'));
});

test('read filters by time, type or category, agent and sprint', () => {
  const f = 'filters', t = day('2026-10-20');
  log.append(f, { type: 'usage.turn', ts: t, agent: 'a', sprint: 1, data: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.01 } });
  log.append(f, { type: 'message.sent', ts: t + 1000, agent: 'b', sprint: 1, data: { to: 'a', text: 'hi' } });
  log.append(f, { type: 'question.asked', ts: t + 2000, agent: 'a', sprint: 2, data: { text: 'which db?' } });
  log.append(f, { type: 'tool.call', ts: day('2026-10-22'), agent: 'a', sprint: 2, data: { tool: 'Read', ok: true } });
  assert.equal(log.read(f).length, 4);
  assert.deepEqual(log.read(f, { type: 'communication' }).map((e) => e.type), ['message.sent', 'question.asked']);
  assert.deepEqual(log.read(f, { type: 'usage,tool.call' }).map((e) => e.type), ['usage.turn', 'tool.call']);
  assert.deepEqual(log.read(f, { type: 'question' }).map((e) => e.type), ['question.asked']);
  assert.equal(log.read(f, { agent: 'a' }).length, 3);
  assert.equal(log.read(f, { sprint: 2 }).length, 2);
  assert.equal(log.read(f, { from: new Date(t + 500).toISOString(), to: String(t + 2500) }).length, 2);
  assert.equal(log.read(f, { limit: 1 })[0].type, 'tool.call', 'the newest events are kept');
});

test('rotation: gzip after 7 days, delete after the retention, gzipped days stay readable', () => {
  const f = 'rot', now = day('2026-10-26');
  for (const d of ['2026-10-25', '2026-10-18', '2026-07-01']) log.append(f, { type: 'commit', ts: day(d), data: { sha: d, subject: 'x' } }, {}, day(d));
  const r = log.maintain({ retentionDays: 90, now });
  assert.deepEqual(r, { gzipped: 1, deleted: 1 });
  assert.deepEqual(fs.readdirSync(log.logDir(f)).sort(), ['2026-10-18.jsonl.gz', '2026-10-25.jsonl']);
  // a late event for a gzipped day is merged into its archive on the next run
  log.append(f, { type: 'commit', ts: day('2026-10-18') + 1, data: { sha: 'late', subject: 'y' } }, {}, now);
  log.maintain({ now });
  const archived = zlib.gunzipSync(fs.readFileSync(path.join(log.logDir(f), '2026-10-18.jsonl.gz'))).toString().trim().split('\n');
  assert.equal(archived.length, 2);
  assert.deepEqual(log.read(f).map((e) => e.data.sha), ['2026-10-18', 'late', '2026-10-25']);
  log.maintain({ retentionDays: 3, now });
  assert.deepEqual(fs.readdirSync(log.logDir(f)), ['2026-10-25.jsonl']);
});
