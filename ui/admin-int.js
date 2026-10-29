// SPDX-License-Identifier: Apache-2.0
// Admin → Integrations (1.6): the MCP servers the Building knows, read from where they are (Claude Code's user scope,
// each Space's .mcp.json, the ERPNext MCP), with secrets masked. Per server: Test connection (its tools and their
// input schemas), what it measures (its kind), and the tools the Owner marks read-only: only those may feed a target.
import { esc, api, toast, ago } from './lib.js';
import { t, tx } from './i18n.js';

export const KIND = { 'social-scheduler': t('Social scheduler'), analytics: t('Analytics'), ads: t('Ads'), helpdesk: t('Help desk'), database: t('Database'), crm: t('CRM'), erp: 'ERP', other: t('Other') };
const SOURCE = { user: t('Claude Code, your user scope (~/.claude.json)'), space: t('the Space\'s .mcp.json'), erpnext: t('AI Squad (ERPNext)') };
const opts = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
const pairs = (o) => Object.entries(o || {}).map(([k, v]) => `<span class="mono">${esc(k)}: ${esc(v)}</span>`).join(' · ');

function status(s) {
  if (s.blocked) return `<span class="badge">${s.blocked.startsWith('Needs sign-in') ? t('Needs sign-in in Claude Code') : t('Not usable')}</span>`;
  if (!s.tested) return `<span class="badge">${t('Not tested')}</span>`;
  return s.tested.ok ? `<span class="badge live">${t('{n} tools', { n: s.tested.tools.length })}</span>` : `<span class="badge update">${t('Failed')}</span>`;
}
// the tools with a read-only box; before the Owner saved any, the server's own readOnlyHint pre-ticks the box
function toolsHtml(s) {
  if (!s.tested?.ok) return '';
  if (!s.tested.tools.length) return `<div class="note">${t('The server has no tools.')}</div>`;
  const on = (tool) => (s.marked ? s.readOnly.includes(tool.name) : tool.readOnlyHint);
  return `<div class="adminList">${s.tested.tools.map((tool) => `<div class="adminRow"><label class="row"><input type="checkbox" data-ro="${esc(tool.name)}" ${on(tool) ? 'checked' : ''}><b class="mono grow">${esc(tool.name)}</b>
      ${tool.readOnlyHint ? `<span class="badge">${t('read-only by its server')}</span>` : ''}${s.readOnly.includes(tool.name) ? `<span class="badge live">${t('read-only')}</span>` : ''}</label>
      ${tool.description ? `<div class="note">${esc(tool.description.slice(0, 240))}</div>` : ''}
      <details><summary class="note">${t('Input schema')}</summary><pre class="note pre mono">${esc(JSON.stringify(tool.inputSchema, null, 2))}</pre></details></div>`).join('')}</div>
    <div class="row"><span class="note grow">${s.marked ? t('Ticked tools may feed a target. The server calls only the tool a target names, never another.') : t('Pre-ticked from what the server says about its tools: check them, then save. Nothing is read-only until you save.')}</span><button class="small gold" data-isave>${t('Save read-only tools')}</button></div>`;
}

export function integrationsHtml(x, d) {
  const name = (id) => { const sp = (d.spaces || []).find((s) => s.id === id); return sp ? `${sp.number} · ${esc(sp.name)}` : esc(id); };
  const servers = x?.servers || [];
  return `<p class="note">${t('The MCP servers this Building knows. AI Squad reads them from where they already are and never changes them: your user scope in Claude Code, each Space\'s .mcp.json, and the ERPNext MCP. A target can read a number from a server here, without a model, through a tool you mark read-only. Secrets stay where they are: ${VAR} references are resolved on this machine only when a call is made.')}</p>
    <p class="note">${t('Who can use what: an Owner-only Space uses your own servers and its .mcp.json; a team Space uses only its own .mcp.json, never your personal servers; ERPNext goes with the Space\'s ERPNext key.')}</p>
    ${servers.length ? servers.map((s) => `<div class="section" data-integ="${esc(s.id)}"><div class="sectionHead"><span class="badge">${esc(s.transport)}</span><h3 class="grow">${esc(s.name)}</h3>${status(s)}</div>
      <div class="note">${esc(SOURCE[s.source] || s.source)}${s.floorId ? ` · ${name(s.floorId)}` : ''} · <span class="mono">${esc(s.id)}</span></div>
      <div class="note mono" style="overflow-wrap:anywhere">${s.url ? esc(s.url) : `${esc(s.command || '')} ${esc((s.args || []).join(' '))}`}</div>
      ${Object.keys(s.headers).length ? `<div class="note">${t('Headers')}: ${pairs(s.headers)}</div>` : ''}${Object.keys(s.env).length ? `<div class="note">${t('Environment')}: ${pairs(s.env)}</div>` : ''}
      <div class="note">${t('Spaces that can use it:')} ${s.usableBy.length ? s.usableBy.map(name).join(', ') : t('none')}</div>
      ${s.blocked ? `<div class="note warnText">${esc(tx(s.blocked))}</div>` : ''}
      <div class="row wrap"><label class="row">${t('Measures')}<select data-ikind>${opts(KIND, s.kind)}</select></label>${s.kindSet ? '' : `<span class="note">${t('(guessed from the name)')}</span>`}<span class="spacer"></span>
        <span class="note">${s.tested ? t('tested {ago}', { ago: ago(s.tested.at) }) : ''}</span><button class="small" data-itest ${s.blocked && !s.blocked.startsWith('Needs sign-in') ? 'disabled' : ''}>${t('Test connection')}</button></div>
      ${s.tested && !s.tested.ok ? `<div class="note badText">${esc(tx(s.tested.error))}</div>` : ''}
      ${toolsHtml(s)}
    </div>`).join('') : `<div class="empty">${t('No MCP servers found. Add one in Claude Code (claude mcp add --scope user …) or in a Space\'s .mcp.json; AI Squad reads them from there.')}</div>`}`;
}

export function bindIntegrations(body, again) {
  body.addEventListener('click', async (e) => {
    const el = e.target, box = el.closest('[data-integ]');
    if (!box) return;
    const id = box.dataset.integ;
    try {
      if (el.dataset.itest !== undefined) {
        el.disabled = true; el.textContent = t('Testing…');
        const r = await api('POST', '/api/integrations/test', { id });
        return again(r.tested.ok ? t('{n} tools', { n: r.tested.tools.length }) : tx(r.tested.error));
      }
      if (el.dataset.isave !== undefined) {
        await api('PATCH', '/api/integrations/marks', { id, readOnly: [...box.querySelectorAll('[data-ro]:checked')].map((c) => c.dataset.ro) });
        return again(t('Saved'));
      }
    } catch (err) { toast(err.message, 5000); }
  });
  body.addEventListener('change', async (e) => {
    if (e.target.dataset.ikind === undefined) return;
    try { await api('PATCH', '/api/integrations/marks', { id: e.target.closest('[data-integ]').dataset.integ, kind: e.target.value }); await again(t('Saved')); } catch (err) { toast(err.message, 5000); }
  });
}
