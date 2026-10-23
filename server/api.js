// JSON API + static UI. GET requests are open on the bound interface (127.0.0.1 by default);
// every mutating request and agent screens need the local PIN (header x-aisquad-pin).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { HttpError, notFound, lineDiff } from './util.js';
import * as building from './building.js';
import * as floors from './floors.js';
import * as roles from './roles.js';
import * as squad from './squad.js';
import { checkPin } from './pin.js';

const UI = path.join(ROOT, 'ui');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

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
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  return true;
}

const floorRoot = (id) => building.floorEntry(id).path;

// [method, pattern, handler(params, body, req), { pin, raw }]
const routes = [
  ['GET', /^\/api\/building$/, () => squad.buildingSnapshot()],
  ['PATCH', /^\/api\/building$/, (p, b) => { building.setBuildingName(b.name); squad.invalidate(); return { ok: true }; }, { pin: true }],
  ['POST', /^\/api\/auth$/, () => ({ ok: true }), { pin: true }],

  ['GET', /^\/api\/roles$/, () => ({ templates: roles.listTemplates(), models: roles.MODELS, efforts: roles.EFFORTS, styles: roles.STYLES })],
  ['GET', /^\/api\/roles\/([\w-]+)$/, ([role]) => ({ template: roles.getTemplate(role), versions: roles.templateVersions(role) })],
  ['GET', /^\/api\/roles\/([\w-]+)\/versions\/(\d+)$/, ([role, v]) => { const t = roles.templateText(role, +v); if (!t) throw notFound('Unknown version'); return { text: t }; }],
  ['GET', /^\/api\/roles\/([\w-]+)\/diff$/, ([role], b, req) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const from = roles.templateText(role, +q.get('from')), to = roles.templateText(role, +q.get('to'));
    if (!from || !to) throw notFound('Unknown version');
    return { role, from: +q.get('from'), to: +q.get('to'), diff: lineDiff(from, to) };
  }],
  ['POST', /^\/api\/roles$/, (p, b) => roles.saveTemplate(b, { create: true }), { pin: true }],
  ['PUT', /^\/api\/roles\/([\w-]+)$/, ([role], b) => { const r = roles.saveTemplate({ ...b, role }); squad.invalidate(); return r; }, { pin: true }],

  ['POST', /^\/api\/floors$/, async (p, b) => { const r = await floors.createFloor(b); squad.invalidate(); return { ok: true, id: r.entry.id, number: r.entry.number }; }, { pin: true }],
  ['POST', /^\/api\/floors\/adopt$/, (p, b) => { const e = floors.adoptFloor(String(b.path || ''), { number: b.number }); squad.invalidate(); return { ok: true, id: e.id }; }, { pin: true }],
  ['GET', /^\/api\/floors\/([\w-]+)$/, ([id]) => squad.floorDetail(id)],
  ['PATCH', /^\/api\/floors\/([\w-]+)$/, ([id], b) => {
    if (b.number !== undefined) building.setFloorNumber(id, b.number);
    floors.updateFloorConfig(floorRoot(id), b);
    squad.invalidate();
    return { ok: true };
  }, { pin: true }],
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
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/start$/, ([id, a], b) => squad.startAgent(id, a, b.task ? squad.withAttachments(b.task, b.attachments) : ''), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/stop$/, ([id, a]) => squad.stopAgent(id, a), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/task$/, ([id, a], b) => squad.sendTask(id, a, b.text, b.attachments), { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/agents\/([\w-]+)\/work-done$/, ([id, a]) => { squad.clearWork(id, a); squad.invalidate(); return { ok: true }; }, { pin: true }],
  ['POST', /^\/api\/floors\/([\w-]+)\/attachments$/, async ([id], b, req) => {
    const buf = await readRaw(req, 20 * 2 ** 20);
    return { ok: true, ...squad.saveAttachment(id, decodeURIComponent(String(req.headers['x-filename'] || '')), buf) };
  }, { pin: true, raw: true }],

  ['POST', /^\/api\/attention\/(\w+)\/answer$/, ([id], b) => squad.answerAttention(id, b.option, b.text), { pin: true }],
];

export function createHandler({ pin }) {
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
        if (opts.pin && !checkPin(pin, req.headers['x-aisquad-pin'])) return send(res, 401, { error: 'PIN required' });
        const body = opts.raw || method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
        return send(res, 200, await handler(m.slice(1), body, req));
      }
      send(res, 404, { error: 'Not found' });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e.message || 'Server error' });
    }
  };
}
