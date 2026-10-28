// SPDX-License-Identifier: Apache-2.0
// The dock (1.2.0): labelled buttons in groups (View · Team · System) with separators; a tooltip and an aria-label
// on every button. On a phone the most used stay (four and More) and the rest go to the More sheet.
import { t as tt } from './i18n.js';

export const GROUPS = ['view', 'team', 'system'];
export const PHONE_SLOTS = 5;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

// items in display order: { id, group, prio (1 = most used), act | pop, icon, label, tip, level?, html? }
// → { groups: [[item…]…], more: [item…] }; items with html (the overview switch) are never moved
export function dockLayout(items, { phone = false } = {}) {
  let shown = items, more = [];
  if (phone && items.length > PHONE_SLOTS) {
    const fixed = items.filter((x) => x.html), room = PHONE_SLOTS - 1 - fixed.length;
    const keep = new Set([...fixed, ...items.filter((x) => !x.html).sort((a, b) => a.prio - b.prio).slice(0, Math.max(0, room))].map((x) => x.id));
    shown = items.filter((x) => keep.has(x.id));
    more = items.filter((x) => !keep.has(x.id));
  }
  const groups = GROUPS.map((g) => shown.filter((x) => x.group === g)).filter((g) => g.length);
  return { groups, more };
}

// the worst level among items, for the More button's dot (a RAM warning stays visible)
const RANK = { ok: 0, warn: 1, bad: 2 };
export const worstLevel = (items) => items.reduce((w, x) => (RANK[x.level] > RANK[w] ? x.level : w), 'ok');

const attrs = (x) => `${x.act ? `data-act="${esc(x.act)}"` : `data-pop="${esc(x.pop)}" aria-haspopup="true" aria-expanded="false"`}${x.v ? ` data-v="${esc(x.v)}"` : ''}${x.pressed != null ? ` aria-pressed="${x.pressed}"` : ''}`;
function button(x) {
  if (x.html) return x.html;
  return `<button class="dk${x.level && x.level !== 'ok' ? ` ${x.level}` : ''}" ${attrs(x)} data-tip="${esc(x.tip)}" aria-label="${esc(x.aria || x.tip)}">${icon(x.icon)}${x.level ? `<i class="sdot ${x.level}"></i>` : ''}<span class="lbl${x.value ? ' val' : ''}">${esc(x.label)}</span></button>`;
}

export function dockHtml({ groups, more }) {
  const parts = groups.map((g) => g.map(button).join(''));
  if (more.length) {
    const level = worstLevel(more);
    parts[parts.length - 1] = (parts[parts.length - 1] || '') + `<button class="dk" data-pop="morePop" aria-haspopup="true" aria-expanded="false" data-tip="${tt('More')}" aria-label="${tt('More: {items}', { items: esc(more.map((x) => x.label).join(', ')) })}">${icon('more')}${level !== 'ok' ? `<i class="sdot ${level}"></i>` : ''}<span class="lbl">${tt('More')}</span></button>`;
  }
  return parts.join('<span class="dsep" aria-hidden="true"></span>');
}

// the More sheet: one row per item, icon, label and what it does
export function moreHtml(more) {
  return `<div class="moreList" role="menu">${more.map((x) => `<button role="menuitem" class="moreRow" ${attrs(x)}>${icon(x.icon)}<span class="grow"><b>${esc(x.label)}</b><small>${esc(x.tip)}</small></span>${x.level && x.level !== 'ok' ? `<i class="dot ${x.level === 'bad' ? 'waiting' : 'idle'}"></i>` : ''}</button>`).join('')}</div>`;
}
