// SPDX-License-Identifier: Apache-2.0
// Contracts stay DRAFT until the Owner approves them; model tiering picks lighter models for routine background work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as legal from '../server/legal.js';
import * as tiering from '../server/tiering.js';
import * as company from '../server/company.js';

const root = scratch({ seed: false });
const sp = { id: 'legal', name: 'Legal', access: 'owner', blueprint: 'legal', root: path.join(root, 'legal'), agents: [{ id: 'lia-legal', lead: true }] };
const team = { id: 'web', name: 'Web', access: 'team', root: path.join(root, 'web'), agents: [] };
fs.mkdirSync(path.join(sp.root, 'contracts'), { recursive: true }); fs.mkdirSync(path.join(team.root, 'contracts'), { recursive: true });
const logs = [], asked = [];
Object.assign(legal.deps, { spaces: () => [sp, team], log: (f, e) => logs.push({ floorId: f, ...e }), ask: async (x) => { asked.push(x); return { ok: true }; } });
const write = (name, text) => fs.writeFileSync(path.join(sp.root, 'contracts', name), text);
const read = (name) => fs.readFileSync(path.join(sp.root, 'contracts', name), 'utf8');
const doc = (status, extra = '') => `# NDA PT Maju\n\nSTATUS: ${status}\nApproved by the owner on:\n\nPasal 1 ...${extra}\n\n## Legal checklist\n- [x] Agreement: Pasal 2\n- [ ] Authority: board approval unknown\n- [-] Personal data: none\n`;

test('the text: status, fingerprint without the status lines, checklist', () => {
  assert.equal(legal.statusOf(doc('READY FOR REVIEW')), 'READY FOR REVIEW');
  assert.equal(legal.fingerprint(doc('DRAFT')), legal.fingerprint(doc('APPROVED')), 'the status does not change what was approved');
  assert.notEqual(legal.fingerprint(doc('DRAFT')), legal.fingerprint(doc('DRAFT', ' changed')));
  assert.deepEqual(legal.checklistOf(doc('DRAFT')), { present: true, done: 1, open: 1, na: 1, openItems: ['Authority: board approval unknown'] });
  assert.match(legal.setStatus(doc('APPROVED').replace('Approved by the owner on:', 'Approved by the owner on: 2026-10-27'), 'DRAFT'), /STATUS: DRAFT\nApproved by the owner on:\n/);
  assert.equal(legal.isLegal(team), false, 'a team Space with contracts/ is not a Legal Space');
});

test('nothing is APPROVED that the Owner did not approve as it stands', async () => {
  write('2026-10-maju-nda.md', doc('APPROVED'));
  const r = legal.guard();
  assert.deepEqual(r.map((x) => x.reason), ['marked APPROVED without the owner\'s approval']);
  assert.match(read('2026-10-maju-nda.md'), /^STATUS: DRAFT$/m);
  assert.equal(legal.alerts().length, 1);
  assert.ok(logs.some((e) => e.type === 'legal.reverted'));
  // ready for review: a card for this version; approving an older version is refused
  write('2026-10-maju-nda.md', doc('READY FOR REVIEW'));
  const [card] = legal.reviewItems();
  assert.match(card.text, /Contract ready for your approval: NDA PT Maju/);
  assert.match(card.text, /1 done, 1 not applicable, 1 open/);
  write('2026-10-maju-nda.md', doc('READY FOR REVIEW', ' edited'));
  assert.throws(() => legal.approve(card.key, card.hash), /changed after it was shown/);
  const [card2] = legal.reviewItems();
  legal.approve(card2.key, card2.hash, { by: 'Ramdani', now: Date.parse('2026-10-27T03:00:00Z') });
  assert.match(read('2026-10-maju-nda.md'), /STATUS: APPROVED\nApproved by the owner on: 2026-10-27/);
  assert.deepEqual(legal.guard(), [], 'approved as it stands: left alone');
  assert.equal(legal.metrics().approved, 1);
  // changed after approval: a DRAFT again, the approval gone
  write('2026-10-maju-nda.md', read('2026-10-maju-nda.md').replace('Pasal 1 ...', 'Pasal 1 (changed)'));
  assert.deepEqual(legal.guard().map((x) => x.reason), ['changed after the owner approved it']);
  assert.match(read('2026-10-maju-nda.md'), /^STATUS: DRAFT$/m);
  assert.equal(legal.metrics().approved, 0); assert.ok(legal.metrics().revisions >= 1);
});

test('request changes: a DRAFT again and a task for the lead; links are never followed', async () => {
  write('2026-10-sow.md', doc('READY FOR REVIEW'));
  const c = legal.reviewItems().find((x) => x.rel.endsWith('sow.md'));
  await assert.rejects(legal.requestChanges(c.key, ' '), /what has to change/);
  await legal.requestChanges(c.key, 'Liability cap 6 months, not 12.');
  assert.match(read('2026-10-sow.md'), /^STATUS: DRAFT$/m);
  assert.equal(asked.at(-1).agentId, 'lia-legal'); assert.match(asked.at(-1).prompt, /Liability cap 6 months/);
  const outside = path.join(root, 'outside.md'); fs.writeFileSync(outside, doc('APPROVED'));
  fs.symlinkSync(outside, path.join(sp.root, 'contracts', 'link.md'));
  legal.guard();
  assert.match(fs.readFileSync(outside, 'utf8'), /STATUS: APPROVED/, 'a linked file is not touched');
});

test('the Company Brain gets the locked bilingual contract templates', () => {
  const dir = path.join(root, 'company');
  company.ensure(dir);
  const nda = fs.readFileSync(path.join(dir, 'legal', 'templates', 'nda.md'), 'utf8');
  assert.match(nda, /STATUS: TEMPLATE/); assert.match(nda, /teks Bahasa Indonesia yang berlaku/); assert.match(nda, /Nomor 27 Tahun 2022/);
  fs.writeFileSync(path.join(dir, 'legal', 'templates', 'nda.md'), 'my own');
  company.ensure(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'legal', 'templates', 'nda.md'), 'utf8'), 'my own', 'never overwritten');
});

test('model tiering: routine work lighter, Legal pinned, the owner\'s choice kept, cost before and after', () => {
  const on = tiering.cleanTiering({ enabled: true });
  assert.equal(tiering.modelFor({ role: 'lead-researcher' }, tiering.cleanTiering({})), null, 'off by default');
  assert.deepEqual(tiering.modelFor({ role: 'project-manager' }, on), { tier: 'deep', model: 'opus' });
  assert.deepEqual(tiering.modelFor({ role: 'sales-manager', routine: true }, on), { tier: 'light', model: 'haiku' });
  assert.deepEqual(tiering.modelFor({ role: 'lead-researcher', routine: true }, on), { tier: 'light', model: 'haiku' }, 'never below light');
  assert.equal(tiering.modelFor({ role: 'legal-counsel', routine: true }, on), null);
  assert.equal(tiering.modelFor({ role: 'content-writer', ownerModel: true }, on), null);
  const s = { ...on, since: 1000 };
  const jobs = [{ status: 'done', cost: 0.4, createdAt: 10 }, { status: 'done', cost: 0.6, createdAt: 20 }, { status: 'done', cost: 0.2, createdAt: 2000, tier: 'light' }, { status: 'failed', cost: 0.4, createdAt: 3000, tier: 'standard' }, { status: 'running', cost: 1, createdAt: 4000 }];
  const st = tiering.costStats(s, jobs);
  assert.deepEqual([st.before.avg, st.after.avg, st.change], [0.5, 0.3, -40]);
  assert.equal(st.byTier.light.jobs, 1);
});
