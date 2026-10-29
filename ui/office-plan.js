// SPDX-License-Identifier: Apache-2.0
// The Office in 3D (1.1.0): what the floor plan (scene-model.js officeLayout, shared with the Iso Pixel Office) means
// for walking and drawing. Glass walls around every room with one door each, the navigation grid of the whole floor
// (walls, desks and furniture are obstacles; doors are the only openings), where an agent stands to leave its desk,
// trips between rooms (meetings in the shared room, cross-Space handoffs), the level of detail for a zoom, and which
// rooms came or went. No DOM or three.js: the same code runs in the browser and in the unit tests.
import { NavGrid, footprints } from './nav.js';

export const WALL_T = .12;                 // wall thickness
export const LOW_WALL = .5, GLASS_TOP = 1.6;
export const OFFICE_CELL = .25;
export const NEAR_ZOOM = 2.2;              // camera zoom from which one room is drawn in full detail
export const MEETING_SEATS = [[-1.45, 0], [1.45, 0], [-.7, -1.05], [.7, -1.05], [-.7, 1.05], [.7, 1.05]];
export const HANDOFF_MS = 90e3;            // a handoff walk: the sender goes to the other room's door and back

// a room's walls: four edges, the door edge in two parts around the door -> [{ x0, z0, x1, z1, roomId }]
export function wallsOf(r) {
  const x0 = r.x, x1 = r.x + r.w, z0 = r.z, z1 = r.z + r.d, out = [];
  const edge = (a, b, z) => out.push({ x0: a, z0: z, x1: b, z1: z, roomId: r.id });
  for (const [z, side] of [[z0, 'back'], [z1, 'front']]) {
    if (r.door?.side === side) { edge(x0, r.door.x - r.door.w / 2, z); edge(r.door.x + r.door.w / 2, x1, z); } else edge(x0, x1, z);
  }
  out.push({ x0, z0, x1: x0, z1, roomId: r.id }, { x0: x1, z0, x1, z1, roomId: r.id });
  return out.filter((w) => Math.hypot(w.x1 - w.x0, w.z1 - w.z0) > .05);
}
// a wall as an obstacle rectangle (nav.js footprints format)
const wallRect = (w) => ({ cx: (w.x0 + w.x1) / 2, cz: (w.z0 + w.z1) / 2, hw: Math.max(WALL_T, Math.abs(w.x1 - w.x0)) / 2, hd: Math.max(WALL_T, Math.abs(w.z1 - w.z0)) / 2, ry: 0, id: `wall:${w.roomId}`, part: 'wall' });

// layout (officeLayout) -> { ...layout, walls, bounds, rects }
export function officePlan(layout) {
  const walls = layout.rooms.flatMap(wallsOf);
  const desks = layout.rooms.flatMap((r) => r.desks.map((d) => ({ ...d, agent: d.agentId || `${r.id}-desk` })));
  const devices = layout.rooms.flatMap((r) => r.devices);
  const rects = [...walls.map(wallRect), ...footprints({ desks, devices })];
  const m = .8, bounds = { x0: -layout.w / 2 - m, x1: layout.w / 2 + m, z0: -layout.d / 2 - m, z1: layout.d / 2 + m };
  return { ...layout, walls, rects, bounds };
}
// the walkable grid of the whole floor (built once per plan; ~25 ms for six Spaces)
export const officeNav = (plan, { cell = OFFICE_CELL } = {}) => new NavGrid(plan.rects, { cell, room: plan.bounds });

// where to stand: just inside and just outside a room's door
export function doorPoints(r) {
  const s = r.door.side === 'back' ? -1 : 1;
  return { inside: { x: r.door.x, z: r.door.z - s * .8 }, outside: { x: r.door.x, z: r.door.z + s * .9 } };
}
// behind an agent's chair: where it gets up and sits down (a free cell)
export function deskStand(nav, desk) {
  const c = nav.nearestFree(desk.x, desk.z - .95);
  return c ? nav.centre(c.i, c.j) : { x: desk.x, z: desk.z - .95 };
}

// trips between rooms now. floors: [{ id, meeting: { agents, until } }]; walks: [{ id, from, agent, to, ts }] (recent
// handoffs) -> [{ key: floorId/agentId, kind: meeting | handoff, to: { x, z }, seat?, until }]
export function trips(plan, floors = [], walks = [], now = Date.now()) {
  const byId = new Map(plan.rooms.map((r) => [r.id, r])), out = [], busy = new Set();
  const meetingRoom = byId.get('meeting'), table = meetingRoom?.devices.find((d) => d.type === 'meeting-table');
  let seat = 0;
  for (const f of floors) {
    const m = f.meeting;
    if (!m || !(m.until > now) || !table || !byId.has(f.id)) continue;
    for (const a of m.agents || []) {
      if (!byId.get(f.id).desks.some((d) => d.agentId === a)) continue;
      const k = seat++;
      const [dx, dz] = MEETING_SEATS[k % MEETING_SEATS.length], ring = Math.floor(k / MEETING_SEATS.length);
      const p = { x: table.x + dx * (1 + ring * .55), z: table.z + dz * (1 + ring * .55) };
      out.push({ key: `${f.id}/${a}`, kind: 'meeting', to: p, seat: ring === 0 ? p : null, until: m.until });
      busy.add(`${f.id}/${a}`);
    }
  }
  for (const w of walks) {
    const key = `${w.from}/${w.agent}`, to = byId.get(w.to);
    if (busy.has(key) || !to || !byId.has(w.from) || now - w.ts > HANDOFF_MS || now < w.ts) continue;
    out.push({ key, kind: 'handoff', to: doorPoints(to).outside, until: w.ts + HANDOFF_MS });
    busy.add(key);
  }
  return out;
}

// the level of detail: far (instanced low-poly agents, merged furniture, no live screens) or near (one room in full
// detail: the room zoomed into, or the one in the middle of the view when zoomed in far enough)
export function lodFor({ zoom = 1, focus = null, centreRoom = null } = {}) {
  if (focus) return { level: 'near', room: focus };
  if (zoom >= NEAR_ZOOM && centreRoom) return { level: 'near', room: centreRoom };
  return { level: 'far', room: null };
}

// rooms that came, went or moved between two plans (a Space added or removed: its room animates in or out)
export function roomDiff(prev = [], next = []) {
  const p = new Map(prev.map((r) => [r.id, r])), n = new Map(next.map((r) => [r.id, r]));
  const sig = (r) => [r.x, r.z, r.w, r.d].map((v) => v.toFixed(2)).join(',');
  return {
    added: next.filter((r) => !p.has(r.id)).map((r) => r.id),
    removed: prev.filter((r) => !n.has(r.id)).map((r) => r.id),
    moved: next.filter((r) => p.has(r.id) && sig(p.get(r.id)) !== sig(r)).map((r) => r.id),
  };
}

// the room under the middle of the view
export const roomAtPoint = (plan, x, z) => plan.rooms.find((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d) || null;
