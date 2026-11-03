// SPDX-License-Identifier: Apache-2.0
// "What do you want to build?" -> a Blueprint and a team, with the reason for every agent. Asks Claude Code
// (`claude -p`, the advisor model: opus at high effort unless the Owner picked another, no tools, structured JSON
// output); falls back to keyword matching when Claude Code is unavailable, slow or answers something unusable.
// Whatever the answer, the team keeps every role the Blueprint's loop needs (1.14): the lead, the minimums, every
// routine's agent and every source document's owner, so no routine is left without someone to run it.
import os from 'node:os';
import path from 'node:path';
import * as auth from './auth.js';
import { loadBuilding } from './building.js';
import { execFile } from 'node:child_process';
import { claudeBin } from './config.js';
import { kebab, clip } from './util.js';
import { listBlueprints, catalog, loopRoles, loopGaps } from './blueprints.js';

export const CLAUDE_TIMEOUT_MS = 180000;   // opus at high effort takes a minute or two

// the model that recommends teams and sharpens the Company Guide's plan (1.14): building.json → prefs.advisor
export const ADVISOR_MODELS = ['opus', 'sonnet', 'haiku'], ADVISOR_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_ADVISOR = { model: 'opus', effort: 'high' };
export function advisor(prefs = loadBuilding().prefs) {
  const a = prefs?.advisor || {};
  return { model: ADVISOR_MODELS.includes(a.model) ? a.model : DEFAULT_ADVISOR.model, effort: ADVISOR_EFFORTS.includes(a.effort) ? a.effort : DEFAULT_ADVISOR.effort };
}

// score = keyword hits (multi-word keywords count double); ties go to the first Blueprint (Software House)
export function keywordMatch(prompt, blueprints) {
  const text = ` ${String(prompt || '').toLowerCase().replace(/[^a-z0-9&+-]+/g, ' ')} `;
  const scored = blueprints.map((b) => ({ b, hits: b.keywords.filter((k) => text.includes(` ${k} `) || (k.length > 4 && text.includes(` ${k}`))) }))
    .map((x) => ({ ...x, score: x.hits.reduce((n, k) => n + (k.includes(' ') ? 2 : 1), 0) }));
  scored.sort((x, y) => y.score - x.score || (x.b.id === 'software-house' ? -1 : y.b.id === 'software-house' ? 1 : 0));
  return scored[0] ? { blueprint: scored[0].b, hits: scored[0].hits } : null;
}

// expand { template, count } into named members; the Blueprint's lead role gets the lead flag
export function membersFor(bp, picks, templates) {
  const out = [];
  for (const p of picks) {
    const t = templates.find((x) => x.role === p.template);
    if (!t) continue;
    const role = bp.roles.find((r) => r.template === p.template);
    const count = Math.max(1, Math.min(role ? Math.max(role.max, 1) : 2, Number(p.count) || 1));
    for (let i = 1; i <= count; i++) out.push({ template: t.role, title: t.title, displayName: count > 1 ? `${t.title} ${i}` : t.title, lead: false, reason: clip(p.reason || role?.why || t.description, 300) });
  }
  const lead = out.find((m) => m.template === bp.lead) || out[0];
  if (lead) lead.lead = true;
  return out;
}

export function defaultPicks(bp) { return bp.roles.filter((r) => r.default > 0).map((r) => ({ template: r.template, count: r.default, reason: r.why })); }

// put back every loop role the picks left out (or raise it to its minimum), saying what it keeps running
export function completeLoop(bp, picks) {
  const out = picks.map((p) => ({ ...p }));
  for (const r of loopGaps(bp, out.flatMap((p) => Array.from({ length: Math.max(1, Number(p.count) || 1) }, () => ({ template: p.template }))))) {
    const why = bp.roles.find((x) => x.template === r.template)?.why;
    const duties = r.duties.map((d) => d.text).join('; ');
    const cur = out.find((p) => p.template === r.template);
    if (cur) { cur.count = Math.max(Number(cur.count) || 1, r.min); continue; }
    out.push({ template: r.template, count: r.min, reason: why ? `${why} Kept for the squad's loop: ${duties}.` : `Kept for the squad's loop: ${duties}.`, loop: true });
  }
  return out;
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['blueprint', 'name', 'goal', 'team'],
  properties: {
    blueprint: { type: 'string' }, name: { type: 'string' }, goal: { type: 'string' },
    team: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['template', 'count', 'reason'], properties: { template: { type: 'string' }, count: { type: 'integer' }, reason: { type: 'string' } } } },
  },
};

export function claudePrompt(prompt, blueprints, roles) {
  return [
    'You recommend an AI agent squad for The AI Squad. The owner wrote what they want to build:',
    `"""${clip(prompt, 2000)}"""`,
    '',
    'Pick exactly one Blueprint (its communication standard is fixed) and build a COMPLETE team: one that can run the Blueprint\'s whole loop by itself, not the smallest team.',
    'Start from the Blueprint\'s default team. Keep every role marked "loop": the squad\'s routines and source documents stop without it.',
    'Then fit the team to the request: raise a count within its max when the workload asks for it, add an optional role or a role from the catalog when the request clearly needs it, and leave out an optional role only when the request clearly has no use for it.',
    'Stay within each role\'s min and max. Give a one-sentence reason per role that refers to the owner\'s request (the business, the market, the target).',
    'Also give a short squad name (max 40 characters) and a one-paragraph goal written for AISQUAD.md: what the squad delivers, for which business and market, and how it measures it.',
    'Answer in the language the owner wrote in.',
    '',
    'Blueprints:',
    ...blueprints.flatMap((b) => {
      const loop = new Map(loopRoles(b).map((r) => [r.template, r.duties.map((d) => d.text).join('; ')]));
      return [`- ${b.id}: ${b.title}. ${b.description}`, ...b.roles.map((r) => `  - ${r.template}: min ${r.min}, default ${r.default}, max ${r.max}${r.lead ? ', lead' : ''}${loop.has(r.template) ? `, loop (${loop.get(r.template)})` : ', optional'}. ${clip(r.why, 200)}`),
        ...(b.cadence?.length ? [`  Routines: ${b.cadence.map((r) => `${r.title} by ${r.agent}, ${r.every}`).join('; ')}`] : [])];
    }),
    '',
    'Role catalog:',
    ...roles.map((t) => `- ${t.role}: ${t.title}. ${clip(t.description, 160)} Skills: ${t.skills.join(', ') || 'none'}`),
    '',
    'Answer with JSON only: {"blueprint": id, "name": string, "goal": string, "team": [{"template": role id, "count": integer, "reason": string}]}.',
  ].join('\n');
}

export function runClaude(prompt, { timeoutMs = CLAUDE_TIMEOUT_MS, schema = SCHEMA, model, effort } = {}) {
  const a = advisor();
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model || a.model, '--effort', effort || a.effort, '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--json-schema', JSON.stringify(schema), prompt];
    execFile(claudeBin(), args, { cwd: os.tmpdir(), timeout: timeoutMs, maxBuffer: 8e6, env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`, ...auth.backgroundEnv(loadBuilding().prefs.auth) } },
      (err, stdout) => {
        if (err && !stdout) return reject(err);
        try {
          const j = JSON.parse(stdout);
          if (j.structured_output && typeof j.structured_output === 'object') return resolve(j.structured_output);
          const m = String(j.result ?? stdout).match(/\{[\s\S]*\}/);
          resolve(JSON.parse(m[0]));
        } catch { reject(new Error('Claude Code gave no readable answer')); }
      });
  });
}

// -> { source: 'claude' | 'keywords' | 'blueprint', model, blueprint, name, goal, slug, team: [{ template, title, displayName, lead, reason, loop }], note }
export async function recommend({ prompt = '', blueprint: chosen = '', useClaude = true, ask = runClaude } = {}) {
  const blueprints = listBlueprints();
  if (!blueprints.length) throw new Error('No Blueprints installed');
  const templates = catalog();
  const pick = (b) => b && blueprints.find((x) => x.id === b);
  const text = String(prompt || '').trim();
  const result = (source, bp, picks, extra = {}) => {
    const name = clip(String(extra.name || '').trim() || (text ? text.replace(/^(i|we) (want|need) (a|an|to build|to)\s*/i, '').split(/[.,;\n]/)[0] : bp.title), 40);
    const done = completeLoop(bp, picks), added = done.filter((p) => p.loop).map((p) => p.template);
    return { source, ...(source === 'claude' ? { model: advisor() } : {}), blueprint: bp.id, name, slug: kebab(name) || bp.id, goal: clip(String(extra.goal || '').trim() || text || bp.description, 1200),
      team: membersFor(bp, done, templates), loopAdded: added, note: extra.note || '' };
  };
  if (!text) { const bp = pick(chosen) || blueprints[0]; return result('blueprint', bp, defaultPicks(bp)); }
  if (useClaude) {
    try {
      const a = await ask(claudePrompt(text, chosen ? [pick(chosen) || blueprints[0]] : blueprints, templates));
      const bp = pick(chosen) || pick(a.blueprint);
      const picks = (Array.isArray(a.team) ? a.team : []).filter((p) => templates.some((t) => t.role === p.template));
      if (bp && picks.length) {
        if (!picks.some((p) => p.template === bp.lead)) picks.unshift({ template: bp.lead, count: 1, reason: bp.roles.find((r) => r.lead)?.why });
        return result('claude', bp, picks, a);
      }
    } catch { /* fall back to keywords */ }
  }
  const m = keywordMatch(text, blueprints);
  const bp = pick(chosen) || m.blueprint;
  return result('keywords', bp, defaultPicks(bp), { note: m.hits.length ? `Matched on: ${m.hits.slice(0, 6).join(', ')}` : 'No clear match; Software House is the default.' });
}
