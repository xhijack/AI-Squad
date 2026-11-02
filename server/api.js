// SPDX-License-Identifier: Apache-2.0
// JSON API + static UI. On a loopback address (the default) reads are open and every change and agent
// screen needs a signed-in person; on any other address every /api call needs one, and in public mode (1.9, behind a
// proxy or a tunnel) every route does, static files included. A browser signs in with its PIN once and keeps a
// session cookie (server/sessions.js); tools on this machine send the PIN in the header x-aisquad-pin.
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
import * as idem from './idempotency.js';
import * as history from './history.js';
import * as company from './company.js';
import * as admin from './admin.js';
import * as users from './users.js';
import * as access from './access.js';
import * as notify from './notify.js';
import * as inbox from './inbox.js';
import * as insight from './insight.js';
import * as nodes from './nodes.js';
import * as erp from './erpnext.js';
import * as tiering from './tiering.js';
import * as trust from './trust.js';
import * as kpi from './kpi.js';
import * as cadence from './cadence.js';
import * as behind from './behind.js';
import * as guide from './guide.js';
import * as update from './update.js';
import * as proposals from './proposals.js';
import * as promote from './promote.js';
import * as integ from './integrations.js';
import * as google from './google.js';
import * as agentToken from './agenttoken.js';
import * as squadLog from './log.js';
import * as proxy from './proxy.js';
import * as sessions from './sessions.js';
import * as limits from './limits.js';
import * as cfaccess from './cfaccess.js';
import * as harden from './harden.js';
import * as second from './secondfactor.js';

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
async function readBody(req, max = harden.BODY_LIMIT) {
  const buf = await readRaw(req, max);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname === '/admin' ? 'admin.html' : decodeURIComponent(pathname.slice(1));   // /admin: the settings page (1.10)
  const file = path.resolve(UI, rel);
  if (!file.startsWith(UI + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  if (rel.startsWith('vendor/') || rel.startsWith('assets/')) {   // vendored libraries and assets (models, HDRI): let the browser cache them
    res.writeHead(200, { 'content-type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff' });
    res.end(fs.readFileSync(file));
    return true;
  }
  // the page carries the Building's language, so the first paint is already in it (ui/i18n.js)
  if (rel === 'index.html' || rel === 'login.html' || rel === 'admin.html') {
    const lang = building.loadBuilding().prefs.lang;
    const html = fs.readFileSync(file, 'utf8');
    // its inline scripts (theme, import map, boot) are allowed by hash, nothing else inline (server/harden.js)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': harden.csp({ scripts: harden.scriptHashes(html) }) });
    res.end(['en', 'id'].includes(lang) ? html.replace('<html lang="en"', `<html lang="${lang}" data-lang="${lang}"`) : html);
    return true;
  }
  // the file as it is (send() would JSON-encode a .json file's Buffer)
  res.writeHead(200, { 'content-type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(fs.readFileSync(file));
  return true;
}

const floorRoot = (id) => building.floorEntry(id).path;

// [method, pattern, handler(params, body, req), { pin, raw }]
// the Space's webhook address for the Owner; none while the values file is unreadable
const spaceOf = (id) => { building.floorEntry(id); return integ.spaces().find((s) => s.id === id); };
const hookOf = (id) => { try { return `/api/kpi/hook/${kpi.token(id)}`; } catch { return null; } };
const routes = [
  ['GET', /^\/api\/building$/, () => squad.buildingSnapshot()],
  ['GET', /^\/api\/version$/, () => ({ version: VERSION, root: ROOT })],
  // the app updates itself (1.10): check (cached 6 hours), check now, update and restart
  ['GET', /^\/api\/update$/, () => update.check(), { pin: true }],
  ['POST', /^\/api\/update\/check$/, () => update.check({ force: true }), { pin: true }],
  ['POST', /^\/api\/update$/, async (p, b, req) => { const r = await update.apply(); console.log(`[update] ${r.from} -> ${r.to} by ${req.user?.name || 'Owner'}, restarting (${r.restart})`); return r; }, { pin: true }],
  ['GET', /^\/api\/watchdog$/, () => squad.watchdogStatus()],
  ['GET', /^\/api\/meter$/, () => meter.detail()],
  ['PATCH', /^\/api\/building$/, (p, b) => {
    if (b.name !== undefined) building.setBuildingName(b.name);
    if (b.lang !== undefined) building.setPrefs({ lang: ['en', 'id'].includes(b.lang) ? b.lang : 'en' });      // the Building's UI language (1.2.0)
    // agents running at once on the whole machine; nightly backups
    if (b.maxAgents !== undefined) building.setPrefs({ maxAgents: Math.max(1, Math.min(40, parseInt(b.maxAgents, 10) || 6)) });
    if (b.backup !== undefined) building.setPrefs({ backup: backup.cleanSettings({ ...building.loadBuilding().prefs.backup, ...b.backup }) });
    if (b.backupPassphrase !== undefined) backup.setPassphrase(String(b.backupPassphrase || ''));
    if (b.squadsDir !== undefined) { if (!path.isAbsolute(String(b.squadsDir))) throw new HttpError(400, 'The squads folder must be an absolute path'); building.setPrefs({ squadsDir: path.resolve(String(b.squadsDir)) }); }
    squad.invalidate(); return { ok: true };
  }, { pin: true, history: () => ({ label: 'Building settings' }) }],
  ['GET', /^\/api\/doctor$/, (p, b, req) => runDoctor({ service: (() => { try { return service.status(); } catch { return null; } })(), online: req.online() }), { pin: true }],
  ['GET', /^\/api\/online$/, (p, b, req) => req.online(), { pin: true }],
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
  // a new PIN or a removed person ends that person's sessions (1.9)
  ['POST', /^\/api\/users\/([\w-]+)\/pin$/, ([id], b, req) => { const r = users.resetPin(id, req.ownerPin); sessions.revokeAll({ userId: id }); return r; }, { pin: true }],
  ['DELETE', /^\/api\/users\/([\w-]+)$/, ([id]) => { const r = users.removeUser(id); sessions.revokeAll({ userId: id }); return r; }, { pin: true }],
  // "Sign out everywhere" (1.9): every session of every person, this one included
  ['POST', /^\/api\/sessions\/revoke-all$/, (p, b, req) => { const n = sessions.revokeAll(); logAuth('auth.signed_out', { ip: req.client.ip, role: req.user.role, user: req.user.name, everywhere: true, sessions: n }); return { ok: true, sessions: n }; }, { pin: true }],
  ['GET', /^\/api\/security$/, () => ({ lockout: limits.status(), sessions: sessions.count(), events: squadLog.read(squadLog.BUILDING, { from: Date.now() - 7 * 864e5 }).slice(-50).reverse() }), { pin: true }],
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
  // handoffs between Spaces and ERPNext (0.19): the list for everyone (Owner-only Spaces hidden), ERPNext for the Owner
  // the Company Guide (1.4): the owner's answers, the plan, the build
  // what the squads learned (1.11): proposals to approve, the facts and skills kept, their versions
  ['GET', /^\/api\/proposals$/, () => ({ pending: proposals.pending(), decided: proposals.load().filter((p) => p.status !== 'pending').slice(-50).reverse(), learned: proposals.learned() }), { pin: true }],
  ['GET', /^\/api\/proposals\/(p-[\w-]+)$/, ([id]) => { const p = proposals.get(id); if (!p) throw notFound('Proposal not found'); const current = proposals.current(p.kind, p.target); return { ...p, current, diff: p.kind === 'fact' ? null : lineDiff(current || '', p.content) }; }, { pin: true }],
  ['POST', /^\/api\/proposals\/(p-[\w-]+)\/approve$/, ([id], b, req) => proposals.approve(id, { content: typeof b.content === 'string' ? b.content : null, scope: b.scope === 'all' ? 'all' : 'space', by: req.user?.name || 'Owner' }), { pin: true }],
  ['POST', /^\/api\/proposals\/(p-[\w-]+)\/reject$/, ([id], b, req) => proposals.reject(id, { reason: String(b.reason || ''), by: req.user?.name || 'Owner' }), { pin: true }],
  ['GET', /^\/api\/learned\/(fact|brain|skill)\/versions$/, ([kind], b, req) => { const q = new URL(req.url, 'http://x').searchParams; const target = q.get('target') || ''; return { versions: proposals.versions(kind, target), current: proposals.current(kind, target) }; }, { pin: true }],
  ['GET', /^\/api\/learned\/(fact|brain|skill)\/version$/, ([kind], b, req) => { const q = new URL(req.url, 'http://x').searchParams; return { text: proposals.versionText(kind, q.get('target') || '', q.get('v') || '') }; }, { pin: true }],
  ['POST', /^\/api\/learned\/(fact|brain|skill)\/restore$/, ([kind], b, req) => proposals.restore(kind, String(b.target || ''), String(b.version || ''), { by: req.user?.name || 'Owner' }), { pin: true }],
  ['GET', /^\/api\/guide$/, () => guide.state(), { pin: true }],
  ['PUT', /^\/api\/guide$/, (p, b) => guide.answer(b?.answers || {}, b?.step), { pin: true }],
  ['DELETE', /^\/api\/guide$/, () => guide.reset(), { pin: true }],
  ['POST', /^\/api\/guide\/plan$/, (p, b) => guide.plan({ useClaude: b.useClaude !== false }), { pin: true }],
  ['POST', /^\/api\/guide\/build$/, async (p, b) => { const r = await guide.build(b); squad.invalidate(); return r; }, { pin: true, history: () => ({ label: 'Company Guide: built' }) }],
  // targets (1.3): per Space, the cockpit across Spaces, a webhook for outside systems
  ['GET', /^\/api\/kpis$/, (p, b, req) => { const o = kpi.overview(); for (const s of o.spaces) { s.acting = behind.counts(s.id).acting; s.triggers = behind.history(s.id, 8); s.agents = squad.spaceAgents(s.id); if (req.user?.role === 'owner') s.hook = hookOf(s.id); } o.acting = o.spaces.reduce((n, s) => n + s.acting, 0); return o; }, {}],
  ['POST', /^\/api\/floors\/([\w-]+)\/kpis\/check$/, ([id]) => squad.targetCheck(id), { pin: true }],
  ['POST', /^\/api\/kpi\/hook\/([0-9a-f]{32})$/, ([tok], b) => {
    const f = kpi.floorOfToken(tok); if (!f) throw new HttpError(401, 'Unknown token');
    if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.kpi !== 'string') throw new HttpError(400, 'A JSON object: {"kpi": "<id>", "value": 12}');
    return kpi.record(f.id, f.path, b.kpi, b.value, { source: 'webhook', note: typeof b.note === 'string' ? b.note : '' });
  }, { hook: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/kpis$/, ([id], b, req) => ({ kpis: kpi.list(id, building.floorEntry(id).path), ...squad.targetTriggers(id), ...(req.user?.role === 'owner' ? { hook: hookOf(id) } : {}) }), {}],
  ['POST', /^\/api\/floors\/([\w-]+)\/kpis\/try$/, ([id], b) => kpi.trySource(building.floorEntry(id).path, b || {}), { pin: true }],   // the Owner's (access.js)
  ['POST', /^\/api\/floors\/([\w-]+)\/kpis\/hook$/, ([id]) => { building.floorEntry(id); return { hook: `/api/kpi/hook/${kpi.token(id, { rotate: true })}` }; }, { pin: true, history: ([id]) => ({ label: 'Webhook address renewed', floorId: id }) }],
  ['POST', /^\/api\/floors\/([\w-]+)\/kpis$/, ([id], b) => { const r = kpi.addKpi(building.floorEntry(id).path, b); kpi.render(building.floorEntry(id).path, id); return r; }, { pin: true, history: ([id]) => ({ label: 'Target added', floorId: id }) }],
  ['PATCH', /^\/api\/floors\/([\w-]+)\/kpis\/([\w-]+)$/, ([id, k], b, req) => { const r = kpi.updateKpi(building.floorEntry(id).path, k, b, { by: req.user?.name || '' }); kpi.render(building.floorEntry(id).path, id); return r; }, { pin: true, history: ([id]) => ({ label: 'Target changed', floorId: id }) }],
  ['DELETE', /^\/api\/floors\/([\w-]+)\/kpis\/([\w-]+)$/, ([id, k]) => { const r = kpi.removeKpi(building.floorEntry(id).path, k); kpi.render(building.floorEntry(id).path, id); return r; }, { pin: true, history: ([id]) => ({ label: 'Target removed', floorId: id }) }],
  ['POST', /^\/api\/floors\/([\w-]+)\/kpis\/([\w-]+)\/values$/, ([id, k], b, req) => kpi.record(id, building.floorEntry(id).path, k, b.value, { source: 'manual', by: req.user?.name || 'Owner', note: b.note }), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/kpis\/([\w-]+)\/measure$/, ([id, k], b, req) => kpi.measure(id, building.floorEntry(id).path, k, { by: req.user?.name || '' }), { pin: true }],
  // an agent's aisquad-google tool (1.8): the Space's agent token, never the PIN; the server makes the Google call
  ['POST', /^\/api\/google\/agent$/, (p, b, req) => google.agentCall(req.space, b || {}), { space: true }],
  // a Space's Google properties (1.8, .claude/aisquad/google.json: ids only) and Test: the Owner's (access.js)
  ['GET', /^\/api\/floors\/([\w-]+)\/google$/, ([id]) => { const sp = spaceOf(id); return { props: google.readProps(sp.path), effective: google.propsFor(sp), access: sp.access, clientEmail: google.status().clientEmail }; }, { pin: true }],
  ['PUT', /^\/api\/floors\/([\w-]+)\/google$/, ([id], b) => ({ props: google.saveProps(spaceOf(id).path, b || {}) }), { pin: true, history: ([id]) => ({ label: 'Google properties', floorId: id }) }],
  ['POST', /^\/api\/floors\/([\w-]+)\/google\/test$/, ([id]) => google.test(spaceOf(id)), { pin: true }],
  // cadence (1.5): routines per Space; the Owner defines them, Members run and toggle them, Viewers read
  ['GET', /^\/api\/cadence$/, () => squad.cadenceOverview(), {}],
  ['GET', /^\/api\/floors\/([\w-]+)\/cadence$/, ([id]) => squad.routinesOf(id), {}],
  ['POST', /^\/api\/floors\/([\w-]+)\/cadence$/, ([id], b) => { const r = cadence.add(building.floorEntry(id).path, b); if (r.enabled) cadence.markEnabled(id, r.id); squad.invalidate(); return r; }, { pin: true, history: ([id]) => ({ label: 'Routine added', floorId: id }) }],
  ['POST', /^\/api\/floors\/([\w-]+)\/cadence\/enable$/, ([id]) => squad.enableRoutines(id), { pin: true, history: ([id]) => ({ label: 'Routines turned on', floorId: id }) }],
  ['PATCH', /^\/api\/floors\/([\w-]+)\/cadence\/([\w-]+)$/, ([id, r], b) => { const { enabled, ...rest } = b || {}; cadence.update(building.floorEntry(id).path, r, rest); return enabled === undefined ? cadence.list(id, building.floorEntry(id).path).find((x) => x.id === r) : squad.setRoutineEnabled(id, r, enabled); }, { pin: true, history: ([id]) => ({ label: 'Routine changed', floorId: id }) }],
  ['DELETE', /^\/api\/floors\/([\w-]+)\/cadence\/([\w-]+)$/, ([id, r]) => { const out = cadence.remove(building.floorEntry(id).path, r); squad.invalidate(); return out; }, { pin: true, history: ([id]) => ({ label: 'Routine removed', floorId: id }) }],
  ['POST', /^\/api\/floors\/([\w-]+)\/cadence\/([\w-]+)\/toggle$/, ([id, r], b) => squad.setRoutineEnabled(id, r, b?.enabled === true), { pin: true, history: ([id], b) => ({ label: b?.enabled === true ? 'Routine turned on' : 'Routine turned off', floorId: id }) }],
  ['POST', /^\/api\/floors\/([\w-]+)\/cadence\/([\w-]+)\/run$/, ([id, r]) => squad.runRoutineNow(id, r), { pin: true }],
  // contracts in Legal Spaces and model tiering (0.20): the Owner's
  ['GET', /^\/api\/legal$/, () => squad.legalOverview(), { pin: true }],
  ['GET', /^\/api\/legal\/contract$/, (p, b, req) => squad.contractText(new URL(req.url, 'http://x').searchParams.get('key') || ''), { pin: true }],
  ['GET', /^\/api\/tiering$/, () => tiering.status(), { pin: true }],
  ['PATCH', /^\/api\/tiering$/, (p, b) => tiering.saveSettings(b), { pin: true, history: () => ({ label: 'Model tiering' }) }],
  ['GET', /^\/api\/handoffs$/, (p, b, req) => squad.handoffsOverview(req.user), { pin: true }],
  ['POST', /^\/api\/handoffs\/scan$/, () => squad.handoffTick(), { pin: true }],
  // integrations (1.6): the MCP servers the Building knows (masked), Test connection, the Owner's kind and read-only marks
  ['GET', /^\/api\/integrations$/, () => ({ ...integ.list(), google: google.status() }), { pin: true }],
  // the Google connector (1.8): the service account's key and the optional keys are write-only; only the client e-mail is shown
  ['PUT', /^\/api\/integrations\/google\/key$/, (p, b) => google.setServiceAccount(b?.key), { pin: true }],
  ['DELETE', /^\/api\/integrations\/google\/key$/, () => google.clearServiceAccount(), { pin: true }],
  ['PUT', /^\/api\/integrations\/google\/keys\/(psi|bing)$/, ([which], b) => google.setKey(which, b?.key), { pin: true }],
  ['PATCH', /^\/api\/integrations\/google$/, (p, b) => ({ owner: google.saveOwnerProps(b || {}) }), { pin: true, history: () => ({ label: 'Google properties (Owner)' }) }],
  ['POST', /^\/api\/integrations\/test$/, (p, b) => integ.test(String(b.id || '')), { pin: true }],
  ['PATCH', /^\/api\/integrations\/marks$/, (p, b) => integ.setMarks(String(b.id || ''), { kind: b.kind, readOnly: b.readOnly, paid: b.paid }), { pin: true }],
  ['GET', /^\/api\/erpnext$/, () => erp.status(), { pin: true }],
  ['PATCH', /^\/api\/erpnext$/, (p, b) => erp.saveSettings(b), { pin: true, history: () => ({ label: 'ERPNext settings' }) }],
  ['PUT', /^\/api\/erpnext\/keys\/(sales|delivery|finance|owner)$/, async ([role], b) => ({ keys: await erp.setKey(role, b.key, b.secret, { check: b.check !== false }) }), { pin: true }],
  ['DELETE', /^\/api\/erpnext\/keys\/(sales|delivery|finance|owner)$/, ([role]) => ({ keys: erp.clearKey(role) }), { pin: true }],
  ['POST', /^\/api\/erpnext\/test$/, () => erp.testAll(), { pin: true }],
  ['POST', /^\/api\/erpnext\/sync$/, () => erp.sync(), { pin: true }],
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
  ['POST', /^\/api\/insights\/trust$/, (p, b) => ({ trust: trust.setLevel(String(b.category || ''), b.level) }), { pin: true, history: () => ({ label: 'Daily Insight trust level' }) }],
  ['POST', /^\/api\/insights\/([\w-]+)\/canary$/, ([id], b, req) => trust.decideCanary(id, b.keep === true, { by: req.user?.name || 'Owner', rollback: history.rollback }), { pin: true }],
  // promoting a lesson from a Space (L2) to a Role Template (L1), always the Owner's call
  ['GET', /^\/api\/promote$/, () => promote.candidates(), { pin: true }],
  ['POST', /^\/api\/promote\/preview$/, (p, b) => promote.preview(b), { pin: true }],
  ['POST', /^\/api\/promote$/, (p, b, req) => promote.apply({ ...b, by: req.user?.name || 'Owner' }), { pin: true }],
  ['POST', /^\/api\/insights\/([\w-]+)\/accept$/, ([id], b, req) => inbox.accept(id, req.user), { pin: true }],
  ['POST', /^\/api\/insights\/([\w-]+)\/dismiss$/, ([id], b, req) => inbox.dismiss(id, req.user, b.reason), { pin: true }],
  // direct chat with one agent (0.14): ?context=space|general
  ['GET', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/chat$/, ([id, a], b, req) => squad.chatThread(id, a, new URL(req.url, 'http://x').searchParams.get('context') || 'space'), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/chat$/, ([id, a], b, req) => squad.sendChat(id, a, b.text, { context: b.context || 'space', user: req.user }), { pin: true }],
  // a reply denied tools in the background (1.0.1): allow narrow rules and run it again, or run it on the Desk
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/chat\/allow$/, ([id, a], b) => squad.chatAllowRetry(id, a, { context: b.context || 'space', msgId: String(b.msgId || ''), rules: Array.isArray(b.rules) ? b.rules : null }), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/chat\/desk$/, ([id, a], b) => squad.chatOnDesk(id, a, { context: b.context || 'space', msgId: String(b.msgId || '') }), { pin: true }],
  // a background service of an agent (1.0.2): stop it
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/services\/([\w-]+)\/stop$/, ([id, a, sid]) => squad.stopService(id, a, sid), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/task$/, ([id, a], b) => squad.sendTask(id, a, b.text, b.attachments), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/work-done$/, ([id, a]) => { squad.clearWork(id, a); squad.invalidate(); return { ok: true }; }, { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/attachments$/, async ([id], b, req) => {
    const buf = await readRaw(req, 20 * 2 ** 20);
    return { ok: true, ...squad.saveAttachment(id, decodeURIComponent(String(req.headers['x-filename'] || '')), buf) };
  }, { pin: true, raw: true, maxBody: 20 * 2 ** 20 }],

  ['POST', /^\/api\/independents\/rescan$/, () => squad.rescanIndependents(), { pin: true }],
  ['POST', /^\/api\/independents\/([\w-]+)\/adopt$/, ([id], b) => squad.adoptIndependent(id, b), { pin: true }],
  ['POST', /^\/api\/attention\/(\w+)\/answer$/, ([id], b) => squad.answerAttention(id, b.option, b.text, { force: !!b.force, floorId: String(b.floorId || ''), agentId: String(b.agentId || ''), kind: String(b.kind || ''), answers: Array.isArray(b.answers) ? b.answers.slice(0, 8) : null }), { pin: true }],
];

// 127.0.0.0/8, ::1 and localhost; 0.0.0.0, :: and real addresses are not
export const isLoopback = (host) => /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\])$/i.test(String(host || '').trim());

// ---------- online access (1.9) ----------
// building.json prefs: public, trustProxy, publicUrl (or the Notifications one), cfAccess, secondFactor; read at most every 2 s
let onlineCache = { at: 0, v: null };
export function onlineSettings(now = Date.now()) {
  if (onlineCache.v && now - onlineCache.at < 2000) return onlineCache.v;
  const p = building.loadBuilding().prefs;
  onlineCache = { at: now, v: { public: p.public === true, trustProxy: p.trustProxy, publicUrl: String(p.publicUrl || p.notify?.publicUrl || ''), cfAccess: p.cfAccess || null, secondFactor: p.secondFactor } };
  return onlineCache.v;
}
export const forgetOnline = () => { onlineCache = { at: 0, v: null }; };
// sign-in events go to the Building's own Squad Log: the client address and the role, never the PIN
function logAuth(type, data) { try { squadLog.append(squadLog.BUILDING, { type, data }, { pii: false }); } catch (e) { console.error('[auth]', e.message); } }
// what a public-mode browser may load before signing in: the sign-in page and what it needs
const OPEN_STATIC = /^\/(login\.html|login\.js|i18n\.js|i18n\/(en|id)\.json|tokens\.css|style\.css|vendor\/fonts\/[\w.-]+\.woff2)$/;
const LOCKED = 'PIN sign-in is locked after too many wrong PINs. The Owner unlocks it with "aisquad unlock" on the machine or /unlock on Telegram.';
const personOf = (id) => users.listUsers().find((u) => u.id === id) || null;

// host: the address the server is bound to. Off loopback every /api read needs a signed-in person as well.
// isPublic: --public. toOwner(text): security messages to the Owner (Telegram); fetchFn: the Cloudflare Access keys.
export function createHandler({ pin, host = '127.0.0.1', isPublic: flag = false, toOwner = (text) => notify.toOwner(text), fetchFn } = {}) {
  const lockReads = !isLoopback(host);
  const pub = proxy.publicMode({ flag, setting: () => onlineSettings().public });
  let cf = { key: '', v: null };
  const accessCheck = (o) => {
    const c = cfaccess.cleanCfAccess(o.cfAccess);
    if (!c) return null;
    if (cf.key !== JSON.stringify(c)) cf = { key: JSON.stringify(c), v: cfaccess.verifier(c, { fetchFn }) };
    return cf.v;
  };
  // what the doctor reports about online access (1.9): how requests came through the proxy
  const seen = { proxied: 0, https: 0, plain: 0 };
  const onlineState = () => { const o = onlineSettings(); return { host, public: pub.on(), reason: pub.reason(), ...seen, ownerPaired: notify.ownerPaired(), cfAccess: cfaccess.cleanCfAccess(o.cfAccess)?.teamDomain || '' }; };
  const secondOn = (c) => second.enabled({ setting: c.o.secondFactor, paired: notify.ownerPaired() });
  const secondState = (c) => (c.user?.role === 'owner' && c.isPublic && c.session && secondOn(c) ? (c.session.secondAt ? 'done' : 'needed') : 'off');

  // a wrong PIN or code: counted against the address (not for tools on this machine), logged, the Owner told of a lockout
  function failed(c, what = 'PIN') {
    logAuth('auth.failed', { ip: c.ip, what, ...(c.email ? { email: c.email } : {}) });
    if (c.local) return { reason: 'wrong' };
    const r = limits.fail(c.ip);
    if (r.locked) {
      const fails = r.locked === 'account' ? limits.status().failsToday : limits.PER_ADDRESS;
      logAuth('auth.locked', r.locked === 'account' ? { scope: 'account', ip: c.ip, fails } : { scope: 'address', ip: c.ip, fails, waitS: Math.round(r.wait / 1000) });
      const text = r.locked === 'account' ? notify.say('lockAccount', { fails }) : notify.say('lockAddress', { fails, ip: c.ip, minutes: Math.round(r.wait / 60e3) });
      Promise.resolve().then(() => toOwner(text)).catch(() => {});
    }
    return { reason: r.locked === 'account' ? 'locked' : r.locked ? 'wait' : 'wrong', retryAfter: r.wait ? Math.ceil(r.wait / 1000) : 0 };
  }
  function refuse(res, l, wrong = 'Wrong PIN') {
    if (l.reason === 'wrong') return send(res, 401, { error: wrong });
    if (l.retryAfter) res.setHeader('retry-after', String(l.retryAfter));
    return send(res, 429, { error: l.reason === 'locked' ? LOCKED : `Too many wrong PINs: try again in ${Math.max(1, Math.ceil(l.retryAfter / 60))} minutes`, locked: l.reason === 'locked', retryAfter: l.retryAfter || 0 });
  }

  // who is asking: a session cookie, or the PIN header (only from this machine in public mode) -> a refusal or null
  function whoIs(req, c) {
    c.sid = sessions.idFrom(req);
    const s = c.sid ? sessions.lookup(c.sid) : null;
    if (s) { const u = personOf(s.userId); if (u) { c.user = u; c.session = s; return null; } sessions.revoke(c.sid); }
    const p = req.headers['x-aisquad-pin'];
    if (!p || (c.isPublic && !c.local)) return null;
    if (!c.local) { const l = limits.check(c.ip); if (!l.ok) return l; }
    c.user = users.identify(p, pin);
    if (!c.user) return failed(c);
    if (!c.local) limits.succeed(c.ip);
    return null;
  }

  // sign in, the second factor, sign out: reachable before anyone is signed in
  async function sessionRoute(req, res, c, key) {
    if (key === 'GET /api/session') return send(res, 200, { signedIn: !!c.user, user: c.user, public: c.isPublic, secondFactor: secondState(c) });
    if (key === 'POST /api/session') {
      if (!c.local) { const l = limits.check(c.ip); if (!l.ok) return refuse(res, l); }
      const b = await readBody(req);
      const user = users.identify(String(b.pin ?? '').trim(), pin);
      if (!user) return refuse(res, failed(c));
      if (!c.local) limits.succeed(c.ip);
      if (c.sid) sessions.revoke(c.sid);
      const id = sessions.create(user, { ip: c.ip, email: c.email });
      res.setHeader('set-cookie', sessions.cookie(id, { secure: c.secure }));
      Object.assign(c, { user, session: sessions.lookup(id) });
      let sf = secondState(c);
      if (sf === 'needed') { try { await second.send(c.session.key, { sendFn: toOwner, lang: notify.settings().lang }); sf = 'sent'; } catch { sf = 'unavailable'; } }
      logAuth('auth.signed_in', { ip: c.ip, role: user.role, user: user.name, ...(c.email ? { email: c.email } : {}) });
      return send(res, 200, { ok: true, user, secondFactor: sf });
    }
    if (key === 'DELETE /api/session') {
      if (c.session) { sessions.revoke(c.sid); logAuth('auth.signed_out', { ip: c.ip, role: c.user.role, user: c.user.name }); }
      res.setHeader('set-cookie', sessions.clearCookie({ secure: c.secure }));
      return send(res, 200, { ok: true });
    }
    if (key === 'POST /api/session/code' || key === 'POST /api/session/verify') {
      if (!c.session) return send(res, 401, { error: 'PIN required' });
      if (secondState(c) === 'off') return send(res, 400, { error: 'No second factor is needed' });
      if (key.endsWith('/code')) {
        try { await second.send(c.session.key, { sendFn: toOwner, lang: notify.settings().lang }); } catch (e) { return send(res, e.status || 503, { error: e.message }); }
        return send(res, 200, { ok: true });
      }
      if (!c.local) { const l = limits.check(c.ip); if (!l.ok) return refuse(res, l); }
      const b = await readBody(req);
      if (!second.verify(c.session.key, b.code)) return refuse(res, failed(c, 'code'), 'Wrong or expired code');
      sessions.markSecond(c.session.key);
      logAuth('auth.signed_in', { ip: c.ip, role: c.user.role, user: c.user.name, secondFactor: true, ...(c.email ? { email: c.email } : {}) });
      return send(res, 200, { ok: true });
    }
    return undefined;
  }

  // what every request needs first: public mode, the client, headers, size, origin, Cloudflare Access, who
  async function prepare(req, res, url, limit) {
    const isPublic = pub.observe(req), o = onlineSettings();
    const hops = proxy.hopsOf(o.trustProxy, isPublic);
    const c = { isPublic, o, hops, ip: proxy.clientAddress(req, hops), https: proxy.isHttps(req, hops), local: proxy.isLocalTool(req), email: '', user: null, session: null, sid: '' };
    // Secure over HTTPS and through a proxy in public mode; a browser on the LAN over plain HTTP still signs in
    c.secure = c.https || (isPublic && proxy.hasProxyHeaders(req) && proxy.trusted(req, hops));
    if (proxy.hasProxyHeaders(req) && proxy.trusted(req, hops)) { seen.proxied++; seen[c.https ? 'https' : 'plain']++; }
    for (const [k, v] of Object.entries(harden.securityHeaders({ isPublic, https: c.https }))) res.setHeader(k, v);
    if (harden.tooLarge(req, limit)) return void send(res, 413, { error: 'Request too large' });
    if (harden.CHANGES.has(req.method) && !harden.originAllowed(req, { host: proxy.requestHost(req, hops), publicUrl: o.publicUrl })) return void send(res, 403, { error: 'Refused: this request came from another site' });
    // Cloudflare Access: whatever came through the tunnel carries the team's token
    const cfv = accessCheck(o);
    if (cfv && proxy.hasProxyHeaders(req)) {
      try { c.email = (await cfv.verify(req.headers[cfaccess.HEADER])).email; } catch { return void send(res, 403, { error: 'Cloudflare Access sign-in required' }); }
    }
    const l = whoIs(req, c);
    if (l) return void refuse(res, l, 'PIN required');
    return c;
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      let hit = null;
      for (const r of routes) { if (r[0] !== req.method) continue; const m = url.pathname.match(r[1]); if (m) { hit = { r, m }; break; } }
      const c = await prepare(req, res, url, hit?.r[3]?.maxBody || harden.BODY_LIMIT);
      if (!c) return;
      req.client = c; req.online = onlineState;
      if (/^\/api\/session(\/(code|verify))?$/.test(url.pathname)) { const done = await sessionRoute(req, res, c, `${req.method} ${url.pathname}`); if (done !== undefined) return; }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        if (c.isPublic && !c.user && !OPEN_STATIC.test(url.pathname)) {
          if (['/', '/index.html', '/admin', '/admin.html'].includes(url.pathname) && serveStatic(res, '/login.html')) return;
          return send(res, 401, 'Sign in first', 'text/plain');
        }
        if (serveStatic(res, url.pathname)) return;
        return send(res, 404, 'Not found', 'text/plain');
      }
      if (!hit) return send(res, 404, { error: 'Not found' });
      const [method, , handler, opts = {}] = hit.r, m = hit.m;
      // an outside system posting a target's value (1.3): the Space's token in the URL, nothing else
      if (opts.hook) return send(res, 200, await handler(m.slice(1), await readBody(req), req));
      // a tool inside an agent's session (1.8): the Space's agent token, only for that Space
      if (opts.space) {
        const id = agentToken.floorOfToken(req.headers[agentToken.HEADER]);
        req.space = id && integ.spaces().find((s) => s.id === id);
        if (!req.space) return send(res, 401, { error: 'Unknown Space token: start the agent from its Space' });
        return send(res, 200, await handler(m.slice(1), await readBody(req), req));
      }
      // a worker machine (0.18): its own token, only for its own routes
      if (opts.node) {
        const node = nodes.authNode(req.headers['x-aisquad-node']);
        if (!node) return send(res, 401, { error: 'Unknown machine or token' });
        req.node = node;
        return send(res, 200, await handler(m.slice(1), method === 'GET' ? {} : await readBody(req), req));
      }
      // who is asking (0.14): a session or a PIN; reads on loopback stay open without one, never in public mode
      const user = c.user;
      if ((opts.pin || lockReads || c.isPublic) && !user) return send(res, 401, { error: 'PIN required' });
      const need = access.requiredRole(method, url.pathname);
      if (user && !access.allows(user, need)) return send(res, 403, { error: `Only ${need === 'owner' ? 'the Owner' : 'a member or the Owner'} can do this` });
      if (!user && need === 'owner' && method !== 'GET') return send(res, 401, { error: 'PIN required' });
      // the Owner's second factor (1.9): owner-level routes and Owner-only Spaces, in public mode, once per session
      const space = url.pathname.match(/^\/api\/floors\/([\w-]+)(\/|$)/);
      const sf = secondState(c);
      if (second.needed({ isPublic: c.isPublic, on: sf !== 'off', user, need, ownerSpace: !!space && access.ownerFloors().has(space[1]), session: c.session })) return send(res, 401, { error: 'Second factor required', secondFactor: true });
      const viewer = sf === 'needed' ? { ...user, role: 'member' } : user;     // until then lists show what a member sees
      if (access.hiddenPath(url.pathname, viewer)) return send(res, 404, { error: 'Floor not found' });
      Object.assign(req, { user: user || null, actor: user?.name || 'owner', ownerPin: pin });
      const body = opts.raw || method === 'GET' || method === 'DELETE' ? {} : await readBody(req, opts.maxBody);
      if (body && typeof body === 'object' && body.floorId && access.hiddenPath(`/api/floors/${body.floorId}`, viewer)) return send(res, 404, { error: 'Floor not found' });
      // configuration is code: changes to the Building or a Space are recorded with their before and after (server/history.js)
      // a submission sent twice (double click, two tabs) runs once: x-idempotency-key (server/idempotency.js)
      const run = (fn) => (method === 'GET' ? fn() : idem.once(user?.id || 'owner', req.headers['x-idempotency-key'], fn));
      let out = await run(() => access.actorStore.run({ user }, async () => {
        if (!opts.history) return handler(m.slice(1), body, req);
        const h = opts.history(m.slice(1), body);
        let root = ''; if (h.floorId) { try { root = building.floorEntry(h.floorId).path; } catch { /* not registered (yet) */ } }
        return history.track(h.label, { root, floorId: h.floorId || '', actor: req.actor }, () => handler(m.slice(1), body, req));
      }));
      if (method !== 'GET' && /^\/api\/(floors|squads|guide)/.test(url.pathname)) access.forgetOwnerFloors();   // a new or changed Space may be the Owner's
      if (method !== 'GET' && url.pathname === '/api/building') forgetOnline();
      out = access.redact(url.pathname, out, viewer);
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
      return method === 'GET' && !opts.pin && !lockReads && !c.isPublic ? sendJsonGet(req, res, out) : send(res, 200, out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (res.headersSent) return void res.end();
      send(res, status, { error: e.message || 'Server error', ...(status !== 500 && e.data ? e.data : {}) });
    }
  };

  // a WebSocket upgrade (none is served yet): the same origin check, Access and sign-in as any request, then 404,
  // so a stream added later cannot skip the gate
  handler.upgrade = async (req, socket) => {
    const reply = (code, text) => { try { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* gone */ } socket.destroy(); };
    try {
      const isPublic = pub.observe(req), o = onlineSettings(), hops = proxy.hopsOf(o.trustProxy, isPublic);
      if (!harden.originAllowed(req, { host: proxy.requestHost(req, hops), publicUrl: o.publicUrl })) return reply(403, 'Forbidden');
      const c = { isPublic, o, hops, ip: proxy.clientAddress(req, hops), local: proxy.isLocalTool(req), email: '', user: null, session: null, sid: '' };
      const cfv = accessCheck(o);
      if (cfv && proxy.hasProxyHeaders(req)) { try { await cfv.verify(req.headers[cfaccess.HEADER]); } catch { return reply(403, 'Forbidden'); } }
      if (whoIs(req, c) || !c.user) return reply(401, 'Unauthorized');
      return reply(404, 'Not Found');
    } catch { return reply(500, 'Internal Server Error'); }
  };
  handler.publicMode = pub;
  return handler;
}
