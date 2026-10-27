// SPDX-License-Identifier: Apache-2.0
// The Notification Gateway (0.15): what reaches a person away from the screen, and what they can do from there.
// Telegram is the first channel (server/telegram.js); the decisions live here so other channels can follow.
//   - Attention that needs a person (questions, permissions, replies, crashes, resources, scope, backups) goes out
//     at once with buttons; the rest waits for the morning digest. Quiet hours hold all but resource alerts.
//   - Every action from Telegram goes through the same functions as the browser, as the paired person, with the
//     same role checks. Hard-stop items (money, legal, production, secrets, irreversible) need a 4-digit code.
//   - Messages carry a redacted summary only: no secrets, no personal data, no contract text. Details stay in the UI.
//   - Pairing: a one-time code from the UI (PIN), sent to the bot as /start CODE. Other chats are ignored.
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson, bad, notFound } from './util.js';
import * as building from './building.js';
import * as floors from './floors.js';
import * as squad from './squad.js';
import * as squadLog from './log.js';
import * as auth from './auth.js';
import * as tg from './telegram.js';
import * as users from './users.js';
import * as access from './access.js';
import * as autopilot from './autopilot.js';
import * as dispatcher from './dispatcher.js';
import { redact } from './redact.js';
import * as insight from './insight.js';

export const IMMEDIATE = ['question', 'permission', 'reply', 'crash', 'resource', 'scope', 'backup'];
export const DEFAULTS = { enabled: false, lang: 'en', quiet: { enabled: true, from: '22:00', to: '07:00' }, digestAt: '07:30', maxPerHour: 20, immediate: IMMEDIATE, publicUrl: '' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN_MS = 24 * 3600e3, CODE_MS = 5 * 60e3, PAIR_MS = 10 * 60e3;
const file = () => path.join(config.home, 'notify.json');

export function cleanNotify(n = {}) {
  const t = (v, d) => (TIME.test(String(v)) ? v : d);
  const max = parseInt(n?.maxPerHour, 10);
  const url = String(n?.publicUrl || '').trim();
  if (url && !/^https?:\/\/[^\s]+$/.test(url)) throw bad('The address must start with http:// or https://');
  return {
    enabled: n?.enabled === true, lang: n?.lang === 'id' ? 'id' : 'en',
    quiet: { enabled: n?.quiet?.enabled !== false, from: t(n?.quiet?.from, DEFAULTS.quiet.from), to: t(n?.quiet?.to, DEFAULTS.quiet.to) },
    digestAt: t(n?.digestAt, DEFAULTS.digestAt), maxPerHour: Number.isFinite(max) ? Math.max(1, Math.min(200, max)) : DEFAULTS.maxPerHour,
    immediate: Array.isArray(n?.immediate) ? n.immediate.filter((k) => /^[a-z-]{2,20}$/.test(k)) : IMMEDIATE, publicUrl: url.replace(/\/+$/, ''),
  };
}
export const settings = () => cleanNotify(building.loadBuilding().prefs.notify);

// the bot's own words (the browser has its i18n tables; Telegram gets these two)
const TEXT = {
  en: { paired: 'Paired with The AI Squad as {name} ({role}). You get questions and alerts here. /help lists the commands.', badCode: 'That pairing code is wrong or expired. Make a new one in Admin → Notifications.',
    help: 'Commands:\n/status what the squad is doing\n/chat <agent> talk to an agent directly (then just type)\n/end stop chatting\n/digest the summary now\n/help this list',
    reply: 'Type your reply to {agent}.', confirm: 'Hard stop ({reasons}). Type {code} within 5 minutes to confirm "{choice}". Anything else cancels.', cancelled: 'Cancelled: nothing was sent.',
    done: 'Done: {choice}', gone: 'Already answered or no longer open.', noRole: 'Your role ({role}) can only read.', expired: 'This button has expired. Open The AI Squad.',
    chatOn: 'Chatting with {agent} in {space}. Type your message; /end stops.', chatOff: 'Chat ended.', noAgent: 'No agent called "{q}". Try its name or id.', many: 'Several agents match: {list}',
    sent: 'Sent to {agent}.', queued: 'Queued ({reason}); {agent} answers when there is room.', digestTitle: 'Summary for {day}', nothingOpen: 'Nothing waits for you.', open: 'Waiting for you ({n}):',
    lastDay: 'Last 24 hours: {done} background jobs done, {failed} failed, ${cost} spent; {stops} idle agents stopped; {chats} chat answers.', suggestions: '{n} new improvement suggestions in Admin → Improvements.',
    status: '{working} working, {waiting} waiting for you, {queued} queued, {slots} free slots.', replyBtn: 'Reply', dismissBtn: 'Dismiss', openBtn: 'Open', test: 'Test message from The AI Squad.' },
  id: { paired: 'Terhubung ke The AI Squad sebagai {name} ({role}). Pertanyaan dan peringatan akan dikirim ke sini. /help untuk daftar perintah.', badCode: 'Kode pairing salah atau kedaluwarsa. Buat kode baru di Admin → Notifikasi.',
    help: 'Perintah:\n/status apa yang sedang dikerjakan squad\n/chat <agent> bicara langsung dengan agent (lalu ketik saja)\n/end berhenti chat\n/digest ringkasan sekarang\n/help daftar ini',
    reply: 'Ketik balasanmu untuk {agent}.', confirm: 'Hard stop ({reasons}). Ketik {code} dalam 5 menit untuk mengonfirmasi "{choice}". Ketikan lain membatalkan.', cancelled: 'Dibatalkan: tidak ada yang dikirim.',
    done: 'Selesai: {choice}', gone: 'Sudah dijawab atau tidak terbuka lagi.', noRole: 'Peranmu ({role}) hanya bisa membaca.', expired: 'Tombol ini sudah kedaluwarsa. Buka The AI Squad.',
    chatOn: 'Chat dengan {agent} di {space}. Ketik pesanmu; /end untuk berhenti.', chatOff: 'Chat selesai.', noAgent: 'Tidak ada agent bernama "{q}". Coba nama atau id-nya.', many: 'Beberapa agent cocok: {list}',
    sent: 'Terkirim ke {agent}.', queued: 'Masuk antrean ({reason}); {agent} menjawab saat ada slot.', digestTitle: 'Ringkasan {day}', nothingOpen: 'Tidak ada yang menunggumu.', open: 'Menunggumu ({n}):',
    lastDay: '24 jam terakhir: {done} job latar belakang selesai, {failed} gagal, ${cost} terpakai; {stops} agent diam dihentikan; {chats} jawaban chat.', suggestions: '{n} saran perbaikan baru di Admin → Perbaikan.',
    status: '{working} bekerja, {waiting} menunggumu, {queued} antre, {slots} slot kosong.', replyBtn: 'Balas', dismissBtn: 'Tutup', openBtn: 'Buka', test: 'Pesan uji dari The AI Squad.' },
};
export const say = (key, vars = {}, lang = settings().lang) => String((TEXT[lang] || TEXT.en)[key] || TEXT.en[key]).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

// ---------- state ----------
export function loadState() {
  const s = readJson(file(), {}) || {};
  return { offset: 0, chats: [], pairing: null, sent: {}, tokens: {}, pending: {}, hourly: [], lastDigest: '', lastError: '', ...s };
}
const saveState = (s) => writeJson(file(), s, 0o600);
function update(fn) { const s = loadState(); const r = fn(s); saveState(s); return r; }

export function tokenStatus() {
  const t = auth.readSecret('telegram');
  return t?.token ? { set: true, last4: t.token.slice(-4), bot: t.bot || '', setAt: t.setAt } : { set: false, last4: '', bot: '', setAt: null };
}
export async function setToken(token, { check = true, fetchFn } = {}) {
  const t = String(token || '').trim();
  if (!tg.validToken(t)) throw bad('That does not look like a Telegram bot token (123456:ABC…)');
  let bot = '';
  if (check) { try { bot = (await tg.getMe(t, { fetchFn })).username || ''; } catch (e) { throw bad(`Telegram refused the token: ${e.message}`); } }
  auth.writeSecret('telegram', { token: t, bot, setAt: new Date().toISOString() });
  restart();
  return tokenStatus();
}
export function clearToken() { auth.writeSecret('telegram', null); stop(); return tokenStatus(); }
const botToken = () => auth.readSecret('telegram')?.token || '';

// a pairing code for the person asking (shown in the UI, sent to the bot as /start CODE)
export function newPairing(user, now = Date.now()) {
  if (!user) throw bad('Sign in with your PIN first');
  const code = String(crypto.randomInt(100000, 999999));
  update((s) => { s.pairing = { code, userId: user.id, exp: now + PAIR_MS }; });
  return { code, expiresAt: now + PAIR_MS, bot: tokenStatus().bot };
}
export function removeChat(chatId) {
  return update((s) => { const n = s.chats.length; s.chats = s.chats.filter((c) => String(c.chatId) !== String(chatId)); if (s.chats.length === n) throw notFound('Chat not found'); return { ok: true }; });
}
export function status() {
  const s = loadState();
  return { settings: settings(), token: tokenStatus(), running: !!poller, chats: s.chats.map(({ chatId, name, userId, pairedAt }) => ({ chatId, name, userId, pairedAt, user: userOf(userId)?.name || '(removed)' })),
    lastDigest: s.lastDigest, lastError: s.lastError, sentToday: s.hourly.filter((t) => Date.now() - t < 24 * 3600e3).length };
}
const userOf = (id) => users.listUsers().find((u) => u.id === id) || null;

// ---------- what goes out ----------
const hhmm = (now) => { const d = new Date(now); return d.getHours() * 60 + d.getMinutes(); };
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export function inQuiet(q, now = Date.now()) {
  if (!q?.enabled) return false;
  const t = hhmm(now), a = mins(q.from), b = mins(q.to);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}
const isCritical = (item) => !!item.hardStop?.length || !!item.autopilot?.critical || (['question', 'permission', 'reply'].includes(item.kind) && autopilot.classify(item.text, { level: 'full' }).reasons.some((r) => r !== 'unclear'));
const reasonsOf = (item) => [...new Set([...(item.hardStop || []), ...(item.autopilot?.reasons || []), ...autopilot.classify(item.text, { level: 'full' }).reasons])].filter((r) => r !== 'unclear');
const short = (s, n) => { const t = redact(String(s || '').replace(/\s+/g, ' ').trim()); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const KIND = { question: 'Question', permission: 'Permission', reply: 'Waiting for your reply', crash: 'Stopped unexpectedly', resource: 'Machine', scope: 'Scope change', backup: 'Backup', finished: 'Finished', taskdone: 'Task done', stall: 'Stalled', merge: 'Merge', budget: 'Budget', decided: 'Decided by Autopilot', price: 'Price approval', handoff: 'Handoff', erpnext: 'ERPNext' };

// a person may see this item: Owner-only Spaces only for the Owner
const visible = (item, user) => user && (user.role === 'owner' || (!item.ownerOnly && !access.ownerFloors().has(item.floorId)));

export function messageFor(item, tok, s = settings()) {
  const where = [item.floorName || item.floorId, item.agentName].filter(Boolean).join(' · ');
  // a price approval: only its first line (customer, total) travels; the lines and the note are opened in the app
  const lines = [`[${KIND[item.kind] || item.kind}] ${where}`.trim(), short(item.kind === 'price' ? String(item.text).split('\n')[0] : item.text, 600)];
  const opts = (item.options || []).filter((o) => !o.free).slice(0, 6);
  if (opts.length) lines.push('', ...opts.map((o) => `${o.n}. ${short(o.label, 80)}`));
  if (isCritical(item)) lines.push('', `Hard stop: ${reasonsOf(item).join(', ') || 'critical'}`);
  const buttons = [];
  if (tok) {
    if (opts.length) for (let i = 0; i < opts.length; i += 3) buttons.push(opts.slice(i, i + 3).map((o) => ({ text: `${o.n}. ${short(o.label, 24)}`, data: `a:${tok}:${o.n}` })));
    const row = [];
    if (['question', 'permission', 'reply', 'finished', 'decided', 'price'].includes(item.kind) || (item.kind === 'handoff' && item.mode === 'question')) row.push({ text: say('replyBtn', {}, s.lang), data: `r:${tok}` });
    if (item.kind === 'crash') buttons.push([{ text: 'Resume', data: `a:${tok}:1` }, { text: 'Start fresh', data: `a:${tok}:2` }]);
    if (!['question', 'permission', 'price'].includes(item.kind) && !(item.kind === 'handoff' && item.mode === 'held')) row.push({ text: say('dismissBtn', {}, s.lang), data: `x:${tok}` });   // a price is approved or sent back, never dismissed     // a dialog is answered, not dismissed
    if (s.publicUrl) row.push({ text: say('openBtn', {}, s.lang), url: item.floorId ? `${s.publicUrl}/#/floor/${item.floorId}${item.agentId ? `/agent/${item.agentId}` : ''}` : `${s.publicUrl}/` });
    buttons.push(row);
  }
  return { text: lines.join('\n'), buttons };
}

// the morning digest for one person: what still waits, and what happened in the last day
export function digestFor(user, { items = deps.items(), now = Date.now(), lang = settings().lang } = {}) {
  const mine = items.filter((i) => visible(i, user));
  const from = now - 24 * 3600e3;
  let done = 0, failed = 0, cost = 0, stops = 0, chats = 0;
  for (const f of building.loadBuilding().floors) {
    if (!visible({ floorId: f.id }, user)) continue;
    for (const e of squadLog.read(f.id, { from, to: now, type: 'job.ended,dispatch.idle-stopped,chat.reply' })) {
      if (e.type === 'job.ended') { if (e.data.status === 'done') done++; else if (e.data.status === 'failed') failed++; cost += +e.data.cost || 0; }
      else if (e.type === 'dispatch.idle-stopped') stops++;
      else chats++;
    }
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const lines = [say('digestTitle', { day }, lang), ''];
  if (!mine.length) lines.push(say('nothingOpen', {}, lang));
  else lines.push(say('open', { n: mine.length }, lang), ...mine.slice(0, 10).map((i) => `- ${[i.floorName, i.agentName].filter(Boolean).join(' · ')}: ${short(i.text, 90)}`));
  lines.push('', say('lastDay', { done, failed, cost: cost.toFixed(2), stops, chats }, lang));
  const fresh = insightsCount(from);
  if (fresh && user.role === 'owner') lines.push(say('suggestions', { n: fresh }, lang));
  return lines.join('\n');
}
const insightsCount = (since) => insight.newSince(since);

const send = (chatId, text, buttons, fetchFn) => tg.sendMessage(botToken(), chatId, text, { buttons, fetchFn });

// every 15 s: send what is new, take the buttons off what was answered elsewhere, the digest once a day
export async function notifyTick(now = Date.now(), { fetchFn } = {}) {
  const s = settings();
  const out = { sent: 0, cleared: 0, digest: 0 };
  if (!s.enabled || !botToken()) return out;
  const st = loadState();
  if (!st.chats.length) return out;
  const items = deps.items();
  const open = new Set(items.map((i) => i.id));
  st.hourly = st.hourly.filter((t) => now - t < 3600e3);
  const quiet = inQuiet(s.quiet, now);
  for (const item of items) {
    if (st.sent[item.id]) continue;
    const urgent = s.immediate.includes(item.kind) || item.autopilot?.critical || ['price', 'handoff', 'erpnext'].includes(item.kind);
    if (!urgent) { st.sent[item.id] = { ts: now, digest: true, msgs: [] }; continue; }       // waits for the digest
    if (quiet && item.kind !== 'resource') continue;                                         // after the quiet hours
    if (st.hourly.length >= s.maxPerHour) break;
    const tok = crypto.randomBytes(5).toString('hex');
    st.tokens[tok] = { itemId: item.id, floorId: item.floorId || '', agentId: item.agentId || '', kind: item.kind, ownerOnly: !!item.ownerOnly, critical: isCritical(item), reasons: reasonsOf(item),
      options: (item.options || []).map(({ n, label }) => ({ n, label: String(label).slice(0, 200) })), agentName: item.agentName || '', exp: now + TOKEN_MS };
    const msgs = [];
    for (const c of st.chats) {
      const user = userOf(c.userId);
      if (!visible(item, user)) continue;
      const m = messageFor(item, user.role === 'viewer' ? null : tok, s);
      try { const r = await send(c.chatId, m.text, m.buttons, fetchFn); msgs.push({ chatId: c.chatId, messageId: r.message_id }); st.hourly.push(now); out.sent++; }
      catch (e) { st.lastError = `${new Date(now).toISOString()} ${e.message}`; }
    }
    st.sent[item.id] = { ts: now, msgs, tok };
  }
  for (const [id, x] of Object.entries(st.sent)) {
    if (open.has(id)) continue;
    if (!x.cleared && x.msgs?.length) { for (const m of x.msgs) { try { await tg.clearButtons(botToken(), m.chatId, m.messageId, { fetchFn }); out.cleared++; } catch { /* already gone */ } } x.cleared = true; }
    if (now - x.ts > 2 * 864e5) delete st.sent[id];
  }
  for (const [k, t] of Object.entries(st.tokens)) if (t.exp < now) delete st.tokens[k];
  const today = new Date(now - new Date(now).getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
  if (st.lastDigest !== today && hhmm(now) >= mins(s.digestAt) && !quiet) {
    st.lastDigest = today;
    for (const c of st.chats) { const u = userOf(c.userId); if (!u) continue; try { await send(c.chatId, digestFor(u, { items, now, lang: s.lang }), [], fetchFn); out.digest++; } catch (e) { st.lastError = e.message; } }
  }
  saveState(st);
  return out;
}

export async function sendTest({ fetchFn } = {}) {
  const st = loadState();
  if (!botToken()) throw bad('Set the bot token first');
  if (!st.chats.length) throw bad('No chat is paired yet');
  for (const c of st.chats) await send(c.chatId, say('test'), [], fetchFn);
  return { ok: true, chats: st.chats.length };
}
export async function sendDigestNow(user, { fetchFn } = {}) {
  const st = loadState();
  const chats = st.chats.filter((c) => !user || c.userId === user.id || user.role === 'owner');
  for (const c of chats) { const u = userOf(c.userId); if (u) await send(c.chatId, digestFor(u), [], fetchFn); }
  return { ok: true, chats: chats.length };
}

// ---------- what comes in ----------
const asUser = (user, fn) => access.actorStore.run({ user }, fn);
// what an action from Telegram calls: the same functions as the browser (tests swap them)
export const deps = { answer: (...a) => squad.answerAttention(...a), chat: (...a) => squad.sendChat(...a), items: () => squad.attentionItems() };
function findAgents(q, user) {
  const s = String(q || '').trim().toLowerCase();
  const out = [];
  for (const f of building.loadBuilding().floors) {
    if (!visible({ floorId: f.id }, user)) continue;
    let cfg; try { cfg = floors.readFloor(f.path); } catch { continue; }
    for (const a of cfg.team.agents) if (a.id === s || a.displayName.toLowerCase().includes(s)) out.push({ floorId: f.id, space: cfg.floor.name, agentId: a.id, name: a.displayName });
  }
  return out;
}

export async function handleUpdate(u, { fetchFn, now = Date.now() } = {}) {
  const lang = settings().lang;
  const reply = (chatId, key, vars, buttons) => send(chatId, say(key, vars, lang), buttons, fetchFn);
  if (u.callback_query) return handleCallback(u.callback_query, { fetchFn, now, lang });
  const m = u.message;
  if (!m?.chat || typeof m.text !== 'string') return null;
  const chatId = m.chat.id, text = m.text.trim();
  const st = loadState();
  const chat = st.chats.find((c) => String(c.chatId) === String(chatId));
  // pairing
  const start = text.match(/^\/start(?:@\w+)?\s+(\d{6})$/);
  if (start) {
    const p = st.pairing;
    if (!p || p.exp < now || p.code !== start[1]) return reply(chatId, 'badCode');
    const user = userOf(p.userId);
    if (!user) return reply(chatId, 'badCode');
    update((s) => { s.pairing = null; s.chats = [...s.chats.filter((c) => String(c.chatId) !== String(chatId)), { chatId, userId: user.id, name: [m.from?.first_name, m.from?.username && `@${m.from.username}`].filter(Boolean).join(' ') || String(chatId), pairedAt: now }]; });
    return reply(chatId, 'paired', { name: user.name, role: user.role });
  }
  if (!chat) return null;                                     // strangers get nothing
  const user = userOf(chat.userId);
  if (!user) return null;
  const pend = st.pending[chatId];
  if (/^\/help/.test(text) || /^\/start/.test(text)) return reply(chatId, 'help');
  if (/^\/status/.test(text)) {
    const b = squad.buildingSnapshot();
    const agents = b.floors.filter((f) => visible({ floorId: f.id }, user)).flatMap((f) => f.agents);
    return reply(chatId, 'status', { working: agents.filter((a) => a.state === 'working').length, waiting: b.attention.filter((i) => visible(i, user)).length, queued: dispatcher.load().length, slots: Math.max(0, b.limits.maxAgents - b.limits.running) });
  }
  if (/^\/digest/.test(text)) return send(chatId, digestFor(user, { now, lang }), [], fetchFn);
  if (/^\/end/.test(text)) { update((s) => { delete s.pending[chatId]; }); return reply(chatId, 'chatOff'); }
  const chatCmd = text.match(/^\/chat(?:@\w+)?\s+(.+)$/);
  if (chatCmd) {
    if (user.role === 'viewer') return reply(chatId, 'noRole', { role: user.role });
    const hits = findAgents(chatCmd[1], user);
    if (!hits.length) return reply(chatId, 'noAgent', { q: chatCmd[1] });
    if (hits.length > 1 && !hits.some((h) => h.agentId === chatCmd[1].trim())) return reply(chatId, 'many', { list: hits.slice(0, 8).map((h) => `${h.agentId} (${h.space})`).join(', ') });
    const h = hits.find((x) => x.agentId === chatCmd[1].trim()) || hits[0];
    update((s) => { s.pending[chatId] = { mode: 'chat', floorId: h.floorId, agentId: h.agentId, agentName: h.name, exp: now + TOKEN_MS }; });
    return reply(chatId, 'chatOn', { agent: h.name, space: h.space });
  }
  if (!pend || pend.exp < now) { if (pend) update((s) => { delete s.pending[chatId]; }); return reply(chatId, 'help'); }
  if (pend.mode === 'confirm') {
    update((s) => { delete s.pending[chatId]; });
    if (text !== pend.code) return reply(chatId, 'cancelled');
    return answer(chatId, user, pend.tok, pend.option, pend.text, { fetchFn, lang, tokens: st.tokens });
  }
  if (pend.mode === 'reply') {
    const t = st.tokens[pend.tok];
    update((s) => { delete s.pending[chatId]; });
    if (!t) return reply(chatId, 'expired');
    if (t.critical) return askCode(chatId, pend.tok, t, 0, text, { fetchFn, lang, now });
    return answer(chatId, user, pend.tok, 0, text, { fetchFn, lang, tokens: st.tokens });
  }
  if (pend.mode === 'chat') {
    const r = await asUser(user, () => deps.chat(pend.floorId, pend.agentId, text, { context: 'space', user }));
    update((s) => { if (s.pending[chatId]) s.pending[chatId].exp = now + TOKEN_MS; });
    return r.delivery === 'queued' ? reply(chatId, 'queued', { reason: r.dispatch.reason, agent: pend.agentName }) : reply(chatId, 'sent', { agent: pend.agentName });
  }
  return null;
}

async function askCode(chatId, tok, t, option, text, { fetchFn, lang, now = Date.now() }) {
  const code = String(crypto.randomInt(1000, 9999));
  const choice = option ? (t.options.find((o) => o.n === option)?.label || String(option)) : short(text, 60);
  update((s) => { s.pending[chatId] = { mode: 'confirm', tok, option, text, code, exp: now + CODE_MS }; });
  return send(chatId, say('confirm', { reasons: t.reasons.join(', ') || 'critical', code, choice }, lang), [], fetchFn);
}

async function answer(chatId, user, tok, option, text, { fetchFn, lang, tokens }) {
  const t = tokens[tok];
  if (!t) return send(chatId, say('expired', {}, lang), [], fetchFn);
  try {
    await asUser(user, () => deps.answer(t.itemId, option, text || '', { floorId: t.floorId, agentId: t.agentId, kind: t.kind }));
  } catch (e) {
    if (e.status === 409) return send(chatId, say('gone', {}, lang), [], fetchFn);
    throw e;
  }
  const choice = option ? (t.options.find((o) => o.n === option)?.label || String(option)) : text ? short(text, 60) : say('dismissBtn', {}, lang);
  return send(chatId, say('done', { choice }, lang), [], fetchFn);
}

async function handleCallback(q, { fetchFn, now, lang }) {
  const chatId = q.message?.chat?.id;
  const st = loadState();
  const chat = st.chats.find((c) => String(c.chatId) === String(chatId));
  const ack = (text) => tg.answerCallback(botToken(), q.id, text, { fetchFn }).catch(() => null);
  if (!chat) return ack('');
  const user = userOf(chat.userId);
  const [act, tok, n] = String(q.data || '').split(':');
  const t = st.tokens[tok];
  if (!user || !t || t.exp < now) return ack(say('expired', {}, lang));
  if (user.role === 'viewer') return ack(say('noRole', { role: user.role }, lang));
  if (!visible({ floorId: t.floorId, ownerOnly: t.ownerOnly }, user)) return ack(say('expired', {}, lang));
  if (act === 'r') { update((s) => { s.pending[chatId] = { mode: 'reply', tok, exp: now + TOKEN_MS }; }); await ack(''); return send(chatId, say('reply', { agent: t.agentName || 'the agent' }, lang), [], fetchFn); }
  if (act === 'x') { await ack(''); return answer(chatId, user, tok, 0, '', { fetchFn, lang, tokens: st.tokens }); }
  if (act === 'a') {
    const option = Number(n);
    await ack('');
    if (t.critical) return askCode(chatId, tok, t, option, '', { fetchFn, lang, now });
    return answer(chatId, user, tok, option, '', { fetchFn, lang, tokens: st.tokens });
  }
  return ack('');
}

// an agent's chat answer goes back to the chats talking to it
export async function forwardChatReply({ floorId, agentId, text, agentName }, { fetchFn } = {}) {
  if (!botToken()) return 0;
  const st = loadState();
  let n = 0;
  for (const [chatId, p] of Object.entries(st.pending)) {
    if (p.mode !== 'chat' || p.floorId !== floorId || p.agentId !== agentId) continue;
    try { await send(chatId, `${agentName || agentId}: ${short(text, 3500)}`, [], fetchFn); n++; } catch { /* next time */ }
  }
  return n;
}

// ---------- the poller ----------
let poller = null;
export function start({ fetchFn } = {}) {
  stop();
  const token = botToken();
  if (!token || !settings().enabled) return false;
  poller = tg.startPoller(token, (u) => handleUpdate(u, { fetchFn }), { fetchFn, getOffset: () => loadState().offset, setOffset: (o) => update((s) => { s.offset = o; }) });
  return true;
}
export function stop() { if (poller) { poller.stop(); poller = null; } }
export function restart() { stop(); return start(); }
squad.bus.on('chat.reply', (r) => { forwardChatReply(r).catch(() => {}); });
