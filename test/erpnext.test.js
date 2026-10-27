// SPDX-License-Identifier: Apache-2.0
// ERPNext and the Sales pilot against a fake ERPNext: write-only keys per role, sessions with FAC as an MCP server
// (no secrets in arguments or files), the watcher (new Lead -> Sales, order -> delivery, a submit without approval
// -> alert), and the price approval (only the owner key submits, only the Quotation the Owner saw).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import * as erp from '../server/erpnext.js';
import * as hb from '../server/handoff.js';
import { fakeFrappe } from './fixtures/fake-frappe.js';

const root = scratch({ seed: false });
const SPACES = [
  { id: 'sales', number: 2, name: 'Sales', access: 'owner', root: path.join(root, 'sales'), agents: [{ id: 'rina-sales', lead: true }] },
  { id: 'proj', number: 3, name: 'Delivery', access: 'team', root: path.join(root, 'proj'), agents: [{ id: 'sari-pm', lead: true }] },
];
for (const sp of SPACES) fs.mkdirSync(sp.root, { recursive: true });
const woken = [], owner = [], logs = [];
Object.assign(hb.deps, { spaces: () => SPACES, log: (f, e) => logs.push({ floorId: f, ...e }), wake: async (w) => { woken.push(w); return { ok: true }; }, ownerItem: async (h) => { owner.push(h.id); await erp.prepareApproval(h); } });
const F = fakeFrappe({ users: { ksales: { secret: 'ssales1', user: 'ai.sales@sopwer.id' }, kdel01: { secret: 'sdel001', user: 'ai.delivery@sopwer.id' }, kowner: { secret: 'sowner1', user: 'ramdani@sopwer.id' } }, submitters: ['ramdani@sopwer.id'] });
const url = await F.listen();
after(() => F.server.close());

test('settings and keys: the site only, keys checked and never shown again', async () => {
  assert.throws(() => erp.cleanSettings({ url: 'https://office.sopwer.id/app/lead' }), /the site only/);
  assert.equal(erp.cleanSettings({ url: 'https://office.sopwer.id/', enabled: true }).url, 'https://office.sopwer.id');
  assert.equal(erp.cleanSettings({ enabled: true }).enabled, false, 'no address, not on');
  erp.saveSettings({ url, enabled: true, pollMin: 1, sales: { floorId: 'sales', agentId: 'rina-sales' }, delivery: { floorId: 'proj' } });
  await assert.rejects(erp.setKey('sales', 'ksales', 'wrong-secret'), /ERPNext: Invalid token/);
  await erp.setKey('sales', 'ksales', 'ssales1');
  await erp.setKey('delivery', 'kdel01', 'sdel001');
  const ks = erp.keyStatus();
  assert.deepEqual([ks.sales.set, ks.sales.last4, ks.sales.user], [true, 'ales', 'ai.sales@sopwer.id']);
  assert.equal(ks.owner.set, false);
  assert.ok(!JSON.stringify(erp.status()).includes('ssales1'), 'the status never carries a secret');
  assert.equal((fs.statSync(path.join(config.home, 'secrets.json')).mode & 0o777), 0o600);
});

test('a Space with ERPNext gets FAC as an MCP server: variables, allowed and denied tools', () => {
  assert.equal(erp.sessionFor({ erpnext: 'off' }), null);
  const s = erp.sessionFor({ erpnext: 'sales' });
  assert.deepEqual(s.args, ['--mcp-config', path.join(config.home, 'erpnext', 'mcp.json')]);
  const mcp = fs.readFileSync(s.args[1], 'utf8');
  assert.match(mcp, /\$\{AISQUAD_ERP_URL\}\/api\/method\/frappe_assistant_core\.api\.fac_endpoint\.handle_mcp/);
  assert.match(mcp, /"Authorization": "token \$\{AISQUAD_ERP_KEY\}:\$\{AISQUAD_ERP_SECRET\}"/);
  assert.ok(!mcp.includes('ssales1'), 'no secret in the file');
  assert.deepEqual(s.env, { AISQUAD_ERP_URL: url, AISQUAD_ERP_KEY: 'ksales', AISQUAD_ERP_SECRET: 'ssales1' });
  assert.ok(s.deny.includes('mcp__erpnext__document_action') && s.deny.includes('mcp__erpnext__run_python_code') && s.deny.includes('mcp__erpnext__delete_document'));
  assert.ok(s.allow.includes('mcp__erpnext__create_document') && !s.allow.some((t) => s.deny.includes(t)));
  assert.equal(erp.sessionFor({ erpnext: 'delivery' }).env.AISQUAD_ERP_KEY, 'kdel01');
  assert.match(erp.contextLine('sales'), /never submit it/);
});

let leadHandoff = '';
test('the watcher: it starts where the pipeline is, then a new Lead goes to Sales', async () => {
  F.add('Lead', { name: 'CRM-LEAD-2026-00001', company_name: 'Old Co' });
  const first = await erp.sync();
  assert.equal(first.started, true);
  assert.equal(woken.length, 0, 'old leads are not handed over');
  F.add('Lead', { name: 'CRM-LEAD-2026-00002', company_name: 'Klinik Sehat', source: 'Website', lead_name: 'Budi Santoso', email_id: 'budi@klinik.id' });
  const r = await erp.sync();
  assert.deepEqual(r.leads, ['CRM-LEAD-2026-00002']);
  assert.equal(woken.length, 1); assert.equal(woken[0].floorId, 'sales'); assert.equal(woken[0].agentId, 'rina-sales');
  assert.match(woken[0].prompt, /from ERPNext: lead: New lead CRM-LEAD-2026-00002/);
  assert.match(woken[0].prompt, /Klinik Sehat/);
  assert.doesNotMatch(woken[0].prompt, /budi@klinik|Budi Santoso/, 'contact data stays in ERPNext');
  leadHandoff = erp.loadState().leads['CRM-LEAD-2026-00002'].handoff;
  assert.equal((await erp.sync()).leads.length, 0, 'once');
  assert.equal(await erp.tick(Date.now()), null, 'the tick waits pollMin');
});

test('the price approval: the card shows the Quotation; only the owner key submits it, only as it was shown', async () => {
  F.add('Opportunity', { name: 'CRM-OPP-2026-00001', opportunity_from: 'Lead', party_name: 'CRM-LEAD-2026-00002' });
  F.add('Quotation', { name: 'SAL-QTN-2026-00001', quotation_to: 'Customer', party_name: 'Klinik Sehat', customer_name: 'Klinik Sehat', opportunity: 'CRM-OPP-2026-00001', currency: 'IDR', grand_total: 45000000, discount_amount: 0,
    items: [{ item_code: 'ERP-IMPL', item_name: 'ERPNext implementation', qty: 1, rate: 30000000, amount: 30000000, uom: 'Paket' }, { item_code: 'CLOUD', item_name: 'Sopwer Cloud 12 months', qty: 12, rate: 1250000, amount: 15000000, uom: 'Month' }] });
  const h = await hb.send(SPACES[0], 'rina-sales', { to: 'owner', agent: '', kind: 'quotation', title: 'Klinik Sehat ERP', erpnext: 'Quotation/SAL-QTN-2026-00001', replyTo: '' }, 'Standard price list, no discount.');
  assert.equal(h.status, 'approval');
  const text = erp.approvalText(hb.get(h.id));
  assert.match(text, /Quotation SAL-QTN-2026-00001 for Klinik Sehat: IDR 45,000,000/);
  assert.match(text, /Sopwer Cloud 12 months: 12 × IDR 1,250,000 = IDR 15,000,000/);
  await erp.setKey('owner', 'kowner', 'sowner1');
  // changed after it was shown: the answer to the old card is refused, and the card is read again
  const shown = erp.approvalOf(h.id).modified;
  F.edit('Quotation', 'SAL-QTN-2026-00001', { grand_total: 40000000 });
  await assert.rejects(erp.approve(h.id, { seenModified: shown }), /changed after it was shown/);
  assert.match(erp.approvalText(hb.get(h.id)), /IDR 40,000,000/);
  await assert.rejects(erp.approve(h.id, { seenModified: shown }), /changed after it was shown/, 'the old card stays refused');
  const n = woken.length;
  const r = await erp.approve(h.id, { by: 'Ramdani', seenModified: erp.approvalOf(h.id).modified });
  assert.equal(r.quotation, 'SAL-QTN-2026-00001');
  const q = F.docs.Quotation[0];
  assert.equal(q.docstatus, 1); assert.equal(q.modified_by, 'ramdani@sopwer.id', 'submitted with the owner key');
  assert.ok(F.calls.filter((c) => c.path.endsWith('frappe.client.submit')).every((c) => c.user === 'ramdani@sopwer.id'));
  assert.equal(hb.get(h.id).status, 'approved');
  assert.equal(woken.length, n + 1); assert.match(woken.at(-1).prompt, /approved Quotation SAL-QTN-2026-00001/);
  const p = erp.loadState().pipeline['SAL-QTN-2026-00001'];
  assert.equal(p.lead, 'CRM-LEAD-2026-00002'); assert.equal(typeof p.leadToApprovedH, 'number');
  assert.equal(erp.metrics().approved, 1);
  assert.equal(r.submitted, true);
  assert.equal(hb.get(erp.loadState().leads['CRM-LEAD-2026-00002'].handoff).status, 'done', 'the Lead\'s thread is closed too');
  await assert.rejects(erp.approve(h.id), /not open any more/);
  assert.ok(logs.some((e) => e.type === 'erpnext.approved' && e.data.quotation === 'SAL-QTN-2026-00001' && !('total' in e.data)), 'no amounts in the Squad Log');
});

test('sent back with a note; an order goes to delivery without prices; a submit without approval is an alert', async () => {
  F.add('Quotation', { name: 'SAL-QTN-2026-00002', quotation_to: 'Lead', party_name: 'CRM-LEAD-2026-00002', customer_name: 'Klinik Sehat', currency: 'IDR', grand_total: 9000000, items: [{ item_name: 'Training', qty: 3, rate: 3000000, amount: 9000000 }] });
  const h = await hb.send(SPACES[0], 'rina-sales', { to: 'owner', agent: '', kind: 'quotation', title: 'Training add-on', erpnext: 'Quotation/SAL-QTN-2026-00002', replyTo: '' }, 'Three training days.');
  await assert.rejects(erp.sendBack(h.id, ' '), /what has to change/);
  await erp.sendBack(h.id, 'Two days are enough.');
  assert.equal(hb.get(h.id).status, 'clarify');
  assert.match(woken.at(-1).prompt, /The Owner sent this quotation back/);
  // without the owner key: approved here, the Owner submits it in ERPNext himself
  erp.clearKey('owner');
  F.add('Quotation', { name: 'SAL-QTN-2026-00004', customer_name: 'Apotek Sehat', currency: 'IDR', grand_total: 5000000, items: [{ item_name: 'Support', qty: 1, rate: 5000000, amount: 5000000 }] });
  const h4 = await hb.send(SPACES[0], 'rina-sales', { to: 'owner', agent: '', kind: 'quotation', title: 'Support', erpnext: 'Quotation/SAL-QTN-2026-00004', replyTo: '' }, 'Support package.');
  const r4 = await erp.approve(h4.id, { seenModified: erp.approvalOf(h4.id).modified });
  assert.equal(r4.submitted, false);
  assert.equal(F.docs.Quotation.find((x) => x.name === 'SAL-QTN-2026-00004').docstatus, 0, 'nothing submitted without the owner key');
  assert.match(woken.at(-1).prompt, /the Owner submits it in ERPNext/);
  await erp.setKey('owner', 'kowner', 'sowner1');
  // the first one became an order
  F.edit('Quotation', 'SAL-QTN-2026-00001', { status: 'Ordered', order_type: 'Sales' });
  const r = await erp.sync();
  assert.deepEqual(r.won, ['SAL-QTN-2026-00001']);
  const w = woken.at(-1);
  assert.equal(w.floorId, 'proj'); assert.equal(w.agentId, 'sari-pm');
  assert.match(w.prompt, /ERPNext implementation × 1 Paket/);
  assert.doesNotMatch(w.prompt, /30,?000,?000|1,?250,?000|45,?000,?000|IDR/, 'no prices for the delivery Space');
  // an agent's user submitted a Quotation itself
  F.add('Quotation', { name: 'SAL-QTN-2026-00003', customer_name: 'X', docstatus: 0 });
  F.edit('Quotation', 'SAL-QTN-2026-00003', { docstatus: 1, modified_by: 'ai.sales@sopwer.id' });
  const r2 = await erp.sync();
  assert.deepEqual(r2.alerts, ['SAL-QTN-2026-00003']);
  assert.match(erp.status().alerts[0].text, /without your price approval/);
  erp.dismissAlert(erp.status().alerts[0].id);
  assert.equal(erp.status().alerts.length, 0);
  // a dead site: the error is kept, nothing breaks
  erp.saveSettings({ url: 'http://127.0.0.1:9' });
  erp.saveSettings({ url });
});
