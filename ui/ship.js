// Ship readiness dialog (Floor menu): which gates and reviews ran for the sprint, and what is still missing before
// the merge (the server merges only when ready) or a deploy (DevOps checks the same list).
import { esc, api, openModal, closeModal } from './lib.js';
import { ctx } from './ctx.js';

const NEED = { merge: 'needed to merge', deploy: 'needed to deploy', info: 'for information' };

ctx.actions.ship = async () => {
  const floorId = ctx.state.route.floorId;
  const r = await api('GET', `/api/floors/${floorId}/ship`);
  const row = (i) => `<li class="shipItem ${i.ok ? 'ok' : i.for === 'info' ? 'info' : 'missing'}"><span class="mark" aria-hidden="true">${i.ok ? '✓' : i.for === 'info' ? '·' : '✗'}</span>
    <span class="grow"><b>${esc(i.label)}</b><span class="note">${esc(i.detail)}</span></span><span class="chip">${NEED[i.for]}</span></li>`;
  const verdict = (k, label) => (r[k].ready ? `<span class="chip ok">${label}: ready</span>` : `<span class="chip bad">${label}: ${r[k].missing.length} missing</span>`);
  const body = openModal(`<div class="mHead"><h3 class="grow">Ship readiness${r.sprint ? ` · sprint ${esc(r.sprint)}` : ''}</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <div class="mBody"><div class="row wrap" style="margin-bottom:10px">${verdict('merge', 'Merge')}${verdict('deploy', 'Deploy')}</div>
      <ul class="shipList">${r.items.map(row).join('')}</ul>
      <p class="note">${r.mergePolicy === 'auto' && r.approved ? 'Automatic merges of a closed sprint wait until the merge list is complete.' : 'Merges are manual or not approved on this Floor; the list still shows what is missing.'} The DevOps agent checks the deploy list before every deploy (git-deploy skill).</p></div>
    <div class="mFoot"><span class="grow"></span><button class="ghost" data-close>Close</button></div>`);
  body.parentElement.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(); });
};
