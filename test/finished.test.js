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

test('answers to items that moved on: typed text still reaches the agent, a clicked option is "already answered"', async () => {
  await squad.startAgent(FLOOR, 'dewi-devops');
  assert.ok(await wait(() => items().some((a) => a.kind === 'permission')) || true);
  const trust = items().find((a) => a.kind === 'permission' && a.agentId === 'dewi-devops');
  if (trust) await squad.answerAttention(trust.id, 1);
  const where = { floorId: FLOOR, agentId: 'dewi-devops' };
  // a reply typed into a card whose id no longer exists
  let r = await squad.answerAttention('deadbeef0001', 1, 'Please also check the backups.', { ...where, kind: 'finished' });
  assert.deepEqual([r.ok, r.delivered], [true, 'as-message']);
  assert.ok(await wait(() => fs.readFileSync(LOG, 'utf8').includes('TASK Please also check the backups.')));
  // free text for a question whose dialog is gone
  r = await squad.answerAttention('deadbeef0002', 3, 'Use port 8310', { ...where, kind: 'question' });
  assert.equal(r.delivered, 'as-message');
  assert.ok(await wait(() => fs.readFileSync(LOG, 'utf8').includes("TASK Owner's answer to your earlier question: Use port 8310")));
  // only an option clicked: already answered (409), never a 404
  await assert.rejects(squad.answerAttention('deadbeef0003', 2, '', { ...where, kind: 'question' }), (e) => e.status === 409 && e.message === 'Already answered');
  await assert.rejects(squad.answerAttention('deadbeef0004', 1, ''), (e) => e.status === 409, 'no context at all');
  // a dismiss of something already gone is fine
  assert.deepEqual(await squad.answerAttention('deadbeef0005', 0, '', where), { ok: true, gone: true });
  // an unknown agent is refused, not messaged
  await assert.rejects(squad.answerAttention('deadbeef0006', 1, 'hello', { floorId: FLOOR, agentId: 'nobody', kind: 'reply' }), (e) => e.status === 404);
  squad.stopAgent(FLOOR, 'dewi-devops');
});

test('a turn keeps its card id whether it reads as a reply or as Finished', async () => {
  await squad.startAgent(FLOOR, 'dewi-devops');
  assert.ok(await wait(() => items().some((a) => a.kind === 'permission' && a.agentId === 'dewi-devops')) || true);
  const trust = items().find((a) => a.kind === 'permission' && a.agentId === 'dewi-devops');
  if (trust) await squad.answerAttention(trust.id, 1);
  const file = path.join(projectDir(proj), 'sess-dewi.jsonl');
  const ts = new Date(Date.now() + 2000).toISOString();          // after the tasks the earlier tests sent
  const write = (text) => fs.writeFileSync(file, jsonl([{ type: 'agent-setting', agentSetting: 'dewi-devops', sessionId: 'sess-dewi' },
    { type: 'user', timestamp: new Date(Date.now() - 90e3).toISOString(), message: { role: 'user', content: 'x' } },
    { type: 'assistant', timestamp: ts, message: { id: 'turn-1', stop_reason: 'end_turn', content: [{ type: 'text', text }] } }]));
  write('Inventory done.');
  assert.ok(await wait(() => items().some((a) => a.agentId === 'dewi-devops' && a.kind === 'finished')));
  const id1 = items().find((a) => a.agentId === 'dewi-devops' && a.kind === 'finished').id;
  assert.equal(items().find((a) => a.agentId === 'dewi-devops' && a.kind === 'finished').id, id1, 'stable across snapshots');
  write('Inventory done. Shall I start the staging install?');
  assert.ok(await wait(() => items().some((a) => a.agentId === 'dewi-devops' && a.kind === 'reply')));
  assert.equal(items().find((a) => a.agentId === 'dewi-devops' && a.kind === 'reply').id, id1, 'the same turn, the same id');
  squad.stopAgent(FLOOR, 'dewi-devops');
});

test('a long command keeps the agent working with a timer; when it ends, a calm card with duration and result', async () => {
  await squad.startAgent(FLOOR, 'dewi-devops');
  assert.ok(await wait(() => items().some((a) => a.kind === 'permission' && a.agentId === 'dewi-devops')) || true);
  const trust = items().find((a) => a.kind === 'permission' && a.agentId === 'dewi-devops');
  if (trust) await squad.answerAttention(trust.id, 1);
  const file = path.join(projectDir(proj), 'sess-dewi.jsonl'), start = Date.now() + 5000 - 8 * 60e3;   // later than the earlier turns
  const head = [{ type: 'agent-setting', agentSetting: 'dewi-devops', sessionId: 'sess-dewi' },
    { type: 'user', timestamp: new Date(start - 5000).toISOString(), message: { role: 'user', content: 'Run the e2e suite' } },
    { type: 'assistant', timestamp: new Date(start).toISOString(), message: { id: 'run', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu-e2e', name: 'Bash', input: { command: 'npx playwright test', description: 'e2e suite' } }] } }];
  fs.writeFileSync(file, jsonl(head));
  const dewi = () => { squad.invalidate(); return squad.buildingSnapshot().floors.find((f) => f.id === FLOOR).agents.find((a) => a.id === 'dewi-devops'); };
  assert.ok(await wait(() => dewi().task));
  const a = dewi();
  assert.equal(a.state, 'working', 'nothing new in the transcript for 8 minutes, still working');
  assert.equal(a.task.label, 'e2e Playwright');
  assert.ok(a.task.elapsedMs >= 7 * 60e3, `${a.task.elapsedMs}`);
  await squad.logTick();
  assert.equal(squadLog.read(FLOOR, { type: 'task.started' }).filter((e) => e.agent === 'dewi-devops').length, 1);
  // it ends
  const end = start + 8 * 60e3;
  fs.writeFileSync(file, jsonl([...head,
    { type: 'user', timestamp: new Date(end).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'tu-e2e', content: [{ type: 'text', text: 'Running 42 tests\n  2 failed\n  40 passed (8.0m)' }] }] } },
    { type: 'assistant', timestamp: new Date(end + 2000).toISOString(), message: { id: 'end', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Two e2e tests fail; details in the QA report.' }] } }]));
  assert.ok(await wait(() => items().some((x) => x.kind === 'taskdone')));
  const card = items().find((x) => x.kind === 'taskdone');
  assert.equal(card.text, 'e2e Playwright failed in 8m 00s: 40 passed, 2 failed');
  assert.equal(card.calm, true);
  assert.equal(dewi().task, null);
  await squad.logTick();
  const ended = squadLog.read(FLOOR, { type: 'task.ended' }).filter((e) => e.agent === 'dewi-devops');
  assert.deepEqual(ended.map((e) => [e.data.kind, e.data.ms, e.data.passed, e.data.failed]), [['e2e', 8 * 60e3, 40, 2]]);
  await squad.answerAttention(card.id, 0);
  assert.equal(items().some((x) => x.kind === 'taskdone'), false, 'OK dismisses it');
  squad.stopAgent(FLOOR, 'dewi-devops');
});
