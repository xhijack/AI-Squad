// Realistic look (Phase 3.2 PoC): root motion taken out of the clips, the arm IK, and one full loop of the person
// (type, push back, stand up, turn, walk, turn, sit down, pull in) on a small synthetic skeleton.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './three-hook.js';

const THREE = await import('three');
const { Person, takeRootMotion, twoBoneIK, angleDiff } = await import('../ui/realistic-person.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
// a root track (centimetres) moving along z from 0 to dz over d seconds, height y0 -> y1
const rootClip = (name, d, dz, y0 = 90, y1 = 90) => new THREE.AnimationClip(name, d, [new THREE.VectorKeyframeTrack('Bip01.position', [0, d / 2, d], [0, y0, 0, 0, (y0 + y1) / 2, dz / 2, 0, y1, dz])]);

test('root motion is taken out of a clip and kept as a sampler', () => {
  const clip = rootClip('sitDown', 2, -46, 90, 59);
  const m = takeRootMotion(clip);
  near(m.end.y, -46, 1e-6, 'the travel is kept'); near(m.at(1).y, -23, 1e-6, 'and can be sampled');
  const v = clip.tracks[0].values;
  assert.deepEqual([v[2], v[5], v[8]], [0, 0, 0], 'the clip itself no longer travels');
  assert.deepEqual([v[1], v[7]], [90, 59], 'but keeps its height');
});

test('two-bone IK puts the hand on the target and keeps the bone lengths', () => {
  const root = new THREE.Bone(), upper = new THREE.Bone(), lower = new THREE.Bone(), hand = new THREE.Bone();
  root.add(upper); upper.add(lower); lower.add(hand);
  upper.position.set(0, 1.4, 0); lower.position.set(.3, 0, 0); hand.position.set(.27, 0, 0);
  lower.rotation.z = -.3;                                         // a slight bend gives the IK its plane
  root.updateMatrixWorld(true);
  const target = new THREE.Vector3(.3, 1.05, .25);
  twoBoneIK(upper, lower, hand, target, 1);
  const p = hand.getWorldPosition(new THREE.Vector3());
  assert.ok(p.distanceTo(target) < 1e-3, `reached ${p.toArray()}`);
  const e = lower.getWorldPosition(new THREE.Vector3()), s = upper.getWorldPosition(new THREE.Vector3());
  near(s.distanceTo(e), .3, 1e-6, 'upper arm length'); near(e.distanceTo(p), .27, 1e-6, 'forearm length');
  // weight 0: the pose the clip set
  lower.rotation.set(0, 0, -.3); upper.rotation.set(0, 0, 0); root.updateMatrixWorld(true);
  const before = hand.getWorldPosition(new THREE.Vector3());
  twoBoneIK(upper, lower, hand, target, 0);
  assert.ok(hand.getWorldPosition(new THREE.Vector3()).distanceTo(before) < 1e-6, 'weight 0 leaves the clip alone');
});

test('angleDiff takes the short way round', () => {
  near(angleDiff(.1, Math.PI * 2 - .1), .2, 1e-9, 'across zero');
  near(angleDiff(-Math.PI + .1, Math.PI - .1), .2, 1e-9, 'across pi');
});

test('one loop: types, pushes back, stands, strolls, sits down, pulls in, and ends where it started', () => {
  const model = new THREE.Group(); model.scale.setScalar(.01);
  const bones = {};
  for (const n of ['Bip01', 'Bip01_Head', 'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand']) { bones[n] = new THREE.Bone(); bones[n].name = n; }
  model.add(bones.Bip01); bones.Bip01.add(bones.Bip01_Head);
  const clips = { sitDown: rootClip('sitDown', 2.9, -46, 90, 59), standUp: rootClip('standUp', 2.5, 42, 59, 90), walk: rootClip('walk', 1, 0), sit: rootClip('sit', 4, 0, 58, 58), idle: rootClip('idle', 2, 0) };
  const chair = new THREE.Group(); chair.position.set(0, 0, .05);
  const seat = new THREE.Vector3(0, 0, .15), stroll = [[0, 0], [-.5, -.3], [-.8, -.8], [-.3, -.7], [0, .04]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const p = new Person({ model, clips, walkSpeed: 1.4 }, { seat, facing: Math.PI, chair, stroll, out: .5 });
  const seen = [p.phase];
  let pushed = 0;
  for (let t = 0; t < 40 && !(seen.length > 1 && p.phase === 'type'); t += 1 / 30) {
    p.update(1 / 30, t);
    if (p.phase !== seen.at(-1)) seen.push(p.phase);
    pushed = Math.max(pushed, chair.position.distanceTo(new THREE.Vector3(0, 0, .05)));
  }
  assert.deepEqual(seen, ['type', 'pushBack', 'standUp', 'turn', 'walk', 'turn', 'sitDown', 'pullIn', 'type']);
  near(pushed, .5, 1e-6, 'the chair rolled back 50 cm');
  assert.ok(chair.position.distanceTo(new THREE.Vector3(0, 0, .05)) < 1e-6, 'and back in');
  assert.ok(p.root.position.distanceTo(seat) < 1e-6, 'seated where it started');
  near(angleDiff(p.root.rotation.y, Math.PI), 0, 1e-3, 'facing the desk again');
});
