// Improvement loop: an audit finding with a target becomes a proposed change (a diff against the Role Template,
// the Blueprint or the Floor setting). Apply saves it as a new template version (existing versioning with .history,
// so Floors see "Update available"); Dismiss records why. Every decision, and the metrics before and after (on the
// next audit of that Floor), go to the improvement ledger ~/.aisquad/improvements.jsonl.
// The export writes an anonymised bundle for product improvement; nothing is ever uploaded.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, VERSION } from './config.js';
import { lineDiff, bad, notFound, clip, readText, writeText } from './util.js';
import * as roles from './roles.js';
import * as blueprints from './blueprints.js';
import { getAudit, listAudits, trendOf } from './audit.js';
import { redact } from './redact.js';
import { floorsWithLogs } from './log.js';

export const ledgerFile = () => path.join(config.home, 'improvements.jsonl');
export const LESSONS = 'Lessons from audits';

// ---------- ledger ----------
export function readLedger() {
  const text = readText(ledgerFile(), '') || '';
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function appendLedger(entry) {
  fs.mkdirSync(path.dirname(ledgerFile()), { recursive: true });
  fs.appendFileSync(ledgerFile(), JSON.stringify(entry) + '\n');
  return entry;
}
// decisions with their outcome (the first audit of the Floor after the decision)
export function ledger({ floor } = {}) {
  const all = readLedger();
  const outcomes = new Map(all.filter((e) => e.type === 'outcome').map((e) => [e.ref, e]));
  return all.filter((e) => e.type === 'decision' && (!floor || e.floor === floor)).map((d) => ({ ...d, outcome: outcomes.get(d.id) || null }));
}
export const decisionsFor = (floor, auditId) => Object.fromEntries(ledger({ floor }).filter((d) => d.audit === auditId).map((d) => [d.finding.id, { decision: d.decision, reason: d.reason || '', version: d.versionCreated ?? null, ts: d.ts }]));

// after a new audit: decisions on this Floor made before it get their "after" metrics
export function recordOutcomes(floorId, audit) {
  if (!audit?.metrics || !audit.range?.events) return [];
  const done = new Set(readLedger().filter((e) => e.type === 'outcome').map((e) => e.ref));
  return ledger({ floor: floorId }).filter((d) => d.decision === 'applied' && !done.has(d.id) && d.ts < audit.createdAt && d.audit !== audit.id)
    .map((d) => appendLedger({ type: 'outcome', ref: d.id, ts: new Date().toISOString(), floor: floorId, audit: audit.id, metricAfter: trendOf(audit.metrics) }));
}

// ---------- proposals ----------
const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
function findingOf(floorId, auditId, findingId) {
  const audit = getAudit(floorId, auditId);
  if (!audit) throw notFound('Audit not found');
  const finding = audit.findings.find((f) => f.id === findingId);
  if (!finding) throw notFound('Finding not found');
  return { audit, finding };
}

// Role Template: rules added / removed, prompt appended, model or effort changed
function roleProposal(t, c) {
  const drop = new Set(c.removeRules.map(norm));
  const rules = t.rules.filter((r) => !drop.has(norm(r)));
  for (const r of c.addRules) if (!rules.some((x) => norm(x) === norm(r))) rules.push(r);
  const next = { ...t, rules, prompt: c.appendPrompt ? `${t.prompt.trim()}\n\n${c.appendPrompt.trim()}` : t.prompt, model: c.model || t.model, effort: c.effort || t.effort };
  return { before: roles.renderTemplate(t), after: roles.renderTemplate({ ...next, version: t.version + 1 }), next };
}

// Blueprint: rules for the whole squad in the "Lessons from audits" section (part of the standard every agent reads)
export function blueprintWithLessons(text, c) {
  const drop = new Set(c.removeRules.map(norm));
  const head = `## ${LESSONS}`;
  let out = String(text).replace(/\n+$/, '');
  if (!out.includes(head)) out += `\n\n${head}\nRules added from Squad Log audits. They apply to every agent in the squad.`;
  const start = out.indexOf(head), next = out.indexOf('\n## ', start + head.length);
  let section = out.slice(start, next < 0 ? undefined : next);
  section = section.split('\n').filter((l) => !(l.startsWith('- ') && drop.has(norm(l.slice(2))))).join('\n').replace(/\n+$/, '');
  for (const r of c.addRules) if (!section.split('\n').some((l) => l.startsWith('- ') && norm(l.slice(2)) === norm(r))) section += `\n- ${r}`;
  out = out.slice(0, start) + section + (next < 0 ? '' : out.slice(next));
  return `${out}\n`;
}

// floor-setting: a few settings only, with a typed value
const SETTINGS = {
  'budget.usd': { parse: (v) => { const n = Number(v); if (!(n >= 0)) throw bad('Budget must be a number'); return n; }, patch: (v, f) => ({ budget: { ...f.budget, usd: v } }), get: (f) => f.budget.usd },
  'sprint.autoNext': { parse: (v) => /^(true|on|yes|1)$/i.test(String(v)), patch: (v) => ({ sprint: { autoNext: v } }), get: (f) => f.sprint.autoNext },
  'audit.model': { parse: (v) => { if (!['sonnet', 'haiku', 'opus'].includes(v)) throw bad('Unknown model'); return v; }, patch: (v) => ({ audit: { model: v } }), get: (f) => f.audit.model },
  'log.messages': { parse: (v) => /^(true|on|yes|1)$/i.test(String(v)), patch: (v) => ({ log: { messages: v } }), get: (f) => f.log.messages },
};

// floor: { id, root, config: floor.json (cleaned) } -> { kind, id, fromVersion, toVersion, diff, applicable, reason }
export function proposal(floor, auditId, findingId) {
  const { audit, finding } = findingOf(floor.id, auditId, findingId);
  const t = finding.target;
  const out = { audit: audit.id, finding: finding.id, kind: t?.kind || 'none', id: t?.id || '', summary: t?.proposedChange.summary || finding.recommendation, applicable: false, reason: '', diff: [] };
  if (!t) return { ...out, reason: 'This finding has no proposed change; it is advice for the owner.' };
  const c = t.proposedChange;
  try {
    if (t.kind === 'role-template') {
      const tpl = roles.getTemplate(t.id);
      if (!tpl.writable) return { ...out, reason: `"${t.id}" comes from library "${tpl.source}" and is read-only. Copy it to the local library first.` };
      const p = roleProposal(tpl, c);
      return { ...out, fromVersion: tpl.version, toVersion: tpl.version + 1, diff: lineDiff(p.before, p.after), applicable: p.before !== p.after, reason: p.before === p.after ? 'The template already has this change.' : '' };
    }
    if (t.kind === 'blueprint') {
      const bp = blueprints.getBlueprint(t.id);
      const before = blueprints.blueprintText(t.id);
      const after = blueprintWithLessons(before, c).replace(/^version:\s*\d+\s*$/m, `version: ${bp.version + 1}`);
      const same = blueprintWithLessons(before, c) === before;
      return { ...out, fromVersion: bp.version, toVersion: bp.version + 1, diff: lineDiff(before, after), applicable: !same, reason: same ? 'The Blueprint already has this change.' : '' };
    }
    if (t.kind === 'floor-setting') {
      const s = SETTINGS[c.setting];
      if (!s) return { ...out, reason: `The setting ${c.setting || '(none)'} cannot be changed from an audit.` };
      const value = s.parse(c.value), cur = s.get(floor.config);
      return { ...out, id: floor.id, setting: c.setting, value, diff: [{ op: '-', text: `${c.setting}: ${JSON.stringify(cur)}` }, { op: '+', text: `${c.setting}: ${JSON.stringify(value)}` }], applicable: cur !== value, reason: cur === value ? 'The Floor already has this setting.' : '' };
    }
  } catch (e) { return { ...out, reason: e.message }; }
  return { ...out, reason: 'Unknown target' };
}

function decision(floor, audit, finding, extra) {
  const id = crypto.randomBytes(6).toString('hex');
  return appendLedger({ type: 'decision', id, ts: new Date().toISOString(), floor: floor.id, audit: audit.id,
    finding: { id: finding.id, area: finding.area, severity: finding.severity, title: finding.title, recommendation: finding.recommendation },
    target: finding.target ? { kind: finding.target.kind, id: finding.target.id } : null, change: finding.target?.proposedChange || null,
    metricBefore: trendOf(audit.metrics), ...extra });
}
const decided = (floorId, auditId, findingId) => ledger({ floor: floorId }).find((d) => d.audit === auditId && d.finding.id === findingId);

// floor: { id, root, config }; updateFloor(patch) applies a floor-setting change. -> the ledger entry
export function apply(floor, auditId, findingId, { updateFloor } = {}) {
  const { audit, finding } = findingOf(floor.id, auditId, findingId);
  const prev = decided(floor.id, auditId, findingId);
  if (prev) throw bad(`This finding was already ${prev.decision}`);
  const p = proposal(floor, auditId, findingId);
  if (!p.applicable) throw bad(p.reason || 'Nothing to apply');
  const c = finding.target.proposedChange;
  let versionCreated = null;
  if (p.kind === 'role-template') {
    const tpl = roles.getTemplate(p.id);
    const { next } = roleProposal(tpl, c);
    const r = roles.saveTemplate({ ...next, role: p.id });
    versionCreated = r.template.version;
  } else if (p.kind === 'blueprint') {
    versionCreated = blueprints.saveBlueprintText(p.id, blueprintWithLessons(blueprints.blueprintText(p.id), c)).version;
  } else if (p.kind === 'floor-setting') {
    updateFloor(SETTINGS[p.setting].patch(p.value, floor.config));
  }
  return decision(floor, audit, finding, { decision: 'applied', fromVersion: p.fromVersion ?? null, versionCreated });
}

export function dismiss(floor, auditId, findingId, reason) {
  const { audit, finding } = findingOf(floor.id, auditId, findingId);
  const why = clip(String(reason || '').trim(), 500);
  if (!why) throw bad('Say why you dismiss it, so the next audits can learn from it');
  if (decided(floor.id, auditId, findingId)) throw bad('This finding was already decided');
  return decision(floor, audit, finding, { decision: 'dismissed', reason: why });
}

// ---------- export for product improvement (anonymised, never uploaded) ----------
function salt() {
  const f = path.join(config.home, 'export-salt');
  let s = readText(f, '');
  if (!s) { s = crypto.randomBytes(16).toString('hex'); writeText(f, s, 0o600); }
  return s.trim();
}
const hasher = (s) => (v) => (v == null || v === '' ? v : `h:${crypto.createHash('sha256').update(`${s}:${v}`).digest('hex').slice(0, 10)}`);
const ID_KEYS = new Set(['floor', 'agent', 'owner', 'target', 'doc', 'file', 'branch', 'audit', 'ref', 'id']);
const KEEP_ID = new Set(['area', 'severity', 'kind', 'decision', 'type', 'label', 'model', 'models', 'role', 'tool', 'setting']);
// paths and ids become salted hashes, free text is redacted and its paths hashed
// names: agent ids (and Floor ids) that free text may mention; they are hashed like the id fields
export function anonymise(v, h, key = '', names = null) {
  if (typeof v === 'string') {
    if (ID_KEYS.has(key)) return h(v);
    if (KEEP_ID.has(key)) return v;
    let t = redact(v).replace(/(?:~|\.{0,2})?(?:\/?[\w.-]+\/)+[\w.-]+/g, (p) => `path#${h(p).slice(2)}`);
    if (names) t = t.replace(names, (m) => h(m));
    return t;
  }
  if (Array.isArray(v)) return v.map((x) => anonymise(x, h, key, names));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, anonymise(x, h, k, names)]));
  return v;
}
const namesRe = (list) => { const l = [...new Set(list.filter((x) => x && x.length > 2))].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); return l.length ? new RegExp(`\\b(?:${l.join('|')})\\b`, 'g') : null; };

export function exportBundle({ now = Date.now() } = {}) {
  const h = hasher(salt());
  const floorIds = [...new Set([...floorsWithLogs(), ...readdirSafe(path.join(config.home, 'audits'))])];
  const ids = [...floorIds];
  for (const id of floorIds) for (const a of listAudits(id)) for (const x of a.metrics?.efficiency?.byAgent || []) ids.push(x.agent);
  const names = namesRe(ids);
  const floors = floorIds.map((id) => ({
    floor: h(id),
    audits: listAudits(id).map((a) => anonymise({
      createdAt: a.createdAt, label: a.range?.label, events: a.range?.events, sprint: a.range?.sprint, model: a.model, cost: a.cost, scores: a.scores,
      metrics: { process: a.metrics.process, efficiency: a.metrics.efficiency, quality: a.metrics.quality },
      findings: a.findings.map((f) => ({ area: f.area, severity: f.severity, title: f.title, recommendation: f.recommendation, evidenceCount: f.evidence.length, target: f.target ? { kind: f.target.kind, role: f.target.kind === 'floor-setting' ? undefined : f.target.id, setting: f.target.proposedChange.setting || undefined } : null })),
    }, h, '', names)),
  })).filter((f) => f.audits.length);
  const decisions = ledger().map((d) => anonymise({ ts: d.ts, floor: d.floor, decision: d.decision, area: d.finding.area, severity: d.finding.severity,
    kind: d.target?.kind, role: d.target?.kind === 'floor-setting' ? undefined : d.target?.id, fromVersion: d.fromVersion, versionCreated: d.versionCreated,
    reason: d.reason, metricBefore: d.metricBefore, metricAfter: d.outcome?.metricAfter || null }, h, '', names));
  const bundle = { v: 1, product: 'The AI Squad', version: VERSION, createdAt: new Date(now).toISOString(),
    note: 'Anonymised export: metrics, findings and decisions. No message text, no file contents; paths and ids are salted hashes. Nothing was uploaded.', floors, decisions };
  const file = path.join(config.home, 'exports', `aisquad-export-${new Date(now).toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z')}.json`);
  writeText(file, JSON.stringify(bundle, null, 2) + '\n', 0o600);
  return { file, floors: floors.length, audits: floors.reduce((n, f) => n + f.audits.length, 0), decisions: decisions.length };
}
const readdirSafe = (d) => { try { return fs.readdirSync(d).filter((x) => !x.startsWith('.')); } catch { return []; } };
