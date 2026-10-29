// SPDX-License-Identifier: Apache-2.0
// Built-in skills: bundled with the plugin in skills/<name>/SKILL.md. For each skill of an agent the Desk shows
// where it comes from: the project (.claude/skills), the user (~/.claude/skills), the plugin (available to the
// sessions The AI Squad starts, as aisquad:<name>) or nowhere. Install copies a bundled skill into the project.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { parseFrontmatter } from './frontmatter.js';
import { safeReaddir, readText, writeText, bad, notFound } from './util.js';

export const BUNDLED = path.join(ROOT, 'skills');
export const PLUGIN_NAME = 'aisquad';
const skillFile = (dir, name) => path.join(dir, name, 'SKILL.md');
const projectDir = (root) => path.join(root, '.claude', 'skills');
const userDir = () => path.join(config.claudeHome, 'skills');
const validName = (n) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(n));

export function bundledSkills() {
  return safeReaddir(BUNDLED).filter((n) => fs.existsSync(skillFile(BUNDLED, n))).map((name) => {
    let description = '';
    try { description = String(parseFrontmatter(readText(skillFile(BUNDLED, name))).data.description || ''); } catch { /* keep empty */ }
    return { name, description };
  });
}

// status: project | user | bundled | missing
export function skillStatus(root, name) {
  const bundled = bundledSkills().find((s) => s.name === name);
  const where = validName(name) && fs.existsSync(skillFile(projectDir(root), name)) ? 'project'
    : validName(name) && fs.existsSync(skillFile(userDir(), name)) ? 'user' : bundled ? 'bundled' : 'missing';
  return { name, status: where, description: bundled?.description || '', installable: !!bundled && where !== 'project' };
}

// the name an agent file uses: our plugin's copy is namespaced (aisquad:<name>) unless the project or the user
// installed the skill; unknown names stay as written (they may come from another plugin)
export function agentSkillName(root, name) {
  return skillStatus(root, name).status === 'bundled' ? `${PLUGIN_NAME}:${name}` : name;
}

// copy a bundled skill (its whole folder) into <repo>/.claude/skills/<name>; never overwrites
export function install(root, name) {
  if (!validName(name)) throw bad('Invalid skill name');
  const src = path.join(BUNDLED, name);
  if (!fs.existsSync(skillFile(BUNDLED, name))) throw notFound(`No bundled skill named ${name}`);
  const dest = path.join(projectDir(root), name);
  if (fs.existsSync(skillFile(projectDir(root), name))) return { name, installed: false, already: true };
  const copy = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.isDirectory()) copy(path.join(from, e.name), path.join(to, e.name));
      else writeText(path.join(to, e.name), fs.readFileSync(path.join(from, e.name), 'utf8'));
    }
  };
  copy(src, dest);
  return { name, installed: true, path: path.relative(root, dest) };
}
