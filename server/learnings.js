// LEARNINGS.md: the project's memory in the repo (docs/squad/LEARNINGS.md). Short entries with a date and a
// source (retro, audit finding, bug): patterns and pitfalls of this project. Every agent reads it before a module;
// the lead adds entries after each Retro; Audit findings with target "project" add entries once the owner applies them.
import fs from 'node:fs';
import path from 'node:path';
import { readText, writeText } from './util.js';

export const FILE = 'docs/squad/LEARNINGS.md';
const HEAD = `# Learnings\n\nThe memory of this project: patterns that work and pitfalls to avoid. Read it before you start a module.\nOne line per entry: \`- YYYY-MM-DD · source: what we learned, and what to do\`. Sources: retro sprint N, audit finding, bug, owner.\n\n## Entries\n`;
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 400);

export const fileOf = (root) => path.join(root, FILE);
export function ensure(root) {
  const f = fileOf(root);
  if (!fs.existsSync(f)) writeText(f, HEAD);
  return f;
}
// -> [{ date, source, text }]
export function entries(root) {
  return (readText(fileOf(root)) || '').split('\n').map((l) => l.match(/^- (\d{4}-\d{2}-\d{2}) · ([^:]+): (.+)$/)).filter(Boolean).map((m) => ({ date: m[1], source: m[2].trim(), text: m[3].trim() }));
}
export const line = ({ date, source, text }) => `- ${date} · ${clean(source)}: ${clean(text)}`;
// the file after adding entries (entries already there are skipped)
export function withEntries(current, list, now = Date.now()) {
  let text = current && current.includes('## Entries') ? current : `${HEAD}${current ? `\n${current}` : ''}`;
  const have = new Set((text.match(/^- .+$/gm) || []).map((l) => l.replace(/^- \d{4}-\d{2}-\d{2} · /, '')));
  for (const e of list) {
    const l = line({ date: day(now), ...e });
    if (have.has(l.replace(/^- \d{4}-\d{2}-\d{2} · /, '')) || !clean(e.text)) continue;
    text = `${text.replace(/\n*$/, '\n')}${l}\n`;
  }
  return text;
}
export function add(root, list, now = Date.now()) {
  const before = readText(fileOf(root)) || '';
  const after = withEntries(before, list, now);
  if (after !== before) writeText(fileOf(root), after);
  return { file: FILE, added: after.split('\n').length - before.split('\n').length };
}
