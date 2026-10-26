// UI language: every key in both languages, every t('…') in the UI has a key, placeholders and tags kept,
// Indonesian copy says "kamu" and has no emoji; tx() also translates server text by pattern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const en = JSON.parse(fs.readFileSync(path.join(ui, 'i18n', 'en.json'), 'utf8'));
const id = JSON.parse(fs.readFileSync(path.join(ui, 'i18n', 'id.json'), 'utf8'));
const holders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const tags = (s) => [...s.matchAll(/<\/?(\w+)/g)].map((m) => m[1]).sort().join();

test('every key is in both languages; English values are the keys', () => {
  assert.deepEqual(Object.keys(id).sort(), Object.keys(en).sort());
  for (const [k, v] of Object.entries(en)) assert.equal(v, k);
});

test('every t(\'…\') in the UI code has a key', () => {
  const missing = [];
  for (const f of fs.readdirSync(ui).filter((x) => x.endsWith('.js') && x !== 'i18n.js')) {   // i18n.js: only examples in comments
    const src = fs.readFileSync(path.join(ui, f), 'utf8');
    for (const m of src.matchAll(/\b(?:t|tt)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      const key = m[2].replace(/\\(['"\\])/g, '$1');
      if (!(key in en)) missing.push(`${f}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('translations keep placeholders and tags, say "kamu", and have no emoji', () => {
  for (const [k, v] of Object.entries(id)) {
    assert.ok(typeof v === 'string' && v.trim(), `empty: ${k}`);
    assert.equal(holders(v), holders(k), `placeholders differ: ${k}`);
    assert.equal(tags(v), tags(k), `tags differ: ${k}`);
    assert.doesNotMatch(v, /\bAnda\b/, `"Anda" in: ${k}`);
    assert.doesNotMatch(v, /\p{Extended_Pictographic}/u, `emoji in: ${k}`);
  }
});

test('t fills placeholders; tx matches server text by pattern', async () => {
  const i18n = await import('../ui/i18n.js');
  i18n.setTable({ '{n} min ago': '{n} menit lalu', '{name} is waiting for you': '{name} menunggu kamu', Idle: 'Santai' });
  assert.equal(i18n.t('{n} min ago', { n: 3 }), '3 menit lalu');
  assert.equal(i18n.t('Not in the table'), 'Not in the table', 'unknown copy stays English');
  assert.equal(i18n.tx('Rina is waiting for you'), 'Rina menunggu kamu', 'a pattern with the name kept');
  assert.equal(i18n.tx('Idle'), 'Santai');
  assert.equal(i18n.tx('Something the agent wrote'), 'Something the agent wrote');
  i18n.setTable({});
  assert.equal(i18n.tx('Idle'), 'Idle', 'English: no table, as it is');
});
