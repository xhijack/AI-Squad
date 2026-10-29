// SPDX-License-Identifier: Apache-2.0
// Microsoft Rocketbox (MIT) avatar and animations: FBX from 3ds Max -> one GLB for three.js. Runs in the converter page.
import * as THREE from 'three';
import { FBXLoader } from 'jsm/loaders/FBXLoader.js';

const SRC = '/playground/assets-src/rocketbox/';
const loadFbx = (url) => new Promise((ok, no) => new FBXLoader().load(url, ok, undefined, no));

export async function probe({ file = 'Business_Male_01.fbx' } = {}) {
  const g = await loadFbx(SRC + file);
  const meshes = [], bones = [];
  g.traverse((o) => {
    if (o.isMesh) meshes.push({ name: o.name, skinned: !!o.isSkinnedMesh, verts: o.geometry.attributes.position.count, groups: o.geometry.groups.length,
      materials: [].concat(o.material).map((m) => ({ name: m.name, type: m.type, map: m.map?.name || m.map?.image?.src || null, transparent: m.transparent })) });
    if (o.isBone) bones.push(o.name);
  });
  const box = new THREE.Box3().setFromObject(g);
  return { meshes, bones: bones.length, someBones: bones.slice(0, 80), size: box.getSize(new THREE.Vector3()).toArray(), min: box.min.toArray(),
    anims: g.animations.map((a) => ({ name: a.name, duration: a.duration, tracks: a.tracks.length })), rootScale: g.scale.toArray() };
}

export async function probeAnim({ file }) {
  const g = await loadFbx(SRC + file);
  let meshes = 0; g.traverse((o) => { if (o.isMesh) meshes++; });
  return { meshes, anims: g.animations.map((a) => ({ name: a.name, duration: a.duration, tracks: a.tracks.length,
    sample: a.tracks.slice(0, 6).map((t) => `${t.name} ${t.times.length}`),
    root: a.tracks.filter((t) => /^Bip01(_Pelvis)?\.position/.test(t.name)).map((t) => ({ name: t.name, first: [...t.values.slice(0, 3)], last: [...t.values.slice(-3)] })) })) };
}

// ---------- one avatar + its animations -> GLB ----------
import { GLTFExporter } from 'jsm/exporters/GLTFExporter.js';

const tex = (url, srgb) => new Promise((ok, no) => new THREE.TextureLoader().load(url, (t) => {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.userData.mimeType = url.endsWith('.png') ? 'image/png' : 'image/jpeg';
  ok(t);
}, undefined, no));

// keep what a clip needs on this avatar: bone rotations, and the root's position (Bip01); other bones keep the
// avatar's own proportions; tracks that never move and equal the rest pose are dropped
function cleanClip(clip, avatar, name) {
  const rest = new Map();
  avatar.traverse((o) => { if (o.isBone) rest.set(o.name, o.quaternion); });
  const tracks = [];
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split('.');
    if (!rest.has(bone) || prop === 'scale' || (prop === 'position' && bone !== 'Bip01')) continue;
    const n = t.getValueSize(), v = t.values;
    let still = true;
    for (let i = n; i < v.length && still; i++) if (Math.abs(v[i] - v[i % n]) > 1e-4) still = false;
    if (still && prop === 'quaternion' && Math.abs(Math.abs(new THREE.Quaternion().fromArray(v, 0).dot(rest.get(bone))) - 1) < 1e-5) continue;
    tracks.push(still ? new t.constructor(t.name, [t.times[0], t.times[t.times.length - 1]], [...v.slice(0, n), ...v.slice(0, n)]) : t);
  }
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

export async function character({ file = 'Business_Male_01.fbx', prefix = 'm005', anims = {} } = {}) {
  const t0 = performance.now(), at = (x) => window.steps?.push(`${x} ${Math.round(performance.now() - t0)}ms`);
  const avatar = await loadFbx(SRC + file); at('avatar');
  const web = SRC + 'web/' + prefix;
  const mat = async (part) => {
    const mr = await tex(`${web}_${part}_mr.jpg`, false);
    return new THREE.MeshStandardMaterial({ name: part, map: await tex(`${web}_${part}_color.jpg`, true), normalMap: await tex(`${web}_${part}_normal.jpg`, false),
      roughnessMap: mr, metalnessMap: mr, roughness: 1, metalness: 1 });
  };
  const body = await mat('body'), head = await mat('head');
  const hasHair = (await fetch(`${web}_opacity.png`, { method: 'HEAD' })).ok;      // hair cards and lashes, when the avatar has them
  const hair = hasHair && new THREE.MeshStandardMaterial({ name: 'hair', map: await tex(`${web}_opacity.png`, true), transparent: true, alphaTest: 0.25, roughness: 0.6, side: THREE.DoubleSide });
  let mesh = null;
  avatar.traverse((o) => { if (o.isSkinnedMesh) { mesh = o; o.name = 'avatar'; o.material = [].concat(o.material).map((m) => (/opacity/.test(m.name) ? hair : /head/.test(m.name) ? head : body)); } });
  const info = { verts: mesh.geometry.attributes.position.count, clips: {} };
  const clips = [];
  for (const [name, f] of Object.entries(anims)) {
    const src = (await loadFbx(SRC + f)).animations[0];
    const clip = cleanClip(src, avatar, name);
    const root = clip.tracks.find((t) => t.name === 'Bip01.position');
    const first = [...root.values.slice(0, 3)], last = [...root.values.slice(-3)];
    if (name === 'walk') {                         // in place: the scene moves the character, the clip keeps the bob
      const v = root.values, d = clip.duration, dz = last[2] - first[2];
      for (let i = 0; i < root.times.length; i++) { v[i * 3] = first[0]; v[i * 3 + 2] -= first[2] + dz * root.times[i] / d; }
      info.walkSpeed = +(dz / 100 / d).toFixed(3);   // metres per second
    }
    info.clips[name] = { duration: +clip.duration.toFixed(3), tracks: clip.tracks.length, rootFirst: first.map((x) => +(x / 100).toFixed(3)), rootLast: last.map((x) => +(x / 100).toFixed(3)) };
    clips.push(clip); at(name);
  }
  avatar.name = 'character';
  avatar.scale.setScalar(0.01);                    // centimetres (3ds Max) -> metres
  avatar.userData = { source: `Microsoft Rocketbox ${file} (MIT)`, ...info };
  const glb = await new GLTFExporter().parseAsync(avatar, { binary: true, animations: clips }); at('export');
  return { glb, info };
}
