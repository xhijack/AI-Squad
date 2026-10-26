// Static merging (ui/merge.js; test/merge.test.js is the git merge of server/merge.js) and the chibi's merged parts (ui/chibi.js): fewer meshes, same geometry in place,
// and what changes on its own (screens, the mouth, the cup) left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './three-hook.js';

const THREE = await import('three');
const { mergeStatic } = await import('../ui/merge.js');

const box = (m, x) => { const o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m); o.position.x = x; o.castShadow = true; return o; };

test('meshes sharing a material become one, with their transforms baked in; screens and keep stay', () => {
  const wood = new THREE.MeshStandardMaterial(), steel = new THREE.MeshStandardMaterial();
  const root = new THREE.Group(); root.position.set(10, 0, 0); root.rotation.y = 1;
  const sub = new THREE.Group(); sub.position.z = 3; root.add(sub);
  root.add(box(wood, 0), box(wood, 2)); sub.add(box(wood, -2), box(steel, 0));
  const screen = box(wood, 5); screen.userData.screen = true; root.add(screen);
  const led = box(wood, 6); root.add(led);
  const r = mergeStatic(root, (o) => o === led);
  assert.deepEqual(r, { before: 3, after: 1 });
  const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 4, 'merged wood, steel (alone), the screen, the LED');
  const merged = meshes.find((o) => o.geometry.attributes.position.count === 72);
  assert.ok(merged && merged.castShadow);
  const bb = new THREE.Box3().setFromBufferAttribute(merged.geometry.attributes.position);
  assert.deepEqual([bb.min.x, bb.max.x, bb.min.z, bb.max.z], [-2.5, 2.5, -.5, 3.5], 'in the root\'s own space');
  assert.ok(merged.geometry.index, 'indices kept');
});

test('a chibi keeps its joints, mouth and cup, with far fewer meshes', async () => {
  globalThis.document ||= { createElement: () => ({ getContext: () => null }) };
  const { buildChibi } = await import('../ui/chibi.js');
  const R = buildChibi({ eye: '#2f3a4a', pants: '#334155', shoe: '#1f2937', hat: '#f08a24', skin: '#f6d2b0', hair: '#2b2440', shirt: '#3d82d6', sleeve: '#3d82d6', style: 'pony' });
  let meshes = 0; R.root.traverse((o) => { if (o.isMesh) meshes++; });
  assert.ok(meshes < 45, `${meshes} meshes`);
  assert.ok(R.mouth.isMesh && R.mouth.parent === R.head && R.cup.isMesh && R.cup.visible === false);
  assert.equal(R.eyes.length, 2);
  assert.ok(R.lArm.el.children.some((c) => c.isMesh), 'the forearm still has its (merged) parts');
});
