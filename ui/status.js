// SPDX-License-Identifier: Apache-2.0
// Agent status (1.2.0): one mapping for the agent list, the name tags in the scene and the Desk. Each state has a
// semantic colour (tokens.css) and an icon, so it never rests on colour alone. Also the last activity in plain words
// ("Ran the tests · 9 h ago"); the raw text stays for the tooltip and the Desk.
import { t as tt, tx } from './i18n.js';
import { esc, ago } from './lib.js';

export const STATES = ['working', 'waiting', 'idle', 'stopped', 'crashed', 'standby'];
const LABEL = { working: tt('working'), waiting: tt('needs you'), idle: tt('idle'), stopped: tt('stopped'), crashed: tt('crashed'), standby: tt('not started') };

// the agent's state for display: not started and crashed come before the runtime state
export function statusOf(a) {
  if (!a) return 'stopped';
  if (a.standby) return 'standby';
  if (a.crash && !a.crash.withLead) return 'crashed';
  if (a.waitingReply || a.state === 'waiting') return 'waiting';
  return STATES.includes(a.state) ? a.state : 'stopped';
}
export const statusLabel = (key) => LABEL[key] || LABEL.stopped;
export const statusIcon = (key) => `<svg class="sti" aria-hidden="true"><use href="#i-st-${key}"/></svg>`;
// the pill: icon + text in the state's colour, with a border
export const statusPill = (a) => { const k = typeof a === 'string' ? a : statusOf(a); return `<span class="st ${k}">${statusIcon(k)}${esc(statusLabel(k))}</span>`; };

// raw activity from the transcript ("editing src/a.css", "thinking: …") → plain words, present or past
const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
const RULES = [
  [/^thinking\b/i, () => [tt('Thinking'), tt('Thought it through')]],
  [/^editing (.+)$/i, (m) => [tt('Editing {file}', { file: base(m[1]) }), tt('Edited {file}', { file: base(m[1]) })]],
  [/^reading (.+)$/i, (m) => [tt('Reading {file}', { file: base(m[1]) }), tt('Read {file}', { file: base(m[1]) })]],
  [/^searching code$/i, () => [tt('Searching the code'), tt('Searched the code')]],
  [/^running tests\b/i, () => [tt('Running the tests'), tt('Ran the tests')]],
  [/^git: .*\bcommit\b/i, () => [tt('Committing'), tt('Committed')]],
  [/^git: /i, () => [tt('Working with git'), tt('Worked with git')]],
  // a description Claude wrote ("Install dependencies") reads well as it is; a raw command does not
  [/^terminal: ([A-Z][\w ,'()-]{2,60})$/, (m) => [m[1], m[1]]],
  [/^terminal: /i, () => [tt('Running a command'), tt('Ran a command')]],
  [/^asking the owner/i, () => [tt('Asking you'), tt('Asked you')]],
  [/^messaging (.+)$/i, (m) => [tt('Messaging {who}', { who: m[1].split('-')[0] }), tt('Messaged {who}', { who: m[1].split('-')[0] })]],
  [/^delegating to (.+)$/i, (m) => [tt('Delegating to {who}', { who: m[1] }), tt('Delegated to {who}', { who: m[1] })]],
  [/^planning tasks/i, () => [tt('Planning tasks'), tt('Planned tasks')]],
  [/^researching the web/i, () => [tt('Researching the web'), tt('Researched the web')]],
  [/^using skill (.+)$/i, (m) => [tt('Using skill {skill}', { skill: m[1] }), tt('Used skill {skill}', { skill: m[1] })]],
];
export function plainActivity(activity, { past = false } = {}) {
  const s = String(activity || '').trim();
  if (!s) return '';
  for (const [re, fn] of RULES) { const m = s.match(re); if (m) return fn(m)[past ? 1 : 0]; }
  const text = tx(s);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// the list row's second line: what it does now, or what it did last and when
export function activityLine(a) {
  const k = statusOf(a);
  if (k === 'standby') return { text: tx(a.activity) ? cap(tx(a.activity)) : statusLabel(k), full: tx(a.activity) || '' };
  if (k === 'crashed') return { text: cap(tx(a.crash.text)), full: tx(a.crash.text) };
  const [note, last] = String(a.stopNote || '').split(' · last: ');
  const raw = last || a.activity || '';
  if (k === 'working' || (k === 'waiting' && raw)) return { text: plainActivity(raw) || statusLabel(k), full: raw };
  const did = plainActivity(raw, { past: true });
  const when = a.lastTs ? ago(a.lastTs) : '';
  const lead = note ? cap(tx(note)) : '';
  const text = [lead, did, when].filter(Boolean).join(' · ') || (k === 'idle' ? tt('Idle') : tt('Not running'));
  return { text, full: [tx(a.stopNote || ''), raw && !last ? raw : ''].filter(Boolean).join(' · ') };
}
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
