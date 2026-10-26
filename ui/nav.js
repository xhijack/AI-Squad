// Navigation (Phase 3, "nothing passes through anything"): an occupancy grid of the Floor built from the real
// footprints of desks, chairs, devices and walls (rotated, inflated by the character radius), A* paths on it with
// string pulling, character avoidance (keep apart, wait, re-route), and layout checks for Edit Mode.
// No DOM or three.js here: the same code runs in the browser and in the unit tests. Coordinates are the room's
// (layout.js toRoom), not the saved ones.
import { FW, FD, toRoom } from './layout.js';

export const ROOM = { x0: -FW / 2, x1: FW / 2, z0: -FD / 2, z1: FD / 2 };
export const CELL = .2;
export const RADIUS = .34;                         // a character's radius on the floor (chibi at station scale)
export const STATION_SCALE = 1.3;

// footprints (w × d metres, centred, before rotation) of what stands on the floor; rugs and the lounge corner's
// walkable parts are not obstacles. A device type may have several parts: [w, d, dx, dz].
const DEVICE_PARTS = {
  plant: [[.75, .75]], whiteboard: [[2.9, .3]], printer: [[.95, .75]], coffee: [[.95, .65]], pantry: [[3.5, 1.25, 0, -.1]],
  bookshelf: [[1.6, .8]], sofa: [[2.7, 1.15]], 'server-rack': [[.8, .8]], tv: [[2.2, .55]], beanbag: [[1.15, 1.15]],
  pingpong: [[2.75, 1.55]], lamp: [[.5, .5]], rug: [],
  'meeting-table': [[2.6, 1.65], ...[[-1.45, 0], [1.45, 0], [-.7, -1.05], [.7, -1.05], [-.7, 1.05], [.7, 1.05]].map(([x, z]) => [.5, .5, x, z])],
};
// a desk station (scaled with STATION_SCALE): the desk and the chair
const DESK_PARTS = [[1.6, .8, 0, .62], [.66, .64, 0, -.07]];
const PART_NAMES = { desk: ['desk', 'chair'], 'meeting-table': ['table', 'seat0', 'seat1', 'seat2', 'seat3', 'seat4', 'seat5'] };

const rot = (x, z, ry) => ({ x: x * Math.cos(ry) + z * Math.sin(ry), z: -x * Math.sin(ry) + z * Math.cos(ry) });
// -> [{ cx, cz, hw, hd, ry, id, part }] rectangles in floor coordinates. sizes: { [device id]: [w, d, dx, dz] }
// measured from the models actually built (bigger or smaller than the table above); multi-part devices and rugs
// keep their table entry
export function footprints({ desks = [], devices = [] } = {}, { sizes = {} } = {}) {
  const out = [];
  const part = (o, [w, d, dx = 0, dz = 0], scale, id, name) => { const c = rot(dx * scale, dz * scale, o.ry || 0); out.push({ cx: o.x + c.x, cz: o.z + c.z, hw: w * scale / 2, hd: d * scale / 2, ry: o.ry || 0, id, part: name }); };
  for (const d of desks) DESK_PARTS.forEach((p, i) => part(d, p, STATION_SCALE, `desk:${d.agent}`, PART_NAMES.desk[i]));
  for (const d of devices) {
    const parts = DEVICE_PARTS[d.type] || [[.8, .8]];
    const measured = parts.length === 1 && sizes[d.id];
    (measured ? [measured] : parts).forEach((p, i) => part(d, p, 1, d.id, PART_NAMES[d.type]?.[i] || 'body'));
  }
  return out;
}

// a straight move a -> b that keeps margin(r) from every rectangle (margin < 0: that rectangle is ignored, e.g. the
// chair being sat on); sampled every 5 cm
export function segmentClear(rects, a, b, margin = () => RADIUS) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .05));
  for (const r of rects) {
    const m = margin(r);
    if (m < 0) continue;
    for (let k = 0; k <= n; k++) if (rectDistance(r, a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n) < m - 1e-9) return false;
  }
  return true;
}
// where a character stands before sitting down (and after getting up): the nearest walkable point from `seat`
// in the direction `heading` (rotation.y; widening the angle when that way is blocked) from which a straight
// step reaches the seat touching nothing but what margin() allows. null when there is none.
const AROUND = [0, .5, -.5, 1, -1, Math.PI / 2, -Math.PI / 2, 2.1, -2.1];
export function approachPoint(grid, seat, heading, margin, { min = .45, max = 2.6 } = {}) {
  for (const da of AROUND) for (let d = min; d <= max + 1e-9; d += .1) {
    const p = { x: seat.x + Math.sin(heading + da) * d, z: seat.z + Math.cos(heading + da) * d };
    const c = grid.cellOf(p.x, p.z);
    if (grid.walkable(p.x, p.z) && grid.free(c.i, c.j) && segmentClear(grid.rects, p, seat, margin)) return p;
  }
  return null;
}
// the margins for docking into a desk chair: the chair itself is ignored, the agent's own desk only not touched,
// everything else keeps a character's radius
export const deskMargin = (agent) => (r) => (r.id === `desk:${agent}` ? (r.part === 'chair' ? -1 : .02) : RADIUS);
// ... and into a device's seat (sofa, beanbag, meeting seat k): that seat ignored, the rest of that device not
// touched, everything else a radius
export const seatMargin = (deviceId, part = null) => (r) => (r.id === deviceId ? (!part || r.part === part ? -1 : .02) : RADIUS);
// distance from a point to a rectangle (0 inside)
export function rectDistance(r, x, z) {
  const l = rot(x - r.cx, z - r.cz, -r.ry);
  const dx = Math.max(0, Math.abs(l.x) - r.hw), dz = Math.max(0, Math.abs(l.z) - r.hd);
  return Math.hypot(dx, dz);
}

export class NavGrid {
  // rects: footprints(); radius: inflation (the character's radius)
  constructor(rects, { radius = RADIUS, cell = CELL, room = ROOM } = {}) {
    Object.assign(this, { rects, radius, cell, room });
    this.w = Math.round((room.x1 - room.x0) / cell); this.h = Math.round((room.z1 - room.z0) / cell);
    this.blocked = new Uint8Array(this.w * this.h);
    // a cell is free when every point in it keeps a full radius from walls and obstacles (radius + half its diagonal)
    const m = radius + cell * Math.SQRT1_2;
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const { x, z } = this.centre(i, j);
      const wall = x - room.x0 < m || room.x1 - x < m || z - room.z0 < m || room.z1 - z < m;
      if (wall || rects.some((r) => rectDistance(r, x, z) < m)) this.blocked[j * this.w + i] = 1;
    }
  }
  centre(i, j) { return { x: this.room.x0 + (i + .5) * this.cell, z: this.room.z0 + (j + .5) * this.cell }; }
  cellOf(x, z) { return { i: Math.max(0, Math.min(this.w - 1, Math.floor((x - this.room.x0) / this.cell))), j: Math.max(0, Math.min(this.h - 1, Math.floor((z - this.room.z0) / this.cell))) }; }
  free(i, j, extra = null) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h || this.blocked[j * this.w + i]) return false;
    if (extra) { const c = this.centre(i, j); for (const b of extra) if (Math.hypot(c.x - b.x, c.z - b.z) < b.r) return false; }
    return true;
  }
  // is a point walkable (not inside any inflated obstacle)?
  walkable(x, z) { return x - this.room.x0 >= this.radius && this.room.x1 - x >= this.radius && z - this.room.z0 >= this.radius && this.room.z1 - z >= this.radius && this.rects.every((r) => rectDistance(r, x, z) >= this.radius); }
  // the nearest free cell (start or goal inside an obstacle's margin, e.g. a docking point next to a chair)
  nearestFree(x, z, extra = null) {
    const c = this.cellOf(x, z);
    if (this.free(c.i, c.j, extra)) return c;
    for (let r = 1; r < Math.max(this.w, this.h); r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !this.free(c.i + di, c.j + dj, extra)) continue;
        const p = this.centre(c.i + di, c.j + dj), d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) { bd = d; best = { i: c.i + di, j: c.j + dj }; }
      }
      if (best) return best;
    }
    return null;
  }
  // straight walk between two points without touching an obstacle (sampled every half cell)
  lineFree(a, b, extra = null) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell / 2)));
    for (let k = 0; k <= n; k++) {
      const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n, c = this.cellOf(x, z);
      if (!this.free(c.i, c.j, extra)) return false;
    }
    return true;
  }
  // A* (8 directions, no corner cutting) from a to b, then string pulled. -> [{x,z}, ...] ending at b, or null
  // extra: temporary round obstacles [{ x, z, r }] (other characters)
  path(a, b, { extra = null } = {}) {
    const s = this.nearestFree(a.x, a.z, extra), g = this.nearestFree(b.x, b.z, extra);
    if (!s || !g) return null;
    const W = this.w, key = (i, j) => j * W + i, gk = key(g.i, g.j);
    const open = new Heap(), came = new Int32Array(W * this.h).fill(-1), cost = new Float32Array(W * this.h).fill(Infinity), closed = new Uint8Array(W * this.h);
    const hfn = (i, j) => { const dx = Math.abs(i - g.i), dj = Math.abs(j - g.j); return (dx + dj) + (Math.SQRT2 - 2) * Math.min(dx, dj); };
    cost[key(s.i, s.j)] = 0; open.push(key(s.i, s.j), hfn(s.i, s.j));
    while (open.size) {
      const k = open.pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === gk) break;
      const i = k % W, j = (k - i) / W;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!this.free(ni, nj, extra)) continue;
        if (di && dj && (!this.free(i + di, j, extra) || !this.free(i, j + dj, extra))) continue;   // no corner cutting
        const nk = key(ni, nj), c = cost[k] + (di && dj ? Math.SQRT2 : 1);
        if (c < cost[nk]) { cost[nk] = c; came[nk] = k; open.push(nk, c + hfn(ni, nj)); }
      }
    }
    if (!closed[gk]) return null;
    const cells = [];
    for (let k = gk; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => this.centre(k % W, (k - (k % W)) / W));
    const startCell = this.cellOf(a.x, a.z), snapped = !this.free(startCell.i, startCell.j, extra);
    if (!snapped) pts[0] = { x: a.x, z: a.z };                         // else walk to the nearest free cell first
    const inExtra = (p) => (extra || []).some((o) => Math.hypot(p.x - o.x, p.z - o.z) < o.r);
    if (this.walkable(b.x, b.z) && !inExtra(b)) pts[pts.length - 1] = { x: b.x, z: b.z };   // the exact goal unless someone stands there
    const out = this.pull(pts, extra);
    return snapped && (out[0]?.x !== pts[0].x || out[0]?.z !== pts[0].z) ? [pts[0], ...out] : out;
  }
  // string pulling: drop every point the walker can skip in a straight free line
  pull(pts, extra = null) {
    if (pts.length < 3) return pts.slice(1).length ? pts.slice(1) : pts;
    const out = [];
    let from = pts[0], k = 1;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) if (this.lineFree(from, pts[m], extra)) { far = m; break; }
      out.push(pts[far]); from = pts[far]; k = far + 1;
    }
    return out;
  }
}

// a small binary heap for A*
class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) { this.k.push(k); this.p.push(p); let i = this.k.length - 1; while (i > 0) { const u = (i - 1) >> 1; if (this.p[u] <= this.p[i]) break; this.swap(i, u); i = u; } }
  pop() {
    const top = this.k[0], lk = this.k.pop(), lp = this.p.pop();
    if (this.k.length) { this.k[0] = lk; this.p[0] = lp; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < this.k.length && this.p[l] < this.p[m]) m = l; if (r < this.k.length && this.p[r] < this.p[m]) m = r; if (m === i) break; this.swap(i, m); i = m; } }
    return top;
  }
  swap(a, b) { [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.p[a], this.p[b]] = [this.p[b], this.p[a]]; }
}

// ---------- character avoidance ----------
// me: { id, x, z }; next: the waypoint; others: [{ id, x, z, moving }]; step: metres this frame
// -> { x, z, blockedBy } the position after the step: the walker never comes closer than two radii to anyone;
// it yields to characters standing still and to walkers with a lower id (right of way), and waits otherwise
export function stepAvoiding(me, next, others, step, radius = RADIUS) {
  const dx = next.x - me.x, dz = next.z - me.z, d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x: me.x, z: me.z, blockedBy: null };
  const mv = Math.min(step, d), min = radius * 2;
  // the first character a move from (me) to (x, z) would come too close to, or null
  const hit = (x, z) => others.find((o) => o.id !== me.id && Math.hypot(o.x - x, o.z - z) < min && Math.hypot(o.x - x, o.z - z) < Math.hypot(o.x - me.x, o.z - me.z) + 1e-9) || null;
  const nx = me.x + dx / d * mv, nz = me.z + dz / d * mv;
  const o = hit(nx, nz);
  if (!o) return { x: nx, z: nz, blockedBy: null };
  // slide along the one in the way (keep only the sideways part of the step), if that is clear of everyone
  const ox = o.x - me.x, oz = o.z - me.z, on = Math.hypot(ox, oz) || 1, ux = dx / d, uz = dz / d;
  const toward = (ux * ox + uz * oz) / on;
  if (toward > 0) {
    let sx = ux - toward * ox / on, sz = uz - toward * oz / on;
    const sl = Math.hypot(sx, sz);
    if (sl > .2) {
      sx /= sl; sz /= sl;
      // a little away from the other as well, so the gap never shrinks while sliding
      const ax = sx - ox / on * .15, az = sz - oz / on * .15, al = Math.hypot(ax, az);
      const px = me.x + ax / al * mv * sl, pz = me.z + az / al * mv * sl;
      if (!hit(px, pz)) return { x: px, z: pz, blockedBy: null, slid: true };
    }
  }
  return { x: me.x, z: me.z, blockedBy: o.id };                    // would come too close: wait
}

// a character walking a grid path: avoids the others, waits, and re-routes around a character that blocks it
export const WALK = 1.3;
export class Walker {
  constructor(id, x, z) { Object.assign(this, { id, x, z, path: [], goal: null, wait: 0, stuck: 0 }); }
  goTo(grid, goal, others = []) {
    this.goal = goal; this.wait = 0;
    this.path = grid.path(this, goal, { extra: others.filter((o) => o.id !== this.id && !o.moving).map((o) => ({ x: o.x, z: o.z, r: RADIUS * 2 })) }) || [];
    return this.path.length > 0;
  }
  // one step; others: [{ id, x, z, moving }]. -> 'walking' | 'waiting' | 'arrived'
  step(grid, others, dt, speed = WALK) {
    if (!this.path.length) return 'arrived';
    let left = speed * dt;
    while (left > 1e-6 && this.path.length) {
      const next = this.path[0];
      const r = stepAvoiding(this, next, others, left);
      if (r.blockedBy) {
        this.wait += dt;
        // blocked for a while: go around the one in the way (the lower id keeps its route, so two never both detour)
        const o = others.find((x) => x.id === r.blockedBy);
        // the goal is taken (someone stands at it): close enough, stop here
        if (this.goal && this.wait > 1.5 && Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < RADIUS * 4) { this.path = []; this.wait = 0; return 'arrived'; }
        if ((this.wait > .8 && (!o?.moving || this.id > o.id)) || this.wait > 3) {
          const alt = grid.path(this, this.goal, { extra: [{ x: o.x, z: o.z, r: RADIUS * 2 + grid.cell }] });
          if (alt?.length) this.path = alt;
          this.wait = 0; this.stuck++;
        }
        return 'waiting';
      }
      if (!grid.walkable(r.x, r.z)) {                                // never into furniture: wait, then route from a free cell
        this.wait += dt;
        if (this.wait > .5) { this.path = grid.path(this, this.goal) || this.path; this.wait = 0; this.stuck++; }
        return 'waiting';
      }
      const moved = Math.hypot(r.x - this.x, r.z - this.z);
      this.x = r.x; this.z = r.z; this.wait = 0;
      if (r.slid) { if (this.path.length && !grid.lineFree(this, this.path[0])) this.path.unshift(...(grid.path(this, this.path[0]) || []).slice(0, -1)); return 'walking'; }
      left -= moved;
      if (Math.hypot(next.x - this.x, next.z - this.z) < 1e-4) this.path.shift();
    }
    return this.path.length ? 'walking' : 'arrived';
  }
}

// ---------- seats ----------
// reserved slots (desk chairs, sofa places, beanbags, meeting seats): one character per seat
export class Seats {
  constructor() { this.by = new Map(); }
  take(seat, who) { const cur = this.by.get(seat); if (cur && cur !== who) return false; this.by.set(seat, who); return true; }
  release(seat, who) { if (this.by.get(seat) === who) this.by.delete(seat); }
  holder(seat) { return this.by.get(seat) || null; }
}

// ---------- Edit Mode ----------
// a layout is refused when two things overlap or a desk cannot be reached from the room
// layout: { desks: [{ agent, x, z, ry }], devices: [{ id, type, x, z, ry }] } -> { ok, problems: [{ id, reason }] }
// sizes: the measured device footprints of the Floor (see footprints)
export function checkLayout(layout, { entrance = toRoom({ x: 0, z: 5.6 }), sizes = {} } = {}) {
  const rects = footprints(layout, { sizes }), problems = [];
  const overlap = (a, b) => {
    // separating axis test for two rotated rectangles
    const axes = [a.ry, a.ry + Math.PI / 2, b.ry, b.ry + Math.PI / 2].map((t) => ({ x: Math.cos(t), z: -Math.sin(t) }));
    const corners = (r) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => { const c = rot(sx * r.hw, sz * r.hd, r.ry); return { x: r.cx + c.x, z: r.cz + c.z }; });
    const ca = corners(a), cb = corners(b);
    return axes.every((ax) => {
      const pa = ca.map((p) => p.x * ax.x + p.z * ax.z), pb = cb.map((p) => p.x * ax.x + p.z * ax.z);
      return Math.max(...pa) > Math.min(...pb) + .02 && Math.max(...pb) > Math.min(...pa) + .02;
    });
  };
  for (let i = 0; i < rects.length; i++) for (let k = i + 1; k < rects.length; k++) {
    const a = rects[i], b = rects[k];
    if (a.id === b.id) continue;
    if (overlap(a, b)) problems.push({ id: b.id.replace(/^desk:/, ''), with: a.id.replace(/^desk:/, ''), reason: `overlaps ${a.id.replace(/^desk:/, '')}` });
  }
  const outside = rects.filter((r) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].some(([sx, sz]) => { const c = rot(sx * r.hw, sz * r.hd, r.ry); const x = r.cx + c.x, z = r.cz + c.z; return x < ROOM.x0 || x > ROOM.x1 || z < ROOM.z0 || z > ROOM.z1; }));
  for (const r of outside) problems.push({ id: r.id.replace(/^desk:/, ''), reason: 'stands outside the room' });
  {
    const grid = new NavGrid(rects);
    for (const d of layout.desks || []) {
      const at = approachPoint(grid, { x: d.x, z: d.z }, (d.ry || 0) + Math.PI, deskMargin(d.agent), { min: .95 * STATION_SCALE });   // where the agent stands up
      if (!at || !grid.path(entrance, at)) problems.push({ id: d.agent, reason: 'cannot be reached: every way to this desk is blocked' });
    }
  }
  return { ok: !problems.length, problems };
}
// the problems a moved piece (desk agent id or device id) is part of
export const problemsOf = (check, id) => check.problems.filter((p) => p.id === id || p.with === id);
