// SPDX-License-Identifier: Apache-2.0
// The admin page and the app's own update (1.10): /admin is served (with its script hash in the CSP and the
// Building's language), behind the sign-in page in public mode; the update check reads a real git checkout against
// its origin (behind, new version, release lines), refuses local changes, local commits and running jobs, fast-
// forwards and asks for a restart; only the Owner reaches it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import { createHandler, forgetOnline } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as building from '../server/building.js';
import * as update from '../server/update.js';

const root = scratch();
const pin = loadPin();
const listen = async (opts) => {
  const s = http.createServer(createHandler({ pin, ...opts }));
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  after(() => s.close());
  return `http://127.0.0.1:${s.address().port}`;
};
const LOCAL = await listen({});
const PUB = await listen({ isPublic: true });
const via = { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https', host: 'squad.example.com' };

test('/admin is the settings page: its own CSP hash, the Building\'s language, no three.js', async () => {
  building.setPrefs({ lang: 'id' });
  const r = await fetch(`${LOCAL}/admin`);
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /<html lang="id" data-lang="id"/);
  assert.match(html, /<script type="module" src="admin-page.js">/);
  assert.doesNotMatch(html, /importmap|three\.module/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self' 'sha256-/, 'the theme script is allowed by its hash');
  assert.equal((await fetch(`${LOCAL}/admin-page.js`)).status, 200);
  const index = await (await fetch(`${LOCAL}/`)).text();
  assert.match(index, /href="\/admin"/, 'the office menu links to it');
  assert.doesNotMatch(index, /data-menu="(people|templates|health|signin|rename)"/, 'settings left the office menu');
});

test('public mode: /admin without a session is the sign-in page', async () => {
  forgetOnline();
  const r = await fetch(`${PUB}/admin`, { headers: via });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /id="loginForm"/);
  assert.equal((await fetch(`${PUB}/admin-page.js`, { headers: via })).status, 401);
});

// a real origin and a checkout of it, like ~/.aisquad-app from install.sh
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const origin = path.join(root, 'origin.git'), work = path.join(root, 'work'), app = path.join(root, 'app');
fs.mkdirSync(origin); git(origin, 'init', '-q', '--bare');
git(root, 'clone', '-q', origin, work);
const commit = (msg, version) => { if (version) fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ version }) + '\n'); else fs.appendFileSync(path.join(work, 'notes.md'), `${msg}\n`); git(work, 'add', '-A'); git(work, 'commit', '-qm', msg); git(work, 'push', '-q', 'origin', 'HEAD:main'); };
commit('chore: release 1.9.0 (online access)', '1.9.0');
git(root, 'clone', '-q', origin, app);
Object.assign(update.deps, { root: () => app, version: () => JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version, running: () => 0 });

test('the check: up to date, then two releases behind with their lines', async () => {
  let st = await update.check({ force: true });
  assert.deepEqual([st.kind, st.current, st.available, st.behind, st.branch], ['git', '1.9.0', false, 0, 'main']);
  commit('feat(ui): the admin page');
  commit('chore: release 1.10.0 (the admin page)', '1.10.0');
  commit('chore: release 1.10.1 (a fix)', '1.10.1');
  assert.equal((await update.check()).available, false, 'cached for 6 hours');
  st = await update.check({ force: true });
  assert.deepEqual([st.available, st.canUpdate, st.behind, st.latest], [true, true, 3, '1.10.1']);
  assert.deepEqual(st.notes, [{ version: '1.10.1', text: 'a fix' }, { version: '1.10.0', text: 'the admin page' }]);
});

test('Update refuses local changes, own commits and running jobs; then fast-forwards and restarts', async () => {
  fs.appendFileSync(path.join(app, 'package.json'), ' ');
  assert.equal((await update.check({ force: true })).reason, 'this checkout has local changes');
  await assert.rejects(update.apply(), /local changes/);
  git(app, 'checkout', '-q', '--', 'package.json');
  update.deps.running = () => 2;
  await assert.rejects(update.apply(), /2 background jobs are running/);
  update.deps.running = () => 0;
  let restarted = 0; update.deps.restart = () => { restarted++; return 'systemd'; };
  const r = await update.apply();
  assert.deepEqual([r.updated, r.from, r.to, r.restart, restarted], [true, '1.9.0', '1.10.1', 'systemd', 1]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version, '1.10.1');
  await assert.rejects(update.apply(), /An update is already running/, 'one update; the server restarts after it');
  assert.equal((await update.check({ force: true })).available, false, 'up to date now');
  git(app, 'commit', '-q', '--allow-empty', '-m', 'local work');
  commit('chore: release 1.10.2', '1.10.2');
  assert.equal((await update.check({ force: true })).reason, 'this checkout has its own commits');
});

test('a plugin install or a plain copy says how to update; only the Owner reaches the routes', async () => {
  assert.equal(update.installKind('/home/x/.claude/plugins/cache/aisquad/aisquad/1.9.0'), 'plugin');
  assert.equal(update.installKind(path.join(root, 'nowhere')), 'other');
  const r = await fetch(`${LOCAL}/api/update`, { headers: { 'x-aisquad-pin': pin } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).kind, 'git');
  const member = await (await fetch(`${LOCAL}/api/users`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisquad-pin': pin }, body: JSON.stringify({ name: 'Dewi', role: 'member' }) })).json();
  for (const [m, p] of [['GET', '/api/update'], ['POST', '/api/update/check'], ['POST', '/api/update']]) assert.equal((await fetch(`${LOCAL}${p}`, { method: m, headers: { 'x-aisquad-pin': member.pin, 'content-type': 'application/json' }, body: m === 'POST' ? '{}' : undefined })).status, 403, `${m} ${p}`);
});
