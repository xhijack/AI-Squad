// Voices (Phase 3.1): the server calls the ElevenLabs text-to-speech REST API so the characters talk. The API key
// lives in the service environment (ELEVENLABS_API_KEY) or in ~/.aisquad/secrets.json (0600): never in a repo, a
// log or the browser (the UI only learns "set" and the last 4 characters). Spoken lines are shortened without a
// model, redacted first, cached by hash, and counted against a monthly character budget; past the budget the
// browser's own speech (or silence) takes over.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, bad } from './util.js';
import { redact } from './redact.js';

export const API = 'https://api.elevenlabs.io/v1';
export const MODELS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_multilingual_v2'];
export const DEFAULTS = { model: 'eleven_flash_v2_5', budgetChars: 50000, quietFrom: '', quietTo: '', onlyVisible: true, mutedFloors: [] };
const CACHE_CAP = 60 * 2 ** 20;                    // 60 MB of cached audio

// premade ElevenLabs voices as defaults per role, so a new squad sounds right before anyone picks a voice;
// a voice missing from the account falls back to the account's first voice
export const ROLE_VOICES = {
  lead: '21m00Tcm4TlvDq8ikWAM', 'project-manager': '21m00Tcm4TlvDq8ikWAM', 'sprint-lead': '21m00Tcm4TlvDq8ikWAM',
  'fullstack-developer': 'pNInz6obpgDQGcFmaJgB', 'sprint-developer': 'ErXwobaYiN019PkySvjV', 'frappe-developer': 'TxGEqnHWrfWFTfGW9XjX',
  'qa-engineer': 'EXAVITQu4vr4xnSDxMaL', 'sprint-qa': 'EXAVITQu4vr4xnSDxMaL', 'ui-ux-designer': 'MF3mGyEYCl7XYWbV9V5O', 'devops-engineer': 'VR6AewLTigWG4xSOukaG',
  'security-engineer': 'yoZ06aMxZJJ28mfd3POQ', 'second-opinion-reviewer': 'AZnzlk1XvdvUeBnXmlld',
};
export const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';
export const validVoice = (v) => /^[A-Za-z0-9]{10,40}$/.test(String(v || ''));

// ---------- the key ----------
const secretsFile = () => path.join(config.home, 'secrets.json');
export function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return { key: process.env.ELEVENLABS_API_KEY.trim(), source: 'environment' };
  const s = readJson(secretsFile(), null);
  return s?.elevenlabs?.key ? { key: s.elevenlabs.key, source: 'settings' } : null;
}
// what the UI may know about the key
export function keyStatus() {
  const k = apiKey();
  return k ? { set: true, last4: k.key.slice(-4), source: k.source } : { set: false, last4: '', source: '' };
}
export function setKey(key) {
  const k = String(key || '').trim();
  if (!/^[\w-]{16,200}$/.test(k)) throw bad('That does not look like an ElevenLabs API key');
  const s = readJson(secretsFile(), {}) || {};
  s.elevenlabs = { key: k, setAt: new Date().toISOString() };
  fs.mkdirSync(config.home, { recursive: true });
  fs.writeFileSync(secretsFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.chmodSync(secretsFile(), 0o600);
  return keyStatus();
}
export function clearKey() {
  const s = readJson(secretsFile(), {}) || {};
  delete s.elevenlabs;
  fs.writeFileSync(secretsFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
  return keyStatus();
}
// errors from the API never carry the key back (it is only ever sent in a header)
const scrub = (msg) => { const k = apiKey()?.key; return k ? String(msg).split(k).join('[key]') : String(msg); };

// ---------- settings and usage ----------
export function cleanSettings(v = {}) {
  const time = (t) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || '')) ? String(t) : '');
  const n = parseInt(v.budgetChars, 10);
  return { model: MODELS.includes(v.model) ? v.model : DEFAULTS.model, budgetChars: Number.isFinite(n) ? Math.max(0, Math.min(5e6, n)) : DEFAULTS.budgetChars,
    quietFrom: time(v.quietFrom), quietTo: time(v.quietTo), onlyVisible: v.onlyVisible !== false,
    mutedFloors: (Array.isArray(v.mutedFloors) ? v.mutedFloors : []).map(String).filter((x) => /^[\w-]{1,64}$/.test(x)).slice(0, 100) };
}
const usageFile = () => path.join(config.home, 'voice-usage.json');
const month = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
export function usage(now = Date.now()) {
  const u = readJson(usageFile(), {}) || {};
  return u.month === month(now) ? { month: u.month, chars: u.chars || 0, calls: u.calls || 0, cached: u.cached || 0 } : { month: month(now), chars: 0, calls: 0, cached: 0 };
}
function addUsage(chars, cached, now = Date.now()) {
  const u = usage(now);
  if (cached) u.cached++; else { u.chars += chars; u.calls++; }
  fs.mkdirSync(config.home, { recursive: true });
  fs.writeFileSync(usageFile(), JSON.stringify(u));
}
// quiet hours (local time), wrapping past midnight
export function quietNow(s, now = new Date()) {
  if (!s.quietFrom || !s.quietTo) return false;
  const m = now.getHours() * 60 + now.getMinutes(), [fh, fm] = s.quietFrom.split(':').map(Number), [th, tm] = s.quietTo.split(':').map(Number);
  const a = fh * 60 + fm, b = th * 60 + tm;
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

// ---------- what is said ----------
// a short spoken version of a message: its headline and up to two sentences, no markdown, code, tables or links
export function spokenText(text, { max = 240 } = {}) {
  const lines = String(text || '').replace(/```[\s\S]*?```/g, ' ').split('\n')
    .filter((l) => !/^\s*\|/.test(l)).map((l) => l.replace(/^\s*(#{1,6}|[-*•]|\d+[.)])\s+/, '').replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').trim()).filter(Boolean);
  const head = lines[0] || '';
  const rest = lines.slice(1).join(' ').match(/[^.!?]+[.!?]+/g) || (lines[1] ? [lines.slice(1).join(' ')] : []);
  let out = /[.!?:]$/.test(head) ? head : `${head}.`;
  for (const s of rest.slice(0, 2)) { if ((`${out} ${s.trim()}`).length > max) break; out = `${out} ${s.trim()}`; }
  return out.length > max ? `${out.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : out;
}

// ---------- cache ----------
const cacheDir = () => path.join(config.home, 'voice-cache');
export const cacheKey = (voice, model, text) => crypto.createHash('sha256').update(`${voice}\n${model}\n${text}`).digest('hex');
function cacheGet(key) { try { const f = path.join(cacheDir(), `${key}.mp3`); const b = fs.readFileSync(f); fs.utimesSync(f, new Date(), new Date()); return b; } catch { return null; } }
function cachePut(key, buf, cap = CACHE_CAP) {
  fs.mkdirSync(cacheDir(), { recursive: true });
  fs.writeFileSync(path.join(cacheDir(), `${key}.mp3`), buf);
  const files = fs.readdirSync(cacheDir()).map((f) => { const st = fs.statSync(path.join(cacheDir(), f)); return { f, size: st.size, at: st.mtimeMs }; }).sort((a, b) => a.at - b.at);
  let total = files.reduce((n, x) => n + x.size, 0);
  for (const x of files) { if (total <= cap) break; fs.rmSync(path.join(cacheDir(), x.f), { force: true }); total -= x.size; }
}

// ---------- the API (fetch is injectable for the tests) ----------
let fetchImpl = (...a) => fetch(...a);
export const setFetch = (f) => { fetchImpl = f || ((...a) => fetch(...a)); };

let voicesCache = { at: 0, list: null };
export async function voices({ fresh = false } = {}) {
  const k = apiKey();
  if (!k) return [];
  if (!fresh && voicesCache.list && Date.now() - voicesCache.at < 10 * 60e3) return voicesCache.list;
  const r = await fetchImpl(`${API}/voices`, { headers: { 'xi-api-key': k.key, accept: 'application/json' } });
  if (!r.ok) throw bad(scrub(`ElevenLabs answered ${r.status} for the voices list`));
  const j = await r.json();
  voicesCache = { at: Date.now(), list: (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, preview: v.preview_url || '', labels: v.labels || {}, category: v.category || '' })) };
  return voicesCache.list;
}

// -> { audio: Buffer, chars, cached } or { fallback: 'browser' | 'silent', reason, text }
export async function speak({ text, voice = DEFAULT_VOICE, settings = DEFAULTS, full = false, now = Date.now() } = {}) {
  const s = cleanSettings(settings);
  const said = redact(full ? String(text || '').slice(0, 3000) : spokenText(text));
  if (!said.trim()) return { fallback: 'silent', reason: 'nothing to say', text: '' };
  const k = apiKey();
  if (!k) return { fallback: 'browser', reason: 'no ElevenLabs key', text: said };
  const v = validVoice(voice) ? voice : DEFAULT_VOICE;
  const key = cacheKey(v, s.model, said);
  const hit = cacheGet(key);
  if (hit) { addUsage(said.length, true, now); return { audio: hit, chars: said.length, cached: true, text: said, voice: v }; }
  if (usage(now).chars + said.length > s.budgetChars) return { fallback: 'browser', reason: `the monthly budget of ${s.budgetChars} characters is used up`, text: said };
  const r = await fetchImpl(`${API}/text-to-speech/${v}?output_format=mp3_44100_64`, {
    method: 'POST', headers: { 'xi-api-key': k.key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: said, model_id: s.model, voice_settings: { stability: .5, similarity_boost: .75 } }),
  });
  if (!r.ok) return { fallback: 'browser', reason: scrub(`ElevenLabs answered ${r.status}`), text: said };
  const audio = Buffer.from(await r.arrayBuffer());
  cachePut(key, audio);
  addUsage(said.length, false, now);
  return { audio, chars: said.length, cached: false, text: said, voice: v };
}

// the voice an agent speaks with: its own, else its role's default, else the Building default
export const voiceFor = (agent = {}) => (validVoice(agent.voice) ? agent.voice : ROLE_VOICES[agent.lead ? 'lead' : agent.role?.template] || DEFAULT_VOICE);
