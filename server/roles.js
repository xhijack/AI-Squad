// Role Template library: ~/.aisquad/roles/<role>.md (frontmatter + "## Rules" + "## Prompt"),
// plus read-only extra libraries from ~/.aisquad/libraries.json. Every content change bumps the version;
// old versions are kept in roles/.history so diffs stay available.
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.js';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { safeReaddir, readText, writeText, kebab, uniq, isHex, bad, notFound } from './util.js';
import * as libraries from './libraries.js';

export const MODELS = ['opus', 'sonnet', 'haiku', 'inherit'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const STYLES = ['farmer', 'bob', 'pony', 'spiky', 'buns'];
const KNOWN = ['role', 'title', 'version', 'description', 'model', 'effort', 'skills', 'tools', 'permissions', 'appearance'];

const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);

export function cleanPermissions(p = {}) {
  const out = { deny: uniq(list(p.deny)) };
  if (p.allow !== undefined && p.allow !== null) out.allow = uniq(list(p.allow));
  return out;
}

export function cleanAppearance(a = {}) {
  const out = {};
  if (STYLES.includes(a.style)) out.style = a.style;
  for (const k of ['shirt', 'hair', 'skin']) if (isHex(a[k])) out[k] = a[k];
  if (a.glasses !== undefined) out.glasses = !!a.glasses;
  return out;
}

// Markdown body -> { rules, prompt }. Sections other than "Rules" stay part of the prompt.
export function parseBody(body) {
  const rules = [];
  const keep = [];
  let section = null;
  for (const line of String(body).split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { section = h[1].toLowerCase(); if (section !== 'rules' && section !== 'prompt') keep.push(line); continue; }
    if (section === 'rules') { const b = line.match(/^\s*[-*]\s+(.*)$/); if (b && b[1].trim() && b[1].trim() !== '(none)') rules.push(b[1].trim()); }
    else keep.push(line);
  }
  return { rules, prompt: keep.join('\n').trim() };
}

export function parseTemplate(text, fallbackRole = '') {
  const { data, body } = parseFrontmatter(text);
  const { rules, prompt } = parseBody(body);
  const role = kebab(data.role || fallbackRole);
  if (!role) throw bad('Template needs a role id');
  const extra = Object.fromEntries(Object.entries(data).filter(([k]) => !KNOWN.includes(k)));
  return {
    role,
    title: String(data.title || role),
    version: Math.max(1, parseInt(data.version, 10) || 1),
    description: data.description ? String(data.description) : '',
    model: MODELS.includes(data.model) ? data.model : 'sonnet',
    effort: EFFORTS.includes(data.effort) ? data.effort : 'medium',
    skills: uniq(list(data.skills)),
    tools: uniq(list(data.tools)),
    permissions: cleanPermissions(data.permissions || {}),
    appearance: cleanAppearance(data.appearance || {}),
    rules,
    prompt,
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}

export function renderTemplate(t) {
  const fm = { role: t.role, title: t.title, version: t.version };
  if (t.description) fm.description = t.description;
  Object.assign(fm, { model: t.model, effort: t.effort, skills: t.skills, tools: t.tools, permissions: t.permissions, appearance: t.appearance }, t.extra || {});
  const rules = t.rules.length ? t.rules.map((r) => `- ${r}`).join('\n') : '- (none)';
  return stringifyFrontmatter(fm, `## Rules\n${rules}\n\n## Prompt\n${String(t.prompt || '').trim()}\n`);
}

// content identity without the version number (used to decide whether a save is a new version)
const contentKey = (t) => JSON.stringify({ ...t, version: 0, source: undefined, writable: undefined });

// ---------- library ----------
// Copies shipped default templates into the local library. A newer shipped version replaces the local
// copy only while that copy still has the version we seeded (user edits always bump the version).
export function seedDefaults() {
  const dir = paths.roles();
  fs.mkdirSync(dir, { recursive: true });
  const seededFile = path.join(dir, '.defaults.json');
  const seeded = readJsonFile(seededFile);
  for (const f of safeReaddir(config.defaultRoles)) {
    if (!f.endsWith('.md')) continue;
    const role = f.slice(0, -3), dest = path.join(dir, f);
    let shipped; try { shipped = parseTemplate(readText(path.join(config.defaultRoles, f)), role); } catch { continue; }
    if (!fs.existsSync(dest)) { fs.copyFileSync(path.join(config.defaultRoles, f), dest); seeded[role] = shipped.version; continue; }
    let local; try { local = parseTemplate(readText(dest), role); } catch { continue; }
    if (seeded[role] === undefined) seeded[role] = local.version;      // libraries seeded before this was tracked
    if (shipped.version > local.version && local.version === seeded[role]) {
      writeText(historyFile(role, local.version), renderTemplate(local));
      fs.copyFileSync(path.join(config.defaultRoles, f), dest);
      seeded[role] = shipped.version;
    }
  }
  writeText(seededFile, JSON.stringify(seeded, null, 2) + '\n');
}
const readJsonFile = (f) => { try { return JSON.parse(readText(f)) || {}; } catch { return {}; } };

function libraryDirs() {
  return [{ name: 'local', dir: paths.roles(), writable: true },
    ...libraries.loadEntries().map((e) => ({ name: e.name, dir: libraries.templateDir(e), writable: false }))];
}

// every template of one library, including ones the local library shadows (for "copy to local")
export function libraryTemplates(name) {
  const lib = libraryDirs().find((l) => l.name === name && !l.writable);
  if (!lib) throw notFound(`Library not found: ${name}`);
  const out = [];
  for (const f of safeReaddir(lib.dir)) {
    if (!f.endsWith('.md') || /^readme\.md$/i.test(f)) continue;
    try { out.push({ ...parseTemplate(readText(path.join(lib.dir, f)), f.slice(0, -3)), source: lib.name, writable: false }); } catch { /* skip broken */ }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// copy a library template into the local library (as a new local template, version 1)
export function copyToLocal(library, role, as = role) {
  const t = libraryTemplates(library).find((x) => x.role === role);
  if (!t) throw notFound(`${role} is not in library ${library}`);
  const { source, writable, version, ...rest } = t;
  return saveTemplate({ ...rest, role: as }, { create: true });
}

export function listTemplates() {
  const seen = new Map();
  for (const lib of libraryDirs()) {
    for (const f of safeReaddir(lib.dir)) {
      if (!f.endsWith('.md')) continue;
      const role = f.slice(0, -3);
      if (seen.has(role)) continue;                    // local library wins over extra libraries
      try {
        const t = parseTemplate(readText(path.join(lib.dir, f)), role);
        seen.set(role, { ...t, role, source: lib.name, writable: lib.writable });
      } catch { /* skip broken template */ }
    }
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function getTemplate(role) {
  const t = listTemplates().find((x) => x.role === role);
  if (!t) throw notFound(`Role Template not found: ${role}`);
  return t;
}

const historyFile = (role, version) => path.join(paths.roleHistory(), `${role}@${version}.md`);

// exact text of a given version (current file or history); null when unknown
export function templateText(role, version) {
  const cur = listTemplates().find((x) => x.role === role);
  if (cur && cur.version === version) return renderTemplate(cur);
  return readText(historyFile(role, version));
}

export function templateVersions(role) {
  const out = new Set();
  for (const f of safeReaddir(paths.roleHistory())) { const m = f.match(/^(.+)@(\d+)\.md$/); if (m && m[1] === role) out.add(+m[2]); }
  const cur = listTemplates().find((x) => x.role === role);
  if (cur) out.add(cur.version);
  return [...out].sort((a, b) => a - b);
}

// create or update a local template. Content changes bump the version; old text goes to history.
export function saveTemplate(input, { create = false } = {}) {
  const role = kebab(input.role);
  if (!role) throw bad('Role id is required');
  let existing = listTemplates().find((x) => x.role === role);
  if (create && existing && existing.writable) throw bad(`Role Template already exists: ${role}`);
  if (create) existing = null;                              // a local template may shadow a library one
  if (!create && !existing) throw notFound(`Role Template not found: ${role}`);
  if (existing && !existing.writable) throw bad(`"${role}" comes from library "${existing.source}" and is read-only. Save it under a new role id.`);
  const next = parseTemplate(renderTemplate({
    ...(existing || {}), ...input, role,
    skills: list(input.skills ?? existing?.skills), tools: list(input.tools ?? existing?.tools),
    rules: (Array.isArray(input.rules) ? input.rules : existing?.rules || []).map((r) => String(r).trim()).filter(Boolean),
    permissions: cleanPermissions(input.permissions ?? existing?.permissions ?? {}),
    appearance: cleanAppearance(input.appearance ?? existing?.appearance ?? {}),
    version: existing ? existing.version : 1,
  }));
  if (existing) {
    if (contentKey(next) === contentKey(existing)) return { template: existing, changed: false };
    writeText(historyFile(role, existing.version), renderTemplate(existing));
    next.version = existing.version + 1;
  }
  writeText(path.join(paths.roles(), role + '.md'), renderTemplate(next));
  return { template: { ...next, source: 'local', writable: true }, changed: true };
}
