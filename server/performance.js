// SPDX-License-Identifier: Apache-2.0
// Performance of a Squad Sprint Floor, read from the docs/squad files (ported from squad-3d's "kinerja"):
// per agent and per sprint the bugs QA found per story point (weighted by severity), the first-round QA pass
// rate, modules owned and cost per story point; plus the cost projection for the remaining backlog.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { safeReaddir, readText } from './util.js';
import { readConfig, parseTasks } from './sprint.js';

export const SEVERITY_WEIGHT = { Blocker: 5, Major: 3, Minor: 1, Cosmetic: 0.5 };
const weight = (sev) => SEVERITY_WEIGHT[sev] ?? 1;
const field = (text, k) => ((String(text).match(new RegExp(`^${k}:\\s*(.+)$`, 'mi')) || [])[1] || '').trim();
const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : +n.toFixed(d));

function splitRow(line) {
  const t = String(line).trim();
  return t.startsWith('|') ? t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/^`|`$/g, '')) : null;
}
// first Markdown table whose header has all the given columns -> rows as objects (lower-case keys)
export function tableRows(md, need) {
  const lines = String(md || '').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const head = splitRow(lines[i]);
    if (!head || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const keys = head.map((h) => h.toLowerCase());
    if (!need.every((n) => keys.includes(n))) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length; j++) {
      const r = splitRow(lines[j]);
      if (!r) break;
      rows.push(Object.fromEntries(keys.map((k, x) => [k, r[x] ?? ''])));
    }
    return rows;
  }
  return [];
}
const sp = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const modId = (s) => (String(s).match(/\bM\d+\b/) || [])[0] || '';

// one sprint's files: docs/squad/sprint-<n>/ (archive) and, for the running sprint, docs/squad itself
export function readSprint(root, n, current) {
  const base = path.join(root, 'docs', 'squad');
  const dirs = [path.join(base, `sprint-${n}`), ...(current ? [base] : [])];
  const S = { sprint: n, modules: {}, bugs: [], qa: {} };
  const mod = (id) => S.modules[id] || (S.modules[id] = { id, name: '', owner: '', sp: 0, build: '', qaStatus: '', qaRound: 0, done: false });
  for (const d of dirs) {
    for (const r of tableRows(readText(path.join(d, 'PLAN.md')), ['module', 'sp'])) {
      const id = modId(r.module); if (!id) continue;
      const m = mod(id);
      m.name = m.name || r.module.replace(id, '').replace(/^[\s:—-]+/, '');
      m.sp = m.sp || sp(r.sp);
      m.owner = m.owner || r.owner || '';
      if (/^DONE/i.test(r.status || '')) m.done = true;
    }
    for (const t of parseTasks(readText(path.join(d, 'TASKS.md')))) {
      const id = modId(t.task); if (!id) continue;
      const m = mod(id);
      if (/^BUILD/i.test(t.task)) { m.owner = m.owner || t.owner; m.build = t.column; }
      if (/^QA/i.test(t.task) && t.column === 'DONE') m.done = true;
    }
    for (const f of safeReaddir(path.join(d, 'qa'))) {
      const id = (f.match(/^(M\d+)\.md$/) || [])[1]; if (!id || S.qa[id]) continue;
      const t = readText(path.join(d, 'qa', f));
      S.qa[id] = { status: field(t, 'STATUS').toUpperCase().split(/\s/)[0], round: parseInt(field(t, 'Round'), 10) || 1, tester: field(t, 'Tester') };
    }
    for (const f of safeReaddir(path.join(d, 'bugs'))) {
      const m = f.match(/^(M\d+)-B\d+\.md$/); if (!m || S.bugs.some((b) => b.id === f.slice(0, -3))) continue;
      const t = readText(path.join(d, 'bugs', f));
      S.bugs.push({ id: f.slice(0, -3), module: m[1], owner: field(t, 'OWNER').split(/[\s(]/)[0], severity: field(t, 'SEVERITY').split(/[\s(]/)[0] || 'Minor',
        status: field(t, 'STATUS').toUpperCase().split(/\s/)[0], round: parseInt(field(t, 'Round'), 10) || 1 });
    }
  }
  for (const [id, q] of Object.entries(S.qa)) { const m = mod(id); m.qaStatus = q.status; m.qaRound = q.round; if (q.status === 'PASS') m.done = true; }
  return S;
}

// sprint windows from git: sprint n ends at its closing commit, starts where the previous one ended
export function sprintWindows(root, numbers, now = Date.now()) {
  let log = '';
  try { log = execFileSync('git', ['-C', root, 'log', '--all', '--format=%ct %s'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* no git */ }
  const ends = {};
  for (const line of log.split('\n')) {
    const m = line.match(/^(\d+) (.*)$/); if (!m) continue;
    const ts = +m[1] * 1000;
    const c = m[2].trim().toLowerCase().match(/^docs\(squad\): close sprint (\d+)$/);
    if (c && !(ends[c[1]] > ts)) ends[c[1]] = ts;
  }
  const out = {};
  let prevEnd = 0;                                          // sprint 1 includes the planning before it
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const end = ends[n] || now;
    out[n] = { start: prevEnd, end, closed: !!ends[n] };
    prevEnd = end;
  }
  return out;
}

// remaining backlog: docs/BACKLOG.md table with an SP column (rows with Status DONE are shipped)
export function backlogSP(root) {
  const rows = tableRows(readText(path.join(root, 'docs', 'BACKLOG.md')), ['sp']);
  return rows.filter((r) => !/^(DONE|SHIPPED|RELEASED)/i.test(r.status || '')).reduce((n, r) => n + sp(r.sp), 0);
}

// agents: [{ id, displayName, kind: lead|dev|qa }]; costs(from, to) -> { agentId: usd }
export function floorPerformance(root, agents, costs, now = Date.now()) {
  const cfg = readConfig(root);
  const current = parseInt(cfg.SPRINT, 10) || 0;
  const numbers = new Set(safeReaddir(path.join(root, 'docs', 'squad')).map((d) => (d.match(/^sprint-(\d+)$/) || [])[1]).filter(Boolean).map(Number));
  if (current) numbers.add(current);
  const windows = sprintWindows(root, numbers, now);
  const known = new Set(agents.map((a) => a.id));
  const kindOf = (id) => agents.find((a) => a.id === id)?.kind || 'dev';
  const blank = () => ({ modules: 0, sp: 0, bugs: 0, bugWeight: 0, qaTested: 0, firstPass: 0, found: 0, foundWeight: 0, cost: 0 });
  const per = {};                                           // agent -> sprint -> stats
  const cell = (a, n) => ((per[a] ||= {})[n] ||= blank());
  const sprints = [];
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const S = readSprint(root, n, n === current);
    const w = windows[n];
    const cost = costs(w.start, w.end);
    const mods = Object.values(S.modules);
    for (const m of mods) {
      if (!m.owner) continue;
      const c = cell(m.owner, n);
      c.modules++; c.sp += m.sp;
      if (m.qaStatus) {
        c.qaTested++;
        if (m.qaStatus === 'PASS' && m.qaRound <= 1 && !S.bugs.some((b) => b.module === m.id && /Blocker|Major/.test(b.severity))) c.firstPass++;
      }
    }
    for (const b of S.bugs) {
      if (b.owner) { const c = cell(b.owner, n); c.bugs++; c.bugWeight += weight(b.severity); }
      // bugs found: credited to the QA agents of the Floor (the tester of the module's report when known)
      const tester = S.qa[b.module]?.tester;
      const qa = known.has(tester) ? [tester] : agents.filter((a) => a.kind === 'qa').map((a) => a.id);
      for (const q of qa) { const c = cell(q, n); c.found += 1 / qa.length; c.foundWeight += weight(b.severity) / qa.length; }
    }
    for (const [a, usd] of Object.entries(cost)) cell(a, n).cost += usd;
    const plannedSP = mods.reduce((s, m) => s + m.sp, 0), doneSP = mods.filter((m) => m.done).reduce((s, m) => s + m.sp, 0);
    const total = Object.values(cost).reduce((s, x) => s + x, 0);
    sprints.push({ sprint: n, closed: w.closed, start: w.start, end: w.end, modules: mods.length, plannedSP, doneSP,
      bugs: S.bugs.length, bugWeight: S.bugs.reduce((s, b) => s + weight(b.severity), 0), openBugs: S.bugs.filter((b) => /OPEN|FIXED/.test(b.status)).length,
      cost: round(total), costPerSP: doneSP ? round(total / doneSP) : null });
  }
  const finish = (c) => ({ ...c, cost: round(c.cost), sp: round(c.sp, 1), found: round(c.found, 1), foundWeight: round(c.foundWeight, 1),
    bugsPerSP: c.sp ? round(c.bugWeight / c.sp) : null, firstPassRate: c.qaTested ? round(c.firstPass / c.qaTested) : null,
    costPerSP: c.sp ? round(c.cost / c.sp) : null, foundPerSP: null });
  const agentRows = [...new Set([...agents.map((a) => a.id), ...Object.keys(per)])].filter((id) => per[id]).map((id) => {
    const bySprint = Object.fromEntries(Object.entries(per[id]).map(([n, c]) => [n, finish(c)]));
    const total = finish(Object.values(per[id]).reduce((t, c) => { for (const k of Object.keys(t)) t[k] += c[k]; return t; }, blank()));
    return { id, displayName: agents.find((a) => a.id === id)?.displayName || id, kind: known.has(id) ? kindOf(id) : 'other', total, bySprint };
  });
  // QA: bugs found per story point of the sprints they tested
  const spOf = (n) => sprints.find((s) => String(s.sprint) === String(n))?.plannedSP || 0;
  for (const a of agentRows) {
    for (const [n, c] of Object.entries(a.bySprint)) c.foundPerSP = spOf(n) ? round(c.foundWeight / spOf(n)) : null;
    const tested = Object.keys(a.bySprint).reduce((s, n) => s + spOf(n), 0);
    a.total.foundPerSP = tested ? round(a.total.foundWeight / tested) : null;
  }
  // projection: cost per done story point so far times the story points still to build
  const spent = sprints.reduce((s, x) => s + (x.cost || 0), 0), doneSP = sprints.reduce((s, x) => s + x.doneSP, 0);
  const costPerSP = doneSP ? spent / doneSP : null;
  const running = sprints.find((s) => !s.closed);
  const remainingSP = backlogSP(root) + (running ? running.plannedSP - running.doneSP : 0);
  return {
    sprint: current, severityWeight: SEVERITY_WEIGHT, sprints, agents: agentRows,
    projection: { spent: round(spent), doneSP, costPerSP: round(costPerSP), remainingSP, remainingCost: costPerSP == null ? null : round(remainingSP * costPerSP),
      totalCost: costPerSP == null ? null : round(spent + remainingSP * costPerSP) },
  };
}
