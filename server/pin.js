// SPDX-License-Identifier: Apache-2.0
// Local PIN for mutating actions, stored in ~/.aisquad/pin (0600).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { paths } from './config.js';
import { writeText } from './util.js';

export function loadPin() {
  try { const p = fs.readFileSync(paths.pin(), 'utf8').trim(); if (p) return p; } catch { /* create below */ }
  const p = String(crypto.randomInt(100000, 999999));
  writeText(paths.pin(), p + '\n', 0o600);
  fs.chmodSync(paths.pin(), 0o600);
  return p;
}

export function checkPin(expected, got) {
  const a = Buffer.from(String(got ?? '')), b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
