import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratch, jsonl } from './helpers.js';
import * as ev from '../server/events.js';
import { config } from '../server/config.js';

const root = scratch({ seed: false });
const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'event.js');
const FLOORS = [{ id: 'shop', path: '/work/shop', agentIds: ['budi-dev', 'sari-qa', 'rina-pm'] }];

test('events are attributed by env, by agent type and by cwd + transcript header', () => {
  ev.reset();
  assert.equal(ev.ingest({ event: 'PreToolUse', agent: 'shop/budi-dev', payload: { tool_name: 'Bash', tool_input: { command: 'npm test' } } }, FLOORS), 'shop/budi-dev');
  assert.equal(ev.ingest({ event: 'PreToolUse', agent: 'shop/rina-pm', payload: { agent_type: 'sari-qa', tool_name: 'Read', tool_input: { file_path: '/work/shop/a.js' } } }, FLOORS), 'shop/sari-qa', 'teammate credited');
  const tr = path.join(root, 't.jsonl');
  fs.writeFileSync(tr, jsonl([{ type: 'agent-setting', agentSetting: 'rina-pm' }]));
  assert.equal(ev.ingest({ event: 'Stop', payload: { cwd: '/work/shop/src', transcript_path: tr } }, FLOORS), 'shop/rina-pm');
  assert.equal(ev.ingest({ event: 'Stop', payload: { cwd: '/elsewhere' } }, FLOORS), null, 'not a Floor');
  assert.equal(ev.ingest({ event: 'Stop', payload: { cwd: '/work/shop' } }, FLOORS), null, 'unknown agent');
});

test('state machine: task, tools, permission prompt, idle prompt, stop', () => {
  ev.reset();
  const send = (event, payload = {}, now = Date.now()) => ev.ingest({ event, agent: 'shop/budi-dev', payload }, FLOORS, now);
  const st = () => ev.agentState('shop', 'budi-dev');
  send('SessionStart', { source: 'startup' });
  assert.equal(st().state, 'idle');
  send('UserPromptSubmit', { prompt: 'Build the cart' });
  assert.deepEqual([st().state, st().activity], ['working', 'task: Build the cart']);
  send('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clean build' } });
  assert.equal(st().activity, 'terminal: Clean build');
  send('Notification', { message: 'Claude needs your permission to use Bash' });
  assert.equal(st().state, 'waiting');
  assert.deepEqual([st().permission.tool, st().permission.detail], ['Bash', 'rm -rf build']);
  send('PostToolUse', { tool_name: 'Bash' });
  assert.deepEqual([st().state, st().permission], ['working', null]);
  send('Notification', { message: 'Claude is waiting for your input', notification_type: 'idle_prompt' });
  assert.equal(st().state, 'idle');
  send('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'cart.js' } });
  send('Stop', {});
  assert.deepEqual([st().state, st().event], ['idle', 'Stop']);
  assert.equal(ev.agentState('shop', 'budi-dev', Date.now() + ev.HOOK_STALE_MS + 1), null, 'stale state ignored');
  ev.forget('shop', 'budi-dev');
  assert.equal(st(), null);
});

function runHook(args, input, env) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const c = spawn(process.execPath, [HOOK, ...args], { env: { ...process.env, ...env } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out, ms: Date.now() - t0 }));
    c.stdin.end(input);
  });
}

test('the hook script posts a trimmed event with the PIN, prints nothing, exits 0', async () => {
  fs.mkdirSync(config.home, { recursive: true });
  fs.writeFileSync(path.join(config.home, 'pin'), '424242\n');
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { got.push({ url: req.url, pin: req.headers['x-aisquad-pin'], body: JSON.parse(b) }); res.end('{}'); }); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const env = { AISQUAD_HOME: config.home, AISQUAD_URL: `http://127.0.0.1:${srv.address().port}`, AISQUAD_AGENT: 'shop/budi-dev' };
  const payload = { session_id: 's1', cwd: '/work/shop', hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'a.js', content: 'x'.repeat(5000) }, tool_response: { output: 'y'.repeat(9000) } };
  const r = await runHook(['PreToolUse'], JSON.stringify(payload), env);
  srv.close();
  assert.equal(r.code, 0);
  assert.equal(r.out, '', 'hooks must not print (stdout becomes context for some events)');
  assert.equal(got[0].url, '/api/events');
  assert.equal(got[0].pin, '424242');
  assert.equal(got[0].body.agent, 'shop/budi-dev');
  assert.equal(got[0].body.event, 'PreToolUse');
  assert.ok(got[0].body.payload.tool_input.content.length < 900, 'large input trimmed');
  assert.equal(got[0].body.payload.tool_response, undefined);
});

test('server down or no PIN: exits 0 quickly and silently', async () => {
  const down = await runHook(['Stop'], '{}', { AISQUAD_HOME: config.home, AISQUAD_URL: 'http://127.0.0.1:9' });
  assert.deepEqual([down.code, down.out], [0, '']);
  assert.ok(down.ms < 2500, `took ${down.ms} ms`);
  const nopin = await runHook(['Stop'], '{}', { AISQUAD_HOME: path.join(root, 'nowhere') });
  assert.deepEqual([nopin.code, nopin.out], [0, '']);
  const garbage = await runHook([], 'not json', { AISQUAD_HOME: config.home, AISQUAD_URL: 'http://127.0.0.1:9' });
  assert.equal(garbage.code, 0);
});
