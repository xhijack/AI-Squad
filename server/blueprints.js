// Squad Blueprints: versioned templates for a whole squad (roles and counts, the lead, and the communication
// standard). Stored like Role Templates: shipped in templates/blueprints/<id>/ (blueprint.md + pack/ files),
// seeded into ~/.aisquad/blueprints/<id>/ where the owner may edit them.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { parseFrontmatter } from './frontmatter.js';
import { safeReaddir, readText, writeText, readJson, writeJson, kebab, uniq, notFound } from './util.js';
import { listTemplates } from './roles.js';
import { SECRET_DENY } from './sprint.js';

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
const historyFile = (id, version) => path.join(libraryDir(), '.history', `${id}@${version}.md`);
export const blueprintVersionText = (id, version) => (getBlueprint(id).version === version ? blueprintText(id) : readText(historyFile(id, version)));
// a new version of a local Blueprint: the old text goes to .history, the version in the frontmatter goes up
export function saveBlueprintText(id, text) {
  const cur = getBlueprint(id);
  const next = parseBlueprint(text, id);
  if (next.id !== id) throw new Error('The Blueprint id cannot change');
  writeText(historyFile(id, cur.version), blueprintText(id));
  const bumped = String(text).replace(/^version:\s*\d+\s*$/m, `version: ${cur.version + 1}`);
  writeText(path.join(libraryDir(), id, 'blueprint.md'), bumped);
  return { id, version: cur.version + 1 };
}
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

// ---------- the communication standard in the repo ----------
// body sections by "## " heading; "Rules per role" holds "### role-a, role-b" subsections
export function sections(body) {
  const out = [];
  for (const part of String(body).split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    out.push({ title: part.slice(0, nl < 0 ? undefined : nl).trim(), text: nl < 0 ? '' : part.slice(nl + 1).trim() });
  }
  return out;
}
export function roleRules(bp, role) {
  const sec = sections(bp.body).find((s) => /^rules per role$/i.test(s.title));
  if (!sec) return '';
  for (const part of sec.text.split(/^### /m).slice(1)) {
    const nl = part.indexOf('\n');
    if (part.slice(0, nl).split(',').map((x) => x.trim()).includes(role)) return part.slice(nl + 1).trim();
  }
  return '';
}
const fill = (text, lead) => String(text).replace(/\{\{lead\}\}/g, lead ? `${lead.displayName} (\`${lead.id}\`)` : 'the lead');

// the standard every agent follows (without the per-role rules), for AISQUAD.md and agent files
export function standardText(bp, lead) {
  return sections(bp.body).filter((s) => !/^rules per role$/i.test(s.title)).map((s) => `### ${s.title}\n${fill(s.text, lead)}`).join('\n\n');
}

export const STANDARD_START = '<!-- aisquad:standard:start -->', STANDARD_END = '<!-- aisquad:standard:end -->';
export function standardBlock(bp, lead) {
  return `${STANDARD_START}\n## Squad standard: ${bp.title} v${bp.version}\nThis squad follows the **${bp.title}** Blueprint. Every agent treats this section as binding; it is generated from \`.claude/aisquad/blueprint.md\`.\n\n**Lead:** ${lead ? `${lead.displayName} (\`${lead.id}\`)` : 'not set'}. Gates: ${bp.gates.join(', ') || 'see below'}.\n\n${standardText(bp, lead)}\n${STANDARD_END}`;
}

// snapshot in the repo (self-contained, like roles.lock); the Floor reads its Blueprint from here
export const snapshotPath = (root) => path.join(root, '.claude', 'aisquad', 'blueprint.md');
export function floorBlueprint(root, ref) {
  if (!ref?.id) return null;
  const text = readText(snapshotPath(root)) || blueprintText(ref.id);
  try { return text ? parseBlueprint(text, ref.id) : null; } catch { return null; }
}

// copy the Blueprint into the repo: snapshot + workflow pack (existing files are never overwritten)
export function applyToRepo(root, bp) {
  writeText(snapshotPath(root), blueprintText(bp.id));
  const created = [];
  for (const f of packFiles(bp)) {
    const dest = path.join(root, f.rel);
    if (fs.existsSync(dest)) continue;
    writeText(dest, fs.readFileSync(f.abs, 'utf8'));
    created.push(f.rel);
  }
  return created;
}

// source documents and their status from the STATUS line: missing | draft | approved
export function sourceDocsStatus(root, bp) {
  return (bp?.sourceDocs || []).filter((d) => d && d.path).map((d) => {
    const text = readText(path.join(root, String(d.path)));
    const st = text == null ? 'missing' : /^STATUS:\s*APPROVED/mi.test(text) ? 'approved' : 'draft';
    return { path: String(d.path), title: String(d.title || d.path), purpose: String(d.purpose || ''), owner: String(d.owner || ''), status: st };
  });
}

// .claude/settings.json for a Blueprint squad: the lead spawns teammates (agent teams), background teammates
// need allow rules for writing (they cannot answer prompts), and secrets stay denied (merged, idempotent)
export const TEAM_ALLOW = ['Edit', 'Write', 'Bash(ls*)', 'Bash(mkdir *)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git switch *)', 'Bash(git branch*)'];
export function mergeTeamSettings(root) {
  const p = path.join(root, '.claude', 'settings.json');
  const cur = fs.existsSync(p) ? readJson(p, null) : {};
  if (!cur) return false;                                      // unreadable settings: leave them alone
  cur.env = { ...(cur.env || {}), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' };
  cur.permissions = { ...(cur.permissions || {}) };
  cur.permissions.allow = [...new Set([...(cur.permissions.allow || []), ...TEAM_ALLOW])];
  cur.permissions.deny = [...new Set([...(cur.permissions.deny || []), ...SECRET_DENY, 'Bash(git push*)', 'Bash(rm -rf *)'])];
  writeJson(p, cur);
  return true;
}
