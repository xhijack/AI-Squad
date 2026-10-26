// The 3D Building: a warm isometric office per Floor (after the squad-3d office), stacked into a dollhouse in the
// Lobby; desks with chibi agents, devices, an orthographic isometric camera, and a perspective camera for the
// first person and screen views.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildChibi, HIP_H, resetPose, blink, sitLegs, arms } from './chibi.js';
import { FW, FD, FH, floorY, desksFor, toRoom } from './layout.js';
import { makeScreen, drawScreen } from './screens.js';
import { loungeSpots, updateLife, deskHome, seatRoot, MEETING_SEATS, meetingSeats } from './life.js';
import { Quality, contactShadow } from './render.js';
import { loadKit, kit, kitStamp } from './kit.js';
import { NavGrid, footprints } from './nav.js';
import { deskProps, propsFor } from './props.js';
import { laptopModel } from './realistic-props.js';
import { REAL } from './look.js';
import { mergeStatic } from './merge.js';
import { loadOffice, officeStamp, realRoom, realDesk, realMonitor, realDeskProps, REAL_DEVICES } from './realistic-office.js';

const UP = new THREE.Vector3(0, 1, 0);
export const POV_FOV = 72;
const ISO = new THREE.Vector3(1, .95, 1).normalize();       // isometric: azimuth 45°, elevation ~34° (like squad-3d)
const ORTHO_H = 10;                                          // half the frustum height at zoom 1
const TOP = .36;                                             // floor surface height inside a Floor group
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// shared materials per colour (fewer GPU programs on shared machines)
const matCache = new Map();
const mat = (c, o) => {
  if (o) return new THREE.MeshStandardMaterial({ color: c, roughness: .75, ...o });
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: .75 }));
  return matCache.get(c);
};
const basic = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });

function box(w, h, d, m, x, y, z, parent, r = .04) {
  const b = new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; parent.add(b); return b;
}
function cyl(rt, rb, h, m, x, y, z, parent, seg = 18) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  c.position.set(x, y, z); c.castShadow = c.receiveShadow = true; parent.add(c); return c;
}
function ball(r, m, x, y, z, parent, sy = 1) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m);
  s.scale.y = sy; s.position.set(x, y, z); s.castShadow = true; parent.add(s); return s;
}
function label(html, cls, parent, x, y, z) {
  const el = document.createElement('div'); el.className = cls; el.innerHTML = html;
  const o = new CSS2DObject(el); o.position.set(x, y, z); parent.add(o); return o;
}

// text drawn on a canvas plane (brand wall); redrawn once the UI font has loaded
function textPlane(lines, w, h) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const draw = () => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of lines) {
      let size = l.size;
      g.font = `${l.weight} ${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
      while (g.measureText(l.text).width > c.width * .9 && size > 20) { size -= 6; g.font = `${l.weight} ${size}px "Plus Jakarta Sans", system-ui, sans-serif`; }
      g.shadowColor = l.glow || 'transparent'; g.shadowBlur = l.glow ? 36 : 0;
      g.fillStyle = l.color; g.fillText(l.text, c.width / 2, l.y * c.height);
    }
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.ready.then(draw);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
}

// honey wood planks, drawn once
let woodTex = null;
function wood() {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = ['#d9b98c', '#d3b184', '#ddc095', '#cfac7f'][i % 4]; g.fillRect(0, i * 64, 512, 64);
    g.fillStyle = 'rgba(90,60,30,.18)'; g.fillRect(0, i * 64, 512, 2); g.fillRect((i * 173) % 512, i * 64, 2, 64); g.fillRect((i * 173 + 256) % 512, i * 64, 2, 64);
  }
  woodTex = new THREE.CanvasTexture(c); woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping; woodTex.repeat.set(FW / 6, FD / 6);
  woodTex.colorSpace = THREE.SRGBColorSpace; woodTex.anisotropy = 4;
  return woodTex;
}

// ---------- devices (movable, in floor.json) ----------
const NOTES = ['#fde68a', '#fbcfe8', '#bbf7d0', '#bfdbfe', '#fed7aa'];
const DEVICE_BUILDERS = {
  plant(g) {
    cyl(.32, .25, .6, mat('#e7e1d6'), 0, .3, 0, g);
    cyl(.27, .27, .04, mat('#5b3a1e'), 0, .6, 0, g);
    for (let i = 0; i < 4; i++) ball(.38, mat(['#2f7d4a', '#3f9a5c', '#256b3d'][i % 3]), Math.cos(i * 1.7) * .2, .95 + i * .28, Math.sin(i * 1.7) * .2, g);
  },
  whiteboard(g, d) {
    // on the back wall: a big board with sticky notes; standing in the room: the same board on legs
    const onWall = d && d.z < -FD / 2 + .9;
    const y = onWall ? 2.05 : 1.45;
    if (!onWall) for (const x of [-1.1, 1.1]) box(.07, 1.6, .07, mat('#9ca3af'), x, .8, 0, g, .01);
    box(2.8, 1.5, .08, mat('#ffffff', { roughness: .3 }), 0, y, 0, g, .02);
    box(2.9, .08, .16, mat('#9ca3af'), 0, y - .8, .06, g, .01);
    for (let i = 0; i < 12; i++) box(.3, .3, .02, mat(NOTES[i % NOTES.length]), -1.1 + (i % 6) * .44, y + .4 - Math.floor(i / 6) * .45, .05, g, 0);
    for (const [w, c, yy] of [[1.1, '#3d82d6', -.35], [.7, '#e2574c', -.52]]) box(w, .04, .01, basic(c), -1.15 + w / 2, y + yy, .05, g, 0);
  },
  printer(g) {
    box(.9, .55, .7, mat('#c9ced8'), 0, .28, 0, g, .03);
    box(.95, .3, .75, mat('#e6e9ef'), 0, .7, 0, g, .03);
    box(.6, .02, .4, basic('#ffffff'), 0, .87, .1, g, 0);
    box(.12, .05, .02, basic('#4fc38a'), .3, .7, .38, g, 0);
  },
  coffee(g) {
    box(.9, .9, .6, mat('#2f3a4a'), 0, .45, 0, g, .03);
    box(.95, .06, .65, mat('#e7e5e4', { roughness: .3 }), 0, .93, 0, g, .01);
    box(.45, .55, .4, mat('#9ca3af', { metalness: .6, roughness: .3 }), -.1, 1.23, 0, g, .04);
    cyl(.06, .05, .12, mat('#ffffff'), .25, 1.02, .05, g);
  },
  // pantry counter along a wall: cabinets, worktop, coffee machine, cups
  pantry(g) {
    box(3.4, 1.05, .9, mat('#2f3a4a'), 0, .53, 0, g, .02);
    box(3.5, .08, 1, mat('#e7e5e4', { roughness: .3 }), 0, 1.09, 0, g, .01);
    for (const x of [-1.1, 0, 1.1]) box(.9, .8, .02, mat('#3b4658'), x, .53, .46, g, .01);
    box(.6, .7, .5, mat('#9ca3af', { metalness: .6, roughness: .3 }), -1.1, 1.48, -.1, g, .04);
    box(.2, .06, .3, mat('#111827'), -1.1, 1.2, .18, g, .01);
    ['#f59e0b', '#ffffff', '#10b981'].forEach((c, i) => cyl(.09, .07, .18, mat(c), .3 + i * .32, 1.22, .1, g));
    box(.7, .45, .4, mat('#e7e1d6'), 1.2, 1.36, -.1, g, .05);                      // bread box
  },
  bookshelf(g) {
    box(1.4, 1.9, .45, mat('#a0754f'), 0, .95, 0, g, .02);
    const colors = ['#e2574c', '#3d82d6', '#f2b544', '#4fa36b', '#7c5cd6', '#2bb3a3'];
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) box(.16, .34, .3, mat(colors[(r * 3 + i) % 6]), -.5 + i * .2, .3 + r * .45, .05, g, .01);
  },
  sofa(g) {
    const m = mat('#3f6c8a');
    box(2.6, .45, .95, m, 0, .32, 0, g, .1);
    box(2.6, .7, .3, m, 0, .72, -.34, g, .1);
    for (const x of [-1.2, 1.2]) box(.28, .55, .95, m, x, .55, 0, g, .1);
    for (const x of [-.62, .62]) box(1.1, .14, .8, mat('#4c7fa0'), x, .6, .05, g, .06);
  },
  rug(g) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, .03, 48), mat('#e9a07a', { roughness: 1 })); r.position.y = .015; r.receiveShadow = true; g.add(r);
    const i = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, .032, 48), mat('#efb08c', { roughness: 1 })); i.position.y = .017; i.receiveShadow = true; g.add(i);
  },
  tv(g) {
    box(2.2, .45, .5, mat('#2f3a4a'), 0, .23, 0, g, .03);                          // console
    const frame = mat('#111827', { roughness: .3 });
    const screen = new THREE.MeshStandardMaterial({ color: '#0b1220', emissive: '#1e3a5f', emissiveIntensity: .6, roughness: .2 });
    const tv = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.2, .07), [frame, frame, frame, frame, screen, frame]);
    tv.position.set(0, 1.12, -.05); tv.castShadow = true; g.add(tv);
    box(.5, .1, .3, mat('#e5e7eb'), .6, .5, .05, g, .02);                          // game console
  },
  beanbag(g) {
    const colors = ['#f59e0b', '#10b981', '#e2574c', '#7c5cd6'];
    const c = colors[Math.abs([...String(g.userData.device || '')].reduce((n, ch) => n + ch.charCodeAt(0), 0)) % colors.length];
    ball(.7, mat(c), 0, .38, 0, g, .62);
  },
  pingpong(g) {
    box(2.7, .08, 1.5, mat('#1e7a53'), 0, .78, 0, g, .02);
    box(2.7, .01, .03, basic('#ffffff'), 0, .825, 0, g, 0);
    box(.03, .18, 1.5, mat('#f5f5f4'), 0, .9, 0, g, 0);                          // net
    for (const [x, z] of [[-1.2, -.6], [1.2, -.6], [-1.2, .6], [1.2, .6]]) cyl(.05, .05, .75, mat('#2f3a4a'), x, .37, z, g, 8);
    for (const s of [-1, 1]) { cyl(.11, .11, .02, mat('#dc2626'), s * .95, .84, .3 * s, g, 16); }
  },
  'meeting-table'(g) {
    // an oval table with six chairs: sprint planning, plan reviews, Retro, standups and briefings
    const top = cyl(1.05, 1.05, .07, mat('#8a5a35', { roughness: .45 }), 0, .76, 0, g, 40); top.scale.set(1.25, 1, .75);
    cyl(.14, .22, .72, mat('#2f3a4a', { metalness: .4, roughness: .4 }), 0, .37, 0, g, 16);
    cyl(.45, .45, .03, mat('#2f3a4a'), 0, .02, 0, g, 24);
    box(.5, .02, .34, mat('#f4efe6'), -.3, .805, .05, g, 0);                         // papers and a laptop on the table
    box(.42, .015, .3, mat('#cbd5e1', { metalness: .3 }), .45, .805, -.1, g, 0);
    for (const s of MEETING_SEATS) {
      const c = new THREE.Group(); c.position.set(s.x, 0, s.z); c.rotation.y = s.face; g.add(c);              // the backrest away from the table
      box(.42, .06, .42, mat('#3d4a5c'), 0, .48, 0, c, .02);
      box(.42, .45, .06, mat('#3d4a5c'), 0, .72, -.2, c, .02);
      cyl(.03, .03, .45, mat('#9ca3af'), 0, .24, 0, c, 8);
    }
  },
  lamp(g) {                                                                  // a standing lamp (KayKit lamp_standing when loaded)
    cyl(.22, .26, .05, mat('#2f3a4a'), 0, .025, 0, g, 20);
    cyl(.03, .03, 1.7, mat('#2f3a4a'), 0, .87, 0, g, 8);
    cyl(.22, .32, .38, basic('#fde9c4'), 0, 1.82, 0, g, 20);
  },
  'server-rack'(g) {
    box(.8, 2, .8, mat('#1f2937', { roughness: .5, metalness: .3 }), 0, 1, 0, g, .02);
    // two LED columns that follow the machine load (setLoad): CPU on the left, RAM on the right
    g.userData.rack = true; g.userData.leds = [];
    for (let i = 0; i < 7; i++) {
      for (const x of [-.17, .17]) g.userData.leds.push({ row: i, col: x < 0 ? 'cpu' : 'mem', mesh: box(.3, .14, .02, basic('#3a4058', { toneMapped: false }), x, .35 + i * .23, .41, g, 0) });
      box(.04, .04, .02, basic('#4fc38a', { toneMapped: false }), .33, .35 + i * .23, .42, g, 0);
    }
  },
};
export const DEVICE_LABELS = { plant: 'Plant', whiteboard: 'Whiteboard', printer: 'Printer', coffee: 'Coffee machine', pantry: 'Pantry counter', bookshelf: 'Bookshelf',
  sofa: 'Sofa', rug: 'Lounge rug', tv: 'TV', beanbag: 'Beanbag', pingpong: 'Ping-pong table', 'server-rack': 'Server rack', 'meeting-table': 'Meeting table', lamp: 'Floor lamp' };

// KayKit versions of the devices (ui/kit.js); a device without one, or before the models load, is procedural
const add = (g, o) => { if (o) g.add(o); return o; };
const KIT_CHAIR_TURN = Math.PI;              // KayKit chairs face -z; ours face the desk at +z
const KIT_DEVICES = {
  sofa: (g) => add(g, kit('couch_pillows', { w: 2.7 })),
  rug: (g) => { const r = kit('rug_rectangle_stripes_A', { w: 4.2, d: 3.2, h: .03, uniform: false }); if (r) r.traverse((o) => { if (o.isMesh) o.castShadow = false; }); return add(g, r); },
  plant: (g) => add(g, kit('cactus_medium_A', { h: 1.3 })),
  bookshelf: (g) => add(g, kit('cabinet_medium_decorated', { w: 1.6 })),
  lamp: (g) => add(g, kit('lamp_standing', { h: 2.1 })),
  pantry: (g) => {
    const parts = [kit('kitchencounter_straight_A_decorated', { w: 1.15 }), kit('kitchencounter_straight_A_decorated', { w: 1.15 }), kit('fridge_A', { w: 1.1 })];
    if (parts.some((p) => !p)) return null;
    parts.forEach((p, i) => { p.position.set(-1.15 + i * 1.15, 0, -.12); g.add(p); });
    return g;
  },
  'meeting-table': (g) => {
    const t = kit('table_medium_long', { w: 2.5, d: 1.55, h: .78, uniform: false });
    if (!t) return null;
    g.add(t);
    for (const s of MEETING_SEATS) { const c = kit('chair_A', { h: 1.0 }); c.position.set(s.x, 0, s.z); c.rotation.y = s.face + Math.PI; g.add(c); }
    return g;
  },
};

function buildDevice(d) {
  const g = new THREE.Group();
  g.userData.device = d.id;
  const built = REAL ? REAL_DEVICES[d.type]?.(g, d, FD, MEETING_SEATS) : KIT_DEVICES[d.type]?.(g, d);
  if (!built) (DEVICE_BUILDERS[d.type] || DEVICE_BUILDERS.plant)(g, d);
  mergeStatic(g);                                                             // one mesh per material
  g.position.set(d.x, TOP, d.z); g.rotation.y = d.ry || 0;
  return g;
}

// ---------- the room (fixed architecture) ----------
const WINDOWS = [-4.2, .2, 4.4].map((z) => toRoom({ x: 0, z }).z), BRAND_X = toRoom({ x: -4.3, z: 0 }).x;   // on the left and back walls
// cutaway office: wood floor, the back and left walls with baseboards, windows on the left wall, and a brand
// wall with the Floor name and tagline on the back wall
function buildRoom(g, f, accent) {
  const lobby = !f;
  if (REAL) realRoom(g, { FW, FD, FH, TOP, missing: f?.missing, windows: WINDOWS });                            // realistic look: PBR floor, plaster, windows
  else buildToonRoom(g, f);
  box(FW + .5, .07, .07, basic(accent), 0, .27, FD / 2 + .25, g, 0);                          // brand colour stripe
  box(.07, .07, FD + .5, basic(accent), FW / 2 + .25, .27, 0, g, 0);
  if (lobby) return;
  // brand wall: a dark panel with the Floor name and its tagline
  box(5.6, FH - .4, .05, mat('#2f4858'), BRAND_X, TOP + FH / 2 + .1, -FD / 2 + .03, g, 0);
  box(3.2, .06, .02, basic(accent), BRAND_X, TOP + 1.25, -FD / 2 + .07, g, 0);
  const lines = [{ text: f.name || 'Floor', size: 220, weight: 800, color: '#ffe7b0', glow: '#ffb347', y: .4 }];
  if (f.tagline) lines.push({ text: f.tagline, size: 96, weight: 600, color: '#cbd5e1', y: .78 });
  const sign = textPlane(lines, 5.2, 2.2);
  sign.position.set(BRAND_X, TOP + 2.25, -FD / 2 + .08); g.add(sign);
}
function buildToonRoom(g, f) {
  box(FW + .5, .3, FD + .5, mat('#e7dfd1'), 0, .15, 0, g, .02);                              // slab
  box(FW, .06, FD, f?.missing ? mat('#cfc8bb') : mat('#ffffff', { map: wood(), roughness: .6 }), 0, TOP - .03, 0, g, 0);
  const wall = mat('#f6f2ea');
  box(FW + .3, FH, .3, wall, -.15, TOP + FH / 2, -FD / 2 - .15, g, 0);                       // back wall
  box(.3, FH, FD, wall, -FW / 2 - .15, TOP + FH / 2, 0, g, 0);                                // left wall
  box(FW, .32, .06, mat('#2f3a4a'), 0, TOP + .16, -FD / 2 + .03, g, 0);                       // baseboards
  box(.06, .32, FD, mat('#2f3a4a'), -FW / 2 + .03, TOP + .16, 0, g, 0);
  // windows on the left wall
  const glass = mat('#bfe3f5', { emissive: '#bfe3f5', emissiveIntensity: .35, roughness: .1 });
  for (const z of WINDOWS) {
    box(.08, 1.7, 2.8, glass, -FW / 2 + .02, TOP + 2.05, z, g, 0);
    for (const y of [1.2, 2.9]) box(.12, .1, 3, mat('#2f3a4a'), -FW / 2 + .05, TOP + y, z, g, 0);
    box(.12, 1.8, .1, mat('#2f3a4a'), -FW / 2 + .05, TOP + 2.05, z, g, 0);
  }
}

// ---------- agents at desks ----------
export const LOOK_BASE = { eye: '#2f3a4a', pants: '#334155', shoe: '#1f2937', hat: '#f08a24', skin: '#f6d2b0', hair: '#2b2440', shirt: '#3d82d6', style: 'bob' };
export const lookFor = (a = {}) => { const l = { ...LOOK_BASE, ...a }; return { ...l, sleeve: l.shirt, overall: l.style === 'farmer' ? '#3b6fb6' : undefined }; };
// desks and agents are a bit larger than life in the room, so agents stay big and readable (like squad-3d)
export const STATION_SCALE = 1.3;
const STATE_RING = { working: '#16a34a', waiting: '#dc2626', idle: '#d97706', stopped: '#9ca3af' };

function buildStation(agent, desk, accent) {
  const g = new THREE.Group();
  g.position.set(desk.x, TOP, desk.z); g.rotation.y = desk.ry || 0; g.scale.setScalar(STATION_SCALE);
  g.userData.agent = agent.id;
  const lead = agent.lead || agent.kindOf === 'lead';
  const kd = !REAL && kit(lead ? 'table_medium' : 'table_medium_long', { w: 1.6, d: .8, h: .955, uniform: false });   // KayKit desk when loaded
  if (REAL) realDesk(g, lead);                                                  // oak desk and an office chair
  else if (kd) { kd.position.set(0, 0, .62); g.add(kd); }
  else {
    box(1.6, .07, .8, mat(lead ? '#8a5a35' : '#f4efe6', { roughness: .5 }), 0, .92, .62, g);         // desk
    for (const x of [-.72, .72]) box(.06, .9, .66, mat('#2f3a4a', { metalness: .5, roughness: .4 }), x, .46, .62, g, .02);
  }
  const screens = [];
  // a monitor = housing (bezel, back, neck, foot) + canvas plane facing the chair (-z); clicking it opens the
  // over-the-shoulder view
  const live = (parent, w, h, x, y, z, part) => {
    const S = makeScreen(w, h);
    S.mesh.position.set(x, y, z); S.mesh.rotation.y = Math.PI; S.mesh.userData.screen = true; S.part = part;
    parent.add(S.mesh); screens.push(S);
  };
  const screen = (x, y, z, w, h, rx, ry, part) => {
    const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.set(rx, ry, 0); g.add(grp);
    realMonitor(grp, w, h, .955, y);
    live(grp, w - .04, h - .04, 0, 0, -.017, part);
  };
  if (desk.device === 'dual-monitor') {
    screen(-.36, 1.3, .8, .62, .38, 0, .5 * .36, 'main');
    screen(.36, 1.3, .8, .62, .38, 0, -.5 * .36, 'side');
    if (!REAL) box(.5, .02, .18, mat('#c9ced6'), 0, .965, .45, g, .005);      // keyboard
  } else {
    const lap = laptopModel({ w: .46 }); lap.position.set(0, .955, .5); g.add(lap);              // a real laptop's proportions
    const sc = lap.userData.screen;
    live(lap.userData.lid, sc.w, sc.h, 0, sc.y, sc.z, 'main');
  }
  if (REAL) realDeskProps(g, .955, desk.device === 'dual-monitor', (agent.appearance && agent.appearance.shirt) || '#e2574c');
  deskProps(g, agent, desk.device);
  const kc = !REAL && kit('chair_C', { h: 1.12 });
  if (REAL) { /* the office chair came with the desk */ }
  else if (kc) { kc.position.set(0, 0, -.08); kc.rotation.y = KIT_CHAIR_TURN; g.add(kc); }
  else {
    const chair = mat('#1f2937');
    box(.62, .1, .6, chair, 0, .55, -.05, g, .04);                              // chair
    box(.62, .6, .1, chair, 0, .9, -.33, g, .04);
    cyl(.04, .04, .45, mat('#2f3a4a'), 0, .27, -.05, g, 8);
  }
  // state ring on the floor around the chair
  const ringMat = basic(STATE_RING[agent.state] || STATE_RING.stopped, { transparent: true, opacity: .55, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.92, 1.04, 48), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.set(0, .015, .2); g.add(ring);
  const rig = buildChibi(lookFor(agent.appearance));
  const human = new THREE.Group();                                              // the agent itself: can leave the desk
  human.userData.agent = agent.id;
  human.userData.human = true;                                                  // clicking the body opens the agent's eyes
  human.add(rig.root, contactShadow());                                        // a soft shadow on the floor under the character
  human.scale.setScalar(STATION_SCALE);
  const st = { id: agent.id, g, human, rig, screens, ringMat, state: agent.state, data: agent, blinkAt: Math.random() * 3, phase: Math.random() * 6, accent };
  // name chip in the agent's colour above the head, its status under it, zzz when idle (as in squad-3d)
  st.label = label('<span class="q" aria-hidden="true">?</span><div class="z" aria-hidden="true">z z z</div><span class="n"></span><div class="a"></div>', 'nlabel', human, 0, 1.95, 0);
  st.label.center.set(.5, 1);
  const color = (agent.appearance && agent.appearance.shirt) || '#3d82d6';
  Object.assign(st.label.element.querySelector('.n').style, { background: color, color: inkOn(color) });
  st.say = label('', 'say', human, 0, 2.75, 0); st.say.center.set(.5, 1); st.say.visible = false;   // lead shout
  mergeStatic(g);                                                             // desk, chair, props: one mesh per material
  deskHome(st);
  updateStation(st, agent);
  return st;
}

// readable text on a coloured chip: dark ink on light colours, white on dark ones
function inkOn(hex) {
  const n = parseInt(String(hex).slice(1), 16), [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b > .4 ? '#1f2937' : '#ffffff';
}
const STATUS_TEXT = { working: 'working', waiting: 'needs you', idle: 'idle', stopped: 'stopped' };
const shortActivity = (s) => { s = String(s || '').replace(/^(terminal|thinking): /, ''); return s.length > 30 ? `${s.slice(0, 29)}…` : s; };

function updateStation(st, a) {
  st.state = a.state; st.data = a;
  const el = st.label.element;
  const name = String(a.displayName || '').split(' - ')[0];
  const status = st.away || (a.standby ? 'not started' : a.crash && !a.crash.withLead ? 'stopped unexpectedly' : a.waitingReply ? 'waiting for your reply' : a.state === 'working' && a.activity ? shortActivity(a.activity) : STATUS_TEXT[a.state] || a.state || '');
  const cls = `nlabel ${a.state || 'stopped'}${a.standby ? ' standby' : ''}${st.away ? ' away' : ''}`;
  if (el.className !== cls) el.className = cls;
  const n = el.querySelector('.n'), s = el.querySelector('.a');
  if (n.textContent !== name) n.textContent = name;
  if (s.textContent !== status) s.textContent = status;
  el.title = `${a.displayName}: ${st.away || a.activity || a.state}`;
  st.ringMat.color.set(STATE_RING[a.state] || STATE_RING.stopped);
  st.label.visible = !!st.labelsOn;
}

function poseDesk(st, t, awake = false) {
  const R = st.rig, p = t + st.phase;
  const state = awake && st.state === 'stopped' ? 'idle' : st.state;   // seen through its own eyes: sit up
  resetPose(R); blink(st, t);
  seatRoot(R);
  sitLegs(R);
  if (state === 'waiting') {
    arms(R, [-.4, .2, -.6], [-.2, -2.7 - Math.sin(p * 6) * .25, -.3]);         // raise a hand
    R.head.rotation.set(-.15, Math.sin(p * 2) * .2, 0);
  } else if (state === 'working') {
    const tap = Math.sin(p * 16);
    arms(R, [-1.0, -.32, -.62 + tap * .1], [-1.0, .32, -.62 - tap * .1]);
    R.torso.rotation.x = .1; R.head.rotation.x = .1;
  } else if (state === 'stopped') {
    R.torso.rotation.x = .55; R.head.rotation.set(.5, 0, .15);                  // asleep on the desk
    arms(R, [-1.3, -.5, -1.2], [-1.3, .5, -1.2]);
  } else {
    R.torso.rotation.x = -.18;
    arms(R, [-.45, .15, -.9], [-.45, -.15, -.9]);
    R.head.rotation.set(-.08, Math.sin(p * .5) * .3, 0);
  }
}

// ?nav=1: the walkable grid (blocked cells in red) and the paths characters walk (navigation debug overlay)
const NAV_DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nav') === '1';
// ?states=working,idle,...: agent states by position, shown in the view only (screenshots of a look; nothing is sent)
const DEMO_STATES = typeof location !== 'undefined' && new URLSearchParams(location.search).get('states')?.split(',');
function navOverlay(grid) {
  const n = grid.blocked.reduce((a, b) => a + b, 0);
  const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(grid.cell * .9, grid.cell * .9), basic('#dc2626', { transparent: true, opacity: .28, depthWrite: false }), n);
  const q = new THREE.Object3D(); let k = 0;
  for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) if (grid.blocked[j * grid.w + i]) { const c = grid.centre(i, j); q.position.set(c.x, TOP + .03, c.z); q.rotation.x = -Math.PI / 2; q.updateMatrix(); m.setMatrixAt(k++, q.matrix); }
  m.userData.navDebug = true;
  return m;
}
function drawPaths(o) {
  if (!o.pathLine) { o.pathLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#2563eb' })); o.g.add(o.pathLine); }
  const pts = [];
  for (const st of o.stations.values()) {
    const w = st.life?.walker; if (!w) continue;
    let a = { x: w.x, z: w.z };
    for (const b of w.path) { pts.push(a.x, TOP + .06, a.z, b.x, TOP + .06, b.z); a = b; }
  }
  o.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}

// ---------- floors ----------
function sigOf(f) {
  return JSON.stringify([kitStamp(), officeStamp(), f.number, f.name, f.tagline, f.accent, f.layout, f.desks, f.devices, f.missing, (f.agents || []).map((a) => [a.id, a.appearance, a.lead, a.kindOf])]);
}

function dispose(o) {
  o.traverse((x) => { if (x.isCSS2DObject) x.element.remove(); if (x.geometry && !x.userData.kit) x.geometry.dispose(); });   // KayKit geometry is shared
  o.removeFromParent();
}

const corners = (x0, x1, y0, y1, z0, z1) => {
  const out = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push(new THREE.Vector3(x, y, z));
  return out;
};

export class BuildingScene {
  constructor(container, handlers = {}) {
    this.handlers = handlers;
    this.floors = new Map();                  // id -> { g, stations: Map, devices: Map, data, sig, label }
    this.view = { mode: 'lobby' };
    this.top = 0;
    this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#efe9df');
    // isometric orthographic camera for the Lobby, Floors and Desks; perspective for the eyes and the screen
    this.ortho = new THREE.OrthographicCamera(-ORTHO_H, ORTHO_H, ORTHO_H, -ORTHO_H, -200, 400);
    this.persp = new THREE.PerspectiveCamera(40, 1, .05, 500);
    this.camera = this.ortho;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));       // Quality sets 1.5 on High, 1 on Low
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;                                 // redrawn on demand (frame)
    this.renderer.toneMapping = REAL ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);
    this.container = container;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // fixed isometric angle: drag pans, the wheel zooms (smoothly)
    Object.assign(this.controls, { enableDamping: true, dampingFactor: .12, enableRotate: false, screenSpacePanning: true, minZoom: .04, maxZoom: 9, zoomSpeed: .8 });
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };

    this.hemi = new THREE.HemisphereLight('#fff8ec', '#b9a68a', 1.15);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#fff1dc', 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    this.aimSun(0, 1);

    // the ground only receives shadows, so the building stands on the page colour with no visible edge
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ color: '#5b4630', opacity: .1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.01; ground.receiveShadow = true; this.scene.add(ground);
    this.ground = ground;
    this.building = new THREE.Group(); this.scene.add(this.building);
    this.buildLobby();
    this.roof = new THREE.Group(); this.building.add(this.roof);
    box(FW + .5, .3, FD + .5, mat('#5b4a3a'), 0, .15, 0, this.roof, .02);
    box(FW + .1, .1, FD + .1, mat('#cbbfa9'), 0, .35, 0, this.roof, 0);
    this.roofSign = label('<b>The AI Squad</b>', 'rooflabel', this.roof, 0, 1.2, 0);

    // rendering quality: Low (one pass, as before), High (environment light, AO, grading, SMAA), Auto
    this.quality = new Quality(this.renderer, this.scene, { hemi: this.hemi, ...(REAL ? { exposure: { high: 1.45, low: 1.5 } } : {}) });
    // KayKit furniture (one small GLB): the Floors are rebuilt with it once it has loaded
    // realistic look (?look=realistic): Poly Haven furniture (one GLB) instead
    if (REAL) loadOffice(() => { if (this.lastFloors) this.sync(this.lastFloors); });
    else loadKit('./assets/kaykit/office.glb', () => { if (this.lastFloors) this.sync(this.lastFloors); });
    this.ray = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.stats = { frames: 0, ms: 0, screens: 0 };   // rendered frames, JS time in frame(), screen textures redrawn (scripts/measure.js)
    this.camAnim = null;
    this.bindPointer();
    this.resize();
    if (DEMO_STATES) window.__scene = this;                                     // screenshots of a look reach the camera
    addEventListener('resize', () => this.resize());
    // render on demand: every display frame while something moves (camera, input, walking, first person), every
    // second one while agents type or talk, and none when everyone sits still; the office life (agents getting up,
    // screens, labels) still ticks twice a second without drawing. Hidden tabs get no frames at all.
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown']) addEventListener(ev, () => { this.lastInput = performance.now(); }, { passive: true });
    this.dirty = true;
    let tick = 0, lastLogic = 0, lastDraw = 0;
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (document.hidden) return;
      tick++;
      const moving = this.camAnim || this.walking || this.view.eyes || this.view.follow || now - (this.lastInput || 0) < 1500;
      const draw = moving || this.dirty || (this.animating && tick % 2 === 0);
      if (!draw && now - lastLogic < 500) return;
      if (draw && lastDraw && now - lastDraw < 40 && tick - this.lastDrawTick === 1) this.quality.sample((now - lastDraw) / 1000);   // Auto quality: back-to-back frames only
      lastLogic = now;
      if (draw) { lastDraw = now; this.lastDrawTick = tick; }
      this.frame(draw);
    };
    requestAnimationFrame(loop);
  }

  // shadows cover the area in view: one Floor (sharp), or the whole building in the Lobby
  aimSun(y, floorsHigh) {
    const s = this.sun, half = Math.max(FW, FD) * .75 + floorsHigh * 3.5;
    // one Floor: light from above-left; the Lobby: low light through the open front so the slab above does not darken a Floor
    if (floorsHigh > 1) { s.position.set(16, y + 24, 30); s.target.position.set(0, y, 0); }
    else { s.position.set(-10, y + 24, 12); s.target.position.set(0, y + 2, 0); }
    Object.assign(s.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 120 + floorsHigh * 10 });
    s.shadow.camera.updateProjectionMatrix();
  }

  // the ground floor of the dollhouse: reception, lounge and the server rack
  buildLobby() {
    const g = new THREE.Group(); this.building.add(g); this.lobby = g;
    buildRoom(g, null, '#b7852a');
    box(4.2, 1.1, 1.1, mat('#b7852a'), 1, TOP + .55, 1.2, g, .05);                 // reception desk
    box(4.6, .1, 1.4, mat('#fbf6ea'), 1, TOP + 1.15, 1.2, g, .03);
    for (const [x, z] of [[-6.8, -5.4], [6.6, 4.8], [-6.8, 4.8]]) { const p = new THREE.Group(); DEVICE_BUILDERS.plant(p); p.position.set(x, TOP, z); g.add(p); }
    const sofa = new THREE.Group(); DEVICE_BUILDERS.sofa(sofa); sofa.position.set(-3.6, TOP, -4.6); g.add(sofa);
    const rug = new THREE.Group(); DEVICE_BUILDERS.rug(rug); rug.position.set(-3.6, TOP, -3.2); g.add(rug);
    const rack = new THREE.Group(); DEVICE_BUILDERS['server-rack'](rack); rack.position.set(FW / 2 - 1, TOP, -FD / 2 + 1); g.add(rack);
    this.lobbyRack = rack;
  }

  // slim columns at the three open corners hold the stacked Floors together as one building (Lobby only)
  buildColumns(top) {
    if (this.columns) dispose(this.columns);
    const g = new THREE.Group(), h = floorY(top + 1) - 1.6;
    for (const [x, z] of [[FW / 2 + .1, -FD / 2 - .1], [-FW / 2 - .1, FD / 2 + .1]]) box(.24, h, .24, mat('#d6ccbb'), x, h / 2, z, g, .05);
    this.building.add(g);
    this.columns = g;
  }

  // ---------- data sync ----------
  sync(floors) {
    // a poll that brings the same data changes nothing (and asks for no frame)
    const key = JSON.stringify([floors, this.draft || null, officeStamp(), kitStamp()]);
    if (key === this.syncKey) return;
    this.syncKey = key;
    this.lastFloors = floors;
    const seen = new Set();
    for (const f of floors) {
      seen.add(f.id);
      let o = this.floors.get(f.id);
      const d = this.draft && this.draft.id === f.id ? this.draft : null;
      // Edit Mode draft: layout, desks, devices and appearance previewed before saving
      let view = d ? { ...f, layout: d.layout, desks: d.desks, devices: d.devices, agents: (f.agents || []).map((a) => (d.appearance[a.id] ? { ...a, appearance: { ...a.appearance, ...d.appearance[a.id] } } : a)) } : f;
      if (DEMO_STATES) view = { ...view, agents: (view.agents || []).map((a, i) => (DEMO_STATES[i] ? { ...a, state: DEMO_STATES[i] } : a)) };
      if (o && o.sig !== sigOf(view)) { dispose(o.g); o = null; }
      if (!o) { o = this.buildFloor(view); this.floors.set(f.id, o); }
      o.data = view;
      o.label.element.innerHTML = floorLabelHtml(view);
      for (const a of view.agents || []) { const st = o.stations.get(a.id); if (st) updateStation(st, a); }
    }
    for (const [id, o] of this.floors) if (!seen.has(id)) { dispose(o.g); this.floors.delete(id); }
    const top = Math.max(0, ...floors.map((f) => f.number));
    this.roof.position.y = floorY(top + 1) - 1.6;
    if (this.top !== top || !this.columns) this.buildColumns(top);
    this.top = top;
    this.racks = [this.lobbyRack, ...[...this.floors.values()].flatMap((o) => [...o.devices.values()].filter((d) => d.userData.rack))];
    this.applyVisibility();
    if (!this.placed) { this.placed = true; this.snapTo(this.poseFor(this.view)); }
    this.dirty = true;
  }

  buildFloor(f) {
    const g = new THREE.Group();
    g.userData.floorId = f.id;
    g.position.y = floorY(f.number);
    const accent = f.accent || '#7c5cd6';
    const room = new THREE.Group(); g.add(room);
    buildRoom(room, f, accent);
    mergeStatic(room);
    const o = { g, stations: new Map(), devices: new Map(), sig: sigOf(f) };
    const devices = (f.devices || []).map(toRoom);                          // saved positions -> the wider room (layout.js)
    for (const d of devices) { const dg = buildDevice(d); g.add(dg); o.devices.set(d.id, dg); }
    const desks = desksFor(f.agents || [], f.desks, f.layout).map(toRoom);
    (f.agents || []).forEach((a, i) => {
      const st = buildStation(a, desks[i], accent);
      g.add(st.g, st.human); o.stations.set(a.id, st);
      // the name tag opens the desk; the body itself opens the first person view
      const chip = st.label.element.querySelector('.n');
      chip.style.pointerEvents = 'auto'; chip.style.cursor = 'pointer';
      chip.addEventListener('click', () => this.handlers.onPickAgent?.(f.id, a.id));
    });
    o.spots = loungeSpots(devices);
    // the walkable grid of this Floor: desks, chairs and devices with their real footprints (rebuilt with the Floor)
    // footprints measured from the devices actually built (models differ from the table in nav.js), in each
    // device's own frame; the grid is rebuilt with the Floor (also once the models have loaded)
    o.sizes = {};
    for (const [id, dg] of o.devices) {
      const p = dg.position.clone(), ry = dg.rotation.y;
      dg.position.set(0, 0, 0); dg.rotation.y = 0; dg.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(dg);
      dg.position.copy(p); dg.rotation.y = ry; dg.updateMatrixWorld(true);
      if (!b.isEmpty()) o.sizes[id] = [b.max.x - b.min.x, b.max.z - b.min.z, (b.max.x + b.min.x) / 2, (b.max.z + b.min.z) / 2];
    }
    o.nav = new NavGrid(footprints({ desks, devices }, { sizes: o.sizes }));
    if (NAV_DEBUG) g.add(navOverlay(o.nav));
    o.seats = meetingSeats(devices);
    o.occupied = new Map();
    if (f.missing) label('Directory not found', 'alabel warnlabel', g, 0, 1.4, 0);
    else if (!(f.agents || []).length) o.empty = label(f.independent ? 'No independent agents right now.' : 'No agents yet. Add one from the dock.', 'alabel', g, 0, 1.3, 0);
    o.label = label('', 'flabel', g, FW / 2 + .6, 1.2, FD / 2 - 1);
    o.label.center.set(0, .5);
    o.label.element.style.setProperty('--c', accent);
    o.label.element.style.pointerEvents = 'auto';
    o.label.element.addEventListener('click', () => this.handlers.onPickFloor?.(f.id));
    this.building.add(g);
    return o;
  }

  // ---------- view & camera ----------
  setView(view) {
    this.dirty = true;
    this.quality.setAO(view.mode !== 'lobby');
    const wasEyes = this.view.eyes, wasPersp = this.camera === this.persp;
    this.view = view;
    const persp = !!(view.eyes || view.screen || view.follow);
    if (persp && !wasPersp) {
      // hand over from the isometric camera: start the perspective camera where the ortho view looked from
      this.persp.position.copy(this.ortho.position).sub(this.controls.target).setLength(18).add(this.controls.target);
      this.persp.lookAt(this.controls.target);
    }
    this.camera = persp ? this.persp : this.ortho;
    this.controls.object = this.camera;
    const fov = view.eyes ? POV_FOV : view.follow ? 42 : 30;    // tight lens for the over-the-shoulder view
    if (persp && this.persp.fov !== fov) { this.persp.fov = fov; this.persp.updateProjectionMatrix(); }
    this.resize();
    this.applyVisibility();
    this.controls.enabled = !view.eyes && !view.follow;
    Object.assign(this.controls, persp ? { enableRotate: true, enablePan: false } : { enableRotate: false, enablePan: true });
    this.controls.mouseButtons.LEFT = persp ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    if (view.follow) { this.followReady = false; this.camAnim = null; return; }   // the chase camera takes over (updateFollow)
    if (view.eyes) {
      // first person: at the desk look down at the hands and keyboard, elsewhere straight ahead
      const st = this.floors.get(view.floorId)?.stations.get(view.agentId);
      this.look = { yaw: 0, pitch: !st?.life || st.life.mode === 'desk' ? -.42 : -.08, fov: POV_FOV, drag: null };
      this.povReady = false; this.camAnim = null;
      return;
    }
    this.flyTo(this.poseFor(view), wasEyes ? 700 : 900);
    // sharp shadows for the Floor in view, a wider shadow area for the whole building in the Lobby
    if (view.mode === 'lobby') this.aimSun(floorY(Math.max(1, this.top)) / 2, this.top + 1);
    else this.aimSun(this.floors.get(view.floorId)?.g.position.y || 0, 1);
  }

  // follow mode: a camera behind and above the agent that follows it around (desk, lounge, meetings)
  updateFollow(dt) {
    const st = this.floors.get(this.view.floorId)?.stations.get(this.view.agentId);
    if (!st) return;
    const h = st.human, head = new THREE.Vector3();
    h.updateWorldMatrix(true, false);
    h.getWorldPosition(head); head.y += 1.5;
    const fwd = new THREE.Vector3(Math.sin(h.rotation.y), 0, Math.cos(h.rotation.y));
    const want = head.clone().addScaledVector(fwd, -3.2).add(new THREE.Vector3(0, 2.4, 0)).addScaledVector(new THREE.Vector3(fwd.z, 0, -fwd.x), 1.9);
    // never through walls or furniture: a ray from the head to the wanted spot; the camera stops in front of the first hit
    if (!this.followRay || performance.now() - this.followRay.at > 100) {
      const o = this.floors.get(this.view.floorId), dir = want.clone().sub(head), len = dir.length();
      this.ray.set(head, dir.normalize()); this.ray.far = len;
      const hits = this.ray.intersectObjects(o.g.children.filter((c) => c !== st.human && c.visible), true).filter((h) => h.object.isMesh && !h.object.userData.contact && h.object.material?.opacity !== 0);
      this.followRay = { at: performance.now(), dist: hits.length ? Math.max(.6, hits[0].distance - .25) : len };
      this.ray.far = Infinity;
    }
    want.copy(head).add(want.clone().sub(head).setLength(Math.min(want.distanceTo(head), this.followRay.dist)));
    const k = this.followReady ? Math.min(1, dt * 2.5) : 1;                // eases after the agent, no jumps
    this.persp.position.lerp(want, k);
    this.followTarget = this.followReady ? this.followTarget.lerp(head, Math.min(1, dt * 4)) : head.clone();
    this.persp.lookAt(this.followTarget);
    this.controls.target.copy(this.followTarget);
    this.followReady = true;
  }

  // camera at the agent's eyes (inside its hidden head), turned by the owner's drag; follows walking and sitting
  updatePov(dt) {
    const st = this.floors.get(this.view.floorId)?.stations.get(this.view.agentId);
    if (!st) return;
    const head = st.rig.head, L = this.look, cam = this.persp;
    head.updateWorldMatrix(true, false);
    const eye = new THREE.Vector3(0, .25, .18).applyMatrix4(head.matrixWorld);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    dir.applyAxisAngle(UP, L.yaw);
    dir.applyAxisAngle(new THREE.Vector3().crossVectors(dir, UP).normalize(), L.pitch).normalize();
    const k = this.povReady ? Math.min(1, dt * 12) : 1;     // smooth the head bob
    cam.position.lerp(eye, k);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, cam.position.clone().add(dir), UP));
    if (this.povReady) cam.quaternion.slerp(q, Math.min(1, dt * 10)); else cam.quaternion.copy(q);
    this.povReady = true;
    if (Math.abs(cam.fov - L.fov) > .01) { cam.fov += (L.fov - cam.fov) * .2; cam.updateProjectionMatrix(); }
    this.controls.target.copy(cam.position).add(dir);
  }

  applyVisibility() {
    const v = this.view, focus = v.mode !== 'lobby' ? v.floorId : null;
    for (const [id, o] of this.floors) {
      // inside a Floor only that Floor is drawn: less clutter, less GPU on a shared machine
      o.g.visible = !focus || id === focus;
      o.label.visible = !focus;
      for (const st of o.stations.values()) { st.labelsOn = id === focus; updateStation(st, { ...(o.data.agents || []).find((a) => a.id === st.id) }); }
      if (o.empty) o.empty.visible = id === focus;
    }
    this.lobby.visible = !focus;
    if (this.columns) this.columns.visible = !focus;
    this.roof.visible = !focus;
    this.roofSign.visible = !focus;
    this.ground.visible = !focus;
  }

  setInsets(insets) {
    this.insets = { left: 0, right: 0, top: 0, bottom: 0, ...insets };
    this.resize();
    if (this.view.eyes || this.view.follow) return;
    const p = this.poseFor(this.view);
    if (this.camAnim) Object.assign(this.camAnim, p);          // retarget the move in progress
    else this.flyTo(p, 500);
  }

  // NDC rectangle of the area not covered by the floating cards
  freeRect() {
    const W = this.size.w, H = this.size.h, i = this.insets;
    return { x0: -1 + 2 * i.left / W, x1: 1 - 2 * i.right / W, y0: -1 + 2 * i.bottom / H, y1: 1 - 2 * i.top / H };
  }

  // isometric framing: the smallest zoom at which every point fits the free area, centred in it
  fitIso(points, margin = .05) {
    const fwd = ISO.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize(), up = new THREE.Vector3().crossVectors(right, fwd);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const c = new THREE.Vector3();
    for (const p of points) { const x = p.dot(right), y = p.dot(up); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); c.add(p); }
    c.divideScalar(points.length);
    const r = this.freeRect(), aspect = this.size.w / this.size.h;
    const fw = (r.x1 - r.x0) / 2 * (1 - 2 * margin), fh = (r.y1 - r.y0) / 2 * (1 - 2 * margin);
    const H = Math.max((y1 - y0) / Math.max(.05, fh), (x1 - x0) / Math.max(.05, fw * aspect));   // world height of the whole viewport
    const W = H * aspect;
    const fcx = (r.x0 + r.x1) / 2, fcy = (r.y0 + r.y1) / 2;
    const cx = (x0 + x1) / 2 - fcx * W / 2, cy = (y0 + y1) / 2 - fcy * H / 2;
    const depth = c.dot(fwd);
    const target = right.clone().multiplyScalar(cx).addScaledVector(up, cy).addScaledVector(fwd, depth);
    return { pos: target.clone().addScaledVector(ISO, 80), target, zoom: 2 * ORTHO_H / H };
  }

  poseFor(v) {
    if (v.mode === 'lobby') {
      const h = floorY(this.top + 1);                         // roof sign included
      return this.fitIso(corners(-FW / 2 - .3, FW / 2 + 5, 0, h, -FD / 2 - .3, FD / 2 + .3), .04);
    }
    const o = this.floors.get(v.floorId);
    const y = o ? o.g.position.y : 0;
    if (v.mode === 'desk' && v.screen && o && o.stations.get(v.agentId)) {
      // over the shoulder: behind the chair, looking at the main screen
      const st = o.stations.get(v.agentId);
      st.g.updateWorldMatrix(true, false);
      const main = st.screens.find((x) => x.part === 'main') || st.screens[0];
      const target = main.mesh.getWorldPosition(new THREE.Vector3());
      const mx = main.mesh.parent.position.x;
      const pos = st.g.localToWorld(new THREE.Vector3(mx - .18, 1.9, -.55));    // just behind the agent's head (hidden in this view)
      return { pos, target };
    }
    if (v.mode === 'desk' && o && o.stations.get(v.agentId)) {
      const st = o.stations.get(v.agentId);
      st.g.updateWorldMatrix(true, false);
      // the desk and its neighbourhood, about a third of the room, so the agent is big but still in its office
      const pts = corners(-3.4, 3.4, 0, 2.4, -3, 3.4).map((q) => st.g.localToWorld(q));
      return this.fitIso(pts, .04);
    }
    return this.fitIso(corners(-FW / 2 - .3, FW / 2 + .3, y + .2, y + TOP + FH, -FD / 2 - .3, FD / 2 + .3), .02);
  }

  snapTo(p) {
    this.camera.position.copy(p.pos); this.controls.target.copy(p.target);
    if (p.zoom && this.camera.isOrthographicCamera) { this.camera.zoom = p.zoom; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(p.target);
    this.camAnim = null;
  }
  flyTo(p, ms = 900) { this.camAnim = { start: performance.now(), ms, fromP: this.camera.position.clone(), fromT: this.controls.target.clone(), fromZ: this.camera.zoom, ...p }; }

  resize() {
    this.dirty = true;
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.size = { w, h };
    const aspect = w / h;
    Object.assign(this.ortho, { left: -ORTHO_H * aspect, right: ORTHO_H * aspect, top: ORTHO_H, bottom: -ORTHO_H });
    this.ortho.updateProjectionMatrix();
    this.persp.aspect = aspect;
    // the perspective views are centred in the area not covered by cards (first person uses the whole canvas)
    const i = this.view.eyes ? { left: 0, right: 0, top: 0, bottom: 0 } : this.insets;
    const cx = (i.left + (w - i.right)) / 2, cy = (i.top + (h - i.bottom)) / 2;
    this.persp.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    this.persp.updateProjectionMatrix();
    this.quality?.resize(w, h);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  // light (default) or dark page: the scene backdrop follows the theme's --scene colour
  setTheme(dark, color) {
    this.dirty = true;
    this.dark = dark;
    this.scene.background = new THREE.Color(color || (dark ? '#141a2b' : '#efe9df'));
    if (this.ground) this.ground.material.opacity = dark ? .3 : .1;
  }

  // live tmux screen for the over-the-shoulder view (null = draw from transcript data)
  setLiveText(text) { this.liveText = text; }
  setShot(floorId, shot) { const o = this.floors.get(floorId); if (o) o.shot = shot; }
  // the conversation view: ease to the agent's desk while its message is open (only on the Floor in view), back after
  focusAgent(floorId, agentId) {
    const v = this.view;
    if (v.mode === 'lobby' || v.floorId !== floorId || v.eyes || v.screen || !this.floors.get(floorId)?.stations.get(agentId)) return false;
    this.convoFocus = true;
    this.flyTo(this.poseFor({ ...v, mode: 'desk', agentId }), 700);
    return true;
  }
  unfocus() { if (!this.convoFocus) return; this.convoFocus = false; if (!this.view.eyes) this.flyTo(this.poseFor(this.view), 600); }
  // voice: the mouth follows the audio level (0..1) while the agent speaks
  setTalk(floorId, agentId, level) { const st = this.floors.get(floorId)?.stations.get(agentId); if (st) st.talkLevel = level; }
  // speech bubble over an agent for ms milliseconds
  say(floorId, agentId, text, ms = 7000) {
    this.dirty = true;
    const st = this.floors.get(floorId)?.stations.get(agentId);
    if (!st) return;
    st.say.element.textContent = text; st.sayUntil = performance.now() + ms;
  }
  // machine load for the server racks: { cpu, mem: { used, total }, levels }
  setLoad(load) { this.load = load; }
  // draw: a frame is drawn anyway, so the top LED may flicker; a change in load asks for a frame by itself
  updateRacks(t, draw = true) {
    if (!this.load || t < (this.rackNext || 0)) return;
    this.rackNext = t + .25;
    const L = this.load, memPct = L.mem?.total ? L.mem.used / L.mem.total * 100 : 0;
    const color = { cpu: { ok: '#4fc38a', warn: '#f2b544', bad: '#ef5d6b' }[L.levels?.cpu || 'ok'], mem: { ok: '#6aa5ff', warn: '#f2b544', bad: '#ef5d6b' }[L.levels?.ram || 'ok'] };
    const lit = { cpu: Math.max(1, Math.round(L.cpu / 100 * 7)), mem: Math.max(1, Math.round(memPct / 100 * 7)) };
    for (const r of this.racks || []) {
      if (!r?.visible && r !== this.lobbyRack) continue;
      for (const led of r.userData.leds) {
        const on = led.row < lit[led.col] && !(draw && led.row === lit[led.col] - 1 && L.cpu > 5 && Math.random() < .3);   // the top LED flickers
        const c = on ? color[led.col] : '#2a3044';
        if (led.c !== c && !(draw === false && led.row === lit[led.col] - 1)) { led.mesh.material.color.set(c); led.c = c; this.dirty = true; }
      }
    }
  }
  setBoard(floorId, board) { const o = this.floors.get(floorId); if (o) o.board = board; }

  // ---------- Edit Mode helpers ----------
  objectFor(floorId, sel) {
    const o = this.floors.get(floorId);
    if (!o || !sel) return null;
    return sel.agent ? o.stations.get(sel.agent)?.g : o.devices.get(sel.device) || null;
  }

  // world point on the floor plane under the pointer, in the floor's local coordinates
  floorPoint(e, floorId) {
    const o = this.floors.get(floorId);
    if (!o) return null;
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(o.g.position.y + TOP));
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, p)) return null;
    return { x: p.x, z: p.z };
  }

  // Edit Mode: the selection ring turns red while the piece would overlap something or block a desk
  warnSelection(on) { if (this.ring) this.ring.material.color.set(on ? '#dc2626' : '#b7852a'); }
  select(floorId, sel) {
    if (!this.ring) {
      this.ring = new THREE.Mesh(new THREE.RingGeometry(.95, 1.1, 40), basic('#b7852a', { transparent: true, opacity: .9, side: THREE.DoubleSide, depthTest: false }));
      this.ring.rotation.x = -Math.PI / 2; this.ring.renderOrder = 10;
      this.scene.add(this.ring);
    }
    this.selection = sel ? { floorId, ...sel } : null;
    this.ring.visible = !!sel;
  }

  // ---------- picking ----------
  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      down = [e.clientX, e.clientY];
      if (this.view.eyes) { this.look.drag = { x: e.clientX, y: e.clientY, yaw: this.look.yaw, pitch: this.look.pitch }; el.setPointerCapture(e.pointerId); return; }
      this.handlers.onPointerDown?.(e);
    });
    el.addEventListener('pointermove', (e) => {          // first person: drag to look around
      const d = this.view.eyes && this.look?.drag;
      if (!d) return;
      this.look.yaw = Math.max(-1.6, Math.min(1.6, d.yaw - (e.clientX - d.x) * .004));
      this.look.pitch = Math.max(-.9, Math.min(.6, d.pitch - (e.clientY - d.y) * .003));
    });
    el.addEventListener('wheel', (e) => { if (!this.view.eyes) { this.camAnim = null; return; } e.preventDefault(); this.look.fov = Math.max(30, Math.min(95, this.look.fov + e.deltaY * .02)); }, { passive: false });
    el.addEventListener('pointerup', (e) => {
      if (this.view.eyes) { if (this.look) this.look.drag = null; return; }
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      this.ray.setFromCamera(this.ndc(e), this.camera);
      if (this.lobby.visible && this.ray.intersectObject(this.lobbyRack, true).length) return this.handlers.onPickRack?.();
      const hit = this.pick(e);
      if (hit.rack) return this.handlers.onPickRack?.();
      if (hit.agent && hit.screen) this.handlers.onPickScreen?.(hit.floorId, hit.agent);
      else if (hit.agent && hit.human) this.handlers.onPickEyes?.(hit.floorId, hit.agent);
      else if (hit.agent) this.handlers.onPickAgent?.(hit.floorId, hit.agent);
      else if (hit.floorId) this.handlers.onPickFloor?.(hit.floorId);
    });
  }

  ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pick(e) {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const hits = this.ray.intersectObjects(this.building.children.filter((c) => c.visible && c.userData.floorId), true);
    for (const h of hits) {
      let o = h.object, agent = null, device = null, human = false, rack = false;
      const screen = !!h.object.userData.screen;
      while (o && !o.userData.floorId) { if (o.userData.agent) agent = o.userData.agent; if (o.userData.human) human = true; if (o.userData.rack) rack = true; if (o.userData.device) device = o.userData.device; o = o.parent; }
      if (o) return { floorId: o.userData.floorId, agent, device, screen, human, rack, point: h.point };
    }
    return {};
  }

  // ---------- loop ----------
  invalidate() { this.dirty = true; }
  // draw: false runs the office life (walks, screens, labels) without rendering a frame
  frame(draw = true) {
    const f0 = performance.now();
    const t = this.clock.getElapsedTime();
    if (this.camAnim && !this.view.eyes && !this.view.follow) {
      const a = this.camAnim, u = Math.min(1, (performance.now() - a.start) / a.ms), k = 1 - Math.pow(1 - u, 3);
      this.camera.position.lerpVectors(a.fromP, a.pos, k);
      this.controls.target.lerpVectors(a.fromT, a.target, k);
      if (a.zoom && this.camera.isOrthographicCamera) { this.camera.zoom = a.fromZ + (a.zoom - a.fromZ) * k; this.camera.updateProjectionMatrix(); }
      if (u >= 1) this.camAnim = null;
    }
    const dt = Math.min(.1, t - (this.lastT ?? t)); this.lastT = t;
    const v = this.view;
    let walking = false, animating = false;
    for (const [fid, o] of this.floors) {
      if (!o.g.visible) continue;
      const near = v.mode !== 'lobby' && v.floorId === fid;
      // characters away from their desks are moving obstacles for each other
      const others = [...o.stations.values()].filter((x) => x.life && x.life.mode !== 'desk').map((x) => ({ id: x.id, x: x.human.position.x, z: x.human.position.z, moving: /walk|return/i.test(x.life.mode) }));
      for (const st of o.stations.values()) {
        // a meeting at the table (from the Log): the agents involved take a seat, except one that waits for the owner
        const mt = near && o.data?.meeting && o.data.meeting.until > Date.now() ? o.data.meeting : null;
        const k = mt && st.state !== 'waiting' ? mt.agents.indexOf(st.id) : -1;
        const meeting = k >= 0 && o.seats[k] ? { ...o.seats[k], label: mt.label } : null;
        const away = updateLife(st, { t, dt, wantsDesk: st.state !== 'idle', spots: near ? o.spots : [], occupied: o.occupied, meeting, nav: o.nav, others, poseDesk: () => { deskHome(st); poseDesk(st, t, near && v.eyes && v.agentId === st.id); } });
        if (away !== (st.away || '')) { st.away = away; updateStation(st, st.data); }
        if (/walk|return/i.test(st.life?.mode || '')) walking = true;
        if (st.state === 'working' || st.state === 'waiting' || st.talkLevel > .02) animating = true;   // typing, a raised hand, talking
        if (st.talkLevel > .02) st.rig.mouth.scale.y = .6 + st.talkLevel * 2.2;
        const focus = near && (v.screen || v.eyes) && v.agentId === st.id;
        st.rig.head.visible = !focus;                     // over the shoulder / own eyes: the big chibi head would hide the view
        st.label.visible = !!st.labelsOn && !focus;
        st.say.visible = !!st.labelsOn && !focus && (st.sayUntil || 0) > performance.now();
        for (const S of st.screens) {
          if (t < S.next && !(focus && S.part === 'main')) continue;
          if (st.state === 'stopped' && S.dark && !focus) { S.next = t + 30; continue; }   // a dark screen stays dark: no redraw, no frame
          S.dark = st.state === 'stopped';
          const every = drawScreen(S, st.data, { t, away, part: S.part, stopped: st.state === 'stopped', live: focus && S.part === 'main' && this.liveText != null ? this.liveText : null,
            shot: o.shot || null, role: propsFor(st.data).screen, board: o.board || null });
          S.tex.needsUpdate = true; this.stats.screens++; this.dirty = true;
          S.next = t + (near ? every : Math.max(every, 6)) + Math.random() * .05;
        }
      }
    }
    if (this.ring?.visible && this.selection) {
      const obj = this.objectFor(this.selection.floorId, this.selection);
      if (obj) { obj.getWorldPosition(this.ring.position); this.ring.position.y += .05; const k = this.selection.agent ? 1 : .8; this.ring.scale.setScalar(k); } else this.ring.visible = false;
    }
    this.walking = walking; this.animating = animating;
    if (NAV_DEBUG) for (const o of this.floors.values()) if (o.g.visible) drawPaths(o);
    this.updateRacks(t, draw);
    this.handlers.onFrame?.(t);
    if (v.eyes) this.updatePov(dt); else if (v.follow) this.updateFollow(dt); else this.controls.update();
    // the camera moved since the last drawn frame (OrbitControls' own answer stays true on damping residue)
    const cam = this.camera, cp = this.camSeen ||= { p: new THREE.Vector3(Infinity), t: new THREE.Vector3(), z: 0 };
    if (cp.p.distanceToSquared(cam.position) > 1e-6 || cp.t.distanceToSquared(this.controls.target) > 1e-6 || Math.abs(cp.z - cam.zoom) > 1e-4) draw = true;
    if (draw) { cp.p.copy(cam.position); cp.t.copy(this.controls.target); cp.z = cam.zoom; }
    this.labels.render(this.scene, this.camera);
    if (!draw) return;
    // the shadow map is redrawn only when something casting moved: walking (every 3rd frame), typing (twice a
    // second), a rebuilt or changed Floor, a new view
    this.drawNo = (this.drawNo || 0) + 1;
    if (this.dirty || (walking && this.drawNo % 3 === 0) || (animating && t - (this.shadowAt || 0) > .5)) { this.renderer.shadowMap.needsUpdate = true; this.shadowAt = t; }
    this.dirty = false;
    this.quality.render(this.camera, dt);
    this.stats.frames++; this.stats.ms += performance.now() - f0;
  }
}

function floorLabelHtml(f) {
  if (f.missing) return `<b>${f.number}</b> ${esc(f.name)} <span class="q">missing</span>`;
  const c = f.counts || {};
  const parts = [];
  if (c.working) parts.push(`<span class="w">● ${c.working} working</span>`);
  if (f.attention) parts.push(`<span class="q">! ${f.attention}</span>`);
  if (!parts.length) parts.push(`<span class="m">${(f.agents || []).some((a) => a.running) ? 'idle' : 'quiet'}</span>`);
  return `<i class="lamp ${f.lamp || ''}"></i><b>${f.number}</b> ${esc(f.name)} ${parts.join(' ')}`;
}
