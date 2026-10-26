// "Waiting for your reply": the text heuristic, trimming, and when an agent counts as waiting for the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksOwner, trimReply, replyWait, finishedReport, REPLY_MAX } from '../server/reply.js';

// shaped like the real case (Software House lead, Indonesian): a status table, assumptions, a next step
const LEAD = `Tech Spec sudah disetujui. Draf Design dan Environments siap kamu tinjau.

| Dokumen | Status | Yang dibutuhkan dari kamu |
|---|---|---|
| \`docs/PRD.md\` | DRAFT | Versi PRD terbaru |
| \`docs/DESIGN.md\` | DRAFT | Tinjau dan setujui |

**Asumsi di ENVIRONMENTS.md**
1. Staging permanen pakai Coolify.
2. Database produksi belum dipilih.
3. Domain usercontent belum terdaftar.

Langkah berikutnya: kirim PRD terbaru, lalu beri tahu apakah draf Design dan Environments disetujui.`;

test('messages that ask the owner for something', () => {
  for (const t of [
    LEAD,
    'I drafted docs/PRD.md. Does the scope look right?',
    'Draft is ready.\n\n**Next steps:** approve DESIGN.md and send the logo.',
    'Two open points:\n- Which payment gateway do you prefer?\n- Is Jakarta hosting required?\n\nI will continue after that.',
    'Please review docs/TECH.md and confirm the stack.',
    'Sprint 2 is blocked on your approval of the PRD.',
    'Mohon cek draf DESIGN.md.',
    'Mana yang kamu pilih, opsi A atau B?',
  ]) assert.equal(asksOwner(t), true, t.slice(0, 60));
});

test('plain reports do not ask', () => {
  for (const t of [
    '',
    'Done. Added the price filter with tests; npm test passes (42 tests).',
    'Sprint 3 closed: M07 and M08 passed QA, RELEASE.md is written and committed.',
    'Semua modul sudah dikirim ke QA dan lulus. Dokumen sudah disetujui.',
    'Fixed the bug in `cart.js` (the total ignored discounts). Why it happened: a rounding step ran twice.',
  ]) assert.equal(asksOwner(t), false, t.slice(0, 60));
});

test('long messages keep their start and their end', () => {
  const t = 'Intro line.\n' + 'x'.repeat(20000) + '\nLast line: please approve?';
  const out = trimReply(t);
  assert.ok(out.length <= REPLY_MAX + 20);
  assert.ok(out.startsWith('Intro line.'));
  assert.ok(out.endsWith('please approve?'));
  assert.match(out, /\[…\]/);
  assert.equal(trimReply('a\n\n\n\nb'), 'a\n\nb');
});

test('replyWait: only an idle agent with its own session, after an ended turn the owner has not answered yet', () => {
  const ts = 1000;
  const base = { running: true, inLead: false, status: { turnOpen: false, reply: { ts, text: 'Which database do you want?' }, ask: null }, work: null, pending: false, dialog: null, busy: false };
  assert.deepEqual(replyWait(base), { ts, text: 'Which database do you want?' });
  assert.equal(replyWait({ ...base, running: false }), null);
  assert.equal(replyWait({ ...base, inLead: true }), null, 'teammates talk to the lead, not the owner');
  assert.equal(replyWait({ ...base, status: { ...base.status, turnOpen: true } }), null, 'working again clears it');
  assert.equal(replyWait({ ...base, work: { assignedAt: ts + 1 } }), null, 'the owner already replied');
  assert.ok(replyWait({ ...base, work: { assignedAt: ts - 1 } }), 'older work does not count');
  assert.equal(replyWait({ ...base, pending: true }), null);
  assert.equal(replyWait({ ...base, status: { ...base.status, ask: { id: 'q' } } }), null, 'an open AskUserQuestion is its own item');
  const report = { ...base, status: { ...base.status, reply: { ts, text: 'Done, tests pass.' } } };
  assert.equal(replyWait(report), null);
  assert.equal(replyWait(report, { gate: true }), null, 'the gate only counts for the lead');
  assert.ok(replyWait(report, { gate: true, isLead: true }), 'a lead blocked by the source document gate waits for the owner');
  assert.equal(replyWait({ ...base, status: { ...base.status, reply: null } }, { gate: true, isLead: true }), null);
});

// shaped like the real case: the ui-ux-designer reporting a design review (findings, questions it answers itself)
const REVIEW = `Design review M162 (premium template) selesai.

**Temuan**
1. Header: padding 16 px, seharusnya 24 px sesuai DESIGN.md.
2. Apakah ikon kalender sudah benar? Ya, sudah sesuai mockup.
3. Warna tombol utama sudah disetujui di DESIGN.md (approved).

**Rekomendasi**
- Tinjau ulang spacing layar RSVP pada 390 px.
- Should we keep the gold accent? Yes, it is fixed in DESIGN.md.

Status: PASS dengan 2 catatan minor. Next steps: fullstack-developer-1 fixes the padding, then QA retests.`;

// shaped like the real case (0.4.2): the DevOps agent, started from its Desk, ends a long report with a question to the PO
const DEVOPS = `## Temuan
- **Server:** dtamu-dev berbagi mesin dengan 6 aplikasi lain; port 8300-8399 bebas.
- **Netlify:** belum ada \`netlify.toml\`. Tolong jangan kirim token lewat chat.

## Langkah berikutnya
1. PM atau PO menjawab K1–K7.
2. \`Dockerfile.api\` perlu masuk ke \`main\`.
3. PO memberi tahu: bolehkah saya mulai dengan sisi server saja (\`ssh\`, siapkan \`~/dtamu-dev\`), sambil menunggu jawaban soal Netlify?`;

test('a report that ends with a question to the owner asks; a review with findings does not', () => {
  assert.equal(asksOwner(DEVOPS), true, 'the DevOps case');
  assert.equal(asksOwner(REVIEW), false, 'questions it answers on the same line are findings');
  assert.equal(asksOwner('Review done. Findings: 3 minor issues, see docs/squad/review/M162.md. Is the contrast enough? It passes WCAG AA.'), false);
  assert.equal(asksOwner('M162 review is ready. Do you want the gold accent kept on the RSVP page?'), true);
  assert.equal(asksOwner('Design review done.\n\nNext steps: fullstack-developer-1 fixes the padding.'), false, '"next steps" for the team is not an ask');
});

test('one card per ended turn: "Waiting for your reply" when it asks, "Finished" otherwise; never for lead-spawned teammates', () => {
  const ts = Date.now() - 60e3;
  const live = (text, extra = {}) => ({ running: true, inLead: false, status: { turnOpen: false, reply: { ts, text }, ask: null }, work: null, pending: false, dialog: null, busy: false, ...extra });
  assert.ok(replyWait(live(DEVOPS))); assert.equal(finishedReport(live(DEVOPS)), null, 'not two cards');
  assert.equal(replyWait(live(REVIEW)), null); assert.deepEqual(finishedReport(live(REVIEW)), { ts, text: REVIEW });
  assert.equal(finishedReport(live(REVIEW, { inLead: true })), null, 'a teammate reports to the lead');
  assert.equal(finishedReport(live(REVIEW, { status: { turnOpen: true, reply: { ts, text: REVIEW } } })), null, 'working again clears it');
  assert.equal(finishedReport(live(REVIEW, { dialog: { options: [] } })), null, 'a dialog is its own item');
  assert.equal(finishedReport(live(REVIEW, { work: { assignedAt: ts + 1 } })), null, 'the owner already gave the next task');
  assert.equal(finishedReport(live(REVIEW), ts + 13 * 3600e3), null, 'old turns are not news');
});
