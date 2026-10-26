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
export const MODELS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v3', 'eleven_multilingual_v2'];
// models that take a language_code (multilingual v2 does not: it guesses the language from the text)
export const LANG_MODELS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v3'];
export const DEFAULTS = { model: 'eleven_flash_v2_5', budgetChars: 50000, quietFrom: '', quietTo: '', onlyVisible: true, mutedFloors: [] };
// the language an agent speaks (ISO 639-1); auto: Indonesian or English from the words of the line
export const LANGUAGES = ['auto', 'id', 'en', 'ms', 'jv', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'ko', 'zh', 'ar', 'hi'];
// ElevenLabs voice settings; defaults a little steadier than ElevenLabs' own
export const VOICE_DEFAULTS = { stability: .6, similarity_boost: .8, style: 0, use_speaker_boost: true };
export function cleanVoice(v = {}) {
  const n = (x, d) => { const f = Number(x); return Number.isFinite(f) ? Math.max(0, Math.min(1, Math.round(f * 100) / 100)) : d; };
  return { stability: n(v.stability, VOICE_DEFAULTS.stability), similarity_boost: n(v.similarity_boost, VOICE_DEFAULTS.similarity_boost),
    style: n(v.style, VOICE_DEFAULTS.style), use_speaker_boost: v.use_speaker_boost === undefined ? VOICE_DEFAULTS.use_speaker_boost : !!v.use_speaker_boost };
}
export const cleanLang = (l) => (LANGUAGES.includes(String(l || '')) ? String(l) : 'auto');
const ID_WORDS = /\b(yang|dan|saya|kamu|tidak|sudah|untuk|dengan|bisa|kami|apakah|bolehkah|ini|itu|ada|akan|sedang|belum|tugas|selesai|tolong|mau|harus|juga|karena|dari|ke|di)\b/gi;
// Indonesian when enough of the words are common Indonesian ones
export function detectLang(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length || 1;
  return (String(text || '').match(ID_WORDS) || []).length / words >= .12 ? 'id' : 'en';
}
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
  forget();
  return keyStatus();
}
export function clearKey() {
  const s = readJson(secretsFile(), {}) || {};
  delete s.elevenlabs;
  fs.writeFileSync(secretsFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
  forget();
  return keyStatus();
}
// a new key: what the old one could list or read is no longer known
function forget() { voicesCache = { at: 0, list: null }; accountCache = { at: 0, v: null }; lastError = null; }
// errors from the API never carry the key back (it is only ever sent in a header)
const scrub = (msg) => { const k = apiKey()?.key; return k ? String(msg).split(k).join('[key]') : String(msg); };

// ElevenLabs' own error: { detail: { status | code, message } } (or a string) -> { status, code, message, hint,
// permission }; the message is scrubbed and shortened. The hint says what the owner can do about it.
export const HINTS = {
  paid_plan_required: 'The free plan cannot use library voices through the API: pick a voice from My Voices (or Voice Design) and paste its id, or upgrade the plan.',
  missing_permissions: 'This API key lacks a permission: in ElevenLabs → Developers → API keys, enable text_to_speech (to speak), voices_read (to list voices) and user_read (to show the plan).',
  quota_exceeded: 'The ElevenLabs character quota of this period is used up: wait for the reset or upgrade the plan.',
  invalid_api_key: 'ElevenLabs does not accept this key: paste it again.',
  voice_not_found: 'That voice id is not on this account: pick another or paste one from My Voices.',
};
export async function apiError(r) {
  let body = '';
  try { body = await r.text(); } catch { /* none */ }
  let detail = null;
  try { detail = JSON.parse(body).detail ?? null; } catch { /* not JSON */ }
  const code = String((detail && typeof detail === 'object' && (detail.code || detail.status)) || (r.status === 401 ? 'unauthorized' : r.status === 402 ? 'payment_required' : `http_${r.status}`));
  const message = scrub(String((detail && typeof detail === 'object' ? detail.message : detail) || body || '')).replace(/\s+/g, ' ').trim().slice(0, 300);
  const permission = code === 'missing_permissions' ? (message.match(/\b(text_to_speech|voices_read|user_read|[a-z_]+_(?:read|write))\b/) || [])[1] || '' : '';
  const hint = permission ? `This API key lacks the ${permission} permission: enable it in ElevenLabs → Developers → API keys (text_to_speech to speak, voices_read to list voices, user_read to show the plan).` : HINTS[code] || '';
  return { status: r.status, code, message, hint, permission };
}
const reasonOf = (e) => `ElevenLabs ${e.status} ${e.code}${e.message ? `: ${e.message}` : ''}`;
let lastError = null;                                      // the last API error (shown in Settings → Voice)
export const lastApiError = () => lastError;
const failed = (e) => { lastError = { ...e, at: Date.now() }; return e; };

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
export const cacheKey = (voice, model, text, lang = '', vs = null) => crypto.createHash('sha256').update(`${voice}\n${model}\n${lang}\n${vs ? JSON.stringify(vs) : ''}\n${text}`).digest('hex');
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

// the account's voices -> { voices: [{ id, name, preview, labels, category, languages }], error } (error: no
// voices_read permission and the like; the owner can still paste a voice id)
let voicesCache = { at: 0, list: null };
export async function voices({ fresh = false } = {}) {
  const k = apiKey();
  if (!k) return { voices: [], error: null };
  if (!fresh && voicesCache.list && Date.now() - voicesCache.at < 10 * 60e3) return { voices: voicesCache.list, error: null };
  const r = await fetchImpl(`${API}/voices`, { headers: { 'xi-api-key': k.key, accept: 'application/json' } });
  if (!r.ok) return { voices: [], error: failed(await apiError(r)) };
  const j = await r.json();
  voicesCache = { at: Date.now(), list: (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, preview: v.preview_url || '', labels: v.labels || {}, category: v.category || '',
    languages: [...new Set([v.labels?.language, ...(v.verified_languages || []).map((x) => x.language)].filter(Boolean).map((x) => String(x).slice(0, 2).toLowerCase()))] })) };
  return { voices: voicesCache.list, error: null };
}
// the plan and what is left this period (needs user_read) -> { tier, used, limit, remaining, resetAt } or { error }
let accountCache = { at: 0, v: null };
export async function account({ fresh = false } = {}) {
  const k = apiKey();
  if (!k) return null;
  if (!fresh && accountCache.v && Date.now() - accountCache.at < 5 * 60e3) return accountCache.v;
  const r = await fetchImpl(`${API}/user/subscription`, { headers: { 'xi-api-key': k.key, accept: 'application/json' } });
  const v = r.ok ? await r.json().then((j) => ({ tier: String(j.tier || ''), used: +j.character_count || 0, limit: +j.character_limit || 0,
    remaining: Math.max(0, (+j.character_limit || 0) - (+j.character_count || 0)), resetAt: j.next_character_count_reset_unix ? j.next_character_count_reset_unix * 1000 : 0 })) : { error: await apiError(r) };
  accountCache = { at: Date.now(), v };
  return v;
}

// lang: auto | an ISO code; vs: voice settings (stability, similarity_boost, style, use_speaker_boost)
// -> { audio: Buffer, chars, cached, lang } or { fallback: 'browser' | 'silent', reason, text, error }
export async function speak({ text, voice = DEFAULT_VOICE, settings = DEFAULTS, full = false, lang = 'auto', vs = VOICE_DEFAULTS, now = Date.now() } = {}) {
  const s = cleanSettings(settings);
  const said = redact(full ? String(text || '').slice(0, 3000) : spokenText(text));
  if (!said.trim()) return { fallback: 'silent', reason: 'nothing to say', text: '' };
  const k = apiKey();
  if (!k) return { fallback: 'browser', reason: 'no ElevenLabs key', text: said };
  const v = validVoice(voice) ? voice : DEFAULT_VOICE;
  const language = cleanLang(lang) === 'auto' ? detectLang(said) : cleanLang(lang);
  const code = LANG_MODELS.includes(s.model) ? language : '';             // only the models that take it
  const vset = cleanVoice(vs);
  const key = cacheKey(v, s.model, said, code, vset);
  const hit = cacheGet(key);
  if (hit) { addUsage(said.length, true, now); return { audio: hit, chars: said.length, cached: true, text: said, voice: v, lang: language }; }
  if (usage(now).chars + said.length > s.budgetChars) return { fallback: 'browser', reason: `the monthly budget of ${s.budgetChars} characters is used up`, text: said };
  const r = await fetchImpl(`${API}/text-to-speech/${v}?output_format=mp3_44100_64`, {
    method: 'POST', headers: { 'xi-api-key': k.key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: said, model_id: s.model, ...(code ? { language_code: code } : {}), voice_settings: vset }),
  });
  if (!r.ok) { const e = failed(await apiError(r)); return { fallback: 'browser', reason: reasonOf(e), error: e, text: said }; }
  const audio = Buffer.from(await r.arrayBuffer());
  cachePut(key, audio);
  addUsage(said.length, false, now);
  lastError = null;
  return { audio, chars: said.length, cached: false, text: said, voice: v, lang: language };
}

// the voice an agent speaks with: its own, else its role's default, else the Building default
export const voiceFor = (agent = {}) => (validVoice(agent.voice) ? agent.voice : ROLE_VOICES[agent.lead ? 'lead' : agent.role?.template] || DEFAULT_VOICE);
