// SPDX-License-Identifier: Apache-2.0
// The dock (1.2.0): groups with separators, labels and aria-labels, five slots on a phone and the rest in More.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockLayout, dockHtml, moreHtml, worstLevel } from '../ui/dock.js';

const floorItems = [
  { id: 'board', group: 'view', prio: 1, act: 'board', icon: 'board', label: 'Board', tip: 'Board' },
  { id: 'performance', group: 'view', prio: 7, act: 'performance', icon: 'chart', label: 'Stats', tip: 'Performance' },
  { id: 'log', group: 'view', prio: 2, act: 'log', icon: 'log', label: 'Log', tip: 'Squad Log' },
  { id: 'audit', group: 'view', prio: 8, act: 'audit', icon: 'audit', label: 'Audit', tip: 'Audit' },
  { id: 'add-agent', group: 'team', prio: 3, act: 'add-agent', icon: 'user-plus', label: 'Add agent', tip: 'Add agent' },
  { id: 'voice', group: 'team', prio: 6, act: 'voice', icon: 'mute', label: 'Voice', tip: 'Lead voice: off' },
  { id: 'cost', group: 'system', prio: 4, act: 'cost', icon: 'coin', label: '$0.00', tip: 'Cost', value: true },
  { id: 'meter', group: 'system', prio: 5, act: 'meter', icon: 'server', label: 'RAM 84%', tip: 'Server meter', level: 'warn', value: true },
  { id: 'legend', group: 'system', prio: 9, pop: 'legendPop', icon: 'info', label: 'Help', tip: 'Legend and controls' },
];

test('desktop: every item, grouped View · Team · System, separators between groups', () => {
  const l = dockLayout(floorItems);
  assert.deepEqual(l.groups.map((g) => g.map((x) => x.id)), [['board', 'performance', 'log', 'audit'], ['add-agent', 'voice'], ['cost', 'meter', 'legend']]);
  assert.deepEqual(l.more, []);
  const html = dockHtml(l);
  assert.equal(html.match(/class="dsep"/g).length, 2);
  assert.equal(html.match(/<button/g).length, 9);
  assert.equal(html.match(/aria-label="/g).length, 9);
  assert.equal(html.match(/data-tip="/g).length, 9);
  assert.match(html, /<span class="lbl">Add agent<\/span>/);
});

test('phone: four most used and More; the rest in the More sheet; More carries the worst dot', () => {
  const l = dockLayout(floorItems, { phone: true });
  assert.deepEqual(l.groups.flat().map((x) => x.id), ['board', 'log', 'add-agent', 'cost']);
  assert.deepEqual(l.more.map((x) => x.id), ['performance', 'audit', 'voice', 'meter', 'legend']);
  const html = dockHtml(l);
  assert.equal(html.match(/<button/g).length, 5);
  assert.match(html, /data-pop="morePop"[^>]*>.*<i class="sdot warn">/);
  assert.equal(worstLevel(l.more), 'warn');
  const sheet = moreHtml(l.more);
  assert.equal(sheet.match(/role="menuitem"/g).length, 5);
  assert.match(sheet, /data-pop="legendPop"/);
});

test('phone: the overview switch always stays; few items need no More', () => {
  const lobby = [{ id: 'setup', group: 'view', prio: 1, act: 'setup-squad', icon: 'spark', label: 'Set up', tip: 'Set up Squad' }, { id: 'ov', group: 'view', prio: 9, html: '<span class="ovSeg"></span>' },
    ...floorItems.filter((x) => ['cost', 'meter', 'voice', 'legend'].includes(x.id))];
  const l = dockLayout(lobby, { phone: true });
  assert.deepEqual(l.groups.flat().map((x) => x.id), ['setup', 'ov', 'cost', 'meter']);
  assert.deepEqual(l.more.map((x) => x.id), ['voice', 'legend']);
  assert.deepEqual(dockLayout(floorItems.slice(0, 5), { phone: true }).more, []);
});
