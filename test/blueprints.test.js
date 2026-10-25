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

test('the standard is written into AISQUAD.md and every agent file, with the rules of each role', async () => {
  const r = await createSquad({ blueprint: 'software-house', name: 'Kiosk', goal: 'A self-service kiosk', team: [
    { template: 'project-manager', displayName: 'Rina - PM', lead: true }, { template: 'fullstack-developer', displayName: 'Budi - Dev' }, { template: 'devops-engineer', displayName: 'Ops' }] });
  const read = (f) => fs.readFileSync(path.join(r.path, f), 'utf8');
  const brief = read('AISQUAD.md');
  assert.match(brief, /## Squad standard: Software House v1/);
  assert.match(brief, /only the lead \(Rina - PM \(`rina-pm`\)\) talks to the owner/);
  assert.match(brief, /\| `docs\/PRD\.md` \| What and why/);
  assert.doesNotMatch(brief, /Rules per role/, 'role rules go to the agents, not the brief');
  const pm = read('.claude/agents/rina-pm.md'), dev = read('.claude/agents/budi-dev.md');
  assert.match(pm, /You are the lead: you are the only agent who talks to the owner/);
  assert.match(pm, /### Your rules in this squad\n- Before the first sprint you \*\*must ask the owner\*\* for the PRD/);
  assert.match(dev, /Your lead is \*\*Rina - PM\*\* \(`rina-pm`\)/);
  assert.match(dev, /Cite the PRD story and the TECH section in every handoff/);
  assert.doesNotMatch(dev, /must ask the owner/);
  // workflow pack, snapshot, settings
  assert.match(read('docs/PRD.md'), /^STATUS: DRAFT$/m);
  assert.ok(fs.existsSync(path.join(r.path, '.env.example')));
  assert.equal(read('.claude/aisquad/blueprint.md'), fs.readFileSync(path.join(bp.libraryDir(), 'software-house', 'blueprint.md'), 'utf8'));
  const settings = JSON.parse(read('.claude/settings.json'));
  assert.equal(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
  assert.ok(settings.permissions.deny.includes('Read(./.env)') && settings.permissions.deny.includes('Read(./.env.local)'));
  assert.ok(!settings.permissions.deny.includes('Read(./.env.*)'), '.env.example stays readable for DevOps');
  // source document status follows the STATUS line
  const f = bp.floorBlueprint(r.path, { id: 'software-house' });
  assert.deepEqual(bp.sourceDocsStatus(r.path, f).map((d) => d.status), ['draft', 'draft', 'draft', 'draft']);
  fs.writeFileSync(path.join(r.path, 'docs/PRD.md'), read('docs/PRD.md').replace('STATUS: DRAFT', 'STATUS: APPROVED'));
  fs.rmSync(path.join(r.path, 'docs/ENVIRONMENTS.md'));
  assert.deepEqual(bp.sourceDocsStatus(r.path, f).map((d) => d.status), ['approved', 'draft', 'draft', 'missing']);
  // regenerating keeps exactly one standard block and does not overwrite the owner's documents
  const { addAgent } = await import('../server/floors.js');
  addAgent(r.path, { displayName: 'Quinn - QA', template: 'qa-engineer' });
  assert.equal(read('AISQUAD.md').split('aisquad:standard:start').length, 2);
  assert.match(read('.claude/agents/quinn-qa.md'), /Report per acceptance criterion, with evidence/);
  assert.match(read('docs/PRD.md'), /STATUS: APPROVED/);
});

test('Blueprint body sections and per-role rules', () => {
  const b = bp.getBlueprint('digital-marketing');
  assert.deepEqual(bp.sections(b.body).map((s) => s.title), ['Purpose', 'Source documents', 'Channels', 'Work items', 'Handoff', 'Gates', 'Definition of done', 'Rules per role']);
  assert.match(bp.roleRules(b, 'social-media-specialist'), /Follow `docs\/BRAND\.md` exactly/);
  assert.equal(bp.roleRules(b, 'frappe-developer'), '');
  assert.match(b.kickoff, /marketing brief, the brand rules and the channel plan/);
});
