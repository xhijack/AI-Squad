// Floor 1 actions: rescan the machine for independent agents, adopt one into a squad's team.
import { esc, api, toast, openModal, closeModal } from './lib.js';
import { ctx } from './ctx.js';
import { t as tt } from './i18n.js';

ctx.actions.rescan = async () => {
  const r = await api('POST', '/api/independents/rescan', {});
  toast(r.found === 1 ? tt('Scan done: {n} independent agent found', { n: r.found }) : tt('Scan done: {n} independent agents found', { n: r.found }));
};

ctx.actions['adopt-agent'] = async (el) => {
  const b = ctx.state.building;
  const agent = b.floors.find((f) => f.independent)?.agents.find((a) => a.id === el.dataset.agent);
  if (!agent) return toast(tt('That agent is gone; rescan first'));
  const squads = b.floors.filter((f) => !f.independent && !f.missing).sort((x, y) => x.number - y.number);
  if (!squads.length) return toast(tt('Set up a squad first (Floor 2 and up), then adopt agents into it.'));
  const templates = (await api('GET', '/api/roles')).templates;
  const body = openModal(`<div class="mHead"><h3 class="grow">${tt('Adopt {name}', { name: esc(agent.displayName) })}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
    <form class="mBody" id="adoptForm">
      <p class="note">${tt("The agent joins the squad's team as a new member, created from a Role Template, and leaves Floor 1. Its running session is not touched; the squad starts its own session for it.")}</p>
      <label for="adFloor">${tt('Squad')}</label><select id="adFloor">${squads.map((f) => `<option value="${esc(f.id)}">${f.number} · ${esc(f.name)}</option>`).join('')}</select>
      <label for="adTpl">${tt('Role Template')}</label><select id="adTpl">${templates.map((t) => `<option value="${esc(t.role)}" ${t.role === 'fullstack-developer' ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select>
      <label for="adName">${tt('Display name')}</label><input id="adName" maxlength="60" required value="${esc(agent.displayName.replace(/[^\w\s-]+/g, ' ').replace(/\s+/g, ' ').trim())}">
    </form>
    <div class="mFoot"><div class="err grow" id="adErr"></div><button class="ghost" data-close>${tt('Cancel')}</button><button class="gold" id="adGo">${tt('Adopt')}</button></div>`);
  body.querySelectorAll('[data-close]').forEach((x) => { x.onclick = () => closeModal(); });
  body.querySelector('#adGo').onclick = async () => {
    try {
      const floorId = body.querySelector('#adFloor').value;
      const r = await api('POST', `/api/independents/${agent.id}/adopt`, { floorId, template: body.querySelector('#adTpl').value, displayName: body.querySelector('#adName').value });
      closeModal();
      toast(tt('{name} joined the squad', { name: r.agent.displayName }));
      location.hash = `#/floor/${floorId}/desk/${r.agent.id}`;
    } catch (e) { body.querySelector('#adErr').textContent = e.message; }
  };
};
