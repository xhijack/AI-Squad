// SPDX-License-Identifier: Apache-2.0
// Floor geometry and desk layout presets (Rows, Pods, Circle, Open Space). Units are metres. The isometric camera
// looks from +x +z, so the back wall and the left wall are the two walls you see; the front half holds the lounge
// (right) and the ping-pong table (left).
// Saved desks and devices (and the presets below) are in the original office's coordinates, 16 x 13 m
// (x -8..8, z -6.5..6.5); since 0.8.4 the office is drawn wider, 22 x 16 m, so there is room between desks, around
// the lounge and the meeting table (furniture keeps its size). toRoom spreads saved positions out when a Floor
// is drawn, toBase turns them back when Edit Mode saves; the server and older versions keep the same files.
import { t } from './i18n.js';

export const BASE_W = 16, BASE_D = 13;
export const FW = 22, FD = 16, FH = 3.4, SLAB = .4, GAP = 3.2;
const SX = FW / BASE_W, SZ = FD / BASE_D;
export const toRoom = (p) => ({ ...p, x: +(p.x * SX).toFixed(3), z: +(p.z * SZ).toFixed(3) });
export const toBase = (p) => ({ ...p, x: +(p.x / SX).toFixed(3), z: +(p.z / SZ).toFixed(3) });
// a layout ({ desks, devices }) in room coordinates
export const layoutToRoom = (l) => ({ ...l, desks: (l.desks || []).map(toRoom), devices: (l.devices || []).map(toRoom) });
// the Lobby stacks the Floors with air between them (a cutaway dollhouse) so every office stays visible
export const floorY = (n) => n * (FH + SLAB + GAP);
export const LAYOUT_NAMES = { rows: t('Rows'), pods: t('Pods'), circle: t('Circle'), 'open-space': t('Open Space') };

// desks live in the work zone: the back two thirds of the room, clear of the pantry on the left wall (base coordinates)
const WORK = { x0: -5.8, x1: 7, z0: -4.6, z1: 1.6 };
const clampX = (x) => Math.max(WORK.x0, Math.min(WORK.x1, x));
const clampZ = (z) => Math.max(WORK.z0, Math.min(WORK.z1 + 2.4, z));
const CX = (WORK.x0 + WORK.x1) / 2;

export function presetSpots(n, layout) {
  const out = [];
  if (layout === 'circle') {
    const r = Math.min(3.8, 1.9 + n * .35);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.PI / 2;
      const x = CX + Math.cos(a) * r * 1.4, z = -1.5 + Math.sin(a) * r * .85;
      out.push({ x, z, ry: Math.atan2(CX - x, -1.5 - z) });           // everyone faces the centre
    }
  } else if (layout === 'pods') {
    const pods = Math.ceil(n / 4);
    for (let i = 0; i < n; i++) {
      const pod = Math.floor(i / 4), k = i % 4;
      const px = CX + (pod - (pods - 1) / 2) * 7.2, side = k % 2 ? 1 : -1, front = k < 2;
      out.push({ x: px + side * 2.1, z: front ? .8 : -4.1, ry: front ? Math.PI : 0 });
    }
  } else if (layout === 'open-space') {
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(n * 1.6))));
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const jitter = ((i * 7919) % 13) / 13 - .5;                    // deterministic, looks hand-placed
      out.push({ x: CX + (c - (cols - 1) / 2) * 3.5 + jitter * .6, z: -4 + r * 3.5 + (c % 2) * .5, ry: jitter * .6 });
    }
  } else {
    const per = Math.min(4, Math.max(1, Math.ceil(n / 2)));
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / per), c = i % per, cols = Math.min(per, n - r * per);
      out.push({ x: CX + (c - (cols - 1) / 2) * 3.4, z: -4.1 + r * 3.6, ry: 0 });
    }
  }
  return out.map((s) => ({ x: +clampX(s.x).toFixed(3), z: +clampZ(s.z).toFixed(3), ry: +s.ry.toFixed(3) }));
}

// saved desk positions win; agents without a desk get their preset spot
export function desksFor(agents, desks = [], layout = 'rows') {
  const spots = presetSpots(agents.length, layout);
  return agents.map((a, i) => {
    const d = desks.find((x) => x.agent === a.id);
    return d ? { ...d } : { agent: a.id, ...spots[i], device: 'laptop' };
  });
}

// the lounge corner (front right) for every preset: rug, sofa facing the TV, beanbags
export function loungeFor() {
  return {
    rug: { x: 4.6, z: 4.4, ry: 0 }, sofa: { x: 4.6, z: 5.75, ry: Math.PI }, tv: { x: 4.6, z: 2.9, ry: 0 },
    beanbag: { x: 2.3, z: 4.1, ry: .4 },
  };
}
