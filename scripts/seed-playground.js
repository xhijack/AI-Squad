#!/usr/bin/env node
// Builds a scratch Building under ./playground for manual and screenshot tests:
//   playground/home        AI Squad home (building.json, roles, pin)
//   playground/claude      fake Claude home with synthetic transcripts
//   playground/floors/*    project directories
// Run the server against it:
//   AISQUAD_HOME=playground/home CLAUDE_HOME=playground/claude AISQUAD_TMUX_SOCKET=aisquad-dev node server/index.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PG = path.join(ROOT, 'playground');
fs.rmSync(path.join(PG, 'home'), { recursive: true, force: true });
fs.rmSync(path.join(PG, 'claude'), { recursive: true, force: true });
fs.rmSync(path.join(PG, 'floors'), { recursive: true, force: true });
process.env.AISQUAD_HOME = path.join(PG, 'home');
process.env.CLAUDE_HOME = path.join(PG, 'claude');

const { seedDefaults } = await import('../server/roles.js');
const floors = await import('../server/floors.js');
const { projectDir } = await import('../server/transcripts.js');
seedDefaults();
fs.writeFileSync(path.join(PG, 'home', 'pin'), '123456\n', { mode: 0o600 });

const dir = (n) => path.join(PG, 'floors', n);
await floors.createFloor({
  name: 'Acme Coffee Shop', goal: 'Online shop for single-origin coffee beans with subscriptions.', number: 1, layout: 'pods',
  directory: { mode: 'new', path: dir('acme-shop') }, git: { qualityGate: 'npm test' }, budget: { usd: 40, period: 'month' },
  team: [
    { displayName: 'Rina - Project Manager', template: 'project-manager', lead: true },
    { displayName: 'Budi - Fullstack Developer', template: 'fullstack-developer' },
    { displayName: 'Sari - QA Engineer', template: 'qa-engineer' },
    { displayName: 'Dewi - UI/UX Designer', template: 'ui-ux-designer' },
  ],
});
await floors.createFloor({
  name: 'Sopwer HR', goal: 'Frappe HR customisations for leave and payroll.', number: 2, layout: 'rows', workflow: 'squad-sprint',
  directory: { mode: 'new', path: dir('sopwer-hr') },
  team: [
    { displayName: 'Ramdani - Frappe Developer', template: 'frappe-developer', overrides: { model: 'opus', rules: ['Work only in apps/sopwer_hr.'] } },
    { displayName: 'Agus - Frappe Developer', template: 'frappe-developer' },
    { displayName: 'Maya - QA Engineer', template: 'qa-engineer' },
  ],
});
await floors.createFloor({
  name: 'Landing Page', goal: 'Marketing site and SEO.', number: 3, layout: 'circle',
  directory: { mode: 'new', path: dir('landing') },
  team: [{ displayName: 'Tono - SEO Specialist', template: 'seo-specialist' }, { displayName: 'Lia - UI/UX Designer', template: 'ui-ux-designer' }],
});

// synthetic transcripts: Budi working, Sari asking a question, Ramdani working, the rest quiet
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const usage = (k) => ({ input_tokens: 2000 * k, output_tokens: 3000 * k, cache_read_input_tokens: 40000 * k, cache_creation_input_tokens: 5000 * k });
function session(root, agent, id, records) {
  const d = projectDir(root);
  fs.mkdirSync(d, { recursive: true });
  const lines = [{ type: 'agent-setting', agentSetting: agent, sessionId: id }, ...records.map((r) => ({ cwd: root, sessionId: id, ...r }))];
  fs.writeFileSync(path.join(d, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
const tool = (ago, id, name, input, k = 1) => ({ type: 'assistant', timestamp: iso(ago), message: { id, model: 'claude-sonnet-5-5', usage: usage(k), content: [{ type: 'tool_use', id: `t-${id}`, name, input }] } });
const say = (ago, id, text) => ({ type: 'assistant', timestamp: iso(ago), message: { id, model: 'claude-sonnet-5-5', usage: usage(1), content: [{ type: 'text', text }] } });
const task = (ago, text) => ({ type: 'user', timestamp: iso(ago), message: { role: 'user', content: text } });

const acme = dir('acme-shop');
session(acme, 'budi-fullstack-developer', 's-budi', [
  task(900e3, 'Build the product catalogue page with filters for origin and roast.'),
  tool(800e3, 'b1', 'Read', { file_path: `${acme}/src/catalogue.js` }),
  say(700e3, 'b2', 'I will add the filter state to the URL so links can be shared.'),
  tool(400e3, 'b3', 'Edit', { file_path: `${acme}/src/catalogue.js`, old_string: 'const filters = {}', new_string: 'const filters = parseFilters(location.search)' }, 3),
  tool(60e3, 'b4', 'Bash', { command: 'npm test -- catalogue', description: 'Run catalogue tests' }),
  tool(20e3, 'b5', 'SendMessage', { to: 'rina-project-manager', message: 'Catalogue filters are in; tests green. Ready for QA.' }),
  tool(8e3, 'b6', 'Edit', { file_path: `${acme}/src/catalogue.css`, old_string: '.grid {', new_string: '.grid { gap: 16px;' }),
]);
session(acme, 'sari-qa-engineer', 's-sari', [
  task(600e3, 'Verify the checkout flow on mobile.'),
  tool(300e3, 's1', 'Bash', { command: 'npx playwright test checkout', description: 'Run checkout e2e' }, 2),
  tool(120e3, 's2', 'AskUserQuestion', { questions: [{ header: 'Scope', question: 'Should guest checkout be tested too, or only signed-in customers?', options: [{ label: 'Both' }, { label: 'Signed-in only' }] }] }),
]);
session(acme, 'rina-project-manager', 's-rina', [
  task(3600e3, 'Plan the first release.'),
  tool(3500e3, 'r1', 'Write', { file_path: `${acme}/docs/plan.md`, content: '# Plan\n- Catalogue\n- Checkout\n- Subscriptions' }, 4),
  { type: 'assistant', timestamp: iso(3400e3), message: { id: 'r2', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: usage(2), content: [{ type: 'text', text: 'Plan written to docs/plan.md; tasks assigned.' }] } },
]);
const hr = dir('sopwer-hr');
session(hr, 'ramdani-frappe-developer', 's-ramdani', [
  task(500e3, 'Add a Leave Encashment report.'),
  tool(30e3, 'h1', 'Bash', { command: 'bench --site hr.local migrate', description: 'Migrate after DocType change' }, 2),
  tool(10e3, 'h2', 'Edit', { file_path: `${hr}/apps/sopwer_hr/sopwer_hr/report/leave_encashment/leave_encashment.py`, old_string: 'def execute', new_string: 'def execute(filters=None)' }),
]);

// a detected project that is not a Floor yet
const other = path.join(PG, 'floors', 'mobile-app');
fs.mkdirSync(other, { recursive: true });
session(other, '', 's-mobile', [task(7200e3, 'Set up the React Native project.'), say(7100e3, 'm1', 'Done.')]);
console.log(`Playground ready in ${PG} (PIN 123456)`);
