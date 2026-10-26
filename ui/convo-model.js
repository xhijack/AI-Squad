// The conversation view's model, without DOM access (unit tested): a one-line preview for the Attention index, the
// short bubble over the agent's head, and which actions an item gets in the action bar.

const clean = (l) => l.replace(/^[#>*\-\s|☐☑✓]+/, '').replace(/[*_`|]/g, '').trim();
// the question when there is one (dialogs start with a short header such as "☐ Runner"), else the first line
const firstLine = (text) => { const ls = String(text || '').split('\n').map(clean).filter(Boolean); return ls.find((l) => l.endsWith('?')) || ls[0] || ''; };
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// "Finished: Server inventory done" / "Question: Which runner?"; at most n characters
export function preview(item, n = 90) {
  const lead = { finished: 'Finished', reply: 'Asks you', question: 'Question', permission: 'Permission', crash: 'Stopped', decided: 'Decided', scope: 'Scope change' }[item.kind] || '';
  return short(`${lead ? `${lead}: ` : ''}${firstLine(item.text)}`, n);
}

// the speech bubble over the agent's head in the office while the item is open
export function bubbleText(item) {
  if (item.kind === 'finished') return short(`Finished: ${firstLine(item.text)}`, 60);
  if (item.kind === 'question' || item.kind === 'reply') return 'Question for you';
  if (item.kind === 'permission') return 'May I?';
  return short(firstLine(item.text), 60) || 'Look at this';
}

const isRecommended = (item, o) => /\(recommended\)/i.test(o.label) || item.autopilot?.recommended === o.n;
// -> { mode: 'options' | 'reply' | 'view', options, canReply, dismiss, act }
// act: the action the existing Attention handlers use for an option (answer, crash-answer)
export function actionsFor(item) {
  const options = (item.options || []).map((o) => ({ ...o, recommended: !o.free && isRecommended(item, o), label: String(o.label).replace(/\s*\(recommended\)\s*/i, ' ').trim() }));
  if (item.kind === 'reply' || item.kind === 'finished') return { mode: 'reply', options: [], canReply: item.canReply !== false, dismiss: item.kind === 'finished' ? 'OK' : 'Dismiss' };
  if (item.kind === 'crash') return { mode: 'options', options, canReply: false, dismiss: 'Dismiss', act: 'crash-answer' };
  if (item.kind === 'decided') return { mode: 'options', options, canReply: false, dismiss: 'OK', act: 'answer' };
  if (item.answerable && options.length) return { mode: 'options', options, canReply: false, dismiss: item.kind === 'stall' || item.kind === 'merge' ? 'Dismiss' : '', act: 'answer' };
  return { mode: 'view', options: [], canReply: false, dismiss: item.kind === 'stall' || item.kind === 'merge' ? 'Dismiss' : '' };
}

// previous / next through the open items: wraps around
export const step = (i, n, d) => (n ? (i + d + n) % n : 0);
export const ofText = (i, n) => `${i + 1} of ${n}`;
