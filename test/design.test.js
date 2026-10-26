import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as design from '../server/design.js';

const root = scratch({ seed: false });
const proj = path.join(root, 'shop');
const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(proj, f)), { recursive: true }); fs.writeFileSync(path.join(proj, f), t); };

test('variant groups: two or more HTML variants per screen, titles, the question', () => {
  w('docs/design/variants/rsvp/variant-a.html', '<title>Cards</title><p>a</p>');
  w('docs/design/variants/rsvp/variant-b.html', '<title>Compact list</title><p>b</p>');
  w('docs/design/variants/rsvp/variant-c.html', '<p>no title</p>');
  w('docs/design/variants/rsvp/README.md', '# RSVP page\n\nWhich layout fits a wedding with 300 guests?\n');
  w('docs/design/variants/lonely/only.html', '<p>one</p>');
  const g = design.groups(proj);
  assert.deepEqual(g, [{ screen: 'rsvp', question: 'Which layout fits a wedding with 300 guests?', chosen: null,
    variants: [{ file: 'variant-a.html', title: 'Cards' }, { file: 'variant-b.html', title: 'Compact list' }, { file: 'variant-c.html', title: 'variant c' }] }]);
  assert.equal(design.variantFile(proj, 'rsvp', 'variant-b.html'), path.join(proj, 'docs/design/variants/rsvp/variant-b.html'));
  for (const [s, f] of [['rsvp', '../../../.env'], ['../x', 'a.html'], ['rsvp', 'README.md'], ['rsvp', 'missing.html']]) assert.throws(() => design.variantFile(proj, s, f), /No such variant/, `${s}/${f}`);
});

test('the pick becomes a taste note in DESIGN.md; other lines stay', () => {
  w('docs/DESIGN.md', '# Design\n\nSTATUS: APPROVED\n\n## Screens\n- RSVP\n');
  const r = design.pick(proj, 'rsvp', 'variant-b.html', { note: 'Guests scan names fast', now: Date.parse('2026-10-27T03:00:00Z') });
  assert.equal(r.title, 'Compact list');
  const md = fs.readFileSync(path.join(proj, 'docs/DESIGN.md'), 'utf8');
  assert.match(md, /^# Design\n\nSTATUS: APPROVED\n\n## Screens\n- RSVP\n\n## Taste notes\n/);
  assert.match(md, /- 2026-10-27 · rsvp: the owner picked "Compact list" over "Cards", "variant c"\. Why: Guests scan names fast \(docs\/design\/variants\/rsvp\/variant-b\.html\)\n$/);
  assert.equal(design.groups(proj)[0].chosen, 'variant-b.html');
  design.pick(proj, 'rsvp', 'variant-a.html', { now: Date.parse('2026-10-28T03:00:00Z') });
  assert.equal(fs.readFileSync(path.join(proj, 'docs/DESIGN.md'), 'utf8').match(/^- 2026/gm).length, 2, 'a second pick adds a line');
  assert.throws(() => design.pick(proj, 'rsvp', 'nope.html'), /Pick one of the variants/);
  assert.equal(design.withTasteNote('# D\n\n## Taste notes\n- old\n\n## Later\nx\n', '- new'), '# D\n\n## Taste notes\n- old\n- new\n\n## Later\nx\n', 'inserted at the end of its section');
});
