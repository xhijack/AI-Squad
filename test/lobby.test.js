// SPDX-License-Identifier: Apache-2.0
// Lobby (1.2.0): Set up Squad is compact once a Floor exists; the Today card sums up asks, cost and running agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lobbySections, todaySummary } from '../ui/views.js';

const floor = (id, extra = {}) => ({ id, name: id, number: 2, accent: '#3d82d6', lamp: 'quiet', counts: {}, cost: { today: 0 }, agents: [], ...extra });
const building = (floors, attention = []) => ({ floors, attention, detected: [], costToday: 1.25 });
const indep = floor('independents', { independent: true, number: 1 });

test('Set up Squad: the big card without Floors, a compact button once one exists', () => {
  const empty = lobbySections(building([indep])).find((s) => s.id === 'floors').html;
  assert.match(empty, /class="setupBtn"/);
  const one = lobbySections(building([indep, floor('shop')])).find((s) => s.id === 'floors').html;
  assert.doesNotMatch(one, /class="setupBtn"/);
  assert.match(one, /class="setupMini"/);
});

test('Today: asks without notices, cost today, running and working agents', () => {
  const b = building([indep, floor('shop', { agents: [
    { id: 'rina', displayName: 'Rina - PM', state: 'working', running: true, activity: 'editing a.md' },
    { id: 'budi', displayName: 'Budi - Dev', state: 'waiting', running: true },
    { id: 'sari', displayName: 'Sari - QA', state: 'stopped', running: false },
  ] })], [{ id: 'x', kind: 'question', agentName: 'Budi - Dev', floorId: 'shop', agentId: 'budi', ts: Date.now() }, { id: 'y', kind: 'stall', notice: true, ts: Date.now() }, { id: 'z', kind: 'stall', muted: true, ts: Date.now() }]);
  const s = todaySummary(b);
  assert.deepEqual([s.asks.map((a) => a.id), s.cost, s.running, s.total, s.working.map((a) => a.id)], [['x'], 1.25, 2, 3, ['rina', 'budi']]);
  const html = lobbySections(b).find((x) => x.id === 'today').html;
  assert.match(html, /<b>1<\/b><span>needs you<\/span>/);
  assert.match(html, /\$1\.25/);
  assert.match(html, /href="#\/floor\/shop\/desk\/budi"/);
  assert.match(html, /Editing a\.md · shop/);
});
