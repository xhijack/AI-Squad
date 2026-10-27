// SPDX-License-Identifier: Apache-2.0
// Admin → Legal and the model tiering section of Admin → Dispatcher (0.20): the contracts of the Legal Spaces (only
// the Owner approves one; the server puts anything else back to DRAFT), and which model background work runs on,
// with the cost per job before and after.
import { esc, api, toast, ago } from './lib.js';
import { t } from './i18n.js';

const STATUS = { DRAFT: t('Draft'), 'READY FOR REVIEW': t('Ready for review'), APPROVED: t('Approved') };
const tone = (c) => (c.approvedAt ? 'live' : c.status === 'READY FOR REVIEW' ? 'update' : '');
const usd = (n) => (n == null ? '–' : `$${Number(n).toFixed(n < 1 ? 3 : 2)}`);

export function legalHtml(x) {
  const m = x.metrics;
  return `<p class="note">${t('Contracts live in the Legal Space (contracts/), copied from the locked bilingual templates in the Company Brain (legal/templates). Agents can only set DRAFT or READY FOR REVIEW; you approve in the app. A contract marked APPROVED any other way, or changed after your approval, is put back to DRAFT.')}</p>
    <div class="kpis"><div><span>${t('Contracts')}</span><b>${m.total}</b></div><div><span>${t('Draft')}</span><b>${m.draft}</b></div><div><span>${t('Ready for review')}</span><b>${m.review}</b></div>
      <div><span>${t('Approved')}</span><b>${m.approved}</b></div><div><span>${t('Revisions')}</span><b>${m.revisions}</b></div></div>
    ${x.alerts.length ? `<div class="adminList">${x.alerts.map((a) => `<div class="adminRow"><div class="row"><span class="badge update">${t('Alert')}</span><span class="grow">${esc(a.text)}</span><span class="note">${ago(a.at)}</span></div></div>`).join('')}</div>` : ''}
    ${x.contracts.length ? `<div class="adminList">${x.contracts.map((c) => `<div class="adminRow"><div class="row"><span class="badge ${tone(c)}">${esc(c.approvedAt ? STATUS.APPROVED : STATUS[c.status] || c.status || '?')}</span><b class="grow">${esc(c.title)}</b><button class="small ghost" data-contract="${esc(c.key)}">${t('Read')}</button></div>
      <div class="note">${esc(c.space)} · <span class="mono">${esc(c.rel)}</span>${c.checklist.present ? ` · ${t('checklist {done} done, {open} open', { done: c.checklist.done, open: c.checklist.open })}` : ` · ${t('no checklist yet')}`}${c.revisions ? ` · ${t('{n} revisions', { n: c.revisions })}` : ''}${c.approvedAt ? ` · ${t('approved {ago}', { ago: ago(c.approvedAt) })}` : ''}</div>
      <div data-ctext="${esc(c.key)}"></div></div>`).join('')}</div>` : `<div class="empty">${t('No contracts yet. Set up a Legal squad (Set up Squad → Legal) and ask its lead for one.')}</div>`}`;
}

export function tieringHtml(x) {
  if (!x) return '';
  const s = x.settings, st = x.stats;
  const sel = (tier) => `<select name="m-${tier}">${['haiku', 'sonnet', 'opus'].concat(s.models[tier] && !['haiku', 'sonnet', 'opus'].includes(s.models[tier]) ? [s.models[tier]] : []).map((m) => `<option ${m === s.models[tier] ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`;
  return `<form class="section" data-tiering><div class="sectionHead"><h3 class="grow">${t('Model tiering')}</h3><span class="badge ${s.enabled ? 'live' : ''}">${s.enabled ? t('On') : t('Off')}</span></div>
    <p class="note">${t('Background jobs run on the model their work needs: routine work (a new lead, a reply to a handoff, a result to file) one tier lighter than the role. Legal roles keep their model, an agent whose model you set keeps it, and Desk sessions and chats always use the role\'s model.')}</p>
    <div class="grid4"><label class="row" style="flex-direction:row;align-items:center;margin-top:18px"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> ${t('Use model tiering')}</label>
      <label>${t('Light tier')}${sel('light')}</label><label>${t('Standard tier')}${sel('standard')}</label><label>${t('Deep tier')}${sel('deep')}</label></div>
    <div class="kpis"><div><span>${t('Cost per job before')}</span><b>${usd(st.before.avg)}</b><span>${t('{n} jobs', { n: st.before.jobs })}</span></div>
      <div><span>${t('Cost per job since')}</span><b>${usd(st.after.avg)}</b><span>${t('{n} jobs', { n: st.after.jobs })}</span></div>
      <div><span>${t('Change since')}</span><b>${st.change == null ? '–' : `${st.change > 0 ? '+' : ''}${st.change} %`}</b><span>${t('target −30 %')}</span></div></div>
    <div class="row"><span class="spacer"></span><button class="gold" type="submit">${t('Save')}</button></div></form>`;
}

export function bindLegal(body, again) {
  body.addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.dataset.tiering === undefined) return;
    e.preventDefault();
    try {
      await api('PATCH', '/api/tiering', { enabled: f.elements.enabled.checked, models: { light: f.elements['m-light'].value, standard: f.elements['m-standard'].value, deep: f.elements['m-deep'].value } });
      await again(t('Saved'));
    } catch (err) { toast(err.message, 5000); }
  });
  body.addEventListener('click', async (e) => {
    const key = e.target.dataset?.contract;
    if (!key) return;
    const box = body.querySelector(`[data-ctext="${CSS.escape(key)}"]`);
    if (!box) return;
    if (box.innerHTML) { box.innerHTML = ''; return; }
    try { const c = await api('GET', `/api/legal/contract?key=${encodeURIComponent(key)}`); box.innerHTML = `<pre class="contractText">${esc(c.text)}</pre>`; }
    catch (err) { toast(err.message, 5000); }
  });
}
