// SPDX-License-Identifier: Apache-2.0
// Sprint 11 through the API: a Legal squad becomes an Owner-only department with the locked templates in the
// Company Brain, a contract READY FOR REVIEW is a card only the Owner sees and approves; Marketing works nights;
// model tiering runs a routine handoff on the light model.
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
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import * as jobs from '../server/jobs.js';
import * as hb from '../server/handoff.js';
import * as access from '../server/access.js';
import * as notify from '../server/notify.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = scratch();
const LOG = path.join(root, 'fake.log');
configure({ claudeBin: path.join(here, 'fixtures', 'fake-claude-stream.cjs'), useHooks: false, useSystemd: false });
process.env.FAKE_CLAUDE_LOG = LOG; delete process.env.FAKE_CLAUDE_MODE;
squad.setResourceReader(() => ({ mem: { available: 12 * 2 ** 30, total: 16 * 2 ** 30 }, cpus: 8, load: [0.2, 0.2, 0.2] }));
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const call = async (method, url, body, p = pin) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-aisquad-pin': p }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return fn(); };
const ran = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
let L = null, M = null;

test('a Legal squad is an Owner-only department with the locked templates; Marketing works nights', async () => {
  const made = await call('POST', '/api/squads', { blueprint: 'legal', name: 'Legal', directory: { mode: 'new', path: path.join(root, 'legal') }, team: [{ template: 'legal-counsel', displayName: 'Lia - Legal Counsel' }, { template: 'contract-drafter', displayName: 'Dimas - Contract Drafter' }] });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  L = { id: made.body.id, root: made.body.path };
  const f = floors.readFloor(L.root).floor;
  assert.deepEqual([f.access, f.kind], ['owner', 'department']);
  assert.ok(fs.existsSync(path.join(L.root, 'docs', 'LEGAL-POLICY.md')) && fs.existsSync(path.join(L.root, 'contracts', 'README.md')));
  assert.ok(fs.existsSync(path.join(config.home, 'company', 'legal', 'templates', 'service-agreement.md')), 'the templates are in the Company Brain');
  const mk = await call('POST', '/api/squads', { blueprint: 'digital-marketing', name: 'Marketing', directory: { mode: 'new', path: path.join(root, 'mkt') }, team: [{ template: 'marketing-strategist', displayName: 'Mira - Strategist' }, { template: 'lead-researcher', displayName: 'Rio - Researcher' }] });
  assert.equal(mk.status, 200, JSON.stringify(mk.body));
  M = { id: mk.body.id, root: mk.body.path, agents: floors.readFloor(mk.body.path).team.agents };
  assert.deepEqual(floors.readFloor(M.root).floor.shift, { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '05:00' });
});

test('a contract READY FOR REVIEW is on the Owner\'s desk only; approve, and an agent cannot approve it', async () => {
  const f = path.join(L.root, 'contracts', '2026-10-klinik-nda.md');
  fs.writeFileSync(f, '# NDA Klinik Sehat\n\nSTATUS: READY FOR REVIEW\nApproved by the owner on:\n\nPasal 1\n\n## Legal checklist\n- [x] Agreement\n');
  const item = (await call('GET', '/api/building')).body.attention.find((a) => a.kind === 'contract');
  assert.ok(item, 'on the desk');
  assert.equal(access.redact('/api/building', squad.buildingSnapshot(), { role: 'member' }).attention.some((a) => a.kind === 'contract'), false);
  const m = notify.messageFor(item, 'tok');
  assert.match(m.text, /Hard stop: legal/); assert.doesNotMatch(m.text, /Legal checklist/);
  const text = (await call('GET', `/api/legal/contract?key=${encodeURIComponent(item.contractKey)}`)).body;
  assert.match(text.text, /# NDA Klinik Sehat/);
  assert.equal((await call('POST', `/api/attention/${item.id}/answer`, { option: 1 })).status, 200);
  assert.match(fs.readFileSync(f, 'utf8'), /STATUS: APPROVED\nApproved by the owner on: \d{4}-\d\d-\d\d/);
  // an agent marks another one APPROVED: the next tick puts it back
  const g = path.join(L.root, 'contracts', '2026-10-klinik-sow.md');
  fs.writeFileSync(g, '# SOW\n\nSTATUS: APPROVED\n\nScope\n');
  const t = await squad.handoffTick();
  assert.equal(t.reverted.length, 1);
  assert.match(fs.readFileSync(g, 'utf8'), /STATUS: DRAFT/);
  const lg = (await call('GET', '/api/legal')).body;
  assert.deepEqual([lg.metrics.approved, lg.metrics.draft, lg.alerts.length], [1, 1, 1]);
  const member = (await call('POST', '/api/users', { name: 'Dewi', role: 'member' })).body;
  assert.equal((await call('GET', '/api/legal', null, member.pin)).status, 403);
});

test('model tiering: a routine handoff for a light role runs on haiku, the cost is compared', async () => {
  assert.equal((await call('PATCH', '/api/tiering', { enabled: true })).status, 200);
  const rio = M.agents.find((a) => a.role.template === 'lead-researcher');
  const sys = { id: hb.SYSTEM, name: 'ERPNext' };
  const r = await hb.send(sys, '', { to: M.id, agent: rio.id, kind: 'lead', title: 'New lead CRM-LEAD-1', erpnext: 'Lead/CRM-LEAD-1', replyTo: '' }, 'Qualify it.');
  // Marketing works at night: the handoff may wait for the shift; start it now for the test
  if (r.queued) await call('POST', `/api/dispatcher/queue/${r.queued.id}/start`, {});
  const run = await until(() => ran().find((x) => x.prompt.startsWith(`Handoff ${r.id}`)));
  assert.ok(run, 'the job ran');
  assert.equal(run.args[run.args.indexOf('--model') + 1], 'haiku');
  await until(() => { for (const j of jobs.jobsTick()) squad.logJobEnded(j); return !jobs.runningJobs().length; });
  const j = jobs.listJobs({ floorId: M.id }).find((x) => x.prompt.startsWith(`Handoff ${r.id}`));
  assert.equal(j.tier, 'light');
  const st = (await call('GET', '/api/tiering')).body;
  assert.equal(st.settings.enabled, true); assert.ok(st.settings.since > 0); assert.equal(st.stats.after.jobs, 1);
});
