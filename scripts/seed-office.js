#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A scratch Building with N Spaces of 5 agents each, for the Office overview (1.1.0 measurements and screenshots):
//   node scripts/seed-office.js 6            -> playground/office-6/{home,claude,floors}
//   AISQUAD_HOME=playground/office-6/home CLAUDE_HOME=playground/office-6/claude node server/index.js --port 8597
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const n = Math.max(1, Math.min(12, +process.argv[2] || 3));
const PG = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'playground', `office-${n}`);
fs.rmSync(PG, { recursive: true, force: true });
process.env.AISQUAD_HOME = path.join(PG, 'home');
process.env.CLAUDE_HOME = path.join(PG, 'claude');
const { seedDefaults } = await import('../server/roles.js');
const floors = await import('../server/floors.js');
seedDefaults();
fs.writeFileSync(path.join(PG, 'home', 'pin'), '123456\n', { mode: 0o600 });
const SPACES = [['Sales', 'department', ['sales-manager', 'sales-analyst', 'sales-copywriter', 'crm-administrator', 'lead-researcher']],
  ['DTamu', 'project', ['project-manager', 'fullstack-developer', 'qa-engineer', 'ui-ux-designer', 'devops-engineer']],
  ['Marketing', 'department', ['marketing-strategist', 'content-writer', 'seo-specialist', 'social-media-specialist', 'ads-analytics-specialist']],
  ['Sopwer HR', 'project', ['project-manager', 'frappe-developer', 'frappe-developer', 'qa-engineer', 'erp-functional-consultant']],
  ['Legal', 'department', ['legal-counsel', 'contract-drafter', 'lead-researcher', 'second-opinion-reviewer', 'security-engineer']],
  ['POS', 'project', ['project-manager', 'fullstack-developer', 'fullstack-developer', 'qa-engineer', 'devops-engineer']]];
const NAMES = ['Rina', 'Budi', 'Sari', 'Dewi', 'Agus', 'Lina', 'Rudi', 'Tari', 'Joko', 'Maya', 'Eko', 'Nina'];
for (let i = 0; i < n; i++) {
  const [name, kind, roles] = SPACES[i % SPACES.length];
  await floors.createFloor({ name: n > SPACES.length ? `${name} ${Math.floor(i / SPACES.length) + 1}` : name, number: i + 2, directory: { mode: 'new', path: path.join(PG, 'floors', `s${i}`) },
    team: roles.map((template, k) => ({ displayName: `${NAMES[(i * 5 + k) % NAMES.length]} - ${template.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')}`, template, lead: k === 0 })) });
  floors.updateFloorConfig(path.join(PG, 'floors', `s${i}`), { kind });
}
console.log(`${PG}: ${n} Spaces, ${n * 5} agents`);
