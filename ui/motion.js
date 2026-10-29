// SPDX-License-Identifier: Apache-2.0
// Reduced motion (1.2.0): with prefers-reduced-motion the camera jumps instead of easing, the scenes do not damp,
// and pulses stop (tokens.css sets the durations to 0, style.css stops the animations).
export const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// a camera move's duration: as asked, or none
export const easeMs = (ms) => (reducedMotion() ? 0 : ms);
// a per-frame easing factor (0..1): 1 jumps to the goal at once
export const easeStep = (k) => (reducedMotion() ? 1 : Math.min(1, k));
