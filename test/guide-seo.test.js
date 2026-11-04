// SPDX-License-Identifier: Apache-2.0
// The Company Guide's Marketing focus (1.8): everything maps to Digital Marketing, search only to SEO & GEO; the agency
// hint; clinic and retail add the local SEO specialist; the plan shows Google access as a material (with the service
// account's e-mail once it is uploaded) and where each target is measured from; Build makes the SEO & GEO Space; the
// same focus question on Telegram, in both languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scratch } from './helpers.js';
import * as building from '../server/building.js';
import * as floors from '../server/floors.js';
import * as guide from '../server/guide.js';
import * as tg from '../server/guide-tg.js';
import * as g from '../server/google.js';
import * as kpi from '../server/kpi.js';

const root = scratch();
building.setPrefs({ squadsDir: path.join(root, 'squads') });
const base = { language: 'en', business: { type: 'clinic', name: 'Senyum', description: 'A dental clinic in Jakarta' }, goals: { picks: ['leads'], leads: 30 }, have: ['website', 'brand'], divisions: ['marketing'], capacity: { hours: 'night' } };

test('the focus: everything is Digital Marketing (the default), search only is SEO & GEO', () => {
  assert.equal(guide.cleanAnswers(base).focus.marketing, 'all');
  assert.equal(guide.cleanAnswers({ ...base, focus: { marketing: 'ads' } }).focus.marketing, 'all', 'unknown focus: the default');
  assert.equal(guide.blueprintOf('marketing', guide.cleanAnswers(base)), 'digital-marketing');
  assert.equal(guide.blueprintOf('marketing', guide.cleanAnswers({ ...base, focus: { marketing: 'search' } })), 'seo-geo');
  assert.equal(guide.blueprintOf('sales', guide.cleanAnswers({ ...base, focus: { marketing: 'search' } })), 'sales-crm', 'only Marketing has a focus');
  assert.deepEqual(guide.state().focusHint, { agency: { marketing: 'search' } }, 'an SEO agency picks search');
  const all = guide.draftPlan(guide.cleanAnswers(base)).spaces[0];
  assert.deepEqual([all.blueprint, all.name, all.extraRoles], ['digital-marketing', 'Senyum Marketing', undefined]);
});

test('search only: the plan names Google access and where each target comes from; a clinic gets local SEO', () => {
  let sp = guide.draftPlan(guide.cleanAnswers({ ...base, focus: { marketing: 'search' } })).spaces[0];
  assert.deepEqual([sp.blueprint, sp.name, sp.extraRoles], ['seo-geo', 'Senyum Search', ['local-seo-specialist']]);
  assert.deepEqual(sp.materials.map((m) => [m.id, m.status]), [['seo-brief', 'missing'], ['brand', 'have'], ['website', 'have'], ['site-repo', 'missing'], ['google-access', 'missing']]);
  assert.equal(sp.materials.at(-1).email, '', 'no service account yet');
  assert.match(guide.materialsMarkdown(sp), /Google access: upload the service account's key \(Admin → Integrations → Google\)/);
  const from = Object.fromEntries(sp.kpis.map((k) => [k.id, k.from]));
  assert.deepEqual(from, { 'organic-clicks': 'Google Search Console', impressions: 'Google Search Console', 'top10-keywords': 'Google Search Console', 'organic-sessions': 'GA4', 'organic-key-events': 'GA4', 'ai-sessions': 'GA4', 'ai-citations': 'hand', 'mobile-score': 'PageSpeed', 'pages-published': 'hand' });
  assert.deepEqual(sp.kpis.filter((k) => k.target != null).map((k) => [k.id, k.target]), [['mobile-score', 90], ['pages-published', 4]]);
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  g.setServiceAccount({ type: 'service_account', client_email: 'seo@senyum.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  sp = guide.draftPlan(guide.cleanAnswers({ ...base, focus: { marketing: 'search' } })).spaces[0];
  assert.equal(sp.materials.at(-1).email, 'seo@senyum.iam.gserviceaccount.com');
  assert.match(guide.materialsMarkdown(sp), /Google access: add seo@senyum.iam.gserviceaccount.com to Search Console \(Users and permissions\) and GA4 \(Viewer\), then enter the properties in Floor settings → Google/);
  for (const type of ['retail']) assert.deepEqual(guide.draftPlan(guide.cleanAnswers({ ...base, business: { ...base.business, type }, focus: { marketing: 'search' } })).spaces[0].extraRoles, ['local-seo-specialist']);
  for (const type of ['saas', 'agency']) assert.equal(guide.draftPlan(guide.cleanAnswers({ ...base, business: { ...base.business, type }, focus: { marketing: 'search' } })).spaces[0].extraRoles, undefined, type);
});

test('Build: the SEO & GEO Space with the local SEO specialist, its Google targets waiting for the properties', async () => {
  guide.answer({ ...base, focus: { marketing: 'search' } }, 7);
  await guide.plan({ useClaude: false });
  const r = await guide.build({});
  const b = r.built[0];
  assert.equal(b.error, undefined, b.error);
  const cfg = floors.readFloor(b.path);
  assert.equal(cfg.floor.blueprint.id, 'seo-geo');
  assert.deepEqual(cfg.team.agents.map((x) => x.role.template).sort(), ['content-writer', 'geo-analyst', 'keyword-researcher', 'local-seo-specialist', 'seo-geo-strategist', 'technical-seo-specialist', 'web-developer']);
  const k = kpi.list(b.id, b.path).find((x) => x.id === 'organic-clicks');
  assert.equal(k.needs, 'the Search Console site (Floor settings → Google)');
  assert.match(fs.readFileSync(path.join(b.path, 'docs', 'squad', 'MATERIALS.md'), 'utf8'), /Google access: add seo@senyum/);
});

test('Telegram: the focus question after the divisions when Marketing is picked, with the agency hint; Google access in the plan', () => {
  const a = guide.cleanAnswers({ ...base, business: { ...base.business, type: 'agency' } });
  const ids = tg.questions(a).map((q) => q.id);
  assert.equal(ids[ids.indexOf('divisions') + 1], 'focus');
  assert.ok(!tg.questions({ ...a, divisions: ['sales'] }).some((q) => q.id === 'focus'));
  const q = tg.questions(a).find((x) => x.id === 'focus');
  const en = tg.questionMessage(q, a, 'en');
  assert.match(en.text, /Marketing: what should it focus on\?[\s\S]*An SEO agency picks Search only\./);
  assert.deepEqual(en.buttons[0].map((b) => b.text), ['Everything (content, social, ads)', 'Search only (SEO and AI answers)']);
  assert.match(tg.questionMessage(q, a, 'id').text, /Agensi SEO memilih Pencarian saja\./);
  const p = guide.draftPlan(guide.cleanAnswers({ ...base, business: { ...base.business, name: 'Gigi' }, focus: { marketing: 'search' } }), {});   // not the Space built above
  assert.match(tg.planMessage(p, 'en'), /Google access: add seo@senyum.iam.gserviceaccount.com to Search Console and GA4/);
  assert.match(tg.planMessage(p, 'id'), /Akses Google: tambahkan seo@senyum.iam.gserviceaccount.com ke Search Console dan GA4/);
});
