// SPDX-License-Identifier: Apache-2.0
// The Floor's activity feed (1.2.0): consecutive events of one agent grouped under its name, the time on the left
// in tabular figures, plain words instead of raw tool text, the message text for "says" (empty ones hidden), and a
// row expands on click instead of being cut off.
import { t as tt, tx } from './i18n.js';
import { esc } from './lib.js';
import { plainActivity } from './status.js';

// rows the owner opened (kept across panel updates)
export const feedOpen = new Set();
export const feedKey = (e) => `${e.ts}:${e.agentId || e.agentName}:${e.tool || e.title}`;
const firstLine = (s) => String(s || '').split('\n').map((x) => x.trim()).find(Boolean) || '';

// one row: what happened in plain words, and a secondary text when it adds something
export function feedItem(e) {
  if (e.title === 'says') {
    const text = firstLine(e.detail);
    return text ? { key: feedKey(e), ts: e.ts, kind: 'say', text, more: String(e.detail).trim() } : null;
  }
  const text = plainActivity(e.title, { past: true }) || tx(e.title);
  const detail = firstLine(e.detail).replace(/^to [^:]{1,60}:\s*/, ''), raw = String(e.title || '');   // a message: its text, not "to x:"
  const extra = detail && !raw.includes(detail) && !detail.endsWith(text.split(' ').pop()) ? detail : '';
  return { key: feedKey(e), ts: e.ts, kind: e.kind, text, extra, more: [raw, String(e.detail || '').trim()].filter(Boolean).join('\n') };
}

// newest first, as the server sends it; consecutive events of one agent in one group
export function groupFeed(feed) {
  const groups = [];
  for (const e of feed) {
    const item = feedItem(e);
    if (!item) continue;
    const id = e.agentId || e.agentName, last = groups.at(-1);
    if (last && last.agentId === id) last.items.push(item);
    else groups.push({ agentId: id, agentName: String(e.agentName || id).split(' - ')[0], items: [item] });
  }
  return groups;
}

const hm = (ts) => new Date(ts).toTimeString().slice(0, 5);
export function feedHtml(feed, expanded = feedOpen) {
  const groups = groupFeed(feed || []);
  if (!groups.length) return `<div class="empty">${tt('No activity yet. Start an agent and give it a task.')}</div>`;
  return `<div class="feedGroups">${groups.map((g) => `<section class="fgroup"><h4 class="fwho">${esc(g.agentName)}</h4><ul class="feed">${g.items.map((x) => {
    const open = expanded.has(x.key);
    return `<li class="frow2${open ? ' open' : ''}"><button type="button" class="fbtn" data-act="feed-toggle" data-key="${esc(x.key)}" aria-expanded="${open}">
      <span class="t">${hm(x.ts)}</span><span class="k ${esc(x.kind)}" aria-hidden="true"></span><span class="grow"><span class="ftext">${esc(x.text)}</span>${x.extra ? ` <span class="d">${esc(x.extra)}</span>` : ''}</span></button>
      ${open && x.more ? `<pre class="fmore">${esc(x.more)}</pre>` : ''}</li>`;
  }).join('')}</ul></section>`).join('')}</div>`;
}
