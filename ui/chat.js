// SPDX-License-Identifier: Apache-2.0
// Desk → Chat (0.14): talk to one agent directly. "This Space": the agent in its project (a running Desk session
// gets the message typed in, else a background job answers). "General": the same agent with no project, only its
// role and the Company Brain. Messages from people go first in the dispatcher's queue.
import { esc, api, toast, openModal, mdLite, ago } from './lib.js';
import { ctx } from './ctx.js';
import { t, tx } from './i18n.js';

let timer = null;
const CTX = { space: t('This Space'), general: t('General') };
function messagesHtml(th) {
  if (!th.messages.length) return `<div class="empty">${t('No messages yet. Ask {name} anything, or give a direct instruction.', { name: esc(th.agent.displayName) })}</div>`;
  return th.messages.map((m) => `<div class="msg ${esc(m.from)}"><div class="note">${esc(m.from === 'system' ? t('The AI Squad') : m.name || '')} · ${ago(m.ts)}${m.cost ? ` · $${(+m.cost).toFixed(2)}` : ''}</div><div class="bubble">${m.from === 'agent' ? mdLite(m.text) : esc(m.from === 'system' ? tx(m.text) : m.text)}</div></div>`).join('')
    + (th.awaiting ? `<div class="msg agent"><div class="bubble note">${th.awaiting.mode === 'queued' ? t('Waiting in the queue…') : th.awaiting.mode === 'typed' ? t('Typed into the Desk session; waiting for the answer…') : t('Thinking…')}</div></div>` : '');
}
async function openChat(floorId, agentId, context = 'space') {
  clearInterval(timer);
  const th = await api('GET', `/api/floors/${floorId}/agents/${agentId}/chat?context=${context}`);
  const modal = openModal(`<div class="chatRoot"><div class="mHead"><h3 class="grow">${t('Chat with {name}', { name: esc(th.agent.displayName) })}</h3>
      <div class="seg" role="group">${th.contexts.map((c) => `<button type="button" data-ctx="${c}" aria-pressed="${c === context}">${esc(CTX[c])}</button>`).join('')}</div>
      <button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="mBody"><p class="note">${context === 'general' ? t('General: no project, only the agent\'s role and the Company Brain. Good for questions and drafts that belong to no client.') : th.running ? t('The Desk session runs: your message is typed into it and its answer comes back here. The lead sees a note of direct messages.') : t('The agent is stopped: a short background job answers (budget $1). The lead sees a note of direct messages.')}</p>
      <div class="chatLog" id="chatLog">${messagesHtml(th)}</div></div>
    <form class="mFoot chatForm"><textarea name="text" rows="2" placeholder="${esc(t('Message'))}" class="grow"></textarea><button class="gold" type="submit">${t('Send')}</button></form></div>`, { onClose: () => clearInterval(timer) });
  const body = modal.querySelector('.chatRoot');
  const log = body.querySelector('#chatLog');
  log.scrollTop = log.scrollHeight;
  body.querySelectorAll('[data-close]').forEach((x) => x.onclick = () => body.closest('dialog').close());
  body.querySelectorAll('[data-ctx]').forEach((b) => b.onclick = () => openChat(floorId, agentId, b.dataset.ctx));
  const form = body.querySelector('form'), ta = form.elements.text;
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  let last = JSON.stringify(th.messages.at(-1)?.id) + JSON.stringify(th.awaiting);
  const poll = async () => {
    try {
      const x = await api('GET', `/api/floors/${floorId}/agents/${agentId}/chat?context=${context}`, undefined, { quiet401: true });
      const key = JSON.stringify(x.messages.at(-1)?.id) + JSON.stringify(x.awaiting);
      if (key !== last) { last = key; log.innerHTML = messagesHtml(x); log.scrollTop = log.scrollHeight; }
    } catch { /* next time */ }
  };
  timer = setInterval(poll, 3000);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = ta.value.trim(); if (!text) return;
    form.querySelector('button').disabled = true;
    try {
      const r = await api('POST', `/api/floors/${floorId}/agents/${agentId}/chat`, { text, context });
      ta.value = '';
      if (r.delivery === 'queued') toast(t('Queued ({priority}, place {n}): {reason}. It starts by itself when there is room.', { priority: r.dispatch.priority, n: r.dispatch.position, reason: tx(r.dispatch.reason) }), 6000);
      await poll();
    } catch (err) { toast(err.message, 5000); }
    form.querySelector('button').disabled = false;
    ta.focus();
  };
  ta.focus();
}
ctx.actions.chat = (el) => openChat(el.dataset.floor || ctx.state.route.floorId, el.dataset.agent);
