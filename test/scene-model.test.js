// SPDX-License-Identifier: Apache-2.0
// The renderer-neutral Scene Model and the Iso Pixel atlas: the 2D projection matches the 3D camera, desks and
// chairs sort by depth, poses follow the state, the palette swap paints an agent in its colours, the atlas is complete.
import './three-hook.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const THREE = await import('three');
const sm = await import('../ui/scene-model.js');

test('the 2D projection is the 3D view\'s isometric camera', () => {
  const ISO = new THREE.Vector3(1, .95, 1).normalize();
  const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 200);
  cam.position.copy(ISO).multiplyScalar(60); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  for (const [x, y, z] of [[3, 0, -2], [-5, 1.2, 4], [7, 3.4, 7], [0, 0, 0]]) {
    const v = new THREE.Vector3(x, y, z).project(cam);           // NDC: x right, y up, ±1 = ±10 units
    const p = sm.project(x, y, z);
    assert.ok(Math.abs(v.x * 10 - p.x) < .01 && Math.abs(-v.y * 10 - p.y) < .01, `${x},${y},${z}: ${v.x * 10},${-v.y * 10} vs ${p.x},${p.y}`);
  }
});

test('headings, station parts by depth, poses by state', () => {
  assert.deepEqual([0, Math.PI / 4, Math.PI, -Math.PI / 2, 2 * Math.PI + .1].map(sm.dirOf), [0, 1, 4, 6, 0]);
  const toward = sm.stationParts({ x: 0, z: 0, ry: 0 }), away = sm.stationParts({ x: 0, z: 0, ry: Math.PI });
  assert.ok(toward.chair.depth < toward.seat.depth && toward.seat.depth < toward.desk.depth, 'facing the camera: chair, agent, desk');
  assert.ok(away.desk.depth < away.chair.depth && away.chair.depth < away.seat.depth, 'facing away: desk, chair, then the agent (always readable over its chair)');
  assert.equal(sm.poseOf({ state: 'working' }, 'desk', 0), 'type-b');
  assert.equal(sm.poseOf({ state: 'working' }, 'desk', 1 / 7), 'type-a');
  assert.equal(sm.poseOf({ state: 'working', task: { label: 'npm test' } }, 'desk'), 'think', 'a long command: watching, not typing');
  assert.equal(sm.poseOf({ state: 'waiting' }, 'desk'), 'wait');
  assert.equal(sm.poseOf({ state: 'stopped' }, 'desk'), 'sleep');
  assert.equal(sm.poseOf({ state: 'stopped', standby: true }, 'desk'), 'think');
  assert.equal(sm.poseOf({ state: 'idle' }, 'spot'), 'stand');
  assert.equal(sm.poseOf({ state: 'idle' }, 'spot', 0, true), 'think', 'at a meeting seat');
  assert.match(sm.poseOf({ state: 'idle' }, 'walk', .1), /^walk-[ab]$/);
  const m = sm.floorModel({ id: 'x', number: 2, layout: 'rows', agents: [{ id: 'a' }, { id: 'b' }], devices: [{ id: 'p', type: 'plant', x: 1, z: 1 }] });
  assert.equal(m.desks.length, 2); assert.equal(m.agents[1].desk.agent, 'b'); assert.equal(m.devices[0].type, 'plant');
});

test('the palette swap paints the key colours in the agent\'s look, shaded; outlines stay dark', () => {
  const px = (...c) => Uint8ClampedArray.from(c.flat());
  const mask = { w: 3, h: 1, ax: 0, ay: 0, data: px([255, 0, 0, 255], [0, 0, 255, 255], [58, 42, 34, 255]) };          // skin, shirt, outline
  const shade = { w: 3, h: 1, ax: 0, ay: 0, data: px([235, 235, 235, 255], [117, 117, 117, 255], [40, 40, 40, 255]) };  // lit, half, dark
  const out = sm.paintSprite(mask, shade, [['skin', [255, 0, 0]], ['shirt', [0, 0, 255]]], [58, 42, 34], { skin: '#f6d2b0', shirt: '#22aa44' });
  assert.deepEqual([...out.slice(0, 4)], [246, 210, 176, 255]);
  assert.deepEqual([...out.slice(4, 8)], [17, 85, 34, 255], 'half the light');
  assert.deepEqual([...out.slice(8, 12)], [58, 42, 34, 255], 'outline as it is');
  assert.equal(sm.autoRenderer({ agents: 13 }), 'iso'); assert.equal(sm.autoRenderer({ phone: true }), 'iso'); assert.equal(sm.autoRenderer({ memory: 4 }), 'iso');
  assert.equal(sm.autoRenderer({ agents: 6, memory: 16 }), 'three');
});

test('the atlas has every sprite the Iso renderer asks for', () => {
  const a = JSON.parse(fs.readFileSync(new URL('../ui/assets/iso/atlas.json', import.meta.url), 'utf8'));
  const devices = ['plant', 'whiteboard', 'printer', 'coffee', 'pantry', 'bookshelf', 'sofa', 'rug', 'tv', 'beanbag', 'pingpong', 'server-rack', 'meeting-table', 'lamp'];
  const missing = [];
  for (let d = 0; d < 8; d++) {
    for (const t of devices) if (!a.sprites[`dev:${t}:${d}`]) missing.push(`dev:${t}:${d}`);
    for (const k of ['std', 'lead']) for (const dev of ['laptop', 'dual-monitor']) if (!a.sprites[`desk:${k}:${dev}:${d}`]) missing.push(`desk:${k}:${dev}:${d}`);
    if (!a.sprites[`chair:${d}`]) missing.push(`chair:${d}`);
    for (const s of ['bob', 'spiky', 'pony', 'buns', 'farmer']) for (const p of ['type-a', 'type-b', 'think', 'wait', 'sleep', 'stand', 'walk-a', 'walk-b']) for (const l of ['m', 's']) if (!a.sprites[`ch:${s}:${p}:${d}:${l}`]) missing.push(`ch:${s}:${p}:${d}:${l}`);
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(a.iso, [.587, .5576, .587], 'rendered from the 3D view\'s camera direction');
  assert.ok(fs.statSync(new URL('../ui/assets/iso/atlas.png', import.meta.url)).size < 1.5e6, 'the atlas stays small');
});

test('the Office plan: departments and the Server room at the back, projects in the middle, Lobby and Owner in front, no overlaps', () => {
  const sp = (id, kind, number, n) => ({ id, kind, number, name: id, agents: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}` })) });
  const spaces = [sp('sales', 'department', 2, 3), sp('mkt', 'department', 3, 1), sp('legal', 'department', 6, 2), sp('pos', 'project', 4, 5), sp('hr', 'project', 5, 2), sp('dtamu', 'project', 7, 9)];
  const l = sm.officeLayout(spaces);
  const by = (id) => l.rooms.find((r) => r.id === id);
  assert.deepEqual(l.rooms.filter((r) => r.kind === 'department').map((r) => r.id), ['sales', 'mkt', 'legal'], 'by Floor number');
  assert.ok(by('server').x > by('legal').x && by('server').z === by('sales').z, 'the Server room ends the back row');
  for (const p of ['pos', 'hr', 'dtamu']) assert.ok(by(p).z > by('sales').z + by('sales').d, `${p} below the departments`);
  for (const f of ['lobby', 'owner']) assert.ok(by(f).z > Math.max(...['pos', 'hr', 'dtamu'].map((p) => by(p).z)), `${f} in front`);
  const overlap = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.z < b.z + b.d - 1e-6 && b.z < a.z + a.d - 1e-6;
  for (const a of l.rooms) for (const b of l.rooms) if (a !== b) assert.ok(!overlap(a, b), `${a.id} overlaps ${b.id}`);
  for (const r of l.rooms) for (const d of r.desks) assert.ok(d.x > r.x && d.x < r.x + r.w && d.z > r.z && d.z < r.z + r.d, `${r.id}: a desk outside its room`);
  assert.equal(by('dtamu').desks.length, 9);
  assert.ok(Math.abs(Math.min(...l.rooms.map((r) => r.x)) + l.w / 2) < 1e-6 && Math.abs(Math.min(...l.rooms.map((r) => r.z)) + l.d / 2) < 1e-6, 'centred');
  const c = by('pos');
  assert.equal(sm.roomAt(l, c.x + 1, c.z + 1).id, 'pos'); assert.equal(sm.roomAt(l, 1e3, 1e3), null);
  assert.equal(sm.defaultOverview({ phone: true }), 'list'); assert.equal(sm.defaultOverview({}), 'building');
  const empty = sm.officeLayout([]);
  assert.deepEqual(empty.rooms.map((r) => r.kind), ['server', 'lobby', 'meeting', 'pantry', 'owner'], 'no Spaces yet: the fixed and shared rooms');
});
