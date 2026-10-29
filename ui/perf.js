// SPDX-License-Identifier: Apache-2.0
// Performance dialog (Squad Sprint Floors): per agent and per sprint from the docs/squad files, plus the
// cost projection for the remaining backlog. Opened from the dock.
import { esc, money, api, openModal } from './lib.js';
import { ctx } from './ctx.js';
import { t } from './i18n.js';

const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
const num = (v, d = 2) => (v == null ? '–' : (+v).toFixed(d).replace(/\.?0+$/, '') || '0');
const usd = (v) => (v == null ? '–' : money(v));
const KIND = { lead: t('Lead'), dev: t('Developer'), qa: t('QA'), other: t('Other') };

let data = null, pick = 'all';

function agentTable(rows, sprint) {
  const stat = (a) => (sprint === 'all' ? a.total : a.bySprint[sprint]);
  const list = rows.filter((a) => stat(a));
  if (!list.length) return `<div class="empty">${t('No work recorded for this sprint yet.')}</div>`;
  const devs = list.filter((a) => a.kind !== 'qa'), qa = list.filter((a) => a.kind === 'qa');
  return `<div class="tableWrap"><table class="perf"><thead><tr><th>${t('Agent')}</th><th title="${t('Modules owned')}">${t('Modules')}</th><th>SP</th><th title="${t('QA bugs weighted by severity, per story point')}">${t('Bugs / SP')}</th><th title="${t('Modules that passed QA in round 1 without Blocker or Major bugs')}">${t('First-round pass')}</th><th>${t('Cost')}</th><th>${t('Cost / SP')}</th></tr></thead>
    <tbody>${devs.map((a) => { const s = stat(a); return `<tr><td><b>${esc(a.displayName)}</b> <span class="note">${KIND[a.kind]}</span></td><td>${s.modules}</td><td>${num(s.sp, 1)}</td>
      <td class="${s.bugsPerSP > 1 ? 'warnText' : ''}">${num(s.bugsPerSP)}${s.bugs ? ` <span class="note">${s.bugs === 1 ? t('({n} bug, weight {w})', { n: s.bugs, w: num(s.bugWeight, 1) }) : t('({n} bugs, weight {w})', { n: s.bugs, w: num(s.bugWeight, 1) })}</span>` : ''}</td>
      <td>${pct(s.firstPassRate)}</td><td>${usd(s.cost)}</td><td>${usd(s.costPerSP)}</td></tr>`; }).join('')}</tbody></table></div>
    ${qa.length ? `<h4 class="perfH">${t('QA')}</h4><div class="tableWrap"><table class="perf"><thead><tr><th>${t('Agent')}</th><th>${t('Bugs found')}</th><th>${t('Weighted')}</th><th title="${t('Weighted bugs found per planned story point')}">${t('Found / SP')}</th><th>${t('Cost')}</th></tr></thead>
    <tbody>${qa.map((a) => { const s = stat(a); return `<tr><td><b>${esc(a.displayName)}</b></td><td>${num(s.found, 1)}</td><td>${num(s.foundWeight, 1)}</td><td>${num(s.foundPerSP)}</td><td>${usd(s.cost)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
}

function draw() {
  const d = data;
  const p = d.projection;
  const sprints = d.sprints.map((s) => `<tr><td><b>${t('Sprint {n}', { n: s.sprint })}</b>${s.closed ? '' : ` <span class="chip info">${t('running')}</span>`}</td><td>${num(s.doneSP, 1)} / ${num(s.plannedSP, 1)}</td><td>${s.modules}</td>
    <td>${s.bugs}${s.openBugs ? ` <span class="note">${t('({n} open)', { n: s.openBugs })}</span>` : ''}</td><td>${num(s.bugWeight, 1)}</td><td>${usd(s.cost)}</td><td>${usd(s.costPerSP)}</td></tr>`).join('');
  const body = openModal(`<div class="mHead"><h3 class="grow">${t('Performance · {name}', { name: esc(ctx.state.floor?.name || '') })}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="mBody">
      <div class="card"><div class="row"><b class="grow">${t('Cost projection')}</b><span class="note">${t('{n} SP done so far', { n: p.doneSP })}</span></div>
        ${p.costPerSP == null ? `<p class="note">${t('No story points are done yet, so there is no cost per story point to project with. Give modules an SP in <code>docs/squad/PLAN.md</code> and keep <code>docs/BACKLOG.md</code> as <code>| Story | SP | Status |</code>.')}</p>` : `
        <div class="kpis"><div><span>${t('Cost per SP')}</span><b>${usd(p.costPerSP)}</b></div><div><span>${t('Spent')}</span><b>${usd(p.spent)}</b></div><div><span>${t('Remaining')}</span><b>${t('{n} SP', { n: num(p.remainingSP, 1) })}</b></div><div><span>${t('Projected to finish')}</span><b>${usd(p.remainingCost)}</b></div><div><span>${t('Projected total')}</span><b>${usd(p.totalCost)}</b></div></div>
        <p class="note">${t('Remaining = open stories in <code>docs/BACKLOG.md</code> plus the unfinished part of the running sprint. Costs are estimates from transcript usage.')}</p>`}</div>
      <h4 class="perfH">${t('Sprints')}</h4>
      ${d.sprints.length ? `<div class="tableWrap"><table class="perf"><thead><tr><th>${t('Sprint')}</th><th>${t('SP done')}</th><th>${t('Modules')}</th><th>${t('Bugs')}</th><th>${t('Weighted')}</th><th>${t('Cost')}</th><th>${t('Cost / SP')}</th></tr></thead><tbody>${sprints}</tbody></table></div>` : `<div class="empty">${t('No sprint yet.')}</div>`}
      <div class="row wrap" style="margin-top:var(--sp-4)"><h4 class="perfH grow" style="margin:0">${t('Agents')}</h4>
        <select data-pick style="width:auto"><option value="all">${t('All sprints')}</option>${d.sprints.map((s) => `<option value="${s.sprint}" ${String(s.sprint) === pick ? 'selected' : ''}>${t('Sprint {n}', { n: s.sprint })}</option>`).join('')}</select></div>
      ${agentTable(d.agents, pick)}
      <p class="note">${t('Bug weights: Blocker 5, Major 3, Minor 1, Cosmetic 0.5. Read from <code>docs/squad</code> (PLAN, TASKS, qa/, bugs/ and the <code>sprint-&lt;N&gt;</code> archives).')}</p>
    </div>`);
  body.closest('dialog').classList.add('wide');
  body.querySelector('[data-close]').onclick = () => body.closest('dialog').close();
  body.querySelector('[data-pick]').onchange = (e) => { pick = e.target.value; draw(); };
}

ctx.actions.performance = async () => {
  data = await api('GET', `/api/floors/${ctx.state.route.floorId}/performance`);
  pick = 'all';
  draw();
};
