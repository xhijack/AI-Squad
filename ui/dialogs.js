// Floor and agent dialogs: add / edit agent (overrides), Floor settings, template update / keep / detach.
import { esc, api, toast, openModal, closeModal, segHtml, bindSegs, segValue, diffHtml } from './lib.js';
import { memberHtml, readMember, gitHtml, readGit } from './forms.js';
import { openWizard } from './wizard.js';
import { openTemplates } from './templates.js';
import { ctx } from './ctx.js';

const floorId = () => ctx.state.route.floorId;
const teamAgent = (id) => ctx.state.floor?.team?.find((a) => a.id === id);

function frame(title, inner, foot) {
  return `<div class="mHead"><h3 class="grow">${title}</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <form class="mBody" id="dForm" novalidate>${inner}</form><div class="mFoot"><div class="err grow" id="dErr"></div>${foot}</div>`;
}
function wire(body) { body.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => closeModal()); return body; }
const fail = (e) => { document.getElementById('dErr').textContent = e.message; };

async function addAgent() {
  const { templates } = await api('GET', '/api/roles');
  let m = { displayName: '', template: templates[0].role, overrides: {}, appearance: {} };
  const draw = () => {
    const body = wire(openModal(frame('Add agent', memberHtml(m, templates, { removable: false }), '<button class="ghost" data-close>Cancel</button><button class="gold" data-ok>Add to team</button>')));
    body.querySelector('[data-f="template"]').addEventListener('change', () => { m = readMember(body.querySelector('[data-member]')); draw(); });
    body.querySelector('[data-f="displayName"]').focus();
    body.querySelector('[data-ok]').onclick = async () => {
      const input = readMember(body.querySelector('[data-member]'));
      if (!input.displayName) return fail(new Error('Display name is required.'));
      try { const r = await api('POST', `/api/floors/${floorId()}/agents`, input); closeModal(); toast(`${r.agent.displayName} joined the team`); ctx.refresh(); } catch (e) { fail(e); }
    };
  };
  draw();
}

async function editAgent(el) {
  const a = teamAgent(el.dataset.agent);
  if (!a) return;
  const { templates } = await api('GET', '/api/roles');
  const list = a.role.detached ? [{ ...a.definition, role: a.role.template, title: `${a.definition.title} (detached)`, version: a.role.version }] : templates;
  const tpl = list.find((t) => t.role === a.role.template);
  const locked = tpl ? list : [{ role: a.role.template, title: a.role.template, version: a.role.version, skills: [], model: '', effort: '' }, ...list];
  const body = wire(openModal(frame(`Edit ${esc(a.displayName)}`,
    `<p class="note" style="margin-top:12px">Agent id <code>${esc(a.id)}</code> stays the same when you rename. Role: ${esc(a.role.template)}@${a.role.version}${a.role.detached ? ' (detached)' : ''}.</p>
     ${memberHtml({ ...a, template: a.role.template }, locked, { removable: false, templateLocked: true })}`,
    '<button class="ghost" data-close>Cancel</button><button class="gold" data-ok>Save</button>')));
  body.querySelector('[data-ok]').onclick = async () => {
    const m = readMember(body.querySelector('[data-member]'));
    try {
      await api('PATCH', `/api/floors/${floorId()}/agents/${a.id}`, { displayName: m.displayName, overrides: m.overrides, appearance: m.appearance, lead: m.lead, git: m.git });
      closeModal(); toast('Agent saved; agent file regenerated'); ctx.refresh();
    } catch (e) { fail(e); }
  };
}

async function floorSettings() {
  const f = ctx.state.floor;
  if (!f?.floor) return;
  const c = f.floor;
  const ap = ctx.state.building?.options?.autopilot || {};
  const body = wire(openModal(frame(`Floor ${f.number} settings`, `
    <div class="grid2"><div><label>Name</label><input name="name" value="${esc(c.name)}" maxlength="60"></div>
      <div class="row"><div class="grow"><label>Floor number</label><input name="number" type="number" min="2" max="99" value="${f.number}"></div><div><label>Colour</label><input name="accent" type="color" value="${esc(c.accent)}"></div></div></div>
    <label>Tagline (under the name on the brand wall)</label><input name="tagline" value="${esc(c.tagline || '')}" maxlength="48" placeholder="ship it, together">
    <label>Goal summary</label><textarea name="goal" rows="3" maxlength="400">${esc(c.goal)}</textarea>
    <p class="note">The full brief lives in <code>AISQUAD.md</code> in the repository.</p>
    <label>Workflow</label>${segHtml('workflow', [['free-team', 'Free Team'], ['squad-sprint', 'Squad Sprint']], c.workflow)}
    <label class="inline"><input type="checkbox" name="autoNext" ${c.sprint?.autoNext ? 'checked' : ''}> Squad Sprint: start the next sprint automatically (fresh lead session) once a closed sprint is merged</label>
    <div class="grid2"><div><label>Budget (USD, 0 = none)</label><input name="budgetUsd" type="number" min="0" value="${c.budget.usd}"></div>
      <div><label>Budget period</label>${segHtml('budgetPeriod', [['month', 'Per month'], ['day', 'Per day']], c.budget.period)}</div></div>
    <h3 style="margin-top:18px">Autopilot</h3>
    ${segHtml('autopilot', [['off', 'Off'], ['balanced', 'Balanced'], ['full', 'Full']], c.autopilot || 'off')}
    <ul class="note apLevels">${['off', 'balanced', 'full'].map((k) => `<li><b>${k[0].toUpperCase() + k.slice(1)}:</b> ${esc(ap.text?.[k] || '')}</li>`).join('')}</ul>
    <div class="grid2"><div><label>Auto-answer after (minutes)</label><input name="apTimeout" type="number" min="0.5" max="60" step="0.5" value="${(c.autopilotTimeoutSec || 180) / 60}"></div>
      <p class="note">A question with a "(Recommended)" option that is not critical gets that answer after this time; an unanswered plain-text ask gets a nudge to decide.</p></div>
    <details class="apHard"><summary>Always waits for you (hard-stop list)</summary><ul class="note">${(ap.hardStop || []).map((x) => `<li>${esc(x)}</li>`).join('')}<li>Balanced also: anything the Blueprint marks as owner-only</li></ul>
      <p class="note">Autopilot also turns on auto-resume after a crash. It never approves a source document and never pushes; the budget and the memory guard still apply.</p></details>
    <h3 style="margin-top:18px">Recovery and memory</h3>
    <label class="inline"><input type="checkbox" name="autoResume" ${c.recovery?.autoResume ? 'checked' : ''}> Auto-resume after a crash (at most 2 times per hour per agent, not while memory is still under pressure)</label>
    <div class="grid2"><div><label>Max concurrent agents</label><input name="maxAgents" type="number" min="1" max="20" value="${c.recovery?.maxAgents || 4}"></div>
      <p class="note">The lead is told this limit. Starting more, or starting while swap is above 80 %, asks you first.</p></div>
    <h3 style="margin-top:18px">Squad Log and Audit</h3>
    <label class="inline"><input type="checkbox" name="logMessages" ${c.log?.messages !== false ? 'checked' : ''}> Log message text (tasks, messages between agents, questions and answers). Off: metadata only.</label>
    <label class="inline"><input type="checkbox" name="logMask" ${c.log?.maskPersonalData !== false ? 'checked' : ''}> Mask personal data (e-mail, phone, national id and bank account numbers). Secrets are always removed.</label>
    <label class="inline"><input type="checkbox" name="auditAuto" ${c.audit?.auto ? 'checked' : ''}> Audit automatically after a sprint closes</label>
    <label>Audit model</label>${segHtml('auditModel', [['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['opus', 'Opus']], c.audit?.model || 'sonnet')}
    <h3 style="margin-top:18px">Git</h3>${gitHtml(f.git, { approved: f.merge?.approved })}
    <h3 style="margin-top:18px">Merges</h3><div id="dMerges" class="note">Loading…</div>`,
  '<button class="ghost danger" data-remove>Remove Floor</button><span class="spacer"></span><button class="ghost" data-close>Cancel</button><button class="gold" data-ok>Save</button>')));
  bindSegs(body);
  loadMerges(f.id, body.querySelector('#dMerges'));
  body.querySelector('[data-remove]').onclick = async () => {
    if (!confirm('Remove this Floor from the Building? The project directory and its files stay untouched.')) return;
    try { await api('DELETE', `/api/floors/${f.id}`); closeModal(); toast('Floor removed'); location.hash = '#/'; } catch (e) { fail(e); }
  };
  body.querySelector('[data-ok]').onclick = async () => {
    const form = body.querySelector('#dForm');
    const v = (n) => form.elements[n].value;
    try {
      await api('PATCH', `/api/floors/${f.id}`, { name: v('name'), number: Number(v('number')), accent: v('accent'), tagline: v('tagline'), goal: v('goal'), workflow: segValue(form, 'workflow'),
        budget: { usd: Number(v('budgetUsd')) || 0, period: segValue(form, 'budgetPeriod') }, sprint: { autoNext: form.elements.autoNext.checked },
        log: { messages: form.elements.logMessages.checked, maskPersonalData: form.elements.logMask.checked },
        audit: { auto: form.elements.auditAuto.checked, model: segValue(form, 'auditModel') }, recovery: { autoResume: form.elements.autoResume.checked, maxAgents: Number(v('maxAgents')) || 4 },
        autopilot: segValue(form, 'autopilot'), autopilotTimeoutSec: Math.round((Number(v('apTimeout')) || 3) * 60), git: readGit(form) });
      closeModal(); toast('Floor saved'); ctx.refresh();
    } catch (e) { fail(e); }
  };
}

const RESULT_TEXT = { merged: 'merged', refused: 'refused', failed: 'failed', noop: 'nothing to merge', busy: 'busy' };
async function loadMerges(floorId, el) {
  let m;
  try { m = await api('GET', `/api/floors/${floorId}/merges`); } catch (e) { el.textContent = e.message; return; }
  const p = m.policy;
  const policy = `${p.mergePolicy === 'auto' ? 'Automatic' : 'Manual'} ${p.mergeMethod === 'merge' ? 'merge commits' : 'squash merges'} into <code>${esc(p.mainBranch)}</code>`
    + `, gate ${p.qualityGate ? `<code>${esc(p.qualityGate)}</code>` : '<b>not set</b> (automatic merges need one)'}`
    + `, push: ${esc({ never: 'never', 'after-merge': 'after merge', 'agents-may-push': 'after merge' }[p.pushPolicy])}`
    + `. ${m.approval ? `Approved ${esc(new Date(m.approval.approvedAt).toLocaleString())}.` : 'Not approved on this machine yet.'}${m.running ? ' <b>A merge is running.</b>' : ''}`;
  const cands = m.candidates.map((c) => `<div class="row" style="margin-top:6px"><code class="grow ellipsis">${esc(c.branch)}</code>${c.lastResult ? `<span class="chip">${esc(RESULT_TEXT[c.lastResult])}</span>` : ''}<button type="button" class="small" data-merge="${esc(c.branch)}">Merge now</button></div>`).join('');
  const log = m.log.slice(0, 8).map((e) => `<li><b class="${e.result === 'merged' ? 'ok' : ''}">${esc(RESULT_TEXT[e.result] || e.result)}</b> <code>${esc(e.branch)}</code> · ${esc(new Date(e.ts).toLocaleString())} · ${esc(e.trigger)}${e.reason ? ` · ${esc(e.reason)}` : ''}${e.push ? ` · push ${e.push.ok ? 'ok' : 'failed'}` : ''}</li>`).join('');
  const sp = m.sprint;
  const CHECK = { branch: 'branch', release: 'RELEASE.md', closingCommit: 'closing commit', cleanTree: 'clean tree', qaPass: 'final QA PASS' };
  const sprintHtml = sp ? `<p>Sprint ${esc(sp.sprint)} (<code>${esc(sp.branch)}</code>): ${sp.closed ? '<b class="ok">closed</b>, ready for the server to merge' : 'open'} ·
    ${Object.entries(sp.checks).map(([k, ok]) => `${ok ? '✓' : '·'} ${CHECK[k]}`).join(', ')}${sp.autoNext ? ' · next sprint starts automatically' : ''}</p>` : '';
  el.innerHTML = `<p style="margin-top:0">${policy}</p>${sprintHtml}
    <b>Ready to merge</b>${cands || '<div class="empty">No unmerged branches for this branch strategy.</div>'}
    <b style="display:block;margin-top:10px">Last merges</b>${log ? `<ul style="padding-left:18px;margin:4px 0">${log}</ul>` : '<div class="empty">None yet.</div>'}`;
  el.querySelectorAll('[data-merge]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api('POST', `/api/floors/${floorId}/merges`, { branch: b.dataset.merge }); toast('Merge started; the result appears here and in Attention'); setTimeout(() => loadMerges(floorId, el), 3000); }
    catch (e) { toast(e.message); b.disabled = false; }
  });
}

async function templateDiff(el) {
  const d = await api('GET', `/api/floors/${floorId()}/agents/${el.dataset.agent}/diff`);
  const body = wire(openModal(frame(`Update ${esc(d.role)}: v${d.from} → v${d.to}`, `<p class="note" style="margin-top:12px">Changes in the Role Template. The agent's overrides are kept either way.</p>${diffHtml(d.diff)}`,
    '<button class="ghost" data-act-keep>Keep current</button><button class="gold" data-act-update>Update</button>')));
  body.querySelector('[data-act-update]').onclick = async () => { await templateAction(el.dataset.agent, 'update'); closeModal(); };
  body.querySelector('[data-act-keep]').onclick = async () => { await templateAction(el.dataset.agent, 'keep'); closeModal(); };
}

async function templateAction(agentId, action) {
  try {
    await api('POST', `/api/floors/${floorId()}/agents/${agentId}/template`, { action });
    toast({ update: 'Agent updated to the latest template', keep: 'Keeping the current version', detach: 'Agent detached from its template' }[action]);
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
  'tpl-detach': (el) => { if (confirm('Detach this agent? It becomes a standalone copy and no longer receives template updates.')) return templateAction(el.dataset.agent, 'detach'); },
  async 'remove-agent'(el) {
    const a = teamAgent(el.dataset.agent);
    if (!confirm(`Remove ${a?.displayName || 'this agent'} from the team? Its session is stopped and its generated agent file deleted.`)) return;
    await api('DELETE', `/api/floors/${floorId()}/agents/${el.dataset.agent}`);
    toast('Agent removed'); location.hash = `#/floor/${floorId()}`;
  },
});

// a newer Blueprint version (for example lessons applied from an audit): new snapshot, standard and agent files
ctx.actions['blueprint-update'] = async () => {
  const bp = ctx.state.floor?.blueprint;
  if (!bp || !confirm(`Update this Floor to ${bp.title} v${bp.latest}? AISQUAD.md and the agent files get the new standard; running agents read it on their next start.`)) return;
  const r = await api('POST', `/api/floors/${floorId()}/blueprint/update`);
  toast(`Blueprint updated to v${r.version}`);
  ctx.refresh();
};
