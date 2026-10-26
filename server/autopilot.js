// SPDX-License-Identifier: Apache-2.0
// Autopilot (Phase 2.4): how far the squad keeps going without the owner. One place for the levels, the
// hard-stop list (always waits for the owner), the classification of questions, the lead's rules and the
// timing of automatic answers and nudges. The lead's agent file is generated from the same list (compose.js).

export const LEVELS = ['off', 'balanced', 'full'];
export const LEVEL_TEXT = {
  off: 'Every question waits for you.',
  balanced: 'The lead decides what is not critical, records it and keeps going; critical items wait for you.',
  full: 'The lead decides everything except the hard-stop list, which always waits for you.',
};
export const DEFAULT_LEVEL = 'balanced';                 // new Floors; Floors from before 0.4.0 stay "off" until changed
export const DEFAULT_TIMEOUT_SEC = 180;
export const IDLE_NUDGE = { afterMs: 5 * 60e3, everyMs: 15 * 60e3 };
export const LEAD_MARK = 'DECIDED BY LEAD (autopilot), owner may correct';

// the hard-stop list: [key, what the owner reads, patterns (English and Indonesian)]
export const HARD_STOP = [
  ['money', 'Money: prices, payments, billing, costs',
    /\b(price|prices|pricing|priced|payments?|pay|paid|billing|invoices?|subscriptions?|refunds?|discounts?|costs? money|charge|charges|tariff|budget|revenue|harga|bayar|membayar|pembayaran|tagihan|biaya|langganan|diskon|uang|tarif|anggaran)\b|\$\s?\d|\b(rp|idr|usd)\s?\d/i],
  ['legal', 'Legal: contracts, terms, licences, personal data and privacy law',
    /\b(legal|law|lawyer|contracts?|terms of (service|use)|licen[cs]es?|gdpr|privacy|personal data|pii|consent|compliance|hukum|kontrak|perjanjian|lisensi|data pribadi|privasi|pdp|persetujuan pengguna)\b/i],
  ['production', 'Production: production deploys, secrets, credentials',
    /\b(production|prod|go[- ]?live|live site|deploy(ing|ment)? (to )?(prod|production|live)|release to (users|production|the store)|(restart|migrate|rollback|roll back|scale|change|update|touch)( the)? (production|prod|live)( server| database| db| app)?|play store|app store|secrets?|credentials?|api[- ]?keys?|passwords?|private keys?|tokens?|\.env|produksi|rilis|kredensial|kata sandi|rahasia)\b/i],
  ['server', 'Servers: installing on a shared server, sudo, reverse proxy, DNS and domains, firewall, production server changes',
    /\b(shared server|install(ing|ation)? (it |the app |our app )?on (the |a |our )?(shared |real |production |staging )?(server|vps|host)|sudo|reverse proxy|nginx|caddy|traefik|dns|domains?|subdomain|firewall|ufw|iptables|ssl cert|tls cert|certificates?|deploy key|ssh key|server bersama|pasang di server|instal(asi)? di server|domain|sertifikat)\b/i],
  ['irreversible', 'Irreversible: deleting data, force push, dropping tables, history rewrites',
    /\b(delete|deleting|deletes|drop|dropping|truncate|wipe|purge|destroy|irreversible|force[- ]push|push --force|rewrite (the )?history|reset --hard|rm -rf|migrate down|hapus|menghapus|dihapus|hapus data|kosongkan|musnahkan)\b/i],
  ['scope', 'Scope and business: changes to the PRD or the source documents',
    /\b(scope|prd|requirements?|business (model|rule|rules|logic)|source documents?|tech spec|design document|blueprint|new feature|drop (a|the) feature|cut (a|the) feature|ruang lingkup|kebutuhan|fitur baru|model bisnis|aturan bisnis|ubah prd|dokumen sumber)\b/i],
  ['missing-doc', 'A source document that does not exist yet',
    /\b(no|missing|without( a| the)?|does not exist|doesn't exist) (prd|tech spec|design document|source documents?)\b|\b(belum ada|tidak ada) (prd|dokumen)\b/i],
];
export const hardStopList = () => HARD_STOP.map(([, text]) => text);

// -> { critical, reasons: [keys] }. Unsure (no text) counts as critical. ownerOnly: Blueprint phrases (balanced only)
export function classify(text, { level = DEFAULT_LEVEL, ownerOnly = [] } = {}) {
  const t = String(text || '').trim();
  if (!t) return { critical: true, reasons: ['unclear'] };
  const reasons = HARD_STOP.filter(([, , re]) => re.test(t)).map(([k]) => k);
  if (level !== 'full') for (const p of ownerOnly) if (p && t.toLowerCase().includes(String(p).toLowerCase())) reasons.push('owner-only');
  return { critical: reasons.length > 0, reasons };
}

// the option the asker recommends: "Postgres (Recommended)"
export const recommendedOption = (options = []) => options.find((o) => !o.free && /\(recommended\)/i.test(o.label)) || null;
export const cleanLabel = (label) => String(label || '').replace(/\s*\(recommended\)\s*/i, ' ').trim();

// floor.json: autopilot + autopilotTimeoutSec
export function cleanSettings(f = {}, fallbackLevel = 'off') {
  const level = LEVELS.includes(f.autopilot) ? f.autopilot : fallbackLevel;
  const n = parseInt(f.autopilotTimeoutSec, 10);
  return { autopilot: level, autopilotTimeoutSec: Number.isFinite(n) ? Math.max(30, Math.min(3600, n)) : DEFAULT_TIMEOUT_SEC };
}

// the lead's "## Autopilot" section in its agent file (compose.js)
export function leadRules(level, { timeoutSec = DEFAULT_TIMEOUT_SEC, questionsFile = 'docs/squad/QUESTIONS.md' } = {}) {
  if (!LEVELS.includes(level) || level === 'off') return null;
  const mins = Math.round(timeoutSec / 60);
  return [
    `Autopilot is **${level}** on this Floor: ${LEVEL_TEXT[level]}`,
    `Decide ${level === 'full' ? 'every question that is not on the hard-stop list' : 'every question that is not critical'} yourself: pick the option you would recommend, and continue.`,
    `Record each such decision in \`${questionsFile}\` as \`${LEAD_MARK}\`, with the question, the options and your choice, so the owner can correct it.`,
    'Critical items always wait for the owner: ask them with AskUserQuestion, with options, one marked "(Recommended)". Hard-stop list:',
    ...hardStopList().map((x) => `  - ${x}`),
    ...(level === 'balanced' ? ['  - Anything the squad standard marks as owner-only'] : []),
    `When you ask a question that is not critical, mark one option "(Recommended)": the server picks it if the owner does not answer within ${mins} minute${mins === 1 ? '' : 's'}.`,
    'Autopilot never approves a source document and never pushes; the budget and the memory rules still apply.',
  ];
}

// texts the server types into a session
export const replyNudge = (timeoutSec = DEFAULT_TIMEOUT_SEC) => `Owner did not answer within ${Math.round(timeoutSec / 60)} minutes: decide yourself per Autopilot rules unless it is critical, record the decision, and continue.`;
export const idleNudge = (open) => `Autopilot: the whole squad is idle while the board has ${open} open task${open === 1 ? '' : 's'}. Continue the sprint: re-spawn the teammates the open tasks need (memory rules apply), or record what blocks it in the questions file and ask the owner if it is critical.`;
export const changeAnswer = (question, chosen, option) => `The owner changes an Autopilot decision. Question: "${String(question).replace(/\s+/g, ' ').slice(0, 300)}". It was decided automatically as "${chosen}"; the owner chooses "${option}". Adjust what you did accordingly and record the change.`;

// is an item due for its automatic step? since: when it was first seen
export const due = (since, timeoutSec, now = Date.now()) => !!since && now - since >= timeoutSec * 1000;

// idle nudge: everyone idle with open work for afterMs, at most once per everyMs. state: { idleSince, lastNudge }
export function idleNudgeDue({ allIdle, openWork }, state, now = Date.now()) {
  if (!allIdle || !openWork) { state.idleSince = 0; return false; }
  state.idleSince ||= now;
  if (now - state.idleSince < IDLE_NUDGE.afterMs || (state.lastNudge && now - state.lastNudge < IDLE_NUDGE.everyMs)) return false;
  state.lastNudge = now;
  return true;
}

// the chain (resume, continue, close, merge, next sprint) stops for these; '' = keep going
export function chainStop({ level = 'off', budgetOver = false, pressure = '', criticalWaiting = 0, openWork = null } = {}) {
  if (level === 'off') return 'Autopilot is off';
  if (budgetOver) return 'budget reached';
  if (pressure) return `memory under pressure (${pressure})`;
  if (criticalWaiting) return `${criticalWaiting} critical item${criticalWaiting === 1 ? '' : 's'} wait${criticalWaiting === 1 ? 's' : ''} for the owner`;
  if (openWork === 0) return 'the backlog is empty';
  return '';
}

// lead decisions in the questions file: each line with the mark (the counter in runtime keeps what was seen)
export function leadDecisions(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  lines.forEach((l, i) => { if (l.includes('DECIDED BY LEAD (autopilot)')) { const q = [...lines.slice(Math.max(0, i - 3), i), l].map((x) => x.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 300); out.push(q); } });
  return out;
}
