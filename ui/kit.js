// KayKit models (CC0, see ASSETS.md) for the office: one GLB, loaded once, cloned per use. Each model is fitted
// to a target size (width, height, depth in metres) with its base on the floor and its centre at the origin.
// Until the file has loaded, or when it cannot be loaded, the procedural builders in scene.js draw the room.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const lib = new Map();                         // model name -> { obj, box }
let state = 'idle';                            // idle | loading | ready | failed
export const kitReady = () => state === 'ready';
export const kitStamp = () => state;           // part of a Floor's signature: the Floor is rebuilt once the models arrive

export function loadKit(url, onReady) {
  if (state !== 'idle') return;
  state = 'loading';
  new GLTFLoader().load(url, (g) => {
    for (const root of [...g.scene.children]) {
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.kit = true; if (o.material.map) o.material.map.anisotropy = 4; } });
      root.updateMatrixWorld(true);
      lib.set(root.name, { obj: root, box: new THREE.Box3().setFromObject(root) });
    }
    state = 'ready';
    onReady?.();
  }, undefined, () => { state = 'failed'; });
}

// a clone fitted to size { w, h, d } (any may be left out: the others scale uniformly); null when not loaded
export function kit(name, { w, h, d, uniform = true } = {}) {
  const m = lib.get(name);
  if (!m) return null;
  const size = m.box.getSize(new THREE.Vector3()), centre = m.box.getCenter(new THREE.Vector3());
  const k = [w && w / size.x, h && h / size.y, d && d / size.z].filter(Boolean);
  const s = uniform ? new THREE.Vector3().setScalar(k.length ? Math.min(...k) : 1) : new THREE.Vector3(w ? w / size.x : k[0] || 1, h ? h / size.y : k[0] || 1, d ? d / size.z : k[0] || 1);
  const inner = m.obj.clone(true);
  inner.position.set(-centre.x, -m.box.min.y, -centre.z);
  const g = new THREE.Group();
  g.add(inner); g.scale.copy(s);
  g.userData.kitModel = name;
  return g;
}
