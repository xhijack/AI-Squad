// SPDX-License-Identifier: Apache-2.0
// JSON API + static UI. On a loopback address (the default) reads are open and every change and agent
// screen needs the local PIN (header x-aisquad-pin); on any other address every /api call needs it.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ROOT, VERSION } from './config.js';
import { HttpError, notFound, lineDiff } from './util.js';
import * as building from './building.js';
import * as floors from './floors.js';
import * as roles from './roles.js';
import * as libraries from './libraries.js';
import * as dispatcher from './dispatcher.js';
import * as squad from './squad.js';
import { setApproval } from './merge.js';
import { recentEvents as hooksRecent } from './events.js';
import { meter } from './meter.js';
import * as blueprints from './blueprints.js';
import { recommend } from './recommend.js';
import { createSquad, squadsDir } from './setup.js';
import * as voice from './voice.js';
import * as backup from './backup.js';
import { runDoctor } from './doctor.js';
import * as service from './service.js';
import * as auth from './auth.js';
import * as jobs from './jobs.js';
import * as history from './history.js';
import * as company from './company.js';
import * as admin from './admin.js';
import * as users from './users.js';
import * as access from './access.js';
import * as notify from './notify.js';
import * as inbox from './inbox.js';
import * as insight from './insight.js';
import * as nodes from './nodes.js';

const UI = path.join(ROOT, 'ui');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

// a GET's JSON with an ETag: the browser revalidates (no-cache) and an unchanged answer is a bodiless 304
export const etagOf = (text) => `"${crypto.createHash('sha1').update(text).digest('base64url').slice(0, 20)}"`;
function sendJsonGet(req, res, body) {
  const text = JSON.stringify(body), tag = etagOf(text);
  const head = { etag: tag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
  if (req.headers['if-none-match'] === tag) { res.writeHead(304, head); return res.end(); }
  res.writeHead(200, { ...head, 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readBody(req) {
  const buf = await readRaw(req, 2e6);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.resolve(UI, rel);
  if (!file.startsWith(UI + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  if (rel.startsWith('vendor/') || rel.startsWith('assets/')) {   // vendored libraries and assets (models, HDRI): let the browser cache them
    res.writeHead(200, { 'content-type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff' });
    res.end(fs.readFileSync(file));
    return true;
  }
  // the file as it is (send() would JSON-encode a .json file's Buffer)
  res.writeHead(200, { 'content-type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(fs.readFileSync(file));
  return true;
}

const floorRoot = (id) => building.floorEntry(id).path;

// [method, pattern, handler(params, body, req), { pin, raw }]
const routes = [
  ['GET', /^\/api\/building$/, () => squad.buildingSnapshot()],
  ['GET', /^\/api\/version$/, () => ({ version: VERSION, root: ROOT })],
  ['GET', /^\/api\/watchdog$/, () => squad.watchdogStatus()],
  ['GET', /^\/api\/meter$/, () => meter.detail()],
  ['PATCH', /^\/api\/building$/, (p, b) => {
    if (b.name !== undefined) building.setBuildingName(b.name);
    // agents running at once on the whole machine; nightly backups
    if (b.maxAgents !== undefined) building.setPrefs({ maxAgents: Math.max(1, Math.min(40, parseInt(b.maxAgents, 10) || 6)) });
    if (b.backup !== undefined) building.setPrefs({ backup: backup.cleanSettings({ ...building.loadBuilding().prefs.backup, ...b.backup }) });
    if (b.backupPassphrase !== undefined) backup.setPassphrase(String(b.backupPassphrase || ''));
    if (b.squadsDir !== undefined) { if (!path.isAbsolute(String(b.squadsDir))) throw new HttpError(400, 'The squads folder must be an absolute path'); building.setPrefs({ squadsDir: path.resolve(String(b.squadsDir)) }); }
    squad.invalidate(); return { ok: true };
  }, { pin: true, history: () => ({ label: 'Building settings' }) }],
  ['GET', /^\/api\/doctor$/, () => runDoctor({ service: (() => { try { return service.status(); } catch { return null; } })() }), { pin: true }],
  ['GET', /^\/api\/backups$/, () => { const s = backup.cleanSettings(building.loadBuilding().prefs.backup); return { settings: s, defaultDir: backup.defaultDir(), status: backup.readStatus(), encrypted: !!backup.storedPassphrase(), backups: backup.listBackups(s.dir || backup.defaultDir()).slice(0, 30) }; }, { pin: true }],
  ['POST', /^\/api\/backups$/, () => { const s = backup.cleanSettings(building.loadBuilding().prefs.backup); const r = backup.createBackup({ out: s.dir || backup.defaultDir(), passphrase: backup.storedPassphrase(), logs: s.logs }); return { ok: true, ...r }; }, { pin: true }],
  ['POST', /^\/api\/backups\/verify$/, (p, b) => { const s = backup.cleanSettings(building.loadBuilding().prefs.backup); const dir = s.dir || backup.defaultDir(); const f = backup.listBackups(dir).find((x) => x.name === String(b.name || '')); if (!f) throw notFound('Backup not found'); return backup.verifyBackup(f.file, { passphrase: backup.storedPassphrase() }); }, { pin: true }],
  // Admin Panel (0.12): overview, change history with rollback, the Company Brain
  ['GET', /^\/api\/admin$/, () => admin.overview(), { pin: true }],
  ['GET', /^\/api\/history$/, (p, b, req) => ({ changes: history.list({ floorId: new URL(req.url, 'http://x').searchParams.get('floor') || '', limit: 100 }) }), { pin: true }],
  ['GET', /^\/api\/history\/(h-[\w-]+)$/, ([id]) => history.get(id), { pin: true }],
  ['POST', /^\/api\/history\/(h-[\w-]+)\/rollback$/, ([id], b, req) => {
    const r = history.rollback(id, { force: !!b.force, actor: req.actor || 'owner' });
    const e = history.get(r.id);
    if (e.floorId) { try { floors.generate(building.floorEntry(e.floorId).path); } catch { /* the Floor is gone */ } }
    squad.invalidate();
    return r;
  }, { pin: true }],
  ['GET', /^\/api\/company$/, () => company.summary(company.companyDir(building.loadBuilding().prefs)), { pin: true }],
  ['PATCH', /^\/api\/company$/, (p, b) => { building.setPrefs({ company: company.cleanCompany(b) }); for (const f of building.loadBuilding().floors) { try { floors.generate(f.path); } catch { /* missing */ } } squad.invalidate(); return company.summary(company.companyDir(building.loadBuilding().prefs)); }, { pin: true, history: () => ({ label: 'Company Brain folder' }) }],
  ['POST', /^\/api\/company\/init$/, () => { const r = company.ensure(company.companyDir(building.loadBuilding().prefs)); for (const f of building.loadBuilding().floors) { try { floors.generate(f.path); } catch { /* missing */ } } squad.invalidate(); return r; }, { pin: true }],
  // Claude sign-in of background runs (docs/BILLING.md); the API key is write-only
  ['GET', /^\/api\/auth$/, () => ({ ...auth.cleanAuth(building.loadBuilding().prefs.auth), key: auth.keyStatus(), modes: auth.MODES }), { pin: true }],
  ['PATCH', /^\/api\/auth$/, (p, b) => { building.setPrefs({ auth: auth.cleanAuth(b) }); return { ...auth.cleanAuth(building.loadBuilding().prefs.auth), key: auth.keyStatus() }; }, { pin: true }],
  ['PUT', /^\/api\/auth\/key$/, (p, b) => ({ key: auth.setApiKey(b.key) }), { pin: true }],
  ['DELETE', /^\/api\/auth\/key$/, () => ({ key: auth.clearApiKey() }), { pin: true }],
  // background jobs (headless runner)
  ['GET', /^\/api\/jobs$/, (p, b, req) => { const q = new URL(req.url, 'http://x').searchParams; return { jobs: jobs.listJobs({ floorId: q.get('floor') || '', agentId: q.get('agent') || '', limit: 50 }).map(({ prompt, ...j }) => j) }; }, { pin: true }],
  ['GET', /^\/api\/jobs\/(j-[\w-]+)$/, ([id]) => jobs.jobDetail(id), { pin: true }],
  ['POST', /^\/api\/jobs\/(j-[\w-]+)\/stop$/, ([id]) => { const j = jobs.stopJob(id); squad.stopRemote(j); squad.logJobEnded(j); return { ok: true, job: j }; }, { pin: true }],
  ['GET', /^\/api\/blueprints$/, () => ({ blueprints: blueprints.listBlueprints().map(({ dir, ...b }) => b), squadsDir: squadsDir(), nextFloorNumber: building.nextFloorNumber() })],
  ['GET', /^\/api\/catalog$/, () => ({ templates: blueprints.catalog() })],
  ['POST', /^\/api\/floors\/([\w-]+)\/skills\/install$/, ([id], b) => squad.installSkills(id, b.names || b.name), { pin: true }],
  ['POST', /^\/api\/squads\/recommend$/, (p, b) => recommend({ prompt: b.prompt, blueprint: b.blueprint, useClaude: b.useClaude !== false }), { pin: true }],
  ['POST', /^\/api\/squads$/, async (p, b) => {
    const r = await createSquad(b);
    if (b.startLead && r.lead) { try { const s = await squad.startAgent(r.id, r.lead, b.kickoff || blueprints.getBlueprint(r.blueprint.id).kickoff, { guard: true }); r.leadStarted = !s.waiting; if (s.waiting) r.leadQueued = s.dispatch; } catch (e) { r.leadError = e.message; } }
    squad.invalidate();
    return r;
  }, { pin: true }],
  ['POST', /^\/api\/auth$/, (p, b, req) => ({ ok: true, user: req.user }), { pin: true }],
  // people (0.14): the Owner adds members and viewers, each with an own PIN (shown once)
  ['GET', /^\/api\/me$/, (p, b, req) => ({ user: req.user }), { pin: true }],
  ['GET', /^\/api\/users$/, () => ({ users: users.listUsers(), roles: users.ROLES }), { pin: true }],
  ['POST', /^\/api\/users$/, (p, b, req) => users.addUser(b, req.ownerPin), { pin: true }],
  ['PATCH', /^\/api\/users\/([\w-]+)$/, ([id], b) => ({ user: users.updateUser(id, b) }), { pin: true }],
  ['POST', /^\/api\/users\/([\w-]+)\/pin$/, ([id], b, req) => users.resetPin(id, req.ownerPin), { pin: true }],
  ['DELETE', /^\/api\/users\/([\w-]+)$/, ([id]) => users.removeUser(id), { pin: true }],
  ['POST', /^\/api\/events$/, (p, b) => squad.ingestEvent(b), { pin: true }],
  ['GET', /^\/api\/events$/, () => ({ events: hooksRecent() }), { pin: true }],

  ['GET', /^\/api\/roles$/, () => ({ templates: roles.listTemplates(), models: roles.MODELS, efforts: roles.EFFORTS, styles: roles.STYLES, props: roles.PROPS, screens: roles.SCREENS })],
  ['GET', /^\/api\/roles\/([\w-]+)$/, ([role]) => ({ template: roles.getTemplate(role), versions: roles.templateVersions(role) })],
  ['GET', /^\/api\/roles\/([\w-]+)\/versions\/(\d+)$/, ([role, v]) => { const t = roles.templateText(role, +v); if (!t) throw notFound('Unknown version'); return { text: t }; }],
  ['GET', /^\/api\/roles\/([\w-]+)\/diff$/, ([role], b, req) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const from = roles.templateText(role, +q.get('from')), to = roles.templateText(role, +q.get('to'));
    if (!from || !to) throw notFound('Unknown version');
    return { role, from: +q.get('from'), to: +q.get('to'), diff: lineDiff(from, to) };
  }],
  ['GET', /^\/api\/libraries$/, async () => ({ libraries: await libraries.listStatus() })],
  ['GET', /^\/api\/libraries\/([\w-]+)\/templates$/, ([name]) => ({ templates: roles.libraryTemplates(name) })],
  ['POST', /^\/api\/libraries$/, async (p, b) => { const e = libraries.addLibrary(b); const st = e.url ? await libraries.pull(e.name) : await libraries.status(e); squad.invalidate(); return { ok: true, library: st }; }, { pin: true }],
  ['POST', /^\/api\/libraries\/([\w-]+)\/pull$/, async ([name]) => { const st = await libraries.pull(name); squad.invalidate(); return { ok: true, library: st }; }, { pin: true }],
  ['DELETE', /^\/api\/libraries\/([\w-]+)$/, ([name]) => { libraries.removeLibrary(name); squad.invalidate(); return { ok: true }; }, { pin: true }],
  ['POST', /^\/api\/libraries\/([\w-]+)\/templates\/([\w-]+)\/copy$/, ([name, role], b) => roles.copyToLocal(name, role, b.as || role), { pin: true }],
  ['POST', /^\/api\/roles$/, (p, b) => roles.saveTemplate(b, { create: true }), { pin: true }],
  ['PUT', /^\/api\/roles\/([\w-]+)$/, ([role], b) => { const r = roles.saveTemplate({ ...b, role }); squad.invalidate(); return r; }, { pin: true }],

  ['POST', /^\/api\/floors$/, async (p, b) => { const r = await floors.createFloor(b); squad.invalidate(); return { ok: true, id: r.entry.id, number: r.entry.number }; }, { pin: true }],
  ['POST', /^\/api\/floors\/adopt$/, (p, b) => { const e = floors.adoptFloor(String(b.path || ''), { number: b.number }); squad.invalidate(); return { ok: true, id: e.id }; }, { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)$/, ([id]) => squad.floorDetail(id)],
  ['GET', /^\/api\/floors\/([\w-]+)\/shot$/, ([id], b, req) => ({ __file: squad.shotFile(id, new URL(req.url, 'http://x').searchParams.get('f')) })],
  ['PATCH', /^\/api\/floors\/([\w-]+)$/, ([id], b) => {
    if (b.number !== undefined) building.setFloorNumber(id, b.number);
    floors.updateFloorConfig(floorRoot(id), b);
    if (b.git && b.git.autoMergeApproved !== undefined) setApproval(id, !!b.git.autoMergeApproved);
    squad.invalidate();
    return { ok: true };
  }, { pin: true, history: ([id]) => ({ label: 'Floor settings', floorId: id }) }],
  ['GET', /^\/api\/floors\/([\w-]+)\/merges$/, ([id]) => squad.floorMerges(id)],
  ['GET', /^\/api\/floors\/([\w-]+)\/repos$/, ([id]) => squad.floorRepos(id)],
  ['PUT', /^\/api\/floors\/([\w-]+)\/repos$/, ([id], b) => squad.updateRepos(id, b.repos), { pin: true, history: ([id]) => ({ label: 'Repositories', floorId: id }) }],
  ['PATCH', /^\/api\/floors\/([\w-]+)\/repos\/([a-z0-9-]+)$/, ([id, rid], b) => (b.approved !== undefined ? squad.setRepoApproval(id, rid, b.approved) : squad.relinkRepo(id, rid, String(b.path || ''))), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/repos\/([a-z0-9-]+)\/clone$/, ([id, rid]) => squad.cloneRepo(id, rid), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/performance$/, ([id]) => squad.performance(id)],
  ['GET', /^\/api\/floors\/([\w-]+)\/audits$/, ([id]) => squad.floorAudits(id), { pin: true }],
  ['GET', /^\/api\/voice$/, () => squad.voiceInfo()],
  ['PATCH', /^\/api\/voice$/, (p, b) => squad.setVoiceSettings(b), { pin: true }],
  ['PUT', /^\/api\/voice\/key$/, (p, b) => { voice.setKey(b.key); return squad.voiceInfo(); }, { pin: true }],
  ['DELETE', /^\/api\/voice\/key$/, () => { voice.clearKey(); return squad.voiceInfo(); }, { pin: true }],
  ['GET', /^\/api\/voice\/voices$/, () => squad.voiceList(), { pin: true }],                     // { voices, error }
  ['POST', /^\/api\/voice\/preview$/, async (p, b) => { const r = await squad.voicePreview(b); return r.audio ? { __audio: r.audio } : { ok: false, ...r }; }, { pin: true }],
  ['POST', /^\/api\/voice\/test$/, async () => { const r = await squad.voiceTest(); return r.audio ? { __audio: r.audio } : { ok: false, ...r }; }, { pin: true }],
  ['POST', /^\/api\/voice\/speak$/, async (p, b) => { const r = await squad.speakLine(b); return r.audio ? { __audio: r.audio } : { ok: false, fallback: r.fallback, reason: r.reason, error: r.error || null, text: r.text }; }, { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/designs$/, ([id]) => squad.floorDesigns(id)],
  ['GET', /^\/api\/floors\/([\w-]+)\/designs\/([a-z0-9-]+)\/([\w.-]+\.html)$/, ([id, screen, file]) => ({ __file: squad.designVariantFile(id, screen, file), sandbox: true }), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/designs\/([a-z0-9-]+)\/pick$/, ([id, screen], b) => squad.pickDesign(id, screen, String(b.file || ''), b.note), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/ship$/, ([id]) => squad.floorShip(id)],
  ['GET', /^\/api\/floors\/([\w-]+)\/standup$/, ([id]) => squad.floorStandup(id), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/retro$/, ([id], b, req) => squad.floorRetro(id, new URL(req.url, 'http://x').searchParams.get('sprint')), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/retro\/send$/, ([id], b) => squad.sendRetroToLead(id, b.sprint ?? null), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/audits\/([\w-]+)$/, ([id, aid]) => squad.floorAudit(id, aid), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/audits$/, ([id], b) => { squad.startAudit(id, { sprint: b.sprint, model: b.model }).catch((e) => console.error('[audit]', e.message)); return { ok: true, started: true }; }, { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/audits\/([\w-]+)\/findings\/(F\d+)\/proposal$/, ([id, aid, fid]) => squad.findingProposal(id, aid, fid), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/audits\/([\w-]+)\/findings\/(F\d+)\/apply$/, ([id, aid, fid]) => squad.applyFinding(id, aid, fid), { pin: true, history: ([id, aid, fid]) => ({ label: `Audit finding ${fid} applied`, floorId: id }) }],
  ['POST', /^\/api\/floors\/([\w-]+)\/audits\/([\w-]+)\/findings\/(F\d+)\/dismiss$/, ([id, aid, fid], b) => squad.dismissFinding(id, aid, fid, b.reason), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/blueprint\/update$/, ([id]) => squad.updateFloorBlueprint(id), { pin: true, history: ([id]) => ({ label: 'Blueprint update', floorId: id }) }],
  ['GET', /^\/api\/floors\/([\w-]+)\/log$/, ([id], b, req) => squad.floorLog(id, Object.fromEntries(new URL(req.url, 'http://x').searchParams)), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/merges$/, ([id], b) => squad.startMerge(id, b.branch, b.repo || ''), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/merge-approval$/, ([id], b) => { building.floorEntry(id); setApproval(id, !!b.approved); squad.invalidate(); return { ok: true, approved: !!b.approved }; }, { pin: true }],
  ['DELETE', /^\/api\/floors\/([\w-]+)$/, ([id]) => { building.unregisterFloor(id); squad.invalidate(); return { ok: true }; }, { pin: true, history: ([id]) => ({ label: `Floor ${id} removed from the Building` }) }],

  ['POST', /^\/api\/floors\/([\w-]+)\/agents$/, ([id], b) => { const a = floors.addAgent(floorRoot(id), b); squad.invalidate(); return { ok: true, agent: a }; }, { pin: true, history: ([id], b) => ({ label: `Agent added: ${String(b.displayName || '').slice(0, 60)}`, floorId: id }) }],
  ['GET', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)$/, ([id, a]) => squad.deskDetail(id, a), { pin: true }],
  ['PATCH', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)$/, ([id, a], b) => { const r = floors.updateAgent(floorRoot(id), a, b); squad.invalidate(); return { ok: true, agent: r }; }, { pin: true, history: ([id, a]) => ({ label: `Agent edited: ${a}`, floorId: id }) }],
  ['DELETE', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)$/, ([id, a]) => { squad.stopAgent(id, a); floors.removeAgent(floorRoot(id), a); squad.invalidate(); return { ok: true }; }, { pin: true, history: ([id, a]) => ({ label: `Agent removed: ${a}`, floorId: id }) }],
  ['GET', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/diff$/, ([id, a]) => {
    const { team } = floors.readFloor(floorRoot(id));
    const agent = team.agents.find((x) => x.id === a); if (!agent) throw notFound('Agent not found');
    return floors.templateDiff(floorRoot(id), agent);
  }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/template$/, ([id, a], b) => { const r = floors.templateAction(floorRoot(id), a, b.action); squad.invalidate(); return { ok: true, agent: r }; }, { pin: true, history: ([id, a], b) => ({ label: `Template ${String(b.action || '')} for ${a}`, floorId: id }) }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/start$/, ([id, a], b) => squad.startAgent(id, a, b.task ? squad.withAttachments(b.task, b.attachments) : '', { guard: !b.force }), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/docs$/, ([id]) => squad.sourceDocs(id)],
  ['GET', /^\/api\/floors\/([\w-]+)\/docs\/text$/, ([id], b, req) => squad.sourceDocText(id, new URL(req.url, 'http://x').searchParams.get('path')), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/docs\/approve$/, ([id], b) => squad.approveSourceDoc(id, b.path), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/docs\/changes$/, ([id], b) => squad.requestDocChanges(id, b.path, b.text), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/resume$/, ([id, a], b) => squad.resumeAgent(id, a, { guard: !b.force }), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/stop$/, ([id, a]) => squad.stopAgent(id, a), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/jobs$/, async ([id, a], b) => {
    const r = await squad.startAgentJob(id, a, squad.withAttachments(String(b.prompt || '').trim(), b.attachments), { budgetUsd: b.budgetUsd, permissionMode: b.permissionMode, guard: !b.force });
    return r.waiting || r.job ? r : { ok: true, job: r };
  }, { pin: true }],
  // the dispatcher (0.13): queue, slots, quota guard; its settings are Building settings (recorded in Changes)
  ['GET', /^\/api\/dispatcher$/, () => squad.dispatchStatus(), { pin: true }],
  ['PATCH', /^\/api\/dispatcher$/, (p, b) => { building.setPrefs({ dispatcher: dispatcher.cleanDispatcher({ ...building.loadBuilding().prefs.dispatcher, ...b, quota: { ...building.loadBuilding().prefs.dispatcher?.quota, ...b.quota } }) }); squad.invalidate(); return squad.dispatchStatus(); }, { pin: true, history: () => ({ label: 'Dispatcher settings' }) }],
  ['POST', /^\/api\/dispatcher\/queue\/([\w-]+)\/start$/, ([id]) => squad.startQueued(id), { pin: true }],
  ['PATCH', /^\/api\/dispatcher\/queue\/([\w-]+)$/, ([id], b) => { dispatcher.setPriority(id, String(b.priority || '')); squad.invalidate(); return { ok: true }; }, { pin: true }],
  ['DELETE', /^\/api\/dispatcher\/queue\/([\w-]+)$/, ([id]) => squad.dropQueued(id), { pin: true }],
  // more machines (0.18): a worker's own calls (its token, not a PIN) and the Owner's list of machines
  ['POST', /^\/api\/nodes\/heartbeat$/, (p, b, req) => nodes.heartbeat(req.node.name, b), { node: true }],
  ['GET', /^\/api\/nodes\/work$/, (p, b, req) => nodes.nextWork(req.node.name, Math.min(30e3, (Number(new URL(req.url, 'http://x').searchParams.get('wait')) || 25) * 1000)), { node: true }],
  ['POST', /^\/api\/nodes\/jobs\/(j-[\w-]+)$/, ([id], b, req) => squad.remoteReport(req.node.name, id, b), { node: true }],
  ['GET', /^\/api\/nodes$/, () => ({ nodes: nodes.listNodes(), head: squad.buildingSnapshot().limits, offlineAfterMs: nodes.OFFLINE_MS }), { pin: true }],
  ['POST', /^\/api\/nodes$/, (p, b) => { const r = nodes.addNode(b.name); return { ...r, command: `aisquad node --head <address of this machine>:8097 --name ${r.node.name} --token ${r.token}` }; }, { pin: true, history: () => ({ label: 'Machine added' }) }],
  ['PATCH', /^\/api\/nodes\/([\w-]+)$/, ([name], b) => nodes.setDrain(name, b.drain), { pin: true }],
  ['DELETE', /^\/api\/nodes\/([\w-]+)$/, ([name]) => nodes.removeNode(name), { pin: true }],
  // the Notification Gateway (0.15): Telegram token (write-only), settings, pairing, chats, test, digest
  ['GET', /^\/api\/notify$/, () => notify.status(), { pin: true }],
  ['PATCH', /^\/api\/notify$/, (p, b) => { building.setPrefs({ notify: notify.cleanNotify({ ...notify.settings(), ...b, quiet: { ...notify.settings().quiet, ...(b.quiet || {}) } }) }); notify.restart(); return notify.status(); }, { pin: true, history: () => ({ label: 'Notification settings' }) }],
  ['PUT', /^\/api\/notify\/telegram\/token$/, async (p, b) => ({ token: await notify.setToken(b.token, { check: b.check !== false }) }), { pin: true }],
  ['DELETE', /^\/api\/notify\/telegram\/token$/, () => ({ token: notify.clearToken() }), { pin: true }],
  ['POST', /^\/api\/notify\/pair$/, (p, b, req) => notify.newPairing(req.user), { pin: true }],
  ['DELETE', /^\/api\/notify\/chats\/(-?\d+)$/, ([id]) => notify.removeChat(id), { pin: true }],
  ['POST', /^\/api\/notify\/test$/, () => notify.sendTest(), { pin: true }],
  ['POST', /^\/api\/notify\/digest$/, (p, b, req) => notify.sendDigestNow(req.user), { pin: true }],
  // Daily Insight and the Improvement Inbox (0.15): suggestions only; the Owner accepts or dismisses
  ['GET', /^\/api\/insights$/, () => inbox.list(), { pin: true }],
  ['PATCH', /^\/api\/insights$/, (p, b) => { building.setPrefs({ insight: insight.cleanInsight({ ...building.loadBuilding().prefs.insight, ...b }) }); return inbox.list(); }, { pin: true, history: () => ({ label: 'Daily Insight settings' }) }],
  ['POST', /^\/api\/insights\/run$/, () => { const r = inbox.run(); return { ...inbox.list(), added: r.added.length }; }, { pin: true }],
  ['POST', /^\/api\/insights\/([\w-]+)\/accept$/, ([id], b, req) => inbox.accept(id, req.user), { pin: true }],
  ['POST', /^\/api\/insights\/([\w-]+)\/dismiss$/, ([id], b, req) => inbox.dismiss(id, req.user, b.reason), { pin: true }],
  // direct chat with one agent (0.14): ?context=space|general
  ['GET', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/chat$/, ([id, a], b, req) => squad.chatThread(id, a, new URL(req.url, 'http://x').searchParams.get('context') || 'space'), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/chat$/, ([id, a], b, req) => squad.sendChat(id, a, b.text, { context: b.context || 'space', user: req.user }), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/task$/, ([id, a], b) => squad.sendTask(id, a, b.text, b.attachments), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/work-done$/, ([id, a]) => { squad.clearWork(id, a); squad.invalidate(); return { ok: true }; }, { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/attachments$/, async ([id], b, req) => {
    const buf = await readRaw(req, 20 * 2 ** 20);
    return { ok: true, ...squad.saveAttachment(id, decodeURIComponent(String(req.headers['x-filename'] || '')), buf) };
  }, { pin: true, raw: true }],

  ['POST', /^\/api\/independents\/rescan$/, () => squad.rescanIndependents(), { pin: true }],
  ['POST', /^\/api\/independents\/([\w-]+)\/adopt$/, ([id], b) => squad.adoptIndependent(id, b), { pin: true }],
  ['POST', /^\/api\/attention\/(\w+)\/answer$/, ([id], b) => squad.answerAttention(id, b.option, b.text, { force: !!b.force, floorId: String(b.floorId || ''), agentId: String(b.agentId || ''), kind: String(b.kind || '') }), { pin: true }],
];

// 127.0.0.0/8, ::1 and localhost; 0.0.0.0, :: and real addresses are not
export const isLoopback = (host) => /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\])$/i.test(String(host || '').trim());

// host: the address the server is bound to. Off loopback every /api read needs the PIN as well.
export function createHandler({ pin, host = '127.0.0.1' }) {
  const lockReads = !isLoopback(host);
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        if (serveStatic(res, url.pathname)) return;
        return send(res, 404, 'Not found', 'text/plain');
      }
      for (const [method, re, handler, opts = {}] of routes) {
        if (method !== req.method) continue;
        const m = url.pathname.match(re);
        if (!m) continue;
        // a worker machine (0.18): its own token, only for its own routes
        if (opts.node) {
          const node = nodes.authNode(req.headers['x-aisquad-node']);
          if (!node) return send(res, 401, { error: 'Unknown machine or token' });
          req.node = node;
          return send(res, 200, await handler(m.slice(1), method === 'GET' ? {} : await readBody(req), req));
        }
        // who is asking (0.14): the Owner's PIN, or a person's own PIN; reads on loopback stay open without one
        const user = users.identify(req.headers['x-aisquad-pin'], pin);
        if ((opts.pin || lockReads) && !user) return send(res, 401, { error: 'PIN required' });
        const need = access.requiredRole(method, url.pathname);
        if (user && !access.allows(user, need)) return send(res, 403, { error: `Only ${need === 'owner' ? 'the Owner' : 'a member or the Owner'} can do this` });
        if (!user && need === 'owner' && method !== 'GET') return send(res, 401, { error: 'PIN required' });
        if (access.hiddenPath(url.pathname, user)) return send(res, 404, { error: 'Floor not found' });
        Object.assign(req, { user: user || null, actor: user?.name || 'owner', ownerPin: pin });
        const body = opts.raw || method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
        if (body && typeof body === 'object' && body.floorId && access.hiddenPath(`/api/floors/${body.floorId}`, user)) return send(res, 404, { error: 'Floor not found' });
        // configuration is code: changes to the Building or a Space are recorded with their before and after (server/history.js)
        let out = await access.actorStore.run({ user }, async () => {
          if (!opts.history) return handler(m.slice(1), body, req);
          const h = opts.history(m.slice(1), body);
          let root = ''; if (h.floorId) { try { root = building.floorEntry(h.floorId).path; } catch { /* not registered (yet) */ } }
          return history.track(h.label, { root, floorId: h.floorId || '', actor: req.actor }, () => handler(m.slice(1), body, req));
        });
        if (method !== 'GET' && /^\/api\/floors/.test(url.pathname)) access.forgetOwnerFloors();
        out = access.redact(url.pathname, out, user);
        if (out === null) return send(res, 404, { error: 'Not found' });
        if (out && out.__audio) { res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); return res.end(out.__audio); }
        if (out && out.__file && out.sandbox) {
          // a design variant: shown in an iframe, sandboxed (no scripts, no access to The AI Squad), nothing from outside
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
            'content-security-policy': "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; font-src data:" });
          return res.end(fs.readFileSync(out.__file));
        }
        if (out && out.__file) return send(res, 200, fs.readFileSync(out.__file), TYPES[path.extname(out.__file).toLowerCase()] || 'image/jpeg');
        // reads open without the PIN (building, Floors) revalidate with an ETag; anything behind the PIN stays no-store
        return method === 'GET' && !opts.pin && !lockReads ? sendJsonGet(req, res, out) : send(res, 200, out);
      }
      send(res, 404, { error: 'Not found' });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e.message || 'Server error', ...(status !== 500 && e.data ? e.data : {}) });
    }
  };
}
