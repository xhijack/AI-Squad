// Shared helpers for the Squad Sprint gate hooks (Node, no jq). Scaffolded by The AI Squad.
const fs = require('fs');
const path = require('path');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// .claude/squad/config.sh: KEY="value" lines (no shell is run)
function config() {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, '.claude', 'squad', 'config.sh'), 'utf8'); } catch { /* defaults */ }
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(?:"((?:[^"\\]|\\.)*)"|(\S*))/);
    if (m) out[m[1]] = (m[2] !== undefined ? m[2] : m[3] || '').replace(/\\(.)/g, '$1');
  }
  return out;
}

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function squadDir(cfg) {
  const dir = path.join(ROOT, cfg.SQUAD_DOCS || 'docs/squad');
  if (cfg.HOOK_DEBUG === '1') fs.mkdirSync(path.join(dir, '.hook-log'), { recursive: true });
  return dir;
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const status = (text) => ((String(text || '').match(/^STATUS:[ \t]*([A-Za-z]+)/m) || [])[1] || '').toUpperCase();
const mdFiles = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return []; } };

// all strings anywhere in a JSON value
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

// exit 2 = refuse; stderr goes back to the agent
function reject(msg) { process.stderr.write(msg.trimEnd() + '\n'); process.exit(2); }

// The gate itself: why a task may not be completed yet ('' = it may). kind: BUILD | BUG | QA.
// Used by the TaskCompleted hook and by the board gate on docs/squad/TASKS.md.
function checkTask(kind, id, cfg, dir) {
  const { execSync } = require('child_process');
  const docs = cfg.SQUAD_DOCS || 'docs/squad';
  const tests = () => {
    if (!cfg.TEST_CMD) return '';
    try { execSync(cfg.TEST_CMD, { cwd: ROOT, stdio: 'pipe', shell: '/bin/bash', timeout: 14 * 60e3 }); return ''; }
    catch (e) {
      const out = `${e.stdout || ''}${e.stderr || ''}`.split('\n').slice(-40).join('\n');
      return `Quality gate: tests FAILED for ${id}. Fix them before completing the task.\nCommand: ${cfg.TEST_CMD}\n--- last 40 lines ---\n${out}`;
    }
  };
  if (kind === 'BUILD') {
    if (!fs.existsSync(path.join(dir, 'handoff', `${id}.md`))) return `Quality gate: no handoff note yet.\nWrite ${docs}/handoff/${id}.md (template: ${docs}/templates/handoff.md),\nthen complete the task again and message QA.`;
    return tests();
  }
  if (kind === 'BUG') {
    const bug = read(path.join(dir, 'bugs', `${id}.md`));
    if (bug === null) return `Quality gate: bug file ${docs}/bugs/${id}.md not found.`;
    if (status(bug) !== 'FIXED' && status(bug) !== 'VERIFIED') return `Quality gate: set 'STATUS: FIXED' in ${docs}/bugs/${id}.md\nand fill in the 'Fix' section, then ask QA to retest.`;
    return tests();
  }
  if (kind === 'QA') {
    const report = read(path.join(dir, 'qa', `${id}.md`));
    if (report === null) return `Quality gate: no QA report at ${docs}/qa/${id}.md yet.`;
    if (status(report) !== 'PASS') return `Quality gate: QA report ${id} is not 'STATUS: PASS'.\nWhile Blocker or Major bugs are open, keep the QA task open: file BUG tasks and wait for the fixes.`;
    const open = mdFiles(path.join(dir, 'bugs')).filter((f) => f.toUpperCase().startsWith(`${id}-`) && ['OPEN', 'FIXED'].includes(status(read(path.join(dir, 'bugs', f))))).map((f) => f.slice(0, -3));
    if (open.length) return `Quality gate: bugs for ${id} are not VERIFIED or DEFERRED yet: ${open.join(' ')}\nRetest until they are VERIFIED (or DEFERRED with the lead's approval).`;
  }
  return '';
}

// "BUILD M01 Login", "[QA] M01: Login" -> { kind, id } or null
function taskOf(name) {
  const words = String(name || '').replace(/[[\]:]/g, '').trim().split(/\s+/);
  const kind = (words[0] || '').toUpperCase(), id = (words[1] || '').toUpperCase();
  return ['BUILD', 'QA', 'BUG'].includes(kind) && /^M\d/.test(id) ? { kind, id } : null;
}

module.exports = { ROOT, config, readInput, squadDir, read, status, mdFiles, strings, reject, checkTask, taskOf };
