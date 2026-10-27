// SPDX-License-Identifier: Apache-2.0
// The Company Brain (context layer L0): what every agent of the company may read and none may change: brand, SOPs,
// templates, products. Legal, finance and pricing are for Owner Spaces only. It is a folder (by default
// ~/.aisquad/company, or a git repository the owner points to), given to agents read-only with --add-dir.
// Layers: L0 Company Brain · L1 the agent's identity (its Role Template) · L2 the Space (repository, docs, memory) ·
// L3 the session (thrown away after the task).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { safeReaddir, writeText, bad } from './util.js';

export const TEAM_DIRS = ['brand', 'sop', 'templates', 'products'];
export const OWNER_DIRS = ['legal', 'finance', 'pricing'];
const README = {
  '': '# Company Brain\n\nWhat every agent of the company may read: brand, standard procedures, templates and products. Agents read it; they never change it. Legal, finance and pricing are read only by agents of Owner Spaces.\n\nPut client facts in the client\'s Space, never here.\n',
  brand: '# Brand\n\nVoice, tone, colours, logo use, words we use and words we avoid.\n',
  sop: '# Standard procedures\n\nHow we work: proposals, onboarding, implementation steps, support.\n',
  templates: '# Templates\n\nReusable documents: proposal outline, project brief, handoff, report.\n',
  products: '# Products\n\nWhat we sell and what each product does.\n',
  legal: '# Legal (Owner only)\n\nContract templates, clauses, privacy (UU PDP) checklist. Only agents of Owner Spaces read this folder.\n',
  finance: '# Finance (Owner only)\n\nRates, payment terms, invoicing rules. Only agents of Owner Spaces read this folder.\n',
  pricing: '# Pricing (Owner only)\n\nPrice lists and discount rules. Only agents of Owner Spaces read this folder.\n',
};

export function companyDir(prefs = {}) {
  const p = prefs?.company?.path;
  return p && path.isAbsolute(p) ? path.resolve(p) : path.join(config.home, 'company');
}
export function cleanCompany(c = {}) {
  const p = String(c?.path || '').trim();
  if (p && !path.isAbsolute(p)) throw bad('The Company Brain folder must be an absolute path');
  return { path: p ? path.resolve(p) : '' };
}
// creates the folders and their READMEs that are missing; never overwrites
export function ensure(dir) {
  for (const d of ['', ...TEAM_DIRS, ...OWNER_DIRS]) {
    const f = path.join(dir, d, 'README.md');
    if (!fs.existsSync(f)) writeText(f, README[d]);
  }
  return summary(dir);
}
const countFiles = (d) => { let n = 0; for (const f of safeReaddir(d)) { const p = path.join(d, f); try { const st = fs.statSync(p); if (st.isDirectory()) n += countFiles(p); else if (st.isFile() && f !== 'README.md') n++; } catch { /* gone */ } } return n; };
export function summary(dir) {
  const exists = fs.existsSync(dir);
  const names = exists ? safeReaddir(dir).filter((f) => { try { return fs.statSync(path.join(dir, f)).isDirectory() && !f.startsWith('.'); } catch { return false; } }) : [];
  return { path: dir, exists, dirs: names.sort().map((name) => ({ name, ownerOnly: OWNER_DIRS.includes(name), files: countFiles(path.join(dir, name)) })) };
}
// for an agent session: the folder read-only, and the Owner folders unreadable outside Owner Spaces
// (Claude Code writes absolute paths as //abs/**). Limits: shell commands (cat) are not caught by these rules.
export function denyRules(dir, { owner = false } = {}) {
  const out = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].map((t) => `${t}(/${dir}/**)`);
  if (!owner) for (const d of OWNER_DIRS) out.push(`Read(/${dir}/${d}/**)`, `Bash(cat ${dir}/${d}:*)`);
  return out;
}
