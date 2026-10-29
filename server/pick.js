// SPDX-License-Identifier: Apache-2.0
// A target from an integration (1.6): its arguments and how one number is read from a tools/call result.
//   args  a JSON object, committed with kpi.json (a literal secret is refused); {{from}} and {{to}} are the period's
//         first and last day (local dates), filled in at call time
//   pick  path (a JSON path into structuredContent, or into the first text content parsed as JSON), count (the
//         length of a list at a path), sum (a field added up across a list), regex (one capture group on the text)
import { redact, sensitiveName } from './redact.js';
import { bad, oneLine } from './util.js';

const REF = /\$\{[^}]*\}/g;
// a target's arguments are committed with kpi.json: a literal secret is refused (keys belong in the server's config)
export function cleanArgs(a) {
  if (a === undefined || a === null || a === '') return {};
  if (typeof a !== 'object' || Array.isArray(a)) throw bad('Arguments: a JSON object, e.g. {"from": "{{from}}", "to": "{{to}}"}');
  const json = JSON.stringify(a);
  if (json.length > 4000) throw bad('Arguments: at most 4000 characters');
  const walk = (v, k = '') => {
    if (v && typeof v === 'object') return Object.entries(v).forEach(([kk, x]) => walk(x, kk));
    if (typeof v === 'string' && v.replace(REF, '').replace(/\{\{(from|to)\}\}/g, '') && (sensitiveName(k) || redact(v, { pii: false }) !== v))
      throw bad(`Arguments are saved in the repository (kpi.json): "${k || v.slice(0, 12)}" looks like a secret; put keys in the integration's own configuration`);
  };
  walk(a);
  return JSON.parse(json);
}
// {{from}} and {{to}} in every string of the arguments
export function fillArgs(a, vars = {}) {
  if (typeof a === 'string') return a.replace(/\{\{(from|to)\}\}/g, (m, k) => vars[k] ?? m);
  if (Array.isArray(a)) return a.map((x) => fillArgs(x, vars));
  if (a && typeof a === 'object') return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, fillArgs(v, vars)]));
  return a;
}
export const PICKS = ['path', 'count', 'sum', 'regex'];
const PATH = /^[\w$-]+(\[\d+\]|\.[\w$-]+|\.\d+)*$/;
export function cleanPick(p = {}) {
  const type = PICKS.includes(p?.type) ? p.type : null;
  if (!type) throw bad(`How to read the number: ${PICKS.join(', ')}`);
  const pth = String(p.path ?? '').trim();
  if (pth && !PATH.test(pth)) throw bad(`Path "${pth.slice(0, 40)}": names joined by dots, e.g. data.total or items[0].count`);
  if (type === 'path' && !pth) throw bad('Path: where the number is, e.g. total or data.count');
  if (type === 'sum') {
    const field = String(p.field ?? '').trim();
    if (!field || !PATH.test(field)) throw bad('Sum: the field to add up in each item, e.g. reach');
    return { type, path: pth, field };
  }
  if (type === 'regex') {
    const pattern = String(p.pattern ?? '');
    if (!pattern || pattern.length > 200) throw bad('Regular expression: one with one capture group, e.g. (\\d+) posts');
    let re; try { re = new RegExp(pattern); } catch (e) { throw bad(`Regular expression: ${e.message}`); }
    if (new RegExp(`${re.source}|`).exec('').length - 1 !== 1) throw bad('Regular expression: exactly one capture group (…), around the number');
    return { type, pattern };
  }
  return { type, path: pth };
}
const at = (obj, pth) => {
  if (!pth) return obj;
  let v = obj;
  for (const k of pth.replace(/\[(\d+)\]/g, '.$1').split('.')) { if (v === null || v === undefined || typeof v !== 'object') return undefined; v = v[k]; }
  return v;
};
const num = (v, what) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim().replace(/,(?=\d{3}\b)/g, '')) : NaN;
  if (!Number.isFinite(n)) throw bad(`${what} is ${v === undefined ? 'not there' : JSON.stringify(v).slice(0, 60)}, not a number`);
  return n;
};
const texts = (r) => (Array.isArray(r?.content) ? r.content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text) : []);
// the JSON a path looks into: structuredContent, else the first text content parsed as JSON
function data(r) {
  if (r?.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent;
  const t = texts(r)[0];
  if (t === undefined) throw bad('The result has neither structured content nor text');
  try { return JSON.parse(t); } catch { throw bad('The result\'s text is not JSON: read it with a regular expression instead'); }
}
// tools/call's result -> one number, or an error in plain words
export function pickValue(result, pick) {
  if (!result || typeof result !== 'object') throw bad('The tool returned nothing');
  if (result.isError) throw bad(`The tool answered with an error: ${oneLine(texts(result).join(' ') || 'no details', 200)}`);
  if (pick.type === 'regex') {
    const text = texts(result).join('\n').slice(0, 100000);
    const m = new RegExp(pick.pattern).exec(text);
    if (!m) throw bad(`The text does not match /${pick.pattern}/`);
    return num(m[1], 'The captured text');
  }
  const d = data(result), v = at(d, pick.path);
  if (pick.type === 'path') return num(v, `The value at ${pick.path}`);
  if (!Array.isArray(v)) throw bad(`${pick.path ? `The value at ${pick.path}` : 'The result'} is not a list`);
  if (pick.type === 'count') return v.length;
  return Math.round(v.reduce((n, x, i) => n + num(at(x, pick.field), `${pick.field} of item ${i + 1}`), 0) * 100) / 100;
}
