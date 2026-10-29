// SPDX-License-Identifier: Apache-2.0
// Small shared helpers for the UI: DOM, formatting, API calls with the local PIN, toast, modal.
import { t, tx } from './i18n.js';
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => `$${(+n || 0).toFixed(2)}`;
export const gb = (b) => `${(b / 2 ** 30).toFixed(1)} GB`;
// a time ahead or just past, on the wall clock: "Thu 22:30" (today: "22:30")
export function when(ts) {
  const d = new Date(ts), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return new Date().toDateString() === d.toDateString() ? hm : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${hm}`;
}

export function ago(ts) {
  if (!ts) return t('never');
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) });
  return t('{n} d ago', { n: Math.round(s / 86400) });
}
export const initials = (name) => String(name || '?').split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export function avatar(a, cls = '') {
  const ap = a.appearance || {};
  return `<span class="avatar ${cls}" style="--shirt:${esc(ap.shirt || '#3d82d6')};--hair:${esc(ap.hair || '#2b2440')}" aria-hidden="true">${esc(initials(a.displayName))}</span>`;
}
export const STATE_TEXT = { working: t('Working'), waiting: t('Waiting for you'), idle: t('Idle'), stopped: t('Stopped') };
// teammates on Squad Sprint / Blueprint Floors the lead has not started yet are "not started", not "stopped"
export const stateText = (a) => (a.standby ? t('Not started') : a.waitingReply ? t('Waiting for your reply') : STATE_TEXT[a.state]);

// unsent replies in Attention cards, kept across re-renders (item id -> text)
export const drafts = new Map();

// a small, safe subset of markdown for agent messages: paragraphs, headings, bold, italics, code, lists, tables
export function mdLite(src) {
  // links: [text](https://…) and bare https:// URLs open in a new tab (only http and https)
  const link = (s) => s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (m, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  const inline = (s) => link(esc(s)).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])[*_]([^*_\s][^*_]*)[*_](?=[\s.,;:)!?]|$)/g, '$1<i>$2</i>');
  const out = [];
  let para = [], list = null, table = null, code = null;
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    if (table) out.push(`<div class="mdTable"><table>${table.map((r, k) => `<tr>${r.map((c) => (k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table></div>`);
    para = []; list = null; table = null;
  };
  for (const line of String(src || '').split('\n')) {
    const t = line.trim();
    if (code) { if (t.startsWith('```')) { out.push(`<pre>${esc(code.join('\n'))}</pre>`); code = null; } else code.push(line); continue; }
    if (t.startsWith('```')) { flush(); code = []; continue; }
    if (!t) { flush(); continue; }
    let m;
    if (/^\|.*\|$/.test(t)) { if (!/^\|[\s:|-]+\|$/.test(t)) { if (!table) { flush(); table = []; } table.push(t.slice(1, -1).split('|').map((c) => c.trim())); } continue; }
    if ((m = t.match(/^#{1,6}\s+(.*)$/))) { flush(); out.push(`<h5>${inline(m[1])}</h5>`); continue; }
    if ((m = t.match(/^([-*•]|\d{1,3}[.)])\s+(.*)$/))) {
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; }
      list.items.push(m[2]); continue;
    }
    if (list || table) flush();
    para.push(t);
  }
  if (code) out.push(`<pre>${esc(code.join('\n'))}</pre>`);
  flush();
  return out.join('');
}

// text: already translated (t) or from the server (translated here with tx when it is a known message)
export function toast(text, ms = 2800) {
  const el = $('toast');
  el.textContent = tx(text); el.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), ms);
}

// ---------- PIN + API ----------
const PIN_KEY = 'aisquad.pin';
let pin = (() => { try { return localStorage.getItem(PIN_KEY) || ''; } catch { return ''; } })();
export const hasPin = () => !!pin;

export function askPin() {
  return new Promise((resolve) => {
    const d = $('pinDlg');
    $('pinIn').value = '';
    d.showModal();
    d.onclose = () => {
      if (d.returnValue !== 'ok') return resolve(false);
      pin = $('pinIn').value.trim();
      try { localStorage.setItem(PIN_KEY, pin); } catch { /* private mode */ }
      resolve(true);
    };
  });
}

// reads: send the PIN too (servers bound off loopback lock every API call); 401 is reported, not prompted
export async function getJson(url) {
  const r = await fetch(url, { headers: pin ? { 'x-aisquad-pin': pin } : {} });
  if (r.status === 401) throw Object.assign(new Error(t('PIN required')), { status: 401 });
  if (r.status === 404) return { notFound: true };
  return r.json();
}

// image with the PIN header (servers off loopback lock reads); null on any failure
export async function fetchImage(url) {
  try {
    const r = await fetch(url, { headers: pin ? { 'x-aisquad-pin': pin } : {} });
    return r.ok ? await createImageBitmap(await r.blob()) : null;
  } catch { return null; }
}

// key: an idempotency key for a submission (the server runs the same key once a minute, server/idempotency.js)
export async function api(method, url, body, { raw = null, headers = {}, quiet401 = false, key = '' } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const init = { method, headers: { 'x-aisquad-pin': pin, ...(key ? { 'x-idempotency-key': key } : {}), ...headers } };
    if (raw) init.body = raw;
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    const r = await fetch(url, init);
    if (r.status === 401) {
      if (quiet401) throw Object.assign(new Error(t('PIN required')), { status: 401 });
      if (!(await askPin())) throw Object.assign(new Error(t('PIN required')), { status: 401 });
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(tx(j.error) || t('Request failed ({status})', { status: r.status })), { status: r.status });
    return j;
  }
  throw new Error(t('Wrong PIN'));
}

// answering an Attention item: its context (floorId, agentId, kind) goes along, so typed text reaches the agent
// even when the item has moved on; "already answered" (409) is not an error for the owner
export async function answerItem(id, body, where = {}) {
  // the same answer to the same item (a double click, Enter and a click, two tabs) is one answer
  try { return await api('POST', `/api/attention/${id}/answer`, { ...body, floorId: where.floorId || '', agentId: where.agentId || '', kind: where.kind || '' }, { key: `answer:${id}:${hashOf(JSON.stringify(body))}` }); }
  catch (e) { if (e.status === 409) { toast(t('Already answered')); return { gone: true }; } throw e; }
}
// a short stable hash of a string (FNV-1a), for idempotency keys and notification de-duplication
export function hashOf(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
export const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
// one submission at a time per control (1.0.3): a spinner, disabled until the request settles; a second click or
// Enter while it runs does nothing. el: the button or form; fn: the request
export async function oneAtATime(el, fn) {
  if (!el || el.dataset.busy) return undefined;
  const btn = el.tagName === 'FORM' ? el.querySelector('button[type=submit], button:not([type])') : el;
  el.dataset.busy = '1';
  const was = btn ? btn.disabled : false;
  if (btn) { btn.disabled = true; btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } finally {
    delete el.dataset.busy;
    if (btn) { btn.disabled = was; btn.classList.remove('busy'); btn.removeAttribute('aria-busy'); }
  }
}
// the context of an Attention card (data attributes on .att)
export const itemContext = (el) => { const c = el?.closest?.('.att, [data-item-floor]'); return c ? { floorId: c.dataset.itemFloor || '', agentId: c.dataset.itemAgent || '', kind: c.dataset.itemKind || '' } : {}; };

// ---------- modal ----------
export function openModal(html, { onClose } = {}) {
  const d = $('modal');
  $('modalBody').innerHTML = html;
  d.className = '';                                   // a wide dialog (board, performance) never leaks into the next one
  if (!d.open) d.showModal();
  d.onclose = () => { $('modalBody').innerHTML = ''; onClose?.(); };
  return $('modalBody');
}
export const closeModal = () => { if ($('modal').open) $('modal').close(); };

export function segHtml(name, options, value) {
  return `<div class="seg" data-seg="${esc(name)}">${options.map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === value}">${esc(label)}</button>`).join('')}</div>`;
}
export function bindSegs(root, onChange) {
  root.querySelectorAll('[data-seg]').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onChange?.(seg.dataset.seg, b.dataset.v);
  }));
}
export const segValue = (root, name) => root.querySelector(`[data-seg="${name}"] [aria-pressed=true]`)?.dataset.v;

export function diffHtml(diff) {
  return `<div class="diff mono">${diff.map((l) => `<span class="${l.op === '+' ? 'add' : l.op === '-' ? 'del' : 'same'}">${esc(l.op)} ${esc(l.text) || '&nbsp;'}</span>`).join('')}</div>`;
}
