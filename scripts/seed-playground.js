#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
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
(await import('../server/building.js')).setPrefs({ squadsDir: path.join(PG, 'squads') });   // Set up Squad creates folders here, never in the real home
fs.rmSync(path.join(PG, 'squads'), { recursive: true, force: true });

const dir = (n) => path.join(PG, 'floors', n);
await floors.createFloor({
  name: 'Acme Coffee Shop', goal: 'Online shop for single-origin coffee beans with subscriptions.', number: 2, layout: 'pods',
  directory: { mode: 'new', path: dir('acme-shop') }, git: { qualityGate: 'npm test' }, budget: { usd: 40, period: 'month' },
  team: [
    { displayName: 'Rina - Project Manager', template: 'project-manager', lead: true },
    { displayName: 'Budi - Fullstack Developer', template: 'fullstack-developer' },
    { displayName: 'Sari - QA Engineer', template: 'qa-engineer' },
    { displayName: 'Dewi - UI/UX Designer', template: 'ui-ux-designer' },
  ],
});
await floors.createFloor({
  name: 'Sopwer HR', goal: 'Frappe HR customisations for leave and payroll.', number: 3, layout: 'rows', workflow: 'squad-sprint',
  directory: { mode: 'new', path: dir('sopwer-hr') },
  team: [
    { displayName: 'Lina - Sprint Lead', template: 'sprint-lead', lead: true },
    { displayName: 'Ramdani - Frappe Developer', template: 'frappe-developer', overrides: { model: 'opus', rules: ['Work only in apps/sopwer_hr.'] } },
    { displayName: 'Agus - Frappe Developer', template: 'frappe-developer' },
    { displayName: 'Dian - Frappe Developer', template: 'frappe-developer' },
    { displayName: 'Maya - QA Engineer', template: 'qa-engineer' },
  ],
});
await floors.createFloor({
  name: 'Landing Page', goal: 'Marketing site and SEO.', number: 4, layout: 'circle',
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

session(hr, 'agus-frappe-developer', 's-agus', [task(2 * 864e5, 'Build the Leave Policy DocType.'), tool(2 * 864e5 - 60e3, 'g1', 'Edit', { file_path: `${hr}/apps/sopwer_hr/leave_policy.py`, old_string: 'x', new_string: 'y' }, 6)]);
session(hr, 'maya-qa-engineer', 's-maya', [task(1.5 * 864e5, 'Test M01 and M02.'), tool(1.5 * 864e5 - 60e3, 'q1', 'Bash', { command: 'bench run-tests --app sopwer_hr', description: 'Run tests' }, 3)]);

// Squad Sprint history for the performance dialog: sprint 1 closed a day ago, sprint 2 running, a backlog
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(hr, rel)), { recursive: true }); fs.writeFileSync(path.join(hr, rel), text); };
const plan = (rows) => `| Module | Stories | SP | Owner | Owned folders | Depends on | Status |\n|---|---|---|---|---|---|---|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
put('docs/squad/sprint-1/PLAN.md', plan([['M01 Leave Policy', 'HR-1', '5', 'agus-frappe-developer', 'leave_policy', '—', 'DONE'], ['M02 Leave Balance', 'HR-2', '3', 'ramdani-frappe-developer', 'leave_balance', 'M01', 'DONE']]));
put('docs/squad/sprint-1/qa/M01.md', 'STATUS: PASS\nRound: 2\nTester: maya-qa-engineer\n');
put('docs/squad/sprint-1/qa/M02.md', 'STATUS: PASS\nRound: 1\nTester: maya-qa-engineer\n');
put('docs/squad/sprint-1/bugs/M01-B01.md', 'STATUS: VERIFIED\nOWNER: agus-frappe-developer\nSEVERITY: Major\n');
put('docs/squad/sprint-1/bugs/M01-B02.md', 'STATUS: VERIFIED\nOWNER: agus-frappe-developer\nSEVERITY: Minor\n');
const { execFileSync } = await import('node:child_process');
const when = new Date(Date.now() - 864e5).toISOString();
const genv = { ...process.env, GIT_AUTHOR_NAME: 'Seed', GIT_AUTHOR_EMAIL: 'seed@aisquad.local', GIT_COMMITTER_NAME: 'Seed', GIT_COMMITTER_EMAIL: 'seed@aisquad.local', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
execFileSync('git', ['-C', hr, 'add', '-A'], { env: genv });
execFileSync('git', ['-C', hr, 'commit', '-qm', 'docs(squad): close sprint 1'], { env: genv });
put('.claude/squad/config.sh', fs.readFileSync(path.join(hr, '.claude/squad/config.sh'), 'utf8').replace(/^SPRINT=.*$/m, 'SPRINT="2"'));
put('docs/squad/PLAN.md', plan([['M03 Leave Encashment report', 'HR-3', '3', 'ramdani-frappe-developer', 'report', '—', 'BUILD'], ['M04 Payroll export', 'HR-4', '5', 'agus-frappe-developer', 'payroll', 'M03', 'TODO']]));
put('docs/squad/TASKS.md', '| Task | Owner | Blocked by | Status |\n|---|---|---|---|\n| BUILD M03 Leave Encashment report | ramdani-frappe-developer | — | IN_PROGRESS |\n| QA M03 Leave Encashment report | maya-qa-engineer | BUILD M03 | TODO |\n| BUILD M04 Payroll export | agus-frappe-developer | M03 | TODO |\n| QA M04 Payroll export | maya-qa-engineer | BUILD M04 | TODO |\n');
put('docs/BACKLOG.md', '| Story | SP | Status |\n|---|---|---|\n| HR-1 Leave policy | 5 | DONE |\n| HR-5 Attendance import | 8 | TODO |\n| HR-6 Shift roster | 5 | TODO |\n');

// a detected project that is not a Floor yet
const other = path.join(PG, 'floors', 'mobile-app');
fs.mkdirSync(other, { recursive: true });
session(other, '', 's-mobile', [task(7200e3, 'Set up the React Native project.'), say(7100e3, 'm1', 'Done.')]);
console.log(`Playground ready in ${PG} (PIN 123456)`);
