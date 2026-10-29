// SPDX-License-Identifier: Apache-2.0
// The Support Blueprint (1.7): a team Space with a knowledge base, the kb-writer skill that keeps customers' personal
// data out of it, escalations through the handoff bus, targets and routines seeded off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as bp from '../server/blueprints.js';
import * as building from '../server/building.js';
import * as floors from '../server/floors.js';
import * as kpi from '../server/kpi.js';
import * as cadence from '../server/cadence.js';
import * as skills from '../server/skills.js';
import { parseFrontmatter } from '../server/frontmatter.js';
import { listTemplates } from '../server/roles.js';
import { createSquad } from '../server/setup.js';

const root = scratch();
building.setPrefs({ squadsDir: path.join(root, 'squads') });

test('the Blueprint: a team department, lead and agent, KB, escalation and the approval rules', () => {
  const b = bp.getBlueprint('support');
  assert.deepEqual(b.space, { kind: 'department' });
  assert.equal(b.lead, 'support-lead');
  assert.deepEqual(b.roles.map((r) => [r.template, r.min, r.default, r.max]), [['support-lead', 1, 1, 1], ['support-agent', 0, 1, 3]]);
  assert.ok(b.gates.includes('KB articles free of personal data'));
  assert.deepEqual(b.ownerOnly, ['refunds', 'credits', 'discounts', 'deleting customer accounts', 'promised dates']);
  assert.deepEqual(b.kpis.map((k) => [k.id, k.source.kind, k.requires || '']), [['first-response', 'manual', 'mcp:helpdesk'], ['open-tickets', 'erpnext', ''], ['resolved', 'erpnext', ''], ['csat', 'manual', 'mcp:helpdesk']]);
  assert.deepEqual(b.cadence.map((r) => [r.id, r.agent, r.every]), [['morning-triage', 'support-lead', 'weekdays'], ['weekly-report', 'support-lead', 'weekly:fri'], ['kb-gaps', 'support-agent', 'weekly:wed']]);
  const lead = listTemplates().find((t) => t.role === 'support-lead'), agent = listTemplates().find((t) => t.role === 'support-agent');
  assert.ok(lead.skills.includes('space-handoff') && lead.skills.includes('kb-writer') && agent.skills.includes('kb-writer'));
  assert.match(lead.rules.join('\n'), /engineering or product Space as a handoff package/);
  assert.match(agent.rules.join('\n'), /Supervised mode: every reply is a draft[^\n]*never send it yourself/);
  assert.match(agent.rules.join('\n'), /Automatic mode: you may answer only with an APPROVED article/);
  for (const t of [lead, agent]) assert.ok(t.permissions.deny.includes('mcp__erpnext__reply_to_helpdesk_ticket'));
});

test('kb-writer: bundled, and it redacts names, phones and e-mail addresses', () => {
  assert.ok(skills.bundledSkills().some((s) => s.name === 'kb-writer'));
  const { data, body } = parseFrontmatter(fs.readFileSync(path.join(skills.BUNDLED, 'kb-writer', 'SKILL.md'), 'utf8'));
  assert.equal(data.name, 'kb-writer');
  assert.match(body, /people's names/); assert.match(body, /phone numbers, e-mail addresses/); assert.match(body, /STATUS: DRAFT/);
});

test('Set up: a team Space with the KB, the policy draft, targets without goals and routines off', async () => {
  const r = await createSquad({ blueprint: 'support', name: 'DTamu Support', team: [{ template: 'support-lead', displayName: 'Sari - Lead', lead: true }, { template: 'support-agent', displayName: 'Andi - Agent' }] });
  const f = floors.readFloor(r.path).floor;
  assert.deepEqual([f.access, f.kind, f.erpnext, f.telegram], ['team', 'department', 'off', 'full']);
  assert.deepEqual(kpi.readDefs(r.path).map((k) => [k.id, k.target]), [['first-response', null], ['open-tickets', null], ['resolved', null], ['csat', null]]);
  assert.deepEqual(cadence.readDefs(r.path).map((x) => [x.id, x.enabled]), [['morning-triage', false], ['weekly-report', false], ['kb-gaps', false]]);
  for (const doc of ['docs/SUPPORT-POLICY.md', 'docs/kb/README.md', 'docs/support/README.md']) assert.ok(fs.existsSync(path.join(r.path, doc)), doc);
  assert.match(fs.readFileSync(path.join(r.path, 'AISQUAD.md'), 'utf8'), /Customers' names, phone numbers, e-mail addresses and ticket numbers never go into an article/);
  assert.match(fs.readFileSync(path.join(r.path, '.claude', 'agents', 'andi-agent.md'), 'utf8'), /Cite the KB article in every reply/);
});
