// SPDX-License-Identifier: Apache-2.0
// Admin → Cadence (1.5): the routines every Space runs by itself. Per Space: each routine with when it runs, its agent,
// its last run (and the result on the agent's desk) and its next run. The Owner adds, changes and removes routines;
// Members turn them on or off and press Run now; Viewers read. A run goes through the dispatcher like other
// automated work; one that cannot start in its window is skipped with the reason.
import { esc, api, toast, ago, when, money } from './lib.js';
import { t, tx } from './i18n.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAME = { sun: t('Sunday'), mon: t('Monday'), tue: t('Tuesday'), wed: t('Wednesday'), thu: t('Thursday'), fri: t('Friday'), sat: t('Saturday') };
const KIND = { daily: t('every day'), weekdays: t('every weekday'), weekly: t('every week on'), monthly: t('every month on day') };
const STATUS = { done: t('done'), failed: t('failed'), stopped: t('stopped'), skipped: t('skipped'), lost: t('lost') };
const TONE = { done: 'live', failed: 'bad', stopped: '', skipped: 'warn', lost: 'bad' };
export function everyText(every) {
  const [kind, day] = String(every).split(':');
  if (kind === 'weekly') return `${KIND.weekly} ${DAY_NAME[day] || day}`;
  if (kind === 'monthly') return `${KIND.monthly} ${day}`;
  return KIND[kind] || every;
}
const opts = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
const agentOpts = (agents, v) => agents.map((a) => `<option value="${esc(a.id)}" ${a.id === v || a.role === v ? 'selected' : ''}>${esc(a.displayName)}</option>`).join('');

// the form for a new routine and for a change (the Owner's)
function formHtml(sp, r = null) {
  const [kind, day] = String(r?.every || 'daily').split(':');
  return `<form class="grid4" data-${r ? 'cedit' : 'cadd'}>
    <label style="grid-column: span 2">${t('Title')}<input name="title" required value="${esc(r?.title || '')}" placeholder="${t('e.g. Weekly report vs targets')}"></label>
    <label>${t('Agent')}<select name="agent">${agentOpts(sp.agents, r?.agentId || r?.agent)}</select></label>
    <label>${t('Budget per run ($)')}<input name="budget" type="number" step="0.5" min="0" max="50" value="${r?.budget ?? ''}" placeholder="2"></label>
    <label>${t('Every')}<select name="kind">${opts({ daily: t('day'), weekdays: t('weekday'), weekly: t('week'), monthly: t('month') }, kind)}</select></label>
    <label>${t('Day')}<select name="day">${DAYS.map((d) => `<option value="${d}" ${d === day ? 'selected' : ''}>${DAY_NAME[d]}</option>`).join('')}${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${String(i + 1) === day ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
    <label>${t('At')}<input name="at" type="time" required value="${esc(r?.at || '09:00')}"></label>
    <span></span>
    <label style="grid-column: span 4">${t('Task')}<textarea name="task" rows="3" required>${esc(r?.task || '')}</textarea></label>
    <div class="row" style="grid-column: span 4"><span class="note grow">${t('Weekly: pick a weekday. Monthly: pick a day of the month (31 means the last day).')}</span><button class="small gold">${r ? t('Save') : t('Add')}</button></div>
  </form>`;
}
function everyOf(f) {
  const kind = f.elements.kind.value, day = f.elements.day.value;
  if (kind === 'weekly') return `weekly:${DAYS.includes(day) ? day : 'mon'}`;
  if (kind === 'monthly') return `monthly:${/^\d+$/.test(day) ? day : '1'}`;
  return kind;
}

function routineHtml(sp, r, role) {
  const can = role === 'owner' || role === 'member';
  const last = r.last;
  const state = r.running ? `<span class="badge live">${t('running')}</span>` : r.pending ? `<span class="badge">${t('queued: {reason}', { reason: esc(tx(r.pending.reason || '')) })}</span>` : '';
  return `<div class="adminRow" data-routine="${esc(r.id)}"><div class="row">
      <label class="toggle" title="${can ? t('Turn on or off') : ''}"><input type="checkbox" data-ctoggle ${r.enabled ? 'checked' : ''} ${can ? '' : 'disabled'} aria-label="${t('{title} is on', { title: esc(r.title) })}"></label>
      <b class="grow">${esc(tx(r.title))}</b>${state}
      ${can ? `<button class="small" data-crun ${r.running || r.pending ? 'disabled' : ''}>${t('Run now')}</button>` : ''}
    </div>
    <div class="note">${everyText(r.every)} ${t('at')} ${esc(r.at)} · ${esc(r.agentName || r.agent)}${r.agentId ? '' : ` <span class="badText">${t('no such agent in this Space')}</span>`}${r.budget ? ` · ${t('max {usd} per run', { usd: money(r.budget) })}` : ''}</div>
    <div class="note">${r.enabled && r.next ? t('Next: {time}', { time: when(r.next) }) : t('Off')}${last ? ` · ${t('Last: {time}', { time: ago(last.ts) })} <span class="badge ${TONE[last.status] || ''}">${STATUS[last.status] || esc(last.status)}</span>${last.reason ? ` ${esc(tx(last.reason))}` : ''}${last.cost ? ` · ${money(last.cost)}` : ''}${last.manual ? ` · ${t('run now')}` : ''}${last.job && r.agentId ? ` · <a href="#/floor/${esc(sp.id)}/desk/${esc(r.agentId)}">${t('Result')}</a>` : ''}` : ` · ${t('never run')}`}</div>
    <details class="ctask"><summary class="note">${t('Task')}</summary><p class="note pre">${esc(r.task)}</p></details>
    ${role === 'owner' ? `<details><summary class="note">${t('Change')}</summary>${formHtml(sp, r)}<div class="row"><span class="spacer"></span><button class="small ghost danger" data-cremove>${t('Remove')}</button></div></details>` : ''}
  </div>`;
}

export function cadenceHtml(x, me) {
  const role = me?.role || 'viewer';
  const spaces = x?.spaces || [];
  const all = spaces.flatMap((s) => s.routines), on = all.filter((r) => r.enabled);
  return `<p class="note">${t('Routines are the work a Space does on its own rhythm: a daily draft, a weekly report, a morning follow-up list. A run goes through the dispatcher like any automated work: it waits for the Space\'s shift, the quota guard and a free slot, and is skipped with the reason when it cannot start within two hours. New routines are off until someone turns them on.')}</p>
    <div class="kpis"><div><span>${t('Routines')}</span><b>${all.length}</b></div><div><span>${t('On')}</span><b>${on.length}</b></div><div><span>${t('Running')}</span><b>${all.filter((r) => r.running).length}</b></div><div><span>${t('Failed last time')}</span><b class="${all.some((r) => r.last?.status === 'failed') ? 'badText' : ''}">${all.filter((r) => r.last?.status === 'failed').length}</b></div></div>
    ${spaces.map((sp) => `<div class="section" data-cspace="${esc(sp.id)}"><div class="sectionHead"><h3 class="grow">${sp.number} · ${esc(sp.name)}</h3>
        ${role === 'owner' && sp.routines.some((r) => !r.enabled) ? `<button class="small" data-cenable>${t('Turn on routines')}</button>` : ''}</div>
      ${sp.routines.length ? `<div class="adminList">${sp.routines.map((r) => routineHtml(sp, r, role)).join('')}</div>` : `<div class="note">${t('No routines yet for this Space.')}</div>`}
      ${role === 'owner' && sp.agents.length && sp.routines.length < 20 ? `<details class="kadd"><summary class="note">${t('Add a routine')}</summary>${formHtml(sp)}</details>` : ''}
    </div>`).join('')}`;
}

export function bindCadence(body, again) {
  body.addEventListener('submit', async (e) => {
    const f = e.target, sp = f.closest('[data-cspace]')?.dataset.cspace, id = f.closest('[data-routine]')?.dataset.routine;
    if (!sp || (f.dataset.cadd === undefined && f.dataset.cedit === undefined)) return;
    e.preventDefault();
    const v = (n) => f.elements[n]?.value ?? '';
    const r = { title: v('title'), agent: v('agent'), every: everyOf(f), at: v('at'), task: v('task'), budget: v('budget') === '' ? null : +v('budget') };
    try {
      if (f.dataset.cadd !== undefined) { await api('POST', `/api/floors/${sp}/cadence`, r); return again(t('Routine added')); }
      await api('PATCH', `/api/floors/${sp}/cadence/${id}`, r); return again(t('Routine saved'));
    } catch (err) { toast(err.message, 5000); }
  });
  body.addEventListener('change', async (e) => {
    if (e.target.dataset.ctoggle === undefined) return;
    const sp = e.target.closest('[data-cspace]')?.dataset.cspace, id = e.target.closest('[data-routine]')?.dataset.routine;
    try { await api('POST', `/api/floors/${sp}/cadence/${id}/toggle`, { enabled: e.target.checked }); again(e.target.checked ? t('Routine on') : t('Routine off')); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, 5000); }
  });
  body.addEventListener('click', async (e) => {
    const el = e.target, sp = el.closest('[data-cspace]')?.dataset.cspace, id = el.closest('[data-routine]')?.dataset.routine;
    if (!sp) return;
    try {
      if (el.dataset.cenable !== undefined) { await api('POST', `/api/floors/${sp}/cadence/enable`, {}); return again(t('Routines on')); }
      if (!id) return;
      if (el.dataset.crun !== undefined) { el.disabled = true; const r = await api('POST', `/api/floors/${sp}/cadence/${id}/run`, {}); return again(r.waiting ? t('Queued: {reason}', { reason: tx(r.dispatch.reason) }) : t('Started')); }
      if (el.dataset.cremove !== undefined) { if (!confirm(t('Remove this routine? Its past runs stay in the Squad Log.'))) return; await api('DELETE', `/api/floors/${sp}/cadence/${id}`); return again(t('Routine removed')); }
    } catch (err) { el.disabled = false; toast(err.message, 5000); }
  });
}
