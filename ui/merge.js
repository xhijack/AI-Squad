// SPDX-License-Identifier: Apache-2.0
// Fewer draw calls for things that never move: the meshes under a group (a desk station, a device, the room) are
// merged into one mesh per material, with their transforms baked in. Meshes that change on their own stay as they
// are: screens, instanced meshes, anything with userData.keep (or under a parent with it), and what keep(o) names.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ATTRS = ['position', 'normal', 'uv'];
const kept = (o, root, keep) => {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.userData.screen || keep(o)) return true;
  for (let p = o; p && p !== root; p = p.parent) if (p.userData.keep || !p.visible) return true;
  return false;
};

// -> { before: meshes merged away, after: meshes made }
export function mergeStatic(root, keep = () => false) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  root.traverse((o) => {
    if (kept(o, root, keep)) return;
    const attrs = ATTRS.filter((a) => o.geometry.attributes[a]).join();
    const key = `${o.material.uuid}|${attrs}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`;
    if (!groups.has(key)) groups.set(key, { meshes: [], material: o.material, cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder });
    groups.get(key).meshes.push(o);
  });
  let before = 0, after = 0;
  for (const g of groups.values()) {
    if (g.meshes.length < 2) continue;
    const geos = g.meshes.map((o) => {
      const x = o.geometry.clone();
      for (const k of Object.keys(x.attributes)) if (!ATTRS.includes(k)) x.deleteAttribute(k);
      x.morphAttributes = {};
      x.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      return x;
    });
    const indexed = geos.every((x) => x.index);                           // keep the indices when all have them (much less memory)
    const merged = mergeGeometries(indexed ? geos : geos.map((x) => (x.index ? x.toNonIndexed() : x)));
    geos.forEach((x) => x.dispose());
    if (!merged) continue;
    const m = new THREE.Mesh(merged, g.material);
    Object.assign(m, { castShadow: g.cast, receiveShadow: g.receive, renderOrder: g.order });
    root.add(m);
    for (const o of g.meshes) o.parent.remove(o);
    before += g.meshes.length; after++;
  }
  return { before, after };
}
