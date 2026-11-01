// SPDX-License-Identifier: Apache-2.0
// Targets from Google (1.8), without network: the fake Google endpoints, an injected clock and a key made here. The
// source is checked when it is saved (read calls only, bounded arguments), measured on the hourly tick with
// {{from}}/{{to}} of the period and Search Console's lag (its period ends at today − 2, and early in a period there is
// nothing to measure yet), logged with the call and the property (never the key or the arguments), shown in KPI.md,
// and a target behind its goal raises the when-behind rule. Edit the source switches a target to Google in place.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as kpi from '../server/kpi.js';
import * as g from '../server/google.js';
import * as behind from '../server/behind.js';
import * as squadLog from '../server/log.js';
import '../server/squad.js';
import { fakeGoogle } from './fixtures/fake-google.js';

const root = scratch();
configure({ useHooks: false, useSystemd: false });
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const F = fakeGoogle({ publicKey });
g.setBase(await F.listen());
after(() => { F.close(); g.setBase(null); });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const T = new Date(2026, 9, 28, 10, 0).getTime();                 // Wednesday 28 Oct 2026, 10:00 local
let clock = T;
g.deps.now = () => clock;
let S;

test('setup: a team Space with its properties, the service account uploaded', async () => {
  const dir = path.join(root, 'search');
  await floors.createFloor({ name: 'Search', directory: { mode: 'new', path: dir }, team: [{ displayName: 'Sinta - Lead', template: 'fullstack-developer', lead: true }] });
  S = building.loadBuilding().floors.find((f) => f.id === 'search');
  g.setServiceAccount({ type: 'service_account', client_email: 'seo@acme.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  g.saveProps(S.path, { gscSite: 'sc-domain:example.com', ga4Property: '312345678', siteUrl: 'https://www.example.com' });
});

test('saving: a read call with bounded arguments; the write call and unknown calls are refused', () => {
  assert.throws(() => kpi.addKpi(S.path, { name: 'Submitted', source: { kind: 'google', call: 'indexnow.submit', args: {}, pick: { type: 'path', path: 'submitted' } } }), /a read call, one of gsc.performance, gsc.inspect, ga4.report, ga4.aiReferrals, psi.run, bing.stats/);
  assert.throws(() => kpi.addKpi(S.path, { name: 'X', source: { kind: 'google', call: 'gsc.query', pick: { type: 'path', path: 'a' } } }), /a read call/);
  assert.throws(() => kpi.addKpi(S.path, { name: 'X', source: { kind: 'google', call: 'gsc.performance', args: { rowLimit: 9000 }, pick: { type: 'path', path: 'count' } } }), /Rows: 1 to 5,000/);
  const k = kpi.addKpi(S.path, { id: 'clicks', name: 'Organic clicks', unit: 'clicks', target: 200, period: 'month', every: 'day', source: { kind: 'google', call: 'gsc.performance', args: { from: '{{from}}', to: '{{to}}' }, pick: { type: 'path', path: 'totals.clicks' } } });
  assert.deepEqual(k.source, { kind: 'google', call: 'gsc.performance', args: { dimensions: [], searchType: 'web', rowLimit: 1000, from: '{{from}}', to: '{{to}}' }, pick: { type: 'path', path: 'totals.clicks' } });
  kpi.addKpi(S.path, { id: 'top10', name: 'Keywords in the top 10', unit: 'keywords', target: 1, period: 'month', every: 'day', source: { kind: 'google', call: 'gsc.performance', args: { dimensions: ['query'], rowLimit: 5000, minImpressions: 10, maxPosition: 10, from: '{{from}}', to: '{{to}}' }, pick: { type: 'path', path: 'count' } } });
  kpi.addKpi(S.path, { id: 'organic', name: 'Organic sessions', unit: 'sessions', target: 500, period: 'month', every: 'day', source: { kind: 'google', call: 'ga4.report', args: { metrics: ['sessions'], where: { sessionDefaultChannelGroup: 'Organic Search' }, from: '{{from}}', to: '{{to}}' }, pick: { type: 'path', path: 'totals.sessions' } } });
  kpi.addKpi(S.path, { id: 'ai', name: 'Sessions from AI assistants', unit: 'sessions', target: 100, period: 'month', every: 'day', onBehind: { mode: 'notify' }, source: { kind: 'google', call: 'ga4.aiReferrals', args: { from: '{{from}}', to: '{{to}}' }, pick: { type: 'path', path: 'total.sessions' } } });
  kpi.addKpi(S.path, { id: 'psi', name: 'Mobile performance score', unit: 'points', target: 90, period: 'week', every: 'day', source: { kind: 'google', call: 'psi.run', args: { strategy: 'mobile' }, pick: { type: 'path', path: 'score' } } });
  assert.doesNotMatch(fs.readFileSync(path.join(S.path, '.claude', 'aisquad', 'kpi.json'), 'utf8'), /PRIVATE|seo@acme/, 'kpi.json carries no key');
});

test('the tick measures each with the period\'s dates; Search Console ends at today − 2; the Log names the call and the property', async () => {
  F.calls.length = 0;
  const out = await kpi.tick(clock);
  const v = Object.fromEntries(out.filter((x) => x.floorId === S.id).map((x) => [x.kpi, x.value ?? x.error]));
  assert.deepEqual(v, { clicks: 120, top10: 2, organic: 640, ai: 43, psi: 72 });
  const gsc = F.calls.filter((c) => c.path.endsWith('/searchAnalytics/query'));
  assert.deepEqual(gsc.map((c) => [c.body.startDate, c.body.endDate]), [['2026-10-01', '2026-10-26'], ['2026-10-01', '2026-10-26']], 'the month so far, up to today − 2');
  const ga4 = F.calls.find((c) => c.path.endsWith(':runReport'));
  assert.deepEqual(ga4.body.dateRanges, [{ startDate: '2026-10-01', endDate: '2026-10-28' }], 'GA4 has no lag: up to today');
  const ev = squadLog.read(S.id, { type: 'kpi.measured' });
  const clicks = ev.find((e) => e.data.kpi === 'clicks');
  assert.deepEqual([clicks.data.source, clicks.data.call, clicks.data.property], ['google', 'gsc.performance', 'sc-domain:example.com']);
  assert.equal(ev.find((e) => e.data.kpi === 'organic').data.property, '312345678');
  assert.equal(clicks.data.args, undefined);
  assert.match(clicks.summary, /target Organic clicks: 120 clicks \(behind, goal 200, google gsc.performance sc-domain:example.com\)/);
  assert.doesNotMatch(JSON.stringify(squadLog.read(S.id)), /PRIVATE KEY|tok-\d|seo@acme/);
  const md = fs.readFileSync(path.join(S.path, kpi.FILE), 'utf8');
  assert.match(md, /\| Organic clicks \| 120 clicks \| 200 clicks \(at least, this month\) \| behind \(60 %\) \| Google Search Console \(data until 2026-10-26\) \|/);
  assert.match(md, /\| Sessions from AI assistants \| 43 sessions .* \| GA4 \|/);
  assert.match(md, /\| Mobile performance score \| 72 points .* \| PageSpeed Insights \|/);
  const card = kpi.list(S.id, S.path, clock).find((k) => k.id === 'clicks');
  assert.deepEqual([card.lagTo, card.lagEmpty], ['2026-10-26', false], 'the card says so');
  assert.equal(kpi.list(S.id, S.path, clock).find((k) => k.id === 'organic').lagTo, undefined);
});

test('behind: the when-behind rule fires for a Google target', async () => {
  for (let i = 0; i < 100 && behind.stateOf(S.id, 'ai')?.status !== 'notice'; i++) await sleep(20);
  const st = behind.stateOf(S.id, 'ai');
  assert.equal(st?.status, 'notice');
  assert.match(st.text, /Sessions from AI assistants this month: 43 of 100 sessions, behind/);
  assert.equal(squadLog.read(S.id, { type: 'kpi.behind' }).find((e) => e.data.kpi === 'ai').data.kpi, 'ai');
});

test('a new month: Search Console has no data yet for two days, so the tick waits; Measure now says why', async () => {
  clock = new Date(2026, 10, 1, 10, 0).getTime();                // Sunday 1 Nov
  F.calls.length = 0;
  const out = await kpi.tick(clock);
  assert.deepEqual(out.filter((x) => x.floorId === S.id).map((x) => x.kpi).sort(), ['ai', 'organic', 'psi'], 'the GSC targets wait');
  assert.equal(F.calls.filter((c) => c.path.endsWith('/searchAnalytics/query')).length, 0);
  await assert.rejects(kpi.measure(S.id, S.path, 'clicks', { now: clock }), /No Search Console data yet for this month: it lags about 2 days/);
  assert.equal(squadLog.read(S.id, { type: 'kpi.failed' }).filter((e) => e.data.kpi === 'clicks').length, 0, 'no data yet is not a failure');
  const card = kpi.list(S.id, S.path, clock).find((k) => k.id === 'clicks');
  assert.deepEqual([card.lagEmpty, card.status.state], [true, 'unknown'], 'last month\'s value does not count for this one');
  clock = new Date(2026, 10, 3, 10, 0).getTime();                // Tuesday 3 Nov: one day of data
  const later = await kpi.tick(clock);
  assert.equal(later.find((x) => x.kpi === 'clicks').value, 120);
  assert.deepEqual([F.calls.at(-1).body?.startDate ?? F.calls.findLast((c) => c.path.endsWith('/searchAnalytics/query')).body.startDate, F.calls.findLast((c) => c.path.endsWith('/searchAnalytics/query')).body.endDate], ['2026-11-01', '2026-11-01']);
});

test('a failure in plain words reaches the Log with the call and property', async () => {
  F.state.access.ga4 = [];
  clock += 2 * 864e5;
  const out = await kpi.tick(clock);
  assert.match(out.find((x) => x.kpi === 'organic').error, /The service account has no access to GA4 property 312345678/);
  const ev = squadLog.read(S.id, { type: 'kpi.failed' }).at(-1);
  assert.deepEqual([ev.data.call, ev.data.property], ['ga4.aiReferrals', '312345678']);
  assert.match(ev.summary, /not measured from google ga4.aiReferrals 312345678: The service account has no access/);
  F.state.access.ga4 = ['312345678'];
});

test('Edit the source: a manual target switched to Google in place, logged with the call; Try works for Google', async () => {
  kpi.addKpi(S.path, { id: 'impr', name: 'Impressions', unit: 'impressions', period: 'month' });
  kpi.record(S.id, S.path, 'impr', 4000, { now: clock - 1000 });
  kpi.updateKpi(S.path, 'impr', { source: { kind: 'google', call: 'gsc.performance', args: { from: '{{from}}', to: '{{to}}' }, pick: { type: 'path', path: 'totals.impressions' } } }, { now: clock, by: 'Owner' });
  const ev = squadLog.read(S.id, { type: 'kpi.source.changed' }).at(-1);
  assert.deepEqual([ev.data.from, ev.data.to, ev.data.toCall], ['manual', 'google', 'gsc.performance']);
  assert.equal((await kpi.measure(S.id, S.path, 'impr', { now: clock + 1000 })).value, 5400);
  const tr = await kpi.trySource(S.path, { source: { kind: 'google', call: 'ga4.aiReferrals', args: { from: '{{from}}', to: '{{to}}' }, pick: { type: 'path', path: 'total.keyEvents' } }, period: 'month' }, clock);
  assert.equal(tr.value, 4);
  assert.deepEqual(tr.args, { from: '2026-11-01', to: '2026-11-30' });
});
