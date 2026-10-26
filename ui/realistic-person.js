// SPDX-License-Identifier: Apache-2.0
// Realistic look (Phase 3.2 proof of concept): one Microsoft Rocketbox avatar (MIT) with its own motion-captured
// clips (sit, stand up, walk, sit down, idle; converted by scripts/convert-assets.js). The clips' root travel is
// taken out of the clips and applied to the character's position here, so crossfades never pull it backwards.
// On top: typing fingers and small head movements while seated. One loop: sit and type, push the chair back,
// stand up, walk a few steps and back, sit down, pull the chair in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ROOT = 'Bip01';
const ease = (k) => k * k * (3 - 2 * k);

export async function loadPerson(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene.getObjectByName('character') || gltf.scene;
  model.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    if (o.isMesh && o.material.name === 'hair') { o.material.transparent = false; o.material.alphaTest = .45; o.material.alphaToCoverage = true; o.castShadow = false; }
  });
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  return { model, clips, walkSpeed: model.userData.walkSpeed || 1.4 };
}

// the root's horizontal travel of a clip as a sampler (centimetres in the clip's space), then removed from the clip
export function takeRootMotion(clip) {
  const tr = clip.tracks.find((t) => t.name === `${ROOT}.position`);
  if (!tr) return null;
  const copy = tr.clone(), inter = copy.createInterpolant();
  const at = (t) => { const v = inter.evaluate(Math.min(Math.max(t, 0), clip.duration)); return new THREE.Vector2(v[0], v[2]); };
  const v = tr.values, x0 = v[0], z0 = v[2];
  for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  return { at, end: at(clip.duration).sub(at(0)) };
}

export class Person {
  // seat: where the pelvis is when seated at the desk (floor point); facing: yaw toward the desk;
  // chair: the chair object (rolls back and in); walk: points of the stroll, relative to the standing spot
  constructor({ model, clips, walkSpeed }, { seat, facing, chair, out = .34, stroll }) {
    Object.assign(this, { model, seat: seat.clone(), facing, chair, out, stroll, walkSpeed });
    this.root = new THREE.Group(); this.root.add(model); this.root.name = 'person';
    this.mixer = new THREE.AnimationMixer(model);
    this.motion = {};
    for (const n of ['sitDown', 'standUp']) this.motion[n] = takeRootMotion(clips[n]);
    for (const n of ['walk', 'sit', 'idle']) takeRootMotion(clips[n]);                  // in place (already flat; keep x/z still)
    this.actions = Object.fromEntries(Object.entries(clips).map(([n, c]) => [n, this.mixer.clipAction(c)]));
    for (const n of ['sitDown', 'standUp']) { this.actions[n].setLoop(THREE.LoopOnce); this.actions[n].clampWhenFinished = true; }
    this.bones = {}; model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.chairHome = chair.position.clone();
    this.fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    this.chairOut = this.chairHome.clone().addScaledVector(this.fwd, -out);
    this.current = null; this.t = 0; this.phase = null; this.saved = new Map();
    this.root.position.copy(this.seat); this.root.rotation.y = facing;
    this.play('sit', 0); this.go('type');
    this.typing = 1;
  }
  play(name, fade = .35) {
    const a = this.actions[name];
    if (this.current === a) return;
    a.reset().setEffectiveWeight(1).play();
    if (this.current && fade) this.current.crossFadeTo(a, fade, false); else if (this.current) this.current.stop();
    this.current = a;
    this.rootPrev = { action: a, t: 0 };
  }
  go(phase, data = {}) { this.phase = phase; this.pt = 0; Object.assign(this, data); }

  // the loop, step by step
  step(dt) {
    this.pt += dt;
    const P = this.phase, r = this.root;
    if (P === 'type' && this.pt > 9) this.go('pushBack', { from: r.position.clone() });
    else if (P === 'pushBack') {                                  // seated, rolls the chair back
      const k = ease(Math.min(1, this.pt / .9));
      r.position.copy(this.from).addScaledVector(this.fwd, -this.out * k);
      this.chair.position.lerpVectors(this.chairHome, this.chairOut, k);
      this.typing = Math.max(0, 1 - this.pt * 3);
      if (k >= 1) { this.play('standUp', .3); this.go('standUp'); }
    } else if (P === 'standUp' && this.pt >= this.actions.standUp.getClip().duration - .15) {
      const start = r.position.clone(), pts = this.stroll.map((p) => start.clone().add(p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.facing)));
      this.go('turn', { yaw0: r.rotation.y, yaw1: Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z), path: new THREE.CatmullRomCurve3(pts), next: 'walk' });
      this.play('idle', .4);
    } else if (P === 'turn') {
      const k = ease(Math.min(1, this.pt / .7));
      r.rotation.y = this.yaw0 + angleDiff(this.yaw1, this.yaw0) * k;
      if (k >= 1) {
        if (this.next === 'walk') { this.go('walk', { s: 0, len: this.path.getLength() }); this.play('walk', .3); this.actions.walk.timeScale = 1.1 / this.walkSpeed; }
        else { this.go('sitDown'); this.play('sitDown', .3); }
      }
    } else if (P === 'walk') {
      this.s = Math.min(this.len, this.s + 1.1 * dt);
      const u = this.path.getUtoTmapping(this.s / this.len), p = this.path.getPoint(u), tan = this.path.getTangent(u);
      r.position.set(p.x, r.position.y, p.z);
      r.rotation.y += angleDiff(Math.atan2(tan.x, tan.z), r.rotation.y) * Math.min(1, dt * 8);
      if (this.s >= this.len) { this.play('idle', .45); this.go('turn', { yaw0: r.rotation.y, yaw1: this.facing, next: 'sitDown' }); }
    } else if (P === 'sitDown' && this.pt >= this.actions.sitDown.getClip().duration - .1) {
      this.play('sit', .3); this.go('pullIn', { from: r.position.clone() });
    } else if (P === 'pullIn') {
      const k = ease(Math.min(1, this.pt / 1));
      r.position.copy(this.from).addScaledVector(this.fwd, this.out * k);
      this.chair.position.lerpVectors(this.chairOut, this.chairHome, k);
      if (k >= 1) { r.position.copy(this.seat); this.go('type'); }
    } else if (P === 'type') this.typing = Math.min(1, this.typing + dt * 2);
  }
  // the clip's own root travel this frame, turned into world space
  applyRootMotion() {
    const a = this.current, name = a?.getClip().name, m = this.motion[name];
    if (!m) return;
    const t = a.time, d = m.at(t).sub(m.at(this.rootPrev.action === a ? this.rootPrev.t : 0));
    this.rootPrev = { action: a, t };
    const s = this.model.scale.x;
    const v = new THREE.Vector3(d.x * s, 0, d.y * s).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y);
    this.root.position.add(v);
  }
  // small motions on top of the clip: fingers typing, the head looking around a little
  overlay(time) {
    const add = (name, x, y, z) => {
      const b = this.bones[name]; if (!b) return;
      this.saved.set(b, b.quaternion.clone());
      b.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
    };
    const k = this.typing;
    if (k > 0) for (const side of ['L', 'R']) for (const f of [1, 2, 3]) {
      const ph = time * (side === 'L' ? 11 : 13) + f * 1.7 + (side === 'L' ? 0 : 2.1);
      add(`Bip01_${side}_Finger${f}`, 0, 0, k * .22 * Math.max(0, Math.sin(ph)) ** 3);
    }
    if (k > 0 && this.keys) for (const side of ['L', 'R']) {        // hands onto the keys, a small bob as they type
      const t = this.keys[side].clone(); t.y += .012 * Math.max(0, Math.sin(time * (side === 'L' ? 7.3 : 8.1)));
      const b = (n) => this.bones[`Bip01_${side}_${n}`];
      for (const x of [b('UpperArm'), b('Forearm'), b('Hand')]) if (!this.saved.has(x)) this.saved.set(x, x.quaternion.clone());
      twoBoneIK(b('UpperArm'), b('Forearm'), b('Hand'), t, k);
      palmDown(b('Hand'), b('Finger2'), b('Finger0'), side === 'L' ? 1 : -1, this.root.rotation.y, k);
    }
    add('Bip01_Head', .04 * Math.sin(time * .37) * (this.phase === 'type' ? 1 : .4), .06 * Math.sin(time * .23 + 1), 0);
  }
  // back to what the clip set (or the rest pose) before the next clip step
  restoreOverlay() { for (const [b, q] of this.saved) b.quaternion.copy(q); this.saved.clear(); }
  update(dt, time) {
    this.restoreOverlay();
    this.step(dt);
    this.mixer.update(dt);
    this.applyRootMotion();
    this.overlay(time);
  }
}
// two-bone IK in world space: the upper arm and forearm turn so the hand reaches the target, bending in the plane
// of the elbow's current direction; w blends from the clip's pose (0) to the reach (1)
const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _t = V(), _q = new THREE.Quaternion(), _p = new THREE.Quaternion();
function turnBone(bone, from, to, w) {
  _q.setFromUnitVectors(from.normalize(), to.normalize()).slerp(new THREE.Quaternion(), 1 - w);
  bone.getWorldQuaternion(_p); _p.premultiply(_q);
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(_p));
  bone.updateMatrixWorld(true);
}
export function twoBoneIK(upper, lower, end, target, w) {
  upper.getWorldPosition(_a); lower.getWorldPosition(_b); end.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
  const d = Math.min(_t.copy(target).sub(_a).length(), (l1 + l2) * .999), dir = _t.clone().normalize();
  const cos = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const bend = _b.clone().sub(_a); bend.addScaledVector(dir, -bend.dot(dir)); if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0); bend.normalize();
  const elbow = _a.clone().addScaledVector(dir, l1 * cos).addScaledVector(bend, l1 * Math.sqrt(1 - cos * cos));
  turnBone(upper, _b.clone().sub(_a), elbow.sub(_a), w);
  lower.getWorldPosition(_b); end.getWorldPosition(_c);
  turnBone(lower, _c.clone().sub(_b), target.clone().sub(_b), w);
}
// the hand flat over the keys: fingers forward and a little down, the thumb toward the other hand (palm down);
// inward: +1 for the left hand (its thumb points to the person's right), yaw: the person's facing
function palmDown(hand, middle, thumb, inward, yaw, w) {
  const y = new THREE.Vector3(0, 1, 0), fd = new THREE.Vector3(-.12 * inward, -.14, 1).normalize().applyAxisAngle(y, yaw);
  const td = new THREE.Vector3(-inward, -.25, 0).applyAxisAngle(y, yaw);
  const h = hand.getWorldPosition(V());
  turnBone(hand, middle.getWorldPosition(V()).sub(h), fd.clone(), w);
  const tv = thumb.getWorldPosition(V()).sub(h);
  const flat = (v) => v.addScaledVector(fd, -v.dot(fd));
  turnBone(hand, flat(tv), flat(td), w);
}
export const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
