// SPDX-License-Identifier: Apache-2.0
// The admin page (1.10): /admin, every setting of the company in one place, without the 3D scene (light on a phone,
// a link per section: /admin#/targets, /admin#/spaces/<id>). A sidebar in six groups, Ctrl/Cmd+K to jump, an
// overview with what needs the owner, the targets, today's cost, the machine and the app's version. What other
// pages open as a dialog (People, Floor settings, the Company Guide, …) is rendered here as the page itself
// (lib.js setModalHost); the office (/) stays the place to watch and work with the agents.
import { $, esc, api, toast, money, ago, checkSession, signedIn, askPin, signOut, setModalHost } from './lib.js';
import { ctx } from './ctx.js';
import { t, tx, LANG, LANGS, setLang, translateDom } from './i18n.js';
import { loadMe } from './people.js';
import { openAdmin, TAB_IDS, setPageTitles } from './admin.js';
import { openTemplates } from './templates.js';
import { updateHtml, bindUpdate } from './update.js';
import { learningPage } from './admin-learn.js';
import { publishingPage } from './admin-publish.js';
import './dialogs.js';
import './health.js';
import './signin.js';
import './voice.js';
import './guide.js';
import './setup.js';

translateDom();
const OWNER = true;
// the sidebar: [id, label, ownerOnly]; ids that are Admin tabs render through openAdmin
export const NAV = [
  [t('Overview'), [['overview', t('Overview')]]],
  [t('Company'), [['guide', t('Company plan'), OWNER], ['targets', t('Targets')], ['cadence', t('Cadence')], ['learning', t('Learning'), OWNER], ['company', t('Company Brain')]]],
  [t('Spaces and team'), [['spaces', t('Spaces')], ['agents', t('Agents')], ['templates', t('Role Templates')], ['skills', t('Skills')]]],
  [t('Work'), [['publishing', t('Publishing'), OWNER], ['dispatcher', t('Queue')], ['handoffs', t('Handoffs')], ['improve', t('Improvements'), OWNER], ['changes', t('Changes')]]],
  [t('Connections'), [['integrations', t('Integrations'), OWNER], ['erpnext', 'ERPNext', OWNER], ['notify', t('Telegram and notifications'), OWNER], ['signin', t('Claude sign-in'), OWNER], ['voice', t('Voice')]]],
  [t('Owner'), [['people', t('People and access'), OWNER], ['legal', t('Legal'), OWNER], ['machines', t('Machines'), OWNER], ['health', t('Backups and health'), OWNER], ['general', t('Building and update'), OWNER]]],
];
const ITEMS = NAV.flatMap(([group, items]) => items.map(([id, label, owner]) => ({ id, label, group, owner: !!owner })));
setPageTitles(Object.fromEntries(ITEMS.map((x) => [x.id, x.label])));
const isOwner = () => ctx.state.me?.role === 'owner';
const visible = (it) => !it.owner || isOwner();
// what a section shows when it is a dialog elsewhere
const DIALOG = { people: () => ctx.actions.people(), signin: () => ctx.actions.signin(), health: () => ctx.actions.health(), voice: () => ctx.actions['voice-settings'](), guide: () => ctx.actions.guide(), templates: () => openTemplates() };

const main = $('aMain');
let route = { id: 'overview', arg: '' };

// ---------- routing ----------
function parse() {
  let h = ''; try { h = decodeURIComponent(location.hash.replace(/^#\/?/, '')); } catch { /* a broken link: the overview */ }
  if (h.startsWith('floor/')) return { office: h };                 // a link into the office (e.g. Set up Squad's new Floor)
  const [id, arg = '', sub = ''] = h.split('/');
  return { id: id || 'overview', arg, sub };
}
// each visit renders into a fresh pane: a slow render of a section left behind lands in a detached node
let pane = main, seq = 0, latestDone = false;
async function go() {
  const r = parse();
  if (r.office) return location.assign(`/#/${r.office}`);
  route = r;
  drawNav();
  closeDrawer();
  await show();
}
async function show() {
  pane = document.createElement('div');
  main.replaceChildren(pane);
  const mine = pane;
  const my = ++seq; latestDone = false;
  setModalHost(mine, { onClose: () => { if (pane === mine) show(); } });     // Save / Cancel in a section: draw it again
  await render(mine);
  // a section that finished after the owner moved on may have drawn over the newer one (openModal fills the current
  // host): once the newest is drawn, a late one draws it again (each late render at most once)
  if (my === seq) latestDone = true;
  else if (latestDone) return show();
}
async function render(main) {
  const it = ITEMS.find((x) => x.id === route.id) || ITEMS[0];
  $('aCrumb').textContent = it.group === it.label ? it.label : `${it.group} · ${it.label}`;
  document.title = `${it.label} · ${t('Admin')} · The AI Squad`;
  if (!visible(it)) { main.innerHTML = `<div class="empty">${t('Only the Owner can open this.')}</div>`; return; }
  main.innerHTML = `<div class="empty">${t('Loading…')}</div>`;
  try {
    if (route.id === 'overview') { const html = await overviewHtml(); if (main.isConnected) { main.innerHTML = html; bindOverview(main); } return; }
    if (route.id === 'general') { const html = await generalHtml(); if (main.isConnected) { main.innerHTML = html; bindGeneral(main); } return; }
    if (route.id === 'spaces' && route.arg) return await floorSettings(route.arg, main, route.sub);
    if (route.id === 'learning') return await learningPage(main);
    if (route.id === 'publishing') return await publishingPage(main);
    if (DIALOG[route.id]) return await DIALOG[route.id]();
    if (TAB_IDS.includes(route.id)) return await openAdmin(route.id);
    main.innerHTML = `<div class="empty">${t('Not found.')}</div>`;
  } catch (e) {
    main.innerHTML = `<div class="empty">${esc(e.status === 401 ? t('Sign in to see this.') : e.message)}</div>`;
  }
}
// Floor settings for one Space: the same dialog the office used, as this page
async function floorSettings(id, main, section = '') {
  const f = await api('GET', `/api/floors/${encodeURIComponent(id)}`);
  if (!main.isConnected) return;
  if (f.notFound || f.missing) { main.innerHTML = `<div class="empty">${t('That Floor no longer exists')}</div>`; return; }
  ctx.state.floor = f; ctx.state.route = { mode: 'floor', floorId: id };
  await ctx.actions['floor-settings'](section);
  const head = main.querySelector('.mHead');
  head?.insertAdjacentHTML('afterbegin', `<a class="btn small ghost" href="#/spaces" aria-label="${t('All Spaces')}">‹ ${t('Spaces')}</a>`);
  head?.insertAdjacentHTML('beforeend', `<a class="btn small" href="/#/floor/${esc(id)}">${t('Open in the office')}</a>`);
}

// ---------- the sidebar ----------
function drawNav() {
  const b = ctx.state.building;
  $('aName').textContent = b?.name || 'The AI Squad';
  $('aNav').innerHTML = NAV.map(([group, items]) => {
    const shown = items.filter(([id, label, owner]) => !owner || isOwner());
    if (!shown.length) return '';
    return `<div class="aGroup"><div class="aGroupT">${esc(group)}</div>${shown.map(([id, label]) => `<a href="#/${id}" class="aItem" ${route.id === id ? 'aria-current="page"' : ''}>${esc(label)}${badge(id)}</a>`).join('')}</div>`;
  }).join('') + `<div class="aGroup aFoot"><a class="aItem" href="/">${t('Back to the office')}</a>${signedIn() ? `<button class="aItem linkBtn" data-signout>${t('Sign out')}</button>` : `<button class="aItem linkBtn" data-signin>${t('Enter PIN')}</button>`}</div>`;
}
function badge(id) {
  const b = ctx.state.building;
  if (!b) return '';
  if (id === 'overview') { const n = (b.attention || []).filter((a) => !a.muted).length; return n ? `<span class="aBadge bad">${n}</span>` : ''; }
  if (id === 'targets' && b.targets?.behind) return `<span class="aBadge warn">${b.targets.behind}</span>`;
  if (id === 'publishing') { const n = (b.attention || []).filter((a) => a.kind === 'outbox').length; return n ? `<span class="aBadge warn">${n}</span>` : ''; }
  if (id === 'learning') { const n = (b.attention || []).filter((a) => a.kind === 'proposal').length; return n ? `<span class="aBadge info">${n}</span>` : ''; }
  if (id === 'general' && ctx.update?.available) return '<span class="aBadge info">1</span>';
  return '';
}
const openDrawer = () => { document.body.classList.add('aNavOpen'); $('aScrim').hidden = false; };
const closeDrawer = () => { document.body.classList.remove('aNavOpen'); $('aScrim').hidden = true; };
$('aBurger').onclick = () => (document.body.classList.contains('aNavOpen') ? closeDrawer() : openDrawer());
$('aScrim').onclick = closeDrawer;
$('aNav').addEventListener('click', (e) => {
  if (e.target.closest('[data-signout]')) signOut();
  if (e.target.closest('[data-signin]')) askPin().then((ok) => ok && boot());
});

// ---------- overview ----------
async function overviewHtml() {
  const b = ctx.state.building;
  const spaces = (b.floors || []).filter((f) => !f.independent && !f.missing);
  const waiting = (b.attention || []).filter((a) => !a.muted);
  const working = spaces.reduce((n, f) => n + (f.counts?.working || 0), 0);
  const tg = b.targets;
  const warn = b.resources?.warnings || [];
  return `<div class="aPage">
    <div class="aHead"><h2 class="grow">${esc(b.name)}</h2>${isOwner() ? `<a class="btn small" href="#/guide">${b.guide?.done ? t('Set up the company again') : t('Set up the company')}</a><button class="small gold" data-act="setup-squad">${t('Set up Squad')}</button>` : ''}</div>
    <div class="kpis aTiles">
      <a href="/#/" class="${waiting.length ? 'badTile' : ''}"><span>${t('Needs you')}</span><b>${waiting.length}</b><small>${t('open in the office')}</small></a>
      <a href="#/targets"><span>${t('Targets')}</span><b>${tg ? `${tg.met}/${tg.total}` : '–'}</b><small>${tg ? t('{n} behind, {u} without a goal', { n: tg.behind, u: tg.unset }) : t('no targets yet')}</small></a>
      <a href="#/dispatcher"><span>${t('Agents working')}</span><b>${working}</b><small>${t('{n} Spaces', { n: spaces.length })}</small></a>
      <a href="#/health"><span>${t('Cost today')}</span><b>${money(b.costToday)}</b><small>${warn.length ? esc(tx(warn[0])) : t('machine OK')}</small></a>
    </div>
    ${waiting.length ? `<section class="section"><div class="sectionHead"><h3 class="grow">${t('Needs you')}</h3><a class="btn small" href="/#/">${t('Answer in the office')}</a></div>
      <ul class="list">${waiting.slice(0, 6).map((a) => `<li class="row"><span class="badge ${a.level === 'warn' ? '' : 'bad'}">${esc(tx(a.kind || ''))}</span><span class="grow">${esc(a.floorName || '')}${a.agentName ? ` · ${esc(a.agentName)}` : ''}: ${esc(tx(a.text || ''))}</span><span class="note">${ago(a.ts)}</span></li>`).join('')}</ul></section>` : ''}
    <section class="section"><div class="sectionHead"><h3 class="grow">${t('Spaces')}</h3><a class="btn small ghost" href="#/spaces">${t('All settings')}</a></div>
      ${spaces.length ? `<div class="aSpaces">${spaces.sort((x, y) => x.number - y.number).map((f) => `<div class="aSpace"><span class="fnum" style="--c:${esc(f.accent || '#888')}">${f.number}</span>
        <span class="grow"><b>${esc(f.name)}</b><span class="note">${esc(f.kind === 'department' ? t('Department') : t('Project'))}${f.access === 'owner' ? ` · ${t('Owner only')}` : ''} · ${t('{n} agents', { n: f.agents?.length || 0 })}${f.counts?.working ? ` · ${t('{n} working', { n: f.counts.working })}` : ''}</span></span>
        <a class="btn small ghost" href="#/spaces/${esc(f.id)}">${t('Settings')}</a><a class="btn small" href="/#/floor/${esc(f.id)}">${t('Office')}</a></div>`).join('')}</div>`
        : `<div class="empty">${t('No Spaces yet. Set up the company or a Squad first.')}</div>`}</section>
    ${isOwner() ? `<section class="section" id="aUpdate">${updateHtml(ctx.update)}</section>` : ''}
  </div>`;
}
function bindOverview(main) {
  main.querySelector('[data-act="setup-squad"]')?.addEventListener('click', () => ctx.actions['setup-squad']());
  const u = main.querySelector('#aUpdate');
  if (u) bindUpdate(u, showUpdate);
}

// ---------- building, language, theme, update ----------
const THEMES = { light: t('Light'), dark: t('Dark'), auto: t('Auto (system)') };
const applyTheme = () => { let v = 'light'; try { v = localStorage.getItem('aisquad.theme') || 'light'; } catch { /* private mode */ } document.documentElement.dataset.theme = v; };
async function generalHtml() {
  const b = ctx.state.building;
  let theme = 'light'; try { theme = localStorage.getItem('aisquad.theme') || 'light'; } catch { /* private mode */ }
  return `<div class="aPage">
    <div class="aHead"><h2 class="grow">${t('Building and update')}</h2></div>
    <section class="section"><div class="sectionHead"><h3 class="grow">${t('Building')}</h3></div>
      <form class="row wrap" data-rename><label class="grow" style="margin:0">${t('Name')}<input name="name" value="${esc(b.name)}" maxlength="60"></label><button class="small gold" type="submit">${t('Save')}</button></form>
      <div class="grid2" style="margin-top:var(--sp-3)">
        <label>${t('Language (this browser and the Building)')}<select data-lang>${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>${t('Theme (this browser)')}<select data-theme>${Object.entries(THEMES).map(([k, v]) => `<option value="${k}" ${k === theme ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      </div></section>
    <section class="section" id="aUpdate">${updateHtml(ctx.update)}</section>
    <section class="section"><div class="sectionHead"><h3 class="grow">${t('Sessions')}</h3></div>
      <p class="note">${t('Sign every device out, this one included: everyone signs in again with their PIN.')}</p>
      <button class="small ghost danger" data-signout-all>${t('Sign out everywhere')}</button></section>
  </div>`;
}
function bindGeneral(main) {
  main.querySelector('[data-rename]').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PATCH', '/api/building', { name: e.target.elements.name.value.trim() }); toast(t('Saved')); await refresh(); } catch (err) { toast(err.message, 5000); }
  };
  main.querySelector('[data-lang]').onchange = async (e) => { await api('PATCH', '/api/building', { lang: e.target.value }).catch(() => {}); setLang(e.target.value); };
  main.querySelector('[data-theme]').onchange = (e) => { try { localStorage.setItem('aisquad.theme', e.target.value); } catch { /* private mode */ } applyTheme(); };
  main.querySelector('[data-signout-all]').onclick = () => { if (confirm(t('Sign out every device, this one included?'))) signOut({ everywhere: true }).catch((err) => toast(err.message)); };
  bindUpdate(main.querySelector('#aUpdate'), showUpdate);
}

// ---------- Ctrl/Cmd+K ----------
let pal = [], palAt = 0;
function palItems(q) {
  const s = q.trim().toLowerCase();
  const spaces = (ctx.state.building?.floors || []).filter((f) => !f.independent && !f.missing);
  const all = [
    ...ITEMS.filter(visible).map((it) => ({ label: it.label, hint: it.group, href: `#/${it.id}` })),
    ...spaces.flatMap((f) => [{ label: `${f.number} · ${f.name}`, hint: t('Space settings'), href: `#/spaces/${f.id}` }, { label: `${f.number} · ${f.name}`, hint: t('Open in the office'), href: `/#/floor/${f.id}` }]),
  ];
  return s ? all.filter((x) => `${x.label} ${x.hint}`.toLowerCase().includes(s)) : all;
}
function palDraw() {
  $('palList').innerHTML = pal.slice(0, 30).map((x, i) => `<li role="option" aria-selected="${i === palAt}" data-i="${i}"><b>${esc(x.label)}</b><span class="note">${esc(x.hint)}</span></li>`).join('') || `<li class="note">${t('Nothing found.')}</li>`;
  $('palList').querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
}
function palOpen() { $('palIn').value = ''; pal = palItems(''); palAt = 0; palDraw(); $('palette').showModal(); $('palIn').focus(); }
function palGo(x) { $('palette').close(); if (!x) return; if (x.href.startsWith('#')) location.hash = x.href; else location.assign(x.href); }
$('aSearch').onclick = palOpen;
$('palIn').addEventListener('input', () => { pal = palItems($('palIn').value); palAt = 0; palDraw(); });
$('palIn').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { palAt = Math.min(pal.length - 1, palAt + 1); palDraw(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { palAt = Math.max(0, palAt - 1); palDraw(); e.preventDefault(); }
  if (e.key === 'Enter') { palGo(pal[palAt]); e.preventDefault(); }
});
$('palList').addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) palGo(pal[+li.dataset.i]); });
$('palette').addEventListener('click', (e) => { if (e.target === $('palette')) $('palette').close(); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('palette').open) $('palette').close(); else palOpen(); }
});

// ---------- data ----------
async function refresh() {
  try { ctx.state.building = await api('GET', '/api/building'); } catch { /* signed out: the section says so */ }
  drawNav();
}
ctx.refresh = refresh;
ctx.render = () => {};
async function boot() {
  await checkSession();
  if (!signedIn() && !(await askPin())) { main.innerHTML = `<div class="empty">${t('Enter the PIN to change settings.')} <button class="small gold" data-pinnow>${t('Enter PIN')}</button></div>`; main.querySelector('[data-pinnow]').onclick = () => askPin().then((ok) => ok && boot()); return; }
  await loadMe();
  await refresh();
  if (isOwner()) api('GET', '/api/update').then(showUpdate).catch(() => {});
  await go();
}
// the update card, once the check is back (it may run git fetch)
function showUpdate(u) {
  ctx.update = u; drawNav();
  const box = pane.querySelector('#aUpdate');
  if (!box) return;
  box.innerHTML = updateHtml(u);
  bindUpdate(box, showUpdate);
}
window.addEventListener('hashchange', go);
setInterval(() => { if (!document.hidden && signedIn()) refresh(); }, 30000);
boot();
