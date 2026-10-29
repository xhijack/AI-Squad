// SPDX-License-Identifier: Apache-2.0
// Admin → Targets (1.3): the numbers every Space works against. Per Space: each target with its value now, its goal,
// its status and where the value comes from; the Owner adds targets and sets goals, people enter manual values,
// the server measures ERPNext, CSV and integration targets; the Space's webhook address for outside systems. A target
// from an integration (1.6): an MCP server the Space may use, one of its read-only tools, its arguments (a form from
// the tool's input schema), how the number is read, and Try before saving. Edit (1.7) changes a target's source in
// place: the history stays, and the first value from the new source starts a new line in the sparkline.
import { esc, api, toast, ago } from './lib.js';
import { t, tx } from './i18n.js';
import { KIND } from './admin-int.js';

const STATE = { met: t('Met'), behind: t('Behind'), unset: t('No goal yet'), unknown: t('No value yet') };
const TONE = { met: 'live', behind: 'bad', unset: '', unknown: '' };
const PERIOD = { day: t('today'), week: t('this week'), month: t('this month'), total: t('in total') };
const SOURCE = { manual: t('entered by a person'), erpnext: 'ERPNext', csv: 'CSV', webhook: t('webhook'), mcp: t('from an integration') };
const MEASURED = ['erpnext', 'csv', 'mcp'];
const PICK = { path: t('the value at a path'), count: t('the number of items in a list'), sum: t('a field added up across a list'), regex: t('a number in the text (regular expression)') };
const EVERY = { hour: t('every hour'), day: t('every day'), week: t('every week') };
// what a target behind its goal raises (1.5)
const MODE = { off: t('nothing'), notify: t('a notice'), suggest: t('a plan to approve'), act: t('the agents act') };
const ACTION = { notice: t('notice'), drafting: t('plan asked'), approved: t('approved'), started: t('started'), dismissed: t('dismissed') };
const agentOpts = (agents = [], v = '') => `<option value="" ${!v ? 'selected' : ''}>${t('the lead')}</option>${agents.map((a) => `<option value="${esc(a.id)}" ${a.id === v || a.role === v ? 'selected' : ''}>${esc(a.displayName)}</option>`).join('')}`;
const agentName = (agents = [], v = '') => (v ? agents.find((a) => a.id === v || a.role === v)?.displayName || v : t('the lead'));
const fmt = (v, unit) => (v == null ? '–' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? ` ${esc(unit)}` : ''}`);
const opts = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');

// ---------- a source from an integration (1.6) ----------
let INTEG = null;                                       // GET /api/integrations (the Owner's), for the picker
const usable = (spId) => (INTEG?.servers || []).filter((s) => !s.blocked && s.usableBy.includes(spId) && s.readOnly.length);
const toolsOf = (s) => (s?.tested?.tools || []).filter((x) => s.readOnly.includes(x.name));
const toolOpts = (s) => toolsOf(s).map((x) => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('');
// a field per top-level argument from the tool's input schema; a date range gets {{from}} / {{to}}
export function argsHtml(tool, values = null) {
  const props = Object.entries(tool?.inputSchema?.properties || {}).slice(0, 20), req = new Set(tool?.inputSchema?.required || []);
  const has = (name) => values && values[name] !== undefined, val = (name) => String(values[name]);
  const field = ([name, p]) => {
    const type = [].concat(p?.type || 'string')[0], label = `<span class="mono">${esc(name)}</span>${req.has(name) ? ' *' : ''}`, title = esc(String(p?.description || '').slice(0, 200));
    const sel = (x) => (has(name) && val(name) === String(x) ? 'selected' : '');
    if (Array.isArray(p?.enum)) return `<label title="${title}">${label}<select data-arg="${esc(name)}" data-type="${esc(type)}"><option value=""></option>${p.enum.slice(0, 50).map((x) => `<option value="${esc(x)}" ${sel(x)}>${esc(x)}</option>`).join('')}</select></label>`;
    if (type === 'boolean') return `<label title="${title}">${label}<select data-arg="${esc(name)}" data-type="boolean"><option value=""></option><option value="true" ${sel(true)}>true</option><option value="false" ${sel(false)}>false</option></select></label>`;
    const guess = has(name) ? val(name) : values ? '' : type === 'string' ? (/^(from|start|since|after|date_?from|start_?date)$/i.test(name) ? '{{from}}' : /^(to|end|until|before|date_?to|end_?date)$/i.test(name) ? '{{to}}' : '') : '';
    return `<label title="${title}">${label}<input data-arg="${esc(name)}" data-type="${['number', 'integer'].includes(type) ? 'number' : 'string'}" ${['number', 'integer'].includes(type) ? 'type="number" step="any"' : ''} value="${esc(guess)}" placeholder="${title}"></label>`;
  };
  const known = new Set(props.map(([n]) => n)), more = values ? Object.fromEntries(Object.entries(values).filter(([k]) => !known.has(k))) : {};
  return `${props.length ? `<div class="grid4">${props.map(field).join('')}</div>` : ''}<label>${t('More arguments (JSON, optional)')}<input name="mcpArgsJson" placeholder='{"status": "published"}' value="${Object.keys(more).length ? esc(JSON.stringify(more)) : ''}"></label>`;
}
// the integration fields; `cur` is the source being edited (1.7), else the first usable server and tool
function mcpBlock(spId, cur = null) {
  const list = usable(spId);
  const show = cur?.kind === 'mcp';
  const wrap = (inner) => `<div class="ksrc" data-src="mcp" ${show ? '' : 'hidden'} style="grid-column: span 4">${inner}</div>`;
  if (!list.length) return wrap(`<div class="note">${t('No integration with a read-only tool for this Space yet: test a server and mark its read-only tools in Admin → Integrations.')}</div>`);
  const server = (show && list.find((s) => s.id === cur.server)) || list[0], tool = toolsOf(server).find((x) => show && x.name === cur.tool) || toolsOf(server)[0];
  const pk = show ? cur.pick || {} : { type: 'path' };
  const hid = (types) => (types.split(' ').includes(pk.type || 'path') ? '' : 'hidden');
  return wrap(`<div class="grid4">
      <label>${t('Integration')}<select name="mcpServer">${list.map((s) => `<option value="${esc(s.id)}" ${s.id === server.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label>${t('Tool (read-only)')}<select name="mcpTool">${toolsOf(server).map((x) => `<option value="${esc(x.name)}" ${x.name === tool?.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label>${t('Read the number as')}<select name="pickType">${opts(PICK, pk.type || 'path')}</select></label>
      <label data-pick="path count sum" ${hid('path count sum')}>${t('Path')}<input name="pickPath" placeholder="total" value="${esc(pk.path || '')}"></label>
      <label data-pick="sum" ${hid('sum')}>${t('Field to add up')}<input name="pickField" placeholder="reach" value="${esc(pk.field || '')}"></label>
      <label data-pick="regex" ${hid('regex')}>${t('Regular expression')}<input name="pickPattern" placeholder="(\\d+) posts" value="${esc(pk.pattern || '')}"></label></div>
    <div class="mcpArgs">${argsHtml(tool, show ? cur.args || {} : null)}</div>
    <div class="row"><span class="note grow">${t('{{from}} and {{to}} are the first and last day of the target\'s period. Arguments are saved in the repository: no keys here.')}</span><button type="button" class="small" data-ktry>${t('Try')}</button></div>
    <div class="mcpTry"></div>`);
}
function mcpSource(f) {
  const v = (n) => f.elements[n]?.value ?? '';
  const args = {};
  f.querySelectorAll('[data-arg]').forEach((i) => { if (i.value === '') return; args[i.dataset.arg] = i.dataset.type === 'number' ? +i.value : i.dataset.type === 'boolean' ? i.value === 'true' : i.value; });
  if (v('mcpArgsJson').trim()) { let j; try { j = JSON.parse(v('mcpArgsJson')); } catch { j = null; } if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(t('More arguments must be a JSON object, e.g. {"status": "published"}')); Object.assign(args, j); }
  return { kind: 'mcp', server: v('mcpServer'), tool: v('mcpTool'), args, pick: { type: v('pickType'), path: v('pickPath'), field: v('pickField'), pattern: v('pickPattern') } };
}
// the fields of every source kind; `cur` fills them for Edit (1.7)
function sourceFields(spId, cur = { kind: 'manual' }) {
  const e = cur.kind === 'erpnext' ? cur : {}, c = cur.kind === 'csv' ? cur : {};
  const hid = (kind) => (cur.kind === kind ? '' : 'hidden');
  return `<div class="ksrc" data-src="erpnext" ${hid('erpnext')} style="grid-column: span 4"><div class="grid4"><label>DocType<input name="doctype" placeholder="Lead" value="${esc(e.doctype || '')}"></label><label>${t('Count or sum')}<select name="aggregate">${opts({ count: t('count'), sum: t('sum of a field') }, e.aggregate || 'count')}</select></label><label>${t('Field to sum')}<input name="field" placeholder="grand_total" value="${esc(e.field || '')}"></label><label>${t('Date field')}<input name="dateField" value="${esc(e.dateField || 'creation')}"></label></div>
      <label>${t('Filters (JSON, optional)')}<input name="filters" placeholder='[["status","=","Ordered"]]' value="${e.filters?.length ? esc(JSON.stringify(e.filters)) : ''}"></label></div>
    ${mcpBlock(spId, cur)}
    <div class="ksrc" data-src="csv" ${hid('csv')} style="grid-column: span 4"><div class="grid4"><label>${t('File in the repository')}<input name="path" placeholder="docs/kpi/traffic.csv" value="${esc(c.path || '')}"></label><label>${t('Column')}<input name="column" value="${esc(c.column || 'value')}"></label><label>${t('Date column')}<input name="dateColumn" value="${esc(c.dateColumn || 'date')}"></label><label>${t('Take')}<select name="csvAggregate">${opts({ last: t('the last row'), sum: t('the sum in the period') }, c.aggregate || 'last')}</select></label></div></div>`;
}
// the source a form describes
function sourceOf(f) {
  const v = (n) => f.elements[n]?.value ?? '';
  const kind = v('kind');
  if (kind === 'erpnext') { let filters = []; if (v('filters').trim()) { try { filters = JSON.parse(v('filters')); } catch { throw new Error(t('Filters must be JSON, e.g. [["status","=","Ordered"]]')); } } return { kind, doctype: v('doctype'), aggregate: v('aggregate'), field: v('field'), dateField: v('dateField'), filters }; }
  if (kind === 'csv') return { kind, path: v('path'), column: v('column'), dateColumn: v('dateColumn'), aggregate: v('csvAggregate') };
  if (kind === 'mcp') return mcpSource(f);
  return { kind };
}
const nameOf = (id) => (INTEG?.servers || []).find((s) => s.id === id)?.name || String(id).split(':').at(-1);

// a small line of the last values; after a source change (1.7) the old values are faint and a new line starts
export function spark(series, switchedAt = 0) {
  if (!series || series.length < 2) return '';
  const vs = series.map((p) => p.value), min = Math.min(...vs), max = Math.max(...vs), w = 90, h = 22;
  const xy = (v, i) => `${(i / (vs.length - 1)) * w},${h - 2 - (max === min ? h / 2 : ((v - min) / (max - min)) * (h - 4))}`;
  const cut = switchedAt ? series.findIndex((p) => p.ts >= switchedAt) : 0;
  const line = (from, to, cls = '') => (to - from >= 1 ? `<polyline class="${cls}" fill="none" stroke="currentColor" stroke-width="1.5" ${cls ? 'opacity="0.35"' : ''} points="${vs.slice(from, to + 1).map((v, j) => xy(v, from + j)).join(' ')}"/>` : '');
  if (cut <= 0) return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${switchedAt && cut < 0 ? line(0, vs.length - 1, 'old') : line(0, vs.length - 1)}</svg>`;
  const x = ((cut - 0.5) / (vs.length - 1)) * w;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${line(0, cut - 1, 'old')}<line x1="${x}" x2="${x}" y1="0" y2="${h}" stroke="currentColor" stroke-dasharray="2 2" opacity="0.5"/>${line(cut, vs.length - 1)}${cut === vs.length - 1 ? `<circle cx="${w}" cy="${xy(vs.at(-1), vs.length - 1).split(',')[1]}" r="1.8" fill="currentColor"/>` : ''}</svg>`;
}

export function targetsHtml(x, d, me, integ = null) {
  const owner = me?.role === 'owner';
  INTEG = integ;
  const spaces = (d.spaces || []).filter((s) => !s.missing);
  const o = x || { spaces: [], total: 0, met: 0, behind: 0, unset: 0, unknown: 0 };
  const bySpace = Object.fromEntries(o.spaces.map((s) => [s.id, s]));
  return `<p class="note">${t('Targets are the numbers a Space works against: the agents read them in docs/squad/KPI.md and plan against the ones that are behind. You set the goal; the value comes from a person, from ERPNext, from a CSV file in the repository, or from an outside system through the Space\'s webhook. Every measurement is in the Squad Log.')}</p>
    <div class="kpis"><div><span>${t('Targets')}</span><b>${o.total}</b></div><div><span>${t('Met')}</span><b>${o.met}</b></div><div><span>${t('Behind')}</span><b class="${o.behind ? 'badText' : ''}">${o.behind}</b></div><div><span>${t('Acting')}</span><b>${o.acting || 0}</b></div><div><span>${t('No goal yet')}</span><b>${o.unset}</b></div><div><span>${t('No value yet')}</span><b>${o.unknown}</b></div></div>
    ${spaces.map((sp) => {
      const s = bySpace[sp.id] || { kpis: [] };
      return `<div class="section" data-kspace="${esc(sp.id)}"><div class="sectionHead"><h3 class="grow">${sp.number} · ${esc(sp.name)}</h3>${s.kpis.length ? `<span class="note">${t('{met} met · {behind} behind', { met: s.met || 0, behind: s.behind || 0 })}</span>` : ''}</div>
        ${s.unreadable ? `<div class="note badText">${t('The values file of this Space is not valid JSON; fix or remove it under ~/.aisquad/kpi/ and the values and webhook come back.')}</div>` : ''}
        ${s.kpis.length ? `<div class="adminList">${s.kpis.map((k) => `<div class="adminRow" data-kpi="${esc(k.id)}"><div class="row"><span class="badge ${TONE[k.status.state]}">${STATE[k.status.state]}${k.status.pct != null ? ` ${k.status.pct} %` : ''}</span><b class="grow">${esc(tx(k.name))}</b>
            <span class="kval">${fmt(k.stale ? null : k.latest?.value, k.unit)}</span><span class="note">/ ${k.target == null ? t('no goal') : fmt(k.target, k.unit)}</span>${spark(k.series, k.switchedAt)}</div>
          <div class="note">${k.direction === 'down' ? t('at most') : t('at least')} · ${PERIOD[k.period]} · ${SOURCE[k.source.kind] || k.source.kind}${k.source.kind === 'erpnext' ? ` (${esc(k.source.aggregate)} ${esc(k.source.doctype)})` : k.source.kind === 'csv' ? ` (<span class="mono">${esc(k.source.path)}</span>)` : k.source.kind === 'mcp' ? ` (${esc(nameOf(k.source.server))} · <span class="mono">${esc(k.source.tool)}</span>)` : ''}${MEASURED.includes(k.source.kind) ? ` · ${EVERY[k.every]}` : ''} · ${k.latest ? t('measured {ago}', { ago: ago(k.latest.ts) }) : t('never measured')}${k.stale ? ` · <span class="warnText">${t('from the previous period')}</span>` : ''}${k.error ? ` · <span class="badText">${t('last measurement failed: {error}', { error: esc(k.error.error) })}</span>` : ''}${k.note ? ` · ${esc(k.note)}` : ''}</div>
          ${k.requires && k.source.kind !== 'mcp' ? `<div class="note">${t('Connect {kind} to measure it (Admin → Integrations), then add it from an integration.', { kind: esc(KIND[k.requires.slice(4)] || k.requires) })}</div>` : ''}
          <div class="note whenBehind">${t('When behind:')} <b>${MODE[k.onBehind?.mode || 'off']}</b>${k.onBehind && k.onBehind.mode !== 'off' && k.onBehind.mode !== 'notify' ? ` · ${esc(agentName(s.agents, k.onBehind.agent))}` : ''}${k.onBehind?.task ? ` · ${esc(k.onBehind.task.slice(0, 80))}` : ''}</div>
          ${owner ? `<details class="kbehind"><summary class="note">${t('Change what happens when it is behind')}</summary><form class="grid4" data-kbehind>
            <label>${t('When behind')}<select name="mode">${opts(MODE, k.onBehind?.mode || 'off')}</select></label>
            <label>${t('Agent')}<select name="agent">${agentOpts(s.agents, k.onBehind?.agent)}</select></label>
            <label>${t('Cooldown (hours)')}<input name="cooldown" type="number" min="1" max="720" value="${k.onBehind?.cooldown || 24}"></label>
            <label style="grid-column: span 4">${t('Task for the agent')}<input name="task" value="${esc(k.onBehind?.task || '')}" placeholder="${t('e.g. Write two extra posts with a lead form')}"></label>
            <div class="row" style="grid-column: span 4"><span class="note grow">${t('A notice tells you; a plan comes to you for Approve or Dismiss; "act" starts the task by itself only in a Space with Autopilot full, otherwise it asks.')}</span><button class="small gold">${t('Save')}</button></div>
          </form></details>
          <details class="kedit"><summary class="note">${t('Edit the source')}</summary><form class="grid4" data-kedit>
            <label>${t('Source')}<select name="kind">${opts(SOURCE, k.source.kind)}</select></label>
            <label>${t('Measure')}<select name="every">${opts(EVERY, k.every)}</select></label>
            <input type="hidden" name="period" value="${esc(k.period)}">
            ${sourceFields(sp.id, k.source)}
            <div class="row" style="grid-column: span 4"><span class="note grow">${t('The history stays; values from the new source start a new line, and the status counts from its first value.')}</span><button class="small gold">${t('Save the source')}</button></div>
          </form></details>` : ''}
          <div class="row wrap">
            ${['manual', 'webhook'].includes(k.source.kind) ? `<form class="row" data-kvalue><input name="value" type="number" step="any" placeholder="${t('Value now')}" required style="width:120px"><input name="note" placeholder="${t('Note (optional)')}" style="width:160px"><button class="small">${t('Enter')}</button></form>` : `<button class="small" data-kmeasure>${t('Measure now')}</button>`}
            <span class="spacer"></span>
            ${owner ? `<form class="row" data-kgoal><input name="target" type="number" step="any" placeholder="${t('Goal value')}" value="${k.target ?? ''}" style="width:110px"><button class="small gold">${t('Set goal')}</button></form><button class="small ghost danger" data-kremove>${t('Remove')}</button>` : ''}
          </div></div>`).join('')}</div>` : `<div class="note">${t('No targets yet for this Space.')}</div>`}
        ${s.triggers?.length ? `<details class="ktriggers"><summary class="note">${t('Triggers ({n})', { n: s.triggers.length })}</summary><ul class="list">${s.triggers.map((h) => `<li class="note">${ago(h.ts)} · <b>${esc(tx(h.name || h.kpi))}</b> · ${ACTION[h.action] || esc(h.action)}${h.value != null ? ` · ${fmt(h.value)} / ${fmt(h.target)}` : ''}${h.by ? ` · ${esc(h.by)}` : ''}${h.fallback ? ` · <span class="warnText">${esc(tx(h.fallback))}</span>` : ''}</li>`).join('')}</ul></details>` : ''}
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
            ${sourceFields(sp.id)}
            <div class="row" style="grid-column: span 4"><span class="spacer"></span><button class="small gold">${t('Add')}</button></div>
          </form></details>
          ${s.hook ? `<div class="note row wrap">${esc(t('Webhook for outside systems (POST JSON {"kpi": "<id>", "value": 12}):'))} <span class="mono">${esc(location.origin + s.hook)}</span> <button class="small ghost" data-khook>${t('New address')}</button></div>` : ''}` : ''}
      </div>`;
    }).join('')}`;
}

export function bindTargets(body, again) {
  body.addEventListener('change', (e) => {
    const f = e.target.closest('form[data-kadd], form[data-kedit]');
    if (!f) return;
    const n = e.target.name;
    if (n === 'kind') f.querySelectorAll('.ksrc').forEach((el) => { el.hidden = el.dataset.src !== e.target.value; });
    const server = () => (INTEG?.servers || []).find((s) => s.id === f.elements.mcpServer.value);
    if (n === 'mcpServer') f.elements.mcpTool.innerHTML = toolOpts(server());
    if (n === 'mcpServer' || n === 'mcpTool') { f.querySelector('.mcpArgs').innerHTML = argsHtml(toolsOf(server()).find((x) => x.name === f.elements.mcpTool.value)); f.querySelector('.mcpTry').innerHTML = ''; }
    if (n === 'pickType') f.querySelectorAll('[data-pick]').forEach((el) => { el.hidden = !el.dataset.pick.split(' ').includes(e.target.value); });
  });
  body.addEventListener('submit', async (e) => {
    const f = e.target, sp = f.closest('[data-kspace]')?.dataset.kspace, id = f.closest('[data-kpi]')?.dataset.kpi;
    if (!sp) return;
    const v = (n) => f.elements[n]?.value ?? '';
    try {
      if (f.dataset.kvalue !== undefined) { e.preventDefault(); await api('POST', `/api/floors/${sp}/kpis/${id}/values`, { value: +v('value'), note: v('note') }); return again(t('Value entered')); }
      if (f.dataset.kbehind !== undefined) { e.preventDefault(); await api('PATCH', `/api/floors/${sp}/kpis/${id}`, { onBehind: { mode: v('mode'), agent: v('agent'), task: v('task'), cooldown: +v('cooldown') || 24 } }); return again(t('Saved')); }
      if (f.dataset.kedit !== undefined) {                     // the source changed in place (1.7)
        e.preventDefault();
        await api('PATCH', `/api/floors/${sp}/kpis/${id}`, { source: sourceOf(f), every: v('every') });
        return again(t('Source changed'));
      }
      if (f.dataset.kgoal !== undefined) { e.preventDefault(); await api('PATCH', `/api/floors/${sp}/kpis/${id}`, { target: v('target') === '' ? null : +v('target') }); return again(t('Goal set')); }
      if (f.dataset.kadd !== undefined) {
        e.preventDefault();
        await api('POST', `/api/floors/${sp}/kpis`, { name: v('name'), unit: v('unit'), target: v('target') === '' ? null : +v('target'), direction: v('direction'), period: v('period'), every: v('every'), note: v('note'), source: sourceOf(f) });
        return again(t('Target added'));
      }
    } catch (err) { toast(err.message, 5000); }
  });
  body.addEventListener('click', async (e) => {
    const el = e.target, sp = el.closest('[data-kspace]')?.dataset.kspace, id = el.closest('[data-kpi]')?.dataset.kpi;
    if (!sp) return;
    try {
      if (el.dataset.ktry !== undefined) {
        const f = el.closest('form'), box = f.querySelector('.mcpTry');
        el.disabled = true;
        try {
          const r = await api('POST', `/api/floors/${sp}/kpis/try`, { source: mcpSource(f), period: f.elements.period.value });
          box.innerHTML = `<div class="note">${r.error ? `<span class="badText">${esc(tx(r.error))}</span>` : `${t('The number:')} <b class="kval">${fmt(r.value)}</b>`} · ${t('sent')} <span class="mono">${esc(JSON.stringify(r.args))}</span></div>
            <details ${r.error ? 'open' : ''}><summary class="note">${t('The result as the tool returned it')}</summary><pre class="note pre mono">${esc(r.raw)}</pre></details>`;
        } finally { el.disabled = false; }
        return;
      }
      if (el.dataset.khook !== undefined) { if (!confirm(t('Make a new webhook address? The old one stops working at once; update the outside systems.'))) return; await api('POST', `/api/floors/${sp}/kpis/hook`, {}); return again(t('New webhook address')); }
      if (!id) return;
      if (el.dataset.kmeasure !== undefined) { const r = await api('POST', `/api/floors/${sp}/kpis/${id}/measure`, {}); return again(t('Measured: {v}', { v: r.value })); }
      if (el.dataset.kremove !== undefined) { if (!confirm(t('Remove this target? Its measurements stay in the Squad Log.'))) return; await api('DELETE', `/api/floors/${sp}/kpis/${id}`); return again(t('Target removed')); }
    } catch (err) { toast(err.message, 5000); }
  });
}
