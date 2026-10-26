// Set up Squad wizard: What do you want to build? → Team → Folder → Review and create.
// The recommendation comes from Claude Code (haiku) with a keyword fallback; the owner edits the team freely.
import { esc, api, toast, openModal, closeModal, segHtml, bindSegs } from './lib.js';
import { ctx } from './ctx.js';

const STEPS = ['What', 'Team', 'Folder', 'Review'];
const CATEGORY = { software: 'Software', marketing: 'Marketing', sales: 'Sales', general: 'General' };
const kebab = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let s = null;

ctx.actions['setup-squad'] = async () => {
  const [{ blueprints, squadsDir, nextFloorNumber }, { templates }] = await Promise.all([api('GET', '/api/blueprints'), api('GET', '/api/catalog')]);
  const order = ['software-house', 'digital-marketing', 'sales-crm'];
  blueprints.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  s = { step: 0, blueprints, templates, squadsDir, number: nextFloorNumber, autopilot: 'balanced', prompt: '', blueprint: '', rec: null, team: [], name: '', goal: '',
    dirMode: 'new', path: '', pathTouched: false, startLead: true, installSkills: true, catalog: false, filter: { category: '', skill: '' }, busy: false };
  draw();
};

const bpOf = () => s.blueprints.find((b) => b.id === s.blueprint);
const tplOf = (role) => s.templates.find((t) => t.role === role) || { title: role, skills: [], model: '?' };

function whatHtml() {
  return `<label for="ssPrompt">What do you want to build?</label>
    <textarea id="ssPrompt" rows="4" placeholder="I want a software house that builds my restaurant POS">${esc(s.prompt)}</textarea>
    <p class="note">Describe it in your own words, or pick a Blueprint. The AI Squad recommends a team <b>and how that team communicates</b>: a Blueprint is the squad's standard for roles, source documents, channels, gates and the definition of done.</p>
    <div class="choice bpCards" data-choice="blueprint">${s.blueprints.map((b) => `<button type="button" data-v="${b.id}" aria-pressed="${s.blueprint === b.id}">
      <b>${esc(b.title)}</b><small>${esc(b.description)}</small><small class="note">${b.roles.map((r) => `${esc(tplOf(r.template).title)}${r.max > 1 ? ` ×${r.min}-${r.max}` : ''}${r.lead ? ' (lead)' : ''}`).join(' · ')}</small></button>`).join('')}</div>`;
}

function memberCard(m, i) {
  const t = tplOf(m.template);
  return `<div class="card memberCard"><div class="row"><input data-name="${i}" value="${esc(m.displayName)}" maxlength="60" aria-label="Display name" class="grow">
      <label class="inline" style="margin:0"><input type="radio" name="ssLead" data-lead="${i}" ${m.lead ? 'checked' : ''}> Lead</label>
      <button type="button" class="small ghost danger" data-rm="${i}" aria-label="Remove ${esc(m.displayName)}">Remove</button></div>
    <div class="chips"><span class="chip">${esc(t.title)}</span><span class="chip">${esc(t.model)}</span>${(t.skills || []).map((k) => `<span class="pill">${esc(k)}</span>`).join('')}</div>
    ${m.reason ? `<div class="note" style="margin-top:6px"><b>Why:</b> ${esc(m.reason)}</div>` : ''}</div>`;
}

function catalogHtml() {
  const f = s.filter, q = f.skill.trim().toLowerCase();
  const list = s.templates.filter((t) => (!f.category || t.category === f.category) && (!q || t.skills.some((k) => k.includes(q)) || t.title.toLowerCase().includes(q)));
  return `<div class="card"><div class="row wrap"><b class="grow">Add agent from the catalog</b><button type="button" class="small ghost" data-catalog="close">Done</button></div>
    <div class="row wrap" style="margin-top:8px">${segHtml('category', [['', 'All'], ...Object.entries(CATEGORY)], f.category)}<input id="ssSkill" placeholder="Filter by skill, e.g. tdd" value="${esc(f.skill)}" style="max-width:220px"></div>
    <div class="catalog">${list.map((t) => `<div class="card"><div class="row"><b class="grow">${esc(t.title)}</b><span class="chip">${esc(t.model)}</span><button type="button" class="small gold" data-add="${esc(t.role)}">Add</button></div>
      <div class="note">${esc(t.description)}</div><div class="chips">${t.skills.map((k) => `<span class="pill">${esc(k)}</span>`).join('') || '<span class="note">no skills listed</span>'}</div></div>`).join('') || '<div class="empty">No Role Template matches.</div>'}</div></div>`;
}

function teamHtml() {
  const r = s.rec, bp = bpOf();
  const src = r?.source === 'claude' ? 'Recommended by Claude Code (haiku).' : r?.source === 'keywords' ? `Recommended by keyword match (Claude Code was not available). ${esc(r.note)}` : 'The Blueprint\'s default team.';
  return `<div class="card" style="margin-top:12px"><div class="row"><b class="grow">${esc(bp.title)} v${bp.version}</b><span class="note">${src}</span></div>
      <div class="grid2"><div><label for="ssName">Squad name</label><input id="ssName" value="${esc(s.name)}" maxlength="60"></div>
      <div><label>Workflow</label><div class="note" style="margin-top:8px">${bp.workflow === 'squad-sprint' ? 'Squad Sprint (lead, board, QA gate)' : 'Free Team led by the lead'}</div></div></div>
      <label for="ssGoal">Goal (written to AISQUAD.md)</label><textarea id="ssGoal" rows="3">${esc(s.goal)}</textarea></div>
    <div class="sectionHead" style="margin-top:12px"><h3 class="grow">Team · ${s.team.length} agent${s.team.length === 1 ? '' : 's'}</h3><button type="button" class="small gold" data-catalog="open">+ Add agent</button></div>
    ${s.catalog ? catalogHtml() : ''}
    ${s.team.map(memberCard).join('') || '<div class="empty">No agents yet. Add them from the catalog.</div>'}`;
}

function suggestPath() { if (!s.pathTouched) s.path = `${s.squadsDir.replace(/\/$/, '')}/${kebab(s.name) || s.blueprint}`; }

function folderHtml() {
  return `<p class="note" style="margin-top:12px">One squad = one project folder. Its Floor files, agent files and the Blueprint's documents go into this folder.</p>
    ${segHtml('dirMode', [['new', 'Create a new folder (git init)'], ['existing', 'Use an existing repository']], s.dirMode)}
    <label for="ssPath">${s.dirMode === 'new' ? 'New folder (absolute path; must not exist yet or be empty)' : 'Repository folder (absolute path)'}</label>
    <input id="ssPath" value="${esc(s.path)}" spellcheck="false" placeholder="/home/you/projects/restaurant-pos">
    ${s.dirMode === 'new' ? `<p class="note">New squads go to <code>${esc(s.squadsDir)}</code> by default (a setting in <code>~/.aisquad/building.json</code>). <button type="button" class="small ghost" data-squadsdir>Change the default</button></p>` : ''}`;
}

const AUTOPILOT = [['balanced', 'Balanced (recommended)'], ['full', 'Full'], ['off', 'Off']];
function reviewHtml() {
  const bp = bpOf(), lead = s.team.find((m) => m.lead);
  return `<div class="card" style="margin-top:12px"><dl class="kv">
      <dt>Floor</dt><dd>${s.number} <span class="note">(next free Floor; Floor 1 is for independent agents)</span></dd>
      <dt>Squad</dt><dd>${esc(s.name)}</dd><dt>Blueprint</dt><dd>${esc(bp.title)} v${bp.version}</dd>
      <dt>Folder</dt><dd><code>${esc(s.path)}</code> <span class="note">(${s.dirMode === 'new' ? 'new, git init' : 'existing'})</span></dd>
      <dt>Lead</dt><dd>${esc(lead?.displayName || '')}</dd>
      <dt>Team</dt><dd>${s.team.map((m) => `${esc(m.displayName)} <span class="note">(${esc(tplOf(m.template).title)})</span>`).join(', ')}</dd></dl></div>
    <p class="note">Creates the Floor files in <code>.claude/aisquad/</code>, an agent file per member in <code>.claude/agents/</code>, <code>AISQUAD.md</code> with the goal, the team and the Blueprint's communication standard, and the Blueprint's workflow pack.</p>
    <label class="inline"><input type="checkbox" id="ssSkills" ${s.installSkills ? 'checked' : ''}> Install the team's skills into <code>.claude/skills/</code> (${[...new Set(s.team.flatMap((m) => tplOf(m.template).skills || []))].length} skills)</label>
    <label class="inline"><input type="checkbox" id="ssStart" ${s.startLead ? 'checked' : ''}> Start the lead after creating (it asks you for the source documents first)</label>
    <label for="ssAutopilot">Autopilot</label><select id="ssAutopilot">${AUTOPILOT.map(([k, t]) => `<option value="${k}" ${s.autopilot === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <p class="note">${esc(ctx.state.building?.options?.autopilot?.text?.[s.autopilot] || '')} Critical items (money, legal, production, deleting data, scope) always wait for you.</p>`;
}

function draw(error = '') {
  const last = s.step === STEPS.length - 1;
  const html = [whatHtml, teamHtml, folderHtml, reviewHtml][s.step]();
  const body = openModal(`<div class="mHead"><h3 class="grow">Set up Squad</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <div class="steps">${STEPS.map((x, i) => `<span class="${i === s.step ? 'on' : i < s.step ? 'done' : ''}">${i + 1}. ${x}</span>`).join('')}</div>
    <form class="mBody" id="ssForm" novalidate>${html}</form>
    <div class="mFoot"><div class="err grow" id="ssErr">${esc(error)}</div>${s.step ? '<button class="ghost" data-back>Back</button>' : ''}
      <button class="gold" data-next ${s.busy ? 'disabled' : ''}>${s.busy ? (s.step === 0 ? 'Asking Claude Code…' : 'Creating…') : s.step === 0 ? 'Recommend a team' : last ? 'Create squad' : 'Next'}</button></div>`);
  body.querySelector('[data-close]').onclick = () => closeModal();
  body.querySelector('[data-back]')?.addEventListener('click', () => { collect(); s.step--; draw(); });
  body.querySelector('[data-next]').onclick = () => next();
  body.querySelector('#ssForm').addEventListener('submit', (e) => { e.preventDefault(); });
  body.querySelectorAll('[data-choice] button').forEach((b) => b.addEventListener('click', () => { collect(); s.blueprint = s.blueprint === b.dataset.v ? '' : b.dataset.v; draw(); }));
  bindSegs(body, (name, v) => { collect(); if (name === 'category') s.filter.category = v; if (name === 'dirMode') { s.dirMode = v; s.pathTouched = false; if (v === 'new') suggestPath(); else s.path = ''; } draw(); });
  body.querySelector('#ssSkill')?.addEventListener('input', (e) => { s.filter.skill = e.target.value; const pos = e.target.selectionStart; collect(); draw(); const el = document.getElementById('ssSkill'); el.focus(); el.setSelectionRange(pos, pos); });
  body.querySelectorAll('[data-catalog]').forEach((b) => b.addEventListener('click', () => { collect(); s.catalog = b.dataset.catalog === 'open'; draw(); }));
  body.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    collect();
    const t = tplOf(b.dataset.add), same = s.team.filter((m) => m.template === t.role).length;
    s.team.push({ template: t.role, displayName: same ? `${t.title} ${same + 1}` : t.title, lead: !s.team.length, reason: '' });
    toast(`${t.title} added`);
    draw();
  }));
  body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { collect(); const [m] = s.team.splice(+b.dataset.rm, 1); if (m.lead && s.team[0]) s.team[0].lead = true; draw(); }));
  body.querySelector('#ssPath')?.addEventListener('input', () => { s.pathTouched = true; });
  body.querySelector('[data-squadsdir]')?.addEventListener('click', async () => {
    const dir = prompt('Default folder for new squads (absolute path)', s.squadsDir);
    if (!dir) return;
    try { await api('PATCH', '/api/building', { squadsDir: dir }); s.squadsDir = dir; suggestPath(); draw(); } catch (e) { draw(e.message); }
  });
  (body.querySelector('#ssPrompt') || body.querySelector('#ssName'))?.focus();
}

function collect() {
  const v = (id) => document.getElementById(id);
  if (s.step === 0) s.prompt = v('ssPrompt').value.trim();
  if (s.step === 1) {
    s.name = v('ssName').value.trim(); s.goal = v('ssGoal').value.trim();
    document.querySelectorAll('[data-name]').forEach((el) => { s.team[+el.dataset.name].displayName = el.value.trim(); });
    const lead = document.querySelector('[data-lead]:checked');
    if (lead) s.team.forEach((m, i) => { m.lead = i === +lead.dataset.lead; });
  }
  if (s.step === 2) s.path = v('ssPath').value.trim();
  if (s.step === 3) { s.startLead = v('ssStart').checked; s.installSkills = v('ssSkills').checked; s.autopilot = v('ssAutopilot').value; }
}

async function next() {
  collect();
  if (s.step === 0) {
    if (!s.prompt && !s.blueprint) return draw('Describe what you want to build, or pick a Blueprint.');
    s.busy = true; draw();
    try {
      const r = await api('POST', '/api/squads/recommend', { prompt: s.prompt, blueprint: s.blueprint });
      Object.assign(s, { rec: r, blueprint: r.blueprint, team: r.team, name: r.name, goal: r.goal, step: 1, busy: false, catalog: false });
      suggestPath();
      return draw();
    } catch (e) { s.busy = false; return draw(e.message); }
  }
  if (s.step === 1) {
    if (!s.name) return draw('Give the squad a name.');
    if (!s.team.length) return draw('Add at least one agent.');
    if (s.team.some((m) => !m.displayName)) return draw('Every agent needs a display name.');
    suggestPath();
  }
  if (s.step === 2 && !s.path.startsWith('/')) return draw('The folder must be an absolute path (starting with /).');
  if (s.step < STEPS.length - 1) { s.step++; return draw(); }
  s.busy = true; draw();
  try {
    const r = await api('POST', '/api/squads', { blueprint: s.blueprint, name: s.name, goal: s.goal, team: s.team, directory: { mode: s.dirMode, path: s.path }, startLead: s.startLead, installSkills: s.installSkills, autopilot: s.autopilot });
    closeModal();
    toast(`Floor ${r.number} created${r.leadStarted ? '; the lead is starting' : r.leadError ? `; the lead did not start: ${r.leadError}` : ''}`, 5000);
    location.hash = r.lead ? `#/floor/${r.id}/desk/${r.lead}` : `#/floor/${r.id}`;
    ctx.refresh();
  } catch (e) { s.busy = false; draw(e.message); }
}
