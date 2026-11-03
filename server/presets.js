// SPDX-License-Identifier: Apache-2.0
// Business presets (1.13): what kind of business the Company Guide is setting up, as files, not code. Each preset is a
// Markdown file with a header; the shipped ones are in templates/presets/, the Owner's own in ~/.aisquad/presets/ (a
// file with the same id replaces the shipped one). A new kind of business (a dental clinic, a law firm) is one file:
//   ---
//   id: dental-clinic                     kebab case; the file name is <id>.md
//   order: 65                             where it is listed (low first)
//   title: { en: Dental clinic, id: Klinik gigi }
//   hint: { en: Patients and treatments, id: Pasien dan perawatan }
//   divisions: [marketing, sales, legal]  the divisions the guide suggests (the Company Guide's division ids)
//   marketing: search                     optional: Marketing's focus, all (the default) or search
//   local: true                           optional: customers come from nearby (the search squad gets local SEO)
//   ---
//   A paragraph about the business for Claude Code when it sharpens the plan.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { parseFrontmatter } from './frontmatter.js';
import { readText, safeReaddir, oneLine, clip } from './util.js';

export const SHIPPED = path.join(ROOT, 'templates', 'presets');
export const ownDir = () => path.join(config.home, 'presets');
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const FOCUS = ['all', 'search'];

const label = (v, fallback) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const en = oneLine(v.en || fallback, 60);
    return { en, id: oneLine(v.id || en, 60) };
  }
  const s = oneLine(v || fallback, 60);
  return { en: s, id: s };
};
// one file -> a preset, or null when it cannot be used (divisions: the guide's known division ids)
export function parsePreset(text, fileId, known) {
  let data, body;
  try { ({ data, body } = parseFrontmatter(String(text || ''))); } catch { return null; }
  const id = String(data.id || fileId || '').trim();
  if (!ID.test(id) || (fileId && id !== fileId)) return null;
  const divisions = (Array.isArray(data.divisions) ? data.divisions : []).map(String).filter((d) => known.includes(d));
  if (!divisions.length) return null;
  return {
    id, order: Number.isFinite(Number(data.order)) ? Number(data.order) : 500,
    title: label(data.title, id), hint: label(data.hint, ''),
    divisions: [...new Set(divisions)],
    marketing: FOCUS.includes(data.marketing) ? data.marketing : 'all',
    local: data.local === true || data.local === 'true',
    about: clip(String(body || '').trim(), 1200),
    source: fileId && fs.existsSync(path.join(ownDir(), `${fileId}.md`)) ? 'own' : 'shipped',
  };
}
// every usable preset, the Owner's over the shipped ones; "other" is always there
export function list(known) {
  const byId = new Map();
  for (const dir of [SHIPPED, ownDir()]) {
    for (const f of safeReaddir(dir).filter((n) => n.endsWith('.md'))) {
      const p = parsePreset(readText(path.join(dir, f), ''), f.slice(0, -3), known);
      if (p) byId.set(p.id, p);
    }
  }
  if (!byId.has('other')) byId.set('other', { id: 'other', order: 999, title: { en: 'Something else', id: 'Lainnya' }, hint: { en: '', id: '' }, divisions: known.filter((d) => ['marketing', 'sales', 'legal'].includes(d)), marketing: 'all', local: false, about: '', source: 'shipped' });
  return [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
