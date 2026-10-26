// Scratch AI Squad home + Claude home under the OS temp dir; never touches the real ~/.aisquad or ~/.claude.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { configure, config } from '../server/config.js';
import { seedDefaults } from '../server/roles.js';
import { seedBlueprints } from '../server/blueprints.js';

export function scratch({ seed = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aisquad-test-'));
  // the first-run scan looks at a scratch /proc and the private tmux server, never at the real machine
  configure({ home: path.join(root, 'home'), claudeHome: path.join(root, 'claude'), tmuxSocket: `aisquad-test-${process.pid}`, scanTmuxSocket: `aisquad-test-${process.pid}`, procDir: path.join(root, 'proc') });
  fs.mkdirSync(path.join(root, 'claude', 'projects'), { recursive: true });
  if (seed) { seedDefaults(); seedBlueprints(); }
  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    // the private tmux servers (shared one and one per agent) and their socket files (kill-server leaves them behind)
    const dir = path.join(process.env.TMUX_TMPDIR || '/tmp', `tmux-${process.getuid()}`);
    let files = []; try { files = fs.readdirSync(dir); } catch { /* none */ }
    for (const f of files.filter((x) => x === config.tmuxSocket || x.startsWith(`${config.tmuxSocket}--`))) {
      try { execFileSync('tmux', ['-L', f, 'kill-server'], { stdio: 'ignore' }); } catch { /* not running */ }
      fs.rmSync(path.join(dir, f), { force: true });
    }
  });
  return root;
}

export const jsonl = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';
