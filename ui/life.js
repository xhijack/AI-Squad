// SPDX-License-Identifier: Apache-2.0
// Office life: idle agents get up, walk to a lounge spot (sofa, coffee machine, whiteboard, bookshelf)
// and run back to their desk when work or a question arrives. Ported and simplified from squad-3d.
import { HIP_H, resetPose, blink, sitLegs, arms } from './chibi.js';
import { Walker, approachPoint, segmentClear, deskMargin, seatMargin } from './nav.js';
import { t as tt, tx } from './i18n.js';

export const WANDER_AFTER = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo') ? 2 : 20;   // seconds idle before getting up (?demo: 2)
const WALK = 1.3, RUN = 3.6;               // m/s
const SEAT_Y = .62 - HIP_H + .06;          // rig root height when sitting on a desk chair

const rot = (x, z, ry) => ({ x: x * Math.cos(ry) + z * Math.sin(ry), z: -x * Math.sin(ry) + z * Math.cos(ry) });

// spots in floor coordinates; face = heading (rotation.y) the agent turns to
export function loungeSpots(devices = []) {
  const out = [];
  const at = (d, lx, lz, act, faceBack, extra = {}) => {
    const o = rot(lx, lz, d.ry || 0);
    out.push({ id: `${d.id}:${lx}`, device: d.id, act, x: d.x + o.x, z: d.z + o.z, face: (d.ry || 0) + (faceBack ? Math.PI : 0), label: LABEL[act], ...extra });
  };
  for (const d of devices) {
    if (d.type === 'sofa') { at(d, -.6, .12, 'sofa', false); at(d, .6, .12, 'sofa', false); }
    else if (d.type === 'coffee') at(d, 0, .85, 'coffee', true);
    else if (d.type === 'pantry') { at(d, -1.1, 1.0, 'coffee', true); at(d, .6, 1.0, 'coffee', true); }
    else if (d.type === 'beanbag') at(d, 0, 0, 'beanbag', false);
    else if (d.type === 'pingpong') { at(d, -1.75, 0, 'pingpong', false, { face: (d.ry || 0) + Math.PI / 2 }); at(d, 1.75, 0, 'pingpong', false, { face: (d.ry || 0) - Math.PI / 2 }); }
    else if (d.type === 'whiteboard') { at(d, -.35, .95, 'whiteboard', true); at(d, .45, 1.05, 'whiteboard', true); }
    else if (d.type === 'bookshelf') at(d, 0, .85, 'read', true);
  }
  return out;
}
// the meeting table's seats in its own coordinates; face = the heading of someone sitting there (towards the table)
export const MEETING_SEATS = [[-1.45, 0], [1.45, 0], [-.7, -1.05], [.7, -1.05], [-.7, 1.05], [.7, 1.05]].map(([x, z]) => ({ x, z, face: Math.atan2(-x, -z) }));
// the seats in floor coordinates (the first meeting table of the Floor)
export function meetingSeats(devices = []) {
  const d = devices.find((x) => x.type === 'meeting-table');
  if (!d) return [];
  return MEETING_SEATS.map((s, k) => { const o = rot(s.x, s.z, d.ry || 0); return { x: d.x + o.x, z: d.z + o.z, face: s.face + (d.ry || 0), device: d.id, part: `seat${k}` }; });
}
const LABEL = { sofa: tt('on the sofa'), coffee: tt('getting coffee'), whiteboard: tt('at the whiteboard'), read: tt('reading'), beanbag: tt('on a beanbag'), pingpong: tt('playing ping-pong') };

// station st: { g (desk group, floor coords), human (group in floor coords), rig, life, phase }
export function deskHome(st) {
  st.human.position.set(st.g.position.x, st.g.position.y, st.g.position.z);
  st.human.rotation.y = st.g.rotation.y;
}
// where the agent stands up and sits down: behind its chair when that is free, else the nearest walkable point
// around it from which the step to the chair touches only the chair (never another desk); kept per grid
function behindDesk(st) {
  const nav = st.life?.nav;
  if (st.exit && st.exitNav === nav) return st.exit;
  const seat = { x: st.g.position.x, z: st.g.position.z }, back = rot(0, -.95 * st.g.scale.x, st.g.rotation.y);
  st.exit = (nav && approachPoint(nav, seat, st.g.rotation.y + Math.PI, deskMargin(st.id), { min: .95 * st.g.scale.x })) || { x: seat.x + back.x, z: seat.z + back.z };
  st.exitNav = nav;
  return st.exit;
}
// the same for a lounge spot or a meeting seat: in front of it (or behind a chair), clear of everything else
function approachTo(st, spot, heading, margin, min) {
  const o = rot(0, min, heading), plain = { x: spot.x + o.x, z: spot.z + o.z };
  return (st.life?.nav && approachPoint(st.life.nav, spot, heading, margin, { min })) || plain;
}
// a lounge spot is offered only when it can be reached without touching other furniture (a cramped layout can put
// a desk right where the pantry spot is); decided once per grid
function usable(spot, nav) {
  if (!nav) return true;
  if (spot.navOf !== nav) { spot.navOf = nav; spot.ok = !!approachPoint(nav, spot, spot.face, spotMargin(spot), { min: .45 }); }
  return spot.ok;
}
const spotMargin = (spot) => (spot.act === 'sofa' || spot.act === 'beanbag' ? seatMargin(spot.device) : seatMargin(spot.device, '-'));

// a walk: a route through the Floor's grid to the first point (around furniture and the other characters), then a
// short straight "docking" step into the seat or spot that touches only what margin allows. Without a grid (no
// Floor data yet) the walk is straight.
function startWalk(st, points, run, margin = null) {
  const L = st.life;
  Object.assign(L, { approach: { x: points[0].x, z: points[0].z }, target: { x: points[0].x, z: points[0].z }, goal: { x: points[0].x, z: points[0].z }, dock: points.slice(1).map((p) => ({ x: p.x, z: p.z })), path: [], walker: null, run, margin, retries: 0 });
}

// the shortest turn from angle a towards b, at most k (0..1) of the way per frame
export function turnTowards(a, b, k) {
  let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * Math.min(1, k);
}
function moveAlong(st, dt) {
  const L = st.life, h = st.human;
  if (L.target) {
    if (!L.nav) { L.path = [L.target, ...L.dock]; L.target = null; }
    else {
      if (!L.walker) {
        L.walker = new Walker(st.id, h.position.x, h.position.z);
        // no route while others stand in the way: route through the furniture only (avoidance handles the people);
        // no route at all: wait and try again, never straight through furniture (Edit Mode prevents this layout)
        if (!L.walker.goTo(L.nav, L.target, L.others || []) && !L.walker.goTo(L.nav, L.target, [])) { L.walker = null; return false; }
      }
      if (L.walker) {
        const w = L.walker, x0 = w.x, z0 = w.z;
        const r = w.step(L.nav, L.others || [], dt, L.run ? RUN : WALK);
        h.position.x = w.x; h.position.z = w.z;
        if (Math.hypot(w.x - x0, w.z - z0) > 1e-4) h.rotation.y = turnTowards(h.rotation.y, Math.atan2(w.x - x0, w.z - z0), dt * 10);
        if (r === 'arrived') {
          const here = { x: w.x, z: w.z }, next = L.dock[0];
          L.walker = null;
          // a spot on open floor (pantry, whiteboard, ping-pong): walk there on the grid too, no straight docking
          if (next && L.nav.walkable(next.x, next.z)) { L.target = L.dock.shift(); return false; }
          // a seat inside furniture: the straight step may touch only that seat; stopped short of the approach point
          // (someone stood there): try again, and after a long wait step onto the approach point first
          if (next && L.margin && !segmentClear(L.nav.rects, here, next, L.margin)) {
            if (++L.retries < 40) return false;
            h.position.x = L.approach.x; h.position.z = L.approach.z;
          }
          L.path = [...L.dock]; L.target = null;
        }
        return false;
      }
    }
  }
  let step = (L.run ? RUN : WALK) * dt;
  while (step > 0 && L.path.length) {
    const tg = L.path[0], dx = tg.x - h.position.x, dz = tg.z - h.position.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) { L.path.shift(); continue; }
    h.rotation.y = turnTowards(h.rotation.y, Math.atan2(dx, dz), dt * 10);   // turn smoothly, no snapping
    const mv = Math.min(step, d);
    h.position.x += dx / d * mv; h.position.z += dz / d * mv;
    step -= mv;
    if (mv >= d) L.path.shift();
  }
  return !L.path.length;
}

function poseWalk(st, t, run) {
  const R = st.rig;
  resetPose(R); blink(st, t);
  R.root.position.set(0, 0, 0);
  const ph = t * (run ? 13 : 7.5) + st.phase, A = run ? .95 : .55, s = Math.sin(ph);
  R.lLeg.hip.rotation.x = s * A; R.rLeg.hip.rotation.x = -s * A;
  R.lLeg.knee.rotation.x = Math.max(0, -Math.sin(ph - .6)) * A * 1.4; R.rLeg.knee.rotation.x = Math.max(0, Math.sin(ph - .6)) * A * 1.4;
  arms(R, [-s * A * .9, .15, run ? -1.4 : -.25], [s * A * .9, -.15, run ? -1.4 : -.25]);
  R.torso.rotation.x = run ? .3 : .05;
  R.hips.position.y = HIP_H + Math.abs(Math.cos(ph)) * (run ? .07 : .03);
}

function poseActivity(st, spot, t) {
  const R = st.rig, p = t + st.phase;
  resetPose(R); blink(st, t);
  R.root.position.set(0, 0, 0);
  if (spot.act === 'beanbag') {
    R.root.position.set(0, .5 - HIP_H, 0);
    sitLegs(R, -1.2, 1.1, .25);
    R.torso.rotation.x = -.35;
    arms(R, [-.9, -.35, -1.1], [-.9, .35, -1.1 + Math.sin(p * 2) * .05]);   // phone in both hands
    R.head.rotation.set(.3, Math.sin(p * .4) * .1, 0);
  } else if (spot.act === 'pingpong') {
    const hit = Math.sin(p * 4.2);
    arms(R, [-.2, .15, -.3], [-1.1 - hit * .5, -.6 - hit * .3, -.7]);         // racket arm swings
    R.torso.rotation.y = hit * .2;
    R.hips.position.y = HIP_H - .04 + Math.abs(Math.cos(p * 4.2)) * .03;
  } else if (spot.act === 'sofa') {
    R.root.position.set(0, .48 - HIP_H + .06, 0);
    sitLegs(R);
    arms(R, [-.9, -.35, -1.1], [-.9, .35, -1.1 + Math.sin(p * 2) * .05]);   // phone in both hands
    R.head.rotation.set(.35, Math.sin(p * .4) * .1, 0);
  } else if (spot.act === 'coffee') {
    const sip = p % 6 < 1.6;
    R.cup.visible = true;
    arms(R, [-.1, .12, -.2], sip ? [-1.25, .35, -2.25] : [-.55, .05, -1.35]);
    R.head.rotation.x = sip ? -.2 : 0;
  } else if (spot.act === 'whiteboard') {
    arms(R, [-.15, .15, -.3], [-2.5 + Math.sin(p * 3) * .2, -.25 + Math.cos(p * 2.3) * .25, -.3]);
    R.head.rotation.set(-.2, .15, 0);
  } else {
    arms(R, [-1.1, -.4, -1.3], [-1.1, .4, -1.3]);
    R.head.rotation.x = .3;
  }
}

// sitting at the meeting table, talking and listening in turns
function poseMeeting(st, t) {
  const R = st.rig, p = t + st.phase;
  resetPose(R); blink(st, t);
  R.root.position.set(0, .48 - HIP_H + .06, 0);
  sitLegs(R);
  const talking = Math.sin(p * .7) > .35;
  arms(R, [-.9, .1, -1.2], talking ? [-1.1 - Math.sin(p * 5) * .25, -.3, -1.2] : [-.9, -.1, -1.2]);
  R.mouth.scale.y = talking ? .6 + Math.abs(Math.sin(p * 13)) * 1.3 : 1;
  R.head.rotation.set(talking ? Math.sin(p * 5) * .05 : .08, Math.sin(p * .6) * .35, 0);   // looks around the table
}

// one frame. wantsDesk: working, waiting or stopped. occupied: Map spot.id -> agent id (per Floor).
// meeting: { x, z, face, label } while the agent is in a meeting at the table (overrides desk and lounge).
// Returns the lounge or meeting label while away, or '' at the desk.
export function updateLife(st, { t, dt, wantsDesk, spots, occupied, poseDesk, meeting = null, nav = null, others = [] }) {
  const L = st.life || (st.life = { mode: 'desk', idleSince: 0 });
  L.nav = nav; L.others = others;                          // the Floor's grid and where the other characters are
  if (meeting) {
    if (L.mode !== 'meetWalk' && L.mode !== 'meet') {
      if (L.spot && occupied.get(L.spot.id) === st.id) occupied.delete(L.spot.id);
      st.rig.cup.visible = false;
      const from = L.mode === 'desk' ? behindDesk(st) : L.mode === 'act' && L.approach ? L.approach : { x: st.human.position.x, z: st.human.position.z };
      st.human.position.set(from.x, st.human.position.y, from.z);
      const m = meeting.device ? seatMargin(meeting.device, meeting.part) : null;   // behind the chair, then onto the seat
      startWalk(st, [approachTo(st, meeting, meeting.face + Math.PI, m || (() => -1), .55), meeting], false, m);
      Object.assign(L, { mode: 'meetWalk', spot: null, meeting });
    }
    if (L.mode === 'meetWalk') {
      poseWalk(st, t, false);
      if (moveAlong(st, dt)) { L.mode = 'meet'; st.human.rotation.y = meeting.face; }
      return tt('walking to the {meeting}', { meeting: tx(meeting.label).toLowerCase() });
    }
    st.human.position.set(meeting.x, st.human.position.y, meeting.z); st.human.rotation.y = meeting.face;
    poseMeeting(st, t);
    return tt('in the {meeting}', { meeting: tx(meeting.label).toLowerCase() });
  }
  if (L.mode === 'meetWalk' || L.mode === 'meet') {                         // the meeting is over: back to the desk
    if (L.mode === 'meet' && L.approach) st.human.position.set(L.approach.x, st.human.position.y, L.approach.z);   // up from the chair, behind it
    const exit = behindDesk(st);
    startWalk(st, [exit, { x: st.g.position.x, z: st.g.position.z }], false, deskMargin(st.id));
    Object.assign(L, { mode: 'return', meeting: null, spot: null });
  }
  if (L.mode === 'desk') {
    if (wantsDesk || !spots.length) { L.idleSince = 0; poseDesk(); return ''; }
    if (!L.idleSince) L.idleSince = t;
    if (t - L.idleSince > WANDER_AFTER * (1 + (st.phase % 1) * .75)) {
      const free = spots.filter((s) => !occupied.has(s.id) && usable(s, nav));
      if (free.length) {
        const spot = free[Math.floor(((st.phase * 9973) % 1) * free.length) % free.length];
        occupied.set(spot.id, st.id);
        Object.assign(L, { mode: 'walk', spot });
        const exit = behindDesk(st);
        st.human.position.set(exit.x, st.human.position.y, exit.z);        // stand up behind the chair
        startWalk(st, [approachTo(st, spot, spot.face, spotMargin(spot), .45), spot], false, spotMargin(spot));
      }
    }
    if (L.mode === 'desk') { poseDesk(); return ''; }
  }
  if (wantsDesk && L.mode !== 'return') {                  // work arrived: run back
    if (L.mode === 'act' && L.approach) st.human.position.set(L.approach.x, st.human.position.y, L.approach.z);   // up from the sofa or spot first
    if (L.spot && occupied.get(L.spot.id) === st.id) occupied.delete(L.spot.id);
    st.rig.cup.visible = false;
    const exit = behindDesk(st);
    startWalk(st, [exit, { x: st.g.position.x, z: st.g.position.z }], true, deskMargin(st.id));
    L.mode = 'return';
  }
  if (L.mode === 'walk' || L.mode === 'return') {
    poseWalk(st, t, L.run);
    if (moveAlong(st, dt)) {
      if (L.mode === 'return') { L.mode = 'desk'; L.spot = null; L.idleSince = 0; deskHome(st); poseDesk(); return ''; }
      L.mode = 'act';
      st.human.rotation.y = L.spot.face;
    }
    return L.mode === 'return' ? tt('hurrying back') : tt('walking: {where}', { where: L.spot.label });
  }
  poseActivity(st, L.spot, t);
  return L.spot.label;
}

export const seatRoot = (R) => R.root.position.set(0, SEAT_Y, 0);
