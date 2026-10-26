// Retro dialog: the ritual after a sprint closes (made from that sprint's audit). What went well, what did not, three
// changes, per agent, cost per story point; "Send to lead" asks the lead to turn it into LEARNINGS.md entries.
import { esc, api, openModal, closeModal, toast } from './lib.js';
import { ctx } from './ctx.js';
import { t as tt } from './i18n.js';

const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
const usd = (v) => (v == null ? '–' : `$${(+v).toFixed(2)}`);
const list = (xs, empty) => (xs.length ? `<ul class="retroList">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<div class="note">${empty}</div>`);

function trendHtml(t) {
  if (!t.length) return `<div class="note">${tt('No sprint with done story points yet.')}</div>`;
  const max = Math.max(...t.map((x) => x.costPerSP)) || 1;
  return `<div class="retroTrend">${t.map((x) => `<div><span>${tt('Sprint {n}', { n: esc(x.sprint) })}</span><i class="sbar" role="img" aria-label="${tt('${cost} per story point', { cost: x.costPerSP })}"><i style="width:${Math.round(x.costPerSP / max * 100)}%"></i></i><b>${usd(x.costPerSP)}</b></div>`).join('')}</div>`;
}

export function retroHtml(r) {
  return `<div class="grid2 retroCols"><div class="card"><h4 class="perfH" style="margin-top:0">${tt('What went well')}</h4>${list(r.wentWell, tt('Nothing stood out.'))}</div>
      <div class="card"><h4 class="perfH" style="margin-top:0">${tt('What did not')}</h4>${list(r.wentBadly, tt('Nothing went wrong that the numbers show.'))}</div></div>
    <h4 class="perfH">${tt('Three changes')}</h4>${r.changes.length ? `<ol class="retroList">${r.changes.map((c) => `<li>${esc(c.text)}${c.target ? ` <span class="chip">${esc(c.target)}</span>` : ''}</li>`).join('')}</ol>` : `<div class="note">${tt('No changes proposed.')}</div>`}
    <h4 class="perfH">${tt('Per agent')}</h4><div class="tableWrap"><table class="perf"><thead><tr><th>${tt('Agent')}</th><th>${tt('Cost')}</th><th>${tt('Turns')}</th><th>${tt('Failed tools')}</th><th>${tt('Idle with open work')}</th><th>SP</th><th>${tt('QA first pass')}</th><th>${tt('Bugs / SP')}</th></tr></thead><tbody>
      ${r.perAgent.map((a) => `<tr><td>${esc(a.agent)}</td><td>${usd(a.cost)}</td><td>${a.turns}</td><td>${a.failedTools}</td><td>${tt('{n} min', { n: a.idleWithOpenWorkMin })}</td><td>${a.sp ?? '–'}</td><td>${pct(a.firstPassRate)}</td><td>${a.bugsPerSP ?? '–'}</td></tr>`).join('') || `<tr><td colspan="8" class="note">${tt('No agent activity in this sprint.')}</td></tr>`}</tbody></table></div>
    <h4 class="perfH">${tt('Cost per story point')}</h4>${trendHtml(r.costPerSPTrend)}`;
}

ctx.actions.retro = async () => {
  const floorId = ctx.state.route.floorId;
  const { retro } = await api('GET', `/api/floors/${floorId}/retro`);
  const body = openModal(`<div class="mHead"><h3 class="grow">${retro ? tt('Retro · sprint {n}', { n: esc(retro.sprint) }) : tt('Retro')}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
    <div class="mBody">${retro ? retroHtml(retro) : `<div class="empty">${tt("No Retro yet. It is made when a sprint closes (the sprint's audit), or when you audit one sprint.")}</div>`}</div>
    <div class="mFoot"><div class="err grow" id="rtErr"></div>${retro ? `<button class="ghost" data-audit>${tt('Open the audit')}</button><button class="gold" data-send title="${tt('Writes docs/squad/retro/sprint-N.md and asks the lead to add LEARNINGS.md entries')}">${tt('Send to lead')}</button>` : ''}<button class="ghost" data-close>${tt('Close')}</button></div>`);
  body.closest('dialog').classList.add('wide');
  body.parentElement.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(); });
  body.parentElement.querySelector('[data-audit]')?.addEventListener('click', () => ctx.actions.audit());
  body.parentElement.querySelector('[data-send]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api('POST', `/api/floors/${floorId}/retro/send`, {}); toast(tt('Retro sent to the lead ({file})', { file: r.file })); closeModal(); }
    catch (err) { document.getElementById('rtErr').textContent = err.message; e.target.disabled = false; }
  });
};
