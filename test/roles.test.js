import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { paths, configure, config } from '../server/config.js';
import * as roles from '../server/roles.js';

const root = scratch();

test('default templates are seeded and parsed', () => {
  const ids = roles.listTemplates().map((t) => t.role).sort();
  assert.deepEqual(ids, ['ads-analytics-specialist', 'content-writer', 'contract-drafter', 'crm-administrator', 'devops-engineer', 'erp-functional-consultant', 'frappe-developer', 'fullstack-developer', 'lead-researcher', 'legal-counsel', 'marketing-strategist',
    'project-manager', 'qa-engineer', 'sales-analyst', 'sales-copywriter', 'sales-manager', 'second-opinion-reviewer', 'security-engineer', 'seo-specialist', 'social-media-specialist', 'sprint-developer', 'sprint-lead', 'sprint-qa', 'ui-ux-designer']);
  assert.equal(roles.getTemplate('sales-manager').category, 'sales');
  const t = roles.getTemplate('frappe-developer');
  assert.equal(t.version, 3);
  assert.ok(t.rules.length >= 3);
  assert.match(t.prompt, /Frappe developer/);
  assert.ok(t.permissions.deny.includes('Bash(git push*)'));
});

test('saving changed content bumps the version and keeps history', () => {
  const r = roles.saveTemplate({ role: 'qa-engineer', rules: [...roles.getTemplate('qa-engineer').rules, 'Attach screenshots to UI bugs.'] });
  assert.equal(r.changed, true);
  assert.equal(r.template.version, 4);
  assert.deepEqual(roles.templateVersions('qa-engineer'), [3, 4]);
  assert.match(roles.templateText('qa-engineer', 3), /version: 3/);
  assert.doesNotMatch(roles.templateText('qa-engineer', 3), /screenshots/);
});

test('saving identical content does not bump', () => {
  const t = roles.getTemplate('seo-specialist');
  const r = roles.saveTemplate({ role: 'seo-specialist', title: t.title });
  assert.equal(r.changed, false);
  assert.equal(roles.getTemplate('seo-specialist').version, 2);
});

test('create rejects duplicates; update needs an existing role', () => {
  assert.throws(() => roles.saveTemplate({ role: 'qa-engineer' }, { create: true }), /already exists/);
  assert.throws(() => roles.saveTemplate({ role: 'nope' }), /not found/);
  const r = roles.saveTemplate({ role: 'Data Analyst', title: 'Data Analyst', model: 'haiku', prompt: 'Analyse data.' }, { create: true });
  assert.equal(r.template.role, 'data-analyst');
  assert.equal(r.template.model, 'haiku');
});

test('extra libraries are listed read-only and local wins', () => {
  const lib = path.join(root, 'team-lib');
  fs.mkdirSync(lib);
  fs.writeFileSync(path.join(lib, 'release-manager.md'), '---\nrole: release-manager\ntitle: Release Manager\nversion: 4\n---\n## Prompt\nShip it.\n');
  fs.writeFileSync(path.join(lib, 'qa-engineer.md'), '---\nrole: qa-engineer\ntitle: Other QA\nversion: 9\n---\n');
  fs.writeFileSync(paths.libraries(), JSON.stringify({ libraries: [{ name: 'team', path: lib }] }));
  const d = roles.getTemplate('release-manager');
  assert.equal(d.source, 'team');
  assert.equal(d.version, 4);
  assert.equal(roles.getTemplate('qa-engineer').title, 'QA Engineer');
  assert.throws(() => roles.saveTemplate({ role: 'release-manager', title: 'X' }), /read-only/);
});

test('shipped default upgrades replace only untouched local copies', () => {
  const ship = path.join(root, 'ship');
  fs.mkdirSync(ship);
  const t = (v, extra = '') => `---\nrole: helper\ntitle: Helper\nversion: ${v}\n---\n## Prompt\nHelp.${extra}\n`;
  const before = config.defaultRoles;
  configure({ defaultRoles: ship });
  fs.writeFileSync(path.join(ship, 'helper.md'), t(1));
  roles.seedDefaults();
  assert.equal(roles.getTemplate('helper').version, 1);
  fs.writeFileSync(path.join(ship, 'helper.md'), t(2, ' New.'));
  roles.seedDefaults();
  assert.equal(roles.getTemplate('helper').version, 2, 'untouched copy upgraded');
  assert.deepEqual(roles.templateVersions('helper'), [1, 2], 'old version kept in history');
  roles.saveTemplate({ role: 'helper', prompt: 'My own prompt.' });           // user edit -> v3
  fs.writeFileSync(path.join(ship, 'helper.md'), t(4, ' Newer.'));
  roles.seedDefaults();
  assert.equal(roles.getTemplate('helper').prompt, 'My own prompt.', 'edited copy left alone');
  configure({ defaultRoles: before });
});

test('appearance keeps known desk props (at most two) and the role screen', () => {
  const { cleanAppearance, parseTemplate } = roles;
  assert.deepEqual(cleanAppearance({ props: ['trophy', 'cactus', 'duck'], screen: 'board' }), { props: ['trophy', 'cactus'], screen: 'board' });
  assert.deepEqual(cleanAppearance({ props: 'ladybug, spaceship', screen: 'tv' }), { props: ['ladybug'] });
  const t = parseTemplate('---\nrole: qa\nappearance: { style: pony, props: [ladybug, magnifier], screen: tests }\n---\n## Prompt\nx\n');
  assert.deepEqual(t.appearance, { style: 'pony', props: ['ladybug', 'magnifier'], screen: 'tests' });
});
