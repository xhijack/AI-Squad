// Agents run as Claude Code sessions in tmux ("aisquad-<floor>-<agent>"). This module starts and stops
// them, reads their screens for option dialogs (numbered and unnumbered), answers dialogs and types tasks.
// Prompt parsing is ported from the squad-3d prototype.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { config, claudeBin } from './config.js';

const SESSION_PREFIX = 'aisquad-';
export const sessionName = (floorId, agentId) => `${SESSION_PREFIX}${floorId}-${agentId}`.replace(/[^\w-]/g, '-').slice(0, 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// socket: tmux -L name; '' = the default tmux server (where independent agents usually run)
function tmuxArgs(args, socket = config.tmuxSocket) { return socket ? ['-L', socket, ...args] : args; }
export function tmux(args, socket = config.tmuxSocket) {
  try { return execFileSync('tmux', tmuxArgs(args, socket), { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
}

// every pane of a tmux server: { session, pane ("1.0"), target ("=session:1.0"), pid, command, path }
export function listPanes(socket) {
  const out = tmux(['list-panes', '-a', '-F', '#{session_name}\t#{window_index}.#{pane_index}\t#{pane_pid}\t#{pane_current_command}\t#{pane_current_path}'], socket);
  return (out || '').split('\n').filter(Boolean).map((l) => {
    const [session, pane, pid, command, cwd] = l.split('\t');
    return { session, pane, target: `=${session}:${pane}`, pid: +pid, command, path: cwd, aisquad: session.startsWith(SESSION_PREFIX) };
  });
}
export const capturePane = (target, socket, history = 0) => tmux(['capture-pane', '-p', '-J', '-t', target, ...(history ? ['-S', `-${history}`] : [])], socket) || '';

// ---------- one tmux server per agent ----------
// Each agent session has its own tmux server (tmux -L <socketOf(name)>) in its own systemd scope:
// systemd-oomd kills a whole scope, and sessions sharing one server used to die together. Sessions started
// by older versions live on the shared server (config.tmuxSocket, '' = the default one) and are still found.
export const tmuxDir = () => path.join(process.env.TMUX_TMPDIR || '/tmp', `tmux-${process.getuid()}`);
const ownPrefix = () => (config.tmuxSocket ? `${config.tmuxSocket}--` : '');     // test and dev Buildings keep theirs apart
export function socketOf(name) {
  const s = ownPrefix() + name;
  const room = 100 - tmuxDir().length - 1;                                          // unix socket paths are short
  return s.length <= room ? s : `${s.slice(0, room - 9)}-${crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)}`;
}
const shared = new Set();                       // sessions found on the shared server (older versions)
const socketFor = (name) => (shared.has(name) ? config.tmuxSocket : socketOf(name));
const hasSession = (name, socket) => tmux(['has-session', '-t', `=${name}`], socket) !== null;

export function isRunning(name) {
  if (hasSession(name, socketOf(name))) { shared.delete(name); return true; }
  if (hasSession(name, config.tmuxSocket)) { shared.add(name); return true; }
  shared.delete(name);
  return false;
}
export function listSessions() {
  const out = new Set();
  const prefix = ownPrefix() || SESSION_PREFIX;
  let files = []; try { files = fs.readdirSync(tmuxDir()); } catch { /* no tmux server yet */ }
  for (const f of files) {
    if (!f.startsWith(prefix) || f === config.tmuxSocket) continue;
    for (const s of (tmux(['list-sessions', '-F', '#{session_name}'], f) || '').split('\n')) {
      if (s.startsWith(SESSION_PREFIX) && socketOf(s) === f) { out.add(s); shared.delete(s); }   // another Building's server is not ours
    }
  }
  for (const s of (tmux(['list-sessions', '-F', '#{session_name}']) || '').split('\n')) {
    if (s.startsWith(SESSION_PREFIX) && !out.has(s)) { out.add(s); shared.add(s); }
  }
  return [...out];
}
// the command that opens the agent's terminal
export function attachCommand(name) {
  const socket = socketFor(name);
  return `tmux ${socket ? `-L ${socket} ` : ''}attach -t ${name}`;
}
// visible screen only by default (old dialogs in the scrollback must not count); history = extra lines
// Agent sessions keep a fixed 200x50 window: a small terminal attaching (tmux attach from a phone or
// an editor panel) must not shrink it, or dialogs are cut off and cannot be read from the screen.
export const SIZE = { x: 200, y: 50 };
const sized = new Set();
export function keepSize(name) {
  tmux(['set-option', '-t', `=${name}`, 'window-size', 'manual'], socketFor(name));
  tmux(['resize-window', '-t', `=${name}:`, '-x', String(SIZE.x), '-y', String(SIZE.y)], socketFor(name));
}
// styled: keep the colour/attribute escapes (needed to tell typed input from a dim prompt suggestion)
export const capture = (name, history = 0, { styled = false } = {}) => {
  if (!sized.has(name) && isRunning(name)) { keepSize(name); sized.add(name); }   // also sessions started before this fix
  return tmux(['capture-pane', '-p', '-J', ...(styled ? ['-e'] : []), '-t', `=${name}:`, ...(history ? ['-S', `-${history}`] : [])], socketFor(name)) || '';
};

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

// Claude Code's prompt suggestions ("ghost text") are drawn dim (SGR 2) in the empty input box, the
// cursor on their first letter in reverse video (SGR 7): drop both, so a suggestion never counts as typed
// input. Other escapes are left for cleanScreen.
export function stripDim(text) {
  let dim = false, rev = false, out = '';
  for (const part of String(text).split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (!m) { out += dim || rev ? part.replace(/[^\n]/g, '') : part; continue; }
    const codes = (m[1] || '0').split(';');
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === '38' || c === '48' || c === '58') { i += codes[i + 1] === '2' ? 4 : 2; continue; }   // colours: 38;5;n and 38;2;r;g;b
      if (c === '2') dim = true; else if (c === '22') dim = false;
      else if (c === '7') rev = true; else if (c === '27') rev = false;
      else if (c === '0' || c === '') dim = rev = false;
    }
    out += part;
  }
  return out;
}

// text currently in the input box ("❯ ..." line inside the last box), '' when empty; pass a styled
// capture (capture(name, 0, { styled: true })) so prompt suggestions are not read as input
export function inputLine(screen) {
  const lines = cleanScreen(screen);
  const typed = cleanScreen(stripDim(screen));          // same lines; the prompt marker itself may be dim too
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
    if (/^\s*(?:❯|>)/.test(lines[i])) return (typed[i] || '').replace(/^\s*(?:❯|>)?\s?/, '').trim();
  }
  return null;
}
export const isReady = (screen) => inputLine(screen) !== null && !parsePrompt(screen);

// ---------- start / stop ----------
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// starts `claude --agent <id>` detached on the agent's own tmux server; through systemd-run --user --scope
// when available, so the session survives the terminal or editor that launched the server and an out of
// memory kill of one scope takes only this agent
// env: extra variables for the agent (hook target, git identity), set with `env` in front of the command
export async function startSession({ name, cwd, agentId, disallowedTools = [], extraArgs = [], env: agentEnv = {} }) {
  if (isRunning(name)) return { ok: true, already: true };
  const vars = Object.entries(agentEnv).filter(([k, v]) => /^[A-Z_][A-Z0-9_]*$/.test(k) && v !== undefined && v !== null).map(([k, v]) => `${k}=${v}`);
  const cmd = [...(vars.length ? ['env', ...vars] : []), claudeBin(), '--agent', agentId, ...(disallowedTools.length ? ['--disallowedTools', ...disallowedTools] : []), ...extraArgs].map(shq).join(' ');
  const tm = ['tmux', ...tmuxArgs(['new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', cwd, cmd], socketOf(name))];
  const env = { ...process.env, PATH: `${process.execPath.replace(/\/node$/, '')}:${process.env.PATH || ''}` };
  delete env.TMUX;
  const exec = (file, args) => new Promise((ok, no) => execFile(file, args, { env, timeout: 15000 }, (e) => (e ? no(e) : ok())));
  try {
    if (!config.useSystemd) throw new Error('systemd disabled');
    await exec('systemd-run', ['--user', '--scope', '--quiet', `--unit=${name}-${Date.now()}`, ...tm]);
  } catch {
    if (!isRunning(name)) await exec(tm[0], tm.slice(1));
  }
  if (isRunning(name)) { keepSize(name); sized.add(name); }
  return { ok: isRunning(name) };
}

// kill-session only hangs up the panes; Claude Code can outlive that, so make sure the pane processes end
export function stopSession(name) {
  sized.delete(name);
  if (!isRunning(name)) return { ok: true, already: true };
  const socket = socketFor(name), own = !shared.has(name);
  const pids = (tmux(['list-panes', '-s', '-t', `=${name}`, '-F', '#{pane_pid}'], socket) || '').split('\n').map(Number).filter((n) => n > 1);
  tmux(['kill-session', '-t', `=${name}`], socket);
  if (own) { tmux(['kill-server'], socket); fs.rmSync(path.join(tmuxDir(), socket), { force: true }); }   // its own server: gone with it
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (const pid of pids) if (alive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  const deadline = Date.now() + 3000;
  while (pids.some(alive) && Date.now() < deadline) execFileSync('sleep', ['0.1']);
  for (const pid of pids) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  return { ok: !isRunning(name) && !pids.some(alive), pids };
}

// ---------- typing ----------
// Never types into a dialog. Long text: send-keys -l, wait, Enter, then verify the text left the input box.
export async function typeTask(name, text, { settleMs = 600, verifyMs = 1500 } = {}) {
  if (!isRunning(name)) return { ok: false, error: 'Agent is not running' };
  const screen = capture(name);
  const keys = (...k) => tmux(['send-keys', '-t', `=${name}:`, ...k], socketFor(name));
  if (parsePrompt(screen)) return { ok: false, error: 'Agent shows a dialog; answer it first', dialog: true };
  const flat = String(text).replace(/[\r\n]+/g, ' ').trim();
  if (!flat) return { ok: false, error: 'Empty task' };
  keys('C-u');
  for (let i = 0; i < flat.length; i += 1000) keys('-l', flat.slice(i, i + 1000));
  await sleep(settleMs + Math.min(2000, flat.length / 2));
  keys('Enter');
  const probe = flat.slice(0, 24);
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(verifyMs);
    const line = inputLine(capture(name, 0, { styled: true }));
    if (line === null || !line.includes(probe)) return { ok: true };
    keys('Enter');                                          // pasted text sometimes swallows the first Enter
  }
  return { ok: false, error: 'Task text is still in the input box' };
}

// choose option n of the open dialog (arrow keys + Enter); free-text options get the typed text.
// opts.target / opts.socket address a pane outside our own sessions (independent agents).
export function answerDialog(name, dialog, n, text = '', { target = `=${name}:`, socket = socketFor(name) } = {}) {
  const opt = dialog.options.find((o) => o.n === n);
  if (!opt) return { ok: false, error: 'Unknown option' };
  if (opt.free && !String(text).trim()) return { ok: false, error: 'Type an answer first' };
  const diff = n - dialog.selected;
  const keys = (...k) => tmux(['send-keys', '-t', target, ...k], socket);
  for (let k = 0; k < Math.abs(diff); k++) keys(diff > 0 ? 'Down' : 'Up');
  if (opt.free) keys('-l', String(text).replace(/[\r\n]+/g, ' '));
  keys('Enter');
  return { ok: true };
}
