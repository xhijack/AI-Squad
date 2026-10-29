// SPDX-License-Identifier: Apache-2.0
// The Telegram adapter of the Notification Gateway (0.15). The Bot API over HTTPS with Node's own fetch: long
// polling (getUpdates), so the machine only makes outgoing connections — no open port, no public address.
// Everything that decides what to send lives in server/notify.js; this file only talks to Telegram.
import { config } from './config.js';

export const API = () => config.telegramApi || 'https://api.telegram.org';
export const validToken = (t) => /^\d{5,12}:[\w-]{30,60}$/.test(String(t || ''));
export const MAX_TEXT = 4000;                 // Telegram allows 4096 characters per message
export const MAX_CALLBACK = 64;               // bytes of callback_data

async function call(token, method, body = {}, { fetchFn = fetch, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(`${API()}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw Object.assign(new Error(j.description || `Telegram ${method} failed (${r.status})`), { code: j.error_code || r.status, retryAfter: j.parameters?.retry_after || 0 });
    return j.result;
  } finally { clearTimeout(timer); }
}

const clip = (s) => (String(s).length > MAX_TEXT ? `${String(s).slice(0, MAX_TEXT - 1)}…` : String(s));
// buttons: [[{ text, data }]] rows of inline buttons; data must fit 64 bytes
export function keyboard(rows = []) {
  const out = rows.map((r) => r.filter(Boolean).map((b) => (b.url ? { text: b.text.slice(0, 60), url: b.url } : { text: b.text.slice(0, 60), callback_data: b.data }))).filter((r) => r.length);
  for (const r of out) for (const b of r) if (b.callback_data && Buffer.byteLength(b.callback_data) > MAX_CALLBACK) throw new Error('callback_data longer than 64 bytes');
  return out.length ? { inline_keyboard: out } : undefined;
}

export const getMe = (token, o) => call(token, 'getMe', {}, o);
export const sendMessage = (token, chatId, text, { buttons = [], fetchFn } = {}) =>
  call(token, 'sendMessage', { chat_id: chatId, text: clip(text), disable_web_page_preview: true, ...(keyboard(buttons) ? { reply_markup: keyboard(buttons) } : {}) }, { fetchFn });
export const answerCallback = (token, id, text = '', o) => call(token, 'answerCallbackQuery', { callback_query_id: id, text: String(text).slice(0, 190) }, o);
export const clearButtons = (token, chatId, messageId, o) => call(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }, o);
// long poll: waits up to `timeout` seconds for updates after `offset`
export const getUpdates = (token, offset, { timeout = 25, fetchFn } = {}) =>
  call(token, 'getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query'] }, { fetchFn, timeoutMs: (timeout + 10) * 1000 });

// the poller: runs until stop(); every update goes to onUpdate. Errors back off (and honour retry_after).
export function startPoller(token, onUpdate, { getOffset, setOffset, fetchFn, log = console } = {}) {
  let stopped = false, backoff = 1000;
  (async () => {
    while (!stopped) {
      try {
        const updates = await getUpdates(token, getOffset(), { fetchFn });
        backoff = 1000;
        for (const u of updates) {
          setOffset(u.update_id + 1);
          try { await onUpdate(u); } catch (e) { log.error('[telegram] update', e.message); }
        }
      } catch (e) {
        if (stopped) break;
        log.error('[telegram]', e.message);
        await new Promise((r) => setTimeout(r, e.retryAfter ? e.retryAfter * 1000 : backoff));
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  })();
  return { stop: () => { stopped = true; } };
}
