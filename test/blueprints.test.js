// Squad Blueprints, the recommendation (Claude Code or keyword fallback) and Set up Squad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, config } from '../server/config.js';
import * as bp from '../server/blueprints.js';
import * as rec from '../server/recommend.js';
import * as building from '../server/building.js';
import { createSquad } from '../server/setup.js';
import { readFloor } from '../server/floors.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-print.cjs');

test('the three shipped Blueprints are seeded with roles, counts and a lead', () => {
  const list = bp.listBlueprints();
  assert.deepEqual(list.map((b) => b.id), ['digital-marketing', 'sales-crm', 'software-house']);
  const sh = bp.getBlueprint('software-house');
  assert.equal(sh.lead, 'project-manager');
  assert.equal(sh.workflow, 'squad-sprint');
  assert.deepEqual(sh.roles.find((r) => r.template === 'fullstack-developer'), { template: 'fullstack-developer', min: 1, default: 2, max: 4, lead: false, why: sh.roles[1].why });
  assert.equal(bp.getBlueprint('sales-crm').lead, 'sales-manager');
  assert.ok(fs.existsSync(path.join(config.home, 'blueprints', 'software-house', 'blueprint.md')));
});

test('an edited local Blueprint is kept when the shipped one is newer', () => {
  const f = path.join(bp.libraryDir(), 'sales-crm', 'blueprint.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('version: 1', 'version: 7').replace('title: Sales & CRM', 'title: Our Sales'));
  bp.seedBlueprints();
  assert.equal(bp.getBlueprint('sales-crm').title, 'Our Sales');
});

test('catalog: every Role Template with its category (from the template or the Blueprints using it)', () => {
  const c = bp.catalog();
  const of = (r) => c.find((t) => t.role === r);
  assert.equal(of('sales-copywriter').category, 'sales');
  assert.equal(of('qa-engineer').category, 'software');
  assert.deepEqual(of('ui-ux-designer').blueprints, ['digital-marketing', 'software-house']);
  assert.equal(of('frappe-developer').category, 'general');
});

test('keyword fallback picks the Blueprint and explains the match', async () => {
  const list = bp.listBlueprints();
  assert.equal(rec.keywordMatch('I want a software house that builds my restaurant POS', list).blueprint.id, 'software-house');
  assert.equal(rec.keywordMatch('digital marketing for my coffee brand on instagram', list).blueprint.id, 'digital-marketing');
  assert.equal(rec.keywordMatch('a sales CRM team to find B2B leads', list).blueprint.id, 'sales-crm');
  const r = await rec.recommend({ prompt: 'Social media and SEO for my bakery', ask: async () => { throw new Error('offline'); } });
  assert.equal(r.source, 'keywords');
  assert.equal(r.blueprint, 'digital-marketing');
  assert.match(r.note, /Matched on: .*seo/);
  assert.deepEqual(r.team.filter((m) => m.lead).map((m) => m.template), ['marketing-strategist']);
  assert.ok(r.team.every((m) => m.reason.length > 10), 'every agent says why');
});

test('Claude Code answer: unknown roles dropped, counts clamped to the Blueprint, the lead added', async () => {
  configure({ claudeBin: FAKE });
  const log = path.join(root, 'claude.log');
  process.env.FAKE_CLAUDE_LOG = log;
  const r = await rec.recommend({ prompt: 'I want a software house that builds my restaurant POS' });
  assert.equal(r.source, 'claude');
  assert.equal(r.name, 'Resto POS');
  assert.deepEqual(r.team.map((m) => [m.displayName, m.lead]), [['Project Manager', true], ['Fullstack Developer 1', false], ['Fullstack Developer 2', false], ['Fullstack Developer 3', false], ['QA Engineer', false]]);
  assert.match(r.team[1].reason, /parallel/);
  const args = JSON.parse(fs.readFileSync(log, 'utf8').trim());
  assert.deepEqual(args.slice(0, 6), ['-p', '--model', 'haiku', '--output-format', 'json', '--tools']);
  process.env.FAKE_CLAUDE_MODE = 'garbage';
  assert.equal((await rec.recommend({ prompt: 'a POS app' })).source, 'keywords', 'unreadable answer falls back');
  delete process.env.FAKE_CLAUDE_MODE; delete process.env.FAKE_CLAUDE_LOG;
  const pickedCard = await rec.recommend({ blueprint: 'sales-crm' });
  assert.equal(pickedCard.source, 'blueprint');
  assert.equal(pickedCard.team.length, 5);
});

test('Set up Squad: next free Floor from 2, a new folder under the squads folder, the Blueprint recorded', async () => {
  building.setPrefs({ squadsDir: path.join(root, 'squads') });
  const r = await createSquad({ blueprint: 'software-house', name: 'Resto POS', goal: 'POS for my restaurant', team: [
    { template: 'project-manager', displayName: 'Rina - PM' }, { template: 'fullstack-developer', displayName: 'Budi - Dev' }] });
  assert.equal(r.number, 2);
  assert.equal(r.path, path.join(root, 'squads', 'resto-pos'));
  assert.equal(r.lead, 'rina-pm', 'the Blueprint lead role leads');
  assert.ok(fs.existsSync(path.join(r.path, '.git')));
  const f = readFloor(r.path);
  assert.deepEqual(f.floor.blueprint, { id: 'software-house', version: 1 });
  assert.equal(f.floor.workflow, 'squad-sprint');
  const second = await createSquad({ blueprint: 'sales-crm', name: 'Leads', team: [{ template: 'lead-researcher', displayName: 'Sam' }] });
  assert.equal(second.number, 3);
  await assert.rejects(createSquad({ blueprint: 'sales-crm', name: 'Leads', team: [{ template: 'sales-manager' }] }), /already exists/);
  await assert.rejects(createSquad({ blueprint: 'nope', name: 'X', team: [] }), /Blueprint not found/);
});
