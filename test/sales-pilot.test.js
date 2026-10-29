// SPDX-License-Identifier: Apache-2.0
// The Sales pilot end to end through the API, with real Spaces, the fake headless Claude and a fake ERPNext:
// a handoff between two Spaces (the receiver woken as a P1 background job, its done reply closing the thread),
// ERPNext as an MCP server for the Spaces that have a role (the key only in the environment), a Lead handed to
// Sales, the price approval on the Owner's desk only (a hard stop on Telegram), a package held when it leaves an
// Owner-only Space.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as squad from '../server/squad.js';
import * as jobs from '../server/jobs.js';
import * as hb from '../server/handoff.js';
import * as notify from '../server/notify.js';
import * as access from '../server/access.js';
import * as squadLog from '../server/log.js';
import { fakeFrappe } from './fixtures/fake-frappe.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = scratch();
const FAKE = path.join(here, 'fixtures', 'fake-claude-stream.cjs');
const LOG = path.join(root, 'fake.log');
configure({ claudeBin: FAKE, useHooks: false, useSystemd: false });
process.env.FAKE_CLAUDE_MODE = 'handoff'; process.env.FAKE_CLAUDE_LOG = LOG;
squad.setResourceReader(() => ({ mem: { available: 12 * 2 ** 30, total: 16 * 2 ** 30 }, cpus: 8, load: [0.2, 0.2, 0.2] }));
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const F = fakeFrappe({ users: { ksales: { secret: 'SALES-SECRET-1', user: 'ai.sales@sopwer.id' }, kdelv1: { secret: 'DELIVERY-SECRET', user: 'ai.delivery@sopwer.id' }, kowner: { secret: 'OWNER-SECRET-1', user: 'ramdani@sopwer.id' } }, submitters: ['ramdani@sopwer.id'] });
const erpUrl = await F.listen();
after(() => { server.close(); F.server.close(); });
const call = async (method, url, body, p = pin) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-aisquad-pin': p }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return fn(); };
// the server's job tick, as index.js runs it
const tickJobs = () => { for (const j of jobs.jobsTick()) squad.logJobEnded(j); };
const ran = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const S = {};

test('three Spaces, ERPNext set up with a key per role', async () => {
  for (const [key, name, tpl, dir] of [['sales', 'Sales', 'sales-manager', 'sales'], ['clinic', 'Clinic ERP', 'project-manager', 'clinic'], ['mkt', 'Marketing', 'marketing-strategist', 'mkt']]) {
    await floors.createFloor({ name, directory: { mode: 'new', path: path.join(root, 'projects', dir) }, team: [{ displayName: `${name} Lead - Lead`, template: tpl }] });
    const e = building.loadBuilding().floors.at(-1);
    S[key] = { id: e.id, root: e.path, agent: floors.readFloor(e.path).team.agents[0].id };
  }
  assert.equal((await call('PATCH', `/api/floors/${S.sales.id}`, { access: 'owner', kind: 'department', erpnext: 'sales' })).status, 200);
  assert.equal((await call('PATCH', `/api/floors/${S.clinic.id}`, { erpnext: 'delivery' })).status, 200);
  assert.equal(floors.readFloor(S.clinic.root).floor.erpnext, 'delivery');
  const st = (await call('PATCH', '/api/erpnext', { url: erpUrl, enabled: true, sales: { floorId: S.sales.id, agentId: S.sales.agent }, delivery: { floorId: S.clinic.id } })).body;
  assert.equal(st.settings.enabled, true);
  for (const [role, key, secret] of [['sales', 'ksales', 'SALES-SECRET-1'], ['delivery', 'kdelv1', 'DELIVERY-SECRET'], ['owner', 'kowner', 'OWNER-SECRET-1']]) {
    const r = await call('PUT', `/api/erpnext/keys/${role}`, { key, secret });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.keys[role].set, true);
  }
  const got = (await call('GET', '/api/erpnext')).body;
  assert.equal(got.keys.owner.user, 'ramdani@sopwer.id');
  assert.ok(!JSON.stringify(got).includes('SECRET'), 'secrets never leave');
  const test1 = (await call('POST', '/api/erpnext/test')).body;
  assert.deepEqual(Object.values(test1).map((x) => x.ok), [true, true, true]);
  // the agent file says how handoffs work, and ERPNext only where the Space has a role
  floors.generate(S.sales.root); floors.generate(S.mkt.root);
  assert.match(fs.readFileSync(path.join(S.sales.root, '.claude', 'agents', `${S.sales.agent}.md`), 'utf8'), /never submit it/);
  const mktFile = fs.readFileSync(path.join(S.mkt.root, '.claude', 'agents', `${S.mkt.agent}.md`), 'utf8');
  assert.match(mktFile, /docs\/squad\/handoffs\/outbox/); assert.doesNotMatch(mktFile, /erpnext/i);
});

test('Marketing hands work to Clinic ERP: the receiver runs as a P1 job with ERPNext, its done reply closes the thread', async () => {
  const out = path.join(S.mkt.root, hb.DIR, 'outbox');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'brief.md'), `---\nto: Clinic ERP\nkind: task\ntitle: Add the webinar sign-up to the clinic portal\nfrom: ${S.mkt.agent}\n---\nThe form fields are in docs/campaigns/webinar.md.\n`);
  const r = (await call('POST', '/api/handoffs/scan')).body;
  assert.equal(r.sent.length, 1); assert.equal(r.sent[0].status, 'delivered');
  const id = r.sent[0].id;
  const job = await until(() => ran().find((x) => x.prompt.startsWith(`Handoff ${id}`)));
  assert.ok(job, 'the receiver was started');
  await until(() => { tickJobs(); return hb.get(id).status === 'done'; });
  assert.equal(hb.get(id).status, 'done', 'the done reply came back');
  const run = ran().find((x) => x.prompt.startsWith(`Handoff ${id}`));
  assert.equal(run.cwd, S.clinic.root);
  assert.ok(run.args.includes('--mcp-config') && run.args.includes('mcp__erpnext__create_document'));
  assert.equal(run.args[run.args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.ok(run.args.includes('mcp__erpnext__document_action'), 'denied');
  assert.equal(run.erpKey, 'kdelv1', 'the delivery key, in the environment');
  assert.ok(!JSON.stringify(run.args).includes('DELIVERY-SECRET'), 'never in the arguments');
  const list = (await call('GET', '/api/handoffs')).body;
  assert.equal(list.metrics.withoutClarification, 100);
  const ev = squadLog.read(S.clinic.id, { type: 'handoff.received' }).at(-1);
  assert.equal(ev.data.from, 'Marketing');
  const q = squadLog.read(S.clinic.id, { type: 'job.started' }).at(-1);
  assert.equal(q.data.kind, 'handoff');
});

test('a new Lead goes to Sales; the price approval is on the Owner\'s desk only and submits with the owner key', async () => {
  F.add('Lead', { name: 'CRM-LEAD-2026-00010', company_name: 'Old' });
  await call('POST', '/api/erpnext/sync');                                    // remembers where the pipeline is
  F.add('Lead', { name: 'CRM-LEAD-2026-00011', company_name: 'Klinik Sehat', source: 'Website' });
  const s = (await call('POST', '/api/erpnext/sync')).body;
  assert.deepEqual(s.leads, ['CRM-LEAD-2026-00011']);
  const leadRun = await until(() => ran().find((x) => x.prompt.includes('New lead CRM-LEAD-2026-00011')));
  assert.equal(leadRun.erpKey, 'ksales');
  // the agent drafted a Quotation and hands it to the Owner
  F.add('Quotation', { name: 'SAL-QTN-2026-00011', quotation_to: 'Lead', party_name: 'CRM-LEAD-2026-00011', customer_name: 'Klinik Sehat', currency: 'IDR', grand_total: 52000000, items: [{ item_name: 'ERPNext implementation', qty: 1, rate: 52000000, amount: 52000000 }] });
  const out = path.join(S.sales.root, hb.DIR, 'outbox');
  fs.writeFileSync(path.join(out, 'qt.md'), `---\nto: owner\nkind: quotation\ntitle: Klinik Sehat ERP\nerpnext: Quotation/SAL-QTN-2026-00011\nfrom: ${S.sales.agent}\n---\nStandard price list.\n`);
  await call('POST', '/api/handoffs/scan');
  const b = (await call('GET', '/api/building')).body;
  const item = b.attention.find((a) => a.kind === 'price');
  assert.ok(item, 'on the Owner\'s desk');
  assert.match(item.text, /Klinik Sehat: IDR 52,000,000/);
  assert.equal(access.redact('/api/building', squad.buildingSnapshot(), { role: 'member' }).attention.some((a) => a.kind === 'price'), false, 'never for anyone else');
  // Telegram: a hard stop (money), only the first line, no dismiss
  const m = notify.messageFor(item, 'tok123');
  assert.match(m.text, /Hard stop: money/); assert.doesNotMatch(m.text, /ERPNext implementation/);
  assert.ok(!m.buttons.flat().some((x) => String(x.data).startsWith('x:')));
  // a Member cannot approve
  const member = (await call('POST', '/api/users', { name: 'Dewi', role: 'member' })).body;
  assert.equal((await call('POST', `/api/attention/${item.id}/answer`, { option: 1 }, member.pin)).status, 403, 'only the Owner');
  const ok = await call('POST', `/api/attention/${item.id}/answer`, { option: 1 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(F.docs.Quotation.at(-1).docstatus, 1); assert.equal(F.docs.Quotation.at(-1).modified_by, 'ramdani@sopwer.id');
  assert.equal((await call('GET', '/api/erpnext')).body.metrics.approved, 1);
});

test('a package leaving the Owner-only Sales Space waits for the Owner', async () => {
  const out = path.join(S.sales.root, hb.DIR, 'outbox');
  fs.writeFileSync(path.join(out, 'proj.md'), `---\nto: Clinic ERP\nkind: project\ntitle: Won: Klinik Sehat\nfrom: ${S.sales.agent}\n---\nScope in Quotation SAL-QTN-2026-00011.\n`);
  const r = (await call('POST', '/api/handoffs/scan')).body;
  assert.equal(r.sent[0].status, 'held');
  const item = (await call('GET', '/api/building')).body.attention.find((a) => a.kind === 'handoff' && a.mode === 'held');
  assert.ok(item);
  assert.equal((await call('POST', `/api/attention/${item.id}/answer`, { option: 0 })).status, 400, 'deliver it or not');
  assert.equal((await call('POST', `/api/attention/${item.id}/answer`, { option: 1 })).status, 200);
  assert.equal(hb.get(r.sent[0].id).status, 'delivered');
  assert.ok(fs.existsSync(path.join(S.clinic.root, hb.DIR, 'inbox', `${r.sent[0].id}.md`)));
  // members see the list without the Owner-only Space
  const member = (await call('POST', '/api/users', { name: 'Mira', role: 'member' })).body;
  const seen = (await call('GET', '/api/handoffs', null, member.pin)).body.handoffs;
  assert.ok(seen.length >= 1 && seen.every((h) => h.from.floorId !== S.sales.id && h.to.floorId !== S.sales.id));
  assert.equal((await call('GET', '/api/erpnext', null, member.pin)).status, 403);
  await until(() => { tickJobs(); return jobs.runningJobs().length === 0; });
});
