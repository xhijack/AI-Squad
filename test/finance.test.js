// SPDX-License-Identifier: Apache-2.0
// The Finance Blueprint (1.7): an Owner-only department with a read-only ERPNext key, hard stops in its role files,
// targets and routines seeded off, and only counts on Telegram.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as bp from '../server/blueprints.js';
import * as building from '../server/building.js';
import * as floors from '../server/floors.js';
import * as space from '../server/space.js';
import * as erp from '../server/erpnext.js';
import * as kpi from '../server/kpi.js';
import * as cadence from '../server/cadence.js';
import * as notify from '../server/notify.js';
import { listTemplates } from '../server/roles.js';
import { createSquad } from '../server/setup.js';
import { fakeFrappe } from './fixtures/fake-frappe.js';

const root = scratch();
building.setPrefs({ squadsDir: path.join(root, 'squads') });
const F = fakeFrappe({ users: { kfin01: { secret: 'sfin001', user: 'ai.finance@sopwer.id' }, ksales: { secret: 'ssales1', user: 'ai.sales@sopwer.id' }, kowner: { secret: 'sowner1', user: 'ramdani@sopwer.id' } } });
const url = await F.listen();
after(() => F.server.close());
const HARD = [/no payments/i, /no (posting, )?submitting or cancelling ERPNext documents/i, /no tax filing/i, /no invoices or reminders to customers/i, /Salary data never leaves this Space/i];

test('the Blueprint: Owner-only department, the finance key, counts on Telegram, roles and hard stops', () => {
  const b = bp.getBlueprint('finance');
  assert.deepEqual(b.space, { kind: 'department', access: 'owner', erpnext: 'finance', telegram: 'counts' });
  assert.equal(b.lead, 'finance-controller');
  assert.deepEqual(b.roles.map((r) => [r.template, r.min, r.default]), [['finance-controller', 1, 1], ['bookkeeper', 0, 1]]);
  assert.deepEqual(b.ownerOnly, ['payments', 'submitting or cancelling ERPNext documents', 'tax filing', 'invoices and reminders to customers', 'salaries']);
  assert.deepEqual(b.sourceDocs.map((d) => d.path), ['docs/FINANCE-POLICY.md']);
  for (const role of ['finance-controller', 'bookkeeper']) {
    const t = listTemplates().find((x) => x.role === role);
    assert.equal(t.category, 'finance');
    const rules = t.rules.join('\n');
    for (const re of HARD) assert.match(rules, re, `${role}: ${re}`);
    for (const tool of ['Bash', 'WebFetch', 'mcp__erpnext__create_document', 'mcp__erpnext__update_document', 'mcp__erpnext__document_action', 'mcp__erpnext__send_email']) assert.ok(t.permissions.deny.includes(tool), `${role} denies ${tool}`);
  }
  // targets (no goals) and routines (off)
  assert.deepEqual(b.kpis.map((k) => [k.id, k.source.kind]), [['overdue-receivables', 'erpnext'], ['cash-in-bank', 'manual'], ['days-to-close', 'manual'], ['unreconciled-lines', 'erpnext']]);
  assert.deepEqual(b.cadence.map((r) => [r.id, r.every]), [['receivables-digest', 'weekdays'], ['monthly-close', 'monthly:1'], ['budget-vs-actual', 'weekly:mon']]);
  for (const r of b.cadence) { assert.equal(cadence.cleanRoutine(r).enabled, false); assert.match(r.task, /send nothing|post, submit and pay nothing|read only/i); }
});

test('a team Space never gets the finance key', () => {
  assert.equal(space.cleanSpace({ erpnext: 'finance' }).erpnext, 'off');
  assert.equal(space.cleanSpace({ erpnext: 'finance', access: 'owner' }).erpnext, 'finance');
  assert.equal(space.cleanSpace({ telegram: 'counts' }).telegram, 'counts');
  assert.equal(space.cleanSpace({}).telegram, 'full');
});

let fin;
test('Set up: the Space is built Owner-only with the finance key, targets without goals and routines off', async () => {
  fin = await createSquad({ blueprint: 'finance', name: 'Sopwer Finance', team: [{ template: 'finance-controller', displayName: 'Fina - Controller', lead: true }, { template: 'bookkeeper', displayName: 'Budi - Bookkeeper' }] });
  const f = floors.readFloor(fin.path).floor;
  assert.deepEqual([f.access, f.kind, f.erpnext, f.telegram], ['owner', 'department', 'finance', 'counts']);
  const ks = kpi.readDefs(fin.path);
  assert.deepEqual(ks.map((k) => [k.id, k.target, k.source.kind, k.period]), [['overdue-receivables', null, 'erpnext', 'total'], ['cash-in-bank', null, 'manual', 'total'], ['days-to-close', null, 'manual', 'month'], ['unreconciled-lines', null, 'erpnext', 'total']]);
  assert.ok(cadence.readDefs(fin.path).every((r) => !r.enabled));
  assert.equal(cadence.readDefs(fin.path).length, 3);
  assert.match(fs.readFileSync(path.join(fin.path, 'docs', 'FINANCE-POLICY.md'), 'utf8'), /^STATUS: DRAFT$/m);
  const agent = fs.readFileSync(path.join(fin.path, '.claude', 'agents', 'fina-controller.md'), 'utf8');
  assert.match(agent, /Hard stop: no payments/);
});

test('the finance key: read-only tools, it measures the Owner-only Space first, never a team Space', async () => {
  erp.saveSettings({ url, enabled: false });
  await erp.setKey('owner', 'kowner', 'sowner1');
  await erp.setKey('sales', 'ksales', 'ssales1');
  assert.equal(erp.measureRole({ access: 'owner', erpnext: 'finance' }), 'owner', 'no finance key yet: the Owner\'s');
  await erp.setKey('finance', 'kfin01', 'sfin001');
  assert.equal(erp.keyStatus().finance.user, 'ai.finance@sopwer.id');
  assert.equal(erp.measureRole({ access: 'owner', erpnext: 'finance' }), 'finance');
  assert.equal(erp.measureRole({ access: 'team', erpnext: 'finance' }), 'sales', 'a team Space falls back to its own kind of key');
  assert.equal(erp.sessionFor({ erpnext: 'finance', access: 'team' }), null);
  const s = erp.sessionFor({ erpnext: 'finance', access: 'owner' });
  assert.equal(s.env.AISQUAD_ERP_KEY, 'kfin01');
  for (const w of ['create_document', 'update_document', 'document_action', 'send_email']) { assert.ok(s.deny.includes(`mcp__erpnext__${w}`)); assert.ok(!s.allow.includes(`mcp__erpnext__${w}`)); }
  assert.ok(s.allow.includes('mcp__erpnext__list_documents') && s.allow.includes('mcp__erpnext__generate_report'));
  assert.match(erp.contextLine('finance'), /You read only/);
  // the seeded targets measure with the finance key
  F.add('Sales Invoice', { name: 'SINV-1', docstatus: 1, status: 'Overdue', outstanding_amount: 1500000 });
  F.add('Sales Invoice', { name: 'SINV-2', docstatus: 1, status: 'Overdue and Discounted', outstanding_amount: 500000 });
  F.add('Sales Invoice', { name: 'SINV-3', docstatus: 1, status: 'Unpaid', outstanding_amount: 9000000 });
  F.add('Bank Transaction', { name: 'BT-1', docstatus: 1, status: 'Unreconciled' });
  F.add('Bank Transaction', { name: 'BT-2', docstatus: 1, status: 'Reconciled' });
  const n = F.calls.length;
  assert.equal((await kpi.measure(fin.id, fin.path, 'overdue-receivables')).value, 2000000);
  assert.equal((await kpi.measure(fin.id, fin.path, 'unreconciled-lines')).value, 1);
  assert.ok(F.calls.slice(n).every((c) => c.user === 'ai.finance@sopwer.id'));
});

test('Telegram: only counts leave the Finance Space', () => {
  const item = { id: 'f1', kind: 'question', floorId: fin.id, floorName: 'Sopwer Finance', agentName: 'Fina - Controller', text: 'Send the reminder to PT Maju for Rp 1.500.000?', options: [{ n: 1, label: 'Yes' }] };
  const m = notify.messageFor(item, 'tok', notify.cleanNotify({ publicUrl: 'https://squad.sopwer.id' }));
  assert.doesNotMatch(m.text, /PT Maju|1\.500\.000|Fina -/);
  assert.match(m.text, /^\[Question\] Sopwer Finance\n1 item\(s\) from an Owner-only Space wait for you/);
  assert.deepEqual(m.buttons.flat().map((b) => b.text), ['Open'], 'no answer from Telegram');
  const owner = { id: 'owner', role: 'owner', name: 'Owner' };
  const d = notify.digestFor(owner, { items: [item, { id: 'x', kind: 'finished', floorId: 'other', floorName: 'POS', text: 'Done' }], now: Date.now(), lang: 'en' });
  assert.match(d, /Waiting for you \(2\):\n- POS: Done\n- 1 item\(s\) from an Owner-only Space/);
  assert.doesNotMatch(d, /PT Maju/);
  const id = notify.digestFor(owner, { items: [item], now: Date.now(), lang: 'id' });
  assert.match(id, /1 hal dari Space khusus Owner menunggumu/);
});
