// The 3D Building: stacked Floors (dollhouse view), desks with chibi agents, devices, camera moves.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildChibi, toon, HIP_H, resetPose, blink, sitLegs, arms } from './chibi.js';
import { FW, FD, FH, floorY, desksFor } from './layout.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mat = (c, o = {}) => new THREE.MeshToonMaterial({ color: c, ...o });
const basic = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });

function box(w, h, d, m, x, y, z, parent, r = .04) {
  const b = new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; parent.add(b); return b;
}
function cyl(rt, rb, h, m, x, y, z, parent, seg = 16) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  c.position.set(x, y, z); c.castShadow = true; parent.add(c); return c;
}
function label(html, cls, parent, x, y, z) {
  const el = document.createElement('div'); el.className = cls; el.innerHTML = html;
  const o = new CSS2DObject(el); o.position.set(x, y, z); parent.add(o); return o;
}

// ---------- devices ----------
const DEVICE_BUILDERS = {
  plant(g) {
    box(.5, .5, .5, mat('#8a5a3c'), 0, .25, 0, g);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(.45, 0), mat('#4fa36b')); leaf.position.set(0, .9, 0); leaf.castShadow = true; g.add(leaf);
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(.3, 0), mat('#5fbf7d')); top.position.set(.1, 1.3, .05); g.add(top);
  },
  whiteboard(g) {
    for (const x of [-.8, .8]) box(.06, 1.5, .06, mat('#9aa3b5'), x, .75, 0, g, .01);
    box(1.9, 1.05, .06, basic('#f7f9fc'), 0, 1.35, .02, g, .01);
    box(1.9, .05, .1, mat('#9aa3b5'), 0, .8, .05, g, .01);
    for (const [y, w, c] of [[1.62, 1.1, '#3d82d6'], [1.45, .8, '#e2574c'], [1.28, 1.3, '#4fa36b'], [1.11, .6, '#3d82d6']]) box(w, .04, .01, basic(c), -.85 + w / 2 + .1, y, .06, g, 0);
  },
  printer(g) {
    box(.9, .55, .7, mat('#c9ced8'), 0, .28, 0, g, .03);
    box(.95, .3, .75, mat('#e6e9ef'), 0, .7, 0, g, .03);
    box(.6, .02, .4, basic('#ffffff'), 0, .87, .1, g, 0);
    box(.12, .05, .02, basic('#4fc38a'), .3, .7, .38, g, 0);
  },
  coffee(g) {
    box(.9, .9, .6, mat('#8a5a3c'), 0, .45, 0, g, .03);
    box(.45, .55, .4, mat('#2b2f3a'), -.1, 1.17, 0, g, .04);
    cyl(.06, .05, .12, mat('#ffffff'), .25, .96, .05, g);
  },
  bookshelf(g) {
    box(1.4, 1.9, .45, mat('#a0754f'), 0, .95, 0, g, .02);
    const colors = ['#e2574c', '#3d82d6', '#f2b544', '#4fa36b', '#7c5cd6', '#2bb3a3'];
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) box(.16, .34, .3, mat(colors[(r * 3 + i) % 6]), -.5 + i * .2, .3 + r * .45, .05, g, .01);
  },
  sofa(g) {
    box(2, .4, .9, mat('#5b6694'), 0, .3, 0, g, .08);
    box(2, .55, .25, mat('#5b6694'), 0, .7, -.33, g, .08);
    for (const x of [-.95, .95]) box(.22, .45, .9, mat('#4b5580'), x, .55, 0, g, .08);
  },
  'server-rack'(g) {
    box(.8, 2, .8, mat('#2b2f3a'), 0, 1, 0, g, .02);
    for (let i = 0; i < 7; i++) box(.66, .16, .02, basic(i % 3 ? '#3a4058' : '#4fc38a'), 0, .35 + i * .23, .41, g, 0);
  },
};
export const DEVICE_LABELS = { plant: 'Plant', whiteboard: 'Whiteboard', printer: 'Printer', coffee: 'Coffee machine', bookshelf: 'Bookshelf', sofa: 'Sofa', 'server-rack': 'Server rack' };

function buildDevice(d) {
  const g = new THREE.Group();
  (DEVICE_BUILDERS[d.type] || DEVICE_BUILDERS.plant)(g);
  g.position.set(d.x, .36, d.z); g.rotation.y = d.ry || 0;
  g.userData.device = d.id;
  return g;
}

// ---------- agents at desks ----------
const LOOK_BASE = { eye: '#2f3a4a', pants: '#334155', shoe: '#1f2937', hat: '#f08a24', skin: '#f6d2b0', hair: '#2b2440', shirt: '#3d82d6', style: 'bob' };
const lookFor = (a = {}) => { const l = { ...LOOK_BASE, ...a }; return { ...l, sleeve: l.shirt, overall: l.style === 'farmer' ? '#3b6fb6' : undefined }; };

function buildStation(agent, desk, accent) {
  const g = new THREE.Group();
  g.position.set(desk.x, .36, desk.z); g.rotation.y = desk.ry || 0;
  g.userData.agent = agent.id;
  box(1.5, .07, .75, mat('#e9dcc2'), 0, .92, .62, g);                         // desk
  for (const x of [-.65, .65]) box(.07, .9, .6, mat('#b59a74'), x, .46, .62, g, .02);
  const screens = [];
  const screenMat = basic('#1d2338');
  if (desk.device === 'dual-monitor') {
    for (const x of [-.36, .36]) {
      box(.05, .22, .05, mat('#3b4258'), x, 1.06, .78, g, .01);
      const s = box(.62, .38, .04, screenMat, x, 1.3, .8, g, .01); s.rotation.y = -x * .5; screens.push(s);
    }
    box(.5, .02, .18, mat('#3b4258'), 0, .965, .45, g, .005);                 // keyboard
  } else {
    box(.62, .04, .42, mat('#3b4258'), 0, .975, .55, g, .01);                   // laptop
    const s = box(.6, .38, .03, screenMat, 0, 1.17, .76, g, .01); s.rotation.x = -.25; screens.push(s);
  }
  box(.6, .1, .6, mat(accent), 0, .55, -.05, g);                                // chair
  box(.6, .6, .1, mat(accent), 0, .9, -.33, g);
  const rig = buildChibi(lookFor(agent.appearance));
  g.add(rig.root);
  const st = { id: agent.id, g, rig, screenMat, state: agent.state, blinkAt: Math.random() * 3, phase: Math.random() * 6 };
  st.label = label('', 'alabel', g, 0, 2.15, 0);
  st.bubble = label('?', 'bubble', g, .5, 2.75, 0);
  st.zzz = label('z<small>z</small>', 'zzz', g, .45, 2.0, .2);
  updateStation(st, agent);
  return st;
}

function updateStation(st, a) {
  st.state = a.state;
  const html = `<i class="dot ${a.state}"></i>${esc(String(a.displayName || '').split(' - ')[0])}`;
  if (st.label.element.innerHTML !== html) st.label.element.innerHTML = html;
  st.label.element.title = `${a.displayName}: ${a.activity || a.state}`;
  st.bubble.visible = a.state === 'waiting' && st.labelsOn;
  st.zzz.visible = a.state === 'stopped' && st.labelsOn;
  st.label.visible = !!st.labelsOn;
}

function poseStation(st, t) {
  const R = st.rig, p = t + st.phase;
  resetPose(R); blink(st, t);
  R.root.position.set(0, .62 - HIP_H + .06, 0);
  sitLegs(R);
  if (st.state === 'waiting') {
    arms(R, [-.4, .2, -.6], [-.2, -2.7 - Math.sin(p * 6) * .25, -.3]);         // raise a hand
    R.head.rotation.set(-.15, Math.sin(p * 2) * .2, 0);
  } else if (st.state === 'working') {
    const tap = Math.sin(p * 16);
    arms(R, [-1.0, -.32, -.62 + tap * .1], [-1.0, .32, -.62 - tap * .1]);
    R.torso.rotation.x = .1; R.head.rotation.x = .1;
  } else if (st.state === 'stopped') {
    R.torso.rotation.x = .55; R.head.rotation.set(.5, 0, .15);                  // asleep on the desk
    arms(R, [-1.3, -.5, -1.2], [-1.3, .5, -1.2]);
  } else {
    R.torso.rotation.x = -.18;
    arms(R, [-.45, .15, -.9], [-.45, -.15, -.9]);
    R.head.rotation.set(-.08, Math.sin(p * .5) * .3, 0);
  }
  const lit = st.state === 'working' ? '#5fd3a0' : st.state === 'waiting' ? '#ef5d6b' : st.state === 'idle' ? '#7d8ab8' : '#1d2338';
  if (st.litHex !== lit) { st.screenMat.color.set(lit); st.litHex = lit; }
}

// ---------- floors ----------
function sigOf(f) {
  return JSON.stringify([f.number, f.name, f.accent, f.layout, f.desks, f.devices, f.missing, (f.agents || []).map((a) => [a.id, a.appearance])]);
}

function dispose(o) {
  o.traverse((x) => { if (x.isCSS2DObject) x.element.remove(); if (x.geometry) x.geometry.dispose(); });
  o.removeFromParent();
}

export class BuildingScene {
  constructor(container, handlers = {}) {
    this.handlers = handlers;
    this.floors = new Map();                  // id -> { g, stations: Map, devices: Map, data, sig, label }
    this.view = { mode: 'lobby' };
    this.top = 0;
    this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0f1320');
    this.scene.fog = new THREE.Fog('#0f1320', 80, 190);
    this.camera = new THREE.PerspectiveCamera(40, 1, .1, 500);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);
    this.container = container;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, maxPolarAngle: Math.PI * .48, minDistance: 3, maxDistance: 160 });

    this.scene.add(new THREE.HemisphereLight('#e4e9ff', '#3a3348', 1.6));
    const sun = new THREE.DirectionalLight('#fff3dd', 1.5);
    sun.position.set(20, 60, 30); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 70, bottom: -10, far: 160 });
    this.sun = sun;
    this.scene.add(sun, sun.target);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(70, 48), toon('#1b2133'));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    this.building = new THREE.Group(); this.scene.add(this.building);
    this.buildLobby();
    this.roof = new THREE.Group(); this.building.add(this.roof);
    box(FW + .6, .3, FD + .6, mat('#2b3352'), 0, .15, 0, this.roof);
    this.roofSign = label('<b>The AI Squad</b>', 'rooflabel', this.roof, 0, 1.2, 0);

    this.ray = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.camAnim = null;
    this.bindPointer();
    this.resize();
    addEventListener('resize', () => this.resize());
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  buildLobby() {
    const g = new THREE.Group(); this.building.add(g); this.lobby = g;
    box(FW + .6, .3, FD + .6, mat('#2b3352'), 0, .15, 0, g);
    box(FW, .06, FD, mat('#d9cdb4'), 0, .33, 0, g, 0);
    box(4, 1.1, 1, mat('#f2b544'), 0, .9, 1.2, g);                             // reception
    box(4.4, .1, 1.3, mat('#fbf6ea'), 0, 1.5, 1.2, g);
    for (const x of [-FW / 2 + .4, FW / 2 - .4]) for (const z of [-FD / 2 + .4, FD / 2 - .4]) box(.35, FH, .35, mat('#3a4366'), x, FH / 2 + .3, z, g);
    for (const x of [-5.6, 5.6]) { const p = new THREE.Group(); DEVICE_BUILDERS.plant(p); p.position.set(x, .36, 3); g.add(p); }
    const sofa = new THREE.Group(); DEVICE_BUILDERS.sofa(sofa); sofa.position.set(-4, .36, -2.6); g.add(sofa);
  }

  // ---------- data sync ----------
  sync(floors) {
    const seen = new Set();
    for (const f of floors) {
      seen.add(f.id);
      let o = this.floors.get(f.id);
      const d = this.draft && this.draft.id === f.id ? this.draft : null;
      // Edit Mode draft: layout, desks, devices and appearance previewed before saving
      const view = d ? { ...f, layout: d.layout, desks: d.desks, devices: d.devices, agents: (f.agents || []).map((a) => (d.appearance[a.id] ? { ...a, appearance: { ...a.appearance, ...d.appearance[a.id] } } : a)) } : f;
      if (o && o.sig !== sigOf(view)) { dispose(o.g); o = null; }
      if (!o) { o = this.buildFloor(view); this.floors.set(f.id, o); }
      o.data = view;
      o.label.element.innerHTML = floorLabelHtml(view);
      for (const a of view.agents || []) { const st = o.stations.get(a.id); if (st) updateStation(st, a); }
    }
    for (const [id, o] of this.floors) if (!seen.has(id)) { dispose(o.g); this.floors.delete(id); }
    const top = Math.max(0, ...floors.map((f) => f.number));
    this.roof.position.y = floorY(top + 1) - .2;
    this.top = top;
    this.applyVisibility();
    if (!this.placed) { this.placed = true; this.snapTo(this.poseFor(this.view)); }
  }

  buildFloor(f) {
    const g = new THREE.Group();
    g.userData.floorId = f.id;
    g.position.y = floorY(f.number);
    const accent = f.accent || '#7c5cd6';
    box(FW + .6, .3, FD + .6, mat('#2b3352'), 0, .15, 0, g);
    box(FW, .06, FD, mat(f.missing ? '#3a3f52' : '#5b6694'), 0, .33, 0, g, 0);
    box(FW + .6, .12, .12, basic(accent), 0, .3, FD / 2 + .3, g, 0);            // accent strip
    box(FW, FH - .3, .12, mat('#46507e'), 0, FH / 2 + .2, -FD / 2 + .06, g, 0);   // back wall
    box(.12, FH - .3, FD, mat('#3d4672'), -FW / 2 + .06, FH / 2 + .2, 0, g, 0);   // side wall
    for (const x of [-4.5, 0, 4.5]) box(2.6, 1, .05, basic('#8fb8ff', { transparent: true, opacity: .35 }), x, 1.9, -FD / 2 + .14, g, 0);
    for (const x of [-FW / 2 + .4, FW / 2 - .4]) box(.35, FH - .3, .35, mat('#3a4366'), x, FH / 2 + .2, FD / 2 - .4, g);
    const o = { g, stations: new Map(), devices: new Map(), sig: sigOf(f) };
    for (const d of f.devices || []) { const dg = buildDevice(d); g.add(dg); o.devices.set(d.id, dg); }
    const desks = desksFor(f.agents || [], f.desks, f.layout);
    (f.agents || []).forEach((a, i) => { const st = buildStation(a, desks[i], accent); g.add(st.g); o.stations.set(a.id, st); });
    if (f.missing) label('Directory not found', 'alabel warnlabel', g, 0, 1.4, 0);
    else if (!(f.agents || []).length) o.empty = label('No agents yet. Add them in the Team panel.', 'alabel', g, 0, 1.3, 0);
    o.label = label('', 'flabel', g, 0, .05, FD / 2 + .35);
    o.label.center.set(.5, 0);
    o.label.element.style.setProperty('--c', accent);
    o.label.element.style.pointerEvents = 'auto';
    o.label.element.addEventListener('click', () => this.handlers.onPickFloor?.(f.id));
    this.building.add(g);
    return o;
  }

  // ---------- view & camera ----------
  setView(view) {
    this.view = view;
    this.applyVisibility();
    this.flyTo(this.poseFor(view));
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
    this.roof.visible = !focus;
    this.roofSign.visible = !focus;
  }

  setInsets(insets) {
    this.insets = { left: 0, right: 0, top: 0, bottom: 0, ...insets };
    this.resize();
    const p = this.poseFor(this.view);
    if (this.camAnim) Object.assign(this.camAnim, p);          // retarget the move in progress
    else this.flyTo(p, 500);
  }

  // NDC rectangle of the area not covered by panels
  freeRect() {
    const W = this.size.w, H = this.size.h, i = this.insets;
    return { x0: -1 + 2 * i.left / W, x1: 1 - 2 * i.right / W, y0: -1 + 2 * i.bottom / H, y1: 1 - 2 * i.top / H };
  }

  // smallest distance along dir at which every point projects inside the free area (with a margin)
  fit(target, dir, points, margin = .06) {
    const cam = this.camera.clone();
    const r = this.freeRect();
    const v = new THREE.Vector3();
    const fits = (d) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target); cam.updateMatrixWorld();
      for (const p of points) {
        v.copy(p).project(cam);
        if (v.z > 1 || v.x < r.x0 + margin || v.x > r.x1 - margin || v.y < r.y0 + margin || v.y > r.y1 - margin) return false;
      }
      return true;
    };
    let lo = 1, hi = 400;
    for (let k = 0; k < 28; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    return { pos: target.clone().addScaledVector(dir, hi), target };
  }

  poseFor(v) {
    const corners = (x0, x1, y0, y1, z0, z1, base = new THREE.Vector3()) => {
      const out = [];
      for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push(new THREE.Vector3(x, y, z).add(base));
      return out;
    };
    if (v.mode === 'lobby') {
      const h = floorY(this.top + 1) + 1.6;                   // roof sign included
      const target = new THREE.Vector3(0, h * .5, 0);
      return this.fit(target, new THREE.Vector3(.62, .38, .69).normalize(), corners(-FW / 2 - .3, FW / 2 + .3, 0, h, -FD / 2, FD / 2 + .6));
    }
    const o = this.floors.get(v.floorId);
    const y = o ? o.g.position.y : 0;
    if (v.mode === 'desk' && o && o.stations.get(v.agentId)) {
      const st = o.stations.get(v.agentId);
      const p = new THREE.Vector3(); st.g.getWorldPosition(p);
      const yAxis = new THREE.Vector3(0, 1, 0), ry = st.g.rotation.y;
      const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(yAxis, ry), side = new THREE.Vector3(1, 0, 0).applyAxisAngle(yAxis, ry);
      const target = p.clone().add(new THREE.Vector3(0, 1.15, .25).applyAxisAngle(yAxis, ry));
      // from the front-side and above, so the laptop does not hide the agent
      const dir = fwd.clone().multiplyScalar(.75).addScaledVector(side, .65).add(new THREE.Vector3(0, 1.05, 0)).normalize();
      const pts = corners(-.9, .9, .3, 2.5, -.6, 1.1).map((q) => q.applyAxisAngle(yAxis, ry).add(p));
      return this.fit(target, dir, pts, .02);
    }
    const target = new THREE.Vector3(0, y + .8, .3);
    return this.fit(target, new THREE.Vector3(.1, .78, .62).normalize(), corners(-FW / 2 + .2, FW / 2 - .2, y + .3, y + FH - .4, -FD / 2 + .2, FD / 2), .02);
  }

  snapTo(p) { this.camera.position.copy(p.pos); this.controls.target.copy(p.target); this.camAnim = null; }
  flyTo(p, ms = 900) { this.camAnim = { start: performance.now(), ms, fromP: this.camera.position.clone(), fromT: this.controls.target.clone(), ...p }; }

  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.size = { w, h };
    this.camera.aspect = w / h;
    const i = this.insets;
    // centre the projection in the area not covered by panels
    const cx = (i.left + (w - i.right)) / 2, cy = (i.top + (h - i.bottom)) / 2;
    this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

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
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(o.g.position.y + .36));
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, p)) return null;
    return { x: p.x, z: p.z };
  }

  select(floorId, sel) {
    if (!this.ring) {
      this.ring = new THREE.Mesh(new THREE.RingGeometry(.95, 1.1, 40), basic('#f2b544', { transparent: true, opacity: .9, side: THREE.DoubleSide, depthTest: false }));
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
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; this.handlers.onPointerDown?.(e); });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      const hit = this.pick(e);
      if (hit.agent) this.handlers.onPickAgent?.(hit.floorId, hit.agent);
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
      let o = h.object, agent = null, device = null;
      while (o && !o.userData.floorId) { if (o.userData.agent) agent = o.userData.agent; if (o.userData.device) device = o.userData.device; o = o.parent; }
      if (o) return { floorId: o.userData.floorId, agent, device, point: h.point };
    }
    return {};
  }

  // ---------- loop ----------
  frame() {
    const t = this.clock.getElapsedTime();
    if (this.camAnim) {
      const a = this.camAnim, u = Math.min(1, (performance.now() - a.start) / a.ms), k = 1 - Math.pow(1 - u, 3);
      this.camera.position.lerpVectors(a.fromP, a.pos, k);
      this.controls.target.lerpVectors(a.fromT, a.target, k);
      if (u >= 1) this.camAnim = null;
    }
    for (const o of this.floors.values()) if (o.g.visible) for (const st of o.stations.values()) poseStation(st, t);
    if (this.ring?.visible && this.selection) {
      const obj = this.objectFor(this.selection.floorId, this.selection);
      if (obj) { obj.getWorldPosition(this.ring.position); this.ring.position.y += .05; const k = this.selection.agent ? 1 : .8; this.ring.scale.setScalar(k); } else this.ring.visible = false;
    }
    this.handlers.onFrame?.(t);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
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
