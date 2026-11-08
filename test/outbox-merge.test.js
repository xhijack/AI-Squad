// SPDX-License-Identifier: Apache-2.0
// Merges through the Outbox (1.17): an agent asks to merge its own branch of a linked repository; the server pushes
// the branch for the Owner to read, holds it with the commits, the files and the compare link (at once on Telegram,
// with a button to the change), and after the Owner's yes merges exactly that commit into the main branch and pushes
// it. A branch that moved goes back to the Owner; someone else's branch, a read-only repository or a conflict is not
// merged, and the agent is told why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import * as building from '../server/building.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import * as outbox from '../server/outbox.js';
import * as notify from '../server/notify.js';
import { createSquad } from '../server/setup.js';

const root = scratch();
configure({ useSystemd: false, useHooks: false });
building.setPrefs({ squadsDir: path.join(root, 'squads') });
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
const remote = path.join(root, 'site.git'), site = path.join(root, 'squads', 'site');
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
execFileSync('git', ['clone', '-q', remote, site]);
fs.writeFileSync(path.join(site, 'index.html'), '<title>Old</title>\n'); g(site, 'add', '.'); g(site, 'commit', '-qm', 'start'); g(site, 'push', '-q', 'origin', 'main');

const r = await createSquad({ blueprint: 'seo-geo', name: 'Search', team: [{ template: 'seo-geo-strategist', displayName: 'Lead', lead: true }, { template: 'web-developer', displayName: 'Dodi' }, { template: 'content-writer', displayName: 'Wulan' }] });
const S = { id: r.id, root: r.path }, ids = floors.readFloor(r.path).team.agents.map((a) => a.id), [lead, web, writer] = ids;
floors.updateRepos(r.path, [{ id: 'site', path: '../site', access: 'write', agents: [web] }]);
const ask = (name, branch, from = web, title = 'K1: titles and meta') => {
  const d = path.join(S.root, 'docs', 'squad', 'outbox'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), `---\nchannel: merge\nfrom: ${from}\ntitle: ${title}\nrepo: site\nbranch: ${branch}\n---\nNew titles for the home page; npm run build passed.\n`);
  const [x] = outbox.scan(); return x;
};
const branch = (name, file, text, msg) => { g(site, 'checkout', '-q', '-B', name, 'main'); fs.writeFileSync(path.join(site, file), text); g(site, 'add', '.'); g(site, 'commit', '-qm', msg); g(site, 'checkout', '-q', 'main'); };
const remoteHas = (ref) => { try { return g(remote, 'rev-parse', '-q', '--verify', ref); } catch { return ''; } };
const answerOf = (id) => fs.readFileSync(path.join(S.root, 'docs', 'squad', 'outbox', 'answered', `${id}.md`), 'utf8');

test('asked: the branch is pushed for review and held with its commits, files and notes; the agents know how', async () => {
  branch(`${web}/k1-meta`, 'index.html', '<title>ERPNext consultant | Sopwer</title>\n', 'feat(seo): K1 titles');
  const x = ask('k1.md', `${web}/k1-meta`);
  assert.match(fs.readFileSync(path.join(S.root, 'docs', 'squad', 'outbox', 'TOOLS.md'), 'utf8'), /\*\*merge\*\*: every one waits for the Owner \(with `repo:` and `branch:`/);
  assert.equal(x.ok, true);
  assert.equal(outbox.get(x.id).status, 'preparing', 'nothing is shown before the branch is pushed');
  await outbox.work();
  const rec = outbox.get(x.id);
  assert.equal(rec.status, 'held');
  assert.equal(rec.ref, g(site, 'rev-parse', `${web}/k1-meta`), 'the exact commit the Owner sees');
  assert.equal(remoteHas(`refs/heads/${web}/k1-meta`), rec.ref, 'pushed for the Owner to read');
  assert.deepEqual([rec.merge.count, rec.merge.files, rec.merge.pushed], [1, ['index.html'], true]);
  const c = outbox.card(rec);
  assert.match(c.text, new RegExp(`asks to merge ${web}/k1-meta into main \\(site\\): K1: titles and meta[\\s\\S]*1 commit, 1 file changed[\\s\\S]*feat\\(seo\\): K1 titles[\\s\\S]*Files: index.html[\\s\\S]*npm run build passed`));
  assert.deepEqual(c.options.map((o) => o.label), ['Merge it', 'Not now, with a note…']);
  assert.equal(c.full, true, 'one tap: the change itself is read on the forge');
  assert.equal(remoteHas('refs/heads/main'), g(site, 'rev-parse', 'main'), 'main untouched until the Owner says yes');
});

test('Telegram: at once, with the commits and a button to the change', () => {
  const item = squad.buildingSnapshot().attention.find((a) => a.kind === 'outbox' && a.channel === 'merge');
  assert.ok(item, 'a card for the Owner');
  const m = notify.messageFor({ ...item, url: 'https://github.com/sopwer/site/compare/main...x' }, 'tok1', { ...notify.DEFAULTS, lang: 'id' }, new Set());
  assert.match(m.text, /^\[Merge\] Search/);
  assert.match(m.text, /feat\(seo\): K1 titles/);
  assert.ok(m.buttons.flat().some((b) => b.data === 'a:tok1:1'), 'Merge it, one tap');
  assert.ok(m.buttons.flat().some((b) => b.url === 'https://github.com/sopwer/site/compare/main...x' && b.text === 'Lihat perubahan'));
  assert.equal(outbox.compareUrl('git@github.com:xhijack/sopwer-landing-page.git', 'main', 'web-developer/k1'), 'https://github.com/xhijack/sopwer-landing-page/compare/main...web-developer/k1');
  assert.equal(outbox.compareUrl('https://gitlab.com/a/b.git', 'develop', 'x/y'), 'https://gitlab.com/a/b/-/compare/develop...x/y');
});

test('the Owner says yes: that commit is merged into main and pushed; the agent reads it', async () => {
  const rec = outbox.load().find((x) => x.channel === 'merge' && x.status === 'held');
  const done = await outbox.approve(rec.id, { by: 'Owner', seen: outbox.digest(rec) });
  assert.equal(done.status, 'published', done.error);
  assert.match(done.result, new RegExp(`${web}/k1-meta merged into main \\([0-9a-f]{7}\\) and pushed`));
  assert.equal(remoteHas('refs/heads/main'), g(site, 'rev-parse', 'main'), 'main pushed');
  assert.match(g(remote, 'show', 'main:index.html'), /ERPNext consultant/);
  assert.match(answerOf(rec.id), /Merged \(approved by Owner\)/);
});

test('a branch that moved after the push goes back to the Owner; it is merged only as seen again', async () => {
  branch(`${web}/t3-redirect`, 'redirects.txt', '/old /new\n', 'fix(seo): T3 redirect');
  const x = ask('t3.md', `${web}/t3-redirect`, web, 'T3: redirect');
  await outbox.work();
  const seen = outbox.get(x.id);
  g(site, 'checkout', '-q', `${web}/t3-redirect`); fs.writeFileSync(path.join(site, 'redirects.txt'), '/old /newer\n'); g(site, 'commit', '-qam', 'later change'); g(site, 'checkout', '-q', 'main');
  const again = await outbox.approve(seen.id, { by: 'Owner', seen: outbox.digest(seen) });
  assert.equal(again.status, 'held', 'shown again with the new commit');
  assert.notEqual(again.ref, seen.ref);
  assert.equal(again.merge.count, 2);
  assert.doesNotMatch(g(remote, 'show', 'main:index.html'), /redirects/);
  assert.equal((await outbox.approve(again.id, { by: 'Owner', seen: outbox.digest(again) })).status, 'published');
  assert.equal(g(remote, 'show', 'main:redirects.txt'), '/old /newer');
});

test('refused: someone else\'s branch, an agent not on the repository, nothing to merge; a conflict fails and wakes the agent', async () => {
  branch('feature/other', 'x.txt', 'x\n', 'other');
  let x = ask('a.md', 'feature/other'); await outbox.work();
  assert.equal(outbox.get(x.id).status, 'rejected'); assert.match(answerOf(x.id), /only a branch of your own/);
  x = ask('b.md', `${writer}/x`, writer); await outbox.work();
  assert.match(answerOf(x.id), /does not commit in site/);
  g(site, 'branch', '-q', `${web}/empty`, 'main');
  x = ask('c.md', `${web}/empty`); await outbox.work();
  assert.match(answerOf(x.id), /has nothing that main does not have/);
  // a conflict: main moved on the forge meanwhile
  branch(`${web}/clash`, 'index.html', '<title>Mine</title>\n', 'mine');
  x = ask('d.md', `${web}/clash`); await outbox.work();
  const other = path.join(root, 'other'); execFileSync('git', ['clone', '-q', remote, other]);
  fs.writeFileSync(path.join(other, 'index.html'), '<title>Theirs</title>\n'); g(other, 'commit', '-qam', 'theirs'); g(other, 'push', '-q', 'origin', 'main');
  const woken = []; const wake = outbox.deps.wake; outbox.deps.wake = (w) => woken.push(w);
  const held = outbox.get(x.id), f = await outbox.approve(held.id, { by: 'Owner', seen: outbox.digest(held) });
  outbox.deps.wake = wake;
  assert.equal(f.status, 'failed');
  assert.match(f.error, /Merge conflicts: index.html/);
  assert.match(answerOf(x.id), /Bring your branch up to date with main/);
  assert.equal(woken[0]?.agentId, web);
  assert.equal(g(remote, 'show', 'main:index.html'), '<title>Theirs</title>', 'the forge keeps what it had');
  assert.equal(outbox.card(f).options[0].label, 'Try again');
});
