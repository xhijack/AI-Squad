// SPDX-License-Identifier: Apache-2.0
// Panel updates without stealing the owner's typing or clicks (1.0.3). Snapshots arrive every few seconds and the
// panels are rebuilt from HTML; a rebuild must never replace
//   - a text field that has focus (the update waits until it loses focus),
//   - the element under a pressed pointer (the update waits until the click is over), nor
//   - a kept node (the Desk's task form in a [data-slot]): it is moved into the new HTML with its focus, caret and
//     selection as they were.
// Updates that had to wait are applied once the field loses focus or the pointer is released.
const TEXT = /^(INPUT|TEXTAREA|SELECT)$/;
const isText = (el) => !!el && (TEXT.test(el.tagName) || el.isContentEditable);

// fillSlots(el): puts the kept nodes back into the new HTML; after(el, state): scroll positions etc.
export function makePatcher({ doc = document, fillSlots = () => {}, before = () => null, after = () => {} } = {}) {
  const waiting = new Map();
  let pressed = null;
  const busy = (el) => {
    const a = doc.activeElement;
    if (a && el.contains(a) && isText(a) && !a.closest('[data-slot]')) return true;     // typing in a rebuilt field
    return !!(pressed && el.contains(pressed));                                         // a click in progress
  };
  function patch(el, html) {
    if (el._html === html) { waiting.delete(el); return false; }
    if (busy(el)) { waiting.set(el, html); return false; }
    waiting.delete(el);
    // a focused field in a kept node (the task form) survives the move: focus, caret and selection come back
    const a = doc.activeElement, keep = a && el.contains(a) && isText(a) ? { el: a, start: a.selectionStart, end: a.selectionEnd, dir: a.selectionDirection, scroll: a.scrollTop } : null;
    const state = before(el);
    for (const slot of el.querySelectorAll('[data-slot]')) for (const c of [...slot.children]) c.remove();   // keep slot nodes alive
    el.innerHTML = html;
    el._html = html;
    fillSlots(el);
    after(el, state);
    if (keep && keep.el.isConnected && doc.activeElement !== keep.el) {
      keep.el.focus({ preventScroll: true });
      try { if (keep.start != null) keep.el.setSelectionRange(keep.start, keep.end, keep.dir || 'none'); } catch { /* not a text input */ }
      keep.el.scrollTop = keep.scroll;
    }
    return true;
  }
  const flush = () => { for (const [el, html] of [...waiting]) patch(el, html); };
  // after the click has been handled (click fires right after pointerup), then the waiting updates
  const release = () => { pressed = null; setTimeout(flush, 60); };
  doc.addEventListener('pointerdown', (e) => { pressed = e.target; }, true);
  doc.addEventListener('pointerup', release, true);
  doc.addEventListener('pointercancel', release, true);
  doc.addEventListener('focusout', () => setTimeout(flush, 0), true);
  return { patch, flush, waiting };
}
