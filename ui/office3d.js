// SPDX-License-Identifier: Apache-2.0
// The Office in 3D (1.1.0): the whole company on one floor, drawn by the 3D Scene from the same plan as the Iso Pixel
// Office (scene-model.js officeLayout, office-plan.js). Each Space is a room with a low wall and glass, a name plate
// in its accent colour and one door; the Server room (racks with RAM / CPU bars), the Lobby (the queue), the shared
// meeting room, the pantry and the Owner's room as in the Iso Office.
// Light by design: far away every agent is one instance of a low-poly chibi (body, head, hair: three instanced
// meshes for the whole Office) at merged low-poly desks, with a blob shadow and no shadow map; zoomed into one room,
// that room alone gets the full desks and chibis (no live screens). It draws only when something changes or moves;
// walking agents are updated a few per frame. Rooms of a removed Space are disposed.
// kit: helpers of ui/scene.js (passed in, so this file does not import scene.js): { THREE, box, mat, basic, label,
// buildStation, updateStation, poseDesk, buildDevice, deskHome, TOP, inkOn, floorLabelHtml }
import { officeLayout } from './scene-model.js';
import { officePlan, officeNav, wallsOf, trips, lodFor, roomDiff, roomAtPoint, deskStand, doorPoints, LOW_WALL, GLASS_TOP, WALL_T } from './office-plan.js';
import { t as tt } from './i18n.js';
import { easeMs } from './motion.js';

const FILL = { department: '#efe2c6', project: '#e3e9f0', server: '#d8dde4', lobby: '#f1e7d6', meeting: '#e6ebdf', pantry: '#f3e8da', owner: '#e9e1ef' };
const RING = { working: '#16a34a', waiting: '#dc2626', idle: '#d97706', stopped: '#9ca3af' };
const QUEUE_LOOKS = ['#3d82d6', '#e2574c', '#16a34a', '#d97706', '#7c5cd6', '#0ea5a4', '#db2777', '#64748b'];
const WALK = 1.4, WALKERS_PER_FRAME = 12, MAX_AGENTS = 400;

export class Office3D {
  constructor(scene, kit) {
    const { THREE } = kit;
    Object.assign(this, { s: scene, kit, THREE, rooms: new Map(), agents: [], byKey: new Map(), focus: null, near: null, key: '', walkers: new Map(), anims: [] });
    this.g = new THREE.Group(); this.g.visible = false; scene.scene.add(this.g);
    // the floor slab and the instanced agents (far detail): body, head, hair, blob shadow, state ring
    this.slab = new THREE.Group(); this.g.add(this.slab);
    const inst = (geo, material) => { const m = new THREE.InstancedMesh(geo, material, MAX_AGENTS); m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.g.add(m); return m; };
    const lit = (o = {}) => new THREE.MeshStandardMaterial({ roughness: .8, ...o });
    // chibi proportions at the stations' scale: the big head shows above the desk
    this.body = inst(new THREE.CapsuleGeometry(.3, .42, 3, 10), lit());
    this.head = inst(new THREE.SphereGeometry(.42, 14, 10), lit());
    this.hair = inst(new THREE.SphereGeometry(.44, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), lit());
    this.blob = inst(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: blobTexture(THREE), transparent: true, opacity: .32, depthWrite: false }));
    this.ring = inst(new THREE.RingGeometry(.9, 1.02, 32), new THREE.MeshBasicMaterial({ transparent: true, opacity: .6, depthWrite: false }));
    for (const m of [this.body, this.head, this.hair]) m.castShadow = false;
    this.q = new THREE.Object3D(); this.c = new THREE.Color();
    this.tip = Object.assign(document.createElement('div'), { className: 'officeTip', hidden: true });
    scene.container.appendChild(this.tip);
  }

  // ---------- data ----------
  update(floors, company = {}) {
    this.company = company;
    const spaces = (floors || []).filter((f) => !f.missing);                 // the same rooms as the Iso Office (independents included)
    this.floors = new Map(spaces.map((f) => [f.id, f]));
    const key = JSON.stringify(spaces.map((f) => [f.id, f.kind, f.number, f.name, f.accent, (f.agents || []).map((a) => [a.id, a.appearance, a.lead])]));
    if (key !== this.key) {
      this.key = key;
      const layout = officeLayout(spaces.map((f) => ({ id: f.id, name: f.name, number: f.number, kind: f.kind || 'project', agents: f.agents || [] })));
      const diff = this.plan ? roomDiff(this.plan.rooms, layout.rooms) : { added: layout.rooms.map((r) => r.id), removed: [], moved: [] };
      this.plan = officePlan(layout); this.nav = null; this.s.dirty = true;     // the grid is built when someone walks
      this.buildSlab();
      const next = new Map(this.plan.rooms.map((r) => [r.id, r]));
      for (const id of diff.removed) this.removeRoom(id);
      for (const [id, r] of next) {
        const o = this.rooms.get(id), sig = roomSig(r, this.floors.get(id));
        if (o && o.sig === sig) { o.r = r; continue; }
        if (o) this.disposeRoom(o);
        this.rooms.set(id, this.buildRoom(r, sig, diff.added.includes(id) && this.shown));
      }
      if (this.near && !next.has(this.near.room)) this.setNear(null);
      else if (this.near) { const room = this.near.room; this.setNear(null); this.setNear(room); }
    }
    this.placeAgents();
    for (const o of this.rooms.values()) this.updatePlate(o);
    this.updateRacks();
  }

  buildSlab() {
    const { THREE, box, mat } = this.kit, p = this.plan;
    this.dispose3(this.slab); this.slab.clear();
    box(p.w + 1.6, .3, p.d + 1.6, mat('#e7dfd1'), 0, .15, 0, this.slab, .02);
    box(p.w + 1.2, .06, p.d + 1.2, mat('#d9cdb8'), 0, .33, 0, this.slab, 0);                // corridor carpet
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(p.w + 1.2, p.d + 1.2), new THREE.MeshBasicMaterial({ visible: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = this.kit.TOP; floor.userData.officeFloor = true; this.slab.add(floor);
    this.hitFloor = floor;
  }

  // one room: floor tile, low walls with glass on top (a gap at the door), its furniture (low-poly desks far away)
  buildRoom(r, sig, grow) {
    const { THREE, box, mat, basic, label, buildDevice, TOP } = this.kit;
    const g = new THREE.Group(); g.userData.officeRoom = r.id;
    const f = this.floors.get(r.id), accent = f?.accent || '#b7852a';
    box(r.w - .04, .05, r.d - .04, mat(FILL[r.kind] || '#e5e7eb'), r.x + r.w / 2, TOP + .005, r.z + r.d / 2, g, 0);
    const wall = mat('#f4efe6'), rail = mat('#2f3a4a');
    const glass = new THREE.MeshStandardMaterial({ color: '#cfe8f5', transparent: true, opacity: .2, roughness: .05, depthWrite: false });
    for (const w of wallsOf(r)) {
      const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0), along = w.z0 === w.z1, cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
      const [sx, sz] = along ? [len, WALL_T] : [WALL_T, len];
      box(sx, LOW_WALL, sz, wall, cx, TOP + LOW_WALL / 2, cz, g, 0);
      const pane = box(along ? len : .03, GLASS_TOP - LOW_WALL, along ? .03 : len, glass, cx, TOP + (LOW_WALL + GLASS_TOP) / 2, cz, g, 0);
      pane.castShadow = false; pane.renderOrder = 2;
      box(along ? len : .05, .04, along ? .05 : len, rail, cx, TOP + GLASS_TOP, cz, g, 0);
    }
    // the accent stripe on the front of the room and the door's threshold
    box(r.w, .03, .1, basic(accent), r.x + r.w / 2, TOP + LOW_WALL + .02, r.z + r.d + .07, g, 0);
    box(r.door.w, .02, .3, mat('#c9b48f'), r.door.x, TOP + .01, r.door.z, g, 0);
    // the low-poly desks: one merged group, hidden while the room is drawn in full detail
    const desks = new THREE.Group();
    for (const d of r.desks) lowDesk(this.kit, desks, d, r.kind === 'owner' || (f?.agents || []).find((a) => a.id === d.agentId)?.lead);
    this.kit.mergeStatic(desks);
    Object.assign(desks.userData, { lowDesk: true, keep: true }); desks.visible = this.near?.room !== r.id; g.add(desks);
    const devices = [];
    for (const d of r.devices) { const dg = buildDevice(d); dg.userData.keep = true; g.add(dg); devices.push(dg); }
    if (r.kind === 'server') {
      // RAM and CPU as two bars beside the racks
      this.bars = ['ram', 'cpu'].map((k, i) => { const b = box(.28, 1, .28, basic('#16a34a'), r.x + r.w / 2 - .4 + i * .8, TOP, r.z + 2.6, g, 0); Object.assign(b.userData, { bar: k, keep: true }); return b; });
      box(1.2, .06, .5, mat('#2f3a4a'), r.x + r.w / 2, TOP + .03, r.z + 2.6, g, 0);
    }
    this.kit.mergeStatic(g);                                                    // walls, glass, floor: one mesh per material
    const plate = label('', `flabel officeRoom ${r.kind}`, g, r.x + .3, TOP + GLASS_TOP + .45, r.z + .1);
    plate.center.set(0, 1); plate.visible = !!this.shown;
    plate.element.style.pointerEvents = 'auto';
    plate.element.addEventListener('click', () => this.clickRoom(r.id));
    if (f) plate.element.style.setProperty('--c', accent);
    this.g.add(g);
    const o = { r, g, sig, plate, devices };
    if (grow) this.animate(g, 0, 1);
    return o;
  }
  updatePlate(o) {
    const { r } = o, f = this.floors.get(r.id), c = this.company || {}, esc = escHtml;
    const html = f ? `${this.kit.floorLabelHtml(f)}`
      : r.kind === 'lobby' ? `<b>${tt('Lobby')}</b> <span class="${c.queued ? 'q' : 'm'}">${tt('{n} queued', { n: c.queued || 0 })}</span>`
      : r.kind === 'owner' ? `<b>${tt('Owner')}</b> <span class="${c.attention ? 'q' : 'm'}">${tt('{n} waiting for you', { n: c.attention || 0 })}</span>`
      : r.kind === 'meeting' ? `<b>${tt('Meeting room')}</b>` : r.kind === 'pantry' ? `<b>${tt('Pantry')}</b>`
      : `<b>${tt('Server room')}</b> <span class="m">${esc(c.limits ? tt('{n} agents', { n: `${c.limits.running}/${c.limits.maxAgents}` }) : '')}</span>`;
    if (o.plate.element._html !== html) { o.plate.element.innerHTML = html; o.plate.element._html = html; }
  }
  removeRoom(id) {
    const o = this.rooms.get(id);
    if (!o) return;
    this.rooms.delete(id);
    if (!this.shown) return this.disposeRoom(o);
    this.animate(o.g, 1, 0, () => this.disposeRoom(o));                                      // shrinks away, then gone
  }
  disposeRoom(o) { o.plate.element.remove(); this.g.remove(o.g); this.dispose3(o.g); }
  dispose3(root) {
    root.traverse((x) => { if (x.userData.kit) return; x.geometry?.dispose?.(); if (x.material && !x.material.userData?.shared) [].concat(x.material).forEach((m) => m.dispose?.()); });
  }
  animate(g, from, to, done) { g.scale.y = from || .001; this.anims.push({ g, from, to, start: performance.now(), ms: Math.max(1, easeMs(450)), done }); }

  // ---------- agents (far: instances; near: full stations of one room) ----------
  placeAgents() {
    const list = [];
    for (const r of this.plan.rooms) {
      const f = this.floors.get(r.id);
      for (const d of r.desks) {
        const a = (f?.agents || []).find((x) => x.id === d.agentId);
        if (a) list.push({ key: `${r.id}/${a.id}`, floorId: r.id, a, desk: d, room: r });
      }
    }
    // the Lobby's queue: plain people waiting in line
    const lobby = this.plan.rooms.find((r) => r.kind === 'lobby');
    for (let i = 0; i < Math.min(8, this.company?.queued || 0); i++) list.push({ key: `queue/${i}`, queue: true, a: { state: 'idle', appearance: { shirt: QUEUE_LOOKS[i % 8] } }, desk: { x: lobby.x + 1.2 + i * .85, z: lobby.z + 3.2, ry: 0 }, room: lobby });
    const old = this.byKey;
    this.agents = list; this.byKey = new Map(list.map((x) => [x.key, x]));
    // a new snapshot keeps where everyone is and who is walking
    for (const x of list) { const prev = old.get(x.key); x.pos = prev?.pos || { x: x.desk.x, z: x.desk.z }; x.labelEl = prev?.labelEl; x.walking = prev?.walking; x.away = prev?.away; x.sayUntil = prev?.sayUntil; }
    for (const [k, x] of old) if (!this.byKey.has(k)) x.labelEl?.remove();
    for (const x of list) if (!x.queue) this.labelFor(x);
    this.writeInstances();
    if (this.near) for (const x of list) { const st = this.near.stations.get(x.key); if (st) this.kit.updateStation(st, x.a); }
  }
  labelFor(x) {
    if (!x.labelEl) {
      x.labelEl = Object.assign(document.createElement('div'), { className: 'nlabel officeAgent', innerHTML: '<span class="q" aria-hidden="true">?</span><span class="n"></span><div class="say"></div>' });
      const n = x.labelEl.querySelector('.n');
      n.style.pointerEvents = 'auto'; n.style.cursor = 'pointer';
      n.addEventListener('click', () => this.s.handlers.onPickAgent?.(x.floorId, x.a.id));
      this.s.labels.domElement.appendChild(x.labelEl);
    }
    const name = String(x.a.displayName || '').split(' - ')[0], color = x.a.appearance?.shirt || '#3d82d6', n = x.labelEl.querySelector('.n');
    if (n.textContent !== name) { n.textContent = name; Object.assign(n.style, { background: color, color: this.kit.inkOn(color) }); }
    x.labelEl.className = `nlabel officeAgent ${x.a.state || 'stopped'}`;
  }
  writeInstances() {
    const { q, c } = this, near = this.near?.room;
    // a poll that changes nothing on the floor asks for no frame (render on demand)
    const sig = JSON.stringify([near, this.agents.map((x) => [x.key, x.pos.x, x.pos.z, x.walking, x.away, x.a.state, x.a.appearance])]);
    if (sig === this.instSig) return;
    this.instSig = sig;
    let k = 0;
    for (const x of this.agents) {
      const hide = near && x.room.id === near && !x.walking;                    // drawn in full detail instead
      const look = { skin: '#f6d2b0', hair: '#2b2440', shirt: '#3d82d6', ...(x.a.appearance || {}) };
      const seated = !x.walking && !x.away;
      const y = this.kit.TOP + (seated ? .95 : 1.05), s = hide ? 0 : 1;
      const set = (m, dy, color, sc = 1, flat = false) => {
        q.position.set(x.pos.x, flat ? this.kit.TOP + .015 : y + dy, x.pos.z); q.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0); q.scale.setScalar(s * sc); q.updateMatrix();
        m.setMatrixAt(k, q.matrix); if (color) m.setColorAt(k, c.set(color));
      };
      set(this.body, 0, look.shirt); set(this.head, .78, look.skin); set(this.hair, .84, look.hair);
      set(this.blob, 0, null, 1, true);
      set(this.ring, 0, x.queue ? '#000000' : RING[x.a.state] || RING.stopped, x.queue || x.walking ? 0 : 1, true);
      k++;
      if (k >= MAX_AGENTS) break;
    }
    for (const m of [this.body, this.head, this.hair, this.blob, this.ring]) { m.count = k; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.s.dirty = true;
  }

  // near detail: the full desks and chibis of one room (built on zoom-in, disposed on zoom-out)
  setNear(roomId) {
    if ((this.near?.room || null) === roomId) return;
    if (this.near) { this.g.remove(this.near.g); this.dispose3(this.near.g); for (const st of this.near.stations.values()) st.label?.element.remove(); this.near = null; }
    if (roomId) {
      const o = this.rooms.get(roomId), f = this.floors.get(roomId);
      if (o && f) {
        const g = new this.THREE.Group(), stations = new Map();
        for (const d of o.r.desks) {
          const a = (f.agents || []).find((x) => x.id === d.agentId);
          if (!a) continue;
          const saved = (f.desks || []).find((x) => x.agent === a.id);
          const st = this.kit.buildStation(a, { x: d.x, z: d.z, ry: 0, device: saved?.device || 'laptop' }, f.accent || '#7c5cd6');
          for (const S of st.screens) S.mesh.visible = true;
          st.label.visible = false; st.say.visible = false;
          g.add(st.g, st.human); stations.set(`${roomId}/${a.id}`, st);
        }
        this.g.add(g);
        this.near = { room: roomId, g, stations };
      }
    }
    // the room in full detail: its low-poly desks give way to the real ones
    for (const o of this.rooms.values()) for (const m of o.g.children) if (m.userData.lowDesk) m.visible = o.r.id !== this.near?.room;
    this.writeInstances();
  }

  // ---------- walking between rooms (meetings in the shared room, handoffs) ----------
  updateTrips(now = Date.now()) {
    const want = trips(this.plan, [...this.floors.values()], this.company?.walks || [], now);
    const keys = new Set(want.map((w) => w.key));
    if (want.length && !this.nav) this.nav = officeNav(this.plan);                // ~25 ms, once per plan
    for (const w of want) {
      const x = this.byKey.get(w.key);
      const cur = this.walkers.get(w.key);
      if (!x || (cur && !cur.back && cur.trip.kind === w.kind && cur.trip.to.x === w.to.x && cur.trip.to.z === w.to.z)) continue;
      const from = x.walking || x.away ? x.pos : deskStand(this.nav, x.desk);
      const path = this.nav.path(from, w.to);
      if (!path) continue;
      if (!x.away) x.pos = { ...from };                                          // gets up behind its chair
      this.walkers.set(w.key, { trip: w, path, back: false }); x.walking = true; x.away = true;
    }
    for (const [k, wk] of this.walkers) if (!keys.has(k) && !wk.back) {
      const x = this.byKey.get(k);
      if (!x) { this.walkers.delete(k); continue; }
      const home = deskStand(this.nav, x.desk);
      wk.back = true; wk.path = this.nav.path(x.pos, home) || [home]; x.walking = true;
    }
  }
  stepWalkers(dt) {
    if (!this.walkers.size) return false;
    const list = [...this.walkers.entries()];
    // a few walkers per frame (round robin): many walking agents never cost more than WALKERS_PER_FRAME updates
    const n = Math.min(list.length, WALKERS_PER_FRAME), start = (this.walkCursor || 0) % list.length;
    this.walkCursor = start + n;
    let moving = false;
    for (let i = 0; i < n; i++) {
      const [k, wk] = list[(start + i) % list.length], x = this.byKey.get(k);
      if (!x) { this.walkers.delete(k); continue; }
      const next = wk.path[0];
      if (!next) {
        x.walking = false;
        if (wk.back) { this.walkers.delete(k); x.away = false; x.pos = { x: x.desk.x, z: x.desk.z }; }
        else if (wk.trip.seat) x.pos = { ...wk.trip.seat };
        continue;
      }
      moving = true; x.walking = true;
      const step = WALK * dt * Math.max(1, list.length / n), dx = next.x - x.pos.x, dz = next.z - x.pos.z, d = Math.hypot(dx, dz);
      if (d <= step) { x.pos = { ...next }; wk.path.shift(); } else x.pos = { x: x.pos.x + dx / d * step, z: x.pos.z + dz / d * step };
    }
    this.writeInstances();
    return moving;
  }

  // ---------- frame ----------
  frame(t, dt) {
    let animating = false;
    const now = performance.now();
    this.anims = this.anims.filter((a) => {
      const u = Math.min(1, (now - a.start) / a.ms), k = 1 - (1 - u) ** 3;
      a.g.scale.y = Math.max(.001, a.from + (a.to - a.from) * k);
      if (u >= 1) { a.done?.(); return false; }
      return true;
    });
    if (this.anims.length) animating = true;
    if (!this.tripAt || now - this.tripAt > 1000) { this.tripAt = now; this.updateTrips(); }
    // walking follows the clock, not the frame count (a slow frame rate never slows the walkers down)
    const wdt = Math.min(.5, (now - (this.walkAt || now)) / 1000); this.walkAt = now;
    const walking = this.stepWalkers(wdt);
    // level of detail: the room zoomed into, or the one in the middle when the camera is close
    const zoomK = this.baseZoom ? this.s.camera.zoom / this.baseZoom : 1;
    const centre = this.centreRoom();
    const lod = lodFor({ zoom: zoomK, focus: this.focus, centreRoom: centre });
    const nearRoom = lod.level === 'near' && !['lobby', 'meeting', 'pantry', 'server', 'owner'].includes(lod.room) ? lod.room : null;
    if (nearRoom !== (this.near?.room || null)) this.setNear(nearRoom);
    if (this.near) for (const st of this.near.stations.values()) {
      this.kit.deskHome(st); this.kit.poseDesk(st, t);
      if (st.state === 'working' || st.state === 'waiting' || st.talkLevel > .02) animating = true;
      if (st.talkLevel > .02) st.rig.mouth.scale.y = .6 + st.talkLevel * 2.2;
    }
    this.placeLabels(zoomK);
    return { walking, animating: animating || walking };
  }
  centreRoom() {
    const t = this.s.controls.target;
    return roomAtPoint(this.plan, t.x, t.z)?.id || null;
  }
  // the ? bubble always; names when the camera is close; speech bubbles from the conversation view
  placeLabels(zoomK) {
    const s = this.s, v = new this.THREE.Vector3(), w = s.size.w, h = s.size.h, names = zoomK >= 1.6 || !!this.focus, nowMs = performance.now();
    for (const x of this.agents) {
      if (!x.labelEl) continue;
      v.set(x.pos.x, this.kit.TOP + 2.35, x.pos.z).project(s.camera);
      const say = (x.sayUntil || 0) > nowMs;
      const show = names || x.a.state === 'waiting' || say;
      x.labelEl.hidden = !show || v.z > 1;
      if (x.labelEl.hidden) continue;
      x.labelEl.classList.toggle('compact', !names);
      x.labelEl.classList.toggle('saying', say);
      x.labelEl.style.transform = `translate(-50%, -100%) translate(${Math.round((v.x + 1) / 2 * w)}px, ${Math.round((1 - v.y) / 2 * h)}px)`;
    }
  }

  // ---------- camera ----------
  pose() {
    const p = this.plan, TOP = this.kit.TOP;
    if (this.focus) {
      const r = this.rooms.get(this.focus)?.r;
      if (r) return this.s.fitIso(corners(this.THREE, r.x - .4, r.x + r.w + .4, TOP, TOP + GLASS_TOP + .8, r.z - .4, r.z + r.d + .4), .06);
    }
    const pose = this.s.fitIso(corners(this.THREE, -p.w / 2 - .8, p.w / 2 + .8, 0, TOP + GLASS_TOP + .8, -p.d / 2 - .8, p.d / 2 + .8), .03);
    this.baseZoom = pose.zoom;
    return pose;
  }
  // a click on a room: zoom into it (a Space), or open what it is for (Server room, Lobby, Owner)
  clickRoom(id) {
    const r = this.rooms.get(id)?.r, h = this.s.handlers;
    if (!r) return;
    if (r.kind === 'server') return h.onPickRack?.();
    if (r.kind === 'lobby') return h.onPickQueue?.();
    if (r.kind === 'owner') return h.onPickOwner?.();
    if (r.kind === 'meeting' || r.kind === 'pantry') return null;
    if (this.focus === id) return h.onPickFloor?.(id);
    return this.zoomTo(id);
  }
  zoomTo(id) {
    this.focus = id;
    if (!this.bar) {
      this.bar = Object.assign(document.createElement('div'), { className: 'officeBar' });
      this.bar.innerHTML = `<b class="grow"></b><button type="button" class="small gold" data-open>${tt('Open Space')}</button><button type="button" class="small ghost" data-back>${tt('Whole office')}</button>`;
      this.bar.querySelector('[data-open]').onclick = () => this.s.handlers.onPickFloor?.(this.focus);
      this.bar.querySelector('[data-back]').onclick = () => this.zoomTo(null);
      this.s.container.appendChild(this.bar);
    }
    this.bar.hidden = !id;
    if (id) this.bar.querySelector('b').textContent = this.floors.get(id)?.name || '';
    this.s.flyTo(this.pose(), 800);
    this.s.dirty = true;
  }
  // the conversation view: the agent's room comes close and its character talks
  focusAgent(floorId, agentId) { if (!this.byKey.has(`${floorId}/${agentId}`)) return false; this.convo = this.focus; this.zoomTo(floorId); return true; }
  unfocus() { if (this.convo === undefined) return; const back = this.convo; this.convo = undefined; this.zoomTo(back || null); }
  say(floorId, agentId, text, ms) {
    const x = this.byKey.get(`${floorId}/${agentId}`);
    if (!x?.labelEl) return;
    x.labelEl.querySelector('.say').textContent = text; x.sayUntil = performance.now() + ms; this.s.dirty = true;
  }
  setTalk(floorId, agentId, level) { const st = this.near?.stations.get(`${floorId}/${agentId}`); if (st) st.talkLevel = level; }

  // ---------- picking and hover ----------
  pick(e) {
    const s = this.s;
    s.ray.setFromCamera(s.ndc(e), s.camera);
    const hit = s.ray.intersectObject(this.head, false)[0] || s.ray.intersectObject(this.body, false)[0];
    if (hit && hit.instanceId != null) { const x = this.agents[hit.instanceId]; if (x && !x.queue) return s.handlers.onPickAgent?.(x.floorId, x.a.id); }
    if (this.near) {
      const h = s.ray.intersectObject(this.near.g, true)[0];
      let o = h?.object; while (o && !o.userData.agent) o = o.parent;
      if (o) return s.handlers.onPickAgent?.(this.near.room, o.userData.agent);
    }
    const p = s.ray.intersectObject(this.hitFloor, false)[0]?.point;
    const r = p && roomAtPoint(this.plan, p.x, p.z);
    if (r) return this.clickRoom(r.id);
    if (this.focus) return this.zoomTo(null);
    return null;
  }
  hover(e) {
    const s = this.s, now = performance.now();
    if (now - (this.hoverAt || 0) < 80) return;
    this.hoverAt = now;
    s.ray.setFromCamera(s.ndc(e), s.camera);
    let text = '';
    const hit = s.ray.intersectObject(this.head, false)[0] || s.ray.intersectObject(this.body, false)[0];
    const x = hit?.instanceId != null ? this.agents[hit.instanceId] : null;
    if (x && !x.queue) text = `${x.a.displayName || ''} · ${this.floors.get(x.floorId)?.name || ''}`;
    else {
      const p = s.ray.intersectObject(this.hitFloor, false)[0]?.point, r = p && roomAtPoint(this.plan, p.x, p.z);
      if (r) text = this.floors.get(r.id)?.name || { server: tt('Server room'), lobby: tt('Lobby'), owner: tt('Owner'), meeting: tt('Meeting room'), pantry: tt('Pantry') }[r.kind] || '';
    }
    this.tip.hidden = !text;
    if (text) { this.tip.textContent = text; const b = s.container.getBoundingClientRect(); Object.assign(this.tip.style, { left: `${e.clientX - b.left + 14}px`, top: `${e.clientY - b.top + 10}px` }); }
    s.renderer.domElement.style.cursor = text ? 'pointer' : '';
  }

  // RAM and CPU bars of the Server room (this machine)
  updateRacks() {
    const res = this.company?.resources || {};
    const v = { ram: res.mem?.total ? 1 - res.mem.available / res.mem.total : 0, cpu: res.cpus && res.load ? Math.min(1, res.load[0] / res.cpus) : 0 };
    const sig = JSON.stringify([Math.round(v.ram * 20), Math.round(v.cpu * 20)]);     // 5 % steps: no frame for every small change
    if (sig === this.barSig) return;
    this.barSig = sig; this.s.dirty = true;
    for (const b of this.bars || []) {
      const k = Math.max(.05, v[b.userData.bar]);
      b.scale.y = k * 1.6; b.position.y = this.kit.TOP + k * .8;
      b.material.color.set(k > .85 ? '#dc2626' : k > .65 ? '#d97706' : '#16a34a');
    }
  }
  racks() { return [...this.rooms.values()].flatMap((o) => o.devices.filter((d) => d.userData.rack)); }

  show(on) {
    this.shown = on; this.g.visible = on;
    for (const x of this.agents) if (x.labelEl) x.labelEl.hidden = !on || x.labelEl.hidden;
    for (const o of this.rooms.values()) o.plate.visible = on;
    if (this.bar) this.bar.hidden = !on || !this.focus;
    if (!on) this.tip.hidden = true;
  }
  dispose() {
    this.setNear(null);
    for (const o of this.rooms.values()) this.disposeRoom(o);
    this.rooms.clear();
    for (const x of this.agents) x.labelEl?.remove();
    this.dispose3(this.g); this.s.scene.remove(this.g);
    this.tip.remove(); this.bar?.remove();
  }
}

// a desk and its chair in a few boxes (far detail), marked so the near detail can hide them
function lowDesk(kit, g, d, lead) {
  const { box, mat, TOP } = kit, k = 1.3;                     // the stations' scale (STATION_SCALE)
  const parts = [box(1.6 * k, .07, .8 * k, mat(lead ? '#8a5a35' : '#f4efe6'), d.x, TOP + .92 * k, d.z + .62 * k, g, 0),
    box(1.5 * k, .9 * k, .06, mat('#c9bfae'), d.x, TOP + .46 * k, d.z + .95 * k, g, 0),
    box(.5, .04, .34, mat('#2f3a4a'), d.x, TOP + .96 * k, d.z + .5 * k, g, 0),
    box(.62, .1, .6, mat('#1f2937'), d.x, TOP + .55, d.z - .1, g, .03), box(.62, .55, .1, mat('#1f2937'), d.x, TOP + .85, d.z - .4, g, .03)];
  for (const p of parts) p.userData.lowDesk = true;
}
const roomSig = (r, f) => JSON.stringify([r.x, r.z, r.w, r.d, r.kind, f?.accent, (r.desks || []).map((d) => d.agentId), (f?.agents || []).map((a) => [a.id, a.lead])]);
const corners = (THREE, x0, x1, y0, y1, z0, z1) => [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].map((z) => new THREE.Vector3(x, y, z))));
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
let blob = null;
function blobTexture(THREE) {
  if (blob) return blob;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(40,28,18,1)'); grd.addColorStop(.55, 'rgba(40,28,18,.45)'); grd.addColorStop(1, 'rgba(40,28,18,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  blob = new THREE.CanvasTexture(c);
  return blob;
}
export { doorPoints };
