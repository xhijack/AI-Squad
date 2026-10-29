#!/usr/bin/env node
// A fake Claude Code AskUserQuestion dialog for tests (as Claude Code 2.1 draws and drives it): a tab bar
// (☐/☒ per question, "✔ Submit" with a review tab), single choice (Enter answers and moves on), multi-select (Enter or
// Space toggles [ ]/[✔], the "Next" / "Submit" row moves on), a free-text row that checks itself when typed into
// (Enter on it unchecks it again in a multi-select), and the review's "1. Submit answers". On submit the answers go
// to FAKE_ASK_LOG as Claude Code reports them ("question"="answer, answer").
//   node fake-ask.cjs questions.json
const fs = require('fs');
const qs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const LOG = process.env.FAKE_ASK_LOG;
const tabsBar = qs.length > 1 || qs.some((q) => q.multiSelect);
const st = qs.map((q) => ({ row: 1, checked: new Set(), text: '', done: false, answer: '' }));
let tab = 0, review = false, reviewRow = 1, closed = false;

function draw() {
  const out = [];
  const bar = qs.map((q, i) => `${st[i].done ? '☒' : '☐'} ${q.header}`).join('  ');
  out.push(tabsBar ? `←  ${bar}  ✔ Submit  →` : ` ${bar}`);
  if (closed) { out.push('', 'SUBMITTED'); return out; }
  if (review) {
    out.push('Review your answers');
    qs.forEach((q, i) => { out.push(` ● ${q.question}`, `   → ${st[i].answer}`); });
    out.push('Ready to submit your answers?', `${reviewRow === 1 ? '❯' : ' '} 1. Submit answers`, `${reviewRow === 2 ? '❯' : ' '} 2. Cancel`);
    return out;
  }
  const q = qs[tab], s = st[tab], k = q.options.length;
  out.push(q.question);
  q.options.forEach((o, i) => {
    const n = i + 1, cur = s.row === n ? '❯' : ' ';
    out.push(q.multiSelect ? `${cur} ${n}. [${s.checked.has(n) ? '✔' : ' '}] ${o}` : `${cur} ${n}. ${o}`, `         about ${o}`);
  });
  const free = s.text || (q.multiSelect ? 'Type something' : 'Type something.');
  out.push(q.multiSelect ? `${s.row === k + 1 ? '❯' : ' '} ${k + 1}. [${s.checked.has(k + 1) ? '✔' : ' '}] ${free}` : `${s.row === k + 1 ? '❯' : ' '} ${k + 1}. ${free}`);
  if (q.multiSelect) out.push(`${s.row === k + 2 ? '❯' : ' '}    ${tab === qs.length - 1 ? 'Submit' : 'Next'}`);
  out.push('─'.repeat(60), `  ${k + 2}. Chat about this`, 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel');
  return out;
}
const render = () => process.stdout.write(`\x1b[2J\x1b[H${draw().join('\n')}\n`);
const advance = () => {
  st[tab].done = true;
  if (tab < qs.length - 1) tab++;
  else if (tabsBar) review = true;
  else finish();
};
function finish() {
  closed = true;
  if (LOG) fs.appendFileSync(LOG, `${qs.map((q, i) => `"${q.question}"="${st[i].answer}"`).join(', ')}\n`);
}
function key(k) {
  if (closed) return;
  if (review) {
    if (k === 'down') reviewRow = 2; else if (k === 'up') reviewRow = 1;
    else if (k === 'enter' && reviewRow === 1) finish();
    return;
  }
  const q = qs[tab], s = st[tab], n = q.options.length, last = q.multiSelect ? n + 2 : n + 1;
  if (k === 'down') s.row = Math.min(last, s.row + 1);
  else if (k === 'up') s.row = Math.max(1, s.row - 1);
  else if (k === 'enter' || (k === ' ' && q.multiSelect && s.row <= n)) {
    if (!q.multiSelect) {
      if (s.row === n + 1 && !s.text) return;
      s.answer = s.row === n + 1 ? s.text : q.options[s.row - 1];
      advance();
    } else if (s.row <= n + 1) {
      if (s.row === n + 1 && !s.text) return;
      if (s.checked.has(s.row)) s.checked.delete(s.row); else s.checked.add(s.row);
    } else {
      s.answer = [...s.checked].sort((a, b) => a - b).map((r) => (r === n + 1 ? s.text : q.options[r - 1])).join(', ');
      advance();
    }
  } else if (k.length === 1 && s.row === n + 1) { s.text += k; if (q.multiSelect) s.checked.add(n + 1); }
}
process.stdin.setRawMode?.(true);
process.stdin.on('data', (b) => {
  let str = b.toString('utf8');
  while (str.length) {
    if (str.startsWith('\x1b[A')) { key('up'); str = str.slice(3); }
    else if (str.startsWith('\x1b[B')) { key('down'); str = str.slice(3); }
    else if (str[0] === '\r') { key('enter'); str = str.slice(1); }
    else { key(str[0]); str = str.slice(1); }
  }
  render();
});
render();
setInterval(() => {}, 1e6);
