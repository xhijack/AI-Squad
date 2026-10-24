// Form pieces shared by the wizard and dialogs: team member + overrides editor, git settings.
import { esc, segHtml } from './lib.js';

export const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
export const commaList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const STYLES = ['bob', 'spiky', 'pony', 'buns', 'farmer'];
const MODELS = ['opus', 'sonnet', 'haiku', 'inherit'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// m: { displayName, template, lead, overrides, appearance }; templates from GET /api/roles
export function memberHtml(m, templates, { idx = 0, removable = true, templateLocked = false, showLead = true } = {}) {
  const t = templates.find((x) => x.role === m.template) || templates[0] || {};
  const o = m.overrides || {};
  const ap = { ...(t.appearance || {}), ...(m.appearance || {}) };
  const rm = new Set(o.skills?.remove || []);
  return `<div class="memberRow" data-member="${idx}">
    <div class="row wrap">
      <div class="grow" style="min-width:180px"><label>Display name</label><input data-f="displayName" value="${esc(m.displayName || '')}" placeholder="Ramdani - ${esc(t.title || 'Developer')}" maxlength="60" required></div>
      <div class="grow" style="min-width:160px"><label>Role Template</label>
        <select data-f="template" ${templateLocked ? 'disabled' : ''}>${templates.map((x) => `<option value="${esc(x.role)}" ${x.role === t.role ? 'selected' : ''}>${esc(x.title)} (v${x.version})</option>`).join('')}</select></div>
      ${removable ? `<button type="button" class="ghost danger small" data-rm-member="${idx}" style="margin-top:28px" aria-label="Remove member">Remove</button>` : ''}
    </div>
    ${showLead ? `<label class="inline"><input type="checkbox" data-f="lead" ${m.lead ? 'checked' : ''}> Team lead</label>` : ''}
    <details ${Object.keys(o).length ? 'open' : ''}><summary>Overrides (template: ${esc(t.model)}, effort ${esc(t.effort)}, ${(t.skills || []).length} skills)</summary>
      <div class="grid2">
        <div><label>Model</label><select data-f="model"><option value="">Template (${esc(t.model)})</option>${MODELS.map((x) => `<option ${o.model === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div><label>Effort</label><select data-f="effort"><option value="">Template (${esc(t.effort)})</option>${EFFORTS.map((x) => `<option ${o.effort === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      </div>
      <label>Add skills (comma separated)</label><input data-f="skillsAdd" value="${esc((o.skills?.add || []).join(', '))}" placeholder="playwright, frappe">
      ${(t.skills || []).length ? `<label>Template skills (uncheck to remove)</label><div class="row wrap">${t.skills.map((s) => `<label class="inline"><input type="checkbox" data-skill="${esc(s)}" ${rm.has(s) ? '' : 'checked'}> ${esc(s)}</label>`).join('')}</div>` : ''}
      <label>Extra rules (one per line, added to the template rules)</label><textarea data-f="rules" rows="2">${esc((o.rules || []).join('\n'))}</textarea>
      <label>Extra denied tools (one per line; overrides can only be stricter)</label><textarea data-f="deny" rows="2" placeholder="Bash(npm publish*)">${esc((o.permissions?.deny || []).join('\n'))}</textarea>
      <label>Prompt addition (appended below the template prompt)</label><textarea data-f="prompt" rows="3">${esc(o.prompt || '')}</textarea>
    </details>
    <details ${m.git ? 'open' : ''}><summary>Commit identity (used when the Floor commits per agent)</summary>
      <div class="grid2"><div><label>Name</label><input data-f="gitName" value="${esc(m.git?.name || '')}" placeholder="${esc(m.displayName || 'Display name')}"></div>
        <div><label>Email</label><input data-f="gitEmail" value="${esc(m.git?.email || '')}" placeholder="from the Floor's agent email template"></div></div>
    </details>
    <details><summary>Appearance</summary>
      <div class="row wrap"><select data-f="style" style="width:auto">${STYLES.map((x) => `<option ${ap.style === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <label class="inline">Shirt <input type="color" data-f="shirt" value="${esc(ap.shirt || '#3d82d6')}"></label>
        <label class="inline">Hair <input type="color" data-f="hair" value="${esc(ap.hair || '#2b2440')}"></label>
        <label class="inline">Skin <input type="color" data-f="skin" value="${esc(ap.skin || '#f6d2b0')}"></label>
        <label class="inline"><input type="checkbox" data-f="glasses" ${ap.glasses ? 'checked' : ''}> Glasses</label></div>
    </details></div>`;
}

export function readMember(el) {
  const v = (f) => el.querySelector(`[data-f="${f}"]`);
  const removeSkills = [...el.querySelectorAll('[data-skill]')].filter((c) => !c.checked).map((c) => c.dataset.skill);
  const overrides = {};
  if (v('model').value) overrides.model = v('model').value;
  if (v('effort').value) overrides.effort = v('effort').value;
  const add = commaList(v('skillsAdd').value);
  if (add.length || removeSkills.length) overrides.skills = { add, remove: removeSkills };
  if (lines(v('rules').value).length) overrides.rules = lines(v('rules').value);
  if (lines(v('deny').value).length) overrides.permissions = { deny: lines(v('deny').value) };
  if (v('prompt').value.trim()) overrides.prompt = v('prompt').value.trim();
  return {
    displayName: v('displayName').value.trim(), template: v('template').value, lead: !!v('lead')?.checked, overrides,
    git: { name: v('gitName').value.trim(), email: v('gitEmail').value.trim() },
    appearance: { style: v('style').value, shirt: v('shirt').value, hair: v('hair').value, skin: v('skin').value, glasses: v('glasses').checked },
  };
}

export const BRANCH_TEXT = { 'agent-branches': 'Branch per agent', 'feature-branches': 'Feature branches', trunk: 'Trunk (main)' };
export const PUSH_TEXT = { never: 'Never push', 'after-merge': 'Server pushes after merge', 'agents-may-push': 'Agents may push' };

export function gitHtml(g = {}, { approved = false } = {}) {
  return `<div class="grid2">
      <div><label>Remote (optional)</label><input data-g="remote" value="${esc(g.remote || '')}" placeholder="git@github.com:org/repo.git"></div>
      <div><label>Main branch</label><input data-g="mainBranch" value="${esc(g.mainBranch || 'main')}"></div>
    </div>
    <label>Branch strategy</label>${segHtml('branchStrategy', Object.entries(BRANCH_TEXT), g.branchStrategy || 'agent-branches')}
    <label>Commit identity</label>${segHtml('commitIdentity', [['repo-default', 'Repository default'], ['per-agent', 'Per agent name']], g.commitIdentity || 'repo-default')}
    <label>Agent commit email (per agent identity; <code>{id}</code> is the agent id)</label><input data-g="agentEmail" value="${esc(g.agentEmail || '{id}@agents.aisquad.local')}">
    <label class="inline"><input type="checkbox" data-g="noAiAttribution" ${g.noAiAttribution !== false ? 'checked' : ''}> No AI attribution in commits and PRs</label>
    <label>Push policy</label>${segHtml('pushPolicy', Object.entries(PUSH_TEXT), g.pushPolicy || 'never')}
    <label>Merge policy</label>${segHtml('mergePolicy', [['auto', 'Automatic (after quality gate)'], ['manual', 'Manual']], g.mergePolicy || 'auto')}
    <label>Merge method</label>${segHtml('mergeMethod', [['squash', 'Squash'], ['merge', 'Merge commit']], g.mergeMethod || 'squash')}
    <label class="inline"><input type="checkbox" data-g="autoMergeApproved" ${approved ? 'checked' : ''}> I approve automatic merges on this Floor (done by the server, never by an agent; stored on this machine, not in the repo)</label>
    <label>Quality gate command</label><input data-g="qualityGate" value="${esc(g.qualityGate || '')}" placeholder="npm test">
    <p class="note">Finished work is merged in a temporary worktree: the quality gate runs on the merged result, and conflicts or a red gate stop the merge and show up in Attention.</p>`;
}

export function readGit(root) {
  const v = (k) => root.querySelector(`[data-g="${k}"]`);
  const seg = (k) => root.querySelector(`[data-seg="${k}"] [aria-pressed=true]`)?.dataset.v;
  return { remote: v('remote').value.trim(), mainBranch: v('mainBranch').value.trim() || 'main', branchStrategy: seg('branchStrategy'), commitIdentity: seg('commitIdentity'), agentEmail: v('agentEmail').value.trim(),
    noAiAttribution: v('noAiAttribution').checked, pushPolicy: seg('pushPolicy'), mergePolicy: seg('mergePolicy'), mergeMethod: seg('mergeMethod'), autoMergeApproved: v('autoMergeApproved').checked, qualityGate: v('qualityGate').value.trim() };
}
