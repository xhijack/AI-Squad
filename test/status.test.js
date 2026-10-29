// SPDX-License-Identifier: Apache-2.0
// Agent status (1.2.0): one state per agent with a label and an icon; the last activity in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusOf, statusPill, plainActivity, activityLine } from '../ui/status.js';

test('state: not started and crashed first, then waiting, then the runtime state', () => {
  assert.equal(statusOf({ state: 'stopped', standby: 'sprint' }), 'standby');
  assert.equal(statusOf({ state: 'stopped', crash: { text: 'x' } }), 'crashed');
  assert.equal(statusOf({ state: 'stopped', crash: { text: 'x', withLead: 'pm' } }), 'stopped');
  assert.equal(statusOf({ state: 'idle', waitingReply: true }), 'waiting');
  assert.equal(statusOf({ state: 'waiting' }), 'waiting');
  assert.equal(statusOf({ state: 'working' }), 'working');
  assert.equal(statusOf({ state: 'idle' }), 'idle');
  assert.equal(statusOf({ state: 'odd' }), 'stopped');
});

test('pill: icon and text in the state class, never colour alone', () => {
  for (const [a, k, label] of [[{ state: 'working' }, 'working', 'working'], [{ state: 'waiting' }, 'waiting', 'needs you'], [{ state: 'idle' }, 'idle', 'idle'],
    [{ state: 'stopped' }, 'stopped', 'stopped'], [{ crash: { text: 'x' } }, 'crashed', 'crashed'], [{ standby: 'docs' }, 'standby', 'not started']]) {
    const html = statusPill(a);
    assert.match(html, new RegExp(`^<span class="st ${k}"><svg class="sti" aria-hidden="true"><use href="#i-st-${k}"/></svg>${label}</span>$`));
  }
});

test('activity in plain words, present while working and past otherwise', () => {
  assert.equal(plainActivity('running tests: npm test -- catalogue'), 'Running the tests');
  assert.equal(plainActivity('running tests: npm test', { past: true }), 'Ran the tests');
  assert.equal(plainActivity('editing src/catalogue.css', { past: true }), 'Edited catalogue.css');
  assert.equal(plainActivity('thinking: Kartu tamu harus bisa dicetak dari halaman detail dan …'), 'Thinking');
  assert.equal(plainActivity('terminal: Install dependencies', { past: true }), 'Install dependencies');
  assert.equal(plainActivity('terminal: rm -rf node_modules && npm ci', { past: true }), 'Ran a command');
  assert.equal(plainActivity('git: git commit -m "x"', { past: true }), 'Committed');
  assert.equal(plainActivity('messaging rina-project-manager'), 'Messaging rina');
  assert.equal(plainActivity(''), '');
  assert.equal(plainActivity('something new'), 'Something new');
});

test('row line: the last meaningful activity with a relative time; full text for the tooltip', () => {
  const nine = Date.now() - 9 * 3600e3;
  assert.deepEqual(activityLine({ state: 'stopped', activity: 'running tests: npm test', lastTs: nine }), { text: 'Ran the tests · 9 h ago', full: 'running tests: npm test' });
  assert.equal(activityLine({ state: 'working', activity: 'editing src/a.js', lastTs: Date.now() }).text, 'Editing a.js');
  const teammate = activityLine({ state: 'stopped', stopNote: 'not running · last: thinking: Kartu …', lastTs: nine });
  assert.equal(teammate.text, 'Not running · Thought it through · 9 h ago');
  assert.match(teammate.full, /thinking: Kartu/);
  assert.equal(activityLine({ state: 'stopped', standby: 'sprint', activity: 'not started: the lead starts them when the sprint begins' }).text, 'Not started: the lead starts them when the sprint begins');
  assert.equal(activityLine({ state: 'stopped', crash: { text: 'out of memory at 10:02' } }).text, 'Out of memory at 10:02');
  assert.equal(activityLine({ state: 'idle' }).text, 'Idle');
});
