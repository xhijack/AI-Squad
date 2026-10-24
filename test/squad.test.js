// Watchdog alerts as they reach the Building snapshot: stall, budget, first-seen times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, jsonl } from './helpers.js';
import { paths } from '../server/config.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import { projectDir } from '../server/transcripts.js';

const root = scratch();
const proj = path.join(root, 'acme');
await floors.createFloor({ name: 'Acme', directory: { mode: 'new', path: proj }, budget: { usd: 1, period: 'day' },
  team: [{ displayName: 'Rina - PM', template: 'project-manager', lead: true }, { displayName: 'Budi - Dev', template: 'fullstack-developer' }] });
const writeWork = (work) => fs.writeFileSync(paths.runtime(), JSON.stringify({ work }));
const fresh = () => { squad.invalidate(); return squad.buildingSnapshot(); };

test('no alerts for a quiet Floor without work', () => {
  writeWork({});
  const s = fresh();
  assert.deepEqual(s.attention.filter((a) => a.kind !== 'resource'), []);
  assert.equal(s.floors[0].lamp, 'stopped');
});

test('pending work with everyone idle for 10 minutes is a Floor stall', () => {
  writeWork({ 'acme/budi-dev': { text: 'Build the catalogue', assignedAt: Date.now() - 11 * 60e3, doneAt: null } });
  const s = fresh();
  const stall = s.attention.find((a) => a.kind === 'stall');
  assert.ok(stall, 'stall alert');
  assert.match(stall.text, /lead and all agents idle for 11 min/);
  assert.equal(s.floors[0].lamp, 'attention');
  const t1 = stall.ts;
  const again = fresh().attention.find((a) => a.kind === 'stall');
  assert.equal(again.ts, t1, 'first-seen time is stable');
  assert.equal(squad.watchdogStatus().alerts.filter((a) => a.kind === 'stall').length, 1);
});

test('dismissing a stall clears the work', () => {
  const id = fresh().attention.find((a) => a.kind === 'stall').id;
  squad.answerAttention(id, 0);
  assert.equal(fresh().attention.find((a) => a.kind === 'stall'), undefined);
  assert.deepEqual(squad.workOf('acme'), {});
});

test('budget: warning at 80 %, Attention at 100 %', () => {
  const dir = projectDir(proj);
  fs.mkdirSync(dir, { recursive: true });
  const rec = (id, out) => ({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, model: 'claude-sonnet-5-5', usage: { output_tokens: out } } });
  // sonnet output: $10 per million tokens -> 85 000 tokens = $0.85 of a $1 daily budget
  fs.writeFileSync(path.join(dir, 's1.jsonl'), jsonl([{ type: 'agent-setting', agentSetting: 'budi-dev' }, rec('a', 85000)]));
  const warn = fresh().attention.find((a) => a.kind === 'budget');
  assert.equal(warn.level, 'warn');
  assert.match(warn.text, /85 %/);
  fs.writeFileSync(path.join(dir, 's2.jsonl'), jsonl([{ type: 'agent-setting', agentSetting: 'rina-pm' }, rec('b', 30000)]));
  const over = fresh().attention.filter((a) => a.kind === 'budget');
  assert.equal(over.length, 1);
  assert.match(over[0].text, /Budget reached: \$1\.15 of \$1 this day/);
  assert.equal(fresh().floors[0].budget.level, 'over');
});

test('the watchdog tick logs each new alert once', async () => {
  const lines = [];
  squad.watchdogTick((l) => lines.push(l));
  squad.watchdogTick((l) => lines.push(l));
  assert.equal(lines.filter((l) => l.includes('budget')).length, 1);
});

test('configured and observed models are reported separately; a mismatch is flagged', async () => {
  const { modelReport } = squad;
  const eff = { model: 'opus', effort: 'high' };
  assert.deepEqual(modelReport(eff, false, null, { model: 'claude-opus-5-5', modelTs: 5 }), { configured: 'opus', observed: 'claude-opus-5-5', observedAt: 5, startedWith: null, mismatch: false, restartNeeded: false });
  assert.equal(modelReport(eff, false, null, { model: 'claude-sonnet-5-5' }).mismatch, true);
  assert.equal(modelReport({ model: 'inherit', effort: 'low' }, false, null, { model: 'claude-sonnet-5-5' }).mismatch, false, 'inherit cannot differ');
  assert.equal(modelReport(eff, true, { model: 'sonnet', effort: 'high' }, null).restartNeeded, true);
  assert.equal(modelReport(eff, true, { model: 'opus', effort: 'medium' }, null).restartNeeded, true, 'effort changed too');
  assert.equal(modelReport(eff, false, { model: 'sonnet' }, null).restartNeeded, false, 'stopped agents start fresh anyway');

  // Budi's transcript (from the budget test) replies with sonnet; an opus override makes it differ
  const budi = () => fresh().floors[0].agents.find((a) => a.id === 'budi-dev').models;
  assert.deepEqual([budi().configured, budi().observed, budi().mismatch], ['sonnet', 'claude-sonnet-5-5', false]);
  floors.updateAgent(proj, 'budi-dev', { overrides: { model: 'opus' } });
  assert.deepEqual([budi().configured, budi().mismatch], ['opus', true]);
});
