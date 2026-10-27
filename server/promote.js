// SPDX-License-Identifier: Apache-2.0
// Promoting a lesson (0.21): a line a Space learned (L2, its docs/squad/LEARNINGS.md) becomes a rule of a Role
// Template (L1), so every agent of that role in every Space follows it. Never automatic: the Owner picks the lesson
// and the role, the server removes what belongs to the client (the Space's name and folder, its agents' names,
// personal data, secrets), the Owner edits the result and approves it; the template gets a new version, and the
// Spaces using it show "Update available" as with any template change.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as building from './building.js';
import * as floors from './floors.js';
import * as roles from './roles.js';
import * as learnings from './learnings.js';
import { redact } from './redact.js';
import { bad, notFound, lineDiff, oneLine } from './util.js';

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function spaceOf(floorId) {
  const e = building.loadBuilding().floors.find((f) => f.id === floorId);
  if (!e) throw notFound('Space not found');
  return { entry: e, cfg: floors.readFloor(e.path) };
}
// what identifies the client in a lesson: the Space's name, id and folder (-> "the project"), its agents' names
function clientWords({ entry, cfg }) {
  const proj = [cfg.floor.name, entry.id, path.basename(entry.path)].map((w) => ({ w, as: 'the project' }));
  const agents = cfg.team.agents.flatMap((a) => [a.displayName, String(a.displayName).split(' - ')[0], a.id]).map((w) => ({ w, as: 'the agent' }));
  const seen = new Set();
  return [...proj, ...agents].map((x) => ({ ...x, w: String(x.w || '').trim() })).filter((x) => x.w.length >= 3 && !seen.has(x.w.toLowerCase()) && seen.add(x.w.toLowerCase()))
    .sort((a, b) => b.w.length - a.w.length);
}
export function scrub(text, sp) {
  let t = redact(String(text || ''), { pii: true });
  for (const { w, as } of clientWords(sp)) t = t.replace(new RegExp(`\\b${esc(w)}\\b`, 'gi'), as);
  return oneLine(t, 400);
}
const leftovers = (text, sp) => clientWords(sp).map((x) => x.w).filter((w) => new RegExp(`\\b${esc(w)}\\b`, 'i').test(text));

// lessons of every Space and the templates a rule can go to
export function candidates() {
  const lessons = [];
  for (const e of building.loadBuilding().floors) {
    let cfg; try { cfg = floors.readFloor(e.path); } catch { continue; }
    learnings.entries(e.path).slice(-40).forEach((l, i) => lessons.push({ floorId: e.id, space: cfg.floor.name, access: cfg.floor.access || 'team', index: i, ...l }));
  }
  return { lessons: lessons.reverse(), roles: roles.listTemplates().map((t) => ({ role: t.role, title: t.title, version: t.version, writable: !!t.writable })) };
}
// the proposed rule and the template's diff
export function preview({ floorId, text, role, rule = '' } = {}) {
  const sp = spaceOf(floorId);
  const t = roles.getTemplate(role);
  if (!t) throw notFound('Role Template not found');
  const proposed = String(rule || '').trim() ? oneLine(rule, 400) : scrub(text, sp);
  const before = roles.renderTemplate(t);
  const after = roles.renderTemplate({ ...t, rules: [...(t.rules || []), proposed] });
  return { rule: proposed, role, version: t.version, writable: !!t.writable, leftovers: leftovers(proposed, sp), personal: redact(proposed, { pii: true }) !== proposed,
    diff: lineDiff(before, after).filter((l, i, a) => l.op !== ' ' || a[i - 1]?.op !== ' ' || a[i + 1]?.op !== ' ') };
}
// the Owner approves the (edited) rule: nothing of the client may be left in it
export function apply({ floorId, text, role, rule, by = 'Owner', now = Date.now() } = {}) {
  const p = preview({ floorId, text, role, rule });
  if (!p.rule) throw bad('The rule is empty');
  if (!p.writable) throw bad(`"${role}" comes from a read-only library: copy it to your own templates first`);
  if (p.leftovers.length) throw bad(`The rule still names the client: ${p.leftovers.join(', ')}`);
  if (p.personal) throw bad('The rule still contains personal data or a secret');
  const t = roles.getTemplate(role);
  const r = roles.saveTemplate({ ...t, role, rules: [...(t.rules || []), p.rule] });
  fs.mkdirSync(path.join(config.home, 'insights'), { recursive: true });
  fs.appendFileSync(path.join(config.home, 'insights', 'promotions.jsonl'), `${JSON.stringify({ ts: now, from: floorId, role, version: r.template.version, rule: p.rule, by })}\n`);
  return { ok: true, role, version: r.template.version, rule: p.rule };
}
