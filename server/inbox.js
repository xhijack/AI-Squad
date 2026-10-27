// SPDX-License-Identifier: Apache-2.0
// The Improvement Inbox (0.15): runs Daily Insight over the Building (server/insight.js) and applies what the Owner
// accepts — through the same files and the same change history as an edit by hand, so Admin → Changes can roll it
// back. Trust level 0: nothing is applied without the Owner.
import * as building from './building.js';
import * as floors from './floors.js';
import * as squadLog from './log.js';
import * as history from './history.js';
import * as insight from './insight.js';
import * as squad from './squad.js';
import * as dispatcher from './dispatcher.js';
import * as trust from './trust.js';
import * as nodes from './nodes.js';
import { bad } from './util.js';

const settings = () => insight.cleanInsight(building.loadBuilding().prefs.insight);
const dayKey = (now) => new Date(now - new Date(now).getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

export function run(now = Date.now()) {
  const b = building.loadBuilding();
  const spaces = [], events = {};
  for (const f of b.floors) {
    let cfg; try { cfg = floors.readFloor(f.path); } catch { continue; }
    spaces.push({ id: f.id, name: cfg.floor.name, autopilot: cfg.floor.autopilot, agents: cfg.team.agents.map((a) => {
      let model = ''; try { model = floors.effectiveOf(f.path, a).model; } catch { /* template missing */ }
      return { id: a.id, name: a.displayName, model, lead: !!a.lead };
    }) });
    events[f.id] = squadLog.read(f.id, { from: now - insight.WINDOW_MS, to: now, type: 'tool.call,usage.turn,agent.idle,agent.crashed,question.answered,dispatch.started,chat.message' });
  }
  let limiting = '';
  try { limiting = squad.dispatchStatus(now).capacity.limiting; } catch { /* no snapshot yet */ }
  const workers = nodes.listNodes(now).filter((n) => n.online && !n.drain);
  const found = insight.analyze({ spaces, events, prefs: { maxAgents: b.prefs.maxAgents }, limiting, workers: { count: workers.length, free: nodes.clusterFree(now) } });
  const added = insight.addSuggestions(found, now);
  // level 1 (0.21): low-risk suggestions of a trusted category start as canaries; last week's canaries are measured
  trust.startCanaries(added, applyChange, now).catch((e) => console.error('[insight] canary:', e.message));
  trust.review(now);
  insight.writeReport(dayKey(now), { ts: now, found: found.length, added: added.map((x) => x.id), spaces: spaces.length, events: Object.values(events).reduce((n, l) => n + l.length, 0) });
  return { found: found.length, added };
}

// once a day at the set time (default 02:30, the quiet of the night: no model is called anyway)
let lastDay = '';
export function tick(now = Date.now()) {
  const s = settings();
  if (!s.enabled) return null;
  const d = new Date(now), [h, m] = s.at.split(':').map(Number);
  const day = dayKey(now);
  if (lastDay === day || d.getHours() * 60 + d.getMinutes() < h * 60 + m) return null;
  if (insight.loadInbox().lastRun && dayKey(insight.loadInbox().lastRun) === day) { lastDay = day; return null; }
  lastDay = day;
  return run(now);
}

export async function applyChange(c, actor, { onRecord = null } = {}) {
  if (!c) return { applied: false };
  if (c.kind === 'prefs') {
    const patch = {};
    if (c.patch.maxAgents !== undefined) patch.maxAgents = Math.max(1, Math.min(40, parseInt(c.patch.maxAgents, 10) || 6));
    if (!Object.keys(patch).length) throw bad('Nothing to change');
    return history.track('Improvement: Building settings', { actor, onRecord }, () => { building.setPrefs(patch); return { applied: true }; });
  }
  const root = building.floorEntry(c.floorId).path;
  const track = (label, fn) => history.track(label, { root, floorId: c.floorId, actor, onRecord }, () => { fn(); floors.generate(root); return { applied: true }; });
  if (c.kind === 'floor') return track('Improvement: Space settings', () => floors.updateFloorConfig(root, c.patch));
  const a = floors.readFloor(root).team.agents.find((x) => x.id === c.agentId);
  if (!a) throw bad(`The agent ${c.agentId} is no longer in this Space`);
  if (c.kind === 'agent-rule') return track(`Improvement: rule for ${a.displayName}`, () => floors.updateAgent(root, a.id, { overrides: { ...a.overrides, rules: [...new Set([...(a.overrides?.rules || []), c.rule])] } }));
  if (c.kind === 'agent-model') return track(`Improvement: model of ${a.displayName}`, () => floors.updateAgent(root, a.id, { overrides: { ...a.overrides, model: c.model } }));
  throw bad(`Unknown change: ${c.kind}`);
}

export async function accept(id, user) {
  const it = insight.loadInbox().items.find((x) => x.id === id);
  if (!it) return insight.decide(id, 'accepted');            // 404 from decide
  if (it.status !== 'open') throw bad('This suggestion was already decided');
  const r = await applyChange(it.change, user?.name || 'Owner');
  squad.invalidate();
  return insight.decide(id, 'accepted', { by: user?.name || 'Owner', result: r });
}
export const dismiss = (id, user, reason) => insight.decide(id, 'dismissed', { by: user?.name || 'Owner', reason });
export function list() {
  const inbox = insight.loadInbox();
  return { settings: settings(), lastRun: inbox.lastRun, queued: dispatcher.load().length, items: [...inbox.items].reverse().slice(0, 100), trust: trust.ladder(), ladderRules: trust.LADDER };
}
