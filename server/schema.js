// SPDX-License-Identifier: Apache-2.0
// Versions of the machine-local data in ~/.aisquad. ~/.aisquad/schema.json says which version the files follow;
// the server runs the pending migrations at start, in order, and records each one. A home made before 0.10.0
// has no schema.json and counts as version 0. Later releases add migrations to MIGRATIONS (never edit old ones).
import fs from 'node:fs';
import path from 'node:path';
import { config, VERSION } from './config.js';
import { readJson, writeJson } from './util.js';

export const schemaPath = () => path.join(config.home, 'schema.json');

// { to, name, run({ home }) }: run() changes files in ~/.aisquad and must be safe to run twice
export const MIGRATIONS = [
  { to: 1, name: 'baseline: the 0.9 layout of ~/.aisquad, recorded in schema.json', run: () => {} },
];
export const SCHEMA_VERSION = MIGRATIONS.at(-1).to;

export function readSchema() {
  const s = readJson(schemaPath(), null);
  if (s && Number.isInteger(s.version)) return { version: s.version, history: Array.isArray(s.history) ? s.history : [] };
  return { version: 0, history: [] };
}

// true when ~/.aisquad holds data from before schema.json existed (or from an older schema)
export function isOutdated() { return readSchema().version < SCHEMA_VERSION; }

// runs every migration above the recorded version; before the first one on an existing home, before() is called
// (the server takes a safety backup there). -> [{ to, name }] applied
export function migrate({ before = null, log = () => {} } = {}) {
  const cur = readSchema();
  const pending = MIGRATIONS.filter((m) => m.to > cur.version);
  if (!pending.length) return [];
  const existing = fs.existsSync(path.join(config.home, 'building.json'));
  if (existing && cur.version > 0 && before) before(cur.version);
  const applied = [];
  for (const m of pending) {
    m.run({ home: config.home });
    cur.version = m.to;
    cur.history.push({ to: m.to, name: m.name, at: new Date().toISOString(), by: VERSION });
    writeJson(schemaPath(), { version: cur.version, history: cur.history.slice(-50) });
    applied.push({ to: m.to, name: m.name });
    log(`[schema] ~/.aisquad migrated to version ${m.to}: ${m.name}`);
  }
  return applied;
}
