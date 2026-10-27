// SPDX-License-Identifier: Apache-2.0
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, config } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as space from '../server/space.js';
import * as company from '../server/company.js';
import * as context from '../server/context.js';
import * as history from '../server/history.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as jobs from '../server/jobs.js';
import * as squad from '../server/squad.js';
import { encodeProjectPath } from '../server/transcripts.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-stream.cjs');
const LOG = path.join(root, 'fake.log');
process.env.FAKE_CLAUDE_LOG = LOG;
configure({ claudeBin: FAKE, useHooks: false, useSystemd: false });
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-aisquad-pin': pin }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return fn(); };
const proj = path.join(root, 'projects', 'sales');
let floorId = '', agentId = '';

test('a Space: kind, access, memory, shift, node and ERPNext role, cleaned with safe defaults', () => {
  assert.deepEqual(space.cleanSpace({}), { kind: 'project', access: 'team', memory: 'claude', shift: space.DEFAULT_SHIFT, node: 'auto', erpnext: 'off' });
  const s = space.cleanSpace({ kind: 'department', access: 'owner', memory: 'repo', shift: { enabled: true, days: [5, 1, 1, 9], from: '22:00', to: '05:00' }, node: 'box-2', erpnext: 'sales' });
  assert.deepEqual(s, { kind: 'department', access: 'owner', memory: 'repo', shift: { enabled: true, days: [1, 5], from: '22:00', to: '05:00' }, node: 'box-2', erpnext: 'sales' });
  assert.equal(space.cleanSpace({ erpnext: 'owner' }).erpnext, 'off', 'the owner key is never for agents');
  assert.equal(space.cleanSpace({ kind: 'x', access: 'root', node: '../etc' }).kind, 'project');
});

test('a shift: day hours, a night shift past midnight belongs to the day it starts, off means always', () => {
  const at = (day, h, m = 0) => new Date(2026, 9, 25 + day, h, m).getTime();     // 25 Oct 2026 is a Sunday (day 0)
  const day = { enabled: true, days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' };
  assert.equal(space.inShift(day, at(1, 9)), true);
  assert.equal(space.inShift(day, at(1, 17)), false);
  assert.equal(space.inShift(day, at(6, 9)), false, 'Saturday');
  const night = { enabled: true, days: [1, 2, 3, 4, 5], from: '22:00', to: '05:00' };
  assert.equal(space.inShift(night, at(1, 23)), true, 'Monday 23:00');
  assert.equal(space.inShift(night, at(2, 3)), true, 'Tuesday 03:00 belongs to Monday night');
  assert.equal(space.inShift(night, at(1, 3)), false, 'Monday 03:00 belongs to Sunday night: no shift');
  assert.equal(space.inShift(night, at(6, 2)), true, 'Saturday 02:00 belongs to Friday night');
  assert.equal(space.inShift(night, at(2, 12)), false);
  assert.equal(space.inShift({ enabled: false }, at(0, 3)), true);
});

test('the Company Brain: folders and READMEs, Owner folders, summary', () => {
  const dir = company.companyDir({});
  assert.equal(dir, path.join(config.home, 'company'));
  assert.equal(company.companyDir({ company: { path: '/srv/brain' } }), '/srv/brain');
  assert.throws(() => company.cleanCompany({ path: 'relative' }), /absolute/);
  const s = company.ensure(dir);
  assert.deepEqual(s.dirs.map((d) => d.name), ['brand', 'finance', 'legal', 'pricing', 'products', 'sop', 'templates']);
  assert.deepEqual(s.dirs.filter((d) => d.ownerOnly).map((d) => d.name), ['finance', 'legal', 'pricing']);
  fs.writeFileSync(path.join(dir, 'brand', 'voice.md'), 'Warm, short.');
  assert.equal(company.summary(dir).dirs.find((d) => d.name === 'brand').files, 1);
  fs.writeFileSync(path.join(dir, 'README.md'), 'custom');
  company.ensure(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), 'custom', 'never overwritten');
});

test('session context: Company Brain read-only, Owner folders closed to team Spaces, identity guarded, memory in the repo', () => {
  const dir = company.companyDir({});
  const team = context.sessionContext('/p/x', { kind: 'department', access: 'team', memory: 'claude' }, {});
  assert.deepEqual(team.addDirs, ['--add-dir', dir]);
  assert.ok(team.deny.includes(`Edit(/${dir}/**)`) && team.deny.includes(`Write(/${dir}/**)`));
  assert.ok(team.deny.includes(`Read(/${dir}/legal/**)`) && team.deny.includes(`Read(/${dir}/pricing/**)`));
  assert.ok(team.deny.includes(`Write(/${path.join(config.claudeHome, 'CLAUDE.md')})`), 'the machine-wide CLAUDE.md');
  assert.ok(team.deny.includes(`Write(/${config.home}/**)`), 'The AI Squad\'s own data (Role Templates)');
  assert.equal(team.settings, null);
  assert.match(team.lines.join('\n'), /Legal, finance and pricing are not for this Space/);
  const owner = context.sessionContext('/p/legal', { access: 'owner', memory: 'repo' }, {});
  assert.ok(!owner.deny.some((d) => d.startsWith('Read(') && d.includes(dir)), 'an Owner Space reads the whole Company Brain');
  for (const c of [team, owner]) assert.ok(c.deny.includes(`Read(/${path.join(config.home, 'secrets.json')})`) && c.deny.includes('Bash(*secrets.json*)') && c.deny.includes('Bash(*AISQUAD_ERP_*)'), 'no agent reads the machine\'s keys');
  assert.deepEqual(owner.settings, { autoMemoryDirectory: path.join('/p/legal', '.claude', 'aisquad', 'memory') });
  assert.match(owner.lines.join('\n'), /for this Owner Space legal, finance, pricing/);
});

test('a Space\'s settings reach floor.json and the agent file; switching memory to the repo brings what was learned', async () => {
  await floors.createFloor({ name: 'Sales', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Sari - Sales Manager', template: 'sales-manager', lead: true }] });
  floorId = building.loadBuilding().floors[0].id; agentId = floors.readFloor(proj).team.agents[0].id;
  const learned = path.join(config.claudeHome, 'projects', encodeProjectPath(proj), 'memory');
  fs.mkdirSync(learned, { recursive: true }); fs.writeFileSync(path.join(learned, 'MEMORY.md'), '- client prefers WhatsApp\n');
  floors.updateFloorConfig(proj, { kind: 'department', memory: 'repo', shift: { enabled: true, days: [1, 2, 3, 4, 5], from: '22:00', to: '05:00' } });
  const f = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'aisquad', 'floor.json'), 'utf8'));
  assert.equal(f.kind, 'department'); assert.equal(f.memory, 'repo'); assert.equal(f.shift.from, '22:00');
  assert.equal(fs.readFileSync(path.join(proj, '.claude', 'aisquad', 'memory', 'MEMORY.md'), 'utf8'), '- client prefers WhatsApp\n');
  const agentFile = fs.readFileSync(path.join(proj, '.claude', 'agents', `${agentId}.md`), 'utf8');
  assert.match(agentFile, /## Context\n- This Space is a department/);
  assert.match(agentFile, /its memory in `\.claude\/aisquad\/memory\/`/);
  assert.match(agentFile, /The Company Brain is at/);
});

test('an agent\'s session gets the context: --add-dir, --settings and the identity guard', async () => {
  const j = squad.startAgentJob(floorId, agentId, 'draft the follow-up plan');
  await until(() => { const r = jobs.refreshJob(jobs.readJob(j.id)); return r.ended && r.job; });
  const c = JSON.parse(fs.readFileSync(LOG, 'utf8').trim().split('\n').at(-1));
  assert.ok(c.args.includes(company.companyDir({})));
  assert.deepEqual(JSON.parse(c.args[c.args.indexOf('--settings') + 1]), { autoMemoryDirectory: path.join(proj, '.claude', 'aisquad', 'memory') });
  assert.ok(c.args.includes(`Write(/${path.join(config.claudeHome, 'CLAUDE.md')})`));
  assert.ok(c.args.includes(`Read(/${company.companyDir({})}/legal/**)`), 'a team Space');
});

test('configuration is code: changes are recorded with before and after; rollback puts them back', async () => {
  const add = await call('POST', `/api/floors/${floorId}/agents`, { displayName: 'Rudi - Lead Researcher', template: 'lead-researcher' });
  assert.equal(add.status, 200);
  const list = (await call('GET', '/api/history')).body.changes;
  assert.equal(list[0].label, 'Agent added: Rudi - Lead Researcher');
  assert.deepEqual(list[0].files, [`${floorId}/team.json`]);
  const detail = (await call('GET', `/api/history/${list[0].id}`)).body;
  assert.ok(detail.files[0].diff.some((l) => l.op === '+' && /Rudi - Lead Researcher/.test(l.text)));
  const rid = add.body.agent.id;
  assert.ok(fs.existsSync(path.join(proj, '.claude', 'agents', `${rid}.md`)));
  // a later change to the same file makes the rollback a conflict, until forced
  await call('PATCH', `/api/floors/${floorId}/agents/${rid}`, { displayName: 'Rudi R. - Lead Researcher' });
  const conflict = await call('POST', `/api/history/${list[0].id}/rollback`, {});
  assert.equal(conflict.status, 409); assert.deepEqual(conflict.body.conflicts, [`${floorId}/team.json`]);
  const rb = await call('POST', `/api/history/${list[0].id}/rollback`, { force: true });
  assert.equal(rb.status, 200);
  assert.deepEqual(floors.readFloor(proj).team.agents.map((a) => a.id), [agentId]);
  assert.ok(!fs.existsSync(path.join(proj, '.claude', 'agents', `${rid}.md`)), 'agent files regenerated after the rollback');
  assert.match((await call('GET', '/api/history')).body.changes[0].label, /^Rollback of: Agent added/);
  // nothing changed: nothing recorded
  const n = history.list().length;
  await history.track('no-op', { root: proj, floorId }, () => 1);
  assert.equal(history.list().length, n);
});

test('the Admin overview: Spaces, agents across Spaces, skills with the roles that use them, the Company Brain', async () => {
  const r = (await call('GET', '/api/admin')).body;
  assert.equal(r.spaces[0].kind, 'department'); assert.equal(r.spaces[0].memory, 'repo');
  assert.equal(r.agents[0].floorId, floorId); assert.ok(r.agents[0].model);
  assert.ok(r.skills.some((s) => s.name === 'crm-hygiene' && s.roles.includes('crm-administrator')));
  assert.equal(r.company.exists, true);
  const moved = await call('PATCH', '/api/company', { path: path.join(root, 'brain') });
  assert.equal(moved.body.exists, false);
  assert.equal((await call('POST', '/api/company/init', {})).body.exists, true);
  assert.match(fs.readFileSync(path.join(proj, '.claude', 'agents', `${agentId}.md`), 'utf8'), new RegExp(`Company Brain is at \`${path.join(root, 'brain')}\``));
});
