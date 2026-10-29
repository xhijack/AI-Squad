// Long-running commands (server/tasks.js): open calls, background shells, kinds, output, progress, results, stalls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as tasks from '../server/tasks.js';

const T0 = Date.parse('2026-10-26T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const use = (s, id, name, input) => ({ type: 'assistant', timestamp: at(s), message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (s, id, text, isError = false) => ({ type: 'user', timestamp: at(s), message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError }] } });
const note = (s, id, status) => ({ type: 'user', timestamp: at(s), message: { content: [{ type: 'text', text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n</task-notification>` }] } });

test('kinds and labels', () => {
  assert.deepEqual(tasks.classify('npx playwright test --reporter=line', 'Run the e2e suite'), { kind: 'e2e', label: 'e2e Playwright' });
  assert.equal(tasks.classify('docker build -t app .').kind, 'docker');
  assert.equal(tasks.classify('docker compose up -d --build').kind, 'compose');
  assert.equal(tasks.classify('pnpm vitest run').kind, 'vitest');
  assert.equal(tasks.classify('python -m pytest -q').kind, 'pytest');
  assert.equal(tasks.classify('npm test').kind, 'tests');
  assert.deepEqual(tasks.classify('sleep 600 && curl -s x', 'Wait for the deploy'), { kind: 'command', label: 'Wait for the deploy' });
});

test('a foreground call is running until its result; a background shell until its notification', () => {
  const recs = [
    use(0, 'tu1', 'Bash', { command: 'npx playwright test', description: 'e2e run' }),
    use(5, 'tu2', 'Bash', { command: 'docker build -t app .', run_in_background: true }),
    result(6, 'tu2', 'Command running in background with ID: b7x9. Output is being written to: /tmp/tasks/b7x9.output'),
    use(10, 'tu3', 'Monitor', { description: 'deploy finishes', command: 'until curl -s x; do sleep 5; done' }),
  ];
  let s = tasks.scan(recs);
  assert.deepEqual(s.running.map((t) => [t.id, t.kind, t.background, t.file]), [['tu1', 'e2e', false, ''], ['b7x9', 'docker', true, '/tmp/tasks/b7x9.output'], ['tu3', 'wait', false, '']]);
  assert.equal(s.running[0].startedAt, T0);
  s = tasks.scan([...recs, result(400, 'tu1', 'Running 3 tests\n  ✓ 1 a\n  ✓ 2 b\n  ✘ 3 c\n  1 failed\n  2 passed (6.4m)'), note(500, 'b7x9', 'completed'), result(510, 'tu3', 'done')]);
  assert.deepEqual(s.running, []);
  assert.deepEqual(s.ended.map((t) => [t.id, t.status, t.endedAt - t.startedAt]), [['tu1', 'completed', 400e3], ['b7x9', 'completed', 495e3], ['tu3', 'completed', 500e3]]);
  assert.match(s.ended[0].output, /2 passed/);
  // killed, and a final output read
  const k = tasks.scan([use(0, 'a', 'Bash', { command: 'npm run build', run_in_background: true }), result(1, 'a', 'Command running in background with ID: s1. Output is being written to: /tmp/s1'), use(9, 'k', 'KillShell', { shell_id: 's1' })]);
  assert.deepEqual([k.running.length, k.ended[0].status], [0, 'killed']);
  const o = tasks.scan([use(0, 'a', 'Bash', { command: 'pytest', run_in_background: true }), result(1, 'a', 'Command running in background with ID: s2. Output is being written to: /tmp/s2'), use(50, 'r', 'BashOutput', { bash_id: 's2' }), result(51, 'r', '<status>failed</status>\n<bash_id>s2</bash_id>\n=== 2 failed, 40 passed in 31.0s ===')]);
  assert.deepEqual([o.running.length, o.ended[0].status], [0, 'failed']);
});

test('output tail, progress, results', () => {
  assert.deepEqual(tasks.tailLines('a\n\n\x1b[32mb\x1b[0m   \nprogress 10%\rprogress 50%\nlast', 3), ['progress 10%', 'progress 50%', 'last']);
  assert.deepEqual(tasks.progressOf('e2e', '[chromium] › a.spec.ts\n[12/40] tests'), { done: 12, total: 40, pct: 30 });
  assert.deepEqual(tasks.progressOf('e2e', 'Running 4 tests using 2 workers\n  ✓ 1 [chromium] a (2s)\n  ✘ 2 [chromium] b (3s)'), { done: 2, total: 4, pct: 50 });
  assert.deepEqual(tasks.progressOf('pytest', 'tests/test_a.py ....... [ 45%]'), { done: null, total: null, pct: 45 });
  assert.deepEqual(tasks.progressOf('docker', '#7 [3/9] RUN npm ci'), { done: 3, total: 9, pct: 33 });
  assert.equal(tasks.progressOf('command', 'hello'), null);
  assert.deepEqual(tasks.resultOf('vitest', ' Test Files  2 passed (2)\n      Tests  12 passed | 1 failed (13)'), { ok: false, passed: 12, failed: 1, summary: '12 passed, 1 failed' });
  assert.deepEqual(tasks.resultOf('jest', 'Tests:       2 failed, 30 passed, 32 total'), { ok: false, passed: 30, failed: 2, summary: '30 passed, 2 failed' });
  assert.equal(tasks.resultOf('pytest', '==== 40 passed, 3 skipped in 12.1s ====').summary, '40 passed, 3 skipped');
  assert.equal(tasks.resultOf('tests', '# tests 289\n# pass 289\n# fail 0').summary, '289 passed');
  assert.deepEqual(tasks.resultOf('docker', '#12 naming to docker.io/library/app done'), { ok: true, summary: 'image built' });
  assert.equal(tasks.resultOf('docker', 'ERROR: failed to solve: exit code 1').ok, false);
  assert.deepEqual(tasks.resultOf('command', '', 'killed'), { ok: false, summary: 'killed' });
});

test('stalls: quiet output for 10 minutes, or far longer than usual (learned per kind)', () => {
  const now = T0 + 3600e3;
  assert.equal(tasks.stallOf({ startedAt: now - 30 * 60e3, lastOutputAt: now - 11 * 60e3, now }), 'quiet');
  assert.equal(tasks.stallOf({ startedAt: now - 30 * 60e3, lastOutputAt: now - 60e3, now }), '');
  const history = [{ kind: 'e2e', ms: 6 * 60e3 }, { kind: 'e2e', ms: 8 * 60e3 }, { kind: 'e2e', ms: 7 * 60e3 }, { kind: 'docker', ms: 60e3 }];
  const typical = tasks.typicalMs('e2e', history);
  assert.equal(typical, 7 * 60e3);
  assert.equal(tasks.stallOf({ startedAt: now - 20 * 60e3, lastOutputAt: now - 60e3, now, typical }), '', '20 min: within 3x');
  assert.equal(tasks.stallOf({ startedAt: now - 22 * 60e3, lastOutputAt: now - 60e3, now, typical }), 'long');
  assert.equal(tasks.typicalMs('pytest', history), 0, 'no history: no "long" stall');
  assert.equal(tasks.duration(452e3), '7m 32s'); assert.equal(tasks.duration(45e3), '45s'); assert.equal(tasks.duration(3840e3), '1h 04m');
});

test('services: dev servers, watchers and log tails by their command, description or what they printed', () => {
  for (const c of ['pnpm dev', 'npm run dev -- --port 3001', 'yarn start', 'next dev', 'npx vite --host', 'docker compose up', 'docker-compose up web', 'node --test --watch', 'tail -f logs/app.log', 'bench start', 'python -m http.server 8000', 'uvicorn app:app --reload', 'npm run build && npm run dev'])
    assert.equal(tasks.classify(c).kind, 'service', c);
  for (const c of ['npm test', 'npm run build', 'vite build', 'docker compose up -d', 'docker compose up --detach db', 'pnpm install', 'tail -n 50 log'])
    assert.notEqual(tasks.classify(c).kind, 'service', c);
  assert.equal(tasks.classify('npm run x', 'Rebuild renderer and start dev server').kind, 'service');
  for (const o of ['  ➜  Local:   http://localhost:5173/', 'ready on http://0.0.0.0:3000', 'Server running at http://127.0.0.1:8080', 'Listening on port 4000', '\x1b[32mwatching for file changes\x1b[0m'])
    assert.ok(tasks.looksLikeService(o), o);
  assert.ok(!tasks.looksLikeService('✓ 40 passed (12s)'));
  // the agent is busy with the newest command that is not a service; services stand beside it
  const running = [{ id: 'b1', kind: 'service', background: true }, { id: 'b2', kind: 'command', background: true, out: 'VITE ready in 300 ms\n  Local: http://localhost:5173/' }, { id: 't1', kind: 'tests', background: false }];
  const out = (t) => t.out || '';
  assert.deepEqual(tasks.splitRunning(running, out).services.map((t) => t.id), ['b1', 'b2']);
  assert.equal(tasks.splitRunning(running, out).task.id, 't1');
  assert.equal(tasks.splitRunning(running.slice(0, 2), out).task, null, 'only services: the agent is not working on anything');
  assert.equal(tasks.splitRunning([{ id: 'f', kind: 'service', background: false }]).task.id, 'f', 'a foreground dev server blocks the agent: it is its work');
  // waiting on a service only stalls when the service has been silent for the quiet threshold
  const now = T0 + 3600e3;
  assert.equal(tasks.serviceWaitStall({ waitStartedAt: now - 30 * 60e3, serviceOutputAt: now - 60e3, now }), '');
  assert.equal(tasks.serviceWaitStall({ waitStartedAt: now - 30 * 60e3, serviceOutputAt: now - 11 * 60e3, now }), 'quiet');
  assert.equal(tasks.serviceWaitStall({ waitStartedAt: now - 2 * 60e3, serviceOutputAt: now - 40 * 60e3, now }), '', 'a fresh wait');
});

test('Stop finds the service\'s shell under the agent\'s session, with its children, and nothing else', () => {
  const rows = tasks.parsePs(`  100     1 tmux
  200   100 claude --agent dev
  300   200 /bin/bash -c -l source snap && eval 'pnpm dev' < /dev/null
  301   300 node /x/.bin/vite
  302   301 esbuild --service
  400   200 /bin/bash -c -l eval 'npm test'
  900     1 /bin/bash -c pnpm dev`);
  assert.deepEqual(tasks.serviceProcesses(rows, [100], 'pnpm dev'), [300, 301, 302], 'not the other session\'s pnpm dev (900)');
  assert.deepEqual(tasks.serviceProcesses(rows, [100], 'yarn start'), []);
  assert.deepEqual(tasks.serviceProcesses(rows, [100], ''), [], 'no command: nothing');
});
