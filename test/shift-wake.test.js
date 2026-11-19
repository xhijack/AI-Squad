import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftWakeDue, shiftWake, SHIFT_WAKE } from '../server/autopilot.js';
import { parseTasks } from '../server/sprint.js';

test('a Blueprint board with a Piece or Item column is read as tasks', () => {
  const seo = '| Piece | Owner | Target | Status |\n|---|---|---|---|\n| K1 | kw | clicks | REVIEW (branch) |\n| K2 | kw | clicks | TODO |\n| G1 | geo | cites | MEASURED (handoff) |\n';
  assert.deepEqual(parseTasks(seo).map((t) => [t.task, t.column]), [['K1', 'REVIEW'], ['K2', 'TODO'], ['G1', 'DONE']]);
  const product = '| Item | Owner | Status | PRD |\n|---|---|---|---|\n| Search | pm | DRAFT | x |\n';
  assert.equal(parseTasks(product)[0].column, 'IN_PROGRESS');
});

test('the stopped lead is woken inside an enabled shift with actionable work, at most every few hours', () => {
  const st = {}, t0 = Date.UTC(2026, 10, 19, 15);
  const base = { shiftOn: true, inShift: true, leadRunning: false, actionable: 3 };
  assert.equal(shiftWakeDue({ ...base, shiftOn: false }, {}, t0), false);
  assert.equal(shiftWakeDue({ ...base, inShift: false }, {}, t0), false);
  assert.equal(shiftWakeDue({ ...base, leadRunning: true }, {}, t0), false);
  assert.equal(shiftWakeDue({ ...base, actionable: 0 }, {}, t0), false);
  assert.equal(shiftWakeDue(base, st, t0), true);
  assert.equal(shiftWakeDue(base, st, t0 + 60e3), false);
  assert.equal(shiftWakeDue(base, st, t0 + SHIFT_WAKE.everyMs), true);
  assert.match(shiftWake(3), /3 pieces/);
});
