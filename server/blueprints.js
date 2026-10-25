// Squad Blueprints: versioned templates for a whole squad (roles and counts, the lead, and the communication
// standard). Stored like Role Templates: shipped in templates/blueprints/<id>/ (blueprint.md + pack/ files),
// seeded into ~/.aisquad/blueprints/<id>/ where the owner may edit them.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { parseFrontmatter } from './frontmatter.js';
import { safeReaddir, readText, writeText, kebab, uniq, notFound } from './util.js';
import { listTemplates } from './roles.js';

export const SHIPPED = path.join(ROOT, 'templates', 'blueprints');
export const libraryDir = () => path.join(config.home, 'blueprints');
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
const int = (v, d) => (Number.isInteger(Number(v)) ? Number(v) : d);

export function parseBlueprint(text, fallbackId = '') {
  const { data, body } = parseFrontmatter(text);
  const id = kebab(data.id || fallbackId);
  const roles = (Array.isArray(data.roles) ? data.roles : []).filter((r) => r && r.template).map((r) => {
    const min = Math.max(0, int(r.min, 0)), max = Math.max(min, int(r.max, Math.max(1, min)));
    return { template: kebab(r.template), min, default: Math.min(max, Math.max(min, int(r.default, min))), max, lead: !!r.lead, why: String(r.why || '') };
  });
  if (roles.length && !roles.some((r) => r.lead)) roles[0].lead = true;
  return {
    id, title: String(data.title || id), version: Math.max(1, int(data.version, 1)), category: kebab(data.category || 'general'),
    description: String(data.description || ''), keywords: uniq(list(data.keywords).map((k) => k.toLowerCase())),
    workflow: data.workflow === 'squad-sprint' ? 'squad-sprint' : 'free-team', layout: String(data.layout || 'rows'),
    roles, lead: roles.find((r) => r.lead)?.template || '',
    sourceDocs: Array.isArray(data.sourceDocs) ? data.sourceDocs : [], channels: Array.isArray(data.channels) ? data.channels : [],
    gates: list(data.gates), kickoff: String(data.kickoff || ''), body: String(body || '').trim(),
  };
}

const walk = (dir, base = dir) => safeReaddir(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return fs.statSync(p).isDirectory() ? walk(p, base) : [path.relative(base, p)];
});

// shipped Blueprints go to the local library; a newer shipped version replaces a local copy only while the
// owner has not edited it (its version is still the one we seeded)
export function seedBlueprints() {
  const seededFile = path.join(libraryDir(), '.defaults.json');
  let seeded = {}; try { seeded = JSON.parse(readText(seededFile, '{}')) || {}; } catch { /* fresh */ }
  for (const id of safeReaddir(SHIPPED)) {
    const src = path.join(SHIPPED, id), dest = path.join(libraryDir(), id);
    const shipped = readText(path.join(src, 'blueprint.md'));
    if (!shipped) continue;
    const sv = parseBlueprint(shipped, id).version;
    const local = readText(path.join(dest, 'blueprint.md'));
    const lv = local ? parseBlueprint(local, id).version : null;
    if (local && !(sv > lv && lv === (seeded[id] ?? lv))) { seeded[id] ??= lv; continue; }
    fs.rmSync(dest, { recursive: true, force: true });
    for (const rel of walk(src)) writeText(path.join(dest, rel), fs.readFileSync(path.join(src, rel), 'utf8'));
    seeded[id] = sv;
  }
  writeText(seededFile, JSON.stringify(seeded, null, 2) + '\n');
}

export function listBlueprints() {
  return safeReaddir(libraryDir()).filter((id) => !id.startsWith('.')).map((id) => {
    const text = readText(path.join(libraryDir(), id, 'blueprint.md'));
    if (!text) return null;
    try { return { ...parseBlueprint(text, id), dir: path.join(libraryDir(), id) }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

export function getBlueprint(id) {
  const b = listBlueprints().find((x) => x.id === id);
  if (!b) throw notFound(`Blueprint not found: ${id}`);
  return b;
}
export const blueprintText = (id) => readText(path.join(libraryDir(), id, 'blueprint.md'));
// files of the Blueprint's workflow pack, relative to the project root
export const packFiles = (b) => walk(path.join(b.dir, 'pack')).map((rel) => ({ rel, abs: path.join(b.dir, 'pack', rel) }));

// the Role Template catalog for "Add agent": category from the template, else from the Blueprints using it
export function catalog() {
  const bps = listBlueprints();
  return listTemplates().map((t) => {
    const used = bps.filter((b) => b.roles.some((r) => r.template === t.role));
    return { role: t.role, title: t.title, version: t.version, description: t.description, model: t.model, effort: t.effort, skills: t.skills,
      appearance: t.appearance, category: t.category || used[0]?.category || 'general', blueprints: used.map((b) => b.id), source: t.source };
  });
}
