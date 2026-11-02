// SPDX-License-Identifier: Apache-2.0
// What the squads learn (1.11): an agent proposes, the Owner decides, every version is kept. Agents never write the
// Company Brain or another Space; they write a proposal in their own Space:
//   <repo>/docs/squad/proposals/<name>.md
//   ---
//   kind: fact            fact (a line every agent should know) | brain (a document of the Company Brain) | skill
//   from: rina-sales      the agent
//   title: Wedding leads answer best in the evening
//   target: sop/lead-follow-up.md     brain: the file in the Company Brain (brand, sop, templates, products; legal,
//                                     finance and pricing only from an Owner-only Space)
//   skill: lead-follow-up             skill: its name (kebab case)
//   why: 3 of 4 replies came after 19:00 this month (CRM-LEAD-12, 15, 19)
//   ---
//   fact: the line(s); brain: the whole new text of the file; skill: the whole SKILL.md
// The server (code, no model) picks it up with the handoff tick, keeps it in ~/.aisquad/proposals.json and puts a card
// on the Owner's desk. Approve (as proposed or edited): a fact goes to the Company Brain's FACTS.md (pinned, read by
// every agent), a document is written to the Company Brain, a skill goes to ~/.aisquad/learned-skills/<name> and into
// the Space's .claude/skills (or every Space). The previous version goes to .history first, so it can be restored.
// The agent finds the answer in docs/squad/proposals/answered/<id>.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as company from './company.js';
import * as building from './building.js';
import { parseFrontmatter } from './frontmatter.js';
import { redact } from './redact.js';
import { readJson, writeJson, writeText, readText, safeReaddir, oneLine, clip, bad, notFound, statOf } from './util.js';
import { bundledSkills } from './skills.js';

export const KINDS = ['fact', 'brain', 'skill'];
export const DIR = 'docs/squad/proposals';
export const MAX_BYTES = 64 * 1024;
export const FACTS = 'FACTS.md';
const KEEP = 500, KEEP_VERSIONS = 30;
const LEARNED = '<!-- learned: approved by the owner in The AI Squad; a new version replaces this file -->';
const file = () => path.join(config.home, 'proposals.json');
export const learnedDir = () => path.join(config.home, 'learned-skills');
// earlier versions of Company Brain files live outside the brain (agents read the brain; Owner-only files must stay hidden)
const brainHistory = () => path.join(config.home, 'learned-history', 'brain');
const brainDir = () => company.companyDir(building.loadBuilding().prefs);

// set by squad.js; tests set their own
export const deps = { spaces: () => [], log: () => {}, invalidate: () => {} };

export const load = () => { const j = readJson(file(), null); return Array.isArray(j?.proposals) ? j.proposals : []; };
const save = (list) => writeJson(file(), { proposals: list.slice(-KEEP) }, 0o600);
export const get = (id) => load().find((p) => p.id === id) || null;
function update(id, patch) {
  const list = load();
  const p = list.find((x) => x.id === id);
  if (!p) throw notFound('Proposal not found');
  Object.assign(p, patch);
  save(list);
  return p;
}
const newId = (now) => `p-${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;

// ---------- files in the Space: never through a link ----------
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
export function safeDir(root, sub = '', { create = false } = {}) {
  let d = root;
  for (const part of [...DIR.split('/'), ...(sub ? [sub] : [])]) {
    d = path.join(d, part);
    let st = null; try { st = fs.lstatSync(d); } catch { /* missing */ }
    if (!st) { if (!create) return null; try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') return null; } st = fs.lstatSync(d); }
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
  }
  return d;
}
function readSafe(f, max = MAX_BYTES) {
  let fd;
  try {
    fd = fs.openSync(f, fs.constants.O_RDONLY | NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) return null;                      // a hard link could be any file of this user
    const buf = Buffer.alloc(Math.min(st.size, max));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return { text: buf.subarray(0, n).toString('utf8'), size: st.size };
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function writeSafe(root, sub, name, text) {
  const d = safeDir(root, sub, { create: true });
  if (!d) return null;
  const f = path.join(d, name);
  try { fs.unlinkSync(f); } catch { /* new */ }
  const fd = fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o644);
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
  return f;
}
export function pendingFiles(root) {
  const d = safeDir(root);
  if (!d) return [];
  return safeReaddir(d).filter((f) => f.endsWith('.md') && !/^readme\.md$/i.test(f)).map((f) => path.join(d, f))
    .filter((f) => { try { const st = fs.lstatSync(f); return st.isFile() && !st.isSymbolicLink(); } catch { return false; } }).sort();
}

// ---------- what a proposal may change ----------
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{1,63}$/;
// a Company Brain file: a .md in a folder the Space may read (no links, no dot folders, no ..)
export function brainTarget(target, { owner = false } = {}) {
  const t = String(target || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = t.split('/');
  if (!/\.md$/i.test(t) || parts.length < 2 || parts.some((p) => !p || p.startsWith('.') || p === '..')) return { error: 'target: a .md file in a Company Brain folder, e.g. sop/lead-follow-up.md' };
  const top = parts[0];
  if (company.OWNER_DIRS.includes(top) && !owner) return { error: `${top}/ is the Owner's: only an Owner-only Space proposes there` };
  if (!company.TEAM_DIRS.includes(top) && !company.OWNER_DIRS.includes(top)) return { error: `target: a file in ${company.TEAM_DIRS.join(', ')}` };
  return { target: t };
}
export function parseProposal(text, space) {
  const { data, body } = parseFrontmatter(String(text || ''));
  const kind = String(data.kind || '').trim().toLowerCase();
  const p = { kind, title: oneLine(data.title || '', 140), why: oneLine(data.why || '', 400), from: String(data.from || '').trim(), content: String(body || '').trim() };
  if (!KINDS.includes(kind)) return { error: `kind: ${KINDS.join(', ')}` };
  if (!p.title) return { error: 'The proposal needs a title' };
  if (!p.content) return { error: 'The proposal is empty: write the fact, the document or the skill below the header' };
  if (kind === 'brain') { const t = brainTarget(data.target, { owner: space.access === 'owner' }); if (t.error) return t; p.target = t.target; }
  if (kind === 'skill') {
    const name = String(data.skill || '').trim();
    if (!SKILL_NAME.test(name)) return { error: 'skill: the skill\'s name in kebab case, e.g. lead-follow-up' };
    if (bundledSkills().some((b) => b.name === name)) return { error: `skill: ${name} ships with The AI Squad; choose another name` };
    const bad = skillHeaderError(p.content); if (bad) return { error: bad };
    p.target = name;
  }
  if (kind === 'fact') p.target = FACTS;
  p.content = redact(p.content, { pii: kind === 'fact' });                // secrets never travel; documents keep the company's own contacts
  return p;
}

// a SKILL.md header: name and description (and an argument hint), nothing that widens tools or runs hooks
const SKILL_KEYS = ['name', 'description', 'argument-hint'];
export function skillHeaderError(text) {
  const m = String(text).match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return 'A skill is a whole SKILL.md: a header with name and description, then the steps';
  let data; try { data = parseFrontmatter(String(text)).data; } catch { return 'The skill\'s header cannot be read'; }
  if (!data.name || !data.description) return 'A skill is a whole SKILL.md: a header with name and description, then the steps';
  const extra = Object.keys(data).filter((k) => !SKILL_KEYS.includes(k));
  return extra.length ? `The skill's header may only have ${SKILL_KEYS.join(', ')} (not ${extra.join(', ')})` : '';
}

// ---------- the scan (from the handoff tick) ----------
function refuse(space, f, reason) {
  try {
    writeSafe(space.root, 'answered', `${path.basename(f, '.md')}.invalid.md`, `Not taken: ${reason}.\n\nFix the proposal and save it again in ${DIR}/.\n`);
    fs.rmSync(f);
  } catch { try { fs.rmSync(f); } catch { /* gone */ } }
  deps.log(space.id, { type: 'proposal.invalid', data: { file: path.relative(space.root, f), reason } });
  return { ok: false, reason };
}
export function scan({ now = Date.now(), spaces = deps.spaces() } = {}) {
  const out = [];
  for (const s of spaces) {
    for (const f of pendingFiles(s.root)) {
      const r = readSafe(f);
      if (!r) { out.push(refuse(s, f, 'not a plain file (a link)')); continue; }
      if (r.size > MAX_BYTES) { out.push(refuse(s, f, 'larger than 64 KB')); continue; }
      let p;
      try { p = parseProposal(r.text, s); } catch (e) { p = { error: `the header cannot be read: ${e.message}` }; }
      if (p.error) { out.push(refuse(s, f, p.error)); continue; }
      const agent = (s.agents || []).find((a) => a.id === p.from);
      const rec = { id: newId(now), status: 'pending', createdAt: now, floorId: s.id, floorName: s.name, access: s.access || 'team', agentId: agent?.id || '', agentName: agent?.displayName || '', file: path.relative(s.root, f), ...p };
      delete rec.from;
      save([...load(), rec]);
      try { fs.rmSync(f); } catch { /* gone */ }
      deps.log(s.id, { type: 'proposal.received', agent: rec.agentId || null, data: { id: rec.id, kind: rec.kind, target: rec.target, title: rec.title } });
      out.push({ ok: true, id: rec.id });
    }
  }
  if (out.some((x) => x.ok)) deps.invalidate();
  return out;
}

// ---------- versions ----------
const histDir = (base, rel) => (base === learnedDir() ? path.join(base, '.history', rel) : path.join(brainHistory(), rel));
const stamp = (now) => new Date(now).toISOString().replace(/[:.]/g, '-');
function snapshot(base, rel, now) {
  const cur = readText(path.join(base, rel));
  if (cur == null) return null;
  const d = histDir(base, rel);
  writeText(path.join(d, `${stamp(now)}.md`), cur);
  const old = safeReaddir(d).filter((f) => f.endsWith('.md')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_VERSIONS))) fs.rmSync(path.join(d, f), { force: true });
  return stamp(now);
}
// where a kind lives: the Company Brain (fact, brain) or the learned skills (skill)
function placeOf(kind, target) {
  if (kind === 'skill') { if (!SKILL_NAME.test(target)) throw bad('Invalid skill name'); return { base: learnedDir(), rel: path.join(target, 'SKILL.md') }; }
  if (kind === 'fact') return { base: brainDir(), rel: FACTS };
  const t = brainTarget(target, { owner: true });
  if (t.error) throw bad(t.error);
  return { base: brainDir(), rel: t.target };
}
export function current(kind, target) { const { base, rel } = placeOf(kind, target); return readText(path.join(base, rel)); }
export function versions(kind, target) {
  const { base, rel } = placeOf(kind, target);
  return safeReaddir(histDir(base, rel)).filter((f) => f.endsWith('.md')).sort().reverse().map((f) => ({ version: f.replace(/\.md$/, ''), size: statOf(path.join(histDir(base, rel), f))?.size || 0 }));
}
export function versionText(kind, target, version) {
  if (!/^[\dTZ-]+$/.test(String(version))) throw bad('Invalid version');
  const { base, rel } = placeOf(kind, target);
  const t = readText(path.join(histDir(base, rel), `${version}.md`));
  if (t == null) throw notFound('Version not found');
  return t;
}

// FACTS.md: pinned lines, newest first under their date, each with where it came from
export function addFacts(text, lines, { date, source }) {
  const head = '# Company facts\n\nWhat every agent of the company should know. The owner approves each line; agents propose new ones (see the propose-learning skill).\n\n## Pinned\n';
  let t = text && text.includes('## Pinned') ? text : head + (text ? `\n${text.trim()}\n` : '');
  const add = lines.map((l) => `- ${oneLine(l.replace(/^[-*•]\s*/, ''), 300)} _(${date}, ${source})_`).join('\n');
  t = t.replace(/## Pinned\n/, () => `## Pinned\n${add}\n`);
  return t.endsWith('\n') ? t : `${t}\n`;
}

// ---------- decide ----------
// install a learned skill into a Space: never over a skill someone wrote by hand
function installSkill(root, name, text) {
  try {
    let d = path.resolve(root);
    for (const part of ['.claude', 'skills', name]) {             // each folder: a plain folder, made here when missing
      d = path.join(d, part);
      let st = null; try { st = fs.lstatSync(d); } catch { /* missing */ }
      if (!st) { fs.mkdirSync(d); st = fs.lstatSync(d); }
      if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, reason: 'a link or a file in the path' };
    }
    const f = path.join(d, 'SKILL.md');
    const st = statOf(f) && fs.lstatSync(f);
    if (st && (st.isSymbolicLink() || !st.isFile())) return { ok: false, reason: 'SKILL.md is a link' };
    if (st && !(readText(f) || '').includes(LEARNED)) return { ok: false, reason: 'a hand-written skill of that name is there' };
    // a fresh temp file that cannot be a planted link (O_EXCL, O_NOFOLLOW, random name), then renamed over SKILL.md
    const tmp = path.join(d, `.SKILL.${crypto.randomBytes(6).toString('hex')}.tmp`);
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o644);
    try { fs.writeSync(fd, withMarker(text)); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, f);
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.code || e.message }; }
}
const withMarker = (text) => (text.includes(LEARNED) ? text : text.replace(/^(---\s*\n[\s\S]*?\n---\s*\n)/, `$1${LEARNED}\n`));

// approve: as proposed, or with the owner's edit; scope (skills): 'space' (the proposing Space) or 'all'
export function approve(id, { content = null, scope = 'space', by = 'Owner', now = Date.now() } = {}) {
  const p = get(id);
  if (!p) throw notFound('Proposal not found');
  if (p.status !== 'pending') throw bad(`Already ${p.status}`);
  const text = content == null ? p.content : redact(String(content).trim(), { pii: false });
  if (!text) throw bad('Nothing to approve');
  if (p.kind === 'brain' && company.OWNER_DIRS.includes(p.target.split('/')[0]) && deps.spaces().find((s) => s.id === p.floorId)?.access !== 'owner') throw bad(`${p.target.split('/')[0]}/ is the Owner's: the proposing Space is no longer Owner-only`);
  const { base, rel } = placeOf(p.kind, p.target);
  const version = snapshot(base, rel, now);                              // the previous version, to restore
  const installed = [];
  if (p.kind === 'fact') writeText(path.join(base, rel), addFacts(readText(path.join(base, rel)), text.split('\n').filter((l) => l.trim()), { date: new Date(now).toISOString().slice(0, 10), source: [p.floorName, p.agentName].filter(Boolean).join(' · ') || p.floorId }));
  else if (p.kind === 'brain') writeText(path.join(base, rel), text.endsWith('\n') ? text : `${text}\n`);
  else {
    const headerError = skillHeaderError(text); if (headerError) throw bad(headerError);
    writeText(path.join(base, rel), withMarker(text));
    const spaces = deps.spaces().filter((s) => (scope === 'all' ? true : s.id === p.floorId));
    for (const s of spaces) installed.push({ floorId: s.id, ...installSkill(s.root, p.target, text) });
  }
  const done = update(id, { status: 'approved', decidedAt: now, by, edited: content != null && text !== p.content, scope: p.kind === 'skill' ? scope : undefined, previous: version, installed: installed.length ? installed : undefined });
  answer(done, `Approved by ${by}${done.edited ? ' (with changes)' : ''}.${p.kind === 'skill' ? ` Installed in ${installed.filter((x) => x.ok).length} Space(s) as .claude/skills/${p.target}.` : p.kind === 'fact' ? ' It is in the Company Brain\'s FACTS.md now.' : ` It is the Company Brain's ${p.target} now.`}`, text);
  deps.log(p.floorId, { type: 'proposal.approved', agent: p.agentId || null, data: { id, kind: p.kind, target: p.target, title: p.title, by, edited: !!done.edited } });
  deps.invalidate();
  return done;
}
export function reject(id, { reason = '', by = 'Owner', now = Date.now() } = {}) {
  const p = get(id);
  if (!p) throw notFound('Proposal not found');
  if (p.status !== 'pending') throw bad(`Already ${p.status}`);
  const done = update(id, { status: 'rejected', decidedAt: now, by, reason: oneLine(reason, 400) });
  answer(done, `Not taken by ${by}${done.reason ? `: ${done.reason}` : '.'}`);
  deps.log(p.floorId, { type: 'proposal.rejected', agent: p.agentId || null, data: { id, kind: p.kind, target: p.target, title: p.title, by, reason: done.reason } });
  deps.invalidate();
  return done;
}
// the agent reads the decision in its own Space
function answer(p, line, text = '') {
  const s = deps.spaces().find((x) => x.id === p.floorId);
  if (!s) return;
  const shown = p.kind === 'fact' && text ? `\n${text}\n` : '';         // documents and skills are where the line says
  try { writeSafe(s.root, 'answered', `${p.id}.md`, `# ${p.title}\n\n${line}\n\nKind: ${p.kind}${p.target ? ` · ${p.target}` : ''}\n${shown}`); } catch { /* the Space cannot be written: the log has it */ }
}

// restore an earlier version (the current one is kept as a version too)
export function restore(kind, target, version, { by = 'Owner', now = Date.now() } = {}) {
  const text = versionText(kind, target, version);
  const { base, rel } = placeOf(kind, target);
  snapshot(base, rel, now);
  writeText(path.join(base, rel), text);
  const installed = [];
  if (kind === 'skill') for (const s of deps.spaces()) { const f = path.join(s.root, '.claude', 'skills', target, 'SKILL.md'); if ((readText(f) || '').includes(LEARNED)) installed.push({ floorId: s.id, ...installSkill(s.root, target, text) }); }
  deps.invalidate();
  return { ok: true, kind, target, restored: version, by, installed };
}

// ---------- what the Owner sees ----------
export const pending = () => load().filter((p) => p.status === 'pending');
export function learned() {
  const facts = readText(path.join(brainDir(), FACTS));
  const skills = safeReaddir(learnedDir()).filter((n) => SKILL_NAME.test(n) && fs.existsSync(path.join(learnedDir(), n, 'SKILL.md'))).map((name) => {
    let description = '';
    try { description = String(parseFrontmatter(readText(path.join(learnedDir(), name, 'SKILL.md'))).data.description || ''); } catch { /* none */ }
    const spaces = deps.spaces().filter((s) => (readText(path.join(s.root, '.claude', 'skills', name, 'SKILL.md')) || '').includes(LEARNED)).map((s) => s.id);
    return { name, description: clip(description, 300), versions: versions('skill', name).length, spaces };
  });
  return { facts: facts || '', factVersions: versions('fact', FACTS).length, skills };
}
export function cardText(p) {
  const what = { fact: 'a company fact', brain: `a Company Brain document (${p.target})`, skill: `a skill (${p.target})` }[p.kind];
  return `${p.agentName || 'An agent'} (${p.floorName}) proposes ${what}: ${p.title}${p.why ? `\nWhy: ${p.why}` : ''}${p.kind === 'fact' ? `\n\n${clip(p.content, 600)}` : '\n\nRead it and approve it in Admin → Learning (/admin#/learning).'}`;
}
