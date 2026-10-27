// SPDX-License-Identifier: Apache-2.0
// AskUserQuestion dialogs with several questions and multi-select (1.0.1). Claude Code draws them with a tab bar
//   ←  ☒ Protokol  ☐ Full custom  ☐ Efek suara  ✔ Submit  →
// one tab per question (☒ = answered), then a review tab ("Review your answers" … "❯ 1. Submit answers").
// Single choice: Enter on an option answers it and moves to the next tab. Multi-select: Enter (or Space) toggles a
// [ ] / [✔] option, the row under the options ("Next", or "Submit" on the last question) moves on. The free-text row
// ("Type something") takes typed text and checks itself; in a multi-select, Enter on it would uncheck it again.
// The structure (questions, options, multiSelect) comes from the tool input (transcript); the screen says where the
// cursor is, which tab is open and what is checked. Answering drives the keys one question at a time and checks the
// screen after each step; a screen that does not match stops with a clear error instead of guessing.
import { cleanScreen } from './tmux.js';

const OPTION = /^(❯\s*)?(\d{1,2})\.\s+(?:\[( |✔|x|X)\]\s+)?(.+)$/;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// the screen -> { tabs: [{ label, answered }], submit, review, question, multi, options: [{ n, label, checked }], cursor,
// nextRow: 'Next' | 'Submit' | null } or null when no such dialog is open. cursor: an option number, or 'next' (the
// Next / Submit row)
export function parseAsk(text) {
  const lines = cleanScreen(text).slice(-60);
  let bar = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/[☐☒]\s+\S/.test(lines[i]) && !/^\s*(❯\s*)?\d+\./.test(lines[i])) { bar = i; break; }
  if (bar < 0) return null;
  const tabs = [...lines[bar].matchAll(/([☐☒])\s+(.+?)(?=\s{2,}[☐☒✔→]|\s*$)/g)].map((m) => ({ label: m[2].trim(), answered: m[1] === '☒' }));
  if (!tabs.length) return null;
  const submit = /✔\s+Submit/.test(lines[bar]);
  const rest = lines.slice(bar + 1);
  if (rest.some((l) => /Review your answers/i.test(l))) {
    const sel = rest.find((l) => OPTION.test(l.trim()) && /^\s*❯/.test(l));
    return { tabs, submit, review: true, question: '', multi: false, options: rest.map((l) => l.trim().match(OPTION)).filter(Boolean).map((m) => ({ n: +m[2], label: m[4].trim(), checked: false })),
      cursor: sel ? +sel.trim().match(OPTION)[2] : null, nextRow: null };
  }
  const q = [], options = [];
  let cursor = null, nextRow = null, multi = false, sep = false;
  for (const raw of rest) {
    const t = raw.trim();
    if (!t) continue;
    if (/^[─━═]{3,}/.test(t)) { if (options.length) sep = true; continue; }
    if (/^(Enter to|Tab\/Arrow|↑\/↓)/i.test(t)) break;
    const row = t.match(/^(❯\s*)?(Next|Submit)$/);
    if (row) { nextRow = row[2]; if (row[1]) cursor = 'next'; continue; }
    const m = t.match(OPTION);
    if (m) {
      if (sep || /^chat about this$/i.test(m[4].trim())) continue;               // "Chat about this" is not an answer
      if (m[3] !== undefined) multi = true;
      options.push({ n: +m[2], label: m[4].trim(), checked: m[3] === '✔' || m[3] === 'x' || m[3] === 'X' });
      if (m[1]) cursor = +m[2];
      continue;
    }
    if (!options.length) q.push(t); else if (/^\s{4,}\S/.test(raw)) continue;      // option descriptions
  }
  if (!options.length) return null;
  return { tabs, submit, review: false, question: q.join(' '), multi, options, cursor, nextRow };
}

// the keys for one question. state: the parsed screen; k: how many options the question has (the free-text row is
// k + 1, the Next / Submit row after it); want: { choices: [1..k], text }. -> [keys] where a key is 'Down', 'Up',
// 'Enter', 'Space' or { text }. Multi-select: toggles only what differs, types the free text, then moves on.
export function questionKeys(state, k, want, { multi = state.multi } = {}) {
  if (!multi) {
    const text = cleanText(want.text), target = text ? k + 1 : want.choices?.[0];
    if (!target) throw new Error('Pick an option');
    return [...moves(at(state, k), target), ...(text ? [{ text }] : []), 'Enter'];
  }
  const t = toggleKeys(state, k, want);
  return [...t.keys, ...moves(t.at, k + 2), 'Enter'];
}
const cleanText = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
// the cursor as a row: options 1..k, the free-text row k + 1, the Next / Submit row k + 2
const at = (state, k) => (state.cursor === 'next' ? k + 2 : state.cursor || 1);
const moves = (from, to) => Array.from({ length: Math.abs(to - from) }, () => (to > from ? 'Down' : 'Up'));
// multi-select: toggle what differs from the wanted choices, type the free text -> { keys, at: the row it ends on }
export function toggleKeys(state, k, want) {
  const keys = [];
  let row = at(state, k);
  const go = (to) => { keys.push(...moves(row, to)); row = to; };
  const wanted = new Set((want.choices || []).filter((n) => n >= 1 && n <= k));
  const checked = new Set(state.options.filter((o) => o.checked && o.n <= k).map((o) => o.n));
  for (let n = 1; n <= k; n++) if (wanted.has(n) !== checked.has(n)) { go(n); keys.push('Enter'); }
  const text = cleanText(want.text), freeChecked = state.options.find((o) => o.n === k + 1)?.checked;
  if (text) { go(k + 1); keys.push({ text }); } else if (freeChecked) { go(k + 1); keys.push('Enter'); }
  return { keys, at: row };
}

// what the screen should show after the toggles of a multi-select question, before moving on
const expectedChecks = (k, want) => [...new Set((want.choices || []).filter((n) => n >= 1 && n <= k)), ...(String(want.text || '').trim() ? [k + 1] : [])].sort((a, b) => a - b);

// questions: [{ question, header, multiSelect, options: [labels] }] (the tool input); answers: [{ choices: [1..k], text }]
// io: { send(keys), capture(), sleep(ms) } -> { ok } or { ok: false, error, step }
export async function answerAll(questions, answers, io, { settleMs = 450 } = {}) {
  if (!questions.length || answers.length !== questions.length) return { ok: false, error: 'Answer every question', step: 0 };
  for (const [i, a] of answers.entries()) {
    const q = questions[i];
    if (!(a.choices || []).length && !String(a.text || '').trim()) return { ok: false, error: `Question ${i + 1} (${q.header || q.question}) has no answer`, step: i };
    if (!q.multiSelect && (a.choices || []).length > 1) return { ok: false, error: `Question ${i + 1} takes one answer`, step: i };
  }
  const look = async () => { await io.sleep(settleMs); return parseAsk(await io.capture()); };
  let s = parseAsk(await io.capture());
  for (const [i, q] of questions.entries()) {
    if (!s) return { ok: false, error: 'The dialog is no longer on the screen', step: i };
    if (s.review) return { ok: false, error: `The dialog went to the review before question ${i + 1}`, step: i };
    if (q.question && !norm(s.question).startsWith(norm(q.question).slice(0, 40))) return { ok: false, error: `Expected question ${i + 1} ("${q.question.slice(0, 60)}") on the screen, found "${s.question.slice(0, 60)}"`, step: i };
    const k = q.options.length, want = answers[i];
    if (q.multiSelect) {
      // the toggles and the text first, checked on the screen, then the move to the Next / Submit row
      await io.send(toggleKeys(s, k, want).keys);
      s = await look();
      const shown = (s?.options || []).filter((o) => o.checked).map((o) => o.n);
      if (JSON.stringify(shown) !== JSON.stringify(expectedChecks(k, want))) return { ok: false, error: `Question ${i + 1}: the screen shows ${shown.length ? shown.join(', ') : 'nothing'} checked, expected ${expectedChecks(k, want).join(', ')}`, step: i };
      await io.send([...moves(at(s, k), k + 2), 'Enter']);
    } else await io.send(questionKeys(s, k, want, { multi: false }));
    const before = s;
    s = await look();
    const one = questions.length === 1 && !before.submit;
    if (one) return s && !s.review && norm(s.question) === norm(before.question) ? { ok: false, error: 'The answer did not close the dialog', step: i } : { ok: true };
    if (!s) return { ok: false, error: `Question ${i + 1}: the dialog closed before Submit`, step: i };
    if (!s.tabs[i]?.answered) return { ok: false, error: `Question ${i + 1} is not marked answered (☒) on the tab bar`, step: i };
  }
  if (!s?.review) return { ok: false, error: 'The review (Submit) did not show', step: questions.length };
  const submitAt = s.options.find((o) => /submit/i.test(o.label))?.n || 1;
  const keys = [];
  for (let row = s.cursor || 1; row > submitAt; row--) keys.push('Up');
  for (let row = s.cursor || 1; row < submitAt; row++) keys.push('Down');
  await io.send([...keys, 'Enter']);
  s = await look();
  return s ? { ok: false, error: 'The dialog is still open after Submit', step: questions.length } : { ok: true };
}

// tmux keys for one send: names stay names, text goes with -l (in its own send-keys call)
export function tmuxCalls(keys) {
  const out = [];
  let names = [];
  for (const k of keys) {
    if (typeof k === 'object') { if (names.length) out.push(names); names = []; out.push(['-l', k.text]); }
    else names.push(k === 'Space' ? 'Space' : k);
  }
  if (names.length) out.push(names);
  return out;
}
