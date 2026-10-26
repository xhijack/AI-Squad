// What the desk monitors show, without canvas or three.js (unit tested): text lines, a developer's edit as a diff,
// and the QA / merge status strip on the lead's and QA's screens.
export const lines = (s, max) => String(s || '').replace(/\t/g, '  ').split('\n').slice(0, max).map((l) => (l.length > 70 ? `${l.slice(0, 69)}…` : l));

// the latest edit: the replaced lines (-) first, then the new ones (+); at least three removed lines stay visible
export function diffLines(peek, max = 18) {
  const del = lines(peek.old, max).filter((l, i, a) => a.length > 1 || l.trim()).map((l) => ['-', l]);
  const add = lines(peek.added ?? peek.text, max).map((l) => ['+', l]);
  const keepDel = Math.min(del.length, Math.max(3, max - add.length));
  return [...del.slice(0, keepDel), ...add].slice(0, max);
}

// info: { board: { sprint, tasks }, merge: { approved, running, last } } -> "QA 2/3 passed · sprint-2 → main · last merge …"
export function mergeStatus(info) {
  const tasks = info?.board?.tasks || [];
  const qa = tasks.filter((t) => /^QA\b/i.test(t.task));
  const last = info?.merge?.last?.[0];
  const parts = [];
  if (qa.length) parts.push(`QA ${qa.filter((t) => t.column === 'DONE').length}/${qa.length} passed`);
  if (info?.board?.sprint) parts.push(`sprint-${info.board.sprint} → main`);
  if (info?.merge?.running) parts.push('merging now…');
  else if (last) parts.push(`last merge ${last.branch}: ${last.result}`);
  else if (info?.merge && !info.merge.approved) parts.push('auto-merge not approved');
  return parts.join(' · ');
}
