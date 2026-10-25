// "What do you want to build?" -> a Blueprint and a team, with the reason for every agent. Asks Claude Code
// (`claude -p`, haiku, no tools, structured JSON output); falls back to keyword matching when Claude Code is
// unavailable, slow or answers something unusable.
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { claudeBin } from './config.js';
import { kebab, clip } from './util.js';
import { listBlueprints, catalog } from './blueprints.js';

export const CLAUDE_TIMEOUT_MS = 90000;

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
    'Pick exactly one Blueprint (its communication standard is fixed) and the team from its roles; you may add roles from the catalog when the request clearly needs them.',
    'Stay within each role\'s min and max. Keep the team small: only roles the request needs. Give a one-sentence reason per role that refers to the owner\'s request.',
    'Also give a short squad name (max 40 characters) and a one-paragraph goal written for AISQUAD.md.',
    '',
    'Blueprints:',
    ...blueprints.map((b) => `- ${b.id}: ${b.title}. ${b.description} Roles: ${b.roles.map((r) => `${r.template} (min ${r.min}, max ${r.max}${r.lead ? ', lead' : ''})`).join(', ')}`),
    '',
    'Role catalog:',
    ...roles.map((t) => `- ${t.role}: ${t.title}. ${clip(t.description, 160)} Skills: ${t.skills.join(', ') || 'none'}`),
    '',
    'Answer with JSON only: {"blueprint": id, "name": string, "goal": string, "team": [{"template": role id, "count": integer, "reason": string}]}.',
  ].join('\n');
}

export function runClaude(prompt, { timeoutMs = CLAUDE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', 'haiku', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--json-schema', JSON.stringify(SCHEMA), prompt];
    execFile(claudeBin(), args, { cwd: os.tmpdir(), timeout: timeoutMs, maxBuffer: 8e6, env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` } },
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

// -> { source: 'claude' | 'keywords' | 'blueprint', blueprint, name, goal, slug, team: [{ template, title, displayName, lead, reason }], note }
export async function recommend({ prompt = '', blueprint: chosen = '', useClaude = true, ask = runClaude } = {}) {
  const blueprints = listBlueprints();
  if (!blueprints.length) throw new Error('No Blueprints installed');
  const templates = catalog();
  const pick = (b) => b && blueprints.find((x) => x.id === b);
  const text = String(prompt || '').trim();
  const result = (source, bp, picks, extra = {}) => {
    const name = clip(String(extra.name || '').trim() || (text ? text.replace(/^(i|we) (want|need) (a|an|to build|to)\s*/i, '').split(/[.,;\n]/)[0] : bp.title), 40);
    return { source, blueprint: bp.id, name, slug: kebab(name) || bp.id, goal: clip(String(extra.goal || '').trim() || text || bp.description, 1200), team: membersFor(bp, picks, templates), note: extra.note || '' };
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
