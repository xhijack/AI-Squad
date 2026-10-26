import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wd from '../server/watchdog.js';

const GB = 2 ** 30;
const MIN = 60000;

test('resource warnings follow the spec thresholds', () => {
  const ok = { mem: { total: 16 * GB, available: 4 * GB }, swap: { total: 8 * GB, used: 1 * GB }, disk: { free: 20 * GB } };
  assert.deepEqual(wd.resourceWarnings(ok), []);
  const bad = { mem: { total: 16 * GB, available: 1 * GB }, swap: { total: 8 * GB, used: 7 * GB }, disk: { free: 4 * GB } };
  assert.deepEqual(wd.resourceWarnings(bad).map((w) => w.key), ['ram', 'swap', 'disk']);
  assert.ok(wd.readResources().mem.total > 0);
});

test('agent stall: assigned work, idle for 10 minutes', () => {
  const now = Date.now();
  const agents = [{ id: 'a', displayName: 'A', state: 'idle', lastTs: now - 11 * MIN }, { id: 'b', displayName: 'B', state: 'working', lastTs: now }];
  assert.deepEqual(wd.stallAlerts(agents, {}, now), []);
  const s = wd.stallAlerts(agents, { a: { assignedAt: now - 20 * MIN } }, now);
  assert.equal(s.length, 1); assert.equal(s[0].agent, 'a'); assert.equal(s[0].scope, 'agent');
  assert.deepEqual(wd.stallAlerts(agents, { a: { assignedAt: now - 5 * MIN } }, now), [], 'recently assigned');
  assert.deepEqual(wd.stallAlerts(agents, { a: { assignedAt: now - 20 * MIN, doneAt: now - 15 * MIN } }, now), [], 'finished work');
});

test('floor stall: pending work while the lead and everyone are idle', () => {
  const now = Date.now();
  const agents = [{ id: 'pm', displayName: 'PM', lead: true, state: 'idle', lastTs: now - 12 * MIN }, { id: 'dev', displayName: 'Dev', state: 'stopped', lastTs: now - 30 * MIN }];
  const s = wd.stallAlerts(agents, { pm: { assignedAt: now - 15 * MIN } }, now);
  assert.equal(s.length, 1); assert.equal(s[0].scope, 'floor');
  assert.match(s[0].text, /lead/);
  assert.deepEqual(wd.stallAlerts([{ ...agents[0], state: 'waiting' }, agents[1]], { pm: { assignedAt: now - 15 * MIN } }, now), [], 'waiting is Attention, not a stall');
});

test('budget levels at 80 % and 100 %', () => {
  assert.equal(wd.budgetStatus({ usd: 0, period: 'month' }, { today: 5, month: 50 }).level, 'none');
  assert.equal(wd.budgetStatus({ usd: 100, period: 'month' }, { today: 5, month: 50 }).level, 'ok');
  assert.equal(wd.budgetStatus({ usd: 100, period: 'month' }, { today: 5, month: 85 }).level, 'warn');
  assert.equal(wd.budgetStatus({ usd: 10, period: 'day' }, { today: 10, month: 85 }).level, 'over');
});

test('memory is read from the configured /proc (tests use a scratch one)', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { configure, config } = await import('../server/config.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisquad-proc-')), before = config.procDir;
  fs.writeFileSync(path.join(dir, 'meminfo'), 'MemTotal: 16000000 kB\nMemAvailable: 4000000 kB\nSwapTotal: 8000000 kB\nSwapFree: 800000 kB\n');
  configure({ procDir: dir });
  try {
    const r = wd.readResources();
    assert.equal(r.mem.available, 4000000 * 1024); assert.equal(r.swap.used, 7200000 * 1024);
  } finally { configure({ procDir: before }); fs.rmSync(dir, { recursive: true, force: true }); }
});
