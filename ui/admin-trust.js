// SPDX-License-Identifier: Apache-2.0
// Admin → Improvements, 1.0: the trust ladder per category (level 1 runs low-risk suggestions as 7-day canaries on
// one agent; a category must earn it), the canaries running now, and promoting a lesson from a Space to a Role
// Template with the client taken out (always your call).
import { esc, api, toast, ago, diffHtml } from './lib.js';
import { t } from './i18n.js';

const CAT = { 'agent-rule': t('Rules for agents'), model: t('Models') };
export function trustHtml(x) {
  const r = x.ladderRules || { accepted: 10, rate: 0.8, improved: 0.6, measured: 3 };
  const running = x.items.filter((i) => i.status === 'canary');
  return `<div class="section"><div class="sectionHead"><h3 class="grow">${t('Trust ladder')}</h3></div>
    <p class="note">${t('Level 0: every suggestion waits for you. Level 1: a low-risk suggestion (a rule or a lighter model for one agent) is applied by itself as a canary for 7 days, measured, and then you keep it or roll it back. A category earns level 1 with {a} accepted suggestions, {p} % of its decisions accepted and improved follow-ups. Never automatic: hard stops, permissions, Building settings, Legal, the Company Brain and promoting lessons.', { a: r.accepted, p: Math.round(r.rate * 100) })}</p>
    <div class="adminList">${(x.trust || []).map((c) => `<div class="adminRow"><div class="row"><span class="badge ${c.level ? 'live' : ''}">${t('Level {n}', { n: c.level })}</span><b class="grow">${esc(CAT[c.category] || c.category)}</b>
      ${c.level ? `<button class="small ghost" data-tlevel="${esc(c.category)}" data-to="0">${t('Back to level 0')}</button>` : `<button class="small ${c.eligible ? 'gold' : 'ghost'}" data-tlevel="${esc(c.category)}" data-to="1" ${c.eligible ? '' : 'disabled'}>${t('Level 1')}</button>`}</div>
      <div class="note">${t('{a} accepted, {d} declined ({p} %), {m} measured, {i} improved', { a: c.accepted, d: c.declined, p: c.rate, m: c.measured, i: c.improved })}${c.eligible || c.level ? '' : ` · ${t('not earned yet')}`}${c.canaries ? ` · ${t('{n} canaries running', { n: c.canaries })}` : ''}</div></div>`).join('')}</div>
    ${running.length ? `<div class="adminList">${running.map((i) => `<div class="adminRow"><div class="row"><span class="badge update">${t('Canary')}</span><b class="grow">${esc(i.title)}</b><span class="note">${t('until {when}', { when: new Date(i.canaryUntil).toLocaleDateString() })}</span></div></div>`).join('')}</div>` : ''}
  </div>
  <div class="section"><div class="sectionHead"><h3 class="grow">${t('Promote a lesson to a Role Template')}</h3><button class="small" data-plist>${t('Show lessons')}</button></div>
    <p class="note">${t('A lesson a Space learned (docs/squad/LEARNINGS.md) becomes a rule for every agent of a role. The client is taken out first (the Space\'s name, its agents, personal data); you edit the rule and approve it; the template gets a new version.')}</p>
    <div id="promoteBox"></div></div>`;
}

export function bindTrust(body, again) {
  let data = null;
  const box = () => body.querySelector('#promoteBox');
  const form = () => {
    const ls = data.lessons, rs = data.roles.filter((r) => r.writable);
    box().innerHTML = ls.length ? `<div class="grid4"><label style="grid-column: span 3">${t('Lesson')}<select id="pLesson">${ls.map((l, i) => `<option value="${i}">${esc(l.space)} · ${esc(l.date)} · ${esc(l.text.slice(0, 110))}</option>`).join('')}</select></label>
      <label>${t('Role')}<select id="pRole">${rs.map((r) => `<option value="${esc(r.role)}">${esc(r.title)} (v${r.version})</option>`).join('')}</select></label></div>
      <div class="row"><span class="spacer"></span><button class="small" data-ppreview>${t('Take the client out')}</button></div><div id="pPreview"></div>`
      : `<div class="empty">${t('No lessons in any Space yet.')}</div>`;
  };
  body.addEventListener('click', async (e) => {
    const el = e.target;
    try {
      if (el.dataset.tlevel) { await api('POST', '/api/insights/trust', { category: el.dataset.tlevel, level: +el.dataset.to }); return again(t('Saved')); }
      if (el.dataset.plist !== undefined) { data = await api('GET', '/api/promote'); return form(); }
      if (el.dataset.ppreview !== undefined || el.dataset.prefresh !== undefined) {
        const l = data.lessons[+body.querySelector('#pLesson').value];
        const rule = el.dataset.prefresh !== undefined ? body.querySelector('#pRule').value : '';
        const p = await api('POST', '/api/promote/preview', { floorId: l.floorId, text: l.text, role: body.querySelector('#pRole').value, rule });
        body.querySelector('#pPreview').innerHTML = `<label class="note">${t('The rule (edit it)')}<textarea id="pRule" rows="2" class="grow">${esc(p.rule)}</textarea></label>
          ${p.leftovers.length || p.personal ? `<div class="note warnText">${p.leftovers.length ? t('Still names the client: {w}', { w: esc(p.leftovers.join(', ')) }) : t('Still contains personal data or a secret')}</div>` : ''}
          ${diffHtml(p.diff)}<div class="row"><span class="spacer"></span><button class="small ghost" data-prefresh>${t('Check again')}</button><button class="small gold" data-papply>${t('Approve: new template version')}</button></div>`;
        return;
      }
      if (el.dataset.papply !== undefined) {
        const l = data.lessons[+body.querySelector('#pLesson').value];
        const r = await api('POST', '/api/promote', { floorId: l.floorId, text: l.text, role: body.querySelector('#pRole').value, rule: body.querySelector('#pRule').value });
        return again(t('{role} is now version {v}', { role: r.role, v: r.version }));
      }
    } catch (err) { toast(err.message, 5000); }
  });
}
