// SPDX-License-Identifier: Apache-2.0
// The Office in 3D (1.1.0): rooms, glass walls with doors, the navigation grid across rooms, trips, LOD, add/remove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeLayout } from '../ui/scene-model.js';
import * as op from '../ui/office-plan.js';

const sp = (id, kind, number, n) => ({ id, kind, number, name: id, agents: Array.from({ length: n }, (_, i) => ({ id: `a${i}` })) });
const SPACES = [sp('sales', 'department', 2, 3), sp('pos', 'project', 4, 5), sp('hr', 'project', 5, 2), sp('dtamu', 'project', 7, 5)];
const plan = op.officePlan(officeLayout(SPACES));
const nav = op.officeNav(plan);
const by = (id) => plan.rooms.find((r) => r.id === id);

test('plan -> rooms with one door each, glass walls with a gap at the door, shared rooms with their furniture, no overlaps', () => {
  const overlap = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.z < b.z + b.d - 1e-6 && b.z < a.z + a.d - 1e-6;
  for (const a of plan.rooms) for (const b of plan.rooms) if (a !== b) assert.ok(!overlap(a, b), `${a.id} overlaps ${b.id}`);
  for (const r of plan.rooms) {
    const w = op.wallsOf(r);
    assert.equal(w.length, 5, `${r.id}: four walls, the door wall in two parts`);
    const doorWall = w.filter((x) => x.z0 === x.z1 && Math.abs(x.z0 - r.door.z) < 1e-9);
    assert.ok(doorWall.every((x) => Math.max(x.x0, x.x1) <= r.door.x - r.door.w / 2 + 1e-9 || Math.min(x.x0, x.x1) >= r.door.x + r.door.w / 2 - 1e-9), `${r.id}: the door is open`);
  }
  assert.deepEqual(by('meeting').devices.map((d) => d.type), ['meeting-table', 'whiteboard']);
  assert.ok(by('pantry').devices.some((d) => d.type === 'pantry'));
  assert.equal(by('server').devices.filter((d) => d.type === 'server-rack').length, 2);
  assert.ok(plan.corridors.length >= 2);
  for (const r of plan.rooms) for (const d of r.devices) assert.ok(d.x > r.x && d.x < r.x + r.w && d.z > r.z && d.z < r.z + r.d, `${d.id} inside ${r.id}`);
});

test('nav grid across rooms: every door and desk is reachable from the Lobby; glass is an obstacle, doors are the way', () => {
  const start = op.doorPoints(by('lobby')).inside;
  for (const r of plan.rooms) {
    const { inside, outside } = op.doorPoints(r);
    assert.ok(nav.path(start, outside), `${r.id}: its door from the lobby`);
    assert.ok(nav.path(start, inside), `${r.id}: inside it`);
    for (const d of r.desks) if (d.agentId) assert.ok(nav.path(start, op.deskStand(nav, d)), `${r.id}/${d.agentId}: its desk`);
  }
  // two neighbouring rooms: the straight line crosses glass, the path goes out of one door and in at the other
  const a = by('pos'), b = by('hr'), pa = op.doorPoints(a).inside, pb = op.doorPoints(b).inside;
  assert.equal(nav.lineFree(pa, pb), false, 'glass in between');
  const path = nav.path(pa, pb), len = path.reduce((n, p, i) => n + Math.hypot(p.x - (i ? path[i - 1] : pa).x, p.z - (i ? path[i - 1] : pa).z), 0);
  assert.ok(len >= Math.hypot(pb.x - pa.x, pb.z - pa.z) - 1e-6);
  const through = (r) => path.some((p) => Math.abs(p.x - r.door.x) < r.door.w && Math.abs(p.z - r.door.z) < 1.2);
  assert.ok(through(a) && through(b), 'out through one door, in through the other');
  // nobody stands inside a wall or a desk
  for (const p of path) assert.ok(nav.walkable(p.x, p.z) || Math.hypot(p.x - pb.x, p.z - pb.z) < 1e-6);
});

test('trips: a meeting gathers its agents in the shared room; a handoff walks the sender to the other room and back', () => {
  const now = 1e12;
  const t = op.trips(plan, [{ id: 'pos', meeting: { agents: ['a0', 'a1', 'zz'], until: now + 60e3 } }, { id: 'hr', meeting: { agents: ['a0'], until: now - 1 } }],
    [{ id: 'h1', from: 'sales', agent: 'a2', to: 'dtamu', ts: now - 10e3 }, { id: 'h2', from: 'sales', agent: 'a1', to: 'pos', ts: now - 5 * 60e3 }, { id: 'h3', from: 'pos', agent: 'a0', to: 'hr', ts: now }], now);
  assert.deepEqual(t.map((x) => [x.key, x.kind]), [['pos/a0', 'meeting'], ['pos/a1', 'meeting'], ['sales/a2', 'handoff']], 'unknown agent, ended meeting, old handoff and an agent in a meeting are left out');
  const m = by('meeting');
  for (const x of t.filter((y) => y.kind === 'meeting')) assert.ok(x.to.x > m.x && x.to.x < m.x + m.w && x.to.z > m.z && x.to.z < m.z + m.d);
  assert.deepEqual(t[2].to, op.doorPoints(by('dtamu')).outside);
});

test('level of detail and room add / remove', () => {
  assert.deepEqual(op.lodFor({ zoom: 1 }), { level: 'far', room: null });
  assert.deepEqual(op.lodFor({ zoom: 3, centreRoom: 'pos' }), { level: 'near', room: 'pos' });
  assert.deepEqual(op.lodFor({ zoom: 1, focus: 'hr' }), { level: 'near', room: 'hr' });
  assert.deepEqual(op.lodFor({ zoom: 3 }), { level: 'far', room: null }, 'zoomed into the corridor');
  const next = officeLayout([...SPACES.filter((s) => s.id !== 'hr'), sp('legal', 'department', 9, 2)]).rooms;
  const d = op.roomDiff(plan.rooms, next);
  assert.deepEqual(d.added, ['legal']); assert.deepEqual(d.removed, ['hr']);
  assert.ok(d.moved.includes('server'), 'the Server room moves along the back row');
  assert.deepEqual(op.roomDiff(plan.rooms, plan.rooms), { added: [], removed: [], moved: [] });
  assert.equal(op.roomAtPoint(plan, by('pos').x + 1, by('pos').z + 1).id, 'pos');
});
