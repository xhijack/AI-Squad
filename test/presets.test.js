// SPDX-License-Identifier: Apache-2.0
// Business presets (1.13): the kinds of business the Company Guide offers are files (templates/presets/ and the
// Owner's ~/.aisquad/presets/), not code. A dental clinic is one file: the guide lists it with its labels, suggests its
// divisions, gives its search squad the local SEO specialist, tells Claude about it and builds it. Broken files are
// left out; "other" is always there; an Owner's file replaces a shipped one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import * as building from '../server/building.js';
import * as floors from '../server/floors.js';
import * as guide from '../server/guide.js';
import * as presets from '../server/presets.js';

const root = scratch();
building.setPrefs({ squadsDir: path.join(root, 'squads') });
const own = (name, text) => { fs.mkdirSync(presets.ownDir(), { recursive: true }); fs.writeFileSync(path.join(presets.ownDir(), name), text); };

test('the shipped presets are the eight kinds of business the guide had in code', () => {
  assert.deepEqual(guide.types(), ['saas', 'erp-consultant', 'consultant', 'software-house', 'agency', 'clinic', 'retail', 'other']);
  assert.deepEqual(guide.suggestFor('saas', []), ['product', 'engineering', 'marketing', 'sales', 'support', 'legal']);
  assert.deepEqual(guide.state().focusHint, { agency: { marketing: 'search' } });
  assert.deepEqual(guide.state().presets.find((p) => p.id === 'clinic').title, { en: 'Clinic or practice', id: 'Klinik atau praktik' });
});

test('a dental clinic without a line of code: listed, suggested, local SEO, told to Claude, built', async () => {
  own('dental-clinic.md', '---\nid: dental-clinic\norder: 65\ntitle: { en: Dental clinic, id: Klinik gigi }\nhint: { en: "Patients, check-ups, treatments", id: "Pasien, kontrol, perawatan" }\ndivisions: [marketing, sales, legal, support]\nmarketing: search\nlocal: true\n---\nPatients book check-ups and treatments; reminders every six months bring them back.\n');
  const st = guide.state();
  assert.deepEqual(st.presets.find((p) => p.id === 'dental-clinic'), { id: 'dental-clinic', title: { en: 'Dental clinic', id: 'Klinik gigi' }, hint: { en: 'Patients, check-ups, treatments', id: 'Pasien, kontrol, perawatan' }, source: 'own' });
  assert.equal(guide.types().indexOf('dental-clinic'), guide.types().indexOf('clinic') + 1, 'listed by its order');
  assert.deepEqual(st.suggest['dental-clinic'], ['marketing', 'sales', 'legal', 'support']);
  assert.deepEqual(st.focusHint['dental-clinic'], { marketing: 'search' });
  const a = { language: 'id', business: { type: 'dental-clinic', name: 'Senyum', description: 'Klinik gigi di Bandung' }, goals: { picks: ['leads'], leads: 40 }, have: ['website'], divisions: ['marketing', 'sales'], focus: { marketing: 'search' }, capacity: { hours: 'day' } };
  assert.equal(guide.cleanAnswers(a).business.type, 'dental-clinic', 'a type from a file is accepted');
  const p = guide.draftPlan(guide.cleanAnswers(a));
  assert.deepEqual(p.spaces.find((s) => s.division === 'marketing').extraRoles, ['local-seo-specialist']);
  assert.match(guide.claudePrompt(p), /Business: Dental clinic \(dental-clinic\), "Senyum"\. Klinik gigi di Bandung\nAbout this kind of business: Patients book check-ups/);
  guide.answer(a, 6);
  await guide.plan({ useClaude: false });
  const r = await guide.build({});
  assert.deepEqual(r.built.map((x) => [x.division, !!x.error]), [['marketing', false], ['sales', false]]);
  assert.equal(floors.readFloor(r.built[0].path).floor.blueprint.id, 'seo-geo');
});

test('broken files are left out; an Owner\'s file replaces a shipped one; "other" is always there', () => {
  own('bad-id.md', '---\nid: Bad Id\ndivisions: [marketing]\n---\n');
  own('mismatch.md', '---\nid: something-else\ndivisions: [marketing]\n---\n');
  own('no-divisions.md', '---\nid: no-divisions\ndivisions: [kitchen, garden]\n---\n');
  own('broken.md', '---\nid: broken\ndivisions: [marketing\n---\n');
  own('retail.md', '---\nid: retail\norder: 70\ntitle: { en: Our shop, id: Toko kami }\ndivisions: [sales]\n---\n');
  const ids = guide.types();
  for (const x of ['bad-id', 'Bad Id', 'something-else', 'mismatch', 'no-divisions', 'broken']) assert.ok(!ids.includes(x), x);
  assert.deepEqual(guide.suggestFor('retail', []), ['sales']);
  assert.equal(guide.presetOf('retail').local, false, 'the Owner\'s file decides');
  assert.equal(guide.presetOf('nonsense').id, 'other');
  assert.ok(presets.list(Object.keys(guide.DIVISIONS)).some((p) => p.id === 'other'));
  assert.ok(fs.existsSync(path.join(config.home, 'presets', 'retail.md')));
});
