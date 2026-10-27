// SPDX-License-Identifier: Apache-2.0
// New Floor wizard: Project → Directory → Git → Team → Workflow → Layout & create.
import { esc, api, toast, openModal, closeModal, segHtml, bindSegs, segValue } from './lib.js';
import { memberHtml, readMember, gitHtml, readGit } from './forms.js';
import { ctx } from './ctx.js';
import { t as tt } from './i18n.js';

const STEPS = ['Project', 'Directory', 'Git', 'Team', 'Workflow', 'Layout'];
const STEP_TEXT = { Project: tt('Project'), Directory: tt('Directory'), Git: 'Git', Team: tt('Team'), Workflow: tt('Workflow'), Layout: tt('Layout') };
const LAYOUTS = [['rows', tt('Rows'), tt('Desks in rows facing the windows')], ['pods', tt('Pods'), tt('Groups of four facing each other')], ['circle', tt('Circle'), tt('Everyone faces the middle')], ['open-space', tt('Open Space'), tt('Loose, hand-placed look')]];
const kebab = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let w = null, templates = [];

export async function openWizard(prefill = {}) {
  templates = (await api('GET', '/api/roles')).templates;
  const opts = ctx.state.building?.options || {};
  w = {
    step: 0, name: prefill.name || '', goal: '', dirMode: prefill.path ? 'existing' : 'new', path: prefill.path || '', pathTouched: !!prefill.path, url: '',
    git: {}, team: [], workflow: 'free-team', budget: { usd: 0, period: 'month' }, layout: 'rows', number: opts.nextFloorNumber || 2, projectsDir: opts.projectsDir || '',
  };
  draw();
}

function suggestPath() {
  if (w.pathTouched || w.dirMode === 'existing' || !w.projectsDir) return;
  w.path = w.name ? `${w.projectsDir.replace(/\/$/, '')}/${kebab(w.name)}` : '';
}

function stepHtml() {
  switch (STEPS[w.step]) {
    case 'Project': return `<label for="wName">${tt('Project name')}</label><input id="wName" data-w="name" value="${esc(w.name)}" maxlength="60" placeholder="${esc(tt('Acme Coffee Shop'))}" required>
      <label for="wGoal">${tt('Goal')}</label><textarea id="wGoal" data-w="goal" rows="5" placeholder="${esc(tt('What should this team achieve? Written to AISQUAD.md, which every agent reads first.'))}">${esc(w.goal)}</textarea>`;
    case 'Directory': return `<label>${tt('Where does the code live?')}</label>
      ${segHtml('dirMode', [['existing', tt('Existing directory')], ['new', tt('New project (git init)')], ['clone', tt('Clone a repository')]], w.dirMode)}
      ${w.dirMode === 'clone' ? `<label for="wUrl">${tt('Repository URL')}</label><input id="wUrl" data-w="url" value="${esc(w.url)}" placeholder="git@github.com:org/repo.git">` : ''}
      <label for="wPath">${w.dirMode === 'existing' ? tt('Directory (absolute path)') : tt('Target directory (absolute path, must not exist yet or be empty)')}</label>
      <input id="wPath" data-w="path" value="${esc(w.path)}" placeholder="/home/you/projects/acme" spellcheck="false">
      <p class="note">${tt('Floor files go to <code>.claude/aisquad/</code> in this directory; generated agents to <code>.claude/agents/</code>. No secrets or absolute paths are written to the repo.')}</p>`;
    case 'Git': return gitHtml(w.git);
    case 'Team': return `<p class="note" style="margin-top:12px">${tt('Agents are created from Role Templates. Overrides change one agent only: model and effort replace, skills add or remove, rules and prompt append, permissions can only get stricter.')}</p>
      <div id="wTeam">${w.team.map((m, i) => memberHtml(m, templates, { idx: i })).join('') || `<div class="empty">${tt('No agents yet. You can also add them later.')}</div>`}</div>
      <div class="row wrap" style="margin-top:10px"><select id="wAddTpl" style="width:auto">${templates.map((t) => `<option value="${esc(t.role)}">${esc(t.title)}</option>`).join('')}</select><button type="button" id="wAdd">${tt('+ Add agent')}</button><button type="button" id="wSprintTeam" class="ghost">${tt('+ Squad Sprint team')}</button></div>`;
    case 'Workflow': return `<label>${tt('Workflow')}</label><div class="choice" data-choice="workflow">
        <button type="button" data-v="free-team" aria-pressed="${w.workflow === 'free-team'}"><b>Free Team</b><small>${tt('You give tasks to agents directly. Default.')}</small></button>
        <button type="button" data-v="squad-sprint" aria-pressed="${w.workflow === 'squad-sprint'}"><b>Squad Sprint</b><small>${tt('Lead plans a sprint board, QA gates every task.')}</small></button></div>
      <label class="inline"><input type="checkbox" data-w="autoNext" ${w.autoNext ? 'checked' : ''}> ${tt('Squad Sprint: start the next sprint automatically once a closed sprint is merged')}</label>
      <p class="note">${tt('Squad Sprint adds <code>.claude/squad/config.sh</code>, gate hooks, a <code>/sprint</code> command and the <code>docs/squad</code> board to the project. Use the Sprint Lead, Sprint Developer and Sprint QA templates.')}</p>
      <div class="grid2"><div><label for="wBudget">${tt('Budget (USD, 0 = none)')}</label><input id="wBudget" type="number" min="0" step="1" data-w="budgetUsd" value="${w.budget.usd || 0}"></div>
        <div><label>${tt('Budget period')}</label>${segHtml('budgetPeriod', [['month', tt('Per month')], ['day', tt('Per day')]], w.budget.period)}</div></div>
      <p class="note">${tt('The Watchdog warns at 80 % of the budget and raises Attention at 100 % (estimated from transcript usage).')}</p>`;
    case 'Layout': return `<label>${tt('Layout preset')}</label><div class="choice" data-choice="layout">${LAYOUTS.map(([v, t, d]) => `<button type="button" data-v="${v}" aria-pressed="${w.layout === v}"><b>${t}</b><small>${d}</small></button>`).join('')}</div>
      <label for="wNum">${tt('Floor number')}</label><input id="wNum" type="number" min="2" max="99" data-w="number" value="${w.number}" style="max-width:120px">
      <div class="card" style="margin-top:14px"><b>${tt('Summary')}</b><dl class="kv" style="margin-top:6px">
        <dt>${tt('Project')}</dt><dd>${esc(w.name)}</dd><dt>${tt('Directory')}</dt><dd>${esc(w.path)} <span class="note">(${w.dirMode === 'new' ? tt('new, git init') : w.dirMode === 'clone' ? tt('clone {url}', { url: esc(w.url) }) : tt('existing')})</span></dd>
        <dt>${tt('Team')}</dt><dd>${w.team.length ? w.team.map((m) => esc(m.displayName || tt('(unnamed)'))).join(', ') : tt('none yet')}</dd>
        <dt>${tt('Workflow')}</dt><dd>${w.workflow === 'squad-sprint' ? 'Squad Sprint' : 'Free Team'}</dd>
        <dt>${tt('Merge')}</dt><dd>${w.git.mergePolicy === 'manual' ? tt('manual') : tt('automatic after quality gate')}${w.git.qualityGate ? ` (<code>${esc(w.git.qualityGate)}</code>)` : ''}</dd></dl></div>`;
    default: return '';
  }
}

function draw(error = '') {
  const last = w.step === STEPS.length - 1;
  const body = openModal(`<div class="mHead"><h3 class="grow">${tt('New Floor')}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
    <div class="steps">${STEPS.map((s, i) => `<span class="${i === w.step ? 'on' : i < w.step ? 'done' : ''}">${i + 1}. ${STEP_TEXT[s]}</span>`).join('')}</div>
    <form class="mBody" id="wForm" novalidate>${stepHtml()}</form>
    <div class="mFoot"><div class="err grow" id="wErr">${esc(error)}</div>
      ${w.step ? `<button class="ghost" data-back>${tt('Back')}</button>` : ''}<button class="gold" data-next>${last ? tt('Create Floor') : tt('Next')}</button></div>`);
  bindSegs(body, (name, v) => { if (name === 'dirMode') { collect(); w.dirMode = v; if (v === 'existing') { w.path = ''; w.pathTouched = false; } suggestPath(); draw(); } });
  body.querySelectorAll('[data-choice]').forEach((c) => c.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    c.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  body.querySelector('[data-close]').onclick = () => closeModal();
  body.querySelector('[data-back]')?.addEventListener('click', () => { collect(); w.step--; draw(); });
  body.querySelector('[data-next]').onclick = () => next();
  body.querySelector('#wForm').addEventListener('submit', (e) => { e.preventDefault(); next(); });
  body.querySelector('[data-w="path"]')?.addEventListener('input', () => { w.pathTouched = true; });
  body.querySelector('#wAdd')?.addEventListener('click', () => {
    collect();
    const t = templates.find((x) => x.role === body.querySelector('#wAddTpl').value);
    w.team.push({ displayName: '', template: t.role, lead: !w.team.length && t.role === 'project-manager', overrides: {}, appearance: {} });
    draw();
    const rows = body.querySelectorAll('[data-member] [data-f="displayName"]');
    rows[rows.length - 1]?.focus();
  });
  body.querySelector('#wSprintTeam')?.addEventListener('click', () => {
    collect();
    const has = (t) => w.team.some((m) => m.template === t);
    if (!has('sprint-lead')) w.team.push({ displayName: 'Sprint Lead', template: 'sprint-lead', lead: !w.team.some((m) => m.lead), overrides: {}, appearance: {} });
    for (let k = 0; k < 2; k++) w.team.push({ displayName: `Developer ${w.team.filter((m) => m.template === 'sprint-developer').length + 1}`, template: 'sprint-developer', overrides: {}, appearance: {} });
    if (!has('sprint-qa')) w.team.push({ displayName: 'QA', template: 'sprint-qa', overrides: {}, appearance: {} });
    w.workflow = 'squad-sprint';
    draw();
  });
  body.querySelectorAll('[data-rm-member]').forEach((b) => b.onclick = () => { collect(); w.team.splice(+b.dataset.rmMember, 1); draw(); });
  body.querySelectorAll('[data-f="template"]').forEach((s) => s.addEventListener('change', () => { collect(); draw(); }));
  body.querySelector('input,textarea')?.focus();
}

function collect() {
  const f = document.getElementById('wForm');
  if (!f) return;
  const val = (k) => f.querySelector(`[data-w="${k}"]`);
  const step = STEPS[w.step];
  if (step === 'Project') { w.name = val('name').value.trim(); w.goal = val('goal').value.trim(); suggestPath(); }
  if (step === 'Directory') { w.path = val('path').value.trim(); if (val('url')) w.url = val('url').value.trim(); }
  if (step === 'Git') w.git = readGit(f);
  if (step === 'Team') w.team = [...f.querySelectorAll('[data-member]')].map(readMember);
  if (step === 'Workflow') {
    w.workflow = f.querySelector('[data-choice="workflow"] [aria-pressed=true]')?.dataset.v || 'free-team';
    w.budget = { usd: Math.max(0, Number(val('budgetUsd').value) || 0), period: segValue(f, 'budgetPeriod') || 'month' };
    w.autoNext = val('autoNext').checked;
  }
  if (step === 'Layout') { w.layout = f.querySelector('[data-choice="layout"] [aria-pressed=true]')?.dataset.v || 'rows'; w.number = Number(val('number').value) || w.number; }
}

function validate() {
  const step = STEPS[w.step];
  if (step === 'Project' && !w.name) return tt('Give the project a name.');
  if (step === 'Directory') {
    if (!w.path.startsWith('/')) return tt('The directory must be an absolute path (starting with /).');
    if (w.dirMode === 'clone' && !/^(https?:\/\/|ssh:\/\/|git@|file:\/\/|\/)/.test(w.url)) return tt('Enter a repository URL (https://, ssh://, git@ or a local path).');
  }
  if (step === 'Team') {
    if (w.team.some((m) => !m.displayName)) return tt('Every agent needs a display name.');
    if (w.team.filter((m) => m.lead).length > 1) return tt('Only one agent can be the lead.');
  }
  if (step === 'Layout' && !(w.number >= 2 && w.number <= 99)) return tt('Floor number must be 2 to 99 (Floor 1 is for independent agents).');
  return '';
}

async function next() {
  collect();
  const err = validate();
  if (err) { document.getElementById('wErr').textContent = err; return; }
  if (w.step < STEPS.length - 1) { w.step++; draw(); return; }
  const btn = document.querySelector('[data-next]');
  btn.disabled = true; btn.textContent = w.dirMode === 'clone' ? tt('Cloning…') : tt('Creating…');
  try {
    const r = await api('POST', '/api/floors', {
      name: w.name, goal: w.goal, number: w.number, directory: { mode: w.dirMode, path: w.path, url: w.url }, git: w.git,
      team: w.team, workflow: w.workflow, layout: w.layout, budget: w.budget, sprint: { autoNext: !!w.autoNext },
    });
    closeModal();
    toast(tt('Floor {n} created', { n: r.number }));
    location.hash = `#/floor/${r.id}`;
    ctx.refresh();
  } catch (e) {
    btn.disabled = false; btn.textContent = tt('Create Floor');
    document.getElementById('wErr').textContent = e.message;
  }
}
