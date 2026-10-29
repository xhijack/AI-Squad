// SPDX-License-Identifier: Apache-2.0
// Targets (1.3): the numbers a Space works against, set by the Owner, measured by the server, read by the agents.
//   <repo>/.claude/aisquad/kpi.json      the definitions (committed; a change is recorded in Admin → Changes)
//   ~/.aisquad/kpi/<floor>.json           the measurements (this machine) and the Space's webhook token
//   <repo>/docs/squad/KPI.md              what the agents read: each target, its value now, its status (generated)
// A target: id, name, unit, target (null until the Owner sets one), direction (up: more is better, down: less),
// period (day, week, month, total: the value counts from the period's start), source and how often it is measured.
// Sources: manual (a person enters it), erpnext (count or sum of documents), csv (a file in the repository),
// webhook (an outside system posts it to /api/kpi/hook/<token>), mcp (1.6: a read-only tool of an integration's MCP
// server, server/integrations.js; its result read into one number by server/pick.js).
// Every measurement goes to the Squad Log (kpi.measured); the status (met, behind, unset, unknown) is computed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as building from './building.js';
import * as erp from './erpnext.js';
import * as integ from './integrations.js';
import * as pick from './pick.js';
import { readJson, writeJson, writeText, readText, kebab, bad, notFound, oneLine } from './util.js';

export const DIRECTIONS = ['up', 'down'];
export const PERIODS = ['day', 'week', 'month', 'total'];
export const SOURCES = ['manual', 'erpnext', 'csv', 'webhook', 'mcp'];
export const MEASURED = ['erpnext', 'csv', 'mcp'];                      // the server measures these on their interval
export const ON_BEHIND = ['off', 'notify', 'suggest', 'act'];          // what a target behind its goal raises (1.5, server/behind.js)
export const EVERY = { hour: 3600e3, day: 864e5, week: 7 * 864e5 };
export const FILE = 'docs/squad/KPI.md';
const KEEP = 400;
const defFile = (root) => path.join(root, '.claude', 'aisquad', 'kpi.json');
const valFile = (floorId) => path.join(config.home, 'kpi', `${floorId}.json`);

export const deps = { log: () => {}, invalidate: () => {}, measured: () => {} };

// ---------- definitions ----------
export function cleanSource(s = {}) {
  const kind = SOURCES.includes(s?.kind) ? s.kind : 'manual';
  if (kind === 'erpnext') {
    const doctype = String(s.doctype || '').trim();
    if (!/^[A-Z][\w ]{1,60}$/.test(doctype)) throw bad('ERPNext source: a DocType, e.g. Lead');
    const filters = Array.isArray(s.filters) ? s.filters.filter((f) => Array.isArray(f) && f.length === 3).map((f) => f.map((x) => (typeof x === 'string' ? x.slice(0, 140) : x))).slice(0, 10) : [];
    const aggregate = s.aggregate === 'sum' ? 'sum' : 'count';
    const field = String(s.field || '').replace(/[^\w]/g, '').slice(0, 60);
    if (aggregate === 'sum' && !field) throw bad('ERPNext source: the field to sum, e.g. grand_total');
    return { kind, doctype, filters, aggregate, field, dateField: String(s.dateField || 'creation').replace(/[^\w]/g, '').slice(0, 60) || 'creation' };
  }
  if (kind === 'csv') {
    const p = String(s.path || '').trim().replace(/\\/g, '/');
    if (!p || p.startsWith('/') || p.includes('..') || !/\.csv$/i.test(p)) throw bad('CSV source: a .csv file inside the repository, e.g. docs/kpi/traffic.csv');
    return { kind, path: p, column: String(s.column || 'value').slice(0, 60), dateColumn: String(s.dateColumn || 'date').slice(0, 60), aggregate: s.aggregate === 'sum' ? 'sum' : 'last' };
  }
  if (kind === 'mcp') {
    const server = String(s.server || '').trim(), tool = String(s.tool || '').trim();
    if (!integ.ID.test(server)) throw bad('Integration source: the integration, e.g. user:postiz (Admin → Integrations)');
    if (!/^[\w./-]{1,128}$/.test(tool)) throw bad('Integration source: the tool to call, e.g. posts_this_week');
    return { kind, server, tool, args: pick.cleanArgs(s.args), pick: pick.cleanPick(s.pick) };
  }
  return { kind };
}
// the rule for a target behind its goal (1.5): mode, the agent (a role or agent id; empty: the lead), the task, the
// cooldown in hours between two triggers
export function cleanOnBehind(o = {}, existing = null) {
  const e = existing || { mode: 'off', agent: '', task: '', cooldown: 24 };
  if (!o || typeof o !== 'object') return e;
  const cd = o.cooldown === undefined ? e.cooldown : Number(o.cooldown);
  if (!(Number.isFinite(cd) && cd >= 1 && cd <= 720)) throw bad('Cooldown: hours between two triggers, 1 to 720');
  return { mode: ON_BEHIND.includes(o.mode) ? o.mode : o.mode === undefined ? e.mode : 'off', agent: kebab(o.agent ?? e.agent ?? '', 60), task: String(o.task ?? e.task ?? '').trim().slice(0, 2000), cooldown: Math.round(cd) };
}
// a Blueprint's hint (1.6): the kind of integration that would measure the target (`mcp:social-scheduler`)
export const REQUIRES = /^mcp:[a-z][a-z-]{1,39}$/;
const MAX_EVERY = { day: 'hour', week: 'day', month: 'week', total: 'week' };   // measuring less often than the period would leave it unknown most of the time
export function cleanKpi(k = {}, existing = null) {
  const name = oneLine(k.name ?? existing?.name ?? '', 80);
  if (!name) throw bad('The target needs a name');
  const id = existing?.id || kebab(k.id || name, 40);
  if (!id) throw bad('The target needs an id');
  const target = k.target === null || k.target === '' || k.target === undefined ? (k.target === undefined ? existing?.target ?? null : null) : Number(k.target);
  if (target !== null && !Number.isFinite(target)) throw bad('The target must be a number');
  const period = PERIODS.includes(k.period) ? k.period : existing?.period || 'month';
  let every = Object.keys(EVERY).includes(k.every) ? k.every : existing?.every || 'day';
  if (EVERY[every] > EVERY[MAX_EVERY[period]]) every = MAX_EVERY[period];
  return {
    id, name, unit: oneLine(k.unit ?? existing?.unit ?? '', 20), target,
    direction: DIRECTIONS.includes(k.direction) ? k.direction : existing?.direction || 'up',
    period, every,
    source: k.source !== undefined ? cleanSource(k.source) : existing?.source || { kind: 'manual' },
    note: oneLine(k.note ?? existing?.note ?? '', 200),
    onBehind: cleanOnBehind(k.onBehind, existing?.onBehind),
    ...(REQUIRES.test(k.requires ?? existing?.requires ?? '') ? { requires: k.requires ?? existing.requires } : {}),
  };
}
const rawDefs = (root) => { const j = readJson(defFile(root), null); return Array.isArray(j?.kpis) ? j.kpis.filter((k) => k && typeof k === 'object') : []; };
const valid = (k) => { try { return cleanKpi(k); } catch { return null; } };
export const readDefs = (root) => rawDefs(root).map(valid).filter(Boolean);
// entries in the file that are not valid targets (hand edits) are kept, never silently dropped
const writeDefs = (root, kpis) => writeJson(defFile(root), { kpis: [...kpis, ...rawDefs(root).filter((k) => !valid(k))] });
export function addKpi(root, input) {
  const kpis = readDefs(root);
  const k = cleanKpi(input);
  if (kpis.some((x) => x.id === k.id)) throw bad(`There is already a target "${k.id}"`);
  checkSource(root, k.source);
  if (kpis.length >= 30) throw bad('At most 30 targets per Space');
  writeDefs(root, [...kpis, k]);
  return k;
}
export function updateKpi(root, id, patch) {
  const kpis = readDefs(root);
  const i = kpis.findIndex((x) => x.id === id);
  if (i < 0) throw notFound('Target not found');
  kpis[i] = cleanKpi(patch, kpis[i]);
  if (patch?.source !== undefined) checkSource(root, kpis[i].source);
  writeDefs(root, kpis);
  return kpis[i];
}
// a source from an integration must be usable here and now: known, read-only, allowed for this Space (plain words)
function checkSource(root, s) { if (s.kind === 'mcp') integ.checkUse(integ.spaceOfRoot(root), s); }
export function removeKpi(root, id) {
  const kpis = readDefs(root);
  if (!kpis.some((x) => x.id === id)) throw notFound('Target not found');
  writeDefs(root, kpis.filter((x) => x.id !== id));
  return { ok: true };
}
// a Blueprint's starting targets (no target values yet: the Owner sets them; a notice when behind); existing ids are kept
export function seed(root, list = []) {
  if (!list.length) return [];
  const have = new Set(readDefs(root).map((k) => k.id));
  const add = [];
  for (const k of list) { try { const c = cleanKpi({ ...k, target: null, onBehind: { mode: 'notify', ...(k.onBehind || {}) } }); if (!have.has(c.id)) { add.push(c); have.add(c.id); } } catch { /* a bad seed is skipped */ } }
  if (add.length) writeDefs(root, [...readDefs(root), ...add]);
  return add;
}

// ---------- values ----------
// the values file: unreadable (not valid JSON) is an error for writes, so a series and the token are never
// wiped by accident; reads show the targets without values and say why
const EMPTY = () => ({ series: {}, errors: {}, token: '' });
function loadVals(floorId, { strict = false } = {}) {
  if (!floorId) return EMPTY();
  const f = valFile(floorId);
  if (!fs.existsSync(f)) return EMPTY();
  const j = readJson(f, null);
  if (!j || typeof j !== 'object') { if (strict) throw bad(`${f} is not valid JSON: fix or remove it`); return { ...EMPTY(), unreadable: true }; }
  return { ...EMPTY(), ...j, series: j.series || {}, errors: j.errors || {} };
}
const saveVals = (floorId, v) => writeJson(valFile(floorId), v, 0o600);
export const latest = (floorId, id) => (loadVals(floorId).series[id] || []).at(-1) || null;
// the last measurement that came the way the target is defined (a hand-entered value never stands in for ERPNext)
const latestOf = (floorId, k) => (loadVals(floorId).series[k.id] || []).findLast((p) => p.source === k.source.kind) || null;
// who may feed a target: a person enters manual and webhook targets (a fallback when the outside system is down),
// the webhook feeds webhook targets, erpnext and csv come from the server's measurement only
const feeds = (source, kind) => source === kind || (source === 'manual' && kind === 'webhook');
export function record(floorId, root, id, value, { source = 'manual', by = '', note = '', now = Date.now() } = {}) {
  const k = readDefs(root).find((x) => x.id === id);
  if (!k) throw notFound('Target not found');
  if (!feeds(source, k.source.kind)) throw bad(source === 'webhook' ? `"${id}" is not a webhook target` : `"${id}" is measured from ${k.source.kind}: a value cannot be entered for it`);
  const v = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  if (!Number.isFinite(v)) throw bad('The value must be a number');
  const vals = loadVals(floorId, { strict: true });
  vals.series[id] = [...(vals.series[id] || []), { ts: now, value: v, source, ...(by ? { by } : {}), ...(note ? { note: oneLine(note, 200) } : {}) }].slice(-KEEP);
  delete vals.errors[id];
  saveVals(floorId, vals);
  const st = statusOf(k, v);
  deps.log(floorId, { type: 'kpi.measured', data: { kpi: id, name: k.name, value: v, unit: k.unit, target: k.target, period: k.period, source, ...mcpFields(k, source), state: st.state, ...(by ? { by } : {}) } });
  render(root, floorId);
  deps.invalidate();
  deps.measured(floorId, root, id, now);                 // a target behind its goal may raise work (1.5)
  return { kpi: k, value: v, at: now, status: st };
}
function failed(floorId, k, error, now) {
  try { const vals = loadVals(floorId, { strict: true }); vals.errors[k.id] = { ts: now, error: oneLine(error, 200) }; saveVals(floorId, vals); } catch { /* the file itself is the problem */ }
  deps.log(floorId, { type: 'kpi.failed', data: { kpi: k.id, name: k.name, source: k.source.kind, ...mcpFields(k, k.source.kind), error: oneLine(error, 200) } });
}
// which integration and tool measured it (the arguments stay out of the log)
const mcpFields = (k, source) => (source === 'mcp' && k.source.kind === 'mcp' ? { server: k.source.server, tool: k.source.tool } : {});
// the Space's webhook token (made on first use, shown to the Owner); a new one when the old one leaked
export function token(floorId, { rotate = false } = {}) {
  const vals = loadVals(floorId, { strict: true });
  if (!vals.token || rotate) { vals.token = crypto.randomBytes(16).toString('hex'); saveVals(floorId, vals); }
  return vals.token;
}
export function floorOfToken(tok) {
  if (!/^[0-9a-f]{32}$/.test(String(tok || ''))) return null;
  for (const f of building.loadBuilding().floors) { const v = readJson(valFile(f.id), null); if (typeof v?.token === 'string' && v.token.length === tok.length && crypto.timingSafeEqual(Buffer.from(v.token), Buffer.from(tok))) return f; }
  return null;
}

// ---------- status ----------
export function statusOf(k, value) {
  if (k.target === null || k.target === undefined) return { state: 'unset', pct: null };
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return { state: 'unknown', pct: null };
  const v = Number(value), t = Number(k.target);
  if (k.direction === 'down') return { state: v <= t ? 'met' : 'behind', pct: v > 0 ? Math.min(999, Math.round((t / v) * 100)) : 100 };
  return { state: v >= t ? 'met' : 'behind', pct: t > 0 ? Math.min(999, Math.round((v / t) * 100)) : 100 };
}
// the start of the period that is running now (local time): day, Monday 00:00, the 1st, or 0
export function periodStart(period, now = Date.now()) {
  const d = new Date(now);
  if (period === 'total') return 0;
  d.setHours(0, 0, 0, 0);
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (period === 'month') d.setDate(1);
  return d.getTime();
}
// the period's first and last day as local dates, for a tool that takes a date range ({{from}} and {{to}}); a total
// runs from 1970 to today
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function periodRange(period, now = Date.now()) {
  if (period === 'total') return { from: '1970-01-01', to: ymd(now) };
  const from = periodStart(period, now), end = new Date(from);
  if (period === 'week') end.setDate(end.getDate() + 6);
  if (period === 'month') end.setMonth(end.getMonth() + 1, 0);
  return { from: ymd(from), to: ymd(end.getTime()) };
}
const frappeTs = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 19).replace('T', ' ');

// ---------- measuring ----------
// which ERPNext key measures a Space's targets: its own role's key, the Owner's only in an Owner-only Space (erpnext.js)
export function erpRole(root) {
  const fl = readJson(path.join(root, '.claude', 'aisquad', 'floor.json'), {}) || {};
  return erp.measureRole(fl);
}
const PAGE = 1000, MAX_ROWS = 50000;
export async function measureOne(root, k, now = Date.now()) {
  const s = k.source;
  if (s.kind === 'erpnext') {
    const filters = [...s.filters];
    if (k.period !== 'total') filters.push([s.dateField, '>=', frappeTs(periodStart(k.period, now))]);
    const who = erpRole(root), fields = s.aggregate === 'sum' ? [s.field] : ['name'];
    let n = 0, sum = 0;
    for (let start = 0; start < MAX_ROWS; start += PAGE) {
      const rows = await erp.list(who, s.doctype, { fields, filters, limit: PAGE, start });
      n += rows.length; for (const r of rows) sum += +r[s.field] || 0;
      if (rows.length < PAGE) break;
    }
    return s.aggregate === 'sum' ? Math.round(sum * 100) / 100 : n;
  }
  if (s.kind === 'csv') {
    let real; try { real = fs.realpathSync(path.join(root, s.path)); } catch { throw bad(`${s.path} does not exist`); }
    if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw bad(`${s.path} points outside the repository`);   // a link out of the repository
    const text = readText(real);
    if (text == null) throw bad(`${s.path} does not exist`);
    const rows = parseCsv(text);
    const ci = rows.head.indexOf(s.column), di = rows.head.indexOf(s.dateColumn);
    if (ci < 0) throw bad(`${s.path} has no column "${s.column}"`);
    let list = rows.body.map((r) => ({ v: Number(String(r[ci] || '').replace(/[^\d.-]/g, '')), d: di >= 0 ? Date.parse(r[di]) : NaN })).filter((x) => Number.isFinite(x.v));
    if (s.aggregate === 'sum') { const from = periodStart(k.period, now); list = list.filter((x) => k.period === 'total' || !Number.isFinite(x.d) || x.d >= from); return Math.round(list.reduce((n, x) => n + x.v, 0) * 100) / 100; }
    if (!list.length) throw bad(`${s.path} has no rows`);
    return list.at(-1).v;
  }
  if (s.kind === 'mcp') {
    const r = await integ.call(integ.spaceOfRoot(root), s, pick.fillArgs(s.args, periodRange(k.period, now)));
    return pick.pickValue(r, s.pick);
  }
  throw bad(`A ${s.kind} target is not measured by the server: enter its value`);
}
// Try (Admin → Targets, 1.6): one call with a source from an integration before it is saved: the arguments as sent,
// the raw result (clipped) and the number it picks, or why not
export async function trySource(root, input = {}, now = Date.now()) {
  const s = cleanSource(input.source);
  if (s.kind !== 'mcp') throw bad('Try works for a source from an integration');
  const args = pick.fillArgs(s.args, periodRange(PERIODS.includes(input.period) ? input.period : 'month', now));
  const r = await integ.call(integ.spaceOfRoot(root), s, args);
  const raw = JSON.stringify(r, null, 2) || '';
  let value = null, error = '';
  try { value = pick.pickValue(r, s.pick); } catch (e) { error = e.message; }
  return { args, raw: raw.length > 20000 ? `${raw.slice(0, 20000)}\n…` : raw, ...(error ? { error } : { value }) };
}
export function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  const split = (l) => l.split(l.includes(';') && !l.includes(',') ? ';' : ',').map((c) => c.trim().replace(/^"|"$/g, ''));
  return { head: lines.length ? split(lines[0]) : [], body: lines.slice(1).map(split) };
}
export async function measure(floorId, root, id, { now = Date.now(), by = '' } = {}) {
  const k = readDefs(root).find((x) => x.id === id);
  if (!k) throw notFound('Target not found');
  let v;
  try { v = await measureOne(root, k, now); } catch (e) { failed(floorId, k, e.message, now); throw e; }
  return record(floorId, root, id, v, { source: k.source.kind, by, now });
}
// the hourly tick: every erpnext, csv and mcp target whose interval passed, or whose last measurement is from
// the previous period (a monthly target measured daily is measured again on the 1st, not a day later)
export async function tick(now = Date.now()) {
  const out = [];
  for (const f of building.loadBuilding().floors) {
    for (const k of readDefs(f.path)) {
      if (!MEASURED.includes(k.source.kind)) continue;
      const last = latestOf(f.id, k);
      if (last && now - last.ts < (EVERY[k.every] || EVERY.day) - 60e3 && (k.period === 'total' || last.ts >= periodStart(k.period, now))) continue;
      try { const r = await measure(f.id, f.path, k.id, { now }); out.push({ floorId: f.id, kpi: k.id, value: r.value, state: r.status.state }); }
      catch (e) { out.push({ floorId: f.id, kpi: k.id, error: e.message }); }
    }
  }
  return out;
}

// ---------- what people and agents see ----------
export function list(floorId, root, now = Date.now()) {
  const vals = loadVals(floorId);
  return readDefs(root).map((k) => {
    const series = vals.series[k.id] || [];
    const l = series.at(-1) || null;
    const stale = l && k.period !== 'total' && l.ts < periodStart(k.period, now) && k.source.kind !== 'manual';   // measured before this period started
    const err = vals.errors[k.id] && (!l || vals.errors[k.id].ts > l.ts) ? vals.errors[k.id] : null;              // the last measurement failed
    return { ...k, latest: l, status: statusOf(k, stale ? null : l?.value), series: series.slice(-30), stale: !!stale, ...(err ? { error: err } : {}), ...(vals.unreadable ? { unreadable: true } : {}) };
  });
}
// all Spaces, for the cockpit and the digest
export function overview(now = Date.now()) {
  const spaces = [];
  for (const f of building.loadBuilding().floors) {
    let name = f.id; try { name = readJson(path.join(f.path, '.claude', 'aisquad', 'floor.json'), {})?.name || f.id; } catch { /* missing */ }
    const kpis = list(f.id, f.path, now);
    if (!kpis.length) continue;
    const by = (s) => kpis.filter((k) => k.status.state === s).length;
    spaces.push({ id: f.id, number: f.number, name, kpis, met: by('met'), behind: by('behind'), unset: by('unset'), unknown: by('unknown'), ...(kpis[0].unreadable ? { unreadable: true } : {}) });
  }
  const sum = (key) => spaces.reduce((n, s) => n + s[key], 0);
  return { spaces, total: spaces.reduce((n, s) => n + s.kpis.length, 0), met: sum('met'), behind: sum('behind'), unset: sum('unset'), unknown: sum('unknown') };
}
const fmt = (v, unit) => (v === null || v === undefined ? '–' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`);
const PERIOD_TEXT = { day: 'today', week: 'this week', month: 'this month', total: 'in total' };
// docs/squad/KPI.md: the agents' view (regenerated on every change and measurement)
export function render(root, floorId, now = Date.now()) {
  const kpis = list(floorId, root, now);
  const f = path.join(root, FILE);
  if (!kpis.length) { if (fs.existsSync(f) && (readText(f) || '').includes('GENERATED by The AI Squad')) fs.rmSync(f); return ''; }
  const cell = (s) => String(s).replace(/\|/g, '/');
  const rows = kpis.map((k) => `| ${cell(k.name)}${k.note ? ` (${cell(k.note)})` : ''} | ${k.stale ? '–' : cell(fmt(k.latest?.value, k.unit))} | ${k.target === null ? 'not set' : cell(fmt(k.target, k.unit))} (${k.direction === 'down' ? 'at most' : 'at least'}, ${PERIOD_TEXT[k.period]}) | ${k.status.state}${k.status.pct != null ? ` (${k.status.pct} %)` : ''}${k.error ? ' · last measurement failed' : ''} | ${k.source.kind === 'mcp' ? `mcp ${cell(k.source.server.split(':').at(-1))}` : k.source.kind} | ${k.latest ? new Date(k.latest.ts).toISOString().slice(0, 16).replace('T', ' ') : 'never'} |`);
  const text = ['# Targets', '', '<!-- GENERATED by The AI Squad from .claude/aisquad/kpi.json: the owner sets targets in Admin → Targets; do not edit this file. -->', '',
    'The numbers this Space works against. Plan the week against the targets that are behind, report progress on them, and never invent a value: a manual target is entered by a person in the app.', '',
    '| Target | Now | Goal | Status | Source | Measured |', '|---|---|---|---|---|---|', ...rows, ''].join('\n');
  if (readText(f) !== text) writeText(f, text);
  return text;
}
