// Autopilot on a running Floor (fake Claude Code): the timeout answer, critical items wait, Change answer,
// reply and idle nudges, lead decisions from the questions file.
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
const GB = 2 ** 30;
const calm = { mem: { available: 6 * GB }, swap: { total: 8 * GB, used: 1 * GB } };
const proj = path.join(root, 'shop');
await floors.createFloor({ name: 'Shop', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Rina - PM', template: 'project-manager', lead: true }, { displayName: 'Budi - Dev', template: 'fullstack-developer' }] });
const FLOOR = 'shop', LEAD = 'rina-pm';
const name = tm.sessionName(FLOOR, LEAD);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const wait = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; };
const logText = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');
const snap = () => { squad.invalidate(); return squad.buildingSnapshot(); };
const items = () => snap().attention.filter((a) => a.floorId === FLOOR);
const later = (min) => Date.now() + min * 60e3;
// the fake opens an AskUserQuestion dialog when its input line gets this word
async function open(word) { assert.ok(await wait(() => tm.isReady(tm.capture(name, 0, { styled: true })))); assert.equal((await tm.typeTask(name, word)).ok, true); assert.ok(await wait(() => items().some((a) => a.kind === 'question'))); }

test('a new Floor starts Balanced; the lead runs', async () => {
  assert.equal(floors.readFloor(proj).floor.autopilot, 'balanced');
  await squad.startAgent(FLOOR, LEAD);
  assert.ok(await wait(() => items().some((a) => a.kind === 'permission')), 'trust dialog');
  const trust = items().find((a) => a.kind === 'permission');
  assert.equal(trust.autopilot.auto, false, 'permission prompts are never answered');
  await squad.answerAttention(trust.id, 1);
  assert.equal(snap().floors.find((f) => f.id === FLOOR).autopilot.level, 'balanced');
});

test('a non-critical question is answered with its recommended option after the timeout, and stays as a muted item', async () => {
  await open('quiz');
  const q = items().find((a) => a.kind === 'question');
  assert.deepEqual([q.autopilot.critical, q.autopilot.recommended, q.autopilot.auto], [false, 2, true]);
  assert.ok(Math.abs(q.autopilot.autoAt - q.ts - 180e3) < 2000, '3 minutes');
  await sleep(1100);
  assert.equal(items().find((a) => a.kind === 'question').autopilot.autoAt, q.autopilot.autoAt, 'the clock does not move with each snapshot');
  assert.deepEqual(await squad.autopilotTick(Date.now(), { res: calm }), [], 'not before the timeout');
  const done = await squad.autopilotTick(later(4), { res: calm });
  assert.deepEqual(done.map((d) => [d.kind, d.option]), [['answered', 'Vitest']]);
  assert.ok(await wait(() => logText().includes('ANSWER quiz 2')));
  const d = items().find((a) => a.kind === 'decided');
  assert.equal(d.muted, true); assert.equal(d.chosen, 'Vitest'); assert.deepEqual(d.options.map((o) => o.label), ['Jest']);
  assert.equal(snap().floors.find((f) => f.id === FLOOR).attention, 0, 'a decided item does not need the owner');
  const ev = squadLog.read(FLOOR, { type: 'autopilot.decided' }).at(-1);
  assert.deepEqual([ev.data.by, ev.data.option, ev.data.critical], ['server timeout', 'Vitest', false]);
});

test('Change answer sends the owner\'s choice to the agent; OK keeps it', async () => {
  const d = items().find((a) => a.kind === 'decided');
  await squad.answerAttention(d.id, 1);
  assert.ok(await wait(() => /TASK The owner changes an Autopilot decision\..*decided automatically as "Vitest"; the owner chooses "Jest"/.test(logText())));
  assert.equal(items().filter((a) => a.kind === 'decided').length, 0);
  assert.equal(squadLog.read(FLOOR, { type: 'autopilot.changed' }).at(-1).data.to, 'Jest');
});

test('a critical question is never answered; it is logged once as blocked and shown on the pill', async () => {
  await open('pricequiz');
  const q = items().find((a) => a.kind === 'question');
  assert.equal(q.autopilot.critical, true); assert.deepEqual(q.autopilot.reasons, ['money']);
  for (const m of [4, 60]) assert.deepEqual((await squad.autopilotTick(later(m), { res: calm })).filter((x) => x.kind === 'answered'), []);
  assert.doesNotMatch(logText(), /ANSWER pricequiz/);
  assert.equal(squadLog.read(FLOOR, { type: 'autopilot.blocked' }).length, 1);
  assert.equal(snap().floors.find((f) => f.id === FLOOR).autopilot.critical, 1);
  await squad.answerAttention(q.id, 1);                     // the owner answers it
  assert.ok(await wait(() => logText().includes('ANSWER pricequiz 1')));
});

test('an unanswered plain-text ask gets the Autopilot nudge once after the timeout', async () => {
  const sid = 'sess-lead';
  fs.mkdirSync(projectDir(proj), { recursive: true });
  fs.writeFileSync(path.join(projectDir(proj), `${sid}.jsonl`), jsonl([
    { type: 'agent-setting', agentSetting: LEAD, sessionId: sid },
    { type: 'user', timestamp: new Date(Date.now() - 60e3).toISOString(), message: { role: 'user', content: 'plan the sprint' } },
    { type: 'assistant', timestamp: new Date(Date.now() - 30e3).toISOString(), message: { id: 'm1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sprint plan drafted. Should the RSVP list be sorted by name or by date?' }] } },
  ]));
  assert.ok(await wait(() => items().some((a) => a.kind === 'reply')));
  const r = items().find((a) => a.kind === 'reply');
  assert.equal(r.autopilot.critical, false);
  const done = await squad.autopilotTick(later(4), { res: calm });
  assert.deepEqual(done.map((x) => x.kind), ['nudged']);
  assert.ok(await wait(() => logText().includes('TASK Owner did not answer within 3 minutes: decide yourself per Autopilot rules')));
  assert.equal(squadLog.read(FLOOR, { type: 'autopilot.nudged' }).at(-1).data.kind, 'reply');
});

test('idle nudge: the whole squad idle with open board work for 5 minutes, at most once per 15 minutes', async () => {
  fs.mkdirSync(path.join(proj, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'docs', 'BOARD.md'), '| Task | Owner | Status |\n|---|---|---|\n| M01 Login | budi-dev | TODO |\n| M02 Cart | budi-dev | DONE |\n');
  const lead = () => snap().floors.find((f) => f.id === FLOOR).agents.find((a) => a.id === LEAD);
  assert.ok(await wait(() => lead().state === 'idle'));
  const t0 = Date.now();
  const idle = async (min) => (await squad.autopilotTick(t0 + min * 60e3, { res: calm })).filter((x) => x.kind === 'idle').length;
  assert.equal(await idle(0), 0);
  assert.equal(await idle(6), 1);
  assert.ok(await wait(() => logText().includes('TASK Autopilot: the whole squad is idle while the board has 1 open task')));
  assert.equal(await idle(10), 0, 'rate limit');
  assert.equal(await idle(30), 1);
  // the chain stops under memory pressure
  assert.equal((await squad.autopilotTick(t0 + 60 * 60e3, { res: { ...calm, swap: { total: 8 * GB, used: 7.5 * GB } } })).filter((x) => x.kind === 'idle').length, 0);
});

test('lead decisions in the questions file are logged once; what was there before is history', async () => {
  const qf = path.join(proj, 'docs', 'QUESTIONS.md');
  fs.mkdirSync(path.dirname(qf), { recursive: true });
  fs.writeFileSync(qf, '1. Font? Choice: Inter. DECIDED BY LEAD (autopilot), owner may correct\n');
  await squad.autopilotTick(Date.now(), { res: calm });
  fs.appendFileSync(qf, '2. Sort RSVP by date? Choice: date. DECIDED BY LEAD (autopilot), owner may correct\n');
  await squad.autopilotTick(Date.now(), { res: calm });
  const ev = squadLog.read(FLOOR, { type: 'autopilot.decided' }).filter((e) => e.data.by === 'lead');
  assert.equal(ev.length, 1); assert.match(ev[0].data.question, /Sort RSVP by date/); assert.equal(ev[0].data.critical, false);
});

test('Autopilot off: nothing is answered or nudged', async () => {
  floors.updateFloorConfig(proj, { autopilot: 'off' });
  await open('quiz');
  assert.equal(items().find((a) => a.kind === 'question').autopilot, undefined);
  assert.deepEqual(await squad.autopilotTick(later(10), { res: calm }), []);
  squad.stopAgent(FLOOR, LEAD);
});

test('the Lobby counts the decisions Autopilot took today', () => {
  assert.equal(snap().autopilotToday, 2, 'one by the server timeout, one by the lead');
});
