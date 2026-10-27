// SPDX-License-Identifier: Apache-2.0
// The Admin Panel's data (0.12): every Space with its kind, access, memory and shift; every agent across Spaces with
// its role, model, effort and skills; the skill catalog and who uses it; the Company Brain; recent changes.
// The Admin is an editor of the same configuration files (it never keeps data of its own).
import * as nodes from './nodes.js';
import fs from 'node:fs';
import * as building from './building.js';
import * as floors from './floors.js';
import * as skills from './skills.js';
import * as company from './company.js';
import * as history from './history.js';
import { listTemplates } from './roles.js';

export function overview() {
  const b = building.loadBuilding();
  const spaces = [], agents = [];
  for (const e of [...b.floors].sort((x, y) => x.number - y.number)) {
    if (!fs.existsSync(e.path)) { spaces.push({ id: e.id, number: e.number, path: e.path, missing: true }); continue; }
    let cfg; try { cfg = floors.readFloor(e.path); } catch { spaces.push({ id: e.id, number: e.number, path: e.path, missing: true }); continue; }
    const f = cfg.floor;
    spaces.push({ id: e.id, number: e.number, path: e.path, name: f.name, workflow: f.workflow, kind: f.kind, access: f.access, memory: f.memory, shift: f.shift, node: f.node, erpnext: f.erpnext || 'off',
      maxAgents: f.recovery.maxAgents, agents: cfg.team.agents.length, blueprint: f.blueprint?.id || '' });
    for (const a of cfg.team.agents) {
      let eff = null; try { eff = floors.effectiveOf(e.path, a); } catch { /* broken template */ }
      agents.push({ floorId: e.id, floorName: f.name, floorNumber: e.number, id: a.id, displayName: a.displayName, lead: !!a.lead, template: a.role?.template || '', version: a.role?.version || null,
        detached: !!a.role?.detached, model: eff?.model || '', effort: eff?.effort || '', skills: eff?.skills || [], overrides: a.overrides || {} });
    }
  }
  const templates = listTemplates();
  const catalog = skills.bundledSkills().map((s) => ({ ...s, roles: templates.filter((t) => (t.skills || []).includes(s.name)).map((t) => t.role) }));
  return { spaces, agents, skills: catalog, templates: templates.map((t) => ({ role: t.role, title: t.title, version: t.version, model: t.model, effort: t.effort })),
    company: company.summary(company.companyDir(b.prefs)), companyPath: b.prefs.company?.path || '', history: history.list({ limit: 40 }), maxAgents: b.prefs.maxAgents || null,
    machines: nodes.listNodes().map((n) => n.name) };
}
