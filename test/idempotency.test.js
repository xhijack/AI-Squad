// SPDX-License-Identifier: Apache-2.0
// One submission, one effect (1.0.3): server/idempotency.js, and the browser's one-notification claim (ui/notified.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as idem from '../server/idempotency.js';
import { claim } from '../ui/notified.js';
import { episodeId } from '../server/squad.js';

test('the same key runs once within a minute, per person; errors are not kept', async () => {
  idem._reset();
  let n = 0;
  const fn = async () => { n++; await new Promise((r) => setTimeout(r, 20)); return { n }; };
  const [a, b] = await Promise.all([idem.once('owner', 'k', fn, 1000), idem.once('owner', 'k', fn, 1001)]);
  assert.deepEqual([a, b, n], [{ n: 1 }, { n: 1 }, 1], 'the duplicate waits for the first');
  assert.deepEqual(await idem.once('dewi', 'k', fn, 1002), { n: 2 }, 'another person, another submission');
  assert.deepEqual(await idem.once('owner', 'k', fn, 1000 + idem.TTL_MS + 1), { n: 3 }, 'after a minute it runs again');
  assert.deepEqual(await idem.once('owner', '', fn), { n: 4 }, 'no key: always runs');
  await assert.rejects(idem.once('owner', 'e', async () => { throw new Error('boom'); }, 5000));
  assert.equal(await idem.once('owner', 'e', async () => 'ok', 5001), 'ok');
});

test('one notification per item across tabs: claimed by id and by content', () => {
  const store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const item = { id: 'q1', kind: 'question', floorId: 'f', agentId: 'a', text: 'Which database?' };
  assert.equal(claim(item, storage, 1000), true, 'the first tab');
  for (let i = 0; i < 20; i++) assert.equal(claim(item, storage, 1000 + i * 3000), false, 'every later snapshot, every other tab');
  assert.equal(claim({ ...item, id: 'q1-new-id' }, storage, 70e3), false, 'the same message under a new id');
  assert.equal(claim({ ...item, id: 'q2', text: 'Which cache?' }, storage, 71e3), true, 'a new question');
  assert.equal(claim(item, storage, 1000 + 3601e3), true, 'an hour later it may be said again');
  const broken = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } };
  assert.equal(claim(item, broken), true, 'no storage: this tab alone');
});

test('a dialog seen on the screen first and by its hook seconds later keeps its first id', () => {
  const S = episodeId('f', 'x', 'screen-1', 'screen', 1000);
  assert.equal(S, 'screen-1');
  assert.equal(episodeId('f', 'x', 'hook-1', 'hook', 4000), 'screen-1', 'the hook arrives: same item');
  assert.equal(episodeId('f', 'x', 'hook-1', 'hook', 90000), 'screen-1', 'and stays the same while it is open');
  assert.equal(episodeId('f', 'x', 'screen-2', 'screen', 95000), 'screen-2', 'another dialog');
  assert.equal(episodeId('f', 'y', 'hook-9', 'hook', 95000), 'hook-9', 'another agent');
  assert.equal(episodeId('f', 'x', 'hook-3', 'hook', 200000), 'hook-3', 'long after: a new dialog');
});
