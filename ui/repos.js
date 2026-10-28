// SPDX-License-Identifier: Apache-2.0
// Floor settings → Repositories (Phase 3.4): the primary repository plus linked ones (.claude/aisquad/repos.json):
// path (relative to the primary), remote, access (read: context only; write: the assigned agents commit there),
// branch strategy, quality gate and agents; their status on this machine (branch, ahead/behind, uncommitted
// changes), Clone when missing, Relink to another folder, and the automatic-merge approval per write repository.
import { api, esc, toast } from './lib.js';
import { t, tx } from './i18n.js';

const STRATEGY = () => ({ 'agent-branches': t('A branch per agent'), 'feature-branches': t('Feature branches'), trunk: t('Trunk (main)') });
function statusText(s) {
  if (!s) return '';
  if (!s.exists) return t('Not on this machine');
  if (!s.git) return t('Not a git repository');
  return [t('on {branch}', { branch: s.branch }), s.ahead ? t('{n} ahead', { n: s.ahead }) : '', s.behind ? t('{n} behind', { n: s.behind }) : '', s.dirty ? t('{n} uncommitted', { n: s.dirty }) : t('clean')].filter(Boolean).join(' · ');
}
function rowHtml(r, agents) {
  const st = r.status, missing = st && !st.exists;
  return `<div class="card repoRow" data-repo="${esc(r.id || '')}">
    <div class="grid2"><div><label>${t('Id')}</label><input data-k="id" value="${esc(r.id || '')}" placeholder="landing" ${r.id ? 'readonly' : ''}></div>
      <div><label>${t('Path (relative to this repository)')}</label><input data-k="path" value="${esc(r.path || '')}" placeholder="../dtamu-landing-page"></div></div>
    <div class="grid2"><div><label>${t('Remote (for Clone)')}</label><input data-k="remote" value="${esc(r.remote || '')}" placeholder="git@github.com:org/repo.git"></div>
      <div><label>${t('Access')}</label><select data-k="access"><option value="read" ${r.access !== 'write' ? 'selected' : ''}>${t('Read only (context)')}</option><option value="write" ${r.access === 'write' ? 'selected' : ''}>${t('Write (its agents commit there)')}</option></select></div></div>
    <div class="grid2"><div><label>${t('Main branch')}</label><input data-k="main" value="${esc(r.branch?.main || 'main')}"></div>
      <div><label>${t('Branches')}</label><select data-k="strategy">${Object.entries(STRATEGY()).map(([k, v]) => `<option value="${k}" ${(r.branch?.strategy || 'agent-branches') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div></div>
    <label>${t('Quality gate (command, run on the merged result)')}</label><input data-k="gate" value="${esc(r.gate || '')}" placeholder="npm run build && npm test">
    <label>${t('Agents')}</label><div class="row wrap">${agents.map((a) => `<label class="inline" style="margin:0 var(--sp-3) 0 0"><input type="checkbox" data-agent="${esc(a.id)}" ${(r.agents || []).includes(a.id) ? 'checked' : ''}> ${esc(String(a.displayName).split(' - ')[0])}</label>`).join('')}</div>
    <p class="note">${t('Read only with no agents ticked: context for everyone. Write: only the ticked agents edit and commit there; never pushed.')}</p>
    ${st ? `<div class="row wrap" style="margin-top:var(--sp-2)"><span class="chip ${missing ? 'bad' : st.dirty ? 'warn' : 'ok'}">${esc(statusText(st))}</span><span class="note grow">${esc(r.abs || '')}${r.local ? ` · ${t('relinked on this machine')}` : ''}</span>
      ${missing && r.remote ? `<button type="button" class="small gold" data-clone>${t('Clone')}</button>` : ''}<button type="button" class="small ghost" data-relink>${t('Relink')}</button>
      ${r.access === 'write' ? `<label class="inline" style="margin:0"><input type="checkbox" data-approve ${r.approval ? 'checked' : ''}> ${t('Merge automatically after its gate passes')}</label>` : ''}</div>` : ''}
    <div class="row"><span class="grow"></span><button type="button" class="small ghost danger" data-remove>${t('Remove from the list')}</button></div></div>`;
}
const readRow = (el) => {
  const v = (k) => el.querySelector(`[data-k="${k}"]`).value.trim();
  return { id: v('id'), path: v('path'), remote: v('remote') || undefined, access: v('access'), branch: { main: v('main') || 'main', strategy: v('strategy') }, gate: v('gate') || undefined,
    agents: [...el.querySelectorAll('[data-agent]:checked')].map((x) => x.dataset.agent) };
};

// el: the section's element; agents: the Floor's team
export async function loadRepos(floorId, el, agents) {
  let data;
  try { data = await api('GET', `/api/floors/${floorId}/repos`); } catch (e) { el.textContent = e.message; return; }
  const draw = (list) => {
    el.innerHTML = `<p class="note" style="margin-top:0">${t('This repository is the primary one ({status}): the Floor, the board and the docs live here. Linked repositories open to the agents with their access; read-only ones are denied every write.', { status: esc(statusText(data.primary.status)) })}</p>
      <div data-rows>${list.map((r) => rowHtml(r, agents)).join('') || `<div class="empty">${t('No linked repositories.')}</div>`}</div>
      <div class="row"><button type="button" class="small" data-add>${t('+ Add linked repository')}</button><span class="grow"></span><span class="err" data-err></span><button type="button" class="small gold" data-save>${t('Save repositories')}</button></div>`;
    const err = el.querySelector('[data-err]');
    const rows = () => [...el.querySelectorAll('.repoRow')];
    el.querySelector('[data-add]').onclick = () => { el.querySelector('[data-rows] .empty')?.remove(); el.querySelector('[data-rows]').insertAdjacentHTML('beforeend', rowHtml({ access: 'read', branch: { main: 'main', strategy: 'agent-branches' }, agents: [] }, agents)); bind(); };
    el.querySelector('[data-save]').onclick = async () => {
      try { await api('PUT', `/api/floors/${floorId}/repos`, { repos: rows().map(readRow) }); toast(t('Repositories saved; agents get them on their next start')); loadRepos(floorId, el, agents); }
      catch (e) { err.textContent = tx(e.message); }
    };
    const bind = () => rows().forEach((row) => {
      const id = row.dataset.repo;
      row.querySelector('[data-remove]').onclick = () => row.remove();
      row.querySelector('[data-clone]')?.addEventListener('click', async (e) => { e.target.disabled = true; try { await api('POST', `/api/floors/${floorId}/repos/${id}/clone`); toast(t('Cloned')); loadRepos(floorId, el, agents); } catch (x) { err.textContent = tx(x.message); e.target.disabled = false; } });
      row.querySelector('[data-relink]')?.addEventListener('click', async () => {
        const p = prompt(t('The folder of {id} on this machine (absolute path; empty: back to its relative path)', { id }), '');
        if (p === null) return;
        try { await api('PATCH', `/api/floors/${floorId}/repos/${id}`, { path: p.trim() }); loadRepos(floorId, el, agents); } catch (x) { err.textContent = tx(x.message); }
      });
      row.querySelector('[data-approve]')?.addEventListener('change', async (e) => {
        try { await api('PATCH', `/api/floors/${floorId}/repos/${id}`, { approved: e.target.checked }); toast(e.target.checked ? t('Automatic merges approved for {id}', { id }) : t('Automatic merges off for {id}', { id })); }
        catch (x) { e.target.checked = !e.target.checked; err.textContent = tx(x.message); }
      });
    });
    bind();
  };
  draw(data.repos);
}
