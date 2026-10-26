// Realistic look (Phase 3.2 proof of concept): the desk-corner pieces that are built here rather than loaded,
// in real sizes (metres) with bevelled edges and physically based materials: an office chair, a monitor, a
// keyboard, a mouse, a mug and an oak desk. Textures are CC0 from Poly Haven (see ASSETS.md).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const TEX = './assets/realistic/textures/';
const loader = new THREE.TextureLoader();
// a Poly Haven texture set (diffuse, normal, ambient occlusion / roughness / metalness) repeated every `size` metres
// (cached: every chair, desk and wall with the same set, size and colour shares one material and its textures)
const sets = new Map();
export function pbrSet(name, opts = {}) {
  const key = `${name}|${JSON.stringify(opts)}`;
  if (!sets.has(key)) sets.set(key, makeSet(name, opts));
  return sets.get(key);
}
const images = new Map();                     // one load per file; sets clone it (same image, own repeat)
function makeSet(name, { size = 1, color = 0xffffff, ...rest } = {}) {
  const tex = (kind, srgb) => {
    const file = `${TEX}${name}_${kind}.jpg`;
    if (!images.has(file)) { const e = { clones: [] }; e.tex = loader.load(file, () => e.clones.forEach((c) => { c.needsUpdate = true; })); images.set(file, e); }
    const e = images.get(file), x = e.tex.clone();
    if (e.tex.image) x.needsUpdate = true; else e.clones.push(x);       // clones made before the image arrived upload when it does
    x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.setScalar(1 / size); x.anisotropy = 8;
    return x;
  };
  const arm = tex('arm', false);
  return new THREE.MeshStandardMaterial({ map: tex('diff', true), normalMap: tex('nor_gl', false), aoMap: arm, roughnessMap: arm, metalnessMap: arm, color, ...rest });
}
// box UVs in metres (so a repeated texture keeps its real scale on any size)
function metricUv(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i), p.getZ(i)); else if (ax >= az) uv.setXY(i, p.getZ(i), p.getY(i)); else uv.setXY(i, p.getX(i), p.getY(i));
  }
  return geo;
}
export const rbox = (w, h, d, r, seg = 4) => metricUv(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
export const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };

// shared materials (no toy colours: greys, black plastic, aluminium, oak)
export const M = {
  aluminium: new THREE.MeshPhysicalMaterial({ color: 0xc9ccd0, metalness: 1, roughness: .32, anisotropy: .6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 1, roughness: .12 }),
  blackPlastic: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: .55 }),
  satinBlack: new THREE.MeshPhysicalMaterial({ color: 0x141517, roughness: .38, clearcoat: .3, clearcoatRoughness: .4 }),
  keycap: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: .7 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x26272a, metalness: .6, roughness: .45 }),           // powder-coated
  rubber: new THREE.MeshStandardMaterial({ color: 0x101010, roughness: .9 }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf1efe9, roughness: .18, clearcoat: .8, clearcoatRoughness: .1 }),
  coffee: new THREE.MeshPhysicalMaterial({ color: 0x2a160a, roughness: .05, clearcoat: 1 }),
};

// ---------- office chair (seat top at 0.48 m; origin on the floor under the gas lift; faces +z) ----------
// back: the cushion's height (lower for the chibis, so the head stays in view); fabric: its colour
export function officeChair({ back: bh = .55, fabric: fc = 0x6d7076 } = {}) {
  const g = new THREE.Group(); g.name = 'office-chair';
  const fabric = pbrSet('poly_wool_herringbone', { size: .25, color: fc });
  // five-star base with casters
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2, leg = new THREE.Group();
    const arm = mesh(rbox(.3, .035, .05, .014), M.aluminium, .16, .095, 0); arm.rotation.z = -.12;
    const fork = mesh(new THREE.CylinderGeometry(.012, .012, .04, 12), M.blackPlastic, .3, .06, 0);
    const wheel = mesh(new THREE.CylinderGeometry(.03, .03, .045, 20), M.rubber, .315, .03, 0); wheel.rotation.x = Math.PI / 2;
    leg.add(arm, fork, wheel); leg.rotation.y = a; g.add(leg);
  }
  g.add(mesh(new THREE.CylinderGeometry(.045, .05, .06, 24), M.aluminium, 0, .11, 0));                // hub
  g.add(mesh(new THREE.CylinderGeometry(.028, .028, .16, 20), M.satinBlack, 0, .2, 0));               // gas lift sleeve
  g.add(mesh(new THREE.CylinderGeometry(.02, .02, .12, 20), M.chrome, 0, .32, 0));                    // piston
  g.add(mesh(rbox(.2, .04, .22, .012), M.satinBlack, 0, .39, 0));                                      // mechanism
  // seat: a cushion on a plastic shell, a little waterfall at the front
  g.add(mesh(rbox(.5, .03, .48, .012), M.blackPlastic, 0, .425, .02));
  const seat = mesh(rbox(.5, .07, .48, .032, 6), fabric, 0, .445, .02); seat.name = 'seat'; g.add(seat);
  // back: a spine bar and a slightly reclined cushion
  const spine = mesh(rbox(.06, .36, .025, .01), M.satinBlack, 0, .55, -.25); spine.rotation.x = -.12; g.add(spine);
  const back = new THREE.Group(); back.position.set(0, .545 + bh / 2, -.29); back.rotation.x = -.14;
  back.add(mesh(rbox(.46, bh + .01, .025, .012), M.blackPlastic, 0, 0, -.03), mesh(rbox(.45, bh, .065, .03, 6), fabric, 0, 0, .01));
  g.add(back);
  // armrests on T-posts
  for (const s of [-1, 1]) {
    g.add(mesh(rbox(.035, .22, .05, .012), M.satinBlack, s * .265, .55, -.02));
    g.add(mesh(rbox(.075, .03, .25, .014), M.blackPlastic, s * .265, .67, .01));
  }
  return g;
}

// ---------- monitor (27", screen texture: an editor) ----------
export function editorTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 576;
  const x = c.getContext('2d');
  x.fillStyle = '#1e2127'; x.fillRect(0, 0, 1024, 576);
  x.fillStyle = '#252930'; x.fillRect(0, 0, 190, 576); x.fillStyle = '#2c313a'; x.fillRect(0, 0, 1024, 26);
  const cols = ['#c678dd', '#61afef', '#98c379', '#e5c07b', '#abb2bf', '#56b6c2', '#e06c75'];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) { x.fillStyle = '#5c6370'; x.fillRect(16, 44 + i * 20, 90 + rnd() * 60, 7); }
  for (let i = 0; i < 26; i++) {
    let px = 220 + (i % 7 > 2 ? 28 : 0) + (i % 11 > 7 ? 28 : 0);
    x.fillStyle = '#4b5263'; x.fillRect(200, 46 + i * 20, 10, 6);
    for (let k = 0, n = 1 + Math.floor(rnd() * 5); k < n; k++) { const w = 20 + rnd() * 110; x.fillStyle = cols[Math.floor(rnd() * cols.length)]; x.fillRect(px, 44 + i * 20, w, 8); px += w + 9; }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export function monitor() {
  const g = new THREE.Group(); g.name = 'monitor';
  const W = .615, H = .36;
  const head = new THREE.Group(); head.position.set(0, .3, 0); head.rotation.x = -.05;
  head.add(mesh(rbox(W, H, .022, .006), M.satinBlack, 0, 0, -.004));
  head.add(mesh(rbox(.32, .2, .035, .02), M.satinBlack, 0, -.02, -.028));                              // back housing
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W - .016, H - .03), new THREE.MeshPhysicalMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: editorTexture(), emissiveIntensity: 1.1, roughness: .08, clearcoat: 1, clearcoatRoughness: .05 }));
  screen.position.set(0, .006, .0075); head.add(screen);
  g.add(head);
  g.add(mesh(rbox(.05, .32, .025, .008), M.aluminium, 0, .16, -.07));                                  // neck
  g.add(mesh(rbox(.24, .012, .17, .005), M.aluminium, 0, .006, -.04));                                 // foot
  g.userData.screen = screen;
  return g;
}

// ---------- laptop (14", aluminium, lid open at ~105°; origin under the hinge centre, opens toward +z) ----------
export function laptop() {
  const g = new THREE.Group(); g.name = 'laptop';
  const W = .312, D = .221;
  g.add(mesh(rbox(W, .009, D, .004), M.aluminium, 0, .0045, D / 2));
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(.27, .1).rotateX(-Math.PI / 2), M.keycap); deck.position.set(0, .0092, .075); g.add(deck);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(.12, .075).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xb9bcc0, metalness: .8, roughness: .45 })); pad.position.set(0, .0092, .17); g.add(pad);
  const lid = new THREE.Group(); lid.position.set(0, .009, .004); lid.rotation.x = -.26;
  lid.add(mesh(rbox(W, D, .006, .004), M.aluminium, 0, D / 2, -.003));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(W - .02, D - .02), new THREE.MeshPhysicalMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: editorTexture(), emissiveIntensity: .9, roughness: .1, clearcoat: 1 }));
  scr.position.set(0, D / 2, .0005); lid.add(scr);
  g.add(lid);
  return g;
}

// ---------- a realistic laptop for the desk stations (both looks) ----------
// w: width (the proportions of a real 16" laptop follow from it); open: the lid's tilt back (radians).
// The user sits at -z: keys near the hinge (+z), the trackpad at the front, the lid at the back facing -z.
// userData.lid is the lid group and userData.screen { w, h, y, z } where the live screen plane goes (facing -z).
const glossBlack = new THREE.MeshPhysicalMaterial({ color: 0x0b0c0e, roughness: .08, clearcoat: 1, clearcoatRoughness: .04 });
const padGlass = new THREE.MeshPhysicalMaterial({ color: 0x9fa3a8, metalness: .2, roughness: .32, clearcoat: .6 });
const wellMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: .8 });
export function laptopModel({ w = .46, open = .3 } = {}) {
  const d = w * .7, t = w * .034, h = d;                                  // base depth and thickness, lid height
  const g = new THREE.Group(); g.name = 'laptop';
  g.add(mesh(rbox(w, t, d, t * .45, 4), M.aluminium, 0, t / 2, 0));
  const well = new THREE.Mesh(rbox(w * .9, t * .2, d * .44, t * .08, 2), wellMat); well.position.set(0, t - t * .06, d * .14); g.add(well);
  const cols = 14, kw = w * .86 / cols, key = new RoundedBoxGeometry(kw * .84, t * .16, kw * .8, 2, kw * .12);
  const keys = new THREE.InstancedMesh(key, M.keycap, cols * 5 + 1), m4 = new THREE.Matrix4(); let n = 0;
  for (let r = 0; r < 5; r++) for (let c = 0; c < cols; c++) { m4.makeTranslation(-w * .43 + kw * (c + .5), t + t * .05, d * .14 + d * .19 - r * kw * .95 - kw * .5); keys.setMatrixAt(n++, m4); }
  m4.compose(new THREE.Vector3(0, t + t * .05, d * .14 + d * .19 - 5 * kw * .95 - kw * .5), new THREE.Quaternion(), new THREE.Vector3(6.5, 1, 1)); keys.setMatrixAt(n++, m4);   // space bar
  keys.count = n; keys.castShadow = keys.receiveShadow = true; g.add(keys);
  g.add(mesh(rbox(w * .42, t * .08, d * .3, t * .1, 2), padGlass, 0, t + t * .01, -d * .27));    // trackpad
  const hinge = mesh(new THREE.CylinderGeometry(t * .42, t * .42, w * .78, 24), M.satinBlack, 0, t * .9, d / 2 - t * .25); hinge.rotation.z = Math.PI / 2; g.add(hinge);
  const lid = new THREE.Group(); lid.position.set(0, t * .9, d / 2 - t * .3); lid.rotation.x = open; g.add(lid);
  lid.add(mesh(rbox(w, h, t * .55, t * .25, 4), M.aluminium, 0, h / 2, t * .28));
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(w - t * .6, h - t * .6), glossBlack); bezel.rotation.y = Math.PI; bezel.position.set(0, h / 2, -.0008); lid.add(bezel);
  const cam = new THREE.Mesh(new THREE.CircleGeometry(t * .12, 16), new THREE.MeshBasicMaterial({ color: 0x1f2a36 })); cam.rotation.y = Math.PI; cam.position.set(0, h - t * .55, -.0012); lid.add(cam);
  g.userData.lid = lid;
  g.userData.screen = { w: w * .93, h: h * .84, y: h * .5 - t * .05, z: -.0016 };
  return g;
}

// ---------- keyboard and mouse ----------
export function keyboard() {
  const g = new THREE.Group(); g.name = 'keyboard';
  g.add(mesh(rbox(.36, .012, .125, .004), M.aluminium, 0, .006, 0));
  const rows = [14, 14, 13, 12, 9], cap = new RoundedBoxGeometry(.0165, .007, .0165, 2, .002);
  const keys = new THREE.InstancedMesh(cap, M.keycap, rows.reduce((a, b) => a + b, 0) + 1);
  const m = new THREE.Matrix4(); let k = 0;
  rows.forEach((n, r) => {
    const z = -.045 + r * .0215, wide = (13 - n) * .0215 / 2;
    for (let i = 0; i < n; i++) { m.makeTranslation(-.155 + wide + i * .0215 + (n === 9 && i > 2 ? .045 : 0), .0145, z); keys.setMatrixAt(k++, m); }
  });
  m.compose(new THREE.Vector3(0, .0145, .041), new THREE.Quaternion(), new THREE.Vector3(5.6, 1, 1)); keys.setMatrixAt(k++, m);   // space bar
  keys.castShadow = keys.receiveShadow = true;
  g.add(keys);
  return g;
}
export function mouse() {
  const geo = new THREE.SphereGeometry(.5, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const m = mesh(geo, M.satinBlack); m.scale.set(.062, .036, .108); m.name = 'mouse';
  return m;
}

// ---------- mug (lathe profile with a wall thickness, a handle, coffee) ----------
export function mug() {
  const g = new THREE.Group(); g.name = 'mug';
  const r = .041, h = .095, t = .004;
  const prof = [[0, 0], [r - .006, 0], [r, .006], [r, h - .002], [r - t / 2, h], [r - t, h - .002], [r - t, .01], [0, .01]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(mesh(new THREE.LatheGeometry(prof, 48), M.ceramic));
  const handle = mesh(new THREE.TorusGeometry(.024, .006, 12, 32, Math.PI * 1.15), M.ceramic, r + .004, h / 2, 0); handle.rotation.z = -Math.PI * .575; g.add(handle);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(r - t, 40), M.coffee); coffee.rotation.x = -Math.PI / 2; coffee.position.y = h - .018; g.add(coffee);
  return g;
}

// ---------- oak desk (1.6 x 0.8 m top at 0.75 m, black steel T-legs; origin on the floor, front edge at +z) ----------
export function oakDesk({ w = 1.6, d = .8, h = .75, tint = 0xffffff } = {}) {
  const g = new THREE.Group(); g.name = 'oak-desk';
  const oak = pbrSet('oak_veneer_01', { size: 1.2, color: tint });
  const top = mesh(rbox(w, .028, d, .006), oak, 0, h - .014, 0); top.name = 'desktop'; g.add(top);
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - .09);
    g.add(mesh(rbox(.05, h - .07, .05, .006), M.steel, x, (h - .07) / 2 + .02, 0));
    g.add(mesh(rbox(.06, .03, d - .06, .008), M.steel, x, .015, 0));                                    // foot
    g.add(mesh(rbox(.06, .025, d - .1, .006), M.steel, x, h - .04, 0));                                 // top bracket
  }
  g.add(mesh(rbox(w - .24, .07, .025, .006), M.steel, 0, h - .07, -d / 2 + .12));                       // modesty rail
  g.userData.height = h;
  return g;
}
