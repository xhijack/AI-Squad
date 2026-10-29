// Built-in skills: the bundled set, per-agent status, Install into the project, names in agent files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import * as skills from '../server/skills.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import { listTemplates } from '../server/roles.js';
import { parseFrontmatter } from '../server/frontmatter.js';
import { createSquad } from '../server/setup.js';

const root = scratch();
const MIN = { 'project-manager': ['source-docs-intake', 'sprint-planning', 'handoff-review'], 'fullstack-developer': ['implement-from-spec', 'tdd', 'handoff-writing', 'investigate'],
  'qa-engineer': ['test-plan-from-acceptance', 'ui-evidence', 'bug-report', 'investigate'], 'ui-ux-designer': ['design-fidelity-map', 'design-review', 'accessibility-check'],
  'devops-engineer': ['environment-matrix', 'deploy-and-rollback', 'secrets-hygiene', 'server-discovery', 'staging-install', 'docker-ops', 'git-deploy', 'netlify-setup', 'server-health', 'canary'] };
const MARKETING = ['marketing-brief-intake', 'seo-audit', 'content-calendar', 'brand-voice-check', 'campaign-report'];
const SALES = ['icp-intake', 'lead-qualification', 'crm-hygiene', 'outreach-copy', 'pipeline-report'];

test('every skill a Role Template lists is bundled, in the standard format', () => {
  const bundled = skills.bundledSkills().map((s) => s.name);
  assert.equal(bundled.length, 42);                    // 0.19: space-handoff, 0.20: contract-checklist, 1.0: fit-gap-analysis, 1.7: kb-writer
  for (const [role, list] of Object.entries(MIN)) for (const s of list) assert.ok(listTemplates().find((t) => t.role === role).skills.includes(s), `${role} lists ${s}`);
  const listed = new Set([...listTemplates().flatMap((t) => t.skills), ...MARKETING, ...SALES]);
  for (const s of listed) if (!['frappe', 'erpnext'].includes(s)) assert.ok(bundled.includes(s), `${s} is bundled`);
  for (const name of bundled) {
    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(skills.BUNDLED, name, 'SKILL.md'), 'utf8'));
    assert.equal(data.name, name);
    assert.ok(data.description.length > 60 && /Use /.test(data.description), `${name} says when to use it`);
    assert.match(body, /^# /);
  }
});

test('DevOps v2: server skills with their safety rules, and the owner / lead split in the role', () => {
  const read = (n) => fs.readFileSync(path.join(skills.BUNDLED, n, 'SKILL.md'), 'utf8');
  assert.match(read('server-discovery'), /SHARED/); assert.match(read('server-discovery'), /docs\/ops\/SERVER-<host>\.md/); assert.match(read('server-discovery'), /change nothing/i);
  assert.match(read('staging-install'), /AskUserQuestion/); assert.match(read('staging-install'), /mem_limit/); assert.match(read('staging-install'), /deploy key/);
  assert.match(read('docker-ops'), /docker system prune/); assert.match(read('docker-ops'), /## Never/);
  assert.match(read('git-deploy'), /previous tag/); assert.match(read('git-deploy'), /read-only deploy key/);
  assert.match(read('netlify-setup'), /NETLIFY_AUTH_TOKEN/); assert.match(read('netlify-setup'), /Never ask for a token in chat/); assert.match(read('netlify-setup'), /DNS/);
  assert.match(read('server-health'), /neighbour/i);
  assert.match(read('canary'), /roll back at once/); assert.match(read('canary'), /Production:\*\* do not roll back on your own/); assert.match(read('git-deploy'), /Ship readiness/);
  const t = listTemplates().find((x) => x.role === 'devops-engineer');
  assert.equal(t.version, 4, 'v4 (1.0.1): the servers the owner registered');
  const rules = t.rules.join('\n');
  assert.match(rules, /AISQUAD_AGENT/); assert.match(rules, /Task from the owner.*setup preparation/); assert.match(rules, /Task from the lead.*deployment/);
  assert.match(rules, /registered \(Floor settings → Servers\).*local development/);
  assert.match(rules, /Desk session prepares and never deploys/);
});

test('status: bundled until installed in the project; user skills are seen too; Install never overwrites', async () => {
  const proj = path.join(root, 'shop');
  await floors.createFloor({ name: 'Shop', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Budi - Dev', template: 'fullstack-developer' }] });
  assert.deepEqual(skills.skillStatus(proj, 'tdd'), { name: 'tdd', status: 'bundled', description: skills.bundledSkills().find((s) => s.name === 'tdd').description, installable: true });
  assert.equal(skills.skillStatus(proj, 'frappe').status, 'missing');
  let agentFile = parseFrontmatter(fs.readFileSync(path.join(proj, '.claude/agents/budi-dev.md'), 'utf8'));
  assert.equal(agentFile.data.skills, 'aisquad:implement-from-spec, aisquad:tdd, aisquad:handoff-writing, aisquad:investigate', 'the plugin copy is namespaced');
  const desk = squad.deskDetail('shop', 'budi-dev');
  assert.deepEqual(desk.skills.map((s) => [s.name, s.status]), [['implement-from-spec', 'bundled'], ['tdd', 'bundled'], ['handoff-writing', 'bundled'], ['investigate', 'bundled']]);
  squad.installSkills('shop', ['tdd']);
  assert.ok(fs.existsSync(path.join(proj, '.claude/skills/tdd/SKILL.md')));
  assert.equal(skills.skillStatus(proj, 'tdd').status, 'project');
  agentFile = parseFrontmatter(fs.readFileSync(path.join(proj, '.claude/agents/budi-dev.md'), 'utf8'));
  assert.equal(agentFile.data.skills, 'aisquad:implement-from-spec, tdd, aisquad:handoff-writing, aisquad:investigate');
  fs.writeFileSync(path.join(proj, '.claude/skills/tdd/SKILL.md'), 'mine');
  assert.deepEqual(skills.install(proj, 'tdd'), { name: 'tdd', installed: false, already: true });
  assert.equal(fs.readFileSync(path.join(proj, '.claude/skills/tdd/SKILL.md'), 'utf8'), 'mine');
  fs.mkdirSync(path.join(config.claudeHome, 'skills', 'bug-report'), { recursive: true });
  fs.writeFileSync(path.join(config.claudeHome, 'skills', 'bug-report', 'SKILL.md'), '---\nname: bug-report\n---\n');
  assert.equal(skills.skillStatus(proj, 'bug-report').status, 'user');
  assert.throws(() => skills.install(proj, '../etc'), /Invalid/);
  assert.throws(() => skills.install(proj, 'frappe'), /No bundled skill/);
});

test('Set up Squad installs the team\'s skills into the new project', async () => {
  const r = await createSquad({ blueprint: 'sales-crm', name: 'Leads', directory: { mode: 'new', path: path.join(root, 'leads') }, team: [{ template: 'sales-manager', displayName: 'Sam' }, { template: 'sales-copywriter', displayName: 'Cy' }] });
  assert.deepEqual(fs.readdirSync(path.join(r.path, '.claude/skills')).sort(), ['brand-voice-check', 'icp-intake', 'lead-qualification', 'outreach-copy', 'pipeline-report']);
  assert.match(fs.readFileSync(path.join(r.path, '.claude/agents/sam.md'), 'utf8'), /^skills: "icp-intake, pipeline-report, lead-qualification"$/m);
});
