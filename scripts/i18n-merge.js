#!/usr/bin/env node
// Folds translation fragments ({ "English key": "Indonesian" } JSON files) into ui/i18n/id.json and rewrites
// ui/i18n/en.json from the keys (value = key). Existing translations win unless --replace is given.
//   node scripts/i18n-merge.js fragment.json [...] [--replace]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'i18n');
const args = process.argv.slice(2), replace = args.includes('--replace');
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
const id = read(path.join(dir, 'id.json'));
let added = 0;
for (const f of args.filter((a) => a !== '--replace')) for (const [k, v] of Object.entries(read(f))) { if (replace || !(k in id)) { if (!(k in id)) added++; id[k] = v; } }
const sorted = Object.fromEntries(Object.keys(id).sort((a, b) => a.localeCompare(b, 'en')).map((k) => [k, id[k]]));
fs.writeFileSync(path.join(dir, 'id.json'), `${JSON.stringify(sorted, null, 1)}\n`);
fs.writeFileSync(path.join(dir, 'en.json'), `${JSON.stringify(Object.fromEntries(Object.keys(sorted).map((k) => [k, k])), null, 1)}\n`);
console.log(`${Object.keys(sorted).length} keys (${added} new)`);
