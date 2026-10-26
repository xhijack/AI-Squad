// Office rituals (Phase 2.5): meetings at the meeting table, read from Squad Log events (sprint planning, plan
// review, Retro, the lead briefing a teammate, the daily standup), and the standup itself: per agent what was done
// since the last standup, what it is doing now and what blocks it. All from the Log, without a model call.

// event type -> meeting: label, how long the characters stay at the table, who joins
const MEETINGS = {
  'sprint.planned': { kind: 'planning', label: 'Sprint planning', ms: 120e3, who: 'team' },
  'plan.reviewed': { kind: 'review', label: 'Plan review', ms: 90e3, who: 'reviewers' },
  'retro.done': { kind: 'retro', label: 'Retro', ms: 120e3, who: 'team' },
  'standup.held': { kind: 'standup', label: 'Standup', ms: 90e3, who: 'team' },
  'task.delegated': { kind: 'briefing', label: 'Briefing', ms: 45e3, who: 'pair' },
};
const REVIEWERS = /designer|security|qa/;

// ev: a logged event; team: [{ id, lead, template }] -> { kind, label, agents, since, until } or null
export function meetingFrom(ev, team, now = Date.now()) {
  const m = MEETINGS[ev?.type];
  if (!m || !team.length) return null;
  const lead = team.find((a) => a.lead) || team[0];
  let agents;
  if (m.who === 'team') agents = team.map((a) => a.id);
  else if (m.who === 'reviewers') agents = [lead.id, ...team.filter((a) => a !== lead && REVIEWERS.test(a.template || '')).map((a) => a.id)];
  else {
    // a briefing: the lead hands a task to a teammate it spawns (Agent tool); other delegations are not meetings
    const to = team.find((a) => a.id === ev.data?.to);
    if (ev.agent !== lead.id || !to || to === lead) return null;
    agents = [lead.id, to.id];
  }
  if (agents.length < 2) return null;
  const ts = typeof ev.ts === 'number' ? ev.ts : Date.parse(ev.ts) || now;
  return { kind: m.kind, label: m.label, agents: [...new Set(agents)].slice(0, 6), since: ts, until: ts + m.ms };
}
export const active = (meeting, now = Date.now()) => (meeting && meeting.until > now ? meeting : null);

// floor.json "standup": { time: "HH:MM" (local), meeting: true }
export function cleanStandup(s = {}) {
  const t = String(s?.time || '').match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return { time: t ? `${t[1].padStart(2, '0')}:${t[2]}` : '09:30', meeting: s?.meeting !== false };
}
// the standup is due when today's time has passed and none was held today
export function standupDue(setting, lastHeld, now = Date.now()) {
  const [h, m] = cleanStandup(setting).time.split(':').map(Number);
  const at = new Date(now); at.setHours(h, m, 0, 0);
  return now >= at.getTime() && (!lastHeld || lastHeld < at.getTime());
}

const ms = (ts) => (typeof ts === 'number' ? ts : Date.parse(ts) || 0);
const oneLine = (s, n = 90) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
// events: the Log since the last standup; team: [{ id, displayName }]; live: { [agentId]: { state, activity } }
// -> { since, until, agents: [{ id, name, done, doing, blocked }], quiet: true when nothing happened }
export function standup(events, team, { since = 0, now = Date.now(), live = {} } = {}) {
  const per = new Map(team.map((a) => [a.id, { id: a.id, name: String(a.displayName || a.id).split(' - ')[0], done: [], doing: [], blocked: [] }]));
  const add = (id, list, text) => { const p = per.get(id); if (p && text && !p[list].includes(text)) p[list].push(text); };
  const inProgress = new Map(), openBugs = new Map(), asked = new Map();
  for (const e of [...events].sort((a, b) => ms(a.ts) - ms(b.ts))) {
    if (ms(e.ts) < since) continue;
    const d = e.data || {};
    switch (e.type) {
      case 'commit': add(e.agent, 'done', `commit: ${oneLine(d.subject, 70)}`); break;
      case 'handoff.written': add(e.agent || d.owner, 'done', `handoff ${d.module}`); break;
      case 'qa.report': if (d.status === 'PASS') add(e.agent, 'done', `QA ${d.module} passed`); else add(e.agent, 'done', `QA ${d.module} round ${d.round}: ${d.status}`); break;
      case 'board.changed':
        if (d.to === 'DONE') { add(d.owner || e.agent, 'done', d.task); inProgress.delete(d.task); }
        else if (d.to === 'IN_PROGRESS' || d.to === 'REVIEW') inProgress.set(d.task, d.owner || e.agent);
        else if (d.to === 'BLOCKED') add(d.owner || e.agent, 'blocked', `${d.task} is blocked`);
        else inProgress.delete(d.task);
        break;
      case 'bug.opened': openBugs.set(d.bug, d.owner || e.agent); break;
      case 'bug.closed': openBugs.delete(d.bug); add(d.owner || e.agent, 'done', `bug ${d.bug} ${String(d.status || '').toLowerCase()}`); break;
      case 'debug.escalated': add(e.agent, 'blocked', `escalated ${d.issue} after ${d.attempts} attempts`); break;
      case 'question.asked': asked.set(d.n ?? e.id, e.agent); break;
      case 'question.answered': asked.delete(d.n ?? e.id); break;
      case 'report.delivered': add(e.agent, 'done', `reported: ${oneLine(d.text, 70) || 'a report'}`); break;
      default:
    }
  }
  for (const [task, owner] of inProgress) add(owner, 'doing', task);
  for (const [bug, owner] of openBugs) add(owner, 'blocked', `open bug ${bug}`);
  for (const [, who] of asked) add(who, 'blocked', 'waiting for an answer from the owner');
  for (const [id, l] of Object.entries(live)) {
    if (l?.state === 'working' && l.activity) add(id, 'doing', `now: ${oneLine(l.activity, 70)}`);
    if (l?.state === 'waiting') add(id, 'blocked', 'waiting for you');
  }
  const agents = [...per.values()];
  return { since, until: now, agents, quiet: agents.every((a) => !a.done.length && !a.doing.length && !a.blocked.length) };
}

export function standupMd(s, floorName = '') {
  const day = new Date(s.until).toISOString().slice(0, 10);
  const items = (xs) => (xs.length ? xs.map((x) => `  - ${x}`).join('\n') : '  - (nothing)');
  return [`# Standup: ${floorName || 'squad'}, ${day}`, '', ...s.agents.flatMap((a) => [`## ${a.name}`, '- Done:', items(a.done), '- Doing:', items(a.doing), '- Blocked by:', items(a.blocked), ''])].join('\n');
}
