// SPDX-License-Identifier: Apache-2.0
// The trust ladder of Daily Insight (0.21). Level 0 (the default) only suggests: the Owner accepts or dismisses.
// Level 1, per category, for low-risk changes to one agent (a rule after a failing command, a lighter model):
// a new suggestion is applied at once as a canary on that agent for 7 days, then measured against its "before";
// the Owner keeps it or rolls it back (the change history undoes it). A category may go to level 1 only when it
// earned it: 10+ accepted, 80 %+ of its decisions accepted, and its measured follow-ups improved (60 %+, 3+ measured).
// Every accepted change is measured a week later (the follow-up), canary or not.
// Never automatic, at any level: the hard-stop list, wider permissions, Building settings, Legal Spaces and roles,
// the Company Brain, and promoting a lesson from a Space to a role (server/promote.js, always the Owner's call).
import * as building from './building.js';
import * as floors from './floors.js';
import * as squadLog from './log.js';
import * as insight from './insight.js';
import { bad, notFound } from './util.js';

export const WEEK = 7 * 864e5;
export const CANARY_CATEGORIES = ['agent-rule', 'model'];            // the only ones that may go to level 1
export const CANARY_KINDS = new Set(['agent-rule', 'agent-model']);
export const LEGAL_ROLES = new Set(['legal-counsel', 'contract-drafter']);
export const LADDER = { accepted: 10, rate: 0.8, improved: 0.6, measured: 3 };

export const cleanTrust = (t = {}) => ({ levels: Object.fromEntries(CANARY_CATEGORIES.map((c) => [c, t?.levels?.[c] === 1 ? 1 : 0])) });
export const settings = () => cleanTrust(building.loadBuilding().prefs.trust);
export const levelOf = (category) => settings().levels[category] || 0;

// a category's record: decisions and measured follow-ups
export function stats(category, items = insight.loadInbox().items) {
  const mine = items.filter((x) => x.category === category);
  const accepted = mine.filter((x) => ['accepted', 'kept'].includes(x.status)).length;
  const declined = mine.filter((x) => ['dismissed', 'rolled-back'].includes(x.status)).length;
  const measured = mine.filter((x) => x.followUp && typeof x.followUp.improved === 'boolean');
  const improved = measured.filter((x) => x.followUp.improved).length;
  const rate = accepted + declined ? accepted / (accepted + declined) : 0;
  const eligible = accepted >= LADDER.accepted && rate >= LADDER.rate && measured.length >= LADDER.measured && improved / measured.length >= LADDER.improved;
  return { category, level: levelOf(category), accepted, declined, rate: Math.round(rate * 100), measured: measured.length, improved, eligible,
    canaries: mine.filter((x) => x.status === 'canary').length };
}
export const ladder = () => CANARY_CATEGORIES.map((c) => stats(c));
export function setLevel(category, level) {
  if (!CANARY_CATEGORIES.includes(category)) throw bad(`Level 1 is only for ${CANARY_CATEGORIES.join(' and ')}`);
  const lv = Number(level) === 1 ? 1 : 0;
  if (lv === 1 && !stats(category).eligible) throw bad(`Not yet: level 1 needs ${LADDER.accepted} accepted suggestions, ${LADDER.rate * 100} % of decisions accepted and improved follow-ups`);
  const s = settings();
  building.setPrefs({ trust: { levels: { ...s.levels, [category]: lv } } });
  return ladder();
}

// may this suggestion run as a canary by itself? (level 1, a low-risk change to one agent, nothing Legal)
export function canCanary(it) {
  const c = it.change;
  if (!c || !CANARY_KINDS.has(c.kind) || levelOf(it.category) !== 1) return false;
  try {
    const root = building.floorEntry(c.floorId).path;
    const cfg = floors.readFloor(root);
    if (cfg.floor.blueprint?.id === 'legal') return false;
    const a = cfg.team.agents.find((x) => x.id === c.agentId);
    return !!a && !LEGAL_ROLES.has(a.role?.template);
  } catch { return false; }
}

// ---------- measuring: the same counts Daily Insight used for "before", over the week after the change ----------
export function measure(it, from, to = from + WEEK) {
  const c = it.change || {};
  const ev = (floorId, type) => (floorId ? squadLog.read(floorId, { from, to, type }) : []);
  if (c.kind === 'agent-rule') {
    const m = String(it.key).match(/^tool:[^:]+:[^|]+\|([^|]*)\|(.*)$/), tool = m?.[1] || '', target = m?.[2] || '';
    return ev(c.floorId, 'tool.call').filter((e) => e.agent === c.agentId && e.data?.ok === false && e.data?.tool === tool && insight.words(e.data?.target, 3) === target).length;
  }
  if (c.kind === 'agent-model') return Math.round(ev(c.floorId, 'usage.turn').filter((e) => e.agent === c.agentId).reduce((n, e) => n + (+e.data?.cost || 0), 0) * 100) / 100;
  if (c.kind === 'floor') return ev(c.floorId, 'agent.idle').filter((e) => e.data?.openWork).length;
  return null;
}
const followUp = (it, now) => { const after = measure(it, it.appliedAt || it.decidedAt); return after == null || it.metric?.before == null ? null : { after, improved: after < it.metric.before, at: now }; };

// ---------- the daily step (from the Improvement Inbox's tick) ----------
// apply: (change, actor, { onRecord }) -> applies through the change history (server/inbox.js)
export async function startCanaries(added, apply, now = Date.now()) {
  const started = [];
  for (const it of added.filter(canCanary)) {
    let historyId = '';
    try { await apply(it.change, 'Daily Insight (canary)', { onRecord: (id) => { historyId = id; } }); } catch { continue; }
    insight.updateItem(it.id, { status: 'canary', appliedAt: now, canaryUntil: now + WEEK, historyId }, { log: 'canary', by: 'Daily Insight' }, now);
    started.push(it.id);
  }
  return started;
}
// canaries whose week is over get their measurement (then wait for the Owner); accepted changes get their follow-up
export function review(now = Date.now()) {
  const out = { canaries: [], followUps: [] };
  for (const it of insight.loadInbox().items) {
    if (it.status === 'canary' && now >= it.canaryUntil) {
      insight.updateItem(it.id, { status: 'canary-done', followUp: followUp(it, now) }, { log: 'canary-done', by: 'Daily Insight' }, now);
      out.canaries.push(it.id);
    } else if (['accepted', 'kept'].includes(it.status) && !it.followUp && it.change && now >= (it.appliedAt || it.decidedAt) + WEEK) {
      const f = followUp(it, now);
      if (f) { insight.updateItem(it.id, { followUp: f }, { log: 'follow-up', by: 'Daily Insight' }, now); out.followUps.push(it.id); }
    }
  }
  return out;
}
// the Owner's call on a finished canary: keep it, or roll it back through the change history
export function decideCanary(id, keep, { by = 'Owner', rollback, now = Date.now() } = {}) {
  const it = insight.loadInbox().items.find((x) => x.id === id);
  if (!it) throw notFound('Suggestion not found');
  if (!['canary', 'canary-done'].includes(it.status)) throw bad('This is not a running or finished canary');
  if (!keep && it.historyId) rollback(it.historyId, { force: true, actor: by });
  return insight.updateItem(id, { status: keep ? 'kept' : 'rolled-back', decidedAt: now, by }, { log: keep ? 'kept' : 'rolled-back', by }, now);
}
export const canaryText = (it) => {
  const f = it.followUp;
  return [`Canary finished: ${it.title}`, `Applied by itself to one agent on ${new Date(it.appliedAt).toISOString().slice(0, 10)} (level 1 for ${it.category}).`,
    f ? `${it.metric?.name || 'measure'}: ${it.metric?.before} before, ${f.after} in the week after: ${f.improved ? 'better' : 'not better'}.` : 'It could not be measured.',
    'Keep it, or roll it back (Admin → Changes keeps the record).'].join('\n');
};
