// Toon chibi characters (from the squad-3d / sopwer-squad prototypes). buildChibi(look) returns a joint rig to pose.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const TOON_GRAD = (() => {
  const t = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
})();
const toonCache = new Map();
export const toon = (color) => { if (!toonCache.has(color)) toonCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRAD })); return toonCache.get(color); };
const OUTLINE = new THREE.MeshBasicMaterial({ color: '#3a2a22', side: THREE.BackSide });
const flat = (color) => new THREE.MeshBasicMaterial({ color });
function part(geo, mat, parent, x = 0, y = 0, z = 0, outline = .06) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = true; parent.add(m);
  if (outline) { const o = new THREE.Mesh(geo, OUTLINE); o.scale.setScalar(1 + outline); m.add(o); }
  return m;
}
const joint = (parent, x = 0, y = 0, z = 0) => { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); return j; };
const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);
const ball = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);


export const HIP_H = .46;   // hip joint height above the soles
export function buildChibi(look) {
  const root = new THREE.Group();
  const R = { root };
  const skin = toon(look.skin), hairM = toon(look.hair), shirt = toon(look.shirt), sleeve = toon(look.sleeve),
    pants = toon(look.pants), shoe = toon(look.shoe);
  R.hips = joint(root, 0, HIP_H, 0);
  // legs
  for (const s of [1, -1]) {
    const hip = joint(R.hips, .09 * s, 0, 0);
    part(cap(.078, .1), look.skirt ? skin : pants, hip, 0, -.1, 0);
    const knee = joint(hip, 0, -.21, 0);
    part(cap(.07, .1), look.skirt ? skin : pants, knee, 0, -.09, 0);
    if (look.skirt) part(new THREE.CylinderGeometry(.072, .072, .07, 14), toon('#ffffff'), knee, 0, -.17, 0, .04); // socks
    const foot = part(new RoundedBoxGeometry(.13, .08, .2, 2, .035), shoe, knee, 0, -.21, .035);
    R[s > 0 ? 'lLeg' : 'rLeg'] = { hip, knee, foot };
  }
  // body
  R.torso = joint(R.hips, 0, 0, 0);
  part(new THREE.CylinderGeometry(.185, .19, .12, 20), look.skirt ? toon(look.pants) : pants, R.torso, 0, .02, 0);
  if (look.skirt) part(new THREE.CylinderGeometry(.19, .3, .2, 22), toon(look.pants), R.torso, 0, -.06, 0); // skirt
  part(cap(.19, .16), shirt, R.torso, 0, .2, 0);
  if (look.overall) {                                     // farmer overalls + straps
    const ov = toon(look.overall);
    part(new RoundedBoxGeometry(.26, .2, .06, 2, .025), ov, R.torso, 0, .19, .16, .05);
    for (const s of [1, -1]) part(new THREE.BoxGeometry(.04, .2, .03), ov, R.torso, .09 * s, .31, .14, 0).rotation.x = -.25;
    part(new THREE.CylinderGeometry(.19, .195, .14, 20), ov, R.torso, 0, .06, 0, .04);
  }
  if (look.vest) for (const s of [1, -1]) part(new RoundedBoxGeometry(.11, .26, .05, 2, .02), toon(look.vest), R.torso, .085 * s, .2, .165, .05);
  if (look.hood) part(new THREE.TorusGeometry(.13, .055, 10, 20), sleeve, R.torso, 0, .38, -.1, .05).rotation.x = 1.2;
  // arms
  for (const s of [1, -1]) {
    const sh = joint(R.torso, .215 * s, .34, 0);
    part(cap(.062, .07), sleeve, sh, 0, -.07, 0);
    const el = joint(sh, 0, -.15, 0);
    part(cap(.056, .06), skin, el, 0, -.06, 0);
    const hand = part(ball(.065), skin, el, 0, -.14, 0);
    R[s > 0 ? 'lArm' : 'rArm'] = { sh, el, hand };
  }
  // head
  R.head = joint(R.torso, 0, .42, 0);
  part(new THREE.CylinderGeometry(.06, .07, .08, 12), skin, R.head, 0, -.02, 0, 0);   // neck
  const HC = new THREE.Vector3(0, .26, 0), HR = .3;
  part(ball(HR, 32, 24), skin, R.head, HC.x, HC.y, HC.z, .035);
  const onFace = (x, y, inset = 0) => { const dy = y - HC.y; return Math.sqrt(Math.max(0, HR * HR - x * x - dy * dy)) - inset; };
  // big anime eyes
  R.eyes = [];
  for (const s of [1, -1]) {
    const ex = .11 * s, ey = .22, ez = onFace(ex, ey, .012);
    const eye = joint(R.head, ex, ey, ez);
    eye.rotation.set(0, Math.atan2(ex, ez) * .9, 0);
    part(ball(.068, 18, 14), flat('#ffffff'), eye, 0, 0, 0, 0).scale.set(1, 1.3, .32);
    part(ball(.056, 18, 14), flat(look.eye), eye, 0, -.008, .012, 0).scale.set(1, 1.35, .3);
    part(ball(.03, 14, 10), flat('#1b1420'), eye, 0, -.012, .022, 0).scale.set(1, 1.3, .3);
    part(ball(.02, 10, 8), flat('#ffffff'), eye, .018 * s, .03, .03, 0);
    part(ball(.01, 8, 6), flat('#ffffff'), eye, -.02 * s, -.035, .03, 0);
    part(new THREE.BoxGeometry(.1, .016, .02), flat('#3a2a22'), eye, 0, .1, .005, 0).rotation.z = -.12 * s;   // eyelid line
    const brow = part(new THREE.BoxGeometry(.075, .014, .02), flat(look.hair === '#f28bb6' ? '#b35a7e' : '#3a2a22'), R.head, ex, .37, onFace(ex, .37) - .005, 0);
    brow.rotation.set(0, Math.atan2(ex, onFace(ex, .37)), .12 * s);
    R.eyes.push(eye);
    const blush = part(ball(.045, 14, 10), new THREE.MeshBasicMaterial({ color: '#ff9fb2', transparent: true, opacity: .7 }), R.head, .18 * s, .13, onFace(.18 * s, .13) - .01, 0);
    blush.scale.set(1.3, .6, .25); blush.rotation.y = Math.atan2(.18 * s, onFace(.18 * s, .13));
  }
  const mouth = part(new THREE.TorusGeometry(.03, .009, 8, 16, Math.PI), flat('#b2453f'), R.head, 0, .12, onFace(0, .12) - .004, 0);
  mouth.rotation.z = Math.PI; R.mouth = mouth;
  // hair
  const back = part(new THREE.SphereGeometry(.322, 32, 20, 0, Math.PI * 2, 0, Math.PI * .62), hairM, R.head, 0, .27, -.015, .035);
  back.rotation.x = -.42;
  for (let i = -2; i <= 2; i++) {                          // fringe
    const b = part(new THREE.SphereGeometry(.085, 14, 10), hairM, R.head, i * .085, .43 - Math.abs(i) * .018, onFace(i * .085, .43) - .035, .05);
    b.scale.set(1, 1.15, .55); b.rotation.z = i * .2;
  }
  for (const s of [1, -1]) {                               // side hair
    const sd = part(cap(.07, .14), hairM, R.head, .27 * s, .2, .03, .05);
    sd.rotation.z = -.15 * s;
  }
  if (look.style === 'bob') for (const s of [1, -1]) { const b = part(cap(.085, .16), hairM, R.head, .25 * s, .12, -.05, .05); b.rotation.z = -.1 * s; }
  if (look.style === 'pony') {
    part(ball(.11), hairM, R.head, 0, .36, -.3, .05);
    const tail = part(cap(.085, .24), hairM, R.head, 0, .18, -.37, .05); tail.rotation.x = .35;
    part(new THREE.TorusGeometry(.05, .02, 8, 14), toon('#e2574c'), R.head, 0, .34, -.36, .05).rotation.x = 1.2;
  }
  if (look.style === 'spiky') for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    const sp = part(new THREE.ConeGeometry(.08, .2, 10), hairM, R.head, Math.cos(a) * .2, .5, Math.sin(a) * .2 - .03, .05);
    sp.rotation.set(Math.sin(a) * .7, 0, -Math.cos(a) * .7);
  }
  if (look.style === 'buns') for (const s of [1, -1]) {
    part(ball(.12), hairM, R.head, .24 * s, .48, -.05, .05);
    const tw = part(cap(.065, .22), hairM, R.head, .3 * s, .22, -.12, .05); tw.rotation.z = -.2 * s;
    part(ball(.035), toon('#7cc7e8'), R.head, .17 * s, .52, .05, .05);
  }
  if (look.style === 'farmer') {                           // farmer hat
    const hat = toon(look.hat);
    part(new THREE.SphereGeometry(.33, 32, 16, 0, Math.PI * 2, 0, Math.PI * .45), hat, R.head, 0, .3, -.01, .04);
    const brim = part(new THREE.CylinderGeometry(.24, .24, .03, 24, 1, false, 0, Math.PI), hat, R.head, 0, .43, .14, .05);
    brim.rotation.set(-.15, Math.PI / 2, 0); brim.scale.set(1, 1, 1.1);
    part(new THREE.BoxGeometry(.66, .05, .05), toon('#ffffff'), R.head, 0, .44, .0, 0).scale.set(1, 1, 1);
  }
  if (look.glasses) for (const s of [1, -1]) {
    const g = part(new THREE.TorusGeometry(.075, .01, 8, 24), flat('#2b2440'), R.head, .11 * s, .22, onFace(.11 * s, .22) + .01, 0);
    g.rotation.y = Math.atan2(.11 * s, onFace(.11 * s, .22));
  }
  // coffee cup in the right hand
  R.cup = part(new THREE.CylinderGeometry(.06, .05, .12, 14), toon('#ffffff'), R.rArm.el, 0, -.16, .07, .06);
  R.cup.visible = false;
  return R;
}

// ---------- poses (from squad-3d) ----------
export function resetPose(R) {
  for (const o of [R.hips, R.torso, R.head, R.lArm.sh, R.lArm.el, R.rArm.sh, R.rArm.el, R.lLeg.hip, R.lLeg.knee, R.rLeg.hip, R.rLeg.knee]) o.rotation.set(0, 0, 0);
  R.hips.position.y = HIP_H;
  R.lArm.sh.rotation.z = .12; R.rArm.sh.rotation.z = -.12;
  R.root.rotation.z = 0;
}
export function blink(st, t) {
  if (t > st.blinkAt) st.blinkAt = t + 2.5 + Math.random() * 3;
  const b = (st.blinkAt - t) < .12 ? .12 : 1;
  for (const e of st.rig.eyes) e.scale.y = b;
}
export function sitLegs(R, thigh = -Math.PI / 2, knee = Math.PI / 2, spread = .1) {
  R.lLeg.hip.rotation.set(thigh, 0, spread); R.rLeg.hip.rotation.set(thigh, 0, -spread);
  R.lLeg.knee.rotation.x = knee; R.rLeg.knee.rotation.x = knee;
}
export function arms(R, l, r) {          // [shoulder.x, shoulder.z, elbow.x]
  if (l) { R.lArm.sh.rotation.x = l[0]; R.lArm.sh.rotation.z = l[1]; R.lArm.el.rotation.x = l[2]; }
  if (r) { R.rArm.sh.rotation.x = r[0]; R.rArm.sh.rotation.z = r[1]; R.rArm.el.rotation.x = r[2]; }
}
