// SPDX-License-Identifier: Apache-2.0
// The office's look: 'toon' (default) or 'realistic' (Phase 3.2 step 1b: polished chibis, realistic furniture),
// chosen with ?look=realistic. Read once; every builder asks here.
export const LOOK = typeof location !== 'undefined' && new URLSearchParams(location.search).get('look') === 'realistic' ? 'realistic' : 'toon';
export const REAL = LOOK === 'realistic';
