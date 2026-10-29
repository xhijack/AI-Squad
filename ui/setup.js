// SPDX-License-Identifier: Apache-2.0
// Set up Squad wizard: What do you want to build? → Team → Folder → Review and create.
// The recommendation comes from Claude Code (haiku) with a keyword fallback; the owner edits the team freely.
import { esc, api, toast, openModal, closeModal, segHtml, bindSegs } from './lib.js';
import { ctx } from './ctx.js';
import { t as tt, tx } from './i18n.js';

const STEPS = [tt('What'), tt('Team'), tt('Folder'), tt('Review')];
const CATEGORY = { software: tt('Software'), marketing: tt('Marketing'), sales: tt('Sales'), general: tt('General') };
const kebab = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let s = null;

ctx.actions['setup-squad'] = async () => {
  const [{ blueprints, squadsDir, nextFloorNumber }, { templates }] = await Promise.all([api('GET', '/api/blueprints'), api('GET', '/api/catalog')]);
  const order = ['software-house', 'digital-marketing', 'sales-crm'];
  blueprints.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  s = { step: 0, blueprints, templates, squadsDir, number: nextFloorNumber, autopilot: 'balanced', prompt: '', blueprint: '', rec: null, team: [], name: '', goal: '',
    dirMode: 'new', path: '', pathTouched: false, repos: [], startLead: true, installSkills: true, catalog: false, filter: { category: '', skill: '' }, busy: false };
  draw();
};

const bpOf = () => s.blueprints.find((b) => b.id === s.blueprint);
const tplOf = (role) => s.templates.find((t) => t.role === role) || { title: role, skills: [], model: '?' };

function whatHtml() {
  return `<label for="ssPrompt">${tt('What do you want to build?')}</label>
    <textarea id="ssPrompt" rows="4" placeholder="${esc(tt('I want a software house that builds my restaurant POS'))}">${esc(s.prompt)}</textarea>
    <p class="note">${tt('Describe it in your own words, or pick a Blueprint. The AI Squad recommends a team <b>and how that team communicates</b>: a Blueprint is the squad\'s standard for roles, source documents, channels, gates and the definition of done.')}</p>
    <div class="choice bpCards" data-choice="blueprint">${s.blueprints.map((b) => `<button type="button" data-v="${b.id}" aria-pressed="${s.blueprint === b.id}">
      <b>${esc(b.title)}</b><small>${esc(b.description)}</small><small class="note">${b.roles.map((r) => `${esc(tplOf(r.template).title)}${r.max > 1 ? ` ×${r.min}-${r.max}` : ''}${r.lead ? ` ${tt('(lead)')}` : ''}`).join(' · ')}</small></button>`).join('')}</div>`;
}

function memberCard(m, i) {
  const t = tplOf(m.template);
  return `<div class="card memberCard"><div class="row"><input data-name="${i}" value="${esc(m.displayName)}" maxlength="60" aria-label="${tt('Display name')}" class="grow">
      <label class="inline" style="margin:0"><input type="radio" name="ssLead" data-lead="${i}" ${m.lead ? 'checked' : ''}> ${tt('Lead')}</label>
      <button type="button" class="small ghost danger" data-rm="${i}" aria-label="${tt('Remove {name}', { name: esc(m.displayName) })}">${tt('Remove')}</button></div>
    <div class="chips"><span class="chip">${esc(t.title)}</span><span class="chip">${esc(t.model)}</span>${(t.skills || []).map((k) => `<span class="pill">${esc(k)}</span>`).join('')}</div>
    ${m.reason ? `<div class="note" style="margin-top:var(--sp-2)"><b>${tt('Why:')}</b> ${esc(m.reason)}</div>` : ''}</div>`;
}

function catalogHtml() {
  const f = s.filter, q = f.skill.trim().toLowerCase();
  const list = s.templates.filter((t) => (!f.category || t.category === f.category) && (!q || t.skills.some((k) => k.includes(q)) || t.title.toLowerCase().includes(q)));
  return `<div class="card"><div class="row wrap"><b class="grow">${tt('Add agent from the catalog')}</b><button type="button" class="small ghost" data-catalog="close">${tt('Done')}</button></div>
    <div class="row wrap" style="margin-top:var(--sp-2)">${segHtml('category', [['', tt('All')], ...Object.entries(CATEGORY)], f.category)}<input id="ssSkill" placeholder="${esc(tt('Filter by skill, e.g. tdd'))}" value="${esc(f.skill)}" style="max-width:220px"></div>
    <div class="catalog">${list.map((t) => `<div class="card"><div class="row"><b class="grow">${esc(t.title)}</b><span class="chip">${esc(t.model)}</span><button type="button" class="small gold" data-add="${esc(t.role)}">${tt('Add')}</button></div>
      <div class="note">${esc(t.description)}</div><div class="chips">${t.skills.map((k) => `<span class="pill">${esc(k)}</span>`).join('') || `<span class="note">${tt('no skills listed')}</span>`}</div></div>`).join('') || `<div class="empty">${tt('No Role Template matches.')}</div>`}</div></div>`;
}

function teamHtml() {
  const r = s.rec, bp = bpOf();
  const src = r?.source === 'claude' ? tt('Recommended by Claude Code (haiku).') : r?.source === 'keywords' ? `${tt('Recommended by keyword match (Claude Code was not available).')} ${esc(tx(r.note))}` : tt('The Blueprint\'s default team.');
  return `<div class="card" style="margin-top:var(--sp-3)"><div class="row"><b class="grow">${esc(bp.title)} v${bp.version}</b><span class="note">${src}</span></div>
      <div class="grid2"><div><label for="ssName">${tt('Squad name')}</label><input id="ssName" value="${esc(s.name)}" maxlength="60"></div>
      <div><label>${tt('Workflow')}</label><div class="note" style="margin-top:var(--sp-2)">${bp.workflow === 'squad-sprint' ? tt('Squad Sprint (lead, board, QA gate)') : tt('Free Team led by the lead')}</div></div></div>
      <label for="ssGoal">${tt('Goal (written to AISQUAD.md)')}</label><textarea id="ssGoal" rows="3">${esc(s.goal)}</textarea></div>
    <div class="sectionHead" style="margin-top:var(--sp-3)"><h3 class="grow">${s.team.length === 1 ? tt('Team · {n} agent', { n: 1 }) : tt('Team · {n} agents', { n: s.team.length })}</h3><button type="button" class="small gold" data-catalog="open">${tt('+ Add agent')}</button></div>
    ${s.catalog ? catalogHtml() : ''}
    ${s.team.map(memberCard).join('') || `<div class="empty">${tt('No agents yet. Add them from the catalog.')}</div>`}`;
}

function suggestPath() { if (!s.pathTouched) s.path = `${s.squadsDir.replace(/\/$/, '')}/${kebab(s.name) || s.blueprint}`; }

function folderHtml() {
  return `<p class="note" style="margin-top:var(--sp-3)">${tt('One squad = one project folder. Its Floor files, agent files and the Blueprint\'s documents go into this folder.')}</p>
    ${segHtml('dirMode', [['new', tt('Create a new folder (git init)')], ['existing', tt('Use an existing repository')]], s.dirMode)}
    <label for="ssPath">${s.dirMode === 'new' ? tt('New folder (absolute path; must not exist yet or be empty)') : tt('Repository folder (absolute path)')}</label>
    <input id="ssPath" value="${esc(s.path)}" spellcheck="false" placeholder="/home/you/projects/restaurant-pos">
    ${s.dirMode === 'new' ? `<p class="note">${tt('New squads go to <code>{dir}</code> by default (a setting in <code>~/.aisquad/building.json</code>).', { dir: esc(s.squadsDir) })} <button type="button" class="small ghost" data-squadsdir>${tt('Change the default')}</button></p>` : ''}
    <div class="sectionHead" style="margin-top:var(--sp-4)"><h3 class="grow">${tt('Linked repositories')}</h3><button type="button" class="small" data-addrepo>${tt('+ Add linked repository')}</button></div>
    <p class="note">${tt('This folder is the primary repository (the Floor, the board, the docs). A squad can also read or write other repositories: a path on this machine or a clone URL.')}</p>
    ${s.repos.map((r, i) => `<div class="card" data-repoi="${i}"><div class="grid2"><div><label>${tt('Path or clone URL')}</label><input data-rk="where" value="${esc(r.where)}" placeholder="../dtamu-landing-page"></div>
      <div><label>${tt('Access')}</label><select data-rk="access"><option value="read" ${r.access !== 'write' ? 'selected' : ''}>${tt('Read only (context)')}</option><option value="write" ${r.access === 'write' ? 'selected' : ''}>${tt('Write (its agents commit there)')}</option></select></div></div>
      <label>${tt('Agents')}</label><div class="row wrap">${s.team.map((m, k) => `<label class="inline" style="margin:0 var(--sp-3) 0 0"><input type="checkbox" data-rteam="${k}" ${r.team.includes(k) ? 'checked' : ''}> ${esc(String(m.displayName).split(' - ')[0])}</label>`).join('')}</div>
      <div class="row"><span class="grow"></span><button type="button" class="small ghost danger" data-rmrepo="${i}">${tt('Remove')}</button></div></div>`).join('')}`;
}
// a linked repository from the Folder step -> repos.json entry (path relative to the squad folder; a URL is cloned
// next to it); team indexes become agent ids once the Floor exists
const isUrl = (w) => /^(https:\/\/|ssh:\/\/|git@)/.test(w);
function relative(from, to) {
  const a = from.split('/').filter(Boolean), b = to.split('/').filter(Boolean);
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
}
function repoEntry(r, ids) {
  const where = r.where.trim(), name = (isUrl(where) ? where.replace(/\.git$/, '').split(/[/:]/).pop() : where.replace(/\/$/, '').split('/').pop()) || 'repo';
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'repo';
  return { id, path: isUrl(where) ? `../${name}` : where.startsWith('/') ? relative(s.path, where) : where, ...(isUrl(where) ? { remote: where } : {}), access: r.access, agents: r.team.map((k) => ids[k]).filter(Boolean) };
}

const AUTOPILOT = [['balanced', tt('Balanced (recommended)')], ['full', tt('Full')], ['off', tt('Off')]];
function reviewHtml() {
  const bp = bpOf(), lead = s.team.find((m) => m.lead);
  return `<div class="card" style="margin-top:var(--sp-3)"><dl class="kv">
      <dt>${tt('Floor')}</dt><dd>${s.number} <span class="note">${tt('(next free Floor; Floor 1 is for independent agents)')}</span></dd>
      <dt>${tt('Squad')}</dt><dd>${esc(s.name)}</dd><dt>Blueprint</dt><dd>${esc(bp.title)} v${bp.version}</dd>
      <dt>${tt('Folder')}</dt><dd><code>${esc(s.path)}</code> <span class="note">(${s.dirMode === 'new' ? tt('new, git init') : tt('existing')})</span></dd>
      <dt>${tt('Lead')}</dt><dd>${esc(lead?.displayName || '')}</dd>
      <dt>${tt('Team')}</dt><dd>${s.team.map((m) => `${esc(m.displayName)} <span class="note">(${esc(tplOf(m.template).title)})</span>`).join(', ')}</dd></dl></div>
    <p class="note">${tt('Creates the Floor files in <code>.claude/aisquad/</code>, an agent file per member in <code>.claude/agents/</code>, <code>AISQUAD.md</code> with the goal, the team and the Blueprint\'s communication standard, and the Blueprint\'s workflow pack.')}</p>
    <label class="inline"><input type="checkbox" id="ssSkills" ${s.installSkills ? 'checked' : ''}> ${tt('Install the team\'s skills into <code>.claude/skills/</code> ({n} skills)', { n: [...new Set(s.team.flatMap((m) => tplOf(m.template).skills || []))].length })}</label>
    <label class="inline"><input type="checkbox" id="ssStart" ${s.startLead ? 'checked' : ''}> ${tt('Start the lead after creating (it asks you for the source documents first)')}</label>
    <label for="ssAutopilot">Autopilot</label><select id="ssAutopilot">${AUTOPILOT.map(([k, t]) => `<option value="${k}" ${s.autopilot === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <p class="note">${esc(tx(ctx.state.building?.options?.autopilot?.text?.[s.autopilot] || ''))} ${tt('Critical items (money, legal, production, deleting data, scope) always wait for you.')}</p>`;
}

function draw(error = '') {
  const last = s.step === STEPS.length - 1;
  const html = [whatHtml, teamHtml, folderHtml, reviewHtml][s.step]();
  const body = openModal(`<div class="mHead"><h3 class="grow">${tt('Set up Squad')}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
    <div class="steps">${STEPS.map((x, i) => `<span class="${i === s.step ? 'on' : i < s.step ? 'done' : ''}">${i + 1}. ${x}</span>`).join('')}</div>
    <form class="mBody" id="ssForm" novalidate>${html}</form>
    <div class="mFoot"><div class="err grow" id="ssErr">${esc(error)}</div>${s.step ? `<button class="ghost" data-back>${tt('Back')}</button>` : ''}
      <button class="gold" data-next ${s.busy ? 'disabled' : ''}>${s.busy ? (s.step === 0 ? tt('Asking Claude Code…') : tt('Creating…')) : s.step === 0 ? tt('Recommend a team') : last ? tt('Create squad') : tt('Next')}</button></div>`);
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
    toast(tt('{name} added', { name: t.title }));
    draw();
  }));
  body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { collect(); const [m] = s.team.splice(+b.dataset.rm, 1); if (m.lead && s.team[0]) s.team[0].lead = true; draw(); }));
  body.querySelector('#ssPath')?.addEventListener('input', () => { s.pathTouched = true; });
  body.querySelector('[data-addrepo]')?.addEventListener('click', () => { collect(); s.repos.push({ where: '', access: 'read', team: [] }); draw(); });
  body.querySelectorAll('[data-rmrepo]').forEach((b) => b.addEventListener('click', () => { collect(); s.repos.splice(+b.dataset.rmrepo, 1); draw(); }));
  body.querySelector('[data-squadsdir]')?.addEventListener('click', async () => {
    const dir = prompt(tt('Default folder for new squads (absolute path)'), s.squadsDir);
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
  if (s.step === 2) {
    s.path = v('ssPath').value.trim();
    document.querySelectorAll('[data-repoi]').forEach((el) => { const r = s.repos[+el.dataset.repoi]; r.where = el.querySelector('[data-rk=where]').value.trim(); r.access = el.querySelector('[data-rk=access]').value; r.team = [...el.querySelectorAll('[data-rteam]:checked')].map((x) => +x.dataset.rteam); });
  }
  if (s.step === 3) { s.startLead = v('ssStart').checked; s.installSkills = v('ssSkills').checked; s.autopilot = v('ssAutopilot').value; }
}

async function next() {
  collect();
  if (s.step === 0) {
    if (!s.prompt && !s.blueprint) return draw(tt('Describe what you want to build, or pick a Blueprint.'));
    s.busy = true; draw();
    try {
      const r = await api('POST', '/api/squads/recommend', { prompt: s.prompt, blueprint: s.blueprint });
      Object.assign(s, { rec: r, blueprint: r.blueprint, team: r.team, name: r.name, goal: r.goal, step: 1, busy: false, catalog: false });
      suggestPath();
      return draw();
    } catch (e) { s.busy = false; return draw(e.message); }
  }
  if (s.step === 1) {
    if (!s.name) return draw(tt('Give the squad a name.'));
    if (!s.team.length) return draw(tt('Add at least one agent.'));
    if (s.team.some((m) => !m.displayName)) return draw(tt('Every agent needs a display name.'));
    suggestPath();
  }
  if (s.step === 2 && !s.path.startsWith('/')) return draw(tt('The folder must be an absolute path (starting with /).'));
  if (s.step < STEPS.length - 1) { s.step++; return draw(); }
  s.busy = true; draw();
  try {
    const r = await api('POST', '/api/squads', { blueprint: s.blueprint, name: s.name, goal: s.goal, team: s.team, directory: { mode: s.dirMode, path: s.path }, startLead: s.startLead, installSkills: s.installSkills, autopilot: s.autopilot });
    const linked = s.repos.filter((x) => x.where);
    if (linked.length) {
      // the agents now have ids: map the team by display name, save the list, clone what was given as a URL
      try {
        const f = await api('GET', `/api/floors/${r.id}`), ids = s.team.map((m) => f.agents.find((a) => a.displayName === m.displayName)?.id);
        const list = linked.map((x) => repoEntry(x, ids));
        await api('PUT', `/api/floors/${r.id}/repos`, { repos: list });
        for (const e of list.filter((x) => x.remote)) api('POST', `/api/floors/${r.id}/repos/${e.id}/clone`).then(() => toast(tt('Cloned {id}', { id: e.id })), (x) => toast(tx(x.message), 6000));
      } catch (e) { toast(tt('The squad is created, but its linked repositories were not saved: {error}', { error: tx(e.message) }), 7000); }
    }
    closeModal();
    toast(r.leadStarted ? tt('Floor {n} created; the lead is starting', { n: r.number }) : r.leadError ? tt('Floor {n} created; the lead did not start: {error}', { n: r.number, error: tx(r.leadError) }) : tt('Floor {n} created', { n: r.number }), 5000);
    location.hash = r.lead ? `#/floor/${r.id}/desk/${r.lead}` : `#/floor/${r.id}`;
    ctx.refresh();
  } catch (e) { s.busy = false; draw(e.message); }
}
