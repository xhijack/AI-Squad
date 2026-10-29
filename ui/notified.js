// SPDX-License-Identifier: Apache-2.0
// One notification per Attention item across the whole browser (1.0.3): every open tab sees the same snapshot, and
// before a tab notifies (a Notification, the voice line) it claims the item in localStorage, shared by the tabs of
// this site. The first tab wins; the others only update their panels. An item is claimed by its id and by its
// content (kind, agent, text), so the same message under a new id is not announced again within the hour.
const KEY = 'aisquad.notified', TTL = 3600e3, MAX = 400;
const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
export const contentOf = (a) => `c:${hash([a.kind, a.floorId || '', a.agentId || '', String(a.text || '').trim()].join('|'))}`;

// storage: localStorage (or a stand-in in tests) -> true when this caller is the first to announce the item
export function claim(a, storage = globalThis.localStorage, now = Date.now()) {
  let seen = {};
  try { seen = JSON.parse(storage.getItem(KEY) || '{}') || {}; } catch { seen = {}; }
  for (const [k, t] of Object.entries(seen)) if (now - t > TTL) delete seen[k];
  const keys = [`i:${a.id}`, contentOf(a)];
  const first = keys.every((k) => !seen[k]);
  for (const k of keys) seen[k] = seen[k] || now;
  const list = Object.entries(seen).sort((x, y) => y[1] - x[1]).slice(0, MAX);
  try { storage.setItem(KEY, JSON.stringify(Object.fromEntries(list))); } catch { /* private mode: this tab alone */ }
  return first;
}
