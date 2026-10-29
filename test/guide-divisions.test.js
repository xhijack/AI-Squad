// SPDX-License-Identifier: Apache-2.0
// The Company Guide knows Finance and Support (1.7): the suggestion per business type (Finance when ERPNext is
// there), the plan with their targets, routines and materials, Finance always built Owner-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as building from '../server/building.js';
import * as floors from '../server/floors.js';
import * as guide from '../server/guide.js';
import * as kpi from '../server/kpi.js';
import * as cadence from '../server/cadence.js';

const root = scratch();
building.setPrefs({ squadsDir: path.join(root, 'squads') });
const answers = { language: 'en', business: { type: 'saas', name: 'Kasir', description: 'A POS app for coffee shops' }, goals: { picks: ['service'] }, have: ['erpnext', 'website'], divisions: ['finance', 'support', 'marketing'], capacity: { hours: 'day', budget: 90 } };

test('nothing is "later" any more; Finance and Support are divisions with a Blueprint', () => {
  assert.deepEqual(guide.LATER, []);
  assert.equal(guide.DIVISIONS.finance, 'finance');
  assert.equal(guide.DIVISIONS.support, 'support');
});

test('the suggestion: Support for saas, software house and ERP consultants; Finance wherever ERPNext is', () => {
  for (const type of ['saas', 'software-house', 'erp-consultant']) assert.ok(guide.suggestFor(type, []).includes('support'), type);
  for (const type of ['consultant', 'agency', 'clinic', 'retail', 'other']) assert.ok(!guide.suggestFor(type, []).includes('support'), type);
  for (const type of guide.TYPES) {
    assert.ok(guide.suggestFor(type, ['erpnext']).includes('finance'), `${type} with ERPNext`);
    assert.ok(!guide.suggestFor(type, ['website']).includes('finance'), `${type} without ERPNext`);
  }
  assert.deepEqual(guide.state().suggestIf, { finance: 'erpnext' });
});

test('the plan: Finance Owner-only and manual, Support supervised; their targets, routines and materials', () => {
  const a = guide.cleanAnswers(answers);
  assert.deepEqual(a.modes, { finance: 'manual', support: 'supervised', marketing: 'supervised' });
  const p = guide.draftPlan(a);
  assert.deepEqual(p.later, []);
  const fin = p.spaces.find((s) => s.division === 'finance'), sup = p.spaces.find((s) => s.division === 'support');
  assert.deepEqual([fin.blueprint, fin.access, fin.mode, fin.autopilot, fin.budget], ['finance', 'owner', 'manual', 'off', 30]);
  assert.deepEqual([sup.blueprint, sup.access, sup.mode, sup.budget], ['support', 'team', 'supervised', 30]);
  assert.deepEqual(fin.kpis.map((k) => [k.id, k.target, k.onBehind]), [['overdue-receivables', null, 'notify'], ['cash-in-bank', null, 'notify'], ['days-to-close', 5, 'notify'], ['unreconciled-lines', null, 'notify']]);
  assert.deepEqual(sup.kpis.map((k) => [k.id, k.target, k.requires || '']), [['first-response', 24, 'helpdesk'], ['open-tickets', null, ''], ['resolved', null, ''], ['csat', 90, 'helpdesk']]);
  assert.deepEqual(fin.routines.map((r) => [r.id, r.on]), [['receivables-digest', false], ['monthly-close', false], ['budget-vs-actual', false]], 'a manual squad: unticked');
  assert.deepEqual(sup.routines.map((r) => [r.id, r.at, r.on]), [['morning-triage', '08:00', true], ['weekly-report', '16:00', true], ['kb-gaps', '10:00', true]]);
  assert.deepEqual(fin.materials.map((m) => `${m.id}:${m.status}`), ['erpnext:have', 'finance-key:missing', 'bank-statements:missing', 'finance-policy:missing']);
  assert.deepEqual(sup.materials.map((m) => `${m.id}:${m.status}`), ['ticket-source:missing', 'kb-sources:missing', 'support-policy:missing']);
  const md = guide.planMarkdown(p);
  assert.match(md, /\| Finance \| Kasir Finance \(Owner only\) \| manual \| Overdue receivables; Cash in bank; Days to close the month: 5 days; Unreconciled bank lines \|/);
  assert.match(md, /\| Support \| Kasir Support \| supervised \| First response time: 24 hours; Open tickets; Tickets resolved; Customer satisfaction: 90 % \|/);
  assert.match(md, /\*\*Kasir Support\*\* \(when a target is behind: a plan for the owner to approve\)\n- Morning triage: every weekday at 08:00, by the support-lead/);
  assert.match(guide.materialsMarkdown(fin), /\| A read-only ERPNext finance key .* \| missing: interview the owner/);
});

test('Build: Finance is made Owner-only with the finance key and counts on Telegram; Support is a team Space', async () => {
  guide.answer(answers, 6);
  await guide.plan({ useClaude: false });
  const r = await guide.build({});
  assert.deepEqual(r.built.map((x) => [x.division, !!x.id, x.error || null]), [['finance', true, null], ['support', true, null], ['marketing', true, null]]);
  const fin = floors.readFloor(r.built[0].path).floor, sup = floors.readFloor(r.built[1].path).floor;
  assert.deepEqual([fin.access, fin.erpnext, fin.telegram, fin.autopilot], ['owner', 'finance', 'counts', 'off']);
  assert.deepEqual([sup.access, sup.telegram, sup.autopilot], ['team', 'full', 'balanced']);
  assert.deepEqual(cadence.readDefs(r.built[0].path), [], 'the unticked routines of a manual squad are not made');
  assert.deepEqual(cadence.readDefs(r.built[1].path).map((x) => [x.id, x.enabled]), [['morning-triage', false], ['weekly-report', false], ['kb-gaps', false]], 'made off');
  assert.equal(kpi.readDefs(r.built[1].path).find((k) => k.id === 'csat').target, 90);
  assert.equal(kpi.readDefs(r.built[0].path).find((k) => k.id === 'days-to-close').target, 5);
});
