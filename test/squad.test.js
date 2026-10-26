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
  assert.equal(s.floors.find((f) => f.id === 'acme').lamp, 'stopped');
});

test('pending work with everyone idle for 10 minutes is a Floor stall', () => {
  writeWork({ 'acme/budi-dev': { text: 'Build the catalogue', assignedAt: Date.now() - 11 * 60e3, doneAt: null } });
  const s = fresh();
  const stall = s.attention.find((a) => a.kind === 'stall');
  assert.ok(stall, 'stall alert');
  assert.match(stall.text, /lead and all agents idle for 11 min/);
  assert.equal(s.floors.find((f) => f.id === 'acme').lamp, 'attention');
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
  assert.equal(fresh().floors.find((f) => f.id === 'acme').budget.level, 'over');
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
  const budi = () => fresh().floors.find((f) => f.id === 'acme').agents.find((a) => a.id === 'budi-dev').models;
  assert.deepEqual([budi().configured, budi().observed, budi().mismatch], ['sonnet', 'claude-sonnet-5-5', false]);
  floors.updateAgent(proj, 'budi-dev', { overrides: { model: 'opus' } });
  assert.deepEqual([budi().configured, budi().mismatch], ['opus', true]);
});

test('code window around the latest edit; never outside the repo or from .env', () => {
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src/add.js'), Array.from({ length: 40 }, (_, i) => (i === 20 ? 'export const add = (a, b) => a + b;' : `// line ${i + 1}`)).join('\n'));
  const w = squad.codeWindow(proj, { type: 'code', path: 'src/add.js', text: 'export const add = (a, b) => a + b;', ts: 1 });
  assert.equal(w.firstLine, 16);
  assert.equal(w.hlFrom, 21);
  assert.equal(w.text.split('\n').length, 18);
  fs.writeFileSync(path.join(proj, '.env'), 'SECRET=1');
  assert.equal(squad.codeWindow(proj, { type: 'code', path: '.env', text: 'SECRET=1' }).firstLine, undefined);
  assert.equal(squad.codeWindow(proj, { type: 'code', path: '../../etc/passwd', text: 'root' }).firstLine, undefined);
});

test('Squad Sprint teammates the lead has not started are not "stopped"; the Floor says what it waits for', async () => {
  const { createSquad } = await import('../server/setup.js');
  const building = await import('../server/building.js');
  building.setPrefs({ squadsDir: path.join(root, 'squads') });
  const r = await createSquad({ blueprint: 'software-house', name: 'Kiosk', team: [
    { template: 'project-manager', displayName: 'Rina - PM' }, { template: 'fullstack-developer', displayName: 'Budi - Dev' }] });
  const kiosk = () => fresh().floors.find((f) => f.id === r.id);
  let f = kiosk();
  const [pm, dev] = ['rina-pm', 'budi-dev'].map((id) => f.agents.find((a) => a.id === id));
  assert.deepEqual([pm.state, pm.standby], ['stopped', null], 'the lead is really stopped');
  assert.deepEqual([dev.state, dev.standby, dev.activity], ['stopped', 'docs', 'waiting for source documents']);
  assert.equal(f.counts.standby, 1);
  assert.deepEqual(f.waitingFor, { kind: 'docs', text: 'Waiting for you: 4 source documents', docs: ['docs/PRD.md', 'docs/TECH.md', 'docs/DESIGN.md', 'docs/ENVIRONMENTS.md'] });
  for (const d of ['PRD', 'TECH', 'DESIGN', 'ENVIRONMENTS']) {
    const file = path.join(r.path, 'docs', `${d}.md`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('STATUS: DRAFT', 'STATUS: APPROVED'));
  }
  f = kiosk();
  assert.deepEqual([f.agents.find((a) => a.id === 'budi-dev').standby, f.agents.find((a) => a.id === 'budi-dev').activity], ['sprint', 'not started: the lead starts them when the sprint begins']);
  assert.equal(f.waitingFor, null);
  // a Free Team Floor without a Blueprint keeps plain "stopped"
  assert.equal(fresh().floors.find((x) => x.id === 'acme').agents.find((a) => a.id === 'budi-dev').standby, null);
});

test('who speaks and how: the agent\'s language and voice settings, else the Floor\'s defaults, else auto', () => {
  const agents = floors.readFloor(proj).team.agents, rina = agents.find((a) => a.lead), budi = agents.find((a) => !a.lead);
  assert.deepEqual(squad.agentVoice('acme', budi.id).lang, 'auto');
  floors.updateFloorConfig(proj, { voice: { lang: 'id', settings: { stability: .4 } } });
  assert.deepEqual(squad.agentVoice('acme', budi.id), { voice: squad.agentVoice('acme', budi.id).voice, lang: 'id', vs: { stability: .4, similarity_boost: .8, style: 0, use_speaker_boost: true } }, 'the Floor default');
  floors.updateAgent(proj, rina.id, { voiceLang: 'en', voiceSettings: { style: .3 } });
  assert.equal(squad.agentVoice('acme', rina.id).lang, 'en', 'the agent\'s own');
  assert.equal(squad.agentVoice('acme', rina.id).vs.style, .3);
  floors.updateAgent(proj, rina.id, { voiceLang: 'klingon' });
  assert.equal(floors.readFloor(proj).team.agents.find((a) => a.id === rina.id).voiceLang, undefined, 'an unknown language is dropped');
  floors.updateAgent(proj, rina.id, { voiceSettings: null });
  assert.equal(squad.agentVoice('acme', rina.id).vs.stability, .4, 'back to the Floor default');
});
