// SPDX-License-Identifier: Apache-2.0
// Edit Mode: drag desks and devices, rotate, add or remove devices, layout presets and appearance.
// Everything is a draft previewed in 3D until "Save", which writes floor.json (and team.json for looks).
import { $, esc, api, toast, avatar } from './lib.js';
import { checkLayout, problemsOf } from './nav.js';
import { desksFor, presetSpots, loungeFor, FW, FD, LAYOUT_NAMES, toRoom, toBase, layoutToRoom } from './layout.js';
import { DEVICE_LABELS } from './scene.js';
import { ctx } from './ctx.js';
import { t } from './i18n.js';

const STYLES = ['bob', 'spiky', 'pony', 'buns', 'farmer'];
let draft = null, selected = null, drag = null, base = null;
const round = (n) => +n.toFixed(2);
// the draft keeps saved coordinates; the scene, the pointer and the checks are in the (wider) room's (layout.js)
const check = () => checkLayout(layoutToRoom(draft), { sizes: ctx.scene.floors.get(draft.id)?.sizes });

function enter() {
  const f = ctx.state.floor;
  if (!f || f.missing) return;
  ctx.editing = true;
  ctx.scene.use?.('three');                         // Edit Mode works on the 3D scene (ui/renderer.js)
  draft = {
    id: f.id, layout: f.floor.layout,
    desks: desksFor(f.agents, f.floor.desks, f.floor.layout).map((d) => ({ ...d })),
    devices: f.floor.devices.map((d) => ({ ...d })),
    appearance: {},
  };
  base = JSON.stringify(draft);
  selected = null;
  ctx.scene.draft = draft;
  ctx.scene.setView({ mode: 'floor', floorId: f.id });
  ctx.scene._viewKey = null;
  $('elevator').hidden = true;
  bindPointer(true);
  drawBar(); drawPanel(); ctx.render();
  if (ctx.isPhone()) ctx.scene.setInsets({ ...ctx.scene.insets, top: $('editBar').getBoundingClientRect().bottom + 6 });   // fit below the bar
}

function exit() {
  ctx.editing = false;
  draft = null; selected = null;
  ctx.scene.draft = null;
  ctx.scene.select(null, null);
  ctx.scene._viewKey = null;
  $('editBar').hidden = true;
  bindPointer(false);
  for (const id of ['sideTop', 'sideMain', 'sideTabs', 'sheetTabs', 'sheetBody']) $(id)._html = null;
  ctx.render();
  ctx.updateInsets();
}

const dirty = () => draft && JSON.stringify(draft) !== base;
function rebuild() { ctx.render(); }

// ---------- bar ----------
function drawBar() {
  const bar = $('editBar');
  bar.hidden = false;
  const sel = selected ? (selected.agent ? draft.desks.find((d) => d.agent === selected.agent) : draft.devices.find((d) => d.id === selected.device)) : null;
  const agentName = selected?.agent ? ctx.state.floor.agents.find((a) => a.id === selected.agent)?.displayName : '';
  bar.innerHTML = `<span class="lbl">${t('Edit Mode')}</span>
    <select id="eLayout" style="width:auto" aria-label="${t('Layout preset')}" title="${t('Layout preset')}">${Object.entries(LAYOUT_NAMES).map(([k, v]) => `<option value="${k}" ${k === draft.layout ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select id="eDevType" style="width:auto" aria-label="${t('Device type')}">${Object.entries(DEVICE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button id="eAddDev" title="${t('Add device')}">${t('+ Add')}</button>
    ${sel ? `<span class="chip">${esc(selected.agent ? t('Desk: {name}', { name: agentName }) : DEVICE_LABELS[sel.type])}</span>
      <button id="eRotL" title="${t('Rotate left (Q)')}" aria-label="${t('Rotate left')}">⟲</button><button id="eRotR" title="${t('Rotate right (E)')}" aria-label="${t('Rotate right')}">⟳</button>
      ${selected.agent ? `<button id="eDeskDev">${sel.device === 'dual-monitor' ? t('Laptop') : t('Dual monitor')}</button>` : `<button id="eDel" class="danger">${t('Remove')}</button>`}` : `<span class="note hideSm">${t('Drag desks and devices; click one to rotate it.')}</span>`}
    <button id="eCancel" class="ghost">${t('Cancel')}</button><button id="eSave" class="gold">${t('Save')}</button>`;
  $('eLayout').onchange = (e) => {
    const v = e.target.value;
    draft.layout = v;
    const spots = presetSpots(ctx.state.floor.agents.length, v);
    draft.desks = ctx.state.floor.agents.map((a, i) => ({ agent: a.id, ...spots[i], device: draft.desks.find((d) => d.agent === a.id)?.device || 'laptop' }));
    // the lounge moves with the preset; it is added when the Floor has none
    const lounge = loungeFor(v);
    for (const type of Object.keys(lounge)) {
      const dev = draft.devices.find((d) => d.type === type);
      if (dev) Object.assign(dev, lounge[type]); else draft.devices.push({ id: `${type}-1`, type, ...lounge[type] });
    }
    rebuild();
  };
  $('eAddDev').onclick = () => {
    const type = $('eDevType').value;
    let n = 1; while (draft.devices.some((d) => d.id === `${type}-${n}`)) n++;
    const dev = { id: `${type}-${n}`, type, x: round((Math.random() - .5) * 3), z: round(toBase({ x: 0, z: FD / 2 - 1.6 }).z), ry: 0 };
    draft.devices.push(dev);
    selected = { device: dev.id };
    rebuild(); select();
  };
  const rotate = (k) => {
    if (!sel) return;
    const id = selected.agent || selected.device, before = problemsOf(check(), id).length, prev = sel.ry || 0;
    sel.ry = round((prev + k * Math.PI / 4) % (Math.PI * 2));
    const bad = problemsOf(check(), id);
    if (bad.length > before) { sel.ry = prev; toast(t('Cannot turn it here: it {reason}.', { reason: bad[0].reason }), 3500); return; }
    const g = ctx.scene.objectFor(draft.id, selected); if (g) g.rotation.y = sel.ry;
  };
  $('eRotL') && ($('eRotL').onclick = () => rotate(1));
  $('eRotR') && ($('eRotR').onclick = () => rotate(-1));
  $('eDeskDev') && ($('eDeskDev').onclick = () => { sel.device = sel.device === 'dual-monitor' ? 'laptop' : 'dual-monitor'; rebuild(); drawBar(); });
  $('eDel') && ($('eDel').onclick = () => { draft.devices = draft.devices.filter((d) => d.id !== selected.device); selected = null; rebuild(); select(); });
  $('eCancel').onclick = () => { if (!dirty() || confirm(t('Discard your layout changes?'))) exit(); };
  $('eSave').onclick = save;
}

function select() { ctx.scene.select(draft.id, selected); drawBar(); }

// ---------- appearance panel ----------
function drawPanel() {
  const f = ctx.state.floor;
  const rows = f.agents.map((a) => {
    const ap = { ...a.appearance, ...(draft.appearance[a.id] || {}) };
    return `<div class="card" data-look="${esc(a.id)}"><div class="agent">${avatar({ ...a, appearance: ap })}<div class="meta"><div class="name ellipsis">${esc(a.displayName)}</div></div></div>
      <div class="row wrap" style="margin-top:8px"><select data-k="style" style="width:auto" aria-label="${t('Hair style')}">${STYLES.map((s) => `<option ${ap.style === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <input type="color" data-k="shirt" value="${esc(ap.shirt || '#3d82d6')}" title="${t('Shirt')}" aria-label="${t('Shirt colour')}"><input type="color" data-k="hair" value="${esc(ap.hair || '#2b2440')}" title="${t('Hair')}" aria-label="${t('Hair colour')}">
        <input type="color" data-k="skin" value="${esc(ap.skin || '#f6d2b0')}" title="${t('Skin')}" aria-label="${t('Skin colour')}"><label class="inline" style="margin:0"><input type="checkbox" data-k="glasses" ${ap.glasses ? 'checked' : ''}> ${t('Glasses')}</label></div></div>`;
  }).join('');
  ctx.layoutPanels([{ id: 'edit', title: t('Edit Mode'), card: 'main', html: `
    <p class="note" style="margin-top:0">${t('Drag desks and devices on the floor. Q / E rotate the selection, Delete removes a device. Pick a preset in the bar to rearrange all desks and the lounge. Idle agents walk to the sofa, beanbags, pantry, ping-pong table and whiteboard.')}</p>
    <div class="sectionHead" style="margin-top:14px"><h3 class="grow">${t('Appearance')}</h3></div>${rows || `<div class="empty">${t('No agents on this Floor.')}</div>`}` }]);
  const panel = ctx.panelBody();
  panel.querySelectorAll('[data-look]').forEach((card) => card.addEventListener('input', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    const id = card.dataset.look;
    draft.appearance[id] = { ...(draft.appearance[id] || {}), [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value };
    clearTimeout(drawPanel.t); drawPanel.t = setTimeout(rebuild, 120);
  }));
}

// ---------- dragging in 3D ----------
const el = () => ctx.scene.renderer.domElement;
function onDown(e) {
  const hit = ctx.scene.pick(e);
  if (hit.floorId !== draft.id || (!hit.agent && !hit.device)) { selected = null; select(); return; }
  selected = hit.agent ? { agent: hit.agent } : { device: hit.device };
  select();
  const item = hit.agent ? draft.desks.find((d) => d.agent === hit.agent) : draft.devices.find((d) => d.id === hit.device);
  const p = ctx.scene.floorPoint(e, draft.id);
  if (!item || !p) return;
  const at = toRoom(item);
  drag = { item, id: hit.agent || hit.device, from: { x: item.x, z: item.z }, before: problemsOf(check(), hit.agent || hit.device).length, dx: at.x - p.x, dz: at.z - p.z, moved: false };
  ctx.scene.controls.enabled = false;
  el().setPointerCapture(e.pointerId);
  e.stopPropagation();
}
function onMove(e) {
  if (!drag) return;
  const p = ctx.scene.floorPoint(e, draft.id);
  if (!p) return;
  const at = { x: Math.max(-FW / 2 + .6, Math.min(FW / 2 - .6, p.x + drag.dx)), z: Math.max(-FD / 2 + .6, Math.min(FD / 2 - .4, p.z + drag.dz)) };
  const b = toBase(at); drag.item.x = round(b.x); drag.item.z = round(b.z);
  drag.moved = true;
  const g = ctx.scene.objectFor(draft.id, selected);
  if (g) { g.position.x = at.x; g.position.z = at.z; }
  drag.bad = problemsOf(check(), drag.id).length > drag.before;    // red ghost: worse than before the drag
  ctx.scene.warnSelection(drag.bad);
}
function onUp(e) {
  if (!drag) return;
  // nothing may stand inside anything else, and every desk must stay reachable: such a drop is undone
  if (drag.bad) {
    const why = problemsOf(check(), drag.id)[0];
    Object.assign(drag.item, drag.from);
    const g = ctx.scene.objectFor(draft.id, selected), back = toRoom(drag.from); if (g) { g.position.x = back.x; g.position.z = back.z; }
    toast(why ? t('Not here: it {reason}. Leave room to walk around it.', { reason: why.reason }) : t('Not here: leave room to walk around it.'), 4000);
  }
  ctx.scene.warnSelection(false);
  drag = null;
  ctx.scene.controls.enabled = true;
  try { el().releasePointerCapture(e.pointerId); } catch { /* already released */ }
}
function onKey(e) {
  if (!ctx.editing || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (e.key === 'q' || e.key === 'Q') $('eRotL')?.click();
  else if (e.key === 'e' || e.key === 'E') $('eRotR')?.click();
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selected?.device) $('eDel')?.click();
  else if (e.key === 'Escape') $('eCancel')?.click();
}
function bindPointer(on) {
  const m = on ? 'addEventListener' : 'removeEventListener';
  el()[m]('pointerdown', onDown, true);
  el()[m]('pointermove', onMove);
  el()[m]('pointerup', onUp);
  document[m]('keydown', onKey);
}

// ---------- save ----------
async function save() {
  const btn = $('eSave'); btn.disabled = true;
  try {
    await api('PATCH', `/api/floors/${draft.id}`, { layout: draft.layout, desks: draft.desks, devices: draft.devices });
    for (const [id, look] of Object.entries(draft.appearance)) await api('PATCH', `/api/floors/${draft.id}/agents/${id}`, { appearance: look });
    toast(t('Layout saved to floor.json'));
    exit();
    await ctx.refresh();
  } catch (e) { toast(e.message); btn.disabled = false; }
}

ctx.actions['edit-mode'] = enter;
