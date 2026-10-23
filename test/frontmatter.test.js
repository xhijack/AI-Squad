import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, stringifyFrontmatter, parseYaml } from '../server/frontmatter.js';

const SPEC_EXAMPLE = `---
role: frappe-developer
title: Frappe Developer
version: 3
model: sonnet
effort: medium
skills: [frappe, erpnext]
tools: [Read, Edit, Write, Bash, Grep, Glob]
permissions:
  deny: ["Read(./.env)", "Bash(git push*)"]
appearance: { style: spiky, shirt: "#3d82d6" }
---
## Rules
- Never edit Frappe core; always work in a custom app.
`;

test('parses the Role Template example from the spec', () => {
  const { data, body } = parseFrontmatter(SPEC_EXAMPLE);
  assert.equal(data.role, 'frappe-developer');
  assert.equal(data.version, 3);
  assert.deepEqual(data.skills, ['frappe', 'erpnext']);
  assert.deepEqual(data.permissions, { deny: ['Read(./.env)', 'Bash(git push*)'] });
  assert.deepEqual(data.appearance, { style: 'spiky', shirt: '#3d82d6' });
  assert.match(body, /^## Rules/);
});

test('round-trips through stringify', () => {
  const { data, body } = parseFrontmatter(SPEC_EXAMPLE);
  const again = parseFrontmatter(stringifyFrontmatter(data, body));
  assert.deepEqual(again.data, data);
  assert.equal(again.body, body);
});

test('block lists, booleans, quoted keys and comments', () => {
  const y = parseYaml('# comment\nlist:\n  - a\n  - "b c"\nflag: true\nnum: -2.5\n"odd key": x\nempty:\nnested:\n  inner:\n    deep: 1\n');
  assert.deepEqual(y, { list: ['a', 'b c'], flag: true, num: -2.5, 'odd key': 'x', empty: null, nested: { inner: { deep: 1 } } });
});

test('strings that look like other types are quoted on output', () => {
  const text = stringifyFrontmatter({ a: 'true', b: '3', c: '#fff', d: 'plain text', e: ['x, y', 'z'] });
  assert.deepEqual(parseFrontmatter(text).data, { a: 'true', b: '3', c: '#fff', d: 'plain text', e: ['x, y', 'z'] });
});

test('text without frontmatter is all body', () => {
  assert.deepEqual(parseFrontmatter('# Hello'), { data: {}, body: '# Hello' });
});
