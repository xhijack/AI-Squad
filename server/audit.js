// Audit: turns a time range of the Squad Log (a sprint, a day, or since the last audit) into a compact digest
// (metrics computed here plus the most relevant events), asks Claude Code (`claude -p` with the bundled squad-audit
// skill, structured JSON output) to judge process and efficiency, and stores the result in
// ~/.aisquad/audits/<floor-id>/<timestamp>.json + .md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config, claudeBin, ROOT } from './config.js';
import { safeReaddir, readJson, writeJson, writeText, readText, clip, oneLine, kebab } from './util.js';
import { parseFrontmatter } from './frontmatter.js';
import { modelFamily } from './transcripts.js';
import { SEVERITY_WEIGHT } from './performance.js';
import * as log from './log.js';

export const AUDIT_TIMEOUT_MS = 5 * 60e3;
export const AREAS = ['process', 'efficiency', 'quality'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const TARGET_KINDS = ['role-template', 'blueprint', 'floor-setting', 'project', 'none'];
export const FLOOR_SETTINGS = ['budget.usd', 'sprint.autoNext', 'audit.model', 'log.messages', 'autopilot'];
const SCORE_COST = { critical: 30, high: 15, medium: 8, low: 3 };
const LONG_OUTPUT = 4000;                        // output tokens in one reply
const REPEAT_READS = 3;

export const auditDir = (floorId) => path.join(config.home, 'audits', String(floorId).replace(/[^\w-]/g, '_'));
const ms = (t) => Date.parse(t);
const r2 = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : +n.toFixed(d));
const sum = (a, f) => a.reduce((n, x) => n + (f(x) || 0), 0);
const inc = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; return o; };

// ---------- metrics (pure: events in, numbers out) ----------
// events: log events in time order. info: { sourceDocs: [paths], team: [{ id, role, model }] }
export function metrics(events, info = {}) {
  const of = (t) => events.filter((e) => e.type === t);
  const end = events.length ? ms(events.at(-1).ts) : Date.now();
  // modules and story points: from the sprint plans, then everything that mentions a module
  const mods = {};
  const mod = (id) => (mods[id] ||= { id, sp: 0, owner: '', handoff: false, qa: [], done: false, reopened: 0, cost: 0, tokens: 0, turns: 0 });
  for (const e of of('sprint.planned')) for (const m of e.data.list || []) if (m.module) Object.assign(mod(m.module), { sp: m.sp || 0, owner: m.owner || '' });
  for (const e of of('handoff.written')) if (/^M\d+$/.test(e.module || '')) mod(e.module).handoff = true;
  for (const e of of('qa.report')) if (/^M\d+$/.test(e.module || '')) { mod(e.module).qa.push({ round: e.data.round, status: e.data.status, ts: e.ts }); if (e.data.status === 'PASS') mod(e.module).done = true; }
  for (const e of of('board.changed')) if (/^M\d+$/.test(e.module || '')) { if (e.data.reopened) mod(e.module).reopened++; if (/^QA\b/i.test(e.data.task) && e.data.to === 'DONE') mod(e.module).done = true; }
  const modules = Object.values(mods).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const plannedSP = sum(modules, (m) => m.sp), doneSP = sum(modules.filter((m) => m.done), (m) => m.sp);

  // ---- process ----
  const firstSprint = of('sprint.planned')[0]?.ts || null;
  const docs = {};
  for (const e of of('doc.status')) docs[e.data.doc] = { ...(docs[e.data.doc] || {}), status: e.data.status, ...(e.data.status === 'approved' && !docs[e.data.doc]?.approvedAt ? { approvedAt: e.ts } : {}) };
  for (const d of info.sourceDocs || []) docs[d] ||= { status: 'unknown' };
  const docList = Object.entries(docs).map(([doc, d]) => ({ doc, status: d.status, approvedAt: d.approvedAt || null, beforeFirstSprint: !!(d.approvedAt && (!firstSprint || d.approvedAt <= firstSprint)) }));
  const qaFirst = modules.filter((m) => m.qa.length);
  const firstRoundPass = qaFirst.filter((m) => m.qa.some((q) => q.round === 1 && q.status === 'PASS') && !m.qa.some((q) => q.round === 1 && q.status === 'FAIL'));
  const bugs = of('bug.opened');
  const bySeverity = {};
  for (const b of bugs) inc(bySeverity, b.data.severity || 'Minor');
  const weighted = sum(bugs, (b) => SEVERITY_WEIGHT[b.data.severity] ?? 1);
  // QA PASS for each module before the merge that shipped it
  const merges = of('merge.done').map((e) => {
    const missing = modules.filter((m) => !m.qa.some((q) => q.status === 'PASS' && q.ts <= e.ts)).map((m) => m.id);
    return { branch: e.data.branch, ts: e.ts, missingQa: missing };
  });
  // the most modules IN_PROGRESS at the same time
  const doing = new Set();
  let maxParallel = 0;
  for (const e of of('board.changed')) {
    if (!/^BUILD\b/i.test(e.data.task)) continue;
    if (e.data.to === 'IN_PROGRESS') doing.add(e.data.task); else doing.delete(e.data.task);
    maxParallel = Math.max(maxParallel, doing.size);
  }
  const plannedOwners = new Set(modules.map((m) => m.owner).filter(Boolean));
  const answered = of('question.answered');
  const waits = answered.map((e) => e.data.waitMs || 0);
  const permWaits = of('permission.answered').map((e) => e.data.waitMs || 0);
  const refused = [...of('gate.failed'), ...of('merge.refused')];
  const process_ = {
    sourceDocs: { total: docList.length, approved: docList.filter((d) => d.status === 'approved').length, approvedBeforeFirstSprint: docList.filter((d) => d.beforeFirstSprint).length, firstSprintAt: firstSprint, docs: docList },
    modules: { total: modules.length, withHandoff: modules.filter((m) => m.handoff).length, missingHandoff: modules.filter((m) => !m.handoff).map((m) => m.id), done: modules.filter((m) => m.done).length },
    qaBeforeMerge: { merges: merges.length, mergesWithAllQa: merges.filter((m) => !m.missingQa.length).length, detail: merges },
    qaFirstRoundPassRate: qaFirst.length ? r2(firstRoundPass.length / qaFirst.length) : null,
    qaReported: qaFirst.length,
    bugs: { total: bugs.length, bySeverity, weighted, perSP: plannedSP ? r2(weighted / plannedSP) : null, open: bugs.length - of('bug.closed').length },
    parallel: { plannedOwners: plannedOwners.size, maxModulesInProgress: maxParallel },
    questions: { asked: of('question.asked').length, answered: answered.length, avgWaitMin: waits.length ? r2(sum(waits, (x) => x) / waits.length / 60e3, 1) : null, maxWaitMin: waits.length ? r2(Math.max(...waits) / 60e3, 1) : null },
    permissions: { asked: of('permission.asked').length, totalWaitMin: r2(sum(permWaits, (x) => x) / 60e3, 1) },
    gatesRefused: { total: refused.length, byGate: refused.reduce((o, e) => inc(o, e.data.gate || 'merge'), {}) },
    gatesPassed: of('gate.passed').length,
    rework: { reopened: sum(modules, (m) => m.reopened) + of('board.changed').filter((e) => e.data.reopened && !/^M\d+$/.test(e.module || '')).length },
    // Squad Sprint: the checks the server makes before it merges a closed sprint (from git, at audit time)
    sprintClose: info.sprintClose || null,
  };

  // ---- efficiency ----
  const usage = of('usage.turn');
  const tokens = (e) => e.data.input + e.data.output + e.data.cacheRead + e.data.cacheWrite;
  const totalCost = sum(usage, (e) => e.data.cost), inputAll = sum(usage, (e) => e.data.input + e.data.cacheRead + e.data.cacheWrite);
  const agents = {};
  const ag = (id) => (agents[id] ||= { agent: id, role: '', models: {}, cost: 0, tokens: 0, output: 0, turns: 0, toolCalls: 0, failedTools: 0, editsDocsOnly: true, edits: 0 });
  for (const e of usage) {
    const a = ag(e.agent || '?'); a.role ||= e.role || ''; a.cost += e.data.cost; a.tokens += tokens(e); a.output += e.data.output; a.turns++;
    inc(a.models, modelFamily(e.model) || e.model || '?', e.data.cost);
    if (/^M\d+$/.test(e.module || '')) { const m = mod(e.module); m.cost += e.data.cost; m.tokens += tokens(e); m.turns++; }
  }
  const costByModel = {};
  for (const e of usage) inc(costByModel, modelFamily(e.model) || e.model || '?', e.data.cost);
  const tools = of('tool.call');
  const reads = {};
  const failed = {};
  let retries = 0;
  const lastByAgent = {};
  for (const e of tools) {
    const a = ag(e.agent || '?'); a.role ||= e.role || ''; a.toolCalls++;
    if (e.data.tool === 'Read' && e.data.target) inc(reads, `${e.agent}\t${e.data.target}`);
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(e.data.tool)) { a.edits++; if (!/\.(md|txt)$/i.test(e.data.target || '') && !/^docs\//.test(e.data.target || '')) a.editsDocsOnly = false; }
    const prev = lastByAgent[e.agent];
    if (prev && !prev.data.ok && prev.data.tool === e.data.tool && prev.data.target === e.data.target) retries++;
    lastByAgent[e.agent] = e;
    if (e.data.ok === false) { a.failedTools++; inc(failed, `${e.data.tool}\t${e.data.target || ''}`); }
  }
  // idle while the team had open work: from agent.idle (openWork) to the next agent.busy, or the end of the range
  const idleOpen = {};
  const idleSince = {};
  for (const e of events) {
    if (e.type === 'agent.idle') idleSince[e.agent] = e.data.openWork ? ms(e.ts) : null;
    if ((e.type === 'agent.busy' || e.type === 'agent.stopped' || e.type === 'agent.crashed') && idleSince[e.agent] != null) { inc(idleOpen, e.agent, ms(e.ts) - idleSince[e.agent]); idleSince[e.agent] = null; }
  }
  for (const [a, t] of Object.entries(idleSince)) if (t != null) inc(idleOpen, a, end - t);
  const byAgent = Object.values(agents).map((a) => ({ agent: a.agent, role: a.role, models: Object.keys(a.models).join(', '), cost: r2(a.cost, 4), tokens: a.tokens, turns: a.turns, outputTokens: a.output,
    toolCalls: a.toolCalls, failedTools: a.failedTools, idleWithOpenWorkMin: r2((idleOpen[a.agent] || 0) / 60e3, 1) })).sort((x, y) => y.cost - x.cost);
  const efficiency = {
    totals: { cost: r2(totalCost, 4), tokens: sum(usage, tokens), outputTokens: sum(usage, (e) => e.data.output), turns: usage.length, toolCalls: tools.length },
    plannedSP, doneSP,
    costPerSP: doneSP ? r2(totalCost / doneSP, 4) : null,
    tokensPerSP: doneSP ? Math.round(sum(usage, tokens) / doneSP) : null,
    cacheHitRate: inputAll ? r2(sum(usage, (e) => e.data.cacheRead) / inputAll) : null,
    costByModel: Object.fromEntries(Object.entries(costByModel).map(([k, v]) => [k, { cost: r2(v, 4), share: totalCost ? r2(v / totalCost) : 0 }])),
    byAgent,
    byModule: modules.filter((m) => m.turns).map((m) => ({ module: m.id, sp: m.sp, cost: r2(m.cost, 4), tokens: m.tokens, turns: m.turns, costPerSP: m.sp ? r2(m.cost / m.sp, 4) : null })),
    repeatedReads: Object.entries(reads).filter(([, n]) => n >= REPEAT_READS).map(([k, n]) => { const [agent, target] = k.split('\t'); return { agent, target, count: n }; }).sort((a, b) => b.count - a.count).slice(0, 10),
    failedTools: { total: sum(Object.values(failed), (x) => x), retries, top: Object.entries(failed).map(([k, n]) => { const [tool, target] = k.split('\t'); return { tool, target, count: n }; }).sort((a, b) => b.count - a.count).slice(0, 8) },
    longOutputs: usage.filter((e) => e.data.output > LONG_OUTPUT).length,
    idleWithOpenWorkMin: r2(sum(Object.values(idleOpen), (x) => x) / 60e3, 1),
    blockedOnOwnerMin: r2((sum(waits, (x) => x) + sum(permWaits, (x) => x)) / 60e3, 1),
    expensiveModelOnSimpleWork: Object.values(agents).filter((a) => a.models.opus && a.edits && a.editsDocsOnly).map((a) => ({ agent: a.agent, role: a.role, cost: r2(a.models.opus, 4), reason: 'opus for docs-only edits' })),
  };
  // Autopilot: decisions without the owner, how many the owner changed later (quality signal), critical items that were
  // decided anyway (must be zero), and the waiting it saved compared with the owner's average answer time
  const apDecided = of('autopilot.decided'), byServer = apDecided.filter((e) => e.data.by !== 'lead'), byLead = apDecided.filter((e) => e.data.by === 'lead');
  const avgWait = waits.length ? sum(waits, (x) => x) / waits.length : null;
  const changed = of('autopilot.changed').length;
  const autopilot = {
    decided: apDecided.length, byServer: byServer.length, byLead: byLead.length, changed,
    changeRate: apDecided.length ? r2(changed / apDecided.length) : null,
    criticalDecided: apDecided.filter((e) => e.data.critical).length,
    blocked: of('autopilot.blocked').length, nudges: of('autopilot.nudged').length,
    timeSavedMin: avgWait == null ? null : r2((byLead.length * avgWait + sum(byServer, (e) => Math.max(0, avgWait - (e.data.waitedMs || 0)))) / 60e3, 1),
  };
  // root cause first: fix attempts per problem; three or more failed attempts without an escalation is a loop
  const dbg = {};
  for (const e of of('debug.attempt')) (dbg[e.data.issue] ||= { issue: e.data.issue, agent: e.agent, attempts: 0, escalated: false }).attempts = Math.max(dbg[e.data.issue]?.attempts || 0, e.data.attempt);
  for (const e of of('debug.escalated')) (dbg[e.data.issue] ||= { issue: e.data.issue, agent: e.agent, attempts: e.data.attempts, escalated: false }).escalated = true;
  const debugList = Object.values(dbg);
  const debug = { issues: debugList.length, attempts: sum(debugList, (d) => d.attempts), escalated: debugList.filter((d) => d.escalated).length,
    loops: debugList.filter((d) => d.attempts > 3 || (d.attempts >= 3 && !d.escalated)).map((d) => ({ issue: d.issue, agent: d.agent, attempts: d.attempts, escalated: d.escalated })) };
  // quality: what QA and the gates caught
  const quality = { qaFailures: of('qa.report').filter((e) => e.data.status === 'FAIL').length, bugsBySeverity: bySeverity, crashes: of('agent.crashed').length, watchdogAlerts: of('watchdog.alert').length };
  return { range: { from: events[0]?.ts || null, to: events.at(-1)?.ts || null, events: events.length }, process: process_, efficiency, quality, autopilot, debug };
}

// ---------- digest: what the reviewer reads ----------
const relevant = (e, m) => {
  switch (e.type) {
    case 'gate.failed': case 'merge.refused': case 'agent.crashed': case 'watchdog.alert': case 'sprint.planned': case 'sprint.closed': case 'merge.done': case 'agent.model': return 5;
    case 'qa.report': return e.data.status === 'FAIL' ? 5 : 3;
    case 'bug.opened': return ['Blocker', 'Major'].includes(e.data.severity) ? 4 : 2;
    case 'board.changed': return e.data.reopened ? 4 : 0;
    case 'question.asked': return 3;
    case 'question.answered': return (e.data.waitMs || 0) > 10 * 60e3 ? 4 : 2;
    case 'permission.answered': return (e.data.waitMs || 0) > 2 * 60e3 ? 3 : 0;
    case 'doc.status': return e.data.status === 'approved' ? 3 : 1;
    case 'tool.call': return e.data.ok === false ? 2 : 0;
    case 'usage.turn': return e.data.output > LONG_OUTPUT ? 2 : 0;
    case 'agent.idle': return e.data.openWork ? 1 : 0;
    case 'message.sent': case 'task.delegated': case 'task.given': return 1;
    case 'autopilot.decided': return e.data.critical ? 5 : 2;
    case 'debug.escalated': return 4;
    case 'debug.attempt': return (e.data.attempt || 0) >= 3 ? 4 : 1;
    case 'autopilot.changed': return 4;
    case 'autopilot.blocked': return 3;
    default: return 0;
  }
};
const table = (head, rows) => (rows.length ? `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.map((c) => String(c ?? '–').replace(/\|/g, '/')).join(' | ')} |`).join('\n')}\n` : '(none)\n');

// -> { text, refs: { E1: event id } }
export function digest(events, m, info = {}, { maxEvents = 60, maxChars = 14000 } = {}) {
  const P = m.process, E = m.efficiency;
  const picked = events.map((e, i) => ({ e, i, w: relevant(e, m) })).filter((x) => x.w > 0);
  // the most relevant first (at most 20 of one important type, 8 of the others), then back in time order
  picked.sort((a, b) => b.w - a.w || a.i - b.i);
  const perType = {};
  const keep = picked.filter((x) => (perType[x.e.type] = (perType[x.e.type] || 0) + 1) <= (x.w >= 4 ? 20 : 8)).slice(0, maxEvents).sort((a, b) => a.i - b.i);
  const refs = {};
  const lines = keep.map((x, n) => { refs[`E${n + 1}`] = x.e.id; return `E${n + 1} ${x.e.ts.slice(0, 16).replace('T', ' ')} ${x.e.type}${x.e.agent ? ` [${x.e.agent}]` : ''}${x.e.module ? ` (${x.e.module})` : ''}: ${oneLine(x.e.summary, 160)}`; });
  const talk = {};
  for (const e of events) if (e.type === 'message.sent' || e.type === 'task.delegated') inc(talk, `${e.agent} -> ${e.data.to}`);
  for (const e of events) if (e.type === 'question.asked') inc(talk, `${e.agent} -> owner`);
  const text = [
    `# Squad audit digest`,
    `Floor: ${info.floorName || info.floorId || '?'} (id \`${info.floorId || '?'}\`)${info.blueprint ? `, Blueprint id \`${info.blueprint}\`${info.blueprintVersion ? ` (version ${info.blueprintVersion})` : ''}` : ''}, workflow ${info.workflow || '?'}.`,
    `Range: ${info.label || ''} ${m.range.from || '?'} to ${m.range.to || '?'}, ${m.range.events} log events.`,
    '', '## Team', table(['agent', 'role', 'configured model', 'effort'], (info.team || []).map((a) => [a.id, a.role, a.model, a.effort])),
    '## Process metrics',
    table(['metric', 'value'], [
      ['process.sourceDocs', `${P.sourceDocs.approvedBeforeFirstSprint} of ${P.sourceDocs.total} approved before the first sprint${P.sourceDocs.docs.length ? ` (${P.sourceDocs.docs.map((d) => `${d.doc}: ${d.status}`).join(', ')})` : ''}`],
      ['process.modules', `${P.modules.total} modules, ${P.modules.withHandoff} with a handoff${P.modules.missingHandoff.length ? `, missing: ${P.modules.missingHandoff.join(', ')}` : ''}, ${P.modules.done} done`],
      ['process.qaBeforeMerge', `${P.qaBeforeMerge.mergesWithAllQa} of ${P.qaBeforeMerge.merges} merges had a QA PASS for every module`],
      ['process.qaFirstRoundPassRate', P.qaFirstRoundPassRate == null ? 'no QA reports' : `${Math.round(P.qaFirstRoundPassRate * 100)} % of ${P.qaReported} modules`],
      ['process.bugs', `${P.bugs.total} (${Object.entries(P.bugs.bySeverity).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), weighted ${P.bugs.weighted}, per SP ${P.bugs.perSP ?? '–'}, open ${P.bugs.open}`],
      ['process.parallel', `${P.parallel.maxModulesInProgress} modules in progress at most, ${P.parallel.plannedOwners} owners planned`],
      ['process.questions', `${P.questions.asked} asked, ${P.questions.answered} answered, wait avg ${P.questions.avgWaitMin ?? '–'} min, max ${P.questions.maxWaitMin ?? '–'} min`],
      ['process.permissions', `${P.permissions.asked} prompts, ${P.permissions.totalWaitMin} min waiting`],
      ['process.gatesRefused', `${P.gatesRefused.total} (${Object.entries(P.gatesRefused.byGate).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), ${P.gatesPassed} passed`],
      ['process.rework', `${P.rework.reopened} rows reopened`],
      ...(m.debug?.issues ? [['process.debug', `${m.debug.issues} problems investigated, ${m.debug.attempts} fix attempts, ${m.debug.escalated} escalated${m.debug.loops.length ? `; LOOPS (3+ failed attempts without escalation, or more than 3): ${m.debug.loops.map((d) => `${d.issue} by ${d.agent || '?'} (${d.attempts})`).join(', ')}` : ''}`]] : []),
      ...(P.sprintClose ? [['process.sprintClose', `sprint ${P.sprintClose.sprint}: ${Object.entries(P.sprintClose.checks).map(([k, ok]) => `${k} ${ok ? 'yes' : 'NO'}`).join(', ')}; the server merges only when all are yes`]] : []),
    ]),
    '## Efficiency metrics',
    table(['metric', 'value'], [
      ['efficiency.totals', `$${E.totals.cost} for ${E.totals.turns} replies, ${E.totals.tokens} tokens (${E.totals.outputTokens} output), ${E.totals.toolCalls} tool calls`],
      ['efficiency.storyPoints', `${E.doneSP} of ${E.plannedSP} SP done`],
      ['efficiency.costPerSP', E.costPerSP == null ? 'no SP done' : `$${E.costPerSP}`],
      ['efficiency.tokensPerSP', E.tokensPerSP ?? '–'],
      ['efficiency.cacheHitRate', E.cacheHitRate == null ? '–' : `${Math.round(E.cacheHitRate * 100)} %`],
      ['efficiency.costByModel', Object.entries(E.costByModel).map(([k, v]) => `${k} $${v.cost} (${Math.round(v.share * 100)} %)`).join(', ') || '–'],
      ['efficiency.failedTools', `${E.failedTools.total} failed, ${E.failedTools.retries} retried right away`],
      ['efficiency.longOutputs', `${E.longOutputs} replies over ${LONG_OUTPUT} output tokens`],
      ['efficiency.idleWithOpenWorkMin', E.idleWithOpenWorkMin],
      ['efficiency.blockedOnOwnerMin', E.blockedOnOwnerMin],
      ['efficiency.expensiveModelOnSimpleWork', E.expensiveModelOnSimpleWork.map((x) => `${x.agent} (${x.reason}, $${x.cost})`).join('; ') || 'none'],
    ]),
    '### Per agent (efficiency.byAgent)', table(['agent', 'role', 'models', 'cost $', 'tokens', 'turns', 'tool calls', 'failed', 'idle with open work (min)'], E.byAgent.map((a) => [a.agent, a.role, a.models, a.cost, a.tokens, a.turns, a.toolCalls, a.failedTools, a.idleWithOpenWorkMin])),
    '### Per module (efficiency.byModule)', table(['module', 'SP', 'cost $', 'tokens', 'turns', 'cost / SP'], E.byModule.map((x) => [x.module, x.sp, x.cost, x.tokens, x.turns, x.costPerSP])),
    '### Files read 3+ times by one agent (efficiency.repeatedReads)', table(['agent', 'file', 'reads'], E.repeatedReads.map((x) => [x.agent, x.target, x.count])),
    '### Failing tool calls (efficiency.failedTools.top)', table(['tool', 'target', 'failures'], E.failedTools.top.map((x) => [x.tool, clip(x.target, 80), x.count])),
    '## Communication (who -> whom: messages)', table(['from -> to', 'count'], Object.entries(talk).sort((a, b) => b[1] - a[1]).slice(0, 15)),
    ...(m.autopilot && (m.autopilot.decided || m.autopilot.blocked || m.autopilot.nudges) ? ['## Autopilot', table(['metric', 'value'], [
      ['autopilot.decided', `${m.autopilot.decided} decisions without the owner (${m.autopilot.byLead} by the lead, ${m.autopilot.byServer} by the server timeout)`],
      ['autopilot.changeRate', m.autopilot.changeRate == null ? '–' : `${m.autopilot.changed} changed by the owner later (${Math.round(m.autopilot.changeRate * 100)} %)`],
      ['autopilot.criticalDecided', `${m.autopilot.criticalDecided} critical items decided without the owner (must be 0)`],
      ['autopilot.blocked', `${m.autopilot.blocked} critical items waited for the owner, ${m.autopilot.nudges} nudges`],
      ['autopilot.timeSavedMin', m.autopilot.timeSavedMin ?? '– (no owner answer times to compare)'],
    ])] : []),
    '## Quality', `QA failures ${m.quality.qaFailures}, crashes ${m.quality.crashes}, watchdog alerts ${m.quality.watchdogAlerts}.`, '',
    '## Relevant events', ...(lines.length ? lines : ['(none)']),
  ].join('\n');
  return { text: text.length > maxChars ? `${text.slice(0, maxChars)}\n(digest cut at ${maxChars} characters)` : text, refs };
}

// ---------- AI review ----------
const STR = { type: 'string' };
export const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'findings'],
  properties: {
    summary: STR,
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['area', 'severity', 'title', 'evidence', 'recommendation', 'target'],
      properties: {
        area: { type: 'string', enum: AREAS }, severity: { type: 'string', enum: SEVERITIES }, title: STR, evidence: { type: 'array', items: STR }, recommendation: STR,
        target: { type: 'object', additionalProperties: false, required: ['kind', 'id', 'proposedChange'], properties: {
          kind: { type: 'string', enum: TARGET_KINDS }, id: STR,
          proposedChange: { type: 'object', additionalProperties: false, required: ['summary', 'addRules', 'removeRules', 'appendPrompt', 'model', 'effort', 'setting', 'value'], properties: {
            summary: STR, addRules: { type: 'array', items: STR }, removeRules: { type: 'array', items: STR }, appendPrompt: STR, model: STR, effort: STR, setting: STR, value: STR } },
        } },
      } } },
  },
};

const strList = (v, n, len) => (Array.isArray(v) ? v : []).map((x) => clip(oneLine(String(x ?? ''), len), len)).filter(Boolean).slice(0, n);
// validates and cleans the reviewer's JSON (it may come from structured output or from text)
export function parseReview(raw) {
  let j = raw;
  if (typeof raw === 'string') {
    try { j = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); if (!m) throw new Error('The review is not JSON'); j = JSON.parse(m[0]); }
  }
  if (j && typeof j === 'object' && j.structured_output) j = j.structured_output;
  if (!j || typeof j !== 'object' || !Array.isArray(j.findings)) throw new Error('The review has no findings list');
  const findings = j.findings.map((f) => {
    if (!f || typeof f !== 'object') return null;
    const area = AREAS.includes(f.area) ? f.area : null;
    const severity = SEVERITIES.includes(String(f.severity).toLowerCase()) ? String(f.severity).toLowerCase() : 'medium';
    const recommendation = clip(String(f.recommendation || '').trim(), 600);
    const evidence = strList(f.evidence, 10, 120);
    if (!area || !recommendation || !evidence.length) return null;               // a finding without evidence is dropped
    const t = f.target && typeof f.target === 'object' ? f.target : {};
    const kind = TARGET_KINDS.includes(t.kind) ? t.kind : 'none';
    const pc = t.proposedChange && typeof t.proposedChange === 'object' ? t.proposedChange : {};
    const change = { summary: clip(oneLine(pc.summary || ''), 300), addRules: strList(pc.addRules, 5, 300), removeRules: strList(pc.removeRules, 5, 300), appendPrompt: clip(String(pc.appendPrompt || '').trim(), 1200),
      model: ['opus', 'sonnet', 'haiku'].includes(pc.model) ? pc.model : '', effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(pc.effort) ? pc.effort : '',
      setting: FLOOR_SETTINGS.includes(pc.setting) ? pc.setting : '', value: clip(String(pc.value ?? ''), 60) };
    const id = kebab(t.id || '').replace(kind === 'blueprint' ? /-v\d+$/ : /^$/, '');      // "software-house v1" -> software-house
    const actionable = kind !== 'none' && id && (kind === 'floor-setting' ? !!change.setting : change.addRules.length || change.removeRules.length || change.appendPrompt || change.model || change.effort);
    return { area, severity, title: clip(oneLine(f.title || recommendation, 120), 120), evidence, recommendation, target: actionable ? { kind, id, proposedChange: change } : null };
  }).filter(Boolean).sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)).slice(0, 20);
  findings.forEach((f, i) => { f.id = `F${i + 1}`; });
  return { summary: clip(String(j.summary || '').trim(), 1200), findings };
}

// score per area: 100 minus the weight of its findings
export function scores(findings) {
  const out = {};
  for (const a of AREAS) out[a] = Math.max(0, 100 - sum(findings.filter((f) => f.area === a), (f) => SCORE_COST[f.severity]));
  out.overall = Math.round(sum(AREAS, (a) => out[a]) / AREAS.length);
  return out;
}

export function skillText() {
  const t = readText(path.join(ROOT, 'skills', 'squad-audit', 'SKILL.md'), '');
  try { return parseFrontmatter(t).body.trim(); } catch { return t; }
}

// claude -p: no tools, no session, the skill as system prompt, JSON by schema. -> { review, cost, usage, model, durationMs }
export function runReview(digestText, { model = 'sonnet', timeoutMs = AUDIT_TIMEOUT_MS } = {}) {
  const prompt = `Audit this squad. Use the squad-audit rules from your system prompt. Answer with the JSON schema only.\n\n${digestText}`;
  const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config',
    '--append-system-prompt', skillText(), '--json-schema', JSON.stringify(REVIEW_SCHEMA), prompt];
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    execFile(claudeBin(), args, { cwd: os.tmpdir(), timeout: timeoutMs, maxBuffer: 16e6, env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` } }, (err, stdout) => {
      if (err && !stdout) return reject(new Error(err.killed ? 'The audit timed out' : `Claude Code failed: ${oneLine(err.message, 200)}`));
      let j; try { j = JSON.parse(stdout); } catch { return reject(new Error('Claude Code gave no readable answer')); }
      if (j.is_error) return reject(new Error(`Claude Code: ${oneLine(j.result || j.subtype || 'error', 200)}`));
      try {
        resolve({ review: parseReview(j.structured_output ? j.structured_output : String(j.result || '')), cost: +(j.total_cost_usd || 0), usage: j.usage || null, model: Object.keys(j.modelUsage || {})[0] || model, durationMs: Date.now() - t0 });
      } catch (e) { reject(e); }
    });
  });
}

// ---------- ranges, storage and history ----------
const stamp = (t) => new Date(t).toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
export function listAudits(floorId) {
  return safeReaddir(auditDir(floorId)).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(path.join(auditDir(floorId), f), null)).filter(Boolean);
}
export function getAudit(floorId, id) {
  if (!/^[\w-]+$/.test(String(id))) return null;
  return readJson(path.join(auditDir(floorId), `${id}.json`), null);
}
// the Retro of a sprint audit: inside the audit and as <id>-retro.md next to it
export function saveRetro(floorId, id, retro, md) {
  const a = getAudit(floorId, id);
  if (!a) return null;
  a.retro = retro;
  writeJson(path.join(auditDir(floorId), `${id}.json`), a);
  writeText(path.join(auditDir(floorId), `${id}-retro.md`), md);
  return a;
}
export const latestRetro = (floorId, sprint = null) => listAudits(floorId).filter((a) => a.retro && (sprint == null || String(a.retro.sprint) === String(sprint))).at(-1)?.retro || null;
// the compact history for trends
export const historyOf = (floorId) => listAudits(floorId).map((a) => ({ id: a.id, createdAt: a.createdAt, label: a.range?.label, retro: !!a.retro, scores: a.scores, findings: a.findings?.length || 0, cost: a.cost, model: a.model, error: a.error || null,
  trend: trendOf(a.metrics) }));
export const trendOf = (m) => (m ? { costPerSP: m.efficiency.costPerSP, passRate: m.process.qaFirstRoundPassRate, cacheHitRate: m.efficiency.cacheHitRate, cost: m.efficiency.totals.cost, doneSP: m.efficiency.doneSP } : {});

// { sprint } -> that sprint's events; { from, to } -> that window; {} -> since the last audit (else the last 7 days)
export function rangeEvents(floorId, { sprint, from, to } = {}, now = Date.now()) {
  if (sprint != null && sprint !== '') {
    const all = log.read(floorId, { limit: 50000 });
    const inSprint = all.filter((e) => String(e.sprint) === String(sprint));
    if (!inSprint.length) return { events: [], label: `sprint ${sprint}`, from: null, to: null, sprint: Number(sprint) };
    const a = inSprint[0].ts, b = inSprint.at(-1).ts;
    // everything in the sprint's window, plus the source document history that decides "approved before the first sprint"
    const events = all.filter((e) => (e.ts >= a && e.ts <= b) || e.type === 'doc.status');
    return { events, label: `sprint ${sprint}`, from: a, to: b, sprint: Number(sprint) };
  }
  const last = listAudits(floorId).at(-1);
  const f = from ? new Date(isNaN(from) ? from : Number(from)).toISOString() : last?.range?.to || new Date(now - 7 * 864e5).toISOString();
  const t = to ? new Date(isNaN(to) ? to : Number(to)).toISOString() : new Date(now).toISOString();
  return { events: log.read(floorId, { from: f, to: t, limit: 50000 }), label: from || to ? 'custom range' : last ? 'since the last audit' : 'last 7 days', from: f, to: t, sprint: null };
}

// info: { floorName, workflow, blueprint, team, sourceDocs }; opts: { sprint, from, to, model, review(digest, { model }) }
export async function runAudit(floorId, info = {}, { sprint, from, to, model = 'sonnet', review = runReview, now = Date.now() } = {}) {
  const r = rangeEvents(floorId, { sprint, from, to }, now);
  const m = metrics(r.events, info);
  const d = digest(r.events, m, { ...info, floorId, label: r.label });
  const audit = { v: 1, id: stamp(now), floor: floorId, createdAt: new Date(now).toISOString(), range: { label: r.label, from: r.from, to: r.to, sprint: r.sprint, events: r.events.length },
    model, cost: 0, usage: null, durationMs: 0, metrics: m, refs: d.refs, digestChars: d.text.length, summary: '', findings: [], scores: scores([]), error: null };
  if (!r.events.length) audit.error = 'No log events in this range yet.';
  else {
    try {
      const out = await review(d.text, { model });
      Object.assign(audit, { cost: r2(out.cost, 5) || 0, usage: out.usage, model: out.model || model, durationMs: out.durationMs || 0, summary: out.review.summary, findings: out.review.findings, scores: scores(out.review.findings) });
    } catch (e) { audit.error = e.message; }
  }
  fs.mkdirSync(auditDir(floorId), { recursive: true });
  writeJson(path.join(auditDir(floorId), `${audit.id}.json`), audit);
  writeText(path.join(auditDir(floorId), `${audit.id}.md`), reportMd(audit, info, d.text));
  return audit;
}

// the human-readable report next to the JSON
export function reportMd(a, info = {}, digestText = '') {
  const E = a.metrics.efficiency, P = a.metrics.process;
  const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
  return [`# Audit: ${info.floorName || a.floor} (${a.range.label})`, '',
    `${a.createdAt} · ${a.range.events} events · reviewed by ${a.model} for $${(a.cost || 0).toFixed(4)}${a.error ? ` · **${a.error}**` : ''}`, '',
    `**Scores:** process ${a.scores.process}, efficiency ${a.scores.efficiency}, quality ${a.scores.quality} (overall ${a.scores.overall}).`, '',
    `**Key numbers:** cost $${E.totals.cost}, cost per SP ${E.costPerSP == null ? '–' : `$${E.costPerSP}`}, QA first-round pass ${pct(P.qaFirstRoundPassRate)}, cache hit rate ${pct(E.cacheHitRate)}, ${P.bugs.total} bugs, ${P.questions.asked} questions to the owner.`, '',
    a.summary ? `## Summary\n${a.summary}\n` : '',
    '## Findings', ...(a.findings.length ? a.findings.map((f) => `### ${f.id} · ${f.severity} · ${f.area}: ${f.title}\n${f.recommendation}\n\nEvidence: ${f.evidence.join(', ')}${f.target ? `\n\nProposed change to ${f.target.kind} \`${f.target.id}\`: ${f.target.proposedChange.summary || ''}${f.target.proposedChange.addRules.map((x) => `\n- add rule: ${x}`).join('')}${f.target.proposedChange.setting ? `\n- set ${f.target.proposedChange.setting} = ${f.target.proposedChange.value}` : ''}` : ''}\n`) : ['None.', '']),
    '## Digest the reviewer read', '', digestText, ''].join('\n');
}
