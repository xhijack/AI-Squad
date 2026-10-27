// SPDX-License-Identifier: Apache-2.0
// The Office view (0.17), drawn by the Iso Pixel renderer: the whole company on one floor plan. Departments at the
// back with the Server room, projects in the middle, the Lobby (the dispatcher's queue) and the Owner's room
// (approvals) at the front. The layout comes from the Scene Model (officeLayout); this file only draws it and
// answers clicks: a room opens its Space, an agent its Desk, the Lobby the queue, the Owner's room the approvals,
// the Server room the meter.
import { officeLayout, roomAt, RX, RZ, dirOf } from './scene-model.js';
import { floorLabelHtml } from './scene.js';
import { t as tt } from './i18n.js';

const WALL = 1.1;
const ROOM_FILL = { department: '#ead9b8', project: '#dfe6ee', server: '#d3d9e1', lobby: '#efe3cf', owner: '#e6dcee' };
const STATE_RING = { working: '#16a34a', waiting: '#dc2626', idle: '#d97706', stopped: '#9ca3af' };
const QUEUE_LOOKS = ['#3d82d6', '#e2574c', '#16a34a', '#d97706', '#7c5cd6', '#0ea5a4', '#db2777', '#64748b'];

export class Office {
  constructor(scene) { this.s = scene; this.roomEls = new Map(); this.agentEls = new Map(); this.boxes = []; this.key = ''; }

  // the plan for the Floors as they are now (rebuilt when Spaces or their agents change)
  update(floors) {
    const spaces = (floors || []).filter((f) => !f.missing);
    const key = JSON.stringify(spaces.map((f) => [f.id, f.kind, f.number, (f.agents || []).map((a) => a.id)]));
    if (key === this.key) { this.floors = spaces; return; }
    this.key = key; this.floors = spaces;
    this.layout = officeLayout(spaces.map((f) => ({ id: f.id, name: f.name, number: f.number, kind: f.kind || 'project', agents: f.agents || [] })));
    for (const el of this.roomEls.values()) el.remove();
    for (const el of this.agentEls.values()) el.remove();
    this.roomEls.clear(); this.agentEls.clear();
    for (const r of this.layout.rooms) {
      const el = Object.assign(document.createElement('div'), { className: `flabel isoRoom ${r.kind}` });
      el.addEventListener('click', () => this.open(r));
      this.s.layer.append(el); this.roomEls.set(r.id, el);
      for (const d of r.desks) {
        if (!d.agentId) continue;
        const a = Object.assign(document.createElement('div'), { className: 'nlabel isoAgent officeAgent', innerHTML: '<span class="q" aria-hidden="true">?</span><span class="n"></span>' });
        a.querySelector('.n').addEventListener('click', () => this.s.handlers.onPickAgent?.(r.id, d.agentId));
        a.querySelector('.n').style.pointerEvents = 'auto';
        this.s.layer.append(a); this.agentEls.set(`${r.id}/${d.agentId}`, a);
      }
    }
  }
  open(r) {
    const h = this.s.handlers;
    if (r.kind === 'server') return h.onPickRack?.();
    if (r.kind === 'lobby') return h.onPickQueue?.();
    if (r.kind === 'owner') return h.onPickOwner?.();
    return h.onPickFloor?.(r.id);
  }
  hide() { for (const el of [...this.roomEls.values(), ...this.agentEls.values()]) el.hidden = true; }
  dispose() { this.hide(); for (const el of [...this.roomEls.values(), ...this.agentEls.values()]) el.remove(); }
  points() {
    if (!this.layout) return [];
    const { w, d } = this.layout, s = this.s;
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].flatMap(([x, z]) => [s.proj(x, -.3, z), s.proj(x, WALL + 1.6, z)]);
  }
  busy() { return (this.floors || []).some((f) => (f.agents || []).some((a) => a.state === 'working' || a.state === 'waiting')); }

  draw() {
    if (!this.layout) return;
    const s = this.s, g = s.g, P = (x, y, z) => s.screen(x, y, z, 0), company = s.company || {};
    const poly = (pts, fill, stroke) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
    const { w, d } = this.layout, X0 = -w / 2 - .6, X1 = w / 2 + .6, Z0 = -d / 2 - .6, Z1 = d / 2 + .6;
    // the building's floor: a carpet for the corridors, its front faces
    poly([P(X0, 0, Z1), P(X1, 0, Z1), P(X1, -.36, Z1), P(X0, -.36, Z1)], '#cdbfa9');
    poly([P(X1, 0, Z0), P(X1, 0, Z1), P(X1, -.36, Z1), P(X1, -.36, Z0)], '#b9aa92');
    poly([P(X0, 0, Z0), P(X1, 0, Z0), P(X1, 0, Z1), P(X0, 0, Z1)], '#d9cdb8');
    const byFloor = new Map(this.floors.map((f) => [f.id, f]));
    const zoomed = s.cam.zoom >= 1.5;                     // names only when zoomed in; the ? bubbles always
    this.boxes = [];
    const rooms = [...this.layout.rooms].sort((a, b) => (a.x + a.w / 2 + a.z + a.d / 2) - (b.x + b.w / 2 + b.z + b.d / 2));
    for (const r of rooms) {
      const f = byFloor.get(r.id), x0 = r.x, x1 = r.x + r.w, z0 = r.z, z1 = r.z + r.d;
      poly([P(x0, .02, z0), P(x1, .02, z0), P(x1, .02, z1), P(x0, .02, z1)], ROOM_FILL[r.kind] || '#e5e7eb', 'rgba(47, 58, 74, .25)');
      if (f?.accent) poly([P(x0, .03, z1 - .12), P(x1, .03, z1 - .12), P(x1, .03, z1), P(x0, .03, z1)], f.accent);
      poly([P(x0, 0, z0), P(x1, 0, z0), P(x1, WALL, z0), P(x0, WALL, z0)], '#f4efe6', 'rgba(47, 58, 74, .35)');     // back wall
      poly([P(x0, 0, z0), P(x0, 0, z1), P(x0, WALL, z1), P(x0, WALL, z0)], '#e9e2d6', 'rgba(47, 58, 74, .35)');     // left wall
      const items = [];
      if (r.kind === 'server') {
        const rx = x0 + r.w / 2, rz = z0 + 1.6;
        items.push({ depth: rx + rz, draw: () => { s.sprite('dev:server-rack:0', rx - .8, rz, 0); s.sprite('dev:server-rack:0', rx + .4, rz, 0); this.meters(rx, rz + 1.4, company); } });
      }
      if (r.kind === 'lobby') {
        const n = Math.min(8, company.queued || 0);
        for (let i = 0; i < n; i++) { const qx = x0 + 1.2 + i * .85, qz = z0 + 2.8; items.push({ depth: qx + qz, draw: () => this.chibi({ state: 'idle', appearance: { shirt: QUEUE_LOOKS[i % QUEUE_LOOKS.length], style: ['bob', 'spiky', 'pony', 'buns'][i % 4] } }, 'stand', 1, qx, qz) }); }
        items.push({ depth: x0 + 7 + z0 + 1, draw: () => s.sprite('dev:sofa:4', x0 + 6.4, z0 + 1.2, 0) });
      }
      if (r.kind === 'owner') {
        const dk = r.desks[0];
        items.push({ depth: dk.x + dk.z + .8, draw: () => s.sprite('desk:lead:dual-monitor:0', dk.x, dk.z, 0) });
        items.push({ depth: dk.x + dk.z - .2, draw: () => s.sprite('chair:0', dk.x, dk.z, 0) });
        items.push({ depth: x0 + 1 + z0 + 1, draw: () => s.sprite('dev:whiteboard:0', x0 + 1.4, z0 + .5, 0) });
      }
      for (const dk of f ? r.desks : []) {
        const a = (f.agents || []).find((x) => x.id === dk.agentId);
        if (!a) continue;
        const saved = (f.desks || []).find((x) => x.agent === a.id);
        const device = saved?.device === 'dual-monitor' ? 'dual-monitor' : 'laptop';
        items.push({ depth: dk.x + dk.z + .8, draw: () => s.sprite(`desk:${a.lead ? 'lead' : 'std'}:${device}:0`, dk.x, dk.z, 0) });
        items.push({ depth: dk.x + dk.z - .2, draw: () => { this.ring(dk, a); s.sprite('chair:0', dk.x, dk.z, 0); } });
        items.push({ depth: dk.x + dk.z + .05, draw: () => {
          const t = performance.now() / 1000 + dk.x;
          const pose = a.state === 'working' && !a.task ? (Math.floor(t * 7) % 2 ? 'type-a' : 'type-b') : a.state === 'waiting' ? 'wait' : a.state === 'stopped' && !a.standby ? 'sleep' : 'think';
          const box = this.chibi(a, pose, 0, dk.x, dk.z);
          if (box) this.boxes.push({ ...box, floorId: r.id, agentId: a.id });
          const el = this.agentEls.get(`${r.id}/${a.id}`);
          if (el) {
            const top = P(dk.x, 2.3, dk.z), name = String(a.displayName || '').split(' - ')[0];
            el.className = `nlabel isoAgent officeAgent ${a.state || 'stopped'}${zoomed ? '' : ' compact'}`;
            const n = el.querySelector('.n'); if (n.textContent !== name) n.textContent = name;
            n.style.background = a.appearance?.shirt || '#3d82d6'; n.style.color = '#fff';
            Object.assign(el.style, { left: `${Math.round(top.x)}px`, top: `${Math.round(top.y)}px` }); el.hidden = false;
          }
        } });
      }
      items.sort((p, q) => p.depth - q.depth).forEach((i) => i.draw());
      // the room's chip
      const el = this.roomEls.get(r.id), lp = P(x0 + .2, WALL + .15, z0 + .2);      // on the room's back-left corner, behind its desks
      if (el) {
        const html = f ? `${floorLabelHtml(f)}<span class="k">${f.kind === 'department' ? tt('Department') : tt('Project')}</span>`
          : r.kind === 'lobby' ? `<b>${tt('Lobby')}</b> <span class="${company.queued ? 'q' : 'm'}">${tt('{n} queued', { n: company.queued || 0 })}</span>`
          : r.kind === 'owner' ? `<b>${tt('Owner')}</b> <span class="${company.attention ? 'q' : 'm'}">${tt('{n} waiting for you', { n: company.attention || 0 })}</span>${company.targets?.total ? ` <span class="${company.targets.behind ? 'q' : 'm'}">${tt('{met}/{n} targets', { met: company.targets.met, n: company.targets.total })}</span>` : ''}`
          : `<b>${tt('Server room')}</b> <span class="m">${esc(serverText(company))}</span>`;
        if (el.innerHTML !== html) el.innerHTML = html;
        if (f) el.style.setProperty('--c', f.accent || '#7c5cd6');
        Object.assign(el.style, { left: `${Math.round(lp.x)}px`, top: `${Math.round(lp.y)}px` }); el.hidden = false;
      }
    }
  }
  ring(dk, a) {
    const s = this.s, g = s.g, c = s.screen(dk.x, 0, dk.z, 0), k = (s.atlas?.meta.px || 24) * s.cam.zoom;
    g.save(); g.globalAlpha = .55; g.strokeStyle = STATE_RING[a.state] || STATE_RING.stopped; g.lineWidth = Math.max(1, k * .08);
    g.beginPath(); g.ellipse(c.x, c.y, k * RX * 1.2, k * RZ * 1.2, 0, 0, Math.PI * 2); g.stroke(); g.restore();
  }
  chibi(a, pose, ry, x, z) {
    const s = this.s, img = s.chibiImage(a, pose, dirOf(ry));
    if (!img) return null;
    const k = s.cam.zoom, p = s.screen(x, 0, z, 0);
    const bx = Math.round(p.x - img.ax * k), by = Math.round(p.y - img.ay * k);
    s.g.drawImage(img.canvas, bx, by, Math.round(img.canvas.width * k), Math.round(img.canvas.height * k));
    return { x: bx, y: by, w: img.canvas.width * k, h: img.canvas.height * k };
  }
  // RAM and CPU of this machine as two bars beside the racks
  meters(x, z, c) {
    const s = this.s, g = s.g, res = c.resources || {};
    const ram = res.mem?.total ? 1 - res.mem.available / res.mem.total : 0, cpu = res.cpus && res.load ? Math.min(1, res.load[0] / res.cpus) : 0;
    [[ram, -.5], [cpu, .3]].forEach(([v, dx]) => {
      const base = s.screen(x + dx, 0, z, 0), top = s.screen(x + dx, 1.6, z, 0), lvl = s.screen(x + dx, 1.6 * v, z, 0), wd = Math.max(4, (s.atlas?.meta.px || 24) * s.cam.zoom * .22);
      g.fillStyle = '#2f3a4a'; g.fillRect(top.x - wd / 2, top.y, wd, base.y - top.y);
      g.fillStyle = v > .85 ? '#dc2626' : v > .65 ? '#d97706' : '#16a34a'; g.fillRect(lvl.x - wd / 2 + 1, lvl.y, wd - 2, base.y - lvl.y);
    });
  }
  // a click: an agent first, then the room under the pointer (the floor plane at y = 0)
  pick(x, y) {
    const hit = this.boxes.filter((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h).at(-1);
    if (hit) return this.s.handlers.onPickAgent?.(hit.floorId, hit.agentId);
    const w = this.s.unproject(x, y);
    const r = w && this.layout && roomAt(this.layout, w.x, w.z);
    return r ? this.open(r) : null;
  }
}
function serverText(c) {
  const res = c.resources || {};
  const ram = res.mem?.available != null ? `${(res.mem.available / 2 ** 30).toFixed(1)} GB ${tt('free')}` : '';
  const slots = c.limits ? `${c.limits.running}/${c.limits.maxAgents}` : '';
  return [slots && tt('{n} agents', { n: slots }), ram].filter(Boolean).join(' · ');
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
