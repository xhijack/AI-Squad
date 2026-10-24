#!/usr/bin/env node
// Fake Claude Code for tests: an unnumbered trust dialog, then an input box. Submitted lines go to
// $FAKE_CLAUDE_LOG; typing "ask" opens a numbered permission dialog.
const fs = require('fs');
const log = process.env.FAKE_CLAUDE_LOG;
let mode = 'trust', sel = 0, buf = '';
const history = [];
const dialogs = {
  trust: { q: ['Do you trust the files in this folder?', '', '/tmp/project'], opts: ['Yes, I trust this folder', 'No, exit'], hint: 'Enter to confirm · Esc to exit', numbered: false },
  ask: { q: ['Bash command', '', '  rm build/cache', '', 'Do you want to proceed?'], opts: ['Yes', "Yes, and don't ask again for rm commands", 'No, and tell Claude what to do differently (esc)'], hint: 'Esc to cancel', numbered: true },
};
function draw() {
  let s = '\x1b[2J\x1b[H';
  for (const h of history) s += `> ${h}\r\n\r\n`;
  const d = dialogs[mode];
  if (d) {
    s += d.q.map((l) => ` ${l}`).join('\r\n') + '\r\n\r\n';
    s += d.opts.map((o, i) => `${i === sel ? ' ❯ ' : '   '}${d.numbered ? `${i + 1}. ` : ''}${o}`).join('\r\n') + '\r\n\r\n';
    s += ` ${d.hint}\r\n`;
  } else {
    s += '╭' + '─'.repeat(60) + '╮\r\n';
    s += `│ ❯ ${buf}\r\n`;
    s += '╰' + '─'.repeat(60) + '╯\r\n';
    s += '  ? for shortcuts\r\n';
  }
  process.stdout.write(s);
}
if (log) fs.appendFileSync(log, `START ${process.argv.slice(2).join(' ')}\nENV ${['AISQUAD_AGENT', 'AISQUAD_URL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'].map((k) => `${k}=${process.env[k] || ''}`).join(' ')}\n`);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (k) => {
  const d = dialogs[mode];
  if (d) {
    if (k === '\x1b[B') sel = Math.min(d.opts.length - 1, sel + 1);
    else if (k === '\x1b[A') sel = Math.max(0, sel - 1);
    else if (k === '\r') {
      if (log) fs.appendFileSync(log, `ANSWER ${mode} ${sel + 1}\n`);
      if (mode === 'trust' && sel === 1) process.exit(0);
      mode = 'input'; sel = 0;
    }
  } else if (k === '\r') {
    if (buf === 'ask') { mode = 'ask'; buf = ''; }
    else { if (log) fs.appendFileSync(log, `TASK ${buf}\n`); history.push(buf); buf = ''; }
  } else if (k === '\x15') buf = '';                 // C-u
  else if (k === '\x03') process.exit(0);
  else if (!k.startsWith('\x1b')) buf += k;
  draw();
});
draw();
