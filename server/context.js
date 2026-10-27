// SPDX-License-Identifier: Apache-2.0
// One agent, many Spaces, no mixed contexts (0.12). Every session of an agent in a Space is started with:
//   L0  the Company Brain, read-only (--add-dir), its Owner folders unreadable outside Owner Spaces
//   L1  its identity (the generated agent file from its Role Template), which it cannot change: no writes to
//       ~/.claude/CLAUDE.md (read by every project on this machine), ~/.claude/agent-memory, ~/.aisquad
//   L2  the Space: its repository, and its auto memory in the repository when the Space says so (--settings)
//   L3  the session itself, thrown away after the task; what it learned is written into the Space
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as company from './company.js';
import * as space from './space.js';
import * as erp from './erpnext.js';

const PRIVATE = ['secrets.json', 'pin', 'users.json', 'notify.json', 'handoffs.json', 'erpnext.json'];
// the rules that keep an agent's identity and the machine's shared memory out of reach of one Space's work
export function identityDenyRules() {
  const claude = config.claudeHome, home = config.home;
  return [
    ...['Edit', 'Write', 'MultiEdit'].map((t) => `${t}(/${path.join(claude, 'CLAUDE.md')})`),
    ...['Edit', 'Write', 'MultiEdit'].map((t) => `${t}(/${path.join(claude, 'agent-memory')}/**)`),
    ...['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].map((t) => `${t}(/${home}/**)`),
    // the machine's secrets and the Owner's desk are not for reading either (0.19): keys, PINs, people, held packages,
    // price approvals, and other processes' environments
    ...PRIVATE.map((f) => `Read(/${path.join(home, f)})`), 'Read(//proc/**)',
    ...PRIVATE.filter((f) => f !== 'pin').map((f) => `Bash(*${f}*)`), `Bash(*${path.join(home, 'pin')}*)`, 'Bash(*.aisquad/pin*)', 'Bash(*/proc/*/environ*)', 'Bash(*AISQUAD_ERP_*)',
  ];
}

// -> { addDirs: ['--add-dir', dir], deny: [...], settings: {...} | null, lines: [...] for the agent file }
export function sessionContext(root, floor, prefs = {}) {
  const sp = space.cleanSpace(floor);
  const dir = company.companyDir(prefs);
  const has = fs.existsSync(dir);
  const owner = sp.access === 'owner';
  return {
    addDirs: has ? ['--add-dir', dir] : [],
    deny: [...identityDenyRules(), ...(has ? company.denyRules(dir, { owner }) : [])],
    settings: space.sessionSettings(root, sp),
    lines: contextLines(sp, has ? dir : '', owner),
  };
}

export function contextLines(sp, dir, owner) {
  return [
    `This Space is a ${sp.kind}${owner ? ' for the Owner only' : ''}. Your identity is your role; what you learn about this ${sp.kind === 'department' ? 'department\'s clients' : 'client or project'} stays in this Space (its documents, \`docs/squad/LEARNINGS.md\`${sp.memory === 'repo' ? ', its memory in `.claude/aisquad/memory/`' : ''}).`,
    'People may message you directly (Desk → Chat): answer them in your reply. The lead finds a list of those messages in `docs/squad/DIRECT.md`.',
    'Never write client or project facts to `~/.claude/CLAUDE.md`, `~/.aisquad` or the Company Brain: other Spaces would see them. Those paths are read-only for you.',
    ...(dir ? [`The Company Brain is at \`${dir}\` (read only): ${company.TEAM_DIRS.join(', ')}${owner ? `, and for this Owner Space ${company.OWNER_DIRS.join(', ')}` : ''}. Read what the task needs; follow the brand and the SOPs there.`] : []),
    ...(!owner && dir ? [`Legal, finance and pricing are not for this Space: ask the lead or the owner instead of looking for them.`] : []),
    'Work for another Space goes as a handoff package: a Markdown file in `docs/squad/handoffs/outbox/` with a header (`to:` the Space, `kind:`, `title:`), see the space-handoff skill; the server delivers it and wakes the receiver. Work handed to this Space arrives in `docs/squad/handoffs/inbox/`.',
    ...(erp.sessionFor(sp) ? [erp.contextLine(sp.erpnext)] : []),
  ];
}
