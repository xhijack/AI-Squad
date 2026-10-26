// The Retro on a Floor: a sprint's audit saves it; "Send to lead" puts it in the repo and asks the lead for LEARNINGS.md entries.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import { configure, config } from '../server/config.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import * as log from '../server/log.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = scratch();
after(() => { try { execFileSync('tmux', ['-L', config.tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ } });
const proj = path.join(root, 'pos');
await floors.createFloor({ name: 'POS', directory: { mode: 'new', path: proj }, workflow: 'squad-sprint', team: [{ displayName: 'Rina - Lead', template: 'sprint-lead', lead: true }, { displayName: 'Budi - Dev', template: 'sprint-developer' }] });
const T0 = Date.now() - 3600e3;
let n = 0;
const put = (min, type, ev = {}) => log.append('pos', { type, ts: T0 + min * 60e3, sprint: 1, id: `r${++n}`, ...ev }, {}, T0 + min * 60e3);
put(1, 'sprint.planned', { data: { modules: 1, sp: 3, list: [{ module: 'M01', sp: 3, owner: 'budi-dev' }] } });
put(5, 'debug.attempt', { agent: 'budi-dev', data: { issue: 'login-500', attempt: 3 } });
put(9, 'qa.report', { module: 'M01', data: { module: 'M01', round: 1, status: 'PASS', failed: [] } });
put(10, 'sprint.closed', { data: {} });

test('every agent reads LEARNINGS.md; the lead adds entries after a Retro', () => {
  assert.match(fs.readFileSync(path.join(proj, '.claude/agents/budi-dev.md'), 'utf8'), /read `docs\/squad\/LEARNINGS\.md`/);
  assert.match(fs.readFileSync(path.join(proj, '.claude/agents/rina-lead.md'), 'utf8'), /## Learnings\n- After each Retro/);
  assert.doesNotMatch(fs.readFileSync(path.join(proj, '.claude/agents/budi-dev.md'), 'utf8'), /## Learnings/);
});

test('the audit of a sprint is also its Retro', async () => {
  configure({ claudeBin: path.join(dir, 'fixtures', 'fake-claude-print.cjs') });
  process.env.FAKE_CLAUDE_MODE = 'audit';
  const a = await squad.startAudit('pos', { sprint: 1 });
  delete process.env.FAKE_CLAUDE_MODE;
  assert.equal(a.retro.sprint, 1);
  assert.deepEqual(a.retro.changes.map((c) => c.finding), ['F1', 'F2', null], 'the high finding first');
  assert.ok(a.retro.wentBadly.includes('debug loops: login-500 (3 attempts)'));
  assert.deepEqual(squad.floorRetro('pos').retro, a.retro);
  assert.equal(squad.floorAudits('pos').audits[0].retro, true);
  assert.equal(log.read('pos', { type: 'retro.done' }).length, 1);
});

test('Send to lead: the Retro goes into the repo and the lead is asked for LEARNINGS.md entries', async () => {
  configure({ claudeBin: path.join(dir, 'fixtures', 'fake-claude.cjs'), useSystemd: false, useHooks: false });
  const r = await squad.sendRetroToLead('pos');
  assert.equal(r.lead, 'rina-lead'); assert.equal(r.file, 'docs/squad/retro/sprint-1.md');
  assert.match(fs.readFileSync(path.join(proj, r.file), 'utf8'), /^# Retro: POS, sprint 1/);
  assert.ok(fs.existsSync(path.join(proj, 'docs/squad/LEARNINGS.md')));
  assert.match(squad.deskDetail('pos', 'rina-lead').pending, /Retro for sprint 1 is ready \(docs\/squad\/retro\/sprint-1\.md\).*LEARNINGS\.md/);
  squad.stopAgent('pos', 'rina-lead');
});

test('a mid-sprint scope change waits for the owner; "back" sends the lead a task', async () => {
  const collect = await import('../server/collect.js');
  const S = collect.stateOf('pos');
  S.scope = { sprint: 2, mode: 'Expand', changed: { from: 'Hold', to: 'Expand', reason: 'more reports', ts: Date.now(), acked: false } };
  squad.invalidate();
  const item = squad.buildingSnapshot().attention.find((a) => a.kind === 'scope');
  assert.equal(item.autopilot.critical, true, 'it stops the Autopilot chain');
  assert.deepEqual(item.options.map((o) => o.label), ['Accept Expand', 'Back to Hold']);
  assert.equal(squad.buildingSnapshot().floors.find((f) => f.id === 'pos').autopilot.critical, 1);
  await squad.answerAttention(item.id, 2);
  assert.match(squad.deskDetail('pos', 'rina-lead').pending, /go back to scope mode Hold/);
  squad.invalidate();
  assert.equal(squad.buildingSnapshot().attention.some((a) => a.kind === 'scope'), false);
  squad.stopAgent('pos', 'rina-lead');
});
