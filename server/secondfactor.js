// SPDX-License-Identifier: Apache-2.0
// The Owner's second factor (1.9): a one-time code sent to the Owner's paired Telegram chat. In public mode an Owner
// session must pass it once before owner-level actions (settings, secrets, people, merges, Owner-only Spaces). It is
// on whenever the Owner has a paired Telegram chat, unless building.json prefs.secondFactor is false. A code is 6
// digits, lives 5 minutes, allows 5 tries and is kept only as a hash, in memory.
import crypto from 'node:crypto';

export const CODE_MS = 5 * 60e3, TRIES = 5, RESEND_MS = 30e3;
const codes = new Map();                        // session key -> { hash, exp, tries, sentAt }
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const reset = () => codes.clear();

export const enabled = ({ setting, paired }) => setting !== false && !!paired;
// does this request need the second factor first?
export function needed({ isPublic, user, need, ownerSpace = false, session, on }) {
  if (!isPublic || !on || user?.role !== 'owner' || !session) return false;      // local tools sign in with the PIN header, no session
  return (need === 'owner' || ownerSpace) && !session.secondAt;
}

// sendFn(text) -> number of chats that got it
export async function send(key, { sendFn, now = Date.now(), lang = 'en' }) {
  const prev = codes.get(key);
  if (prev && now - prev.sentAt < RESEND_MS) return { ok: true, resent: false, expiresAt: prev.exp };
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const text = lang === 'id' ? `Kode masuk The AI Squad: ${code} (berlaku 5 menit). Jangan bagikan kode ini.` : `The AI Squad sign-in code: ${code} (valid for 5 minutes). Do not share it.`;
  const n = await sendFn(text);
  if (!n) throw Object.assign(new Error('The code could not be sent: pair the Owner\'s Telegram chat first'), { status: 503 });
  codes.set(key, { hash: sha(code), exp: now + CODE_MS, tries: 0, sentAt: now });
  return { ok: true, resent: true, expiresAt: now + CODE_MS };
}
// -> true once for the right code in time
export function verify(key, code, now = Date.now()) {
  const c = codes.get(key);
  if (!c) return false;
  if (c.exp < now || c.tries >= TRIES) { codes.delete(key); return false; }
  c.tries++;
  const a = Buffer.from(sha(String(code || '').trim()), 'hex'), b = Buffer.from(c.hash, 'hex');
  if (!crypto.timingSafeEqual(a, b)) { if (c.tries >= TRIES) codes.delete(key); return false; }
  codes.delete(key);
  return true;
}
