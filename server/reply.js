// "Waiting for your reply": an agent ended its turn with a plain-text message that asks the owner for
// something (questions, approvals, documents, a next step for the owner). A cheap text heuristic, no LLM.
import { clip } from './util.js';

export const REPLY_MAX = 6000;                 // characters of the message shown in Attention

// phrases that ask the owner for something (English and Indonesian)
const ASKS = [
  /\bnext steps?\s*:/i, /\blangkah (berikut(nya)?|selanjutnya)\b/i,
  /\b(please|kindly)\s+(send|share|provide|confirm|approve|review|answer|reply|decide|choose|pick|check|paste|upload|tell|let me know)\b/i,
  /\blet me know\b/i, /\b(waiting|blocked) (for|on) (you|your|the owner|owner)\b/i, /\bi need (you|your|from you)\b/i,
  /\b(your|owner) (approval|decision|answer|input|go-ahead|confirmation)\b/i, /\b(do|would|should|can|could) (you|we|i)\b[^.?!\n]*\?/i,
  /\b(approve|approval needed|needs? (your )?approval|for (your )?approval)\b/i,
  /\b(tolong|mohon|silakan|harap)\b/i, /\b(kirim(kan)?|setujui|konfirmasi|putuskan|pilih|jawab|tinjau)\b/i,
  /\b(menunggu|perlu) (jawaban|keputusan|persetujuan|konfirmasi)\b/i, /\bperlu kamu\b/i, /\b(apakah|mana yang|yang mana)\b[^\n]*\?/i,
];

// markdown decoration off a line, for checking whether it ends with a question
const plain = (l) => l.replace(/[*_`>#|]+/g, '').replace(/^\s*([-+•]|\d+[.)])\s+/, '').trim();

// -> true when the text asks the owner for something
export function asksOwner(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const lines = t.split('\n').map(plain).filter(Boolean);
  if (lines.at(-1)?.endsWith('?')) return true;
  const tail = lines.slice(-12).join('\n');                       // asks usually close the message
  if (ASKS.some((re) => re.test(tail))) return true;
  return lines.filter((l) => l.endsWith('?')).length >= 2;          // a list of questions anywhere
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
export function replyWait(live, { gate = false, isLead = false } = {}) {
  const r = live.status?.reply;
  if (!r || live.status.turnOpen || !live.running || live.inLead) return null;
  if (live.dialog || live.status.ask || live.busy) return null;
  if (live.pending || (live.work && live.work.assignedAt > r.ts)) return null;   // the owner already answered
  if (!asksOwner(r.text) && !(isLead && gate)) return null;
  return { ts: r.ts, text: trimReply(r.text) };
}
