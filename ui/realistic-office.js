// Realistic look of the office (Phase 3.2 step 1b, ?look=realistic): the same isometric office, layout and chibis,
// with realistic furniture and props: PBR wood floor and plaster walls, aluminium windows, an oak desk with an office
// chair, monitors and keyboards per station, and the devices (sofa, plants, TV cabinet from Poly Haven; whiteboard,
// server rack, pantry, rug, beanbags, ping-pong, floor lamp and the meeting table built here). Sizes follow the
// chibi scale of each place (the stations are 1.3x), materials follow real ones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pbrSet, officeChair, oakDesk, keyboard, mouse, mug, M, rbox, mesh, laptopModel } from './realistic-props.js';

// ---------- the Poly Haven models (one GLB, loaded once) ----------
const lib = new Map();
let state = 'idle';
export const officeStamp = () => state;          // part of a Floor's signature: rebuilt once the models arrive
export function loadOffice(onReady) {
  if (state !== 'idle') return;
  state = 'loading';
  new GLTFLoader().load('./assets/realistic/office-props.glb', (g) => {
    for (const root of [...g.scene.children]) {
      root.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      root.updateMatrixWorld(true);
      lib.set(root.name, { obj: root, box: new THREE.Box3().setFromObject(root) });
    }
    state = 'ready'; onReady?.();
  }, undefined, () => { state = 'failed'; });
}
// a clone fitted to a size (uniform scale), base on the floor, centred
function model(name, { w, h, d }) {
  const m = lib.get(name);
  if (!m) return null;
  const size = m.box.getSize(new THREE.Vector3()), c = m.box.getCenter(new THREE.Vector3());
  const k = Math.min(...[w && w / size.x, h && h / size.y, d && d / size.z].filter(Boolean));
  const inner = m.obj.clone(true); inner.position.set(-c.x, -m.box.min.y, -c.z);
  const g = new THREE.Group(); g.add(inner); g.scale.setScalar(k);
  return g;
}

const mat = {
  white: new THREE.MeshPhysicalMaterial({ color: 0xf3f1ec, roughness: .35, clearcoat: .2 }),          // lacquered cabinet
  board: new THREE.MeshPhysicalMaterial({ color: 0xfbfbf9, roughness: .12, clearcoat: 1, clearcoatRoughness: .05 }),
  paper: (c) => new THREE.MeshStandardMaterial({ color: c, roughness: .9 }),
  stone: new THREE.MeshPhysicalMaterial({ color: 0xd9d6d0, roughness: .25, clearcoat: .6 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xdfeef5, roughness: .05, transmission: .85, thickness: .02, ior: 1.5, transparent: true, opacity: .55 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: .7, roughness: .4 }),
  shade: new THREE.MeshPhysicalMaterial({ color: 0xf6eedf, roughness: .9, sheen: .6, sheenColor: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: .35, side: THREE.DoubleSide }),
};
const fabric = (color, size = .3) => pbrSet('poly_wool_herringbone', { size, color });

// ---------- the room: floor, walls, baseboards, windows ----------
export function realRoom(g, { FW, FD, FH, TOP, missing, windows }) {
  const slab = mesh(rbox(FW + .5, .3, FD + .5, .02), new THREE.MeshStandardMaterial({ color: 0xd9d3c8, roughness: .8 }), 0, .15, 0); g.add(slab);
  const floor = mesh(rbox(FW, .06, FD, .005, 1), missing ? new THREE.MeshStandardMaterial({ color: 0xcfc8bb }) : pbrSet('laminate_floor_02', { size: 1.7 }), 0, TOP - .03, 0); g.add(floor);
  const plaster = pbrSet('beige_wall_001', { size: 1.5, color: 0xffffff });
  g.add(mesh(rbox(FW + .3, FH, .3, .01, 1), plaster, -.15, TOP + FH / 2, -FD / 2 - .15), mesh(rbox(.3, FH, FD, .01, 1), plaster, -FW / 2 - .15, TOP + FH / 2, 0));
  const base = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: .45 });
  g.add(mesh(rbox(FW, .14, .03, .008), base, 0, TOP + .07, -FD / 2 + .015), mesh(rbox(.03, .14, FD, .008), base, -FW / 2 + .015, TOP + .07, 0));
  for (const z of windows) {                                         // tall windows with thin aluminium frames
    const w = new THREE.Group(); w.position.set(-FW / 2 + .03, TOP + 2.05, z); g.add(w);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.7), mat.glass); pane.rotation.y = Math.PI / 2; pane.position.x = .01; w.add(pane);
    for (const y of [-.87, .87]) w.add(mesh(rbox(.07, .05, 2.9, .01), mat.frame, .02, y, 0));
    for (const zz of [-1.42, 0, 1.42]) w.add(mesh(rbox(.07, 1.75, .05, .01), mat.frame, .02, 0, zz));
    w.add(mesh(rbox(.16, .03, 2.95, .008), base, .07, -.9, 0));      // sill
  }
}

// ---------- a station (station units: x1.3 in the room) ----------
export function realDesk(g, lead) {
  const d = oakDesk({ w: 1.6, d: .8, h: .955, tint: lead ? 0x9a7a62 : 0xffffff }); d.position.z = .62; g.add(d);
  const c = officeChair({ back: .42, fabric: lead ? 0x4b4f57 : 0x6d7076 }); c.scale.setScalar(1.29); c.position.z = -.04; g.add(c);
}
// a monitor's housing around a screen plane that faces the chair (-z): bezel, back, neck and foot on the desk
export function realMonitor(grp, w, h, deskTop, centreY) {
  grp.add(mesh(rbox(w, h, .028, .008), M.satinBlack, 0, 0, 0));
  grp.add(mesh(rbox(w * .5, h * .55, .04, .02), M.satinBlack, 0, -h * .05, .03));
  const neckH = centreY - deskTop;
  grp.add(mesh(rbox(.06, neckH, .03, .008), M.aluminium, 0, -neckH / 2, .06));
  const foot = mesh(rbox(.26, .012, .2, .005), M.aluminium, 0, -neckH + .006, .04); grp.add(foot);
}
// keyboard, mouse and a mug in the agent's colour, real materials (dual: a separate keyboard; laptop: its own keys)
export function realDeskProps(g, top, dual, mugColor) {
  if (dual) { const k = keyboard(); k.scale.setScalar(1.33); k.rotation.y = Math.PI; k.position.set(0, top, .45); g.add(k); }
  g.add(mesh(rbox(.3, .004, .24, .002), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: .95 }), -.48, top + .002, .45));
  const ms = mouse(); ms.scale.multiplyScalar(1.3); ms.position.set(-.48, top + .004, .45); ms.rotation.y = Math.PI; g.add(ms);
  const cup = mug(); cup.scale.setScalar(1.35); cup.position.set(.56, top, .42); cup.rotation.y = Math.PI / 2;
  cup.children[0].material = cup.children[1].material = new THREE.MeshPhysicalMaterial({ color: mugColor, roughness: .2, clearcoat: .8, clearcoatRoughness: .1 });
  g.add(cup);
}

// ---------- devices (floor units) ----------
const NOTES = [0xfde68a, 0xfbcfe8, 0xbbf7d0, 0xbfdbfe, 0xfed7aa];
export const REAL_DEVICES = {
  plant: (g) => { const m = model('potted_plant_02', { h: 1.35 }); if (m) g.add(m); return m; },
  sofa(g) {                                                          // a modern three-seater: fabric cushions, black legs
    const f = fabric(0x7b8794, .3);
    g.add(mesh(rbox(2.7, .22, .95, .05, 5), f, 0, .3, 0));                                    // base
    g.add(mesh(rbox(2.7, .5, .24, .09, 6), f, 0, .62, -.36));                                 // back
    for (const x of [-1.25, 1.25]) g.add(mesh(rbox(.2, .4, .95, .08, 6), f, x, .52, 0));      // arms
    for (const x of [-.7, 0, .7]) g.add(mesh(rbox(.7, .16, .72, .07, 6), f, x, .48, .08));     // seat cushions
    for (const x of [-.75, .75]) { const c = mesh(rbox(.95, .42, .18, .08, 6), f, x, .7, -.2); c.rotation.x = -.18; g.add(c); }
    for (const [x, z] of [[-1.25, -.4], [1.25, -.4], [-1.25, .4], [1.25, .4]]) g.add(mesh(new THREE.CylinderGeometry(.02, .015, .19, 12), M.steel, x, .095, z));
    return g;
  },
  tv(g) {
    const cab = model('modern_wooden_cabinet', { w: 2.2 }); if (!cab) return null;
    g.add(cab);
    const top = new THREE.Box3().setFromObject(cab).max.y;
    const tv = new THREE.Group(); tv.position.set(0, top + .7, -.05); g.add(tv);
    tv.add(mesh(rbox(1.9, 1.08, .035, .01), M.satinBlack));
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 1.04), new THREE.MeshPhysicalMaterial({ color: 0x05070a, emissive: 0x1d3550, emissiveIntensity: .5, roughness: .05, clearcoat: 1 })); sc.position.z = .018; tv.add(sc);
    g.add(mesh(rbox(.3, .02, .2, .005), M.aluminium, 0, top + .01, -.05), mesh(rbox(.06, .14, .03, .006), M.aluminium, 0, top + .08, -.09));
    return g;
  },
  rug(g) {
    const r = mesh(rbox(4.2, .025, 3.2, .012, 2), fabric(0xc9b49c, .35), 0, .0125, 0); r.castShadow = false; g.add(r);
    return g;
  },
  beanbag(g) {
    const colors = [0xc98b3a, 0x4f8f73, 0xb4574c, 0x6d5aa8];
    const c = colors[Math.abs([...String(g.userData.device || '')].reduce((n, ch) => n + ch.charCodeAt(0), 0)) % colors.length];
    const geo = new THREE.SphereGeometry(.7, 48, 32), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, y < 0 ? y * .45 : y * .62 - Math.max(0, y - .3) * .25); }   // slumped, flat bottom
    geo.computeVertexNormals();
    const b = mesh(geo, new THREE.MeshPhysicalMaterial({ color: c, roughness: .9, sheen: .8, sheenColor: new THREE.Color(c).lerp(new THREE.Color(0xffffff), .3), sheenRoughness: .5 }), 0, .32, 0); g.add(b);
    return g;
  },
  pingpong(g) {
    const blue = new THREE.MeshPhysicalMaterial({ color: 0x1d3f6e, roughness: .55, clearcoat: .2 });
    g.add(mesh(rbox(2.74, .03, 1.525, .006), blue, 0, .76, 0));
    const line = new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: .6 });
    g.add(mesh(rbox(2.74, .003, .02, .001), line, 0, .777, 0), mesh(rbox(.02, .003, 1.525, .001), line, -1.36, .777, 0), mesh(rbox(.02, .003, 1.525, .001), line, 1.36, .777, 0));
    for (const z of [-.752, .752]) g.add(mesh(rbox(2.74, .003, .02, .001), line, 0, .777, z));
    const net = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .15), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: .9, transparent: true, opacity: .55, side: THREE.DoubleSide }));
    net.rotation.y = Math.PI / 2; net.position.set(0, .85, 0); g.add(net);
    for (const [x, z] of [[-1.15, -.6], [1.15, -.6], [-1.15, .6], [1.15, .6]]) g.add(mesh(rbox(.05, .74, .05, .01), M.steel, x, .37, z));
    for (const s of [-1, 1]) { const p = mesh(new THREE.CylinderGeometry(.08, .08, .012, 32), new THREE.MeshPhysicalMaterial({ color: 0xa61b1b, roughness: .7 }), s * .95, .785, .3 * s); g.add(p); }
    return g;
  },
  lamp(g) {
    g.add(mesh(new THREE.CylinderGeometry(.2, .22, .025, 48), M.steel, 0, .0125, 0));
    g.add(mesh(new THREE.CylinderGeometry(.012, .012, 1.62, 16), M.aluminium, 0, .83, 0));
    g.add(mesh(new THREE.CylinderGeometry(.2, .28, .34, 48, 1, true), mat.shade, 0, 1.8, 0));
    return g;
  },
  whiteboard(g, d, FD) {
    const onWall = d && d.z < -FD / 2 + .9, y = onWall ? 2.05 : 1.45;
    if (!onWall) for (const x of [-1.1, 1.1]) g.add(mesh(rbox(.05, 1.6, .05, .01), M.aluminium, x, .8, 0));
    g.add(mesh(rbox(2.8, 1.5, .03, .01), mat.board, 0, y, 0));
    for (const yy of [-.76, .76]) g.add(mesh(rbox(2.84, .03, .04, .008), M.aluminium, 0, y + yy, .005));
    for (const s of [-1, 1]) g.add(mesh(rbox(.03, 1.55, .04, .008), M.aluminium, s * 1.41, y, .005));
    g.add(mesh(rbox(2.4, .025, .08, .006), M.aluminium, 0, y - .8, .04));              // marker tray
    for (let i = 0; i < 12; i++) { const n = mesh(rbox(.26, .26, .004, .002), mat.paper(NOTES[i % NOTES.length]), -1.1 + (i % 6) * .44, y + .4 - Math.floor(i / 6) * .45, .02); n.rotation.z = ((i * 37) % 7 - 3) * .02; g.add(n); }
    for (const [w, c, yy] of [[1.1, 0x2563eb, -.35], [.7, 0xdc2626, -.52]]) g.add(mesh(rbox(w, .012, .002, .001), new THREE.MeshBasicMaterial({ color: c }), -1.15 + w / 2, y + yy, .018));
    return g;
  },
  'server-rack'(g) {
    const steel = new THREE.MeshPhysicalMaterial({ color: 0x1c1e22, metalness: .6, roughness: .45, clearcoat: .2 });
    g.add(mesh(rbox(.8, 2, .8, .015), steel, 0, 1, 0));
    g.add(mesh(rbox(.74, 1.9, .015, .006), new THREE.MeshStandardMaterial({ color: 0x0d0f12, metalness: .5, roughness: .6 }), 0, 1, .405));   // perforated door look
    g.userData.rack = true; g.userData.leds = [];
    for (let i = 0; i < 7; i++) {
      for (const x of [-.17, .17]) {                                  // CPU on the left, RAM on the right (setLoad)
        const led = mesh(rbox(.3, .12, .01, .004), new THREE.MeshBasicMaterial({ color: '#3a4058', toneMapped: false }), x, .35 + i * .23, .415);
        g.add(led); g.userData.leds.push({ row: i, col: x < 0 ? 'cpu' : 'mem', mesh: led });
      }
      g.add(mesh(rbox(.035, .035, .01, .005), new THREE.MeshBasicMaterial({ color: '#4fc38a', toneMapped: false }), .33, .35 + i * .23, .418));
    }
    return g;
  },
  pantry(g) {
    const oak = pbrSet('oak_veneer_01', { size: 1.2 });
    g.add(mesh(rbox(3.4, .98, .62, .01), mat.white, 0, .55, -.05));
    g.add(mesh(rbox(3.4, .08, .66, .006), M.steel, 0, .04, -.07));                       // plinth
    for (const x of [-1.13, 0, 1.13]) { g.add(mesh(rbox(1.1, .94, .02, .006), mat.white, x, .55, .27)); g.add(mesh(rbox(.24, .015, .02, .006), M.aluminium, x, .95, .29)); }
    g.add(mesh(rbox(3.48, .045, .7, .006), oak, 0, 1.065, -.04));                          // oak worktop
    const cm = new THREE.Group(); cm.position.set(-1.1, 1.09, -.12); g.add(cm);               // espresso machine
    cm.add(mesh(rbox(.42, .46, .38, .03), M.aluminium, 0, .23, 0), mesh(rbox(.3, .05, .2, .01), M.satinBlack, 0, .02, .14), mesh(rbox(.36, .06, .3, .02), M.satinBlack, 0, .49, 0));
    [0xffffff, 0x2f3a4a, 0xc2410c].forEach((c, i) => { const m = mug(); m.position.set(.25 + i * .25, 1.09, .08); m.rotation.y = -1; m.children[0].material = m.children[1].material = new THREE.MeshPhysicalMaterial({ color: c, roughness: .2, clearcoat: .8 }); g.add(m); });
    g.add(mesh(rbox(.6, .35, .35, .04), new THREE.MeshPhysicalMaterial({ color: 0x8b5e3c, roughness: .6 }), 1.2, 1.26, -.12));   // bread box
    return g;
  },
  'meeting-table'(g, d, FD, seats) {
    const oak = pbrSet('oak_veneer_01', { size: 1.4, color: 0xb08a6a });
    const shape = new THREE.Shape(); shape.absellipse(0, 0, 1.31, .79, 0, Math.PI * 2);
    const top = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .05, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 4, curveSegments: 64 }).rotateX(-Math.PI / 2), oak);
    top.position.y = .73; top.castShadow = top.receiveShadow = true;
    g.add(top);
    g.add(mesh(new THREE.CylinderGeometry(.09, .12, .7, 32), M.steel, 0, .37, 0), mesh(new THREE.CylinderGeometry(.5, .5, .025, 48), M.steel, 0, .013, 0));
    g.add(mesh(rbox(.42, .02, .3, .006), mat.paper(0xf4f1ea), -.3, .815, .05));
    const lap = laptopModel({ w: .34 }); lap.position.set(.45, .785, -.3); lap.rotation.y = Math.PI; g.add(lap);
    for (const s of seats) { const c = officeChair({ back: .42 }); c.scale.setScalar(1.06); c.position.set(s.x, 0, s.z); c.rotation.y = s.face; g.add(c); }
    return g;
  },
};
