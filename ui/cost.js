// Cost dialog from the dock: today and this month per Floor (Lobby) or per agent (Floor), with the budget.
// Estimates from transcript usage, like everywhere else.
import { esc, money, openModal } from './lib.js';
import { ctx } from './ctx.js';

const bar = (used, cap) => (cap > 0 ? `<div class="meterBar ${used >= cap ? 'bad' : used >= cap * .8 ? 'warn' : ''}"><div class="track"><i style="width:${Math.min(100, Math.round(used / cap * 100))}%"></i></div></div>` : '');

ctx.actions.cost = () => {
  const b = ctx.state.building, f = ctx.state.floor;
  const onFloor = ctx.state.route.mode !== 'lobby' && f && !f.missing;
  let html;
  if (onFloor) {
    const bud = f.budget || {};
    const rows = [...f.agents].sort((x, y) => (y.costToday || 0) - (x.costToday || 0));
    html = `<div class="kpis"><div><span>Today</span><b>${money(f.cost.today)}</b></div><div><span>This month</span><b>${money(f.cost.month)}</b></div>
        ${bud.usd > 0 ? `<div><span>Budget per ${esc(bud.period)}</span><b>${money(bud.used)} / ${money(bud.usd)}</b>${bar(bud.used, bud.usd)}</div>` : '<div><span>Budget</span><b>none</b></div>'}</div>
      <h4 class="perfH">Agents today</h4>
      <div class="tableWrap"><table class="perf"><thead><tr><th>Agent</th><th>Role</th><th>Model</th><th>Today</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td><b>${esc(a.displayName)}</b></td><td>${esc(a.title || '')}</td><td>${esc(a.model || '')}</td><td>${money(a.costToday)}</td></tr>`).join('')}</tbody></table></div>
      ${f.workflow === 'squad-sprint' ? '<p class="note">Cost per story point and the projection for the backlog are in <a href="#" data-act="performance">Performance</a>.</p>' : ''}`;
  } else {
    const floors = [...b.floors].sort((x, y) => x.number - y.number);
    html = `<div class="kpis"><div><span>Today, all Floors</span><b>${money(b.costToday)}</b></div><div><span>This month</span><b>${money(floors.reduce((n, x) => n + (x.cost?.month || 0), 0))}</b></div></div>
      <h4 class="perfH">Floors</h4>
      <div class="tableWrap"><table class="perf"><thead><tr><th>Floor</th><th>Today</th><th>Month</th><th>Budget</th></tr></thead><tbody>
      ${floors.map((x) => `<tr><td><b>${x.number} · ${esc(x.name)}</b></td><td>${money(x.cost?.today)}</td><td>${money(x.cost?.month)}</td><td>${x.budget?.usd > 0 ? `${Math.round(x.budget.pct)} % of ${money(x.budget.usd)}/${esc(x.budget.period)}` : '–'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const body = openModal(`<div class="mHead"><h3 class="grow">Cost${onFloor ? ` · ${esc(f.name)}` : ''}</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <div class="mBody">${html}<p class="note">Estimated from Claude Code transcript usage at list prices.</p></div>`);
  body.querySelector('[data-close]').onclick = () => body.closest('dialog').close();
};
