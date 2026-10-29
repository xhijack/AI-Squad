// SPDX-License-Identifier: Apache-2.0
// The Company Guide (1.4): the first thing a new owner meets. A short interview in the owner's language (what the
// business is, what it should reach, what already exists, which divisions, how much runs by itself, the machine and
// the budget), then a plan in plain words: the Spaces to build, their starting targets, what runs automatically and
// what waits for the owner, and the materials each division needs. "Build" creates it all: the plan goes to the
// Company Brain (PLAN.md, read by every agent), each Space gets its materials list (docs/squad/MATERIALS.md) and its
// targets. Claude Code (haiku) sharpens the plan when it is there (a summary, target numbers, materials specific to
// the business); without it the plan is the defaults, and the guide still works. The answers and the plan live in
// ~/.aisquad/guide.json (the owner's; never in a repository). A division whose Blueprint is gone is listed as
// "later", never built. The guide can be run again any time (add a division, change the goals). Since 1.7 every
// division has a Blueprint (Finance, Owner-only; Support), and the same interview runs on Telegram (server/guide-tg.js).
import fs from 'node:fs';
import path from 'node:path';
import { config, claudeBin } from './config.js';
import * as building from './building.js';
import * as blueprints from './blueprints.js';
import * as company from './company.js';
import * as floors from './floors.js';
import * as setup from './setup.js';
import * as kpi from './kpi.js';
import * as integ from './integrations.js';
import * as cadence from './cadence.js';
import { membersFor, defaultPicks, runClaude } from './recommend.js';
import { readJson, writeJson, writeText, kebab, clip, oneLine, bad } from './util.js';

export const LANGUAGES = ['en', 'id'];
export const TYPES = ['saas', 'erp-consultant', 'consultant', 'software-house', 'agency', 'clinic', 'retail', 'other'];
export const GOALS = ['revenue', 'leads', 'launch', 'cost', 'service'];
export const HAVE = ['products', 'brand', 'website', 'social', 'erpnext', 'tools', 'repos', 'team', 'legal'];
export const MODES = ['automatic', 'supervised', 'manual'];
export const HOURS = ['day', 'night', 'always'];
export const MACHINES = ['this', 'more'];
// division -> Blueprint; the delivery division depends on the business (software or ERP implementation)
export const DIVISIONS = { product: 'product', engineering: 'software-house', implementation: 'erp-consultant', marketing: 'digital-marketing', sales: 'sales-crm', legal: 'legal', finance: 'finance', support: 'support' };
export const LATER = [];                                      // divisions without a Blueprint: shown, never built (none since 1.7)
const TITLE = { product: 'Product', engineering: 'Engineering', implementation: 'Implementation', marketing: 'Marketing', sales: 'Sales', legal: 'Legal', finance: 'Finance', support: 'Support' };
export const SUGGEST = {
  saas: ['product', 'engineering', 'marketing', 'sales', 'support', 'legal'],
  'erp-consultant': ['implementation', 'sales', 'marketing', 'support', 'legal'],
  consultant: ['sales', 'marketing', 'legal'],
  'software-house': ['engineering', 'sales', 'marketing', 'support', 'legal'],
  agency: ['marketing', 'sales', 'legal'],
  clinic: ['marketing', 'sales', 'legal'],
  retail: ['marketing', 'sales', 'legal'],
  other: ['marketing', 'sales', 'legal'],
};
// Finance is suggested to every business that already runs ERPNext (it reads the books there)
export const SUGGEST_IF = { finance: 'erpnext' };
export const suggestFor = (type, have = []) => [...(SUGGEST[type] || SUGGEST.other), ...Object.entries(SUGGEST_IF).filter(([, h]) => have.includes(h)).map(([d]) => d)];
// Legal and Finance start manual: the owner decides everything there
const OWNER_DESKS = ['legal', 'finance'];
export const defaultMode = (division) => (OWNER_DESKS.includes(division) ? 'manual' : 'supervised');
const AUTOPILOT = { automatic: 'full', supervised: 'balanced', manual: 'off' };
const BEHIND = { automatic: 'act', supervised: 'suggest', manual: 'notify' };       // what a target behind its goal raises (1.5)
export const STEPS = ['language', 'business', 'goals', 'have', 'divisions', 'modes', 'capacity', 'plan'];
// what every division needs from the owner; `have` answers mark what is there, the rest is missing or later
const MATERIALS = {
  product: [['product-description', 'products'], ['user-feedback', null], ['competitors', null]],
  engineering: [['repos', 'repos'], ['deploy-access', 'later'], ['prd', null]],
  implementation: [['erpnext', 'erpnext'], ['business-requirements', null], ['master-data', null]],
  marketing: [['brand', 'brand'], ['website', 'website'], ['social-accounts', 'social'], ['analytics', 'later']],
  sales: [['price-list', 'products'], ['erpnext', 'erpnext'], ['lead-sources', 'website'], ['inbox', 'later']],
  legal: [['contract-templates', 'have'], ['company-documents', 'legal']],
  finance: [['erpnext', 'erpnext'], ['finance-key', null], ['bank-statements', null], ['finance-policy', null]],
  support: [['ticket-source', 'tools'], ['kb-sources', 'products'], ['support-policy', null]],
};
const file = () => path.join(config.home, 'guide.json');
const hasClaude = () => { const b = claudeBin(); return b.includes('/') ? fs.existsSync(b) : String(process.env.PATH || '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, b))); };

export const deps = { ask: (prompt, opts) => runClaude(prompt, opts), log: () => {} };

// ---------- answers ----------
const pickList = (list, allowed) => (Array.isArray(list) ? [...new Set(list.map(String).filter((x) => allowed.includes(x)))] : []);
const num = (v) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100; };
export function cleanAnswers(a = {}) {
  const b = a.business || {}, g = a.goals || {}, c = a.capacity || {};
  const type = TYPES.includes(b.type) ? b.type : 'other';
  const divisions = pickList(a.divisions, [...Object.keys(DIVISIONS), ...LATER]);
  const modes = {};
  for (const d of divisions) if (DIVISIONS[d]) modes[d] = MODES.includes(a.modes?.[d]) ? a.modes[d] : defaultMode(d);
  return {
    language: LANGUAGES.includes(a.language) ? a.language : 'en',
    business: { type, name: oneLine(b.name || '', 60), description: oneLine(b.description || '', 300) },
    goals: { picks: pickList(g.picks, GOALS), revenue: num(g.revenue), currency: a.language === 'id' ? 'IDR' : 'USD', leads: num(g.leads), launch: oneLine(g.launch || '', 120) },
    have: pickList(a.have, HAVE),
    divisions, modes,
    capacity: { machines: MACHINES.includes(c.machines) ? c.machines : 'this', hours: HOURS.includes(c.hours) ? c.hours : 'day', budget: num(c.budget) },
  };
}
export const load = () => { const j = readJson(file(), null); return j && typeof j === 'object' && !Array.isArray(j) ? { built: {}, ...j } : { answers: null, plan: null, done: false, step: 0, built: {} }; };
// every save is stamped, so the web and Telegram (1.7) see that the other side moved on
const save = (st, via = '') => writeJson(file(), { ...st, updatedAt: Date.now(), via }, 0o600);
// the state the UI shows: where the owner is, the answers so far, the plan, whether it was built
export function state() {
  const st = load();
  return { step: Number(st.step) || 0, answers: st.answers || null, plan: st.plan || null, done: !!st.done, builtAt: st.builtAt || null, suggest: SUGGEST, suggestIf: SUGGEST_IF, divisions: Object.keys(DIVISIONS), later: LATER, hasClaude: hasClaude(), updatedAt: st.updatedAt || 0, planAt: st.planAt || 0, via: st.via || '' };
}
export function answer(partial, step, { via = 'web' } = {}) {
  const st = load();
  st.answers = cleanAnswers({ ...(st.answers || {}), ...(partial || {}) });
  if (step !== undefined) st.step = Math.max(0, Math.min(STEPS.length - 1, Number(step) || 0));
  st.plan = null;                                              // the plan follows the answers
  save(st, via);
  setLanguage(st.answers.language);
  return state();
}
// the owner's language: the app's default, the Telegram bot's, and every agent's when it talks to the owner
export function setLanguage(language) {
  const prefs = building.loadBuilding().prefs;
  if (prefs.language === language) return false;
  building.setPrefs({ language, notify: { ...(prefs.notify || {}), lang: language } });   // notify cleans its settings when it reads them
  for (const f of building.loadBuilding().floors) { try { floors.generate(f.path); } catch { /* a Space without files */ } }   // the context line in every agent file
  return true;
}
export function reset() { save({ answers: null, plan: null, done: false, step: 0 }); return state(); }

// ---------- the plan ----------
const kpiGoal = (bp, k, a) => {
  const month = (n) => (n == null || n <= 0 ? null : Math.round(n));
  if (bp === 'digital-marketing') return { leads: month(a.goals.leads), posts: 3, engagement: null, 'organic-traffic': null }[k.id] ?? null;
  if (bp === 'sales-crm') return { 'new-leads': month(a.goals.leads), 'response-time': 24, won: null }[k.id] ?? null;
  if (bp === 'software-house') return { uptime: 99.5, 'open-bugs': 5, 'stories-done': null }[k.id] ?? null;
  if (bp === 'product') return { 'feedback-handled': 5 }[k.id] ?? null;
  if (bp === 'support') return { 'first-response': 24, csat: 90 }[k.id] ?? null;
  if (bp === 'finance') return { 'days-to-close': 5 }[k.id] ?? null;
  return null;
};
const materialsFor = (division, a) => (MATERIALS[division] || []).map(([id, when]) => ({ id, status: when === 'have' ? 'have' : when === 'later' ? 'later' : when && a.have.includes(when) ? 'have' : 'missing' }));
// the deterministic plan from the answers: every Space with its Blueprint, mode, shift, budget, targets and materials
// a division the guide built before (its Space is still registered), or a Space with the name the guide would give
function existingSpace(division, spaceName, built) {
  const b = building.loadBuilding();
  const id = built?.[division]?.id;
  if (id && b.floors.some((f) => f.id === id)) return true;
  return b.floors.some((f) => readJson(path.join(f.path, '.claude', 'aisquad', 'floor.json'), {})?.name === spaceName);
}
// the owner's hours beat the Blueprint's; a manual squad has no automated work to time, so no shift for it
const shiftFor = (hours, mode) => (hours === 'night' && mode !== 'manual' ? { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '05:00' } : null);
// the rhythm (1.5): the Blueprint's routines, moved into the owner's hours (a night squad works 22:00-05:00, a day
// squad not at night); a manual squad gets them unticked, since nothing runs by itself there
const NIGHT_AT = ['22:30', '23:00', '23:30', '00:00', '00:30'], DAY_AT = ['08:30', '09:00', '09:30', '10:00', '10:30'];
const atNight = (at) => at >= '22:00' || at < '05:00';
const routineAt = (at, hours, i) => (hours === 'night' && !atNight(at) ? NIGHT_AT[i % 5] : hours === 'day' && atNight(at) ? DAY_AT[i % 5] : at);
const routinesFor = (bp, hours, mode) => (bp.cadence || []).map((r, i) => ({ id: kebab(r.id || r.title, 40), title: String(r.title), agent: String(r.agent || ''), every: String(r.every || 'daily'), at: routineAt(String(r.at || '09:00'), hours, i), on: mode !== 'manual' }));
const withMode = (sp, hours, bp) => {
  sp.routines = routinesFor(bp, hours, sp.mode);
  for (const k of sp.kpis) k.onBehind = BEHIND[sp.mode];
};
// a target the Blueprint would measure from an integration (1.6): the integration here that does it, or what to
// connect; the target stays manual until then
function measuredBy(k, space) {
  if (!kpi.REQUIRES.test(k.requires || '')) return {};
  const kind = k.requires.slice(4);
  try { return { requires: kind, ...integ.match(kind, space, k.mcp || null) }; } catch { return { requires: kind }; }
}
// the budget per Space: the monthly budget over the Spaces this build makes
const splitBudget = (p) => { const n = p.spaces.filter((s) => !s.skip).length; const each = p.capacity.budget && n ? Math.round((p.capacity.budget / n) * 100) / 100 : 0; for (const s of p.spaces) s.budget = s.skip ? 0 : each; };
export function draftPlan(a, built = load().built) {
  const name = a.business.name || 'My company';
  const later = a.divisions.filter((d) => LATER.includes(d));
  const spaces = [];
  for (const division of a.divisions.filter((d) => DIVISIONS[d])) {
    let bp; try { bp = blueprints.getBlueprint(DIVISIONS[division]); } catch { later.push(division); continue; }   // a Blueprint removed from the library
    const spaceName = clip(`${name} ${TITLE[division]}`, 60);
    const mode = a.modes[division] || defaultMode(division);    // Finance is always the Owner's, whatever its Blueprint says
    spaces.push({
      division, blueprint: bp.id, name: spaceName, mode, autopilot: AUTOPILOT[mode], access: division === 'finance' ? 'owner' : bp.space.access || 'team', shift: shiftFor(a.capacity.hours, mode), budget: 0,
      ...(existingSpace(division, spaceName, built) ? { exists: true, skip: true } : {}),   // run again: a Space that is already there is not built twice
      kpis: bp.kpis.map((k) => ({ id: kebab(k.id || k.name, 40), name: k.name, unit: k.unit || '', target: kpiGoal(bp.id, { ...k, id: kebab(k.id || k.name, 40) }, a), onBehind: BEHIND[mode], ...measuredBy(k, { id: '', access: bp.space.access || 'team' }) })),
      routines: routinesFor(bp, a.capacity.hours, mode),
      materials: materialsFor(division, a),
    });
  }
  const p = { company: { name, type: a.business.type, description: a.business.description, language: a.language }, goals: a.goals, capacity: a.capacity, spaces, later, summary: '', source: 'defaults' };
  splitBudget(p);
  return p;
}
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'targets', 'materials'],
  properties: {
    summary: { type: 'string' },
    targets: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['space', 'kpi', 'target', 'why'], properties: { space: { type: 'string' }, kpi: { type: 'string' }, target: { type: 'number' }, why: { type: 'string' } } } },
    materials: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['space', 'item', 'why'], properties: { space: { type: 'string' }, item: { type: 'string' }, why: { type: 'string' } } } },
  },
};
export function claudePrompt(plan) {
  const g = plan.goals;
  return [
    'You help a small company owner set up an AI agent company (The AI Squad). From the interview below, write a plan summary and sharpen the starting targets. Be concrete and modest; never promise results.',
    `Language of the summary: ${plan.company.language === 'id' ? 'Bahasa Indonesia' : 'English'}. Business: ${plan.company.type}, "${plan.company.name}". ${plan.company.description}`,
    `Goals: ${g.picks.join(', ') || 'not stated'}${g.revenue ? `; revenue ${g.revenue} ${g.currency} per month` : ''}${g.leads ? `; ${g.leads} leads per month` : ''}${g.launch ? `; launch: ${g.launch}` : ''}.`,
    `Works ${plan.capacity.hours}, ${plan.capacity.machines === 'more' ? 'more machines later' : 'one machine'}${plan.capacity.budget ? `, API budget ${plan.capacity.budget} USD per month` : ''}.`,
    '', 'Spaces (division: Blueprint, mode; targets with their current suggested goal or null):',
    ...plan.spaces.map((s) => `- ${s.division} (${s.blueprint}, ${s.mode}): ${s.kpis.map((k) => `${k.id} [${k.unit || 'count'}] = ${k.target ?? 'null'}`).join(', ')}`),
    '', 'Answer with JSON only: {"summary": one paragraph (max 90 words) in the language above, "targets": [{"space": division, "kpi": id, "target": number, "why": short}] only for targets you can justify from the goals (leave the rest out), "materials": [{"space": division, "item": one short line, "why": short}] at most 3 items the owner should prepare that are specific to this business and not generic}.',
  ].join('\n');
}
// the plan with Claude's touch when it is available; the defaults otherwise
export async function plan({ useClaude = true, via = 'web' } = {}) {
  const st = load();
  if (!st.answers) throw bad('Answer the guide first');
  const a = cleanAnswers(st.answers);
  if (!a.divisions.some((d) => DIVISIONS[d])) throw bad('Pick at least one division that can be built');
  const p = draftPlan(a);
  if (useClaude) {
    try {
      const r = await deps.ask(claudePrompt(p), { schema: SCHEMA });
      if (r && typeof r === 'object') {
        p.summary = oneLine(r.summary || '', 700).replace(/^#+\s*/, '');
        for (const t of Array.isArray(r.targets) ? r.targets : []) { const sp = p.spaces.find((s) => s.division === t.space); const k = sp?.kpis.find((x) => x.id === t.kpi); if (k && Number.isFinite(Number(t.target)) && Number(t.target) >= 0) { k.target = Math.round(Number(t.target) * 100) / 100; k.why = oneLine(t.why || '', 120); } }
        for (const m of (Array.isArray(r.materials) ? r.materials : []).slice(0, 3)) { const sp = p.spaces.find((s) => s.division === m.space); if (sp && m.item) sp.materials.push({ id: 'custom', label: oneLine(m.item, 100), why: oneLine(m.why || '', 120), status: 'missing' }); }
        p.source = 'claude';
      }
    } catch { /* the defaults stand */ }
  }
  st.plan = p; st.step = STEPS.length - 1; st.planAt = Date.now();
  save(st, via);
  return p;
}
// the owner's edits on the plan page: names, goals, materials statuses, modes
export function cleanPlan(input, base) {
  const p = JSON.parse(JSON.stringify(base));
  const edits = Array.isArray(input?.spaces) ? input.spaces : [];
  for (const e of edits) {
    const sp = p.spaces.find((s) => s.division === e.division);
    if (!sp) continue;
    if (e.name !== undefined) sp.name = clip(oneLine(e.name, 60) || sp.name, 60);
    if (MODES.includes(e.mode) && e.mode !== sp.mode) {
      sp.mode = e.mode; sp.autopilot = AUTOPILOT[e.mode]; sp.shift = shiftFor(p.capacity?.hours, e.mode);
      try { withMode(sp, p.capacity?.hours, blueprints.getBlueprint(sp.blueprint)); } catch { /* the Blueprint is gone: keep the rest */ }
    }
    if (e.skip !== undefined) sp.skip = !!e.skip;
    for (const k of Array.isArray(e.kpis) ? e.kpis : []) {
      const x = sp.kpis.find((y) => y.id === k.id);
      if (x && k.target !== undefined) x.target = num(k.target);
      if (x && kpi.ON_BEHIND.includes(k.onBehind)) x.onBehind = k.onBehind;                          // 'off': the owner unticked it
    }
    for (const r of Array.isArray(e.routines) ? e.routines : []) { const x = (sp.routines || []).find((y) => y.id === r.id); if (x && r.on !== undefined) x.on = !!r.on; }
    for (const m of Array.isArray(e.materials) ? e.materials : []) { const x = sp.materials.find((y, i) => (y.id === 'custom' ? `custom-${i}` : y.id) === m.id); if (x && ['have', 'missing', 'later'].includes(m.status)) x.status = m.status; }
  }
  if (input?.summary !== undefined) p.summary = oneLine(input.summary, 700);
  p.summary = p.summary.replace(/^#+\s*/, '');
  splitBudget(p);
  return p;
}

// ---------- the documents ----------
const LABEL = {
  'product-description': 'Product description (what it does, for whom, the price)', 'user-feedback': 'User feedback (support messages, reviews, interviews)', competitors: 'Competitors you know',
  repos: 'The code repositories (or where the code lives)', 'deploy-access': 'How staging and production are deployed (no secrets in files)', prd: 'A PRD or a feature list for the first sprint',
  erpnext: 'ERPNext: the site address and a sales key (Admin → ERPNext)', 'business-requirements': 'Business requirements (processes, reports, who does what)', 'master-data': 'Master data (customers, items, chart of accounts)',
  brand: 'Brand rules (voice, colours, logo, words to use and to avoid)', website: 'The website (address, who can change it)', 'social-accounts': 'Social media accounts (which, who posts)', analytics: 'Analytics (GA4 or similar) for the traffic target',
  'price-list': 'Price list and discount rules (Owner only: pricing/ in the Company Brain)', 'lead-sources': 'Where leads come from (forms, WhatsApp, marketplace)', inbox: 'A shared inbox or WhatsApp for lead replies',
  'contract-templates': 'Contract templates (the bilingual ones are in the Company Brain)', 'company-documents': 'Company documents (deed, NPWP, signatory)',
  'finance-key': 'A read-only ERPNext finance key (Admin → ERPNext → Finance; docs/ERPNEXT.md)', 'bank-statements': 'Bank statements each month (placed in docs/finance/bank/; agents never log in to a bank)', 'finance-policy': 'Approval limits, who pays, the close and tax calendars, the budget',
  'ticket-source': 'Where the tickets live (ERPNext Issues or a help desk connected as an integration)', 'kb-sources': 'What answers come from (product docs, FAQ, past replies without personal data)', 'support-policy': 'Channels, hours, SLAs per priority and what only the owner decides',
};
const STATUS_TEXT = { have: 'available: ask the owner where it is', missing: 'missing: interview the owner and draft it for approval', later: 'later: not needed for the first weeks' };
const MODE_TEXT = { automatic: 'automatic: routine work runs and ships by itself; money, legal, production, secrets and deleting data still wait for the owner', supervised: 'supervised: the squad prepares, the owner approves what goes out', manual: 'manual: the squad drafts only; the owner decides everything' };
const cell = (s) => String(s ?? '').replace(/\|/g, '/');
const BEHIND_TEXT = { notify: 'a notice to the owner', suggest: 'a plan for the owner to approve', act: 'the agents act on it', off: 'nothing' };
// a routine in plain words: "Daily content draft: every day at 22:30, by the marketing-strategist"
export const rhythmLines = (sp) => (sp.routines || []).filter((r) => r.on).map((r) => `${cell(r.title)}: ${cadence.everyText(r.every)} at ${r.at}, by the ${cell(r.agent)}`);
// the plan as every agent reads it; `built` (from guide.json) keeps the Spaces an earlier run made in the table
export function planMarkdown(p, built = {}) {
  const g = p.goals;
  const registered = (b) => b && building.loadBuilding().floors.some((f) => f.id === b.id);
  const rows = [];
  for (const s of p.spaces) {                                   // a Space built before is shown as it was built, not as the new answers would make it
    if (s.skip && !s.exists) continue;
    const b = s.exists && registered(built[s.division]) ? built[s.division] : null;
    rows.push(b ? { division: s.division, name: b.name, mode: b.mode, access: b.access, targets: b.targets || '', rhythm: b.rhythm || [], behind: b.behind || '' } : { division: s.division, name: s.name, mode: s.mode, access: s.access, targets: s.kpis.map((k) => `${cell(k.name)}${k.target != null ? `: ${k.target}${k.unit ? ` ${cell(k.unit)}` : ''}` : ''}`).join('; '), rhythm: rhythmLines(s), behind: BEHIND[s.mode] });
  }
  for (const [division, b] of Object.entries(built)) if (!rows.some((r) => r.division === division) && registered(b)) rows.push({ division, name: b.name, mode: b.mode, access: b.access, targets: b.targets || '', rhythm: b.rhythm || [], behind: b.behind || '' });
  const modes = [...new Set(rows.map((r) => r.mode))];
  return ['# Company plan', '', '<!-- GENERATED by The AI Squad\'s Company Guide: the owner answers the guide again to change it. -->', '',
    `**${cell(p.company.name)}** (${p.company.type})${p.company.description ? `: ${cell(p.company.description)}` : ''}`, '',
    ...(p.summary ? [p.summary, ''] : []), '## Goals', '',
    ...(g.picks.length ? g.picks.map((x) => `- ${x}${x === 'revenue' && g.revenue ? `: ${g.revenue} ${g.currency} per month` : x === 'leads' && g.leads ? `: ${g.leads} per month` : x === 'launch' && g.launch ? `: ${cell(g.launch)}` : ''}`) : ['- not stated yet']), '',
    `The owner talks with the squads in ${p.company.language === 'id' ? 'Bahasa Indonesia' : 'English'}. Working hours: ${p.capacity.hours}; ${p.capacity.machines === 'more' ? 'more machines later' : 'one machine'}${p.capacity.budget ? `; API budget ${p.capacity.budget} USD per month across the Spaces` : ''}.`, '',
    '## Divisions', '', '| Division | Space | Mode | Starting targets |', '|---|---|---|---|',
    ...rows.map((r) => `| ${TITLE[r.division] || r.division} | ${cell(r.name)}${r.access === 'owner' ? ' (Owner only)' : ''} | ${r.mode} | ${r.targets} |`),
    ...(p.later.length ? ['', `Later (no squad yet): ${p.later.map((d) => TITLE[d] || d).join(', ')}.`] : []), '',
    '## Rhythm', '', 'The routines each Space runs by itself, once the owner turns them on (Admin → Cadence). When a target is behind its goal the Space raises it: a notice, a recovery plan for the owner to approve, or the work itself.', '',
    ...rows.flatMap((r) => [`**${cell(r.name)}** (when a target is behind: ${BEHIND_TEXT[r.behind] || 'nothing'})`, ...(r.rhythm?.length ? r.rhythm.map((l) => `- ${l}`) : ['- no routines']), '']),
    '## What runs by itself and what waits for the owner', '', ...modes.map((m) => `- ${MODE_TEXT[m] || m}`), '',
    'Hard stops in every Space: spending money, contracts and legal commitments, production deploys, secrets, deleting data, and anything irreversible.', ''].join('\n');
}
export function materialsMarkdown(sp) {
  return ['# Materials this Space needs', '', '<!-- GENERATED by The AI Squad\'s Company Guide. The lead keeps the status column current. -->', '',
    'Before real work, the lead asks the owner for what is missing and drafts it in `docs/` for approval. Never invent a material.', '',
    '| Material | Status |', '|---|---|',
    ...sp.materials.map((m) => `| ${cell(m.label || LABEL[m.id] || m.id)}${m.why ? ` (${cell(m.why)})` : ''} | ${STATUS_TEXT[m.status] || m.status} |`), ''].join('\n');
}

// ---------- build ----------
let inflight = false;
export async function build(input = {}, { create = setup.createSquad } = {}) {
  const st = load();
  if (!st.plan || !Array.isArray(st.plan.spaces)) throw bad('Make the plan first');
  const p = cleanPlan(input, st.plan);
  if (!p.spaces.some((s) => !s.skip)) throw bad('Pick at least one Space to build');
  if (inflight) throw bad('A build is already running');
  inflight = true;
  try { return await buildAll(st, p, create); } finally { inflight = false; }
}
async function buildAll(st, p, create) {
  const dir = company.companyDir(building.loadBuilding().prefs);
  company.ensure(dir);
  writeText(path.join(dir, 'PLAN.md'), planMarkdown(p, st.built));   // before the Spaces, so their agent files point to it; again after, with every Space built
  const templates = blueprints.catalog();
  const out = [];
  for (const sp of p.spaces.filter((s) => !s.skip)) {
    const bp = blueprints.getBlueprint(sp.blueprint);
    const team = membersFor(bp, defaultPicks(bp), templates).map((m) => ({ template: m.template, displayName: m.displayName, lead: m.lead }));
    try {
      const r = await create({ blueprint: bp.id, name: sp.name, goal: `${p.company.name}: ${TITLE[sp.division]}. ${p.summary || p.company.description || ''}`.trim(), team, autopilot: sp.autopilot, budget: sp.budget ? { usd: sp.budget, period: 'month' } : undefined, installSkills: true });
      const root = r.path;
      floors.updateFloorConfig(root, { shift: sp.shift || { enabled: false }, ...(sp.division === 'finance' ? { access: 'owner', erpnext: 'finance', telegram: 'counts' } : {}) });
      for (const k of sp.kpis) { try { kpi.updateKpi(root, k.id, { ...(k.target != null ? { target: k.target } : {}), ...(k.onBehind ? { onBehind: { mode: k.onBehind } } : {}) }); } catch { /* not seeded */ } }
      // measured from the integration the plan named; it stays manual when that is not possible any more
      for (const k of sp.kpis.filter((x) => x.measure)) { try { kpi.updateKpi(root, k.id, { every: 'hour', source: { kind: 'mcp', server: k.measure.server, tool: k.measure.tool, args: k.measure.args, pick: k.measure.pick } }); } catch { /* the integration changed */ } }
      // the routines: the Blueprint seeded them off; the planned time, the unticked ones removed; nothing runs yet
      const planned = new Map((sp.routines || []).map((x) => [x.id, x]));
      for (const x of cadence.readDefs(root)) { const want = planned.get(x.id); try { if (want && !want.on) cadence.remove(root, x.id); else if (want) cadence.update(root, x.id, { at: want.at, enabled: false }); } catch { /* hand-edited */ } }
      writeText(path.join(root, 'docs', 'squad', 'MATERIALS.md'), materialsMarkdown(sp));
      kpi.render(root, r.id);
      floors.generate(root);
      out.push({ division: sp.division, id: r.id, number: r.number, name: sp.name, path: root, lead: r.lead, routines: cadence.readDefs(root).length });
      st.built[sp.division] = { id: r.id, name: sp.name, mode: sp.mode, access: sp.access, targets: sp.kpis.map((k) => `${cell(k.name)}${k.target != null ? `: ${k.target}${k.unit ? ` ${cell(k.unit)}` : ''}` : ''}`).join('; '), rhythm: rhythmLines(sp), behind: BEHIND[sp.mode] };
      deps.log(r.id, { type: 'guide.built', data: { division: sp.division, blueprint: bp.id, mode: sp.mode, targets: sp.kpis.filter((k) => k.target != null).length, routines: (sp.routines || []).filter((x) => x.on).length } });
    } catch (e) { out.push({ division: sp.division, name: sp.name, error: e.message }); }
  }
  writeText(path.join(dir, 'PLAN.md'), planMarkdown(p, st.built));
  const ok = out.some((x) => !x.error);
  st.plan = p; st.done = st.done || ok; if (ok) st.builtAt = new Date().toISOString();
  save(st);
  return { built: out, plan: p, planFile: path.join(dir, 'PLAN.md') };
}
