import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rituals from '../server/rituals.js';

const TEAM = [{ id: 'rina-pm', lead: true, template: 'project-manager', displayName: 'Rina - PM' }, { id: 'budi-dev', template: 'fullstack-developer', displayName: 'Budi - Dev' },
  { id: 'dewi-design', template: 'ui-ux-designer', displayName: 'Dewi - Design' }, { id: 'quinn-qa', template: 'qa-engineer', displayName: 'Quinn - QA' }];
const T = Date.parse('2026-10-27T02:00:00Z');

test('meetings from Log events: who joins and for how long', () => {
  assert.deepEqual(rituals.meetingFrom({ type: 'sprint.planned', ts: T }, TEAM), { kind: 'planning', label: 'Sprint planning', agents: ['rina-pm', 'budi-dev', 'dewi-design', 'quinn-qa'], since: T, until: T + 120e3 });
  assert.deepEqual(rituals.meetingFrom({ type: 'plan.reviewed', ts: T }, TEAM).agents, ['rina-pm', 'dewi-design', 'quinn-qa'], 'the reviewers');
  assert.deepEqual(rituals.meetingFrom({ type: 'task.delegated', agent: 'rina-pm', ts: T, data: { to: 'budi-dev' } }, TEAM).agents, ['rina-pm', 'budi-dev'], 'a briefing');
  assert.equal(rituals.meetingFrom({ type: 'task.delegated', agent: 'budi-dev', ts: T, data: { to: 'Explore' } }, TEAM), null, 'not the lead briefing a teammate');
  assert.equal(rituals.meetingFrom({ type: 'commit', ts: T }, TEAM), null);
  assert.equal(rituals.meetingFrom({ type: 'retro.done', ts: T }, [TEAM[0]]), null, 'a meeting needs two');
  assert.ok(rituals.active({ until: T + 1 }, T)); assert.equal(rituals.active({ until: T }, T), null);
});

test('the standup is due once a day after its time', () => {
  const day = new Date(2026, 9, 27, 9, 0).getTime();
  assert.equal(rituals.standupDue({ time: '09:30' }, 0, day), false, 'not yet');
  assert.equal(rituals.standupDue({ time: '09:30' }, 0, day + 40 * 60e3), true);
  assert.equal(rituals.standupDue({ time: '09:30' }, day + 35 * 60e3, day + 60 * 60e3), false, 'held today');
  assert.equal(rituals.standupDue({}, day - 864e5, day + 60 * 60e3), true, 'yesterday does not count');
  assert.deepEqual(rituals.cleanStandup({ time: '7:05', meeting: false }), { time: '07:05', meeting: false });
  assert.deepEqual(rituals.cleanStandup({ time: '25:00' }), { time: '09:30', meeting: true });
});

test('standup per agent: done, doing, blocked by, from the Log and the live state', () => {
  const ev = [
    { type: 'commit', ts: T + 1, agent: 'budi-dev', data: { subject: 'feat(cart): totals' } },
    { type: 'board.changed', ts: T + 2, data: { task: 'BUILD M01 Cart', owner: 'budi-dev', to: 'DONE' } },
    { type: 'board.changed', ts: T + 3, data: { task: 'BUILD M02 RSVP', owner: 'budi-dev', to: 'IN_PROGRESS' } },
    { type: 'qa.report', ts: T + 4, agent: 'quinn-qa', data: { module: 'M01', round: 1, status: 'PASS' } },
    { type: 'bug.opened', ts: T + 5, data: { bug: 'M02-B01', owner: 'budi-dev' } },
    { type: 'debug.escalated', ts: T + 6, agent: 'dewi-design', data: { issue: 'font-load', attempts: 3 } },
    { type: 'question.asked', ts: T + 7, agent: 'rina-pm', data: { n: 4 } },
    { type: 'commit', ts: T - 864e5, agent: 'budi-dev', data: { subject: 'older than the last standup' } },
  ];
  const s = rituals.standup(ev, TEAM, { since: T, now: T + 10, live: { 'rina-pm': { state: 'working', activity: 'planning tasks' } } });
  const by = Object.fromEntries(s.agents.map((a) => [a.id, a]));
  assert.deepEqual(by['budi-dev'], { id: 'budi-dev', name: 'Budi', done: ['commit: feat(cart): totals', 'BUILD M01 Cart'], doing: ['BUILD M02 RSVP'], blocked: ['open bug M02-B01'] });
  assert.deepEqual(by['quinn-qa'].done, ['QA M01 passed']);
  assert.deepEqual(by['dewi-design'].blocked, ['escalated font-load after 3 attempts']);
  assert.deepEqual(by['rina-pm'], { id: 'rina-pm', name: 'Rina', done: [], doing: ['now: planning tasks'], blocked: ['waiting for an answer from the owner'] });
  assert.equal(s.quiet, false);
  assert.equal(rituals.standup([], TEAM, { since: T, now: T + 1 }).quiet, true);
  assert.match(rituals.standupMd(s, 'Shop'), /^# Standup: Shop, 2026-10-27\n\n## Rina\n- Done:\n  - \(nothing\)\n- Doing:\n  - now: planning tasks/);
});
