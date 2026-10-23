// Small filesystem and string helpers shared by the server modules.
import fs from 'node:fs';
import path from 'node:path';

export const safeReaddir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
export const statOf = (f) => { try { return fs.statSync(f); } catch { return null; } };
export const readText = (f, d = null) => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
export const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// atomic write: temp file + rename, so a crash never leaves half a JSON file
export function writeText(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
export const writeJson = (file, data) => writeText(file, JSON.stringify(data, null, 2) + '\n');

// "Ramdani - Frappe Developer" -> "ramdani-frappe-developer"
export function kebab(s, max = 48) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
}
export function uniqueId(base, taken, fallback = 'item') {
  const b = kebab(base) || fallback;
  const used = new Set(taken);
  if (!used.has(b)) return b;
  for (let i = 2; ; i++) if (!used.has(`${b}-${i}`)) return `${b}-${i}`;
}

export const isHex = (s) => /^#[0-9a-f]{6}$/i.test(String(s ?? ''));
export const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const oneLine = (s, n = 90) => clip(String(s ?? '').replace(/\s+/g, ' ').trim(), n);
export const uniq = (a) => [...new Set(a)];

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg) => new HttpError(404, msg);

// line diff (LCS) used to show template changes between versions
export function lineDiff(a, b) {
  const x = String(a).split('\n'), y = String(b).split('\n');
  const n = x.length, m = y.length;
  if (n * m > 4e6) return [...x.map((t) => ({ op: '-', text: t })), ...y.map((t) => ({ op: '+', text: t }))];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: ' ', text: x[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: x[i++] });
    else out.push({ op: '+', text: y[j++] });
  }
  while (i < n) out.push({ op: '-', text: x[i++] });
  while (j < m) out.push({ op: '+', text: y[j++] });
  return out;
}
