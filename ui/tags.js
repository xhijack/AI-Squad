// SPDX-License-Identifier: Apache-2.0
// Name tags in screen space (1.2.0): tags that overlap are nudged upward (never down over a face) and, when there
// is no room, the farther one fades. The selected agent's tag is placed first and stays on top.
//   tags: [{ id, x, y, w, h, depth, selected? }]   x, y = top left in px; depth = distance to the camera
//   → Map id → { dy (px, ≤ 0), fade (bool) }
import { statusOf, statusIcon, statusLabel } from './status.js';

export const GAP = 2, MAX_STEPS = 3;

const hit = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

export function spreadTags(tags) {
  const order = [...tags].sort((a, b) => (b.selected ? 1 : 0) - (a.selected ? 1 : 0) || a.depth - b.depth);
  const placed = [], out = new Map();
  for (const t of order) {
    let dy = 0, box = { ...t };
    for (let step = 0; step <= MAX_STEPS; step++) {
      const other = placed.find((p) => hit(box, p));
      if (!other) break;
      if (step === MAX_STEPS) { box = null; break; }
      dy = other.y - GAP - t.h - t.y;                    // just above the tag in the way
      box = { ...t, y: t.y + dy };
    }
    if (!box) { out.set(t.id, { dy: 0, fade: true }); continue; }
    placed.push(box);
    out.set(t.id, { dy: Math.round(dy), fade: false });
  }
  return out;
}

// ---------- DOM: the tag's state dot, and the spread applied to label elements ----------

export const TAG_HTML = '<span class="q" aria-hidden="true">?</span><span class="n"><i class="sd"></i><span class="nm"></span></span><div class="a"></div>';
// the state in the tag itself: an icon in a dot (never colour alone), named for screen readers
export function setTagState(el, a) {
  const k = statusOf(a), sd = el.querySelector('.sd');
  if (sd && sd.dataset.k !== k) { sd.dataset.k = k; sd.className = `sd ${k}`; sd.innerHTML = statusIcon(k); sd.setAttribute('aria-label', statusLabel(k)); }
  return k;
}
// entries: [{ id, el, depth, selected }] of visible tags; nudges them with the CSS translate property, which adds
// to the transform the renderer sets
export function applySpread(entries) {
  const tags = [];
  for (const e of entries) {
    const r = e.el.getBoundingClientRect();
    if (!r.width) continue;
    const dy = +e.el.dataset.dy || 0;
    tags.push({ id: e.id, x: r.left, y: r.top - dy, w: r.width, h: r.height, depth: e.depth, selected: !!e.selected, el: e.el });
  }
  const out = spreadTags(tags);
  for (const t of tags) {
    const o = out.get(t.id);
    if (+t.el.dataset.dy !== o.dy) { t.el.dataset.dy = o.dy; t.el.style.translate = o.dy ? `0 ${o.dy}px` : ''; }
    t.el.classList.toggle('faded', o.fade);
    t.el.classList.toggle('sel', t.selected);
  }
  return out;
}
