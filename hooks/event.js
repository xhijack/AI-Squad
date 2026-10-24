#!/usr/bin/env node
// Claude Code hook -> The AI Squad server (POST /api/events). Never blocks Claude Code: prints nothing,
// always exits 0, gives up after ~1.5 s, and does nothing when the server or its PIN is missing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const event = process.argv[2] || '';
const home = process.env.AISQUAD_HOME || path.join(os.homedir(), '.aisquad');
const url = (process.env.AISQUAD_URL || `http://127.0.0.1:${process.env.AISQUAD_PORT || 8097}`).replace(/\/$/, '');
const quit = () => process.exit(0);
setTimeout(quit, 1500).unref();

const clip = (v, n) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n)}…` : v);
function trim(p) {
  const out = {};
  for (const k of ['session_id', 'transcript_path', 'cwd', 'hook_event_name', 'tool_name', 'tool_use_id', 'message', 'notification_type', 'title', 'source', 'reason', 'agent_id', 'agent_type', 'stop_hook_active']) if (p[k] !== undefined) out[k] = clip(p[k], 1000);
  if (typeof p.prompt === 'string') out.prompt = clip(p.prompt, 500);
  if (p.tool_input && typeof p.tool_input === 'object') out.tool_input = Object.fromEntries(Object.entries(p.tool_input).map(([k, v]) => [k, typeof v === 'string' ? clip(v, 800) : typeof v === 'object' ? undefined : v]));
  const r = p.tool_response;
  if (r && typeof r === 'object') out.tool_error = !!(r.is_error || r.error || r.interrupted);
  return out;
}

let pin = '';
try { pin = fs.readFileSync(path.join(home, 'pin'), 'utf8').trim(); } catch { quit(); }
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; if (input.length > 4e6) quit(); });
process.stdin.on('end', async () => {
  let payload = {};
  try { payload = JSON.parse(input || '{}'); } catch { /* send the event name anyway */ }
  try {
    await fetch(`${url}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aisquad-pin': pin },
      body: JSON.stringify({ event: event || payload.hook_event_name || '', agent: process.env.AISQUAD_AGENT || '', payload: trim(payload) }),
      signal: AbortSignal.timeout(1200),
    });
  } catch { /* server down: skip silently */ }
  quit();
});
