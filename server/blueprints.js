// SPDX-License-Identifier: Apache-2.0
// Squad Blueprints: versioned templates for a whole squad (roles and counts, the lead, and the communication
// standard). Stored like Role Templates: shipped in templates/blueprints/<id>/ (blueprint.md + pack/ files),
// seeded into ~/.aisquad/blueprints/<id>/ where the owner may edit them.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { parseFrontmatter } from './frontmatter.js';
import { safeReaddir, readText, writeText, readJson, writeJson, kebab, uniq, notFound, bad } from './util.js';
import { listTemplates } from './roles.js';
import { SECRET_DENY } from './sprint.js';
import * as google from './google.js';

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
    // Autopilot (balanced): topics only the owner decides, besides the hard-stop list
    ownerOnly: list(data.ownerOnly).map(String).filter(Boolean),
    // the Space a squad of this Blueprint becomes (0.20): kind, access, shift (Legal: Owner only; Marketing: nights)
    // starting targets (1.3): the Owner sets their values in Admin → Targets
    kpis: Array.isArray(data.kpis) ? data.kpis.filter((k) => k && k.name) : [],
    // routines (1.5): created disabled in a new Space; the Owner turns them on in Admin → Cadence
    cadence: Array.isArray(data.cadence) ? data.cadence.filter((r) => r && r.title && r.task) : [],
    // first questions (1.15): asked in Set up Squad, so the lead starts from the answers instead of asking again
    intake: cleanIntake(data.intake), intakeDoc: String(data.intakeDoc || 'docs/SETUP.md'),
    // ERPNext key and Telegram (1.7): Finance reads with the finance key and sends only counts
    // built-in MCP servers the squad's sessions get (1.8): aisquad-google
    mcp: list(data.mcp).filter((x) => x === google.MCP_NAME),
    space: (({ kind, access, shift, erpnext, telegram }) => ({ ...(kind ? { kind } : {}), ...(access ? { access } : {}), ...(shift ? { shift } : {}), ...(erpnext ? { erpnext } : {}), ...(telegram ? { telegram } : {}) }))(data.space && typeof data.space === 'object' ? data.space : {}),
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

// The squad's loop (1.14): the roles the Blueprint's own work cycle cannot run without. The lead, every role with a
// minimum, every role a routine names and every source document's owner; each with the duties that need it, so a
// team that drops one can say what stops (a routine without its agent is skipped every time it is due).
// -> [{ template, min, duties: [{ kind: 'lead' | 'min' | 'routine' | 'doc', text, id? }] }]
export function loopRoles(bp) {
  const by = new Map(), add = (template, duty) => {
    const t = kebab(template || '');
    if (!t) return;
    if (!by.has(t)) by.set(t, { template: t, min: Math.max(1, bp.roles.find((r) => r.template === t)?.min || 0), duties: [] });
    by.get(t).duties.push(duty);
  };
  if (bp.lead) add(bp.lead, { kind: 'lead', text: 'Leads the squad and is the one who talks to you' });
  for (const r of bp.roles) if (r.min > 0 && r.template !== bp.lead) add(r.template, { kind: 'min', text: `Required by the Blueprint (at least ${r.min})` });
  for (const r of bp.cadence || []) add(r.agent, { kind: 'routine', id: kebab(r.id || r.title, 40), text: `Routine: ${r.title}` });
  for (const d of bp.sourceDocs || []) if (d?.owner) add(d.owner, { kind: 'doc', text: `Owns ${d.title || d.path}` });
  return [...by.values()];
}
// the loop roles a team (members with a template) leaves out, with what stops without them
export function loopGaps(bp, team) {
  const have = new Map();
  for (const m of team || []) have.set(m.template, (have.get(m.template) || 0) + 1);
  return loopRoles(bp).filter((r) => (have.get(r.template) || 0) < (r.duties.some((d) => d.kind === 'min') ? r.min : 1));
}

// ---------- first questions (1.15) ----------
// intake: [{ id, label, kind: choice|text|url|repo|branch, options: [{ value, label, hint }], when: { id: value | [values] },
// required, placeholder, hint, default, agents (repo: the templates that may commit there), repo (branch: its repo question) }]
export const INTAKE_KINDS = ['choice', 'text', 'url', 'repo', 'branch'];
export function cleanIntake(input) {
  return (Array.isArray(input) ? input : []).filter((q) => q && q.id && q.label).map((q) => {
    const kind = INTAKE_KINDS.includes(q.kind) ? q.kind : 'text';
    return {
      id: kebab(q.id, 40), label: String(q.label), kind, required: !!q.required, placeholder: String(q.placeholder || ''), hint: String(q.hint || ''), default: String(q.default || ''),
      ...(kind === 'choice' ? { options: (Array.isArray(q.options) ? q.options : []).filter((o) => o && o.value).map((o) => ({ value: kebab(o.value, 40), label: String(o.label || o.value), hint: String(o.hint || '') })) } : {}),
      ...(q.when && typeof q.when === 'object' ? { when: Object.fromEntries(Object.entries(q.when).map(([k, v]) => [kebab(k, 40), list(v).map((x) => kebab(x, 40))])) } : {}),
      ...(kind === 'repo' ? { agents: list(q.agents).map((x) => kebab(x)) } : {}),
      ...(kind === 'branch' ? { repo: kebab(q.repo || '', 40) } : {}),
    };
  });
}
// a question shows (and counts) only while its condition holds
export const intakeAsked = (q, answers = {}) => !q.when || Object.entries(q.when).every(([k, vals]) => vals.includes(String(answers[k] || '')));
const URL_RE = /^https?:\/\/[^\s/]+\.[^\s]+$/i, REPO_RE = /^(https:\/\/\S+|ssh:\/\/\S+|git@[^\s:]+:\S+|\/\S*)$/, BRANCH_RE = /^[\w./-]{1,100}$/;
// the owner's answers, checked against the Blueprint -> { answers, errors: [label] } (answers only for asked questions)
export function intakeAnswers(bp, input = {}) {
  const answers = {}, errors = [];
  for (const q of bp.intake || []) {
    if (!intakeAsked(q, answers)) continue;
    let v = String(input?.[q.id] ?? '').trim().slice(0, 300) || q.default;
    if (q.kind === 'choice' && v && !q.options.some((o) => o.value === v)) v = '';
    if (q.kind === 'url' && v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
    const ok = !v || (q.kind === 'url' ? URL_RE.test(v) : q.kind === 'repo' ? REPO_RE.test(v) : q.kind === 'branch' ? BRANCH_RE.test(v) : true);
    const name = q.label.replace(/[:?]\s*$/, '');
    if (!ok) errors.push(`${name}: not valid`);
    else if (v) answers[q.id] = v;
    else if (q.required) errors.push(`${name}: required`);
  }
  return { answers, errors };
}
const answerText = (q, v) => (q.kind === 'choice' ? q.options.find((o) => o.value === v)?.label || v : v);
// the answers as Markdown (written to the Blueprint's intakeDoc and added to the lead's kickoff)
export function intakeMarkdown(bp, answers = {}) {
  const rows = (bp.intake || []).filter((q) => answers[q.id]).map((q) => `- **${q.label}** ${answerText(q, answers[q.id])}`);
  return rows.length ? `# Set up answers\n\nThe owner answered these in Set up Squad (The AI Squad). Treat them as given; ask only what is missing or unclear.\n\n${rows.join('\n')}\n` : '';
}
export function intakeKickoff(bp, answers = {}) {
  const md = intakeMarkdown(bp, answers);
  return md ? `${bp.kickoff}\n\nThe owner already answered the first questions in Set up Squad (also in \`${bp.intakeDoc}\`); do not ask them again:\n${md.split('\n').filter((l) => l.startsWith('- ')).join('\n')}`.trim() : bp.kickoff;
}
// the repositories the answers name -> [{ where, branch, templates }] (a Linked repository with write access)
export function intakeRepos(bp, answers = {}) {
  return (bp.intake || []).filter((q) => q.kind === 'repo' && answers[q.id]).map((q) => ({
    where: answers[q.id], branch: answers[(bp.intake.find((b) => b.kind === 'branch' && b.repo === q.id) || {}).id] || 'main', templates: q.agents,
  }));
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
  if (bp.mcp?.includes(google.MCP_NAME) && google.addToSpace(root)) created.push('.mcp.json');
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

// ---------- source documents: view and approve (only the paths the Blueprint names) ----------
export function sourceDocPath(root, bp, rel) {
  const want = String(rel || '').trim();
  const doc = (bp?.sourceDocs || []).find((d) => d && String(d.path) === want);
  const full = doc && path.resolve(root, want);
  if (!doc || !full.startsWith(path.resolve(root) + path.sep) || /(^|\/)\.env/.test(want)) throw notFound('Not a source document of this Blueprint');
  return full;
}
export function readSourceDoc(root, bp, rel) {
  const full = sourceDocPath(root, bp, rel);
  const text = readText(full);
  if (text == null) throw notFound(`${rel} does not exist yet`);
  return { path: String(rel), text: text.slice(0, 400000), truncated: text.length > 400000 };
}
const APPROVED_BY = /^Approved by the owner on:.*$/m;
// sets the first STATUS line to APPROVED and fills "Approved by the owner on: <date>" (inserted after STATUS when
// missing); every other line stays as it is. An approved document with its date is left alone.
export function approveText(text, date) {
  const lines = String(text).split('\n');
  let i = lines.findIndex((l) => /^STATUS:/.test(l));
  const j = lines.findIndex((l) => APPROVED_BY.test(l));
  if (i >= 0 && /^STATUS:\s*APPROVED\s*$/.test(lines[i]) && j >= 0 && lines[j].replace(/^Approved by the owner on:/, '').trim()) return text;
  if (i < 0) {                                         // no STATUS line: after the title, else at the top
    if (/^#\s/.test(lines[0] || '')) { lines.splice(1, 0, '', 'STATUS: APPROVED'); i = 2; } else { lines.unshift('STATUS: APPROVED', ''); i = 0; }
  } else lines[i] = 'STATUS: APPROVED';
  const stamp = `Approved by the owner on: ${date}`;
  const k = lines.findIndex((l) => APPROVED_BY.test(l));
  if (k >= 0) lines[k] = stamp; else lines.splice(i + 1, 0, stamp);
  return lines.join('\n');
}
export function approveSourceDoc(root, bp, rel, date) {
  const full = sourceDocPath(root, bp, rel);
  const text = readText(full);
  if (text == null) throw bad(`${rel} does not exist yet; ask the lead to draft it first`);
  const next = approveText(text, date);
  if (next !== text) writeText(full, next);
  return { path: String(rel), changed: next !== text };
}

// the "source documents approved" gate: blocking while any source document is missing or still DRAFT
export function docsGate(root, bp) {
  const pending = sourceDocsStatus(root, bp).filter((d) => d.status !== 'approved');
  const gated = (bp?.gates || []).some((g) => /source doc/i.test(g));
  return { blocking: gated && pending.length > 0, pending };
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
