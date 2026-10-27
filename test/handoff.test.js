// SPDX-License-Identifier: Apache-2.0
// The handoff bus: packages from one Space's outbox to another's inbox, the receiver woken, replies (clarify,
// answer, done), packages leaving an Owner-only Space held for the Owner, quotations to the Owner, the numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as hb from '../server/handoff.js';

const root = scratch({ seed: false });
const mk = (id, number, name, access = 'team', agents = []) => ({ id, number, name, access, root: path.join(root, id), agents });
const SPACES = [
  mk('sales', 2, 'Sales', 'owner', [{ id: 'rina-sales', lead: true }, { id: 'dodi-copy' }]),
  mk('web', 3, 'Website Revamp', 'team', [{ id: 'budi-dev' }, { id: 'sari-pm', lead: true }]),
  mk('mkt', 4, 'Marketing', 'team', [{ id: 'mira-mkt', lead: true }]),
];
for (const sp of SPACES) fs.mkdirSync(sp.root, { recursive: true });
const logs = [], woken = [], owner = [];
Object.assign(hb.deps, {
  spaces: () => SPACES,
  log: (floorId, ev) => logs.push({ floorId, ...ev }),
  wake: async (w) => { woken.push(w); return { ok: true }; },
  ownerItem: async (h) => { owner.push(h.id); },
});
const outbox = (sp, name, text) => { const d = path.join(sp.root, hb.DIR, 'outbox'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, name), text); };
const pkg = (head, body = 'Context and what done means.') => `---\n${Object.entries(head).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}\n`;

test('packages: header, checks, the receiving Space and agent', () => {
  const { meta, body } = hb.parsePackage(pkg({ to: 'Sales', kind: 'opportunity', title: 'Quote for a clinic', erpnext: 'Opportunity/CRM-OPP-2026-00012' }));
  assert.deepEqual(meta, { to: 'Sales', agent: '', kind: 'opportunity', title: 'Quote for a clinic', erpnext: 'Opportunity/CRM-OPP-2026-00012', replyTo: '' });
  assert.equal(body, 'Context and what done means.');
  assert.equal(hb.validate({ ...meta, kind: 'gossip' }, body).startsWith('Unknown kind'), true);
  assert.match(hb.validate({ ...meta, to: 'owner' }, body), /Only a quotation/);
  assert.match(hb.validate({ ...meta, kind: 'quotation', to: 'owner', erpnext: '' }, body), /names its draft/);
  assert.match(hb.validate({ ...meta, kind: 'done', replyTo: '' }, ''), /needs reply-to/);
  assert.equal(hb.validate({ ...meta, kind: 'done', to: '', replyTo: 'h-1' }, ''), '');
  assert.equal(hb.resolveSpace('3').id, 'web'); assert.equal(hb.resolveSpace('floor 4').id, 'mkt'); assert.equal(hb.resolveSpace('website-revamp').id, 'web'); assert.equal(hb.resolveSpace('nope'), null);
  assert.equal(hb.receiverOf(SPACES[1]).id, 'sari-pm', 'the lead');
  assert.equal(hb.receiverOf(SPACES[1], 'budi-dev').id, 'budi-dev');
  assert.equal(hb.receiverOf(SPACES[1], 'ghost'), null);
});

test('a package goes from the outbox to the other Space, the receiver wakes; clarify, answer and done close the thread', async () => {
  const [, web, mkt] = SPACES;
  outbox(mkt, 'landing.md', pkg({ to: 'Website Revamp', agent: 'budi-dev', kind: 'task', title: 'Build the webinar landing page', from: 'mira-mkt' }, 'Copy is in docs/campaigns/webinar.md. Done = page live on staging.\nAPI key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'));
  outbox(mkt, 'broken.md', pkg({ to: 'Nowhere', title: 'x' }));
  const r = await hb.scan();
  assert.equal(r.length, 2);
  const sent = r.find((x) => x.ok); const id = sent.id;
  assert.equal(sent.status, 'delivered');
  assert.ok(fs.existsSync(path.join(mkt.root, hb.DIR, 'outbox', 'broken.md.invalid')), 'a bad package is set aside with the reason');
  assert.match(fs.readFileSync(path.join(mkt.root, hb.DIR, 'outbox', 'broken.md.invalid'), 'utf8'), /Not sent: to: no Space called "Nowhere"/);
  assert.ok(!fs.existsSync(path.join(mkt.root, hb.DIR, 'outbox', 'landing.md')), 'the outbox is emptied');
  assert.ok(fs.existsSync(path.join(mkt.root, hb.DIR, 'sent', `${id}.md`)), 'the sender keeps a copy');
  const inbox = fs.readFileSync(path.join(web.root, hb.DIR, 'inbox', `${id}.md`), 'utf8');
  assert.match(inbox, /from: Marketing/); assert.match(inbox, /from-agent: mira-mkt/);
  assert.doesNotMatch(inbox, /sk-ant-api03/, 'no secrets travel');
  assert.equal(woken.length, 1); assert.equal(woken[0].floorId, 'web'); assert.equal(woken[0].agentId, 'budi-dev');
  assert.match(woken[0].prompt, new RegExp(`Handoff ${id} from Marketing \\(mira-mkt\\)`));
  assert.match(woken[0].prompt, new RegExp(`outbox/${id}-clarify.md`));
  // questions back to the sender
  outbox(web, 'q.md', pkg({ 'reply-to': id, kind: 'clarify', from: 'budi-dev' }, 'Which webinar date goes on the page?'));
  const [q] = await hb.scan({ floorId: 'web' });
  assert.equal(q.status, 'delivered');
  assert.equal(woken.at(-1).floorId, 'mkt'); assert.equal(woken.at(-1).agentId, 'mira-mkt');
  assert.match(woken.at(-1).prompt, new RegExp(`${q.id}-answer.md`));
  assert.equal(hb.get(id).status, 'clarify'); assert.equal(hb.get(id).rounds, 1);
  // the answer goes back to the one who asked
  outbox(mkt, 'a.md', pkg({ 'reply-to': q.id, kind: 'answer', from: 'mira-mkt' }, '14 November, 10:00 WIB.'));
  const [a] = await hb.scan({ floorId: 'mkt' });
  assert.equal(hb.get(a.id).to.floorId, 'web'); assert.equal(woken.at(-1).agentId, 'budi-dev');
  assert.equal(hb.get(id).status, 'delivered');
  // done: filed with the sender, nobody woken
  const n = woken.length;
  outbox(web, 'd.md', pkg({ 'reply-to': a.id, kind: 'done', from: 'budi-dev' }, 'Live on staging: /webinar.'));
  const [d] = await hb.scan({ floorId: 'web' });
  assert.equal(d.status, 'done'); assert.equal(woken.length, n);
  assert.ok(fs.existsSync(path.join(mkt.root, hb.DIR, 'inbox', `${d.id}.md`)));
  assert.equal(hb.get(id).status, 'done'); assert.match(hb.get(id).result, /Live on staging/);
  assert.deepEqual(hb.metrics().withoutClarification, 0);
  assert.ok(logs.some((e) => e.type === 'handoff.received' && e.floorId === 'web'));
  // a reply from a Space the handoff is not about is refused
  outbox(SPACES[0], 'x.md', pkg({ 'reply-to': id, kind: 'done' }, 'not mine'));
  const [x] = await hb.scan({ floorId: 'sales' });
  assert.match(x.reason, /not for this Space/);
});

test('leaving an Owner-only Space waits for the Owner; a quotation goes to the Owner; the Owner answers', async () => {
  const [sales] = SPACES;
  outbox(sales, 'proj.md', pkg({ to: '3', kind: 'project', title: 'Won: clinic ERP', from: 'rina-sales' }, 'Scope: items in Quotation SAL-QTN-2026-00007.'));
  const [h] = await hb.scan({ floorId: 'sales' });
  assert.equal(h.status, 'held');
  assert.ok(!fs.existsSync(path.join(SPACES[1].root, hb.DIR, 'inbox', `${h.id}.md`)), 'not delivered yet');
  const before = woken.length;
  await hb.release(h.id, true, { by: 'Ramdani' });
  assert.equal(hb.get(h.id).status, 'delivered'); assert.equal(hb.get(h.id).approvedBy, 'Ramdani'); assert.equal(woken.length, before + 1);
  await assert.rejects(hb.release(h.id, false), /not held/);
  // a quotation for the price approval
  outbox(sales, 'qt.md', pkg({ to: 'owner', kind: 'quotation', title: 'Clinic ERP, 12 users', erpnext: 'Quotation/SAL-QTN-2026-00007', from: 'rina-sales' }, 'Standard price list, 10 % discount as agreed in the call.'));
  const [qt] = await hb.scan({ floorId: 'sales' });
  assert.equal(qt.status, 'approval'); assert.deepEqual(owner.at(-1), qt.id);
  // sent back with a note: the agent revises and hands it in again
  const back = await hb.ownerReply(qt.id, 'No discount above 5 %.', { kind: 'clarify' });
  assert.equal(back.status, 'delivered');
  assert.equal(woken.at(-1).agentId, 'rina-sales');
  assert.match(woken.at(-1).prompt, /The Owner sent this quotation back/);
  assert.match(woken.at(-1).prompt, new RegExp(`reply-to: ${back.id}`));
  outbox(sales, 'qt2.md', pkg({ 'reply-to': back.id, kind: 'quotation', erpnext: 'Quotation/SAL-QTN-2026-00007', from: 'rina-sales' }, 'Discount now 5 %.'));
  const [qt2] = await hb.scan({ floorId: 'sales' });
  assert.equal(qt2.status, 'approval'); assert.equal(hb.get(qt2.id).thread, qt.id);
  assert.equal(hb.get(qt.id).rounds, 1);
  // the list hides Owner-only Spaces from others
  assert.ok(hb.listFor(new Set(['sales'])).every((x) => x.from.floorId !== 'sales' && x.to.floorId !== 'sales'));
  assert.ok(hb.listFor().some((x) => x.id === qt.id && !('body' in x)));
});

test('a package from the ERPNext watcher; questions about it go to the Owner', async () => {
  const sys = { id: hb.SYSTEM, name: 'ERPNext' };
  const r = await hb.send(sys, '', { to: 'Sales', agent: 'rina-sales', kind: 'lead', title: 'New lead CRM-LEAD-2026-00042', erpnext: 'Lead/CRM-LEAD-2026-00042', replyTo: '' }, 'Qualify it.');
  assert.equal(r.status, 'delivered');
  assert.match(woken.at(-1).prompt, /from ERPNext: lead: New lead/);
  outbox(SPACES[0], 'q.md', pkg({ 'reply-to': r.id, kind: 'clarify', from: 'rina-sales' }, 'Do we sell to hospitals?'));
  const [q] = await hb.scan({ floorId: 'sales' });
  assert.equal(q.status, 'question'); assert.equal(owner.at(-1), q.id);
  const ans = await hb.ownerReply(q.id, 'Yes, private hospitals only.');
  assert.equal(hb.get(ans.id).to.agentId, 'rina-sales'); assert.equal(hb.get(ans.id).kind, 'answer');
  assert.equal(hb.get(q.id).status, 'answered');
});

test('no links, no blocking: linked folders are refused, a broken header does not stop the others, replies only from the receiver of an open package', async () => {
  const [sales, web, mkt] = SPACES;
  // an outbox that is a link to another Space's outbox is not read
  const other = path.join(root, 'elsewhere'); fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'steal.md'), pkg({ to: 'Website Revamp', title: 'x' }));
  const linked = { ...mk('lnk', 9, 'Linked', 'team', [{ id: 'eve' }]) }; fs.mkdirSync(path.join(linked.root, hb.DIR), { recursive: true });
  fs.symlinkSync(other, path.join(linked.root, hb.DIR, 'outbox'));
  assert.deepEqual(hb.outboxFiles(linked.root), []);
  assert.ok(fs.existsSync(path.join(other, 'steal.md')), 'nothing renamed or moved there');
  // a sent/ folder that is a link: the package is refused, nothing written through it
  const target = path.join(root, 'claude-rules'); fs.mkdirSync(target);
  fs.mkdirSync(path.join(mkt.root, hb.DIR), { recursive: true });
  fs.rmSync(path.join(mkt.root, hb.DIR, 'sent'), { recursive: true, force: true });
  fs.symlinkSync(target, path.join(mkt.root, hb.DIR, 'sent'));
  outbox(mkt, 'via-link.md', pkg({ to: '3', title: 'Through a link' }));
  const [l] = await hb.scan({ floorId: 'mkt' });
  assert.equal(l.ok, false); assert.match(l.reason, /plain folder/);
  assert.deepEqual(fs.readdirSync(target), []);
  fs.rmSync(path.join(mkt.root, hb.DIR, 'sent'));
  // a header that cannot be read is set aside; the next package still goes
  outbox(mkt, 'a-broken.md', '---\nto: [unclosed\n  - : :\n---\nbody\n');
  outbox(mkt, 'b-fine.md', pkg({ to: '3', title: 'Fine one' }));
  const r = await hb.scan({ floorId: 'mkt' });
  assert.ok(r.some((x) => x.ok && x.status === 'delivered'), JSON.stringify(r));
  // replies: not to a held package, not by its sender
  outbox(sales, 'held.md', pkg({ to: '3', kind: 'project', title: 'Held one' }));
  const [held] = await hb.scan({ floorId: 'sales' });
  assert.equal(held.status, 'held');
  outbox(web, 'q.md', pkg({ 'reply-to': held.id, kind: 'clarify' }, 'jump the hold'));
  const [q] = await hb.scan({ floorId: 'web' });
  assert.match(q.reason, /not open for replies \(held\)/);
  assert.equal(hb.get(held.id).status, 'held');
  const own = r.find((x) => x.ok).id;
  outbox(mkt, 'own.md', pkg({ 'reply-to': own, kind: 'done' }, 'closing my own'));
  const [o] = await hb.scan({ floorId: 'mkt' });
  assert.match(o.reason, /not for this Space/);
  // members and viewers see nothing of the Owner's desk
  assert.ok(!hb.listFor(new Set(), { owner: false }).some((h) => h.kind === 'quotation' || h.to?.floorId === hb.OWNER || h.from.floorId === hb.OWNER));
});
