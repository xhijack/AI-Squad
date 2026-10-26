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
