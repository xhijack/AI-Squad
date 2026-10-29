// SPDX-License-Identifier: Apache-2.0
// The Iso Pixel renderer (0.16): the same Building, Floors and agents as the three.js view, drawn on a Canvas 2D
// from a sprite atlas that was rendered from the 3D models (scripts/make-iso-sprites.js). No WebGL, a fraction of
// the memory, so it suits many agents, phones and weak machines. It is "lite" on purpose: positions, states,
// walking, clicks to the Desk, the Attention bubble, the meeting table and the room walls; no first person, no live
// screens, no shadows. It speaks the same interface as BuildingScene (sync, setView, setInsets, say, …), so app.js
// does not know which one draws (ui/renderer.js switches them).
import { FW, FD, FH, floorY, toRoom } from './layout.js';
import { RX, RZ, RY, project, rot, dirOf, floorModel, stationParts, poseOf, paintSprite, hexRgb } from './scene-model.js';
import { loungeSpots, meetingSeats, WANDER_AFTER } from './life.js';
import { NavGrid, footprints, Walker } from './nav.js';
import { lookFor, agentStatus, floorLabelHtml, STATION_SCALE } from './scene.js';
import { t as tt } from './i18n.js';
import { Office } from './office.js';
import { TAG_HTML, setTagState, applySpread } from './tags.js';
import { easeStep } from './motion.js';

const SLAB = .36;
const STATE_RING = { working: '#16a34a', waiting: '#dc2626', idle: '#d97706', stopped: '#9ca3af' };
const WINDOWS = [-4.2, .2, 4.4].map((z) => toRoom({ x: 0, z }).z), BRAND_X = toRoom({ x: -4.3, z: 0 }).x;

export class IsoScene {
  constructor(container, handlers = {}) {
    this.kind = 'iso';
    this.handlers = handlers;
    this.container = container;
    this.canvas = Object.assign(document.createElement('canvas'), { className: 'isoCanvas' });
    this.layer = Object.assign(document.createElement('div'), { className: 'isoLabels' });
    container.append(this.canvas, this.layer);
    this.g = this.canvas.getContext('2d');
    this.floors = new Map();                      // id -> runtime of a Floor
    this.view = { mode: 'lobby' };
    this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
    this.cam = { x: 0, y: 0, zoom: 1 };           // world point at the centre of the free area, pixels per metre / atlas px
    this.camGoal = null;
    this.bg = '#efe9df';
    this.dark = false;
    this.cache = new Map();                       // palette-swapped chibis
    this.bubbles = new Map();                     // floor/agent -> { text, until }
    this.stats = { frames: 0, ms: 0 };
    this.quality = { chosen: 'auto', active: 'low', set() {}, sample() {}, setAO() {} };   // the Graphics menu has nothing to do here
    this.company = {};                            // the queue, approvals and this machine, for the Office view
    this.office = new Office(this);
    this.loadAtlas();
    this.bindPointer();
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    this.resize();
    let last = 0, logic = 0;
    const loop = (now) => {
      if (this.disposed) return;
      requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min(.1, (now - (logic || now)) / 1000);
      const moving = this.walking || this.camGoal || this.drag;
      if (!moving && !this.dirty && now - last < (this.animating ? 140 : 500)) return;   // typing frames at ~7 fps, walking at full rate
      logic = now;
      this.tick(dt, now / 1000);
      if (moving || this.dirty || this.animating) { last = now; this.draw(); }
    };
    requestAnimationFrame(loop);
  }

  async loadAtlas() {
    try {
      const meta = await (await fetch('./assets/iso/atlas.json')).json();
      const img = new Image(); img.src = './assets/iso/atlas.png'; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      this.atlas = { meta, img, pixels: g.getImageData(0, 0, c.width, c.height) };
      this.keys = Object.entries(meta.keys).map(([k, hex]) => [k, hexRgb(hex)]);
      this.outline = hexRgb(meta.outline);
    } catch (e) { console.error('[iso] atlas', e.message); }
    this.dirty = true;
  }

  // ---------- data ----------
  sync(floors) {
    const key = JSON.stringify(floors);
    if (key === this.syncKey) return;
    this.syncKey = key;
    this.lastFloors = floors;
    const seen = new Set();
    for (const f of floors) {
      seen.add(f.id);
      let o = this.floors.get(f.id);
      const sig = JSON.stringify([f.number, f.layout, f.desks, f.devices, (f.agents || []).map((a) => [a.id, a.lead, a.appearance])]);
      if (!o || o.sig !== sig) o = this.buildFloor(f, o);
      o.sig = sig; o.data = f;
      for (const a of f.agents || []) { const r = o.agents.get(a.id); if (r) this.updateAgent(r, a); }
      o.labelEl.innerHTML = floorLabelHtml(f);
      o.labelEl.style.setProperty('--c', f.accent || '#7c5cd6');
      this.floors.set(f.id, o);
    }
    for (const [id, o] of this.floors) if (!seen.has(id)) { o.labelEl.remove(); for (const r of o.agents.values()) r.el.remove(); this.floors.delete(id); }
    this.office.update(floors);
    if (!this.placed) { this.placed = true; this.fit(true); }
    this.dirty = true;
  }
  setCompany(c) { this.company = c || {}; this.dirty = true; }
  officeOn() { return this.view.mode === 'lobby' && this.view.overview === 'office'; }

  buildFloor(f, old) {
    if (old) { old.labelEl.remove(); for (const r of old.agents.values()) r.el.remove(); }
    const { devices, desks } = floorModel(f);
    const o = { id: f.id, data: f, devices, desks, agents: new Map(), spots: loungeSpots(devices), seats: meetingSeats(devices), nav: new NavGrid(footprints({ desks, devices })) };
    o.labelEl = Object.assign(document.createElement('div'), { className: 'flabel isoFloor' });
    o.labelEl.addEventListener('click', () => this.handlers.onPickFloor?.(f.id));
    this.layer.append(o.labelEl);
    (f.agents || []).forEach((a, i) => {
      const desk = desks[i];
      const seat = { x: desk.x, z: desk.z, ry: desk.ry || 0 };
      const back = rot(0, -.9 * STATION_SCALE, seat.ry);
      const el = Object.assign(document.createElement('div'), { innerHTML: `${TAG_HTML}<div class="say" hidden></div>` });
      el.querySelector('.n').addEventListener('click', () => this.handlers.onPickAgent?.(f.id, a.id));
      el.querySelector('.n').style.pointerEvents = 'auto';
      this.layer.append(el);
      const r = { id: a.id, floorId: f.id, a, desk, seat, approach: { x: seat.x + back.x, z: seat.z + back.z }, el, mode: 'desk', w: new Walker(a.id, seat.x, seat.z), ry: seat.ry, idleSince: 0, phase: Math.random() * 6 };
      o.agents.set(a.id, r);
      this.updateAgent(r, a);
    });
    return o;
  }

  updateAgent(r, a) {
    if (r.a.state !== a.state && a.state === 'idle') r.idleSince = performance.now() / 1000;
    r.a = a;
    const name = String(a.displayName || '').split(' - ')[0];
    const k = setTagState(r.el, a);                                    // the state is in the tag (1.2.0)
    const cls = `nlabel isoAgent ${k}`, keep = ['faded', 'sel'].filter((c) => r.el.classList.contains(c)).map((c) => ` ${c}`).join('');
    if (r.el.className !== cls + keep) r.el.className = cls + keep;
    const n = r.el.querySelector('.n'), nm = n.querySelector('.nm');
    if (nm.textContent !== name) nm.textContent = name;
    const color = a.appearance?.shirt || '#3d82d6';
    n.style.background = color; n.style.color = luminance(color) > .6 ? '#1f2937' : '#fff';
    r.el.title = `${a.displayName}: ${agentStatus(a)}`;
  }

  // ---------- life: idle agents walk to a lounge spot, a meeting gathers at the table, work brings them back ----------
  tick(dt, t) {
    this.walking = false; this.animating = false;
    if (this.camGoal) {
      const k = easeStep(dt * 6);                                   // reduced motion: straight to the goal
      for (const p of ['x', 'y', 'zoom']) this.cam[p] += (this.camGoal[p] - this.cam[p]) * k;
      if (Math.abs(this.camGoal.zoom - this.cam.zoom) < .002 && Math.hypot(this.camGoal.x - this.cam.x, this.camGoal.y - this.cam.y) < .01) { Object.assign(this.cam, this.camGoal); this.camGoal = null; }
    }
    for (const o of this.floors.values()) {
      if (!this.shown(o)) continue;
      const meeting = o.data.meeting?.agents || [];
      const others = [...o.agents.values()].map((x) => ({ id: x.id, x: x.w.x, z: x.w.z, moving: x.mode === 'walk' || x.mode === 'return' }));
      const taken = new Set([...o.agents.values()].map((x) => x.spot?.id).filter(Boolean));
      for (const r of o.agents.values()) {
        const st = r.a.state;
        if (st === 'working' || st === 'waiting') this.animating = true;
        const seatAt = meeting.indexOf(r.id);
        const wantsDesk = st !== 'idle' || r.a.standby;
        if (seatAt >= 0 && o.seats[seatAt] && r.spot?.id !== `seat${seatAt}`) this.go(o, r, { id: `seat${seatAt}`, ...o.seats[seatAt], seat: true }, others);
        else if (seatAt < 0 && r.spot?.seat) this.goHome(o, r, others);
        else if (wantsDesk && r.mode !== 'desk' && r.mode !== 'return') this.goHome(o, r, others);
        else if (!wantsDesk && r.mode === 'desk' && seatAt < 0 && r.idleSince && t - r.idleSince > WANDER_AFTER && o.spots.length) {
          const free = o.spots.filter((s) => !taken.has(s.id));
          if (free.length) { const s = free[Math.floor(Math.random() * free.length)]; taken.add(s.id); this.go(o, r, s, others); }
          r.idleSince = t + 60;                         // try again in a minute
        }
        if (r.mode === 'walk' || r.mode === 'return') {
          this.walking = true;
          const px = r.w.x, pz = r.w.z;
          const res = r.w.step(o.nav, others, dt);
          if (Math.hypot(r.w.x - px, r.w.z - pz) > 1e-4) r.ry = Math.atan2(r.w.x - px, r.w.z - pz);
          if (res === 'arrived') {
            if (r.mode === 'return') { r.mode = 'desk'; r.spot = null; r.w.x = r.seat.x; r.w.z = r.seat.z; r.ry = r.seat.ry; }
            else { r.mode = 'spot'; if (r.spot.seat) { r.w.x = r.spot.x; r.w.z = r.spot.z; } r.ry = r.spot.face ?? r.ry; }
          }
        }
      }
    }
    for (const [k, b] of this.bubbles) if (b.until < performance.now()) { this.bubbles.delete(k); this.dirty = true; }
    if (this.officeOn()) this.animating = this.office.busy();
  }
  go(o, r, spot, others) {
    r.spot = spot; r.mode = 'walk';
    if (r.w.x === r.seat.x && r.w.z === r.seat.z) { r.w.x = r.approach.x; r.w.z = r.approach.z; }   // stand up behind the chair
    const goal = spot.seat ? o.nav.nearestFree(spot.x, spot.z) || spot : o.nav.nearestFree(spot.x, spot.z) || spot;
    if (!r.w.goTo(o.nav, goal, others)) { r.w.x = goal.x; r.w.z = goal.z; r.mode = 'spot'; r.ry = spot.face ?? r.ry; }
  }
  goHome(o, r, others) {
    r.mode = 'return'; r.spot = null;
    const goal = o.nav.nearestFree(r.approach.x, r.approach.z) || r.approach;
    if (!r.w.goTo(o.nav, goal, others)) { r.mode = 'desk'; r.w.x = r.seat.x; r.w.z = r.seat.z; r.ry = r.seat.ry; }
  }

  // ---------- view ----------
  shown(o) { return (this.view.mode === 'lobby' && !this.officeOn()) || this.view.floorId === o.id; }
  setView(view) { this.view = view; this.fit(false); this.dirty = true; }
  setInsets(insets) { this.insets = { left: 0, right: 0, top: 0, bottom: 0, ...insets }; this.fit(true); this.dirty = true; }
  freeRect() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, i = this.insets;
    return { x: i.left, y: i.top, w: Math.max(80, w - i.left - i.right), h: Math.max(80, h - i.top - i.bottom) };
  }
  // world -> screen units (before zoom) at a Floor's height
  proj(x, y, z) { return project(x, y, z); }
  fit(snap) {
    const pts = [];
    const add = (o) => { const y0 = this.view.mode === 'lobby' ? floorY(o.data.number) : 0; for (const [x, z] of [[-FW / 2, -FD / 2], [FW / 2, -FD / 2], [FW / 2, FD / 2], [-FW / 2, FD / 2]]) { pts.push(this.proj(x, y0 - SLAB, z), this.proj(x, y0 + FH, z)); } };
    let focus = null;
    if (this.officeOn()) pts.push(...this.office.points());
    else if (this.view.mode === 'lobby') for (const o of this.floors.values()) add(o);
    else { const o = this.floors.get(this.view.floorId); if (o) add(o); focus = o && this.view.agentId ? o.agents.get(this.view.agentId) : null; }
    if (!pts.length) return;
    const r = this.freeRect(), atlasPx = this.atlas?.meta.px || 24;
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    let zoom = Math.min(r.w / ((maxX - minX) * 1.06), r.h / ((maxY - minY) * 1.06)) / atlasPx;
    let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    if (focus) { const p = this.proj(focus.w.x, 1, focus.w.z); cx = p.x; cy = p.y; zoom = Math.max(zoom * 2.4, 2); }
    zoom = Math.max(.25, zoom >= 1 ? Math.round(zoom * 4) / 4 : Math.round(zoom * 8) / 8);   // even steps keep the pixels even
    const goal = { x: cx, y: cy, zoom };
    if (snap || !this.drawnOnce) { Object.assign(this.cam, goal); this.camGoal = null; } else this.camGoal = goal;
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr; this.dirty = true;
  }
  setTheme(dark, color) { this.dark = dark; this.bg = color || (dark ? '#151a2c' : '#efe9df'); this.dirty = true; }
  focusAgent(floorId, agentId) { this.view = { ...this.view, mode: 'desk', floorId, agentId }; this.fit(false); this.convoFocus = true; }
  unfocus() { if (!this.convoFocus) return; this.convoFocus = false; this.view = { ...this.view, agentId: this.view.mode === 'desk' ? this.view.agentId : undefined }; this.fit(false); }
  say(floorId, agentId, text, ms = 7000) { this.bubbles.set(`${floorId}/${agentId}`, { text, until: performance.now() + ms }); this.dirty = true; }
  setLoad() {}
  setLiveText() {}
  setBoard() {}
  setShot() {}
  dispose() {
    this.disposed = true;
    removeEventListener('resize', this.onResize);
    this.office.dispose();
    this.canvas.remove(); this.layer.remove();
    this.cache.clear();
  }

  // screen pixel of a world point on a Floor
  screen(x, y, z, base = 0) {
    const s = (this.atlas?.meta.px || 24) * this.cam.zoom, r = this.freeRect();
    const p = this.proj(x, y + base, z);
    return { x: r.x + r.w / 2 + (p.x - this.cam.x) * s, y: r.y + r.h / 2 + (p.y - this.cam.y) * s };
  }

  // ---------- drawing ----------
  draw() {
    const t0 = performance.now();
    this.dirty = false; this.drawnOnce = true;
    const g = this.g, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = this.bg; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const list = [...this.floors.values()].filter((o) => this.shown(o)).sort((a, b) => a.data.number - b.data.number);
    const labelsOn = this.view.mode !== 'lobby';
    if (this.officeOn()) this.office.draw(); else this.office.hide();
    for (const o of list) this.drawFloor(o, this.view.mode === 'lobby' ? floorY(o.data.number) : 0, labelsOn);
    for (const o of this.floors.values()) if (!this.shown(o)) { o.labelEl.hidden = true; for (const r of o.agents.values()) r.el.hidden = true; }
    this.stats.frames++; this.stats.ms += performance.now() - t0;
  }

  drawFloor(o, base, labelsOn) {
    const g = this.g, f = o.data;
    const P = (x, y, z) => this.screen(x, y, z, base);
    const poly = (pts, fill, stroke) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
    const X0 = -FW / 2, X1 = FW / 2, Z0 = -FD / 2, Z1 = FD / 2;
    // slab: the two faces towards the camera, then the floor
    poly([P(X0, 0, Z1), P(X1, 0, Z1), P(X1, -SLAB, Z1), P(X0, -SLAB, Z1)], '#cdbfa9');
    poly([P(X1, 0, Z0), P(X1, 0, Z1), P(X1, -SLAB, Z1), P(X1, -SLAB, Z0)], '#b9aa92');
    poly([P(X0, 0, Z0), P(X1, 0, Z0), P(X1, 0, Z1), P(X0, 0, Z1)], f.missing ? '#cfc8bb' : '#e2c79f');
    g.strokeStyle = 'rgba(120, 84, 48, .16)'; g.lineWidth = 1;                    // planks
    for (let x = X0 + 1; x < X1; x += 1) { const a = P(x, 0, Z0), b = P(x, 0, Z1); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    const accent = f.accent || '#7c5cd6';
    poly([P(X0, 0, Z1), P(X1, 0, Z1), P(X1, .07, Z1 + .02), P(X0, .07, Z1 + .02)], accent);
    poly([P(X1, 0, Z0), P(X1, 0, Z1), P(X1 + .02, .07, Z1), P(X1 + .02, .07, Z0)], accent);
    // back and left walls with baseboards and windows
    poly([P(X0, 0, Z0), P(X1, 0, Z0), P(X1, FH, Z0), P(X0, FH, Z0)], '#f6f2ea');
    poly([P(X0, 0, Z0), P(X0, 0, Z1), P(X0, FH, Z1), P(X0, FH, Z0)], '#ebe4d8');
    poly([P(X0, 0, Z0 + .01), P(X1, 0, Z0 + .01), P(X1, .32, Z0 + .01), P(X0, .32, Z0 + .01)], '#2f3a4a');
    poly([P(X0 + .01, 0, Z0), P(X0 + .01, 0, Z1), P(X0 + .01, .32, Z1), P(X0 + .01, .32, Z0)], '#2f3a4a');
    for (const z of WINDOWS) poly([P(X0 + .02, 1.2, z - 1.4), P(X0 + .02, 1.2, z + 1.4), P(X0 + .02, 2.9, z + 1.4), P(X0 + .02, 2.9, z - 1.4)], '#bfe3f5', '#2f3a4a');
    // the brand wall: a dark panel with the Floor's name, drawn in the wall's own plane
    poly([P(BRAND_X - 2.8, .3, Z0 + .02), P(BRAND_X + 2.8, .3, Z0 + .02), P(BRAND_X + 2.8, FH - .1, Z0 + .02), P(BRAND_X - 2.8, FH - .1, Z0 + .02)], '#2f4858');
    const s = (this.atlas?.meta.px || 24) * this.cam.zoom, o0 = P(BRAND_X - 2.5, 2.7, Z0 + .03);
    g.save(); g.setTransform(this.dpr * RX * s, this.dpr * RZ * s, 0, this.dpr * RY * s, this.dpr * o0.x, this.dpr * o0.y);
    g.fillStyle = '#ffe7b0'; g.font = '800 0.62px system-ui, sans-serif'; g.textBaseline = 'top';
    g.fillText(String(f.name || '').slice(0, 26), 0, 0, 5);
    if (f.tagline) { g.fillStyle = '#cbd5e1'; g.font = '600 0.28px system-ui, sans-serif'; g.fillText(String(f.tagline).slice(0, 48), 0, .82, 5); }
    g.restore();
    // things on the floor, far to near (the rug first)
    const items = [];
    for (const d of o.devices) items.push({ depth: d.type === 'rug' ? -1e9 : d.x + d.z, draw: () => this.sprite(`dev:${d.type}:${dirOf(d.ry || 0)}`, d.x, d.z, base) });
    for (const r of o.agents.values()) {
      const d = r.desk, dir = dirOf(d.ry || 0), parts = stationParts(d);
      items.push({ depth: parts.desk.depth, draw: () => this.sprite(`desk:${r.a.lead ? 'lead' : 'std'}:${d.device === 'dual-monitor' ? 'dual-monitor' : 'laptop'}:${dir}`, d.x, d.z, base) });
      items.push({ depth: parts.chair.depth, draw: () => { this.ring(r, base); this.sprite(`chair:${dir}`, d.x, d.z, base); } });
      items.push({ depth: r.w.x + r.w.z + (r.mode === 'desk' ? .05 : 0), draw: () => this.character(r, base, labelsOn) });
    }
    items.sort((a, b) => a.depth - b.depth).forEach((i) => i.draw());
    // overlapping name tags: nudged up, the farther (smaller x + z) faded, the Desk's agent on top (ui/tags.js)
    if (labelsOn) applySpread([...o.agents.values()].map((r) => ({ id: r.id, el: r.el, depth: -(r.w.x + r.w.z), selected: this.view.mode === 'desk' && this.view.agentId === r.id })));
    // the Floor's chip (Lobby) beside the right edge
    const lp = P(X1 + .6, 1.2, Z1 - 1);
    o.labelEl.hidden = labelsOn;
    if (!labelsOn) Object.assign(o.labelEl.style, { left: `${lp.x}px`, top: `${lp.y}px` });
  }

  sprite(key, x, z, base, y = 0) {
    const sp = this.atlas?.meta.sprites[key];
    if (!sp) return null;
    const [sx, sy, w, h, ax, ay] = sp, k = this.cam.zoom, p = this.screen(x, y, z, base);
    const dx = Math.round(p.x - ax * k), dy = Math.round(p.y - ay * k);
    this.g.drawImage(this.atlas.img, sx, sy, w, h, dx, dy, Math.round(w * k), Math.round(h * k));
    return { x: dx, y: dy, w: w * k, h: h * k };
  }
  ring(r, base) {
    if (r.mode !== 'desk') return;
    const g = this.g, c = this.screen(r.seat.x, 0, r.seat.z, base), s = (this.atlas?.meta.px || 24) * this.cam.zoom;
    g.save(); g.globalAlpha = .55; g.strokeStyle = STATE_RING[r.a.state] || STATE_RING.stopped; g.lineWidth = Math.max(1.5, s * .1);
    g.beginPath(); g.ellipse(c.x, c.y, s * 1.0 * RX * 1.414, s * 1.0 * RZ * 1.414, 0, 0, Math.PI * 2); g.stroke(); g.restore();
  }

  // the chibi in its own colours: the atlas has a colour-key mask and a white shading pass per pose and heading
  character(r, base, labelsOn) {
    const a = r.a;
    const t = performance.now() / 1000 + r.phase;
    const pose = poseOf(a, r.mode, t, !!r.spot?.seat);
    const img = this.chibiImage(a, pose, dirOf(r.mode === 'desk' ? r.seat.ry : r.ry));
    const k = this.cam.zoom, p = this.screen(r.w.x, 0, r.w.z, base);
    if (img) this.g.drawImage(img.canvas, Math.round(p.x - img.ax * k), Math.round(p.y - img.ay * k), Math.round(img.canvas.width * k), Math.round(img.canvas.height * k));
    r.box = img ? { x: p.x - img.ax * k, y: p.y - img.ay * k, w: img.canvas.width * k, h: img.canvas.height * k } : null;
    // its name chip, status and bubbles (DOM, so they stay sharp and clickable)
    r.el.hidden = !labelsOn;
    if (labelsOn) {
      const top = this.screen(r.w.x, 2.55 * (r.mode === 'desk' ? .9 : 1), r.w.z, base);
      Object.assign(r.el.style, { left: `${Math.round(top.x)}px`, top: `${Math.round(top.y)}px` });
      const b = this.bubbles.get(`${r.floorId}/${r.id}`), say = r.el.querySelector('.say');
      if (b) { if (say.textContent !== b.text) say.textContent = b.text; say.hidden = false; } else say.hidden = true;
    }
  }
  // an agent in its own colours, in a pose and heading (cached; the Office view uses it too)
  chibiImage(a, pose, dir) {
    const style = a.appearance?.style || 'bob', look = lookFor(a.appearance || {});
    const ck = `${style}|${pose}|${dir}|${look.skin}|${look.hair}|${look.shirt}|${look.pants}|${look.shoe}|${look.hat}|${look.eye}`;
    let img = this.cache.get(ck);
    if (img === undefined && this.atlas) { img = this.paint(`ch:${style}:${pose}:${dir}`, look); this.cache.set(ck, img); if (this.cache.size > 600) this.cache.delete(this.cache.keys().next().value); }
    return img || null;
  }
  // a screen point back to the floor plane (y = 0)
  unproject(sx, sy) {
    const k = (this.atlas?.meta.px || 24) * this.cam.zoom, r = this.freeRect();
    const px = (sx - r.x - r.w / 2) / k + this.cam.x, py = (sy - r.y - r.h / 2) / k + this.cam.y;
    const a = px / RX, b = py / RZ;
    return { x: (a + b) / 2, z: (b - a) / 2 };
  }
  paint(prefix, look) {
    const m = this.atlas.meta.sprites[`${prefix}:m`], s = this.atlas.meta.sprites[`${prefix}:s`];
    if (!m || !s) return null;
    const view = (sp) => { const [x, y, w, h, ax, ay] = sp, data = new Uint8ClampedArray(w * h * 4), src = this.atlas.pixels.data, W = this.atlas.pixels.width;
      for (let j = 0; j < h; j++) data.set(src.subarray(((y + j) * W + x) * 4, ((y + j) * W + x + w) * 4), j * w * 4);
      return { data, w, h, ax, ay }; };
    const c = document.createElement('canvas'); c.width = m[2]; c.height = m[3];
    const img = new ImageData(paintSprite(view(m), view(s), this.keys, this.outline, look), m[2], m[3]);
    c.getContext('2d').putImageData(img, 0, 0);
    return { canvas: c, ax: m[4], ay: m[5] };
  }

  // ---------- input: drag pans, the wheel zooms, a click picks an agent or a Floor ----------
  bindPointer() {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false }; el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
      if (!this.drag.moved) return;
      const s = (this.atlas?.meta.px || 24) * this.cam.zoom;
      this.cam.x = this.drag.cx - dx / s; this.cam.y = this.drag.cy - dy / s; this.camGoal = null; this.dirty = true;
    });
    el.addEventListener('pointerup', (e) => { const d = this.drag; this.drag = null; if (d && !d.moved) this.pick(e); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const z = Math.max(.25, Math.min(8, this.cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.cam.zoom = z; this.camGoal = null; this.dirty = true;
    }, { passive: false });
  }
  pick(e) {
    const rect = this.canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (this.officeOn()) return this.office.pick(x, y);
    if (this.view.mode === 'lobby') {
      // the Floor whose slab is under the pointer (the top one wins)
      const list = [...this.floors.values()].sort((a, b) => b.data.number - a.data.number);
      for (const o of list) { if (inFloor(this, o, x, y)) return this.handlers.onPickFloor?.(o.id); }
      return null;
    }
    const o = this.floors.get(this.view.floorId);
    if (!o) return null;
    const hit = [...o.agents.values()].filter((r) => r.box && x >= r.box.x && x <= r.box.x + r.box.w && y >= r.box.y && y <= r.box.y + r.box.h).sort((a, b) => (b.w.x + b.w.z) - (a.w.x + a.w.z))[0];
    if (hit) return this.handlers.onPickAgent?.(o.id, hit.id);
    const rack = o.devices.find((d) => d.type === 'server-rack' && Math.hypot(...['x', 'y'].map((k) => this.screen(d.x, 1, d.z)[k] - ({ x, y })[k])) < 30);
    if (rack) return this.handlers.onPickRack?.();
    return null;
  }
}

function inFloor(scene, o, x, y) {
  const base = floorY(o.data.number);
  const pts = [[-FW / 2, -FD / 2], [FW / 2, -FD / 2], [FW / 2, FD / 2], [-FW / 2, FD / 2]].map(([a, b]) => scene.screen(a, 0, b, base));
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > y) !== (pts[j].y > y) && x < (pts[j].x - pts[i].x) * (y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}
function luminance(hex) { const [r, g, b] = hexRgb(hex); return (.299 * r + .587 * g + .114 * b) / 255; }
