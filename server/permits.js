// SPDX-License-Identifier: Apache-2.0
// Narrow allow rules for a Floor's .claude/settings.json (1.0.1). Background runs (chat replies, jobs) use
// "dontAsk": a tool call the settings do not allow is denied without a prompt. The owner can allow what was denied,
// one narrow rule at a time: a command prefix with its first words (`Bash(ssh erpnext@192.168.0.150 *)`), one file,
// one web domain, one MCP tool. Never a bare tool, a wildcard of its own, shell operators, a command that runs other
// commands (sudo, sh -c, xargs, env ...), `git push`, the squad's deny list or anything on the Autopilot hard-stop list.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, bad } from './util.js';
import { SQUAD_DENY } from './sprint.js';
import { classify } from './autopilot.js';

const WRAPPERS = /^(sudo|su|doas|eval|exec|env|xargs|bash|sh|zsh|dash|fish|nohup|time|timeout|nice|watch|command|builtin|source|\.)$/;
const BANNED = [/^git push\b/, /^git reset --hard\b/, /^rm -rf?\b/, /--force\b/, /^(dd|mkfs\S*|shutdown|reboot|halt|poweroff|chmod 777)\b/];
const SECRET = /(^|\/)\.env(\.|$)|id_rsa|id_ed25519|\.pem$|\.key$|credentials|secrets?/i;
const FILE_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

// a denial ({ tool, command }) -> the narrow rule the owner is asked about, or null when none would be narrow
export function proposeRule({ tool, command = '' } = {}) {
  const c = String(command).trim();
  if (tool === 'Bash') {
    // the program and its first word; an option there (`ssh -p 22 host`) would not be narrow
    const words = c.split(/\s+/);
    if (words.length < 2 || words[1].startsWith('-')) return null;
    const rule = `Bash(${words[0]} ${words[1]} *)`;
    return checkRule(rule).ok ? rule : null;
  }
  if (FILE_TOOLS.includes(tool) && c) {
    const rule = `${tool}(${c.startsWith('/') ? `/${c}` : c.startsWith('.') ? c : `./${c}`})`;    // "//abs" is an absolute path
    return checkRule(rule).ok ? rule : null;
  }
  if (tool === 'WebFetch' && c) { try { return `WebFetch(domain:${new URL(c).hostname})`; } catch { return null; } }
  if (/^mcp__\w+__\w+/.test(tool || '')) return tool;
  return null;
}

// -> { ok } or { ok: false, error }
export function checkRule(rule) {
  const r = String(rule || '').trim();
  const no = (error) => ({ ok: false, error });
  if (/^mcp__[\w-]+__[\w-]+$/.test(r)) return { ok: true };
  const m = r.match(/^(\w+)\((.+)\)$/);
  if (!m) return no('A rule names one tool and what it may do, for example Bash(ssh user@host *)');
  const [, tool, spec] = m;
  if (tool === 'Bash') {
    const prefix = spec.replace(/\s\*$/, '');
    if (prefix.includes('*') || /:\*$/.test(spec)) return no('Only one wildcard, at the end after a space');
    if (/[;&|`$<>(){}\\\n]/.test(prefix)) return no('No shell operators in an allow rule');
    const words = prefix.split(/\s+/);
    if (words.length < 2) return no('Name the program and at least one more word (narrow rules only)');
    if (WRAPPERS.test(words[0])) return no(`${words[0]} runs other commands: answer it on the Desk instead`);
    const all = [...SQUAD_DENY.filter((d) => d.startsWith('Bash(')).map((d) => d.slice(5, -1).replace(/\*/g, '').trim()), 'git push'];
    if (BANNED.some((re) => re.test(prefix)) || all.some((d) => d && prefix.startsWith(d))) return no(`${prefix} is never allowed in the background`);
    const c = classify(prefix);
    if (c.critical) return no(`${prefix} is on the hard-stop list (${c.reasons.join(', ')}): answer it on the Desk`);
    return { ok: true };
  }
  if (FILE_TOOLS.includes(tool)) {
    if (/\*/.test(spec)) return no('One file at a time, no wildcards');
    if (SECRET.test(spec)) return no('Secret files are never allowed');
    return { ok: true };
  }
  if (tool === 'WebFetch') return /^domain:[\w.-]+\.[a-z]{2,}$/i.test(spec) ? { ok: true } : no('One web domain, for example WebFetch(domain:docs.example.com)');
  return no(`${tool} rules are not added from here`);
}

// ---------- Servers (Floor settings): the hosts DevOps may reach with ssh ----------
// [{ host: alias or user@host, purpose }] -> cleaned, each with a narrow rule; throws on a host that is not
export const MAX_SERVERS = 20;
export const sshRule = (host) => `Bash(ssh ${host} *)`;
export function cleanServers(list = []) {
  if (!Array.isArray(list)) throw bad('Servers must be a list');
  const out = [];
  for (const s of list.slice(0, MAX_SERVERS)) {
    const host = String(s?.host || '').trim();
    if (!host) continue;
    if (!/^([\w.-]+@)?[\w.-]+$/.test(host) || host.startsWith('-')) throw bad(`${host}: write a host alias or user@host`);
    const c = checkRule(sshRule(host));
    if (!c.ok) throw bad(`${host}: ${c.error}`);
    if (out.some((x) => x.host === host)) continue;
    out.push({ host, purpose: String(s.purpose || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160) });
  }
  return out;
}
// the allow rules follow the list: new hosts added, removed hosts taken out
export function syncServerRules(root, before = [], after = []) {
  const want = new Set(after.map((s) => sshRule(s.host)));
  const removed = removeAllowRules(root, before.map((s) => sshRule(s.host)).filter((r) => !want.has(r)));
  const added = addAllowRules(root, [...want]);
  return { added, removed };
}

const settingsFile = (root) => path.join(root, '.claude', 'settings.json');
// adds narrow allow rules (each checked) -> the rules added
export function addAllowRules(root, rules) {
  for (const r of rules) { const c = checkRule(r); if (!c.ok) throw bad(c.error); }
  const p = settingsFile(root);
  const cur = fs.existsSync(p) ? readJson(p, null) : {};
  if (!cur) throw bad('.claude/settings.json is not valid JSON; fix it first');
  cur.permissions = { ...(cur.permissions || {}) };
  const allow = cur.permissions.allow || [];
  const added = rules.filter((r) => !allow.includes(r));
  if (!added.length) return [];
  cur.permissions.allow = [...allow, ...added];
  writeJson(p, cur);
  return added;
}
export function removeAllowRules(root, rules) {
  const p = settingsFile(root);
  const cur = fs.existsSync(p) ? readJson(p, null) : null;
  if (!cur?.permissions?.allow) return [];
  const removed = cur.permissions.allow.filter((r) => rules.includes(r));
  if (!removed.length) return [];
  cur.permissions.allow = cur.permissions.allow.filter((r) => !rules.includes(r));
  writeJson(p, cur);
  return removed;
}
