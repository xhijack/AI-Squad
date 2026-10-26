// Design variants: when the owner gives only a mockup or a vague wish, the designer writes 3-4 variants of a screen
// as static HTML in docs/design/variants/<screen>/; the owner sees them side by side, picks one, and the choice is
// written as a taste note in docs/DESIGN.md so later rounds follow it. Only files in that folder are ever served.
import fs from 'node:fs';
import path from 'node:path';
import { readText, writeText, notFound, bad } from './util.js';

export const DIR = 'docs/design/variants';
const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const FILE = /^[\w.-]{1,80}\.html$/;
const list = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const title = (html, file) => (String(html || '').match(/<title>([^<]{1,80})<\/title>/i) || [])[1]?.trim() || file.replace(/\.html$/, '').replace(/[-_]/g, ' ');

// -> [{ screen, question, variants: [{ file, title }], chosen, note }]  (screens with at least two variants)
export function groups(root) {
  const base = path.join(root, DIR);
  return list(base).filter((s) => SLUG.test(s) && fs.statSync(path.join(base, s)).isDirectory()).map((screen) => {
    const dir = path.join(base, screen);
    const variants = list(dir).filter((f) => FILE.test(f)).sort().map((file) => ({ file, title: title(readText(path.join(dir, file)), file) }));
    const chosen = (readText(path.join(dir, 'CHOSEN')) || '').trim().split('\n')[0] || null;
    // README.md: the question for the owner (first paragraph after a heading)
    const question = (readText(path.join(dir, 'README.md')) || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
    return { screen, question: question.slice(0, 300), variants, chosen: chosen && variants.some((v) => v.file === chosen) ? chosen : null };
  }).filter((g) => g.variants.length >= 2);
}

// the HTML of one variant (served sandboxed: no scripts from it reach The AI Squad)
export function variantFile(root, screen, file) {
  if (!SLUG.test(String(screen)) || !FILE.test(String(file))) throw notFound('No such variant');
  const full = path.join(root, DIR, screen, file);
  if (!full.startsWith(path.join(root, DIR) + path.sep) || !fs.existsSync(full)) throw notFound('No such variant');
  return full;
}

// DESIGN.md gets one line per pick under "## Taste notes" (created at the end when missing); other lines stay
export function withTasteNote(designMd, line) {
  const text = String(designMd || '# Design\n');
  const m = text.match(/^## Taste notes[^\n]*\n/m);
  if (!m) return `${text.replace(/\n*$/, '\n')}\n## Taste notes\nWhat the owner picked between design variants. Later rounds follow these.\n\n${line}\n`;
  const start = m.index + m[0].length;
  const next = text.slice(start).search(/^## /m);
  const end = next < 0 ? text.length : start + next;
  const body = text.slice(start, end).replace(/\n*$/, '\n');
  return text.slice(0, start) + body + line + '\n' + (next < 0 ? '' : '\n') + text.slice(end).replace(/^\n+/, '');
}

export function pick(root, screen, file, { note = '', now = Date.now() } = {}) {
  const g = groups(root).find((x) => x.screen === screen);
  if (!g) throw notFound('No such design');
  const v = g.variants.find((x) => x.file === file);
  if (!v) throw bad('Pick one of the variants');
  writeText(path.join(root, DIR, screen, 'CHOSEN'), `${file}\n`);
  const others = g.variants.filter((x) => x !== v).map((x) => x.title);
  const line = `- ${new Date(now).toISOString().slice(0, 10)} · ${screen}: the owner picked "${v.title}" over ${others.map((t) => `"${t}"`).join(', ')}${String(note).trim() ? `. Why: ${String(note).replace(/\s+/g, ' ').trim().slice(0, 300)}` : ''} (docs/design/variants/${screen}/${file})`;
  const dm = path.join(root, 'docs', 'DESIGN.md');
  writeText(dm, withTasteNote(readText(dm), line));
  return { screen, chosen: file, title: v.title, others, line };
}
