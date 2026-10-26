import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, config, paths } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import { flushPending } from '../server/squad.js';

const root = scratch();
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.cjs');
const LOG = path.join(root, 'fake.log');
process.env.FAKE_CLAUDE_LOG = LOG;
configure({ claudeBin: FAKE, useSystemd: false });
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => { server.close(); try { execFileSync('tmux', ['-L', config.tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ } });

async function call(method, url, body, withPin = true) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(withPin ? { 'x-aisquad-pin': pin } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const wait = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((ok) => setTimeout(ok, 150)); } return null; };
const proj = path.join(root, 'playground', 'acme');

test('PIN file is private and required for changes', async () => {
  assert.equal(fs.statSync(paths.pin()).mode & 0o777, 0o600);
  assert.equal((await call('POST', '/api/auth', {}, false)).status, 401);
  assert.equal((await call('POST', '/api/auth', {})).status, 200);
  assert.equal((await call('POST', '/api/floors', { name: 'x' }, false)).status, 401);
});

test('serves the UI and refuses path traversal', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.equal((await fetch(base + '/..%2fpackage.json')).status, 404);
});

test('create a Floor through the wizard API and read it back', async () => {
  const r = await call('POST', '/api/floors', { name: 'Acme', goal: 'Coffee shop', directory: { mode: 'new', path: proj },
    team: [{ displayName: 'Rina - PM', template: 'project-manager', lead: true }, { displayName: 'Budi - Dev', template: 'fullstack-developer' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = (await call('GET', '/api/building')).body;
  assert.deepEqual(b.floors.map((f) => [f.number, f.id]), [[1, 'independents'], [2, 'acme']], 'Floor 1 holds the independent agents');
  assert.equal(b.floors.find((f) => f.id === 'acme').name, 'Acme');
  assert.deepEqual(b.floors.find((f) => f.id === 'acme').agents.map((a) => a.state), ['stopped', 'stopped']);
  assert.equal(b.floors.find((f) => f.id === 'acme').lamp, 'stopped');
  const d = (await call('GET', '/api/floors/acme')).body;
  assert.equal(d.team.length, 2);
  assert.match(d.brief, /Coffee shop/);
  assert.equal((await call('GET', '/api/roles')).body.templates.length, 21);
  assert.equal((await call('GET', '/api/floors/nope')).status, 404);
});

test('QA screenshots are listed and served only from screenshot folders', async () => {
  fs.mkdirSync(path.join(proj, 'docs/squad/qa/screenshots'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'docs/squad/qa/screenshots/M01-cart-390.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(proj, 'secret.png'), 'x');
  const d = (await call('GET', '/api/floors/acme')).body;
  assert.deepEqual(d.shots.map((x) => x.file), ['docs/squad/qa/screenshots/M01-cart-390.png']);
  const r = await fetch(`${base}/api/floors/acme/shot?f=${encodeURIComponent(d.shots[0].file)}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/png/);
  for (const bad of ['secret.png', 'docs/squad/qa/screenshots/../../../secret.png', '.git/config', '/etc/passwd']) assert.equal((await fetch(`${base}/api/floors/acme/shot?f=${encodeURIComponent(bad)}`)).status, 404, bad);
});

test('bad input is a 400 with a message', async () => {
  const r = await call('POST', '/api/floors/acme/agents', { displayName: 'X', template: 'qa-engineer', overrides: { permissions: { allow: ['Bash(*)'] } } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /stricter/);
});

test('start agent with a task: dialog shows in Attention, answering it lets the queued task through', async () => {
  const s = await call('POST', '/api/floors/acme/agents/budi-dev/start', { task: 'Build the catalogue page' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const item = await wait(async () => (await call('GET', '/api/building')).body.attention.find((a) => a.agentId === 'budi-dev'));
  assert.ok(item, 'trust dialog reaches Attention');
  assert.equal(item.kind, 'permission');
  assert.match(fs.readFileSync(LOG, 'utf8'), /START --agent budi-dev --disallowedTools Read\(\.\/\.env\) Read\(\.\/\.env\.\*\) Bash\(git push\*\) Bash\(rm -rf \*\) --model sonnet --effort medium/, 'configured model and effort passed explicitly');
  assert.equal(item.answerable, true);
  const b = (await call('GET', '/api/building')).body;
  assert.equal(b.floors.find((f) => f.id === 'acme').agents.find((a) => a.id === 'budi-dev').state, 'waiting');
  assert.equal(b.floors.find((f) => f.id === 'acme').lamp, 'attention');
  await flushPending();
  assert.ok(!fs.existsSync(LOG) || !fs.readFileSync(LOG, 'utf8').includes('TASK'), 'task is never typed into a dialog');

  assert.equal((await call('POST', `/api/attention/${item.id}/answer`, { option: 1 })).status, 200);
  const typed = await wait(async () => { await flushPending(); return fs.existsSync(LOG) && fs.readFileSync(LOG, 'utf8').includes('TASK Build the catalogue page'); });
  assert.ok(typed, 'queued task typed after the dialog closed');

  const desk = (await call('GET', '/api/floors/acme/agents/budi-dev')).body;
  assert.equal(desk.running, true);
  assert.match(desk.screen, /Build the catalogue page/);
  assert.equal(desk.attach, `tmux -L ${config.tmuxSocket}--aisquad-acme-budi-dev attach -t aisquad-acme-budi-dev`);
  assert.match(desk.work.text, /catalogue/);
  assert.deepEqual([desk.models.configured, desk.models.startedWith, desk.models.restartNeeded], ['sonnet', 'sonnet', false]);
});

test('hook events make the agent live: permission prompt in Attention, Stop ends the turn', async () => {
  const log = fs.readFileSync(LOG, 'utf8');
  assert.match(log, /START .*--plugin-dir \S+/, 'agents start with the plugin hooks');
  assert.match(log, /ENV AISQUAD_AGENT=acme\/budi-dev AISQUAD_URL=http/);
  const post = (event, payload) => call('POST', '/api/events', { event, agent: 'acme/budi-dev', payload });
  assert.equal((await call('POST', '/api/events', { event: 'Stop' }, false)).status, 401, 'events need the PIN');
  await post('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm publish', description: 'Publish' } });
  await post('Notification', { message: 'Claude needs your permission to use Bash' });
  let b = (await call('GET', '/api/building')).body;
  const budi = b.floors.find((f) => f.id === 'acme').agents.find((a) => a.id === 'budi-dev');
  assert.deepEqual([budi.state, budi.live], ['waiting', true]);
  const item = b.attention.find((a) => a.agentId === 'budi-dev' && a.live);
  assert.match(item.text, /permission to use Bash\nnpm publish/);
  await post('PostToolUse', { tool_name: 'Bash' });
  await post('Stop', {});
  b = (await call('GET', '/api/building')).body;
  assert.equal(b.floors.find((f) => f.id === 'acme').agents.find((a) => a.id === 'budi-dev').state, 'idle');
});

test('a turn that ends asking the owner is "Waiting for your reply"; the reply goes to the agent as a task', async () => {
  const { projectDir } = await import('../server/transcripts.js');
  fs.mkdirSync(projectDir(proj), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(projectDir(proj), 'budi.jsonl'), [{ type: 'agent-setting', agentSetting: 'budi-dev' },
    { type: 'user', timestamp: now, message: { content: 'Plan the catalogue' } },
    { type: 'assistant', timestamp: now, message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '**Plan ready.**\n\nNext step: approve the plan or tell me what to change.' }] } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  let b = await wait(async () => { const x = (await call('GET', '/api/building')).body; return x.attention.some((a) => a.kind === 'reply') && x; });
  const item = b && b.attention.find((a) => a.kind === 'reply' && a.agentId === 'budi-dev');
  assert.ok(item, 'reply item in Attention');
  assert.match(item.text, /Next step: approve the plan/);
  assert.equal(b.floors.find((f) => f.id === 'acme').agents.find((a) => a.id === 'budi-dev').state, 'waiting');
  assert.equal(b.floors.find((f) => f.id === 'acme').waitingFor.text, 'Waiting for your reply');
  assert.equal((await call('POST', `/api/attention/${item.id}/answer`, { option: 1, text: '' })).status, 400, 'an empty reply is refused');
  const r = await call('POST', `/api/attention/${item.id}/answer`, { option: 1, text: 'Approved, go ahead' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(await wait(() => fs.readFileSync(LOG, 'utf8').includes('TASK Approved, go ahead')));
  assert.ok(await wait(async () => !(await call('GET', '/api/building')).body.attention.some((a) => a.kind === 'reply')), 'cleared once the owner replied');
});

test('dismissing a reply item keeps it away until the agent asks again', async () => {
  const { projectDir } = await import('../server/transcripts.js');
  const later = new Date(Date.now() + 5000).toISOString();
  fs.appendFileSync(path.join(projectDir(proj), 'budi.jsonl'), [{ type: 'user', timestamp: later, message: { content: 'Approved, go ahead' } },
    { type: 'assistant', timestamp: later, message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Which colour do you want for the buttons?' }] } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const item = await wait(async () => (await call('GET', '/api/building')).body.attention.find((a) => a.kind === 'reply'));
  assert.ok(item);
  assert.equal((await call('POST', `/api/attention/${item.id}/answer`, { option: 0 })).status, 200);
  assert.ok(await wait(async () => !(await call('GET', '/api/building')).body.attention.some((a) => a.kind === 'reply')));
});

test('send a task to a running agent, then stop it', async () => {
  const r = await call('POST', '/api/floors/acme/agents/budi-dev/task', { text: 'Add a price filter' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.queued, false);
  assert.ok(await wait(() => fs.readFileSync(LOG, 'utf8').includes('TASK Add a price filter')));
  assert.equal((await call('POST', '/api/floors/acme/agents/budi-dev/stop', {})).status, 200);
  const b = (await call('GET', '/api/building')).body;
  assert.equal(b.floors.find((f) => f.id === 'acme').agents.find((a) => a.id === 'budi-dev').state, 'stopped');
});

test('the Squad Log records start, hook permission wait, tool call and stop; reading it needs the PIN', async () => {
  assert.equal((await call('GET', '/api/floors/acme/log', null, false)).status, 401);
  const r = await call('GET', '/api/floors/acme/log?agent=budi-dev');
  assert.equal(r.status, 200);
  const types = r.body.events.map((e) => e.type);
  for (const t of ['agent.started', 'permission.asked', 'permission.answered', 'agent.stopped']) assert.ok(types.includes(t), `${t} in ${types}`);
  const started = r.body.events.find((e) => e.type === 'agent.started');
  assert.deepEqual([started.role, started.data.model, started.data.effort], ['fullstack-developer', 'sonnet', 'medium']);
  assert.ok(r.body.categories.includes('communication'));
  assert.deepEqual((await call('GET', '/api/floors/acme/log?type=lifecycle')).body.events.map((e) => e.type).filter((t) => !t.startsWith('agent.')), []);
});

test('audits: settings and history need the PIN; a Free Team Floor has automatic audits off', async () => {
  assert.equal((await call('GET', '/api/floors/acme/audits', null, false)).status, 401);
  const r = (await call('GET', '/api/floors/acme/audits')).body;
  assert.deepEqual([r.audits, r.running, r.settings], [[], null, { auto: false, model: 'sonnet' }]);
  assert.equal((await call('GET', '/api/floors/acme/audits/nope')).status, 404);
  assert.equal((await call('POST', '/api/floors/acme/audits', { sprint: 'x' })).status, 400);
});

test('per-agent commit identity reaches the agent session as git env', async () => {
  assert.equal((await call('PATCH', '/api/floors/acme', { git: { commitIdentity: 'per-agent' } })).status, 200);
  assert.equal((await call('PATCH', '/api/floors/acme/agents/rina-pm', { git: { email: 'rina@sopwer.net' } })).status, 200);
  assert.match(fs.readFileSync(LOG, 'utf8'), /ENV AISQUAD_AGENT=acme\/budi-dev .* GIT_AUTHOR_NAME= /, 'repository default before');
  await call('POST', '/api/floors/acme/agents/rina-pm/start', {});
  assert.ok(await wait(() => /ENV AISQUAD_AGENT=acme\/rina-pm .*GIT_AUTHOR_NAME=Rina - PM GIT_AUTHOR_EMAIL=rina@sopwer.net GIT_COMMITTER_NAME=Rina - PM GIT_COMMITTER_EMAIL=rina@sopwer.net/.test(fs.readFileSync(LOG, 'utf8'))));
  await call('POST', '/api/floors/acme/agents/rina-pm/stop', {});
  await call('PATCH', '/api/floors/acme', { git: { commitIdentity: 'repo-default' } });
});

test('attachments are stored outside the repo and referenced in the task', async () => {
  const r = await fetch(`${base}/api/floors/acme/attachments`, { method: 'POST', headers: { 'x-aisquad-pin': pin, 'x-filename': 'brief.md' }, body: '# Brief' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(j.path.startsWith(paths.attachments()));
  const bad = await fetch(`${base}/api/floors/acme/attachments`, { method: 'POST', headers: { 'x-aisquad-pin': pin, 'x-filename': '.env' }, body: 'SECRET=1' });
  assert.equal(bad.status, 400);
});

test('edit floor layout and number, template update flow over HTTP', async () => {
  assert.equal((await call('PATCH', '/api/floors/acme', { layout: 'circle', number: 3, desks: [{ agent: 'rina-pm', x: 1, z: 1, ry: 0 }] })).status, 200);
  const d = (await call('GET', '/api/floors/acme')).body;
  assert.equal(d.number, 3);
  assert.equal(d.floor.layout, 'circle');
  const t = (await call('GET', '/api/roles/project-manager')).body.template;
  assert.equal((await call('PUT', '/api/roles/project-manager', { ...t, prompt: t.prompt + '\nAlways write a weekly report.' })).body.template.version, 5);
  const b = (await call('GET', '/api/building')).body;
  assert.equal(b.floors.find((f) => f.id === 'acme').updates, 1);
  const diff = (await call('GET', '/api/floors/acme/agents/rina-pm/diff')).body;
  assert.ok(diff.diff.some((l) => l.op === '+' && l.text.includes('weekly report')));
  assert.equal((await call('POST', '/api/floors/acme/agents/rina-pm/template', { action: 'update' })).body.agent.role.version, 5);
});

test('diff between two template versions', async () => {
  const r = await call('GET', '/api/roles/project-manager/diff?from=4&to=5');
  assert.equal(r.status, 200);
  assert.ok(r.body.diff.some((l) => l.op === '+' && l.text.includes('weekly report')));
  assert.equal((await call('GET', '/api/roles/project-manager/diff?from=4&to=9')).status, 404);
  assert.ok((await call('GET', '/api/building')).body.options.projectsDir.endsWith('playground'));
});

test('off loopback every API read needs the PIN; on loopback reads stay open', async () => {
  const { isLoopback } = await import('../server/api.js');
  for (const h of ['127.0.0.1', 'localhost', '::1', '127.0.1.1']) assert.equal(isLoopback(h), true, h);
  for (const h of ['0.0.0.0', '::', '192.168.1.5', '']) assert.equal(isLoopback(h), false, h);
  const open = http.createServer(createHandler({ pin, host: '0.0.0.0' }));
  await new Promise((ok) => open.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${open.address().port}`;
  try {
    for (const p of ['/api/building', '/api/floors/acme', '/api/roles', '/api/watchdog', '/api/libraries', '/api/floors/acme/merges']) {
      assert.equal((await fetch(url + p)).status, 401, p);
      assert.equal((await fetch(url + p, { headers: { 'x-aisquad-pin': pin } })).status, 200, p);
    }
    assert.equal((await fetch(url + '/api/building', { headers: { 'x-aisquad-pin': '000000' } })).status, 401, 'wrong PIN');
    assert.equal((await fetch(url + '/')).status, 200, 'the UI shell itself carries no data');
  } finally { open.close(); }
  assert.equal((await fetch(base + '/api/building')).status, 200, 'loopback server unchanged');
});

test('three.js is served locally from ui/vendor and cached', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /"three": "\.\/vendor\/three\/three\.module\.js"/);
  assert.doesNotMatch(html, /cdn\.jsdelivr|unpkg/);
  for (const p of ['/vendor/three/three.module.js', '/vendor/three/addons/controls/OrbitControls.js', '/vendor/three/addons/renderers/CSS2DRenderer.js', '/vendor/three/addons/geometries/RoundedBoxGeometry.js']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('cache-control'), /immutable/);
  }
});

test('source documents: view and approve only the Blueprint\'s paths; only STATUS and approval lines change', async () => {
  const building = await import('../server/building.js');
  const squadLog = await import('../server/log.js');
  building.setPrefs({ squadsDir: path.join(root, 'squads') });
  const made = await call('POST', '/api/squads', { blueprint: 'software-house', name: 'Docs Kiosk', team: [{ template: 'project-manager', displayName: 'Rina - PM' }, { template: 'fullstack-developer', displayName: 'Budi - Dev' }] });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = made.body.id, dir = made.body.path;
  const list = await call('GET', `/api/floors/${id}/docs`);
  assert.deepEqual(list.body.docs.map((d) => d.path), ['docs/PRD.md', 'docs/TECH.md', 'docs/DESIGN.md', 'docs/ENVIRONMENTS.md']);
  assert.equal(list.body.gate.blocking, true);
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
  for (const bad of ['../../etc/passwd', '.env', 'docs/../.env', 'AISQUAD.md', '/etc/passwd', 'docs/PRD.md/../../.env']) {
    assert.equal((await call('GET', `/api/floors/${id}/docs/text?path=${encodeURIComponent(bad)}`)).status, 404, bad);
    assert.equal((await call('POST', `/api/floors/${id}/docs/approve`, { path: bad })).status, 404, bad);
  }
  assert.equal((await call('GET', `/api/floors/${id}/docs/text?path=docs/PRD.md`, null, false)).status, 401, 'the text needs the PIN');
  const before = fs.readFileSync(path.join(dir, 'docs/ENVIRONMENTS.md'), 'utf8');
  const view = await call('GET', `/api/floors/${id}/docs/text?path=docs/ENVIRONMENTS.md`);
  assert.equal(view.body.text, before);
  const ok = await call('POST', `/api/floors/${id}/docs/approve`, { path: 'docs/ENVIRONMENTS.md' });
  assert.equal(ok.status, 200); assert.equal(ok.body.changed, true);
  const after = fs.readFileSync(path.join(dir, 'docs/ENVIRONMENTS.md'), 'utf8');
  const a = before.split('\n'), b = after.split('\n');
  assert.equal(a.length, b.length, 'no lines added when both lines exist');
  const diff = a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y);
  assert.deepEqual(diff.map(([, y]) => y.replace(/\d+ \w+ \d{4}$/, 'DATE')), ['STATUS: APPROVED', 'Approved by the owner on: DATE']);
  assert.equal(ok.body.docs.find((d) => d.path === 'docs/ENVIRONMENTS.md').status, 'approved');
  assert.equal(ok.body.docs.at(-1).path, 'docs/ENVIRONMENTS.md', 'pending documents first');
  assert.equal((await call('POST', `/api/floors/${id}/docs/approve`, { path: 'docs/ENVIRONMENTS.md' })).body.changed, false, 'approving twice changes nothing');
  assert.equal(squadLog.read(id, { type: 'doc.approved' }).length, 1);
  for (const d of ['PRD', 'TECH', 'DESIGN']) await call('POST', `/api/floors/${id}/docs/approve`, { path: `docs/${d}.md` });
  const fl = await call('GET', `/api/floors/${id}`);
  assert.equal(fl.body.waitingFor, null, 'the gate and the pill update right away');
  // Request changes: the notes go to the lead as a task (the lead starts and gets it queued)
  assert.equal((await call('POST', `/api/floors/${id}/docs/changes`, { path: 'docs/PRD.md', text: '' })).status, 400);
  const ch = await call('POST', `/api/floors/${id}/docs/changes`, { path: 'docs/PRD.md', text: 'Add the refund flow.' });
  assert.equal(ch.status, 200, JSON.stringify(ch.body)); assert.equal(ch.body.lead, 'rina-pm');
  const desk = await call('GET', `/api/floors/${id}/agents/rina-pm`);
  assert.match(desk.body.pending, /changes to the source document docs\/PRD\.md .*Add the refund flow\./);
  await call('POST', `/api/floors/${id}/agents/rina-pm/stop`, {});
});

test('design variants: listed, served sandboxed, picked into DESIGN.md; paths outside the folder refused', async () => {
  const dir = path.join(proj, 'docs/design/variants/rsvp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'variant-a.html'), '<title>Cards</title><p>a</p>');
  fs.writeFileSync(path.join(dir, 'variant-b.html'), '<title>List</title><p>b</p>');
  const list = await call('GET', '/api/floors/acme/designs');
  assert.deepEqual(list.body.groups.map((g) => [g.screen, g.variants.length, g.chosen]), [['rsvp', 2, null]]);
  assert.ok((await call('GET', '/api/building')).body.attention.some((a) => a.kind === 'design' && a.screen === 'rsvp'), 'waits for the owner in Attention');
  const r = await fetch(`${base}/api/floors/acme/designs/rsvp/variant-b.html`, { headers: { 'x-aisquad-pin': pin } });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /^sandbox; default-src 'none'/); assert.match(await r.text(), /<title>List/);
  assert.equal((await fetch(`${base}/api/floors/acme/designs/rsvp/variant-b.html`)).status, 401, 'needs the PIN');
  for (const bad of ['..%2F..%2F.env.html', 'nope.html']) assert.equal((await fetch(`${base}/api/floors/acme/designs/rsvp/${bad}`, { headers: { 'x-aisquad-pin': pin } })).status, 404, bad);
  const p = await call('POST', '/api/floors/acme/designs/rsvp/pick', { file: 'variant-b.html', note: 'denser' });
  assert.equal(p.status, 200); assert.equal(p.body.title, 'List');
  assert.match(fs.readFileSync(path.join(proj, 'docs/DESIGN.md'), 'utf8'), /## Taste notes[\s\S]*rsvp: the owner picked "List" over "Cards"\. Why: denser/);
  assert.equal((await call('GET', '/api/building')).body.attention.some((a) => a.kind === 'design'), false, 'picked: no longer waiting');
});

test('voice: the key is write-only over HTTP; speak returns audio; an agent keeps a voice id', async () => {
  const voice = await import('../server/voice.js');
  delete process.env.ELEVENLABS_API_KEY;
  voice.setFetch(async (url, init) => (url.endsWith('/voices') ? new Response(JSON.stringify({ voices: [] }), { status: 200 }) : new Response(Buffer.from('ID3fake-mp3'), { status: 200 })));
  const KEY = 'sk_api_test_9876543210abcdQRST';
  assert.equal((await call('PUT', '/api/voice/key', { key: KEY }, false)).status, 401, 'needs the PIN');
  const set = await call('PUT', '/api/voice/key', { key: KEY });
  assert.deepEqual(set.body.key, { set: true, last4: 'QRST', source: 'settings' });
  const all = [JSON.stringify(set.body), JSON.stringify((await call('GET', '/api/voice')).body), JSON.stringify((await call('GET', '/api/building')).body)];
  for (const t of all) assert.ok(!t.includes(KEY) && !t.includes(KEY.slice(0, 12)), 'the key never comes back');
  const r = await fetch(`${base}/api/voice/speak`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisquad-pin': pin }, body: JSON.stringify({ floorId: 'acme', agentId: 'rina-pm', kind: 'finished', text: '## Done\n\nAll tests pass.' }) });
  assert.equal(r.headers.get('content-type'), 'audio/mpeg'); assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'ID3fake-mp3');
  const muted = await call('PATCH', '/api/voice', { mutedFloors: ['acme'] });
  assert.deepEqual(muted.body.settings.mutedFloors, ['acme']);
  assert.equal((await call('POST', '/api/voice/speak', { floorId: 'acme', agentId: 'rina-pm', text: 'Hello.' })).body.reason, 'this Floor is muted');
  await call('PATCH', '/api/voice', { mutedFloors: [] });
  assert.equal((await call('PATCH', '/api/floors/acme/agents/rina-pm', { voice: 'AZnzlk1XvdvUeBnXmlld' })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(proj, '.claude/aisquad/team.json'), 'utf8')).agents.find((a) => a.id === 'rina-pm').voice, 'AZnzlk1XvdvUeBnXmlld');
  assert.ok(!fs.readFileSync(path.join(proj, '.claude/aisquad/team.json'), 'utf8').includes(KEY), 'never in the repo');
  assert.deepEqual((await call('DELETE', '/api/voice/key')).body.key, { set: false, last4: '', source: '' });
  voice.setFetch(null);
});
