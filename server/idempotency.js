// SPDX-License-Identifier: Apache-2.0
// One submission, one effect (1.0.3): a client sends x-idempotency-key with a submission (a reply, an answer, a task,
// an approval); the same key from the same person within a minute gets the first answer again instead of running a
// second time. While the first is still running, the duplicate waits for it. Failures are not kept: a retry after an
// error runs again.
export const TTL_MS = 60e3;
const MAX = 2000;
const seen = new Map();                         // user/key -> { at, promise }

const clean = (k) => String(k || '').trim().slice(0, 200);
// run(fn) once per (user, key) within TTL_MS -> fn's result (the first one's for a duplicate)
export async function once(user, key, fn, now = Date.now()) {
  const k = clean(key);
  if (!k) return fn();
  for (const [x, v] of seen) if (now - v.at > TTL_MS) seen.delete(x); else break;   // oldest first
  const id = `${user || 'anon'}/${k}`;
  const hit = seen.get(id);
  if (hit && now - hit.at <= TTL_MS) return hit.promise;
  const promise = Promise.resolve().then(fn);
  seen.set(id, { at: now, promise });
  if (seen.size > MAX) seen.delete(seen.keys().next().value);
  promise.catch(() => seen.delete(id));
  return promise;
}
export const _reset = () => seen.clear();
