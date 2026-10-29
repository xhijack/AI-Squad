// SPDX-License-Identifier: Apache-2.0
// Direct chat with one agent (0.14): a thread per agent and context, outside the squad's own flow.
//   space    the agent in its Space: the thread lives in the Space (docs/squad/chats/<agent>.jsonl, so it travels
//            with the Space); a running Desk session gets the message typed in, else a background job answers
//   general  the same agent without any project: a neutral folder (~/.aisquad/general/<floor>--<agent>/) with
//            only its identity and the Company Brain; the thread lives in ~/.aisquad/chats/
// A message from a person always goes first (P0). The agent's answer comes back into the thread. In a Space, the
// lead learns about direct messages through docs/squad/DIRECT.md and the Squad Log.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, writeJson, writeText, bad } from './util.js';

export const CONTEXTS = ['space', 'general'];
export const MAX_TEXT = 8000;
const HISTORY_IN_PROMPT = 10;
const stateFile = () => path.join(config.home, 'chats', 'state.json');
export const keyOf = (floorId, agentId, context) => `${floorId}/${agentId}/${context}`;

export function threadFile({ root, floorId, agentId, context }) {
  if (!CONTEXTS.includes(context)) throw bad('The context must be space or general');
  if (!/^[\w-]+$/.test(agentId) || !/^[\w-]+$/.test(floorId)) throw bad('Bad agent');
  return context === 'space' ? path.join(root, 'docs', 'squad', 'chats', `${agentId}.jsonl`) : path.join(config.home, 'chats', `${floorId}--${agentId}.jsonl`);
}
export function read(file, limit = 200) {
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-limit);
}
export function append(file, msg, now = Date.now()) {
  const m = { id: `m-${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`, ts: now, ...msg, text: String(msg.text || '').slice(0, 20000) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(m)}\n`);
  return m;
}
// per thread: { sessionId (the chat's own Claude Code session), awaiting: { msgId, since, mode: typed | job | queued, job } }
export const loadState = () => readJson(stateFile(), {}) || {};
export function getState(key) { return loadState()[key] || {}; }
export function setState(key, patch) {
  const all = loadState();
  all[key] = { ...(all[key] || {}), ...patch };
  for (const k of Object.keys(all[key])) if (all[key][k] === undefined) delete all[key][k];
  writeJson(stateFile(), all);
  return all[key];
}

export function cleanText(text) {
  const t = String(text || '').trim();
  if (!t) throw bad('Write a message first');
  if (t.length > MAX_TEXT) throw bad(`A message can be at most ${MAX_TEXT} characters`);
  return t;
}

// typed into a running Desk session: short, and says where the answer goes
export const typedText = (name, text) => `Direct message from ${name} (answer it in your next reply; the answer goes back to the chat): ${text}`;

// a background job's prompt: the last turns of the thread for context, then the message
export function jobPrompt({ name, text, context, messages = [], spaceName = '' }) {
  const earlier = messages.slice(-HISTORY_IN_PROMPT - 1, -1).map((m) => `- ${m.from === 'agent' ? 'You' : m.name || 'Owner'}: ${m.text.replace(/\s+/g, ' ').slice(0, 600)}`);
  return [
    `Direct message from ${name} in your chat${context === 'general' ? ' (general: no project here; use your role and the Company Brain only, and say so if the question needs a project)' : ` in the Space "${spaceName}"`}.`,
    'Answer in plain words; ask if something is unclear. If it asks for work, do what your permissions allow and say what you did and what is left.',
    ...(earlier.length ? ['', 'Earlier in this chat:', ...earlier] : []),
    '', 'Message:', text,
  ].join('\n');
}

// the neutral folder of the General context: only the agent's identity (its generated agent file)
export function neutralDir(floorId, agentId, agentFile) {
  const dir = path.join(config.home, 'general', `${floorId}--${agentId}`);
  const dest = path.join(dir, '.claude', 'agents', `${agentId}.md`);
  if (agentFile && fs.existsSync(agentFile)) writeText(dest, fs.readFileSync(agentFile, 'utf8'));
  return dir;
}

// the lead's note of direct messages in its Space
export function noteForLead(root, { name, agentName, text, now = Date.now() }) {
  const f = path.join(root, 'docs', 'squad', 'DIRECT.md');
  if (!fs.existsSync(f)) writeText(f, '# Direct messages\n\nMessages people sent straight to one agent (Desk → Chat). The lead reads this when planning.\n\n');
  fs.appendFileSync(f, `- ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} ${name} → ${agentName}: ${text.replace(/\s+/g, ' ').slice(0, 200)}\n`);
}
