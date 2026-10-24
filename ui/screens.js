// Live desk screens drawn on canvases (CanvasTexture): the code an agent is writing, its terminal,
// the latest QA screenshot, a question waiting for the owner, a clock when idle, or the live tmux
// screen in the over-the-shoulder view. Drawing ideas ported from the squad-3d prototype.
import * as THREE from 'three';

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
const lines = (s, max) => String(s || '').replace(/\t/g, '  ').split('\n').slice(0, max).map((l) => (l.length > 70 ? `${l.slice(0, 69)}…` : l));

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

const KIND_COLOR = { write: '#4fc38a', test: '#b388ff', run: '#6aa5ff', read: '#7dd3fc', talk: '#f2b544', plan: '#fdba74', git: '#a3e635', think: '#94a3b8' };

// mode: what to show; returns the redraw interval in seconds
export function drawScreen(S, a, { t, away = '', live = null, shot = null, part = 'main', stopped = false }) {
  const ctx = S.ctx;
  if (live !== null && part === 'main') { drawLive(ctx, live); return .1; }
  if (stopped) { ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, SCR_W, SCR_H); return 30; }
  if (a.state === 'waiting') { drawWaiting(ctx, a); return 2; }
  if (away || a.state !== 'working') {
    if (a.kindOf === 'qa' && shot && !away && part === 'main') { drawShot(ctx, shot.img, shot.file); return 5; }
    drawIdle(ctx, a, away); return 5;
  }
  const p = a.peek;
  if (a.kindOf === 'qa' && shot && part === 'main' && (!p || p.type !== 'code')) { drawShot(ctx, shot.img, shot.file); return 3; }
  if (part === 'side') {                                   // second monitor: terminal or activity
    if (p && p.type === 'terminal') drawTerminal(ctx, p); else drawBars(ctx, t, KIND_COLOR[a.peek?.kind] || '#6aa5ff');
    return .6;
  }
  if (p && p.type === 'code') { drawCode(ctx, p, t); return .25; }
  if (p && p.type === 'terminal') { drawTerminal(ctx, p); return .6; }
  drawBars(ctx, t, KIND_COLOR[p?.kind] || '#6aa5ff');
  return .4;
}
