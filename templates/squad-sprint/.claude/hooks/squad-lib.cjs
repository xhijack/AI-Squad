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

module.exports = { ROOT, config, readInput, squadDir, read, status, mdFiles, strings, reject };
