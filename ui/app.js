// The AI Squad UI: routing (#/, #/floor/<id>, #/floor/<id>/desk/<agent>), polling, panels, actions.
import { BuildingScene } from './scene.js';
import { $, esc, money, gb, toast, api, askPin, hasPin, getJson, fetchImage, openModal, STATE_TEXT } from './lib.js';
import { lobbySections, floorSections, deskSections, attentionHtml, boardHtml } from './views.js';
import { ctx } from './ctx.js';
import './dialogs.js';
import './edit.js';
import './perf.js';
import './independents.js';
import './setup.js';
import './meter.js';
import './cost.js';
import { shoutStep, floorIdle, speak, voiceOn, setVoice } from './shout.js';

const state = ctx.state;
const isPhone = () => matchMedia('(max-width: 760px)').matches;

// ---------- routing ----------
function parseRoute() {
  const m = location.hash.match(/^#\/floor\/([\w-]+)(?:\/desk\/([\w-]+)(?:\/(screen|eyes))?)?/);
  if (!m) return { mode: 'lobby' };
  return m[2] ? { mode: 'desk', floorId: m[1], agentId: m[2], ...(m[3] ? { [m[3]]: true } : {}) } : { mode: 'floor', floorId: m[1] };
}
const routeKey = (r) => [r.mode, r.floorId, r.agentId, r.screen ? 'screen' : r.eyes ? 'eyes' : ''].join('/');

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
  onPickScreen: (floorId, agentId) => { if (!ctx.editing && state.route.floorId === floorId) location.hash = `#/floor/${floorId}/desk/${agentId}/screen`; },
  onPickRack: () => { if (!ctx.editing) ctx.actions.meter(); },
  onPickEyes: (floorId, agentId) => { if (!ctx.editing && state.route.floorId === floorId) location.hash = `#/floor/${floorId}/desk/${agentId}/eyes`; },
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
    const jobs = [getJson('/api/building')];
    if (r.floorId) jobs.push(getJson(`/api/floors/${r.floorId}`));
    let b, f;
    try { [b, f] = await Promise.all(jobs); }
    catch (e) {
      if (e.status !== 401) throw e;
      // server bound off loopback: reads need the PIN as well
      inflight = false;
      if (!document.querySelector('#pinDlg[open]') && await askPin()) return refresh();
      toast('This server needs the PIN to show anything. Menu → Enter PIN.', 6000);
      timer = setTimeout(refresh, 15000);
      return;
    }
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
  if (!state.building) return void (timer = setTimeout(refresh, 4000));
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
  if (!f) return [{ id: 'loading', title: 'Floor', card: 'main', html: '<div class="empty">Loading…</div>' }];
  const fs = floorSections(f, route.agentId);
  if (route.mode === 'floor') return fs;
  // desk: the desk card replaces the agent list; questions for the owner stay on top
  return [...fs.filter((s) => s.card === 'top'), ...deskSections(f, desk, { locked: state.locked, screen: !!route.screen })];
}

const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
function tabsHtml(list, active, group) {
  return list.map((s) => `<button role="tab" data-tab="${group}:${s.id}" aria-selected="${s.id === active}">${s.icon ? icon(s.icon) : ''}${esc(s.title)}${s.count ? `<span class="count ${s.countClass || ''}">${s.count}</span>` : ''}</button>`).join('');
}

// set innerHTML only when it changed and the user is not typing inside; keep scroll positions and slots
function patch(el, html) {
  if (el._html === html) return;
  const active = document.activeElement;
  if (active && el.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && !active.closest('[data-slot]')) return;
  const scrolls = {};
  el.querySelectorAll('[data-scroll]').forEach((s) => { scrolls[s.dataset.scroll] = { top: s.scrollTop, bottom: s.scrollHeight - s.scrollTop - s.clientHeight < 24 }; });
  const bodies = [...el.querySelectorAll('.cardBody')].map((x) => x.scrollTop);
  const bodyTop = el.scrollTop;
  for (const slot of el.querySelectorAll('[data-slot]')) for (const c of [...slot.children]) c.remove();   // keep slot nodes alive
  el.innerHTML = html;
  el._html = html;
  el.querySelectorAll('[data-slot="task"]').forEach((s) => s.appendChild(getTaskForm()));
  el.querySelectorAll('[data-scroll]').forEach((s) => { const p = scrolls[s.dataset.scroll]; s.scrollTop = !p || p.bottom ? s.scrollHeight : p.top; });
  el.querySelectorAll('.cardBody').forEach((x, i) => { x.scrollTop = bodies[i] || 0; });
  el.scrollTop = bodyTop;
}

// one floating card: an optional back link, tabs when it holds several sections, the active section's body
function cardHtml(list, group) {
  const pick = () => { const cur = state.tab[group]; return list.find((s) => s.id === cur) ? cur : list[0]?.id; };
  const active = pick(), sec = list.find((s) => s.id === active);
  const back = list[0]?.back ? `<a class="backLink" href="${list[0].back}">${icon('left')}All agents</a>` : '';
  const head = list.length > 1 ? `<div class="tabs" role="tablist">${tabsHtml(list, active, group)}</div>` : sec.head || `<div class="cardHead"><h3>${esc(sec.title)}</h3>${sec.count ? `<span class="count ${sec.countClass || ''}">${sec.count}</span>` : ''}</div>`;
  const hide = group === 'main' ? `<button class="ib collapse" data-act="hide-side" title="Hide the panel" aria-label="Hide the panel">${icon('right')}</button>` : '';
  return `${hide}${back}${head}<div class="cardBody">${sec.html}</div>`;
}

function layoutPanels(sections) {
  const phone = isPhone();
  if (state.route.eyes) {                                  // first person: only the 3D view and the small bar
    $('side').hidden = $('sheet').hidden = $('sideShow').hidden = true;
    return updateInsets();
  }
  if (phone) {
    $('side').hidden = $('sideShow').hidden = true;
    // the sheet opens on what the place is about (Desk, Agents, Floors); questions for the owner are the next tab
    sections = [...sections.filter((x) => x.card === 'main'), ...sections.filter((x) => x.card === 'top'), ...sections.filter((x) => x.card !== 'main' && x.card !== 'top')];
    const sheet = $('sheet');
    sheet.hidden = !sections.length;
    const cur = state.tab.sheet, active = sections.find((x) => x.id === cur) ? cur : sections[0]?.id;
    patch($('sheetTabs'), tabsHtml(sections, active, 'sheet'));
    const sec = sections.find((x) => x.id === active);
    patch($('sheetBody'), sec ? `${sec.back ? `<a class="backLink" href="${sec.back}">${icon('left')}All agents</a>` : ''}${sec.head || ''}${sec.html}` : '');
  } else {
    $('sheet').hidden = true;
    const hidden = state.sideHidden && !ctx.editing;
    $('side').hidden = hidden || !sections.length;
    $('sideShow').hidden = !hidden;
    const groups = { top: sections.filter((x) => x.card === 'top'), main: sections.filter((x) => x.card === 'main'), tabs: sections.filter((x) => !x.card || x.card === 'tabs') };
    // each "top" section is its own card (questions for the owner); main and tabs are one card each
    const topEl = $('sideTop');
    topEl.hidden = !groups.top.length;
    if (groups.top.length) patch(topEl, groups.top.map((x) => `<div class="cardHead"><h3 class="bad">${icon('alert')}${esc(x.title)}</h3><span class="count bad">${x.count}</span></div><div class="cardBody">${x.html}</div>`).join(''));
    for (const [id, list, group] of [['sideMain', groups.main, 'main'], ['sideTabs', groups.tabs, 'tabs']]) {
      $(id).hidden = !list.length;
      if (list.length) patch($(id), cardHtml(list, group));
    }
    // without a tabs card the main card takes the height; with one, the main card shrinks to its content
    $('sideMain').classList.toggle('grow', !groups.tabs.length);
    $('side').classList.toggle('wide', state.route.mode === 'desk');
  }
  updateInsets();
}

let insetKey = '', shotKey = '';
function updateInsets() {
  // hidden elements, and those hidden by CSS (screen view, first person), take no room
  const phone = isPhone(), r = (id) => { if ($(id).hidden) return null; const b = $(id).getBoundingClientRect(); return b.width && b.height ? b : null; };
  const hud = r('hud'), dock = r('dock'), side = r('side'), sheet = r('sheet'), elev = r('elevator');
  let insets;
  if (state.route.eyes) insets = {};
  else if (phone) insets = { top: (hud ? hud.bottom : 0) + 8, bottom: (sheet ? innerHeight - sheet.top : 0) + (dock ? dock.height + 14 : 0) };
  else insets = { top: (hud ? hud.bottom : 0) + 12, bottom: (dock ? innerHeight - dock.top : 0) + 12, right: side ? innerWidth - side.left + 12 : 0, left: elev ? elev.right + 12 : 0 };
  const k = JSON.stringify(insets);
  if (k !== insetKey) { insetKey = k; scene.setInsets(insets); }
}

// ---------- hud (top-left status pill) ----------
function hudHtml(b, route, f) {
  const att = b.attention.length;
  const attPill = att ? `<button class="hpill alert" data-pop="attPop" aria-haspopup="true" aria-expanded="false">${icon('alert')}${att} need${att === 1 ? 's' : ''} you</button>` : '';
  const menu = `<button class="iconBtn" data-pop="menu" aria-haspopup="true" aria-expanded="false" title="Menu" aria-label="Menu">${icon('menu')}</button>`;
  if (route.mode === 'lobby' || !f) {
    const working = b.floors.reduce((n, x) => n + (x.counts?.working || 0), 0), agents = b.floors.reduce((n, x) => n + (x.agents?.length || 0), 0);
    return `<div class="bar"><span class="brandMark" aria-hidden="true"></span><b class="brand">${esc(b.name || 'The AI Squad')}</b><span class="sep"></span>
      <span class="meta"><b>${b.floors.length}</b> Floors · <b>${working}</b>/${agents} working</span>${menu}</div>${attPill}`;
  }
  const c = f.counts || {}, active = (c.working || 0) + (c.waiting || 0), board = state.floor?.id === f.id ? state.floor.board : null;
  const tasks = board?.tasks || [], done = tasks.filter((t) => t.column === 'DONE').length;
  const progress = tasks.length ? `<span class="sep"></span><button class="sprintBtn" data-act="board" title="Open the board">${board.sprint ? `<b>Sprint ${esc(board.sprint)}</b>` : '<b>Board</b>'}<span class="prog"><i style="width:${Math.round(done / tasks.length * 100)}%"></i></span><span class="meta">${done}/${tasks.length}</span></button>` : '';
  let warn = '';
  if (!f.independent && !f.missing) {
    if (f.budget?.level === 'over') warn = `<span class="hpill warn">${icon('alert')}Budget reached</span>`;
    else if (f.agents.length && !f.agents.some((a) => a.running)) warn = `<button class="hpill warn" data-act="start-all" title="Start every agent of this Floor">${icon('alert')}Squad not running</button>`;
    else if (f.budget?.level === 'warn') warn = `<span class="hpill warn">${icon('alert')}Budget ${Math.round(f.budget.pct)} %</span>`;
  }
  return `<div class="bar"><a class="iconBtn" href="#/" title="Lobby" aria-label="Back to the Lobby">${icon('building')}</a><span class="lamp ${f.lamp}"></span>
    <b class="brand ellipsis">${f.number} · ${esc(f.name)}</b>${progress}<span class="sep"></span><span class="meta"><b>${active}</b>/${f.agents.length} active</span>
    ${f.independent || f.missing ? '' : `<button class="iconBtn" data-pop="floorMenu" aria-haspopup="true" aria-expanded="false" title="Floor menu" aria-label="Floor menu">${icon('more')}</button>`}${menu}</div>${warn}${attPill}`;
}

function floorMenuHtml(f) {
  const any = (fn) => f.agents.some(fn);
  return [['floor-settings', 'Floor settings'], ['edit-mode', 'Edit layout and looks'], ['add-agent', 'Add agent'],
    ...(any((a) => !a.running) ? [['start-all', 'Start all agents']] : []), ...(any((a) => a.running) ? [['stop-all', 'Stop all agents']] : []),
    ...(f.board ? [['board', 'Board']] : []), ...(f.workflow === 'squad-sprint' ? [['performance', 'Performance']] : []), ['cost', 'Cost']]
    .map(([act, text]) => `<button role="menuitem" data-act="${act}">${text}</button>`).join('');
}

// ---------- dock (icons, bottom centre) ----------
const WORST = (m) => {
  if (!m) return { level: 'ok', text: '–' };
  const L = m.levels || {}, pct = (u, t) => (t ? Math.round(u / t * 100) : 0);
  const items = [['cpu', `CPU ${Math.round(m.cpu)}%`, m.cpu], ['ram', `RAM ${pct(m.mem.used, m.mem.total)}%`, pct(m.mem.used, m.mem.total)], ['swap', `Swap ${pct(m.swap.used, m.swap.total)}%`, pct(m.swap.used, m.swap.total)],
    ['disk', m.disk ? `Disk ${gb(m.disk.free)}` : 'Disk', m.disk ? 100 - pct(m.disk.free, m.disk.total) : 0]];
  const rank = { bad: 2, warn: 1, ok: 0 };
  items.sort((x, y) => (rank[L[y[0]]] || 0) - (rank[L[x[0]]] || 0) || y[2] - x[2]);
  return { level: L.overall || 'ok', text: items[0][1] };
};
function dockHtml(b, route, f) {
  const btn = (act, ic, tip, extra = '', label = '') => `<button class="dk" data-act="${act}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" ${extra}>${icon(ic)}${label ? `<span>${label}</span>` : ''}</button>`;
  const w = WORST(b.meter), voice = voiceOn(), floor = route.mode !== 'lobby' && f && !f.missing;
  const out = [];
  if (!floor) out.push(btn('setup-squad', 'spark', 'Set up Squad', '', 'Set up Squad'), '<span class="dsep"></span>');
  if (floor && state.floor?.board) out.push(btn('board', 'board', 'Board'));
  if (floor && f.workflow === 'squad-sprint') out.push(btn('performance', 'chart', 'Performance and cost projection'));
  out.push(btn('cost', 'coin', floor ? 'Cost of this Floor' : 'Cost of all Floors', '', money(floor ? f.cost.today : b.costToday)));
  out.push(`<button class="dk ${w.level}" data-act="meter" data-tip="Server meter: CPU, RAM, swap and disk" aria-label="Server meter, ${esc(w.text)}">${icon('server')}<i class="sdot ${w.level}"></i><span>${esc(w.text)}</span></button>`);
  out.push('<span class="dsep"></span>');
  if (floor && !f.independent) out.push(btn('add-agent', 'user-plus', 'Add agent'));
  out.push(btn('voice', voice ? 'vol' : 'mute', `Lead voice: ${voice ? 'on' : 'off'}`, `aria-pressed="${voice}"`));
  out.push(`<button class="dk" data-pop="legendPop" data-tip="Legend and controls" aria-label="Legend and controls" aria-expanded="false">${icon('info')}</button>`);
  return out.join('');
}

const LEGEND = `<div class="lgGrid"><span><i class="st working">working</i></span><span><i class="st waiting">needs you</i></span><span><i class="st idle">idle</i></span><span><i class="st stopped">stopped</i></span></div>
  <ul class="lgList"><li><b>Click a character</b> to look through its eyes</li><li><b>Click a name chip</b> for the desk</li><li><b>Click a monitor</b> for the screen view</li>
  <li><b>Drag</b> to move around, <b>scroll</b> to zoom</li><li><b>Esc</b> goes back one level</li></ul>`;

// ---------- render ----------
function render() {
  const { building: b, route } = state;
  if (!b) return;
  // screen view and first person view: no hud or dock, just the scene
  document.body.classList.toggle('immersive', !!(route.screen || route.eyes));
  document.body.classList.toggle('pov', !!route.eyes);
  const f = b.floors.find((x) => x.id === route.floorId);
  const desk = f && route.agentId ? f.agents.find((a) => a.id === route.agentId) : null;
  $('povBar').hidden = !route.eyes;
  if (route.eyes) patch($('povText'), desk ? `<i class="dot ${desk.state}"></i> Through the eyes of <b>${esc(desk.displayName)}</b> · ${esc(desk.activity && desk.state !== 'stopped' ? desk.activity : STATE_TEXT[desk.state] || '')}` : 'First person view');
  patch($('hud'), hudHtml(b, route, f));
  scene.setLoad(b.meter);
  if (!$('attPop').hidden) patch($('attPop'), `<div class="cardHead"><h3>Needs you</h3><span class="count bad">${b.attention.length}</span></div>${attentionHtml(b.attention)}`);
  if (!$('floorMenu').hidden && f) patch($('floorMenu'), floorMenuHtml(f));
  if (state.offline) toast('Server not reachable, retrying…');

  $('dock').hidden = !!ctx.editing;
  patch($('dock'), dockHtml(b, route, f));
  // lead shout when the whole team of the Floor in view is idle
  if (state.floor && !state.floor.missing && route.floorId === state.floor.id) {
    const { idle, lead } = floorIdle(state.floor);
    const text = shoutStep(shouts[state.floor.id] ||= {}, idle, Date.now());
    if (text && lead) { scene.say(state.floor.id, lead.id, text); speak(text); }
  }
  // elevator (Floor switcher): a slim card on the left
  const elev = $('elevator');
  elev.hidden = route.mode === 'lobby' || ctx.editing || !!route.eyes || isPhone();
  if (!elev.hidden) {
    const floors = [...b.floors].sort((x, y) => y.number - x.number);
    patch(elev, `${floors.map((x) => `<button data-href="#/floor/${x.id}" aria-current="${x.id === route.floorId}" data-tip="${x.number} · ${esc(x.name)}" aria-label="Floor ${x.number}: ${esc(x.name)}">${x.number}<i class="l lamp ${x.lamp}"></i></button>`).join('')}<button data-href="#/" data-tip="Lobby" aria-label="Lobby">L</button>`);
  }

  // 3D
  const floorsForScene = b.floors.map((x) => (state.floor && state.floor.id === x.id ? { ...x, desks: state.floor.desks, devices: state.floor.devices } : x));
  scene.sync(floorsForScene);
  const viewKey = routeKey(route) + (state.desk ? '' : '-');
  if (!ctx.editing && scene._viewKey !== viewKey) { scene._viewKey = viewKey; scene.setView({ ...route }); }

  // monitors: live tmux text in the over-the-shoulder view, latest QA screenshot on QA screens
  scene.setLiveText(route.screen && state.desk?.running ? state.desk.screen : null);
  if (state.floor && !state.floor.missing) scene.setBoard(state.floor.id, { board: state.floor.board, agents: state.floor.agents.map((x) => ({ name: x.displayName, state: x.state, activity: x.activity })) });
  const shot = state.floor?.shots?.[0];
  if (state.floor && shot && shotKey !== `${state.floor.id}:${shot.file}:${shot.mtime}`) {
    shotKey = `${state.floor.id}:${shot.file}:${shot.mtime}`;
    const fid = state.floor.id;
    fetchImage(`/api/floors/${fid}/shot?f=${encodeURIComponent(shot.file)}`).then((img) => img && scene.setShot(fid, { file: shot.file, img }));
  }
  if (!ctx.editing) layoutPanels(lastSections = sectionsFor());
  // phones: the dock sits just above the bottom sheet; the camera frames the space left between them
  const dockBottom = isPhone() && !$('sheet').hidden ? `${innerHeight - $('sheet').getBoundingClientRect().top + 8}px` : '';
  if ($('dock').style.bottom !== dockBottom) { $('dock').style.bottom = dockBottom; updateInsets(); }
  ctx.afterRender?.();
}
ctx.render = render;
ctx.layoutPanels = layoutPanels;
ctx.updateInsets = () => { insetKey = ''; updateInsets(); };
ctx.isPhone = isPhone;
ctx.panelBody = () => (isPhone() ? $('sheetBody') : $('sideMain'));

// ---------- popovers (menu, Floor menu, attention, legend) ----------
const POPS = ['menu', 'floorMenu', 'attPop', 'legendPop'];
function closePopovers() {
  for (const id of POPS) $(id).hidden = true;
  document.querySelectorAll('[data-pop]').forEach((x) => x.setAttribute('aria-expanded', 'false'));
}
function openPopover(id, anchor) {
  const was = !$(id).hidden;
  closePopovers();
  if (was) return;
  const el = $(id), r = anchor.getBoundingClientRect();
  if (id === 'floorMenu') { const f = state.building.floors.find((x) => x.id === state.route.floorId); if (!f) return; el._html = null; patch(el, floorMenuHtml(f)); }
  if (id === 'attPop') { el._html = null; patch(el, `<div class="cardHead"><h3>Needs you</h3><span class="count bad">${state.building.attention.length}</span></div>${attentionHtml(state.building.attention)}`); }
  if (id === 'legendPop') patch(el, LEGEND);
  el.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  // under hud buttons, above dock buttons, kept on screen
  const below = r.top < innerHeight / 2, w = el.offsetWidth;
  Object.assign(el.style, { left: `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - (below ? 24 : w / 2)))}px`, top: below ? `${r.bottom + 8}px` : 'auto', bottom: below ? 'auto' : `${innerHeight - r.top + 8}px`, right: 'auto' });
}
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-pop]');
  if (p) { e.stopPropagation(); openPopover(p.dataset.pop, p); return; }
  if (!e.target.closest('.popover')) closePopovers();
}, true);
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (POPS.some((id) => !$(id).hidden)) return closePopovers();
  if (ctx.editing) return;
  if (state.route.eyes) location.hash = `#/floor/${state.route.floorId}`;
  else if (state.route.screen) location.hash = `#/floor/${state.route.floorId}/desk/${state.route.agentId}`;
  else if (state.route.mode === 'desk') location.hash = `#/floor/${state.route.floorId}`;
  else if (state.route.mode === 'floor') location.hash = '#/';
});
document.querySelector('[data-povback]').onclick = () => { location.hash = `#/floor/${state.route.floorId}`; };
document.querySelector('[data-povdesk]').onclick = () => { location.hash = `#/floor/${state.route.floorId}/desk/${state.route.agentId}`; };
$('grip').onclick = () => { $('sheet').classList.toggle('tall'); setTimeout(() => { render(); updateInsets(); }, 250); };
$('sideShow').onclick = () => { state.sideHidden = false; try { localStorage.removeItem('aisquad.sideHidden'); } catch { /* private mode */ } render(); };
try { state.sideHidden = localStorage.getItem('aisquad.sideHidden') === '1'; } catch { /* private mode */ }
addEventListener('resize', () => { for (const id of ['hud', 'dock', 'sideTop', 'sideMain', 'sideTabs', 'sheetTabs', 'sheetBody']) $(id)._html = null; render(); });

// ---------- actions (event delegation on data-act / data-href / data-tab) ----------
const shouts = {};
const actions = Object.assign(ctx.actions, {
  'hide-side'() { state.sideHidden = true; try { localStorage.setItem('aisquad.sideHidden', '1'); } catch { /* private mode */ } render(); },
  board() {
    const f = state.floor; if (!f) return;
    const body = openModal(`<div class="mHead"><h3 class="grow">Board · ${esc(f.name)}</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div><div class="mBody">${boardHtml(f)}</div>`);
    body.closest('dialog').classList.add('xwide');
    body.querySelector('[data-close]').onclick = () => body.closest('dialog').close();
  },
  voice() { const on = !voiceOn(); setVoice(on); if (on) speak('Voice is on, boss.'); render(); },
  async start(el) { await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/start`, {}); toast('Starting agent…'); },
  async restart(el) {
    if (!confirm('Restart this agent? Its Claude Code session is closed and a fresh one starts with the configured model and effort.')) return;
    await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/stop`, {});
    await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/start`, {});
    toast('Agent restarted');
  },
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
  async 'install-skill'(el) {
    const names = el.dataset.skill.split(',');
    const r = await api('POST', `/api/floors/${state.route.floorId}/skills/install`, { names });
    const n = r.results.filter((x) => x.installed).length;
    toast(n ? `Installed ${n} skill${n === 1 ? '' : 's'} into .claude/skills` : 'Already installed');
  },
  async copy(el) { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); } catch { toast(el.dataset.text, 6000); } },
});

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { const [group, id] = tab.dataset.tab.split(':'); state.tab[group] = id; layoutPanels(lastSections); return; }
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
// rows with data-href work with the keyboard too
document.addEventListener('keydown', (e) => {
  const nav = (e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-href][role=button]');
  if (nav) { e.preventDefault(); location.hash = nav.dataset.href; }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-act="answer-free"]');
  if (!f) return;
  e.preventDefault();
  try { await api('POST', `/api/attention/${f.dataset.id}/answer`, { option: +f.dataset.n, text: f.elements.text.value }); toast('Answer sent'); } catch (err) { toast(err.message); }
  refresh();
});
// theme: light (default) → dark → auto (follows the system), remembered per browser
const THEMES = { light: 'Light', dark: 'Dark', auto: 'Auto (system)' };
export function applyTheme() {
  const t = document.documentElement.dataset.theme || 'light';
  $('themeName').textContent = THEMES[t] || 'Light';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  scene.setTheme(dark, getComputedStyle(document.documentElement).getPropertyValue('--scene').trim());
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();
$('menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-menu]'); if (!b) return;
  closePopovers();
  if (b.dataset.menu === 'theme') {
    const order = Object.keys(THEMES), next = order[(order.indexOf(document.documentElement.dataset.theme) + 1) % order.length];
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('aisquad.theme', next); } catch { /* private mode */ }
    applyTheme(); toast(`Theme: ${THEMES[next]}`);
  } else if (b.dataset.menu === 'pin') askPin().then((ok) => ok && refresh());
  else if (b.dataset.menu === 'rename') {
    const name = prompt('Building name', state.building?.name || 'The AI Squad');
    if (name) api('PATCH', '/api/building', { name }).then(refresh, (err) => toast(err.message));
  } else actions[b.dataset.menu]?.(b);
});

// #/new-floor (from "/aisquad new-floor") opens the wizard over the Lobby
if (location.hash === '#/new-floor') {
  history.replaceState(null, '', '#/');
  const open = () => (state.building ? actions['new-floor']() : setTimeout(open, 300));
  setTimeout(open, 300);
}
state.route = parseRoute();
refresh();
