// JSON API + static UI. On a loopback address (the default) reads are open and every change and agent
// screen needs the local PIN (header x-aisquad-pin); on any other address every /api call needs it.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, VERSION } from './config.js';
import { HttpError, notFound, lineDiff } from './util.js';
import * as building from './building.js';
import * as floors from './floors.js';
import * as roles from './roles.js';
import * as libraries from './libraries.js';
import * as squad from './squad.js';
import { checkPin } from './pin.js';
import { setApproval } from './merge.js';
import { recentEvents as hooksRecent } from './events.js';
import { meter } from './meter.js';
import * as blueprints from './blueprints.js';
import { recommend } from './recommend.js';
import { createSquad, squadsDir } from './setup.js';

const UI = path.join(ROOT, 'ui');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
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
  if (rel.startsWith('vendor/')) {                         // vendored libraries never change: let the browser cache them
    res.writeHead(200, { 'content-type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff' });
    res.end(fs.readFileSync(file));
    return true;
  }
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
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
    if (b.squadsDir !== undefined) { if (!path.isAbsolute(String(b.squadsDir))) throw new HttpError(400, 'The squads folder must be an absolute path'); building.setPrefs({ squadsDir: path.resolve(String(b.squadsDir)) }); }
    squad.invalidate(); return { ok: true };
  }, { pin: true }],
  ['GET', /^\/api\/blueprints$/, () => ({ blueprints: blueprints.listBlueprints().map(({ dir, ...b }) => b), squadsDir: squadsDir(), nextFloorNumber: building.nextFloorNumber() })],
  ['GET', /^\/api\/catalog$/, () => ({ templates: blueprints.catalog() })],
  ['POST', /^\/api\/floors\/([\w-]+)\/skills\/install$/, ([id], b) => squad.installSkills(id, b.names || b.name), { pin: true }],
  ['POST', /^\/api\/squads\/recommend$/, (p, b) => recommend({ prompt: b.prompt, blueprint: b.blueprint, useClaude: b.useClaude !== false }), { pin: true }],
  ['POST', /^\/api\/squads$/, async (p, b) => {
    const r = await createSquad(b);
    if (b.startLead && r.lead) { try { await squad.startAgent(r.id, r.lead, b.kickoff || blueprints.getBlueprint(r.blueprint.id).kickoff); r.leadStarted = true; } catch (e) { r.leadError = e.message; } }
    squad.invalidate();
    return r;
  }, { pin: true }],
  ['POST', /^\/api\/auth$/, () => ({ ok: true }), { pin: true }],
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
  }, { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/merges$/, ([id]) => squad.floorMerges(id)],
  ['GET', /^\/api\/floors\/([\w-]+)\/performance$/, ([id]) => squad.performance(id)],
  ['GET', /^\/api\/floors\/([\w-]+)\/audits$/, ([id]) => squad.floorAudits(id), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/standup$/, ([id]) => squad.floorStandup(id), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/retro$/, ([id], b, req) => squad.floorRetro(id, new URL(req.url, 'http://x').searchParams.get('sprint')), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/retro\/send$/, ([id], b) => squad.sendRetroToLead(id, b.sprint ?? null), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/audits\/([\w-]+)$/, ([id, aid]) => squad.floorAudit(id, aid), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/audits$/, ([id], b) => { squad.startAudit(id, { sprint: b.sprint, model: b.model }).catch((e) => console.error('[audit]', e.message)); return { ok: true, started: true }; }, { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/audits\/([\w-]+)\/findings\/(F\d+)\/proposal$/, ([id, aid, fid]) => squad.findingProposal(id, aid, fid), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/audits\/([\w-]+)\/findings\/(F\d+)\/apply$/, ([id, aid, fid]) => squad.applyFinding(id, aid, fid), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/audits\/([\w-]+)\/findings\/(F\d+)\/dismiss$/, ([id, aid, fid], b) => squad.dismissFinding(id, aid, fid, b.reason), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/blueprint\/update$/, ([id]) => squad.updateFloorBlueprint(id), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/log$/, ([id], b, req) => squad.floorLog(id, Object.fromEntries(new URL(req.url, 'http://x').searchParams)), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/merges$/, ([id], b) => squad.startMerge(id, b.branch), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/merge-approval$/, ([id], b) => { building.floorEntry(id); setApproval(id, !!b.approved); squad.invalidate(); return { ok: true, approved: !!b.approved }; }, { pin: true }],
  ['DELETE', /^\/api\/floors\/([\w-]+)$/, ([id]) => { building.unregisterFloor(id); squad.invalidate(); return { ok: true }; }, { pin: true }],

  ['POST', /^\/api\/floors\/([\w-]+)\/agents$/, ([id], b) => { const a = floors.addAgent(floorRoot(id), b); squad.invalidate(); return { ok: true, agent: a }; }, { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)$/, ([id, a]) => squad.deskDetail(id, a), { pin: true }],
  ['PATCH', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)$/, ([id, a], b) => { const r = floors.updateAgent(floorRoot(id), a, b); squad.invalidate(); return { ok: true, agent: r }; }, { pin: true }],
  ['DELETE', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)$/, ([id, a]) => { squad.stopAgent(id, a); floors.removeAgent(floorRoot(id), a); squad.invalidate(); return { ok: true }; }, { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/diff$/, ([id, a]) => {
    const { team } = floors.readFloor(floorRoot(id));
    const agent = team.agents.find((x) => x.id === a); if (!agent) throw notFound('Agent not found');
    return floors.templateDiff(floorRoot(id), agent);
  }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/template$/, ([id, a], b) => { const r = floors.templateAction(floorRoot(id), a, b.action); squad.invalidate(); return { ok: true, agent: r }; }, { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/start$/, ([id, a], b) => squad.startAgent(id, a, b.task ? squad.withAttachments(b.task, b.attachments) : '', { guard: !b.force }), { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)\/docs$/, ([id]) => squad.sourceDocs(id)],
  ['GET', /^\/api\/floors\/([\w-]+)\/docs\/text$/, ([id], b, req) => squad.sourceDocText(id, new URL(req.url, 'http://x').searchParams.get('path')), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/docs\/approve$/, ([id], b) => squad.approveSourceDoc(id, b.path), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/docs\/changes$/, ([id], b) => squad.requestDocChanges(id, b.path, b.text), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/resume$/, ([id, a], b) => squad.resumeAgent(id, a, { guard: !b.force }), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/stop$/, ([id, a]) => squad.stopAgent(id, a), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/task$/, ([id, a], b) => squad.sendTask(id, a, b.text, b.attachments), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/work-done$/, ([id, a]) => { squad.clearWork(id, a); squad.invalidate(); return { ok: true }; }, { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/attachments$/, async ([id], b, req) => {
    const buf = await readRaw(req, 20 * 2 ** 20);
    return { ok: true, ...squad.saveAttachment(id, decodeURIComponent(String(req.headers['x-filename'] || '')), buf) };
  }, { pin: true, raw: true }],

  ['POST', /^\/api\/independents\/rescan$/, () => squad.rescanIndependents(), { pin: true }],
  ['POST', /^\/api\/independents\/([\w-]+)\/adopt$/, ([id], b) => squad.adoptIndependent(id, b), { pin: true }],
  ['POST', /^\/api\/attention\/(\w+)\/answer$/, ([id], b) => squad.answerAttention(id, b.option, b.text, { force: !!b.force }), { pin: true }],
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
        if ((opts.pin || lockReads) && !checkPin(pin, req.headers['x-aisquad-pin'])) return send(res, 401, { error: 'PIN required' });
        const body = opts.raw || method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
        const out = await handler(m.slice(1), body, req);
        if (out && out.__file) return send(res, 200, fs.readFileSync(out.__file), TYPES[path.extname(out.__file).toLowerCase()] || 'image/jpeg');
        return send(res, 200, out);
      }
      send(res, 404, { error: 'Not found' });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e.message || 'Server error', ...(status !== 500 && e.data ? e.data : {}) });
    }
  };
}
