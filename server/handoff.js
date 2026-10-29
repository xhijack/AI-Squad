// SPDX-License-Identifier: Apache-2.0
// The handoff bus (0.19): work passes from one Space to another as a package, a Markdown file with a short header.
// An agent writes it to `docs/squad/handoffs/outbox/` in its own Space; the server (code, no model) picks it up,
// gives it an id, keeps a copy in `sent/`, delivers it to the other Space's `docs/squad/handoffs/inbox/<id>.md` and
// wakes the receiving agent with a background job (P1, through the dispatcher). The receiver answers with a package
// that names `reply-to`: `clarify` (questions: the sender is woken) or `done` (the result: filed, nobody woken).
//   ---
//   to: Sales                  a Space (its name, number or id), or "owner" for a price approval
//   agent: rina-sales          optional: the receiving agent (default: the Space's lead, else its first agent)
//   kind: opportunity          task, lead, opportunity, quotation, project; replies: clarify, answer, done
//   title: Quote for PT Maju
//   erpnext: Opportunity/CRM-OPP-2026-00012     optional: the ERPNext document it is about
//   reply-to: h-20261027-a1b2c3                 for clarify and done
//   ---
//   What is needed, the context, what done means, links to files in the sender's repository.
// Packages leaving an Owner-only Space wait for the Owner before delivery (legal, finance and personal data stay
// with the Owner). Secrets are removed from every package. The index lives in ~/.aisquad/handoffs.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, writeJson, safeReaddir, oneLine, clip, bad, notFound } from './util.js';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { redact } from './redact.js';

export const KINDS = ['task', 'lead', 'opportunity', 'quotation', 'project', 'clarify', 'answer', 'done'];
const REPLIES = ['clarify', 'answer', 'done'];
export const DIR = 'docs/squad/handoffs';
export const OWNER = 'owner';
export const SYSTEM = 'erpnext';                     // packages the ERPNext watcher sends come "from" here
export const MAX_BYTES = 64 * 1024;
const KEEP = 500;

const file = () => path.join(config.home, 'handoffs.json');
export const load = () => { const j = readJson(file(), null); return Array.isArray(j?.handoffs) ? j.handoffs : []; };
const save = (list) => writeJson(file(), { handoffs: list.slice(-KEEP) });
export const get = (id) => load().find((h) => h.id === id) || null;
export function update(id, patch) {
  const list = load();
  const h = list.find((x) => x.id === id);
  if (!h) throw notFound('Handoff not found');
  Object.assign(h, typeof patch === 'function' ? patch(h) || {} : patch);
  save(list);
  return h;
}
export const newId = (now = Date.now()) => `h-${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;

// what the server needs from the rest of the app (set by squad.js; tests set their own)
export const deps = {
  spaces: () => [],                                  // [{ id, number, name, root, access, agents: [{ id, displayName, lead }] }]
  log: () => {},                                     // (floorId, { type, agent, data })
  wake: async () => null,                            // ({ floorId, agentId, prompt, title, handoff }) -> admit result
  ownerItem: () => {},                               // a package for the Owner arrived (price approval): (handoff)
};

// ---------- packages ----------
export function parsePackage(text) {
  const { data, body } = parseFrontmatter(String(text || ''));
  const meta = {
    to: String(data.to ?? '').trim(), agent: String(data.agent ?? '').trim(), kind: String(data.kind || 'task').trim().toLowerCase(),
    title: oneLine(data.title || '', 140), erpnext: String(data.erpnext ?? '').trim(), replyTo: String(data['reply-to'] ?? data.replyTo ?? '').trim(),
  };
  return { meta, body: String(body || '').trim() };
}
export function validate(meta, body) {
  if (!KINDS.includes(meta.kind)) return `Unknown kind "${meta.kind}": use ${KINDS.join(', ')}`;
  if (REPLIES.includes(meta.kind) && !meta.replyTo) return `A ${meta.kind} package needs reply-to: the id of the handoff it answers`;
  if (!meta.replyTo && !meta.to) return 'The package needs to: the Space it goes to';
  if (!meta.title && !meta.replyTo) return 'The package needs a title';
  if (meta.to.toLowerCase() === OWNER && meta.kind !== 'quotation') return 'Only a quotation goes to the owner (for the price approval); ask the owner anything else through your lead';
  if (meta.erpnext && !/^[A-Z][\w ]{1,60}\/[\w.\- ]{1,140}$/.test(meta.erpnext)) return 'erpnext: write it as DocType/name, e.g. Quotation/SAL-QTN-2026-00012';
  if (meta.kind === 'quotation' && !/^Quotation\//.test(meta.erpnext)) return 'A quotation package names its draft: erpnext: Quotation/<name>';
  if (!body && !['done'].includes(meta.kind)) return 'The package is empty: write what is needed below the header';
  return '';
}
// "Sales", "3", "Floor 3", an id -> the Space, or null
export function resolveSpace(to, spaces = deps.spaces()) {
  const q = String(to || '').trim().toLowerCase().replace(/^(floor|lantai|space)\s+/, '');
  if (!q) return null;
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return spaces.find((s) => s.id === q) || spaces.find((s) => String(s.number) === q) || spaces.find((s) => String(s.name).toLowerCase() === q) || spaces.find((s) => slug(s.name) === slug(q)) || null;
}
// who receives: the named agent, else the lead, else the first agent
export function receiverOf(space, agentId = '') {
  const agents = space?.agents || [];
  if (agentId) return agents.find((a) => a.id === agentId) || null;
  return agents.find((a) => a.lead) || agents[0] || null;
}

// ---------- files: never through a link ----------
// <root>/docs/squad/handoffs/<sub>, created when asked; null when any part of it is a link or not a folder (an agent
// could point it anywhere: another Space's outbox, ~/.claude)
export function safeDir(root, sub, { create = false } = {}) {
  let d = root;
  for (const part of [...DIR.split('/'), sub]) {
    d = path.join(d, part);
    let st = null; try { st = fs.lstatSync(d); } catch { /* missing */ }
    if (!st) { if (!create) return null; try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') return null; } st = fs.lstatSync(d); }
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
  }
  return d;
}
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
// write a file in a safe folder: replaced, never followed
function writeSafe(root, sub, name, text) {
  const d = safeDir(root, sub, { create: true });
  if (!d) throw bad(`${DIR}/${sub} must be a plain folder (no links)`);
  const f = path.join(d, name);
  try { fs.unlinkSync(f); } catch { /* new */ }
  const fd = fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o644);
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
  return f;
}
// read at most max bytes of a regular file, never through a link -> { text, size } or null
function readSafe(f, max = MAX_BYTES) {
  let fd;
  try {
    fd = fs.openSync(f, fs.constants.O_RDONLY | NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    const buf = Buffer.alloc(Math.min(st.size, max));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return { text: buf.subarray(0, n).toString('utf8'), size: st.size };
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// ---------- the outbox ----------
// new packages in a Space's outbox: regular *.md files (no links), at most 64 KB
export function outboxFiles(root) {
  const d = safeDir(root, 'outbox');
  if (!d) return [];
  return safeReaddir(d).filter((f) => f.endsWith('.md') && !/^readme\.md$/i.test(f)).map((f) => path.join(d, f)).filter((f) => {
    try { const st = fs.lstatSync(f); return st.isFile() && !st.isSymbolicLink(); } catch { return false; }
  }).sort();
}
// a package that cannot go: renamed to .invalid with the reason on top, so the agent sees it
function refuse(space, fromAgent, f, reason) {
  try {
    const r = readSafe(f);
    const fd = fs.openSync(`${f}.invalid`, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | NOFOLLOW, 0o644);
    try { fs.writeSync(fd, `<!-- Not sent: ${reason} -->\n${r ? r.text : ''}`); } finally { fs.closeSync(fd); }
    fs.rmSync(f);
  } catch { try { fs.rmSync(f); } catch { /* gone */ } }
  deps.log(space.id, { type: 'handoff.invalid', agent: fromAgent || null, data: { file: path.relative(space.root, f), reason } });
  return { ok: false, file: f, reason };
}

// every new package of one Space (or all): -> [{ ok, id?, status?, reason? }]
export async function scan({ floorId = '', now = Date.now(), spaces = deps.spaces() } = {}) {
  const out = [];
  for (const s of spaces.filter((x) => !floorId || x.id === floorId)) {
    for (const f of outboxFiles(s.root)) {
      const r = readSafe(f);
      if (!r) continue;
      if (r.size > MAX_BYTES) { out.push(refuse(s, '', f, 'larger than 64 KB: link files instead of pasting them')); continue; }
      let meta, body, fromAgent = '';
      try {
        ({ meta, body } = parsePackage(r.text));
        const from = String(parseFrontmatter(r.text).data.from || '').trim();      // the writing agent, when it says so
        fromAgent = (s.agents || []).some((a) => a.id === from) ? from : '';
      } catch (e) { out.push(refuse(s, '', f, `the header cannot be read: ${e.message}`)); continue; }
      try { out.push(await send(s, fromAgent, meta, body, { now, spaces, sourceFile: f })); }
      catch (e) { out.push(e.sent ? { ok: true, id: e.sent, status: 'error', error: e.message } : refuse(s, fromAgent, f, e.message)); }
    }
  }
  return out;
}

// send one package from a Space (or from the ERPNext watcher: from = { id: SYSTEM })
export async function send(fromSpace, fromAgent, meta, body, { now = Date.now(), spaces = deps.spaces(), sourceFile = '' } = {}) {
  const err = validate(meta, body);
  if (err) throw bad(err);
  const virtual = [SYSTEM, OWNER].includes(fromSpace.id);              // the ERPNext watcher or the Owner: no repository
  const list = load();
  const id = newId(now);
  const clean = redact(body, { pii: false });                     // secrets never travel; personal data is the sender's call
  const rec = { id, kind: meta.kind, title: meta.title, erpnext: meta.erpnext, replyTo: meta.replyTo || '', thread: id, rounds: 0,
    from: { floorId: fromSpace.id, agentId: fromAgent || '', name: fromSpace.name || '' }, to: null, status: 'new', createdAt: now, body: clip(clean, 16000) };
  // a reply: it goes back to whoever sent the package it answers
  if (meta.replyTo) {
    const orig = list.find((h) => h.id === meta.replyTo);
    if (!orig) throw bad(`reply-to ${meta.replyTo}: no such handoff`);
    if (orig.to?.floorId !== fromSpace.id) throw bad(`reply-to ${meta.replyTo}: that handoff is not for this Space`);
    if (['new', 'held', 'approval', 'rejected', 'failed'].includes(orig.status)) throw bad(`reply-to ${meta.replyTo}: that handoff is not open for replies (${orig.status})`);
    rec.thread = orig.thread || orig.id;
    rec.title ||= `${{ done: 'Done', clarify: 'Questions', answer: 'Answers', quotation: 'Quotation' }[meta.kind] || 'Re'}: ${orig.title}`;
    rec.to = { ...orig.from };                                       // back to whoever sent the package it answers
    if (rec.to.floorId === SYSTEM) rec.to = { floorId: OWNER, agentId: '', name: 'Owner' };   // questions about ERPNext work go to the Owner
  } else if (meta.to.toLowerCase() === OWNER) {
    rec.to = { floorId: OWNER, agentId: '', name: 'Owner' };
  } else {
    const sp = resolveSpace(meta.to, spaces);
    if (!sp) throw bad(`to: no Space called "${meta.to}"`);
    if (sp.id === fromSpace.id) throw bad('to: this is the same Space; use the board for work inside it');
    const who = receiverOf(sp, meta.agent);
    if (!who) throw bad(meta.agent ? `agent: ${meta.agent} is not in ${sp.name}` : `${sp.name} has no agents`);
    rec.to = { floorId: sp.id, agentId: who.id, name: sp.name };
  }
  // the sender keeps a copy with its id
  if (!virtual) {
    writeSafe(fromSpace.root, 'sent', `${id}.md`, stringifyFrontmatter({ id, to: rec.to.name, ...(rec.to.agentId ? { agent: rec.to.agentId } : {}), kind: rec.kind, title: rec.title, ...(rec.erpnext ? { erpnext: rec.erpnext } : {}), ...(rec.replyTo ? { 'reply-to': rec.replyTo } : {}) }, `\n${clean}\n`));
    if (sourceFile) try { fs.rmSync(sourceFile); } catch { /* gone */ }
  }
  list.push(rec); save(list);
  try { return await route(rec, meta, fromSpace, fromAgent, clean, virtual, { now, spaces }); }
  catch (e) { try { update(id, { error: oneLine(e.message, 200) }); } catch { /* pruned */ } e.sent = id; throw e; }
}
async function route(rec, meta, fromSpace, fromAgent, clean, virtual, { now, spaces }) {
  const id = rec.id;
  deps.log(virtual ? rec.to.floorId : fromSpace.id, { type: 'handoff.sent', agent: fromAgent || null, data: { handoff: id, kind: rec.kind, to: rec.to.name, title: rec.title, replyTo: rec.replyTo || undefined, erpnext: rec.erpnext || undefined } });
  // the thread: a clarify counts a round and waits for its answer; done closes it
  if (rec.replyTo) {
    const root = rec.thread;
    try { update(root, (h) => (meta.kind === 'clarify' ? { status: 'clarify', rounds: (h.rounds || 0) + 1 } : meta.kind === 'done' ? { status: 'done', doneAt: now, result: oneLine(clean, 300) } : { status: 'delivered' }));
    } catch { /* the thread's start was pruned */ }
    if (meta.kind === 'done' && rec.replyTo !== root) update(rec.replyTo, { status: 'done', doneAt: now });
  }
  // into the Owner's hands, held, or delivered
  if (rec.to.floorId === OWNER) {
    if (rec.kind === 'done') { update(id, { status: 'done', deliveredAt: now }); return { ok: true, id, status: 'done' }; }
    update(id, { status: rec.kind === 'quotation' ? 'approval' : 'question' });
    await deps.ownerItem(get(id));
    return { ok: true, id, status: get(id).status };
  }
  const fromSp = spaces.find((x) => x.id === fromSpace.id);
  const toSp = spaces.find((x) => x.id === rec.to.floorId);
  if (fromSp?.access === 'owner' && toSp && toSp.access !== 'owner') {
    update(id, { status: 'held' });
    deps.log(fromSpace.id, { type: 'handoff.held', agent: fromAgent || null, data: { handoff: id, to: rec.to.name } });
    return { ok: true, id, status: 'held' };
  }
  return deliver(id, { now, spaces });
}

// write the package into the receiver's inbox and wake it (a `done` is only filed)
export async function deliver(id, { now = Date.now(), spaces = deps.spaces(), by = '' } = {}) {
  const h = get(id);
  if (!h) throw notFound('Handoff not found');
  const sp = spaces.find((x) => x.id === h.to.floorId);
  if (!sp) { update(id, { status: 'failed', error: 'the receiving Space is gone' }); return { ok: false, id, status: 'failed' }; }
  const rel = `${DIR}/inbox/${id}.md`;
  const fromName = h.from.floorId === SYSTEM ? 'ERPNext' : h.from.floorId === OWNER ? 'the Owner' : h.from.name;
  writeSafe(sp.root, 'inbox', `${id}.md`, stringifyFrontmatter({ id, from: fromName, ...(h.from.agentId ? { 'from-agent': h.from.agentId } : {}), kind: h.kind, title: h.title, ...(h.erpnext ? { erpnext: h.erpnext } : {}), ...(h.replyTo ? { 'reply-to': h.replyTo } : {}), sent: new Date(h.createdAt).toISOString() }, `\n${h.body}\n`));
  update(id, { status: h.kind === 'done' ? 'done' : 'delivered', deliveredAt: now, file: rel, ...(by ? { approvedBy: by } : {}) });
  deps.log(sp.id, { type: 'handoff.received', agent: h.to.agentId || null, data: { handoff: id, kind: h.kind, from: fromName, title: h.title, erpnext: h.erpnext || undefined } });
  if (h.kind === 'done' || !h.to.agentId) return { ok: true, id, status: get(id).status };
  let wake = null;
  try { wake = await deps.wake({ floorId: sp.id, agentId: h.to.agentId, prompt: wakePrompt(get(id), fromName), title: `Handoff: ${h.title}`, handoff: id }); }
  catch (e) { update(id, { wakeError: oneLine(e.message, 200) }); return { ok: true, id, status: 'delivered', wakeError: e.message }; }   // filed; the receiver finds it in its inbox
  return { ok: true, id, status: 'delivered', ...(wake?.waiting ? { queued: wake.dispatch } : {}) };
}

// the receiver's task: the package itself is in the prompt (a job can run anywhere), and how to answer
export function wakePrompt(h, fromName = h.from.name) {
  const out = (name) => `${DIR}/outbox/${h.id}-${name}.md`;
  const sentBack = h.from.floorId === OWNER && h.kind === 'clarify' && /^Quotation\//.test(h.erpnext || '');
  const next = sentBack
    ? `The Owner sent this quotation back. Revise the draft in ERPNext as the note says (never submit it), then hand it to the Owner again: write ${out('quotation')} with \`reply-to: ${h.id}\`, \`kind: quotation\`, \`erpnext: ${h.erpnext}\` and a short note on what changed.`
    : h.kind === 'clarify' ? `These are questions about work you handed over: answer them in ${out('answer')} with the header \`reply-to: ${h.id}\` and \`kind: answer\`, then stop.`
    : h.kind === 'answer' ? `These are the answers to your questions: continue the work. If something essential is still missing, write ${out('clarify')} with \`reply-to: ${h.id}\` and \`kind: clarify\`. When the work is done, write ${out('done')} with \`reply-to: ${h.id}\`, \`kind: done\` and a short result.`
    : `Do the work it asks for in this Space. If something essential is missing, do not guess: write ${out('clarify')} with the header \`reply-to: ${h.id}\` and \`kind: clarify\`, list your questions, and stop. When the work is done, write ${out('done')} with \`reply-to: ${h.id}\`, \`kind: done\` and a short result (what you did, where, ERPNext ids).`;
  return [
    `Handoff ${h.id} from ${fromName}${h.from.agentId ? ` (${h.from.agentId})` : ''}: ${h.kind}: ${h.title}${h.erpnext ? ` [ERPNext ${h.erpnext}]` : ''}.`,
    `It is filed in ${DIR}/inbox/${h.id}.md. The package:`, '', '"""', h.body, '"""', '',
    next, 'Contact data and amounts never go into a package (refer to ERPNext ids: the Owner sees the amounts from ERPNext). Packages are Markdown files with a header: see the space-handoff skill.',
  ].join('\n');
}

// the Owner's answer to a held package
export async function release(id, deliverIt, { now = Date.now(), by = 'Owner', reason = '' } = {}) {
  const h = get(id);
  if (!h || h.status !== 'held') throw notFound('Handoff not found or not held');
  if (deliverIt) return deliver(id, { now, by });
  update(id, { status: 'rejected', rejectedAt: now, reason: oneLine(reason, 200), rejectedBy: by });
  deps.log(h.from.floorId, { type: 'handoff.rejected', agent: h.from.agentId || null, data: { handoff: id, reason: oneLine(reason, 200) || undefined } });
  return { ok: true, id, status: 'rejected' };
}

// the Owner answers a question (or sends a quotation back): a package from the Owner to the asking agent
export async function ownerReply(id, text, { kind = 'answer', now = Date.now(), title = '' } = {}) {
  const h = get(id);
  if (!h || !['question', 'approval'].includes(h.status)) throw notFound('Handoff not found or already answered');
  update(id, { status: kind === 'clarify' ? 'sent-back' : 'answered', answeredAt: now });
  const sp = deps.spaces().find((x) => x.id === h.from.floorId);
  if (!sp) return { ok: false, id, status: 'failed' };
  return send({ id: OWNER, name: 'Owner' }, '', { to: '', agent: '', kind, title: title || `${kind === 'clarify' ? 'Sent back' : 'Answer'}: ${h.title}`, erpnext: h.erpnext, replyTo: id }, String(text || '').trim() || '(no note)', { now });
}
export function closeOwnerItem(id, status = 'closed', now = Date.now()) { return update(id, { status, closedAt: now }); }

// ---------- numbers ----------
// threads that ended (done): how many needed no clarification; open ones by status
export function metrics(list = load()) {
  const roots = list.filter((h) => h.thread === h.id && !h.replyTo);
  const done = roots.filter((h) => h.status === 'done' || h.status === 'approved');
  const clean = done.filter((h) => !(h.rounds > 0));
  const by = (s) => roots.filter((h) => h.status === s).length;
  return { total: roots.length, done: done.length, withoutClarification: done.length ? Math.round((clean.length / done.length) * 100) : null,
    open: { delivered: by('delivered'), clarify: by('clarify'), held: by('held'), approval: by('approval') } };
}
// the list for a person: Owner-only Spaces left out for everyone else
export function listFor(hidden = new Set(), { owner = true } = {}) {
  return load().filter((h) => owner || (h.from.floorId !== OWNER && h.to?.floorId !== OWNER && h.kind !== 'quotation'))
    .filter((h) => !hidden.has(h.from.floorId) && !hidden.has(h.to?.floorId)).slice(-200).reverse()
    .map(({ body, ...h }) => ({ ...h, excerpt: oneLine(body, 160) }));
}
