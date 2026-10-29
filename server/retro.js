// SPDX-License-Identifier: Apache-2.0
// Retro: the ritual after a sprint closes. Built from the sprint's audit (metrics and findings) and the Performance
// data, without another model call: what went well, what did not, a per-agent breakdown, the cost per story point
// trend and three concrete changes. Saved inside the audit and as retro.md next to it; the lead turns it into
// entries in LEARNINGS.md.

const pct = (v) => `${Math.round(v * 100)} %`;
const SEV = { critical: 0, high: 1, medium: 2, low: 3 };

// audit: a saved audit (metrics, findings, range.sprint); perf: floorPerformance() or null; history: earlier audits
// (the cost per story point trend comes from Performance, else from the audits of earlier sprints)
export function buildRetro(audit, perf = null, history = []) {
  const m = audit.metrics || {}, P = m.process || {}, E = m.efficiency || {};
  const sprint = audit.range?.sprint ?? null;
  const fromAudits = () => {
    const by = new Map();
    for (const a of [...history, audit]) if (a.range?.sprint != null && a.metrics?.efficiency?.costPerSP != null) by.set(String(a.range.sprint), { sprint: a.range.sprint, costPerSP: a.metrics.efficiency.costPerSP, doneSP: a.metrics.efficiency.doneSP, plannedSP: a.metrics.efficiency.plannedSP });
    return [...by.values()].sort((a, b) => Number(a.sprint) - Number(b.sprint));
  };
  const perfTrend = (perf?.sprints || []).filter((s) => s.costPerSP != null).map((s) => ({ sprint: s.sprint, costPerSP: s.costPerSP, doneSP: s.doneSP, plannedSP: s.plannedSP }));
  const trend = perfTrend.length ? perfTrend : fromAudits();
  const now = trend.find((t) => String(t.sprint) === String(sprint)), prev = now ? trend.filter((t) => Number(t.sprint) < Number(sprint)).at(-1) : null;
  const findings = [...(audit.findings || [])].sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9));
  const well = [], badly = findings.filter((x) => x.severity === 'critical' || x.severity === 'high').map((f) => f.title);   // the reviewer's worst first
  if (P.qaFirstRoundPassRate != null) (P.qaFirstRoundPassRate >= 0.8 ? well : P.qaFirstRoundPassRate < 0.6 ? badly : []).push(`QA passed ${pct(P.qaFirstRoundPassRate)} of ${P.qaReported} modules in the first round`);
  if (E.plannedSP) (E.doneSP >= E.plannedSP ? well : badly).push(`${E.doneSP} of ${E.plannedSP} story points done`);
  if (P.qaBeforeMerge?.merges) (P.qaBeforeMerge.mergesWithAllQa === P.qaBeforeMerge.merges ? well : badly).push(`${P.qaBeforeMerge.mergesWithAllQa} of ${P.qaBeforeMerge.merges} merges had QA for every module`);
  if (E.cacheHitRate != null && E.cacheHitRate >= 0.7) well.push(`cache hit rate ${pct(E.cacheHitRate)}`);
  const money = (v) => `$${+(+v).toFixed(2)}`;
  if (now && prev) (now.costPerSP <= prev.costPerSP ? well : badly).push(`cost per story point ${money(now.costPerSP)} (sprint ${prev.sprint}: ${money(prev.costPerSP)})`);
  if (P.bugs?.open) badly.push(`${P.bugs.open} bug${P.bugs.open === 1 ? '' : 's'} still open`);
  if (P.rework?.reopened) badly.push(`${P.rework.reopened} board row${P.rework.reopened === 1 ? '' : 's'} reopened`);
  if (m.debug?.loops?.length) badly.push(`debug loops: ${m.debug.loops.map((d) => `${d.issue} (${d.attempts} attempts)`).join(', ')}`);
  if (m.quality?.crashes) badly.push(`${m.quality.crashes} agent crash${m.quality.crashes === 1 ? '' : 'es'}`);
  if (E.idleWithOpenWorkMin >= 30) badly.push(`${E.idleWithOpenWorkMin} min idle while work was open`);
  if (E.blockedOnOwnerMin >= 30) badly.push(`${E.blockedOnOwnerMin} min waiting for the owner`);
  if (m.autopilot?.criticalDecided) badly.push(`${m.autopilot.criticalDecided} critical item${m.autopilot.criticalDecided === 1 ? '' : 's'} decided without the owner`);
  if (!m.quality?.crashes && !(m.debug?.loops?.length)) well.push('no crashes and no debug loops');
  // three changes: the most severe findings first, then what the numbers suggest
  const changes = findings.slice(0, 3).map((f) => ({ text: f.recommendation, finding: f.id, target: f.target ? `${f.target.kind} ${f.target.id}` : null }));
  const fallback = [
    [m.debug?.loops?.length, 'Developers stop after three failed fix attempts and escalate with the investigate record.'],
    [P.qaFirstRoundPassRate != null && P.qaFirstRoundPassRate < 0.6, 'Developers run the acceptance criteria of their module before handing it to QA.'],
    [E.idleWithOpenWorkMin >= 30, 'The lead re-assigns open work as soon as a teammate is idle.'],
    [E.blockedOnOwnerMin >= 30, 'The lead batches questions for the owner and marks a recommended option, so Autopilot can decide what is not critical.'],
    [E.plannedSP && E.doneSP < E.plannedSP, 'Plan fewer story points next sprint, or split the largest module.'],
  ];
  for (const [when, text] of fallback) if (changes.length < 3 && when) changes.push({ text, finding: null, target: null });
  const perAgent = (E.byAgent || []).map((a) => {
    const p = perf?.agents?.find((x) => x.id === a.agent);
    const s = p?.bySprint?.[String(sprint)] || null;
    return { agent: a.agent, role: a.role, cost: a.cost, turns: a.turns, toolCalls: a.toolCalls, failedTools: a.failedTools, idleWithOpenWorkMin: a.idleWithOpenWorkMin,
      sp: s?.sp ?? null, firstPassRate: s?.firstPassRate ?? null, bugsPerSP: s?.bugsPerSP ?? null };
  });
  return { sprint, createdAt: audit.createdAt, audit: audit.id, wentWell: well.slice(0, 6), wentBadly: badly.slice(0, 6), perAgent, costPerSPTrend: trend, changes: changes.slice(0, 3) };
}

export function retroMd(r, floorName = '') {
  const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (nothing)');
  return [`# Retro: ${floorName || 'squad'}, sprint ${r.sprint ?? '?'}`, '', `${r.createdAt} · from audit ${r.audit}`, '',
    '## What went well', list(r.wentWell), '', '## What did not', list(r.wentBadly), '',
    '## Three changes', r.changes.length ? r.changes.map((c, i) => `${i + 1}. ${c.text}${c.target ? ` (${c.target})` : ''}`).join('\n') : '- (none)', '',
    '## Per agent', '| Agent | Role | Cost $ | Turns | Tool calls | Failed | Idle with open work (min) | SP | QA first pass | Bugs / SP |', '|---|---|---|---|---|---|---|---|---|---|',
    ...r.perAgent.map((a) => `| ${a.agent} | ${a.role || ''} | ${a.cost} | ${a.turns} | ${a.toolCalls} | ${a.failedTools} | ${a.idleWithOpenWorkMin} | ${a.sp ?? '–'} | ${a.firstPassRate == null ? '–' : pct(a.firstPassRate)} | ${a.bugsPerSP ?? '–'} |`), '',
    '## Cost per story point', r.costPerSPTrend.length ? r.costPerSPTrend.map((t) => `- sprint ${t.sprint}: $${t.costPerSP} (${t.doneSP} of ${t.plannedSP} SP)`).join('\n') : '- no sprint with done story points yet', ''].join('\n');
}

// the task the lead gets (owner's choice in the Retro dialog): turn the Retro into LEARNINGS.md entries
export const learningsTask = (r, file) => `Retro for sprint ${r.sprint} is ready (${file}). Read it and add 1-3 short entries to docs/squad/LEARNINGS.md (date, source "retro sprint ${r.sprint}", the pattern or pitfall and what to do). Then apply the three changes where they are yours to make.`;
