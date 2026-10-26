// Navigation: footprints, the grid, A* with string pulling, avoidance, seats, Edit Mode checks, and a soak test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nav from '../ui/nav.js';

const { NavGrid, footprints, rectDistance, RADIUS } = nav;
const segmentClear = (grid, a, b, rects) => { const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .02) || 1; for (let k = 0; k <= n; k++) { const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n; if (rects.some((r) => rectDistance(r, x, z) < RADIUS)) return false; } return true; };

test('footprints are rotated and the grid inflates them by the character radius', () => {
  const [desk, chair] = footprints({ desks: [{ agent: 'a', x: 0, z: 0, ry: Math.PI / 2 }] });
  assert.ok(Math.abs(desk.hw - .8 * 1.3) < 1e-9 && Math.abs(desk.hd - .4 * 1.3) < 1e-9);
  assert.ok(Math.abs(desk.cx - .62 * 1.3) < 1e-9 && Math.abs(desk.cz) < 1e-9, 'the desk part sits in front of the chair, turned with the station');
  assert.equal(rectDistance(desk, desk.cx, 0), 0);
  assert.ok(Math.abs(rectDistance(desk, desk.cx + desk.hd + 1, 0) - 1) < 1e-9, 'rotated: the desk is now deep along x');
  const g = new NavGrid([desk, chair]);
  const at = (x, z) => { const c = g.cellOf(x, z); return g.free(c.i, c.j); };
  assert.equal(at(desk.cx, 0), false); assert.equal(at(desk.cx + desk.hd + .2, 0), false, 'within the radius');
  assert.equal(at(desk.cx + desk.hd + .7, 0), true);
  assert.equal(at(-7.9, 0), false, 'walls'); assert.equal(at(3, 3), true);
});

test('A* goes around obstacles with string pulled paths; no way is no path', () => {
  const wall = { cx: 0, cz: 0, hw: .2, hd: 4, ry: 0, id: 'wall' };
  const g = new NavGrid([wall]);
  const p = g.path({ x: -3, z: 0 }, { x: 3, z: 0 });
  assert.ok(p && p.length >= 2 && p.length <= 4, `few corners (${p?.length})`);
  let from = { x: -3, z: 0 };
  for (const q of p) { assert.ok(segmentClear(g, from, q, [wall]), 'every segment keeps a radius from the wall'); from = q; }
  assert.deepEqual(p.at(-1), { x: 3, z: 0 });
  // a box around the goal: unreachable
  const box = [{ cx: 3, cz: -1, hw: 1, hd: .1, ry: 0, id: 'a' }, { cx: 3, cz: 1, hw: 1, hd: .1, ry: 0, id: 'b' }, { cx: 2, cz: 0, hw: .1, hd: 1, ry: 0, id: 'c' }, { cx: 4, cz: 0, hw: .1, hd: 1, ry: 0, id: 'd' }];
  assert.equal(new NavGrid(box).path({ x: -3, z: 0 }, { x: 3, z: 0 }), null);
});

test('narrow gaps: a character fits through a door of its size, not through a slit', () => {
  const doorWith = (gap) => [{ cx: 0, cz: -3 - gap / 2, hw: .2, hd: 3, ry: 0, id: 'top' }, { cx: 0, cz: 3 + gap / 2, hw: .2, hd: 3, ry: 0, id: 'bottom' }];
  assert.ok(new NavGrid(doorWith(1.2)).path({ x: -3, z: 0 }, { x: 3, z: 0 }), 'a 1.2 m door');
  assert.equal(new NavGrid(doorWith(.5)).path({ x: -3, z: 0 }, { x: 3, z: 0 }), null, 'a 0.5 m slit');
});

test('two characters crossing never come closer than two radii, and both arrive', () => {
  const g = new NavGrid([]);
  const a = new nav.Walker('a', -4, 0), b = new nav.Walker('b', 4, .05);
  a.goTo(g, { x: 4, z: 0 }); b.goTo(g, { x: -4, z: 0 });
  const done = new Set();
  for (let t = 0; t < 600 && done.size < 2; t++) {
    for (const w of [a, b]) { const others = [a, b].filter((o) => o !== w).map((o) => ({ id: o.id, x: o.x, z: o.z, moving: !done.has(o.id) })); if (w.step(g, others, .05) === 'arrived') done.add(w.id); }
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2 * RADIUS - 1e-9, `apart at step ${t}`);
  }
  assert.equal(done.size, 2, 'both arrived');
});

test('seats hold one character each', () => {
  const s = new nav.Seats();
  assert.equal(s.take('meeting:0', 'a'), true); assert.equal(s.take('meeting:0', 'b'), false); assert.equal(s.take('meeting:0', 'a'), true);
  s.release('meeting:0', 'b'); assert.equal(s.holder('meeting:0'), 'a');
  s.release('meeting:0', 'a'); assert.equal(s.take('meeting:0', 'b'), true);
});

test('Edit Mode: overlapping things and unreachable desks are refused', () => {
  const desk = (agent, x, z, ry = 0) => ({ agent, x, z, ry });
  assert.deepEqual(nav.checkLayout({ desks: [desk('a', 0, -3), desk('b', 4, -3)], devices: [{ id: 'plant-1', type: 'plant', x: -6, z: -5 }] }), { ok: true, problems: [] });
  const r = nav.checkLayout({ desks: [desk('a', 0, -3), desk('b', .8, -3)], devices: [] });
  assert.equal(r.ok, false); assert.match(r.problems[0].reason, /overlaps a/);
  assert.match(nav.checkLayout({ desks: [desk('a', 7.6, 0)], devices: [] }).problems[0].reason, /outside the room/);
  // a desk walled in by bookshelves: no way to its chair
  const walls = [[-1.6, -4.4, 0], [1.6, -4.4, 0], [0, -5.6, 0], [-2.3, -3.6, Math.PI / 2], [2.3, -3.6, Math.PI / 2]].map(([x, z, ry], i) => ({ id: `shelf-${i}`, type: 'bookshelf', x, z, ry }));
  const enclosed = nav.checkLayout({ desks: [desk('a', 0, -2.6, Math.PI)], devices: [...walls, { id: 'pp', type: 'pingpong', x: 0, z: -.6 }] });
  assert.ok(enclosed.problems.some((p) => /cannot be reached/.test(p.reason)) || enclosed.problems.some((p) => /overlaps/.test(p.reason)));
});

test('soak: 8 characters walking for 10 simulated minutes never touch an obstacle or each other', () => {
  const layout = { desks: [-3.4, 0, 3.4].flatMap((x) => [{ agent: `a${x}`, x, z: -4.1, ry: 0 }, { agent: `b${x}`, x, z: -.5, ry: 0 }]),
    devices: [{ id: 'sofa', type: 'sofa', x: 4.6, z: 5.75, ry: Math.PI }, { id: 'tv', type: 'tv', x: 4.6, z: 2.9, ry: 0 }, { id: 'pp', type: 'pingpong', x: -3.6, z: 4.4, ry: 0 },
      { id: 'mt', type: 'meeting-table', x: .3, z: 4.5, ry: 0 }, { id: 'pantry', type: 'pantry', x: -7.45, z: 1.4, ry: Math.PI / 2 }, { id: 'p1', type: 'plant', x: 7.3, z: 2.4, ry: 0 }] };
  const rects = footprints(layout), g = new NavGrid(rects);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const freeSpot = () => { for (;;) { const x = -7 + rnd() * 14, z = -5.8 + rnd() * 11.6; if (g.walkable(x, z) && g.path({ x: 0, z: 2 }, { x, z })) return { x, z }; } };
  const walkers = Array.from({ length: 8 }, (_, i) => { const p = freeSpot(); return new nav.Walker(`w${i}`, p.x, p.z); });
  // start apart
  for (let i = 0; i < walkers.length; i++) for (let k = 0; k < i; k++) while (Math.hypot(walkers[i].x - walkers[k].x, walkers[i].z - walkers[k].z) < 2 * RADIUS) Object.assign(walkers[i], freeSpot());
  let arrivals = 0;
  const dt = .1;
  for (let step = 0; step < 6000; step++) {
    for (const w of walkers) {
      const others = walkers.filter((o) => o !== w).map((o) => ({ id: o.id, x: o.x, z: o.z, moving: o.path.length > 0 }));
      if (!w.path.length) { if (step) arrivals++; w.goTo(g, freeSpot(), others); }
      w.step(g, others, dt);
      for (const r of rects) assert.ok(rectDistance(r, w.x, w.z) >= RADIUS - 1e-9, `${w.id} touches ${r.id} at step ${step}`);
      assert.ok(w.x >= nav.ROOM.x0 + RADIUS && w.x <= nav.ROOM.x1 - RADIUS && w.z >= nav.ROOM.z0 + RADIUS && w.z <= nav.ROOM.z1 - RADIUS, 'inside the walls');
    }
    for (let i = 0; i < walkers.length; i++) for (let k = 0; k < i; k++) assert.ok(Math.hypot(walkers[i].x - walkers[k].x, walkers[i].z - walkers[k].z) >= 2 * RADIUS - 1e-9, `${walkers[i].id} and ${walkers[k].id} overlap at step ${step}`);
  }
  assert.ok(arrivals > 80, `the characters keep moving (${arrivals} arrivals)`);
});

test('Edit Mode judges only what the moved piece causes', () => {
  const layout = { desks: [{ agent: 'a', x: 0, z: -3, ry: 0 }, { agent: 'b', x: 4, z: -3, ry: 0 }], devices: [{ id: 'plant-1', type: 'plant', x: 4, z: -3.4 }] };
  const c = nav.checkLayout(layout);
  assert.deepEqual(nav.problemsOf(c, 'a'), [], 'desk a is fine');
  assert.equal(nav.problemsOf(c, 'plant-1').length, 1, 'the plant stands in desk b');
  assert.equal(nav.problemsOf(c, 'b')[0].with, 'b');
});
