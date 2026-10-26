// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import * as schema from '../server/schema.js';
import { runDoctor, doctorText } from '../server/doctor.js';

scratch();

test('a home without schema.json is version 0; migrate records every step once', () => {
  assert.equal(schema.readSchema().version, 0);
  assert.ok(schema.isOutdated());
  let before = null;
  const applied = schema.migrate({ before: (v) => { before = v; } });
  assert.deepEqual(applied.map((m) => m.to), schema.MIGRATIONS.map((m) => m.to));
  assert.equal(before, null, 'no safety backup for a home that never had a schema (nothing to protect yet)');
  const s = schema.readSchema();
  assert.equal(s.version, schema.SCHEMA_VERSION);
  assert.equal(s.history.length, schema.MIGRATIONS.length);
  assert.deepEqual(schema.migrate(), [], 'nothing left to do');
  assert.equal(schema.isOutdated(), false);
});

test('an older recorded version gets the safety backup hook before migrating', () => {
  fs.writeFileSync(path.join(config.home, 'building.json'), '{"floors":[]}');
  fs.writeFileSync(schema.schemaPath(), JSON.stringify({ version: 1, history: [] }));
  schema.MIGRATIONS.push({ to: 2, name: 'test step', run: ({ home }) => fs.writeFileSync(path.join(home, 'migrated.txt'), 'yes') });
  try {
    let before = null;
    const applied = schema.migrate({ before: (v) => { before = v; } });
    assert.equal(before, 1);
    assert.deepEqual(applied, [{ to: 2, name: 'test step' }]);
    assert.equal(fs.readFileSync(path.join(config.home, 'migrated.txt'), 'utf8'), 'yes');
  } finally { schema.MIGRATIONS.pop(); fs.writeFileSync(schema.schemaPath(), JSON.stringify({ version: schema.SCHEMA_VERSION, history: [] })); }
});

test('doctor reports each check with a fix, and a missing Floor folder fails', () => {
  fs.writeFileSync(path.join(config.home, 'building.json'), JSON.stringify({ floors: [{ id: 'gone', number: 2, path: path.join(config.home, 'nowhere') }] }));
  const r = runDoctor({ service: { mode: 'systemd', installed: false } });
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(by.node.status, 'ok');
  assert.equal(by['floor:gone'].status, 'fail');
  assert.match(by['floor:gone'].fix, /relink/);
  assert.equal(by.service.status, 'warn');
  assert.equal(by.backup.status, 'warn', 'nightly backups are off');
  assert.equal(r.ok, false);
  assert.match(doctorText(r), /\[FAIL\] Floor 2 · gone/);
});
