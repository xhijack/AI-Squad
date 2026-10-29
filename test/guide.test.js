// SPDX-License-Identifier: Apache-2.0
// The Company Guide (1.4): the owner's answers become a plan (with or without Claude Code), the plan builds the
// Spaces with their targets, shifts, budgets and materials lists, the company plan reaches the Company Brain and
// the agents, the owner's language reaches the agents; only the Owner runs the guide; it can be run again.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as guide from '../server/guide.js';
import * as kpi from '../server/kpi.js';
import * as cadence from '../server/cadence.js';
import * as context from '../server/context.js';
import * as squadLog from '../server/log.js';

const root = scratch();
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const call = async (method, url, body, p = pin) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(p ? { 'x-aisquad-pin': p } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
building.setPrefs({ squadsDir: path.join(root, 'squads') });
const answers = {
  language: 'id', business: { type: 'saas', name: 'DTamu', description: 'Undangan digital dan buku tamu digital' },
  goals: { picks: ['leads', 'revenue'], leads: 50, revenue: 30000000 }, have: ['website', 'repos', 'erpnext'],
  divisions: ['product', 'engineering', 'marketing', 'sales', 'legal'], modes: { marketing: 'automatic', sales: 'supervised' },
  capacity: { machines: 'this', hours: 'night', budget: 100 },
};

test('answers are cleaned; the plan is deterministic without Claude Code', () => {
  const a = guide.cleanAnswers({ ...answers, divisions: [...answers.divisions, 'bogus'], modes: { marketing: 'wild' }, capacity: { hours: 'later', budget: '-5' } });
  assert.deepEqual(a.divisions, ['product', 'engineering', 'marketing', 'sales', 'legal']);
  assert.deepEqual(a.modes, { product: 'supervised', engineering: 'supervised', marketing: 'supervised', sales: 'supervised', legal: 'manual' }, 'Legal is manual unless the owner says otherwise');
  assert.deepEqual([a.capacity.hours, a.capacity.budget, a.goals.currency], ['day', null, 'IDR']);
  const p = guide.draftPlan(guide.cleanAnswers(answers));
  assert.deepEqual(p.spaces.map((s) => [s.division, s.blueprint, s.mode, s.autopilot, s.budget]), [['product', 'product', 'supervised', 'balanced', 20], ['engineering', 'software-house', 'supervised', 'balanced', 20], ['marketing', 'digital-marketing', 'automatic', 'full', 20], ['sales', 'sales-crm', 'supervised', 'balanced', 20], ['legal', 'legal', 'manual', 'off', 20]]);
  assert.deepEqual(p.later, []);
  const mkt = p.spaces.find((s) => s.division === 'marketing');
  assert.deepEqual(mkt.kpis.map((k) => [k.id, k.target]), [['organic-traffic', null], ['leads', 50], ['posts', 3], ['engagement', null]], 'the leads goal becomes the target');
  assert.deepEqual(mkt.materials.map((m) => `${m.id}:${m.status}`), ['brand:missing', 'website:have', 'social-accounts:missing', 'analytics:later']);
  assert.deepEqual(mkt.shift, { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '05:00' });
  assert.match(guide.planMarkdown(p), /\| Marketing \| DTamu Marketing \| automatic \| Organic traffic; Leads from the site: 50 leads; Posts published: 3 posts; Engagement rate \|/);
  assert.doesNotMatch(guide.planMarkdown(p), /Later \(no squad yet\)/);
  assert.match(guide.planMarkdown(p), /\| Legal \| DTamu Legal \(Owner only\) \| manual \|/);
  assert.match(guide.materialsMarkdown(mkt), /\| Brand rules .* \| missing: interview the owner/);
});

test('the plan has a rhythm (1.5): the Blueprint routines in the owner\'s hours, and what a target behind raises per mode', () => {
  const p = guide.draftPlan(guide.cleanAnswers(answers));                 // night hours
  const of = (d) => p.spaces.find((s) => s.division === d);
  assert.deepEqual(of('marketing').routines.map((r) => [r.id, r.at, r.on]), [['daily-content-draft', '22:30', true], ['weekly-report', '23:00', true]]);
  assert.deepEqual(of('sales').routines.map((r) => [r.id, r.every, r.at]), [['follow-up-list', 'weekdays', '22:30']], 'moved into the night shift');
  assert.deepEqual(of('legal').routines.map((r) => r.on), [false], 'a manual squad: unticked');
  assert.deepEqual(['marketing', 'sales', 'legal'].map((d) => of(d).kpis[0]?.onBehind), ['act', 'suggest', 'notify'], 'manual -> notify, supervised -> suggest, automatic -> act');
  assert.ok(of('sales').kpis.every((k) => k.onBehind === 'suggest'));
  const day = guide.draftPlan(guide.cleanAnswers({ ...answers, capacity: { ...answers.capacity, hours: 'day' } }));
  assert.deepEqual(day.spaces.find((s) => s.division === 'marketing').routines.map((r) => r.at), ['08:30', '09:00'], 'a day squad does not work at night');
  assert.deepEqual(day.spaces.find((s) => s.division === 'engineering').routines.map((r) => r.at), ['09:00', '10:00'], 'times in the day stay');
  // the owner unticks a routine and a target's trigger; a new mode resets both to what the mode means
  const edited = guide.cleanPlan({ spaces: [{ division: 'marketing', routines: [{ id: 'weekly-report', on: false }], kpis: [{ id: 'engagement', onBehind: 'off' }] }, { division: 'legal', mode: 'supervised' }] }, p);
  assert.deepEqual(edited.spaces.find((s) => s.division === 'marketing').routines.map((r) => r.on), [true, false]);
  assert.equal(edited.spaces.find((s) => s.division === 'marketing').kpis.find((k) => k.id === 'engagement').onBehind, 'off');
  assert.deepEqual(edited.spaces.find((s) => s.division === 'legal').routines.map((r) => r.on), [true]);
  const md = guide.planMarkdown(edited);
  assert.match(md, /## Rhythm/);
  assert.match(md, /\*\*DTamu Marketing\*\* \(when a target is behind: the agents act on it\)\n- Daily content draft: every day at 22:30, by the content-writer\n\n/);
  assert.match(md, /\*\*DTamu Sales\*\* \(when a target is behind: a plan for the owner to approve\)\n- Follow-up list from ERPNext: every weekday at 22:30, by the sales-manager/);
});

test('the Owner answers step by step; the language is saved; others are kept out', async () => {
  assert.equal((await call('GET', '/api/guide')).body.step, 0);
  assert.equal((await call('PUT', '/api/guide', { answers: { language: 'id' }, step: 1 })).status, 200);
  assert.equal(building.loadBuilding().prefs.language, 'id');
  assert.equal((await call('GET', '/api/building')).body.guide.firstRun, true, 'no Spaces yet and not built');
  const st = (await call('PUT', '/api/guide', { answers, step: 7 })).body;
  assert.deepEqual([st.step, st.answers.business.name, st.answers.language, st.plan], [7, 'DTamu', 'id', null]);
  assert.equal((fs.statSync(path.join(config.home, 'guide.json')).mode & 0o777), 0o600);
  const member = (await call('POST', '/api/users', { name: 'Dewi', role: 'member' })).body;
  assert.equal((await call('GET', '/api/guide', null, member.pin)).status, 403);
  assert.equal((await call('PUT', '/api/guide', { answers }, member.pin)).status, 403);
  assert.equal((await call('POST', '/api/guide/build', {}, member.pin)).status, 403);
});

test('Claude Code sharpens the plan when it answers, the defaults stand when it does not', async () => {
  const asked = [];
  guide.deps.ask = async (prompt) => { asked.push(prompt); return { summary: 'DTamu menjual undangan digital; fokus 3 bulan: 50 lead per bulan dari situs.', targets: [{ space: 'marketing', kpi: 'organic-traffic', target: 3000, why: 'lead 50 pada konversi 2 %' }, { space: 'nowhere', kpi: 'x', target: 1, why: '' }], materials: [{ space: 'sales', item: 'Daftar paket undangan dan harga per tier', why: 'sales butuh harga' }] }; };
  const p = (await call('POST', '/api/guide/plan', {})).body;
  assert.match(asked[0], /Business: saas, "DTamu"/); assert.match(asked[0], /Bahasa Indonesia/); assert.match(asked[0], /- marketing \(digital-marketing, automatic\): organic-traffic \[sessions\] = null, leads \[leads\] = 50/);
  assert.equal(p.source, 'claude');
  assert.equal(p.spaces.find((s) => s.division === 'marketing').kpis.find((k) => k.id === 'organic-traffic').target, 3000);
  assert.deepEqual(p.spaces.find((s) => s.division === 'sales').materials.at(-1), { id: 'custom', label: 'Daftar paket undangan dan harga per tier', why: 'sales butuh harga', status: 'missing' });
  assert.match(p.summary, /50 lead per bulan/);
  guide.deps.ask = async () => { throw new Error('offline'); };
  const d = (await call('POST', '/api/guide/plan', {})).body;
  assert.equal(d.source, 'defaults'); assert.equal(d.summary, '');
  guide.deps.ask = async () => ({ summary: 'Ringkasan.', targets: [], materials: [] });
  assert.equal((await call('POST', '/api/guide/plan', {})).body.source, 'claude');
});

test('Build makes the Spaces with targets, shift, budget, materials; the plan reaches the Company Brain and the agents', async () => {
  const r = (await call('POST', '/api/guide/build', { spaces: [{ division: 'engineering', skip: true }, { division: 'marketing', name: 'DTamu Marketing Squad', kpis: [{ id: 'posts', target: 5 }, { id: 'engagement', onBehind: 'off' }], routines: [{ id: 'weekly-report', on: false }], materials: [{ id: 'brand', status: 'have' }] }, { division: 'legal', mode: 'supervised' }] })).body;
  assert.deepEqual(r.built.map((x) => [x.division, !!x.id, x.error || null]), [['product', true, null], ['marketing', true, null], ['sales', true, null], ['legal', true, null]], 'engineering was skipped');
  const mkt = r.built.find((x) => x.division === 'marketing');
  assert.equal(mkt.name, 'DTamu Marketing Squad');
  const f = floors.readFloor(mkt.path);
  assert.deepEqual([f.floor.autopilot, f.floor.budget, f.floor.shift.enabled, f.floor.shift.from], ['full', { usd: 25, period: 'month' }, true, '22:00'], 'the budget is split over the Spaces built');
  assert.deepEqual(kpi.readDefs(mkt.path).map((k) => [k.id, k.target]), [['organic-traffic', null], ['leads', 50], ['posts', 5], ['engagement', null]], 'the owner\'s edit on the plan page');
  // the rhythm (1.5): the routines written off (one "Turn on routines" per Space), the triggers per target
  assert.deepEqual(cadence.readDefs(mkt.path).map((x) => [x.id, x.at, x.enabled]), [['daily-content-draft', '22:30', false]], 'the unticked routine is not there');
  assert.equal(mkt.routines, 1);
  assert.deepEqual(kpi.readDefs(mkt.path).map((k) => k.onBehind.mode), ['act', 'act', 'act', 'off']);
  assert.deepEqual(kpi.readDefs(r.built.find((x) => x.division === 'sales').path).map((k) => k.onBehind.mode), ['suggest', 'suggest', 'suggest']);
  const materials = fs.readFileSync(path.join(mkt.path, 'docs', 'squad', 'MATERIALS.md'), 'utf8');
  assert.match(materials, /\| Brand rules .* \| available: ask the owner where it is \|/);
  assert.match(fs.readFileSync(path.join(mkt.path, kpi.FILE), 'utf8'), /\| Leads from the site \| – \| 50 leads/);
  const legal = r.built.find((x) => x.division === 'legal');
  assert.deepEqual([floors.readFloor(legal.path).floor.access, floors.readFloor(legal.path).floor.autopilot, floors.readFloor(legal.path).floor.shift.enabled], ['owner', 'balanced', true]);
  assert.equal(floors.readFloor(r.built.find((x) => x.division === 'sales').path).floor.shift.enabled, true);
  const plan = fs.readFileSync(path.join(config.home, 'company', 'PLAN.md'), 'utf8');
  assert.match(plan, /^# Company plan/); assert.match(plan, /\| Marketing \| DTamu Marketing Squad \| automatic \|/); assert.doesNotMatch(plan, /\| Engineering \|/);
  // the agents: the plan, the materials, the language
  const agent = fs.readFileSync(path.join(mkt.path, '.claude', 'agents', `${f.team.agents[0].id}.md`), 'utf8');
  assert.match(agent, /The company plan is `.*PLAN\.md`/); assert.match(agent, /docs\/squad\/MATERIALS\.md/); assert.match(agent, /Talk to the owner and the team in Bahasa Indonesia/);
  assert.doesNotMatch(context.contextLines({ kind: 'project', access: 'team' }, '', false, { language: 'en' }).join('\n'), /Bahasa Indonesia/);
  assert.equal(building.loadBuilding().prefs.notify.lang, 'id', 'the bot speaks the owner\'s language too');
  assert.equal(squadLog.read(mkt.id, { type: 'guide.built' }).length, 1);
  const st = (await call('GET', '/api/guide')).body;
  assert.equal(st.done, true); assert.ok(st.builtAt);
  assert.equal((await call('GET', '/api/building')).body.guide.firstRun, false);
  // again: a new answer clears the plan, the Spaces stay, the plan skips what the guide built before (even renamed)
  assert.equal((await call('PUT', '/api/guide', { answers: { divisions: ['marketing', 'engineering'] }, step: 4 })).body.plan, null);
  assert.equal((await call('GET', '/api/building')).body.floors.filter((x) => !x.independent).length, 4);
  const again = (await call('POST', '/api/guide/plan', { useClaude: false })).body;
  assert.deepEqual(again.spaces.map((x) => [x.division, !!x.exists, !!x.skip, x.budget]), [['marketing', true, true, 0], ['engineering', false, false, 100]]);
  assert.equal((await call('POST', '/api/guide/build', { spaces: [{ division: 'engineering', skip: true }] })).status, 400, 'nothing to build');
  assert.equal((await call('GET', '/api/guide')).body.done, true, 'still built');
  const r2 = (await call('POST', '/api/guide/build', {})).body;
  assert.deepEqual(r2.built.map((x) => [x.division, !!x.id]), [['engineering', true]]);
  assert.equal(floors.readFloor(r2.built[0].path).floor.budget.usd, 100);
  const plan2 = fs.readFileSync(path.join(config.home, 'company', 'PLAN.md'), 'utf8');
  for (const row of ['| Marketing | DTamu Marketing Squad | automatic |', '| Engineering | DTamu Engineering | supervised |', '| Legal | DTamu Legal (Owner only) | supervised |', '| Product |']) assert.ok(plan2.includes(row), `${row} stays in the plan`);
  assert.deepEqual((await call('POST', '/api/guide/plan', { useClaude: false })).body.spaces.map((x) => [x.division, !!x.exists]), [['marketing', true], ['engineering', true]]);
  // the language changes: every agent file follows
  await call('PUT', '/api/guide', { answers: { language: 'en' }, step: 1 });
  assert.doesNotMatch(fs.readFileSync(path.join(mkt.path, '.claude', 'agents', `${f.team.agents[0].id}.md`), 'utf8'), /Bahasa Indonesia/);
  assert.equal(building.loadBuilding().prefs.notify.lang, 'en');
});
