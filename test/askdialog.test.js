// AskUserQuestion with several questions and multi-select (1.0.1): the screen parser, the key builder, and a round
// trip through a fake dialog in a real tmux pane (driven exactly as the owner's answers drive Claude Code).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as ask from '../server/askdialog.js';

const SCREEN = `────────────────────────────────────────────────
←  ☒ Protokol  ☐ Full custom  ☐ Efek suara  ✔ Submit  →
│ Apa saja yang termasuk "protokol tamu" ... ?
❯ 1. [✔] Link bernama tamu
         Tiap tamu dapat link pribadi.
  2. [ ] Sampul tertutup
  3. [ ] RSVP dan ucapan
  4. [ ] QR check-in
  5. [ ] Type something
     Next
────────────────────────────────────────────────
  6. Chat about this
Enter to select · Tab/Arrow keys to navigate · Esc to cancel`;

test('the tab bar, the options with their checks, the cursor and the Next row', () => {
  const s = ask.parseAsk(SCREEN);
  assert.deepEqual(s.tabs, [{ label: 'Protokol', answered: true }, { label: 'Full custom', answered: false }, { label: 'Efek suara', answered: false }]);
  assert.equal(s.submit, true); assert.equal(s.review, false); assert.equal(s.multi, true);
  assert.match(s.question, /^Apa saja yang termasuk "protokol tamu"/);
  assert.deepEqual(s.options.map((o) => [o.n, o.label, o.checked]), [[1, 'Link bernama tamu', true], [2, 'Sampul tertutup', false], [3, 'RSVP dan ucapan', false], [4, 'QR check-in', false], [5, 'Type something', false]], '"Chat about this" is not an answer');
  assert.equal(s.cursor, 1); assert.equal(s.nextRow, 'Next');
  const single = ask.parseAsk('←  ☒ A  ☐ B  ✔ Submit  →\nFull custom design?\n❯ 1. Yes (Recommended)\n     Allow it.\n  2. No\n  3. Type something.\n──────\n  4. Chat about this\nEnter to select');
  assert.deepEqual([single.multi, single.options.length, single.cursor, single.nextRow], [false, 3, 1, null]);
  const review = ask.parseAsk('←  ☒ A  ☒ B  ✔ Submit  →\nReview your answers\n ● A?\n   → x\nReady to submit your answers?\n❯ 1. Submit answers\n  2. Cancel');
  assert.deepEqual([review.review, review.cursor, review.options.map((o) => o.label)], [true, 1, ['Submit answers', 'Cancel']]);
  assert.equal(ask.parseAsk('❯ 1. Yes\n  2. No\nEnter to select'), null, 'no tab bar: not this kind of dialog');
});

test('keys for 1..4 questions: single choice, multi-select toggles only what differs, free text, Next', () => {
  const st = (cursor, checked = [], k = 4, multi = true) => ({ cursor, multi, options: Array.from({ length: k + 1 }, (_, i) => ({ n: i + 1, checked: checked.includes(i + 1) })) });
  assert.deepEqual(ask.questionKeys(st(1, [], 2, false), 2, { choices: [2] }, { multi: false }), ['Down', 'Enter']);
  assert.deepEqual(ask.questionKeys(st(2, [], 2, false), 2, { text: 'Only at check-in' }, { multi: false }), ['Down', { text: 'Only at check-in' }, 'Enter']);
  // the screen above: 1 is checked; the owner wants 1 and 3 and a free text
  assert.deepEqual(ask.questionKeys(st(1, [1]), 4, { choices: [1, 3], text: 'Foto tamu' }), ['Down', 'Down', 'Enter', 'Down', 'Down', { text: 'Foto tamu' }, 'Down', 'Enter']);
  assert.deepEqual(ask.questionKeys(st(1, [1, 2]), 4, { choices: [2] }), ['Enter', 'Down', 'Down', 'Down', 'Down', 'Down', 'Enter'], 'unchecks 1, keeps 2, then Next');
  assert.deepEqual(ask.questionKeys(st('next', [5]), 4, { choices: [4] }), ['Up', 'Up', 'Enter', 'Down', 'Enter', 'Down', 'Enter'], 'a typed answer no longer wanted is unchecked');
  assert.throws(() => ask.questionKeys(st(1, [], 2, false), 2, {}, { multi: false }), /Pick an option/);
  assert.deepEqual(ask.tmuxCalls(['Down', 'Enter', { text: 'a b' }, 'Down']), [['Down', 'Enter'], ['-l', 'a b'], ['Down']]);
});

// ---------- round trip in a real tmux pane ----------
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-ask.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisquad-ask-'));
const SOCK = `aisquad-test-ask-${process.pid}`, LOG = path.join(dir, 'answers.log');
const tmux = (...a) => { try { return execFileSync('tmux', ['-L', SOCK, ...a], { encoding: 'utf8' }); } catch { return ''; } };
after(() => { tmux('kill-server'); fs.rmSync(dir, { recursive: true, force: true }); });
let n = 0;
function open(questions) {
  const f = path.join(dir, `q${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(questions));
  const name = `ask${n}`;
  tmux('new-session', '-d', '-s', name, '-x', '160', '-y', '50', '-e', `FAKE_ASK_LOG=${LOG}`, process.execPath, FAKE, f);
  return { name, io: { send: async (keys) => { for (const c of ask.tmuxCalls(keys)) tmux('send-keys', '-t', name, ...c); }, capture: async () => (tmux('capture-pane', '-p', '-t', name).includes('SUBMITTED') ? '' : tmux('capture-pane', '-p', '-t', name)), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) } };
}
const lastAnswer = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').at(-1);
const QS = [
  { header: 'Protokol', question: 'Which guest protocol features?', multiSelect: true, options: ['Named link', 'Closed cover', 'RSVP', 'QR check-in'] },
  { header: 'Custom', question: 'Full custom design?', multiSelect: false, options: ['Yes (Recommended)', 'No'] },
  { header: 'Sound', question: 'Sound effects?', multiSelect: false, options: ['On', 'Off (Recommended)'] },
];

test('round trip: three questions, the first multi-select with free text, answered and submitted', async () => {
  const d = open(QS);
  await new Promise((r) => setTimeout(r, 800));
  const r = await ask.answerAll(QS, [{ choices: [1, 3], text: 'Guest photo wall' }, { choices: [2] }, { text: 'Only at check-in' }], d.io, { settleMs: 250 });
  assert.deepEqual(r, { ok: true });
  assert.equal(lastAnswer(), '"Which guest protocol features?"="Named link, RSVP, Guest photo wall", "Full custom design?"="No", "Sound effects?"="Only at check-in"');
});

test('round trip: one multi-select question; four questions mixed; a mismatch stops with a clear error', async () => {
  const one = [{ header: 'Pick', question: 'Which colours?', multiSelect: true, options: ['Red', 'Blue (Recommended)', 'Green'] }];
  let d = open(one); await new Promise((r) => setTimeout(r, 800));
  assert.deepEqual(await ask.answerAll(one, [{ choices: [2] }], d.io, { settleMs: 250 }), { ok: true });
  assert.equal(lastAnswer(), '"Which colours?"="Blue (Recommended)"');
  const four = [...QS, { header: 'Tone', question: 'Which tones?', multiSelect: true, options: ['Formal', 'Warm', 'Playful'] }];
  d = open(four); await new Promise((r) => setTimeout(r, 800));
  assert.deepEqual(await ask.answerAll(four, [{ choices: [4] }, { choices: [1] }, { choices: [2] }, { choices: [1, 2], text: 'Respectful' }], d.io, { settleMs: 250 }), { ok: true });
  assert.equal(lastAnswer(), '"Which guest protocol features?"="QR check-in", "Full custom design?"="Yes (Recommended)", "Sound effects?"="Off (Recommended)", "Which tones?"="Formal, Warm, Respectful"');
  d = open(QS); await new Promise((r) => setTimeout(r, 800));
  const wrong = [{ ...QS[0], question: 'A different question?' }, QS[1], QS[2]];
  const r = await ask.answerAll(wrong, [{ choices: [1] }, { choices: [1] }, { choices: [1] }], d.io, { settleMs: 250 });
  assert.equal(r.ok, false); assert.match(r.error, /Expected question 1 \("A different question\?"\) on the screen, found "Which guest protocol features\?"/);
  assert.match((await ask.answerAll(QS, [{ choices: [] }, { choices: [1] }, { choices: [1] }], d.io)).error, /Question 1 \(Protokol\) has no answer/);
  assert.match((await ask.answerAll(QS, [{ choices: [1] }, { choices: [1, 2] }, { choices: [1] }], d.io)).error, /Question 2 takes one answer/);
});

test('Autopilot answers several questions only when every one has a recommended option', async () => {
  const { askQuestions } = await import('../server/squad.js');
  const qs = askQuestions([{ header: 'A', question: 'a?', multiSelect: true, options: ['x', 'y (Recommended)', 'z (Recommended)'] }, { header: 'B', question: 'b?', options: ['Yes (Recommended)', 'No'] }]);
  assert.deepEqual(qs[0].options.map((o) => o.recommended), [false, true, true]);
  assert.deepEqual(ask.recommendedAnswers(qs), [{ choices: [2, 3] }, { choices: [1] }]);
  assert.equal(ask.recommendedAnswers(askQuestions([{ question: 'a?', options: ['x (Recommended)'] }, { question: 'b?', options: ['Yes', 'No'] }])), null, 'one without: it waits');
});

test('the Telegram message lists every question and sends the owner to the app (no one-tap buttons)', async () => {
  const { messageFor } = await import('../server/notify.js');
  const { askQuestions } = await import('../server/squad.js');
  const item = { id: 'x', kind: 'question', floorName: 'DTamu', agentName: 'PM', text: 'joined', options: [{ n: 1, label: '[✔] Link' }],
    questions: askQuestions([{ header: 'Protokol', question: 'Apa saja?', multiSelect: true, options: ['Link', 'QR'] }, { header: 'Efek', question: 'Suara?', options: ['On', 'Off'] }]) };
  const m = messageFor(item, 'tok', { lang: 'en' });
  assert.match(m.text, /1\. \[Protokol\] Apa saja\? \(multi\)\n   - Link\n   - QR\n\n2\. \[Efek\] Suara\?\n   - On\n   - Off/);
  assert.match(m.text, /answer them in The AI Squad/);
  assert.ok(!m.buttons.flat().some((b) => /^a:/.test(b.data || '')), 'no option buttons');
});
