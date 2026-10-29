// SPDX-License-Identifier: Apache-2.0
// A Floor is a Space (Company Mode, 0.12): one project folder with one team, plus what kind of place it is.
//   kind    department (Sales, Marketing, Legal: permanent, many clients over time) | project (one client or product)
//   access  team (every person with a PIN) | owner (only the Owner: legal, finance, pricing)
//   memory  claude (Claude Code's auto memory stays in ~/.claude, per repository and machine) |
//           repo (in .claude/aisquad/memory/ inside the Space: committed with it, travels with git and backups)
//   shift   when the Space's automated work may run (the dispatcher of 0.13 holds it outside these hours)
//   node    auto | the machine the Space runs on (several machines, later)
// The code keeps the word Floor; Space is the concept.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { encodeProjectPath } from './transcripts.js';
import { safeReaddir, writeText } from './util.js';

export const KINDS = ['project', 'department'];
export const ACCESS = ['team', 'owner'];
export const MEMORY = ['claude', 'repo'];
export const ERPNEXT = ['off', 'sales', 'delivery'];          // which ERPNext credential the Space's agents get (0.19)
export const DEFAULT_SHIFT = { enabled: false, days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanShift(s = {}) {
  const days = Array.isArray(s?.days) ? [...new Set(s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_SHIFT.days;
  return { enabled: s?.enabled === true, days: days.length ? days : DEFAULT_SHIFT.days, from: TIME.test(String(s?.from)) ? s.from : DEFAULT_SHIFT.from, to: TIME.test(String(s?.to)) ? s.to : DEFAULT_SHIFT.to };
}
export function cleanSpace(s = {}) {
  return {
    kind: KINDS.includes(s.kind) ? s.kind : 'project',
    access: ACCESS.includes(s.access) ? s.access : 'team',
    memory: MEMORY.includes(s.memory) ? s.memory : 'claude',
    shift: cleanShift(s.shift),
    node: /^[a-z0-9][a-z0-9-]{0,39}$/.test(String(s.node || '')) ? s.node : 'auto',
    erpnext: ERPNEXT.includes(s.erpnext) ? s.erpnext : 'off',
  };
}

// is a time inside the shift? (from > to: the shift runs past midnight, e.g. 22:00-05:00; days are the day it starts)
export function inShift(shift, now = Date.now()) {
  const s = cleanShift(shift);
  if (!s.enabled) return true;
  const d = new Date(now), mins = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = s.from.split(':').map(Number), [th, tm] = s.to.split(':').map(Number);
  const from = fh * 60 + fm, to = th * 60 + tm;
  if (from === to) return s.days.includes(d.getDay());
  if (from < to) return s.days.includes(d.getDay()) && mins >= from && mins < to;
  if (mins >= from) return s.days.includes(d.getDay());
  return s.days.includes((d.getDay() + 6) % 7) && mins < to;                  // after midnight: yesterday's shift
}

// ---------- auto memory in the Space ----------
export const repoMemoryDir = (root) => path.join(root, '.claude', 'aisquad', 'memory');
export const claudeMemoryDir = (root) => path.join(config.claudeHome, 'projects', encodeProjectPath(root), 'memory');
// what a session of this Space is started with: --settings {"autoMemoryDirectory": …} when memory lives in the repo
export const sessionSettings = (root, space) => (cleanSpace(space).memory === 'repo' ? { autoMemoryDirectory: repoMemoryDir(root) } : null);
// switching to "repo": what Claude Code already learned on this machine comes along (files already there win)
export function adoptMemory(root) {
  const from = claudeMemoryDir(root), to = repoMemoryDir(root);
  let n = 0;
  const copy = (a, b) => {
    for (const f of safeReaddir(a)) {
      const src = path.join(a, f), dst = path.join(b, f), st = fs.statSync(src);
      if (st.isDirectory()) copy(src, dst);
      else if (st.isFile() && !fs.existsSync(dst)) { writeText(dst, fs.readFileSync(src)); n++; }
    }
  };
  copy(from, to);
  if (!fs.existsSync(path.join(to, 'README.md'))) writeText(path.join(to, 'README.md'), '# Auto memory of this Space\n\nClaude Code keeps what it learns about this project here (MEMORY.md and topic files), because the Space keeps its memory in the repository. Facts about this client stay in this Space; they never go into an agent\'s Role Template or the Company Brain.\n');
  return n;
}
