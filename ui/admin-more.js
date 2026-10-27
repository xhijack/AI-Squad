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
    : `<div class="note">${decidedText(i)}${i.decidedAt ? ` · ${ago(i.decidedAt)}` : ''}${i.followUp ? ` · ${t('a week later: {after} ({how})', { after: esc(i.followUp.after), how: i.followUp.improved ? t('better') : t('not better') })}` : ''}</div>`}</div>`;
  return `<p class="note">${t('Every night The AI Squad reads its own week (the Squad Log, crashes, the queue) and suggests improvements here. Nothing changes until you accept; an accepted change is in Changes and can be rolled back. No model is called for this.')}</p>
    <div class="row"><span class="note grow">${x.lastRun ? t('Last run {ago}', { ago: ago(x.lastRun) }) : t('Not run yet')} · ${t('every night at {at}', { at: esc(x.settings.at) })}</span><button class="small" data-srun>${t('Run now')}</button></div>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Open ({n})', { n: open.length })}</h3></div>${open.length ? `<div class="adminList">${open.map(card).join('')}</div>` : `<div class="empty">${t('No open suggestions.')}</div>`}</div>
    ${done.length ? `<div class="section"><div class="sectionHead"><h3 class="grow">${t('Decided')}</h3></div><div class="adminList">${done.map(card).join('')}</div></div>` : ''}`;
}
function decidedText(i) {
  const by = esc(i.by || '');
  return { accepted: t('Accepted by {by}', { by }), dismissed: t('Dismissed by {by}', { by }), canary: t('Running as a canary until {when}', { when: new Date(i.canaryUntil || 0).toLocaleDateString() }),
    'canary-done': t('Canary finished: waits for you'), kept: t('Kept after its canary by {by}', { by }), 'rolled-back': t('Rolled back after its canary by {by}', { by }) }[i.status] || esc(i.status);
}
function changeText(c) {
  if (c.kind === 'prefs') return Object.entries(c.patch).map(([k, v]) => `${k} → ${v}`).join(', ');
  if (c.kind === 'floor') return `${c.floorId}: ${Object.entries(c.patch).map(([k, v]) => `${k} → ${v}`).join(', ')}`;
  if (c.kind === 'agent-model') return `${c.floorId}/${c.agentId}: model → ${c.model}`;
  if (c.kind === 'agent-rule') return `${c.floorId}/${c.agentId}: + rule "${c.rule}"`;
  return JSON.stringify(c);
}

// Admin → Machines (0.18): the Head and its workers, adding one (its token shown once), draining, removing,
// and moving the whole Building to another machine
const gbOf = (b) => (b ? `${(b / 2 ** 30).toFixed(1)} GB` : '–');
export function machinesHtml(x) {
  const h = x.head || {};
  const row = (n) => `<div class="adminRow" data-node="${esc(n.name)}"><div class="row"><span class="badge ${n.online ? 'live' : ''}">${n.online ? t('Online') : t('Offline')}</span><b class="grow">${esc(n.name)}</b>
      <span class="note">${n.lastSeen ? t('seen {ago}', { ago: ago(n.lastSeen) }) : t('never connected')}</span></div>
    <div class="note">${[n.lastSeen && [n.host, n.version].filter(Boolean).map(esc).join(' · '), n.lastSeen && t('{n} of {max} jobs', { n: n.running?.length || 0, max: n.maxAgents || 6 }), n.resources?.mem?.available && t('{gb} free', { gb: gbOf(n.resources.mem.available) }), n.drain && `<b>${t('draining: no new jobs')}</b>`].filter(Boolean).join(' · ')}</div>
    <div class="row"><span class="spacer"></span><button class="small ghost" data-ndrain="${n.drain ? '0' : '1'}">${n.drain ? t('Take jobs again') : t('Drain')}</button><button class="small ghost danger" data-nremove>${t('Remove')}</button></div></div>`;
  return `<p class="note">${t('More machines run more background jobs without upgrading this one. A worker only connects out to this machine (over Tailscale or WireGuard), signs in to Claude itself and works in its own clones of the repositories; this machine keeps every Space, the queue, the log and the chats. Desk sessions stay here. A worker that goes silent for 45 seconds loses its jobs, and they are queued again.')}</p>
    <div class="adminList"><div class="adminRow"><div class="row"><span class="badge live">${t('Head')}</span><b class="grow">${t('This machine')}</b><span class="note">${t('{n} of {max} agents', { n: h.running ?? 0, max: h.maxAgents ?? '–' })}${h.remote ? ` · ${t('{n} jobs on workers', { n: h.remote })}` : ''}</span></div></div>
      ${(x.nodes || []).map(row).join('')}</div>
    <form class="row wrap addAgent" data-addnode><input name="name" placeholder="${esc(t('Name, e.g. box-2'))}" required pattern="[a-z0-9][a-z0-9-]{0,39}"><button class="small gold" type="submit">${t('Add a machine')}</button></form>
    <div id="nodeToken"></div>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Move to another machine')}</h3></div>
      <ol class="moveSteps note">
        <li>${t('Make a backup (encrypted when a passphrase is saved in Backups and health):')} <button class="small" data-mkbackup>${t('Back up now')}</button> <span id="bkOut" class="mono"></span></li>
        <li>${t('Copy the file to the new machine (a USB disk, scp, a synced folder).')}</li>
        <li>${t('There, install The AI Squad and Claude Code, then:')} <code>aisquad restore FILE --dry-run</code>, ${t('then without')} <code>--dry-run</code>. ${t('Repositories come back from their git remotes; paths are relinked (--projects-dir, --relink OLD=NEW).')}</li>
        <li>${t('Check it:')} <code>aisquad doctor</code>, ${t('then give one agent a small task.')}</li>
        <li>${t('Approve auto-merge again on the new machine (approvals do not travel), and stop the server here.')}</li>
      </ol></div>`;
}

// the handlers of both tabs; again(msg) re-renders the tab
export function bindMore(body, again) {
  body.addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.dataset.addnode !== undefined) {
      e.preventDefault();
      try {
        const r = await api('POST', '/api/nodes', { name: f.elements.name.value.trim() });
        await again(t('Machine added'));
        const box = document.querySelector('#nodeToken');
        if (box) box.innerHTML = `<div class="pinShown"><b>${t('Run this on {name} (the token is shown only once):', { name: esc(r.node.name) })}</b><div class="mono" style="margin-top:6px;word-break:break-all">${esc(r.command)}</div></div>`;
      } catch (err) { toast(err.message, 5000); }
      return;
    }
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
      const node = el.closest('[data-node]')?.dataset.node;
      if (node && el.dataset.ndrain) { await api('PATCH', `/api/nodes/${node}`, { drain: el.dataset.ndrain === '1' }); return again(t('Saved')); }
      if (node && el.dataset.nremove !== undefined) { if (!confirm(t('Remove this machine? Its token stops working; running jobs there are lost and queued again.'))) return; await api('DELETE', `/api/nodes/${node}`); return again(t('Machine removed')); }
      if (el.dataset.mkbackup !== undefined) { el.disabled = true; const r = await api('POST', '/api/backups', {}); el.disabled = false; const o = body.querySelector('#bkOut'); if (o) o.textContent = r.file || ''; return toast(t('Backup written')); }
      if (el.dataset.srun !== undefined) { const r = await api('POST', '/api/insights/run', {}); return again(t('{n} new suggestions', { n: r.added })); }
      const sug = el.closest('[data-sug]')?.dataset.sug;
      if (sug && el.dataset.saccept !== undefined) { await api('POST', `/api/insights/${sug}/accept`, {}); return again(t('Accepted')); }
      if (sug && el.dataset.sdismiss !== undefined) { const reason = prompt(t('Why not? (optional)')) ?? null; if (reason === null) return; await api('POST', `/api/insights/${sug}/dismiss`, { reason }); return again(t('Dismissed')); }
    } catch (err) { toast(tx(err.message), 5000); }
  });
}
