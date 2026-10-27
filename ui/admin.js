// SPDX-License-Identifier: Apache-2.0
// Menu → Admin (0.12): one place for the configuration of the whole company. Spaces (kind, access, memory, shift,
// agents at once), agents across Spaces (model, effort, skills; add, remove), the skill catalog, the Company Brain,
// and the change history with diff and rollback. It edits the same files as the Floor settings; nothing of its own.
import { esc, api, toast, openModal, closeModal, diffHtml, ago } from './lib.js';
import { ctx } from './ctx.js';
import { t, tx } from './i18n.js';
import { notifyHtml, improvementsHtml, machinesHtml, bindMore } from './admin-more.js';
import { handoffsHtml, erpnextHtml, bindErp } from './admin-erp.js';
import { legalHtml, tieringHtml, bindLegal } from './admin-legal.js';
import { trustHtml, bindTrust } from './admin-trust.js';
import { targetsHtml, bindTargets } from './admin-kpi.js';

const TABS = [['spaces', t('Spaces')], ['targets', t('Targets')], ['dispatcher', t('Dispatcher')], ['agents', t('Agents')], ['skills', t('Skills')], ['company', t('Company Brain')], ['handoffs', t('Handoffs')], ['erpnext', 'ERPNext'], ['legal', t('Legal')], ['machines', t('Machines')], ['notify', t('Notifications')], ['improve', t('Improvements')], ['changes', t('Changes')]];
const KIND = { project: t('Project'), department: t('Department') };
const ACCESS = { team: t('Team'), owner: t('Owner only') };
const MEMORY = { claude: t('This machine (Claude Code)'), repo: t('In the Space (committed)') };
const ERP = { off: t('No'), sales: t('Sales key'), delivery: t('Delivery key') };
const DAYS = [t('Sun'), t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat')];
const opts = (map, v) => Object.entries(map).map(([k, label]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(label)}</option>`).join('');
const when = (ts) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

function spacesHtml(d) {
  if (!d.spaces.length) return `<div class="empty">${t('No Spaces yet. Set up a Squad or create a Floor first.')}</div>`;
  return `<p class="note">${t('A Floor is a Space. A department works for many clients over time; a project is one client or product. Owner-only Spaces may read legal, finance and pricing in the Company Brain. Memory in the Space keeps what Claude Code learns in the repository, so it travels with git and backups. The shift holds automated work outside its hours (from 0.13).')}</p>
    <div class="adminList">${d.spaces.map((s) => s.missing ? `<div class="adminRow"><b>${s.number} · ${esc(s.id)}</b> <span class="note warnText">${t('folder missing: {path}', { path: esc(s.path) })}</span></div>` : `
    <form class="adminRow" data-space="${esc(s.id)}">
      <div class="row"><b class="grow">${s.number} · ${esc(s.name)}</b><span class="note">${t('{n} agents', { n: s.agents })}${s.blueprint ? ` · ${esc(s.blueprint)}` : ''}</span></div>
      <div class="grid4">
        <label>${t('Kind')}<select name="kind">${opts(KIND, s.kind)}</select></label>
        <label>${t('Access')}<select name="access">${opts(ACCESS, s.access)}</select></label>
        <label>${t('Memory')}<select name="memory">${opts(MEMORY, s.memory)}</select></label>
        <label>${t('Agents at once')}<input name="maxAgents" type="number" min="1" max="20" value="${s.maxAgents}"></label>
        <label>ERPNext<select name="erpnext">${opts(ERP, s.erpnext || 'off')}</select></label>
        ${d.machines?.length ? `<label>${t('Background jobs run on')}<select name="node">${opts({ auto: t('Any machine with room'), head: t('This machine only'), ...Object.fromEntries(d.machines.map((m) => [m, m])) }, s.node || 'auto')}</select></label>` : ''}
      </div>
      <div class="row wrap shiftRow"><label class="inline"><input type="checkbox" name="shiftOn" ${s.shift.enabled ? 'checked' : ''}> ${t('Shift')}</label>
        <input name="from" type="time" value="${esc(s.shift.from)}" aria-label="${t('From')}"> – <input name="to" type="time" value="${esc(s.shift.to)}" aria-label="${t('To')}">
        ${DAYS.map((name, i) => `<label class="inline day"><input type="checkbox" name="day" value="${i}" ${s.shift.days.includes(i) ? 'checked' : ''}>${esc(name)}</label>`).join('')}
        <span class="spacer"></span><button class="small gold" type="submit">${t('Save')}</button></div>
    </form>`).join('')}</div>`;
}

function agentsHtml(d, roles) {
  const bySpace = d.spaces.filter((s) => !s.missing);
  return `<p class="note">${t('The same agent can work in several Spaces: each Space has its own copy of the role, and its sessions only see that Space. Changes here are overrides on top of the Role Template.')}</p>
    ${bySpace.map((s) => `<div class="section"><div class="sectionHead"><h3 class="grow">${s.number} · ${esc(s.name)}</h3></div>
      <div class="adminList">${d.agents.filter((a) => a.floorId === s.id).map((a) => `
      <form class="adminRow" data-agent="${esc(a.id)}" data-floor="${esc(a.floorId)}">
        <div class="row"><b class="grow">${esc(a.displayName)}${a.lead ? ` <span class="badge">${t('lead')}</span>` : ''}</b><span class="note">${esc(a.template)}${a.version ? `@${a.version}` : ''}${a.detached ? ` · ${t('detached copy')}` : ''}</span></div>
        <div class="grid4">
          <label>${t('Model')}<select name="model"><option value="">${t('template ({v})', { v: esc(a.model) })}</option>${roles.models.map((m) => `<option ${a.overrides.model === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
          <label>${t('Effort')}<select name="effort"><option value="">${t('template ({v})', { v: esc(a.effort) })}</option>${roles.efforts.map((m) => `<option ${a.overrides.effort === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
          <label class="span2">${t('Extra skills (comma separated)')}<input name="skills" value="${esc((a.overrides.skills?.add || []).join(', '))}" list="skillNames"></label>
        </div>
        <div class="note">${t('Skills now: {list}', { list: esc(a.skills.join(', ') || t('none')) })}</div>
        <div class="row"><span class="spacer"></span><button class="small ghost danger" type="button" data-remove>${t('Remove')}</button><button class="small gold" type="submit">${t('Save')}</button></div>
      </form>`).join('') || `<div class="empty">${t('No agents.')}</div>`}</div>
      <form class="row wrap addAgent" data-add="${esc(s.id)}"><input name="displayName" placeholder="${esc(t('Name - Role, e.g. Rina - Sales Copywriter'))}" required>
        <select name="template">${d.templates.map((x) => `<option value="${esc(x.role)}">${esc(x.title)}</option>`).join('')}</select><button class="small" type="submit">${t('Add agent')}</button></form></div>`).join('')}
    <datalist id="skillNames">${d.skills.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>
    <div class="row"><button class="ghost" data-templates>${t('Open Role Templates')}</button></div>`;
}

function skillsHtml(d) {
  const spaces = d.spaces.filter((s) => !s.missing);
  return `<p class="note">${t('Skills that ship with The AI Squad. An agent uses the ones its role lists (plus its extra skills); Install copies a skill into a Space so it is pinned there.')}</p>
    <div class="adminList">${d.skills.map((x) => `<div class="adminRow"><div class="row"><b class="grow mono">${esc(x.name)}</b><span class="note">${esc(x.roles.join(', ') || t('no role uses it yet'))}</span></div>
      <div class="note">${esc(x.description)}</div>
      ${spaces.length ? `<div class="row"><span class="spacer"></span><select data-install-space="${esc(x.name)}">${spaces.map((s) => `<option value="${esc(s.id)}">${s.number} · ${esc(s.name)}</option>`).join('')}</select><button class="small" data-install="${esc(x.name)}">${t('Install')}</button></div>` : ''}</div>`).join('')}</div>`;
}

function companyHtml(d) {
  const c = d.company;
  return `<p class="note">${t('Four layers keep one agent from mixing clients: the Company Brain (shared, read only), the agent\'s role (its identity, which it cannot change), the Space (one client or project: its repository, documents and memory), and the session (thrown away after the task).')}</p>
    <label for="cPath">${t('Folder (empty: {dir})', { dir: esc(d.company.path) })}</label>
    <div class="row"><input id="cPath" value="${esc(d.companyPath)}" placeholder="${esc(c.path)}" class="grow"><button class="small" data-cpath>${t('Save')}</button></div>
    ${c.exists ? `<ul class="list">${c.dirs.map((x) => `<li class="row"><b class="grow mono">${esc(x.name)}/</b>${x.ownerOnly ? `<span class="badge">${t('Owner only')}</span>` : ''}<span class="note">${t('{n} files', { n: x.files })}</span></li>`).join('')}</ul>
      <p class="note">${t('Agents get this folder read-only. Put client facts in the client\'s Space, never here.')}</p>`
    : `<div class="empty">${t('The folder does not exist yet.')}</div><button class="gold" data-cinit>${t('Create the folders')}</button>`}`;
}

function changesHtml(d) {
  if (!d.history.length) return `<div class="empty">${t('No changes recorded yet.')}</div>`;
  return `<p class="note">${t('Every change made through The AI Squad to the Building or a Space, with who made it. Roll back puts the files back as they were and records that too.')}</p>
    <ul class="list">${d.history.map((h) => `<li class="adminRow"><div class="row"><span class="note">${when(h.ts)}</span><b class="grow">${esc(h.label)}</b><span class="note">${esc(h.actor || '')}</span><button class="small ghost" data-change="${esc(h.id)}">${t('View')}</button></div>
      <div class="note mono">${esc(h.files.join(', '))}</div><div data-diff="${esc(h.id)}"></div></li>`).join('')}</ul>`;
}

const LIMIT = { building: t('Building maximum'), ram: t('free RAM'), cpu: t('CPU load') };
// keys, so the line is translated as a whole (not word by word from the server's English)
const LIMIT_TEXT = { building: 'Building maximum of {n} agents at once', ram: '{ram} GB RAM free, about {per} GB per session, 2 GB kept free', cpu: 'CPU load {load} on {cpus} cores' };
function dispatcherHtml(x) {
  const c = x.capacity, q = x.quota, p = x.prefs;
  return `<p class="note">${t('Every start goes through one queue: the owner\'s own work first (P0), then a waiting squad (P1), normal work (P2) and background work (P3). Waiting 30 minutes moves an item up one level. Automated work waits outside its Space\'s shift and while the quota guard pauses.')}</p>
    <div class="dispStats">
      <div><b>${c.running} / ${c.cap}</b><span class="note">${t('running / slots now')}</span></div>
      <div><b>${c.free}</b><span class="note">${t('free')}${x.reserve ? ` · ${t('{n} kept for the owner', { n: x.reserve })}` : ''}</span></div>
      <div><b>${esc(LIMIT[c.limiting] || c.limiting)}</b><span class="note">${t('limits it now')}</span></div>
      <div><b class="${q.paused ? 'warnText' : ''}">${q.paused ? t('Paused') : t('OK')}</b><span class="note">${t('quota guard')}</span></div>
    </div>
    <ul class="list note">${c.limits.map((l) => `<li>${esc(LIMIT_TEXT[l.key] ? t(LIMIT_TEXT[l.key], l.vars) : l.text)}: ${l.cap}</li>`).join('')}</ul>
    ${q.paused ? `<p class="warnText">${esc(q.reasonKey ? t(q.reasonKey, { ...q.vars, label: t(q.vars.label || '') }) : q.reason)}${q.until ? ` · ${t('until {time}', { time: new Date(q.until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) })}` : ''}</p>` : ''}
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Queue')}</h3></div>
    ${x.queue.length ? `<div class="adminList">${x.queue.map((it) => `<div class="adminRow"><div class="row"><span class="badge">${esc(it.effective)}</span><b class="grow">${esc(it.agentName)} · ${esc(it.floorName)}</b><span class="note">${esc(it.action)} · ${esc(it.via)} · ${ago(it.createdAt)}</span></div>
      <div class="note">${esc(it.title)}</div>
      <div class="row"><span class="note grow">${esc(tx(it.reason))}${it.lastError ? ` · <span class="warnText">${esc(it.lastError)}</span>` : ''}</span>
        <select data-prio="${esc(it.id)}" aria-label="${t('Priority')}">${['P0', 'P1', 'P2', 'P3'].map((v) => `<option ${v === it.priority ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="small ghost danger" data-qdrop="${esc(it.id)}">${t('Remove')}</button><button class="small gold" data-qstart="${esc(it.id)}">${t('Start now')}</button></div></div>`).join('')}</div>`
    : `<div class="empty">${t('Nothing waiting.')}</div>`}</div>
    <form class="section" data-dispatch>
      <div class="sectionHead"><h3 class="grow">${t('Settings')}</h3></div>
      <div class="grid4">
        <label>${t('Slots kept for the owner (daytime)')}<input name="reserveP0" type="number" min="0" max="4" value="${p.reserveP0}"></label>
        <label>${t('Daytime from')}<input name="dayFrom" type="time" value="${esc(p.day.from)}"></label>
        <label>${t('Daytime to')}<input name="dayTo" type="time" value="${esc(p.day.to)}"></label>
        <label>${t('Stop idle agents after (min, 0 = never)')}<input name="idleStopMin" type="number" min="0" value="${p.idleStopMin}"></label>
        <label>${t('…while work waits (min)')}<input name="idleStopBusyMin" type="number" min="0" value="${p.idleStopBusyMin}"></label>
        <label>${t('Quota: 5 hours (USD, 0 = off)')}<input name="fiveHourUsd" type="number" min="0" step="0.5" value="${p.quota.fiveHourUsd}"></label>
        <label>${t('Quota: 7 days (USD, 0 = off)')}<input name="weekUsd" type="number" min="0" step="1" value="${p.quota.weekUsd}"></label>
        <label>${t('Pause automated work at (%)')}<input name="pausePct" type="number" min="50" max="100" value="${p.quota.pausePct}"></label>
      </div>
      <p class="note">${t('Used (API-equivalent estimate): {five} in 5 hours, {week} in 7 days. A subscription counts differently; set limits from what you see in Claude\'s usage page. Rate-limit reports of background jobs pause automated work too.', { five: `$${q.windows[0].usd}`, week: `$${q.windows[1].usd}` })}</p>
      <div class="row"><span class="spacer"></span><button class="gold" type="submit">${t('Save')}</button></div>
    </form>`;
}

async function openAdmin(tab = 'spaces') {
  const [d, roles, disp, extra] = await Promise.all([api('GET', '/api/admin'), api('GET', '/api/roles'), tab === 'dispatcher' ? api('GET', '/api/dispatcher') : tab === 'notify' ? api('GET', '/api/notify') : tab === 'machines' ? api('GET', '/api/nodes') : tab === 'handoffs' ? api('GET', '/api/handoffs') : tab === 'erpnext' ? api('GET', '/api/erpnext') : tab === 'improve' ? api('GET', '/api/insights') : tab === 'legal' ? api('GET', '/api/legal') : tab === 'targets' ? api('GET', '/api/kpis') : null,
    tab === 'dispatcher' ? api('GET', '/api/tiering').catch(() => null) : null]);
  const modal = openModal(`<div class="adminRoot"><div class="mHead"><h3 class="grow">${t('Admin')}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="mBody"><div class="tabs adminTabs" role="tablist">${TABS.map(([id, label]) => `<button role="tab" data-atab="${id}" aria-selected="${id === tab}">${esc(label)}</button>`).join('')}</div>
    <div id="adminBody">${{ spaces: spacesHtml, dispatcher: () => dispatcherHtml(disp) + tieringHtml(extra), legal: () => legalHtml(disp), targets: (x) => targetsHtml(disp, x, ctx.state.me), notify: () => notifyHtml(disp), machines: () => machinesHtml(disp), handoffs: () => handoffsHtml(disp), erpnext: (x) => erpnextHtml(disp, x), improve: () => trustHtml(disp) + improvementsHtml(disp), agents: (x) => agentsHtml(x, roles), skills: skillsHtml, company: companyHtml, changes: changesHtml }[tab](d)}</div></div></div>`);
  modal.closest('dialog').classList.add('xwide');
  const body = modal.querySelector('.adminRoot');          // new on every render: its listeners go with it
  body.querySelectorAll('[data-close]').forEach((x) => x.onclick = () => closeModal());
  body.querySelectorAll('[data-atab]').forEach((b) => b.onclick = () => openAdmin(b.dataset.atab));
  const again = async (msg) => { toast(msg); ctx.refresh(); await openAdmin(tab); };

  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.dataset.dispatch !== undefined) {
        const v = (n) => f.elements[n].value;
        await api('PATCH', '/api/dispatcher', { reserveP0: +v('reserveP0'), day: { from: v('dayFrom'), to: v('dayTo') }, idleStopMin: +v('idleStopMin'), idleStopBusyMin: +v('idleStopBusyMin'),
          quota: { fiveHourUsd: +v('fiveHourUsd'), weekUsd: +v('weekUsd'), pausePct: +v('pausePct') } });
        return again(t('Saved'));
      }
      if (f.dataset.space) {
        const days = [...f.querySelectorAll('[name=day]:checked')].map((x) => +x.value);
        await api('PATCH', `/api/floors/${f.dataset.space}`, { kind: f.elements.kind.value, access: f.elements.access.value, memory: f.elements.memory.value,
          shift: { enabled: f.elements.shiftOn.checked, from: f.elements.from.value, to: f.elements.to.value, days }, recovery: { maxAgents: +f.elements.maxAgents.value }, erpnext: f.elements.erpnext.value, ...(f.elements.node ? { node: f.elements.node.value } : {}) });
        return again(t('Space saved'));
      }
      if (f.dataset.agent) {
        const a = d.agents.find((x) => x.id === f.dataset.agent && x.floorId === f.dataset.floor);
        const add = f.elements.skills.value.split(',').map((x) => x.trim()).filter(Boolean);
        const o = { ...a.overrides, model: f.elements.model.value || undefined, effort: f.elements.effort.value || undefined, skills: { add, remove: a.overrides.skills?.remove || [] } };
        await api('PATCH', `/api/floors/${f.dataset.floor}/agents/${f.dataset.agent}`, { overrides: o });
        return again(t('Agent saved; agent file regenerated'));
      }
      if (f.dataset.add) {
        await api('POST', `/api/floors/${f.dataset.add}/agents`, { displayName: f.elements.displayName.value.trim(), template: f.elements.template.value });
        return again(t('Agent added'));
      }
    } catch (err) { toast(err.message, 5000); }
  });
  body.addEventListener('click', async (e) => {
    const el = e.target;
    try {
      if (el.closest('[data-remove]')) {
        const f = el.closest('form');
        if (!confirm(t('Remove this agent from its Space? Its files in the repository stay.'))) return;
        await api('DELETE', `/api/floors/${f.dataset.floor}/agents/${f.dataset.agent}`);
        return again(t('Agent removed'));
      }
      if (el.dataset.qstart) { await api('POST', `/api/dispatcher/queue/${el.dataset.qstart}/start`, {}); return again(t('Started')); }
      if (el.dataset.qdrop) { await api('DELETE', `/api/dispatcher/queue/${el.dataset.qdrop}`); return again(t('Removed from the queue')); }
      if (el.closest('[data-templates]')) { closeModal(); return ctx.actions.templates?.(); }
      if (el.dataset.install) {
        const sp = body.querySelector(`[data-install-space="${el.dataset.install}"]`).value;
        const r = await api('POST', `/api/floors/${sp}/skills/install`, { names: [el.dataset.install] });
        return toast(r.results[0]?.installed ? t('Installed into .claude/skills') : t('Already installed'));
      }
      if (el.closest('[data-cpath]')) { await api('PATCH', '/api/company', { path: body.querySelector('#cPath').value.trim() }); return again(t('Saved')); }
      if (el.closest('[data-cinit]')) { await api('POST', '/api/company/init', {}); return again(t('Company Brain created')); }
      if (el.dataset.change) {
        const box = body.querySelector(`[data-diff="${el.dataset.change}"]`);
        if (box.innerHTML) { box.innerHTML = ''; return; }
        const c = await api('GET', `/api/history/${el.dataset.change}`);
        box.innerHTML = `${c.files.map((f) => `<div class="note mono" style="margin-top:8px">${esc(f.key)}${f.created ? ` · ${t('created')}` : ''}</div>${diffHtml(f.diff)}`).join('')}
          <div class="row"><span class="spacer"></span><button class="small ghost danger" data-rollback="${esc(c.id)}">${t('Roll back')}</button></div>`;
        return;
      }
      if (el.dataset.rollback) {
        if (!confirm(t('Put these files back as they were before this change?'))) return;
        try { await api('POST', `/api/history/${el.dataset.rollback}/rollback`, {}); }
        catch (err) { if (err.status !== 409 || !confirm(t('{message} Roll back anyway?', { message: err.message.replace(/ Roll back anyway\?$/, '') }))) throw err; await api('POST', `/api/history/${el.dataset.rollback}/rollback`, { force: true }); }
        return again(t('Rolled back'));
      }
    } catch (err) { toast(err.message, 5000); }
  });
  bindMore(body, again);
  bindErp(body, again);
  bindLegal(body, again);
  bindTrust(body, again);
  bindTargets(body, again);
  body.addEventListener('change', async (e) => {
    if (!e.target.dataset.prio) return;
    try { await api('PATCH', `/api/dispatcher/queue/${e.target.dataset.prio}`, { priority: e.target.value }); await again(t('Priority changed')); } catch (err) { toast(err.message, 5000); }
  });
}
ctx.actions.admin = (el) => openAdmin(el?.dataset?.tab || 'spaces');
