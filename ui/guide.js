// SPDX-License-Identifier: Apache-2.0
// The Company Guide (1.4): the first thing a new owner meets, and "Set up the company" in the Lobby afterwards.
// Eight short steps with buttons (language, the business, the goals, what exists, the divisions, what runs by
// itself, the machine and the budget), then the plan in plain words to edit and build. Every answer is saved on
// the server (GET/PUT /api/guide), so the owner can stop and come back; the language choice reloads the page in
// that language and the guide opens again where it was.
import { esc, api, toast, openModal, closeModal, segHtml, bindSegs } from './lib.js';
import { ctx } from './ctx.js';
import { t, tx, LANG, setLang } from './i18n.js';
import { KIND } from './admin-int.js';

const STEPS = ['language', 'business', 'goals', 'have', 'divisions', 'modes', 'capacity', 'plan'];
const STEP_TITLE = { language: t('Language'), business: t('Your business'), goals: t('Your goals'), have: t('What you have'), divisions: t('Divisions'), modes: t('How much runs by itself'), capacity: t('Machine and budget'), plan: t('The plan') };
const TYPE = { saas: [t('A SaaS product'), t('People subscribe to your software')], 'erp-consultant': [t('ERPNext consulting'), t('You implement ERPNext for clients')], consultant: [t('Consulting'), t('Advice and projects for clients')], 'software-house': [t('Software house'), t('You build software for clients')], agency: [t('Agency'), t('Marketing, creative or media work for clients')], clinic: [t('Clinic or practice'), t('Patients, appointments, treatments')], retail: [t('Shop or retail'), t('You sell products, online or in a store')], other: [t('Something else'), t('Describe it in the next field')] };
const GOAL = { revenue: t('More revenue'), leads: t('More leads'), launch: t('Launch a product'), cost: t('Lower costs'), service: t('Better service') };
const HAVE = { products: t('Products or services with prices'), brand: t('Brand rules (logo, voice, colours)'), website: t('A website'), social: t('Social media accounts'), erpnext: t('ERPNext'), tools: t('Other tools (CRM, analytics)'), repos: t('Code repositories'), team: t('People on the team'), legal: t('Company documents and contracts') };
const DIVISION = { product: [t('Product'), t('Vision, roadmap, PRDs from research and feedback')], engineering: [t('Engineering'), t('Builds and ships the software in QA-gated sprints')], implementation: [t('Implementation (ERPNext)'), t('Fit-gap, configuration, migration, UAT for clients')], marketing: [t('Marketing'), t('Content, SEO, social posts and campaigns against targets')], sales: [t('Sales'), t('Leads recorded and followed up; quotations through ERPNext')], legal: [t('Legal'), t('Contracts from locked templates; you approve every one')], finance: [t('Finance'), t('Owner only: month-end close, cash flow, receivables drafts; reads ERPNext, never pays')], support: [t('Support'), t('Tickets triaged against SLAs, replies from a knowledge base, escalations')] };
const MODE = { automatic: [t('Automatic'), t('Routine work runs and ships by itself')], supervised: [t('Supervised'), t('The squad prepares, you approve what goes out')], manual: [t('Manual'), t('The squad drafts only, you decide everything')] };
const HOURS = { day: t('Daytime'), night: t('At night (22:00–05:00)'), always: t('Around the clock') };
const MACHINES = { this: t('This machine only'), more: t('More machines later') };
const STATUS = { have: t('I have it'), missing: t('Missing'), later: t('Later') };
const MATERIAL = { 'product-description': t('Product description (what it does, for whom, the price)'), 'user-feedback': t('User feedback (support messages, reviews, interviews)'), competitors: t('Competitors you know'), repos: t('The code repositories'), 'deploy-access': t('How staging and production are deployed'), prd: t('A PRD or a feature list for the first sprint'), erpnext: t('ERPNext: the site address and a sales key'), 'business-requirements': t('Business requirements (processes, reports, who does what)'), 'master-data': t('Master data (customers, items, chart of accounts)'), brand: t('Brand rules (voice, colours, logo, words to use and to avoid)'), website: t('The website (address, who can change it)'), 'social-accounts': t('Social media accounts (which, who posts)'), analytics: t('Analytics (GA4 or similar) for the traffic target'), 'price-list': t('Price list and discount rules'), 'lead-sources': t('Where leads come from (forms, WhatsApp, marketplace)'), inbox: t('A shared inbox or WhatsApp for lead replies'), 'contract-templates': t('Contract templates (bilingual, in the Company Brain)'), 'company-documents': t('Company documents (deed, NPWP, signatory)'),
  'finance-key': t('A read-only ERPNext finance key'), 'bank-statements': t('Bank statements each month'), 'finance-policy': t('Approval limits, who pays, the close and tax calendars, the budget'),
  'ticket-source': t('Where the tickets live (ERPNext Issues or a help desk)'), 'kb-sources': t('What answers come from (product docs, FAQ, past replies)'), 'support-policy': t('Channels, hours, SLAs and what only you decide') };
// the suggestion for the business type, and Finance when ERPNext is already there (1.7)
const suggestion = () => [...(s.st.suggest?.[s.a.business.type] || s.st.suggest?.other || []), ...Object.entries(s.st.suggestIf || {}).filter(([, h]) => s.a.have.includes(h)).map(([d]) => d)];
const defaultMode = (d) => (['legal', 'finance'].includes(d) ? 'manual' : 'supervised');

let s = null;   // { st (server state), step, a (answers being edited), busy, plan, edits, result }

const blank = () => ({ language: LANG, business: { type: '', name: '', description: '' }, goals: { picks: [], leads: '', revenue: '', launch: '' }, have: [], divisions: [], modes: {}, capacity: { machines: 'this', hours: 'day', budget: '' } });
const merge = (a, b) => ({ ...a, ...(b || {}), business: { ...a.business, ...(b?.business || {}) }, goals: { ...a.goals, ...(b?.goals || {}) }, capacity: { ...a.capacity, ...(b?.capacity || {}) }, modes: { ...(b?.modes || {}) } });

// where the guide opens: the saved step; after a build the divisions again, unless a plan was made since (on Telegram)
function fromState(st) {
  s = { st, step: Math.min(st.step || 0, STEPS.length - 1), a: merge(blank(), st.answers), busy: false, plan: st.plan, edits: {}, result: null };
  if (st.done && !(st.plan && st.planAt > Date.parse(st.builtAt || 0))) { s.step = Math.min(s.step, STEPS.indexOf('divisions')); s.plan = null; }   // built before: pick the divisions again, the plan is made fresh (what exists is skipped)
  if (s.step === STEPS.length - 1 && !s.plan) s.step = STEPS.length - 2;
}
// the same interview runs on Telegram (1.7): while the guide is open, what the owner answers there shows here
let watch = null;
function watchTelegram() {
  clearInterval(watch);
  watch = setInterval(async () => {
    if (!document.getElementById('cgForm')) { clearInterval(watch); return; }
    if (s.busy || s.result) return;
    try {
      const st = await api('GET', '/api/guide');
      if (st.updatedAt !== s.st.updatedAt && st.via === 'telegram') { fromState(st); draw(); toast(t('Updated from Telegram')); }
    } catch { /* next time */ }
  }, 4000);
}
ctx.actions.guide = async () => {
  try {
    fromState(await api('GET', '/api/guide'));
    draw();
    watchTelegram();
  } catch (e) { toast(e.message, 5000); }
};
// after the language reload, or the first time an owner opens an empty Building: open once
export function maybeOpen(b, me) {
  if (!b?.guide || me?.role !== 'owner') return;
  let resume = false; try { resume = sessionStorage.getItem('aisquad.guide.resume') === '1'; sessionStorage.removeItem('aisquad.guide.resume'); } catch { /* private mode */ }
  let dismissed = false; try { dismissed = localStorage.getItem('aisquad.guide.dismissed') === '1'; } catch { /* private mode */ }
  if (resume || (b.guide.firstRun && !dismissed && !document.getElementById('modal')?.open)) ctx.actions.guide();
}

const choice = (name, map, value, { multi = false } = {}) => `<div class="choice" data-choice="${esc(name)}" data-multi="${multi}">${Object.entries(map).map(([k, v]) => { const on = multi ? value.includes(k) : value === k; const [b, small] = Array.isArray(v) ? v : [v, '']; return `<button type="button" data-v="${esc(k)}" aria-pressed="${on}"><b>${esc(b)}</b>${small ? `<small>${esc(small)}</small>` : ''}</button>`; }).join('')}</div>`;

function stepHtml() {
  const a = s.a, id = STEPS[s.step];
  if (id === 'language') return `<p class="note">${t('Welcome. This guide asks a few questions about your business and builds your AI company from the answers: a squad per division, with targets, working hours and a list of what each squad needs from you. Nothing happens before you say "Build". First: which language do you want to work in?')}</p>
    ${choice('language', { en: ['English', 'The app, the Telegram bot and the agents talk to you in English'], id: ['Bahasa Indonesia', 'Aplikasi, bot Telegram dan agent bicara denganmu dalam bahasa Indonesia'] }, a.language)}`;
  if (id === 'business') return `<p class="note">${t('What is your business? Pick the closest; the squads are built from it.')}</p>${choice('type', TYPE, a.business.type)}
    <div class="grid2" style="margin-top:12px"><label>${t('Company or product name')}<input name="name" value="${esc(a.business.name)}" maxlength="60" placeholder="${esc(t('e.g. DTamu'))}" required></label>
    <label>${t('In one sentence, what do you sell and to whom?')}<input name="description" value="${esc(a.business.description)}" maxlength="300" placeholder="${esc(t('e.g. digital invitations and a guest book for weddings and corporate events'))}"></label></div>`;
  if (id === 'goals') return `<p class="note">${t('What should the company reach in the next 3 months? Pick one or two. A number helps: it becomes the first targets.')}</p>${choice('picks', GOAL, a.goals.picks, { multi: true })}
    <div class="grid2" style="margin-top:12px">
      ${a.goals.picks.includes('leads') ? `<label>${t('Leads per month')}<input name="leads" type="number" min="0" step="1" value="${esc(a.goals.leads ?? '')}" placeholder="50"></label>` : ''}
      ${a.goals.picks.includes('revenue') ? `<label>${t('Revenue per month ({currency})', { currency: a.language === 'id' ? 'IDR' : 'USD' })}<input name="revenue" type="number" min="0" step="1" value="${esc(a.goals.revenue ?? '')}"></label>` : ''}
      ${a.goals.picks.includes('launch') ? `<label>${t('What launches, and when?')}<input name="launch" value="${esc(a.goals.launch || '')}" maxlength="120" placeholder="${esc(t('e.g. the guest book app, December'))}"></label>` : ''}
    </div>`;
  if (id === 'have') return `<p class="note">${t('What do you already have? Everything you leave unticked becomes a task for the squads: they interview you and draft it for your approval.')}</p>${choice('have', HAVE, a.have, { multi: true })}`;
  if (id === 'divisions') {
    const sug = suggestion();
    return `<p class="note">${t('Which divisions should run? The suggestion fits your business; one division alone is fine. Each becomes a Space with its own squad.')}</p>${choice('divisions', DIVISION, a.divisions, { multi: true })}
      <p class="note">${t('Suggested for you: {list}.', { list: sug.map((d) => esc(DIVISION[d]?.[0] || d)).join(', ') })} <button type="button" class="small ghost" data-suggest>${t('Use the suggestion')}</button></p>`;
  }
  if (id === 'modes') return `<p class="note">${t('How much should each division do by itself? Money, contracts, production deploys, secrets and deleting data always wait for you, whatever you pick.')}</p>
    ${a.divisions.filter((d) => s.st.divisions.includes(d)).map((d) => `<div class="card"><b>${esc(DIVISION[d][0])}</b><div class="note" style="margin-bottom:6px">${esc(DIVISION[d][1])}</div>${segHtml(`mode:${d}`, Object.entries(MODE).map(([k, v]) => [k, v[0]]), a.modes[d] || defaultMode(d))}</div>`).join('')}
    <p class="note">${Object.values(MODE).map(([b, small]) => `<b>${esc(b)}</b>: ${esc(small)}`).join(' · ')}</p>`;
  if (id === 'capacity') return `<p class="note">${t('Where and when does the company work, and what may it spend on the AI per month?')}</p>
    <div class="grid2"><div><label>${t('Machines')}</label>${segHtml('machines', Object.entries(MACHINES), a.capacity.machines)}</div><div><label>${t('Working hours')}</label>${segHtml('hours', Object.entries(HOURS), a.capacity.hours)}</div></div>
    <label style="margin-top:12px">${t('AI budget per month (USD, optional; split across the divisions)')}<input name="budget" type="number" min="0" step="1" value="${esc(a.capacity.budget ?? '')}" placeholder="100" style="max-width:200px"></label>
    <p class="note">${t('At night the squads work 22:00–05:00 and their results are in your morning digest; the machine stays free for you by day.')}</p>
    ${s.st.hasClaude === false ? `<p class="note warnText">${t('Claude Code was not found on this machine: the plan will use the defaults, which you can edit.')}</p>` : ''}`;
  return planHtml();
}

// what a target behind its goal raises, and the mode's default (1.5)
const BEHIND = { off: t('nothing'), notify: t('a notice'), suggest: t('a plan to approve'), act: t('the agents act') };
const BEHIND_OF = { automatic: 'act', supervised: 'suggest', manual: 'notify' };
const EVERY = (e) => { const [k, d] = String(e).split(':'); return k === 'weekly' ? t('weekly, {day}', { day: d }) : k === 'monthly' ? t('monthly, day {day}', { day: d }) : k === 'weekdays' ? t('weekdays') : t('daily'); };
// where a target's number will come from (1.6): an integration here, or what to connect
function measuredHtml(k) {
  if (!k.requires) return '';
  const kind = esc(KIND[k.requires] || k.requires);
  return `<div class="note cgMeasure">${k.measure ? t('Measured from: {name}', { name: esc(k.measure.name) })
    : k.available ? t('Enter by hand for now: {name} can measure it once you mark its tool read-only (Admin → Integrations) and pick it in Admin → Targets', { name: esc(k.available) })
    : k.personal ? t('Enter by hand: {name} is your personal integration; a team Space needs a {kind} server in its own .mcp.json', { name: esc(k.personal), kind })
    : t('Enter by hand (connect {kind} to measure it)', { kind })}</div>`;
}
function planHtml() {
  if (s.result) return resultHtml();
  const p = s.plan;
  if (!p) return `<div class="empty">${t('No plan yet.')}</div>`;
  const e = s.edits;
  return `<p class="note">${p.source === 'claude' ? t('Claude Code wrote the summary and sharpened the targets; change anything you like.') : t('Claude Code was not available, so these are the defaults; change anything you like.')}</p>
    <label>${t('Summary')}<textarea name="summary" rows="3" maxlength="700">${esc(e.summary ?? p.summary ?? '')}</textarea></label>
    ${p.spaces.map((sp) => { const x = e.spaces?.[sp.division] || {}; return `<div class="card" data-space="${esc(sp.division)}"><div class="row wrap cgHead"><label class="inline" style="margin:0"><input type="checkbox" data-skip ${(x.skip ?? sp.skip) ? '' : 'checked'}> <b>${esc(DIVISION[sp.division]?.[0] || sp.division)}</b>${sp.exists ? ` <span class="note">${t('(already there)')}</span>` : ''}</label><input data-name value="${esc(x.name ?? sp.name)}" maxlength="60" class="grow" aria-label="${t('Space name')}"><select data-mode>${Object.entries(MODE).map(([k, v]) => `<option value="${k}" ${(x.mode || sp.mode) === k ? 'selected' : ''}>${esc(v[0])}</option>`).join('')}</select></div>
      <div class="note">${t('Blueprint {name}', { name: esc(sp.blueprint) })}${sp.access === 'owner' ? ` · ${t('Owner only')}` : ''}${sp.shift ? ` · ${t('at night')}` : ''}${sp.budget ? ` · ${t('{usd} USD per month', { usd: sp.budget })}` : ''}</div>
      <div class="grid2" style="margin-top:8px"><div><b class="note">${t('Starting targets')}</b>${sp.kpis.map((k) => `<label class="cgRow"><span class="grow">${esc(tx(k.name))}${k.why ? ` <span class="note">(${esc(k.why)})</span>` : ''}</span><input data-kpi="${esc(k.id)}" type="number" step="any" min="0" value="${esc(x.kpis?.[k.id] ?? k.target ?? '')}" placeholder="${t('no goal')}" style="width:110px"> <span class="note">${esc(k.unit)}</span></label>
        ${measuredHtml(k)}
        <label class="cgRow cgBehind"><span class="grow note">${t('when behind')}</span><select data-behind="${esc(k.id)}" aria-label="${t('When {name} is behind', { name: esc(tx(k.name)) })}">${Object.entries(BEHIND).map(([m, l]) => `<option value="${m}" ${(x.behind?.[k.id] || k.onBehind || 'notify') === m ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`).join('')}</div>
      <div><b class="note">${t('What the squad needs from you')}</b>${sp.materials.map((m, i) => { const id = m.id === 'custom' ? `custom-${i}` : m.id; return `<label class="cgRow"><span class="grow">${esc(m.label || MATERIAL[m.id] || m.id)}${m.why ? ` <span class="note">(${esc(m.why)})</span>` : ''}</span><select data-material="${esc(id)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${(x.materials?.[id] || m.status) === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`; }).join('')}</div></div>
      ${sp.routines?.length ? `<div style="margin-top:8px"><b class="note">${t('Routines (made off; you turn them on after the build)')}</b>${sp.routines.map((r) => `<label class="cgRow inline"><input type="checkbox" data-routine="${esc(r.id)}" ${(x.routines?.[r.id] ?? r.on) ? 'checked' : ''}> <span class="grow">${esc(tx(r.title))} <span class="note">· ${EVERY(r.every)} ${t('at')} ${esc(r.at)} · ${esc(r.agent)}</span></span></label>`).join('')}</div>` : ''}</div>`; }).join('')}
    ${p.later?.length ? `<p class="note">${t('Later, no squad yet in this version: {list}.', { list: p.later.map((d) => esc(DIVISION[d]?.[0] || d)).join(', ') })}</p>` : ''}
    <p class="note">${t('Build creates a folder and a git repository per Space under the squads folder, with its agents, targets and the materials list; the plan goes to the Company Brain where every agent reads it. Nothing starts running by itself: open a Space and start its lead when you are ready.')} ${t('Routines are made off: after the build, turn them on per Space here or in Admin → Cadence.')}</p>`;
}
function resultHtml() {
  const r = s.result;
  return `<p class="note">${t('Done. Your company is set up; open a Space and start its lead: it asks you for the materials that are missing first.')}</p>
    <ul class="list">${r.built.map((x) => `<li class="row">${x.error ? `<b class="grow">${esc(DIVISION[x.division]?.[0] || x.division)}</b><span class="badText">${esc(x.error)}</span>` : `<b class="grow">${x.number} · ${esc(x.name)}</b>${x.routines ? `<button type="button" class="small" data-enable="${esc(x.id)}">${t('Turn on routines ({n})', { n: x.routines })}</button>` : ''}<a class="small" href="#/floor/${esc(x.id)}" data-open>${t('Open')}</a>`}</li>`).join('')}</ul>
    <p class="note">${t('The plan is in the Company Brain: {file}. Run the guide again from the Lobby to add a division or change the goals.', { file: `<code>${esc(r.planFile)}</code>` })}</p>`;
}

function draw(error = '') {
  const last = s.step === STEPS.length - 1, first = s.step === 0;
  const body = openModal(`<div class="mHead"><h3 class="grow">${t('Set up the company')}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="steps wrap">${STEPS.map((x, i) => `<span class="${i === s.step ? 'on' : i < s.step ? 'done' : ''}">${i + 1}. ${STEP_TITLE[x]}</span>`).join('')}</div>
    <form class="mBody" id="cgForm" novalidate>${stepHtml()}</form>
    <div class="mFoot"><div class="err grow" id="cgErr">${esc(error)}</div>${!first && !s.result ? `<button class="ghost" data-back ${s.busy ? 'disabled' : ''}>${t('Back')}</button>` : ''}
      ${s.result ? `<button class="gold" data-close>${t('Close')}</button>` : `<button class="gold" data-next ${s.busy ? 'disabled' : ''}>${s.busy ? (last ? t('Building…') : s.step === STEPS.length - 2 ? t('Making the plan…') : t('Saving…')) : last ? t('Build') : s.step === STEPS.length - 2 ? t('Make the plan') : t('Next')}</button>`}</div>`, { onClose: () => { try { if (!s?.result) localStorage.setItem('aisquad.guide.dismissed', '1'); } catch { /* private mode */ } } });
  body.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => { closeModal(); if (s.result) ctx.refresh(); });
  body.querySelector('[data-back]')?.addEventListener('click', () => { collect(); s.step--; draw(); });
  body.querySelector('[data-next]')?.addEventListener('click', () => next());
  body.querySelector('#cgForm').addEventListener('submit', (e) => { e.preventDefault(); next(); });
  body.querySelectorAll('[data-choice] button').forEach((b) => b.addEventListener('click', () => {
    collect();
    const name = b.closest('[data-choice]').dataset.choice, v = b.dataset.v, multi = b.closest('[data-choice]').dataset.multi === 'true';
    if (name === 'language') { s.a.language = v; return next(); }
    if (name === 'type') s.a.business.type = v;
    if (name === 'picks') s.a.goals.picks = s.a.goals.picks.includes(v) ? s.a.goals.picks.filter((x) => x !== v) : [...s.a.goals.picks, v];
    if (name === 'have') s.a.have = s.a.have.includes(v) ? s.a.have.filter((x) => x !== v) : [...s.a.have, v];
    if (name === 'divisions') s.a.divisions = s.a.divisions.includes(v) ? s.a.divisions.filter((x) => x !== v) : [...s.a.divisions, v];
    if (!multi && name !== 'type') return;
    draw();
  }));
  body.querySelector('[data-suggest]')?.addEventListener('click', () => { collect(); s.a.divisions = suggestion(); draw(); });
  body.querySelectorAll('[data-space] [data-mode]').forEach((sel) => sel.addEventListener('change', () => {
    const card = sel.closest('[data-space]');
    card.querySelectorAll('[data-behind]').forEach((b) => { b.value = BEHIND_OF[sel.value]; });
    card.querySelectorAll('[data-routine]').forEach((c) => { c.checked = sel.value !== 'manual'; });
  }));
  body.querySelectorAll('[data-enable]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('POST', `/api/floors/${b.dataset.enable}/cadence/enable`, {}); b.textContent = t('Routines on'); } catch (e) { b.disabled = false; toast(e.message, 5000); }
  }));
  bindSegs(body, (name, v) => { if (name.startsWith('mode:')) s.a.modes[name.slice(5)] = v; if (name === 'machines') s.a.capacity.machines = v; if (name === 'hours') s.a.capacity.hours = v; });
  (body.querySelector('input[name=name]') || body.querySelector('input[name=budget]'))?.focus();
}

function collect() {
  const f = document.getElementById('cgForm'); if (!f) return;
  const v = (n) => f.elements[n]?.value?.trim() ?? '';
  const id = STEPS[s.step];
  if (id === 'business') { s.a.business.name = v('name'); s.a.business.description = v('description'); }
  if (id === 'goals') { s.a.goals.leads = v('leads'); s.a.goals.revenue = v('revenue'); s.a.goals.launch = v('launch'); }
  if (id === 'capacity') s.a.capacity.budget = v('budget');
  if (id === 'plan' && s.plan) {
    const e = { summary: v('summary'), spaces: {} };
    f.querySelectorAll('[data-space]').forEach((el) => {
      const d = el.dataset.space, kpis = {}, materials = {};
      el.querySelectorAll('[data-kpi]').forEach((i) => { kpis[i.dataset.kpi] = i.value; });
      el.querySelectorAll('[data-material]').forEach((i) => { materials[i.dataset.material] = i.value; });
      const behind = {}, routines = {};
      el.querySelectorAll('[data-behind]').forEach((i) => { behind[i.dataset.behind] = i.value; });
      el.querySelectorAll('[data-routine]').forEach((i) => { routines[i.dataset.routine] = i.checked; });
      e.spaces[d] = { skip: !el.querySelector('[data-skip]').checked, name: el.querySelector('[data-name]').value, mode: el.querySelector('[data-mode]').value, kpis, materials, behind, routines };
    });
    s.edits = e;
  }
}

async function next() {
  if (s.busy) return;                                           // Enter on a one-field step must not submit twice
  collect();
  const id = STEPS[s.step], a = s.a;
  if (id === 'business' && !a.business.type) return draw(t('Pick what your business is.'));
  if (id === 'business' && !a.business.name) return draw(t('Give the company or product a name.'));
  if (id === 'goals' && !a.goals.picks.length) return draw(t('Pick at least one goal.'));
  if (id === 'divisions' && !a.divisions.some((d) => s.st.divisions.includes(d))) return draw(t('Pick at least one division that has a squad.'));
  s.busy = true; draw();
  try {
    if (id === 'plan') {
      const e = s.edits;
      const body = { summary: e.summary, spaces: Object.entries(e.spaces || {}).map(([division, x]) => ({ division, skip: x.skip, name: x.name, mode: x.mode, kpis: Object.entries(x.kpis).map(([k, target]) => ({ id: k, target: target === '' ? null : +target, ...(x.behind?.[k] ? { onBehind: x.behind[k] } : {}) })), routines: Object.entries(x.routines || {}).map(([id, on]) => ({ id, on })), materials: Object.entries(x.materials).map(([k, status]) => ({ id: k, status })) })) };
      s.result = await api('POST', '/api/guide/build', body);
      s.busy = false; toast(t('Company set up')); return draw();
    }
    const nextStep = s.step + 1;
    s.st = await api('PUT', '/api/guide', { answers: a, step: nextStep });
    if (id === 'language' && a.language !== LANG) { try { sessionStorage.setItem('aisquad.guide.resume', '1'); } catch { /* private mode */ } return setLang(a.language); }
    if (STEPS[nextStep] === 'plan') { s.plan = await api('POST', '/api/guide/plan', {}); s.edits = {}; }
    s.step = nextStep; s.busy = false; draw();
  } catch (e) { s.busy = false; draw(e.message); }
}
