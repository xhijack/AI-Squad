// SPDX-License-Identifier: Apache-2.0
// Admin → Publishing (1.12): what waits to go out (held by the rules, the reviewer, the day's limit, or a send that
// failed), the rules per Space and channel, and the receipts of what went out.
import { esc, api, toast, ago } from './lib.js';
import { t, tx } from './i18n.js';

const CH = { post: t('Posts'), message: t('Messages to leads and customers'), ad: t('Ads'), 'deploy-staging': t('Deploys to staging'), 'deploy-production': t('Deploys to production') };
const GO = { post: t('Publish it'), message: t('Send it'), ad: t('Run the ad'), 'deploy-staging': t('Deploy to staging'), 'deploy-production': t('Deploy to production') };
const MODE = { owner: t('Waits for you'), review: t('After a reviewer'), auto: t('By itself') };
const STATUS = { published: t('Sent'), go: t('Go given'), rejected: t('Not sent'), failed: t('Failed'), held: t('Waiting'), reviewing: t('With the reviewer'), queued: t('Sending'), publishing: t('Sending') };
const when = (ts) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const what = (x) => (x.args ? JSON.stringify(x.args, null, 2) : x.note || '');

function waitingHtml(x) {
  const failed = x.status === 'failed';
  return `<div class="adminRow" data-ob="${esc(x.id)}" data-digest="${esc(x.digest || '')}"${x.uncertain ? ' data-unsure="1"' : ''}><div class="row wrap"><span class="badge ${failed ? 'update' : ''}">${esc(CH[x.channel] || x.channel)}</span><b class="grow">${esc(x.title)}</b></div>
    <div class="note">${esc([x.floorName, x.agentName].filter(Boolean).join(' · '))} · ${ago(x.createdAt)}</div>
    ${x.via ? `<div class="note mono">${esc(x.via)} → ${esc(x.tool)}</div>` : x.ref ? `<div class="note mono">${esc(x.ref)}</div>` : ''}
    <div class="note ${failed ? 'badText' : ''}">${failed ? `${x.uncertain ? `<b>${t('It may have gone out: check the channel before trying again.')}</b> ` : ''}${esc(tx(x.error || ''))}` : t('Waiting because {why}.', { why: esc(tx(x.reason || '')) })}</div>
    ${x.review?.problems?.length ? `<ul class="note">${x.review.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${x.args && x.note ? `<div class="note">${t('Notes:')} ${esc(x.note)}</div>` : ''}
    <div class="mdBox mono">${esc(what(x))}</div>
    <div class="row wrap">${failed ? '' : `<input data-reason placeholder="${esc(t('Why not (the agent reads it)'))}" class="grow" style="min-width:min(16em,100%)">`}<span class="spacer"></span>
      ${failed ? `<button class="small ghost danger" data-reject>${t('Drop it')}</button><button class="small gold" data-retry>${t('Try again')}</button>`
        : `<button class="small ghost danger" data-reject>${t('Not now')}</button><button class="small gold" data-approve>${esc(GO[x.channel] || t('Send it'))}</button>`}</div></div>`;
}
function rulesHtml(d) {
  const chans = Object.keys(d.channels);
  if (!d.spaces.length) return `<div class="empty">${t('No Spaces yet.')}</div>`;
  return `<div class="tableWrap"><table class="perf"><thead><tr><th>${t('Space')}</th>${chans.map((c) => `<th>${esc(CH[c] || c)}</th>`).join('')}<th></th></tr></thead><tbody>
    ${d.spaces.map((s) => `<tr data-rules="${esc(s.id)}"><td><b>${esc(s.name)}</b>${s.locked ? `<div class="note">${t('Legal: always you')}</div>` : ''}${s.tools.length ? `<div class="note">${s.tools.map((x) => `${esc(x.name)} → ${esc(x.tool)} (${esc(CH[x.channel] || x.channel)})`).join('<br>')}</div>` : `<div class="note">${t('No publishing tools')}</div>`}</td>
      ${chans.map((c) => { const r = s.rules[c], modes = d.channels[c].modes; return `<td><select style="min-width:9.5em" data-mode="${esc(c)}" ${modes.length === 1 || s.locked ? 'disabled' : ''}>${modes.map((m) => `<option value="${m}" ${r.mode === m ? 'selected' : ''}>${esc(MODE[m])}</option>`).join('')}</select>
        ${modes.length > 1 ? `<label class="note row">${t('max/day')}<input type="number" min="0" max="200" data-per="${esc(c)}" value="${r.perDay}" style="width:4.5em" ${s.locked ? 'disabled' : ''}></label>` : ''}</td>`; }).join('')}
      <td>${s.locked ? '' : `<button class="small" data-save>${t('Save')}</button>`}</td></tr>`).join('')}</tbody></table></div>`;
}
function recentHtml(list) {
  if (!list.length) return `<div class="empty">${t('Nothing sent yet.')}</div>`;
  return `<ul class="list">${list.map((x) => `<li><details><summary class="row wrap"><span class="badge ${x.status === 'published' || x.status === 'go' ? 'live' : ''}">${esc(STATUS[x.status] || x.status)}</span><span class="grow">${esc(x.title)} <span class="note">${esc(CH[x.channel] || x.channel)} · ${esc(x.floorName || '')} · ${x.auto ? t('by the rules') : esc(x.by || '')}${x.rejectReason ? ` · ${esc(x.rejectReason)}` : ''} · ${when(x.doneAt || x.decidedAt || x.createdAt)}</span></span></summary>
    ${x.result ? `<div class="note">${t('What the channel answered:')}</div><div class="mdBox mono">${esc(x.result)}</div>` : ''}
    <div class="note">${t('What was asked:')}</div><div class="mdBox mono">${esc(what(x))}</div></details></li>`).join('')}</ul>`;
}

export async function publishingPage(box) {
  const d = await api('GET', '/api/outbox');
  if (!box.isConnected) return;
  box.innerHTML = `<div class="aPage"><div class="aHead"><h2 class="grow">${t('Publishing')}</h2></div>
    <p class="note">${t('Nothing leaves the company from an agent\'s own hands. Agents ask here for a post, a message to a lead or a customer, an ad or a deploy; the rules of each Space decide: it waits for you, it goes out after a second reviewer, or it goes out by itself up to a daily limit. Money and legal topics, tools that cost money, ads and production deploys always wait for you. Publishing tools are the ones you mark in Integrations: agents never get them.')}</p>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Waiting for you')}</h3></div>
      ${d.waiting.length ? `<div class="adminList">${d.waiting.map(waitingHtml).join('')}</div>` : `<div class="empty">${t('Nothing waiting.')}</div>`}
      ${d.reviewing.length ? `<div class="note">${t('In progress: {list}', { list: d.reviewing.map((x) => `${esc(x.title)} (${esc(STATUS[x.status] || x.status)})`).join(', ') })}</div>` : ''}</div>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Rules per Space')}</h3></div>${rulesHtml(d)}</div>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Sent and decided')}</h3></div>${recentHtml(d.recent)}</div></div>`;
  const again = (msg) => { if (msg) toast(msg); return publishingPage(box); };
  box.onclick = async (e) => {
    const el = e.target, row = el.closest('[data-ob]'), rules = el.closest('[data-rules]');
    try {
      if (row && el.closest('[data-approve]')) { el.disabled = true; const r = await api('POST', `/api/outbox/${row.dataset.ob}/approve`, { digest: row.dataset.digest }); return again(r.status === 'failed' ? t('Not sent: {why}', { why: tx(r.error) }) : r.status === 'go' ? t('Go given; the agent does it now') : t('Sent')); }
      if (row && el.closest('[data-retry]')) { el.disabled = true; if (row.dataset.unsure && !confirm(t('It may have gone out already. Did you check the channel? Send it again?'))) { el.disabled = false; return; }
        const r = await api('POST', `/api/outbox/${row.dataset.ob}/retry`, { digest: row.dataset.digest }); return again(r.status === 'failed' ? t('Not sent: {why}', { why: tx(r.error) }) : t('Sent')); }
      if (row && el.closest('[data-reject]')) { el.disabled = true; await api('POST', `/api/outbox/${row.dataset.ob}/reject`, { reason: row.querySelector('[data-reason]')?.value.trim() || '' }); return again(t('Not sent; the agent is told')); }
      if (rules && el.closest('[data-save]')) {
        el.disabled = true;
        const patch = {};
        for (const s of rules.querySelectorAll('[data-mode]')) if (!s.disabled) patch[s.dataset.mode] = { mode: s.value };
        for (const n of rules.querySelectorAll('[data-per]')) if (!n.disabled && n.value.trim() !== '') patch[n.dataset.per] = { ...(patch[n.dataset.per] || {}), perDay: Number(n.value) };
        await api('PUT', `/api/outbox/rules/${rules.dataset.rules}`, { rules: patch });
        return again(t('Saved'));
      }
    } catch (err) { el.disabled = false; toast(err.message, 6000); }
  };
}
