// SPDX-License-Identifier: Apache-2.0
// Accessibility and motion (1.2.0): focus ring from the tokens on every control, keyboard order = visual order of
// the page's regions, reduced motion stops camera easing and pulses, hit areas from the tokens.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { easeMs, easeStep, reducedMotion } from '../ui/motion.js';

const ui = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const css = fs.readFileSync(path.join(ui, 'style.css'), 'utf8');
const tokens = fs.readFileSync(path.join(ui, 'tokens.css'), 'utf8');
const html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8');

test('reduced motion: camera moves jump, easing factors are 1', () => {
  const real = globalThis.matchMedia;
  after(() => { globalThis.matchMedia = real; });
  globalThis.matchMedia = () => ({ matches: false });
  assert.equal(reducedMotion(), false);
  assert.equal(easeMs(900), 900);
  assert.equal(easeStep(0.2), 0.2);
  globalThis.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
  assert.equal(easeMs(900), 0);
  assert.equal(easeStep(0.2), 1);
});

test('the scenes ease the camera through ui/motion.js', () => {
  for (const f of ['scene.js', 'iso.js']) assert.match(fs.readFileSync(path.join(ui, f), 'utf8'), /from '\.\/motion\.js'/, f);
});

test('focus ring: one token, on every control, never removed', () => {
  assert.match(tokens, /--focus-ring:/);
  assert.match(css, /:focus-visible \{[^}]*outline: 2px solid var\(--focus\)/);
  assert.match(css, /input:focus-visible, select:focus-visible, textarea:focus-visible \{[^}]*var\(--focus-ring\)/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /:focus[^-{]*\{[^}]*outline: (none|0)/);
});

test('reduced motion stops animations and transitions; touch gets 44 px hit areas', () => {
  assert.match(tokens, /prefers-reduced-motion: reduce\) \{ :root \{ --dur-fast: 0ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important; transition: none !important;/);
  assert.match(tokens, /pointer: coarse\) \{ :root \{ --control-h: 44px; --control-h-sm: 36px; --hit-min: 44px; \}/);
  assert.match(css, /min-height: var\(--hit-min\)/);
});

test('keyboard order follows the screen: status bar, Floor switcher, panel, dock', () => {
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.ok(at('hud') < at('elevator') && at('elevator') < at('side') && at('side') < at('dock'));
});
