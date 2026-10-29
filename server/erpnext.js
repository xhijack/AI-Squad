// SPDX-License-Identifier: Apache-2.0
// ERPNext and the Sales pilot (0.19). The AI Squad talks to one ERPNext site (Sopwer: office.sopwer.id) in two ways:
//   - Agents use it through Frappe Assistant Core (FAC), an MCP server inside ERPNext, with the API key of an ERPNext
//     user made for their role: "sales" (Lead, Opportunity, Quotation as drafts), "delivery" (Project, Task) or
//     "finance" (1.7: Accounts User, read only; only an Owner-only Space gets it, and its tools are read-only too).
//     A Space chooses which (floor.json `erpnext`). The keys are write-only here and reach a session only as
//     environment variables (never in a repository, an argument list or a browser); FAC applies that user's ERPNext
//     permissions to every call, and destructive tools are denied on top.
//   - The server itself (code, no model) watches the pipeline every few minutes: a new Lead becomes a handoff to the
//     Sales Space; a draft Quotation that an agent hands to the Owner becomes a price approval (a hard stop: money)
//     that only the Owner can approve; the server then submits it with the "owner" key, which no agent ever gets;
//     a Quotation that turned into an order becomes a project handoff to the delivery Space (items, no prices).
// Settings: building.json prefs.erpnext; keys: ~/.aisquad/secrets.json (erpnext.<role>); the watcher's state:
// ~/.aisquad/erpnext.json.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as building from './building.js';
import * as auth from './auth.js';
import * as hb from './handoff.js';
import { readJson, writeJson, writeText, bad, notFound, HttpError, oneLine, clip } from './util.js';

export const ROLES = ['sales', 'delivery', 'finance', 'owner'];
export const AGENT_ROLES = ['sales', 'delivery', 'finance'];
export const MCP_PATH = '/api/method/frappe_assistant_core.api.fac_endpoint.handle_mcp';
export const SERVER = 'erpnext';                     // the MCP server's name in sessions: tools are mcp__erpnext__*
// FAC tools an agent may use without asking; the denied ones never (deleting, submitting or cancelling documents,
// workflows, e-mail to customers, code and SQL on the server)
export const ALLOW = ['list_documents', 'get_document', 'search_documents', 'search', 'fetch', 'get_doctype_info', 'create_document', 'update_document',
  'generate_report', 'report_list', 'report_requirements', 'get_pending_approvals', 'get_crm_activity', 'add_crm_activity'].map((t) => `mcp__${SERVER}__${t}`);
export const DENY = ['delete_document', 'document_action', 'run_workflow', 'send_email', 'send_crm_email', 'reply_to_helpdesk_ticket', 'run_python_code', 'run_database_query'].map((t) => `mcp__${SERVER}__${t}`);
// the finance key reads only: nothing is created or changed, even where the ERPNext user could (1.7)
const WRITES = ['create_document', 'update_document', 'add_crm_activity'].map((t) => `mcp__${SERVER}__${t}`);
export const toolsFor = (role) => (role === 'finance' ? { allow: ALLOW.filter((t) => !WRITES.includes(t)), deny: [...DENY, ...WRITES] } : { allow: ALLOW, deny: DENY });
export const DEFAULTS = { enabled: false, url: '', pollMin: 5, sales: { floorId: '', agentId: '' }, delivery: { floorId: '', agentId: '' } };

const target = (t = {}) => ({ floorId: String(t?.floorId || '').replace(/[^\w-]/g, '').slice(0, 60), agentId: String(t?.agentId || '').replace(/[^\w-]/g, '').slice(0, 60) });
export function cleanSettings(s = {}) {
  let url = String(s?.url || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(url)) throw bad('ERPNext address: the site only, e.g. https://office.sopwer.id');
  return { enabled: s?.enabled === true && !!url, url, pollMin: Math.max(1, Math.min(60, parseInt(s?.pollMin, 10) || DEFAULTS.pollMin)), sales: target(s?.sales), delivery: target(s?.delivery) };
}
export const settings = () => { try { return cleanSettings({ ...DEFAULTS, ...building.loadBuilding().prefs.erpnext }); } catch { return { ...DEFAULTS }; } };

// ---------- keys (write-only) ----------
const keys = () => auth.readSecret('erpnext') || {};
export const credential = (role) => (keys()[role]?.key ? keys()[role] : null);
export function keyStatus() {
  return Object.fromEntries(ROLES.map((r) => { const c = credential(r); return [r, c ? { set: true, last4: String(c.key).slice(-4), user: c.user || '', setAt: c.setAt || null } : { set: false, last4: '', user: '', setAt: null }]; }));
}
// a role's key and secret (an ERPNext user's API key); checked against the site when one is set
export async function setKey(role, key, secret, { check = true } = {}) {
  if (!ROLES.includes(role)) throw bad(`Role: ${ROLES.join(', ')}`);
  const k = String(key || '').trim(), s = String(secret || '').trim();
  if (!/^[\w-]{6,64}$/.test(k) || !/^[\w-]{6,64}$/.test(s)) throw bad('Paste the API key and the API secret of the ERPNext user');
  let user = '';
  if (check && settings().url) user = await ping({ key: k, secret: s });
  auth.writeSecret('erpnext', { ...keys(), [role]: { key: k, secret: s, user, setAt: Date.now() } });
  return keyStatus();
}
export function clearKey(role) {
  const all = { ...keys() }; delete all[role];
  auth.writeSecret('erpnext', Object.keys(all).length ? all : null);
  return keyStatus();
}

// ---------- the REST client ----------
let fetchImpl = (...a) => fetch(...a);
export const setFetch = (fn) => { fetchImpl = fn || ((...a) => fetch(...a)); };
// a call as a role (or with an explicit credential) -> data or message
export async function request(who, method, p, body, { url = settings().url, timeoutMs = 20000 } = {}) {
  const c = typeof who === 'string' ? credential(who) : who;
  if (!url) throw bad('ERPNext is not set up (Admin → ERPNext)');
  if (!c) throw bad(`No ERPNext key for the ${who} role`);
  let r;
  try {
    r = await fetchImpl(url + p, { method, headers: { Authorization: `token ${c.key}:${c.secret}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) { throw new HttpError(502, `ERPNext did not answer: ${e.message}`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    let msg = (typeof j.message === 'string' && j.message) || j.exception || j.exc_type || `HTTP ${r.status}`;
    try { if (j._server_messages) msg = JSON.parse(JSON.parse(j._server_messages)[0]).message || msg; } catch { /* keep */ }
    throw new HttpError(r.status === 401 || r.status === 403 ? 403 : 502, `ERPNext: ${oneLine(String(msg).replace(/<[^>]+>/g, ''), 200)}`);
  }
  return j.data !== undefined ? j.data : j.message;
}
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`).join('&');
export const list = (who, doctype, { fields = ['name'], filters = [], orderBy = 'creation asc', limit = 20, start = 0 } = {}) =>
  request(who, 'GET', `/api/resource/${encodeURIComponent(doctype)}?${q({ fields, filters, order_by: orderBy, limit_page_length: limit, ...(start ? { limit_start: start } : {}) })}`);
export const getDoc = (who, doctype, name) => request(who, 'GET', `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
// submit the document as it was read: ERPNext refuses it when it changed since (its own "modified" check)
export async function submitDoc(who, doctype, name, doc = null) {
  return request(who, 'POST', '/api/method/frappe.client.submit', { doc: doc || await getDoc(who, doctype, name) });
}
export const ping = (who) => request(who, 'GET', '/api/method/frappe.auth.get_logged_user');
// every role's key against the site
export async function testAll() {
  const out = {};
  for (const r of ROLES) { if (!credential(r)) { out[r] = { ok: false, error: 'no key' }; continue; } try { out[r] = { ok: true, user: await ping(r) }; } catch (e) { out[r] = { ok: false, error: e.message }; } }
  return out;
}

// which key reads for a Space on the server's behalf (targets, 1.3; integrations, 1.6): the Owner's key reads
// everything (payroll, invoices), and what it reads is seen by the whole team, so a team Space uses its own role's key
// (or the sales, then delivery key); only an Owner-only Space uses the Owner's key. space: { access, erpnext }
// The finance key (1.7) is read-only and reads for its Owner-only Space first; a team Space never uses it.
export function measureRole(space = {}) {
  if (space?.access === 'owner' && space?.erpnext === 'finance' && credential('finance')) return 'finance';
  if (space?.access === 'owner' && credential('owner')) return 'owner';
  for (const r of [space?.erpnext, 'sales', 'delivery']) if (['sales', 'delivery'].includes(r) && credential(r)) return r;
  throw bad(space?.access === 'owner' ? 'No ERPNext key: set one in Admin → ERPNext' : 'A team Space measures ERPNext targets with the sales or delivery key, not the Owner\'s: set one in Admin → ERPNext');
}

// ---------- agent sessions ----------
// the MCP configuration every session shares: no secrets in it, Claude Code expands the variables at start
export function mcpFile() {
  const f = path.join(config.home, 'erpnext', 'mcp.json');
  const want = JSON.stringify({ mcpServers: { [SERVER]: { type: 'http', url: '${AISQUAD_ERP_URL}' + MCP_PATH, headers: { Authorization: 'token ${AISQUAD_ERP_KEY}:${AISQUAD_ERP_SECRET}' } } } }, null, 2) + '\n';
  if ((() => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } })() !== want) writeText(f, want, 0o600);
  return f;
}
// what a session of a Space gets: arguments, allowed and denied tools, and the (secret) environment; null when off
export function sessionFor(floor = {}) {
  const role = floor?.erpnext;
  if (!AGENT_ROLES.includes(role) || (role === 'finance' && floor?.access !== 'owner')) return null;
  const s = settings(), c = credential(role);
  if (!s.url || !c) return null;
  return { role, args: ['--mcp-config', mcpFile()], ...toolsFor(role), env: { AISQUAD_ERP_URL: s.url, AISQUAD_ERP_KEY: c.key, AISQUAD_ERP_SECRET: c.secret } };
}
// a line for the agent file (server/context.js)
export function contextLine(role) {
  if (!AGENT_ROLES.includes(role)) return '';
  if (role === 'finance') return 'ERPNext holds the books: the `erpnext` tools (Frappe Assistant Core) read with the permissions of the read-only Finance user (Accounts User, read). You read only: nothing is created, changed, submitted, cancelled, paid or e-mailed from here. Amounts, customers and salaries stay in this Space.';
  return role === 'sales'
    ? 'ERPNext is your CRM: the `erpnext` tools (Frappe Assistant Core) work with the permissions of the Sales user. Leads, Opportunities and Quotations are created and kept there; contact data stays there. A Quotation stays a draft: you never submit it (not with update_document either). When a draft is ready, hand it to the Owner for the price approval (a package with `to: owner`, `kind: quotation`, `erpnext: Quotation/<name>` and how you priced it, without amounts: the Owner reads them from ERPNext).'
    : 'ERPNext holds the projects: the `erpnext` tools (Frappe Assistant Core) work with the permissions of the Delivery user. Create the Project and its Tasks there for won work; prices are not for this Space.';
}

// ---------- the watcher ----------
const stateFile = () => path.join(config.home, 'erpnext.json');
const EMPTY = { leadCursor: '', wonCursor: '', submitCursor: '', leads: {}, won: {}, approvals: {}, pipeline: {}, alerts: [], lastSync: 0, lastError: '', started: false };
export const loadState = () => ({ ...EMPTY, ...(readJson(stateFile(), {}) || {}) });
const saveState = (s) => writeJson(stateFile(), s);
// every change of the state: read, change, write, with nothing awaited in between (calls to ERPNext happen outside)
function mutate(fn) { const st = loadState(); const r = fn(st); saveState(st); return r; }
const reader = () => (credential('owner') ? 'owner' : 'sales');          // reads for the Owner's cards use the owner key when there is one

export const deps = { spaces: () => hb.deps.spaces(), log: (...a) => hb.deps.log(...a), invalidate: () => {} };

// the first sync only remembers where the pipeline is: no flood of old leads and orders
async function start(now) {
  const [l] = await list('sales', 'Lead', { fields: ['name', 'creation'], orderBy: 'creation desc', limit: 1 });
  const [w] = await list(reader(), 'Quotation', { fields: ['name', 'modified'], filters: [['status', '=', 'Ordered']], orderBy: 'modified desc', limit: 1 });
  const [s] = await list(reader(), 'Quotation', { fields: ['name', 'modified'], filters: [['docstatus', '=', 1]], orderBy: 'modified desc', limit: 1 });
  mutate((st) => Object.assign(st, { leadCursor: l?.creation || '1970-01-01 00:00:00', wonCursor: w?.modified || '1970-01-01 00:00:00', submitCursor: s?.modified || '1970-01-01 00:00:00', started: true, lastSync: now, lastError: '' }));
}

// one run at a time (the tick and "Check now" share it); a cursor moves only past what was handed over
let running = null;
export function sync(now = Date.now()) { return (running ||= runSync(now).finally(() => { running = null; })); }
const later = (a, b) => (String(a) > String(b) ? a : b);
async function runSync(now) {
  const s = settings();
  if (!s.enabled) return { ok: false, skipped: 'off' };
  const out = { leads: [], won: [], alerts: [] };
  let error = '';
  try {
    if (!loadState().started) { await start(now); return { ok: true, started: true }; }
    // 1. new Leads -> the Sales Space
    const sales = spaceOf(s.sales);
    if (sales) {
      const leads = await list('sales', 'Lead', { fields: ['name', 'creation', 'source', 'status', 'territory', 'industry', 'company_name'], filters: [['creation', '>', loadState().leadCursor]], orderBy: 'creation asc', limit: 20 });
      for (const l of leads) {
        if (loadState().leads[l.name]) { mutate((st) => { st.leadCursor = later(l.creation, st.leadCursor); }); continue; }
        const body = [`A new Lead arrived in ERPNext: ${l.name}${l.company_name ? ` (${l.company_name})` : ''}${l.source ? `, source: ${l.source}` : ''}${l.territory ? `, territory: ${l.territory}` : ''}${l.industry ? `, industry: ${l.industry}` : ''}.`, '',
          '1. Read the Lead with the erpnext tools and qualify it against docs/ICP.md (contact data stays in ERPNext).',
          '2. If it fits: create an Opportunity from it, then a draft Quotation following docs/OFFER.md and the price list. Never submit the Quotation.',
          '3. Hand the draft to the Owner for the price approval: a package with `to: owner`, `kind: quotation`, `erpnext: Quotation/<name>` and a short note: what the customer needs, which price list and discount rule you used and why (no amounts: the Owner reads them from ERPNext).',
          '4. If it does not fit: set the Lead\'s status in ERPNext and write the done reply with the reason.'].join('\n');
        const r = await hb.send({ id: hb.SYSTEM, name: 'ERPNext' }, '', { to: sales.id, agent: s.sales.agentId, kind: 'lead', title: `New lead ${l.name}`, erpnext: `Lead/${l.name}`, replyTo: '' }, body, { now });
        mutate((st) => { st.leads[l.name] = { handoff: r.id, at: l.creation }; st.leadCursor = later(l.creation, st.leadCursor); });
        out.leads.push(l.name);
        deps.log(sales.id, { type: 'erpnext.lead', data: { lead: l.name, handoff: r.id } });
      }
    }
    // 2. Quotations that became orders -> the delivery Space (items, no prices)
    const delivery = spaceOf(s.delivery);
    if (delivery) {
      const won = await list(reader(), 'Quotation', { fields: ['name', 'modified', 'customer_name', 'party_name'], filters: [['status', '=', 'Ordered'], ['modified', '>', loadState().wonCursor]], orderBy: 'modified asc', limit: 20 });
      for (const w of won) {
        if (loadState().won[w.name]) { mutate((st) => { st.wonCursor = later(w.modified, st.wonCursor); }); continue; }
        const doc = await getDoc(reader(), 'Quotation', w.name);
        const items = (doc.items || []).map((i) => `- ${i.item_name || i.item_code}${i.qty ? ` × ${+i.qty}${i.uom ? ` ${i.uom}` : ''}` : ''}${i.description && i.description !== i.item_name ? `: ${oneLine(String(i.description).replace(/<[^>]+>/g, ' '), 200)}` : ''}`);
        const body = [`${w.customer_name || w.party_name} ordered: Quotation ${w.name}${doc.order_type ? ` (${doc.order_type})` : ''}. The scope, without prices:`, '', ...items, '',
          'Create the Project (and its first Tasks) in ERPNext with the erpnext tools, linked to the customer and this Quotation, plan the work in this Space, and write the done reply with the Project id.'].join('\n');
        const r = await hb.send({ id: hb.SYSTEM, name: 'ERPNext' }, '', { to: delivery.id, agent: s.delivery.agentId, kind: 'project', title: `Won: ${w.customer_name || w.party_name}`, erpnext: `Quotation/${w.name}`, replyTo: '' }, body, { now });
        mutate((st) => { st.won[w.name] = { handoff: r.id, at: w.modified }; st.wonCursor = later(w.modified, st.wonCursor); record(st, w.name, { wonAt: w.modified, projectHandoff: r.id }); });
        out.won.push(w.name);
        deps.log(delivery.id, { type: 'erpnext.won', data: { quotation: w.name, handoff: r.id } });
      }
    }
    // 3. a Quotation submitted by an agent's user, not through the Owner's approval: an alert
    const agentUsers = new Set(AGENT_ROLES.map((r) => credential(r)?.user).filter(Boolean));
    if (agentUsers.size) {
      const subs = await list(reader(), 'Quotation', { fields: ['name', 'modified', 'modified_by'], filters: [['docstatus', '=', 1], ['modified', '>', loadState().submitCursor]], orderBy: 'modified asc', limit: 50 });
      for (const x of subs) {
        const added = mutate((st) => {
          st.submitCursor = later(x.modified, st.submitCursor);
          if (!agentUsers.has(x.modified_by) || st.pipeline[x.name]?.approvedAt || st.alerts.some((a) => a.quotation === x.name)) return false;
          st.alerts.push({ id: `erp-${x.name}`, quotation: x.name, user: x.modified_by, at: now, text: `Quotation ${x.name} was submitted by ${x.modified_by} without your price approval. Check it in ERPNext, and remove the Submit permission on Quotation from that user's role.` });
          return true;
        });
        if (!added) continue;
        out.alerts.push(x.name);
        deps.log(s.sales.floorId || hb.SYSTEM, { type: 'erpnext.alert', data: { quotation: x.name, user: x.modified_by } });
      }
    }
  } catch (e) { error = oneLine(e.message, 300); }
  mutate((st) => Object.assign(st, { lastSync: now, lastError: error }));
  if (out.leads.length || out.won.length || out.alerts.length) deps.invalidate();
  return { ok: !error, ...out, ...(error ? { error } : {}) };
}
export async function tick(now = Date.now()) {
  const s = settings();
  if (!s.enabled || running) return null;
  if (now - loadState().lastSync < s.pollMin * 60e3) return null;
  return sync(now);
}
const spaceOf = (t) => (t.floorId ? deps.spaces().find((x) => x.id === t.floorId) || null : null);
function record(st, name, patch) { st.pipeline[name] = { ...(st.pipeline[name] || {}), ...patch }; }

// ---------- the price approval ----------
// a quotation handed to the Owner: read it for the card (the Owner sees customer, total and items here)
export async function prepareApproval(h) {
  const name = String(h.erpnext || '').replace(/^Quotation\//, '');
  let info;
  try {
    const d = await getDoc(reader(), 'Quotation', name);
    info = { name, customer: d.customer_name || d.party_name || '', partyType: d.quotation_to || '', party: d.party_name || '', opportunity: d.opportunity || '', currency: d.currency || '',
      total: +d.grand_total || 0, discount: +d.discount_amount || 0, items: (d.items || []).length, docstatus: d.docstatus, modified: d.modified, creation: d.creation,
      lines: (d.items || []).slice(0, 12).map((i) => ({ item: i.item_name || i.item_code, qty: +i.qty || 0, rate: +i.rate || 0, amount: +i.amount || 0 })), validTill: d.valid_till || '' };
    if (d.docstatus !== 0) info.error = 'This Quotation is not a draft any more';
  } catch (e) { info = { name, error: e.message }; }
  mutate((st) => { st.approvals[h.id] = { ...info, readAt: Date.now() }; record(st, name, { draftHandoff: h.id, handedAt: h.createdAt, from: h.from }); });
  deps.log(h.from.floorId, { type: 'erpnext.approval', agent: h.from.agentId || null, data: { quotation: name, handoff: h.id } });
  deps.invalidate();
  return info;
}
export const approvalOf = (id) => loadState().approvals[id] || null;

const money = (n, cur) => `${cur || ''} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim();
export function approvalText(h, a = approvalOf(h.id)) {
  if (!a) return `Price approval: ${h.erpnext}. Reading the Quotation…`;
  if (a.error && !a.total) return `Price approval: ${h.erpnext}. It could not be read: ${a.error}`;
  return [`Price approval: Quotation ${a.name} for ${a.customer}: ${money(a.total, a.currency)}${a.discount ? ` (discount ${money(a.discount, a.currency)})` : ''}, ${a.items} item${a.items === 1 ? '' : 's'}${a.validTill ? `, valid until ${a.validTill}` : ''}.`,
    ...a.lines.map((l) => `- ${l.item}: ${l.qty} × ${money(l.rate, a.currency)} = ${money(l.amount, a.currency)}`),
    ...(a.error ? ['', `Note: ${a.error}`] : []), '', `From ${h.from.name}${h.from.agentId ? ` (${h.from.agentId})` : ''}: ${clip(h.body, 1200)}`].join('\n');
}

// approve: the Quotation must be the draft the Owner saw (seenModified: the version on the card that was answered)
// and still a draft. With the owner key the server submits exactly that version (ERPNext refuses it when it changed
// in between); without one the approval is recorded and the Owner submits it in ERPNext.
export async function approve(id, { by = 'Owner', now = Date.now(), seenModified = undefined } = {}) {
  const h = hb.get(id);
  if (!h || h.status !== 'approval') throw notFound('This approval is not open any more');
  const name = String(h.erpnext).replace(/^Quotation\//, '');
  const who = credential('owner') ? 'owner' : reader();
  const seen = seenModified !== undefined ? seenModified : approvalOf(id)?.modified;
  const d = await getDoc(who, 'Quotation', name);
  if (d.docstatus !== 0) throw new HttpError(409, 'This Quotation is not a draft any more');
  if (!seen || seen !== d.modified) { await prepareApproval(h); throw new HttpError(409, 'The Quotation changed after it was shown to you: look at it again'); }
  const submitted = who === 'owner';
  if (submitted) await submitDoc('owner', 'Quotation', name, d);
  const after = submitted ? await getDoc('owner', 'Quotation', name).catch(() => d) : d;
  const lead = await leadOf(d).catch(() => null);
  const hours = (a, b) => (a && b ? Math.max(0, Math.round(((Date.parse(`${b.replace(' ', 'T')}Z`) - Date.parse(`${a.replace(' ', 'T')}Z`)) / 36e5) * 10) / 10) : null);
  const leadHandoff = mutate((st) => {
    record(st, name, { approvedAt: now, approvedBy: by, submitted, submittedAt: submitted ? after.modified : '', lead: lead?.name || '', leadAt: lead?.creation || '', draftAt: d.creation,
      leadToDraftH: hours(lead?.creation, d.creation), leadToApprovedH: hours(lead?.creation, after.modified) });
    return lead ? st.leads[lead.name]?.handoff : '';
  });
  deps.log(h.from.floorId, { type: 'erpnext.approved', agent: h.from.agentId || null, data: { quotation: name, handoff: id, by, submitted } });
  // the agent hears it (and drafts the cover e-mail); then the threads are closed: this one and the Lead's
  await hb.ownerReply(id, `The Owner approved Quotation ${name}${submitted ? ' and it is submitted in ERPNext' : '; the Owner submits it in ERPNext'}. Draft the cover e-mail for the customer in sales/drafts/ for the Owner to send (send nothing yourself), and note the next follow-up date on the Opportunity.`, { kind: 'answer', title: `Approved: ${name}` }).catch(() => null);
  for (const t of [h.thread, leadHandoff].filter((x) => x && x !== id)) try { hb.update(t, { status: 'done', doneAt: now }); } catch { /* gone */ }
  hb.update(id, { status: 'approved', approvedAt: now, approvedBy: by });
  deps.invalidate();
  return { ok: true, quotation: name, submitted };
}
export async function sendBack(id, note, { by = 'Owner', now = Date.now() } = {}) {
  const h = hb.get(id);
  if (!h || h.status !== 'approval') throw notFound('This approval is not open any more');
  if (!String(note || '').trim()) throw bad('Write what has to change');
  const r = await hb.ownerReply(id, note, { kind: 'clarify', now });
  deps.log(h.from.floorId, { type: 'erpnext.sent-back', agent: h.from.agentId || null, data: { quotation: h.erpnext, handoff: id, by } });
  deps.invalidate();
  return r;
}
// the Lead behind a Quotation: directly, or through its Opportunity
async function leadOf(d) {
  if (d.quotation_to === 'Lead' && d.party_name) return getDoc(reader(), 'Lead', d.party_name);
  if (d.opportunity) {
    const o = await getDoc(reader(), 'Opportunity', d.opportunity);
    if (o.opportunity_from === 'Lead' && o.party_name) return getDoc(reader(), 'Lead', o.party_name);
  }
  return null;
}
export function dismissAlert(alertId) {
  mutate((st) => { st.alerts = st.alerts.filter((a) => a.id !== alertId); });
  return { ok: true };
}

// ---------- numbers and status ----------
const median = (xs) => { const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10; };
export function metrics(st = loadState()) {
  const p = Object.entries(st.pipeline).map(([name, r]) => ({ name, ...r }));
  return { leads: Object.keys(st.leads).length, approved: p.filter((r) => r.approvedAt).length, won: Object.keys(st.won).length,
    leadToDraftH: median(p.map((r) => r.leadToDraftH)), leadToApprovedH: median(p.map((r) => r.leadToApprovedH)) };
}
export function status() {
  const st = loadState();
  return { settings: settings(), keys: keyStatus(), lastSync: st.lastSync, lastError: st.lastError, started: st.started, metrics: metrics(st), alerts: st.alerts,
    pipeline: Object.entries(st.pipeline).map(([name, r]) => ({ name, approvedAt: r.approvedAt || null, wonAt: r.wonAt || null, leadToApprovedH: r.leadToApprovedH ?? null, lead: r.lead || '' })).slice(-30).reverse(),
    mcpPath: MCP_PATH };
}
// a change of address or switching off starts the watcher over (it remembers where the pipeline is again)
export function saveSettings(input) {
  const prev = settings();
  const next = cleanSettings({ ...prev, ...input, sales: { ...prev.sales, ...(input?.sales || {}) }, delivery: { ...prev.delivery, ...(input?.delivery || {}) } });
  building.setPrefs({ erpnext: next });
  if (next.url !== prev.url || (next.enabled && !prev.enabled)) mutate((st) => { st.started = false; });
  return status();
}
