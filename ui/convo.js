// SPDX-License-Identifier: Apache-2.0
// The conversation view: an Attention item as a large dialog. The agent's own chibi as a live portrait, its message
// as a speech bubble (readable markdown that scrolls between a fixed header and action bar), the actions for the
// item (options, Reply, OK / Dismiss, Open desk), and "n of m" with previous / next. While it is open the office
// camera eases to the agent and a short bubble appears over its head. Esc closes.
import { esc, api, toast, ago, mdLite, drafts, answerItem } from './lib.js';
import { ctx } from './ctx.js';
import { preview, bubbleText, actionsFor, step, ofText } from './convo-model.js';
import { playLine, stopVoice } from './voice.js';
import { t } from './i18n.js';

let C = null;            // { list, i, portrait, dlg }
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const KIND = { finished: t('Finished'), reply: t('Waiting for your reply'), question: t('Question'), permission: t('Permission'), crash: t('Stopped unexpectedly'), decided: t('Decided by autopilot'), scope: t('Scope change'), stall: t('Stalled'), merge: t('Merge'), budget: t('Budget'), resource: t('Resources'), price: t('Price approval'), handoff: t('Handoff'), erpnext: 'ERPNext', contract: t('Contract'), legal: t('Legal') };

function agentOf(item) {
  const f = ctx.state.building?.floors.find((x) => x.id === item.floorId);
  return f?.agents?.find((a) => a.id === item.agentId) || { id: item.agentId || 'squad', displayName: item.agentName || item.floorName || 'The AI Squad', appearance: {} };
}

function dialogEl() {
  let d = document.getElementById('convo');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'convo'; d.setAttribute('aria-labelledby', 'convoName');
  document.body.appendChild(d);
  d.addEventListener('close', cleanup);
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });          // a click on the backdrop
  d.addEventListener('keydown', (e) => {
    if (/^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });
  return d;
}

function actionsHtml(item, a) {
  const desk = item.floorId && item.agentId ? `<a class="btn ghost" href="#/floor/${esc(item.floorId)}/desk/${esc(item.agentId)}" data-desk>${t('Open desk')}</a>` : '';
  const dismiss = a.dismiss ? `<button type="button" class="ghost" data-dismiss>${esc(a.dismiss === 'OK' ? t('OK') : t('Dismiss'))}</button>` : '';
  if (a.mode === 'options') {
    const free = a.options.find((o) => o.free);
    return `<div class="convoOpts">${a.options.filter((o) => !o.free).map((o) => `<button type="button" class="big ${o.recommended ? 'gold' : ''}" data-n="${o.n}">${o.recommended ? `<small>${t('Recommended')}</small>` : ''}${esc(o.label)}</button>`).join('')}</div>
      ${free ? `<form class="convoForm" data-free="${free.n}"><textarea name="text" rows="2" placeholder="${esc(free.label)}" aria-label="${t('Your own answer')}" required></textarea><button class="gold">${t('Send')}</button></form>` : ''}
      <div class="convoBar">${desk}<span class="spacer"></span>${dismiss}</div>`;
  }
  if (a.mode === 'reply') {
    const who = esc(String(item.agentName || t('the agent')).split(' - ')[0]);
    return `${a.canReply ? `<form class="convoForm" data-reply><textarea name="text" rows="3" placeholder="${t('Reply to {name}…', { name: who })}" aria-label="${t('Your reply to {name}', { name: who })}" required>${esc(drafts.get(item.id) || '')}</textarea></form>` : `<p class="note">${t('This agent runs on its own: reply in its own terminal.')}</p>`}
      <div class="convoBar">${desk}<span class="spacer"></span>${dismiss}${a.canReply ? `<button type="button" class="gold" data-send>${t('Reply')}</button>` : ''}</div>`;
  }
  return `<div class="convoBar">${desk}<span class="spacer"></span>${dismiss}<button type="button" class="ghost" data-close>${t('Close')}</button></div>`;
}

function render() {
  const d = dialogEl(), item = C.list[C.i], ag = agentOf(item), a = actionsFor(item);
  C.portrait?.dispose(); C.portrait = null;
  const markdown = item.kind === 'finished' || item.kind === 'reply';
  d.className = `convo ${esc(item.kind)}`;
  d.innerHTML = `<div class="convoHead">
      <canvas class="convoPortrait" width="200" height="240" role="img" aria-label="${esc(ag.displayName)}"></canvas>
      <div class="convoWho"><div class="where">${esc(KIND[item.kind] || item.kind)}</div><h3 id="convoName">${esc(ag.displayName)}</h3>
        <div class="note">${esc([ag.title, item.floorNumber ? t('Floor {n} · {name}', { n: item.floorNumber, name: item.floorName }) : item.floorName].filter(Boolean).join(' · '))}</div><div class="note">${ago(item.ts)}</div></div>
      <div class="convoNav">${C.list.length > 1 ? `<button type="button" class="iconBtn ghost" data-prev aria-label="${t('Previous item')}">‹</button><span class="note">${ofText(C.i, C.list.length)}</span><button type="button" class="iconBtn ghost" data-next aria-label="${t('Next item')}">›</button>` : ''}
        ${item.agentId && item.text ? `<button type="button" class="small ghost" data-listen title="${t('Read the whole message aloud')}">▶ ${t('Listen')}</button>` : ''}<button type="button" class="iconBtn ghost" data-close aria-label="${t('Close')}">×</button></div></div>
    <div class="convoBody" tabindex="0"><div class="convoMsg ${markdown ? 'md' : ''}">${markdown ? mdLite(item.text) : `<p>${esc(item.text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`}${item.kind === 'decided' ? `<p class="note">${t('Decided automatically: <b>{choice}</b>. Pick another option to change it.', { choice: esc(item.chosen) })}</p>` : ''}${item.hardStop?.length ? `<p class="note warnText">${t('Hard stop ({reasons}): only you decide this.', { reasons: esc(item.hardStop.join(', ')) })}</p>` : ''}</div></div>
    <div class="convoActions">${actionsHtml(item, a)}</div>`;
  if (!d.open) d.showModal();
  wire(d, item, a);
  // the portrait (one small WebGL canvas) and the office: camera to the agent, a short bubble over its head
  import('./portrait.js').then(({ createPortrait }) => {
    if (!C || C.list[C.i] !== item) return;
    try { C.portrait = createPortrait(d.querySelector('.convoPortrait'), ag, { reducedMotion: reduced() }); C.portrait.talk(Math.min(4000, 800 + item.text.length * 6)); } catch { /* no WebGL: the text is what matters */ }
  });
  if (item.agentId) { ctx.scene?.focusAgent(item.floorId, item.agentId); ctx.scene?.say(item.floorId, item.agentId, bubbleText(item), 8000); }
  (d.querySelector('.convoActions textarea') || d.querySelector('.convoActions button.gold') || d.querySelector('.convoBody')).focus({ preventScroll: true });
}

async function act(fn, done = t('Sent')) {
  try { const r = await fn(); if (!r?.gone) toast(done); } catch (e) { toast(e.message); return; }   // gone: the helper already said "Already answered"
  C.list.splice(C.i, 1);
  await ctx.refresh();
  if (!C.list.length) return dialogEl().close();
  C.i = Math.min(C.i, C.list.length - 1);
  render();
}
const answer = (item, body) => answerItem(item.id, body, item);

function wire(d, item, a) {
  d.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => d.close(); });
  d.querySelector('[data-listen]')?.addEventListener('click', () => playLine({ floorId: item.floorId, agentId: item.agentId, kind: item.kind, text: item.text, full: true }, { force: true, onLevel: (v) => C?.portrait?.setLevel(v) }));
  d.querySelector('[data-prev]')?.addEventListener('click', () => go(-1));
  d.querySelector('[data-next]')?.addEventListener('click', () => go(1));
  d.querySelector('[data-desk]')?.addEventListener('click', () => d.close());
  d.querySelector('[data-dismiss]')?.addEventListener('click', () => act(() => answer(item, { option: 0 }), a.dismiss === 'OK' ? t('OK') : t('Dismissed')));
  d.querySelectorAll('[data-n]').forEach((b) => { b.onclick = () => act(async () => {
    if (a.act === 'crash-answer') return ctx.actions['crash-answer']({ dataset: { id: item.id, n: b.dataset.n }, closest: () => null });
    return answer(item, { option: +b.dataset.n });
  }, t('Answer sent')); });
  const free = d.querySelector('[data-free]');
  if (free) free.onsubmit = (e) => { e.preventDefault(); act(() => answer(item, { option: +free.dataset.free, text: free.elements.text.value }), t('Answer sent')); };
  const reply = d.querySelector('[data-reply]');
  if (reply) {
    const ta = reply.elements.text;
    ta.oninput = () => drafts.set(item.id, ta.value);
    const send = () => { if (!ta.value.trim()) { ta.focus(); return; } drafts.set(item.id, ta.value); act(async () => { const r = await answer(item, { option: 1, text: ta.value }); drafts.delete(item.id); if (r.delivered === 'as-message') toast(t('Sent to the agent as a message')); }, t('Reply sent')); };
    reply.onsubmit = (e) => { e.preventDefault(); send(); };
    d.querySelector('[data-send]').onclick = send;
    ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); };
  }
}

function go(dir) { if (!C || C.list.length < 2) return; C.i = step(C.i, C.list.length, dir); render(); }

function cleanup() {
  stopVoice();
  C?.portrait?.dispose();
  ctx.scene?.unfocus();
  C = null;
}

// list: the open items to step through (the order shown); id: the one to open
export function openConversation(list, id) {
  const items = (list || []).filter((x) => x && x.id);
  const i = Math.max(0, items.findIndex((x) => x.id === id));
  if (!items.length) return;
  C = { list: items, i, portrait: null };
  render();
}

// the compact index (Needs you popover): one row per item, a one-line preview; a click opens the conversation
export function attentionIndexHtml(items) {
  if (!items.length) return `<div class="empty">${t('All clear. Nothing is waiting for you.')}</div>`;
  return `<ul class="attIndex">${items.map((a) => `<li><button type="button" class="attRow ${esc(a.kind)}${a.muted ? ' muted' : ''}" data-act="convo" data-id="${esc(a.id)}">
    <span class="grow"><b>${esc(String(a.agentName || a.floorName || 'The AI Squad').split(' - ')[0])}</b>${a.floorNumber ? ` <span class="note">${t('Floor {n}', { n: a.floorNumber })}</span>` : ''}<span class="pv">${esc(preview(a))}</span></span>
    <span class="note">${ago(a.ts)}</span></button></li>`).join('')}</ul>`;
}

ctx.actions.convo = (el) => {
  const all = ctx.state.building?.attention || [];
  const list = [...all.filter((a) => !a.muted), ...all.filter((a) => a.muted)];
  openConversation(list, el.dataset.id);
};
