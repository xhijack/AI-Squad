// Live desk screens drawn on canvases (CanvasTexture): the code an agent is writing, its terminal,
// the latest QA screenshot, a question waiting for the owner, a clock when idle, or the live tmux
// screen in the over-the-shoulder view. Drawing ideas ported from the squad-3d prototype.
import * as THREE from 'three';
import { lines, diffLines, mergeStatus } from './screen-model.js';

export const SCR_W = 800, SCR_H = 490;
const MONO = 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
const SANS = 'system-ui, "Segoe UI", sans-serif';

export function makeScreen(pw, ph) {
  const canvas = document.createElement('canvas');
  canvas.width = SCR_W; canvas.height = SCR_H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh, next: 0, key: '' };
}

const KW = /^(import|export|from|const|let|var|function|return|async|await|if|else|for|while|new|class|def|self|try|catch|except|throw|raise|default|describe|it|test|expect|assert)$/;
function hlCode(ctx, text, x, y) {
  let cx = x;
  for (const p of text.split(/(\/\/.*$|#.*$|'[^']*'|"[^"]*"|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/)) {
    if (!p) continue;
    ctx.fillStyle = /^(\/\/|#)/.test(p) ? '#6b7280' : /^['"`]/.test(p) ? '#a5d6a7' : /^\d/.test(p) ? '#f9b17a' : KW.test(p) ? '#c792ea' : /^[A-Z]/.test(p) ? '#ffcb6b' : '#d6deeb';
    ctx.fillText(p, cx, y);
    cx += ctx.measureText(p).width;
  }
}

function titleBar(ctx, text, color) {
  ctx.fillStyle = '#181a26'; ctx.fillRect(0, 0, SCR_W, 34);
  [['#ff5f57', 18], ['#febc2e', 38], ['#28c840', 58]].forEach(([c, x]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, 17, 6, 0, 7); ctx.fill(); });
  ctx.fillStyle = color || '#c0c3d6'; ctx.font = `14px ${MONO}`; ctx.fillText(text, 80, 22);
}

function drawCode(ctx, peek, t) {
  ctx.fillStyle = '#1e1f2b'; ctx.fillRect(0, 0, SCR_W, SCR_H);
  titleBar(ctx, `✎ ${peek.path}`, '#fcd34d');
  const all = lines(peek.text, 18);
  // typing effect: lines appear over the first seconds after the edit
  const shown = Math.min(all.length, Math.max(1, Math.floor((Date.now() - peek.ts) / 250)));
  ctx.font = `17px ${MONO}`;
  const first = peek.firstLine || 1;
  all.slice(0, shown).forEach((l, i) => {
    const n = first + i;
    if (peek.hlFrom && n >= peek.hlFrom && n <= peek.hlTo) { ctx.fillStyle = 'rgba(252, 211, 77, .10)'; ctx.fillRect(0, 48 + i * 23, SCR_W, 23); }
    ctx.fillStyle = '#4b5068'; ctx.fillText(String(n).padStart(3), 10, 64 + i * 23);
    hlCode(ctx, l, 56, 64 + i * 23);
  });
  if (Math.floor(t * 2) % 2) { ctx.fillStyle = '#e2e8f0'; ctx.fillRect(56 + ctx.measureText(all[shown - 1] || '').width, 48 + (shown - 1) * 23, 9, 20); }
}

function drawTerminal(ctx, peek) {
  ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, SCR_W, SCR_H);
  titleBar(ctx, '❯ terminal', '#86efac');
  ctx.font = `16px ${MONO}`;
  const cmd = lines(peek.command, 3);
  cmd.forEach((l, i) => { ctx.fillStyle = '#86efac'; ctx.fillText(i ? '  ' : '❯', 14, 62 + i * 21); ctx.fillStyle = '#e2e8f0'; ctx.fillText(l, 34, 62 + i * 21); });
  const out = peek.output ? lines(peek.output, 40).slice(-(17 - cmd.length)) : ['…'];
  out.forEach((l, i) => { ctx.fillStyle = peek.error ? '#fca5a5' : /fail|error/i.test(l) ? '#fca5a5' : /pass|ok\b|✓/i.test(l) ? '#86efac' : '#94a3b8'; ctx.fillText(l, 14, 62 + (cmd.length + i) * 21); });
}

function drawBars(ctx, t, color) {
  ctx.fillStyle = '#11131c'; ctx.fillRect(0, 0, SCR_W, SCR_H);
  ctx.fillStyle = color; ctx.fillRect(0, 0, SCR_W, 22);
  const cols = ['#7dd3fc', '#c4b5fd', '#86efac', '#fcd34d', '#f9a8d4', '#e2e8f0'];
  const scroll = Math.floor(t * 3);
  for (let i = 0; i < 14; i++) {
    const n = ((i + scroll) * 2654435761) % 997, indent = (n % 4) * 30, w = 100 + (n % 9) * 55;
    ctx.globalAlpha = .85; ctx.fillStyle = cols[n % cols.length];
    ctx.fillRect(30 + indent, 44 + i * 31, Math.min(w, SCR_W - 90 - indent), 13);
  }
  ctx.globalAlpha = 1;
}

function drawIdle(ctx, a, away) {
  const g = ctx.createLinearGradient(0, 0, SCR_W, SCR_H); g.addColorStop(0, '#1e1b4b'); g.addColorStop(1, '#0f172a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, SCR_W, SCR_H);
  ctx.textAlign = 'center'; ctx.fillStyle = '#e2e8f0';
  ctx.font = `200 120px ${SANS}`;
  ctx.fillText(new Date().toTimeString().slice(0, 5), SCR_W / 2, SCR_H / 2 + 20);
  ctx.font = `600 26px ${SANS}`; ctx.fillStyle = '#94a3b8';
  ctx.fillText(`${String(a.displayName).split(' - ')[0]} · ${away || 'waiting for a task'}`, SCR_W / 2, SCR_H / 2 + 80);
  ctx.textAlign = 'left';
}

function drawWaiting(ctx, a) {
  ctx.fillStyle = '#3a1520'; ctx.fillRect(0, 0, SCR_W, SCR_H);
  ctx.fillStyle = '#ef5d6b'; ctx.fillRect(0, 0, SCR_W, 10);
  ctx.fillStyle = '#fecdd3'; ctx.font = `700 34px ${SANS}`; ctx.fillText('Waiting for you', 40, 80);
  ctx.font = `20px ${SANS}`; ctx.fillStyle = '#fde4e8';
  const words = String(a.activity || 'A question or permission prompt is open.').split(/\s+/);
  let line = '', y = 130;
  for (const w of words) { if (ctx.measureText(`${line} ${w}`).width > SCR_W - 80) { ctx.fillText(line, 40, y); y += 30; line = w; } else line = line ? `${line} ${w}` : w; }
  ctx.fillText(line, 40, y);
}

function drawShot(ctx, img, file) {
  ctx.fillStyle = '#f3f4f6'; ctx.fillRect(0, 0, SCR_W, SCR_H);
  titleBar(ctx, `◎ ${String(file).split('/').pop()}`, '#f9a8d4');
  const r = Math.min((SCR_W - 20) / img.width, (SCR_H - 50) / img.height);
  ctx.drawImage(img, (SCR_W - img.width * r) / 2, 40 + (SCR_H - 50 - img.height * r) / 2, img.width * r, img.height * r);
}

function drawLive(ctx, text) {
  ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, SCR_W, SCR_H);
  ctx.font = `13px ${MONO}`;
  const all = String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const rows = all.slice(-34);
  rows.forEach((l, i) => { ctx.fillStyle = /^\s*❯/.test(l) ? '#86efac' : /^⏺|^●/.test(l) ? '#e2e8f0' : '#aab4cc'; ctx.fillText(l.slice(0, 104), 10, 18 + i * 14); });
}

// lead screen: the sprint board (counts + first tasks per column), or the team's states on Free Team Floors
const BOARD_COLS = [['TODO', 'To do', '#94a3b8'], ['IN_PROGRESS', 'Building', '#6aa5ff'], ['REVIEW', 'QA', '#b388ff'], ['DONE', 'Done', '#4fc38a']];
const STATE_COLOR = { working: '#4fc38a', waiting: '#ef5d6b', idle: '#f2b544', stopped: '#4b5068' };
function drawDiff(ctx, peek, t) {
  ctx.fillStyle = '#1e1f2b'; ctx.fillRect(0, 0, SCR_W, SCR_H);
  titleBar(ctx, `± ${peek.path}`, '#86efac');
  const all = diffLines(peek);
  const shown = Math.min(all.length, Math.max(1, Math.floor((Date.now() - peek.ts) / 200)));
  ctx.font = `17px ${MONO}`;
  all.slice(0, shown).forEach(([op, l], i) => {
    const y = 48 + i * 23;
    ctx.fillStyle = op === '+' ? 'rgba(79, 195, 138, .16)' : 'rgba(239, 93, 107, .16)'; ctx.fillRect(0, y, SCR_W, 23);
    ctx.fillStyle = op === '+' ? '#4fc38a' : '#ef5d6b'; ctx.fillText(op, 18, y + 16);
    if (op === '+') hlCode(ctx, l, 44, y + 16); else { ctx.fillStyle = '#fca5a5'; ctx.fillText(l, 44, y + 16); }
  });
  if (Math.floor(t * 2) % 2 && shown) { ctx.fillStyle = '#e2e8f0'; ctx.fillRect(44 + ctx.measureText(all[shown - 1][1]).width, 48 + (shown - 1) * 23, 9, 20); }
}
function drawStrip(ctx, text) {
  if (!text) return;
  ctx.fillStyle = 'rgba(12, 14, 22, .92)'; ctx.fillRect(0, SCR_H - 38, SCR_W, 38);
  ctx.fillStyle = /fail|refused/.test(text) ? '#fca5a5' : '#a3e635'; ctx.font = `600 16px ${SANS}`; ctx.fillText(`⎇ ${text}`.slice(0, 80), 14, SCR_H - 13);
}

function drawBoard(ctx, info) {
  ctx.fillStyle = '#141826'; ctx.fillRect(0, 0, SCR_W, SCR_H);
  const tasks = info?.board?.tasks;
  if (tasks?.length) {
    titleBar(ctx, `▦ Sprint ${info.board.sprint || ''} board`, '#fdba74');
    const w = (SCR_W - 50) / 4;
    BOARD_COLS.forEach(([key, name, color], i) => {
      const x = 10 + i * (w + 10), items = tasks.filter((t) => (key === 'TODO' ? t.column === 'TODO' || t.column === 'BLOCKED' : t.column === key));
      ctx.fillStyle = '#1d2236'; ctx.fillRect(x, 46, w, SCR_H - 56);
      ctx.fillStyle = color; ctx.fillRect(x, 46, w, 5);
      ctx.font = `600 18px ${SANS}`; ctx.fillText(`${name} ${items.length}`, x + 10, 78);
      ctx.font = `14px ${SANS}`;
      items.slice(0, 8).forEach((t, k) => {
        ctx.fillStyle = t.column === 'BLOCKED' ? '#3a1f2a' : '#262c44'; ctx.fillRect(x + 8, 92 + k * 44, w - 16, 38);
        ctx.fillStyle = '#e2e8f0'; ctx.fillText(String(t.task).slice(0, 22), x + 14, 116 + k * 44);
      });
    });
    return;
  }
  titleBar(ctx, '▦ Team board', '#fdba74');
  ctx.font = `20px ${SANS}`;
  (info?.agents || []).slice(0, 9).forEach((a, i) => {
    const y = 80 + i * 44;
    ctx.fillStyle = STATE_COLOR[a.state] || '#94a3b8'; ctx.beginPath(); ctx.arc(34, y - 7, 8, 0, 7); ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.fillText(String(a.name).slice(0, 30), 56, y);
    ctx.fillStyle = '#94a3b8'; ctx.fillText(String(a.activity || a.state).slice(0, 34), 400, y);
  });
}

// QA screen while tests run: a test runner with pass / fail counts read from the output
function drawTests(ctx, peek) {
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, SCR_W, SCR_H);
  titleBar(ctx, '✓ test runner', '#b388ff');
  const out = String(peek.output || '');
  const num = (re) => { const m = out.match(re); return m ? +m[1] : null; };
  const pass = num(/#\s*pass\s+(\d+)/i) ?? num(/(\d+)\s+pass(?:ed|ing)?/i), fail = num(/#\s*fail\s+(\d+)/i) ?? num(/(\d+)\s+fail(?:ed|ing|ures?)?/i);
  ctx.font = `16px ${MONO}`; ctx.fillStyle = '#e2e8f0'; ctx.fillText(`❯ ${lines(peek.command, 1)[0] || ''}`, 16, 64);
  ctx.font = `700 44px ${SANS}`;
  ctx.fillStyle = '#4fc38a'; ctx.fillText(pass == null ? (peek.output ? '…' : 'running') : `${pass} passed`, 16, 130);
  if (fail) { ctx.fillStyle = '#ef5d6b'; ctx.fillText(`${fail} failed`, 380, 130); }
  ctx.font = `15px ${MONO}`;
  lines(out, 60).filter((l) => /✔|✓|✖|✗|ok |not ok|pass|fail/i.test(l)).slice(-15).forEach((l, i) => {
    ctx.fillStyle = /✖|✗|not ok|fail/i.test(l) ? '#fca5a5' : '#86efac'; ctx.fillText(l, 16, 176 + i * 20);
  });
}

const KIND_COLOR = { write: '#4fc38a', test: '#b388ff', run: '#6aa5ff', read: '#7dd3fc', talk: '#f2b544', plan: '#fdba74', git: '#a3e635', think: '#94a3b8' };

// mode: what to show; returns the redraw interval in seconds
// role: the role screen (code | tests | board); board: { board, agents } of the Floor for lead screens
export function drawScreen(S, a, { t, away = '', live = null, shot = null, part = 'main', stopped = false, role = 'code', board = null }) {
  const ctx = S.ctx;
  if (live !== null && part === 'main') { drawLive(ctx, live); return .1; }
  if (stopped) { ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, SCR_W, SCR_H); return 30; }
  if (a.state === 'waiting') { drawWaiting(ctx, a); return 2; }
  const strip = () => drawStrip(ctx, mergeStatus(board));
  if (role === 'board' && part === 'main' && !away) { drawBoard(ctx, board); strip(); return 3; }
  if (role === 'tests' && part === 'main' && a.state === 'working' && a.peek?.type === 'terminal' && a.peek.kind === 'test') { drawTests(ctx, a.peek); strip(); return .6; }
  if (away || a.state !== 'working') {
    if (role === 'tests' && shot && !away && part === 'main') { drawShot(ctx, shot.img, shot.file); strip(); return 5; }
    drawIdle(ctx, a, away); return 5;
  }
  const p = a.peek;
  if (role === 'tests' && shot && part === 'main' && (!p || p.type !== 'code')) { drawShot(ctx, shot.img, shot.file); strip(); return 3; }
  if (part === 'side') {                                   // second monitor: terminal or activity
    if (p && p.type === 'terminal') drawTerminal(ctx, p); else drawBars(ctx, t, KIND_COLOR[a.peek?.kind] || '#6aa5ff');
    return .6;
  }
  if (p && p.type === 'code') { if (p.old != null && role === 'code') drawDiff(ctx, p, t); else drawCode(ctx, p, t); return .25; }
  if (p && p.type === 'terminal') { drawTerminal(ctx, p); return .6; }
  drawBars(ctx, t, KIND_COLOR[p?.kind] || '#6aa5ff');
  return .4;
}
