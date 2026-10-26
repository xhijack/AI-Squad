// SPDX-License-Identifier: Apache-2.0
// Realistic look, proof of concept (Phase 3.2 step 1): one desk corner at ?look=desk-poc, next to (not instead of)
// the default look. Real-size furniture and props with physically based materials (Poly Haven CC0 models and
// textures, plus pieces built in realistic-props.js), one Microsoft Rocketbox person (MIT) who types, stands up,
// walks a few steps and sits back down, image-based light from the studio HDRI, a soft sun shadow, a warm desk lamp,
// contact shadows, ambient occlusion (the models' own baked AO maps plus GTAO on High) and AgX tone mapping.
// Two cameras: the office's isometric view and a closer 3/4 view of the desk.
//   ?look=desk-poc[&view=wide|close][&desk=oak|metal][&quality=high|low][&t=seconds into the loop][&cam=x,y,z&at=x,y,z]
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Quality, ContactShadows } from './render.js';
import { pbrSet, officeChair, monitor, laptop, keyboard, mouse, mug, oakDesk } from './realistic-props.js';
import { loadPerson, Person } from './realistic-person.js';
import { t } from './i18n.js';

const A = './assets/realistic/';
const ISO = new THREE.Vector3(1, .95, 1).normalize();             // the office's isometric angle (scene.js)
const params = new URLSearchParams(location.search);
const poc = window.__poc = { ready: false, frames: [], frameMs: 0 };

// a loaded model fitted to a size in metres (any of w, h, d; uniform scale), base on the floor, centred
function fit(obj, { w, h, d }) {
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = Math.min(...[w && w / size.x, h && h / size.y, d && d / size.z].filter(Boolean));
  const inner = obj; inner.position.set(-c.x, -box.min.y, -c.z);
  const g = new THREE.Group(); g.add(inner); g.scale.setScalar(k);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  return g;
}
const place = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; return o; };

function room(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), pbrSet('laminate_floor_02', { size: 1.7 }));
  floor.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 9; });
  floor.receiveShadow = true; floor.name = 'floor';
  const plaster = pbrSet('beige_wall_001', { size: 1.5, color: 0xfaf8f5 });
  const wall = (w, h) => { const g = new THREE.PlaneGeometry(w, h); g.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 ? h : w); }); const m = new THREE.Mesh(g, plaster); m.receiveShadow = true; return m; };
  const back = place(wall(9, 2.8), 0, 1.4, -1.05), left = place(wall(9, 2.8), -1.45, 1.4, 0, Math.PI / 2);
  const skirting = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: .45 });
  const sk1 = place(new THREE.Mesh(new THREE.BoxGeometry(9, .08, .015), skirting), 0, .04, -1.042), sk2 = place(new THREE.Mesh(new THREE.BoxGeometry(.015, .08, 9), skirting), -1.442, .04, 0);
  scene.add(floor, back, left, sk1, sk2);
  return [floor, back, left, sk1, sk2];
}

async function build() {
  document.body.classList.add('pocBody');
  document.body.innerHTML = `<canvas id="poc"></canvas>
    <div class="pocBar"><b>${t('Realistic look')}</b><span class="note">${t('proof of concept, not the office yet')}</span>
      <button data-view="wide">Wide</button><button data-view="close">Close</button>
      <select id="pocQ" aria-label="${t('Quality')}"><option value="high">${t('High')}</option><option value="low">${t('Low')}</option></select>
      <a href="./">${t('Back to the office')}</a></div>
    <div class="pocCredit">${t('Furniture and textures: Poly Haven (CC0). Person and motion: Microsoft Rocketbox (MIT). See ASSETS.md.')}</div>`;
  const canvas = document.getElementById('poc');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf1efeb);

  // light: sky fill, a soft sun through an (unseen) window on the right, the desk lamp
  const hemi = new THREE.HemisphereLight(0xf6f4f0, 0x9a9389, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.2); sun.position.set(3.2, 3.6, 2.2); sun.target.position.set(0, .6, -.5);
  Object.assign(sun.shadow, { bias: -.0004, normalBias: .02, radius: 9, blurSamples: 16 }); sun.shadow.mapSize.setScalar(2048);
  Object.assign(sun.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: .5, far: 9 });
  sun.castShadow = true; scene.add(sun, sun.target);
  const statics = room(scene);

  const gltf = new GLTFLoader();
  const [props, personSrc] = await Promise.all([gltf.loadAsync(`${A}desk-props.glb`), loadPerson(`${A}character.glb`)]);
  const pick = (n) => props.scene.getObjectByName(n);

  // the desk against the back wall, front edge at z = -0.25
  const metal = params.get('desk') === 'metal';
  const desk = metal ? fit(pick('metal_office_desk'), { w: 1.6 }) : oakDesk();
  const deskH = metal ? new THREE.Box3().setFromObject(desk).max.y : desk.userData.height;
  place(desk, 0, 0, -.65); scene.add(desk);
  const kb = place(keyboard(), 0, deskH, -.42), ms = place(mouse(), .3, deskH, -.4, .1);
  const mon = place(monitor(), 0, deskH, -.82);
  const lap = place(laptop(), .58, deskH, -.78, -.45);
  const lamp = place(fit(pick('desk_lamp_arm_01'), { h: .5 }), -.62, deskH, -.84, .7);
  const plant = place(fit(pick('potted_plant_04'), { h: .26 }), .66, deskH, -.9);
  const pads = place(fit(pick('office_notepads'), { w: .36 }), -.48, deskH, -.47, .15);
  const cup = place(mug(), .42, deskH, -.52);
  scene.add(kb, ms, mon, lap, lamp, plant, pads, cup);
  const bulb = new THREE.SpotLight(0xffd29a, 3, 1.6, .7, .8, 2); bulb.position.set(-.48, deskH + .42, -.66); bulb.target.position.set(-.35, deskH, -.5);
  bulb.castShadow = true; bulb.shadow.mapSize.setScalar(512); bulb.shadow.bias = -.0005; bulb.shadow.radius = 6;
  scene.add(bulb, bulb.target);

  // the person: seated so that the hands rest on the keyboard
  const chair = officeChair(); scene.add(chair);
  const facing = Math.PI;                                          // toward the desk (-z)
  const probe = new Person(personSrc, { seat: new THREE.Vector3(), facing, chair, stroll: [] });
  probe.mixer.update(0); probe.root.updateMatrixWorld(true);
  const hands = ['Bip01_L_Hand', 'Bip01_R_Hand'].map((n) => probe.bones[n].getWorldPosition(new THREE.Vector3()));
  const mid = hands[0].clone().add(hands[1]).multiplyScalar(.5);
  const seat = new THREE.Vector3(kb.position.x - mid.x, 0, kb.position.z + .02 - mid.z);
  poc.hands = { y: +mid.y.toFixed(3), desk: deskH, reach: +(-mid.z).toFixed(3) };
  probe.mixer.stopAllAction();
  place(chair, seat.x, 0, seat.z - .05, facing);                  // the seat's centre a little in front of the hips
  const stroll = [[0, 0], [-.45, -.3], [-.85, -.55], [-1, -.9], [-.7, -1.05], [-.3, -.75], [-.08, -.2], [0, .04]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const person = new Person(personSrc, { seat, facing, chair, stroll, out: .5 });   // the chair rolls back 50 cm to stand up
  scene.add(person.root);
  person.keys = { L: new THREE.Vector3(kb.position.x - .12, deskH + .05, kb.position.z + .09), R: new THREE.Vector3(kb.position.x + .1, deskH + .05, kb.position.z + .095) };   // wrists; he faces -z, his left is -x
  if (params.get('t')) { for (let t = 0, T = Number(params.get('t')); t < T; t += 1 / 30) person.update(1 / 30, t); }   // jump in the loop (screenshots)

  // contact shadows under the desk corner, ambient occlusion and grading from the shared Quality
  const contact = new ContactShadows({ width: 3.2, depth: 2.6, height: .9, darkness: 1.5, blur: 2.4, opacity: .7 });
  contact.group.position.set(0, .003, -.2); scene.add(contact.group);
  const quality = new Quality(renderer, scene, { hemi });
  const setLevel = (q) => { quality.chosen = q; quality.apply(q); };   // not saved: the office keeps its own Quality
  setLevel(params.get('quality') === 'low' ? 'low' : 'high');
  const qSel = document.getElementById('pocQ'); qSel.value = quality.active;
  qSel.onchange = () => { setLevel(qSel.value); applyLevel(); };
  const applyLevel = () => {
    const high = quality.active === 'high';
    renderer.toneMappingExposure = high ? 1.55 : 1.5;
    sun.shadow.mapSize.setScalar(high ? 2048 : 1024); sun.shadow.map?.dispose(); sun.shadow.map = null;
    renderer.shadowMap.type = high ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    bulb.castShadow = high; contact.group.visible = high;
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  };
  applyLevel();

  // cameras: the office's isometric view, and a closer 3/4 view of the desk
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 100), persp = new THREE.PerspectiveCamera(34, 1, .05, 60);
  const views = {
    wide: { cam: ortho, target: new THREE.Vector3(.05, .6, -.3), half: 1.15 },
    close: { cam: persp, target: new THREE.Vector3(-.1, .92, -.5), pos: new THREE.Vector3(1.55, 1.48, .38) },
  };
  const vec = (k) => (params.get(k) ? new THREE.Vector3(...params.get(k).split(',').map(Number)) : null);
  if (vec('cam')) Object.assign(views.close, { pos: vec('cam'), target: vec('at') || views.close.target });   // &cam=x,y,z&at=x,y,z (a free close view)
  let view = params.get('view') === 'close' || vec('cam') ? 'close' : 'wide', controls = null;
  const setView = (v) => {
    view = v; const V = views[v];
    if (V.cam.isOrthographicCamera) V.cam.position.copy(V.target).addScaledVector(ISO, 20); else V.cam.position.copy(V.pos);
    V.cam.lookAt(V.target);
    controls?.dispose(); controls = new OrbitControls(V.cam, canvas); controls.target.copy(V.target);
    Object.assign(controls, { enableDamping: true, enableRotate: v === 'close', screenSpacePanning: true, maxPolarAngle: Math.PI * .48 });
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    resize();
  };
  document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
  const resize = () => {
    const w = innerWidth, h = innerHeight, asp = w / h;
    renderer.setSize(w, h, false); quality.resize(w, h);
    const half = views.wide.half; Object.assign(ortho, { left: -half * asp, right: half * asp, top: half, bottom: -half }); ortho.updateProjectionMatrix();
    persp.aspect = asp; persp.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  setView(view);

  const clock = new THREE.Clock(); let time = Number(params.get('t')) || 0;
  renderer.setAnimationLoop(() => {
    const raw = clock.getDelta(), dt = Math.min(raw, 1 / 20); time += dt;
    person.update(dt, time);
    controls.update();
    if (contact.group.visible) contact.update(renderer, scene, [...statics, desk.getObjectByName('desktop') || desk, contact.group]);
    quality.render(views[view].cam, dt);
    poc.frames.push(raw * 1000); if (poc.frames.length > 240) poc.frames.shift();   // time between frames
    poc.frameMs = +(poc.frames.reduce((a, b) => a + b, 0) / poc.frames.length).toFixed(1);
    poc.phase = person.phase; poc.calls = renderer.info.render.calls; poc.triangles = renderer.info.render.triangles; poc.ready = true;
  });
}

build().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<p class="pocErr">${t('The realistic scene could not load: {error}', { error: String(e.message || e).replace(/</g, '&lt;') })}</p>`); console.error(e); });
