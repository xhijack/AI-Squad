// SPDX-License-Identifier: Apache-2.0
// Contracts in a Legal Space (0.20): every contract stays a DRAFT until the Owner approves it, in the app.
//   <legal Space>/contracts/<file>.md, the first `STATUS:` line: DRAFT -> READY FOR REVIEW (set by the agents)
//   -> APPROVED (set only here, by the Owner). The server keeps a fingerprint of each approved text
//   (~/.aisquad/legal.json): a contract marked APPROVED any other way, or changed after its approval, is put back to
//   DRAFT, logged and shown to the Owner. A contract READY FOR REVIEW is a card on the Owner's desk (a hard stop:
//   legal): Approve, or Request changes (a task for the Space's lead). The card names the version it shows.
// A Legal Space is one made from the Legal Blueprint, or any Owner-only Space with a `contracts/` folder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, writeJson, safeReaddir, oneLine, bad, notFound, HttpError } from './util.js';
import { approveText } from './blueprints.js';

export const DIR = 'contracts';
const MAX = 512 * 1024;
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const file = () => path.join(config.home, 'legal.json');
export const loadState = () => ({ approvals: {}, revisions: {}, alerts: [], ...(readJson(file(), {}) || {}) });
function mutate(fn) { const st = loadState(); const r = fn(st); writeJson(file(), st); return r; }

export const deps = {
  spaces: () => [],                    // [{ id, name, root, access, blueprint, agents: [{ id, lead }] }]
  log: () => {},
  ask: async () => null,               // ({ floorId, agentId, prompt, title }) -> a task for the lead
  invalidate: () => {},
};

// ---------- the text ----------
export const statusOf = (text) => ((String(text || '').match(/^STATUS:[ \t]*(.+?)[ \t]*$/m) || [])[1] || '').toUpperCase();
// the fingerprint of what was approved: the text without its STATUS and approval lines
export const fingerprint = (text) => crypto.createHash('sha256').update(String(text || '').split('\n').filter((l) => !/^STATUS:/.test(l) && !/^Approved by the owner on:/.test(l)).join('\n').trim()).digest('hex').slice(0, 32);
export const titleOf = (text, rel) => (String(text || '').match(/^#\s+(.+)$/m) || [])[1]?.trim() || path.basename(rel, '.md');
// the `## Legal checklist` section: - [x] done, - [ ] open, - [-] not applicable
export function checklistOf(text) {
  const sec = String(text || '').split(/^## /m).find((s) => /^Legal checklist/i.test(s));
  if (!sec) return { present: false, done: 0, open: 0, na: 0, openItems: [] };
  const items = sec.split('\n').filter((l) => /^\s*-\s*\[[ xX-]\]/.test(l));
  const open = items.filter((l) => /\[ \]/.test(l));
  return { present: true, done: items.filter((l) => /\[[xX]\]/.test(l)).length, open: open.length, na: items.filter((l) => /\[-\]/.test(l)).length,
    openItems: open.map((l) => oneLine(l.replace(/^\s*-\s*\[ \]\s*/, ''), 120)).slice(0, 10) };
}
export function setStatus(text, status) {
  const lines = String(text).split('\n');
  const i = lines.findIndex((l) => /^STATUS:/.test(l));
  if (i >= 0) lines[i] = `STATUS: ${status}`; else lines.splice(/^#\s/.test(lines[0] || '') ? 1 : 0, 0, ...(/^#\s/.test(lines[0] || '') ? ['', `STATUS: ${status}`] : [`STATUS: ${status}`, '']));
  return lines.map((l) => (/^Approved by the owner on:/.test(l) && status !== 'APPROVED' ? 'Approved by the owner on:' : l)).join('\n');
}

// ---------- files: never through a link ----------
function contractsDir(root) {
  const d = path.join(root, DIR);
  try { const st = fs.lstatSync(d); return st.isDirectory() && !st.isSymbolicLink() ? d : null; } catch { return null; }
}
function readSafe(f) {
  let fd;
  try { fd = fs.openSync(f, fs.constants.O_RDONLY | NOFOLLOW); const st = fs.fstatSync(fd); if (!st.isFile() || st.size > MAX) return null; return fs.readFileSync(fd, 'utf8'); }
  catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function writeSafe(f, text) {
  const fd = fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_TRUNC | NOFOLLOW);
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
}
export const isLegal = (sp) => sp.blueprint === 'legal' || (sp.access === 'owner' && !!contractsDir(sp.root));
// every contract of every Legal Space -> [{ floorId, space, rel, key, text, status, hash, title, checklist }]
export function contracts(spaces = deps.spaces()) {
  const out = [];
  for (const sp of spaces.filter(isLegal)) {
    const d = contractsDir(sp.root);
    if (!d) continue;
    for (const f of safeReaddir(d).filter((x) => x.endsWith('.md') && !/^readme\.md$/i.test(x)).sort()) {
      const text = readSafe(path.join(d, f));
      if (text == null) continue;
      const rel = `${DIR}/${f}`;
      out.push({ floorId: sp.id, space: sp.name, rel, key: `${sp.id}/${rel}`, text, status: statusOf(text), hash: fingerprint(text), title: titleOf(text, rel), checklist: checklistOf(text) });
    }
  }
  return out;
}

// ---------- the guard: nothing is APPROVED that the Owner did not approve as it stands ----------
export function guard(now = Date.now(), spaces = deps.spaces()) {
  const out = [];
  for (const c of contracts(spaces)) {
    const appr = loadState().approvals[c.key];
    const approvedAsIs = appr && appr.hash === c.hash;
    if (c.status === 'APPROVED' && approvedAsIs) continue;
    if (appr && !approvedAsIs) mutate((st) => { delete st.approvals[c.key]; st.revisions[c.key] = (st.revisions[c.key] || 0) + 1; });   // changed after approval
    if (c.status !== 'APPROVED') continue;
    const reason = appr ? 'changed after the owner approved it' : 'marked APPROVED without the owner\'s approval';
    try { writeSafe(path.join(spaces.find((s) => s.id === c.floorId).root, c.rel), setStatus(c.text, 'DRAFT')); } catch { continue; }
    mutate((st) => { st.alerts = [...st.alerts.filter((a) => a.key !== c.key), { id: `legal-${c.hash.slice(0, 10)}`, key: c.key, floorId: c.floorId, rel: c.rel, at: now, text: `${c.rel} in ${c.space} was ${reason}: it is a DRAFT again.` }].slice(-50); });
    deps.log(c.floorId, { type: 'legal.reverted', data: { file: c.rel, reason } });
    out.push({ key: c.key, reason });
  }
  if (out.length) deps.invalidate();
  return out;
}

// the cards for the Owner: contracts READY FOR REVIEW (the version shown is in the card) and the guard's alerts
export function reviewItems(spaces = deps.spaces()) {
  return contracts(spaces).filter((c) => c.status === 'READY FOR REVIEW').map((c) => ({
    key: c.key, floorId: c.floorId, rel: c.rel, hash: c.hash, title: c.title, checklist: c.checklist,
    text: [`Contract ready for your approval: ${c.title} (${c.rel})`,
      c.checklist.present ? `Legal checklist: ${c.checklist.done} done, ${c.checklist.na} not applicable, ${c.checklist.open} open${c.checklist.openItems.length ? `:\n${c.checklist.openItems.map((x) => `- ${x}`).join('\n')}` : '.'}` : 'No legal checklist in the contract yet.',
      'Read the whole contract in Admin → Legal before you approve it.'].join('\n\n'),
  }));
}
export const alerts = () => loadState().alerts;
export function dismissAlert(id) { mutate((st) => { st.alerts = st.alerts.filter((a) => a.id !== id); }); return { ok: true }; }

// the Owner approves the version on the card
export function approve(key, seenHash, { by = 'Owner', now = Date.now(), spaces = deps.spaces() } = {}) {
  const c = contracts(spaces).find((x) => x.key === key);
  if (!c) throw notFound('Contract not found');
  if (c.status !== 'READY FOR REVIEW') throw new HttpError(409, 'This contract is not ready for review any more');
  if (c.hash !== seenHash) throw new HttpError(409, 'The contract changed after it was shown to you: look at it again');
  const next = approveText(c.text, new Date(now).toISOString().slice(0, 10));
  writeSafe(path.join(spaces.find((s) => s.id === c.floorId).root, c.rel), next);
  mutate((st) => { st.approvals[key] = { hash: fingerprint(next), at: now, by }; });
  deps.log(c.floorId, { type: 'legal.approved', data: { file: c.rel, by, checklistOpen: c.checklist.open } });
  deps.invalidate();
  return { ok: true, file: c.rel };
}
// changes: back to DRAFT and a task for the lead with the Owner's note
export async function requestChanges(key, note, { by = 'Owner', spaces = deps.spaces() } = {}) {
  if (!String(note || '').trim()) throw bad('Write what has to change');
  const c = contracts(spaces).find((x) => x.key === key);
  if (!c) throw notFound('Contract not found');
  const sp = spaces.find((s) => s.id === c.floorId);
  writeSafe(path.join(sp.root, c.rel), setStatus(c.text, 'DRAFT'));
  mutate((st) => { st.revisions[key] = (st.revisions[key] || 0) + 1; });
  const lead = (sp.agents || []).find((a) => a.lead) || sp.agents?.[0];
  deps.log(c.floorId, { type: 'legal.changes', data: { file: c.rel, by } });
  if (lead) await deps.ask({ floorId: c.floorId, agentId: lead.id, title: `Contract changes: ${c.title}`,
    prompt: `The owner asks for changes to ${c.rel} (it is a DRAFT again):\n\n${String(note).trim()}\n\nRevise it, run the contract-checklist skill again, and set STATUS: READY FOR REVIEW when it is done.` });
  deps.invalidate();
  return { ok: true, file: c.rel };
}

// numbers: contracts by status, approvals, revisions, what the guard caught
export function metrics(spaces = deps.spaces()) {
  const all = contracts(spaces), st = loadState();
  const by = (s) => all.filter((c) => c.status === s).length;
  return { total: all.length, draft: by('DRAFT'), review: by('READY FOR REVIEW'), approved: all.filter((c) => c.status === 'APPROVED' && st.approvals[c.key]?.hash === c.hash).length,
    revisions: Object.values(st.revisions).reduce((a, b) => a + b, 0), alerts: st.alerts.length };
}
export const list = (spaces = deps.spaces()) => { const st = loadState(); return contracts(spaces).map(({ text, ...c }) => ({ ...c, approvedAt: st.approvals[c.key]?.hash === c.hash ? st.approvals[c.key].at : null, revisions: st.revisions[c.key] || 0 })); };
