// Lead shout timing (ui/shout.js is plain JS without DOM access at import time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shoutStep, floorIdle, MAX_SHOUTS } from '../ui/shout.js';

test('first shout after 20 s of team idle, then every 2 to 3 minutes, at most 6 per idle period', () => {
  const s = {};
  assert.equal(shoutStep(s, true, 0), null);
  assert.equal(shoutStep(s, true, 19e3), null);
  assert.match(shoutStep(s, true, 20e3, () => 0), /^Boss!/);
  assert.equal(shoutStep(s, true, 100e3), null, 'not again within 2 minutes');
  let n = 1;
  for (let t = 140e3; t < 3600e3; t += 1e3) if (shoutStep(s, true, t, () => .5)) n++;
  assert.equal(n, MAX_SHOUTS);
  assert.equal(shoutStep(s, false, 3601e3), null, 'work resets the idle period');
  assert.equal(shoutStep(s, true, 3602e3), null);
  assert.ok(shoutStep(s, true, 3622e3));
});

test('idle means the lead runs and nobody works or waits', () => {
  const lead = { id: 'pm', lead: true, running: true, state: 'idle' };
  assert.deepEqual(floorIdle({ agents: [lead, { id: 'd', state: 'stopped' }] }), { idle: true, lead });
  assert.equal(floorIdle({ agents: [lead, { id: 'd', state: 'working' }] }).idle, false);
  assert.equal(floorIdle({ agents: [{ ...lead, running: false, state: 'stopped' }] }).idle, false);
  assert.equal(floorIdle({ agents: [{ id: 'x', state: 'idle', running: true }] }).lead, null, 'no lead, no shout');
});
