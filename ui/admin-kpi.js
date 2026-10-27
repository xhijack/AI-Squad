// SPDX-License-Identifier: Apache-2.0
// Admin → Targets (1.1): the numbers every Space works against. Per Space: each target with its value now, its goal,
// its status and where the value comes from; the Owner adds targets and sets goals, people enter manual values,
// the server measures ERPNext and CSV targets; the Space's webhook address for outside systems.
import { esc, api, toast, ago } from './lib.js';
import { t } from './i18n.js';

const STATE = { met: t('Met'), behind: t('Behind'), unset: t('No goal yet'), unknown: t('No value yet') };
const TONE = { met: 'live', behind: 'bad', unset: '', unknown: '' };
const PERIOD = { day: t('today'), week: t('this week'), month: t('this month'), total: t('in total') };
const SOURCE = { manual: t('entered by a person'), erpnext: 'ERPNext', csv: 'CSV', webhook: t('webhook') };
const EVERY = { hour: t('every hour'), day: t('every day'), week: t('every week') };
const fmt = (v, unit) => (v == null ? '–' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? ` ${esc(unit)}` : ''}`);
const opts = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');

// a small line of the last values
function spark(series) {
  if (!series || series.length < 2) return '';
  const vs = series.map((p) => p.value), min = Math.min(...vs), max = Math.max(...vs), w = 90, h = 22;
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * w},${h - 2 - (max === min ? h / 2 : ((v - min) / (max - min)) * (h - 4))}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts}"/></svg>`;
}

export function targetsHtml(x, d, me) {
  const owner = me?.role === 'owner';
  const spaces = (d.spaces || []).filter((s) => !s.missing);
  const o = x || { spaces: [], total: 0, met: 0, behind: 0, unset: 0, unknown: 0 };
  const bySpace = Object.fromEntries(o.spaces.map((s) => [s.id, s]));
  return `<p class="note">${t('Targets are the numbers a Space works against: the agents read them in docs/squad/KPI.md and plan against the ones that are behind. You set the goal; the value comes from a person, from ERPNext, from a CSV file in the repository, or from an outside system through the Space\'s webhook. Every measurement is in the Squad Log.')}</p>
    <div class="kpis"><div><span>${t('Targets')}</span><b>${o.total}</b></div><div><span>${t('Met')}</span><b>${o.met}</b></div><div><span>${t('Behind')}</span><b class="${o.behind ? 'badText' : ''}">${o.behind}</b></div><div><span>${t('No goal yet')}</span><b>${o.unset}</b></div><div><span>${t('No value yet')}</span><b>${o.unknown}</b></div></div>
    ${spaces.map((sp) => {
      const s = bySpace[sp.id] || { kpis: [] };
      return `<div class="section" data-kspace="${esc(sp.id)}"><div class="sectionHead"><h3 class="grow">${sp.number} · ${esc(sp.name)}</h3>${s.kpis.length ? `<span class="note">${t('{met} met · {behind} behind', { met: s.met || 0, behind: s.behind || 0 })}</span>` : ''}</div>
        ${s.unreadable ? `<div class="note badText">${t('The values file of this Space is not valid JSON; fix or remove it under ~/.aisquad/kpi/ and the values and webhook come back.')}</div>` : ''}
        ${s.kpis.length ? `<div class="adminList">${s.kpis.map((k) => `<div class="adminRow" data-kpi="${esc(k.id)}"><div class="row"><span class="badge ${TONE[k.status.state]}">${STATE[k.status.state]}${k.status.pct != null ? ` ${k.status.pct} %` : ''}</span><b class="grow">${esc(k.name)}</b>
            <span class="kval">${fmt(k.stale ? null : k.latest?.value, k.unit)}</span><span class="note">/ ${k.target == null ? t('no goal') : fmt(k.target, k.unit)}</span>${spark(k.series)}</div>
          <div class="note">${k.direction === 'down' ? t('at most') : t('at least')} · ${PERIOD[k.period]} · ${SOURCE[k.source.kind] || k.source.kind}${k.source.kind === 'erpnext' ? ` (${esc(k.source.aggregate)} ${esc(k.source.doctype)})` : k.source.kind === 'csv' ? ` (<span class="mono">${esc(k.source.path)}</span>)` : ''}${['erpnext', 'csv'].includes(k.source.kind) ? ` · ${EVERY[k.every]}` : ''} · ${k.latest ? t('measured {ago}', { ago: ago(k.latest.ts) }) : t('never measured')}${k.stale ? ` · <span class="warnText">${t('from the previous period')}</span>` : ''}${k.error ? ` · <span class="badText">${t('last measurement failed: {error}', { error: esc(k.error.error) })}</span>` : ''}${k.note ? ` · ${esc(k.note)}` : ''}</div>
          <div class="row wrap">
            ${['manual', 'webhook'].includes(k.source.kind) ? `<form class="row" data-kvalue><input name="value" type="number" step="any" placeholder="${t('Value now')}" required style="width:120px"><input name="note" placeholder="${t('Note (optional)')}" style="width:160px"><button class="small">${t('Enter')}</button></form>` : `<button class="small" data-kmeasure>${t('Measure now')}</button>`}
            <span class="spacer"></span>
            ${owner ? `<form class="row" data-kgoal><input name="target" type="number" step="any" placeholder="${t('Goal value')}" value="${k.target ?? ''}" style="width:110px"><button class="small gold">${t('Set goal')}</button></form><button class="small ghost danger" data-kremove>${t('Remove')}</button>` : ''}
          </div></div>`).join('')}</div>` : `<div class="note">${t('No targets yet for this Space.')}</div>`}
        ${owner ? `<details class="kadd"><summary class="note">${t('Add a target')}</summary>
          <form class="grid4" data-kadd>
            <label>${t('Name')}<input name="name" required placeholder="${t('e.g. Leads from the site')}"></label>
            <label>${t('Unit')}<input name="unit" placeholder="leads"></label>
            <label>${t('Goal value')}<input name="target" type="number" step="any"></label>
            <label>${t('Direction')}<select name="direction">${opts({ up: t('more is better'), down: t('less is better') }, 'up')}</select></label>
            <label>${t('Period')}<select name="period">${opts(PERIOD, 'month')}</select></label>
            <label>${t('Source')}<select name="kind">${opts(SOURCE, 'manual')}</select></label>
            <label>${t('Measure')}<select name="every">${opts(EVERY, 'day')}</select></label>
            <label>${t('Note')}<input name="note"></label>
            <div class="ksrc" data-src="erpnext" hidden style="grid-column: span 4"><div class="grid4"><label>DocType<input name="doctype" placeholder="Lead"></label><label>${t('Count or sum')}<select name="aggregate">${opts({ count: t('count'), sum: t('sum of a field') }, 'count')}</select></label><label>${t('Field to sum')}<input name="field" placeholder="grand_total"></label><label>${t('Date field')}<input name="dateField" value="creation"></label></div>
              <label>${t('Filters (JSON, optional)')}<input name="filters" placeholder='[["status","=","Ordered"]]'></label></div>
            <div class="ksrc" data-src="csv" hidden style="grid-column: span 4"><div class="grid4"><label>${t('File in the repository')}<input name="path" placeholder="docs/kpi/traffic.csv"></label><label>${t('Column')}<input name="column" value="value"></label><label>${t('Date column')}<input name="dateColumn" value="date"></label><label>${t('Take')}<select name="csvAggregate">${opts({ last: t('the last row'), sum: t('the sum in the period') }, 'last')}</select></label></div></div>
            <div class="row" style="grid-column: span 4"><span class="spacer"></span><button class="small gold">${t('Add')}</button></div>
          </form></details>
          ${s.hook ? `<div class="note row wrap">${esc(t('Webhook for outside systems (POST JSON {"kpi": "<id>", "value": 12}):'))} <span class="mono">${esc(location.origin + s.hook)}</span> <button class="small ghost" data-khook>${t('New address')}</button></div>` : ''}` : ''}
      </div>`;
    }).join('')}`;
}

export function bindTargets(body, again) {
  body.addEventListener('change', (e) => {
    if (e.target.name !== 'kind') return;
    const f = e.target.closest('form');
    f.querySelectorAll('.ksrc').forEach((el) => { el.hidden = el.dataset.src !== e.target.value; });
  });
  body.addEventListener('submit', async (e) => {
    const f = e.target, sp = f.closest('[data-kspace]')?.dataset.kspace, id = f.closest('[data-kpi]')?.dataset.kpi;
    if (!sp) return;
    const v = (n) => f.elements[n]?.value ?? '';
    try {
      if (f.dataset.kvalue !== undefined) { e.preventDefault(); await api('POST', `/api/floors/${sp}/kpis/${id}/values`, { value: +v('value'), note: v('note') }); return again(t('Value entered')); }
      if (f.dataset.kgoal !== undefined) { e.preventDefault(); await api('PATCH', `/api/floors/${sp}/kpis/${id}`, { target: v('target') === '' ? null : +v('target') }); return again(t('Goal set')); }
      if (f.dataset.kadd !== undefined) {
        e.preventDefault();
        const kind = v('kind');
        let source = { kind };
        if (kind === 'erpnext') { let filters = []; if (v('filters').trim()) { try { filters = JSON.parse(v('filters')); } catch { throw new Error(t('Filters must be JSON, e.g. [["status","=","Ordered"]]')); } } source = { kind, doctype: v('doctype'), aggregate: v('aggregate'), field: v('field'), dateField: v('dateField'), filters }; }
        if (kind === 'csv') source = { kind, path: v('path'), column: v('column'), dateColumn: v('dateColumn'), aggregate: v('csvAggregate') };
        await api('POST', `/api/floors/${sp}/kpis`, { name: v('name'), unit: v('unit'), target: v('target') === '' ? null : +v('target'), direction: v('direction'), period: v('period'), every: v('every'), note: v('note'), source });
        return again(t('Target added'));
      }
    } catch (err) { toast(err.message, 5000); }
  });
  body.addEventListener('click', async (e) => {
    const el = e.target, sp = el.closest('[data-kspace]')?.dataset.kspace, id = el.closest('[data-kpi]')?.dataset.kpi;
    if (!sp) return;
    try {
      if (el.dataset.khook !== undefined) { if (!confirm(t('Make a new webhook address? The old one stops working at once; update the outside systems.'))) return; await api('POST', `/api/floors/${sp}/kpis/hook`, {}); return again(t('New webhook address')); }
      if (!id) return;
      if (el.dataset.kmeasure !== undefined) { const r = await api('POST', `/api/floors/${sp}/kpis/${id}/measure`, {}); return again(t('Measured: {v}', { v: r.value })); }
      if (el.dataset.kremove !== undefined) { if (!confirm(t('Remove this target? Its measurements stay in the Squad Log.'))) return; await api('DELETE', `/api/floors/${sp}/kpis/${id}`); return again(t('Target removed')); }
    } catch (err) { toast(err.message, 5000); }
  });
}
