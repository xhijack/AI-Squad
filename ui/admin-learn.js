// SPDX-License-Identifier: Apache-2.0
// Admin → Learning (1.11): what the agents propose to keep, for the Owner to approve (as proposed or edited), not
// take (with a note the agent reads), and what was kept: the Company Brain's pinned facts and the learned skills,
// each with its earlier versions to look at and restore.
import { esc, api, toast, diffHtml, ago } from './lib.js';
import { t } from './i18n.js';

const KIND = { fact: t('Company fact'), brain: t('Company Brain document'), skill: t('Skill') };
const STATUS = { approved: t('Approved'), rejected: t('Not taken') };
const when = (ts) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
// a version id (2026-11-03T04-55-00-000Z) as a date
const vdate = (v) => { const m = String(v).match(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)/); return m ? `${m[1]} ${m[2]}:${m[3]}` : v; };

function pendingHtml(p) {
  return `<div class="adminRow" data-prop="${esc(p.id)}"><div class="row wrap"><span class="badge update">${esc(KIND[p.kind])}</span><b class="grow">${esc(p.title)}</b><span class="note">${esc([p.floorName, p.agentName].filter(Boolean).join(' · '))} · ${ago(p.createdAt)}</span></div>
    ${p.target && p.kind !== 'fact' ? `<div class="note mono">${esc(p.target)}</div>` : ''}
    ${p.why ? `<div class="note">${t('Why: {why}', { why: esc(p.why) })}</div>` : ''}
    <div data-review></div>
    <div class="row"><span class="spacer"></span><button class="small" data-open>${t('Review')}</button></div></div>`;
}
function reviewHtml(p) {
  return `${p.current == null && p.kind !== 'fact' ? `<div class="note" style="margin-top:var(--sp-2)">${t('A new file.')}</div>` : p.diff ? `<div class="note" style="margin-top:var(--sp-2)">${t('Changes to the current version:')}</div>${diffHtml(p.diff)}` : ''}
    <label style="margin-top:var(--sp-2)">${p.kind === 'fact' ? t('The fact (one line each); edit before approving if needed') : t('What will be kept; edit before approving if needed')}<textarea data-content rows="${p.kind === 'fact' ? 3 : 12}" class="mono">${esc(p.content)}</textarea></label>
    ${p.kind === 'skill' ? `<label class="inline"><input type="checkbox" data-all> ${t('Install it in every Space (otherwise only in {space})', { space: esc(p.floorName) })}</label>` : ''}
    <div class="row wrap"><input data-reason placeholder="${esc(t('Why not (the agent reads it)'))}" class="grow"><button class="small ghost danger" data-reject>${t('Not now')}</button><button class="small gold" data-approve>${t('Approve')}</button></div>`;
}
function keptHtml(l) {
  return `<div class="section"><div class="sectionHead"><h3 class="grow">${t('Company facts')}</h3><button class="small ghost" data-hist="fact" data-target="FACTS.md">${t('Versions ({n})', { n: l.factVersions })}</button></div>
      ${l.facts ? `<div class="mdBox mono">${esc(l.facts)}</div>` : `<div class="empty">${t('No facts yet. Agents propose them; you approve.')}</div>`}<div data-histbox="fact:FACTS.md"></div></div>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Learned skills')}</h3></div>
      ${l.skills.length ? `<div class="adminList">${l.skills.map((s) => `<div class="adminRow"><div class="row wrap"><b class="grow mono">${esc(s.name)}</b><span class="note">${t('in {n} Spaces', { n: s.spaces.length })}</span><button class="small ghost" data-hist="skill" data-target="${esc(s.name)}">${t('Versions ({n})', { n: s.versions })}</button></div>
        <div class="note">${esc(s.description)}</div><div data-histbox="skill:${esc(s.name)}"></div></div>`).join('')}</div>` : `<div class="empty">${t('No learned skills yet.')}</div>`}</div>`;
}
function decidedHtml(list) {
  if (!list.length) return '';
  return `<div class="section"><div class="sectionHead"><h3 class="grow">${t('Decided')}</h3></div><ul class="list">${list.slice(0, 20).map((p) => `<li class="row wrap"><span class="badge ${p.status === 'approved' ? 'live' : ''}">${esc(STATUS[p.status] || p.status)}</span><span class="grow">${esc(p.title)} <span class="note">${esc(KIND[p.kind])}${p.target && p.kind !== 'fact' ? ` · ${esc(p.target)}` : ''} · ${esc(p.floorName || '')}${p.reason ? ` · ${esc(p.reason)}` : ''}${p.edited ? ` · ${t('edited')}` : ''}</span></span><span class="note">${when(p.decidedAt)}</span></li>`).join('')}</ul></div>`;
}

export async function learningPage(box) {
  const d = await api('GET', '/api/proposals');
  if (!box.isConnected) return;
  box.innerHTML = `<div class="aPage"><div class="aHead"><h2 class="grow">${t('Learning')}</h2></div>
    <p class="note">${t('Agents propose what the company should keep: a fact every agent should know, a Company Brain document, or a skill. Nothing changes until you approve it; every earlier version is kept and can be restored. Agents learn the format from the propose-learning skill.')}</p>
    <div class="section"><div class="sectionHead"><h3 class="grow">${t('Waiting for you')}</h3></div>
      ${d.pending.length ? `<div class="adminList">${d.pending.map(pendingHtml).join('')}</div>` : `<div class="empty">${t('Nothing waiting.')}</div>`}</div>
    ${keptHtml(d.learned)}${decidedHtml(d.decided)}</div>`;
  const again = (msg) => { if (msg) toast(msg); return learningPage(box); };
  box.onclick = async (e) => {
    const el = e.target, row = el.closest('[data-prop]');
    try {
      if (row && el.closest('[data-open]')) {
        const p = await api('GET', `/api/proposals/${row.dataset.prop}`);
        row.querySelector('[data-review]').innerHTML = reviewHtml(p);
        el.closest('[data-open]').remove();
        return;
      }
      if (row && el.closest('[data-approve]')) {
        el.disabled = true;
        await api('POST', `/api/proposals/${row.dataset.prop}/approve`, { content: row.querySelector('[data-content]').value, scope: row.querySelector('[data-all]')?.checked ? 'all' : 'space' });
        return again(t('Approved and kept'));
      }
      if (row && el.closest('[data-reject]')) {
        el.disabled = true;
        await api('POST', `/api/proposals/${row.dataset.prop}/reject`, { reason: row.querySelector('[data-reason]').value.trim() });
        return again(t('Not taken; the agent is told'));
      }
      const h = el.closest('[data-hist]');
      if (h) {
        const key = `${h.dataset.hist}:${h.dataset.target}`, out = box.querySelector(`[data-histbox="${CSS.escape(key)}"]`);
        if (out.innerHTML) { out.innerHTML = ''; return; }
        const v = await api('GET', `/api/learned/${h.dataset.hist}/versions?target=${encodeURIComponent(h.dataset.target)}`);
        out.innerHTML = v.versions.length ? `<ul class="list">${v.versions.map((x) => `<li class="row" data-ver="${esc(x.version)}" data-kind="${esc(h.dataset.hist)}" data-tgt="${esc(h.dataset.target)}"><span class="grow note">${esc(vdate(x.version))}</span><button class="small ghost" data-vshow>${t('View')}</button><button class="small ghost danger" data-vrestore>${t('Restore')}</button></li><li data-vtext="${esc(x.version)}" hidden></li>`).join('')}</ul>` : `<div class="note">${t('No earlier versions.')}</div>`;
        return;
      }
      const li = el.closest('[data-ver]');
      if (li && el.closest('[data-vshow]')) {
        const box2 = li.nextElementSibling;
        if (!box2.hidden) { box2.hidden = true; return; }
        const r = await api('GET', `/api/learned/${li.dataset.kind}/version?target=${encodeURIComponent(li.dataset.tgt)}&v=${encodeURIComponent(li.dataset.ver)}`);
        box2.innerHTML = `<div class="mdBox mono">${esc(r.text)}</div>`; box2.hidden = false;
        return;
      }
      if (li && el.closest('[data-vrestore]')) {
        if (!confirm(t('Put this version back? The current one is kept as a version too.'))) return;
        await api('POST', `/api/learned/${li.dataset.kind}/restore`, { target: li.dataset.tgt, version: li.dataset.ver });
        return again(t('Restored'));
      }
    } catch (err) { if (el.disabled !== undefined) el.disabled = false; toast(err.message, 6000); }
  };
}
