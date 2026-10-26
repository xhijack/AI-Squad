import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rc from '../server/recovery.js';

const GB = 2 ** 30;
const MIN = 60000;
const JOURNAL = `1792990188.934938 sopwerp systemd[1061]: aisquad-builder-1792929853.scope: systemd-oomd killed 354 process(es) in this unit.
1792990195.100000 sopwerp systemd[1061]: aisquad-builder-1792929853.scope: Consumed 3h 7min 17.184s CPU time.
1792990200.000000 sopwerp systemd[1061]: aisquad-f-pm-1792990100000.scope: systemd-oomd killed 12 process(es) in this unit.`;

test('out of memory kills are read from journal lines', () => {
  const k = rc.parseOomKills(JOURNAL);
  assert.deepEqual(k.map((x) => x.unit), ['aisquad-builder-1792929853', 'aisquad-f-pm-1792990100000']);
  assert.equal(k[0].ts, 1792990188935); assert.equal(k[0].processes, 354);
  assert.deepEqual(rc.parseOomKills(''), []);
});

test('oomKills asks the user journal for the window and survives a missing journalctl', () => {
  let seen;
  const k = rc.oomKills(1792990000000, 1792990300000, { run: (cmd, args) => { seen = [cmd, ...args]; return JOURNAL; } });
  assert.equal(k.length, 2);
  assert.equal(seen[0], 'journalctl'); assert.ok(seen.includes('--user')); assert.ok(seen.includes('@1792990000'));
  assert.deepEqual(rc.oomKills(0, 1, { run: () => { throw new Error('ENOENT'); } }), []);
});

test('an agent killed by systemd-oomd in its own scope crashed out of memory', () => {
  const kills = rc.parseOomKills(JOURNAL);
  const info = { unit: 'aisquad-f-pm-1792990100000', startedAt: 1792990100000 };
  const end = rc.classifyEnd({ info, status: { lastTs: 1792990190000, turnOpen: true }, name: 'aisquad-f-pm', detectedAt: 1792990230000, kills });
  assert.deepEqual(end, { kind: 'crashed', cause: 'oom', at: 1792990200000 });
  // another scope's kill does not count for an agent with its own scope; the open turn still says crashed
  const other = rc.classifyEnd({ info: { unit: 'aisquad-f-dev-1', startedAt: 1792990100000 }, status: { lastTs: 1792990190000, turnOpen: true }, name: 'aisquad-f-dev', detectedAt: 1792990230000, kills });
  assert.equal(other.cause, 'killed');
});

test('sessions from before per-agent scopes match any AI Squad scope killed in the window', () => {
  const kills = rc.parseOomKills(JOURNAL);
  const end = rc.classifyEnd({ info: { startedAt: 1792980000000 }, status: { lastTs: 1792990180000, turnOpen: true }, name: 'aisquad-dtamu-app-squad-project-manager', detectedAt: 1792990260000, kills });
  assert.equal(end.cause, 'oom'); assert.equal(end.at, 1792990200000);
  const old = rc.classifyEnd({ info: { startedAt: 1792980000000 }, status: { lastTs: 1792995000000, turnOpen: false }, name: 'x', detectedAt: 1792995100000, kills });
  assert.equal(old.kind, 'exited', 'a kill long before the last activity is not this session');
});

test('a clean exit at the end of a turn is not a crash; mid-turn without a kill is', () => {
  assert.deepEqual(rc.classifyEnd({ status: { lastTs: 5, turnOpen: false }, detectedAt: 10 }), { kind: 'exited', cause: 'exit', at: 5 });
  assert.deepEqual(rc.classifyEnd({ status: { lastTs: 5, turnOpen: true }, detectedAt: 10 }), { kind: 'crashed', cause: 'killed', at: 5 });
});

test('crash texts name the cause and the local time', () => {
  const at = new Date(2026, 9, 26, 11, 49).getTime();
  assert.equal(rc.crashText({ kind: 'crashed', cause: 'oom', at }), 'Stopped unexpectedly (out of memory at 11:49)');
  assert.equal(rc.crashText({ kind: 'crashed', cause: 'killed', at }), 'Stopped unexpectedly (ended mid-turn, last activity at 11:49)');
});

test('auto-resume: at most two per hour and not under memory pressure', () => {
  const now = Date.now();
  const calm = { mem: { available: 6 * GB }, swap: { total: 8 * GB, used: 2 * GB } };
  assert.equal(rc.autoResumeAllowed([], calm, now).ok, true);
  assert.equal(rc.autoResumeAllowed([now - 10 * MIN], calm, now).ok, true);
  assert.equal(rc.autoResumeAllowed([now - 10 * MIN, now - 5 * MIN], calm, now).ok, false);
  assert.equal(rc.autoResumeAllowed([now - 90 * MIN, now - 70 * MIN], calm, now).ok, true, 'older than an hour');
  assert.match(rc.autoResumeAllowed([], { mem: { available: 6 * GB }, swap: { total: 8 * GB, used: 7 * GB } }, now).reason, /swap is 88 %/);
  assert.match(rc.autoResumeAllowed([], { mem: { available: 1 * GB }, swap: { total: 0, used: 0 } }, now).reason, /RAM/);
});

test('start warnings: swap above 80 % or the Floor at its maximum', () => {
  const calm = { mem: { available: 6 * GB }, swap: { total: 8 * GB, used: 2 * GB } };
  assert.deepEqual(rc.startWarnings({ res: calm, running: 1, maxAgents: 4 }), []);
  const full = rc.startWarnings({ res: { swap: { total: 8 * GB, used: 6.8 * GB } }, running: 4, maxAgents: 4 });
  assert.equal(full.length, 2); assert.match(full[0], /Swap is 85 %/); assert.match(full[1], /4 agents already run.*maximum 4/);
});

test('recovery settings, memory rules and the recovery message', () => {
  assert.deepEqual(rc.cleanRecovery(), { autoResume: false, maxAgents: 4 });
  assert.deepEqual(rc.cleanRecovery({ autoResume: true, maxAgents: '99' }), { autoResume: true, maxAgents: 20 });
  assert.deepEqual(rc.cleanRecovery({ autoResume: 'yes', maxAgents: 0 }), { autoResume: false, maxAgents: 1 });
  assert.match(rc.memoryRules(4)[0], /At most 4 agents.*more than 3 teammates/);
  const msg = rc.recoveryMessage({ end: { kind: 'crashed', cause: 'oom', at: new Date(2026, 9, 26, 11, 49).getTime() }, maxAgents: 3 });
  assert.match(msg, /out of memory at 11:49/); assert.match(msg, /teammates died/); assert.match(msg, /re-spawn only/); assert.match(msg, /at most 3 agents/);
  assert.doesNotMatch(msg, /\n/, 'typed as one line');
});
