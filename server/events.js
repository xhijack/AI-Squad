// SPDX-License-Identifier: Apache-2.0
// Live events from the Claude Code plugin hooks (hooks/event.js). They make status, activity and
// permission prompts live instead of depending on transcript timing and TUI parsing alone.
import path from 'node:path';
import { describeTool, sessionAgent } from './transcripts.js';
import { oneLine, clip } from './util.js';

export const HOOK_STALE_MS = 2 * 3600e3;       // a hook state older than this is ignored
const states = new Map();                       // "floor/agent" -> state
const recent = [];                              // last events (debugging, /api/events)

const PERMISSION = /permission|approve|allow/i;
const IDLE_PROMPT = /waiting for (your )?input|idle/i;

// event: { event, agent: "floor/agent" or "", payload }; floors: [{ id, path, agentIds }]
// returns the "floor/agent" key the event was attributed to, or null
export function ingest(body, floors, now = Date.now()) {
  const p = body.payload || {};
  const name = String(body.event || p.hook_event_name || '');
  let key = /^[\w-]+\/[\w-]+$/.test(body.agent || '') ? body.agent : null;
  if (!key) {
    // sessions not started by The AI Squad: find the Floor by cwd, the agent by agent type or transcript header
    const cwd = path.resolve(String(p.cwd || '/'));
    const floor = floors.find((f) => cwd === f.path || cwd.startsWith(f.path + path.sep));
    if (!floor) return null;
    const id = [p.agent_type, p.transcript_path ? sessionAgent(String(p.transcript_path)) : ''].find((x) => x && floor.agentIds.includes(x));
    if (!id) return null;
    key = `${floor.id}/${id}`;
  } else if (p.agent_type) {
    // a teammate / subagent of an AI Squad session reports with the parent's env: credit the subagent when it is on the team
    const [floorId] = key.split('/');
    const floor = floors.find((f) => f.id === floorId);
    if (floor && floor.agentIds.includes(p.agent_type)) key = `${floorId}/${p.agent_type}`;
  }
  const s = states.get(key) || { key, sessionId: '', state: 'idle', activity: '', ts: 0, permission: null, lastTool: null };
  s.ts = now; s.event = name; s.sessionId = p.session_id || s.sessionId;
  switch (name) {
    case 'SessionStart': s.state = 'idle'; s.activity = 'session started'; s.permission = null; break;
    case 'UserPromptSubmit': s.state = 'working'; s.activity = `task: ${oneLine(p.prompt, 60)}`; s.permission = null; break;
    case 'PreToolUse': {
      s.state = 'working'; s.permission = null;
      s.activity = describeTool(String(p.tool_name || ''), p.tool_input || {}, '')[1];
      s.lastTool = { name: p.tool_name, input: p.tool_input || {}, ts: now };
      break;
    }
    case 'PostToolUse': s.state = 'working'; s.permission = null; break;
    case 'Notification': {
      const msg = String(p.message || '');
      if (p.notification_type === 'permission_prompt' || (PERMISSION.test(msg) && p.notification_type !== 'idle_prompt')) {
        s.state = 'waiting';
        const t = s.lastTool;
        s.permission = { message: msg || 'Claude needs your permission', tool: t?.name || '', detail: t ? clip(t.input.command || t.input.file_path || JSON.stringify(t.input), 300) : '', ts: now };
      } else if (p.notification_type === 'idle_prompt' || IDLE_PROMPT.test(msg)) { s.state = 'idle'; s.permission = null; }
      break;
    }
    case 'Stop': s.state = 'idle'; s.permission = null; s.activity = 'finished the turn'; break;
    case 'SubagentStop': if (p.agent_type && key.endsWith(`/${p.agent_type}`)) { s.state = 'idle'; s.permission = null; } break;
    default: break;
  }
  states.set(key, s);
  recent.push({ ts: now, key, event: name, tool: p.tool_name || '' });
  if (recent.length > 200) recent.shift();
  return key;
}

export function agentState(floorId, agentId, now = Date.now()) {
  const s = states.get(`${floorId}/${agentId}`);
  return s && now - s.ts < HOOK_STALE_MS ? s : null;
}
export const recentEvents = () => recent.slice(-100);
export const reset = () => { states.clear(); recent.length = 0; };
// the session ended (agent stopped): its hook state no longer applies
export const forget = (floorId, agentId) => states.delete(`${floorId}/${agentId}`);
