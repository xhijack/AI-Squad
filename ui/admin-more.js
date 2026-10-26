// SPDX-License-Identifier: Apache-2.0
// Admin → Notifications and Admin → Improvements (0.15): the Telegram bot (token write-only, pairing, chats,
// quiet hours, digest) and the Improvement Inbox of Daily Insight (accept or dismiss; nothing applies itself).
import { esc, api, toast, ago } from './lib.js';
import { t, tx } from './i18n.js';

const KINDS = ['question', 'permission', 'reply', 'crash', 'resource', 'scope', 'backup', 'finished', 'stall', 'merge', 'budget'];
const KIND_TEXT = { question: t('Questions'), permission: t('Permissions'), reply: t('Waiting for a reply'), crash: t('Crashes'), resource: t('Machine alerts'), scope: t('Scope changes'), backup: t('Backups'),
  finished: t('Finished work'), stall: t('Stalls'), merge: t('Merges'), budget: t('Budget') };

export function notifyHtml(x) {
  const s = x.settings, tk = x.token;
  return `<p class="note">${t('Questions, permissions and alerts reach you on Telegram with buttons, also when the screen is off. The bot only makes outgoing connections (no open port). Messages carry a short redacted summary; details stay here. Hard stops (money, legal, production, secrets) need a 4-digit code.')}</p>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Telegram bot')}</h3><span class="badge ${x.running ? 'live' : ''}">${x.running ? t('Connected') : t('Off')}</span></div>
      <p class="note">${tk.set ? t('Token set ····{last4}{bot}. Paste a new one to replace it.', { last4: esc(tk.last4), bot: tk.bot ? ` (@${esc(tk.bot)})` : '' }) : t('Create a bot with @BotFather in Telegram and paste its token here.')}</p>
      <div class="row"><input id="tgToken" type="password" autocomplete="off" placeholder="123456:ABC…" class="grow"><button class="small" data-tgtoken>${t('Save token')}</button>${tk.set ? `<button class="small ghost danger" data-tgclear>${t('Remove')}</button>` : ''}</div>
      ${x.lastError ? `<p class="note warnText">${esc(x.lastError)}</p>` : ''}
    </div>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Paired chats')}</h3><button class="small gold" data-pair ${tk.set ? '' : 'disabled'}>${t('Pair a chat')}</button></div>
      <div id="pairBox"></div>
      ${x.chats.length ? `<ul class="list">${x.chats.map((c) => `<li class="row"><b class="grow">${esc(c.name)}</b><span class="note">${esc(c.user)} · ${ago(c.pairedAt)}</span><button class="small ghost danger" data-unpair="${esc(c.chatId)}">${t('Remove')}</button></li>`).join('')}</ul>` : `<div class="empty">${t('No chat paired yet.')}</div>`}
      ${x.chats.length ? `<div class="row"><span class="spacer"></span><button class="small ghost" data-tgtest>${t('Send a test')}</button><button class="small ghost" data-tgdigest>${t('Send the digest now')}</button></div>` : ''}
    </div>
    <form class="section" data-notify><div class="sectionHead"><h3 class="grow">${t('Settings')}</h3></div>
      <label class="inline"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> ${t('Send notifications')}</label>
      <div class="grid4">
        <label>${t('Quiet from')}<input name="qFrom" type="time" value="${esc(s.quiet.from)}"></label>
        <label>${t('Quiet until')}<input name="qTo" type="time" value="${esc(s.quiet.to)}"></label>
        <label>${t('Morning digest at')}<input name="digestAt" type="time" value="${esc(s.digestAt)}"></label>
        <label>${t('At most per hour')}<input name="maxPerHour" type="number" min="1" max="200" value="${s.maxPerHour}"></label>
      </div>
      <label class="inline"><input type="checkbox" name="qOn" ${s.quiet.enabled ? 'checked' : ''}> ${t('Quiet hours (only machine alerts get through; the rest follows after)')}</label>
      <label>${t('Sent at once (the rest waits for the digest)')}</label>
      <div class="row wrap">${KINDS.map((k) => `<label class="inline day"><input type="checkbox" name="imm" value="${k}" ${s.immediate.includes(k) ? 'checked' : ''}>${esc(KIND_TEXT[k])}</label>`).join('')}</div>
      <div class="grid4">
        <label class="span2">${t('Address of this page for the Open button (optional)')}<input name="publicUrl" value="${esc(s.publicUrl)}" placeholder="https://squad.example.com"></label>
        <label>${t('Bot language')}<select name="lang"><option value="en" ${s.lang === 'en' ? 'selected' : ''}>English</option><option value="id" ${s.lang === 'id' ? 'selected' : ''}>Bahasa Indonesia</option></select></label>
      </div>
      <div class="row"><span class="spacer"></span><button class="gold" type="submit">${t('Save')}</button></div>
    </form>`;
}

const CAT = { 'agent-rule': t('Agent rule'), model: t('Model'), autopilot: t('Autopilot'), notifications: t('Notifications'), capacity: t('Capacity'), skill: t('Skill candidate') };
export function improvementsHtml(x) {
  const open = x.items.filter((i) => i.status === 'open'), done = x.items.filter((i) => i.status !== 'open').slice(0, 20);
  const card = (i) => `<div class="adminRow" data-sug="${esc(i.id)}"><div class="row"><span class="badge">${esc(CAT[i.category] || i.category)}</span><b class="grow">${esc(i.title)}</b><span class="note">${ago(i.createdAt)}</span></div>
    ${i.evidence?.length ? `<div class="note">${i.evidence.map((e) => `${esc(e.floorId || '')}${e.summary ? `: ${esc(e.summary)}` : ''}${e.ids?.length ? ` · ${t('{n} events', { n: e.ids.length })}` : ''}`).join('<br>')}</div>` : ''}
    <div class="note">${t('Impact')}: ${esc(i.impact || '')} · ${t('Risk')}: ${esc(i.risk || '')}</div>
    ${i.change ? `<div class="note mono">${esc(changeText(i.change))}</div>` : i.advice ? `<div class="note">${esc(i.advice)}</div>` : ''}
    <div class="note">${t('Check')}: ${esc(i.verify || '')}${i.metric ? ` (${t('now')}: ${esc(i.metric.before)} ${esc(i.metric.name)})` : ''}</div>
    ${i.status === 'open' ? `<div class="row"><span class="spacer"></span><button class="small ghost" data-sdismiss>${t('Dismiss')}</button><button class="small gold" data-saccept>${i.change ? t('Accept and apply') : t('Mark done')}</button></div>`
    : `<div class="note">${i.status === 'accepted' ? t('Accepted by {by}', { by: esc(i.by || '') }) : t('Dismissed by {by}', { by: esc(i.by || '') })} · ${ago(i.decidedAt)}</div>`}</div>`;
  return `<p class="note">${t('Every night The AI Squad reads its own week (the Squad Log, crashes, the queue) and suggests improvements here. Nothing changes until you accept; an accepted change is in Changes and can be rolled back. No model is called for this.')}</p>
    <div class="row"><span class="note grow">${x.lastRun ? t('Last run {ago}', { ago: ago(x.lastRun) }) : t('Not run yet')} · ${t('every night at {at}', { at: esc(x.settings.at) })}</span><button class="small" data-srun>${t('Run now')}</button></div>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Open ({n})', { n: open.length })}</h3></div>${open.length ? `<div class="adminList">${open.map(card).join('')}</div>` : `<div class="empty">${t('No open suggestions.')}</div>`}</div>
    ${done.length ? `<div class="section"><div class="sectionHead"><h3 class="grow">${t('Decided')}</h3></div><div class="adminList">${done.map(card).join('')}</div></div>` : ''}`;
}
function changeText(c) {
  if (c.kind === 'prefs') return Object.entries(c.patch).map(([k, v]) => `${k} → ${v}`).join(', ');
  if (c.kind === 'floor') return `${c.floorId}: ${Object.entries(c.patch).map(([k, v]) => `${k} → ${v}`).join(', ')}`;
  if (c.kind === 'agent-model') return `${c.floorId}/${c.agentId}: model → ${c.model}`;
  if (c.kind === 'agent-rule') return `${c.floorId}/${c.agentId}: + rule "${c.rule}"`;
  return JSON.stringify(c);
}

// the handlers of both tabs; again(msg) re-renders the tab
export function bindMore(body, again) {
  body.addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.dataset.notify === undefined) return;
    e.preventDefault();
    try {
      await api('PATCH', '/api/notify', { enabled: f.elements.enabled.checked, quiet: { enabled: f.elements.qOn.checked, from: f.elements.qFrom.value, to: f.elements.qTo.value }, digestAt: f.elements.digestAt.value,
        maxPerHour: +f.elements.maxPerHour.value, immediate: [...f.querySelectorAll('[name=imm]:checked')].map((x) => x.value), publicUrl: f.elements.publicUrl.value.trim(), lang: f.elements.lang.value });
      await again(t('Saved'));
    } catch (err) { toast(err.message, 5000); }
  });
  body.addEventListener('click', async (e) => {
    const el = e.target.closest('button'); if (!el) return;
    try {
      if (el.dataset.tgtoken !== undefined) { const v = body.querySelector('#tgToken').value.trim(); if (!v) return; await api('PUT', '/api/notify/telegram/token', { token: v }); return again(t('Token saved')); }
      if (el.dataset.tgclear !== undefined) { if (!confirm(t('Remove the bot token? Notifications stop.'))) return; await api('DELETE', '/api/notify/telegram/token'); return again(t('Token removed')); }
      if (el.dataset.pair !== undefined) {
        const p = await api('POST', '/api/notify/pair', {});
        body.querySelector('#pairBox').innerHTML = `<div class="pinShown"><b>${t('Send this to {bot} in Telegram within 10 minutes:', { bot: p.bot ? `@${esc(p.bot)}` : t('your bot') })}</b><div class="mono" style="font-size:16px;margin-top:6px">/start ${esc(p.code)}</div></div>`;
        return;
      }
      if (el.dataset.unpair) { await api('DELETE', `/api/notify/chats/${el.dataset.unpair}`); return again(t('Chat removed')); }
      if (el.dataset.tgtest !== undefined) { await api('POST', '/api/notify/test', {}); return toast(t('Test sent')); }
      if (el.dataset.tgdigest !== undefined) { await api('POST', '/api/notify/digest', {}); return toast(t('Digest sent')); }
      if (el.dataset.srun !== undefined) { const r = await api('POST', '/api/insights/run', {}); return again(t('{n} new suggestions', { n: r.added })); }
      const sug = el.closest('[data-sug]')?.dataset.sug;
      if (sug && el.dataset.saccept !== undefined) { await api('POST', `/api/insights/${sug}/accept`, {}); return again(t('Accepted')); }
      if (sug && el.dataset.sdismiss !== undefined) { const reason = prompt(t('Why not? (optional)')) ?? null; if (reason === null) return; await api('POST', `/api/insights/${sug}/dismiss`, { reason }); return again(t('Dismissed')); }
    } catch (err) { toast(tx(err.message), 5000); }
  });
}
