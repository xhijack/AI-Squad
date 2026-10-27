// SPDX-License-Identifier: Apache-2.0
// Floor and agent dialogs: add / edit agent (overrides), Floor settings, template update / keep / detach.
import { esc, api, toast, openModal, closeModal, segHtml, bindSegs, segValue, diffHtml } from './lib.js';
import { memberHtml, readMember, gitHtml, readGit } from './forms.js';
import { openWizard } from './wizard.js';
import { openTemplates } from './templates.js';
import { ctx } from './ctx.js';
import { voiceControlsHtml, bindVoiceControls, readVoiceControls, previewVoice } from './voice.js';
import { loadRepos } from './repos.js';
import { t as tt, tx, LANG, LANGS, setLang } from './i18n.js';

const floorId = () => ctx.state.route.floorId;
const teamAgent = (id) => ctx.state.floor?.team?.find((a) => a.id === id);

function frame(title, inner, foot) {
  return `<div class="mHead"><h3 class="grow">${title}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
    <form class="mBody" id="dForm" novalidate>${inner}</form><div class="mFoot"><div class="err grow" id="dErr"></div>${foot}</div>`;
}
function wire(body) { body.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => closeModal()); return body; }
const fail = (e) => { document.getElementById('dErr').textContent = e.message; };

async function addAgent() {
  const { templates } = await api('GET', '/api/roles');
  let m = { displayName: '', template: templates[0].role, overrides: {}, appearance: {} };
  const draw = () => {
    const body = wire(openModal(frame(tt('Add agent'), memberHtml(m, templates, { removable: false }), `<button class="ghost" data-close>${tt('Cancel')}</button><button class="gold" data-ok>${tt('Add to team')}</button>`)));
    body.querySelector('[data-f="template"]').addEventListener('change', () => { m = readMember(body.querySelector('[data-member]')); draw(); });
    body.querySelector('[data-f="displayName"]').focus();
    body.querySelector('[data-ok]').onclick = async () => {
      const input = readMember(body.querySelector('[data-member]'));
      if (!input.displayName) return fail(new Error(tt('Display name is required.')));
      try { const r = await api('POST', `/api/floors/${floorId()}/agents`, input); closeModal(); toast(tt('{name} joined the team', { name: r.agent.displayName })); ctx.refresh(); } catch (e) { fail(e); }
    };
  };
  draw();
}

async function editAgent(el) {
  const a = teamAgent(el.dataset.agent);
  if (!a) return;
  const { templates } = await api('GET', '/api/roles');
  const list = a.role.detached ? [{ ...a.definition, role: a.role.template, title: tt('{title} (detached)', { title: a.definition.title }), version: a.role.version }] : templates;
  const tpl = list.find((t) => t.role === a.role.template);
  const locked = tpl ? list : [{ role: a.role.template, title: a.role.template, version: a.role.version, skills: [], model: '', effort: '' }, ...list];
  const role = `${esc(a.role.template)}@${a.role.version}`;
  const body = wire(openModal(frame(tt('Edit {name}', { name: esc(a.displayName) }),
    `<p class="note" style="margin-top:12px">${tt('Agent id <code>{id}</code> stays the same when you rename.', { id: esc(a.id) })} ${a.role.detached ? tt('Role: {role} (detached).', { role }) : tt('Role: {role}.', { role })}</p>
     ${memberHtml({ ...a, template: a.role.template }, locked, { removable: false, templateLocked: true })}`,
    `<button class="ghost" data-close>${tt('Cancel')}</button><button class="gold" data-ok>${tt('Save')}</button>`)));
  body.querySelector('[data-ok]').onclick = async () => {
    const m = readMember(body.querySelector('[data-member]'));
    try {
      await api('PATCH', `/api/floors/${floorId()}/agents/${a.id}`, { displayName: m.displayName, overrides: m.overrides, appearance: m.appearance, lead: m.lead, git: m.git });
      closeModal(); toast(tt('Agent saved; agent file regenerated')); ctx.refresh();
    } catch (e) { fail(e); }
  };
}

async function floorSettings() {
  const f = ctx.state.floor;
  if (!f?.floor) return;
  const c = f.floor;
  const ap = ctx.state.building?.options?.autopilot || {};
  const AP_NAME = { off: tt('Off'), balanced: tt('Balanced'), full: tt('Full') };
  const body = wire(openModal(frame(tt('Floor {n} settings', { n: f.number }), `
    <div class="grid2"><div><label>${tt('Name')}</label><input name="name" value="${esc(c.name)}" maxlength="60"></div>
      <div class="row"><div class="grow"><label>${tt('Floor number')}</label><input name="number" type="number" min="2" max="99" value="${f.number}"></div><div><label>${tt('Colour')}</label><input name="accent" type="color" value="${esc(c.accent)}"></div></div></div>
    <label>${tt('Tagline (under the name on the brand wall)')}</label><input name="tagline" value="${esc(c.tagline || '')}" maxlength="48" placeholder="${esc(tt('ship it, together'))}">
    <label>${tt('Goal summary')}</label><textarea name="goal" rows="3" maxlength="400">${esc(c.goal)}</textarea>
    <p class="note">${tt('The full brief lives in <code>AISQUAD.md</code> in the repository.')}</p>
    <label for="dLang">${tt('Language (this browser)')}</label><select id="dLang" style="width:auto">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    <label>${tt('Workflow')}</label>${segHtml('workflow', [['free-team', 'Free Team'], ['squad-sprint', 'Squad Sprint']], c.workflow)}
    <label class="inline"><input type="checkbox" name="autoNext" ${c.sprint?.autoNext ? 'checked' : ''}> ${tt('Squad Sprint: start the next sprint automatically (fresh lead session) once a closed sprint is merged')}</label>
    <div class="grid2"><div><label>${tt('Budget (USD, 0 = none)')}</label><input name="budgetUsd" type="number" min="0" value="${c.budget.usd}"></div>
      <div><label>${tt('Budget period')}</label>${segHtml('budgetPeriod', [['month', tt('Per month')], ['day', tt('Per day')]], c.budget.period)}</div></div>
    <h3 style="margin-top:18px">Autopilot</h3>
    ${segHtml('autopilot', Object.entries(AP_NAME), c.autopilot || 'off')}
    <ul class="note apLevels">${['off', 'balanced', 'full'].map((k) => `<li><b>${AP_NAME[k]}:</b> ${esc(tx(ap.text?.[k] || ''))}</li>`).join('')}</ul>
    <div class="grid2"><div><label>${tt('Auto-answer after (minutes)')}</label><input name="apTimeout" type="number" min="0.5" max="60" step="0.5" value="${(c.autopilotTimeoutSec || 180) / 60}"></div>
      <p class="note">${tt('A question with a "(Recommended)" option that is not critical gets that answer after this time; an unanswered plain-text ask gets a nudge to decide.')}</p></div>
    <details class="apHard"><summary>${tt('Always waits for you (hard-stop list)')}</summary><ul class="note">${(ap.hardStop || []).map((x) => `<li>${esc(tx(x))}</li>`).join('')}<li>${tt('Balanced also: anything the Blueprint marks as owner-only')}</li></ul>
      <p class="note">${tt('Autopilot also turns on auto-resume after a crash. It never approves a source document and never pushes; the budget and the memory guard still apply.')}</p></details>
    <h3 style="margin-top:18px">${tt('Recovery and memory')}</h3>
    <label class="inline"><input type="checkbox" name="autoResume" ${c.recovery?.autoResume ? 'checked' : ''}> ${tt('Auto-resume after a crash (at most 2 times per hour per agent, not while memory is still under pressure)')}</label>
    <div class="grid2"><div><label>${tt('Max concurrent agents')}</label><input name="maxAgents" type="number" min="1" max="20" value="${c.recovery?.maxAgents || 4}"></div>
      <p class="note">${tt('The lead is told this limit. Starting more, or starting while swap is above 80 %, asks you first.')}</p></div>
    <h3 style="margin-top:18px">Standup</h3>
    <div class="grid2"><div><label>${tt('Daily standup at (local time)')}</label><input name="standupTime" type="time" value="${esc(c.standup?.time || '09:30')}"></div>
      <label class="inline" style="align-self:end"><input type="checkbox" name="standupMeeting" ${c.standup?.meeting !== false ? 'checked' : ''}> ${tt('The team meets at the table for it')}</label></div>
    <p class="note">${tt('Made from the Squad Log (done, doing, blocked by per agent), no model call. It shows in the Standup tab.')}</p>
    <h3 style="margin-top:18px">${tt('Voice (this Floor\'s default)')}</h3>
    <p class="note">${tt('How this Floor\'s agents speak unless an agent sets its own (Desk → Profile → Voice). Auto picks Indonesian or English from the words of each line.')}</p>
    ${voiceControlsHtml(c.voice?.lang || 'auto', c.voice?.settings || null)}
    <div class="row"><button type="button" class="small ghost" data-vpreview>${tt('Preview')}</button><div class="grow" id="dVErr"></div></div>
    <h3 style="margin-top:18px">${tt('Squad Log and Audit')}</h3>
    <label class="inline"><input type="checkbox" name="logMessages" ${c.log?.messages !== false ? 'checked' : ''}> ${tt('Log message text (tasks, messages between agents, questions and answers). Off: metadata only.')}</label>
    <label class="inline"><input type="checkbox" name="logMask" ${c.log?.maskPersonalData !== false ? 'checked' : ''}> ${tt('Mask personal data (e-mail, phone, national id and bank account numbers). Secrets are always removed.')}</label>
    <label class="inline"><input type="checkbox" name="auditAuto" ${c.audit?.auto ? 'checked' : ''}> ${tt('Audit automatically after a sprint closes')}</label>
    <label>${tt('Audit model')}</label>${segHtml('auditModel', [['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['opus', 'Opus']], c.audit?.model || 'sonnet')}
    <h3 style="margin-top:18px">Git</h3>${gitHtml(f.git, { approved: f.merge?.approved })}
    <h3 style="margin-top:18px">${tt('Repositories')}</h3><div id="dRepos" class="note">${tt('Loading…')}</div>
    <h3 style="margin-top:18px">${tt('Merges')}</h3><div id="dMerges" class="note">${tt('Loading…')}</div>`,
  `<button class="ghost danger" data-remove>${tt('Remove Floor')}</button><span class="spacer"></span><button class="ghost" data-close>${tt('Cancel')}</button><button class="gold" data-ok>${tt('Save')}</button>`)));
  bindSegs(body);
  body.querySelector('#dLang').onchange = (e) => setLang(e.target.value);   // per browser, not saved with the Floor
  bindVoiceControls(body);
  body.querySelector('[data-vpreview]').onclick = () => { const c = readVoiceControls(body); previewVoice({ lang: c.lang, settings: c.settings }, body.querySelector('#dVErr')); };
  loadMerges(f.id, body.querySelector('#dMerges'));
  loadRepos(f.id, body.querySelector('#dRepos'), f.agents);
  body.querySelector('[data-remove]').onclick = async () => {
    if (!confirm(tt('Remove this Floor from the Building? The project directory and its files stay untouched.'))) return;
    try { await api('DELETE', `/api/floors/${f.id}`); closeModal(); toast(tt('Floor removed')); location.hash = '#/'; } catch (e) { fail(e); }
  };
  body.querySelector('[data-ok]').onclick = async () => {
    const form = body.querySelector('#dForm');
    const v = (n) => form.elements[n].value;
    try {
      await api('PATCH', `/api/floors/${f.id}`, { name: v('name'), number: Number(v('number')), accent: v('accent'), tagline: v('tagline'), goal: v('goal'), workflow: segValue(form, 'workflow'),
        budget: { usd: Number(v('budgetUsd')) || 0, period: segValue(form, 'budgetPeriod') }, sprint: { autoNext: form.elements.autoNext.checked },
        log: { messages: form.elements.logMessages.checked, maskPersonalData: form.elements.logMask.checked },
        audit: { auto: form.elements.auditAuto.checked, model: segValue(form, 'auditModel') }, recovery: { autoResume: form.elements.autoResume.checked, maxAgents: Number(v('maxAgents')) || 4 },
        autopilot: segValue(form, 'autopilot'), standup: { time: v('standupTime') || '09:30', meeting: form.elements.standupMeeting.checked }, autopilotTimeoutSec: Math.round((Number(v('apTimeout')) || 3) * 60), git: readGit(form), voice: readVoiceControls(form) });
      closeModal(); toast(tt('Floor saved')); ctx.refresh();
    } catch (e) { fail(e); }
  };
}

const RESULT_TEXT = { merged: tt('merged'), refused: tt('refused'), failed: tt('failed'), noop: tt('nothing to merge'), busy: tt('busy') };
const TRIGGER_TEXT = { manual: tt('manual'), auto: tt('auto'), sprint: tt('sprint') };
async function loadMerges(floorId, el) {
  let m;
  try { m = await api('GET', `/api/floors/${floorId}/merges`); } catch (e) { el.textContent = e.message; return; }
  const p = m.policy;
  const branch = `<code>${esc(p.mainBranch)}</code>`;
  const how = p.mergePolicy === 'auto'
    ? (p.mergeMethod === 'merge' ? tt('Automatic merge commits into {branch}', { branch }) : tt('Automatic squash merges into {branch}', { branch }))
    : (p.mergeMethod === 'merge' ? tt('Manual merge commits into {branch}', { branch }) : tt('Manual squash merges into {branch}', { branch }));
  const vars = {
    policy: how, gate: p.qualityGate ? `<code>${esc(p.qualityGate)}</code>` : tt('<b>not set</b> (automatic merges need one)'),
    approval: m.approval ? tt('Approved {date}.', { date: esc(new Date(m.approval.approvedAt).toLocaleString()) }) : tt('Not approved on this machine yet.') };
  const policy = (p.pushPolicy === 'never' ? tt('{policy}, gate {gate}, push: never. {approval}', vars) : tt('{policy}, gate {gate}, push: after merge. {approval}', vars))
    + (m.running ? ` <b>${tt('A merge is running.')}</b>` : '');
  const cands = m.candidates.map((c) => `<div class="row" style="margin-top:6px"><code class="grow ellipsis">${esc(c.branch)}</code>${c.lastResult ? `<span class="chip">${esc(RESULT_TEXT[c.lastResult])}</span>` : ''}<button type="button" class="small" data-merge="${esc(c.branch)}">${tt('Merge now')}</button></div>`).join('');
  const log = m.log.slice(0, 8).map((e) => `<li><b class="${e.result === 'merged' ? 'ok' : ''}">${esc(RESULT_TEXT[e.result] || e.result)}</b> <code>${esc(e.branch)}</code> · ${esc(new Date(e.ts).toLocaleString())} · ${esc(TRIGGER_TEXT[e.trigger] || e.trigger)}${e.reason ? ` · ${esc(tx(e.reason))}` : ''}${e.push ? ` · ${e.push.ok ? tt('push ok') : tt('push failed')}` : ''}</li>`).join('');
  const sp = m.sprint;
  const CHECK = { branch: tt('branch'), release: 'RELEASE.md', closingCommit: tt('closing commit'), cleanTree: tt('clean tree'), qaPass: tt('final QA PASS') };
  const sprintHtml = sp ? `<p>${tt('Sprint {n} ({branch}): {status}', { n: esc(sp.sprint), branch: `<code>${esc(sp.branch)}</code>`, status: sp.closed ? tt('<b class="ok">closed</b>, ready for the server to merge') : tt('open') })} ·
    ${Object.entries(sp.checks).map(([k, ok]) => `${ok ? '✓' : '·'} ${CHECK[k]}`).join(', ')}${sp.autoNext ? ` · ${tt('next sprint starts automatically')}` : ''}</p>` : '';
  el.innerHTML = `<p style="margin-top:0">${policy}</p>${sprintHtml}
    <b>${tt('Ready to merge')}</b>${cands || `<div class="empty">${tt('No unmerged branches for this branch strategy.')}</div>`}
    <b style="display:block;margin-top:10px">${tt('Last merges')}</b>${log ? `<ul style="padding-left:18px;margin:4px 0">${log}</ul>` : `<div class="empty">${tt('None yet.')}</div>`}`;
  el.querySelectorAll('[data-merge]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api('POST', `/api/floors/${floorId}/merges`, { branch: b.dataset.merge }); toast(tt('Merge started; the result appears here and in Attention')); setTimeout(() => loadMerges(floorId, el), 3000); }
    catch (e) { toast(e.message); b.disabled = false; }
  });
}

async function templateDiff(el) {
  const d = await api('GET', `/api/floors/${floorId()}/agents/${el.dataset.agent}/diff`);
  const body = wire(openModal(frame(tt('Update {role}: v{from} → v{to}', { role: esc(d.role), from: d.from, to: d.to }), `<p class="note" style="margin-top:12px">${tt('Changes in the Role Template. The agent\'s overrides are kept either way.')}</p>${diffHtml(d.diff)}`,
    `<button class="ghost" data-act-keep>${tt('Keep current')}</button><button class="gold" data-act-update>${tt('Update')}</button>`)));
  body.querySelector('[data-act-update]').onclick = async () => { await templateAction(el.dataset.agent, 'update'); closeModal(); };
  body.querySelector('[data-act-keep]').onclick = async () => { await templateAction(el.dataset.agent, 'keep'); closeModal(); };
}

async function templateAction(agentId, action) {
  try {
    await api('POST', `/api/floors/${floorId()}/agents/${agentId}/template`, { action });
    toast({ update: tt('Agent updated to the latest template'), keep: tt('Keeping the current version'), detach: tt('Agent detached from its template') }[action]);
  } catch (e) { toast(e.message); }
  ctx.refresh();
}

Object.assign(ctx.actions, {
  'new-floor': () => openWizard(),
  templates: () => openTemplates(),
  'from-detected': (el) => { const p = ctx.state.building.detected[+el.dataset.i]; openWizard({ name: p.name, path: p.root }); },
  'add-agent': addAgent,
  'edit-agent': editAgent,
  'floor-settings': floorSettings,
  'tpl-diff': templateDiff,
  'tpl-update': (el) => templateAction(el.dataset.agent, 'update'),
  'tpl-keep': (el) => templateAction(el.dataset.agent, 'keep'),
  'tpl-detach': (el) => { if (confirm(tt('Detach this agent? It becomes a standalone copy and no longer receives template updates.'))) return templateAction(el.dataset.agent, 'detach'); },
  async 'remove-agent'(el) {
    const a = teamAgent(el.dataset.agent);
    if (!confirm(a?.displayName ? tt('Remove {name} from the team? Its session is stopped and its generated agent file deleted.', { name: a.displayName }) : tt('Remove this agent from the team? Its session is stopped and its generated agent file deleted.'))) return;
    await api('DELETE', `/api/floors/${floorId()}/agents/${el.dataset.agent}`);
    toast(tt('Agent removed')); location.hash = `#/floor/${floorId()}`;
  },
});

// a newer Blueprint version (for example lessons applied from an audit): new snapshot, standard and agent files
ctx.actions['blueprint-update'] = async () => {
  const bp = ctx.state.floor?.blueprint;
  if (!bp || !confirm(tt('Update this Floor to {title} v{version}? AISQUAD.md and the agent files get the new standard; running agents read it on their next start.', { title: bp.title, version: bp.latest }))) return;
  const r = await api('POST', `/api/floors/${floorId()}/blueprint/update`);
  toast(tt('Blueprint updated to v{version}', { version: r.version }));
  ctx.refresh();
};
