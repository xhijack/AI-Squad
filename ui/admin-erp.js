// SPDX-License-Identifier: Apache-2.0
// Admin → Handoffs and Admin → ERPNext (0.19): the packages that passed between Spaces (with how many needed no
// clarification), and the ERPNext connection: the site, a key per role (write-only), where Leads and won orders go,
// the watcher's state and the Sales pipeline numbers.
import { esc, api, toast, ago } from './lib.js';
import { t } from './i18n.js';

const STATUS = { delivered: t('Delivered'), clarify: t('Questions open'), done: t('Done'), held: t('Waits for you'), approval: t('Price approval'), approved: t('Approved'),
  question: t('Question for you'), answered: t('Answered'), rejected: t('Not delivered'), 'sent-back': t('Sent back'), failed: t('Failed'), closed: t('Closed') };
const KIND = { task: t('Task'), lead: t('Lead'), opportunity: t('Opportunity'), quotation: t('Quotation'), project: t('Project'), clarify: t('Questions'), answer: t('Answers'), done: t('Done') };
const ROLE_TEXT = {
  sales: t('Sales: Lead, Opportunity, Quotation (create and edit, no Submit). Agents of Spaces with the Sales role use it.'),
  delivery: t('Delivery: Project and Task. Agents of Spaces with the Delivery role use it.'),
  owner: t('Owner: may submit Quotations. Only this server uses it, after you approve a price; no agent ever gets it.'),
};
const tone = (s) => (['done', 'approved', 'answered'].includes(s) ? 'live' : ['held', 'approval', 'question', 'clarify'].includes(s) ? 'update' : '');
const hours = (h) => (h == null ? '–' : h < 48 ? t('{n} h', { n: h }) : t('{n} days', { n: Math.round(h / 24 * 10) / 10 }));

export function handoffsHtml(x) {
  const m = x.metrics;
  const where = (p) => (p.floorId === 'erpnext' ? 'ERPNext' : p.floorId === 'owner' ? t('Owner') : esc(p.name || p.floorId));
  return `<p class="note">${t('Work passes between Spaces as a package: an agent writes it to docs/squad/handoffs/outbox/, the server delivers it to the other Space\'s inbox and wakes the receiver (P1). Questions go back as a clarify package, the result as done. Packages leaving an Owner-only Space wait for you; secrets are removed from every package.')}</p>
    <div class="kpis"><div><span>${t('Handoffs')}</span><b>${m.total}</b></div><div><span>${t('Done')}</span><b>${m.done}</b></div>
      <div><span>${t('Done without questions')}</span><b>${m.withoutClarification == null ? '–' : `${m.withoutClarification} %`}</b></div>
      <div><span>${t('Open')}</span><b>${m.open.delivered + m.open.clarify}</b></div><div><span>${t('Waits for you')}</span><b>${m.open.held + m.open.approval}</b></div></div>
    <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="small" data-hscan>${t('Check the outboxes now')}</button></div>
    ${x.handoffs.length ? `<div class="adminList">${x.handoffs.map((h) => `<div class="adminRow"><div class="row"><span class="badge ${tone(h.status)}">${esc(STATUS[h.status] || h.status)}</span><b class="grow">${esc(h.title)}</b><span class="note">${ago(h.createdAt)}</span></div>
      <div class="note">${where(h.from)}${h.from.agentId ? ` (${esc(h.from.agentId)})` : ''} → ${h.to ? where(h.to) : '–'}${h.to?.agentId ? ` (${esc(h.to.agentId)})` : ''} · ${esc(KIND[h.kind] || h.kind)}${h.erpnext ? ` · <span class="mono">${esc(h.erpnext)}</span>` : ''}${h.rounds ? ` · ${t('{n} rounds of questions', { n: h.rounds })}` : ''} · <span class="mono">${esc(h.id)}</span></div>
      ${h.excerpt ? `<div class="note">${esc(h.excerpt)}</div>` : ''}</div>`).join('')}</div>` : `<div class="empty">${t('No handoffs yet.')}</div>`}`;
}

export function erpnextHtml(x, d) {
  const s = x.settings, m = x.metrics;
  const spaces = (d.spaces || []).filter((sp) => !sp.missing);
  const spaceOpts = (v) => `<option value="">${t('Nobody')}</option>${spaces.map((sp) => `<option value="${esc(sp.id)}" ${sp.id === v ? 'selected' : ''}>${sp.number} · ${esc(sp.name)}</option>`).join('')}`;
  const agentOpts = (floorId, v) => `<option value="">${t('The Space\'s lead')}</option>${(d.agents || []).filter((a) => a.floorId === floorId).map((a) => `<option value="${esc(a.id)}" ${a.id === v ? 'selected' : ''}>${esc(a.displayName)}</option>`).join('')}`;
  return `<p class="note">${t('Agents work in ERPNext through Frappe Assistant Core (an MCP server inside ERPNext) with the key of an ERPNext user made for their role, so ERPNext\'s own permissions apply; deleting, submitting, workflows, e-mail and code are blocked on top. The server watches the pipeline: a new Lead goes to Sales, a Quotation an agent hands you becomes a price approval (only you approve; the server then submits it with the owner key), an order becomes a project handoff without prices.')}</p>
    <form class="section" data-erp><div class="sectionHead"><h3 class="grow">${t('Connection')}</h3><span class="badge ${s.enabled ? 'live' : ''}">${s.enabled ? t('On') : t('Off')}</span></div>
      <div class="grid4">
        <label style="grid-column: span 2">${t('ERPNext site')}<input name="url" placeholder="https://office.sopwer.id" value="${esc(s.url)}"></label>
        <label>${t('Check every (minutes)')}<input name="pollMin" type="number" min="1" max="60" value="${s.pollMin}"></label>
        <label class="row" style="flex-direction:row;align-items:center;margin-top:18px"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> ${t('Watch the pipeline')}</label>
        <label>${t('New Leads go to')}<select name="salesFloor">${spaceOpts(s.sales.floorId)}</select></label>
        <label>${t('Agent')}<select name="salesAgent">${agentOpts(s.sales.floorId, s.sales.agentId)}</select></label>
        <label>${t('Orders go to')}<select name="deliveryFloor">${spaceOpts(s.delivery.floorId)}</select></label>
        <label>${t('Agent')}<select name="deliveryAgent">${agentOpts(s.delivery.floorId, s.delivery.agentId)}</select></label>
      </div>
      <div class="row"><span class="note grow">${x.lastSync ? t('Last check {ago}', { ago: ago(x.lastSync) }) : t('Not checked yet')}${x.lastError ? ` · <span class="warnText">${esc(x.lastError)}</span>` : ''}</span>
        <button type="button" class="small ghost" data-erptest>${t('Test the keys')}</button><button type="button" class="small ghost" data-erpsync ${s.enabled ? '' : 'disabled'}>${t('Check now')}</button><button class="gold" type="submit">${t('Save')}</button></div>
      <div id="erpTest"></div>
    </form>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Keys per role')}</h3></div>
      <p class="note">${t('In ERPNext, make one user per role, give it only the roles it needs, and generate its API key and secret (User → API Access). Keys are stored on this machine only and never shown again.')}</p>
      <div class="adminList">${['sales', 'delivery', 'owner'].map((r) => { const k = x.keys[r]; return `<div class="adminRow" data-erprole="${r}"><div class="row"><b class="grow">${esc({ sales: t('Sales'), delivery: t('Delivery'), owner: t('Owner') }[r])}</b>
        <span class="note">${k.set ? `${t('set ····{last4}', { last4: esc(k.last4) })}${k.user ? ` · ${esc(k.user)}` : ''}` : t('not set')}</span></div>
        <div class="note">${ROLE_TEXT[r]}</div>
        <div class="row wrap"><input name="key" placeholder="${t('API key')}" autocomplete="off" class="grow"><input name="secret" type="password" placeholder="${t('API secret')}" autocomplete="off" class="grow">
          <button class="small" data-erpkey="${r}">${t('Save key')}</button>${k.set ? `<button class="small ghost danger" data-erpclear="${r}">${t('Remove')}</button>` : ''}</div></div>`; }).join('')}</div>
      <p class="note">${t('A Space gets ERPNext in Admin → Spaces (ERPNext: Sales or Delivery). Its jobs then run on this machine only, so the keys never reach a worker.')}</p>
    </div>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Sales pipeline')}</h3></div>
      <div class="kpis"><div><span>${t('Leads handed over')}</span><b>${m.leads}</b></div><div><span>${t('Prices approved')}</span><b>${m.approved}</b></div><div><span>${t('Orders')}</span><b>${m.won}</b></div>
        <div><span>${t('Lead → draft quotation')}</span><b>${hours(m.leadToDraftH)}</b></div><div><span>${t('Lead → approved quotation')}</span><b>${hours(m.leadToApprovedH)}</b></div></div>
      ${x.alerts.length ? `<div class="adminList">${x.alerts.map((a) => `<div class="adminRow"><div class="row"><span class="badge update">${t('Alert')}</span><span class="grow">${esc(a.text)}</span></div></div>`).join('')}</div>` : ''}
      ${x.pipeline.length ? `<div class="adminList">${x.pipeline.map((p) => `<div class="adminRow"><div class="row"><b class="grow mono">${esc(p.name)}</b><span class="note">${p.lead ? `${esc(p.lead)} · ` : ''}${p.approvedAt ? t('approved {ago}', { ago: ago(p.approvedAt) }) : t('not approved yet')}${p.wonAt ? ` · ${t('ordered')}` : ''}${p.leadToApprovedH != null ? ` · ${hours(p.leadToApprovedH)}` : ''}</span></div></div>`).join('')}</div>` : ''}
    </div>`;
}

// the handlers of both tabs; again(msg) re-renders the tab
export function bindErp(body, again) {
  body.addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.dataset.erp === undefined) return;
    e.preventDefault();
    try {
      const v = (n) => f.elements[n].value;
      await api('PATCH', '/api/erpnext', { url: v('url').trim(), enabled: f.elements.enabled.checked, pollMin: +v('pollMin'),
        sales: { floorId: v('salesFloor'), agentId: v('salesAgent') }, delivery: { floorId: v('deliveryFloor'), agentId: v('deliveryAgent') } });
      await again(t('Saved'));
    } catch (err) { toast(err.message, 5000); }
  });
  body.addEventListener('click', async (e) => {
    const el = e.target;
    try {
      if (el.dataset.hscan !== undefined) { const r = await api('POST', '/api/handoffs/scan', {}); return again(t('{n} packages sent', { n: r.sent.filter((s) => s.ok).length })); }
      if (el.dataset.erpkey) {
        const row = el.closest('[data-erprole]');
        await api('PUT', `/api/erpnext/keys/${el.dataset.erpkey}`, { key: row.querySelector('[name=key]').value.trim(), secret: row.querySelector('[name=secret]').value.trim() });
        return again(t('Key saved'));
      }
      if (el.dataset.erpclear) { if (!confirm(t('Remove this key? Spaces with this role lose ERPNext.'))) return; await api('DELETE', `/api/erpnext/keys/${el.dataset.erpclear}`); return again(t('Key removed')); }
      if (el.dataset.erptest !== undefined) {
        const r = await api('POST', '/api/erpnext/test', {});
        const box = body.querySelector('#erpTest');
        if (box) box.innerHTML = `<div class="adminList">${Object.entries(r).map(([role, x]) => `<div class="note">${esc(role)}: ${x.ok ? `<span class="okText">${t('works')} (${esc(x.user)})</span>` : `<span class="warnText">${esc(x.error)}</span>`}</div>`).join('')}</div>`;
        return;
      }
      if (el.dataset.erpsync !== undefined) { const r = await api('POST', '/api/erpnext/sync', {}); return again(r.error ? r.error : r.started ? t('Started: new Leads and orders from now on are handed over') : t('{l} leads, {w} orders handed over', { l: r.leads?.length || 0, w: r.won?.length || 0 })); }
    } catch (err) { toast(err.message, 5000); }
  });
  // the agent lists follow the chosen Space
  body.addEventListener('change', (e) => {
    const f = e.target.closest('form[data-erp]');
    if (!f || !['salesFloor', 'deliveryFloor'].includes(e.target.name)) return;
    const agent = f.elements[e.target.name === 'salesFloor' ? 'salesAgent' : 'deliveryAgent'];
    agent.value = '';
    for (const o of agent.options) o.hidden = !!o.value;
  });
}
