// Floor configuration inside the project repo (.claude/aisquad/*, AISQUAD.md, generated agent files)
// and the operations on it: create (New Floor wizard), team changes, template update/keep/detach.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readJson, readText, writeJson, writeText, safeReaddir, uniqueId, isHex, clip, bad, notFound } from './util.js';
import { listTemplates, parseTemplate, renderTemplate, templateText, cleanAppearance, STYLES } from './roles.js';
import { effectiveAgent, renderAgentFile, cleanOverrides, permissionViolations, GENERATED_MARK } from './compose.js';
import { lineDiff } from './util.js';
import * as building from './building.js';
import { setApproval } from './merge.js';
import * as sprint from './sprint.js';
import * as blueprints from './blueprints.js';
import * as skills from './skills.js';
import * as recovery from './recovery.js';
import * as autopilot from './autopilot.js';
import * as voiceLib from './voice.js';
import * as reposLib from './repos.js';
import { cleanStandup } from './rituals.js';

const run = promisify(execFile);

export const LAYOUTS = ['rows', 'pods', 'circle', 'open-space'];
export const WORKFLOWS = ['free-team', 'squad-sprint'];
export const DEVICE_TYPES = ['whiteboard', 'printer', 'plant', 'coffee', 'bookshelf', 'sofa', 'rug', 'server-rack', 'pantry', 'tv', 'beanbag', 'pingpong', 'meeting-table', 'lamp'];
export const DESK_DEVICES = ['laptop', 'dual-monitor'];
export const BRANCH_STRATEGIES = ['agent-branches', 'feature-branches', 'trunk'];
export const PUSH_POLICIES = ['never', 'after-merge', 'agents-may-push'];
export const MERGE_METHODS = ['squash', 'merge'];
const ACCENTS = ['#7c5cd6', '#4fa36b', '#3d82d6', '#f2b544', '#e2574c', '#f08a24', '#2bb3a3', '#d94f8c'];
const SHIRTS = ['#3d82d6', '#4fa36b', '#7c5cd6', '#e2574c', '#f08a24', '#2bb3a3', '#d94f8c', '#f2b544'];
const HAIR = ['#2b2440', '#5a3418', '#8a5a2b', '#e8742c', '#1f2937', '#c9a227', '#f28bb6'];

export const dirOf = (root) => path.join(root, '.claude', 'aisquad');
const file = (root, name) => path.join(dirOf(root), name);
const lockDir = (root) => path.join(dirOf(root), 'roles.lock');
const agentsDir = (root) => path.join(root, '.claude', 'agents');

// ---------- defaults & cleaning ----------
// the office of every new Floor (16 x 13 m, like the squad-3d office): whiteboard on the back wall, pantry on the
// left wall, a lounge (rug, sofa, TV, beanbags) front right, ping-pong front left, plants in the corners
export function defaultDevices() {
  return [
    { id: 'whiteboard-1', type: 'whiteboard', x: 3.4, z: -6.3, ry: 0 },
    { id: 'server-rack-1', type: 'server-rack', x: 7.25, z: -5.85, ry: 0 },   // LEDs follow the machine load
    { id: 'pantry-1', type: 'pantry', x: -7.45, z: 1.4, ry: 1.571 },
    { id: 'plant-1', type: 'plant', x: -7.3, z: -5.8, ry: 0 },
    { id: 'plant-2', type: 'plant', x: .4, z: -5.95, ry: 0 },
    { id: 'plant-3', type: 'plant', x: -7.3, z: 5.8, ry: 0 },
    { id: 'plant-4', type: 'plant', x: 7.3, z: 2.4, ry: 0 },
    // lounge corner: idle agents go here (sofa, beanbags, TV, coffee, ping-pong, whiteboard)
    { id: 'rug-1', type: 'rug', x: 4.6, z: 4.4, ry: 0 },
    { id: 'sofa-1', type: 'sofa', x: 4.6, z: 5.75, ry: 3.142 },
    { id: 'tv-1', type: 'tv', x: 4.6, z: 2.9, ry: 0 },
    { id: 'beanbag-1', type: 'beanbag', x: 2.3, z: 4.1, ry: .4 },
    { id: 'beanbag-2', type: 'beanbag', x: 7, z: 4, ry: -.4 },
    { id: 'pingpong-1', type: 'pingpong', x: -3.6, z: 4.4, ry: 0 },
    { id: 'lamp-1', type: 'lamp', x: 6.7, z: 5.95, ry: 0 },
    // rituals: sprint planning, plan reviews, Retro, standups and briefings happen here (Phase 2.5)
    MEETING_TABLE,
  ];
}

// Floors made before Phase 2.1 still carry the old default set (7 or 8 devices at their default spots). As long as
// nobody moved them, they get the new office; anything the owner arranged is kept as it is.
const LEGACY_DEFAULTS = { 'whiteboard-1': [-5.2, -3.9], 'plant-1': [6.2, -3.7], 'plant-2': [-6.2, 3.7], 'printer-1': [6, 3.4], 'coffee-1': [4.6, -3.8], 'rug-1': [5.9, 1.1], 'sofa-1': [6.4, 1.1], 'server-rack-1': [-6.35, -1.6] };
export const MEETING_TABLE = { id: 'meeting-table-1', type: 'meeting-table', x: .3, z: 4.5, ry: 0 };
export function upgradeDevices(devices) {
  if (!Array.isArray(devices)) return devices;
  const legacy = devices.length >= 7 && devices.every((d) => LEGACY_DEFAULTS[d.id] && Math.abs(LEGACY_DEFAULTS[d.id][0] - d.x) < .01 && Math.abs(LEGACY_DEFAULTS[d.id][1] - d.z) < .01);
  if (legacy) return defaultDevices();
  // every Floor has a meeting table (0.5.3); arranged offices get it at its default spot, movable in Edit Mode
  return devices.some((d) => d && d.type === 'meeting-table') ? devices : [...devices, { ...MEETING_TABLE }];
}

const num = (v, d = 0, lim = 20) => { const n = Number(v); return Number.isFinite(n) ? Math.max(-lim, Math.min(lim, +n.toFixed(3))) : d; };

export const AUDIT_MODELS = ['sonnet', 'haiku', 'opus'];
// automatic audits after a sprint closes are on by default for Squad Sprint Floors
const auditSettings = (a = {}, workflow) => ({ auto: typeof a?.auto === 'boolean' ? a.auto : workflow === 'squad-sprint', model: AUDIT_MODELS.includes(a?.model) ? a.model : 'sonnet' });

export function cleanFloor(f = {}, prev = {}) {
  const pick = (k) => (f[k] !== undefined ? f[k] : prev[k]);
  const budget = pick('budget') || {};
  return {
    name: clip(String(pick('name') || 'Untitled Floor').trim(), 60),
    goal: clip(String(pick('goal') || '').trim(), 400),
    // the short line under the Floor name on the brand wall
    tagline: clip(String(pick('tagline') || '').replace(/[\r\n]+/g, ' ').trim(), 48),
    workflow: WORKFLOWS.includes(pick('workflow')) ? pick('workflow') : 'free-team',
    layout: LAYOUTS.includes(pick('layout')) ? pick('layout') : 'rows',
    accent: isHex(pick('accent')) ? pick('accent') : ACCENTS[0],
    budget: { usd: Math.max(0, Number(budget.usd) || 0), period: budget.period === 'day' ? 'day' : 'month' },
    sprint: { autoNext: !!(pick('sprint') || {}).autoNext },
    // Squad Log: message text and personal data masking (secrets are always removed); Audit: after a sprint closes, model
    log: (({ messages, maskPersonalData }) => ({ messages: messages !== false, maskPersonalData: maskPersonalData !== false }))({ ...prev.log, ...f.log }),
    audit: auditSettings({ ...prev.audit, ...f.audit }, WORKFLOWS.includes(pick('workflow')) ? pick('workflow') : 'free-team'),
    // after a crash: resume automatically (off by default); how many agents may run at once (the lead is told)
    recovery: recovery.cleanRecovery({ ...prev.recovery, ...f.recovery }),
    // the daily standup: when (local time) and whether the team meets at the table for it
    standup: cleanStandup({ ...prev.standup, ...f.standup }),
    // Autopilot level and auto-answer timeout (server/autopilot.js); a floor.json without it stays "off"
    ...autopilot.cleanSettings({ autopilot: pick('autopilot'), autopilotTimeoutSec: pick('autopilotTimeoutSec') }),
    // the Floor's default voice language and settings (each agent may set its own; server/voice.js)
    ...(pick('voice') ? { voice: { lang: voiceLib.cleanLang(pick('voice').lang), settings: voiceLib.cleanVoice(pick('voice').settings || {}) } } : {}),
    // the Squad Blueprint this Floor follows (its text is kept in .claude/aisquad/blueprint.md)
    ...(pick('blueprint')?.id ? { blueprint: { id: String(pick('blueprint').id).replace(/[^\w-]/g, '').slice(0, 60), version: Math.max(1, parseInt(pick('blueprint').version, 10) || 1) } } : {}),
    desks: (Array.isArray(pick('desks')) ? pick('desks') : []).filter((d) => d && d.agent).map((d) => ({
      agent: String(d.agent), x: num(d.x), z: num(d.z), ry: num(d.ry, 0, 7), device: DESK_DEVICES.includes(d.device) ? d.device : 'laptop' })),
    devices: (Array.isArray(pick('devices')) ? upgradeDevices(pick('devices')) : defaultDevices()).filter((d) => d && DEVICE_TYPES.includes(d.type)).slice(0, 60).map((d, i) => ({
      id: String(d.id || `${d.type}-${i + 1}`).slice(0, 40), type: d.type, x: num(d.x), z: num(d.z), ry: num(d.ry, 0, 7) })),
  };
}

export function cleanGit(g = {}, prev = {}) {
  const pick = (k, d) => (g[k] !== undefined ? g[k] : prev[k] !== undefined ? prev[k] : d);
  return {
    remote: String(pick('remote', '') || '').trim().slice(0, 300),
    mainBranch: String(pick('mainBranch', 'main') || 'main').replace(/[^\w./-]/g, '').slice(0, 60) || 'main',
    branchStrategy: BRANCH_STRATEGIES.includes(pick('branchStrategy')) ? pick('branchStrategy') : 'agent-branches',
    commitIdentity: pick('commitIdentity') === 'per-agent' ? 'per-agent' : 'repo-default',
    agentEmail: /^[^\s@<>]*\{id\}[^\s@<>]*@[\w.-]+$/.test(String(pick('agentEmail', '') || '')) ? String(pick('agentEmail')) : '{id}@agents.aisquad.local',
    noAiAttribution: pick('noAiAttribution', true) !== false,
    pushPolicy: PUSH_POLICIES.includes(pick('pushPolicy')) ? pick('pushPolicy') : 'never',
    mergePolicy: pick('mergePolicy') === 'manual' ? 'manual' : 'auto',
    mergeMethod: pick('mergeMethod') === 'merge' ? 'merge' : 'squash',
    qualityGate: String(pick('qualityGate', '') || '').trim().slice(0, 300),
  };
}

export function defaultAppearance(i, template) {
  return { style: STYLES[i % STYLES.length], shirt: SHIRTS[i % SHIRTS.length], hair: HAIR[i % HAIR.length], skin: ['#f6d2b0', '#e9bf96', '#d9a77f', '#f3cfae'][i % 4], glasses: i % 3 === 1, ...cleanAppearance(template?.appearance || {}) };
}

// ---------- read / write ----------
export function readFloor(root) {
  const floor = readJson(file(root, 'floor.json'), null);
  if (!floor) throw notFound(`No AI Squad Floor in ${root}`);
  const team = readJson(file(root, 'team.json'), { agents: [] });
  return { floor: cleanFloor(floor), team: { agents: Array.isArray(team.agents) ? team.agents : [] }, git: cleanGit(readJson(file(root, 'git.json'), {})), repos: reposLib.readRepos(root) };
}
// linked repositories (Phase 3.4): this machine's paths (building.json overrides) and what one agent gets
export const localRepoPaths = (root) => building.loadBuilding().floors.find((f) => f.path === path.resolve(root))?.repos || {};
export function agentReposOf(root, agentId, repos = reposLib.readRepos(root)) {
  const { team } = readFloor(root);
  const lead = team.agents.find((a) => a.lead) || team.agents.find((a) => sprint.roleKind(a) === 'lead');
  return lead?.id === agentId ? reposLib.leadRepos(root, repos, agentId, localRepoPaths(root)) : reposLib.agentRepos(root, repos, agentId, localRepoPaths(root));
}
// the owner edits the list (Floor settings, Set up Squad): checked against the team, then every agent file is redone
export function updateRepos(root, list) {
  const { team } = readFloor(root);
  const repos = reposLib.writeRepos(root, list, { agentIds: team.agents.map((a) => a.id) });
  generate(root);
  return repos;
}
export const hasFloor = (root) => fs.existsSync(file(root, 'floor.json'));
export const writeFloor = (root, floor) => writeJson(file(root, 'floor.json'), cleanFloor(floor));
export const writeTeam = (root, team) => writeJson(file(root, 'team.json'), { agents: team.agents });
export const writeGit = (root, git) => writeJson(file(root, 'git.json'), cleanGit(git));

// ---------- role locks ----------
export const lockName = (role, version) => `${role}@${version}.md`;

export function lockTemplate(root, t) {
  const f = path.join(lockDir(root), lockName(t.role, t.version));
  if (!fs.existsSync(f)) writeText(f, renderTemplate(t));
}

// the template an agent is pinned to: repo lock first (self-contained), then the library history
export function lockedTemplate(root, role, version) {
  const text = readText(path.join(lockDir(root), lockName(role, version))) ?? templateText(role, version);
  if (!text) throw notFound(`Role Template ${role}@${version} is not in roles.lock or the library`);
  return parseTemplate(text, role);
}

export function templateOf(root, agent) {
  if (agent.role?.detached) return parseTemplate(renderTemplate({ ...agent.definition, role: agent.definition?.role || agent.id }), agent.id);
  return lockedTemplate(root, agent.role.template, agent.role.version);
}

export function effectiveOf(root, agent) { return effectiveAgent(templateOf(root, agent), agent); }

// ---------- generation ----------
export function generate(root) {
  const { floor, team, git } = readFloor(root);
  const used = new Set();
  const wanted = new Set();
  const bp = blueprints.floorBlueprint(root, floor.blueprint);
  const leadAgent = team.agents.find((a) => a.lead);
  const lead = leadAgent ? { id: leadAgent.id, displayName: leadAgent.displayName } : null;
  const runsSquad = leadAgent || team.agents.find((a) => sprint.roleKind(a) === 'lead');
  const repoList = reposLib.readRepos(root);
  fs.mkdirSync(agentsDir(root), { recursive: true });
  for (const a of team.agents) {
    const eff = effectiveOf(root, a);
    if (!a.role.detached) { used.add(lockName(a.role.template, a.role.version)); lockTemplate(root, templateOf(root, a)); }
    wanted.add(a.id + '.md');
    const standard = bp ? { title: bp.title, version: bp.version, text: blueprints.standardText(bp, lead), roleRules: blueprints.roleRules(bp, a.role.template), lead } : null;
    writeText(path.join(agentsDir(root), a.id + '.md'), renderAgentFile(eff, { floorName: floor.name, git, workflow: floor.workflow, standard, skillName: (n) => skills.agentSkillName(root, n),
      memory: a === runsSquad ? recovery.memoryRules(floor.recovery.maxAgents) : null,
      autopilot: a === runsSquad ? autopilot.leadRules(floor.autopilot, { timeoutSec: floor.autopilotTimeoutSec, questionsFile: sprint.hasPack(root) ? 'docs/squad/QUESTIONS.md' : 'docs/QUESTIONS.md' }) : null,
      repos: a === runsSquad ? reposLib.leadRepos(root, repoList, a.id, localRepoPaths(root)) : reposLib.agentRepos(root, repoList, a.id, localRepoPaths(root)),
      lead: a === runsSquad }));
  }
  // remove generated files of agents that left the team (hand-written agent files are never touched)
  for (const f of safeReaddir(agentsDir(root))) {
    if (!f.endsWith('.md') || wanted.has(f)) continue;
    const p = path.join(agentsDir(root), f);
    if ((readText(p) || '').includes(GENERATED_MARK)) fs.rmSync(p);
  }
  for (const f of safeReaddir(lockDir(root))) if (f.endsWith('.md') && !used.has(f)) fs.rmSync(path.join(lockDir(root), f));
  writeBrief(root, floor, team);
  if (bp) writeStandard(root, bp, lead);
  if (sprint.hasPack(root)) { sprint.updateTeamBlock(root, team.agents); sprint.mergeSettings(root, { qualityGate: git.qualityGate }); }
}

const TEAM_START = '<!-- aisquad:team:start -->', TEAM_END = '<!-- aisquad:team:end -->';
function teamTable(root, team) {
  if (!team.agents.length) return 'No agents yet.';
  return ['| Agent | id | Role | Model |', '|---|---|---|---|', ...team.agents.map((a) => {
    const e = effectiveOf(root, a);
    return `| ${e.displayName.replace(/\|/g, '/')}${a.lead ? ' (lead)' : ''} | \`${a.id}\` | ${e.title} | ${e.model} |`;
  })].join('\n');
}
export function writeBrief(root, floor, team, goal) {
  const p = path.join(root, 'AISQUAD.md');
  const repos = reposLib.readRepos(root);
  const repoLines = repos.length ? `\n\n**Repositories:** this one is the primary (the Floor, the board, the docs). Linked: ${repos.map((r) => `\`${r.path}\` (${r.id}, ${r.access}${r.agents.length ? `: ${r.agents.join(', ')}` : ''})`).join(', ')}. Read-only repositories are never changed by the squad.` : '';
  const block = `${TEAM_START}\n${teamTable(root, team)}${repoLines}\n${TEAM_END}`;
  const cur = readText(p);
  if (cur && cur.includes(TEAM_START) && cur.includes(TEAM_END)) {
    writeText(p, cur.slice(0, cur.indexOf(TEAM_START)) + block + cur.slice(cur.indexOf(TEAM_END) + TEAM_END.length));
    return;
  }
  if (cur) { writeText(p, `${cur.trimEnd()}\n\n## Team\n${block}\n`); return; }
  const wf = floor.workflow === 'squad-sprint'
    ? 'Squad Sprint: the lead plans the sprint on the board, developers build, QA gates every task.'
    : 'Free Team: the owner gives tasks to agents directly; agents coordinate with each other when needed.';
  writeText(p, `# ${floor.name}\n\n## Goal\n${String(goal || floor.goal || 'Describe the project goal here.').trim()}\n\n## Team\n${block}\n\n## How we work\n- Workflow: ${wf}\n- Floor configuration lives in \`.claude/aisquad/\`; files in \`.claude/agents/\` are generated by The AI Squad.\n- Never read or print \`.env\` files or other secrets.\n`);
}

// the Blueprint's communication standard in AISQUAD.md (kept current between markers, after the team table)
function writeStandard(root, bp, lead) {
  const p = path.join(root, 'AISQUAD.md');
  const cur = readText(p) || '';
  const block = blueprints.standardBlock(bp, lead);
  const { STANDARD_START: S, STANDARD_END: E } = blueprints;
  const next = cur.includes(S) && cur.includes(E) ? cur.slice(0, cur.indexOf(S)) + block + cur.slice(cur.indexOf(E) + E.length) : `${cur.trimEnd()}\n\n${block}\n`;
  if (next !== cur) writeText(p, next);
}

// project setting so Claude Code itself adds no attribution lines (merged into .claude/settings.json)
function applyAttribution(root, git) {
  if (!git.noAiAttribution) return;
  const p = path.join(root, '.claude', 'settings.json');
  const cur = fs.existsSync(p) ? readJson(p, null) : {};
  if (!cur || (cur.attribution && cur.attribution.commit === '' && cur.attribution.pr === '')) return;
  cur.attribution = { commit: '', pr: '' };
  writeJson(p, cur);
}

// ---------- update available / diff ----------
export function templateStatus(root, agent) {
  if (agent.role?.detached) return { detached: true };
  const latest = listTemplates().find((t) => t.role === agent.role.template);
  if (!latest) return { missing: true };
  const updateAvailable = latest.version > agent.role.version && agent.role.keep !== latest.version;
  return { latestVersion: latest.version, updateAvailable, keptVersion: agent.role.keep || null };
}

export function templateDiff(root, agent) {
  if (agent.role?.detached) throw bad('A detached agent has no template');
  const latest = listTemplates().find((t) => t.role === agent.role.template);
  if (!latest) throw notFound('Template no longer exists in the library');
  const from = renderTemplate(lockedTemplate(root, agent.role.template, agent.role.version));
  return { role: latest.role, from: agent.role.version, to: latest.version, diff: lineDiff(from, renderTemplate(latest)) };
}

// ---------- commit identity ----------
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function cleanAgentGit(g) {
  if (!g || typeof g !== 'object') return undefined;
  const name = clip(String(g.name || '').replace(/[<>\r\n]/g, '').trim(), 80), email = String(g.email || '').trim();
  if (email && !EMAIL.test(email)) throw bad(`Invalid commit email: ${email}`);
  return name || email ? { ...(name ? { name } : {}), ...(email ? { email } : {}) } : undefined;
}

// git env for an agent session when git.json asks for per-agent commit identity (null = repository default)
export function commitIdentity(agent, git) {
  if (git.commitIdentity !== 'per-agent') return null;
  const name = agent.git?.name || agent.displayName;
  const email = agent.git?.email || git.agentEmail.replace('{id}', agent.id);
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}

// ---------- team operations ----------
function teamAgent(team, id) {
  const a = team.agents.find((x) => x.id === id);
  if (!a) throw notFound(`Agent not found: ${id}`);
  return a;
}

function buildAgent(input, taken, index) {
  const displayName = clip(String(input.displayName || '').replace(/[\r\n<>]/g, ' ').trim(), 60);
  if (!displayName) throw bad('displayName is required');
  const t = listTemplates().find((x) => x.role === input.template);
  if (!t) throw bad(`Unknown Role Template: ${input.template}`);
  const overrides = cleanOverrides(input.overrides || {});
  const v = permissionViolations(t.permissions, overrides.permissions);
  if (v.length) throw bad(`Overrides may only be stricter than the template: ${v.join('; ')}`);
  return { template: t, agent: {
    id: uniqueId(displayName, taken, 'agent'), displayName, role: { template: t.role, version: t.version }, overrides,
    appearance: { ...defaultAppearance(index, t), ...cleanAppearance(input.appearance || {}) }, ...(input.lead ? { lead: true } : {}),
    ...(cleanAgentGit(input.git) ? { git: cleanAgentGit(input.git) } : {}),
  } };
}

export function addAgent(root, input) {
  const { team } = readFloor(root);
  const { template, agent } = buildAgent(input, team.agents.map((a) => a.id), team.agents.length);
  if (agent.lead) team.agents.forEach((a) => delete a.lead);
  lockTemplate(root, template);
  team.agents.push(agent);
  writeTeam(root, team);
  generate(root);
  return agent;
}

export function updateAgent(root, id, input) {
  const { team } = readFloor(root);
  const a = teamAgent(team, id);
  if (input.displayName !== undefined) {
    const n = clip(String(input.displayName).replace(/[\r\n<>]/g, ' ').trim(), 60);
    if (!n) throw bad('displayName is required');
    a.displayName = n;                                 // the id stays stable once created
  }
  if (input.overrides !== undefined) {
    const o = cleanOverrides(input.overrides);
    const tpl = templateOf(root, a);
    const v = permissionViolations(tpl.permissions, o.permissions);
    if (v.length) throw bad(`Overrides may only be stricter than the template: ${v.join('; ')}`);
    a.overrides = o;
  }
  if (input.appearance !== undefined) a.appearance = { ...a.appearance, ...cleanAppearance(input.appearance) };
  // the agent's ElevenLabs voice (an id only; the key is never in the repo)
  if (input.voice !== undefined) { if (/^[A-Za-z0-9]{10,40}$/.test(String(input.voice))) a.voice = String(input.voice); else delete a.voice; }
  // the language it speaks and its voice settings (none: the Floor's defaults)
  if (input.voiceLang !== undefined) { const l = voiceLib.cleanLang(input.voiceLang); if (input.voiceLang && l === String(input.voiceLang)) a.voiceLang = l; else delete a.voiceLang; }
  if (input.voiceSettings !== undefined) { if (input.voiceSettings) a.voiceSettings = voiceLib.cleanVoice(input.voiceSettings); else delete a.voiceSettings; }
  if (input.lead !== undefined) { team.agents.forEach((x) => delete x.lead); if (input.lead) a.lead = true; }
  if (input.git !== undefined) { const g = cleanAgentGit(input.git); if (g) a.git = g; else delete a.git; }
  writeTeam(root, team);
  generate(root);
  return a;
}

export function removeAgent(root, id) {
  const { floor, team } = readFloor(root);
  teamAgent(team, id);
  team.agents = team.agents.filter((a) => a.id !== id);
  floor.desks = floor.desks.filter((d) => d.agent !== id);
  writeTeam(root, team);
  writeFloor(root, floor);
  generate(root);
}

// action: update (move to latest version) | keep (stay, hide the notice for this version) | detach (standalone copy)
export function templateAction(root, id, action) {
  const { team } = readFloor(root);
  const a = teamAgent(team, id);
  if (a.role.detached) throw bad('Agent is already detached');
  if (action === 'update') {
    const latest = listTemplates().find((t) => t.role === a.role.template);
    if (!latest) throw notFound('Template no longer exists in the library');
    const v = permissionViolations(latest.permissions, a.overrides?.permissions);
    if (v.length) throw bad(`The new template version conflicts with this agent's overrides: ${v.join('; ')}`);
    lockTemplate(root, latest);
    a.role = { template: latest.role, version: latest.version };
  } else if (action === 'keep') {
    const latest = listTemplates().find((t) => t.role === a.role.template);
    a.role.keep = latest ? latest.version : a.role.version;
  } else if (action === 'detach') {
    const eff = effectiveOf(root, a);
    a.definition = { role: eff.role, title: eff.title, description: eff.description, model: eff.model, effort: eff.effort, skills: eff.skills,
      tools: eff.tools, permissions: eff.permissions, appearance: {}, rules: eff.rules, prompt: eff.prompt };
    a.role = { template: eff.role, version: eff.version, detached: true };
    a.overrides = {};
  } else throw bad('action must be update, keep or detach');
  writeTeam(root, team);
  generate(root);
  return a;
}

export function updateFloorConfig(root, input) {
  const cur = readFloor(root);
  const floor = cleanFloor(input, cur.floor);
  const ids = new Set(cur.team.agents.map((a) => a.id));
  floor.desks = floor.desks.filter((d) => ids.has(d.agent));
  writeFloor(root, floor);
  if (input.git) { const g = cleanGit(input.git, cur.git); writeGit(root, g); applyAttribution(root, g); }
  if (floor.workflow === 'squad-sprint' && !sprint.hasPack(root)) sprint.scaffold(root, { git: readFloor(root).git, agents: cur.team.agents });
  generate(root);
  return readFloor(root);
}

// ---------- New Floor wizard ----------
const gitOk = (url) => /^(https?:\/\/|ssh:\/\/|git@|file:\/\/|\/)/.test(url) && !url.startsWith('-') && !/\s/.test(url);

// input: { name, goal, number, directory: { mode: existing|new|clone, path, url }, git: {...}, team: [...], workflow, layout, accent, budget }
export async function createFloor(input) {
  const name = clip(String(input.name || '').trim(), 60);
  if (!name) throw bad('Floor name is required');
  const dirIn = input.directory || {};
  const mode = ['existing', 'new', 'clone'].includes(dirIn.mode) ? dirIn.mode : 'existing';
  if (!dirIn.path || !path.isAbsolute(String(dirIn.path))) throw bad('Directory must be an absolute path');
  const root = path.resolve(String(dirIn.path));
  const b = building.loadBuilding();
  if (b.floors.some((f) => f.path === root)) throw bad('This directory is already a Floor');
  const number = input.number ? Number(input.number) : building.nextFloorNumber(b);
  if (!(number >= building.FIRST_SQUAD_FLOOR && number <= building.MAX_FLOOR)) throw bad(`Floor number must be ${building.FIRST_SQUAD_FLOOR}-${building.MAX_FLOOR}; Floor 1 is for independent agents`);
  if (b.floors.some((f) => f.number === number)) throw bad(`Floor ${number} is already taken`);
  const teamIn = Array.isArray(input.team) ? input.team : [];
  // validate the team before touching the disk
  const agents = [], templates = [];
  for (const [i, t] of teamIn.entries()) { const r = buildAgent(t, agents.map((a) => a.id), i); agents.push(r.agent); templates.push(r.template); }
  if (agents.filter((a) => a.lead).length > 1) throw bad('Only one agent can be the lead');

  const exists = fs.statSync(root, { throwIfNoEntry: false });
  if (mode === 'existing') {
    if (!exists?.isDirectory()) throw bad(`Directory not found: ${root}`);
    if (hasFloor(root)) throw bad('This directory already has an AI Squad Floor; register it from "Detected projects" instead');
  } else if (mode === 'new') {
    if (exists && (!exists.isDirectory() || safeReaddir(root).length)) throw bad('A new project needs an empty or missing directory');
    fs.mkdirSync(root, { recursive: true });
    await run('git', ['init', '-q', '-b', cleanGit(input.git).mainBranch, root], { timeout: 20000 });
  } else {
    const url = String(dirIn.url || '').trim();
    if (!gitOk(url)) throw bad('Clone URL must be https://, ssh://, git@ or a local path');
    if (exists) throw bad('Clone target directory must not exist yet');
    fs.mkdirSync(path.dirname(root), { recursive: true });
    try { await run('git', ['clone', '-q', '--', url, root], { timeout: 300000 }); }
    catch (e) { throw bad(`git clone failed: ${String(e.stderr || e.message).trim().slice(0, 300)}`); }
  }

  const git = cleanGit({ ...(input.git || {}), ...(mode === 'clone' && !input.git?.remote ? { remote: String(dirIn.url) } : {}) });
  if (git.remote && fs.existsSync(path.join(root, '.git'))) {
    const has = await run('git', ['-C', root, 'remote'], { timeout: 10000 }).then((r) => r.stdout.split('\n').includes('origin'), () => true);
    if (!has && gitOk(git.remote)) await run('git', ['-C', root, 'remote', 'add', 'origin', git.remote], { timeout: 10000 }).catch(() => {});
  }
  const floor = cleanFloor({ ...input, name, accent: input.accent || ACCENTS[(number - 1) % ACCENTS.length], desks: [], devices: undefined, autopilot: input.autopilot || autopilot.DEFAULT_LEVEL });
  writeFloor(root, floor);
  writeGit(root, git);
  for (const t of templates) lockTemplate(root, t);
  writeTeam(root, { agents });
  applyAttribution(root, git);
  writeBrief(root, floor, { agents: [] }, input.goal);   // brief first, generate() then fills the team table
  if (floor.blueprint) { blueprints.applyToRepo(root, blueprints.getBlueprint(floor.blueprint.id)); blueprints.mergeTeamSettings(root); }
  if (floor.workflow === 'squad-sprint') sprint.scaffold(root, { git, agents });
  if (input.installSkills) for (const name of new Set(templates.flatMap((t) => t.skills))) if (skills.skillStatus(root, name).installable) skills.install(root, name);
  generate(root);
  if (mode === 'new') await initialCommit(root);          // main must exist for sprints and merges
  const entry = building.registerFloor(root, { name, number });
  if (input.git?.autoMergeApproved) setApproval(entry.id, true);   // approval lives in ~/.aisquad, never in the repo
  return { entry, ...readFloor(root) };
}

// first commit of a new project (scaffold only), so the main branch exists. Uses the configured git
// identity; without one, a neutral setup identity.
async function initialCommit(root) {
  const id = await run('git', ['-C', root, 'config', 'user.email'], { timeout: 5000 }).then((r) => r.stdout.trim(), () => '');
  const env = id ? process.env : { ...process.env, GIT_AUTHOR_NAME: 'The AI Squad', GIT_AUTHOR_EMAIL: 'setup@aisquad.local', GIT_COMMITTER_NAME: 'The AI Squad', GIT_COMMITTER_EMAIL: 'setup@aisquad.local' };
  try {
    await run('git', ['-C', root, 'add', '-A'], { timeout: 20000 });
    await run('git', ['-C', root, 'commit', '-q', '--no-verify', '-m', 'chore: set up The AI Squad Floor'], { timeout: 20000, env });
  } catch { /* nothing to commit or git unavailable: the Floor still works */ }
}

// register a directory that already contains .claude/aisquad (e.g. cloned from a teammate)
export function adoptFloor(root, { number } = {}) {
  const { floor } = readFloor(root);
  generate(root);
  return building.registerFloor(root, { name: floor.name, number });
}
