// The AI Squad UI: routing (#/, #/floor/<id>, #/floor/<id>/desk/<agent>), polling, panels, actions.
import { BuildingScene } from './scene.js';
import { $, esc, money, gb, toast, api, askPin, hasPin } from './lib.js';
import { lobbySections, floorSections, deskSections } from './views.js';
import { ctx } from './ctx.js';
import './dialogs.js';
import './edit.js';

const state = ctx.state;
const isPhone = () => matchMedia('(max-width: 760px)').matches;

// ---------- routing ----------
function parseRoute() {
  const m = location.hash.match(/^#\/floor\/([\w-]+)(?:\/desk\/([\w-]+))?/);
  if (!m) return { mode: 'lobby' };
  return m[2] ? { mode: 'desk', floorId: m[1], agentId: m[2] } : { mode: 'floor', floorId: m[1] };
}
const routeKey = (r) => [r.mode, r.floorId, r.agentId].join('/');

addEventListener('hashchange', () => {
  const prev = state.route;
  state.route = parseRoute();
  if (prev.floorId !== state.route.floorId) state.floor = null;
  if (prev.agentId !== state.route.agentId) { state.desk = null; resetTaskForm(); }
  if (prev.mode !== state.route.mode || prev.floorId !== state.route.floorId) state.tab = {};
  if (state.route.mode === 'desk' && prev.mode !== 'desk') state.tab.right = 'desk';
  closePopovers();
  render();
  refresh();
});

// ---------- scene ----------
const scene = new BuildingScene($('scene'), {
  onPickFloor: (id) => { if (state.route.mode === 'lobby' && !ctx.editing) location.hash = `#/floor/${id}`; },
  onPickAgent: (floorId, agentId) => { if (!ctx.editing && state.route.floorId === floorId) location.hash = `#/floor/${floorId}/desk/${agentId}`; },
});
ctx.scene = scene;
window.aisquad = ctx;                     // handy in the console and for scripted UI checks

// ---------- polling ----------
let timer = null, inflight = false;
async function refresh() {
  clearTimeout(timer);
  if (inflight) { timer = setTimeout(refresh, 400); return; }
  inflight = true;
  const r = state.route, key = routeKey(r);
  try {
    const jobs = [fetch('/api/building').then((x) => x.json())];
    if (r.floorId) jobs.push(fetch(`/api/floors/${r.floorId}`).then(async (x) => { if (x.status === 404) return { notFound: true }; return x.json(); }));
    const [b, f] = await Promise.all(jobs);
    state.building = b;
    if (key === routeKey(state.route)) state.floor = f || null;
    if (state.floor?.notFound) { toast('That Floor no longer exists'); location.hash = '#/'; }
    if (r.mode === 'desk' && hasPin()) {
      try { const d = await api('GET', `/api/floors/${r.floorId}/agents/${r.agentId}`, undefined, { quiet401: true }); if (key === routeKey(state.route)) state.desk = d; state.locked = false; }
      catch (e) { if (e.status === 401) state.locked = true; else if (e.status === 404) { toast('That agent is no longer on this Floor'); location.hash = `#/floor/${r.floorId}`; } }
    } else if (r.mode === 'desk') state.locked = true;
    state.offline = false;
  } catch { state.offline = true; }
  inflight = false;
  render();
  timer = setTimeout(refresh, document.hidden ? 15000 : r.mode === 'desk' ? 2000 : 3000);
}
ctx.refresh = refresh;
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

// ---------- persistent task form (survives re-renders) ----------
let taskForm = null, taskFiles = [];
function resetTaskForm() { taskForm = null; taskFiles = []; }
function getTaskForm() {
  if (taskForm) return taskForm;
  const f = document.createElement('form');
  f.className = 'taskBox';
  f.innerHTML = `<textarea name="text" placeholder="Describe the task. The agent gets it as a message in its Claude Code session." aria-label="Task" required></textarea>
    <div class="files" data-files></div>
    <div class="row" style="margin-top:8px"><label class="ghost" style="margin:0"><input type="file" multiple hidden data-file><span class="chip" style="cursor:pointer">+ Attach files</span></label><span class="spacer"></span><button class="gold" type="submit">Send task</button></div>`;
  f.querySelector('[data-file]').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      try {
        const r = await api('POST', `/api/floors/${state.route.floorId}/attachments`, undefined, { raw: file, headers: { 'x-filename': encodeURIComponent(file.name) } });
        taskFiles.push(r); drawFiles();
      } catch (err) { toast(`${file.name}: ${err.message}`); }
    }
    e.target.value = '';
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = f.elements.text.value.trim();
    if (!text) return;
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await api('POST', `/api/floors/${state.route.floorId}/agents/${state.route.agentId}/task`, { text, attachments: taskFiles.map((x) => x.path) });
      toast(r.queued ? r.note : 'Task sent');
      f.elements.text.value = ''; taskFiles = []; drawFiles();
      refresh();
    } catch (err) { toast(err.message); }
    btn.disabled = false;
  });
  f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) f.requestSubmit(); });
  function drawFiles() {
    f.querySelector('[data-files]').innerHTML = taskFiles.map((x, i) => `<span class="chip">${esc(x.name)} <button type="button" class="small ghost" data-rm="${i}" aria-label="Remove ${esc(x.name)}">×</button></span>`).join('');
    f.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { taskFiles.splice(+b.dataset.rm, 1); drawFiles(); });
  }
  taskForm = f;
  return f;
}

// ---------- layout ----------
state.tab = {};
let lastSections = [];

function sectionsFor() {
  const { route, building, floor, desk } = state;
  if (!building) return [];
  if (route.mode === 'lobby') return lobbySections(building);
  const f = floor && !floor.notFound ? floor : null;
  if (!f) return [{ id: 'loading', title: 'Floor', side: 'left', html: '<div class="empty">Loading…</div>' }];
  const fs = floorSections(f, route.agentId);
  if (route.mode === 'floor') return fs;
  // desk: the team list stays on the left, the desk takes the right side
  return [...fs.filter((s) => s.side === 'left'), ...deskSections(f, desk, { locked: state.locked })];
}

function tabsHtml(list, active, side) {
  return list.map((s) => `<button role="tab" data-tab="${side}:${s.id}" aria-selected="${s.id === active}">${esc(s.title)}${s.count ? `<span class="count ${s.countClass || ''}">${s.count}</span>` : ''}</button>`).join('');
}

// set innerHTML only when it changed and the user is not typing inside; keep scroll positions and slots
function patch(el, html) {
  if (el._html === html) return;
  const active = document.activeElement;
  if (active && el.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && !active.closest('[data-slot]')) return;
  const scrolls = {};
  el.querySelectorAll('[data-scroll]').forEach((s) => { scrolls[s.dataset.scroll] = { top: s.scrollTop, bottom: s.scrollHeight - s.scrollTop - s.clientHeight < 24 }; });
  const bodyTop = el.scrollTop;
  for (const slot of el.querySelectorAll('[data-slot]')) for (const c of [...slot.children]) c.remove();   // keep slot nodes alive
  el.innerHTML = html;
  el._html = html;
  el.querySelectorAll('[data-slot="task"]').forEach((s) => s.appendChild(getTaskForm()));
  el.querySelectorAll('[data-scroll]').forEach((s) => { const p = scrolls[s.dataset.scroll]; s.scrollTop = !p || p.bottom ? s.scrollHeight : p.top; });
  el.scrollTop = bodyTop;
}

function layoutPanels(sections) {
  const phone = isPhone();
  const left = sections.filter((s) => s.side === 'left'), right = sections.filter((s) => s.side === 'right');
  const pick = (list, side) => { const cur = state.tab[side]; return list.find((s) => s.id === cur) ? cur : list[0]?.id; };
  if (phone) {
    $('left').hidden = $('right').hidden = true;
    const all = state.route.mode === 'desk' ? [...right, ...left] : [...left, ...right];
    const sheet = $('sheet');
    sheet.hidden = !all.length;
    const active = pick(all, 'sheet');
    patch($('sheetTabs'), tabsHtml(all, active, 'sheet'));
    patch($('sheetBody'), all.find((s) => s.id === active)?.html || '');
  } else {
    $('sheet').hidden = true;
    for (const [side, list] of [['left', left], ['right', right]]) {
      const el = $(side);
      el.hidden = !list.length;
      if (!list.length) continue;
      if (!el._built) { el.innerHTML = '<div class="tabs" role="tablist"></div><div class="panelBody"></div>'; el._built = true; }
      const active = pick(list, side);
      const tabs = el.querySelector('.tabs');
      tabs.hidden = list.length < 2;
      patch(tabs, tabsHtml(list, active, side));
      patch(el.querySelector('.panelBody'), list.find((s) => s.id === active)?.html || '');
    }
    $('right').classList.toggle('wide', state.route.mode === 'desk');
  }
  updateInsets();
}

let insetKey = '';
function updateInsets() {
  const phone = isPhone(), top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 56;
  const insets = phone
    ? { top: top + ($('elevator').hidden ? 0 : 44), bottom: $('sheet').hidden ? 0 : $('sheet').getBoundingClientRect().height }
    : { top: top + 10, left: $('left').hidden ? 0 : $('left').offsetWidth + 12, right: ($('right').hidden ? 0 : $('right').offsetWidth + 12) + ($('elevator').hidden ? 0 : 56) };
  const k = JSON.stringify(insets);
  if (k !== insetKey) { insetKey = k; scene.setInsets(insets); }
}

// ---------- render ----------
function render() {
  const { building: b, route } = state;
  if (!b) return;
  // top bar
  const f = b.floors.find((x) => x.id === route.floorId);
  const desk = f && route.agentId ? f.agents.find((a) => a.id === route.agentId) : null;
  const trail = [['#/', route.mode === 'lobby' && b.name !== 'The AI Squad' ? b.name : 'Lobby']];
  if (f) trail.push([`#/floor/${f.id}`, `${f.number} · ${f.name}`]);
  if (desk) trail.push([null, desk.displayName]);
  const last = trail.length - 1;
  // phones get "‹ parent  current", desktops the whole trail
  const shown = isPhone() && last > 0 ? [[trail[last - 1][0], '‹'], trail[last]] : trail;
  patch($('crumbs'), shown.map(([href, text], i) => (i === shown.length - 1
    ? `<span class="cur">${esc(text)}</span>` : `<a href="${href}"${text === '‹' ? ' aria-label="Back" class="back"' : ''}>${esc(text)}</a>`)).join('<span class="sep">›</span>'));
  $('costChip').textContent = `today ${money(b.costToday)}`;
  const r = b.resources;
  $('resChip').className = `chip ${r.warnings.length ? 'warn' : ''}`;
  const swapPct = r.swap?.total ? Math.round(r.swap.used / r.swap.total * 100) : 0;
  $('resChip').textContent = r.warnings.length ? r.warnings[0].replace(/\s*\(.*\)$/, '') : `RAM ${gb(r.mem.available)} free · swap ${swapPct} %`;
  $('resChip').title = r.warnings.join('\n') || 'Machine resources are fine';
  $('attCount').textContent = b.attention.length;
  $('attBtn').classList.toggle('on', b.attention.length > 0);
  if (!$('attPop').hidden) patch($('attPop'), `<div class="sectionHead"><h3 class="grow">Attention</h3></div>${attentionPopHtml()}`);
  if (state.offline) toast('Server not reachable, retrying…');

  // elevator (Floor switcher)
  const elev = $('elevator');
  elev.hidden = route.mode === 'lobby' || ctx.editing;
  if (!elev.hidden) {
    const floors = [...b.floors].sort((x, y) => y.number - x.number);
    patch(elev, `<div class="cap">Floor</div>${floors.map((x) => `<button data-href="#/floor/${x.id}" aria-current="${x.id === route.floorId}" title="${x.number} · ${esc(x.name)}">${x.number}<i class="l lamp ${x.lamp}"></i></button>`).join('')}<button data-href="#/" title="Lobby">L</button>`);
    if (isPhone()) Object.assign(elev.style, { top: `calc(var(--top) + 6px)`, left: '8px', right: 'auto' });
    else Object.assign(elev.style, { top: `calc(var(--top) + 10px)`, right: `${($('right').hidden ? 0 : $('right').offsetWidth + 12) + 18}px`, left: 'auto' });
  }

  // 3D
  const floorsForScene = b.floors.map((x) => (state.floor && state.floor.id === x.id ? { ...x, desks: state.floor.desks, devices: state.floor.devices } : x));
  scene.sync(floorsForScene);
  const viewKey = routeKey(route) + (state.desk ? '' : '-');
  if (!ctx.editing && scene._viewKey !== viewKey) { scene._viewKey = viewKey; scene.setView({ ...route }); }

  if (!ctx.editing) layoutPanels(lastSections = sectionsFor());
  ctx.afterRender?.();
}
ctx.render = render;
ctx.layoutPanels = layoutPanels;
ctx.updateInsets = () => { insetKey = ''; updateInsets(); };
ctx.isPhone = isPhone;

function attentionPopHtml() {
  return lobbySections(state.building).find((s) => s.id === 'attention').html;
}

// ---------- popovers ----------
function closePopovers() {
  $('menu').hidden = true; $('attPop').hidden = true;
  $('menuBtn').setAttribute('aria-expanded', 'false'); $('attBtn').setAttribute('aria-expanded', 'false');
}
$('attBtn').onclick = (e) => {
  e.stopPropagation();
  const open = $('attPop').hidden;
  closePopovers();
  if (open && state.building) { $('attPop').hidden = false; $('attBtn').setAttribute('aria-expanded', 'true'); $('attPop')._html = null; render(); }
};
$('menuBtn').onclick = (e) => {
  e.stopPropagation();
  const open = $('menu').hidden;
  closePopovers();
  if (open) { $('menu').hidden = false; $('menuBtn').setAttribute('aria-expanded', 'true'); }
};
document.addEventListener('click', (e) => { if (!e.target.closest('.popover') && !e.target.closest('#attBtn') && !e.target.closest('#menuBtn')) closePopovers(); });
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (!$('menu').hidden || !$('attPop').hidden) return closePopovers();
  if (ctx.editing) return;
  if (state.route.mode === 'desk') location.hash = `#/floor/${state.route.floorId}`;
  else if (state.route.mode === 'floor') location.hash = '#/';
});
$('grip').onclick = () => { $('sheet').classList.toggle('tall'); setTimeout(updateInsets, 250); };
addEventListener('resize', () => { for (const id of ['left', 'right', 'sheetTabs', 'sheetBody']) $(id)._html = null; render(); });

// ---------- actions (event delegation on data-act / data-href / data-tab) ----------
const actions = Object.assign(ctx.actions, {
  async start(el) { await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/start`, {}); toast('Starting agent…'); },
  async stop(el) { await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/stop`, {}); toast('Agent stopped'); },
  async 'start-all'() { for (const a of state.floor.agents.filter((x) => !x.running)) await api('POST', `/api/floors/${state.route.floorId}/agents/${a.id}/start`, {}); toast('Starting the team…'); },
  async 'stop-all'() {
    if (!confirm('Stop every running agent on this Floor?')) return;
    for (const a of state.floor.agents.filter((x) => x.running)) await api('POST', `/api/floors/${state.route.floorId}/agents/${a.id}/stop`, {});
    toast('Team stopped');
  },
  async answer(el) { el.disabled = true; await api('POST', `/api/attention/${el.dataset.id}/answer`, { option: +el.dataset.n }); toast('Answer sent'); },
  async dismiss(el) { await api('POST', `/api/attention/${el.dataset.id}/answer`, { option: 0 }); toast('Dismissed'); },
  async 'work-done'(el) { await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/work-done`, {}); },
  async 'remove-floor'(el) {
    if (!confirm('Remove this Floor from the Building? The project directory and its files stay untouched.')) return;
    await api('DELETE', `/api/floors/${el.dataset.floor}`); toast('Floor removed'); location.hash = '#/';
  },
  async adopt(el) {
    const p = state.building.detected[+el.dataset.i];
    const r = await api('POST', '/api/floors/adopt', { path: p.root }); toast('Floor registered'); location.hash = `#/floor/${r.id}`;
  },
  async unlock() { if (await askPin()) refresh(); },
  async copy(el) { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); } catch { toast(el.dataset.text, 6000); } },
});

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { const [side, id] = tab.dataset.tab.split(':'); state.tab[side] = id; layoutPanels(lastSections); return; }
  const act = e.target.closest('[data-act]');
  if (act && act.tagName !== 'FORM') {
    const fn = actions[act.dataset.act];
    if (!fn) return;
    e.preventDefault();
    closePopovers();
    try { await fn(act); } catch (err) { if (err.status !== 401) toast(err.message); }
    refresh();
    return;
  }
  const nav = e.target.closest('[data-href]');
  if (nav && !e.target.closest('button[data-act], a, input, label')) location.hash = nav.dataset.href;
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-act="answer-free"]');
  if (!f) return;
  e.preventDefault();
  try { await api('POST', `/api/attention/${f.dataset.id}/answer`, { option: +f.dataset.n, text: f.elements.text.value }); toast('Answer sent'); } catch (err) { toast(err.message); }
  refresh();
});
$('menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-menu]'); if (!b) return;
  closePopovers();
  if (b.dataset.menu === 'pin') askPin().then((ok) => ok && refresh());
  else if (b.dataset.menu === 'rename') {
    const name = prompt('Building name', state.building?.name || 'The AI Squad');
    if (name) api('PATCH', '/api/building', { name }).then(refresh, (err) => toast(err.message));
  } else actions[b.dataset.menu]?.(b);
});

state.route = parseRoute();
refresh();
