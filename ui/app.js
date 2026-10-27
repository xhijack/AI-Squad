// SPDX-License-Identifier: Apache-2.0
// The AI Squad UI: routing (#/, #/floor/<id>, #/floor/<id>/desk/<agent>), polling, panels, actions.
import { createSceneHost } from './renderer.js';
import { OVERVIEWS, defaultOverview } from './scene-model.js';
import { $, esc, money, gb, toast, api, askPin, hasPin, getJson, fetchImage, openModal, STATE_TEXT, drafts, answerItem, itemContext, mdLite, ago } from './lib.js';
import { lobbySections, floorSections, deskSections, attentionHtml, boardHtml, needsYou, standupAgents } from './views.js';
import { ctx } from './ctx.js';
import './dialogs.js';
import './edit.js';
import './perf.js';
import './independents.js';
import './setup.js';
import './meter.js';
import './cost.js';
import './log.js';
import './audit.js';
import './improve.js';
import './docs.js';
import './retro.js';
import './ship.js';
import './design.js';
import './health.js';
import './signin.js';
import './admin.js';
import './people.js';
import './chat.js';
import { attentionIndexHtml } from './convo.js';
import { readAskForm } from './askform.js';
import { playLine } from './voice.js';
import { shoutStep, floorIdle, speak, voiceOn, setVoice } from './shout.js';
import { t as tt, tx, LANG, LANGS, setLang, translateDom } from './i18n.js';

translateDom();                                       // the static parts of index.html
$('langName').textContent = LANGS[LANG];

const state = ctx.state;
const isPhone = () => matchMedia('(max-width: 760px)').matches;

// ---------- routing ----------
function parseRoute() {
  const m = location.hash.match(/^#\/floor\/([\w-]+)(?:\/desk\/([\w-]+)(?:\/(screen|eyes|follow))?)?/);
  if (!m) return { mode: 'lobby' };
  return m[2] ? { mode: 'desk', floorId: m[1], agentId: m[2], ...(m[3] ? { [m[3]]: true } : {}) } : { mode: 'floor', floorId: m[1] };
}
const routeKey = (r) => [r.mode, r.floorId, r.agentId, r.screen ? 'screen' : r.eyes ? 'eyes' : r.follow ? 'follow' : ''].join('/');

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
const scene = createSceneHost($('scene'), {
  onPickFloor: (id) => { if (state.route.mode === 'lobby' && !ctx.editing) location.hash = `#/floor/${id}`; },
  onPickAgent: (floorId, agentId) => { if (!ctx.editing && (state.route.floorId === floorId || state.route.mode === 'lobby')) location.hash = `#/floor/${floorId}/desk/${agentId}`; },
  onPickQueue: () => ctx.actions.admin?.({ dataset: { tab: 'dispatcher' } }),                          // Office / List: the Lobby
  onPickOwner: () => document.querySelector('[data-pop="attPop"]')?.click(),                            // Office / List: approvals
  onPickScreen: (floorId, agentId) => { if (!ctx.editing && state.route.floorId === floorId) location.hash = `#/floor/${floorId}/desk/${agentId}/screen`; },
  onPickRack: () => { if (!ctx.editing) ctx.actions.meter(); },
  onPickEyes: (floorId, agentId) => { if (!ctx.editing && state.route.floorId === floorId) location.hash = `#/floor/${floorId}/desk/${agentId}/eyes`; },
});
ctx.scene = scene;
// the Lobby's overview: Building (stacked Floors), Office (one floor plan) or List; phones start with the List
const OVERVIEW_KEY = 'aisquad.overview';
ctx.overview = (() => { try { const v = localStorage.getItem(OVERVIEW_KEY); return OVERVIEWS.includes(v) ? v : defaultOverview({ phone: isPhone() }); } catch { return defaultOverview({ phone: isPhone() }); } })();
window.aisquad = ctx;                     // handy in the console and for scripted UI checks

// ---------- polling ----------
let timer = null, inflight = false, quiet = 0, lastSig = '';
// slower polls while nothing changes (3 s, then 6 s, then 10 s; the machine meter alone does not count), back to
// 3 s on any change, click or key
const pollEvery = (r) => (document.hidden ? 15000 : r.mode === 'desk' ? 2000 : quiet >= 10 ? 10000 : quiet >= 4 ? 6000 : 3000);
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (quiet >= 4) { quiet = 0; refresh(); } }, { passive: true });
async function refresh() {
  clearTimeout(timer);
  if (inflight) { timer = setTimeout(refresh, 400); return; }
  inflight = true;
  const r = state.route, key = routeKey(r), p0 = performance.now();
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
      toast(tt('This server needs the PIN to show anything. Menu → Enter PIN.'), 6000);
      timer = setTimeout(refresh, 15000);
      return;
    }
    const { meter, now, resources, ...rest } = b;
    const sig = JSON.stringify([rest, f || null]);
    quiet = sig === lastSig ? quiet + 1 : 0; lastSig = sig;
    // Floor 1 (independent agents) is named by the server, not by the owner: shown in the UI language
    for (const x of [...(b.floors || []), ...(f && f.independent ? [f] : [])]) if (x.independent) { x.name = tx(x.name); x.tagline = tx(x.tagline); }
    for (const a of b.attention || []) if (a.independent) a.floorName = tx(a.floorName);
    state.building = b;
    if (key === routeKey(state.route)) state.floor = f || null;
    if (state.floor?.notFound) { toast(tt('That Floor no longer exists')); location.hash = '#/'; }
    if (r.mode === 'desk' && hasPin()) {
      try { const d = await api('GET', `/api/floors/${r.floorId}/agents/${r.agentId}`, undefined, { quiet401: true }); if (key === routeKey(state.route)) state.desk = d; state.locked = false; }
      catch (e) { if (e.status === 401) state.locked = true; else if (e.status === 404) { toast(tt('That agent is no longer on this Floor')); location.hash = `#/floor/${r.floorId}`; } }
    } else if (r.mode === 'desk') state.locked = true;
    state.offline = false;
  } catch { state.offline = true; }
  inflight = false;
  if (!state.building) return void (timer = setTimeout(refresh, 4000));
  const r0 = performance.now();
  render();
  const st = ctx.stats ||= { polls: 0, fetchMs: 0, renderMs: 0 };       // per poll: network + JSON, then DOM and scene sync
  st.polls++; st.fetchMs += r0 - p0; st.renderMs += performance.now() - r0;
  timer = setTimeout(refresh, pollEvery(r));
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
  f.innerHTML = `<textarea name="text" placeholder="${tt('Describe the task. The agent gets it as a message in its Claude Code session.')}" aria-label="${tt('Task')}" required></textarea>
    <div class="files" data-files></div>
    <div class="row" style="margin-top:8px"><label class="ghost" style="margin:0"><input type="file" multiple hidden data-file><span class="chip" style="cursor:pointer">${tt('+ Attach files')}</span></label><span class="spacer"></span><button class="gold" type="submit">${tt('Send task')}</button></div>
    <details class="bgOpts"><summary>${tt('Run in the background')}</summary>
      <label class="inline"><input type="checkbox" name="bg"> ${tt('As a background job: no terminal, ends by itself, every step in the Squad Log')}</label>
      <div class="row"><label class="inline" style="margin:0">${tt('Budget (USD)')} <input name="budget" type="number" min="0.1" max="50" step="0.5" value="2" style="width:80px"></label>
      <label class="inline" style="margin:0"><input type="checkbox" name="edits"> ${tt('May edit files')}</label></div></details>`;
  f.querySelector('[data-file]').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      try {
        const r = await api('POST', `/api/floors/${state.route.floorId}/attachments`, undefined, { raw: file, headers: { 'x-filename': encodeURIComponent(file.name) } });
        taskFiles.push(r); drawFiles();
      } catch (err) { toast(`${file.name}: ${tx(err.message)}`); }
    }
    e.target.value = '';
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = f.elements.text.value.trim();
    if (!text) return;
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (f.elements.bg.checked) {
        const r = await guarded(`/api/floors/${state.route.floorId}/agents/${state.route.agentId}/jobs`, { prompt: text, attachments: taskFiles.map((x) => x.path), budgetUsd: +f.elements.budget.value || 2, permissionMode: f.elements.edits.checked ? 'acceptEdits' : 'dontAsk' });
        if (!r) { btn.disabled = false; return; }
        toast(r.waiting ? queuedText(r) : tt('Background job started'), r.waiting ? 6000 : 2800);
        f.elements.text.value = ''; taskFiles = []; drawFiles(); btn.disabled = false; refresh();
        return;
      }
      const r = await api('POST', `/api/floors/${state.route.floorId}/agents/${state.route.agentId}/task`, { text, attachments: taskFiles.map((x) => x.path) });
      toast(r.waiting ? queuedText(r) : r.queued ? tx(r.note) : tt('Task sent'), r.waiting ? 6000 : 2800);
      f.elements.text.value = ''; taskFiles = []; drawFiles();
      refresh();
    } catch (err) { toast(err.message); }
    btn.disabled = false;
  });
  f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) f.requestSubmit(); });
  function drawFiles() {
    f.querySelector('[data-files]').innerHTML = taskFiles.map((x, i) => `<span class="chip">${esc(x.name)} <button type="button" class="small ghost" data-rm="${i}" aria-label="${tt('Remove {name}', { name: esc(x.name) })}">×</button></span>`).join('');
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
  if (!f) return [{ id: 'loading', title: tt('Floor'), card: 'main', html: `<div class="empty">${tt('Loading…')}</div>` }];
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
  // new scroll areas start at the end (screens, a reply card's ask); a Finished report starts at its first lines
  el.querySelectorAll('[data-scroll]').forEach((s) => { const p = scrolls[s.dataset.scroll]; s.scrollTop = !p ? ('top' in s.dataset ? 0 : s.scrollHeight) : p.bottom && !('top' in s.dataset) ? s.scrollHeight : p.top; });
  el.querySelectorAll('.cardBody').forEach((x, i) => { x.scrollTop = bodies[i] || 0; });
  el.scrollTop = bodyTop;
}

// one floating card: an optional back link, tabs when it holds several sections, the active section's body
function cardHtml(list, group) {
  const pick = () => { const cur = state.tab[group]; return list.find((s) => s.id === cur) ? cur : list[0]?.id; };
  const active = pick(), sec = list.find((s) => s.id === active);
  const back = list[0]?.back ? `<a class="backLink" href="${list[0].back}">${icon('left')}${tt('All agents')}</a>` : '';
  const head = list.length > 1 ? `<div class="tabs" role="tablist">${tabsHtml(list, active, group)}</div>` : sec.head || `<div class="cardHead"><h3>${esc(sec.title)}</h3>${sec.count ? `<span class="count ${sec.countClass || ''}">${sec.count}</span>` : ''}</div>`;
  const hide = group === 'main' ? `<button class="ib collapse" data-act="hide-side" title="${tt('Hide the panel')}" aria-label="${tt('Hide the panel')}">${icon('right')}</button>` : '';
  return `${hide}${back}${head}<div class="cardBody">${sec.html}</div>`;
}

function layoutPanels(sections) {
  const phone = isPhone();
  if (state.route.eyes || state.route.follow) {           // first person and follow: only the 3D view and the small bar
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
    patch($('sheetBody'), sec ? `${sec.back ? `<a class="backLink" href="${sec.back}">${icon('left')}${tt('All agents')}</a>` : ''}${sec.head || ''}${sec.html}` : '');
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
  if (state.route.eyes || state.route.follow) insets = {};
  else if (phone) insets = { top: (hud ? hud.bottom : 0) + 8, bottom: (sheet ? innerHeight - sheet.top : 0) + (dock ? dock.height + 14 : 0) };
  else insets = { top: (hud ? hud.bottom : 0) + 12, bottom: (dock ? innerHeight - dock.top : 0) + 12, right: side ? innerWidth - side.left + 12 : 0, left: elev ? elev.right + 12 : 0 };
  const k = JSON.stringify(insets);
  if (k !== insetKey) { insetKey = k; scene.setInsets(insets); }
}

// ---------- hud (top-left status pill) ----------
function hudHtml(b, route, f) {
  const att = needsYou(b.attention).length;
  const attPill = att ? `<button class="hpill alert" data-pop="attPop" aria-haspopup="true" aria-expanded="false">${icon('alert')}${att === 1 ? tt('{n} needs you', { n: att }) : tt('{n} need you', { n: att })}</button>` : '';
  const menu = `<button class="iconBtn" data-pop="menu" aria-haspopup="true" aria-expanded="false" title="${tt('Menu')}" aria-label="${tt('Menu')}">${icon('menu')}</button>`;
  if (route.mode === 'lobby' || !f) {
    const working = b.floors.reduce((n, x) => n + (x.counts?.working || 0), 0), agents = b.floors.reduce((n, x) => n + (x.agents?.length || 0), 0);
    return `<div class="bar"><span class="brandMark" aria-hidden="true"></span><b class="brand">${esc(b.name || 'The AI Squad')}</b><span class="sep"></span>
      <span class="meta">${tt('<b>{floors}</b> Floors · <b>{working}</b>/{agents} working', { floors: b.floors.length, working, agents })}</span>${menu}</div>${attPill}`;
  }
  const c = f.counts || {}, active = (c.working || 0) + (c.waiting || 0), board = state.floor?.id === f.id ? state.floor.board : null;
  const tasks = board?.tasks || [], done = tasks.filter((t) => t.column === 'DONE').length;
  const progress = tasks.length ? `<span class="sep"></span><button class="sprintBtn" data-act="board" title="${tt('Open the board')}">${board.sprint ? `<b>${tt('Sprint {name}', { name: esc(board.sprint) })}</b>` : `<b>${tt('Board')}</b>`}<span class="prog"><i style="width:${Math.round(done / tasks.length * 100)}%"></i></span><span class="meta">${done}/${tasks.length}</span></button>` : '';
  let warn = '';
  if (!f.independent && !f.missing) {
    if (f.budget?.level === 'over') warn = `<span class="hpill warn">${icon('alert')}${tt('Budget reached')}</span>`;
    else if (f.agents.some((a) => a.crash && !a.crash.withLead)) { const c = f.agents.find((a) => a.crash && !a.crash.withLead); warn = `<a class="hpill wait" href="#/floor/${f.id}/desk/${c.id}" title="${esc(tx(c.crash.text))}">${icon('alert')}<span class="ellipsis">${tt('{name} stopped unexpectedly', { name: esc(String(c.displayName).split(' - ')[0]) })}</span></a>`; }
    else if (f.agents.length && !f.agents.some((a) => a.running)) warn = `<button class="hpill warn" data-act="start-all" title="${tt('Start every agent of this Floor')}">${icon('alert')}${tt('Squad not running')}</button>`;
    else if (f.waitingFor) warn = `<button class="hpill wait" data-act="waiting-for" title="${esc(f.waitingFor.docs ? tt('Not approved yet: {docs}', { docs: f.waitingFor.docs.join(', ') }) : tt('Open what the squad waits for'))}">${icon('alert')}<span class="ellipsis">${esc(tx(f.waitingFor.text))}</span></button>`;
    else if (f.budget?.level === 'warn') warn = `<span class="hpill warn">${icon('alert')}${tt('Budget {pct} %', { pct: Math.round(f.budget.pct) })}</span>`;
  }
  return `<div class="bar"><a class="iconBtn" href="#/" title="${tt('Lobby')}" aria-label="${tt('Back to the Lobby')}">${icon('building')}</a><span class="lamp ${f.lamp}"></span>
    <b class="brand ellipsis">${f.number} · ${esc(f.name)}</b>${progress}<span class="sep"></span><span class="meta">${tt('<b>{n}</b>/{total} active', { n: active, total: f.agents.length })}</span>
    ${f.independent || f.missing ? '' : `<button class="iconBtn" data-pop="floorMenu" aria-haspopup="true" aria-expanded="false" title="${tt('Floor menu')}" aria-label="${tt('Floor menu')}">${icon('more')}</button>`}${menu}</div>${warn}${apChip(f)}${attPill}`;
}

// the Floor's Autopilot level; when a critical item waits it says so (opens the Floor settings)
const AP_NAME = { off: tt('Off'), balanced: tt('Balanced'), full: tt('Full') };
function apChip(f) {
  const ap = f.autopilot;
  if (!ap || f.independent || f.missing) return '';
  const name = AP_NAME[ap.level] || ap.level[0].toUpperCase() + ap.level.slice(1);
  return `<button class="hpill ap ${ap.level}${ap.critical ? ' crit' : ''}" data-act="floor-settings" title="${esc(ap.level === 'off' ? tt('Autopilot is off: every question waits for you') : tt('Autopilot {name}: non-critical questions are decided after {min} min', { name, min: Math.round(ap.timeoutSec / 60) }))}">${tt('Autopilot: {level}', { level: name })}${ap.critical ? ` · ${ap.critical === 1 ? tt('{n} critical waits for you', { n: 1 }) : tt('{n} critical wait for you', { n: ap.critical })}` : ''}</button>`;
}

function floorMenuHtml(f) {
  const any = (fn) => f.agents.some(fn);
  return [['floor-settings', tt('Floor settings')], ['edit-mode', tt('Edit layout and looks')], ['add-agent', tt('Add agent')],
    ...(any((a) => !a.running) ? [['start-all', tt('Start all agents')]] : []), ...(any((a) => a.running) ? [['stop-all', tt('Stop all agents')]] : []),
    ...(state.floor?.id === f.id && state.floor.blueprint ? [['source-docs', tt('Source documents')]] : []),
    ...(state.floor?.id === f.id && state.floor.board ? [['board', tt('Board')]] : []), ...(f.workflow === 'squad-sprint' ? [['performance', tt('Performance')]] : []), ['cost', tt('Cost')], ['log', tt('Squad Log')], ['audit', tt('Audit')], ['retro', tt('Retro')], ...(f.workflow === 'squad-sprint' ? [['ship', tt('Ship readiness')]] : []), ['designs', tt('Design variants')]]
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
  if (!floor) out.push(btn('setup-squad', 'spark', tt('Set up Squad'), '', tt('Set up Squad')), '<span class="dsep"></span>');
  if (!floor) out.push(`<span class="ovSeg" role="group" aria-label="${tt('Overview')}">${[['building', tt('Building')], ['office', tt('Office')], ['list', tt('List')]].map(([v, l]) => `<button class="dk ov" data-act="overview" data-v="${v}" aria-pressed="${ctx.overview === v}">${l}</button>`).join('')}</span>`, '<span class="dsep"></span>');
  if (floor && state.floor?.board) out.push(btn('board', 'board', tt('Board')));
  if (floor && f.workflow === 'squad-sprint') out.push(btn('performance', 'chart', tt('Performance and cost projection')));
  if (floor) out.push(btn('log', 'log', tt('Squad Log: timeline and conversation')));
  if (floor && !f.independent) out.push(btn('audit', 'audit', tt('Audit: process and token efficiency')));
  out.push(btn('cost', 'coin', floor ? tt('Cost of this Floor') : tt('Cost of all Floors'), '', money(floor ? f.cost.today : b.costToday)));
  out.push(`<button class="dk ${w.level}" data-act="meter" data-tip="${tt('Server meter: CPU, RAM, swap and disk')}" aria-label="${tt('Server meter, {value}', { value: esc(w.text) })}">${icon('server')}<i class="sdot ${w.level}"></i><span>${esc(w.text)}</span></button>`);
  out.push('<span class="dsep"></span>');
  if (floor && !f.independent) out.push(btn('add-agent', 'user-plus', tt('Add agent')));
  out.push(btn('voice', voice ? 'vol' : 'mute', voice ? tt('Lead voice: on') : tt('Lead voice: off'), `aria-pressed="${voice}"`));
  out.push(`<button class="dk" data-pop="legendPop" data-tip="${tt('Legend and controls')}" aria-label="${tt('Legend and controls')}" aria-expanded="false">${icon('info')}</button>`);
  return out.join('');
}

const LEGEND = `<div class="lgGrid"><span><i class="st working">${tt('working')}</i></span><span><i class="st waiting">${tt('needs you')}</i></span><span><i class="st idle">${tt('idle')}</i></span><span><i class="st stopped">${tt('stopped')}</i></span><span><i class="st standby">${tt('not started')}</i></span></div>
  <ul class="lgList"><li>${tt('<b>Click a character</b> to look through its eyes')}</li><li>${tt('<b>Click a name chip</b> for the desk')}</li><li>${tt('<b>Click a monitor</b> for the screen view')}</li>
  <li>${tt('<b>Drag</b> to move around, <b>scroll</b> to zoom')}</li><li>${tt('<b>Esc</b> goes back one level')}</li></ul>`;

// ---------- render ----------
function render() {
  const { building: b, route } = state;
  if (!b) return;
  // screen view and first person view: no hud or dock, just the scene
  document.body.classList.toggle('immersive', !!(route.screen || route.eyes || route.follow));
  document.body.classList.toggle('pov', !!route.eyes);
  const f = b.floors.find((x) => x.id === route.floorId);
  const desk = f && route.agentId ? f.agents.find((a) => a.id === route.agentId) : null;
  $('povBar').hidden = !route.eyes;
  $('followBar').hidden = !route.follow;
  if (route.follow) patch($('followText'), desk ? `<i class="dot ${desk.state}"></i> ${tt('Following <b>{name}</b>', { name: esc(String(desk.displayName).split(' - ')[0]) })} · ${esc(desk.activity && desk.state !== 'stopped' ? tx(desk.activity) : STATE_TEXT[desk.state] || '')}` : tt('Follow'));
  if (route.eyes) patch($('povText'), desk ? `<i class="dot ${desk.state}"></i> ${tt('Through the eyes of <b>{name}</b>', { name: esc(desk.displayName) })} · ${esc(desk.activity && desk.state !== 'stopped' ? tx(desk.activity) : STATE_TEXT[desk.state] || '')}` : tt('First person view'));
  patch($('hud'), hudHtml(b, route, f));
  scene.setLoad(b.meter);
  announceAttention(needsYou(b.attention), route);
  announceNotices(b.attention);
  if (!$('attPop').hidden) patch($('attPop'), attPopHtml(b.attention));
  if (!$('floorMenu').hidden && f) patch($('floorMenu'), floorMenuHtml(f));
  if (state.offline) toast(tt('Server not reachable, retrying…'));

  $('dock').hidden = !!ctx.editing;
  patch($('dock'), dockHtml(b, route, f));
  // a meeting starts at the table: the lead opens it in one short line
  if (f?.meeting && f.meeting.since !== lastMeeting[f.id]) {
    if (lastMeeting[f.id] !== undefined) playLine({ floorId: f.id, agentId: f.meeting.agents[0], kind: 'meeting', text: tt("{label}. Let's start.", { label: tx(f.meeting.label) }) });
    lastMeeting[f.id] = f.meeting.since;
  }
  // lead shout when the whole team of the Floor in view is idle
  if (state.floor && !state.floor.missing && route.floorId === state.floor.id) {
    const { idle, lead } = floorIdle(state.floor);
    const text = shoutStep(shouts[state.floor.id] ||= {}, idle, Date.now());
    if (text && lead) { scene.say(state.floor.id, lead.id, text); playLine({ floorId: state.floor.id, agentId: lead.id, kind: 'shout', text }); }
  }
  // elevator (Floor switcher): a slim card on the left
  const elev = $('elevator');
  elev.hidden = route.mode === 'lobby' || ctx.editing || !!route.eyes || !!route.follow || isPhone();
  if (!elev.hidden) {
    const floors = [...b.floors].sort((x, y) => y.number - x.number);
    patch(elev, `${floors.map((x) => `<button data-href="#/floor/${x.id}" aria-current="${x.id === route.floorId}" data-tip="${x.number} · ${esc(x.name)}" aria-label="${tt('Floor {n}: {name}', { n: x.number, name: esc(x.name) })}">${x.number}<i class="l lamp ${x.lamp}"></i></button>`).join('')}<button data-href="#/" data-tip="${tt('Lobby')}" aria-label="${tt('Lobby')}">L</button>`);
  }

  // 3D
  const floorsForScene = b.floors.map((x) => (state.floor && state.floor.id === x.id ? { ...x, desks: state.floor.desks, devices: state.floor.devices } : x));
  scene.route(route, !!ctx.editing, ctx.overview);                     // three.js, Iso Pixel or the List (ui/renderer.js)
  scene.sync(floorsForScene);
  scene.setCompany({ queued: b.limits?.queued || 0, attention: needsYou(b.attention).length, resources: b.resources, limits: b.limits });
  showRenderer();
  const viewKey = routeKey(route) + (state.desk ? '' : '-') + ctx.overview;
  if (!ctx.editing && scene._viewKey !== viewKey) { scene._viewKey = viewKey; scene.setView({ ...route, overview: ctx.overview }); }

  // monitors: live tmux text in the over-the-shoulder view, latest QA screenshot on QA screens
  scene.setLiveText(route.screen && state.desk?.running ? state.desk.screen : null);
  if (state.floor && !state.floor.missing) scene.setBoard(state.floor.id, { board: state.floor.board, merge: state.floor.merge, agents: state.floor.agents.map((x) => ({ name: x.displayName, state: x.state, activity: x.activity })) });
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

// a stall notice is muted; a Notification only once it has lasted 15 minutes (its notifyAt), and once
const noticed = new Set();
function announceNotices(list) {
  for (const a of list) {
    if (!a.notice || noticed.has(a.id) || Date.now() < (a.notifyAt || 0)) continue;
    noticed.add(a.id);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(tt('Notice: {floor}', { floor: a.floorName || 'The AI Squad' }), { body: tx(String(a.text || '')).slice(0, 160), tag: a.id }); } catch { /* not allowed here */ }
    }
  }
}
// ---------- new Attention: open it by itself, badge the tab, notify when the tab is in the background ----------
const lastMeeting = {};                // floorId -> the meeting already announced
let seenAtt = null, attBooted = false;
try { seenAtt = new Set(JSON.parse(sessionStorage.getItem('aisquad.seenAtt') || '[]')); } catch { seenAtt = new Set(); }
function announceAttention(list, route) {
  document.title = list.length ? `(${list.length}) The AI Squad` : 'The AI Squad';
  const fresh = list.filter((a) => !seenAtt.has(a.id));
  // the first look after the page loads: what is waiting is in the panel (and the pill's count) already; only
  // items that arrive later open the popover, so the two never open together
  if (!attBooted) { attBooted = true; fresh.forEach((a) => seenAtt.add(a.id)); return; }
  if (!fresh.length) return;
  // the newest report or question is said aloud by its character (short; the full text is in the conversation view)
  const say = fresh.find((a) => ['finished', 'question', 'reply'].includes(a.kind) && a.agentId);
  if (say && seenAtt.size) playLine({ floorId: say.floorId, agentId: say.agentId, kind: say.kind, text: say.text });
  fresh.forEach((a) => seenAtt.add(a.id));
  try { sessionStorage.setItem('aisquad.seenAtt', JSON.stringify([...seenAtt].slice(-200))); } catch { /* private mode */ }
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const a = fresh[0];
    try { new Notification(a.kind === 'finished' ? tt('{name} finished', { name: a.agentName || tt('An agent') }) : tt('{name} needs you', { name: a.agentName || tt('An agent') }), { body: String(a.text || '').slice(0, 160), tag: a.id }); } catch { /* not allowed here */ }
  }
  // do not interrupt: typing, an open dialog, another popover, or the screen / first person view
  const busy = route.screen || route.eyes || $('modal').open || POPS.some((id) => id !== 'attPop' && !$(id).hidden)
    || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (busy || !$('attPop').hidden) return;
  // the panel lists the Lobby's Attention, or this Floor's; anything else opens the popover
  const sec = lastSections?.find((x) => x.id === 'attention' || x.id === 'f-attention');
  const inPanel = sec && (route.mode === 'lobby' || fresh.some((a) => a.floorId === route.floorId));
  if (inPanel && !$('sheet').hidden) { state.tab.sheet = sec.id; layoutPanels(lastSections); }   // phone: switch the sheet to it
  requestAnimationFrame(() => {
    // the side panel (or phone sheet) already shows it: bring that card into view and make it pulse
    const card = inPanel && [...document.querySelectorAll('#side .att, #sheet .att')].find((el) => el.offsetParent);
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      card.classList.remove('pulse'); void card.offsetWidth; card.classList.add('pulse');
      return;
    }
    const pill = document.querySelector('#hud [data-pop="attPop"]'); if (pill) openPopover('attPop', pill);
  });
}

// the Needs you popover: an index with a one-line preview per item; a click opens the conversation view
const attPopHtml = (list) => `<div class="cardHead"><h3>${tt('Needs you')}</h3><span class="count bad">${needsYou(list).length}</span></div>${attentionIndexHtml([...needsYou(list), ...list.filter((a) => a.muted)])}`;

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
  if (id === 'attPop' && 'Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch { /* unsupported */ } }
  if (id === 'attPop') { el._html = null; patch(el, attPopHtml(state.building.attention)); }
  if (id === 'legendPop') { patch(el, LEGEND); getJson('/api/version').then((v) => { if (!el.querySelector('.ver')) el.insertAdjacentHTML('beforeend', `<p class="ver note">The AI Squad ${v.version}</p>`); }).catch(() => {}); }
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
  if (state.route.eyes || state.route.follow) location.hash = `#/floor/${state.route.floorId}`;
  else if (state.route.screen) location.hash = `#/floor/${state.route.floorId}/desk/${state.route.agentId}`;
  else if (state.route.mode === 'desk') location.hash = `#/floor/${state.route.floorId}`;
  else if (state.route.mode === 'floor') location.hash = '#/';
});
document.querySelectorAll('[data-povback]').forEach((b) => { b.onclick = () => { location.hash = `#/floor/${state.route.floorId}`; }; });
document.querySelectorAll('[data-povdesk]').forEach((b) => { b.onclick = () => { location.hash = `#/floor/${state.route.floorId}/desk/${state.route.agentId}`; }; });
// follow mode: switch to the previous / next agent of the Floor
document.querySelectorAll('[data-follow]').forEach((b) => { b.onclick = () => {
  const list = state.building.floors.find((f) => f.id === state.route.floorId)?.agents || [];
  const i = list.findIndex((a) => a.id === state.route.agentId), next = list[(i + Number(b.dataset.follow) + list.length) % list.length];
  if (next) location.hash = `#/floor/${state.route.floorId}/desk/${next.id}/follow`;
}; });
$('grip').onclick = () => { $('sheet').classList.toggle('tall'); setTimeout(() => { render(); updateInsets(); }, 250); };
$('sideShow').onclick = () => { state.sideHidden = false; try { localStorage.removeItem('aisquad.sideHidden'); } catch { /* private mode */ } render(); };
try { state.sideHidden = localStorage.getItem('aisquad.sideHidden') === '1'; } catch { /* private mode */ }
addEventListener('resize', () => { for (const id of ['hud', 'dock', 'sideTop', 'sideMain', 'sideTabs', 'sheetTabs', 'sheetBody']) $(id)._html = null; render(); });

// starts that the Watchdog may question first (swap above 80 %, the Floor at its maximum of agents): ask, then force
// the dispatcher queued it (0.13): why it waits; it starts by itself when there is room
const queuedText = (r) => tt('Queued ({priority}, place {n}): {reason}. It starts by itself when there is room.', { priority: r.dispatch.priority, n: r.dispatch.position, reason: tx(r.dispatch.reason) });
async function guarded(url, body = {}, force = false) {
  try { return await api('POST', url, { ...body, ...(force ? { force: true } : {}) }); } catch (e) {
    if (e.status !== 409) throw e;
    if (!confirm(tt('Watchdog: {message}', { message: tx(e.message) }))) return null;
    return api('POST', url, { ...body, force: true });
  }
}

// ---------- actions (event delegation on data-act / data-href / data-tab) ----------
const shouts = {};
const actions = Object.assign(ctx.actions, {
  'hide-side'() { state.sideHidden = true; try { localStorage.setItem('aisquad.sideHidden', '1'); } catch { /* private mode */ } render(); },
  board() {
    const f = state.floor; if (!f) return;
    const body = openModal(`<div class="mHead"><h3 class="grow">${tt('Board · {name}', { name: esc(f.name) })}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div><div class="mBody">${boardHtml(f)}</div>`);
    body.closest('dialog').classList.add('xwide');
    body.querySelector('[data-close]').onclick = () => body.closest('dialog').close();
  },
  overview(el) { ctx.overview = el.dataset.v; try { localStorage.setItem(OVERVIEW_KEY, ctx.overview); } catch { /* private mode */ } render(); showRenderer(); },
  voice() { const on = !voiceOn(); setVoice(on); if (on) speak(tt('Voice is on, boss.')); render(); },
  async start(el) { const r = await guarded(`/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/start`); if (r) toast(r.waiting ? queuedText(r) : tt('Starting agent…'), r.waiting ? 6000 : 2800); },
  // continue the agent's last Claude Code session (after a crash this is the main action)
  async resume(el) { const r = await guarded(`/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/resume`); if (r) toast(r.waiting ? queuedText(r) : tt('Resuming the last session…'), r.waiting ? 6000 : 2800); },
  async 'crash-answer'(el) { el.disabled = true; const r = await guarded(`/api/attention/${el.dataset.id}/answer`, { option: +el.dataset.n, ...itemContext(el) }); if (r) toast(r.waiting ? queuedText(r) : +el.dataset.n === 1 ? tt('Resuming the last session…') : tt('Starting a fresh session…')); else el.disabled = false; },
  async restart(el) {
    if (!confirm(tt('Restart this agent? Its Claude Code session is closed and a fresh one starts with the configured model and effort.'))) return;
    await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/stop`, {});
    await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/start`, {});
    toast(tt('Agent restarted'));
  },
  async stop(el) { await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/stop`, {}); toast(tt('Agent stopped')); },
  async 'start-all'() {
    let force = false;
    for (const a of state.floor.agents.filter((x) => !x.running && !x.standby)) {
      const r = await guarded(`/api/floors/${state.route.floorId}/agents/${a.id}/${a.crash && a.resume ? 'resume' : 'start'}`, {}, force);
      if (!r) return; force = true;                     // one warning for the whole team
    }
    toast(tt('Starting the team…'));
  },
  async 'stop-all'() {
    if (!confirm(tt('Stop every running agent on this Floor?'))) return;
    for (const a of state.floor.agents.filter((x) => x.running)) await api('POST', `/api/floors/${state.route.floorId}/agents/${a.id}/stop`, {});
    toast(tt('Team stopped'));
  },
  async answer(el) { el.disabled = true; const r = await answerItem(el.dataset.id, { option: +el.dataset.n }, itemContext(el)); if (!r.gone) toast(tt('Answer sent')); },
  async dismiss(el) { const r = await answerItem(el.dataset.id, { option: 0 }, itemContext(el)); if (!r.gone) toast(tt('Dismissed')); },
  // the Floor pill: source documents open their dialog, a reply or answer opens Attention
  'waiting-for'(el) {
    const f = state.building.floors.find((x) => x.id === state.route.floorId);
    if (f?.waitingFor?.kind === 'docs') { actions['source-docs'](); return; }
    const sec = 'f-attention';
    if (!lastSections?.some((x) => x.id === sec)) { openPopover('attPop', el); return; }
    if (!$('sheet').hidden) state.tab.sheet = sec; else state.tab.tabs = sec;
    layoutPanels(lastSections);
    requestAnimationFrame(() => document.querySelector('#side .att, #sheet .att')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  },
  async 'standup-now'() {
    const r = await api('GET', `/api/floors/${state.route.floorId}/standup`);
    const body = openModal(`<div class="mHead"><h3 class="grow">${tt('Standup so far today')}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
      <div class="mBody"><p class="note" style="margin-top:0">${r.last ? tt('From the Squad Log since the last standup ({when}), and what the agents do right now. The next one is at {time}.', { when: new Date(r.last.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }), time: esc(r.setting.time) }) : tt('From the Squad Log since the last standup, and what the agents do right now. The next one is at {time}.', { time: esc(r.setting.time) })}</p>${standupAgents(r.now)}</div>`);
    body.closest('dialog').querySelector('[data-close]').onclick = () => body.closest('dialog').close();
  },
  async 'work-done'(el) { await api('POST', `/api/floors/${state.route.floorId}/agents/${el.dataset.agent}/work-done`, {}); },
  async 'remove-floor'(el) {
    if (!confirm(tt('Remove this Floor from the Building? The project directory and its files stay untouched.'))) return;
    await api('DELETE', `/api/floors/${el.dataset.floor}`); toast(tt('Floor removed')); location.hash = '#/';
  },
  async adopt(el) {
    const p = state.building.detected[+el.dataset.i];
    const r = await api('POST', '/api/floors/adopt', { path: p.root }); toast(tt('Floor registered')); location.hash = `#/floor/${r.id}`;
  },
  async unlock() { if (await askPin()) refresh(); },
  async 'install-skill'(el) {
    const names = el.dataset.skill.split(',');
    const r = await api('POST', `/api/floors/${state.route.floorId}/skills/install`, { names });
    const n = r.results.filter((x) => x.installed).length;
    toast(n ? (n === 1 ? tt('Installed {n} skill into .claude/skills', { n }) : tt('Installed {n} skills into .claude/skills', { n })) : tt('Already installed'));
  },
  async 'stop-service'(el) {
    if (!confirm(tt('Stop this background service? The agent sees its shell end.'))) return;
    try { await api('POST', `/api/floors/${el.dataset.floor}/agents/${el.dataset.agent}/services/${el.dataset.service}/stop`, {}); toast(tt('Service stopped')); refresh(); }
    catch (e) { toast(tx(e.message), 6000); }
  },
  async 'job-stop'(el) { await api('POST', `/api/jobs/${el.dataset.job}/stop`, {}); toast(tt('Job stopped')); },
  async 'job-open'(el) {
    const j = await api('GET', `/api/jobs/${el.dataset.job}`);
    const body = openModal(`<div class="mHead"><h3 class="grow">${esc(j.title)}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
      <div class="mBody"><p class="note">${tt('{status} · {cost} · {turns} turns · started {ago}', { status: esc(j.status), cost: money(j.cost), turns: j.turns || 0, ago: ago(j.startedAt) })}${j.sessionId ? ` · <code>${esc(j.sessionId.slice(0, 8))}</code>` : ''}</p>
      ${j.error ? `<div class="att budget warn"><div class="q">${esc(tx(j.error))}</div></div>` : ''}
      ${j.denials?.length ? `<div class="denied"><b>${tt('Denied in the background (no one could be asked):')}</b><ul>${j.denials.map((d) => `<li><code>${esc(d.tool)}</code> ${esc(d.command)}</li>`).join('')}</ul>${tt('Start the agent on its Desk for work that needs these, so the prompts reach Needs you.')}</div>` : ''}
      ${j.text ? `<div class="md">${mdLite(j.text)}</div>` : ''}
      ${j.events?.length ? `<details><summary>${tt('Steps ({n})', { n: j.events.length })}</summary><ul class="feed events">${j.events.map((e) => `<li><span class="k ${e.kind === 'tool' ? 'tool' : 'text'}"></span><div class="grow d ${e.kind === 'tool' ? 'mono' : ''}">${esc(e.detail)}</div></li>`).join('')}</ul></details>` : ''}</div>`);
    body.querySelector('[data-close]').onclick = () => body.closest('dialog').close();
  },
  async copy(el) { try { await navigator.clipboard.writeText(el.dataset.text); toast(tt('Copied')); } catch { toast(el.dataset.text, 6000); } },
});

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { const [group, id] = tab.dataset.tab.split(':'); state.tab[group] = id; layoutPanels(lastSections); return; }
  const act = e.target.closest('[data-act]');
  // a message opens large on click, but links in it still work and selecting text does not open it
  if (act?.dataset.act === 'convo' && act.tagName !== 'BUTTON' && (e.target.closest('a[href]') || String(getSelection?.() || '').trim())) return;
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
// a reply to an agent that waits for the owner: sent as its next task; the draft survives re-renders
document.addEventListener('input', (e) => { const id = e.target.dataset?.draft; if (id) drafts.set(id, e.target.value); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.dataset?.draft) { e.preventDefault(); e.target.form.requestSubmit(); } });
document.addEventListener('submit', async (e) => {
  const r = e.target.closest('form[data-act="reply"]');
  if (!r) return;
  e.preventDefault();
  const btn = r.querySelector('button:not([type=button])'); btn.disabled = true;   // Send reply (reply card) or Reply (Finished card)
  // the typed text stays (textarea and draft) until the server confirms; a moved-on item still gets it as a message
  try {
    const res = await answerItem(r.dataset.id, { option: 1, text: r.elements.text.value }, itemContext(r));
    drafts.delete(r.dataset.id); r.elements.text.value = ''; r.elements.text.blur();
    toast(res.delivered === 'as-message' ? tt('Sent to the agent as a message') : tt('Reply sent'));
  } catch (err) { btn.disabled = false; drafts.set(r.dataset.id, r.elements.text.value); toast(err.message); }
  refresh();
});
// a dialog with several questions or multi-select (askform.js): every answer at once
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-act="answer-ask"]');
  if (!f) return;
  e.preventDefault();
  const item = (state.building?.attention || []).concat(state.floor?.attentionItems || []).find((x) => x.id === f.dataset.id);
  if (!item) { toast(tt('Already answered')); refresh(); return; }
  const btn = f.querySelector('button.gold'); btn.disabled = true;
  try { await answerItem(f.dataset.id, { answers: readAskForm(f, item) }, itemContext(f)); toast(tt('Answers sent')); }
  catch (err) { f.querySelector('[data-askerr]').textContent = err.message; btn.disabled = false; }
  refresh();
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-act="answer-free"]');
  if (!f) return;
  e.preventDefault();
  try { const r = await answerItem(f.dataset.id, { option: +f.dataset.n, text: f.elements.text.value }, itemContext(f)); toast(r.delivered === 'as-message' ? tt('Sent to the agent as a message') : tt('Answer sent')); } catch (err) { toast(err.message); }
  refresh();
});
// theme: light (default) → dark → auto (follows the system), remembered per browser
const THEMES = { light: tt('Light'), dark: tt('Dark'), auto: tt('Auto (system)') };
export function applyTheme() {
  const t = document.documentElement.dataset.theme || 'light';
  $('themeName').textContent = THEMES[t] || tt('Light');
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  scene.setTheme(dark, getComputedStyle(document.documentElement).getPropertyValue('--scene').trim());
}
// graphics quality: Auto (High, Low when frames are slow), High (soft light, AO, grading), Low (as fast as before)
const QUALITY_TEXT = { auto: tt('Auto'), high: tt('High'), low: tt('Low') };
function showQuality() { $('qualityName').textContent = `${QUALITY_TEXT[scene.quality.chosen]}${scene.quality.chosen === 'auto' ? ` (${({ high: tt('high'), low: tt('low') })[scene.quality.active] || scene.quality.active})` : ''}`; }
showQuality();
// view: 3D (three.js), Iso Pixel (light, Canvas 2D) or Auto (Iso on phones, small devices and big squads)
const RENDERER_TEXT = { auto: tt('Auto'), three: tt('3D'), iso: tt('Iso Pixel') };
function showRenderer() { $('rendererName').textContent = `${RENDERER_TEXT[scene.chosen]}${scene.chosen === 'auto' ? ` (${RENDERER_TEXT[scene.kind]})` : ''}`; }
showRenderer();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();
$('menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-menu]'); if (!b) return;
  closePopovers();
  if (b.dataset.menu === 'theme') {
    const order = Object.keys(THEMES), next = order[(order.indexOf(document.documentElement.dataset.theme) + 1) % order.length];
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('aisquad.theme', next); } catch { /* private mode */ }
    applyTheme(); toast(tt('Theme: {name}', { name: THEMES[next] }));
  } else if (b.dataset.menu === 'voice') { ctx.actions['voice-settings']();
  } else if (b.dataset.menu === 'language') { setLang(LANG === 'en' ? 'id' : 'en');                 // reloads in the other language
  } else if (b.dataset.menu === 'quality') {
    const order = ['auto', 'high', 'low'], next = order[(order.indexOf(scene.quality.chosen) + 1) % order.length];
    scene.quality.set(next); showQuality(); toast(tt('Graphics: {name}', { name: QUALITY_TEXT[next] }));
  } else if (b.dataset.menu === 'renderer') {
    const order = ['auto', 'three', 'iso'], next = scene.choose(order[(order.indexOf(scene.chosen) + 1) % order.length]);
    scene._viewKey = null; applyTheme(); render(); showRenderer(); toast(tt('Scene view: {name}', { name: RENDERER_TEXT[next] }));
  } else if (b.dataset.menu === 'pin') askPin().then((ok) => ok && refresh());
  else if (b.dataset.menu === 'rename') {
    const name = prompt(tt('Building name'), state.building?.name || 'The AI Squad');
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
