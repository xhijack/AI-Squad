#!/usr/bin/env node
// Squad Sprint: keep a teammate from going idle while work is waiting (TeammateIdle hook).
// The files in docs/squad are the source of truth (task status can lag).
//   QA agents (QA_AGENTS in config.sh): held while a handed-off module has no QA report or a FIXED bug waits for retest.
//   Other teammates (developers): held while a bug with OWNER: <their id> is OPEN.
// After IDLE_MAX_NUDGE nudges in a row the agent is released (no loops).
const fs = require('fs');
const path = require('path');
const { config, readInput, squadDir, read, status, mdFiles } = require('./squad-lib.cjs');

const input = readInput();
const cfg = config();
const docs = cfg.SQUAD_DOCS || 'docs/squad';
const dir = squadDir(cfg);
if (cfg.HOOK_DEBUG === '1') fs.writeFileSync(path.join(dir, '.hook-log', 'teammate-idle-last.json'), JSON.stringify(input, null, 2));
const max = Number(cfg.IDLE_MAX_NUDGE || 3);

const name = String(input.teammate_name || (input.teammate && input.teammate.name) || input.agent_name || input.name || input.agent_type || '').toLowerCase();
if (!name || !/^[\w.-]+$/.test(name)) process.exit(0);
const qaAgents = String(cfg.QA_AGENTS || '').split(/\s+/).filter(Boolean);
const isQa = qaAgents.length ? qaAgents.includes(name) : name.startsWith('qa');
const bugs = mdFiles(path.join(dir, 'bugs')).map((f) => ({ id: f.slice(0, -3), text: read(path.join(dir, 'bugs', f)) }));

let msg = '';
if (isQa) {
  const waiting = mdFiles(path.join(dir, 'handoff')).map((f) => f.slice(0, -3)).filter((id) => !fs.existsSync(path.join(dir, 'qa', `${id}.md`)));
  const retest = bugs.filter((b) => status(b.text) === 'FIXED').map((b) => b.id);
  if (waiting.length) msg += `Handed-off modules without a QA report: ${waiting.join(' ')}. `;
  if (retest.length) msg += `FIXED bugs waiting for retest: ${retest.join(' ')}. `;
} else if (name !== String(cfg.LEAD_AGENT || '').toLowerCase()) {
  const owner = new RegExp(`^OWNER:[ \\t]*${name.replace(/[.]/g, '\\.')}(\\s|$)`, 'im');
  const mine = bugs.filter((b) => owner.test(b.text) && status(b.text) === 'OPEN').map((b) => b.id);
  if (mine.length) msg = `You still have OPEN bugs: ${mine.join(' ')}. Fix them first (they come before new modules). `;
}

const counter = path.join(dir, `.idle-${name}`);
if (!msg) { fs.rmSync(counter, { force: true }); process.exit(0); }
const n = Number(read(counter) || 0) + 1;
if (n > max) { fs.rmSync(counter, { force: true }); process.exit(0); }   // release; the lead follows up
fs.writeFileSync(counter, String(n));
process.stderr.write(`Do not go idle yet. ${msg}Check ${docs} and continue.\n`);
process.exit(2);
