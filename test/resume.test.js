// Recovery after an agent dies: crash detection, Resume, teammates of a crashed lead, the start guard, auto-resume.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratch, jsonl } from './helpers.js';
import { configure, paths } from '../server/config.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';
import * as recovery from '../server/recovery.js';
import * as tx from '../server/transcripts.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.cjs');
const root = scratch();
const GB = 2 ** 30;
const calm = { mem: { available: 6 * GB }, swap: { total: 8 * GB, used: 1 * GB } };
const fakeLog = path.join(root, 'fake.log');
process.env.FAKE_CLAUDE_LOG = fakeLog;
configure({ claudeBin: FAKE, useSystemd: false, useHooks: false });
let journal = '';
recovery.setJournalRunner(() => journal);
after(() => recovery.setJournalRunner(null));

const { createSquad } = await import('../server/setup.js');
const building = await import('../server/building.js');
building.setPrefs({ squadsDir: path.join(root, 'squads') });
const r = await createSquad({ blueprint: 'software-house', name: 'Kiosk', team: [
  { template: 'project-manager', displayName: 'Rina - PM' }, { template: 'fullstack-developer', displayName: 'Budi - Dev' }] });
const FLOOR = r.id;
const pdir = tx.projectDir(r.path);
const iso = (ts) => new Date(ts).toISOString();
const kiosk = () => { squad.invalidate(); return squad.buildingSnapshot().floors.find((f) => f.id === FLOOR); };
const runtime = () => JSON.parse(fs.readFileSync(paths.runtime(), 'utf8'));
const wait = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((ok) => setTimeout(ok, 100)); } return false; };
const setRuntime = (patch) => fs.writeFileSync(paths.runtime(), JSON.stringify({ ...(fs.existsSync(paths.runtime()) ? runtime() : {}), ...patch }));

// the lead's session ends mid-turn; its teammate was editing inside it
function leadSession(id, { endTurn = false, at = Date.now() - 30000 } = {}) {
  fs.mkdirSync(path.join(pdir, id, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(pdir, `${id}.jsonl`), jsonl([
    { type: 'agent-setting', agentSetting: 'rina-pm', sessionId: id },
    { type: 'user', timestamp: iso(at - 60000), message: { role: 'user', content: '/sprint 2' } },
    { type: 'assistant', timestamp: iso(at), message: { id: 'm1', stop_reason: endTurn ? 'end_turn' : 'tool_use', content: endTurn ? [{ type: 'text', text: 'Done.' }] : [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'budi-dev' } }] } },
  ]));
  fs.writeFileSync(path.join(pdir, id, 'subagents', 'agent-abudi.jsonl'), jsonl([
    { type: 'assistant', timestamp: iso(at - 5000), message: { id: 's1', content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: path.join(r.path, 'src/app.js'), old_string: 'a', new_string: 'b' } }] } },
  ]));
  fs.writeFileSync(path.join(pdir, id, 'subagents', 'agent-abudi.meta.json'), JSON.stringify({ agentType: 'budi-dev', taskKind: 'in_process_teammate' }));
}

test('a lead killed by systemd-oomd: crashed on the Desk and in Attention; its teammate shows its real last state', () => {
  const at = Date.now() - 30000;
  leadSession('sess-1', { at });
  fs.writeFileSync(path.join(r.path, 'docs', 'BOARD.md'), '| Task | Owner | Status |\n|---|---|---|\n| M01 Login | budi-dev | IN_PROGRESS |\n');
  journal = `${((at + 10000) / 1000).toFixed(6)} host systemd[1]: aisquad-${FLOOR}-rina-pm-1.scope: systemd-oomd killed 40 process(es) in this unit.\n`;
  setRuntime({ sessions: { [`${FLOOR}/rina-pm`]: { startedAt: at - 3600e3, model: 'opus', effort: 'high', unit: `aisquad-${FLOOR}-rina-pm-1` } } });
  const f = kiosk();
  const pm = f.agents.find((a) => a.id === 'rina-pm'), dev = f.agents.find((a) => a.id === 'budi-dev');
  assert.equal(pm.state, 'stopped');
  assert.equal(pm.crash.cause, 'oom');
  assert.match(pm.crash.text, /^Stopped unexpectedly \(out of memory at \d\d:\d\d\)$/);
  assert.deepEqual(pm.resume, { sessionId: 'sess-1' });
  const ended = runtime().ended[`${FLOOR}/rina-pm`];
  assert.equal(ended.sessionId, 'sess-1'); assert.equal(ended.kind, 'crashed');
  assert.equal(runtime().sessions[`${FLOOR}/rina-pm`], undefined, 'noted once');
  // the source documents are still drafts, but the sprint has started: never "waiting for source documents"
  assert.equal(dev.standby, null);
  assert.equal(dev.crash.withLead, 'rina-pm');
  assert.match(dev.stopNote, /^stopped with the lead \(out of memory at \d\d:\d\d\) · last: editing src\/app\.js$/);
  assert.equal(f.waitingFor.kind, 'docs', 'the pending documents stay on the pill (the owner still approves them)');
  const att = squad.attentionItems().filter((a) => a.floorId === FLOOR && a.kind === 'crash');
  assert.equal(att.length, 1, 'one item for the lead, none for the teammate');
  assert.deepEqual(att[0].options.map((o) => o.label), ['Resume', 'Start fresh']);
});

test('the crash is logged once with its cause', async () => {
  // collect.stateChanges needs a previous "running" state: simulate the tick before the crash
  const collect = await import('../server/collect.js');
  const S = collect.stateOf(FLOOR);
  S.agents = { 'rina-pm': { state: 'working', running: true, since: 0 }, 'budi-dev': { state: 'working', running: true, inLead: true, since: 0 } };
  await squad.logTick();
  const ev = squadLog.read(FLOOR, { type: 'agent.crashed' });
  assert.deepEqual(ev.map((e) => [e.agent, e.data.cause]), [['rina-pm', 'oom'], ['budi-dev', 'oom']]);
  assert.equal(ev[1].data.withLead, 'rina-pm');
});

test('Resume from Attention continues the last session; the lead gets the recovery note', async () => {
  const item = squad.attentionItems().find((a) => a.floorId === FLOOR && a.kind === 'crash');
  const res = await squad.answerAttention(item.id, 1, '', { force: true });
  assert.equal(res.resumed, 'sess-1');
  assert.ok(await wait(() => fs.existsSync(fakeLog)));
  assert.match(fs.readFileSync(fakeLog, 'utf8'), /START --agent rina-pm .*--resume sess-1/);
  const desk = squad.deskDetail(FLOOR, 'rina-pm');
  assert.match(desk.pending, /^Recovery note from The AI Squad: your session stopped unexpectedly \(out of memory at/);
  assert.match(desk.pending, /re-spawn only the teammates/);
  assert.equal(desk.crash, null);
  assert.equal(runtime().ended[`${FLOOR}/rina-pm`], undefined);
  assert.equal(squadLog.read(FLOOR, { type: 'agent.resumed' }).at(-1).data.session, 'sess-1');
  assert.equal(squad.attentionItems().filter((a) => a.kind === 'crash').length, 0);
});

test('the start guard warns when the Floor runs its maximum of agents (the lead and its live teammate count)', async () => {
  floors.updateFloorConfig(r.path, { recovery: { maxAgents: 1 } });
  await assert.rejects(squad.startAgent(FLOOR, 'budi-dev', '', { guard: true }), (e) => e.status === 409 && /2 agents already run on this Floor \(maximum 1\)/.test(e.message) && e.data.warnings.length >= 1);
  const ok = await squad.startAgent(FLOOR, 'budi-dev', '', { guard: false });
  assert.equal(ok.ok, true);
  squad.stopAgent(FLOOR, 'budi-dev');
  squad.stopAgent(FLOOR, 'rina-pm');
  assert.equal(runtime().ended[`${FLOOR}/rina-pm`], undefined, 'a stop from The AI Squad is not a crash');
  const pm = kiosk().agents.find((a) => a.id === 'rina-pm');
  assert.equal(pm.crash, null); assert.deepEqual(pm.resume, { sessionId: 'sess-1' }, 'Resume stays available after a clean stop');
});

test('a clean exit at the end of a turn is not a crash', () => {
  leadSession('sess-2', { endTurn: true });
  journal = '';
  setRuntime({ sessions: { [`${FLOOR}/rina-pm`]: { startedAt: Date.now() - 3600e3 } } });
  const pm = kiosk().agents.find((a) => a.id === 'rina-pm');
  assert.equal(pm.crash, null); assert.equal(pm.exited, true); assert.deepEqual(pm.resume, { sessionId: 'sess-2' });
  assert.equal(squad.attentionItems().filter((a) => a.kind === 'crash').length, 0);
});

test('auto-resume: only when the Floor allows it, at most twice an hour, never under memory pressure', async () => {
  const crash = () => { setRuntime({ sessions: { [`${FLOOR}/rina-pm`]: { startedAt: Date.now() - 3600e3 } } }); leadSession('sess-3'); kiosk(); };
  crash();
  floors.updateFloorConfig(r.path, { recovery: { autoResume: false, maxAgents: 4 } });
  assert.deepEqual(await squad.autoResumeTick(Date.now(), { res: calm }), [], 'off by default');
  floors.updateFloorConfig(r.path, { recovery: { autoResume: true } });
  assert.deepEqual(await squad.autoResumeTick(Date.now(), { res: { ...calm, swap: { total: 8 * GB, used: 7 * GB } } }), [], 'memory under pressure');
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await squad.autoResumeTick(Date.now(), { res: calm }), [{ floorId: FLOOR, agentId: 'rina-pm' }]);
    squad.stopAgent(FLOOR, 'rina-pm');
    crash();
  }
  assert.deepEqual(await squad.autoResumeTick(Date.now(), { res: calm }), [], 'third crash within the hour waits for the owner');
  assert.equal(squadLog.read(FLOOR, { type: 'agent.resumed' }).at(-1).data.via, 'auto-resume');
  assert.ok(squad.attentionItems().some((a) => a.kind === 'crash'), 'still in Attention');
});
