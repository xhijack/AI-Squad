// Ship readiness dialog (Floor menu): which gates and reviews ran for the sprint, and what is still missing before
// the merge (the server merges only when ready) or a deploy (DevOps checks the same list).
import { esc, api, openModal, closeModal } from './lib.js';
import { ctx } from './ctx.js';
import { t, tx } from './i18n.js';

const NEED = { merge: t('needed to merge'), deploy: t('needed to deploy'), info: t('for information') };

ctx.actions.ship = async () => {
  const floorId = ctx.state.route.floorId;
  const r = await api('GET', `/api/floors/${floorId}/ship`);
  const row = (i) => `<li class="shipItem ${i.ok ? 'ok' : i.for === 'info' ? 'info' : 'missing'}"><span class="mark" aria-hidden="true">${i.ok ? '✓' : i.for === 'info' ? '·' : '✗'}</span>
    <span class="grow"><b>${esc(tx(i.label))}</b><span class="note">${esc(tx(i.detail))}</span></span><span class="chip">${NEED[i.for]}</span></li>`;
  const verdict = (k, ready, missing) => (r[k].ready ? `<span class="chip ok">${ready}</span>` : `<span class="chip bad">${missing}</span>`);
  const body = openModal(`<div class="mHead"><h3 class="grow">${r.sprint ? t('Ship readiness · sprint {n}', { n: esc(r.sprint) }) : t('Ship readiness')}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="mBody"><div class="row wrap" style="margin-bottom:10px">${verdict('merge', t('Merge: ready'), t('Merge: {n} missing', { n: r.merge.missing?.length }))}${verdict('deploy', t('Deploy: ready'), t('Deploy: {n} missing', { n: r.deploy.missing?.length }))}</div>
      <ul class="shipList">${r.items.map(row).join('')}</ul>
      <p class="note">${r.mergePolicy === 'auto' && r.approved ? t('Automatic merges of a closed sprint wait until the merge list is complete.') : t('Merges are manual or not approved on this Floor; the list still shows what is missing.')} ${t('The DevOps agent checks the deploy list before every deploy (git-deploy skill).')}</p></div>
    <div class="mFoot"><span class="grow"></span><button class="ghost" data-close>${t('Close')}</button></div>`);
  body.parentElement.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(); });
};
