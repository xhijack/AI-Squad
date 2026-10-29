// SPDX-License-Identifier: Apache-2.0
// The Desk's one primary action per agent state (1.2.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primaryAction, deskActionsHtml } from '../ui/desk-actions.js';

const ask = [{ id: 'a1', kind: 'question' }];
const primaries = (html) => [...html.matchAll(/class="(?:btn )?gold"[^>]*data-act="([\w-]+)"/g)].map((m) => m[1]);

test('stopped → Start; crashed with a session → Resume; running → Send task; waiting → the answer', () => {
  assert.equal(primaryAction({ running: false, state: 'stopped' }), 'start');
  assert.equal(primaryAction({ running: false, state: 'stopped', standby: true }), 'start');
  assert.equal(primaryAction({ running: false, crash: { text: 'x' }, resume: { sessionId: 'abcdef123' } }), 'resume');
  assert.equal(primaryAction({ running: false, crash: { text: 'x', withLead: true }, resume: { sessionId: 'abcdef123' } }), 'start');
  assert.equal(primaryAction({ running: true, state: 'working' }), 'send');
  assert.equal(primaryAction({ running: true, state: 'idle' }), 'send');
  assert.equal(primaryAction({ running: true, state: 'waiting' }, ask), 'answer');
  assert.equal(primaryAction(null), null);
});

test('exactly one filled button, and none when the primary lives elsewhere', () => {
  const stopped = { id: 'dodi', running: false, resume: { sessionId: 'abcdef123' } };
  assert.deepEqual(primaries(deskActionsHtml(stopped, primaryAction(stopped), { floorId: 'f' })), ['start']);
  const crashed = { ...stopped, crash: { text: 'x' } };
  assert.deepEqual(primaries(deskActionsHtml(crashed, primaryAction(crashed), { floorId: 'f' })), ['resume']);
  const running = { id: 'dodi', running: true };
  const html = deskActionsHtml(running, 'send', { floorId: 'f' });
  assert.deepEqual(primaries(html), []);                       // Send task is in the task form
  assert.match(html, /data-act="stop"/);
  assert.match(html, /class="btn ghost" href="#\/floor\/f\/desk\/dodi\/screen"/);
  assert.doesNotMatch(deskActionsHtml(running, 'send', { floorId: 'f', screen: true }), /\/screen"/);
});
