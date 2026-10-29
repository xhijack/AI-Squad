// SPDX-License-Identifier: Apache-2.0
// Design tokens (1.2.0): every text pair ≥ 4.5:1 and every state border / focus ring ≥ 3:1, light and dark;
// style.css has no raw colours outside the tokens and no text below 12 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, ratio, parseColor, readTokens } from '../scripts/contrast.js';

const ui = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const tokens = fs.readFileSync(path.join(ui, 'tokens.css'), 'utf8');
const style = fs.readFileSync(path.join(ui, 'style.css'), 'utf8');

test('contrast ratios follow WCAG', () => {
  assert.equal(Math.round(ratio(parseColor('#000'), parseColor('#fff')) * 10) / 10, 21);
  assert.equal(Math.round(ratio(parseColor('#777777'), parseColor('#ffffff')) * 100) / 100, 4.48);
  assert.deepEqual(parseColor('rgba(31, 41, 55, .5)'), [31, 41, 55, 0.5]);
});

test('every token pair meets its minimum in both themes', () => {
  const failed = check(tokens).filter((r) => !r.ok).map((r) => `${r.theme} ${r.fg} on ${r.bg}: ${r.ratio}`);
  assert.deepEqual(failed, []);
});

test('the dark theme overrides the light colours it needs and keeps the rest', () => {
  const light = readTokens(tokens), dark = readTokens(tokens, 'dark');
  assert.notEqual(dark.surface, light.surface);
  assert.equal(dark['tag-working'], light['tag-working']);      // scene name tags stay light
  assert.equal(dark['fs-xs'], '12px');
});

test('style.css uses tokens: no raw hex colours, no font size below 12 px, no ad-hoc sizes', () => {
  const css = style.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(css.match(/#[0-9a-f]{3,8}\b/gi) || [], []);
  assert.deepEqual(css.match(/font(?:-size)?:[^;]*\b(?:[0-9]|1[01])(?:\.\d+)?px/g) || [], []);
  assert.deepEqual(css.match(/font-size:\s*[\d.]+px/g) || [], [], 'font sizes come from --fs-*');
  assert.deepEqual(css.match(/border-radius:\s*(?!0\b)[\d.]+px/g) || [], [], 'radius comes from --r-*');
});
