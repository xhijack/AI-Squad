// SPDX-License-Identifier: Apache-2.0
// The renderer-neutral Scene Model (0.16): what a Floor looks like and where everything stands, worked out once
// for every renderer (three.js and Iso Pixel). Plain functions over plain data: no three.js, no DOM, so they are
// tested in Node. A renderer turns this into pixels; it never decides where a desk is or which pose an agent has.
import { desksFor, toRoom } from './layout.js';

// the 3D view's isometric camera (azimuth 45°, elevation ~34°) projected to 2D screen units (y down)
export const RX = .7071, RZ = .3943, RY = .8301;
export const project = (x, y, z) => ({ x: RX * (x - z), y: RZ * (x + z) - RY * y });
// a point turned by a heading (the same convention as three.js rotation.y)
export const rot = (x, z, ry) => ({ x: x * Math.cos(ry) + z * Math.sin(ry), z: -x * Math.sin(ry) + z * Math.cos(ry) });
// the nearest of the 8 headings the sprites were rendered at
export const dirOf = (ry) => ((Math.round((ry || 0) / (Math.PI / 4)) % 8) + 8) % 8;
export const STATION_SCALE = 1.3;

// one Floor: desks (one per agent, preset or saved), devices, in room coordinates
export function floorModel(f) {
  const devices = (f.devices || []).map(toRoom);
  const desks = desksFor(f.agents || [], f.desks, f.layout).map(toRoom);
  return { id: f.id, number: f.number, devices, desks, agents: (f.agents || []).map((a, i) => ({ id: a.id, desk: desks[i] })) };
}

// the parts of a desk station and how far each is from the camera (bigger = nearer: drawn later). The agent is
// always drawn over its own chair, so it stays readable even with its back to the camera.
export function stationParts(desk) {
  const at = (lx, lz) => { const p = rot(lx, lz, desk.ry || 0); return { x: desk.x + p.x, z: desk.z + p.z }; };
  const d = at(0, .62 * STATION_SCALE), c = at(0, -.1 * STATION_SCALE);
  return { desk: { ...d, depth: d.x + d.z }, chair: { ...c, depth: c.x + c.z - .2 }, seat: { x: desk.x, z: desk.z, depth: desk.x + desk.z + .05 } };
}

// the pose an agent shows: at its desk (or a meeting seat) by its state, walking, or standing at a lounge spot.
// t: seconds (typing and walking alternate two frames)
export function poseOf(agent, mode, t = 0, seated = false) {
  if (mode === 'walk' || mode === 'return') return Math.floor(t * 6) % 2 ? 'walk-a' : 'walk-b';
  if (mode !== 'desk' && !seated) return 'stand';
  if (agent.state === 'working' && !agent.task) return Math.floor(t * 7) % 2 ? 'type-a' : 'type-b';
  if (agent.state === 'waiting') return 'wait';
  if (agent.state === 'stopped' && !agent.standby) return 'sleep';
  return 'think';
}

// palette swap of a chibi sprite: the mask has key colours (skin, hair, shirt, …), the shading pass the light.
// mask/shade: { data (RGBA), w, h, ax, ay } views; keys: [[name, [r,g,b]]]; look: { name: '#hex' } -> RGBA bytes
export function paintSprite(mask, shade, keys, outline, look) {
  const out = new Uint8ClampedArray(mask.w * mask.h * 4);
  const pal = Object.fromEntries(keys.map(([k]) => [k, hexRgb(look[k] || '#888888')]));
  const ox = mask.ax - shade.ax, oy = mask.ay - shade.ay;
  for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) {
    const i = (y * mask.w + x) * 4;
    if (mask.data[i + 3] < 128) continue;
    const rgb = [mask.data[i], mask.data[i + 1], mask.data[i + 2]];
    let base = rgb, best = 2500;
    for (const [k, kc] of keys) { const d = dist(kc, rgb); if (d < best) { best = d; base = pal[k]; } }
    let s = 1;
    const sx = x - ox, sy = y - oy;
    if (dist(outline, rgb) >= 900 && sx >= 0 && sy >= 0 && sx < shade.w && sy < shade.h) {
      const j = (sy * shade.w + sx) * 4;
      if (shade.data[j + 3] > 0) s = Math.min(1.15, (shade.data[j] + shade.data[j + 1] + shade.data[j + 2]) / 3 / 235);
    }
    out[i] = base[0] * s; out[i + 1] = base[1] * s; out[i + 2] = base[2] * s; out[i + 3] = 255;
  }
  return out;
}
const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
export const hexRgb = (h) => { const n = parseInt(String(h).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

// Auto picks Iso Pixel on phones, on devices with 4 GB or less and for big squads; three.js otherwise
export const autoRenderer = ({ agents = 0, phone = false, memory = 8 } = {}) => (phone || memory <= 4 || agents > 12 ? 'iso' : 'three');

// ---------- the Office view (0.17; 3D in 1.1.0): the whole company on one floor plan ----------
// Departments along the back wall with the Server room at its end, projects in rows in the middle, and in front the
// Lobby (the dispatcher's queue), the shared meeting room, the pantry / lounge and the Owner's room (approvals).
// Corridors run between the rows. Each Space is one room; its desks sit in a compact grid facing the camera, so
// every agent is readable; each room has one door onto a corridor. Pure: both renderers (Iso Pixel and three.js)
// draw this same plan and never decide where anything is.
export const DESK_DX = 2.4, DESK_DZ = 3.5, ROOM_PAD = 1.3, CORRIDOR = 2.2, DOOR_W = 1.4;
const roomSize = (n) => {
  const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, n))))), rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows, w: Math.max(5.2, cols * DESK_DX + ROOM_PAD * 2), d: Math.max(5.2, rows * DESK_DZ + ROOM_PAD * 2) };
};
// the fixed rooms' furniture, relative to the room's back-left corner: [type, x, z, ry]
const FURNITURE = {
  server: (w) => [['server-rack', w / 2 - .7, 1.2, 0], ['server-rack', w / 2 + .5, 1.2, 0]],
  lobby: () => [['sofa', 6.2, 1.1, 0], ['plant', .7, .7, 0], ['plant', 7.3, 4.4, 0]],
  // the front row opens at the back (onto the corridor): its furniture keeps the door free
  meeting: (w, d) => [['meeting-table', w / 2, d / 2 + .1, 0], ['whiteboard', w / 2, d - .35, Math.PI]],
  pantry: (w, d) => [['pantry', w / 2, d - .8, Math.PI], ['sofa', .75, d / 2 - .2, Math.PI / 2], ['plant', w - .6, .6, 0]],
  owner: (w, d) => [['whiteboard', 1.8, d - .35, Math.PI]],
};
// spaces: [{ id, name, kind, number, agents: [{ id }] }] -> { rooms: [{ id, kind, x, z, w, d, desks: [{ agentId, x, z, ry }],
// devices: [{ id, type, x, z, ry }], door: { x, z, side: front | back, w } }], corridors: [{ x, z, w, d }], w, d }
// room kinds: department | project | server | lobby | meeting | pantry | owner. x, z: the room's back-left corner;
// the plan is centred on 0, 0.
export function officeLayout(spaces, { maxRow = 30 } = {}) {
  const rooms = [], corridors = [];
  const room = (r, side) => {
    const devices = (FURNITURE[r.kind]?.(r.w, r.d) || []).map(([type, dx, dz, ry], i) => ({ id: `${r.id}:${type}:${i}`, type, x: r.x + dx, z: r.z + dz, ry }));
    rooms.push({ desks: [], ...r, devices, door: { x: r.x + r.w / 2, z: side === 'back' ? r.z : r.z + r.d, side, w: DOOR_W } });
  };
  const place = (s, kind, x, z, size) => {
    const desks = (s.agents || []).map((a, i) => ({ agentId: a.id, x: x + ROOM_PAD + DESK_DX / 2 + (i % size.cols) * DESK_DX, z: z + ROOM_PAD + 1.2 + Math.floor(i / size.cols) * DESK_DZ, ry: 0 }));
    room({ id: s.id, kind, name: s.name || '', number: s.number, x, z, w: size.w, d: size.d, desks }, 'front');
  };
  const deps = spaces.filter((s) => s.kind === 'department').sort((a, b) => a.number - b.number);
  const projects = spaces.filter((s) => s.kind !== 'department').sort((a, b) => a.number - b.number);
  // back row: departments, then the Server room
  let x = 0, backD = 0;
  for (const s of deps) { const sz = roomSize(s.agents?.length || 0); place(s, 'department', x, 0, sz); x += sz.w; backD = Math.max(backD, sz.d); }
  backD = Math.max(backD, 5.2);
  room({ id: 'server', kind: 'server', x, z: 0, w: 4.4, d: backD }, 'front');
  x += 4.4;
  // the front row: Lobby, meeting room, pantry, Owner (at the right end)
  const FRONT = [['lobby', 8], ['meeting', 6.4], ['pantry', 5.6], ['owner', 6]];
  const frontW = FRONT.reduce((n, [, w]) => n + w, 0) + .6 * (FRONT.length - 1);
  const width = Math.max(x, frontW, Math.min(maxRow, 22));
  // middle: projects, wrapped into rows as wide as the plan
  let z = backD + CORRIDOR, rx = 0, rowD = 0;
  corridors.push({ x: 0, z: backD, w: width, d: CORRIDOR });
  for (const s of projects) {
    const sz = roomSize(s.agents?.length || 0);
    if (rx > 0 && rx + sz.w > width) { z += rowD + CORRIDOR; corridors.push({ x: 0, z: z - CORRIDOR, w: width, d: CORRIDOR }); rx = 0; rowD = 0; }
    place(s, 'project', rx, z, sz); rx += sz.w + .6; rowD = Math.max(rowD, sz.d);
  }
  if (projects.length) { z += rowD + CORRIDOR; corridors.push({ x: 0, z: z - CORRIDOR, w: width, d: CORRIDOR }); }
  let fx = 0;
  for (const [kind, w] of FRONT) {
    const at = kind === 'owner' ? Math.max(fx, width - w) : fx;
    room({ id: kind, kind, x: at, z, w, d: 5.2, ...(kind === 'owner' ? { desks: [{ agentId: '', x: at + w / 2, z: z + 2.2, ry: 0 }] } : {}) }, 'back');
    fx = at + w + .6;
  }
  const W = width, D = z + 5.2;
  const shift = (o) => { o.x -= W / 2; o.z -= D / 2; };
  for (const r of rooms) { shift(r); r.desks.forEach(shift); r.devices.forEach(shift); shift(r.door); }
  corridors.forEach(shift);
  return { rooms, corridors, w: W, d: D };
}
// which room is under a floor point
export const roomAt = (layout, x, z) => layout.rooms.find((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d) || null;
// the default overview: the list on phones, the building elsewhere (the person's choice wins)
export const OVERVIEWS = ['building', 'office', 'list'];
export const defaultOverview = ({ phone = false } = {}) => (phone ? 'list' : 'building');
