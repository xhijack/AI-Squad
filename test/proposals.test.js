// SPDX-License-Identifier: Apache-2.0
// What the squads learn (1.11): an agent's proposal in its Space becomes a card on the Owner's desk; approving a fact
// pins it in the Company Brain's FACTS.md, a document replaces a Company Brain file, a skill goes to the learned skills
// and into the Space; every earlier version is kept and can be restored; a rejection is answered in the Space;
// invalid, linked, oversized or out-of-bounds proposals are refused; only the Owner decides; agents are told how.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as floors from '../server/floors.js';
import * as squad from '../server/squad.js';
import * as squadLog from '../server/log.js';
import * as proposals from '../server/proposals.js';
import * as context from '../server/context.js';

const root = scratch();
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const call = async (method, url, body, p = pin) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(p ? { 'x-aisquad-pin': p } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const brain = path.join(config.home, 'company');
let S = null, L = null;
const propose = (sp, name, text) => { const d = path.join(sp.root, 'docs', 'squad', 'proposals'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, name), text); };
const card = async (id) => (await call('GET', '/api/building')).body.attention.find((a) => a.kind === 'proposal' && a.proposalId === id);

test('set up: a Sales squad and an Owner-only Legal squad; the agents are told how to propose', async () => {
  await call('POST', '/api/company/init', {});
  const s = await call('POST', '/api/squads', { blueprint: 'sales-crm', name: 'Sales', directory: { mode: 'new', path: path.join(root, 'sales') }, team: [{ template: 'sales-manager', displayName: 'Rina - Sales' }] });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  S = { id: s.body.id, root: s.body.path, agent: floors.readFloor(s.body.path).team.agents[0].id };
  const l = await call('POST', '/api/squads', { blueprint: 'legal', name: 'Legal', directory: { mode: 'new', path: path.join(root, 'legal') }, team: [{ template: 'legal-counsel', displayName: 'Lia - Legal' }] });
  L = { id: l.body.id, root: l.body.path, agent: floors.readFloor(l.body.path).team.agents[0].id };
  const file = fs.readFileSync(path.join(S.root, '.claude', 'agents', `${S.agent}.md`), 'utf8');
  assert.match(file, /docs\/squad\/proposals\//); assert.match(file, /FACTS\.md/);
  assert.match(context.contextLines({ kind: 'project', access: 'team' }, '/b', false).join('\n'), /Never write to the Company Brain yourself/);
});

test('a fact: a card for the Owner, approved into FACTS.md, answered in the Space', async () => {
  propose(S, 'evening.md', `---\nkind: fact\nfrom: ${S.agent}\ntitle: Wedding leads answer best after 19:00\nwhy: 3 of 4 replies came after 19:00\n---\nWedding leads answer best after 19:00.\n`);
  const r = (await squad.handoffTick()).learned;
  assert.equal(r.length, 1); assert.ok(r[0].ok);
  assert.ok(!fs.existsSync(path.join(S.root, 'docs', 'squad', 'proposals', 'evening.md')), 'taken out of the folder');
  const c = await card(r[0].id);
  assert.match(c.text, /Rina - Sales \(Sales\) proposes a company fact: Wedding leads answer best after 19:00/);
  assert.deepEqual(c.options.map((o) => o.n), [1, 2]);
  assert.equal(squadLog.read(S.id, { type: 'proposal.received' }).length, 1);
  assert.equal((await call('POST', `/api/attention/${c.id}/answer`, { option: 1 })).status, 200);
  const facts = fs.readFileSync(path.join(brain, 'FACTS.md'), 'utf8');
  assert.match(facts, /## Pinned\n- Wedding leads answer best after 19:00\. _\(\d{4}-\d\d-\d\d, Sales · Rina - Sales\)_/);
  assert.match(fs.readFileSync(path.join(S.root, 'docs', 'squad', 'proposals', 'answered', `${r[0].id}.md`), 'utf8'), /Approved by Owner/);
  assert.equal(await card(r[0].id), undefined, 'off the desk');
  assert.equal(squadLog.read(S.id, { type: 'proposal.approved' }).length, 1);
});

test('a Company Brain document, edited by the Owner; the old version restored', async () => {
  fs.mkdirSync(path.join(brain, 'sop'), { recursive: true });
  fs.writeFileSync(path.join(brain, 'sop', 'lead-follow-up.md'), '# Lead follow-up\n\nAnswer within a day.\n');
  propose(S, 'sop.md', `---\nkind: brain\nfrom: ${S.agent}\ntitle: Answer leads within 2 hours\ntarget: sop/lead-follow-up.md\nwhy: leads answered later bought less\n---\n# Lead follow-up\n\nAnswer within 2 hours, in the evening for weddings.\n`);
  const [{ id }] = proposals.scan();
  const c = await card(id);
  assert.deepEqual(c.options.map((o) => o.n), [2], 'a document is read in Admin → Learning; no one-tap approve');
  assert.match(c.text, /Admin → Learning/);
  assert.equal((await call('POST', `/api/attention/${c.id}/answer`, { option: 1 })).status, 400);
  const p = (await call('GET', `/api/proposals/${id}`)).body;
  assert.match(p.current, /Answer within a day/); assert.match(p.content, /within 2 hours/);
  assert.equal((await call('POST', `/api/proposals/${id}/approve`, { content: '# Lead follow-up\n\nAnswer within 2 hours.\n' })).status, 200);
  assert.equal(fs.readFileSync(path.join(brain, 'sop', 'lead-follow-up.md'), 'utf8'), '# Lead follow-up\n\nAnswer within 2 hours.\n');
  assert.equal(proposals.get(id).edited, true);
  const v = (await call('GET', '/api/learned/brain/versions?target=sop/lead-follow-up.md')).body;
  assert.equal(v.versions.length, 1);
  assert.match((await call('GET', `/api/learned/brain/version?target=sop/lead-follow-up.md&v=${v.versions[0].version}`)).body.text, /within a day/);
  assert.equal((await call('POST', '/api/learned/brain/restore', { target: 'sop/lead-follow-up.md', version: v.versions[0].version })).status, 200);
  assert.match(fs.readFileSync(path.join(brain, 'sop', 'lead-follow-up.md'), 'utf8'), /within a day/);
  assert.equal(proposals.versions('brain', 'sop/lead-follow-up.md').length, 2, 'the restored-over version is kept too');
  assert.ok(!fs.existsSync(path.join(brain, 'sop', '.history')), 'history is kept outside the Company Brain agents read');
  assert.ok(fs.existsSync(path.join(config.home, 'learned-history', 'brain')));
});

test('a skill: into the learned skills and the Space; to every Space on request; a hand-written skill is left alone', async () => {
  const skill = '---\nname: lead-follow-up\ndescription: "Follow up a lead the same day."\n---\n# Lead follow-up\n\n1. Read the lead.\n2. Answer within 2 hours.\n';
  propose(S, 'skill.md', `---\nkind: skill\nfrom: ${S.agent}\ntitle: Lead follow-up\nskill: lead-follow-up\nwhy: done the same way five times\n---\n${skill}`);
  const [{ id }] = proposals.scan();
  fs.mkdirSync(path.join(L.root, '.claude', 'skills', 'lead-follow-up'), { recursive: true });
  fs.writeFileSync(path.join(L.root, '.claude', 'skills', 'lead-follow-up', 'SKILL.md'), '---\nname: lead-follow-up\ndescription: mine\n---\nhand-written\n');
  const r = (await call('POST', `/api/proposals/${id}/approve`, { scope: 'all' })).body;
  assert.deepEqual(r.installed.map((x) => [x.floorId, x.ok]).sort(), [[L.id, false], [S.id, true]].sort());
  assert.match(fs.readFileSync(path.join(S.root, '.claude', 'skills', 'lead-follow-up', 'SKILL.md'), 'utf8'), /learned: approved by the owner[\s\S]*Answer within 2 hours/);
  assert.match(fs.readFileSync(path.join(L.root, '.claude', 'skills', 'lead-follow-up', 'SKILL.md'), 'utf8'), /hand-written/);
  assert.ok(fs.existsSync(path.join(config.home, 'learned-skills', 'lead-follow-up', 'SKILL.md')));
  const list = (await call('GET', '/api/proposals')).body;
  assert.deepEqual(list.learned.skills.map((x) => [x.name, x.spaces]), [['lead-follow-up', [S.id]]]);
  assert.match(list.learned.facts, /Wedding leads/);
});

test('rejected with a note; refused when invalid, out of bounds, linked or too big', async () => {
  propose(S, 'no.md', `---\nkind: fact\nfrom: ${S.agent}\ntitle: Discounts are 50 %\n---\nAll discounts are 50 %.\n`);
  const [{ id }] = proposals.scan();
  const c = await card(id);
  assert.equal((await call('POST', `/api/attention/${c.id}/answer`, { option: 2, text: 'Discounts are decided per deal' })).status, 200);
  assert.deepEqual([proposals.get(id).status, proposals.get(id).reason], ['rejected', 'Discounts are decided per deal']);
  assert.match(fs.readFileSync(path.join(S.root, 'docs', 'squad', 'proposals', 'answered', `${id}.md`), 'utf8'), /Not taken by Owner: Discounts are decided per deal/);
  propose(S, 'a.md', '---\nkind: rumor\ntitle: x\n---\ny\n');
  propose(S, 'b.md', '---\nkind: brain\ntitle: x\ntarget: ../../etc/passwd.md\n---\ny\n');
  propose(S, 'c.md', '---\nkind: brain\ntitle: Rates\ntarget: finance/rates.md\n---\ny\n');
  propose(S, 'd.md', '---\nkind: skill\ntitle: x\nskill: Bad Name\n---\ny\n');
  propose(S, 'e.md', '---\nkind: skill\ntitle: x\nskill: ok-name\n---\nno header\n');
  propose(S, 'f.md', `---\nkind: fact\ntitle: big\n---\n${'x'.repeat(70 * 1024)}\n`);
  propose(S, 'h.md', '---\nkind: skill\ntitle: x\nskill: ok-name\n---\n---\nname: ok-name\ndescription: d\nallowed-tools: Bash\n---\nbody\n');
  propose(S, 'i.md', '---\nkind: skill\ntitle: x\nskill: propose-learning\n---\n---\nname: propose-learning\ndescription: d\n---\nbody\n');
  fs.writeFileSync(path.join(root, 'hard.md'), '---\nkind: fact\ntitle: hard\n---\nsecret from elsewhere\n');
  fs.linkSync(path.join(root, 'hard.md'), path.join(S.root, 'docs', 'squad', 'proposals', 'j.md'));
  fs.writeFileSync(path.join(root, 'outside.md'), '---\nkind: fact\ntitle: linked\n---\nfrom outside\n');
  fs.symlinkSync(path.join(root, 'outside.md'), path.join(S.root, 'docs', 'squad', 'proposals', 'g.md'));
  const r = proposals.scan();
  assert.deepEqual(r.map((x) => x.ok), Array(9).fill(false));
  assert.match(r.map((x) => x.reason).join('\n'), /kind: fact, brain, skill[\s\S]*target: a \.md file[\s\S]*finance\/ is the Owner's[\s\S]*kebab case[\s\S]*whole SKILL\.md[\s\S]*64 KB/);
  assert.ok(fs.existsSync(path.join(S.root, 'docs', 'squad', 'proposals', 'answered', 'a.invalid.md')), 'the agent sees why');
  assert.match(r.map((x) => x.reason).join('\n'), /allowed-tools[\s\S]*ships with The AI Squad/);
  assert.equal(squadLog.read(S.id, { type: 'proposal.invalid' }).length, 9);
  const ans = path.join(S.root, 'docs', 'squad', 'proposals', 'answered');
  assert.doesNotMatch(fs.readdirSync(ans).filter((n) => n.endsWith('.invalid.md')).map((n) => fs.readFileSync(path.join(ans, n), 'utf8')).join('\n'), /secret from elsewhere|from outside/, 'a refusal never echoes the file');
  assert.ok(fs.existsSync(path.join(root, 'hard.md')), 'a hard-linked file is not touched');
  assert.ok(fs.existsSync(path.join(root, 'outside.md')), 'a linked file is not touched');
  // an Owner-only Space may propose for the Owner's folders
  propose(L, 'rates.md', '---\nkind: brain\ntitle: NDA clause\ntarget: legal/clauses.md\n---\nA clause.\n');
  assert.ok(proposals.scan()[0].ok);
});

test('only the Owner decides and sees the queue; secrets never travel', async () => {
  const member = (await call('POST', '/api/users', { name: 'Dewi', role: 'member' })).body;
  assert.equal((await call('GET', '/api/proposals', null, member.pin)).status, 403);
  const id = proposals.pending()[0].id;
  assert.equal((await call('POST', `/api/proposals/${id}/approve`, {}, member.pin)).status, 403);
  assert.equal((await call('POST', '/api/learned/fact/restore', { target: 'FACTS.md', version: 'x' }, member.pin)).status, 403);
  assert.equal((await call('GET', '/api/building', null, member.pin)).body.attention.some((a) => a.kind === 'proposal'), false, 'not on anyone else\'s desk');
  propose(S, 'key.md', `---\nkind: fact\nfrom: ${S.agent}\ntitle: The API key\n---\nThe key is sk-ant-api03-${'a'.repeat(40)}\n`);
  const [{ id: k }] = proposals.scan();
  assert.doesNotMatch(proposals.get(k).content, /sk-ant-api03-a{40}/);
});
