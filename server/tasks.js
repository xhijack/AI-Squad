// SPDX-License-Identifier: Apache-2.0
// Long-running commands: a 10-minute docker build or e2e run writes nothing to the transcript while it runs, so
// without this the agent looks idle and the Watchdog or Autopilot would nudge it. From the transcript records:
// open tool calls (a tool_use without its tool_result yet), background shells (started with run_in_background:
// running until a task notification, a kill or a final output read says otherwise) and Monitor waits. For each:
// a kind and a label ("e2e Playwright"), the last output lines, progress when the output counts it, the result
// (passed / failed) when it ends, and a stall when the output stops moving or it runs far longer than usual.
// Pure functions; reading files and screens is done by the caller (server/squad.js).

const oneLine = (s, n = 80) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const tsOf = (r) => Date.parse(r.timestamp || '') || 0;
const resultText = (c) => (Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : String(c || ''));

// what kind of command it is, and a short label the owner recognises
const KINDS = [
  ['e2e', /\b(playwright|cypress|e2e)\b/i, 'e2e Playwright'],
  ['vitest', /\bvitest\b/i, 'vitest'],
  ['jest', /\bjest\b/i, 'jest'],
  ['pytest', /\bpytest\b/i, 'pytest'],
  ['compose', /\bdocker[- ]compose\b|\bdocker compose\b/i, 'docker compose'],
  ['docker', /\bdocker (buildx )?build\b/i, 'docker build'],
  ['tests', /\b(npm|pnpm|yarn|bun)( run)? test\b|\bnode --test\b|\bgo test\b|\bcargo test\b|\bbench (run-tests|--site .* run-tests)\b/i, 'tests'],
  ['build', /\b(npm|pnpm|yarn|bun) run build\b|\bvite build\b|\bnext build\b|\bmake\b|\bcargo build\b|\bbench build\b/i, 'build'],
  ['install', /\b(npm|pnpm|yarn|bun) (install|ci|i)\b|\bpip install\b|\bapt(-get)? install\b|\bbench (get-app|install-app)\b/i, 'install'],
];
export function classify(command = '', description = '') {
  const c = `${command} ${description}`;
  for (const [kind, re, name] of KINDS) if (re.test(c)) {
    const label = kind === 'e2e' && /cypress/i.test(c) ? 'e2e Cypress' : name;
    return { kind, label };
  }
  return { kind: 'command', label: oneLine(description || command, 40) || 'command' };
}

// running and ended tasks in a transcript's records -> { running: [task], ended: [task] }
// task: { id, kind, label, command, background, file, startedAt, endedAt?, status?, output? }
export function scan(records = []) {
  const open = new Map(), bg = new Map(), ended = [];
  const finish = (t, at, status, output = '') => { ended.push({ ...t, endedAt: at, status, ...(output ? { output } : {}) }); };
  for (const r of records) {
    const at = tsOf(r); if (!at) continue;
    const content = Array.isArray(r.message?.content) ? r.message.content : [];
    if (r.type === 'assistant') {
      for (const c of content) {
        if (c.type !== 'tool_use') continue;
        const input = c.input || {};
        if (c.name === 'Bash') {
          const { kind, label } = classify(input.command, input.description);
          open.set(c.id, { id: c.id, kind, label, command: oneLine(input.command, 200), background: !!input.run_in_background, file: '', startedAt: at });
        } else if (c.name === 'Monitor') {
          open.set(c.id, { id: c.id, kind: 'wait', label: oneLine(input.description || input.command || 'waiting', 40), command: oneLine(input.command, 200), background: false, file: '', startedAt: at });
        } else if (['KillShell', 'KillBash', 'TaskStop'].includes(c.name)) {
          const id = String(input.shell_id || input.bash_id || input.task_id || input.id || '');
          if (bg.has(id)) { finish(bg.get(id), at, 'killed'); bg.delete(id); }
        }
      }
    } else if (r.type === 'user') {
      // background shells finish with a task notification in a user message
      const texts = typeof r.message?.content === 'string' ? [r.message.content] : content.filter((c) => c.type === 'text').map((c) => c.text || '');
      for (const t of texts) for (const m of t.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
        const id = (m[1].match(/<task-id>([^<]+)<\/task-id>/) || [])[1], status = (m[1].match(/<status>([^<]+)<\/status>/) || [])[1] || 'completed';
        if (id && bg.has(id)) { finish(bg.get(id), at, /fail|error|killed/i.test(status) ? (status.includes('kill') ? 'killed' : 'failed') : 'completed'); bg.delete(id); }
      }
      for (const c of content) {
        if (c.type !== 'tool_result') continue;
        const t = open.get(c.tool_use_id);
        if (t) {
          open.delete(c.tool_use_id);
          const text = resultText(c.content);
          const started = t.background && text.match(/running in background with ID: ([\w-]+)/i);
          if (started) {
            const file = (text.match(/Output is being written to: (\S+)/) || [])[1] || '';
            bg.set(started[1], { ...t, id: started[1], file });
          } else finish(t, at, c.is_error ? 'failed' : 'completed', text.slice(-6000));
        }
        // a final read of a background shell's output (BashOutput) says it is done
        const text = resultText(c.content);
        const st = text.match(/<status>(completed|failed|killed)<\/status>/);
        const id = (text.match(/<(?:shell|bash|task)_id>([\w-]+)</) || [])[1];
        if (st && id && bg.has(id)) { finish(bg.get(id), at, st[1], text.slice(-6000)); bg.delete(id); }
      }
    }
  }
  return { running: [...open.values(), ...bg.values()].sort((a, b) => a.startedAt - b.startedAt), ended };
}

// the last lines of output, without control codes and blank runs
export function tailLines(text = '', n = 6) {
  return String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()).slice(-n);
}

// progress the output can tell: [12/40], "Running 40 tests" + ticks, pytest's [ 45%], docker's #12 [5/9]
// -> { done, total, pct } or null
export function progressOf(kind, text = '') {
  const s = String(text);
  let m;
  const last = (re) => { let x = null; for (const k of s.matchAll(re)) x = k; return x; };
  if ((m = last(/\[\s*(\d+)\s*\/\s*(\d+)\s*\]/g)) && +m[2] > 0) return { done: +m[1], total: +m[2], pct: Math.min(100, Math.round(+m[1] / +m[2] * 100)) };
  if (kind === 'e2e' && (m = s.match(/Running (\d+) tests?/))) {
    const total = +m[1], done = (s.match(/^\s*(✓|✘|×|ok|x|-)\s+\d+\s/gm) || []).length;
    if (total) return { done: Math.min(done, total), total, pct: Math.min(100, Math.round(done / total * 100)) };
  }
  if ((m = last(/\[\s*(\d{1,3})%\]/g))) return { done: null, total: null, pct: Math.min(100, +m[1]) };
  return null;
}

// the result when it ends: passed / failed / skipped counts (vitest, jest, playwright, pytest, node --test), or for
// docker build / compose ok or not -> { ok, passed?, failed?, skipped?, summary }
export function resultOf(kind, text = '', status = 'completed') {
  const s = String(text);
  const num = (re) => { let x = null; for (const k of s.matchAll(re)) x = +k[1]; return x; };
  const passed = num(/(\d+) (?:tests? )?passed/gi) ?? num(/^# pass (\d+)/gm) ?? num(/(\d+) passing\b/g);
  const failed = num(/(\d+) (?:tests? )?failed/gi) ?? num(/^# fail (\d+)/gm) ?? num(/(\d+) failing\b/g);
  const skipped = num(/(\d+) (?:tests? )?skipped/gi);
  if (passed != null || failed != null) {
    const ok = status !== 'failed' && !failed;
    return { ok, passed: passed || 0, failed: failed || 0, ...(skipped ? { skipped } : {}), summary: `${passed || 0} passed${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}` };
  }
  if (kind === 'docker' || kind === 'compose') {
    const bad = status === 'failed' || /^(ERROR|error)[: ]|failed to solve|Error response from daemon/m.test(s);
    return { ok: !bad, summary: bad ? 'failed' : kind === 'docker' ? 'image built' : 'up' };
  }
  return { ok: status === 'completed', summary: status === 'completed' ? 'done' : status };
}

// a typical duration per kind, from earlier task.ended Log events (the median), or 0
export function typicalMs(kind, history = []) {
  const d = history.filter((e) => e.kind === kind && e.ms > 0).map((e) => e.ms).sort((a, b) => a - b);
  return d.length >= 2 ? d[Math.floor(d.length / 2)] : 0;
}
export const STALL_QUIET_MS = 10 * 60e3;
// a real stall: the output has not moved for 10 minutes, or it runs far longer than its usual duration
// -> '' or the reason
export function stallOf({ startedAt, lastOutputAt = 0, now = Date.now(), typical = 0, hasOutput = true }) {
  if (hasOutput && lastOutputAt && now - lastOutputAt >= STALL_QUIET_MS) return 'quiet';
  if (typical && now - startedAt > Math.max(3 * typical, typical + STALL_QUIET_MS)) return 'long';
  return '';
}
// "7m 32s", "1h 04m", "45s"
export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
}
