// Design variants dialog: the designer's 3-4 variants of a screen side by side (each a static HTML file, shown in a
// sandboxed frame without scripts), Pick with an optional note; the pick becomes a taste note in docs/DESIGN.md.
import { esc, api, openModal, closeModal, toast } from './lib.js';
import { ctx } from './ctx.js';

async function frameHtml(floorId, screen, file) {
  const r = await fetch(`/api/floors/${floorId}/designs/${screen}/${encodeURIComponent(file)}`, { headers: { 'x-aisquad-pin': (() => { try { return localStorage.getItem('aisquad.pin') || ''; } catch { return ''; } })() } });
  return r.ok ? r.text() : `<p style="font:14px sans-serif;color:#b91c1c">Could not load ${esc(file)} (${r.status})</p>`;
}

ctx.actions.designs = async (el) => {
  const floorId = ctx.state.route.floorId;
  const { groups } = await api('GET', `/api/floors/${floorId}/designs`);
  const want = el?.dataset?.screen;
  const list = want ? groups.filter((g) => g.screen === want) : groups;
  const body = openModal(`<div class="mHead"><h3 class="grow">Design variants</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <div class="mBody">${list.length ? list.map((g) => `<section class="dvGroup" data-screen="${esc(g.screen)}">
      <h4 class="perfH" style="margin-top:0">${esc(g.screen)}${g.chosen ? ` <span class="chip ok">picked: ${esc(g.variants.find((v) => v.file === g.chosen)?.title || g.chosen)}</span>` : ''}</h4>
      ${g.question ? `<p class="note" style="margin-top:0">${esc(g.question)}</p>` : ''}
      <div class="dvGrid">${g.variants.map((v) => `<figure class="dvItem${g.chosen === v.file ? ' chosen' : ''}"><iframe sandbox="" title="${esc(v.title)}" data-file="${esc(v.file)}" loading="lazy"></iframe>
        <figcaption><b>${esc(v.title)}</b><button class="small ${g.chosen === v.file ? '' : 'gold'}" data-pick="${esc(v.file)}">${g.chosen === v.file ? 'Picked' : 'Pick this'}</button></figcaption></figure>`).join('')}</div>
      <label class="note">Why (optional, goes into the taste note)<input class="dvNote" placeholder="e.g. guests scan names fast; keep the gold accent"></label></section>`).join('')
      : '<div class="empty">No design variants yet. The UI/UX designer writes them in <code>docs/design/variants/&lt;screen&gt;/</code> when you give only a mockup or a vague wish.</div>'}</div>`);
  body.closest('dialog').classList.add('xwide');
  body.parentElement.querySelector('[data-close]').onclick = () => closeModal();
  for (const sec of body.querySelectorAll('.dvGroup')) {
    const screen = sec.dataset.screen;
    for (const f of sec.querySelectorAll('iframe')) frameHtml(floorId, screen, f.dataset.file).then((html) => { f.srcdoc = html; });
    for (const b of sec.querySelectorAll('[data-pick]')) b.onclick = async () => {
      b.disabled = true;
      try { const r = await api('POST', `/api/floors/${floorId}/designs/${screen}/pick`, { file: b.dataset.pick, note: sec.querySelector('.dvNote').value }); toast(`Picked "${r.title}": noted in docs/DESIGN.md`); closeModal(); ctx.refresh(); }
      catch (e) { toast(e.message); b.disabled = false; }
    };
  }
};
