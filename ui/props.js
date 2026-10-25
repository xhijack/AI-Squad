// Desk props: a keyboard with keys, a mouse, a mug in the agent's colour and up to two toys per role
// (lead: trophy + cactus, developers: rubik / rubber duck / robot, QA: ladybug + magnifier). Ported from squad-3d.
// Props come from the role template appearance (`props`, `screen`); without them the role kind decides.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const M = (c, o = {}) => new THREE.MeshToonMaterial({ color: c, ...o });
const B = (c) => new THREE.MeshBasicMaterial({ color: c });
const TOP = .955;                                      // desk surface height in the station group

function mesh(geo, m, x, y, z, parent) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; }
const rbox = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 1, r);
const ball = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
const cylg = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);

// keys drawn once and shared by every keyboard
let keysTex = null;
function keys() {
  if (keysTex) return keysTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 170;
  const x = c.getContext('2d');
  x.fillStyle = '#2b3042'; x.fillRect(0, 0, 512, 170);
  [14, 14, 13, 12, 9].forEach((n, r) => {
    const kw = 512 / 14.6; let off = r * 6 + 6;
    for (let i = 0; i < n; i++) {
      const w = r === 4 && i === 4 ? kw * 5.2 : kw - 5;
      x.fillStyle = '#c9cfdc'; x.beginPath(); x.roundRect(off, 6 + r * 32, w, 26, 5); x.fill();
      x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(off, 6 + r * 32 + 23, w, 3);
      off += w + 5;
    }
  });
  keysTex = new THREE.CanvasTexture(c); keysTex.colorSpace = THREE.SRGBColorSpace;
  return keysTex;
}
function keyboard(g, x, y, z, w, d) {
  const k = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: keys() }));
  k.rotation.set(-Math.PI / 2, 0, Math.PI);           // keys face up, rows read from the agent's chair
  k.position.set(x, y, z); g.add(k);
}

const TOYS = {
  trophy(t) {
    const gold = M('#f2b705');
    mesh(cylg(.04, .055, .025), M('#4b2e1a'), 0, .012, 0, t); mesh(cylg(.012, .012, .05), gold, 0, .05, 0, t);
    const cup = mesh(new THREE.CylinderGeometry(.052, .024, .075, 16, 1, true), gold, 0, .11, 0, t); cup.material.side = THREE.DoubleSide;
  },
  cactus(t) { mesh(cylg(.036, .032, .05), M('#e07a5f'), 0, .025, 0, t); mesh(cylg(.02, .02, .09), M('#3f9a5c'), 0, .095, 0, t); mesh(cylg(.01, .01, .04), M('#3f9a5c'), .025, .1, 0, t).rotation.z = -.9; },
  rubik(t) {
    const cols = ['#ef4444', '#22c55e', '#3b82f6', '#facc15', '#f97316', '#ffffff'];
    for (let i = 0; i < 27; i++) mesh(rbox(.036, .036, .036, .006), M(cols[i % 6]), (i % 3) * .038 - .038, Math.floor(i / 9) * .038 + .02, (Math.floor(i / 3) % 3) * .038 - .038, t);
    t.rotation.y = .6;
  },
  duck(t) {
    const y = M('#facc15');
    mesh(ball(.072, 16, 12), y, 0, .065, 0, t).scale.set(1.2, .85, 1);
    mesh(ball(.048), y, .03, .145, 0, t);
    mesh(new THREE.ConeGeometry(.02, .05, 8), M('#f97316'), .085, .14, 0, t).rotation.z = -Math.PI / 2;
    t.rotation.y = -2.2;
  },
  robot(t) {
    const m = M('#94a3b8');
    mesh(rbox(.1, .1, .075, .015), m, 0, .06, 0, t); mesh(rbox(.08, .065, .065, .015), m, 0, .15, 0, t);
    for (const s of [-1, 1]) mesh(ball(.01, 8, 6), B('#22d3ee'), .02 * s, .16, .034, t);
    mesh(cylg(.005, .005, .05), m, 0, .205, 0, t); mesh(ball(.012, 8, 6), B('#f43f5e'), 0, .235, 0, t);
    t.rotation.y = Math.PI + .5;
  },
  ladybug(t) {
    mesh(new THREE.SphereGeometry(.065, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M('#dc2626'), 0, 0, 0, t).scale.set(1, .8, 1.25);
    mesh(ball(.032), M('#111827'), 0, .016, .075, t);
    for (const [x, z] of [[.028, .016], [-.028, .016], [.024, -.032], [-.024, -.032]]) mesh(ball(.011, 8, 6), M('#111827'), x, .045, z, t);
    t.rotation.y = Math.PI + .4;
  },
  magnifier(t) {
    mesh(new THREE.TorusGeometry(.045, .008, 8, 20), M('#334155'), 0, .01, 0, t).rotation.x = -Math.PI / 2;
    mesh(new THREE.CircleGeometry(.04, 20), new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: .45 }), 0, .011, 0, t).rotation.x = -Math.PI / 2;
    mesh(cylg(.01, .01, .1, 8), M('#7c3a1d'), .09, .01, 0, t).rotation.z = Math.PI / 2;
    t.rotation.y = .7;
  },
  megaphone(t) {
    const c = mesh(new THREE.CylinderGeometry(.06, .022, .14, 14, 1, true), M('#f08a24'), 0, .06, 0, t); c.rotation.z = Math.PI / 2; c.material.side = THREE.DoubleSide;
    mesh(cylg(.012, .012, .06, 8), M('#2b2f3a'), -.03, .02, 0, t);
    t.rotation.y = 2.4;
  },
  books(t) { ['#3d82d6', '#e2574c', '#4fa36b'].forEach((c, i) => { const b = mesh(rbox(.16, .03, .11, .005), M(c), 0, .016 + i * .031, 0, t); b.rotation.y = (i - 1) * .2; }); },
  headphones(t) {
    const band = mesh(new THREE.TorusGeometry(.06, .009, 8, 20, Math.PI), M('#2b2f3a'), 0, .03, 0, t); band.rotation.x = -Math.PI / 2;
    for (const s of [-1, 1]) mesh(cylg(.03, .03, .025, 14), M('#7c5cd6'), .06 * s, .015, 0, t);
  },
};

const DEV_TOYS = ['rubik', 'duck', 'robot'];
const hash = (s) => [...String(s)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);

// the props and role screen an agent shows: its appearance first, else by role kind (lead / qa / dev)
export function propsFor(agent) {
  const ap = agent.appearance || {};
  const kind = agent.kindOf || 'dev';
  const props = Array.isArray(ap.props) && ap.props.length ? ap.props
    : kind === 'lead' ? ['trophy', 'cactus'] : kind === 'qa' ? ['ladybug', 'magnifier'] : [DEV_TOYS[hash(agent.id) % 3]];
  const screen = ap.screen || (kind === 'lead' ? 'board' : kind === 'qa' ? 'tests' : 'code');
  return { props: props.filter((p) => TOYS[p]).slice(0, 2), screen };
}

// device: laptop | dual-monitor; mug in the shirt colour
export function deskProps(g, agent, device) {
  const { props } = propsFor(agent);
  if (device === 'dual-monitor') keyboard(g, 0, .977, .45, .48, .16);
  else keyboard(g, 0, .997, .45, .54, .17);               // the laptop's own keys
  mesh(rbox(.24, .006, .2, .003), M('#2f3a4a'), -.48, TOP + .003, .45, g);            // mouse pad, on the agent's right (-x)
  mesh(ball(.04, 14, 10), M('#f1f4f9'), -.48, TOP + .02, .45, g).scale.set(1, .55, 1.5);
  const mugColor = agent.appearance?.shirt || '#e2574c';
  mesh(cylg(.055, .05, .12), M(mugColor), .56, TOP + .06, .42, g);
  mesh(new THREE.TorusGeometry(.034, .011, 8, 16), M(mugColor), .505, TOP + .06, .42, g).rotation.y = Math.PI / 2;
  mesh(new THREE.CircleGeometry(.048, 16), M('#5b3a1e'), .56, TOP + .115, .42, g).rotation.x = -Math.PI / 2;
  [[.56, .86], [-.52, .84]].forEach(([x, z], i) => {
    if (!props[i]) return;
    const t = new THREE.Group(); t.position.set(x, TOP, z); g.add(t);
    TOYS[props[i]](t);
  });
}
