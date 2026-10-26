// "Finished": an agent the owner talks to directly ended its turn with a report; one calm card, Reply / OK / Open desk.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scratch, jsonl } from './helpers.js';
import { configure, config } from '../server/config.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';
import * as tm from '../server/tmux.js';
import { projectDir } from '../server/transcripts.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.cjs');
const root = scratch();
const LOG = path.join(root, 'fake.log');
process.env.FAKE_CLAUDE_LOG = LOG;
configure({ claudeBin: FAKE, useSystemd: false, useHooks: false });
after(() => { try { execFileSync('tmux', ['-L', config.tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ } });
const proj = path.join(root, 'shop');
await floors.createFloor({ name: 'Shop', directory: { mode: 'new', path: proj }, workflow: 'squad-sprint', team: [
  { displayName: 'Rina - PM', template: 'sprint-lead', lead: true }, { displayName: 'Dewi - DevOps', template: 'devops-engineer' }, { displayName: 'Budi - Dev', template: 'sprint-developer' }] });
const FLOOR = 'shop';
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const wait = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; };
const items = () => { squad.invalidate(); return squad.buildingSnapshot().attention.filter((a) => a.floorId === FLOOR); };
const iso = (ms) => new Date(Date.now() - ms).toISOString();
const REPORT = '## Server inventory done\n\n| Item | Value |\n|---|---|\n| Free ports | 8300-8399 |\n\n- Written to `docs/ops/SERVER-box.md`.\n- Next: the lead plans the install.';
function session(agent, id, text, { lead = null } = {}) {
  const dir = lead ? path.join(projectDir(proj), lead, 'subagents') : projectDir(proj);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, lead ? `agent-a${agent}.jsonl` : `${id}.jsonl`);
  fs.writeFileSync(file, jsonl([...(lead ? [] : [{ type: 'agent-setting', agentSetting: agent, sessionId: id }]),
    { type: 'user', timestamp: iso(90e3), message: { role: 'user', content: 'Inventory the staging server' } },
    { type: 'assistant', timestamp: iso(60e3), message: { id: `m-${agent}`, stop_reason: 'end_turn', content: [{ type: 'text', text }] } }]));
  if (lead) fs.writeFileSync(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ agentType: agent, taskKind: 'in_process_teammate' }));
}

test('an agent started from its Desk that ends its turn with a report raises one calm "Finished" card', async () => {
  await squad.startAgent(FLOOR, 'dewi-devops');
  assert.ok(await wait(() => items().some((a) => a.kind === 'permission')));
  await squad.answerAttention(items().find((a) => a.kind === 'permission').id, 1);
  session('dewi-devops', 'sess-dewi', REPORT);
  assert.ok(await wait(() => items().some((a) => a.kind === 'finished')));
  const list = items().filter((a) => a.agentId === 'dewi-devops');
  assert.deepEqual(list.map((a) => a.kind), ['finished'], 'one card');
  assert.equal(list[0].text, REPORT); assert.equal(list[0].calm, true);
  const f = squad.buildingSnapshot().floors.find((x) => x.id === FLOOR);
  const dewi = f.agents.find((a) => a.id === 'dewi-devops');
  assert.equal(dewi.state, 'idle', 'a report does not make the agent wait');
  assert.equal(f.waitingFor, null, 'nothing blocks');
  assert.equal(f.autopilot.critical, 0, 'and Autopilot keeps going');
});

test('a report that asks the owner is "Waiting for your reply" instead (the DevOps case)', async () => {
  session('dewi-devops', 'sess-dewi', `${REPORT}\n3. PO memberi tahu: bolehkah saya mulai dengan sisi server saja?`);
  assert.ok(await wait(() => items().some((a) => a.kind === 'reply' && a.agentId === 'dewi-devops')));
  assert.deepEqual(items().filter((a) => a.agentId === 'dewi-devops').map((a) => a.kind), ['reply']);
  session('dewi-devops', 'sess-dewi', REPORT);
});

test('report.delivered is logged once per report', async () => {
  assert.ok(await wait(() => items().some((a) => a.kind === 'finished')));
  await squad.logTick(); await squad.logTick();
  const ev = squadLog.read(FLOOR, { type: 'report.delivered' }).filter((e) => e.agent === 'dewi-devops');
  assert.deepEqual(ev.map((e) => e.data.card), ['finished']);
});

test('Reply sends a follow-up task and clears the card; OK dismisses it', async () => {
  const card = items().find((a) => a.kind === 'finished');
  await squad.answerAttention(card.id, 1, 'Good. Now plan the staging install.');
  assert.ok(await wait(() => fs.readFileSync(LOG, 'utf8').includes('TASK Good. Now plan the staging install.')));
  assert.equal(items().some((a) => a.kind === 'finished'), false, 'the owner gave the next task');
  // the next report, dismissed with OK
  fs.appendFileSync(path.join(projectDir(proj), 'sess-dewi.jsonl'), jsonl([{ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'm2', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Install plan written to docs/ops/INSTALL-staging-box.md.' }] } }]));
  assert.ok(await wait(() => items().some((a) => a.kind === 'finished')));
  await squad.answerAttention(items().find((a) => a.kind === 'finished').id, 0);
  assert.equal(items().some((a) => a.kind === 'finished'), false);
  squad.stopAgent(FLOOR, 'dewi-devops');
});

test('a teammate spawned by the lead reports to the lead: no card', async () => {
  await squad.startAgent(FLOOR, 'rina-pm');
  assert.ok(await wait(() => items().some((a) => a.kind === 'permission')));
  await squad.answerAttention(items().find((a) => a.kind === 'permission').id, 1);
  session('rina-pm', 'sess-rina', 'Sprint 1 planned on the board.\n\n```\nM01 Login  3 SP\n```');
  session('budi-dev', '', 'M01 built, tests pass, handoff written.', { lead: 'sess-rina' });
  assert.ok(await wait(() => items().some((a) => a.kind === 'finished' && a.agentId === 'rina-pm')), 'the lead\'s own report');
  assert.equal(items().some((a) => a.agentId === 'budi-dev'), false);
  squad.stopAgent(FLOOR, 'rina-pm');
});
