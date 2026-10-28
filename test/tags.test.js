// SPDX-License-Identifier: Apache-2.0
// Name tag de-overlap (1.2.0): nudged upward, the farther one fades when there is no room, the selected one first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spreadTags } from '../ui/tags.js';

const tag = (id, x, y, depth, extra = {}) => ({ id, x, y, w: 80, h: 20, depth, ...extra });
const boxes = (tags, out) => tags.filter((t) => !out.get(t.id).fade).map((t) => ({ ...t, y: t.y + out.get(t.id).dy }));
const overlaps = (list) => list.some((a, i) => list.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));

test('tags apart stay where they are', () => {
  const out = spreadTags([tag('a', 0, 100, 5), tag('b', 200, 100, 6)]);
  assert.deepEqual([...out.values()], [{ dy: 0, fade: false }, { dy: 0, fade: false }]);
});

test('two overlapping tags: the nearer stays, the farther goes up above it (never down)', () => {
  const out = spreadTags([tag('far', 30, 105, 9), tag('near', 0, 100, 4)]);
  assert.deepEqual(out.get('near'), { dy: 0, fade: false });
  assert.equal(out.get('far').dy, -27);                       // 105 - 27 = 78: above 100 with the gap
  assert.ok(out.get('far').dy < 0);
  assert.equal(overlaps(boxes([tag('far', 30, 105, 9), tag('near', 0, 100, 4)], out)), false);
});

test('a pile of tags at one spot: no overlaps among the shown ones; the farthest fade', () => {
  const pile = Array.from({ length: 7 }, (_, i) => tag(`t${i}`, i * 3, 200 + i, i + 1));
  const out = spreadTags(pile);
  assert.equal(overlaps(boxes(pile, out)), false);
  assert.ok([...out.values()].some((o) => o.fade));
  assert.equal(out.get('t0').dy, 0);
  for (const o of out.values()) assert.ok(o.dy <= 0);
});

test('the selected tag is placed first and keeps its place', () => {
  const out = spreadTags([tag('near', 0, 100, 2), tag('sel', 10, 102, 8, { selected: true })]);
  assert.deepEqual(out.get('sel'), { dy: 0, fade: false });
  assert.ok(out.get('near').dy < 0);
});
