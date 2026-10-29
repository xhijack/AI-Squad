// SPDX-License-Identifier: Apache-2.0
// The Desk's actions (1.2.0): one primary action, the next useful one for the agent's state; the rest are
// secondary (outlined) or tertiary (ghost). Waiting → the answer, stopped → Start (Resume after a crash),
// running → Send task.
import { t as tt } from './i18n.js';

export function primaryAction(d, dialog = []) {
  if (!d) return null;
  if (dialog.length) return 'answer';
  if (!d.running) return d.crash && !d.crash.withLead && d.resume ? 'resume' : 'start';
  return 'send';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// the row under the Desk header: [primary] [secondary …] [tertiary …]
export function deskActionsHtml(d, primary, { floorId, screen = false, chat = true, follow = true } = {}) {
  const cls = (act) => (act === primary ? 'gold' : '');
  const out = [];
  if (d.running) out.push(`<button class="danger" data-act="stop" data-agent="${esc(d.id)}">${tt('Stop')}</button>`);
  else if (d.crash && !d.crash.withLead && d.resume) out.push(`<button class="${cls('resume')}" data-act="resume" data-agent="${esc(d.id)}" title="${tt('Continue the last session')}">${tt('Resume')}</button>`,
    `<button class="ghost" data-act="start" data-agent="${esc(d.id)}" title="${tt('A new session without the earlier context')}">${tt('Start fresh')}</button>`);
  else {
    out.push(`<button class="${cls('start')}" data-act="start" data-agent="${esc(d.id)}">${tt('Start')}</button>`);
    if (d.resume) out.push(`<button class="ghost" data-act="resume" data-agent="${esc(d.id)}" title="${tt('Continue the last session ({id})', { id: esc(d.resume.sessionId.slice(0, 8)) })}">${tt('Resume last session')}</button>`);
  }
  if (chat) out.push(`<button data-act="chat" data-agent="${esc(d.id)}" title="${tt('Talk to this agent directly')}">${tt('Chat')}</button>`);
  out.push(`<a class="btn ghost" href="#/floor/${esc(floorId)}/desk/${esc(d.id)}${screen ? '' : '/screen'}">${screen ? tt('Leave screen') : tt('Look at screen')}</a>`);
  if (follow) out.push(`<a class="btn ghost" href="#/floor/${esc(floorId)}/desk/${esc(d.id)}/follow" title="${tt('A camera that follows this agent around')}">${tt('Follow')}</a>`);
  return `<div class="deskActions">${out.join('')}</div>`;
}
