// Agents run as Claude Code sessions in tmux ("aisquad-<floor>-<agent>"). This module starts and stops
// them, reads their screens for option dialogs (numbered and unnumbered), answers dialogs and types tasks.
// Prompt parsing is ported from the squad-3d prototype.
import { execFile, execFileSync } from 'node:child_process';
import { config, claudeBin } from './config.js';

const SESSION_PREFIX = 'aisquad-';
export const sessionName = (floorId, agentId) => `${SESSION_PREFIX}${floorId}-${agentId}`.replace(/[^\w-]/g, '-').slice(0, 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tmuxArgs(args) { return config.tmuxSocket ? ['-L', config.tmuxSocket, ...args] : args; }
export function tmux(args) {
  try { return execFileSync('tmux', tmuxArgs(args), { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
}

export function listSessions() {
  const out = tmux(['list-sessions', '-F', '#{session_name}']);
  return out ? out.split('\n').filter((s) => s.startsWith(SESSION_PREFIX)) : [];
}
export const isRunning = (name) => tmux(['has-session', '-t', `=${name}`]) !== null;
// visible screen only by default (old dialogs in the scrollback must not count); history = extra lines
export const capture = (name, history = 0) => tmux(['capture-pane', '-p', '-J', '-t', `=${name}:`, ...(history ? ['-S', `-${history}`] : [])]) || '';

// ---------- screen parsing ----------
const BOX = /^\s*[│┃|] ?|\s*[│┃|]\s*$/g;             // strip box borders, keep indentation
const OPT = /^(?:(❯|›|>)\s*)?(\d{1,2})[.)]\s+(.+)$/;

export function cleanScreen(text) {
  // drop the right-hand side panel Claude Code may draw (separated by long runs of spaces)
  const lines = String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n').map((l) => {
    const lead = l.match(/^\s*/)[0];
    if (lead.length >= 40) return '';
    const body = l.slice(lead.length).replace(/\s{6,}\S.*$/, '');
    return (lead + body).replace(BOX, '');
  });
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

// -> { question, options: [{ n, label, free }], selected } or null when no dialog is open
export function parsePrompt(text) {
  const tail = cleanScreen(text).slice(-45);
  let end = -1;
  for (let i = tail.length - 1; i >= 0; i--) if (OPT.test(tail[i].trim())) { end = i; break; }
  if (end < 0) return unnumberedPrompt(tail);
  const opts = [];
  let i = end, sel = -1;
  for (; i >= 0; i--) {
    const t = tail[i].trim();
    const m = t.match(OPT);
    if (m) { opts.unshift({ n: +m[2], label: m[3].trim() }); if (m[1]) sel = +m[2]; continue; }
    if (!t || /^[─━═\-�]{3,}/.test(t) || /^\s{3,}\S/.test(tail[i])) continue;   // rules and indented option descriptions
    break;
  }
  if (opts.length < 2 || sel < 0 || opts[0].n !== 1) return unnumberedPrompt(tail);
  for (let k = 1; k < opts.length; k++) if (opts[k].n !== opts[k - 1].n + 1) return null;
  // only hints may follow the options (otherwise it is conversation text that happens to be a list)
  for (const t of tail.slice(end + 1)) if (t.trim() && !/(esc|enter|tab|↑|↓|cancel|navigate|select|─|�)/i.test(t)) return null;
  const q = [];
  for (; i >= 0 && q.length < 10; i--) {
    const t = tail[i].trim();
    if (/^[╭╰─━═┌└]{1}|^[─━═\-�]{3,}/.test(t)) { if (q.length) break; continue; }
    if (!t) { if (q.length > 3) break; continue; }
    q.unshift(t);
  }
  return { question: q.join('\n'), options: opts.map((o) => { const label = o.label.replace(/\s{2,}.*$/, ''); return { n: o.n, label, free: /^type something/i.test(label) }; }), selected: sel };
}

// option dialogs without numbers, e.g. "Do you trust this folder?": "❯ Yes, I trust this folder" / "  No, exit" / "Enter to confirm"
export function unnumberedPrompt(tail) {
  let hint = -1;
  for (let i = tail.length - 1; i >= Math.max(0, tail.length - 6); i--) if (/Enter to (confirm|select|continue)/i.test(tail[i])) { hint = i; break; }
  if (hint < 0) return null;
  for (const t of tail.slice(hint + 1)) if (t.trim() && !/(esc|enter|tab|↑|↓|cancel|navigate|select|─)/i.test(t)) return null;
  let sel = -1;
  for (let i = hint - 1; i >= 0; i--) { if (/^\s*❯\s+\D/.test(tail[i])) { sel = i; break; } if (hint - i > 12) break; }
  if (sel < 0) return null;
  let a = sel, b = sel;
  while (a - 1 >= 0 && /^\s{2,}\S/.test(tail[a - 1]) && !/^\s*❯/.test(tail[a - 1])) a--;
  while (b + 1 < hint && /^\s{2,}\S/.test(tail[b + 1])) b++;
  const opts = tail.slice(a, b + 1).map((t, k) => ({ n: k + 1, label: t.replace(/^\s*❯?\s*/, '').replace(/^\d{1,2}[.)]\s+/, '').trim(), free: false }));
  if (opts.length < 2) return null;
  const q = [];
  for (let i = a - 1; i >= 0 && q.length < 8; i--) {
    const t = tail[i].trim();
    if (/^[─━═\-�]{3,}/.test(t)) break;
    if (t) q.unshift(t);
  }
  return { question: q.join('\n'), options: opts, selected: sel - a + 1 };
}

// Claude Code shows "esc to interrupt" while a turn is running
export const isBusy = (screen) => /esc to interrupt/i.test(screen);

// text currently in the input box ("❯ ..." line inside the last box), '' when empty
export function inputLine(screen) {
  const lines = cleanScreen(screen);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
    const m = lines[i].match(/^\s*(?:❯|>)\s?(.*)$/);
    if (m) return m[1].trim();
  }
  return null;
}
export const isReady = (screen) => inputLine(screen) !== null && !parsePrompt(screen);

// ---------- start / stop ----------
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// starts `claude --agent <id>` detached; through systemd-run --user --scope when available so the
// session survives the terminal or editor that launched the server
export async function startSession({ name, cwd, agentId, disallowedTools = [], extraArgs = [] }) {
  if (isRunning(name)) return { ok: true, already: true };
  const cmd = [claudeBin(), '--agent', agentId, ...(disallowedTools.length ? ['--disallowedTools', disallowedTools.join(',')] : []), ...extraArgs].map(shq).join(' ');
  const tm = ['tmux', ...tmuxArgs(['new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', cwd, cmd])];
  const env = { ...process.env, PATH: `${process.execPath.replace(/\/node$/, '')}:${process.env.PATH || ''}` };
  delete env.TMUX;
  const exec = (file, args) => new Promise((ok, no) => execFile(file, args, { env, timeout: 15000 }, (e) => (e ? no(e) : ok())));
  try {
    if (!config.useSystemd) throw new Error('systemd disabled');
    await exec('systemd-run', ['--user', '--scope', '--quiet', `--unit=${name}-${Date.now()}`, ...tm]);
  } catch {
    if (!isRunning(name)) await exec(tm[0], tm.slice(1));
  }
  return { ok: isRunning(name) };
}

export function stopSession(name) {
  if (!isRunning(name)) return { ok: true, already: true };
  tmux(['kill-session', '-t', `=${name}`]);
  return { ok: !isRunning(name) };
}

// ---------- typing ----------
// Never types into a dialog. Long text: send-keys -l, wait, Enter, then verify the text left the input box.
export async function typeTask(name, text, { settleMs = 600, verifyMs = 1500 } = {}) {
  const screen = capture(name);
  if (!isRunning(name)) return { ok: false, error: 'Agent is not running' };
  if (parsePrompt(screen)) return { ok: false, error: 'Agent shows a dialog; answer it first', dialog: true };
  const flat = String(text).replace(/[\r\n]+/g, ' ').trim();
  if (!flat) return { ok: false, error: 'Empty task' };
  tmux(['send-keys', '-t', `=${name}:`, 'C-u']);
  for (let i = 0; i < flat.length; i += 1000) tmux(['send-keys', '-t', `=${name}:`, '-l', flat.slice(i, i + 1000)]);
  await sleep(settleMs + Math.min(2000, flat.length / 2));
  tmux(['send-keys', '-t', `=${name}:`, 'Enter']);
  const probe = flat.slice(0, 24);
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(verifyMs);
    const line = inputLine(capture(name));
    if (line === null || !line.includes(probe)) return { ok: true };
    tmux(['send-keys', '-t', `=${name}:`, 'Enter']);       // pasted text sometimes swallows the first Enter
  }
  return { ok: false, error: 'Task text is still in the input box' };
}

// choose option n of the open dialog (arrow keys + Enter); free-text options get the typed text
export function answerDialog(name, dialog, n, text = '') {
  const opt = dialog.options.find((o) => o.n === n);
  if (!opt) return { ok: false, error: 'Unknown option' };
  if (opt.free && !String(text).trim()) return { ok: false, error: 'Type an answer first' };
  const diff = n - dialog.selected;
  for (let k = 0; k < Math.abs(diff); k++) tmux(['send-keys', '-t', `=${name}:`, diff > 0 ? 'Down' : 'Up']);
  if (opt.free) tmux(['send-keys', '-t', `=${name}:`, '-l', String(text).replace(/[\r\n]+/g, ' ')]);
  tmux(['send-keys', '-t', `=${name}:`, 'Enter']);
  return { ok: true };
}
