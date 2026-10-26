// SPDX-License-Identifier: Apache-2.0
// Menu → People (0.14): the Owner adds members (they work: agents, tasks, chat) and viewers (they read), each with
// an own PIN that is shown once. The page knows who is signed in (GET /api/me) and hides what only the Owner can do.
import { esc, api, toast, openModal, closeModal, hasPin } from './lib.js';
import { ctx } from './ctx.js';
import { t } from './i18n.js';

const ROLE = { owner: t('Owner'), member: t('Member'), viewer: t('Viewer') };
export async function loadMe() {
  if (!hasPin()) { document.body.dataset.role = ''; return null; }
  try { const { user } = await api('GET', '/api/me', undefined, { quiet401: true }); document.body.dataset.role = user.role; ctx.state.me = user; return user; }
  catch { document.body.dataset.role = ''; return null; }
}

async function peopleDialog(shown = null) {
  const { users } = await api('GET', '/api/users');
  const body = openModal(`<div class="peopleRoot"><div class="mHead"><h3 class="grow">${t('People')}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="mBody">
      <p class="note">${t('Members start and stop agents, send tasks, chat and answer questions. Viewers only read. Settings, money, secrets, people and Owner-only Spaces stay with the Owner. Everyone signs in with their own PIN.')}</p>
      ${shown ? `<div class="pinShown"><b>${t('PIN for {name}: {pin}', { name: esc(shown.user.name), pin: esc(shown.pin) })}</b><div class="note">${t('Give it to them now: it is shown only once.')}</div></div>` : ''}
      <ul class="list">${users.map((u) => `<li class="row" data-user="${esc(u.id)}"><b class="grow">${esc(u.name)}</b>
        ${u.role === 'owner' ? `<span class="badge">${ROLE.owner}</span>` : `<select data-role aria-label="${t('Role')}">${['member', 'viewer'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select>
        <button class="small ghost" data-pin>${t('New PIN')}</button><button class="small ghost danger" data-remove>${t('Remove')}</button>`}</li>`).join('')}</ul>
      <form class="row wrap" data-add><input name="name" placeholder="${esc(t('Name'))}" required class="grow"><select name="role"><option value="member">${ROLE.member}</option><option value="viewer">${ROLE.viewer}</option></select><button class="gold" type="submit">${t('Add person')}</button></form>
    </div></div>`).querySelector('.peopleRoot');
  body.querySelectorAll('[data-close]').forEach((x) => x.onclick = () => closeModal());
  const run = async (fn) => { try { await fn(); } catch (e) { toast(e.message, 5000); } };
  body.querySelector('[data-add]').onsubmit = (e) => { e.preventDefault(); run(async () => peopleDialog(await api('POST', '/api/users', { name: e.target.elements.name.value.trim(), role: e.target.elements.role.value }))); };
  body.addEventListener('change', (e) => { const li = e.target.closest('[data-user]'); if (e.target.dataset.role !== undefined && li) run(async () => { await api('PATCH', `/api/users/${li.dataset.user}`, { role: e.target.value }); toast(t('Saved')); }); });
  body.addEventListener('click', (e) => {
    const li = e.target.closest('[data-user]'); if (!li) return;
    if (e.target.closest('[data-pin]') && confirm(t('Make a new PIN? The old one stops working at once.'))) run(async () => peopleDialog(await api('POST', `/api/users/${li.dataset.user}/pin`, {})));
    if (e.target.closest('[data-remove]') && confirm(t('Remove this person? Their PIN stops working at once.'))) run(async () => { await api('DELETE', `/api/users/${li.dataset.user}`); peopleDialog(); });
  });
}
ctx.actions.people = () => peopleDialog();
loadMe();
document.getElementById('pinDlg')?.addEventListener('close', () => setTimeout(loadMe, 50));     // a new PIN: maybe another person
