// SPDX-License-Identifier: Apache-2.0
// Targets (1.3): definitions, status, periods, manual and ERPNext and CSV and webhook values, the agents' KPI.md,
// the cockpit across Spaces, the Blueprint seeds, the digest, who may change what.
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
import * as kpi from '../server/kpi.js';
import * as erp from '../server/erpnext.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';
import * as notify from '../server/notify.js';
import * as history from '../server/history.js';
import { fakeFrappe } from './fixtures/fake-frappe.js';

const root = scratch();
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const F = fakeFrappe({ users: { kowner: { secret: 'sowner1', user: 'ramdani@sopwer.id' }, ksales: { secret: 'ssales1', user: 'sales-bot@sopwer.id' } } });
const erpUrl = await F.listen();
after(() => { server.close(); F.server.close(); });
const call = async (method, url, body, p = pin) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(p ? { 'x-aisquad-pin': p } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
let M = null;

test('status and periods', () => {
  const up = { target: 100, direction: 'up' }, down = { target: 2, direction: 'down' };
  assert.deepEqual(kpi.statusOf(up, 120), { state: 'met', pct: 120 });
  assert.deepEqual(kpi.statusOf(up, 40), { state: 'behind', pct: 40 });
  assert.deepEqual(kpi.statusOf(down, 1.5), { state: 'met', pct: 133 });
  assert.deepEqual(kpi.statusOf(down, 4), { state: 'behind', pct: 50 });
  assert.equal(kpi.statusOf({ target: null }, 5).state, 'unset');
  assert.equal(kpi.statusOf(up, null).state, 'unknown');
  const now = new Date(2026, 9, 28, 15, 30).getTime();                     // Wednesday 28 Oct 2026
  assert.equal(new Date(kpi.periodStart('day', now)).getHours(), 0);
  assert.equal(new Date(kpi.periodStart('week', now)).getDate(), 26, 'Monday');
  assert.equal(new Date(kpi.periodStart('month', now)).getDate(), 1);
  assert.equal(kpi.periodStart('total', now), 0);
  assert.throws(() => kpi.cleanKpi({ name: 'x', target: 'ten' }), /must be a number/);
  assert.throws(() => kpi.cleanSource({ kind: 'csv', path: '../etc/passwd.csv' }), /inside the repository/);
  assert.throws(() => kpi.cleanSource({ kind: 'erpnext', doctype: 'Lead', aggregate: 'sum' }), /field to sum/);
  assert.equal(kpi.cleanKpi({ name: 'x', period: 'day', every: 'week' }).every, 'hour', 'measured at least once per period');
});

test('a Marketing squad starts with the Blueprint targets; the Owner sets goals and enters values; agents read KPI.md', async () => {
  const made = await call('POST', '/api/squads', { blueprint: 'digital-marketing', name: 'DTamu Marketing', directory: { mode: 'new', path: path.join(root, 'mkt') }, team: [{ template: 'marketing-strategist', displayName: 'Mira - Strategist' }] });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  M = { id: made.body.id, root: made.body.path };
  assert.match(fs.readFileSync(path.join(M.root, kpi.FILE), 'utf8'), /\| Leads from the site \| – \| not set/, 'KPI.md is there from the start');
  assert.equal((await import('node:child_process')).execSync('git status --porcelain', { cwd: M.root, encoding: 'utf8' }).trim(), '', 'and in the first commit');
  const list = (await call('GET', `/api/floors/${M.id}/kpis`)).body;
  assert.deepEqual(list.kpis.map((k) => [k.id, k.status.state]), [['organic-traffic', 'unset'], ['leads', 'unset'], ['posts', 'unset'], ['engagement', 'unset']]);
  assert.match(list.hook, /^\/api\/kpi\/hook\/[0-9a-f]{32}$/, 'the Owner sees the webhook');
  // goals
  assert.equal((await call('PATCH', `/api/floors/${M.id}/kpis/leads`, { target: 50 })).status, 200);
  assert.equal((await call('PATCH', `/api/floors/${M.id}/kpis/posts`, { target: 10, period: 'week', source: { kind: 'webhook' } })).status, 200);
  assert.equal(history.list({ floorId: M.id })[0].label, 'Target changed', 'in the change history');
  // a value by hand
  const v = (await call('POST', `/api/floors/${M.id}/kpis/leads/values`, { value: 31, note: 'from GA4' })).body;
  assert.deepEqual([v.value, v.status.state, v.status.pct], [31, 'behind', 62]);
  const md = fs.readFileSync(path.join(M.root, kpi.FILE), 'utf8');
  assert.match(md, /\| Leads from the site \| 31 leads \| 50 leads \(at least, this month\) \| behind \(62 %\) \| manual \|/);
  assert.match(md, /\| Posts published \| – \| 10 posts \(at least, this week\) \| unknown \| webhook \| never \|/);
  assert.match(md, /\| Organic traffic \(GA4 organic sessions; a CSV or GA4 integration can feed it\) \|/, 'the note sits in the cell');
  floors.generate(M.root);
  assert.match(fs.readFileSync(path.join(M.root, '.claude', 'agents', floors.readFloor(M.root).team.agents[0].id + '.md'), 'utf8'), /docs\/squad\/KPI\.md/);
  const ev = squadLog.read(M.id, { type: 'kpi.measured' }).at(-1);
  assert.deepEqual([ev.data.kpi, ev.data.value, ev.data.state, ev.data.source], ['leads', 31, 'behind', 'manual']);
  assert.match(ev.summary, /target Leads from the site: 31 leads \(behind, goal 50, manual\)/);
  // a webhook from outside, no PIN: only a webhook target, only a number
  const hook = (await call('POST', list.hook, { kpi: 'posts', value: 7 }, '')).body;
  assert.equal(hook.status.state, 'behind');
  assert.equal((await call('POST', '/api/kpi/hook/' + '0'.repeat(32), { kpi: 'posts', value: 7 }, '')).status, 401);
  for (const body of [{ kpi: 'posts', value: null }, { kpi: 'posts', value: '' }, { kpi: 'posts', value: true }, { kpi: 'posts' }, { kpi: 7, value: 1 }, [1], 'x', null]) assert.equal((await call('POST', list.hook, body, '')).status, 400, JSON.stringify(body));
  assert.match((await call('POST', list.hook, { kpi: 'leads', value: 99 }, '')).body.error, /not a webhook target/);
  assert.equal(squadLog.read(M.id, { type: 'kpi.measured' }).filter((e) => e.data.kpi === 'posts').length, 1);
  // a new address when the old one leaked: the old one stops at once
  const renewed = (await call('POST', `/api/floors/${M.id}/kpis/hook`, {})).body.hook;
  assert.notEqual(renewed, list.hook); assert.equal((await call('POST', list.hook, { kpi: 'posts', value: 8 }, '')).status, 401);
  assert.equal((await call('POST', renewed, { kpi: 'posts', value: 8 }, '')).status, 200);
  // a member may enter values, not change goals; a viewer neither
  const member = (await call('POST', '/api/users', { name: 'Dewi', role: 'member' })).body;
  const viewer = (await call('POST', '/api/users', { name: 'Vino', role: 'viewer' })).body;
  assert.equal((await call('POST', `/api/floors/${M.id}/kpis/leads/values`, { value: 33 }, member.pin)).status, 200);
  assert.equal((await call('PATCH', `/api/floors/${M.id}/kpis/leads`, { target: 10 }, member.pin)).status, 403);
  assert.equal((await call('POST', `/api/floors/${M.id}/kpis/leads/values`, { value: 1 }, viewer.pin)).status, 403);
  assert.equal((await call('GET', `/api/floors/${M.id}/kpis`, null, member.pin)).body.hook, undefined, 'the webhook is the Owner\'s');
  assert.equal((await call('POST', `/api/floors/${M.id}/kpis/hook`, {}, member.pin)).status, 403);
  M.member = member;
  // add, remove
  const added = await call('POST', `/api/floors/${M.id}/kpis`, { name: 'Newsletter subscribers', unit: 'people', target: 500, period: 'total' });
  assert.equal(added.body.id, 'newsletter-subscribers');
  assert.equal((await call('POST', `/api/floors/${M.id}/kpis`, { name: 'Newsletter subscribers' })).status, 400, 'ids are unique');
  assert.equal((await call('DELETE', `/api/floors/${M.id}/kpis/engagement`)).status, 200);
});

test('ERPNext and CSV targets are measured by the server on their interval', async () => {
  erp.saveSettings({ url: erpUrl, enabled: false });
  await erp.setKey('owner', 'kowner', 'sowner1');
  F.add('Lead', { name: 'CRM-LEAD-1', creation: '2020-01-01 10:00:00' });
  F.add('Lead', { name: 'CRM-LEAD-2' }); F.add('Lead', { name: 'CRM-LEAD-3' });
  F.add('Quotation', { name: 'SAL-QTN-1', status: 'Ordered', grand_total: 1000 }); F.add('Quotation', { name: 'SAL-QTN-2', status: 'Ordered', grand_total: 250.5 }); F.add('Quotation', { name: 'SAL-QTN-3', status: 'Open', grand_total: 99 });
  await call('POST', `/api/floors/${M.id}/kpis`, { name: 'Leads in ERPNext', unit: 'leads', target: 5, period: 'month', every: 'hour', source: { kind: 'erpnext', doctype: 'Lead', aggregate: 'count' } });
  await call('POST', `/api/floors/${M.id}/kpis`, { name: 'Revenue ordered', unit: 'IDR', target: 2000, period: 'total', source: { kind: 'erpnext', doctype: 'Quotation', filters: [['status', '=', 'Ordered']], aggregate: 'sum', field: 'grand_total' } });
  fs.mkdirSync(path.join(M.root, 'docs', 'kpi'), { recursive: true });
  fs.writeFileSync(path.join(M.root, 'docs', 'kpi', 'traffic.csv'), 'date,sessions\n2026-10-01,1200\n2026-10-15,1500\n');
  await call('POST', `/api/floors/${M.id}/kpis`, { name: 'Sessions', unit: 'sessions', target: 2000, period: 'total', source: { kind: 'csv', path: 'docs/kpi/traffic.csv', column: 'sessions', aggregate: 'sum' } });
  // a team Space never measures with the Owner's key
  const noKey = await squad.kpiTick();
  assert.match(noKey.find((x) => x.kpi === 'leads-in-erpnext').error, /sales or delivery key/);
  assert.equal(squadLog.read(M.id, { type: 'kpi.failed' }).length, 2);
  assert.match((await call('GET', `/api/floors/${M.id}/kpis`)).body.kpis.find((k) => k.id === 'leads-in-erpnext').error.error, /sales or delivery key/);
  await erp.setKey('sales', 'ksales', 'ssales1');
  const r = await squad.kpiTick();
  const byId = Object.fromEntries(r.map((x) => [x.kpi, x]));
  assert.equal(byId['leads-in-erpnext'].value, 2, 'this month only: the 2020 lead is out');
  assert.ok(F.calls.filter((c) => c.path.startsWith('/api/resource/Lead')).every((c) => c.user === 'sales-bot@sopwer.id'), 'with the sales key');
  assert.equal((await call('GET', `/api/floors/${M.id}/kpis`)).body.kpis.find((k) => k.id === 'leads-in-erpnext').error, undefined, 'the failure is over');
  assert.equal(byId['revenue-ordered'].value, 1250.5);
  assert.equal(noKey.find((x) => x.kpi === 'sessions').value, 2700, 'the CSV needs no key');
  assert.equal((await squad.kpiTick()).filter((x) => !x.error).length, 0, 'not again within the interval');
  await call('PATCH', `/api/floors/${M.id}/kpis/leads-in-erpnext`, { period: 'day', every: 'day' });
  const tomorrow = kpi.periodStart('day') + 864e5 + 60e3;
  assert.deepEqual((await kpi.tick(tomorrow)).map((x) => x.kpi), ['leads-in-erpnext'], 'measured again when a new period starts, whatever the interval');
  assert.equal((await call('POST', `/api/floors/${M.id}/kpis/leads-in-erpnext/values`, { value: 999 }, M.member.pin)).status, 400, 'a measured target takes no values by hand');
  assert.equal((await call('POST', `/api/floors/${M.id}/kpis/leads-in-erpnext/measure`, {}, M.member.pin)).status, 200);
  const now = (await call('POST', `/api/floors/${M.id}/kpis/sessions/measure`, {})).body;
  assert.equal(now.status.state, 'met');
  const o = (await call('GET', '/api/kpis')).body;
  const sp = o.spaces.find((s) => s.id === M.id);
  assert.deepEqual([o.total, sp.met, sp.behind, sp.unset, sp.unknown], [7, 1, 4, 1, 1]);
  const b = (await call('GET', '/api/building')).body;
  assert.deepEqual(b.targets, { total: 7, met: 1, behind: 4, unset: 1, acting: 0 });
  const digest = notify.digestFor({ id: 'owner', name: 'Owner', role: 'owner' }, { items: [] });
  assert.match(digest, /Targets: 1 of 7 met, 4 behind, 1 without a goal\./);
  assert.match(digest, /DTamu Marketing · Leads in ERPNext: 2 of 5 leads/);
});

test('Owner-only Spaces are left out of the cockpit for others; the Space\'s KPI.md goes when the targets go', async () => {
  await call('PATCH', `/api/floors/${M.id}`, { access: 'owner' });
  const member = (await call('POST', '/api/users', { name: 'Rudi', role: 'member' })).body;
  const o = (await call('GET', '/api/kpis', null, member.pin)).body;
  assert.equal(o.spaces.length, 0); assert.equal(o.total, 0);
  assert.equal((await call('GET', `/api/floors/${M.id}/kpis`, null, member.pin)).status, 404);
  assert.deepEqual((await call('GET', '/api/building', null, member.pin)).body.targets, { total: 0, met: 0, behind: 0, unset: 0, acting: 0 }, 'not even the counts');
  assert.equal((await call('GET', '/api/building')).body.targets.total, 7);
  await call('PATCH', `/api/floors/${M.id}`, { access: 'team' });
  // a values file that is not JSON: nothing is wiped, the Owner is told
  const vf = path.join(config.home, 'kpi', `${M.id}.json`), keep = fs.readFileSync(vf, 'utf8');
  fs.writeFileSync(vf, '{broken');
  const broken = (await call('GET', `/api/floors/${M.id}/kpis`)).body;
  assert.equal(broken.hook, null); assert.ok(broken.kpis.every((k) => k.unreadable && !k.latest));
  assert.match((await call('POST', `/api/floors/${M.id}/kpis/leads/values`, { value: 1 })).body.error, /not valid JSON/);
  assert.equal(fs.readFileSync(vf, 'utf8'), '{broken', 'left as it is');
  fs.writeFileSync(vf, keep);
  assert.equal((await call('GET', `/api/floors/${M.id}/kpis`)).body.kpis.find((k) => k.id === 'leads').latest.value, 33);
  // a hand edit that is not a target stays in kpi.json
  const df = path.join(M.root, '.claude', 'aisquad', 'kpi.json');
  fs.writeFileSync(df, JSON.stringify({ kpis: [...JSON.parse(fs.readFileSync(df, 'utf8')).kpis, { name: 'Broken | one', target: '50 leads' }] }));
  await call('POST', `/api/floors/${M.id}/kpis`, { name: 'Pipe | name', unit: 'a|b', target: 1 });
  assert.ok(JSON.parse(fs.readFileSync(df, 'utf8')).kpis.some((k) => k.target === '50 leads'), 'kept');
  assert.match(fs.readFileSync(path.join(M.root, kpi.FILE), 'utf8'), /\| Pipe \/ name \| – \| 1 a\/b \(at least/);
  for (const k of kpi.readDefs(M.root)) kpi.removeKpi(M.root, k.id);
  kpi.render(M.root, M.id);
  assert.ok(!fs.existsSync(path.join(M.root, kpi.FILE)));
  assert.equal((fs.statSync(path.join(config.home, 'kpi', `${M.id}.json`)).mode & 0o777), 0o600);
});
