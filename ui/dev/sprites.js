// SPDX-License-Identifier: Apache-2.0
// The Iso Pixel sprite atlas (0.16), rendered from the same 3D models as the three.js view, so both looks match:
// devices, desks and chairs as they are; the chibis twice, as a colour-key mask and as a white shading pass, so the
// Iso renderer can paint each agent in its own colours (palette swap) without a sprite per appearance.
// Run by scripts/make-iso-sprites.js; the result is ui/assets/iso/atlas.png + atlas.json.
import * as THREE from 'three';
import { buildDevice, STATION_SCALE } from '../scene.js';
import { buildChibi, resetPose, sitLegs, arms, HIP_H } from '../chibi.js';
import { loadKit, kit } from '../kit.js';
import { laptopModel } from '../realistic-props.js';
import { realMonitor } from '../realistic-office.js';

export const PX = 24;                                          // pixels per metre in the atlas
export const DIRS = 8;                                         // headings: d * 45°
export const KEYS = { skin: '#ff0000', hair: '#00ff00', shirt: '#0000ff', pants: '#ffff00', shoe: '#ff00ff', hat: '#00ffff', eye: '#800080' };
const STYLES = ['bob', 'spiky', 'pony', 'buns', 'farmer'];
const POSES = ['type-a', 'type-b', 'think', 'wait', 'sleep', 'stand', 'walk-a', 'walk-b'];
const DEVICES = ['plant', 'whiteboard', 'printer', 'coffee', 'pantry', 'bookshelf', 'sofa', 'rug', 'tv', 'beanbag', 'pingpong', 'server-rack', 'meeting-table', 'lamp'];
const ISO = new THREE.Vector3(1, .95, 1).normalize();
const SIZE = 320;
const SEAT_Y = .62 - HIP_H + .06;

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(SIZE, SIZE); renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);
const cam = new THREE.OrthographicCamera(-SIZE / 2 / PX, SIZE / 2 / PX, SIZE / 2 / PX, -SIZE / 2 / PX, .1, 200);
cam.position.copy(ISO).multiplyScalar(60); cam.lookAt(0, 0, 0);
const lit = new THREE.Scene();
lit.add(new THREE.HemisphereLight('#fff8ec', '#b9a68a', 1.15));
const sun = new THREE.DirectionalLight('#fff1dc', 2.1); sun.position.set(-6, 14, 8); lit.add(sun, sun.target);

const out = []; // { key, canvas, ax, ay }
const work = document.createElement('canvas'); work.width = work.height = SIZE;
const wx = work.getContext('2d', { willReadFrequently: true });
function grab(obj, key, { flatColors = false, white = false } = {}) {
  const restore = [];
  if (flatColors || white) obj.traverse((o) => {
    if (!o.isMesh || !o.material || o.material.side === THREE.BackSide) return;    // outlines stay as they are
    const m = o.material;
    restore.push([o, m]);
    o.material = flatColors ? new THREE.MeshBasicMaterial({ color: m.color }) : (() => { const c = m.clone(); c.color = new THREE.Color('#ffffff'); if (c.map) c.map = null; return c; })();
  });
  lit.add(obj);
  renderer.render(lit, cam);
  lit.remove(obj);
  for (const [o, m] of restore) o.material = m;
  wx.clearRect(0, 0, SIZE, SIZE); wx.drawImage(renderer.domElement, 0, 0);
  const img = wx.getImageData(0, 0, SIZE, SIZE).data;
  let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (img[(y * SIZE + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return;
  const c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  c.getContext('2d').drawImage(work, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  out.push({ key, canvas: c, ax: SIZE / 2 - x0, ay: SIZE / 2 - y0 });                // where the object's origin is in the sprite
}
const turned = (obj, d) => { const g = new THREE.Group(); obj.rotation.y = d * Math.PI / 4; g.add(obj); return g; };

function deskSet(lead, device) {
  const g = new THREE.Group(); g.scale.setScalar(STATION_SCALE);
  const kd = kit(lead ? 'table_medium' : 'table_medium_long', { w: 1.6, d: .8, h: .955, uniform: false });
  if (kd) { kd.position.set(0, 0, .62); g.add(kd); }
  const dark = new THREE.MeshBasicMaterial({ color: '#1e293b' });
  if (device === 'dual-monitor') {
    for (const [x, ry] of [[-.36, .18], [.36, -.18]]) {
      const grp = new THREE.Group(); grp.position.set(x, 1.3, .8); grp.rotation.y = ry; g.add(grp);
      realMonitor(grp, .62, .38, .955, 1.3);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(.58, .34), dark); s.position.z = -.017; s.rotation.y = Math.PI; grp.add(s);
    }
  } else { const lap = laptopModel({ w: .46 }); lap.position.set(0, .955, .5); g.add(lap); }
  return g;
}
function chair() { const g = new THREE.Group(); g.scale.setScalar(STATION_SCALE); const c = kit('chair_C', { h: 1.12 }); if (c) { c.position.set(0, 0, -.08); c.rotation.y = Math.PI; g.add(c); } return g; }

function pose(R, p) {
  resetPose(R);
  const sit = ['type-a', 'type-b', 'think', 'wait', 'sleep'].includes(p);
  if (sit) { R.root.position.set(0, SEAT_Y, 0); sitLegs(R); }
  if (p === 'type-a' || p === 'type-b') { const tap = p === 'type-a' ? 1 : -1; arms(R, [-1.0, -.32, -.62 + tap * .1], [-1.0, .32, -.62 - tap * .1]); R.torso.rotation.x = .1; R.head.rotation.x = .1; }
  if (p === 'think') { R.torso.rotation.x = -.18; arms(R, [-.45, .15, -.9], [-.45, -.15, -.9]); R.head.rotation.set(-.08, .2, 0); }
  if (p === 'wait') { arms(R, [-.4, .2, -.6], [-.2, -2.7, -.3]); R.head.rotation.set(-.15, 0, 0); }
  if (p === 'sleep') { R.torso.rotation.x = .55; R.head.rotation.set(.5, 0, .15); arms(R, [-1.3, -.5, -1.2], [-1.3, .5, -1.2]); }
  if (p === 'walk-a' || p === 'walk-b') {
    const s = p === 'walk-a' ? 1 : -1, A = .55;
    R.lLeg.hip.rotation.x = s * A; R.rLeg.hip.rotation.x = -s * A;
    R.lLeg.knee.rotation.x = s < 0 ? A * .8 : 0; R.rLeg.knee.rotation.x = s > 0 ? A * .8 : 0;
    arms(R, [-s * A * .9, .15, -.25], [s * A * .9, -.15, -.25]);
    R.torso.rotation.x = .05; R.hips.position.y = HIP_H + .02;
  }
}

async function main() {
  await new Promise((ok) => loadKit('../assets/kaykit/office.glb', ok));
  for (const type of DEVICES) for (let d = 0; d < DIRS; d++) {
    const g = buildDevice({ id: type, type, x: 0, z: 0, ry: 0 }); g.position.set(0, 0, 0);
    grab(turned(g, d), `dev:${type}:${d}`);
  }
  for (const lead of [false, true]) for (const device of ['laptop', 'dual-monitor']) for (let d = 0; d < DIRS; d++) grab(turned(deskSet(lead, device), d), `desk:${lead ? 'lead' : 'std'}:${device}:${d}`);
  for (let d = 0; d < DIRS; d++) grab(turned(chair(), d), `chair:${d}`);
  for (const style of STYLES) {
    const R = buildChibi({ ...KEYS, sleeve: KEYS.shirt, style, overall: style === 'farmer' ? '#3b6fb6' : undefined });
    const human = new THREE.Group(); human.add(R.root); human.scale.setScalar(STATION_SCALE);
    for (const p of POSES) {
      pose(R, p);
      for (let d = 0; d < DIRS; d++) {
        const g = turned(human, d);
        grab(g, `ch:${style}:${p}:${d}:m`, { flatColors: true });
        grab(g, `ch:${style}:${p}:${d}:s`, { white: true });
        g.remove(human);
      }
    }
  }
  // shelf packing into one atlas
  const W = 2048; let x = 0, y = 0, rowH = 0;
  const sorted = [...out].sort((a, b) => b.canvas.height - a.canvas.height);
  for (const s of sorted) { if (x + s.canvas.width > W) { x = 0; y += rowH + 1; rowH = 0; } s.x = x; s.y = y; x += s.canvas.width + 1; rowH = Math.max(rowH, s.canvas.height); }
  const atlas = document.createElement('canvas'); atlas.width = W; atlas.height = y + rowH + 1;
  const ax = atlas.getContext('2d');
  for (const s of sorted) ax.drawImage(s.canvas, s.x, s.y);
  window.__atlas = { png: atlas.toDataURL('image/png'), json: { v: 1, px: PX, dirs: DIRS, keys: KEYS, outline: '#3a2a22', iso: ISO.toArray().map((v) => +v.toFixed(4)), styles: STYLES, poses: POSES,
    sprites: Object.fromEntries(sorted.map((s) => [s.key, [s.x, s.y, s.canvas.width, s.canvas.height, s.ax, s.ay]])) } };
}
main().catch((e) => { window.__atlas = { error: e.message }; });
