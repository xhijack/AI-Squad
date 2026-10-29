#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Contrast check over the token pairs of ui/tokens.css (1.2.0), light and dark: text ≥ 4.5:1 on its surface,
// state pill borders and the focus ring ≥ 3:1. Translucent colours are laid over the colour behind them.
//   node scripts/contrast.js        prints every pair, exits 1 when one fails
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// [foreground, background, minimum]; a background "a/b" is a over b (glass panels over the page)
export const PAIRS = [
  ['text', 'surface', 4.5], ['text', 'surface-muted', 4.5], ['text', 'bg', 4.5], ['text', 'surface-glass/bg', 4.5],
  ['text-muted', 'surface', 4.5], ['text-muted', 'surface-muted', 4.5], ['text-muted', 'bg', 4.5], ['text-muted', 'surface-glass/bg', 4.5],
  ['accent-text', 'surface', 4.5], ['accent-text', 'surface-muted', 4.5], ['on-accent', 'accent', 4.5], ['on-accent', 'accent-hover', 4.5],
  ['on-danger', 'danger', 4.5], ['on-danger', 'danger-hover', 4.5],
  ['success-ink', 'success-soft', 4.5], ['warning-ink', 'warning-soft', 4.5], ['danger-ink', 'danger-soft', 4.5], ['info-ink', 'info-soft', 4.5],
  ['neutral-ink', 'neutral-soft', 4.5], ['crashed', 'crashed-soft', 4.5], ['violet', 'violet-soft', 4.5],
  ['success-ink', 'surface', 4.5], ['warning-ink', 'surface', 4.5], ['danger-ink', 'surface', 4.5], ['neutral-ink', 'surface', 4.5],
  ['label-text', 'label-bg', 4.5], ['on-dark', 'tip-bg/bg', 4.5],
  // state pill borders and the dots beside them, against the panel
  ['success', 'surface', 3], ['warning-border', 'surface', 3], ['danger', 'surface', 3], ['neutral', 'surface', 3], ['crashed', 'surface', 3], ['info', 'surface', 3],
  ['tag-working', 'label-bg', 3], ['tag-idle', 'label-bg', 3], ['tag-waiting', 'label-bg', 3], ['tag-stopped', 'label-bg', 3], ['tag-crashed', 'label-bg', 3],
  ['focus', 'surface', 3], ['focus', 'bg', 3], ['accent', 'surface', 3],
];

// the custom properties of one block: light = the first ":root {", dark = ':root[data-theme="dark"] {' over light
export function readTokens(css, theme = 'light') {
  if (theme === 'dark') return { ...readTokens(css), ...block(css, theme) };
  return block(css, theme);
}
function block(css, theme) {
  const start = theme === 'dark' ? css.indexOf(':root[data-theme="dark"]') : css.indexOf(':root {');
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

export function parseColor(s) {
  s = String(s).trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1); }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
  return null;
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

// a token name to an opaque colour ("surface-glass/bg" = surface-glass laid over bg)
function resolve(tokens, name) {
  const parts = name.split('/').map((n) => parseColor(tokens[n]));
  if (parts.some((c) => !c)) throw new Error(`not a colour: ${name}`);
  return parts.reduceRight((bg, c) => over(c, bg), [255, 255, 255, 1]);
}

export function check(css, pairs = PAIRS) {
  const rows = [];
  for (const theme of ['light', 'dark']) {
    const tokens = readTokens(css, theme);
    for (const [fg, bg, min] of pairs) {
      const r = ratio(over(resolve(tokens, fg), resolve(tokens, bg)), resolve(tokens, bg));
      rows.push({ theme, fg, bg, min, ratio: Math.round(r * 100) / 100, ok: r >= min });
    }
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = check(fs.readFileSync(path.join(ROOT, 'ui', 'tokens.css'), 'utf8'));
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.theme.padEnd(5)} ${r.fg.padEnd(14)} on ${r.bg.padEnd(16)} ${r.ratio.toFixed(2).padStart(5)} (≥ ${r.min})`);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}
