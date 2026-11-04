// SPDX-License-Identifier: Apache-2.0
// Set up Squad wizard: What do you want to build? → Team → (the Blueprint's first questions) → Folder → Review and create.
// The recommendation comes from Claude Code (the advisor model, opus at high effort by default) with a keyword
// fallback; the owner edits the team freely. The Team step shows the squad's loop (1.14): every routine and source
// document of the Blueprint with the agent that keeps it running, and what stops when a role is left out. A Blueprint
// with first questions (1.15, e.g. how the site is managed) asks them in their own step; the answers reach the lead's
// kickoff and the Blueprint's intake document, and a repository answer becomes a linked repository with write access.
import { esc, api, toast, openModal, closeModal, segHtml, bindSegs, stepperHtml } from './lib.js';
import { ctx } from './ctx.js';
import { t as tt, tx } from './i18n.js';

const STEP_TITLE = { what: tt('What'), team: tt('Team'), intake: tt('Details'), folder: tt('Folder'), review: tt('Review') };
const stepKeys = () => ['what', 'team', ...(bpOf()?.intake?.length ? ['intake'] : []), 'folder', 'review'];
const stepKey = () => stepKeys()[s.step];
const CATEGORY = { software: tt('Software'), marketing: tt('Marketing'), sales: tt('Sales'), general: tt('General'), erp: 'ERPNext', finance: tt('Finance'), legal: tt('Legal'), support: tt('Support') };
const kebab = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let s = null;

ctx.actions['setup-squad'] = async () => {
  const [{ blueprints, squadsDir, nextFloorNumber, advisor }, { templates }] = await Promise.all([api('GET', '/api/blueprints'), api('GET', '/api/catalog')]);
  const order = ['software-house', 'digital-marketing', 'sales-crm'];
  blueprints.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  s = { step: 0, blueprints, templates, squadsDir, number: nextFloorNumber, advisor: advisor || { model: 'opus', effort: 'high' }, ackGaps: false, intake: {}, autopilot: 'balanced', prompt: '', blueprint: '', rec: null, team: [], name: '', goal: '',
    dirMode: 'new', path: '', pathTouched: false, repos: [], startLead: true, installSkills: true, catalog: false, filter: { category: '', skill: '' }, busy: false };
  draw();
};

const bpOf = () => s.blueprints.find((b) => b.id === s.blueprint);
const tplOf = (role) => s.templates.find((t) => t.role === role) || { title: role, skills: [], model: '?' };

const ic = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const advisorText = (a = s.advisor) => tt('{model}, {effort} effort', { model: a.model, effort: a.effort });

function whatHtml() {
  const busy = s.busy ? `<div class="ssBusy" role="status"><span class="spinner" aria-hidden="true"></span><div><b>${tt('Claude Code is building your team')}</b>
      <div class="note">${tt('{model} reads your request and the Blueprints, then picks a complete team. This takes up to 2 minutes.', { model: esc(advisorText()) })}</div></div></div>` : '';
  return `<div class="ssField"><label for="ssPrompt">${tt('What do you want to build?')}</label>
    <textarea id="ssPrompt" rows="5" placeholder="${esc(tt('I want a software house that builds my restaurant POS'))}" ${s.busy ? 'disabled' : ''}>${esc(s.prompt)}</textarea>
    <p class="hint">${tt('Name the business, the market and the target. Claude Code ({model}) recommends a complete team that can run the whole loop by itself.', { model: esc(advisorText()) })}</p></div>
    ${busy}
    <div class="sectionHead ssSection"><h3 class="grow">${tt('Blueprint')}</h3><span class="note">${tt('Optional: how the team works together (roles, documents, routines, gates)')}</span></div>
    <div class="choice bpGrid" data-choice="blueprint">${s.blueprints.map((b) => {
      const lead = b.roles.find((r) => r.lead), size = b.roles.reduce((n, r) => n + r.default, 0);
      return `<button type="button" class="bpCard" data-v="${b.id}" aria-pressed="${s.blueprint === b.id}" ${s.busy ? 'disabled' : ''}>
        <span class="bpTop"><b>${esc(b.title)}</b><span class="chip">${esc(CATEGORY[b.category] || b.category)}</span><span class="bpTick" aria-hidden="true">${ic('check')}</span></span>
        <small class="bpDesc">${esc(b.description)}</small>
        <span class="bpMeta">${size === 1 ? tt('{n} agent', { n: 1 }) : tt('{n} agents', { n: size })} · ${tt('lead: {name}', { name: esc(tplOf(lead?.template).title) })}${b.cadence?.length ? ` · ${b.cadence.length === 1 ? tt('{n} routine', { n: 1 }) : tt('{n} routines', { n: b.cadence.length })}` : ''}</span></button>`;
    }).join('')}</div>`;
}

// the squad's loop against the team being edited: what each loop role keeps running, and who does it
const loopOf = () => (bpOf()?.loop || []).map((r) => ({ ...r, have: s.team.filter((m) => m.template === r.template).length, need: r.duties.some((d) => d.kind === 'min') ? r.min : 1 }));
const gapsOf = () => loopOf().filter((r) => r.have < r.need);
const dutyText = (d) => (d.kind === 'lead' ? tt('Leads the squad and is the one who talks to you') : d.kind === 'min' ? tt('Required by the Blueprint (at least {n})', { n: d.text.match(/\d+/)?.[0] || 1 })
  : d.kind === 'routine' ? tt('Routine: {title}', { title: tx(d.text.replace(/^Routine: /, '')) }) : tt('Owns {title}', { title: tx(d.text.replace(/^Owns /, '')) }));
function loopHtml() {
  const loop = loopOf();
  if (!loop.length) return '';
  const gaps = loop.filter((r) => r.have < r.need), routines = (bpOf().cadence || []).length;
  const head = gaps.length ? `<span class="loopState warn">${ic('alert')}${gaps.length === 1 ? tt('{n} role is missing: its work never runs', { n: 1 }) : tt('{n} roles are missing: their work never runs', { n: gaps.length })}</span>`
    : `<span class="loopState ok">${ic('check')}${tt('Complete: every routine and document has an agent')}</span>`;
  return `<section class="card loopCard" aria-labelledby="ssLoopH"><div class="row wrap"><h4 id="ssLoopH" class="grow">${tt('Squad loop')}</h4>${head}</div>
    <p class="note">${tt('The work this Blueprint repeats by itself ({n} routines), and the role that keeps each part running.', { n: routines })}</p>
    <ul class="loopList">${loop.map((r) => {
      const miss = r.have < r.need;
      return `<li class="${miss ? 'miss' : ''}"><span class="loopIcon">${ic(miss ? 'alert' : 'check')}</span><div class="grow"><b>${esc(tplOf(r.template).title)}</b>${r.need > 1 ? ` <span class="note">${tt('×{n} needed', { n: r.need })}</span>` : ''}
        <div class="note">${r.duties.map(dutyText).map(esc).join(' · ')}</div></div>${miss ? `<button type="button" class="small" data-addloop="${esc(r.template)}">${tt('Add')}</button>` : ''}</li>`;
    }).join('')}</ul></section>`;
}

// the Blueprint's first questions: a question shows only while its condition holds (as intakeAsked on the server)
const asked = (q) => !q.when || Object.entries(q.when).every(([k, vals]) => vals.includes(String(s.intake[k] || '')));
const intakeQs = () => (bpOf()?.intake || []).filter(asked);
const answerOf = (q) => s.intake[q.id] ?? q.default ?? '';
function intakeHtml() {
  return `<p class="stepLead">${tt('A few questions about how {name} works, so the lead starts from your answers instead of asking again.', { name: esc(bpOf().title) })}</p>
    ${intakeQs().map((q) => (q.kind === 'choice'
    ? `<fieldset class="ssField intakeQ"><legend>${esc(tx(q.label))}${q.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</legend>
        <div class="choice bpGrid intakeOpts">${q.options.map((o) => `<button type="button" class="bpCard" data-iqchoice="${esc(q.id)}" data-v="${esc(o.value)}" aria-pressed="${answerOf(q) === o.value}">
          <span class="bpTop"><b>${esc(tx(o.label))}</b><span class="bpTick" aria-hidden="true">${ic('check')}</span></span>${o.hint ? `<small class="bpDesc">${esc(tx(o.hint))}</small>` : ''}</button>`).join('')}</div></fieldset>`
    : `<div class="ssField intakeQ"><label for="iq-${esc(q.id)}">${esc(tx(q.label))}${q.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
        <input id="iq-${esc(q.id)}" data-iq="${esc(q.id)}" value="${esc(answerOf(q))}" placeholder="${esc(q.placeholder)}" spellcheck="false" ${q.kind === 'url' ? 'type="url" inputmode="url" autocomplete="url"' : ''}>
        ${q.hint ? `<p class="hint">${esc(tx(q.hint))}</p>` : ''}</div>`)).join('')}`;
}
// the repositories the answers name, with the team members that may commit there (indexes into s.team)
const intakeRepos = () => intakeQs().filter((q) => q.kind === 'repo' && answerOf(q)).map((q) => ({
  where: answerOf(q), access: 'write', branch: answerOf(intakeQs().find((b) => b.kind === 'branch' && b.repo === q.id) || {}) || 'main', fromIntake: true,
  team: s.team.map((m, k) => (q.agents.includes(m.template) ? k : -1)).filter((k) => k >= 0),
}));
const answersText = () => intakeQs().filter((q) => answerOf(q)).map((q) => `${esc(tx(q.label).replace(/[:?]\s*$/, ''))}: <b>${esc(q.kind === 'choice' ? tx(q.options.find((o) => o.value === answerOf(q))?.label || answerOf(q)) : answerOf(q))}</b>`);

function memberCard(m, i) {
  const t = tplOf(m.template), loop = loopOf().find((r) => r.template === m.template);
  const sole = loop && loop.have <= loop.need;
  return `<li class="card memberCard${m.lead ? ' isLead' : ''}"><div class="memberTop">
      <div class="grow memberId"><span class="memberRole">${esc(t.title)}</span>
        <div class="chips"><span class="chip model">${esc(t.model)}</span>${loop ? `<span class="chip info">${tt('Loop')}</span>` : ''}</div></div>
      <label class="inline leadPick"><input type="radio" name="ssLead" data-lead="${i}" ${m.lead ? 'checked' : ''}> ${tt('Lead')}</label>
      <button type="button" class="ghost iconBtn danger" data-rm="${i}" aria-label="${tt('Remove {name}', { name: esc(m.displayName) })}" title="${tt('Remove')}">×</button></div>
    <label class="memberName"><span class="note">${tt('Display name')}</span><input data-name="${i}" value="${esc(m.displayName)}" maxlength="60"></label>
    ${m.reason ? `<p class="memberWhy">${esc(m.reason)}</p>` : ''}
    ${sole ? `<p class="note loopNote">${ic('info')}<span>${loop.duties.length === 1 ? tt('Removing it stops 1 part of the loop: {what}', { what: esc(dutyText(loop.duties[0])) }) : tt('Removing it stops {n} parts of the loop (see Squad loop)', { n: loop.duties.length })}</span></p>` : ''}
    ${(t.skills || []).length ? `<details class="skills"><summary>${t.skills.length === 1 ? tt('{n} skill', { n: 1 }) : tt('{n} skills', { n: t.skills.length })}</summary><div class="chips">${t.skills.map((k) => `<span class="pill">${esc(k)}</span>`).join('')}</div></details>` : ''}</li>`;
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
  const src = r?.source === 'claude' ? `<span class="chip ok">${ic('spark')}${tt('Recommended by Claude Code ({model})', { model: esc(advisorText(r.model || s.advisor)) })}</span>`
    : r?.source === 'keywords' ? `<span class="chip warn" title="${esc(tx(r.note))}">${tt('Keyword match: Claude Code was not available')}</span>` : `<span class="chip">${tt('The Blueprint\'s default team.')}</span>`;
  const added = (r?.loopAdded || []).filter((x) => s.team.some((m) => m.template === x));
  return `<div class="card ssSummary"><div class="row wrap"><b class="grow">${esc(bp.title)} <span class="note">v${bp.version} · ${bp.workflow === 'squad-sprint' ? tt('Squad Sprint (lead, board, QA gate)') : tt('Free Team led by the lead')}</span></b>${src}</div>
      <div class="ssField"><label for="ssName">${tt('Squad name')}</label><input id="ssName" value="${esc(s.name)}" maxlength="60"></div>
      <div class="ssField"><label for="ssGoal">${tt('Goal (written to AISQUAD.md)')}</label><textarea id="ssGoal" rows="4">${esc(s.goal)}</textarea></div>
      ${added.length ? `<p class="note loopNote">${ic('info')}<span>${tt('Added back so the loop is complete: {list}.', { list: added.map((x) => esc(tplOf(x).title)).join(', ') })}</span></p>` : ''}</div>
    ${loopHtml()}
    <div class="sectionHead ssSection"><h3 class="grow">${s.team.length === 1 ? tt('Team · {n} agent', { n: 1 }) : tt('Team · {n} agents', { n: s.team.length })}</h3><button type="button" class="small" data-catalog="${s.catalog ? 'close' : 'open'}" aria-expanded="${s.catalog}">${s.catalog ? tt('Close the catalog') : tt('+ Add agent')}</button></div>
    ${s.catalog ? catalogHtml() : ''}
    ${s.team.length ? `<ul class="memberList">${s.team.map(memberCard).join('')}</ul>` : `<div class="empty">${tt('No agents yet. Add them from the catalog.')}</div>`}`;
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
    ${intakeRepos().map((r) => `<div class="card siteRepo"><b>${esc(r.where)}</b> <span class="chip">${tt('branch {name}', { name: esc(r.branch) })}</span>
      <p class="note">${tt('From your answers: linked with write access for {names}. They commit on their own branches; you push and merge.', { names: esc(r.team.map((k) => String(s.team[k].displayName).split(' - ')[0]).join(', ') || tt('nobody yet')) })}</p></div>`).join('')}
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
  return { id, path: isUrl(where) ? `../${name}` : where.startsWith('/') ? relative(s.path, where) : where, ...(isUrl(where) ? { remote: where } : {}), access: r.access, ...(r.branch ? { branch: { strategy: 'agent-branches', main: r.branch } } : {}), agents: r.team.map((k) => ids[k]).filter(Boolean) };
}

const AUTOPILOT = [['balanced', tt('Balanced (recommended)')], ['full', tt('Full')], ['off', tt('Off')]];
function reviewHtml() {
  const bp = bpOf(), lead = s.team.find((m) => m.lead);
  return `<div class="card" style="margin-top:var(--sp-3)"><dl class="kv">
      <dt>${tt('Floor')}</dt><dd>${s.number} <span class="note">${tt('(next free Floor; Floor 1 is for independent agents)')}</span></dd>
      <dt>${tt('Squad')}</dt><dd>${esc(s.name)}</dd><dt>Blueprint</dt><dd>${esc(bp.title)} v${bp.version}</dd>
      <dt>${tt('Folder')}</dt><dd><code>${esc(s.path)}</code> <span class="note">(${s.dirMode === 'new' ? tt('new, git init') : tt('existing')})</span></dd>
      <dt>${tt('Lead')}</dt><dd>${esc(lead?.displayName || '')}</dd>
      <dt>${tt('Team')}</dt><dd>${s.team.map((m) => `${esc(m.displayName)} <span class="note">(${esc(tplOf(m.template).title)})</span>`).join(', ')}</dd>
      ${answersText().length ? `<dt>${tt('Details')}</dt><dd>${answersText().join('<br>')}</dd>` : ''}</dl></div>
    <p class="note">${tt('Creates the Floor files in <code>.claude/aisquad/</code>, an agent file per member in <code>.claude/agents/</code>, <code>AISQUAD.md</code> with the goal, the team and the Blueprint\'s communication standard, and the Blueprint\'s workflow pack.')}</p>
    <label class="inline"><input type="checkbox" id="ssSkills" ${s.installSkills ? 'checked' : ''}> ${tt('Install the team\'s skills into <code>.claude/skills/</code> ({n} skills)', { n: [...new Set(s.team.flatMap((m) => tplOf(m.template).skills || []))].length })}</label>
    <label class="inline"><input type="checkbox" id="ssStart" ${s.startLead ? 'checked' : ''}> ${tt('Start the lead after creating (it asks you for the source documents first)')}</label>
    <label for="ssAutopilot">Autopilot</label><select id="ssAutopilot">${AUTOPILOT.map(([k, t]) => `<option value="${k}" ${s.autopilot === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <p class="note">${esc(tx(ctx.state.building?.options?.autopilot?.text?.[s.autopilot] || ''))} ${tt('Critical items (money, legal, production, deleting data, scope) always wait for you.')}</p>`;
}

function draw(error = '') {
  const keys = stepKeys(), last = s.step === keys.length - 1;
  const html = { what: whatHtml, team: teamHtml, intake: intakeHtml, folder: folderHtml, review: reviewHtml }[stepKey()]();
  const body = openModal(`<div class="mHead"><h3 class="grow">${tt('Set up Squad')}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
    ${stepperHtml(keys.map((k) => STEP_TITLE[k]), s.step)}
    <form class="mBody" id="ssForm" novalidate>${html}</form>
    <div class="mFoot"><div class="err grow" id="ssErr">${esc(error)}</div>${s.step ? `<button class="ghost" data-back>${tt('Back')}</button>` : ''}
      <button class="gold${s.busy ? ' busy' : ''}" data-next ${s.busy ? 'disabled aria-busy="true"' : ''}>${s.busy ? (s.step === 0 ? tt('Asking Claude Code…') : tt('Creating…')) : s.step === 0 ? tt('Recommend a team') : last ? tt('Create squad') : tt('Next')}</button></div>`);
  body.querySelector('[data-close]').onclick = () => closeModal();
  body.querySelector('[data-back]')?.addEventListener('click', () => { collect(); s.step--; draw(); });
  body.querySelector('[data-next]').onclick = () => next();
  body.querySelector('#ssForm').addEventListener('submit', (e) => { e.preventDefault(); });
  body.querySelectorAll('[data-iqchoice]').forEach((b) => b.addEventListener('click', () => { collect(); s.intake[b.dataset.iqchoice] = b.dataset.v; draw(); }));
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
  body.querySelectorAll('[data-addloop]').forEach((b) => b.addEventListener('click', () => {
    collect();
    const r = loopOf().find((x) => x.template === b.dataset.addloop), t = tplOf(r.template);
    for (let k = r.have; k < r.need; k++) s.team.push({ template: t.role, displayName: k ? `${t.title} ${k + 1}` : t.title, lead: !s.team.length, reason: r.duties.map(dutyText).join(' · ') });
    toast(tt('{name} added', { name: t.title }));
    draw();
  }));
  body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { collect(); const [m] = s.team.splice(+b.dataset.rm, 1); if (m.lead && s.team[0]) s.team[0].lead = true; s.ackGaps = false; draw(); }));
  body.querySelector('#ssPath')?.addEventListener('input', () => { s.pathTouched = true; });
  body.querySelector('[data-addrepo]')?.addEventListener('click', () => { collect(); s.repos.push({ where: '', access: 'read', team: [] }); draw(); });
  body.querySelectorAll('[data-rmrepo]').forEach((b) => b.addEventListener('click', () => { collect(); s.repos.splice(+b.dataset.rmrepo, 1); draw(); }));
  body.querySelector('[data-squadsdir]')?.addEventListener('click', async () => {
    const dir = prompt(tt('Default folder for new squads (absolute path)'), s.squadsDir);
    if (!dir) return;
    try { await api('PATCH', '/api/building', { squadsDir: dir }); s.squadsDir = dir; suggestPath(); draw(); } catch (e) { draw(e.message); }
  });
  (body.querySelector('#ssPrompt') || body.querySelector('#ssName') || body.querySelector('[data-iq]'))?.focus();
}

function collect() {
  const v = (id) => document.getElementById(id);
  const key = stepKey();
  if (key === 'what') s.prompt = v('ssPrompt').value.trim();
  if (key === 'intake') document.querySelectorAll('[data-iq]').forEach((el) => { s.intake[el.dataset.iq] = el.value.trim(); });
  if (key === 'team') {
    s.name = v('ssName').value.trim(); s.goal = v('ssGoal').value.trim();
    document.querySelectorAll('[data-name]').forEach((el) => { s.team[+el.dataset.name].displayName = el.value.trim(); });
    const lead = document.querySelector('[data-lead]:checked');
    if (lead) s.team.forEach((m, i) => { m.lead = i === +lead.dataset.lead; });
  }
  if (key === 'folder') {
    s.path = v('ssPath').value.trim();
    document.querySelectorAll('[data-repoi]').forEach((el) => { const r = s.repos[+el.dataset.repoi]; r.where = el.querySelector('[data-rk=where]').value.trim(); r.access = el.querySelector('[data-rk=access]').value; r.team = [...el.querySelectorAll('[data-rteam]:checked')].map((x) => +x.dataset.rteam); });
  }
  if (key === 'review') { s.startLead = v('ssStart').checked; s.installSkills = v('ssSkills').checked; s.autopilot = v('ssAutopilot').value; }
}

async function next() {
  collect();
  const key = stepKey();
  if (key === 'what') {
    if (!s.prompt && !s.blueprint) return draw(tt('Describe what you want to build, or pick a Blueprint.'));
    s.busy = true; draw();
    try {
      const r = await api('POST', '/api/squads/recommend', { prompt: s.prompt, blueprint: s.blueprint });
      Object.assign(s, { rec: r, blueprint: r.blueprint, team: r.team, name: r.name, goal: r.goal, step: 1, busy: false, catalog: false });
      suggestPath();
      return draw();
    } catch (e) { s.busy = false; return draw(e.message); }
  }
  if (key === 'team') {
    if (!s.name) return draw(tt('Give the squad a name.'));
    if (!s.team.length) return draw(tt('Add at least one agent.'));
    if (s.team.some((m) => !m.displayName)) return draw(tt('Every agent needs a display name.'));
    const gaps = gapsOf();
    if (gaps.length && !s.ackGaps) { s.ackGaps = true; return draw(tt('Without {list} part of the loop never runs. Add them in Squad loop, or press Next again to continue anyway.', { list: gaps.map((r) => tplOf(r.template).title).join(', ') })); }
    suggestPath();
  }
  if (key === 'intake') {
    const missing = intakeQs().filter((q) => q.required && !answerOf(q));
    if (missing.length) return draw(tt('Answer: {list}', { list: missing.map((q) => tx(q.label).replace(/[:?]\s*$/, '')).join(', ') }));
  }
  if (key === 'folder' && !s.path.startsWith('/')) return draw(tt('The folder must be an absolute path (starting with /).'));
  if (s.step < stepKeys().length - 1) { s.step++; return draw(); }
  s.busy = true; draw();
  try {
    const r = await api('POST', '/api/squads', { blueprint: s.blueprint, name: s.name, goal: s.goal, team: s.team, directory: { mode: s.dirMode, path: s.path }, startLead: s.startLead, installSkills: s.installSkills, autopilot: s.autopilot,
      ...(bpOf()?.intake?.length ? { intake: Object.fromEntries(intakeQs().map((q) => [q.id, answerOf(q)])) } : {}) });
    const linked = [...intakeRepos(), ...s.repos.filter((x) => x.where && !intakeRepos().some((i) => i.where === x.where))];
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
