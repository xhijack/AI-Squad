// SPDX-License-Identifier: Apache-2.0
// Menu → Admin (0.12): one place for the configuration of the whole company. Spaces (kind, access, memory, shift,
// agents at once), agents across Spaces (model, effort, skills; add, remove), the skill catalog, the Company Brain,
// and the change history with diff and rollback. It edits the same files as the Floor settings; nothing of its own.
import { esc, api, toast, openModal, closeModal, diffHtml } from './lib.js';
import { ctx } from './ctx.js';
import { t } from './i18n.js';

const TABS = [['spaces', t('Spaces')], ['agents', t('Agents')], ['skills', t('Skills')], ['company', t('Company Brain')], ['changes', t('Changes')]];
const KIND = { project: t('Project'), department: t('Department') };
const ACCESS = { team: t('Team'), owner: t('Owner only') };
const MEMORY = { claude: t('This machine (Claude Code)'), repo: t('In the Space (committed)') };
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

async function openAdmin(tab = 'spaces') {
  const [d, roles] = await Promise.all([api('GET', '/api/admin'), api('GET', '/api/roles')]);
  const body = openModal(`<div class="mHead"><h3 class="grow">${t('Admin')}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="mBody"><div class="tabs adminTabs" role="tablist">${TABS.map(([id, label]) => `<button role="tab" data-atab="${id}" aria-selected="${id === tab}">${esc(label)}</button>`).join('')}</div>
    <div id="adminBody">${{ spaces: spacesHtml, agents: (x) => agentsHtml(x, roles), skills: skillsHtml, company: companyHtml, changes: changesHtml }[tab](d)}</div></div>`);
  body.closest('dialog').classList.add('xwide');
  body.querySelectorAll('[data-close]').forEach((x) => x.onclick = () => closeModal());
  body.querySelectorAll('[data-atab]').forEach((b) => b.onclick = () => openAdmin(b.dataset.atab));
  const again = async (msg) => { toast(msg); ctx.refresh(); await openAdmin(tab); };

  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.dataset.space) {
        const days = [...f.querySelectorAll('[name=day]:checked')].map((x) => +x.value);
        await api('PATCH', `/api/floors/${f.dataset.space}`, { kind: f.elements.kind.value, access: f.elements.access.value, memory: f.elements.memory.value,
          shift: { enabled: f.elements.shiftOn.checked, from: f.elements.from.value, to: f.elements.to.value, days }, recovery: { maxAgents: +f.elements.maxAgents.value } });
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
}
ctx.actions.admin = (el) => openAdmin(el?.dataset?.tab || 'spaces');
