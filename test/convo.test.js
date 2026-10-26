// The conversation view: model helpers and the markdown it renders (no DOM needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preview, bubbleText, actionsFor, step, ofText } from '../ui/convo-model.js';
import { mdLite } from '../ui/lib.js';

const FIN = { kind: 'finished', text: '## Server inventory: dev.dtamu.id\n\nThe server is **shared**.', answerable: true };
const Q = { kind: 'question', text: 'Which test runner should we use?', answerable: true, options: [{ n: 1, label: 'Jest' }, { n: 2, label: 'Vitest (Recommended)' }, { n: 3, label: 'Type something.', free: true }] };

test('one-line previews for the index and short bubbles over the agent', () => {
  assert.equal(preview(FIN), 'Finished: Server inventory: dev.dtamu.id');
  assert.equal(preview(Q), 'Question: Which test runner should we use?');
  assert.equal(preview({ kind: 'question', text: '☐ Runner\n\nWhich test runner should we use?' }), 'Question: Which test runner should we use?', 'the question, not the dialog header');
  assert.equal(preview({ kind: 'reply', text: 'x'.repeat(200) }).length, 90);
  assert.equal(bubbleText(FIN), 'Finished: Server inventory: dev.dtamu.id');
  assert.equal(bubbleText(Q), 'Question for you');
  assert.equal(bubbleText({ kind: 'reply', text: 'Bolehkah saya mulai?' }), 'Question for you');
});

test('actions per kind: options with the recommended one, Reply for reports and asks, view-only otherwise', () => {
  const q = actionsFor(Q);
  assert.equal(q.mode, 'options'); assert.equal(q.act, 'answer');
  assert.deepEqual(q.options.map((o) => [o.label, o.recommended, !!o.free]), [['Jest', false, false], ['Vitest', true, false], ['Type something.', false, true]]);
  assert.equal(actionsFor({ ...Q, options: [{ n: 1, label: 'A' }, { n: 2, label: 'B' }], autopilot: { recommended: 1 } }).options[0].recommended, true);
  assert.deepEqual(actionsFor(FIN), { mode: 'reply', options: [], canReply: true, dismiss: 'OK' });
  assert.equal(actionsFor({ kind: 'reply' }).dismiss, 'Dismiss');
  assert.equal(actionsFor({ ...FIN, canReply: false }).canReply, false, 'independent agents are answered in their own terminal');
  assert.equal(actionsFor({ kind: 'crash', options: [{ n: 1, label: 'Resume' }], answerable: true }).act, 'crash-answer');
  assert.equal(actionsFor({ kind: 'question', answerable: false, options: [{ n: 1, label: 'A' }] }).mode, 'view', 'answered in its own terminal');
  assert.equal(actionsFor({ kind: 'stall' }).dismiss, 'Dismiss');
});

test('n of m with previous and next wrapping around', () => {
  assert.equal(step(0, 3, -1), 2); assert.equal(step(2, 3, 1), 0); assert.equal(step(0, 0, 1), 0);
  assert.equal(ofText(1, 3), '2 of 3');
});

test('the message markdown: headings, lists, tables, code, safe links', () => {
  const h = mdLite('## Plan\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nnpm test\n```\nSee [the docs](https://example.com/x?a=1) or https://netlify.com. Bad: [x](javascript:alert(1)) <b>raw</b>');
  assert.match(h, /<h5>Plan<\/h5>/); assert.match(h, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(h, /<div class="mdTable"><table><tr><th>a<\/th>/); assert.match(h, /<pre>npm test<\/pre>/);
  assert.match(h, /<a href="https:\/\/example\.com\/x\?a=1" target="_blank" rel="noopener noreferrer">the docs<\/a>/);
  assert.match(h, /<a href="https:\/\/netlify\.com" [^>]*>https:\/\/netlify\.com<\/a>\./, 'the full stop is not part of the URL');
  assert.doesNotMatch(h, /href="javascript/); assert.doesNotMatch(h, /<b>raw<\/b>/);
});
