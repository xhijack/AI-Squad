// "Waiting for your reply": an agent ended its turn with a plain-text message that asks the owner for
// something (questions, approvals, documents, a next step for the owner). A cheap text heuristic, no LLM.
import { clip } from './util.js';

export const REPLY_MAX = 6000;                 // characters of the message shown in Attention

// phrases that ask the owner for something (English and Indonesian). Weak signals that reports also contain
// ("approved", "next steps:", a bare "tinjau", a question inside a list of findings) do not count on their own.
const VERB = '(approve|send|share|provide|confirm|review|answer|reply|decide|choose|pick|check|paste|upload|tell me|let me know|kirim(kan)?|setujui|konfirmasi|putuskan|pilih|jawab|tinjau|cek|beri tahu|berikan)';
const ASKS = [
  new RegExp(`\\b(next steps?|langkah (berikut(nya)?|selanjutnya))\\s*:?\\**\\s*${VERB}\\b`, 'i'),
  /\b(please|kindly)\s+(send|share|provide|confirm|approve|review|answer|reply|decide|choose|pick|check|paste|upload|tell|let me know)\b/i,
  /\blet me know\b/i, /\b(waiting|blocked) (for|on) (you|your|the owner|owner)\b/i, /\bi need (you|your|from you)\b/i,
  /\b(your|owner'?s?) (approval|decision|answer|input|go-ahead|confirmation)\b/i, /\b(do|would|should|can|could) (you|we|i)\b[^.?!\n]*\?\s*$/im,
  /\b(needs? (your )?approval|for (your )?approval|please approve)\b/i,
  new RegExp(`\\b(tolong|mohon|silakan|harap)\\b[^.\\n]*\\b${VERB}`, 'i'),
  /\b(menunggu|perlu) (jawaban|keputusan|persetujuan|konfirmasi)\b/i, /\bperlu kamu\b/i, /\b(apakah|mana yang|yang mana)\b[^\n]*\?\s*$/im,
];
// words that address the owner: a teammate's message only asks the owner when it says so
const ADDRESSED = /\b(you|your|owner|kamu|anda|bapak|ibu|pak|bu|boss|bos)\b/i;

// markdown decoration off a line, for checking whether it ends with a question
const plain = (l) => l.replace(/[*_`>#|]+/g, '').replace(/^\s*([-+•]|\d+[.)])\s+/, '').trim();

// -> true when the text asks the owner for something. teammate: an agent that is not the lead; its status
// reports and reviews (findings, recommendations, questions it answers itself) are not asks
export function asksOwner(text, { teammate = false } = {}) {
  const t = String(text || '').trim();
  if (!t) return false;
  const lines = t.split('\n').map(plain).filter(Boolean);
  const tail = lines.slice(-12);                                  // asks usually close the message
  const last = lines.at(-1) || '';
  if (teammate) return tail.some((l) => ADDRESSED.test(l) && (l.endsWith('?') || ASKS.some((re) => re.test(l))));
  if (last.endsWith('?')) return true;
  if (ASKS.some((re) => re.test(tail.join('\n')))) return true;
  return tail.filter((l) => l.endsWith('?')).length >= 2;          // a list of questions at the end
}

// the message for the Attention card: long messages keep their start and their end (where the ask is)
export function trimReply(text, max = REPLY_MAX) {
  const t = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= max) return t;
  const head = Math.floor(max * 0.35), tail = max - head;
  return `${clip(t.slice(0, head), head)}\n\n[…]\n\n${t.slice(-tail).replace(/^[^\n]*\n/, '')}`;
}

// should this agent show "Waiting for your reply"?
// live: { running, inLead, state, status: { turnOpen, reply }, work, pending }; gate: source documents block work
export function replyWait(live, { gate = false, isLead = false, teammate = false } = {}) {
  const r = live.status?.reply;
  if (!r || live.status.turnOpen || !live.running || live.inLead) return null;
  if (live.dialog || live.status.ask || live.busy) return null;
  if (live.pending || (live.work && live.work.assignedAt > r.ts)) return null;   // the owner already answered
  if (!asksOwner(r.text, { teammate: teammate && !isLead }) && !(isLead && gate)) return null;
  return { ts: r.ts, text: trimReply(r.text) };
}
