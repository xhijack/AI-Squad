// Lead shout (from squad-3d): when every agent of the Floor in view has been idle for 20 s, the lead shows a
// speech bubble and, if the owner turned voice on, says it with speechSynthesis. Repeats every 2 to 3 minutes,
// at most 6 times per idle period.
import { t, LANG } from './i18n.js';

export const FIRST_AFTER = 20e3, MAX_SHOUTS = 6;
const SHOUTS = [
  t('Boss! We are idle. Any new work for us?'),
  t('Boss, everything on our list is done. What is next?'),
  t('Hello boss? The whole team is waiting for orders.'),
  t('Boss, we are playing ping pong now. Got anything for us?'),
  t('Boss! We are ready to work again whenever you are.'),
];

// s: per-Floor state; idle: the lead runs and nobody works or waits. Returns the text to shout now, or null.
export function shoutStep(s, idle, now, rnd = Math.random) {
  if (!idle) { s.idleSince = null; return null; }
  if (s.idleSince == null) Object.assign(s, { idleSince: now, next: now + FIRST_AFTER, count: 0 });
  if (now < s.next || s.count >= MAX_SHOUTS) return null;
  const text = SHOUTS[s.count % SHOUTS.length];
  s.count++;
  s.next = now + 120e3 + rnd() * 60e3;
  return text;
}

export function floorIdle(f) {
  const agents = f?.agents || [];
  const lead = agents.find((a) => a.lead) || agents.find((a) => a.kindOf === 'lead');
  if (!lead || !lead.running) return { idle: false, lead: null };
  return { idle: agents.every((a) => a.state === 'idle' || a.state === 'stopped'), lead };
}

const VOICE_KEY = 'aisquad.voice';
export const voiceOn = () => { try { return localStorage.getItem(VOICE_KEY) === 'on'; } catch { return false; } };
export function setVoice(on) { try { localStorage.setItem(VOICE_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } }

export function speak(text) {
  if (!voiceOn() || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => (LANG === 'id' ? /^id/i : /^en/i).test(x.lang));   // the UI language's voice
    if (v) u.voice = v;
    u.lang = v ? v.lang : LANG === 'id' ? 'id-ID' : 'en-US'; u.rate = 1.05; u.pitch = 1.1; u.volume = .9;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* the browser refuses speech before any interaction */ }
}
