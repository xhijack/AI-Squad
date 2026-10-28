// SPDX-License-Identifier: Apache-2.0
// Source documents dialog: the Blueprint's source documents with their status; View, Approve and Request changes.
// Opened by the Floor pill ("Waiting for you: N source documents"), the Standard tab and the Floor menu.
import { esc, api, toast, openModal, closeModal, mdLite } from './lib.js';
import { ctx } from './ctx.js';
import { t as tt } from './i18n.js';

const STATE = { approved: ['ok', tt('approved')], draft: ['warn', tt('draft')], missing: ['bad', tt('missing')] };
const leadName = () => { const t = ctx.state.floor?.agents || []; const l = t.find((a) => a.lead) || t.find((a) => a.kindOf === 'lead'); return String(l?.displayName || tt('the lead')).split(' - ')[0]; };

function docHtml(d) {
  const pending = d.status !== 'approved', missing = d.status === 'missing';
  return `<details class="srcDoc ${d.status}" ${pending ? 'open' : ''} data-path="${esc(d.path)}">
    <summary><span class="grow"><b>${esc(d.title)}</b> <code>${esc(d.path)}</code></span><span class="chip ${STATE[d.status][0]}">${STATE[d.status][1]}</span></summary>
    <div class="note">${esc(d.purpose)}${d.owner ? ` · ${tt('written by <code>{owner}</code>', { owner: esc(d.owner) })}` : ''}</div>
    <div class="row wrap" style="margin-top:var(--sp-2)">
      <button type="button" class="small" data-doc="view" ${missing ? `disabled title="${tt('Not written yet')}"` : ''}>${tt('View')}</button>
      ${pending ? `<button type="button" class="small gold" data-doc="approve" ${missing ? `disabled title="${tt('Not written yet')}"` : ''}>${tt('Approve')}</button>` : ''}
      <button type="button" class="small ghost" data-doc="changes">${tt('Request changes')}</button></div>
    <div class="docText md" hidden tabindex="0" aria-label="${esc(d.title)}"></div>
    <form class="docChanges" hidden><textarea name="text" rows="3" required placeholder="${tt('What should change in {title}?', { title: esc(d.title) })}" aria-label="${tt('Changes for {title}', { title: esc(d.title) })}"></textarea>
      <div class="row"><span class="note grow">${tt('Sent to {name} as the next task.', { name: esc(leadName()) })}</span><button class="small gold">${tt('Send to {name}', { name: esc(leadName()) })}</button></div></form>
  </details>`;
}

function listHtml(docs, gate) {
  const pending = docs.filter((d) => d.status !== 'approved').length;
  const head = gate?.passed ? tt('A sprint has already started, so the squad is not held by the documents that are still drafts.')
    : pending ? (pending === 1 ? tt('The squad starts its sprints once this document is approved.') : tt('The squad starts its sprints once these {n} documents are approved.', { n: pending })) : tt('All source documents are approved.');
  return `<p class="note" style="margin-top:0">${head} ${tt('Approving sets <code>STATUS: APPROVED</code> and the approval date in the file; nothing else changes.')}</p>
    <div class="srcDocs">${docs.map(docHtml).join('')}</div>`;
}

export async function openSourceDocs(floorId = ctx.state.route.floorId) {
  const body = openModal(`<div class="mHead"><h3 class="grow">${tt('Source documents')}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
    <div class="mBody" id="sdBody"><div class="empty">${tt('Loading…')}</div></div><div class="mFoot"><div class="err grow" id="sdErr"></div><button class="ghost" data-close>${tt('Close')}</button></div>`);
  body.closest('dialog').classList.add('wide');
  body.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(); });
  const box = body.querySelector('#sdBody'), err = body.querySelector('#sdErr');
  const draw = (r) => { box.innerHTML = listHtml(r.docs, r.gate); };
  try { draw(await api('GET', `/api/floors/${floorId}/docs`)); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  box.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-doc]'); if (!b) return;
    const item = b.closest('.srcDoc'), p = item.dataset.path;
    err.textContent = '';
    try {
      if (b.dataset.doc === 'view') {
        const t = item.querySelector('.docText');
        if (!t.hidden) { t.hidden = true; b.textContent = tt('View'); return; }
        if (!t.dataset.loaded) { t.innerHTML = mdLite((await api('GET', `/api/floors/${floorId}/docs/text?path=${encodeURIComponent(p)}`)).text.replace(/<!--[\s\S]*?-->/g, '')); t.dataset.loaded = '1'; }   // template notes (comments) are not content
        t.hidden = false; b.textContent = tt('Hide');
      } else if (b.dataset.doc === 'approve') {
        if (!confirm(tt("Approve {path}? Its STATUS line becomes APPROVED with today's date.", { path: p }))) return;
        b.disabled = true;
        draw(await api('POST', `/api/floors/${floorId}/docs/approve`, { path: p }));
        toast(tt('{path} approved', { path: p })); ctx.refresh();
      } else if (b.dataset.doc === 'changes') {
        const f = item.querySelector('.docChanges'); f.hidden = !f.hidden;
        if (!f.hidden) f.querySelector('textarea').focus();
      }
    } catch (e) { err.textContent = e.message; b.disabled = false; }
  });
  box.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target, p = f.closest('.srcDoc').dataset.path, text = f.elements.text.value.trim();
    if (!text) return;
    try {
      const r = await api('POST', `/api/floors/${floorId}/docs/changes`, { path: p, text });
      f.hidden = true; f.reset(); toast(r.queued ? tt('Changes queued for the lead') : tt('Changes sent to the lead')); ctx.refresh();
    } catch (e) { err.textContent = e.message; }
  });
}

ctx.actions['source-docs'] = () => openSourceDocs();
