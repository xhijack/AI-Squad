// SPDX-License-Identifier: Apache-2.0
// Publishing under rules (1.12): an agent's request in docs/squad/outbox/ is checked by the server against the
// Space's rules (owner, review, auto, a limit per day; money and legal, paid tools, ads and production always wait),
// the second reviewer (Claude Code without tools) passes or holds it, the server calls the publishing tool itself and
// keeps the receipt, or tells the agent to deploy; publishing tools are denied to every run of the agents; only the
// Owner decides, one tap from the card; invalid requests (unknown tool, secrets, links) are refused.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';
import * as outbox from '../server/outbox.js';
import * as integ from '../server/integrations.js';
import * as context from '../server/context.js';
import { fakeMcpHttp } from './fixtures/fake-mcp-http.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude-stream.cjs');
const root = scratch();
configure({ claudeBin: FAKE, useSystemd: false, useHooks: false });
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const H = fakeMcpHttp();
const mcpUrl = await H.listen();
after(() => { server.close(); H.close(); });
const call = async (method, url, body, p = pin) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(p ? { 'x-aisquad-pin': p } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const card = async (id) => (await call('GET', '/api/building')).body.attention.find((a) => a.kind === 'outbox' && a.outboxId === id);
let M = null, E = null;
const dir = (sp) => path.join(sp.root, 'docs', 'squad', 'outbox');
const request = (sp, name, text) => { fs.mkdirSync(dir(sp), { recursive: true }); fs.writeFileSync(path.join(dir(sp), name), text); };
const post = (title, args = { from: '2026-11-04', to: '2026-11-05' }, note = 'For the wedding season.') => `---\nchannel: post\nfrom: ${M.agent}\ntitle: ${title}\nvia: postiz\ntool: posts_this_week\n---\n${note}\n\n\`\`\`json\n${JSON.stringify(args)}\n\`\`\`\n`;
const pass = async () => ({ pass: true, problems: [], summary: 'fine' });
const one = async (sp, name, text, ask = pass) => { request(sp, name, text); const [r] = outbox.scan(); await outbox.work({ ask }); return outbox.get(r.id) || r; };

test('set up: a Marketing Space with Postiz (a publishing tool), an Engineering Space; agents are told', async () => {
  await call('POST', '/api/company/init', {});
  const m = await call('POST', '/api/squads', { blueprint: 'sales-crm', name: 'Marketing', directory: { mode: 'new', path: path.join(root, 'mkt') }, team: [{ template: 'sales-manager', displayName: 'Sinta - Marketing' }] });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  M = { id: m.body.id, root: m.body.path, agent: floors.readFloor(m.body.path).team.agents[0].id };
  const e = await call('POST', '/api/squads', { blueprint: 'sales-crm', name: 'Engineering', directory: { mode: 'new', path: path.join(root, 'eng') }, team: [{ template: 'sales-manager', displayName: 'Aul - DevOps' }] });
  E = { id: e.body.id, root: e.body.path, agent: floors.readFloor(e.body.path).team.agents[0].id };
  fs.writeFileSync(path.join(M.root, '.mcp.json'), JSON.stringify({ mcpServers: { postiz: { type: 'http', url: mcpUrl } } }));
  const id = `space:${M.id}:postiz`;
  assert.equal((await call('POST', '/api/integrations/test', { id })).body.tested.ok, true);
  assert.equal((await call('PATCH', '/api/integrations/marks', { id, publish: { posts_this_week: 'tweet' } })).status, 400);
  const mk = await call('PATCH', '/api/integrations/marks', { id, publish: { posts_this_week: 'post', delete_post: 'ad' } });
  assert.deepEqual(mk.body.publish, { posts_this_week: 'post', delete_post: 'ad' });
  // no run of an agent ever gets the publishing tools
  assert.deepEqual(squad.publishRules(M.id).sort(), ['mcp__postiz__delete_post', 'mcp__postiz__posts_this_week']);
  assert.deepEqual(squad.publishRules(E.id), [], 'another Space cannot reach them anyway');
  assert.match(context.contextLines({ kind: 'project', access: 'team' }, '/b', false).join('\n'), /docs\/squad\/outbox\/[\s\S]*Publishing tools are blocked for you/);
  outbox.scan();
  const tools = fs.readFileSync(path.join(dir(M), 'TOOLS.md'), 'utf8');
  assert.match(tools, /\*\*post\*\*: every one waits for the Owner/);
  assert.match(tools, /### post: `via: postiz`, `tool: posts_this_week`[\s\S]*"from"/);
  assert.match(fs.readFileSync(path.join(dir(E), 'TOOLS.md'), 'utf8'), /None yet/);
});

test('owner (the default): held, one tap on the card sends it, with the receipt', async () => {
  const x = await one(M, 'tips.md', post('Five questions before you choose'));
  assert.equal(x.status, 'held');
  const c = await card(x.id);
  assert.match(c.text, /Sinta - Marketing \(Marketing\) wants to send a post: Five questions before you choose \(postiz → posts_this_week\)\nWaiting because every request of this kind waits for you/);
  assert.match(c.text, /"from": "2026-11-04"/);
  assert.deepEqual(c.options.map((o) => o.label), ['Publish it', 'Not now, with a note…']);
  const before = H.calls.filter((k) => k.method === 'tools/call').length;
  assert.equal((await call('POST', `/api/attention/${c.id}/answer`, { option: 1 })).status, 200);
  const done = outbox.get(x.id);
  assert.deepEqual([done.status, done.by, done.auto], ['published', 'Owner', false]);
  assert.match(done.result, /Published 4 posts between 2026-11-04 and 2026-11-05/);
  const sent = H.calls.filter((k) => k.method === 'tools/call');
  assert.equal(sent.length, before + 1);
  assert.deepEqual(sent.at(-1).params, { name: 'posts_this_week', arguments: { from: '2026-11-04', to: '2026-11-05' } }, 'exactly the arguments of the request');
  assert.match(fs.readFileSync(path.join(dir(M), 'answered', `${x.id}.md`), 'utf8'), /Sent \(approved by Owner\) with postiz → posts_this_week[\s\S]*Published 4 posts/);
  assert.equal(await card(x.id), undefined, 'off the desk');
  assert.deepEqual(squadLog.read(M.id, { type: 'publish.done' }).map((ev) => ev.data.id), [x.id]);
});

test('review: passed and sent by the rules, up to the day\'s limit; a problem or a broken reviewer holds it', async () => {
  assert.equal((await call('PUT', `/api/outbox/rules/${M.id}`, { rules: { post: { mode: 'review', perDay: 2 } } })).status, 200);
  assert.match(fs.readFileSync(path.join(dir(M), 'TOOLS.md'), 'utf8'), /\*\*post\*\*: goes out after a second reviewer passes it, at most 2 a day/);
  let x = await one(M, 'a.md', post('Venue checklist'));
  assert.deepEqual([x.status, x.by, x.auto, x.review.pass], ['published', 'rules', true, true]);
  x = await one(M, 'b.md', post('Guest list tips'));
  assert.equal(x.status, 'published');
  x = await one(M, 'c.md', post('Third today'));
  assert.deepEqual([x.status, x.reason], ['held', 'today\'s limit of 2 went out already']);
  outbox.reject(x.id, { reason: 'tomorrow' });
  await call('PUT', `/api/outbox/rules/${M.id}`, { rules: { post: { perDay: 50 } } });
  x = await one(M, 'd.md', post('We are the best in Indonesia', undefined, 'FAKE-FAIL'), outbox.runReview);
  assert.deepEqual([x.status, x.reason], ['held', 'the reviewer found problems']);
  assert.match((await card(x.id)).text, /The reviewer: An unsupported claim/);
  x = await one(M, 'e.md', post('Reviewer down'), async () => { throw new Error('quota'); });
  assert.deepEqual([x.status, x.reason], ['held', 'the reviewer could not run (quota)']);
  x = await one(M, 'f.md', post('Wedding package', { from: 'harga mulai Rp 1.500.000', to: 'x' }));
  assert.deepEqual([x.status, x.reason], ['held', 'it touches money (a hard stop)'], 'money waits even when the reviewer would pass it');
  assert.equal(squadLog.read(M.id, { type: 'publish.reviewed' }).length, 3, 'over the limit, money and a broken reviewer: no review logged');
});

test('auto; ads and production always wait; a failed send is tried again or dropped', async () => {
  assert.equal((await call('PUT', `/api/outbox/rules/${M.id}`, { rules: { post: { mode: 'auto' } } })).status, 200);
  let x = await one(M, 'g.md', post('Straight out'));
  assert.deepEqual([x.status, x.review], ['published', undefined]);
  for (const [c, m] of [['ad', 'auto'], ['message', 'auto'], ['deploy-production', 'auto'], ['deploy-staging', 'review']]) assert.equal((await call('PUT', `/api/outbox/rules/${M.id}`, { rules: { [c]: { mode: m } } })).status, 400, c);
  x = await one(M, 'ad.md', `---\nchannel: ad\nfrom: ${M.agent}\ntitle: Boost\nvia: postiz\ntool: delete_post\n---\n\`\`\`json\n{}\n\`\`\`\n`);
  assert.equal(x.status, 'held');
  assert.deepEqual((await card(x.id)).hardStop, ['money']);
  H.state.mode = 'error';
  x = await one(M, 'h.md', post('Into a wall'));
  assert.deepEqual([x.status, x.error], ['failed', 'postiz: The server answered with an error: quota exceeded']);
  let c = await card(x.id);
  assert.deepEqual(c.options.map((o) => o.label), ['Try again', 'Drop it']);
  H.state.mode = 'ok';
  assert.equal((await call('POST', `/api/attention/${c.id}/answer`, { option: 1 })).status, 200);
  assert.equal(outbox.get(x.id).status, 'published');
  H.state.mode = 'error';
  x = await one(M, 'i.md', post('Dropped'));
  c = await card(x.id);
  assert.equal((await call('POST', `/api/attention/${c.id}/answer`, { option: 2 })).status, 200);
  assert.equal(outbox.get(x.id).status, 'rejected');
  H.state.mode = 'ok';
});

test('deploys: staging by the rules, production only with the Owner\'s go; the agent is woken', async () => {
  const woken = [];
  const wake = outbox.deps.wake;
  outbox.deps.wake = (w) => woken.push(w);
  try {
    const dep = (ch, ref) => `---\nchannel: ${ch}\nfrom: ${E.agent}\ntitle: Release ${ref}\nref: ${ref}\n---\nGuest check-in fix. Tests and QA green. Roll back: the previous tag.\n`;
    let x = await one(E, 's.md', dep('deploy-staging', 'v1.4.2'));
    assert.equal(x.status, 'held', 'staging waits until the rules say otherwise');
    outbox.reject(x.id, {});
    await call('PUT', `/api/outbox/rules/${E.id}`, { rules: { 'deploy-staging': { mode: 'auto' } } });
    x = await one(E, 's2.md', dep('deploy-staging', 'v1.4.2'));
    assert.equal(x.status, 'go');
    assert.equal(woken.length, 1);
    assert.match(woken[0].prompt, /Outbox o-[\w-]+ \(deploy-staging\) is approved: Release v1\.4\.2/);
    x = await one(E, 'p.md', dep('deploy-production', 'v1.4.2'));
    const c = await card(x.id);
    assert.deepEqual([x.status, c.hardStop, c.options[0].label], ['held', ['production'], 'Deploy to production']);
    assert.equal((await call('POST', `/api/attention/${c.id}/answer`, { option: 1 })).status, 200);
    assert.equal(outbox.get(x.id).status, 'go');
    assert.equal(woken.length, 2);
    assert.match(fs.readFileSync(path.join(dir(E), 'answered', `${x.id}.md`), 'utf8'), /Go \(approved by Owner\)/);
  } finally { outbox.deps.wake = wake; }
});

test('refused: unknown channel or tool, a tool of another kind, no json, secrets, links; nothing was sent', async () => {
  const calls = H.calls.filter((k) => k.method === 'tools/call').length;
  request(M, 'a.md', '---\nchannel: tweet\ntitle: x\n---\ny\n');
  request(M, 'b.md', `---\nchannel: post\ntitle: x\nvia: postiz\ntool: nope\n---\n\`\`\`json\n{}\n\`\`\`\n`);
  request(M, 'c.md', `---\nchannel: message\ntitle: x\nvia: postiz\ntool: posts_this_week\n---\n\`\`\`json\n{}\n\`\`\`\n`);
  request(M, 'd.md', `---\nchannel: post\ntitle: x\nvia: postiz\ntool: posts_this_week\n---\nno block\n`);
  request(M, 'e.md', post('Key', { from: `sk-ant-api03-${'a'.repeat(40)}` }));
  request(E, 'f.md', `---\nchannel: deploy-staging\ntitle: x\n---\n`);
  fs.writeFileSync(path.join(root, 'outside.md'), post('Linked'));
  fs.symlinkSync(path.join(root, 'outside.md'), path.join(dir(M), 'g.md'));
  fs.writeFileSync(path.join(root, 'hard.md'), post('Hard linked'));
  fs.linkSync(path.join(root, 'hard.md'), path.join(dir(M), 'h.md'));
  const r = outbox.scan();
  await outbox.work({ ask: pass });
  assert.deepEqual(r.map((x) => x.ok), Array(7).fill(false));
  assert.match(r.map((x) => x.reason).join('\n'), /channel: post, message[\s\S]*not a publishing tool[\s\S]*publishes posts: use channel: post[\s\S]*one ```json block[\s\S]*secret[\s\S]*not a plain file[\s\S]*what goes out/);
  assert.equal(H.calls.filter((k) => k.method === 'tools/call').length, calls);
  assert.ok(fs.existsSync(path.join(root, 'outside.md')) && fs.existsSync(path.join(root, 'hard.md')), 'linked files are not touched');
  assert.equal(squadLog.read(M.id, { type: 'publish.invalid' }).length, 6);
});

test('a Legal Space never sends by itself; only the Owner sees and decides; the marks follow the tools', async () => {
  const l = await call('POST', '/api/squads', { blueprint: 'legal', name: 'Legal', directory: { mode: 'new', path: path.join(root, 'legal') }, team: [{ template: 'legal-counsel', displayName: 'Lia - Legal' }] });
  assert.equal((await call('PUT', `/api/outbox/rules/${l.body.id}`, { rules: { post: { mode: 'review' } } })).status, 400);
  const member = (await call('POST', '/api/users', { name: 'Dewi', role: 'member' })).body;
  assert.equal((await call('GET', '/api/outbox', null, member.pin)).status, 403);
  assert.equal((await call('PUT', `/api/outbox/rules/${M.id}`, { rules: { post: { mode: 'auto' } } }, member.pin)).status, 403);
  const x = await one(M, 'z.md', post('Held for the test', { from: 'harga' }));
  assert.equal((await call('POST', `/api/outbox/${x.id}/approve`, {}, member.pin)).status, 403);
  assert.equal((await call('GET', '/api/building', null, member.pin)).body.attention.some((a) => a.kind === 'outbox'), false);
  const o = (await call('GET', '/api/outbox')).body;
  assert.ok(o.waiting.some((y) => y.id === x.id));
  assert.equal(o.spaces.find((s) => s.id === l.body.id).locked, true);
  assert.equal(o.spaces.find((s) => s.id === M.id).rules.post.mode, 'auto');
  assert.ok(o.recent.length >= 5);
  // a publishing mark is never dropped by a test, failed or not (the agents would get the tool back)
  const id = `space:${M.id}:postiz`;
  H.state.mode = '500';
  await integ.test(id);
  H.state.mode = 'ok';
  assert.equal(squad.publishRules(M.id).length, 2, 'a failed test keeps the marks');
});

test('what an agent could try: a copy of the server, a changed server, a forged queue, a target on the tool, a long text', async () => {
  // a copy of the marked server under another name in the Space's .mcp.json: the same tools are denied
  fs.writeFileSync(path.join(M.root, '.mcp.json'), JSON.stringify({ mcpServers: { postiz: { type: 'http', url: mcpUrl }, 'my.copy': { type: 'http', url: mcpUrl } } }));
  assert.ok(squad.publishRules(M.id).includes('mcp__my_copy__posts_this_week'), 'a copy, with Claude Code\'s spelling of the name');
  // the Owner's own servers are loaded by Claude Code everywhere: denied to a team Space and to a General chat
  fs.writeFileSync(integ.claudeJson(), JSON.stringify({ mcpServers: { 'social-hq': { type: 'http', url: mcpUrl } } }));
  await integ.test('user:social-hq');
  integ.setMarks('user:social-hq', { publish: { posts_this_week: 'post' } });
  assert.ok(squad.publishRules(E.id).includes('mcp__social-hq__posts_this_week'));
  assert.ok(integ.publishRules(null).includes('mcp__social-hq__posts_this_week'));
  assert.ok(squad.publishRules(M.id).includes('mcp__social-hq__posts_this_week'));
  // a publishing tool never feeds a target, and is not read-only at the same time
  assert.throws(() => integ.checkUse({ id: M.id, access: 'team' }, { server: `space:${M.id}:postiz`, tool: 'posts_this_week' }), /publishes/);
  await integ.test(`space:${M.id}:postiz`);
  assert.throws(() => integ.setMarks(`space:${M.id}:postiz`, { readOnly: ['posts_this_week'] }), /cannot be read-only and publishing/);
  // a forged queued item in outbox.json (no approval from this server) is held, not sent
  await call('PUT', `/api/outbox/rules/${M.id}`, { rules: { post: { mode: 'owner' } } });
  const x = await one(M, 'forge.md', post('Forged'));
  const file = path.join(root, 'home', 'outbox.json'), j = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(j.items.find((y) => y.id === x.id), { status: 'queued', by: 'Owner', args: { from: 'something else', to: 'x' } });
  fs.writeFileSync(file, JSON.stringify(j));
  const sent = H.calls.filter((k) => k.method === 'tools/call').length;
  await outbox.work({ ask: pass });
  assert.deepEqual([outbox.get(x.id).status, outbox.get(x.id).reason], ['held', 'its approval was not given by this server (a restart, or the request changed): decide again']);
  assert.equal(H.calls.filter((k) => k.method === 'tools/call').length, sent);
  // what the Owner saw is what is approved: an old digest is refused
  assert.equal((await call('POST', `/api/outbox/${x.id}/approve`, { digest: 'f'.repeat(64) })).status, 400);
  // the server changed after its tools were marked: refused at send time
  fs.writeFileSync(path.join(M.root, '.mcp.json'), JSON.stringify({ mcpServers: { postiz: { type: 'http', url: `${mcpUrl}?other=1` } } }));
  const ch = await call('POST', `/api/outbox/${x.id}/approve`, { digest: outbox.digest(outbox.get(x.id)) });
  assert.deepEqual([ch.body.status, /changed since its publishing tools were marked/.test(ch.body.error)], ['failed', true]);
  outbox.reject(x.id, {});
  fs.writeFileSync(path.join(M.root, '.mcp.json'), JSON.stringify({ mcpServers: { postiz: { type: 'http', url: mcpUrl } } }));
  // a reply cut off: maybe sent, so no one-tap retry
  H.state.mode = 'big';
  const y = await one(M, 'big.md', post('Cut off'));
  await call('POST', `/api/outbox/${y.id}/approve`, { digest: outbox.digest(outbox.get(y.id)) });
  H.state.mode = 'ok';
  assert.deepEqual([outbox.get(y.id).status, outbox.get(y.id).uncertain], ['failed', true]);
  const c = await card(y.id);
  assert.match(c.text, /^Maybe not sent/);
  assert.deepEqual(c.options.map((o) => o.label), ['Drop it']);
  // a text longer than a Telegram message: decided in Admin → Publishing, never one tap
  const z = await one(M, 'long.md', post('Long', { from: 'x'.repeat(700), to: 'y' }));
  const lc = await card(z.id);
  assert.deepEqual(lc.options.map((o) => o.n), [2]);
  assert.match(lc.text, /Read all of it and decide in Admin → Publishing/);
});
