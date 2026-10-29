// SPDX-License-Identifier: Apache-2.0
// Model tiering (0.20): background jobs run on the model their work needs instead of always the role's own.
//   light     routine work: qualifying a lead, answering a clarify, filing a result, social posts, CRM upkeep
//   standard  most work: writing, building, analysing
//   deep      planning, architecture, reviews that decide
// A role has a tier; a routine job (a lead, a reply, a done) goes one tier lighter. The Legal roles are pinned to
// their own model, and an agent whose model the owner set by hand keeps it. Desk sessions (where you work with the
// agent) always keep the role's model. Off by default; Admin → Dispatcher shows the cost per job before and after.
import * as building from './building.js';
import * as jobsLib from './jobs.js';

export const TIERS = ['light', 'standard', 'deep'];
export const DEFAULT_MODELS = { light: 'haiku', standard: 'sonnet', deep: 'opus' };
export const PINNED = new Set(['legal-counsel', 'contract-drafter']);
// the tier of each shipped role; any other role is standard
export const ROLE_TIER = {
  'project-manager': 'deep', 'sprint-lead': 'deep', 'second-opinion-reviewer': 'deep', 'security-engineer': 'deep',
  'marketing-strategist': 'standard', 'sales-manager': 'standard', 'fullstack-developer': 'standard', 'frappe-developer': 'standard', 'sprint-developer': 'standard',
  'qa-engineer': 'standard', 'sprint-qa': 'standard', 'devops-engineer': 'standard', 'ui-ux-designer': 'standard', 'content-writer': 'standard', 'sales-copywriter': 'standard', 'seo-specialist': 'standard',
  'lead-researcher': 'light', 'crm-administrator': 'light', 'sales-analyst': 'light', 'social-media-specialist': 'light', 'ads-analytics-specialist': 'light',
};
export const LIGHT_KINDS = new Set(['lead', 'clarify', 'answer', 'done']);      // handoff packages that are routine

export function cleanTiering(t = {}) {
  const models = { ...DEFAULT_MODELS };
  for (const k of TIERS) if (/^[a-z][\w.-]{1,40}$/.test(String(t?.models?.[k] || ''))) models[k] = t.models[k];
  return { enabled: t?.enabled === true, models, since: Number(t?.since) || 0 };
}
export const settings = () => cleanTiering(building.loadBuilding().prefs.tiering);
export function saveSettings(input, now = Date.now()) {
  const prev = settings();
  const next = cleanTiering({ ...prev, ...input, models: { ...prev.models, ...(input?.models || {}) } });
  if (next.enabled && !prev.enabled) next.since = now;               // the "after" of the comparison starts here
  building.setPrefs({ tiering: next });
  return status();
}

const step = (tier, d) => TIERS[Math.max(0, Math.min(TIERS.length - 1, TIERS.indexOf(tier) + d))];
// the model for a background job, or null to keep the role's: role (template id), whether the owner set the agent's
// model, and whether the job is routine
export function modelFor({ role = '', ownerModel = false, routine = false } = {}, s = settings()) {
  if (!s.enabled || ownerModel || PINNED.has(role)) return null;
  const base = ROLE_TIER[role] || 'standard';
  const tier = routine ? step(base, -1) : base;
  return { tier, model: s.models[tier] };
}

// cost per finished job before tiering was switched on and since (the last 30 days of jobs are kept)
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10000) / 10000 : null);
export function costStats(s = settings(), jobs = jobsLib.listJobs({ limit: 5000 })) {
  const ended = jobs.filter((j) => j.status !== 'running' && Number(j.cost) > 0);
  const before = s.since ? ended.filter((j) => j.createdAt < s.since) : ended;
  const after = s.since ? ended.filter((j) => j.createdAt >= s.since) : [];
  const b = avg(before.map((j) => +j.cost)), a = avg(after.map((j) => +j.cost));
  const byTier = Object.fromEntries(TIERS.map((t) => [t, { jobs: after.filter((j) => j.tier === t).length, avg: avg(after.filter((j) => j.tier === t).map((j) => +j.cost)) }]));
  return { before: { jobs: before.length, avg: b }, after: { jobs: after.length, avg: a }, change: b && a != null ? Math.round(((a - b) / b) * 100) : null, byTier };
}
export const status = () => ({ settings: settings(), roles: ROLE_TIER, pinned: [...PINNED], stats: costStats() });
