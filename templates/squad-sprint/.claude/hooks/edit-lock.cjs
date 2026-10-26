#!/usr/bin/env node
// Squad Sprint edit locks (PreToolUse on Edit / Write / MultiEdit / NotebookEdit / Bash).
// 1. A developer who owns modules in docs/squad/PLAN.md may edit only its modules' "Owned folders" and the squad's
//    own docs (docs/squad/): shared files (lockfiles, root config, migrations, the main layout) are the lead's.
//    Agents without modules in the plan (the lead, QA, the designer) are not limited. Unknown agents are let through.
// 2. Destructive commands (rm -rf, git reset --hard, force push, git clean, dropping tables, docker prune) ask
//    for confirmation with the reason; a background teammate cannot confirm, so for it they are refused.
const fs = require('fs');
const path = require('path');
const { ROOT, config, readInput, squadDir, read, recordGate } = require('./squad-lib.cjs');

const input = readInput();
const tool = String(input.tool_name || '');
const ti = input.tool_input || {};
const out = (decision, reason) => { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } })); process.exit(0); };

const DESTRUCTIVE = [
  [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/, 'deletes files recursively'],
  [/\bgit\s+reset\s+--hard\b/, 'throws away uncommitted work'],
  [/\bgit\s+push\b[^\n]*(--force\b|-f\b|--force-with-lease\b)/, 'rewrites the remote history'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'deletes untracked files'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, 'throws away all local changes'],
  [/\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b/i, 'deletes data'],
  [/\bdocker\s+(system|volume|image|network)\s+prune\b|\bdocker\s+volume\s+rm\b/, 'can delete other apps\' data'],
];

if (tool === 'Bash') {
  const cmd = String(ti.command || '');
  const hit = DESTRUCTIVE.find(([re]) => re.test(cmd));
  if (!hit) process.exit(0);
  recordGate('destructive', cmd.slice(0, 200), hit[1]);
  out('ask', `Destructive command: it ${hit[1]}. Confirm only if this is really intended (The AI Squad edit locks).`);
}

if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) process.exit(0);
const file = String(ti.file_path || ti.notebook_path || '');
if (!file) process.exit(0);
const rel = path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join('/');
if (rel.startsWith('..')) process.exit(0);                                    // outside the repo: not ours to judge

// who is editing: the subagent's type when the hook runs inside one, else the session's own agent
function agentId() {
  if (input.agent_type) return String(input.agent_type);
  if (input.agent_id && input.transcript_path) {
    const meta = read(path.join(path.dirname(input.transcript_path), path.basename(input.transcript_path, '.jsonl'), 'subagents', `agent-${input.agent_id}.meta.json`));
    try { const m = JSON.parse(meta || '{}'); if (m.customAgentType || m.agentType) return m.customAgentType || m.agentType; } catch { /* unreadable */ }
  }
  const own = String(process.env.AISQUAD_AGENT || '').split('/')[1];
  return own || '';
}

const cfg = config();
const dir = squadDir(cfg);
const me = agentId();
if (!me || me === cfg.LEAD_AGENT) process.exit(0);
// PLAN.md rows: | Module | Stories | SP | Owner | Owned folders | ... (columns found by name)
const plan = read(path.join(dir, 'PLAN.md')) || '';
const lines = plan.split('\n');
const owned = [];
for (let i = 0; i < lines.length - 1; i++) {
  const head = lines[i].trim().startsWith('|') ? lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().toLowerCase()) : null;
  if (!head || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
  const io = head.indexOf('owner'), iff = head.findIndex((h) => /owned folders?|folders?/.test(h));
  if (io < 0 || iff < 0) continue;
  for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
    const c = lines[j].trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
    if ((c[io] || '').replace(/`/g, '') === me) for (const f of (c[iff] || '').split(/[,;]| and /)) { const p = f.replace(/`/g, '').trim().replace(/^\.\//, '').replace(/\/+$/, ''); if (p && p !== '-' && p !== '—') owned.push(p); }
  }
  break;
}
if (!owned.length) process.exit(0);                                          // no modules of its own: not limited
const squadDocs = path.relative(ROOT, dir).split(path.sep).join('/');
const inside = (p) => rel === p || rel.startsWith(`${p}/`);
if (owned.some(inside) || inside(squadDocs)) process.exit(0);
recordGate('edit-lock', `${me}: ${rel}`, 'outside the owned folders');
out('deny', `${rel} is outside your module folders (${owned.join(', ')}). Shared files belong to the lead: ask the lead (SendMessage) to change it, or to give you the folder in PLAN.md.`);
