// Set up Squad: one squad = one project folder = one Floor (2 and up). Creates the folder when asked
// (default ~/aisquad-squads/<slug>, git init), writes the Floor files with the Blueprint, and can start the lead.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import * as building from './building.js';
import * as floors from './floors.js';
import { getBlueprint } from './blueprints.js';
import { kebab, clip, bad } from './util.js';

export const squadsDir = (b = building.loadBuilding()) => b.prefs.squadsDir || path.join(os.homedir(), 'aisquad-squads');

// input: { blueprint, name, goal, team: [{ template, displayName, lead }], directory: { mode: new|existing, path? }, budget }
export async function createSquad(input) {
  const bp = getBlueprint(String(input.blueprint || ''));
  const name = clip(String(input.name || '').trim(), 60) || bp.title;
  const team = (Array.isArray(input.team) ? input.team : []).filter((m) => m && m.template);
  if (!team.length) throw bad('A squad needs at least one agent');
  if (!team.some((m) => m.lead)) (team.find((m) => m.template === bp.lead) || team[0]).lead = true;
  if (team.filter((m) => m.lead).length > 1) throw bad('Only one agent can be the lead');
  const dir = input.directory || {};
  const mode = dir.mode === 'existing' ? 'existing' : 'new';
  const target = mode === 'existing' || dir.path ? String(dir.path || '') : path.join(squadsDir(), kebab(name) || bp.id);
  if (!path.isAbsolute(target)) throw bad('The folder must be an absolute path');
  if (mode === 'new' && fs.existsSync(target) && fs.readdirSync(target).length) throw bad(`${target} already exists and is not empty; choose another name or folder`);
  const r = await floors.createFloor({
    name, goal: input.goal, directory: { mode, path: target }, team: team.map((m) => ({ displayName: m.displayName || m.template, template: m.template, lead: !!m.lead })),
    workflow: bp.workflow, layout: floors.LAYOUTS.includes(bp.layout) ? bp.layout : 'rows', budget: input.budget, blueprint: { id: bp.id, version: bp.version },
    git: { qualityGate: String(input.qualityGate || '') }, installSkills: input.installSkills !== false,
  });
  const lead = r.team.agents.find((a) => a.lead);
  return { ok: true, id: r.entry.id, number: r.entry.number, path: r.entry.path, lead: lead?.id || null, blueprint: { id: bp.id, version: bp.version } };
}
