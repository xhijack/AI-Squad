// Performance dialog (Squad Sprint Floors): per agent and per sprint from the docs/squad files, plus the
// cost projection for the remaining backlog. Opened from the dock.
import { esc, money, api, openModal } from './lib.js';
import { ctx } from './ctx.js';

const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
const num = (v, d = 2) => (v == null ? '–' : (+v).toFixed(d).replace(/\.?0+$/, '') || '0');
const usd = (v) => (v == null ? '–' : money(v));
const KIND = { lead: 'Lead', dev: 'Developer', qa: 'QA', other: 'Other' };

let data = null, pick = 'all';

function agentTable(rows, sprint) {
  const stat = (a) => (sprint === 'all' ? a.total : a.bySprint[sprint]);
  const list = rows.filter((a) => stat(a));
  if (!list.length) return '<div class="empty">No work recorded for this sprint yet.</div>';
  const devs = list.filter((a) => a.kind !== 'qa'), qa = list.filter((a) => a.kind === 'qa');
  return `<div class="tableWrap"><table class="perf"><thead><tr><th>Agent</th><th title="Modules owned">Modules</th><th>SP</th><th title="QA bugs weighted by severity, per story point">Bugs / SP</th><th title="Modules that passed QA in round 1 without Blocker or Major bugs">First-round pass</th><th>Cost</th><th>Cost / SP</th></tr></thead>
    <tbody>${devs.map((a) => { const s = stat(a); return `<tr><td><b>${esc(a.displayName)}</b> <span class="note">${KIND[a.kind]}</span></td><td>${s.modules}</td><td>${num(s.sp, 1)}</td>
      <td class="${s.bugsPerSP > 1 ? 'warnText' : ''}">${num(s.bugsPerSP)}${s.bugs ? ` <span class="note">(${s.bugs} bug${s.bugs === 1 ? '' : 's'}, weight ${num(s.bugWeight, 1)})</span>` : ''}</td>
      <td>${pct(s.firstPassRate)}</td><td>${usd(s.cost)}</td><td>${usd(s.costPerSP)}</td></tr>`; }).join('')}</tbody></table></div>
    ${qa.length ? `<h4 class="perfH">QA</h4><div class="tableWrap"><table class="perf"><thead><tr><th>Agent</th><th>Bugs found</th><th>Weighted</th><th title="Weighted bugs found per planned story point">Found / SP</th><th>Cost</th></tr></thead>
    <tbody>${qa.map((a) => { const s = stat(a); return `<tr><td><b>${esc(a.displayName)}</b></td><td>${num(s.found, 1)}</td><td>${num(s.foundWeight, 1)}</td><td>${num(s.foundPerSP)}</td><td>${usd(s.cost)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
}

function draw() {
  const d = data;
  const p = d.projection;
  const sprints = d.sprints.map((s) => `<tr><td><b>Sprint ${s.sprint}</b>${s.closed ? '' : ' <span class="chip info">running</span>'}</td><td>${num(s.doneSP, 1)} / ${num(s.plannedSP, 1)}</td><td>${s.modules}</td>
    <td>${s.bugs}${s.openBugs ? ` <span class="note">(${s.openBugs} open)</span>` : ''}</td><td>${num(s.bugWeight, 1)}</td><td>${usd(s.cost)}</td><td>${usd(s.costPerSP)}</td></tr>`).join('');
  const body = openModal(`<div class="mHead"><h3 class="grow">Performance · ${esc(ctx.state.floor?.name || '')}</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <div class="mBody">
      <div class="card"><div class="row"><b class="grow">Cost projection</b><span class="note">${p.doneSP} SP done so far</span></div>
        ${p.costPerSP == null ? '<p class="note">No story points are done yet, so there is no cost per story point to project with. Give modules an SP in <code>docs/squad/PLAN.md</code> and keep <code>docs/BACKLOG.md</code> as <code>| Story | SP | Status |</code>.</p>' : `
        <div class="kpis"><div><span>Cost per SP</span><b>${usd(p.costPerSP)}</b></div><div><span>Spent</span><b>${usd(p.spent)}</b></div><div><span>Remaining</span><b>${num(p.remainingSP, 1)} SP</b></div><div><span>Projected to finish</span><b>${usd(p.remainingCost)}</b></div><div><span>Projected total</span><b>${usd(p.totalCost)}</b></div></div>
        <p class="note">Remaining = open stories in <code>docs/BACKLOG.md</code> plus the unfinished part of the running sprint. Costs are estimates from transcript usage.</p>`}</div>
      <h4 class="perfH">Sprints</h4>
      ${d.sprints.length ? `<div class="tableWrap"><table class="perf"><thead><tr><th>Sprint</th><th>SP done</th><th>Modules</th><th>Bugs</th><th>Weighted</th><th>Cost</th><th>Cost / SP</th></tr></thead><tbody>${sprints}</tbody></table></div>` : '<div class="empty">No sprint yet.</div>'}
      <div class="row wrap" style="margin-top:14px"><h4 class="perfH grow" style="margin:0">Agents</h4>
        <select data-pick style="width:auto"><option value="all">All sprints</option>${d.sprints.map((s) => `<option value="${s.sprint}" ${String(s.sprint) === pick ? 'selected' : ''}>Sprint ${s.sprint}</option>`).join('')}</select></div>
      ${agentTable(d.agents, pick)}
      <p class="note">Bug weights: Blocker 5, Major 3, Minor 1, Cosmetic 0.5. Read from <code>docs/squad</code> (PLAN, TASKS, qa/, bugs/ and the <code>sprint-&lt;N&gt;</code> archives).</p>
    </div>`);
  body.querySelector('[data-close]').onclick = () => body.closest('dialog').close();
  body.querySelector('[data-pick]').onchange = (e) => { pick = e.target.value; draw(); };
}

ctx.actions.performance = async () => {
  data = await api('GET', `/api/floors/${ctx.state.route.floorId}/performance`);
  pick = 'all';
  draw();
};
