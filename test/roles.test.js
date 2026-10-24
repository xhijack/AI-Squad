import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { paths } from '../server/config.js';
import * as roles from '../server/roles.js';

const root = scratch();

test('default templates are seeded and parsed', () => {
  const ids = roles.listTemplates().map((t) => t.role).sort();
  assert.deepEqual(ids, ['frappe-developer', 'fullstack-developer', 'project-manager', 'qa-engineer', 'seo-specialist', 'sprint-developer', 'sprint-lead', 'sprint-qa', 'ui-ux-designer']);
  const t = roles.getTemplate('frappe-developer');
  assert.equal(t.version, 1);
  assert.ok(t.rules.length >= 3);
  assert.match(t.prompt, /Frappe developer/);
  assert.ok(t.permissions.deny.includes('Bash(git push*)'));
});

test('saving changed content bumps the version and keeps history', () => {
  const r = roles.saveTemplate({ role: 'qa-engineer', rules: [...roles.getTemplate('qa-engineer').rules, 'Attach screenshots to UI bugs.'] });
  assert.equal(r.changed, true);
  assert.equal(r.template.version, 2);
  assert.deepEqual(roles.templateVersions('qa-engineer'), [1, 2]);
  assert.match(roles.templateText('qa-engineer', 1), /version: 1/);
  assert.doesNotMatch(roles.templateText('qa-engineer', 1), /screenshots/);
});

test('saving identical content does not bump', () => {
  const t = roles.getTemplate('seo-specialist');
  const r = roles.saveTemplate({ role: 'seo-specialist', title: t.title });
  assert.equal(r.changed, false);
  assert.equal(roles.getTemplate('seo-specialist').version, 1);
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
  fs.writeFileSync(path.join(lib, 'devops-engineer.md'), '---\nrole: devops-engineer\ntitle: DevOps Engineer\nversion: 4\n---\n## Prompt\nShip it.\n');
  fs.writeFileSync(path.join(lib, 'qa-engineer.md'), '---\nrole: qa-engineer\ntitle: Other QA\nversion: 9\n---\n');
  fs.writeFileSync(paths.libraries(), JSON.stringify({ libraries: [{ name: 'team', path: lib }] }));
  const d = roles.getTemplate('devops-engineer');
  assert.equal(d.source, 'team');
  assert.equal(d.version, 4);
  assert.equal(roles.getTemplate('qa-engineer').title, 'QA Engineer');
  assert.throws(() => roles.saveTemplate({ role: 'devops-engineer', title: 'X' }), /read-only/);
});
