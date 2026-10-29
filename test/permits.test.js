// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as permits from '../server/permits.js';

test('proposeRule: the program and its first word, one file, one domain; null when nothing narrow fits', () => {
  assert.equal(permits.proposeRule({ tool: 'Bash', command: 'ssh erpnext@192.168.0.150 "df -h"' }), 'Bash(ssh erpnext@192.168.0.150 *)');
  assert.equal(permits.proposeRule({ tool: 'Bash', command: 'ssh -p 2222 erpnext@host uptime' }), null, 'an option is not narrow');
  assert.equal(permits.proposeRule({ tool: 'Bash', command: 'npm run build' }), 'Bash(npm run *)');
  assert.equal(permits.proposeRule({ tool: 'Bash', command: 'ls' }), null, 'one word is not narrow');
  assert.equal(permits.proposeRule({ tool: 'Bash', command: 'git push origin main' }), null);
  assert.equal(permits.proposeRule({ tool: 'Bash', command: 'sudo systemctl restart nginx' }), null);
  assert.equal(permits.proposeRule({ tool: 'Read', command: '/etc/hosts' }), 'Read(//etc/hosts)');
  assert.equal(permits.proposeRule({ tool: 'Read', command: '.env' }), null, 'secrets never');
  assert.equal(permits.proposeRule({ tool: 'WebFetch', command: 'https://docs.frappe.io/x?y' }), 'WebFetch(domain:docs.frappe.io)');
  assert.equal(permits.proposeRule({ tool: 'mcp__erp__get_doc' }), 'mcp__erp__get_doc');
});

test('checkRule refuses wildcards, bare tools, shell operators, wrappers, git push and the hard-stop list', () => {
  for (const r of ['Bash(ssh erpnext@host *)', 'Bash(npm test *)', 'Edit(./src/a.js)', 'WebFetch(domain:example.com)']) assert.ok(permits.checkRule(r).ok, r);
  const no = (r, re) => { const c = permits.checkRule(r); assert.equal(c.ok, false, r); if (re) assert.match(c.error, re, r); };
  no('Bash', /names one tool/); no('Bash(*)'); no('Bash(npm *)', /at least one more word/); no('Bash(npm * test)', /one wildcard/);
  no('Bash(npm test:*)'); no('Bash(npm test && curl x *)', /shell operators/); no('Bash(sh -c *)', /runs other commands/);
  no('Bash(git push origin *)', /never allowed/); no('Bash(rm -rf build *)', /never allowed/); no('Bash(git reset --hard *)');
  no('Bash(npm publish --force *)'); no('Bash(nginx -s reload *)', /hard-stop/); no('Bash(ssh deploy@prod-server *)', /hard-stop/);
  no('Read(./**)'); no('Read(./.env.production)', /Secret/); no('WebFetch(domain:*)'); no('Task(x)');
});

test('addAllowRules merges into .claude/settings.json once, keeps what was there; removeAllowRules takes them out', () => {
  const root = scratch();
  fs.mkdirSync(path.join(root, '.claude'));
  const p = path.join(root, '.claude', 'settings.json');
  fs.writeFileSync(p, JSON.stringify({ env: { A: '1' }, permissions: { allow: ['Bash(npm test *)'], deny: ['Bash(git push*)'] } }));
  assert.deepEqual(permits.addAllowRules(root, ['Bash(ssh erpnext@host *)', 'Bash(npm test *)']), ['Bash(ssh erpnext@host *)']);
  assert.deepEqual(permits.addAllowRules(root, ['Bash(ssh erpnext@host *)']), []);
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepEqual(s.permissions, { allow: ['Bash(npm test *)', 'Bash(ssh erpnext@host *)'], deny: ['Bash(git push*)'] }); assert.equal(s.env.A, '1');
  assert.throws(() => permits.addAllowRules(root, ['Bash(git push *)']), /never allowed/);
  assert.deepEqual(permits.removeAllowRules(root, ['Bash(ssh erpnext@host *)']), ['Bash(ssh erpnext@host *)']);
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')).permissions.allow, ['Bash(npm test *)']);
});
